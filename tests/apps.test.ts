import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { client } from '../src/client.js';
import { listApps, getApp, listAppStoreVersions, getAppInfos } from '../src/tools/apps.js';

describe('apps tools', () => {
  let reqSpy: ReturnType<typeof vi.spyOn<typeof client, 'request'>>;

  beforeEach(() => {
    reqSpy = vi.spyOn(client, 'request');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listApps: GET /v1/apps with default limit and compact projection', async () => {
    reqSpy.mockResolvedValueOnce({
      data: [
        {
          type: 'apps',
          id: '111',
          attributes: { name: 'My App', bundleId: 'com.example.x', sku: 'X1', primaryLocale: 'en-US' },
        },
      ],
    } as never);

    const result = await listApps();
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/apps', undefined, {
      limit: 50,
      'filter[bundleId]': undefined,
      'filter[name]': undefined,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.apps[0]).toEqual({ id: '111', name: 'My App', bundleId: 'com.example.x', sku: 'X1', primaryLocale: 'en-US' });
  });

  it('listApps: passes through filter args', async () => {
    reqSpy.mockResolvedValueOnce({ data: [] } as never);
    await listApps({ limit: 10, bundleId: 'com.x.y', name: 'Foo' });
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/apps', undefined, {
      limit: 10,
      'filter[bundleId]': 'com.x.y',
      'filter[name]': 'Foo',
    });
  });

  it('getApp: GET /v1/apps/{id}', async () => {
    reqSpy.mockResolvedValueOnce({
      data: { type: 'apps', id: '999', attributes: { name: 'A', bundleId: 'b', sku: 's', primaryLocale: 'en-US' } },
    } as never);
    const result = await getApp({ appId: '999' });
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/apps/999');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe('999');
    expect(parsed.bundleId).toBe('b');
  });

  it('listAppStoreVersions: hits app sub-resource with platform/state filters', async () => {
    reqSpy.mockResolvedValueOnce({
      data: [
        {
          type: 'appStoreVersions',
          id: 'v1',
          attributes: { versionString: '1.2.0', appStoreState: 'READY_FOR_SALE', platform: 'IOS', releaseType: 'MANUAL', createdDate: '2025-01-01' },
        },
      ],
    } as never);
    const result = await listAppStoreVersions({ appId: '999', platform: 'IOS', appStoreState: 'READY_FOR_SALE' });
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/apps/999/appStoreVersions', undefined, {
      limit: 25,
      'filter[platform]': 'IOS',
      'filter[appStoreState]': 'READY_FOR_SALE',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.versions[0].versionString).toBe('1.2.0');
  });

  it('getAppInfos: GET /v1/apps/{id}/appInfos', async () => {
    reqSpy.mockResolvedValueOnce({
      data: [{ type: 'appInfos', id: 'info1', attributes: { appStoreState: 'READY_FOR_SALE', appStoreAgeRating: 'FOUR_PLUS' } }],
    } as never);
    const result = await getAppInfos({ appId: '999' });
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/apps/999/appInfos');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.infos[0].appStoreAgeRating).toBe('FOUR_PLUS');
  });
});
