import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { client } from '../src/client.js';
import {
  listBuilds,
  getBuild,
  listBetaGroups,
  listBetaTesters,
  inviteBetaTester,
  deleteBetaTester,
  addTestersToBetaGroup,
  removeTestersFromBetaGroup,
  submitBuildForBetaReview,
} from '../src/tools/testflight.js';

describe('testflight tools', () => {
  let reqSpy: ReturnType<typeof vi.spyOn<typeof client, 'request'>>;

  beforeEach(() => {
    reqSpy = vi.spyOn(client, 'request');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listBuilds: sorts -uploadedDate by default', async () => {
    reqSpy.mockResolvedValueOnce({
      data: [
        {
          type: 'builds',
          id: 'b1',
          attributes: { version: '42', uploadedDate: '2025-09-01', processingState: 'VALID', expired: false, expirationDate: '2025-12-01', minOsVersion: '17.0' },
        },
      ],
    } as never);
    const result = await listBuilds({ appId: '999' });
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/builds', undefined, {
      limit: 25,
      'filter[app]': '999',
      'filter[processingState]': undefined,
      'filter[version]': undefined,
      sort: '-uploadedDate',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.builds[0].id).toBe('b1');
    expect(parsed.builds[0].version).toBe('42');
  });

  it('getBuild: GET /v1/builds/{id}', async () => {
    reqSpy.mockResolvedValueOnce({
      data: { type: 'builds', id: 'b9', attributes: { version: '50', uploadedDate: '2025-10-01', processingState: 'VALID' } },
    } as never);
    await getBuild({ buildId: 'b9' });
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/builds/b9');
  });

  it('listBetaGroups: encodes isInternalGroup boolean as string', async () => {
    reqSpy.mockResolvedValueOnce({ data: [] } as never);
    await listBetaGroups({ appId: '999', isInternalGroup: true });
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/betaGroups', undefined, {
      limit: 50,
      'filter[app]': '999',
      'filter[isInternalGroup]': 'true',
    });
  });

  it('listBetaTesters: filter by app, group, email', async () => {
    reqSpy.mockResolvedValueOnce({ data: [] } as never);
    await listBetaTesters({ appId: '999', betaGroupId: 'g1', email: 't@x.com' });
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/betaTesters', undefined, {
      limit: 100,
      'filter[apps]': '999',
      'filter[betaGroups]': 'g1',
      'filter[email]': 't@x.com',
    });
  });

  it('inviteBetaTester: posts JSON:API body with relationships', async () => {
    reqSpy.mockResolvedValueOnce({
      data: { type: 'betaTesters', id: 'newid', attributes: { email: 'a@b.com', firstName: 'A', lastName: 'B', state: 'INVITED' } },
    } as never);
    await inviteBetaTester({ email: 'a@b.com', firstName: 'A', lastName: 'B', betaGroupIds: ['g1', 'g2'], buildIds: ['b1'] });
    expect(reqSpy).toHaveBeenCalledWith(
      'POST',
      '/v1/betaTesters',
      {
        data: {
          type: 'betaTesters',
          attributes: { email: 'a@b.com', firstName: 'A', lastName: 'B' },
          relationships: {
            betaGroups: { data: [{ id: 'g1', type: 'betaGroups' }, { id: 'g2', type: 'betaGroups' }] },
            builds: { data: [{ id: 'b1', type: 'builds' }] },
          },
        },
      }
    );
  });

  it('inviteBetaTester: omits relationships block when no groups/builds', async () => {
    reqSpy.mockResolvedValueOnce({
      data: { type: 'betaTesters', id: 'x', attributes: { email: 'a@b.com' } },
    } as never);
    await inviteBetaTester({ email: 'a@b.com' });
    const body = reqSpy.mock.calls[0]![2] as { data: { relationships?: unknown } };
    expect(body.data.relationships).toBeUndefined();
  });

  it('deleteBetaTester: DELETE /v1/betaTesters/{id}', async () => {
    reqSpy.mockResolvedValueOnce(null as never);
    const result = await deleteBetaTester({ betaTesterId: 'tester1' });
    expect(reqSpy).toHaveBeenCalledWith('DELETE', '/v1/betaTesters/tester1');
    expect(result.content[0].text).toContain('tester1');
  });

  it('addTestersToBetaGroup: posts to relationship endpoint', async () => {
    reqSpy.mockResolvedValueOnce(null as never);
    await addTestersToBetaGroup({ betaGroupId: 'g1', betaTesterIds: ['t1', 't2'] });
    expect(reqSpy).toHaveBeenCalledWith(
      'POST',
      '/v1/betaGroups/g1/relationships/betaTesters',
      { data: [{ id: 't1', type: 'betaTesters' }, { id: 't2', type: 'betaTesters' }] }
    );
  });

  it('removeTestersFromBetaGroup: deletes from relationship endpoint', async () => {
    reqSpy.mockResolvedValueOnce(null as never);
    await removeTestersFromBetaGroup({ betaGroupId: 'g1', betaTesterIds: ['t1'] });
    expect(reqSpy).toHaveBeenCalledWith(
      'DELETE',
      '/v1/betaGroups/g1/relationships/betaTesters',
      { data: [{ id: 't1', type: 'betaTesters' }] }
    );
  });

  it('submitBuildForBetaReview: POST /v1/betaAppReviewSubmissions', async () => {
    reqSpy.mockResolvedValueOnce({
      data: { type: 'betaAppReviewSubmissions', id: 'sub1', attributes: { betaReviewState: 'WAITING_FOR_REVIEW' } },
    } as never);
    await submitBuildForBetaReview({ buildId: 'b1' });
    expect(reqSpy).toHaveBeenCalledWith('POST', '/v1/betaAppReviewSubmissions', {
      data: {
        type: 'betaAppReviewSubmissions',
        relationships: { build: { data: { id: 'b1', type: 'builds' } } },
      },
    });
  });
});
