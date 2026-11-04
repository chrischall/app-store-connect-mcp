/**
 * App names: the review read's `appId` argument as the person's own app names.
 *
 * At start the server lists the account's apps once ({@link loadAppDirectory});
 * when that succeeds `list_customer_reviews` publishes the app NAMES as a JSON
 * Schema `enum`, so a host that groups tools by subject (the mcp-host context
 * groups) can fan "any new reviews?" out over every app without enumerating
 * anything itself. A listing that fails — no key configured yet, a rejected
 * JWT, Apple down, or past the deadline — or an account with no apps publishes
 * the property with no `enum` (never an empty one, which is invalid JSON
 * Schema).
 *
 * The enum holds the names only, each app once — a host fanning out over the
 * enum's values would otherwise read every app twice. The handler stays
 * lenient underneath: a numeric App Store Connect app id passes through, so a
 * caller that does not validate against the schema, or an app created after
 * start, still works.
 */
import { z } from 'zod';
import { McpToolError } from '@chrischall/mcp-utils';
import { client as defaultClient, ascId } from '../client.js';
import type { AscEnvelope, AscResource } from '../types.js';

export interface AppDirectory {
  /** One label per app, in Apple's order; never empty. */
  labels: string[];
  /** A label (any case, trimmed) → that app's id; a numeric app id passes through; anything else is refused. */
  resolve(value: string): string;
}

/** Bound on the start-time listing: a host must not wait on it to list tools. */
export const APP_LIST_TIMEOUT_MS = 5_000;

/** App Store Connect app ids are numeric; an app name essentially never is. */
const APP_ID = /^\d+$/;

const normal = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function buildAppDirectory(apps: { id: string; name?: string | null }[]): AppDirectory | null {
  if (apps.length === 0) return null;
  const base = apps.map((a) => ({ id: a.id, label: a.name?.trim() || a.id }));
  const counts = new Map<string, number>();
  for (const a of base) counts.set(normal(a.label), (counts.get(normal(a.label)) ?? 0) + 1);
  // Two apps sharing one name would make the name ambiguous, so each carries its id.
  const labelled = base.map((a) => ({ id: a.id, label: counts.get(normal(a.label))! > 1 ? `${a.label} (${a.id})` : a.label }));
  const byLabel = new Map(labelled.map((a) => [normal(a.label), a.id]));
  const labels = labelled.map((a) => a.label);
  return {
    labels,
    resolve(value: string): string {
      const id = byLabel.get(normal(value));
      if (id !== undefined) return id;
      const ref = value.trim();
      if (APP_ID.test(ref)) return ref;
      throw new McpToolError(`Unknown app "${value}". Known: ${labels.join(', ')}.`, {
        hint: 'Use one of those names, or an app id from list_apps.',
      });
    },
  };
}

/**
 * List the apps ONCE, at server start (one page of `/v1/apps`, names only).
 * Answers null on failure, on timeout, or when the account has no apps. Never throws.
 */
export async function loadAppDirectory(
  timeoutMs: number = APP_LIST_TIMEOUT_MS,
  client: Pick<typeof defaultClient, 'request'> = defaultClient,
): Promise<AppDirectory | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref();
  });
  const listing = Promise.resolve()
    .then(() => client.request<AscEnvelope<AscResource<{ name?: string }>[]>>('GET', '/v1/apps', undefined, { limit: 200, 'fields[apps]': 'name' }))
    .then((r) => buildAppDirectory((r.data ?? []).map((a) => ({ id: a.id, name: a.attributes?.name }))))
    .catch(() => null);
  try {
    return await Promise.race([listing, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** The review read's `appId`: the app names as an enum when they were listed, else the plain id shape. */
export function appIdArgFor(apps: AppDirectory | null | undefined) {
  if (!apps) return ascId.describe('App Store Connect app ID');
  // `.meta({ enum })` publishes the names without making zod refuse an id.
  return z
    .string()
    .min(1)
    .max(200)
    .describe('The app, by name as listed here. The server also accepts a numeric app ID from list_apps, but this schema offers the names only.')
    .meta({ enum: apps.labels });
}
