import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readEnvVar } from '@chrischall/mcp-utils';
import { registerCredentialHealthcheckTool } from '@chrischall/mcp-utils/healthcheck';
import { client as defaultClient } from '../client.js';

/**
 * `asc_healthcheck` — the one call that answers "is this connector working?",
 * and the only tool here that reports a failure as DATA rather than throwing.
 *
 * App Store Connect had none, and its credential is unusually easy to get
 * half-right: it is THREE separate settings (key id, issuer id, private key),
 * each individually fatal, and the private key arrives either inline or as a
 * path to a .p8. "Check your credentials" is useless advice when exactly one
 * of them is missing — {@link describeMissing} names the one that is.
 *
 * The rejection case is likewise specific: an ASC JWT is signed locally, so a
 * 401 does not mean "wrong password". It means the key was revoked, the key
 * and issuer belong to different teams, or the local clock has drifted far
 * enough that the JWT is outside its validity window.
 */

type ReadEnv = (key: string) => string | undefined;

/** Which of the three required settings is absent, in the order ASC needs them. */
function describeMissing(readEnv: ReadEnv): string | null {
  if (!readEnv('APP_STORE_CONNECT_KEY_ID')) return 'APP_STORE_CONNECT_KEY_ID';
  if (!readEnv('APP_STORE_CONNECT_ISSUER_ID')) return 'APP_STORE_CONNECT_ISSUER_ID';
  if (!readEnv('APP_STORE_CONNECT_PRIVATE_KEY') && !readEnv('APP_STORE_CONNECT_PRIVATE_KEY_PATH')) {
    return 'APP_STORE_CONNECT_PRIVATE_KEY (PEM contents) or APP_STORE_CONNECT_PRIVATE_KEY_PATH (.p8 file)';
  }
  return null;
}

export function classifyAscError(err: unknown): { kind: string; hint?: string } | undefined {
  const msg = err instanceof Error ? err.message : String(err);

  // Our own resolver message, carried through so the hint names the specific
  // setting that is missing rather than the helper's generic "set the
  // documented environment variable".
  if (msg.includes('credential incomplete')) {
    return {
      kind: 'no_credential',
      hint: `${msg} Generate a key at https://appstoreconnect.apple.com/access/integrations/api`,
    };
  }
  if (/401|unauthorized/i.test(msg)) {
    return {
      kind: 'credential_rejected',
      hint:
        'App Store Connect rejected the signed JWT. The key is signed locally, so this is not a wrong password: ' +
        'the key may be revoked, APP_STORE_CONNECT_KEY_ID and APP_STORE_CONNECT_ISSUER_ID may belong to different ' +
        'teams, or this machine\'s clock may have drifted outside the JWT validity window. ' +
        'Keys are managed at https://appstoreconnect.apple.com/access/integrations/api',
    };
  }
  return undefined;
}

export function registerHealthcheckTools(
  server: McpServer,
  client: Pick<typeof defaultClient, 'request'> = defaultClient,
  /** Seam: injectable so tests need no process env. */
  readEnv: ReadEnv = (k) => readEnvVar(k),
): void {
  registerCredentialHealthcheckTool({
    server,
    prefix: 'asc',
    hostLabel: 'api.appstoreconnect.apple.com',
    probePath: '/v1/apps',
    resolveCredential: async () => {
      const missing = describeMissing(readEnv);
      if (missing) {
        // Thrown rather than returned as `source: null` so the hint can name
        // the specific setting; the arm stays `no_credential` either way.
        throw new Error(`App Store Connect credential incomplete — set ${missing}.`);
      }
      return {
        // Which form the key took is the first thing to check when a .p8 path
        // is wrong; neither id is secret.
        source: readEnv('APP_STORE_CONNECT_PRIVATE_KEY')
          ? 'APP_STORE_CONNECT_PRIVATE_KEY'
          : 'APP_STORE_CONNECT_PRIVATE_KEY_PATH',
        detail: {
          key_id: readEnv('APP_STORE_CONNECT_KEY_ID'),
          issuer_id: readEnv('APP_STORE_CONNECT_ISSUER_ID'),
        },
      };
    },
    // One app, not the account's whole catalogue: enough to prove the JWT is
    // accepted, cheap for a team with hundreds of apps, and it writes nothing.
    probeFn: () => client.request('GET', '/v1/apps', undefined, { limit: 1 }),
    classifyThrown: classifyAscError,
  });
}
