import { expect } from 'vitest';
import { createTestHarness, parseToolResult, type TestHarness, type TestHarnessOptions } from '@chrischall/mcp-utils/test';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { registerAppTools } from '../src/tools/apps.js';
import { registerTestFlightTools } from '../src/tools/testflight.js';
import { registerReviewTools } from '../src/tools/reviews.js';
import { registerUserTools } from '../src/tools/users.js';

/**
 * A harness over every write-bearing registrar. Created without an elicitation
 * handler it is a client that cannot be prompted, so gated writes take the
 * two-step confirm-token path (MCP_CONFIRM_MODE defaults to ask-user).
 */
export function writeHarness(options?: TestHarnessOptions): Promise<TestHarness> {
  return createTestHarness((server) => {
    registerAppTools(server);
    registerTestFlightTools(server);
    registerReviewTools(server);
    registerUserTools(server);
  }, options);
}

export interface PhaseOne {
  status: string;
  action: string;
  confirmToken: string;
  preview: Record<string, unknown> & { willSend?: any; path?: string; method?: string };
}

/** Phase 1: the call without a token. Asserts it asked for confirmation. */
export async function phaseOne(harness: TestHarness, name: string, args: Record<string, unknown>): Promise<PhaseOne> {
  const result = await harness.callTool(name, args);
  const body = parseToolResult<PhaseOne>(result);
  expect(body.status).toBe('confirmation-required');
  expect(typeof body.confirmToken).toBe('string');
  return body;
}

/** Phase 1 then phase 2 with the issued token: the approved write. */
export async function confirmedCall(harness: TestHarness, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const { confirmToken } = await phaseOne(harness, name, args);
  return harness.callTool(name, { ...args, confirmToken });
}
