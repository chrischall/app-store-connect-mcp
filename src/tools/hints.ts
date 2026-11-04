/**
 * Context-group hints, published on each tool as `_meta.mint` (mcp-host's
 * `mintHintSchema`, the context-groups contract). Inert data: a host that does
 * not read them sees an extra `_meta` key and nothing else. The shape is fixed
 * by the host's contract, so it is restated here rather than imported — this
 * server takes no dependency on mcp-host.
 *
 * `subject` and `when` name THIS tool's own argument names (the host fills
 * them), never values; `aliases` are the words a person says — lowercase, at
 * most 8, each at most 40 chars.
 *
 * App Store Connect answers one of the three group questions: "what's new" —
 * new customer reviews (`list_customer_reviews`, canonical). Nothing here has a
 * due date or a calendar, so there is no `whats-due` or `whats-on` read.
 */
export type MintIntent =
  | 'whats-new' | 'whats-due' | 'whats-on' | 'lookup' | 'turn-on-off' | 'send' | 'change' | 'other';

export interface MintHint {
  domain: 'work';
  intent: MintIntent;
  canonical?: true;
  subject?: string;
  when?: { start: string; end: string };
  aliases?: string[];
}

/** `_meta` for an App Store Connect tool: every tool here is in the `work` domain. */
export function workMeta(intent: MintIntent, extra: Omit<MintHint, 'domain' | 'intent'> = {}): { mint: MintHint } {
  return { mint: { domain: 'work', intent, ...extra } };
}
