import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseToolResult, type TestHarness } from '@chrischall/mcp-utils/test';
import { client } from '../src/client.js';
import { writeHarness, phaseOne } from './helpers.js';

const GATED_TOOLS = [
  'invite_beta_tester',
  'delete_beta_tester',
  'add_testers_to_beta_group',
  'remove_testers_from_beta_group',
  'submit_build_for_beta_review',
  'respond_to_review',
  'invite_user',
];

interface Rejection {
  status: string;
  error?: string;
  reason?: string;
  confirmToken?: string;
}

describe('confirmation gate', () => {
  let reqSpy: ReturnType<typeof vi.spyOn<typeof client, 'request'>>;
  let savedEnv: NodeJS.ProcessEnv;
  let harness: TestHarness | undefined;

  beforeEach(() => {
    savedEnv = { ...process.env };
    reqSpy = vi.spyOn(client, 'request').mockResolvedValue(null as never);
  });

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
    process.env = savedEnv;
    vi.restoreAllMocks();
  });

  it('every gated tool takes confirmToken and no longer takes confirm', async () => {
    harness = await writeHarness();
    const { tools } = await harness.client.listTools();
    for (const name of GATED_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      const props = (tool?.inputSchema as { properties: Record<string, unknown> }).properties;
      expect(props, name).toHaveProperty('confirmToken');
      expect(props, name).not.toHaveProperty('confirm');
      expect(tool?.description, name).toMatch(/confirmToken/);
      expect(tool?.description, name).not.toMatch(/confirm:\s*true/);
    }
  });

  it('replaying a used token is refused as TOKEN_REUSED and writes nothing more', async () => {
    harness = await writeHarness();
    const args = { betaTesterId: 't1' };
    const { confirmToken } = await phaseOne(harness, 'delete_beta_tester', args);
    await harness.callTool('delete_beta_tester', { ...args, confirmToken });
    expect(reqSpy).toHaveBeenCalledTimes(1);

    const replay = await harness.callTool('delete_beta_tester', { ...args, confirmToken });
    expect(replay.isError).toBe(true);
    expect(parseToolResult<Rejection>(replay).error).toBe('TOKEN_REUSED');
    expect(reqSpy).toHaveBeenCalledTimes(1);
  });

  it('changing an argument between the phases is refused as DRAFT_CHANGED and writes nothing', async () => {
    harness = await writeHarness();
    const { confirmToken } = await phaseOne(harness, 'respond_to_review', { reviewId: 'r9', responseBody: 'Thanks!' });
    const changed = await harness.callTool('respond_to_review', { reviewId: 'r9', responseBody: 'Something else', confirmToken });
    expect(changed.isError).toBe(true);
    const body = parseToolResult<Rejection>(changed);
    expect(body.error).toBe('DRAFT_CHANGED');
    expect(body.confirmToken).toBeDefined();
    expect(reqSpy).not.toHaveBeenCalled();
  });

  it('a token issued for one target does not act on another', async () => {
    harness = await writeHarness();
    const { confirmToken } = await phaseOne(harness, 'invite_user', { email: 'a@b.com', firstName: 'A', lastName: 'B', roles: ['DEVELOPER'] });
    const other = await harness.callTool('invite_user', { email: 'x@y.com', firstName: 'A', lastName: 'B', roles: ['DEVELOPER'], confirmToken });
    expect(other.isError).toBe(true);
    expect(parseToolResult<Rejection>(other).status).toBe('confirmation-rejected');
    expect(reqSpy).not.toHaveBeenCalled();
  });

  it('a client that can be prompted writes once the user accepts', async () => {
    const elicitation = vi.fn(async () => ({ action: 'accept' as const, content: { confirmed: true } }));
    harness = await writeHarness({ elicitation });
    const result = await harness.callTool('delete_beta_tester', { betaTesterId: 't1' });
    expect(result.isError).toBeFalsy();
    expect(elicitation).toHaveBeenCalled();
    expect(reqSpy).toHaveBeenCalledTimes(1);
    expect(reqSpy).toHaveBeenCalledWith('DELETE', '/v1/betaTesters/t1');
  });

  it('a client that can be prompted writes nothing when the user declines', async () => {
    harness = await writeHarness({ elicitation: async () => ({ action: 'decline' as const }) });
    const result = await harness.callTool('delete_beta_tester', { betaTesterId: 't1' });
    expect(parseToolResult<{ confirmed: boolean; cancelled: boolean }>(result)).toMatchObject({ confirmed: false, cancelled: true });
    expect(reqSpy).not.toHaveBeenCalled();
  });

  it('MCP_CONFIRM_MODE=refuse refuses on a client that cannot be prompted', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    harness = await writeHarness();
    const result = await harness.callTool('invite_beta_tester', { email: 'a@b.com' });
    expect(parseToolResult<Rejection>(result).reason).toBe('confirmation-unsupported');
    expect(reqSpy).not.toHaveBeenCalled();
  });
});
