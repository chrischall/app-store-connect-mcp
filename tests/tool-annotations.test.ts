import { describe, expect, it } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { registerAppTools } from '../src/tools/apps.js';
import { registerTestFlightTools } from '../src/tools/testflight.js';
import { registerReviewTools } from '../src/tools/reviews.js';
import { registerSalesTools } from '../src/tools/sales.js';
import { registerUserTools } from '../src/tools/users.js';
import { registerHealthcheckTools } from '../src/tools/health.js';

/**
 * Reads the annotations off tools/list (the wire), not the source: a write
 * that forgets `destructiveHint` publishes as destructive (the spec default),
 * and a considered `false` and a forgotten one are otherwise indistinguishable.
 */
interface Ann {
  readOnlyHint?: unknown;
  destructiveHint?: unknown;
  openWorldHint?: unknown;
}

async function servedAnnotations(): Promise<Record<string, Ann>> {
  const harness = await createTestHarness((server) => {
    registerAppTools(server);
    registerTestFlightTools(server);
    registerReviewTools(server);
    registerSalesTools(server);
    registerUserTools(server);
    registerHealthcheckTools(server, { request: async () => ({}) } as never, () => undefined);
  });
  const { tools } = await harness.client.listTools();
  await harness.close();
  return Object.fromEntries(tools.map((t) => [t.name, (t.annotations ?? {}) as Ann]));
}

describe('tool annotations', () => {
  it('covers the full served surface', async () => {
    // Asserted first so the property checks below cannot silently cover less.
    expect(Object.keys(await servedAnnotations())).toHaveLength(22);
  });

  it('sets an explicit boolean readOnlyHint on every tool', async () => {
    const missing = Object.entries(await servedAnnotations())
      .filter(([, a]) => typeof a.readOnlyHint !== 'boolean')
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('sets an explicit boolean destructiveHint on every write', async () => {
    const undeclared = Object.entries(await servedAnnotations())
      .filter(([, a]) => a.readOnlyHint === false && typeof a.destructiveHint !== 'boolean')
      .map(([name]) => name);
    expect(undeclared).toEqual([]);
  });

  it('never lets a read claim to be destructive', async () => {
    const contradictory = Object.entries(await servedAnnotations())
      .filter(([, a]) => a.readOnlyHint === true && a.destructiveHint === true)
      .map(([name]) => name);
    expect(contradictory).toEqual([]);
  });

  it('marks every tool open-world (all of them call api.appstoreconnect.apple.com)', async () => {
    const closed = Object.entries(await servedAnnotations())
      .filter(([, a]) => a.openWorldHint !== true)
      .map(([name]) => name);
    expect(closed).toEqual([]);
  });

  it('classifies each write by the inverse test', async () => {
    const ann = await servedAnnotations();
    const writes = Object.fromEntries(
      Object.entries(ann)
        .filter(([, a]) => a.readOnlyHint === false)
        .map(([name, a]) => [name, a.destructiveHint]),
    );
    expect(writes).toEqual({
      // Emails a real person — no inverse can un-send it.
      invite_beta_tester: true,
      invite_user: true,
      // Permanent removal from the team.
      delete_beta_tester: true,
      // Grants testers the group's builds, which can trigger TestFlight's invite email.
      add_testers_to_beta_group: true,
      // Revokes the testers' access to the group's builds; re-adding them can
      // re-send TestFlight's invite, so there is no clean inverse.
      remove_testers_from_beta_group: true,
      // Hands the build to Apple's review — reaches another party.
      submit_build_for_beta_review: true,
      // Public on the App Store; nothing here deletes a response.
      respond_to_review: true,
    });
  });
});
