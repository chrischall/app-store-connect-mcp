import type { CallToolResult, InputRequiredResult, ServerContext } from '@modelcontextprotocol/server';
import { confirmationFromEnv, requireConfirmationWithFallback } from '@chrischall/mcp-utils';

/** The sentence every gated tool's description ends with. */
export const CONFIRM_FLOW =
  'Asks the user to confirm first: a confirmation prompt where the client supports one; otherwise the first call ' +
  'returns a preview and a confirmToken, and only a repeat call with that token proceeds (see MCP_CONFIRM_MODE).';

/** One App Store Connect write, described once for the preview, the token and the request. */
export interface PlannedWrite {
  /** Registered tool name the token is bound to. */
  tool: string;
  /** `<resource>.<verb>` identifier for the operation. */
  action: string;
  /** Prompt shown above the preview. */
  message: string;
  /** The primary ID or address acted on. */
  target: string;
  /** Human-readable summary of what the write does. */
  summary: string;
  method: 'POST' | 'DELETE';
  /** The validated request path — the same string the real call uses. */
  path: string;
  /** The JSON:API body, when the request has one. */
  body?: unknown;
  /** Extra caveat for the user (e.g. public visibility). */
  note?: string;
}

/**
 * Gate a write behind the user's confirmation. `undefined` means proceed; any
 * other value is the result to return unchanged (a prompt, a phase-1 preview
 * with a confirmToken, or a refusal). The token binds method, path and body,
 * so a phase-2 call with different arguments is refused as DRAFT_CHANGED.
 */
export function confirmWrite(
  ctx: ServerContext,
  confirmToken: string | undefined,
  write: PlannedWrite
): Promise<InputRequiredResult | CallToolResult | undefined> {
  const preview: Record<string, unknown> = {
    action: write.summary,
    method: write.method,
    path: write.path,
    ...(write.body === undefined ? {} : { willSend: write.body }),
    ...(write.note === undefined ? {} : { note: write.note }),
  };
  return requireConfirmationWithFallback(
    ctx,
    confirmationFromEnv({
      action: write.action,
      message: write.message,
      details: preview,
      tool: write.tool,
      confirmToken,
      subject: () => ({
        target: write.target,
        payload: { method: write.method, path: write.path, body: write.body },
        preview,
      }),
    })
  );
}
