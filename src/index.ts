#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { registerAppTools } from './tools/apps.js';
import { registerTestFlightTools } from './tools/testflight.js';
import { registerReviewTools } from './tools/reviews.js';
import { registerSalesTools } from './tools/sales.js';
import { registerUserTools } from './tools/users.js';
import { registerHealthcheckTools } from './tools/health.js';
import { loadAppDirectory } from './tools/app-labels.js';

// The App Store Connect client is a module-level singleton (imported by each
// tool module) that mints its JWT lazily on the first request. That preserves
// the deferred-config-error pattern: the server boots and answers the host's
// install-time tools/list smoke test even when the ASC key env vars are absent
// — the configuration error only surfaces on the first tool call.
// The review read's `appId` publishes the app names as an enum (context
// groups: a subject the host can fan "any new reviews?" out over), so list the
// apps ONCE here, bounded by APP_LIST_TIMEOUT_MS. Null — no key yet, a
// rejected JWT, a timeout, no apps — publishes the plain id with no enum.
const apps = await loadAppDirectory();

await runMcp({
  name: 'app-store-connect-mcp',
  version: '1.3.2', // x-release-please-version
  banner:
    '[app-store-connect-mcp] This project was developed and is maintained by AI (Claude). Use at your own discretion.',
  tools: [
    registerAppTools,
    registerTestFlightTools,
    (server) => registerReviewTools(server, apps),
    registerSalesTools,
    registerUserTools,
    registerHealthcheckTools,
  ],
});
