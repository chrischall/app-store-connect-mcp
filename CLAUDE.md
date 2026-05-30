# app-store-connect-mcp

MCP server for App Store Connect — apps, builds, TestFlight, customer reviews, sales/finance reports, and team users.

## Commands

```bash
npm run build        # tsc + esbuild bundle
npm test             # vitest run
npm run test:watch   # vitest in watch mode
```

## Architecture

```
src/
  index.ts          MCP server entry point — registers all tool modules, starts stdio transport
  client.ts         AppStoreConnectClient — ES256 JWT signing, Bearer auth, 401/429 retry
  types.ts          AscEnvelope/AscResource (JSON:API) and ToolResult types
  tools/
    apps.ts         list/get apps, App Store versions, app infos
    testflight.ts   builds, beta groups/testers, invitations, beta review submission
    reviews.ts      customer reviews, developer responses
    sales.ts        sales and finance report TSV downloads (gzipped)
    users.ts        team users, invitations
```

All tools use `client.request()` against `https://api.appstoreconnect.apple.com/v1/...`. JWTs are minted on demand (ES256, 20-minute lifetime) and cached until 2 minutes before expiry. Each tool file exports handler functions and a `register*Tools(server)` function. `index.ts` imports and calls each registration function.

Sales/finance reports return gzipped TSVs — those handlers use `client.requestRaw()` and parse with `zlib.gunzipSync`.

## Authentication

App Store Connect uses ES256-signed JWTs. Required env:

```
APP_STORE_CONNECT_KEY_ID         # 10-char key ID
APP_STORE_CONNECT_ISSUER_ID      # UUID issuer ID
APP_STORE_CONNECT_PRIVATE_KEY    # PEM contents of .p8 (or...)
APP_STORE_CONNECT_PRIVATE_KEY_PATH  # path to .p8 file
```

JWT signing uses Node's built-in `crypto` module — no `jsonwebtoken` dependency. The signature is converted from DER to IEEE P1363 (raw r||s) via `dsaEncoding: 'ieee-p1363'`, which is the JWS-required format.

## API conventions

App Store Connect uses JSON:API:

- Responses are `{ data: T, included?: [], links?: {}, meta?: {} }`
- Resources are `{ type, id, attributes, relationships }`
- Filtering: `filter[name]=value`
- Field selection: `fields[apps]=name,bundleId`
- Sorting: `sort=-createdDate` (prefix `-` for descending)
- Pagination: `limit=N`, follow `links.next`

`buildUrl()` in client.ts handles the URL building. Array values are comma-joined (Apple's convention, not the standard JSON:API `?key=a&key=b`).

## Testing

Tests in `tests/`. Run with `npm test`. No real API calls — `client.request` and `client.requestRaw` are mocked via `vi.spyOn`. JWT signing tests use `crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })` to round-trip a real ES256 signature against the matching public key.

## Plugin / Marketplace

```
.claude-plugin/
  plugin.json       Claude Code plugin manifest
  marketplace.json  Marketplace catalog entry
skills/
  app-store-connect/SKILL.md   Claude Code skill — teaches Claude when/how to use the tools
SKILL.md            Full skill reference with setup, tools table, and workflows
manifest.json       mcpb bundle manifest
.mcp.json           MCP server configuration for Claude Code
server.json         MCP registry server descriptor
```

## Versioning

Version appears in FOUR places — all must match:

- `package.json` `version`
- `manifest.json` `version`
- `server.json` `version` and `packages[0].version`
- `.claude-plugin/plugin.json` `version` and `.claude-plugin/marketplace.json` `metadata.version` and `plugins[0].version`
- `src/index.ts` `new McpServer({ version: ... })`
