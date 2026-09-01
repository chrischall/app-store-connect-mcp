---
name: app-store-connect
description: This skill should be used when the user asks about App Store Connect data — their apps, builds, TestFlight beta testers, customer reviews, sales reports, or team users. Triggers on phrases like "check App Store Connect", "list my apps", "TestFlight builds", "beta testers", "App Store reviews", "respond to review", "sales report", "invite tester", "App Store Connect users", or any request involving Apple developer / App Store Connect / TestFlight management.
---

# app-store-connect

MCP server for App Store Connect — apps, TestFlight, customer reviews, sales/finance reports, and team users.

## Tools

### Apps
- `list_apps` — List apps (filter by bundleId/name)
- `get_app` — App details by ID
- `list_app_store_versions` — Releases for an app
- `get_app_infos` — Age rating and store-state info

### TestFlight
- `list_builds` — Recent builds, newest first
- `get_build` — Single build details
- `list_beta_groups` — Internal & external beta groups
- `list_beta_testers` — Testers (filter by app/group/email)
- `invite_beta_tester` — Add a new tester
- `delete_beta_tester` — Remove tester from team
- `add_testers_to_beta_group` / `remove_testers_from_beta_group` — Bulk group membership
- `submit_build_for_beta_review` — Send build for beta review

### Customer Reviews
- `list_customer_reviews` — Filter by rating/territory
- `get_customer_review` — Single review + developer response
- `respond_to_review` — Post or update reply

### Sales & Finance
- `download_sales_report` — Daily/weekly/monthly/yearly TSV
- `download_finance_report` — Region-scoped proceeds TSV

### Team Users
- `list_users`, `list_user_invitations`, `invite_user`

### Health
- `asc_healthcheck` — Is this connector working? Reports which of the three key settings resolved, whether App Store Connect accepted the signed JWT, and what to fix. Start here when another tool fails: a 401 here means a revoked key, a key/issuer team mismatch, or local clock drift — never a wrong password.

## Setup

Generate an App Store Connect API key at [appstoreconnect.apple.com → Users and Access → Integrations](https://appstoreconnect.apple.com/access/integrations/api). Set:

- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY_PATH` (absolute path to `.p8`)

The MCP signs short-lived JWTs locally; your private key never leaves the machine.

## Tips

- App Store Connect IDs (apps, builds, testers) are the long numeric strings shown in tool output, not the bundle ID or version string.
- For sales reports, find the **vendorNumber** in App Store Connect → Payments and Financial Reports. Daily reports are typically available ~24 hours after the date closes.
- Most TestFlight write operations require an API key with **App Manager** or **Admin** role.
