import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, schemaConfirm } from '@chrischall/mcp-utils';
import { client, paginate, pageSize, paginateOpts } from '../client.js';
import { AscEnvelope, AscResource, ToolResult } from '../types.js';

interface BuildAttrs {
  version: string;
  uploadedDate: string;
  expirationDate?: string;
  expired?: boolean;
  processingState?: string;
  usesNonExemptEncryption?: boolean;
  minOsVersion?: string;
}

interface BetaGroupAttrs {
  name: string;
  isInternalGroup: boolean;
  publicLink?: string | null;
  publicLinkEnabled?: boolean;
  publicLinkLimit?: number | null;
  publicLinkLimitEnabled?: boolean;
  createdDate: string;
}

interface BetaTesterAttrs {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  inviteType?: string;
  state?: string;
}

export async function listBuilds(args: { appId?: string; limit?: number; processingState?: string; version?: string; auto_paginate?: boolean } = {}): Promise<ToolResult> {
  const { items, pagination } = await paginate<AscResource<BuildAttrs>>('/v1/builds', {
    limit: pageSize(args.limit, 25, args.auto_paginate),
    'filter[app]': args.appId,
    'filter[processingState]': args.processingState,
    'filter[version]': args.version,
    sort: '-uploadedDate',
  }, paginateOpts(args, 25));
  const builds = items.map((r) => ({
    id: r.id,
    version: r.attributes?.version,
    uploadedDate: r.attributes?.uploadedDate,
    processingState: r.attributes?.processingState,
    expired: r.attributes?.expired,
    expirationDate: r.attributes?.expirationDate,
    minOsVersion: r.attributes?.minOsVersion,
  }));
  return textResult({ count: builds.length, builds, pagination });
}

export async function getBuild(args: { buildId: string }): Promise<ToolResult> {
  const response = await client.request<AscEnvelope<AscResource<BuildAttrs>>>('GET', `/v1/builds/${args.buildId}`);
  return textResult({ id: response.data.id, ...response.data.attributes });
}

export async function listBetaGroups(args: { appId?: string; limit?: number; isInternalGroup?: boolean; auto_paginate?: boolean } = {}): Promise<ToolResult> {
  const { items, pagination } = await paginate<AscResource<BetaGroupAttrs>>('/v1/betaGroups', {
    limit: pageSize(args.limit, 50, args.auto_paginate),
    'filter[app]': args.appId,
    'filter[isInternalGroup]': args.isInternalGroup === undefined ? undefined : String(args.isInternalGroup),
  }, paginateOpts(args, 50));
  const groups = items.map((r) => ({
    id: r.id,
    name: r.attributes?.name,
    isInternalGroup: r.attributes?.isInternalGroup,
    publicLink: r.attributes?.publicLink,
    publicLinkEnabled: r.attributes?.publicLinkEnabled,
    createdDate: r.attributes?.createdDate,
  }));
  return textResult({ count: groups.length, groups, pagination });
}

export async function listBetaTesters(args: { appId?: string; betaGroupId?: string; email?: string; limit?: number; auto_paginate?: boolean } = {}): Promise<ToolResult> {
  const { items, pagination } = await paginate<AscResource<BetaTesterAttrs>>('/v1/betaTesters', {
    limit: pageSize(args.limit, 100, args.auto_paginate),
    'filter[apps]': args.appId,
    'filter[betaGroups]': args.betaGroupId,
    'filter[email]': args.email,
  }, paginateOpts(args, 100));
  const testers = items.map((r) => ({
    id: r.id,
    email: r.attributes?.email,
    firstName: r.attributes?.firstName,
    lastName: r.attributes?.lastName,
    state: r.attributes?.state,
    inviteType: r.attributes?.inviteType,
  }));
  return textResult({ count: testers.length, testers, pagination });
}

export async function inviteBetaTester(args: { email: string; firstName?: string; lastName?: string; betaGroupIds?: string[]; buildIds?: string[]; confirm?: boolean }): Promise<ToolResult> {
  const relationships: Record<string, { data: { id: string; type: string }[] }> = {};
  if (args.betaGroupIds?.length) {
    relationships.betaGroups = { data: args.betaGroupIds.map((id) => ({ id, type: 'betaGroups' })) };
  }
  if (args.buildIds?.length) {
    relationships.builds = { data: args.buildIds.map((id) => ({ id, type: 'builds' })) };
  }
  const body = {
    data: {
      type: 'betaTesters',
      attributes: {
        email: args.email,
        firstName: args.firstName,
        lastName: args.lastName,
      },
      ...(Object.keys(relationships).length > 0 ? { relationships } : {}),
    },
  };
  if (args.confirm !== true) {
    return textResult({ dryRun: true, action: `Invite beta tester ${args.email} (sends a real email)`, method: 'POST', path: '/v1/betaTesters', willSend: body, note: 'Dry run — re-run with confirm:true to invite.' });
  }
  const response = await client.request<AscEnvelope<AscResource<BetaTesterAttrs>>>('POST', '/v1/betaTesters', body);
  return textResult({ id: response.data.id, ...response.data.attributes });
}

export async function deleteBetaTester(args: { betaTesterId: string; confirm?: boolean }): Promise<ToolResult> {
  if (args.confirm !== true) {
    return textResult({ dryRun: true, action: 'Permanently remove a beta tester from your team', method: 'DELETE', path: `/v1/betaTesters/${args.betaTesterId}`, note: 'Dry run — re-run with confirm:true to delete.' });
  }
  await client.request<null>('DELETE', `/v1/betaTesters/${args.betaTesterId}`);
  return textResult({ deleted: args.betaTesterId });
}

export async function addTestersToBetaGroup(args: { betaGroupId: string; betaTesterIds: string[]; confirm?: boolean }): Promise<ToolResult> {
  const body = {
    data: args.betaTesterIds.map((id) => ({ id, type: 'betaTesters' })),
  };
  if (args.confirm !== true) {
    return textResult({ dryRun: true, action: `Add ${args.betaTesterIds.length} tester(s) to beta group ${args.betaGroupId}`, method: 'POST', path: `/v1/betaGroups/${args.betaGroupId}/relationships/betaTesters`, willSend: body, note: 'Dry run — re-run with confirm:true to add.' });
  }
  await client.request<null>('POST', `/v1/betaGroups/${args.betaGroupId}/relationships/betaTesters`, body);
  return textResult({ betaGroupId: args.betaGroupId, added: args.betaTesterIds });
}

export async function removeTestersFromBetaGroup(args: { betaGroupId: string; betaTesterIds: string[]; confirm?: boolean }): Promise<ToolResult> {
  const body = {
    data: args.betaTesterIds.map((id) => ({ id, type: 'betaTesters' })),
  };
  if (args.confirm !== true) {
    return textResult({ dryRun: true, action: `Remove ${args.betaTesterIds.length} tester(s) from beta group ${args.betaGroupId}`, method: 'DELETE', path: `/v1/betaGroups/${args.betaGroupId}/relationships/betaTesters`, willSend: body, note: 'Dry run — re-run with confirm:true to remove.' });
  }
  await client.request<null>('DELETE', `/v1/betaGroups/${args.betaGroupId}/relationships/betaTesters`, body);
  return textResult({ betaGroupId: args.betaGroupId, removed: args.betaTesterIds });
}

export async function submitBuildForBetaReview(args: { buildId: string; confirm?: boolean }): Promise<ToolResult> {
  const body = {
    data: {
      type: 'betaAppReviewSubmissions',
      relationships: {
        build: { data: { id: args.buildId, type: 'builds' } },
      },
    },
  };
  if (args.confirm !== true) {
    return textResult({ dryRun: true, action: `Submit build ${args.buildId} to Apple for TestFlight beta review`, method: 'POST', path: '/v1/betaAppReviewSubmissions', willSend: body, note: 'Dry run — re-run with confirm:true to submit.' });
  }
  const response = await client.request<AscEnvelope<AscResource<{ betaReviewState: string; submittedDate?: string }>>>(
    'POST',
    '/v1/betaAppReviewSubmissions',
    body
  );
  return textResult({ id: response.data.id, ...response.data.attributes });
}

export function registerTestFlightTools(server: McpServer): void {
  server.registerTool(
    'list_builds',
    {
      description: 'List recent builds, sorted by upload date (newest first). Filter by app, processing state, or version.',
      inputSchema: {
        appId: z.string().optional().describe('Filter to builds for a single app ID'),
        limit: z.number().int().min(1).max(1000).optional().describe('Max builds (default 25). With auto_paginate this is the total across pages.'),
        auto_paginate: z.boolean().optional().describe('Follow links.next across pages until the limit is reached (default false).'),
        processingState: z.enum(['PROCESSING', 'FAILED', 'INVALID', 'VALID']).optional().describe('Filter by processing state'),
        version: z.string().optional().describe('Filter by build version (e.g. "42")'),
      },
      annotations: { readOnlyHint: true },
    },
    listBuilds
  );

  server.registerTool(
    'get_build',
    {
      description: 'Get a single build by ID — version, processing state, expiration, encryption flag.',
      inputSchema: { buildId: z.string().describe('Build ID') },
      annotations: { readOnlyHint: true },
    },
    getBuild
  );

  server.registerTool(
    'list_beta_groups',
    {
      description: 'List TestFlight beta groups (internal and external). Filter by app or group type.',
      inputSchema: {
        appId: z.string().optional().describe('Filter to beta groups for a single app ID'),
        limit: z.number().int().min(1).max(1000).optional().describe('Max groups (default 50). With auto_paginate this is the total across pages.'),
        auto_paginate: z.boolean().optional().describe('Follow links.next across pages until the limit is reached (default false).'),
        isInternalGroup: z.boolean().optional().describe('true = internal-only, false = external'),
      },
      annotations: { readOnlyHint: true },
    },
    listBetaGroups
  );

  server.registerTool(
    'list_beta_testers',
    {
      description: 'List TestFlight beta testers. Filter by app, beta group, or email.',
      inputSchema: {
        appId: z.string().optional().describe('Filter to testers with access to a specific app'),
        betaGroupId: z.string().optional().describe('Filter to testers in a specific beta group'),
        email: z.string().optional().describe('Exact email match'),
        limit: z.number().int().min(1).max(1000).optional().describe('Max testers (default 100). With auto_paginate this is the total across pages.'),
        auto_paginate: z.boolean().optional().describe('Follow links.next across pages until the limit is reached (default false).'),
      },
      annotations: { readOnlyHint: true },
    },
    listBetaTesters
  );

  server.registerTool(
    'invite_beta_tester',
    {
      description: 'Invite a new beta tester by email (sends a real email). Optionally adds them to one or more beta groups or specific builds. Without confirm:true this returns a dry-run preview and makes NO network call; with confirm:true it sends the invite.',
      inputSchema: {
        email: z.string().email().describe("Tester's email address"),
        firstName: z.string().optional().describe("Tester's first name"),
        lastName: z.string().optional().describe("Tester's last name"),
        betaGroupIds: z.array(z.string()).optional().describe('Beta group IDs to add the tester to'),
        buildIds: z.array(z.string()).optional().describe('Specific build IDs to grant the tester access to'),
        confirm: schemaConfirm,
      },
      annotations: { destructiveHint: true },
    },
    inviteBetaTester
  );

  server.registerTool(
    'delete_beta_tester',
    {
      description: 'Permanently remove a beta tester from your team. Without confirm:true this returns a dry-run preview and makes NO network call; with confirm:true it deletes.',
      inputSchema: { betaTesterId: z.string().describe('Beta tester ID'), confirm: schemaConfirm },
      annotations: { destructiveHint: true },
    },
    deleteBetaTester
  );

  server.registerTool(
    'add_testers_to_beta_group',
    {
      description: 'Add one or more existing beta testers to a beta group. Without confirm:true this returns a dry-run preview and makes NO network call; with confirm:true it adds them.',
      inputSchema: {
        betaGroupId: z.string().describe('Beta group ID'),
        betaTesterIds: z.array(z.string()).min(1).describe('IDs of beta testers to add'),
        confirm: schemaConfirm,
      },
      annotations: { destructiveHint: true },
    },
    addTestersToBetaGroup
  );

  server.registerTool(
    'remove_testers_from_beta_group',
    {
      description: 'Remove one or more beta testers from a beta group (does not delete the testers). Without confirm:true this returns a dry-run preview and makes NO network call; with confirm:true it removes them.',
      inputSchema: {
        betaGroupId: z.string().describe('Beta group ID'),
        betaTesterIds: z.array(z.string()).min(1).describe('IDs of beta testers to remove'),
        confirm: schemaConfirm,
      },
      annotations: { destructiveHint: true },
    },
    removeTestersFromBetaGroup
  );

  server.registerTool(
    'submit_build_for_beta_review',
    {
      description: 'Submit a build for TestFlight beta app review (required before external testing) — submits to Apple. Without confirm:true this returns a dry-run preview and makes NO network call; with confirm:true it submits.',
      inputSchema: { buildId: z.string().describe('Build ID to submit'), confirm: schemaConfirm },
      annotations: { destructiveHint: true },
    },
    submitBuildForBetaReview
  );
}
