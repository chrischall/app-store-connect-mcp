import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, createPublicKey, createVerify } from 'crypto';
import { AppStoreConnectClient, mintJwt, signES256, buildUrl } from '../src/client.js';

function generateP256Pem(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  };
}

function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [headerB64, payloadB64] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(headerB64!, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8')),
  };
}

function makeResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  const headers = new Headers();
  headers.set('content-type', contentType);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : `Error ${status}`,
    headers,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
    arrayBuffer: async () => (body instanceof Buffer ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new ArrayBuffer(0)),
  } as unknown as Response;
}

describe('signES256 + mintJwt', () => {
  it('produces a JWT that verifies against the matching public key', () => {
    const { privatePem, publicPem } = generateP256Pem();
    const token = mintJwt({ keyId: 'ABC123', issuerId: '57246542-96fe-1a63-e053', privateKey: privatePem });
    const [headerB64, payloadB64, sigB64] = token.split('.');

    const { header, payload } = decodeJwt(token);
    expect(header).toMatchObject({ alg: 'ES256', kid: 'ABC123', typ: 'JWT' });
    expect(payload).toMatchObject({ iss: '57246542-96fe-1a63-e053', aud: 'appstoreconnect-v1' });
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect((payload.exp as number) - (payload.iat as number)).toBe(20 * 60);

    // Verify signature: ES256 IEEE-P1363 sig should verify with same dsaEncoding setting
    const verifier = createVerify('SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    const ok = verifier.verify(
      { key: createPublicKey({ key: publicPem, format: 'pem' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(sigB64!, 'base64url')
    );
    expect(ok).toBe(true);
  });

  it('signES256 returns a 64-byte (P1363) signature for P-256 keys', () => {
    const { privatePem } = generateP256Pem();
    const sig = signES256(privatePem, 'hello.world');
    const decoded = Buffer.from(sig, 'base64url');
    expect(decoded.length).toBe(64);
  });
});

describe('buildUrl', () => {
  it('serializes scalar query params', () => {
    const u = buildUrl('/v1/apps', { limit: 10, 'filter[name]': 'My App' });
    expect(u).toContain('https://api.appstoreconnect.apple.com/v1/apps');
    expect(u).toContain('limit=10');
    expect(u).toContain('filter%5Bname%5D=My+App');
  });

  it('joins array values with commas', () => {
    const u = buildUrl('/v1/users', { 'filter[roles]': ['ADMIN', 'DEVELOPER'] });
    expect(u).toContain('filter%5Broles%5D=ADMIN%2CDEVELOPER');
  });

  it('skips undefined and empty arrays', () => {
    const u = buildUrl('/v1/apps', { limit: undefined, foo: [] });
    expect(u).not.toContain('limit=');
    expect(u).not.toContain('foo=');
  });
});

describe('AppStoreConnectClient.request', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const { privatePem } = generateP256Pem();

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.APP_STORE_CONNECT_KEY_ID = 'TESTKEY01';
    process.env.APP_STORE_CONNECT_ISSUER_ID = 'issuer-uuid';
    process.env.APP_STORE_CONNECT_PRIVATE_KEY = privatePem;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.APP_STORE_CONNECT_KEY_ID;
    delete process.env.APP_STORE_CONNECT_ISSUER_ID;
    delete process.env.APP_STORE_CONNECT_PRIVATE_KEY;
    delete process.env.APP_STORE_CONNECT_PRIVATE_KEY_PATH;
  });

  it('throws when APP_STORE_CONNECT_KEY_ID is missing', async () => {
    delete process.env.APP_STORE_CONNECT_KEY_ID;
    const c = new AppStoreConnectClient();
    await expect(c.request('GET', '/v1/apps')).rejects.toThrow('APP_STORE_CONNECT_KEY_ID must be set');
  });

  it('throws when APP_STORE_CONNECT_ISSUER_ID is missing', async () => {
    delete process.env.APP_STORE_CONNECT_ISSUER_ID;
    const c = new AppStoreConnectClient();
    await expect(c.request('GET', '/v1/apps')).rejects.toThrow('APP_STORE_CONNECT_ISSUER_ID must be set');
  });

  it('throws helpful error when private key is missing', async () => {
    delete process.env.APP_STORE_CONNECT_PRIVATE_KEY;
    const c = new AppStoreConnectClient();
    await expect(c.request('GET', '/v1/apps')).rejects.toThrow(/private key not configured/);
  });

  it('sends Bearer JWT and accepts JSON', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ data: [] }));
    const c = new AppStoreConnectClient();
    await c.request('GET', '/v1/apps');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.appstoreconnect.apple.com/v1/apps');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization ?? headers.authorization).toMatch(/^Bearer ey/);
    expect(headers.Accept ?? headers.accept).toBe('application/json');
  });

  it('sends body as JSON with content-type for POST', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ data: { type: 'foo', id: '1' } }));
    const c = new AppStoreConnectClient();
    await c.request('POST', '/v1/betaTesters', { foo: 'bar' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type'] ?? headers['content-type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ foo: 'bar' }));
    expect(init.method).toBe('POST');
  });

  it('serializes query params into the URL', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ data: [] }));
    const c = new AppStoreConnectClient();
    await c.request('GET', '/v1/apps', undefined, { limit: 5, 'filter[bundleId]': 'com.example.x' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('limit=5');
    expect(url).toContain('filter%5BbundleId%5D=com.example.x');
  });

  it('caches token between requests within lifetime', async () => {
    fetchMock.mockResolvedValue(makeResponse({ data: [] }));
    const c = new AppStoreConnectClient();
    await c.request('GET', '/v1/apps');
    await c.request('GET', '/v1/apps');
    const auth1 = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const auth2 = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(auth1.authorization).toBe(auth2.authorization);
  });

  it('re-mints token and retries once on 401', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse({ errors: [{ status: '401' }] }, 401))
      .mockResolvedValueOnce(makeResponse({ data: [] }));
    const c = new AppStoreConnectClient();
    const result = await c.request<{ data: [] }>('GET', '/v1/apps');
    expect(result.data).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('mints a fresh token for the 401 replay (cache cleared, not resent)', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse({ errors: [{ status: '401' }] }, 401))
      .mockResolvedValueOnce(makeResponse({ data: [] }));
    const c = new AppStoreConnectClient();
    await c.request('GET', '/v1/apps');

    const auth1 = ((fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>);
    const auth2 = ((fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>);
    const token1 = (auth1.Authorization ?? auth1.authorization)!;
    const token2 = (auth2.Authorization ?? auth2.authorization)!;
    expect(token1).toMatch(/^Bearer ey/);
    expect(token2).toMatch(/^Bearer ey/);
    // ES256 signatures are randomized, so a re-minted JWT never equals the
    // cached one — proving the replay used a fresh mint, not the stale token.
    expect(token2).not.toBe(token1);
  });

  it('surfaces an unauthorized error when the 401 persists after the re-mint replay', async () => {
    fetchMock.mockResolvedValue(makeResponse({ errors: [{ status: '401' }] }, 401));
    const c = new AppStoreConnectClient();
    await expect(c.request('GET', '/v1/apps')).rejects.toThrow(/[Uu]nauthorized/);
    // exactly one replay: initial attempt + one re-minted retry
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('passes a timeout AbortSignal to fetch so requests cannot hang forever', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ data: [] }));
    const c = new AppStoreConnectClient();
    await c.request('GET', '/v1/apps');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.signal as AbortSignal).aborted).toBe(false);
  });

  it('retries once on 429 with backoff', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    fetchMock
      .mockResolvedValueOnce(makeResponse({}, 429))
      .mockResolvedValueOnce(makeResponse({ data: [] }));
    const c = new AppStoreConnectClient();
    await c.request('GET', '/v1/apps');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws helpful error on non-2xx with body excerpt', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ errors: [{ title: 'Forbidden' }] }, 403));
    const c = new AppStoreConnectClient();
    await expect(c.request('GET', '/v1/apps')).rejects.toThrow(/App Store Connect error 403 for GET \/v1\/apps.*Forbidden/);
  });

  it('strips `${...}` placeholder env values', async () => {
    process.env.APP_STORE_CONNECT_KEY_ID = '${APP_STORE_CONNECT_KEY_ID}';
    const c = new AppStoreConnectClient();
    await expect(c.request('GET', '/v1/apps')).rejects.toThrow('APP_STORE_CONNECT_KEY_ID must be set');
  });
});

describe('AppStoreConnectClient.requestRaw', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const { privatePem } = generateP256Pem();

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.APP_STORE_CONNECT_KEY_ID = 'KEYID';
    process.env.APP_STORE_CONNECT_ISSUER_ID = 'ISSUERID';
    process.env.APP_STORE_CONNECT_PRIVATE_KEY = privatePem;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns raw buffer for binary report responses', async () => {
    const fakeBuffer = Buffer.from([0x1f, 0x8b, 0x08, 0x00]); // gzip magic
    const headers = new Headers();
    headers.set('content-type', 'application/a-gzip');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers,
      arrayBuffer: async () => fakeBuffer.buffer.slice(fakeBuffer.byteOffset, fakeBuffer.byteOffset + fakeBuffer.byteLength),
      text: async () => '',
    } as unknown as Response);

    const c = new AppStoreConnectClient();
    const result = await c.requestRaw('GET', '/v1/salesReports', { 'filter[vendorNumber]': '8001' });

    expect(result.contentType).toBe('application/a-gzip');
    expect(Buffer.compare(result.buffer, fakeBuffer)).toBe(0);
  });

  it('re-mints and replays once on 401', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse('', 401))
      .mockResolvedValueOnce(makeResponse(Buffer.from([0x1f, 0x8b])));
    const c = new AppStoreConnectClient();
    const result = await c.requestRaw('GET', '/v1/salesReports');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('retries once on 429 with backoff', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    fetchMock
      .mockResolvedValueOnce(makeResponse('', 429))
      .mockResolvedValueOnce(makeResponse(Buffer.from([0x1f, 0x8b])));
    const c = new AppStoreConnectClient();
    await c.requestRaw('GET', '/v1/salesReports');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('passes a timeout AbortSignal to fetch', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(Buffer.from([0x1f, 0x8b])));
    const c = new AppStoreConnectClient();
    await c.requestRaw('GET', '/v1/salesReports');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
