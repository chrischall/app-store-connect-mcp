import { describe, expect, it } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { registerAppTools } from '../src/tools/apps.js';
import { registerTestFlightTools } from '../src/tools/testflight.js';
import { registerReviewTools } from '../src/tools/reviews.js';
import { registerSalesTools } from '../src/tools/sales.js';
import { registerUserTools } from '../src/tools/users.js';

describe('SDK v2 tool registration', () => {
  it('publishes every registrar and a representative schema through tools/list', async () => {
    const harness = await createTestHarness((server) => {
      registerAppTools(server);
      registerTestFlightTools(server);
      registerReviewTools(server);
      registerSalesTools(server);
      registerUserTools(server);
    });
    const { tools } = await harness.client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(21);
    for (const name of ['list_apps', 'list_builds', 'list_customer_reviews', 'download_sales_report', 'list_users']) {
      expect(tools.map((tool) => tool.name)).toContain(name);
    }
    expect(tools.find((tool) => tool.name === 'get_app')?.inputSchema).toMatchObject({
      type: 'object',
      properties: { appId: { type: 'string', description: 'App Store Connect app ID (numeric, from list_apps)' } },
      required: ['appId'],
    });
    await harness.close();
  });
});
