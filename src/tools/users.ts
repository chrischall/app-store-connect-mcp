import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { minifiedResult, schemaConfirm } from '@chrischall/mcp-utils';
import { client, paginate, pageSize, paginateOpts } from '../client.js';
import { AscEnvelope, AscResource, ToolResult } from '../types.js';

interface UserAttrs {
  username: string;
  firstName: string;
  lastName: string;
  roles: string[];
  allAppsVisible: boolean;
  provisioningAllowed: boolean;
}

interface UserInvitationAttrs {
  email: string;
  firstName: string;
  lastName: string;
  expirationDate?: string;
  roles: string[];
  allAppsVisible: boolean;
  provisioningAllowed: boolean;
}

const ROLE_VALUES = [
  'ADMIN',
  'FINANCE',
  'ACCOUNT_HOLDER',
  'SALES',
  'MARKETING',
  'APP_MANAGER',
  'DEVELOPER',
  'ACCESS_TO_REPORTS',
  'CUSTOMER_SUPPORT',
  'CREATE_APPS',
  'CLOUD_MANAGED_DEVELOPER_ID',
  'CLOUD_MANAGED_APP_DISTRIBUTION',
  'GENERATE_INDIVIDUAL_KEYS',
] as const;

export async function listUsers(args: { limit?: number; username?: string; roles?: string[]; auto_paginate?: boolean } = {}): Promise<ToolResult> {
  const { items, pagination } = await paginate<AscResource<UserAttrs>>('/v1/users', {
    limit: pageSize(args.limit, 100, args.auto_paginate),
    'filter[username]': args.username,
    'filter[roles]': args.roles,
  }, paginateOpts(args, 100));
  const users = items.map((r) => ({
    id: r.id,
    username: r.attributes?.username,
    firstName: r.attributes?.firstName,
    lastName: r.attributes?.lastName,
    roles: r.attributes?.roles,
    allAppsVisible: r.attributes?.allAppsVisible,
  }));
  return minifiedResult({ count: users.length, users, pagination });
}

export async function listUserInvitations(args: { limit?: number; email?: string; auto_paginate?: boolean } = {}): Promise<ToolResult> {
  const { items, pagination } = await paginate<AscResource<UserInvitationAttrs>>(
    '/v1/userInvitations',
    {
      limit: pageSize(args.limit, 100, args.auto_paginate),
      'filter[email]': args.email,
    },
    paginateOpts(args, 100)
  );
  const invitations = items.map((r) => ({
    id: r.id,
    email: r.attributes?.email,
    firstName: r.attributes?.firstName,
    lastName: r.attributes?.lastName,
    expirationDate: r.attributes?.expirationDate,
    roles: r.attributes?.roles,
    allAppsVisible: r.attributes?.allAppsVisible,
  }));
  return minifiedResult({ count: invitations.length, invitations, pagination });
}

export async function inviteUser(args: {
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  allAppsVisible?: boolean;
  provisioningAllowed?: boolean;
  visibleAppIds?: string[];
  confirm?: boolean;
}): Promise<ToolResult> {
  const relationships: Record<string, { data: { id: string; type: string }[] }> = {};
  if (args.visibleAppIds?.length) {
    relationships.visibleApps = { data: args.visibleAppIds.map((id) => ({ id, type: 'apps' })) };
  }
  const body = {
    data: {
      type: 'userInvitations',
      attributes: {
        email: args.email,
        firstName: args.firstName,
        lastName: args.lastName,
        roles: args.roles,
        allAppsVisible: args.allAppsVisible ?? args.visibleAppIds === undefined,
        provisioningAllowed: args.provisioningAllowed ?? false,
      },
      ...(Object.keys(relationships).length > 0 ? { relationships } : {}),
    },
  };
  if (args.confirm !== true) {
    return minifiedResult({
      dryRun: true,
      action: `Invite ${args.email} to your App Store Connect team with roles [${args.roles.join(', ')}] (sends a real email; roles can include ADMIN)`,
      method: 'POST',
      path: '/v1/userInvitations',
      willSend: body,
      note: 'Dry run — re-run with confirm:true to send the invitation.',
    });
  }
  const response = await client.request<AscEnvelope<AscResource<UserInvitationAttrs>>>('POST', '/v1/userInvitations', body);
  return minifiedResult({ id: response.data.id, ...response.data.attributes });
}

export function registerUserTools(server: McpServer): void {
  server.registerTool(
    'list_users',
    {
      description: 'List users on your App Store Connect team.',
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional().describe('Max users (default 100). With auto_paginate this is the total across pages.'),
        auto_paginate: z.boolean().optional().describe('Follow links.next across pages until the limit is reached (default false).'),
        username: z.string().optional().describe('Exact username (email) filter'),
        roles: z.array(z.enum(ROLE_VALUES)).optional().describe('Filter by one or more roles'),
      },
      annotations: { readOnlyHint: true },
    },
    listUsers
  );

  server.registerTool(
    'list_user_invitations',
    {
      description: 'List pending user invitations on your team.',
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional().describe('Max invitations (default 100). With auto_paginate this is the total across pages.'),
        auto_paginate: z.boolean().optional().describe('Follow links.next across pages until the limit is reached (default false).'),
        email: z.string().optional().describe('Exact email filter'),
      },
      annotations: { readOnlyHint: true },
    },
    listUserInvitations
  );

  server.registerTool(
    'invite_user',
    {
      description: 'Invite a new user to your App Store Connect team with specified roles (sends a real email; roles can include ADMIN). Without confirm:true this returns a dry-run preview and makes NO network call; with confirm:true it sends the invitation.',
      inputSchema: {
        email: z.string().email().describe("User's email"),
        firstName: z.string().describe('First name'),
        lastName: z.string().describe('Last name'),
        roles: z.array(z.enum(ROLE_VALUES)).min(1).describe('Roles to assign'),
        allAppsVisible: z.boolean().optional().describe('Grant access to all apps. Default: true unless visibleAppIds is provided.'),
        provisioningAllowed: z.boolean().optional().describe('Allow access to provisioning (certificates/profiles). Default false.'),
        visibleAppIds: z.array(z.string()).optional().describe('Restrict visibility to these app IDs. If provided, allAppsVisible defaults to false.'),
        confirm: schemaConfirm,
      },
      annotations: { destructiveHint: true },
    },
    inviteUser
  );
}
