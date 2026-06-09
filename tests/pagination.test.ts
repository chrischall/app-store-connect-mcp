import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { client, paginate, nextUrlToPath, pageSize, paginateOpts, API_BASE } from '../src/client.js';
import { listApps } from '../src/tools/apps.js';
import type { AscEnvelope, AscResource } from '../src/types.js';

type Page = AscEnvelope<AscResource[]>;

function page(ids: string[], next?: string): Page {
  return {
    data: ids.map((id) => ({ type: 'things', id, attributes: { id } })),
    links: next ? { next } : {},
  };
}

describe('paginate', () => {
  let reqSpy: ReturnType<typeof vi.spyOn<typeof client, 'request'>>;

  beforeEach(() => {
    reqSpy = vi.spyOn(client, 'request');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aggregates results across multiple pages up to the limit', async () => {
    // 3 pages of 2 items each; limit is generous (10) so all 6 are returned.
    reqSpy
      .mockResolvedValueOnce(page(['1', '2'], `${API_BASE}/v1/things?cursor=A`) as never)
      .mockResolvedValueOnce(page(['3', '4'], `${API_BASE}/v1/things?cursor=B`) as never)
      .mockResolvedValueOnce(page(['5', '6']) as never);

    const result = await paginate<AscResource>('/v1/things', { 'filter[x]': 'y' }, { limit: 10 });

    expect(result.items.map((r) => r.id)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(result.pagination).toEqual({ fetched: 6, pages: 3, has_more: false });

    // First call carries the original query; follow-up calls use the reduced next path with no extra query.
    expect(reqSpy).toHaveBeenNthCalledWith(1, 'GET', '/v1/things', undefined, { 'filter[x]': 'y' });
    expect(reqSpy).toHaveBeenNthCalledWith(2, 'GET', '/v1/things?cursor=A');
    expect(reqSpy).toHaveBeenNthCalledWith(3, 'GET', '/v1/things?cursor=B');
  });

  it('reports has_more and a next_cursor when truncated at the limit', async () => {
    reqSpy
      .mockResolvedValueOnce(page(['1', '2'], `${API_BASE}/v1/things?cursor=A`) as never)
      .mockResolvedValueOnce(page(['3', '4'], `${API_BASE}/v1/things?cursor=B`) as never);

    // limit 3 -> stop mid-stream; second page still has a next link.
    const result = await paginate<AscResource>('/v1/things', undefined, { limit: 3 });

    expect(result.items.map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(result.pagination.fetched).toBe(3);
    expect(result.pagination.has_more).toBe(true);
    expect(result.pagination.next_cursor).toBe(`${API_BASE}/v1/things?cursor=B`);
    expect(reqSpy).toHaveBeenCalledTimes(2);
  });

  it('returns a single page when there is no links.next', async () => {
    reqSpy.mockResolvedValueOnce(page(['1', '2']) as never);

    const result = await paginate<AscResource>('/v1/things', undefined, { limit: 100 });

    expect(result.items.map((r) => r.id)).toEqual(['1', '2']);
    expect(result.pagination).toEqual({ fetched: 2, pages: 1, has_more: false });
    expect(reqSpy).toHaveBeenCalledTimes(1);
  });

  it('terminates on a non-advancing next cursor (does not loop forever)', async () => {
    const stuck = `${API_BASE}/v1/things?cursor=SAME`;
    reqSpy
      .mockResolvedValueOnce(page(['1', '2'], stuck) as never)
      .mockResolvedValueOnce(page(['3', '4'], stuck) as never);

    const result = await paginate<AscResource>('/v1/things', undefined, { limit: 100 });

    // Second page repeats the same cursor we just followed -> stop instead of looping.
    expect(result.items.map((r) => r.id)).toEqual(['1', '2', '3', '4']);
    expect(result.pagination.has_more).toBe(true);
    expect(reqSpy).toHaveBeenCalledTimes(2);
  });

  it('honors the max-pages cap to guard runaway loops', async () => {
    // Every page advertises a fresh, advancing next cursor -> only the cap stops it.
    let n = 0;
    reqSpy.mockImplementation((async () => {
      n += 1;
      return page([`${n}`], `${API_BASE}/v1/things?cursor=${n}`);
    }) as never);

    const result = await paginate<AscResource>('/v1/things', undefined, { limit: 100000, maxPages: 4 });

    expect(result.pagination.pages).toBe(4);
    expect(result.pagination.has_more).toBe(true);
    expect(reqSpy).toHaveBeenCalledTimes(4);
  });

  it('respects a page limit smaller than the API page size by trimming the final page', async () => {
    reqSpy.mockResolvedValueOnce(page(['1', '2', '3', '4', '5']) as never);
    const result = await paginate<AscResource>('/v1/things', undefined, { limit: 3 });
    expect(result.items.map((r) => r.id)).toEqual(['1', '2', '3']);
    // No links.next on the page, but we truncated -> has_more is true.
    expect(result.pagination.has_more).toBe(true);
  });
});

describe('nextUrlToPath', () => {
  it('reduces an absolute ASC next URL to a path+query', () => {
    expect(nextUrlToPath(`${API_BASE}/v1/apps?cursor=ABC&limit=200`)).toBe('/v1/apps?cursor=ABC&limit=200');
  });

  it('rejects an off-host URL (defensive)', () => {
    expect(nextUrlToPath('https://evil.example.com/v1/apps?cursor=X')).toBeUndefined();
  });
});

describe('pageSize / paginateOpts', () => {
  it('clamps the per-request page size to the API max (200)', () => {
    expect(pageSize(1000, 50, false)).toBe(200);
    expect(pageSize(1000, 50, true)).toBe(200);
    expect(pageSize(10, 50, false)).toBe(10);
    expect(pageSize(undefined, 50, false)).toBe(50);
  });

  it('caps to a single page when auto_paginate is off', () => {
    expect(paginateOpts({ limit: 500 }, 50)).toEqual({ limit: 500, maxPages: 1 });
    expect(paginateOpts({ limit: 500, auto_paginate: true }, 50)).toEqual({ limit: 500 });
  });
});

describe('list tool wiring (listApps)', () => {
  let reqSpy: ReturnType<typeof vi.spyOn<typeof client, 'request'>>;
  beforeEach(() => {
    reqSpy = vi.spyOn(client, 'request');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto_paginate walks multiple pages and reports pagination in the result', async () => {
    reqSpy
      .mockResolvedValueOnce({
        data: [{ type: 'apps', id: 'a1', attributes: { name: 'A1', bundleId: 'b1', sku: 's1', primaryLocale: 'en-US' } }],
        links: { next: `${API_BASE}/v1/apps?cursor=N1` },
      } as never)
      .mockResolvedValueOnce({
        data: [{ type: 'apps', id: 'a2', attributes: { name: 'A2', bundleId: 'b2', sku: 's2', primaryLocale: 'en-US' } }],
        links: {},
      } as never);

    const result = await listApps({ auto_paginate: true, limit: 500 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
    expect(parsed.apps.map((a: { id: string }) => a.id)).toEqual(['a1', 'a2']);
    expect(parsed.pagination).toEqual({ fetched: 2, pages: 2, has_more: false });
    // First page requests the API-max page size (200) under auto-pagination.
    expect(reqSpy).toHaveBeenNthCalledWith(1, 'GET', '/v1/apps', undefined, {
      limit: 200,
      'filter[bundleId]': undefined,
      'filter[name]': undefined,
    });
  });

  it('without auto_paginate makes exactly one request and surfaces has_more from links.next', async () => {
    reqSpy.mockResolvedValueOnce({
      data: [{ type: 'apps', id: 'a1', attributes: { name: 'A1', bundleId: 'b1', sku: 's1', primaryLocale: 'en-US' } }],
      links: { next: `${API_BASE}/v1/apps?cursor=N1` },
    } as never);

    const result = await listApps();
    expect(reqSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.pagination.has_more).toBe(true);
    expect(parsed.pagination.next_cursor).toBe(`${API_BASE}/v1/apps?cursor=N1`);
  });
});
