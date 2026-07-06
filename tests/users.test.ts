import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { client } from '../src/client.js';
import { listUsers, listUserInvitations, inviteUser } from '../src/tools/users.js';

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
    await inviteUser({ email: 'a@b.com', firstName: 'A', lastName: 'B', roles: ['DEVELOPER'], confirm: true });
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
    await inviteUser({
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      roles: ['APP_MANAGER'],
      visibleAppIds: ['app1', 'app2'],
      confirm: true,
    });
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

  it('inviteUser: without confirm returns a dry-run preview and makes NO network call', async () => {
    const result = await inviteUser({ email: 'a@b.com', firstName: 'A', lastName: 'B', roles: ['ADMIN'] });
    expect(reqSpy).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.willSend.data.attributes.roles).toEqual(['ADMIN']);
  });
});
