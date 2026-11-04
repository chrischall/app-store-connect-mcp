import { describe, it, expect, vi, afterEach } from 'vitest';
import { UNTRUSTED_CONTENT_RULE } from '@chrischall/mcp-utils';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { client } from '../src/client.js';
import { registerAppTools } from '../src/tools/apps.js';
import { registerTestFlightTools } from '../src/tools/testflight.js';
import { registerReviewTools } from '../src/tools/reviews.js';
import { registerSalesTools } from '../src/tools/sales.js';
import { registerUserTools } from '../src/tools/users.js';
import { registerHealthcheckTools } from '../src/tools/health.js';
import { buildAppDirectory, loadAppDirectory, APP_LIST_TIMEOUT_MS, type AppDirectory } from '../src/tools/app-labels.js';
import { textOf } from './helpers.js';

type Listed = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  inputSchema: { properties: Record<string, any> };
  _meta?: { mint?: Record<string, any> };
};

const DOMAINS = ['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food'];
const INTENTS = ['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'];
const ANSWERING = ['whats-new', 'whats-due', 'whats-on'];
const KEYS = ['domain', 'intent', 'canonical', 'subject', 'when', 'aliases'];

function register(apps: AppDirectory | null) {
  return (server: Parameters<typeof registerAppTools>[0]) => {
    registerAppTools(server);
    registerTestFlightTools(server);
    registerReviewTools(server, apps);
    registerSalesTools(server);
    registerUserTools(server);
    registerHealthcheckTools(server, { request: async () => ({}) } as never, () => undefined);
  };
}

async function served(apps: AppDirectory | null = null): Promise<Listed[]> {
  const h = await createTestHarness(register(apps));
  const { tools } = await h.client.listTools();
  await h.close();
  return tools as Listed[];
}

const APPS = buildAppDirectory([
  { id: '111', name: 'Pocket Planner' },
  { id: '222', name: 'Tide Tables' },
])!;

afterEach(() => vi.restoreAllMocks());

describe('_meta.mint hints', () => {
  it('every tool except the healthcheck carries a hint in the contract’s shape', async () => {
    const tools = await served(APPS);
    expect(tools).toHaveLength(22);
    for (const t of tools) {
      if (t.name.endsWith('_healthcheck')) {
        expect(t._meta?.mint, t.name).toBeUndefined();
        continue;
      }
      const m = t._meta?.mint;
      expect(m, t.name).toBeDefined();
      expect(Object.keys(m!).every((k) => KEYS.includes(k)), t.name).toBe(true);
      expect(DOMAINS).toContain(m!.domain);
      expect(m!.domain, t.name).toBe('work');
      expect(INTENTS, t.name).toContain(m!.intent);
      if (m!.aliases) {
        expect(m!.aliases.length, t.name).toBeLessThanOrEqual(8);
        for (const a of m!.aliases) {
          expect(a.length, t.name).toBeLessThanOrEqual(40);
          expect(a, t.name).toBe(a.toLowerCase());
        }
      }
      if (m!.subject) expect(t.inputSchema.properties, t.name).toHaveProperty(m!.subject);
      if (m!.when) {
        expect(t.inputSchema.properties, t.name).toHaveProperty(m!.when.start);
        expect(t.inputSchema.properties, t.name).toHaveProperty(m!.when.end);
      }
    }
  });

  it('puts canonical only on read-only reads that answer what’s new/due/on, at most one per intent', async () => {
    const canonical = (await served(APPS)).filter((t) => t._meta?.mint?.canonical !== undefined);
    const perIntent = new Map<string, number>();
    for (const t of canonical) {
      expect(t._meta!.mint!.canonical, t.name).toBe(true);
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(ANSWERING, t.name).toContain(t._meta!.mint!.intent);
      perIntent.set(t._meta!.mint!.intent, (perIntent.get(t._meta!.mint!.intent) ?? 0) + 1);
    }
    for (const [intent, n] of perIntent) expect(n, intent).toBe(1);
    // The one question this MCP genuinely answers: new customer reviews. Nothing here is due or on.
    expect(canonical.map((t) => t.name)).toEqual(['list_customer_reviews']);
  });

  it('gives the canonical review read its subject, a brief view and the everyday words', async () => {
    const t = (await served(APPS)).find((x) => x.name === 'list_customer_reviews')!;
    expect(t._meta!.mint).toEqual({
      domain: 'work',
      intent: 'whats-new',
      canonical: true,
      subject: 'appId',
      aliases: ['app reviews', 'reviews', 'ratings', 'stars', 'app store', 'customer feedback'],
    });
    expect(t.inputSchema.properties.view.enum).toEqual(['full', 'brief']);
  });

  it('marks writes as send or change, never canonical', async () => {
    const writes = Object.fromEntries(
      (await served(APPS)).filter((t) => t.annotations?.readOnlyHint === false).map((t) => [t.name, t._meta!.mint!.intent]),
    );
    expect(writes).toEqual({
      invite_beta_tester: 'send',
      invite_user: 'send',
      respond_to_review: 'send',
      delete_beta_tester: 'change',
      add_testers_to_beta_group: 'change',
      remove_testers_from_beta_group: 'change',
      submit_build_for_beta_review: 'change',
    });
  });
});

describe('app names on the review read’s appId', () => {
  it('publishes the app names as an enum, each app once, never the ids', async () => {
    const p = (await served(APPS)).find((t) => t.name === 'list_customer_reviews')!.inputSchema.properties.appId;
    expect(p.enum).toEqual(['Pocket Planner', 'Tide Tables']);
    expect(p.description).toMatch(/by name/);
  });

  it('keeps the plain id property, with no enum, when the apps could not be listed', async () => {
    const p = (await served(null)).find((t) => t.name === 'list_customer_reviews')!.inputSchema.properties.appId;
    expect(p).not.toHaveProperty('enum');
    expect(p.type).toBe('string');
  });

  it('disambiguates two apps with one name by id', () => {
    const d = buildAppDirectory([{ id: '1', name: 'Same' }, { id: '2', name: 'Same' }])!;
    expect(d.labels).toEqual(['Same (1)', 'Same (2)']);
    expect(d.resolve('same (2)')).toBe('2');
  });

  it('answers null for an account with no apps (never an empty enum)', () => {
    expect(buildAppDirectory([])).toBeNull();
  });

  it('resolves a name (any case) to its id, passes a raw id through, refuses anything else naming the apps', () => {
    expect(APPS.resolve(' pocket planner ')).toBe('111');
    expect(APPS.resolve('333')).toBe('333');
    expect(() => APPS.resolve('Nope')).toThrow(/Unknown app "Nope"\. Known: Pocket Planner, Tide Tables\./);
  });

  it('loads the directory from one page of /v1/apps', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValueOnce({
      data: [{ type: 'apps', id: '111', attributes: { name: 'Pocket Planner' } }, { type: 'apps', id: '9', attributes: {} }],
    } as never);
    const d = await loadAppDirectory();
    expect(spy).toHaveBeenCalledWith('GET', '/v1/apps', undefined, { limit: 200, 'fields[apps]': 'name' });
    expect(d!.labels).toEqual(['Pocket Planner', '9']);
  });

  it('answers null when the listing fails or outlasts its bound', async () => {
    vi.spyOn(client, 'request').mockRejectedValueOnce(new Error('credential incomplete'));
    expect(await loadAppDirectory()).toBeNull();
    vi.spyOn(client, 'request').mockReturnValueOnce(new Promise(() => {}) as never);
    expect(await loadAppDirectory(10)).toBeNull();
    expect(APP_LIST_TIMEOUT_MS).toBe(5_000);
  });

  it('a call by name reads that app’s reviews', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValueOnce({ data: [] } as never);
    const h = await createTestHarness(register(APPS));
    try {
      await h.callTool('list_customer_reviews', { appId: 'Tide Tables' });
    } finally {
      await h.close();
    }
    expect(spy.mock.calls[0]![1]).toBe('/v1/apps/222/customerReviews');
  });

  it('refuses an unknown name as a tool error', async () => {
    const h = await createTestHarness(register(APPS));
    try {
      const r = await h.callTool('list_customer_reviews', { appId: 'Nope' });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/Unknown app "Nope"/);
    } finally {
      await h.close();
    }
  });
});

describe('view: brief on list_customer_reviews', () => {
  const review = (id: string, attrs: Record<string, unknown>) => ({ type: 'customerReviews', id, attributes: attrs });

  async function brief(response: unknown, args: Record<string, unknown> = {}) {
    vi.spyOn(client, 'request').mockResolvedValueOnce(response as never);
    const h = await createTestHarness(register(APPS));
    try {
      return JSON.parse(textOf(await h.callTool('list_customer_reviews', { appId: '111', view: 'brief', ...args })));
    } finally {
      await h.close();
    }
  }

  it('answers one line per review inside the untrusted-data envelope', async () => {
    const body = await brief({
      data: [
        review('r1', { rating: 5, title: 'Great', createdDate: '2026-11-01T10:00:00-07:00', territory: 'USA' }),
        review('r2', { rating: 2, title: null, createdDate: null, territory: 'GBR' }),
      ],
    });
    expect(Object.keys(body)).toEqual(['untrusted_content', 'note', 'data']);
    expect(body.untrusted_content).toBe(true);
    expect(body.note).toContain(UNTRUSTED_CONTENT_RULE);
    expect(body.data).toEqual([
      'Great — 2026-11-01T10:00:00-07:00 — 5 stars, USA',
      '(no title) — no date — 2 stars, GBR',
    ]);
  });

  it('caps every line at 120 characters, trimming the title', async () => {
    const body = await brief({ data: [review('r1', { rating: 1, title: 'x'.repeat(300), createdDate: '2026-11-01', territory: 'USA' })] });
    expect(body.data[0].length).toBeLessThanOrEqual(120);
    expect(body.data[0]).toMatch(/… — 2026-11-01 — 1 star, USA$/);
  });

  it('says "-- none" for no reviews', async () => {
    expect((await brief({ data: [] })).data).toEqual(['-- none']);
  });

  it('says "-- more" when the page is partial', async () => {
    const body = await brief(
      { data: [review('r1', { rating: 4, title: 'Ok', createdDate: '2026-11-01', territory: 'USA' })], links: { next: 'https://api.appstoreconnect.apple.com/v1/apps/111/customerReviews?cursor=x' } },
      { limit: 1 },
    );
    expect(body.data).toEqual(['Ok — 2026-11-01 — 4 stars, USA', '-- more']);
  });

  it('leaves the full view unchanged', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ data: [review('r1', { rating: 5, title: 'Great', body: 'b', createdDate: '2026-11-01', territory: 'USA' })] } as never);
    const h = await createTestHarness(register(APPS));
    try {
      const body = JSON.parse(textOf(await h.callTool('list_customer_reviews', { appId: '111' })));
      expect(body.untrusted_content).toBe(true);
      expect(body.reviews[0]).toMatchObject({ id: 'r1', title: 'Great' });
    } finally {
      await h.close();
    }
  });
});
