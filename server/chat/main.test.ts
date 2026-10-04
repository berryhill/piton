import { describe, expect, it } from 'vitest';
import { startupOptions } from './main.js';

const valid = {
  PITON_ORIGIN: 'http://127.0.0.1:14446',
  PITON_PORT: '14446',
  PITON_DIST: '/private/piton/dist',
  PITON_CHAT_STATE: '/private/piton/state',
};
describe('application startup settings', () => {
  it('requires explicit paths, exact origin and loopback listen port', () => {
    expect(startupOptions(valid)).toMatchObject({ port: 14446, origin: valid.PITON_ORIGIN, staticDirectory: valid.PITON_DIST, stateDirectory: valid.PITON_CHAT_STATE, allowLocalBootstrap: false });
    for (const name of Object.keys(valid)) expect(() => startupOptions({ ...valid, [name]: '' })).toThrow();
    for (const port of ['0', '-1', '65536', '14446junk']) expect(() => startupOptions({ ...valid, PITON_PORT: port })).toThrow();
    expect(() => startupOptions({ ...valid, PITON_DIST: 'dist' })).toThrow();
    expect(() => startupOptions({ ...valid, PITON_ORIGIN: 'http://public.example' })).toThrow();
    expect(() => startupOptions({ ...valid, PITON_ORIGIN: 'https://example.test/path' })).toThrow();
  });
  it('does not permit a public origin to request anonymous bootstrap', () => {
    expect(() => startupOptions({ ...valid, PITON_ORIGIN: 'https://example.test', PITON_LOCAL_BOOTSTRAP: '1' })).toThrow();
    expect(startupOptions({ ...valid, PITON_LOCAL_BOOTSTRAP: '1' }).allowLocalBootstrap).toBe(true);
    expect(startupOptions({ ...valid, PITON_ORIGIN: 'https://example.test', PITON_TAILSCALE_LOGIN: 'operator@example.test' }).tailscaleLogin).toBe('operator@example.test');
    expect(startupOptions(valid).verifyConversationIsolation).toBeUndefined();
  });
});
