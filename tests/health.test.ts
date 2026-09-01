import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerHealthcheckTools } from '../src/tools/health.js';

function setup(env: Record<string, string | undefined>, probe?: () => Promise<unknown>) {
  const request = vi.fn(probe ?? (async () => ({ data: [{ id: 'app1' }] })));
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerHealthcheckTools(server, { request } as any, (k: string) => env[k]);
  const call = async () =>
    JSON.parse((await (server as any)._registeredTools.asc_healthcheck.handler({}, {})).content[0].text);
  return { server, call, request };
}

const FULL = {
  APP_STORE_CONNECT_KEY_ID: 'K123',
  APP_STORE_CONNECT_ISSUER_ID: 'I456',
  APP_STORE_CONNECT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
};

afterEach(() => vi.clearAllMocks());

describe('asc_healthcheck', () => {
  it('registers the tool', () => {
    expect(Object.keys((setup(FULL).server as any)._registeredTools)).toEqual(['asc_healthcheck']);
  });

  it('reports ok when the credential resolves and the probe succeeds', async () => {
    const out = await setup(FULL).call();
    expect(out.ok).toBe(true);
    expect(out.credential.resolved).toBe(true);
  });

  it('probes a single app rather than the whole account', async () => {
    const { call, request } = setup(FULL);
    await call();
    expect(request).toHaveBeenCalledWith('GET', '/v1/apps', undefined, { limit: 1 });
  });

  it('reports the key and issuer ids, which are not secret', async () => {
    const out = await setup(FULL).call();
    expect(out.credential.detail.key_id).toBe('K123');
    expect(out.credential.detail.issuer_id).toBe('I456');
  });

  it('never echoes the private key', async () => {
    const out = await setup({ ...FULL, APP_STORE_CONNECT_PRIVATE_KEY: 'SUPER-SECRET-PEM' }).call();
    expect(JSON.stringify(out)).not.toContain('SUPER-SECRET-PEM');
  });

  it('names the key file when the PEM came from a path', async () => {
    const out = await setup({
      APP_STORE_CONNECT_KEY_ID: 'K',
      APP_STORE_CONNECT_ISSUER_ID: 'I',
      APP_STORE_CONNECT_PRIVATE_KEY_PATH: '/keys/AuthKey.p8',
    }).call();
    expect(out.credential.source).toBe('APP_STORE_CONNECT_PRIVATE_KEY_PATH');
  });

  // Three separate env vars, each individually fatal. "Check your credentials"
  // is useless advice when only one of them is missing.
  it('names which of the three settings is missing', async () => {
    const out = await setup({ APP_STORE_CONNECT_ISSUER_ID: 'I', APP_STORE_CONNECT_PRIVATE_KEY: 'k' }).call();
    expect(out.ok).toBe(false);
    expect(out.error.kind).toBe('no_credential');
    expect(out.hint).toMatch(/APP_STORE_CONNECT_KEY_ID/);
  });

  it('names a missing private key distinctly from a missing id', async () => {
    const out = await setup({ APP_STORE_CONNECT_KEY_ID: 'K', APP_STORE_CONNECT_ISSUER_ID: 'I' }).call();
    expect(out.hint).toMatch(/APP_STORE_CONNECT_PRIVATE_KEY/);
  });

  it('skips the probe when the credential is incomplete', async () => {
    const { call, request } = setup({});
    await call();
    expect(request).not.toHaveBeenCalled();
  });

  it('reports a rejected key as credential_rejected', async () => {
    const out = await setup(FULL, async () => { throw new Error('HTTP 401 Unauthorized'); }).call();
    expect(out.error.kind).toBe('credential_rejected');
    expect(out.hint).toMatch(/revoked|expired|clock/i);
  });

  it('leaves an unrecognised failure to the helper defaults', async () => {
    const out = await setup(FULL, async () => { throw new Error('socket hang up'); }).call();
    expect(out.ok).toBe(false);
    expect(out.error.kind).not.toBe('credential_rejected');
  });

  it('classifies a non-Error throw without crashing', async () => {
    const out = await setup(FULL, async () => { throw 'HTTP 401 Unauthorized'; }).call();
    expect(out.error.kind).toBe('credential_rejected');
  });

  it('reads the real environment when no reader is injected', async () => {
    vi.stubEnv('APP_STORE_CONNECT_KEY_ID', 'REALK');
    vi.stubEnv('APP_STORE_CONNECT_ISSUER_ID', 'REALI');
    vi.stubEnv('APP_STORE_CONNECT_PRIVATE_KEY', 'REAL-PEM');
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerHealthcheckTools(server, { request: vi.fn(async () => ({})) } as any);
    const out = JSON.parse(
      (await (server as any)._registeredTools.asc_healthcheck.handler({}, {})).content[0].text,
    );
    expect(out.credential.detail.key_id).toBe('REALK');
    expect(JSON.stringify(out)).not.toContain('REAL-PEM');
    vi.unstubAllEnvs();
  });
});
