import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8'));

describe('server.json is publishable to the MCP registry', () => {
  it('keeps description within the registry limit', () => {
    // The registry rejects a longer one with a 422 at publish time, which fails
    // the publish step and SKIPS every later step — including the release-asset
    // attach. v0.2.6 shipped with no .mcpb and no registry entry for exactly
    // this reason, at 107 characters, on an otherwise-healthy release.
    expect(read('server.json').description.length).toBeLessThanOrEqual(100);
  });

  it('publishes the scoped npm identity while the registry name stays unscoped', () => {
    const server = read('server.json');
    const pkg = read('package.json');
    expect(server.name).toBe('io.github.chrischall/app-store-connect-mcp');
    expect(pkg.name).toBe('@chrischall/app-store-connect-mcp');
    expect(pkg.publishConfig?.access).toBe('public');
    for (const p of server.packages) expect(p.identifier).toBe(pkg.name);
  });

  it('keeps the bin unscoped so the command name is unchanged', () => {
    expect(Object.keys(read('package.json').bin)).toEqual(['app-store-connect-mcp']);
  });
});
