import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readRuntimeLaunchConfig, verifyRuntimeManifest, runtimeEnvironment } from './runtime-launch.js';

describe('server-owned runtime launch configuration', () => {
  it('requires private configuration and pinned source bytes; rejects drift and escaping entries', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.piton-runtime-test-'));
    try {
      await mkdir(join(directory, 'acp_adapter'));
      const source = join(directory, 'acp_adapter/entry.py');
      await writeFile(source, '# synthetic runtime fixture\n');
      const manifestFile = join(directory, 'manifest.json');
      const manifest = { version: 1, root: directory, files: { 'acp_adapter/entry.py': createHash('sha256').update(await readFile(source)).digest('hex') } };
      await writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
      const config = { python: '/test/python', hermesRoot: directory, profileHome: '/test/profile', workingDirectory: '/test/work', manifestFile, defaultModel: 'test', models: [{ id: 'test', label: 'Test model' }] };
      const path = join(directory, 'launch.json');
      await writeFile(path, JSON.stringify(config), { mode: 0o600 });
      expect(await readRuntimeLaunchConfig(path)).toEqual(config);
      expect(await verifyRuntimeManifest(config)).toBe(true);
      await writeFile(source, '# changed\n');
      expect(await verifyRuntimeManifest(config)).toBe(false);
      await writeFile(manifestFile, JSON.stringify({ ...manifest, files: { '../outside.py': '0'.repeat(64) } }));
      expect(await verifyRuntimeManifest(config)).toBe(false);
      await chmod(path, 0o644);
      await expect(readRuntimeLaunchConfig(path)).rejects.toThrow('Unsafe runtime configuration');
      expect(runtimeEnvironment(config)).toMatchObject({ HERMES_HOME: '/test/profile', PYTHONPATH: directory });
      expect(runtimeEnvironment(config)).not.toHaveProperty('API_SERVER_KEY');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('rejects browser-style executable overrides and unknown default models', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.piton-runtime-test-'));
    try {
      const path = join(directory, 'launch.json');
      await writeFile(path, JSON.stringify({ executable: 'sh', model: 'untrusted' }), { mode: 0o600 });
      await expect(readRuntimeLaunchConfig(path)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
