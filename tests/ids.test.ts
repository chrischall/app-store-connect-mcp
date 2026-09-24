import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import type { ServerContext } from '@modelcontextprotocol/server';
import { writeHarness, phaseOne } from './helpers.js';
import { client, idSegment } from '../src/client.js';
import { getApp, listAppStoreVersions, getAppInfos, registerAppTools } from '../src/tools/apps.js';
import {
  getBuild,
  deleteBetaTester,
  addTestersToBetaGroup,
  removeTestersFromBetaGroup,
  registerTestFlightTools,
} from '../src/tools/testflight.js';
import { listCustomerReviews, getCustomerReview, registerReviewTools } from '../src/tools/reviews.js';

// A dot-segment payload: new URL('/v1/betaTesters/x/../../betaGroups/G1', base)
// resolves to /v1/betaGroups/G1, so an unvalidated ID retargets the request.
const TRAVERSAL = 'x/../../betaGroups/G1';
// The ID guard runs before the confirmation gate, so no context is ever read.
const NO_CTX = {} as ServerContext;
const BAD_IDS = [TRAVERSAL, '..', 'a/b', 'a?b=c', 'a#frag', 'a%2F..', 'a b', ''];

describe('idSegment', () => {
  it('accepts real App Store Connect IDs (numeric and UUID-shaped)', () => {
    expect(idSegment('1234567890')).toBe('1234567890');
    expect(idSegment('6f1c8e2a-3b4d-4e5f-9a0b-1c2d3e4f5a6b')).toBe('6f1c8e2a-3b4d-4e5f-9a0b-1c2d3e4f5a6b');
    expect(idSegment('ABC123')).toBe('ABC123');
  });

  it.each(BAD_IDS)('rejects %j', (id) => {
    expect(() => idSegment(id)).toThrow(/Invalid App Store Connect ID/);
  });
});

describe('ID path segments cannot retarget requests', () => {
  let reqSpy: ReturnType<typeof vi.spyOn<typeof client, 'request'>>;

  beforeEach(() => {
    reqSpy = vi.spyOn(client, 'request').mockResolvedValue({ data: [] } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const cases: [string, () => Promise<unknown>][] = [
    ['getApp', () => getApp({ appId: TRAVERSAL })],
    ['listAppStoreVersions', () => listAppStoreVersions({ appId: TRAVERSAL })],
    ['getAppInfos', () => getAppInfos({ appId: TRAVERSAL })],
    ['getBuild', () => getBuild({ buildId: TRAVERSAL })],
    ['deleteBetaTester (phase 1)', () => deleteBetaTester({ betaTesterId: TRAVERSAL }, NO_CTX)],
    ['deleteBetaTester (phase 2)', () => deleteBetaTester({ betaTesterId: TRAVERSAL, confirmToken: 'mcpu.token.v1.x.y' }, NO_CTX)],
    ['addTestersToBetaGroup (phase 1)', () => addTestersToBetaGroup({ betaGroupId: TRAVERSAL, betaTesterIds: ['t1'] }, NO_CTX)],
    ['addTestersToBetaGroup (phase 2)', () => addTestersToBetaGroup({ betaGroupId: TRAVERSAL, betaTesterIds: ['t1'], confirmToken: 'mcpu.token.v1.x.y' }, NO_CTX)],
    ['removeTestersFromBetaGroup', () => removeTestersFromBetaGroup({ betaGroupId: TRAVERSAL, betaTesterIds: ['t1'] }, NO_CTX)],
    ['listCustomerReviews', () => listCustomerReviews({ appId: TRAVERSAL })],
    ['getCustomerReview', () => getCustomerReview({ reviewId: TRAVERSAL })],
  ];

  it.each(cases)('%s rejects a traversal ID without making a request', async (_name, run) => {
    await expect(run()).rejects.toThrow(/Invalid App Store Connect ID/);
    expect(reqSpy).not.toHaveBeenCalled();
  });

  it('the previewed path is exactly the path that will be sent', async () => {
    const harness = await writeHarness();
    try {
      const { preview, confirmToken } = await phaseOne(harness, 'delete_beta_tester', { betaTesterId: 'abc-123' });
      reqSpy.mockResolvedValueOnce(null as never);
      await harness.callTool('delete_beta_tester', { betaTesterId: 'abc-123', confirmToken });
      expect(reqSpy).toHaveBeenCalledWith('DELETE', preview.path);
    } finally {
      await harness.close();
    }
  });
});

describe('ID schemas over MCP', () => {
  it('rejects a traversal ID at schema validation for a destructive tool', async () => {
    const reqSpy = vi.spyOn(client, 'request').mockResolvedValue(null as never);
    const harness = await createTestHarness((server) => {
      registerAppTools(server);
      registerTestFlightTools(server);
      registerReviewTools(server);
    });
    try {
      const result = await harness.callTool('delete_beta_tester', { betaTesterId: TRAVERSAL });
      expect(result.isError).toBe(true);
      expect(reqSpy).not.toHaveBeenCalled();

      const { tools } = await harness.client.listTools();
      const schema = tools.find((t) => t.name === 'delete_beta_tester')?.inputSchema as {
        properties: Record<string, { pattern?: string }>;
      };
      expect(schema.properties.betaTesterId.pattern).toBeDefined();
    } finally {
      await harness.close();
      vi.restoreAllMocks();
    }
  });
});
