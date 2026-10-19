import { createServer } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApplicationService, type ApplicationOptions } from './host.js';
import { startAcpService, type AcpService } from './acp-service.js';
import { readRuntimeLaunchConfig, verifyRuntimeManifest, runtimeEnvironment } from './runtime-launch.js';

type StartupOptions = ApplicationOptions & { port: number; runtimeConfigPath?: string };
export function startupOptions(env: Record<string, string | undefined>): StartupOptions {
  const origin = env.PITON_ORIGIN ?? '';
  const url = new URL(origin);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new Error('Exact secure PITON_ORIGIN required');
  const portText = env.PITON_PORT ?? '';
  if (!/^[0-9]+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw new Error('Valid PITON_PORT required');
  const staticDirectory = env.PITON_DIST ?? '';
  const stateDirectory = env.PITON_CHAT_STATE ?? '';
  if (!isAbsolute(staticDirectory) || !isAbsolute(stateDirectory)) throw new Error('Absolute PITON_DIST and PITON_CHAT_STATE required');
  if (env.PITON_LOCAL_BOOTSTRAP !== undefined && !['0', '1'].includes(env.PITON_LOCAL_BOOTSTRAP)) throw new Error('PITON_LOCAL_BOOTSTRAP must be 0 or 1');
  const allowLocalBootstrap = env.PITON_LOCAL_BOOTSTRAP === '1';
  if (allowLocalBootstrap && !loopback) throw new Error('Anonymous bootstrap requires a loopback origin');
  const runtimeConfigPath = env.PITON_RUNTIME_CONFIG;
  if (runtimeConfigPath !== undefined && !isAbsolute(runtimeConfigPath)) throw new Error('Absolute PITON_RUNTIME_CONFIG required');
  return { origin, port: Number(portText), staticDirectory, stateDirectory, allowLocalBootstrap, tailscaleLogin: env.PITON_TAILSCALE_LOGIN || undefined, runtimeConfigPath };
}

export async function startApplication(options: StartupOptions) {
  let runtime: AcpService | undefined;
  if (options.runtimeConfigPath) {
    const config = await readRuntimeLaunchConfig(options.runtimeConfigPath);
    if (!await verifyRuntimeManifest(config)) throw new Error('Runtime source identity verification failed');
    runtime = await startAcpService({
      executable: config.python, argv: ['-m', 'acp_adapter', '--conversation-only'],
      cwd: config.workingDirectory, env: runtimeEnvironment(config),
      stateDirectory: join(options.stateDirectory, 'runtime'),
      defaultModel: config.defaultModel, models: config.models,
      attestRestrictedRuntime: () => verifyRuntimeManifest(config),
    });
  }
  let application: Awaited<ReturnType<typeof createApplicationService>>;
  try {
    application = await createApplicationService({ ...options, ...(runtime ? {
      env: runtime.env, verifyConversationIsolation: () => runtime!.verifyIsolation(), runtimeManagement: runtime.management,
    } : {}) });
  } catch (error) { await runtime?.shutdown(); throw error; }
  const server = createServer(application.handler);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error) { await application.shutdown(); await runtime?.shutdown(); throw error; }
  return {
    async shutdown() {
      await application.shutdown();
      await runtime?.shutdown();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = startupOptions(process.env);
    const application = await startApplication(options);
    // Server bind is loopback only. Runtime isolation is deliberately not synthesized.
    console.log(`Piton application listening on 127.0.0.1:${options.port}; ACP execution requires verified conversation-only policy.`);
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void application.shutdown().then(() => process.exit(0), () => process.exit(1));
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch {
    // Do not render environment or credential-bearing exception details.
    console.error('Piton application startup failed. Check the required non-secret startup settings and private storage.');
    process.exitCode = 1;
  }
}
