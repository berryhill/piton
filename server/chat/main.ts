import { createServer } from 'node:http';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApplicationService, type ApplicationOptions } from './host.js';

export function startupOptions(env: Record<string, string | undefined>): ApplicationOptions & { port: number } {
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
  return { origin, port: Number(portText), staticDirectory, stateDirectory, allowLocalBootstrap, tailscaleLogin: env.PITON_TAILSCALE_LOGIN || undefined };
}

export async function startApplication(options: ApplicationOptions & { port: number }) {
  const application = await createApplicationService(options);
  const server = createServer(application.handler);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error) { await application.shutdown(); throw error; }
  return {
    async shutdown() {
      await application.shutdown();
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
    console.log(`Piton application listening on 127.0.0.1:${options.port}; agent execution remains default-denied.`);
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
