#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { registerAppTools } from './tools/apps.js';
import { registerTestFlightTools } from './tools/testflight.js';
import { registerReviewTools } from './tools/reviews.js';
import { registerSalesTools } from './tools/sales.js';
import { registerUserTools } from './tools/users.js';

// The App Store Connect client is a module-level singleton (imported by each
// tool module) that mints its JWT lazily on the first request. That preserves
// the deferred-config-error pattern: the server boots and answers the host's
// install-time tools/list smoke test even when the ASC key env vars are absent
// — the configuration error only surfaces on the first tool call.
await runMcp({
  name: 'app-store-connect-mcp',
  version: '0.2.5', // x-release-please-version
  banner:
    '[app-store-connect-mcp] This project was developed and is maintained by AI (Claude). Use at your own discretion.',
  tools: [
    registerAppTools,
    registerTestFlightTools,
    registerReviewTools,
    registerSalesTools,
    registerUserTools,
  ],
});
