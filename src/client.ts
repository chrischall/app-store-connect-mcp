import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { createPrivateKey, sign as cryptoSign } from 'crypto';
import {
  createApiClient,
  formatApiError,
  loadDotenvSafely,
  readEnvVar,
  expandPath,
  type ApiClient,
} from '@chrischall/mcp-utils';
import type { AscEnvelope, AscResource } from './types.js';

// Load .env (local dev) from the package root. `loadDotenvSafely` swallows a
// missing dotenv module (bundled mcpb runtime) and never lets .env override a
// host-provided value.
const __dirname = dirname(fileURLToPath(import.meta.url));
await loadDotenvSafely({ path: join(__dirname, '..', '.env'), override: false });

/**
 * Read an env var, trim whitespace, and treat as unset if blank or if the value
 * looks like an unsubstituted shell placeholder (e.g. `${FOO}`) — defends
 * against MCP hosts that pass .mcp.json env blocks through unexpanded.
 *
 * Backed by the shared `readEnvVar` from `@chrischall/mcp-utils`, which applies
 * the same trim + blank/`undefined`/`null`/`${...}`-placeholder suppression.
 */
function readVar(key: string): string | undefined {
  return readEnvVar(key);
}

export const API_BASE = 'https://api.appstoreconnect.apple.com';
const SERVICE_NAME = 'App Store Connect';

// Pagination defaults. ASC paginates via the response BODY's `links.next` (a
// full URL cursor), NOT a Link header. `maxPages` is a safety cap so a buggy or
// hostile cursor stream can never loop unboundedly.
const DEFAULT_PAGE_CAP = 1000;
const MAX_PAGES = 50;

// JWT lifetime: Apple allows up to 20 minutes. We re-mint with 2-minute buffer.
const JWT_LIFETIME_SEC = 20 * 60;
const JWT_REFRESH_BUFFER_MS = 2 * 60 * 1000;

// Per-request timeout (the repo previously had none — requests could hang
// until the MCP host killed the tool call).
const REQUEST_TIMEOUT_MS = 30_000;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Resolve the App Store Connect private key (PEM string) from env.
 * Supports either inline PEM (`APP_STORE_CONNECT_PRIVATE_KEY`) or a file path
 * (`APP_STORE_CONNECT_PRIVATE_KEY_PATH`) pointing at a downloaded `.p8`.
 */
function resolvePrivateKey(): string {
  const inline = readVar('APP_STORE_CONNECT_PRIVATE_KEY');
  if (inline) {
    // Allow `\n`-escaped PEMs (common when passing through env injection).
    return inline.includes('-----BEGIN') ? inline.replace(/\\n/g, '\n') : inline;
  }
  const path = readVar('APP_STORE_CONNECT_PRIVATE_KEY_PATH');
  if (path) {
    // expandPath resolves a leading `~`/`~/...` to the user's home dir and any
    // remaining relative path against the CWD; absolute paths pass through.
    return readFileSync(expandPath(path), 'utf8');
  }
  throw new Error(
    'App Store Connect private key not configured. Set APP_STORE_CONNECT_PRIVATE_KEY (PEM contents) ' +
      'or APP_STORE_CONNECT_PRIVATE_KEY_PATH (path to your .p8 file). ' +
      'Generate keys at https://appstoreconnect.apple.com/access/integrations/api'
  );
}

/**
 * Sign a string with ES256 (ECDSA P-256 + SHA-256) and return a base64url
 * JWS signature in IEEE P1363 (raw r||s) format — JWT spec, not DER.
 */
export function signES256(privateKeyPem: string, payload: string): string {
  const key = createPrivateKey({ key: privateKeyPem, format: 'pem' });
  const sig = cryptoSign('SHA256', Buffer.from(payload), { key, dsaEncoding: 'ieee-p1363' });
  return sig.toString('base64url');
}

export interface JwtConfig {
  keyId: string;
  issuerId: string;
  privateKey: string;
}

/**
 * Mint an App Store Connect JWT (ES256, 20-minute lifetime).
 * https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
 */
export function mintJwt(config: JwtConfig, now: Date = new Date()): string {
  const header = { alg: 'ES256', kid: config.keyId, typ: 'JWT' };
  const iat = Math.floor(now.getTime() / 1000);
  const payload = {
    iss: config.issuerId,
    iat,
    exp: iat + JWT_LIFETIME_SEC,
    aud: 'appstoreconnect-v1',
  };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${headerB64}.${payloadB64}`;
  const sigB64 = signES256(config.privateKey, data);
  return `${data}.${sigB64}`;
}

export class AppStoreConnectClient {
  private cachedToken: string | null = null;
  private cachedTokenExpiry: Date | null = null;
  private readonly api: ApiClient;

  constructor() {
    // Shared bearer-client kit (one-shot 429 retry, 401 mapping, 204/empty
    // handling, redacted errors, per-attempt timeout). Auth is routed through a
    // small ReactiveTokenSource adapter over the Apple-specific ES256 mint so
    // the exact clear-cache → re-mint → replay-once-on-401 semantics survive.
    this.api = createApiClient({
      baseUrl: API_BASE,
      serviceName: SERVICE_NAME,
      tokenManager: { withAuth: (call) => this.withAuth(call) },
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  /**
   * Run `call` with a freshly-ensured JWT; on a 401, clear the cached token,
   * re-mint, and replay exactly once. A second 401 surfaces through the shared
   * client's unauthorized mapping.
   */
  private async withAuth(call: (accessToken: string) => Promise<Response>): Promise<Response> {
    const first = await call(this.ensureToken());
    if (first.status !== 401) return first;
    this.cachedToken = null;
    this.cachedTokenExpiry = null;
    return call(this.ensureToken());
  }

  /**
   * Make an authenticated request to the App Store Connect API.
   *
   * `path` should start with `/v1/...`. `body` is JSON-serialized when present.
   * For non-JSON responses (e.g. report TSVs), use `requestRaw`.
   */
  async request<T>(method: HttpMethod, path: string, body?: unknown, query?: Record<string, string | number | string[] | undefined>): Promise<T> {
    // buildUrl keeps Apple's comma-joined array convention (the shared
    // buildQueryString expands arrays as repeated keys, which ASC rejects).
    const pathWithQuery = buildUrl(path, query).slice(API_BASE.length);
    return this.api.fetchJson<T>(method, pathWithQuery, body !== undefined ? { body } : {});
  }

  /**
   * Make an authenticated request and return the raw response body as a Buffer.
   * Used for sales/finance report downloads which return gzipped TSVs — a thin
   * local raw-fetch path (the shared client has no fetchRaw), sharing the same
   * withAuth re-mint/replay, one-shot 429 retry, and timeout.
   */
  async requestRaw(method: HttpMethod, path: string, query?: Record<string, string | number | string[] | undefined>): Promise<{ buffer: Buffer; contentType: string | null }> {
    const url = buildUrl(path, query);
    const doFetch = (token: string): Promise<Response> =>
      fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

    let response = await this.withAuth(doFetch);
    if (response.status === 429) {
      await new Promise<void>((r) => setTimeout(r, 2000));
      response = await this.withAuth(doFetch);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(formatApiError(response.status, method, path, text, { service: SERVICE_NAME }));
    }
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType: response.headers.get('content-type') };
  }

  private ensureToken(): string {
    if (this.cachedToken && this.cachedTokenExpiry) {
      if (this.cachedTokenExpiry.getTime() - Date.now() > JWT_REFRESH_BUFFER_MS) {
        return this.cachedToken;
      }
    }
    const keyId = readVar('APP_STORE_CONNECT_KEY_ID');
    const issuerId = readVar('APP_STORE_CONNECT_ISSUER_ID');
    if (!keyId) throw new Error('APP_STORE_CONNECT_KEY_ID must be set');
    if (!issuerId) throw new Error('APP_STORE_CONNECT_ISSUER_ID must be set');
    const privateKey = resolvePrivateKey();

    const now = new Date();
    this.cachedToken = mintJwt({ keyId, issuerId, privateKey }, now);
    this.cachedTokenExpiry = new Date(now.getTime() + JWT_LIFETIME_SEC * 1000);
    return this.cachedToken;
  }
}

/**
 * Build a fully-qualified URL with serialized query params.
 * App Store Connect uses JSON:API conventions: filter[name]=val, fields[apps]=foo,bar, sort=-createdDate, limit=N.
 * Repeated keys with array values are joined with commas (the App Store Connect convention).
 */
export function buildUrl(path: string, query?: Record<string, string | number | string[] | undefined>): string {
  const url = new URL(path, API_BASE);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        url.searchParams.set(key, value.join(','));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

export const client = new AppStoreConnectClient();

// App Store Connect's largest accepted `limit` query value for most list
// endpoints. We never request more than this per page.
const API_MAX_PAGE_SIZE = 200;

/**
 * Compute the `limit` query value to send to the API for a single request.
 *
 * - Without auto-pagination: the user's `limit` (or the tool default), clamped to
 *   the API page-size ceiling — i.e. exactly the legacy single-page behavior.
 * - With auto-pagination: request the largest page the API allows (so the walk
 *   uses the fewest round-trips), but never more than the total the caller wants.
 */
export function pageSize(limit: number | undefined, defaultLimit: number, autoPaginate?: boolean): number {
  const total = limit ?? defaultLimit;
  if (autoPaginate) return Math.min(API_MAX_PAGE_SIZE, Math.max(1, total));
  return Math.min(API_MAX_PAGE_SIZE, Math.max(1, total));
}

/**
 * Build {@link PaginateOptions} from a list tool's args. When `auto_paginate` is
 * off the walk is capped at a single page (`maxPages: 1`) — legacy behavior,
 * one request, no `links.next` following. When on, the `limit` becomes the total
 * ceiling across pages.
 */
export function paginateOpts(args: { limit?: number; auto_paginate?: boolean }, defaultLimit = DEFAULT_PAGE_CAP): PaginateOptions {
  if (!args.auto_paginate) {
    return { limit: args.limit ?? defaultLimit, maxPages: 1 };
  }
  return { limit: args.limit ?? defaultLimit };
}

/** Options controlling how far a paginated list walks. */
export interface PaginateOptions {
  /** Max total results to return across all pages (ceiling). Default 1000. */
  limit?: number;
  /** Hard cap on the number of pages fetched, guarding runaway loops. Default 50. */
  maxPages?: number;
}

/** Per-list pagination summary so truncation is never silent. */
export interface PaginationInfo {
  /** Number of results actually returned. */
  fetched: number;
  /** Number of API pages fetched. */
  pages: number;
  /** True if more results exist beyond what was returned (truncated at the limit/cap). */
  has_more: boolean;
  /** The next-page cursor URL when `has_more` is true, so callers can resume manually. */
  next_cursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationInfo;
}

/**
 * Reduce an absolute App Store Connect `links.next` URL to a path+query relative
 * to {@link API_BASE} so it can be fed back into {@link AppStoreConnectClient.request}
 * (which takes a path). Returns `undefined` if the URL points off-host (defensive;
 * ASC always returns same-host cursors).
 */
export function nextUrlToPath(nextUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(nextUrl, API_BASE);
  } catch {
    return undefined;
  }
  if (parsed.origin !== new URL(API_BASE).origin) return undefined;
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Walk an App Store Connect list endpoint, following the response body's
 * `links.next` cursor, and aggregate results up to `limit`.
 *
 * Stops when: the limit is reached, `links.next` is absent, the next cursor does
 * not advance (same URL we just followed), or the `maxPages` cap is hit. The
 * returned `pagination` block reports how much was fetched and whether more
 * remains, so a truncated result is never silent.
 */
export async function paginate<T = AscResource>(
  path: string,
  query?: Record<string, string | number | string[] | undefined>,
  options: PaginateOptions = {}
): Promise<PaginatedResult<T>> {
  const limit = Math.max(1, options.limit ?? DEFAULT_PAGE_CAP);
  const maxPages = Math.max(1, options.maxPages ?? MAX_PAGES);

  const items: T[] = [];
  let pages = 0;
  let nextUrl: string | undefined;
  let lastFollowedUrl: string | undefined;
  let hasMore = false;

  while (pages < maxPages) {
    const response: AscEnvelope<T[]> = nextUrl
      ? await client.request<AscEnvelope<T[]>>('GET', nextUrlToPath(nextUrl) ?? nextUrl)
      : await client.request<AscEnvelope<T[]>>('GET', path, undefined, query);
    pages += 1;

    const pageItems = response.data ?? [];
    for (const item of pageItems) {
      if (items.length >= limit) {
        // Truncated mid-page by the limit; more results remain.
        hasMore = true;
        break;
      }
      items.push(item);
    }

    const candidateNext = response.links?.next;
    if (items.length >= limit) {
      // Hit the ceiling; surface whether the API itself had more to give.
      hasMore = hasMore || Boolean(candidateNext);
      if (candidateNext) nextUrl = candidateNext;
      break;
    }
    if (!candidateNext) {
      // No more pages from the API.
      break;
    }
    if (candidateNext === lastFollowedUrl) {
      // Non-advancing cursor — bail rather than loop forever.
      hasMore = true;
      nextUrl = candidateNext;
      break;
    }
    lastFollowedUrl = candidateNext;
    nextUrl = candidateNext;
  }

  // If we exited because the page cap was hit while a next cursor was pending.
  if (pages >= maxPages && nextUrl && items.length < limit) {
    hasMore = true;
  }

  const pagination: PaginationInfo = { fetched: items.length, pages, has_more: hasMore };
  if (hasMore && nextUrl) pagination.next_cursor = nextUrl;
  return { items, pagination };
}
