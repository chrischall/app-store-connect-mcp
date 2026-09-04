/**
 * Standard JSON:API response envelope from App Store Connect.
 * https://developer.apple.com/documentation/appstoreconnectapi
 */
export interface AscEnvelope<T> {
  data: T;
  included?: unknown[];
  links?: { self?: string; next?: string; first?: string };
  meta?: { paging?: { total?: number; limit?: number } };
}

export interface AscResource<TAttrs = Record<string, unknown>, TRels = Record<string, unknown>> {
  type: string;
  id: string;
  attributes?: TAttrs;
  relationships?: TRels;
  links?: { self?: string };
}

/**
 * Standard MCP tool return type.
 * Re-exported from the shared SDK type so tool handlers can return the
 * results produced by `@chrischall/mcp-utils`' `minifiedResult` helper.
 */
export type { CallToolResult as ToolResult } from '@modelcontextprotocol/sdk/types.js';
