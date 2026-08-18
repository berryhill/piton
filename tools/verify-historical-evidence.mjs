#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_COMMIT = "2e865a8c837dc96f883e2cb39f73311e60629f18";
const SOURCE_TREE = "379d5d3409981dbda71eb3cf08d44e4a6025de7a";
const RECURSIVE_ROOT = "evidence/stage0";
const SINGLE_FILE = "docs/baseline-freeze-8af59d7.md";
const EXPECTED_ENTRY_COUNT = 29;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(repoRoot, args, options = {}) {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

function assertSafeRelativePath(filePath) {
  assert.equal(typeof filePath, "string", "manifest paths must be strings");
  assert.ok(filePath.length > 0, "manifest paths must not be empty");
  assert.ok(!path.posix.isAbsolute(filePath), `absolute path rejected: ${filePath}`);
  assert.ok(!filePath.includes("\\"), `backslash path rejected: ${filePath}`);
  assert.equal(path.posix.normalize(filePath), filePath, `non-normalized path rejected: ${filePath}`);
  assert.ok(!filePath.split("/").some((part) => part === "" || part === "." || part === ".."), `unsafe path rejected: ${filePath}`);
}

export function readPinnedTree(repoRoot) {
  const actualTree = git(repoRoot, ["rev-parse", `${SOURCE_COMMIT}^{tree}`]).toString("utf8").trim();
  assert.equal(actualTree, SOURCE_TREE, "pinned source tree does not match the audited tree");

  const listing = git(repoRoot, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    SOURCE_COMMIT,
    "--",
    RECURSIVE_ROOT,
    SINGLE_FILE,
  ]);
  const records = listing.toString("utf8").split("\0").filter(Boolean);
  const result = new Map();

  for (const record of records) {
    const tab = record.indexOf("\t");
    assert.ok(tab > 0, `malformed git tree record: ${record}`);
    const [mode, type, gitBlobOid] = record.slice(0, tab).split(" ");
    const filePath = record.slice(tab + 1);
    assertSafeRelativePath(filePath);
    assert.equal(mode, "100644", `historical evidence must be a regular non-executable file: ${filePath}`);
    assert.equal(type, "blob", `historical evidence must be a blob: ${filePath}`);
    assert.ok(!result.has(filePath), `duplicate pinned path: ${filePath}`);
    const bytes = git(repoRoot, ["cat-file", "blob", gitBlobOid]);
    result.set(filePath, { gitBlobOid, sha256: sha256(bytes), bytes });
  }

  assert.equal(result.size, EXPECTED_ENTRY_COUNT, "unexpected pinned historical-evidence path count");
  return result;
}

export function readManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.format, "piton-historical-evidence-manifest/v1");
  assert.equal(manifest.base_commit, SOURCE_COMMIT, "manifest cannot select another authority commit");
  assert.equal(manifest.base_tree, SOURCE_TREE, "manifest cannot select another authority tree");
  assert.equal(manifest.authority, "fixed_git_tree");
  assert.equal(manifest.current_product_authority, false);
  assert.ok(Array.isArray(manifest.entries), "manifest entries must be an array");
  assert.equal(manifest.entries.length, EXPECTED_ENTRY_COUNT, "unexpected manifest entry count");

  const byPath = new Map();
  for (const entry of manifest.entries) {
    assertSafeRelativePath(entry.path);
    assert.match(entry.git_blob_oid, /^[0-9a-f]{40}$/);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(!byPath.has(entry.path), `duplicate manifest path: ${entry.path}`);
    byPath.set(entry.path, entry);
  }
  return { manifest, byPath };
}

function walkRegularFiles(repoRoot, relativeDir) {
  const result = [];
  const visit = (relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    const stat = lstatSync(absolutePath);
    assert.ok(!stat.isSymbolicLink(), `historical evidence symlink rejected: ${relativePath}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolutePath).sort()) {
        visit(path.posix.join(relativePath, name));
      }
      return;
    }
    assert.ok(stat.isFile(), `historical evidence must be a regular file: ${relativePath}`);
    result.push(relativePath);
  };
  visit(relativeDir);
  return result;
}

export function listCurrentScope(repoRoot) {
  const baselineStat = lstatSync(path.join(repoRoot, SINGLE_FILE));
  assert.ok(baselineStat.isFile() && !baselineStat.isSymbolicLink(), `${SINGLE_FILE} must be a regular file`);
  return [...walkRegularFiles(repoRoot, RECURSIVE_ROOT), SINGLE_FILE].sort();
}

export function verifyHistoricalEvidence({ repoRoot, manifestPath = path.join(repoRoot, "docs/historical-evidence-manifest.json") }) {
  const pinned = readPinnedTree(repoRoot);
  const { byPath } = readManifest(manifestPath);
  const pinnedPaths = [...pinned.keys()].sort();
  const manifestPaths = [...byPath.keys()].sort();
  const currentPaths = listCurrentScope(repoRoot);

  assert.deepEqual(manifestPaths, pinnedPaths, "manifest path set differs from the fixed Git tree");
  assert.deepEqual(currentPaths, pinnedPaths, "current historical-evidence path set differs from the fixed Git tree");

  for (const filePath of pinnedPaths) {
    const expected = pinned.get(filePath);
    const declared = byPath.get(filePath);
    const current = readFileSync(path.join(repoRoot, filePath));
    assert.equal(declared.git_blob_oid, expected.gitBlobOid, `Git blob OID drift: ${filePath}`);
    assert.equal(declared.sha256, expected.sha256, `manifest SHA-256 drift: ${filePath}`);
    assert.equal(sha256(current), expected.sha256, `current SHA-256 drift: ${filePath}`);
    assert.ok(current.equals(expected.bytes), `current bytes differ from fixed Git blob: ${filePath}`);
  }
  return { baseCommit: SOURCE_COMMIT, baseTree: SOURCE_TREE, entryCount: pinned.size };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = verifyHistoricalEvidence({ repoRoot });
  console.log(`historical evidence verified: ${result.entryCount} files at ${result.baseCommit}`);
}
