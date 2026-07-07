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
- Pagination: `limit=N`, follow `links.next` (an absolute URL cursor in the response **body**, not a `Link` header)

`buildUrl()` in client.ts handles the URL building. Array values are comma-joined (Apple's convention, not the standard JSON:API `?key=a&key=b`).

`paginate()` in client.ts walks a list endpoint by following the body's `links.next` cursor. List tools opt in via an `auto_paginate` boolean; `limit` is then the total ceiling across pages (per-page requests are clamped to the API max of 200). Every list result carries a `pagination: { fetched, pages, has_more, next_cursor? }` block so truncation is never silent. The walk stops at the limit, an absent `links.next`, a non-advancing cursor, or a `maxPages` safety cap (50).

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

release-please owns the version — don't bump by hand. `package.json` is the source of truth; every other version-bearing file is kept in sync automatically via `release-please-config.json` → `extra-files`:

- `manifest.json` `$.version`
- `server.json` `$.version` and `$.packages[*].version`
- `.claude-plugin/plugin.json` `$.version`
- `.claude-plugin/marketplace.json` `$.plugins[*].version` and `$.metadata.version`
- `src/index.ts` — the `version` constant carries a `// x-release-please-version` annotation (raw-file `extra-files` entry)

`tests/version-sync.test.ts` (shared `versionSyncTest` from `@chrischall/mcp-utils/test`) asserts every `x-release-please-version` annotation in `src/` matches `package.json` — so a constant that drifts because its annotation went missing fails CI. Adding a new version-bearing constant? Tag the line with `// x-release-please-version` and the test picks it up automatically.

<!-- pr-workflow:v2 -->
## Pull requests & releases

**Default workflow: branch + PR.** This repo **squash-merges**, so the **PR title MUST be a Conventional Commit** (`fix(scope): …`, `feat(scope): …`) — it becomes the squash commit's subject line, the only thing release-please (`.github/workflows/release-please.yml`) parses to pick the version bump and changelog section. Only `feat` (minor), `fix` (patch), and `!`/`BREAKING CHANGE` (major) cut a release; `perf`/`refactor`/`docs` show in the changelog without bumping; `ci`/`test`/`build`/`chore` are recognised but hidden (`release-please-config.json` → `changelog-sections`). A title without a conventional type is invisible to release-please.

**Exception for first-party dependency bumps.** When bumping a package we own (`@chrischall/mcp-utils`, `@chrischall/realty-core`, `@fetchproxy/server` — anything published from a chrischall-owned repo), label the PR `enhancement` or `bug` instead of `dependencies`, and use the matching Conventional-Commit prefix (`feat:` or `fix:`) instead of `chore:`/`build(deps):`. Those bumps deliver real product fixes or features through us, so they should drive a release-please version bump and show up under Features/Bug Fixes in the release notes — not get hidden under "Dependencies" (which doesn't trigger a release).

**Don't run `gh pr merge` yourself.** `pr-auto-review.yml` reviews every PR; a `pass` or `warn` verdict adds `ready-to-merge` and `auto-merge.yml` then arms `gh pr merge --auto --squash`. A `warn` or `fail` verdict also opens/updates an `auto-review-followup` issue capturing the findings; only `fail` blocks the merge. Override a `fail` by adding `ready-to-merge` yourself. Open a PR only when the change is done — it auto-merges on a passing review.

### Auto-review follow-up issues

When a PR's auto-review verdict is `warn` or `fail`, the `chrischall/workflows` pipeline opens or updates a single `auto-review-followup` issue ("Auto-review follow-ups for PR #N") whose checklist captures every finding, and links it from the PR's `<!-- auto-review-verdict -->` comment (`📋 Tracking follow-ups: #N`). `warn` (nits only) still auto-merges — the issue carries the nits forward, so most nits are fixed in a *later* PR; `fail` blocks until the important findings are addressed on the PR itself.

When asked to address the auto-review comments / review findings on a PR:

1. Read the verdict comment, open the linked `auto-review-followup` issue, and treat its checklist as the work list (alongside any inline review comments).
2. Resolve each item, checking off only what you've **verified** is genuinely fixed.
3. If every item is resolved on the current PR, add `Closes #<issue>` to that PR's body so the merge closes it; if some are deferred, check off only the resolved ones and leave the issue open.
4. For nits whose `warn` PR already auto-merged, address them in a follow-up PR that references `Closes #<issue>`.

(Mirrors the fleet-wide convention in `~/.claude/CLAUDE.md`.)
