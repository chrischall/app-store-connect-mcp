# App Store Connect MCP

[![CI](https://github.com/chrischall/app-store-connect-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischall/app-store-connect-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server that connects Claude to [App Store Connect](https://appstoreconnect.apple.com), giving you natural-language access to your apps, builds, TestFlight beta groups and testers, customer reviews, sales/finance reports, and team users.

> [!WARNING]
> **AI-developed project.** This codebase was entirely built and is actively maintained by [Claude Code](https://www.anthropic.com/claude). No human has audited the implementation. Review all code and tool permissions before use.

## What you can do

Ask Claude things like:

- *"List my apps"*
- *"Show me the latest builds for app 1234567890"*
- *"Who hasn't accepted their TestFlight invitation?"*
- *"Invite alex@example.com to the External Beta group"*
- *"Submit build 9876 for beta review"*
- *"What's our average rating in Japan this month?"*
- *"Respond to that 1-star review with an apology"*
- *"Pull yesterday's daily sales report for vendor 80012345"*
- *"Invite a new developer with App Manager role"*

## Requirements

- [Claude Desktop](https://claude.ai/download) or [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Node.js](https://nodejs.org) 20.6 or later
- An [App Store Connect API key](https://appstoreconnect.apple.com/access/integrations/api) (`.p8` file, Key ID, and Issuer ID) — admin or higher access required to create

## Installation

### Option A — npm

```bash
npx -y app-store-connect-mcp
```

Add to your Claude config (`.mcp.json` or Claude Desktop config):

```json
{
  "mcpServers": {
    "app-store-connect": {
      "command": "npx",
      "args": ["-y", "app-store-connect-mcp"],
      "env": {
        "APP_STORE_CONNECT_KEY_ID": "ABC1234567",
        "APP_STORE_CONNECT_ISSUER_ID": "57246542-96fe-1a63-e053-0824d011072a",
        "APP_STORE_CONNECT_PRIVATE_KEY_PATH": "/absolute/path/to/AuthKey_ABC1234567.p8"
      }
    }
  }
}
```

### Option B — from source

```bash
git clone https://github.com/chrischall/app-store-connect-mcp.git
cd app-store-connect-mcp
npm install
npm run build
```

Add to Claude Desktop config:

- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "app-store-connect": {
      "command": "node",
      "args": ["/absolute/path/to/app-store-connect-mcp/dist/bundle.js"],
      "env": {
        "APP_STORE_CONNECT_KEY_ID": "ABC1234567",
        "APP_STORE_CONNECT_ISSUER_ID": "57246542-96fe-1a63-e053-0824d011072a",
        "APP_STORE_CONNECT_PRIVATE_KEY_PATH": "/absolute/path/to/AuthKey_ABC1234567.p8"
      }
    }
  }
}
```

## Getting an API key

1. Sign in at [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api).
2. Click **+** to generate a key. Pick a role appropriate to what you want Claude to do — `Developer` is enough for read-only browsing; `App Manager` for TestFlight management; `Admin` for user invites and most write operations.
3. Download the `.p8` file (you can only download it **once**) and note the **Key ID** and **Issuer ID**.
4. Either point `APP_STORE_CONNECT_PRIVATE_KEY_PATH` at the saved `.p8`, or paste the PEM contents into `APP_STORE_CONNECT_PRIVATE_KEY` (newline-escaped is fine).

The key signs short-lived (20-minute) ES256 JWTs on demand. No external token storage; nothing is sent to anyone but Apple.

## Tools

| Tool | What it does |
| --- | --- |
| `list_apps` | List apps in your account (filter by bundleId/name) |
| `get_app` | Get a single app by ID |
| `list_app_store_versions` | List App Store releases for an app |
| `get_app_infos` | Age rating and store-state info for an app |
| `list_builds` | Recent builds (newest first), filter by app/state/version |
| `get_build` | Single build details |
| `list_beta_groups` | TestFlight internal/external beta groups |
| `list_beta_testers` | Beta testers, filter by app/group/email |
| `invite_beta_tester` | Add a new tester, optionally to groups/builds |
| `delete_beta_tester` | Remove a tester from your team |
| `add_testers_to_beta_group` | Add existing testers to a group |
| `remove_testers_from_beta_group` | Remove testers from a group |
| `submit_build_for_beta_review` | Send a build for TestFlight beta review |
| `list_customer_reviews` | App Store reviews, filter by rating/territory |
| `get_customer_review` | Single review with developer response |
| `respond_to_review` | Post or update a developer reply |
| `download_sales_report` | Daily/weekly/monthly/yearly units & sales TSV |
| `download_finance_report` | Region finance/proceeds TSV |
| `list_users` | App Store Connect team users |
| `list_user_invitations` | Pending team invitations |
| `invite_user` | Invite a new team member with roles |

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_STORE_CONNECT_KEY_ID` | yes | 10-character Key ID (e.g. `ABC1234567`) |
| `APP_STORE_CONNECT_ISSUER_ID` | yes | Team Issuer ID (UUID) |
| `APP_STORE_CONNECT_PRIVATE_KEY` | one of | Full PEM contents of your `.p8`. Newline-escapes (`\n`) are accepted. |
| `APP_STORE_CONNECT_PRIVATE_KEY_PATH` | one of | Absolute path to the `.p8` file |

## Development

```bash
npm install
npm test               # vitest run
npm run test:watch     # watch mode
npm run build          # tsc + esbuild bundle
npm run dev            # node --env-file=.env dist/index.js
```

Tests mock `client.request` / `client.requestRaw`; no real App Store Connect calls are made.

## License

MIT
