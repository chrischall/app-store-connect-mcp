// Invariant: every `// x-release-please-version` annotation in src/
// must hold a version string that matches package.json's `version`.
//
// Why this exists: a recurring class of bug where a VERSION constant
// (used as the MCP server's self-reported version) drifts from
// package.json because release-please's `extra-files` registration lacks
// the marker — so release-please silently skips bumping it on each release.
//
// The walk/assert is the shared `versionSyncTest` from
// `@chrischall/mcp-utils/test` — if a future contributor registers a new
// version-bearing constant, just add the `x-release-please-version`
// comment to the line and this test starts asserting it automatically.
import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionSyncTest } from '@chrischall/mcp-utils/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('version sync', () => {
  it('every `x-release-please-version` annotation matches package.json', () => {
    const mismatches = versionSyncTest({
      srcDir: join(ROOT, 'src'),
      pkgPath: join(ROOT, 'package.json'),
    });
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });
});
