import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface RuntimeLaunchConfig {
  python: string;
  hermesRoot: string;
  profileHome: string;
  workingDirectory: string;
  manifestFile: string;
  defaultModel: string;
  models: { id: string; label: string }[];
}
async function privateJson(path: string): Promise<unknown> {
  if (!isAbsolute(path)) throw new Error('Invalid runtime configuration');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > 2_000_000) throw new Error('Unsafe runtime configuration');
    return JSON.parse(await file.readFile('utf8')) as unknown;
  } finally { await file.close(); }
}
export async function readRuntimeLaunchConfig(path: string): Promise<RuntimeLaunchConfig> {
  const value = await privateJson(path);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid runtime configuration');
  const config = value as RuntimeLaunchConfig;
  const names = ['python', 'hermesRoot', 'profileHome', 'workingDirectory', 'manifestFile', 'defaultModel', 'models'];
  if (Object.keys(config).some(key => !names.includes(key))) throw new Error('Invalid runtime configuration');
  for (const key of ['python', 'hermesRoot', 'profileHome', 'workingDirectory', 'manifestFile'] as const) {
    if (typeof config[key] !== 'string' || !isAbsolute(config[key])) throw new Error('Invalid runtime path');
  }
  if (typeof config.defaultModel !== 'string' || config.defaultModel.length > 256 || !Array.isArray(config.models) || !config.models.length || config.models.length > 100 ||
      config.models.some(model => !model || typeof model.id !== 'string' || !model.id || model.id.length > 256 || typeof model.label !== 'string' || model.label.length > 256) ||
      new Set(config.models.map(model => model.id)).size !== config.models.length || !config.models.some(model => model.id === config.defaultModel)) throw new Error('Invalid runtime models');
  return config;
}
/** Verifies deployment identity, not isolation by itself. Session policy metadata and
 * the enforced native policy are independently required by the ACP integration. */
export async function verifyRuntimeManifest(config: RuntimeLaunchConfig): Promise<boolean> {
  try {
    const value = await privateJson(config.manifestFile);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const manifest = value as { version?: unknown; root?: unknown; files?: Record<string, unknown> };
    if (manifest.version !== 1 || manifest.root !== config.hermesRoot || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) return false;
    const entries = Object.entries(manifest.files);
    if (!entries.length || entries.length > 10000 || !entries.some(([name]) => name === 'acp_adapter/entry.py')) return false;
    const root = await realpath(config.hermesRoot);
    for (const [name, expected] of entries) {
      if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected) || isAbsolute(name)) return false;
      const path = resolve(root, name);
      const rel = relative(root, path);
      if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || await realpath(path) !== path) return false;
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.size > 10_000_000) return false;
        if (createHash('sha256').update(await file.readFile()).digest('hex') !== expected) return false;
      } finally { await file.close(); }
    }
    return true;
  } catch { return false; }
}
export function runtimeEnvironment(config: RuntimeLaunchConfig): NodeJS.ProcessEnv {
  // Reuse Hermes's own profile-scoped credential resolver; never copy credentials
  // into browser settings or command arguments, nor inherit unrelated agent controls.
  return {
    HOME: process.env.HOME, PATH: process.env.PATH, LANG: process.env.LANG,
    HERMES_HOME: config.profileHome, PYTHONPATH: config.hermesRoot,
    PYTHONUNBUFFERED: '1',
  };
}
