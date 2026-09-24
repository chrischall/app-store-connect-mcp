import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { client } from '../src/client.js';
import { listUsers, listUserInvitations } from '../src/tools/users.js';
import { writeHarness, phaseOne, confirmedCall } from './helpers.js';

describe('users tools', () => {
  let reqSpy: ReturnType<typeof vi.spyOn<typeof client, 'request'>>;

  beforeEach(() => {
    reqSpy = vi.spyOn(client, 'request');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listUsers: GET /v1/users with role filter passed as array', async () => {
    reqSpy.mockResolvedValueOnce({
      data: [
        {
          type: 'users',
          id: 'u1',
          attributes: { username: 'a@b.com', firstName: 'A', lastName: 'B', roles: ['ADMIN'], allAppsVisible: true, provisioningAllowed: true },
        },
      ],
    } as never);
    const result = await listUsers({ roles: ['ADMIN', 'DEVELOPER'] });
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/users', undefined, {
      limit: 100,
      'filter[username]': undefined,
      'filter[roles]': ['ADMIN', 'DEVELOPER'],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.users[0].roles).toEqual(['ADMIN']);
  });

  it('listUserInvitations: GET /v1/userInvitations', async () => {
    reqSpy.mockResolvedValueOnce({ data: [] } as never);
    await listUserInvitations({ email: 'x@y.com' });
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/userInvitations', undefined, {
      limit: 100,
      'filter[email]': 'x@y.com',
    });
  });

  it('inviteUser: defaults allAppsVisible=true when no visibleAppIds', async () => {
    reqSpy.mockResolvedValueOnce({
      data: {
        type: 'userInvitations',
        id: 'i1',
        attributes: { email: 'a@b.com', firstName: 'A', lastName: 'B', roles: ['DEVELOPER'], allAppsVisible: true, provisioningAllowed: false },
      },
    } as never);
    const harness = await writeHarness();
    try {
      await confirmedCall(harness, 'invite_user', { email: 'a@b.com', firstName: 'A', lastName: 'B', roles: ['DEVELOPER'] });
    } finally {
      await harness.close();
    }
    expect(reqSpy).toHaveBeenCalledTimes(1);
    expect(reqSpy).toHaveBeenCalledWith('POST', '/v1/userInvitations', {
      data: {
        type: 'userInvitations',
        attributes: {
          email: 'a@b.com',
          firstName: 'A',
          lastName: 'B',
          roles: ['DEVELOPER'],
          allAppsVisible: true,
          provisioningAllowed: false,
        },
      },
    });
  });

  it('inviteUser: defaults allAppsVisible=false when visibleAppIds provided, attaches relationship', async () => {
    reqSpy.mockResolvedValueOnce({
      data: {
        type: 'userInvitations',
        id: 'i2',
        attributes: { email: 'a@b.com', firstName: 'A', lastName: 'B', roles: ['APP_MANAGER'], allAppsVisible: false, provisioningAllowed: false },
      },
    } as never);
    const harness = await writeHarness();
    try {
      await confirmedCall(harness, 'invite_user', {
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        roles: ['APP_MANAGER'],
        visibleAppIds: ['app1', 'app2'],
      });
    } finally {
      await harness.close();
    }
    expect(reqSpy).toHaveBeenCalledTimes(1);
    expect(reqSpy).toHaveBeenCalledWith('POST', '/v1/userInvitations', {
      data: {
        type: 'userInvitations',
        attributes: {
          email: 'a@b.com',
          firstName: 'A',
          lastName: 'B',
          roles: ['APP_MANAGER'],
          allAppsVisible: false,
          provisioningAllowed: false,
        },
        relationships: {
          visibleApps: { data: [{ id: 'app1', type: 'apps' }, { id: 'app2', type: 'apps' }] },
        },
      },
    });
  });

  it('inviteUser: phase 1 returns the preview and makes NO network call', async () => {
    const harness = await writeHarness();
    try {
      const body = await phaseOne(harness, 'invite_user', { email: 'a@b.com', firstName: 'A', lastName: 'B', roles: ['ADMIN'] });
      expect(reqSpy).not.toHaveBeenCalled();
      expect(body.preview.method).toBe('POST');
      expect(body.preview.path).toBe('/v1/userInvitations');
      expect(body.preview.action).toMatch(/ADMIN/);
      expect(body.preview.willSend.data.attributes.roles).toEqual(['ADMIN']);
    } finally {
      await harness.close();
    }
  });
});
