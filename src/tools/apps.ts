import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { minifiedResult } from '@chrischall/mcp-utils';
import { client, paginate, pageSize, paginateOpts } from '../client.js';
import { AscEnvelope, AscResource, ToolResult } from '../types.js';

interface AppAttrs {
  name: string;
  bundleId: string;
  sku: string;
  primaryLocale: string;
  isOrEverWasMadeForKids?: boolean;
  contentRightsDeclaration?: string | null;
}

interface AppVersionAttrs {
  versionString: string;
  appStoreState: string;
  platform: string;
  releaseType: string;
  createdDate: string;
}

interface AppInfoAttrs {
  appStoreState: string;
  appStoreAgeRating?: string;
  brazilAgeRating?: string;
}

function compactApp(r: AscResource<AppAttrs>) {
  return {
    id: r.id,
    name: r.attributes?.name,
    bundleId: r.attributes?.bundleId,
    sku: r.attributes?.sku,
    primaryLocale: r.attributes?.primaryLocale,
  };
}

export async function listApps(args: { limit?: number; bundleId?: string; name?: string; auto_paginate?: boolean } = {}): Promise<ToolResult> {
  const { items, pagination } = await paginate<AscResource<AppAttrs>>(
    '/v1/apps',
    {
      limit: pageSize(args.limit, 50, args.auto_paginate),
      'filter[bundleId]': args.bundleId,
      'filter[name]': args.name,
    },
    paginateOpts(args, 50)
  );
  const apps = items.map(compactApp);
  return minifiedResult({ count: apps.length, apps, pagination });
}

export async function getApp(args: { appId: string }): Promise<ToolResult> {
  const response = await client.request<AscEnvelope<AscResource<AppAttrs>>>('GET', `/v1/apps/${args.appId}`);
  return minifiedResult({ id: response.data.id, ...response.data.attributes });
}

export async function listAppStoreVersions(args: { appId: string; limit?: number; platform?: string; appStoreState?: string; auto_paginate?: boolean }): Promise<ToolResult> {
  const { items, pagination } = await paginate<AscResource<AppVersionAttrs>>(
    `/v1/apps/${args.appId}/appStoreVersions`,
    {
      limit: pageSize(args.limit, 25, args.auto_paginate),
      'filter[platform]': args.platform,
      'filter[appStoreState]': args.appStoreState,
    },
    paginateOpts({ limit: args.limit, auto_paginate: args.auto_paginate }, 25)
  );
  const versions = items.map((r) => ({
    id: r.id,
    versionString: r.attributes?.versionString,
    platform: r.attributes?.platform,
    appStoreState: r.attributes?.appStoreState,
    releaseType: r.attributes?.releaseType,
    createdDate: r.attributes?.createdDate,
  }));
  return minifiedResult({ count: versions.length, versions, pagination });
}

export async function getAppInfos(args: { appId: string }): Promise<ToolResult> {
  const response = await client.request<AscEnvelope<AscResource<AppInfoAttrs>[]>>('GET', `/v1/apps/${args.appId}/appInfos`);
  const infos = response.data.map((r) => ({ id: r.id, ...r.attributes }));
  return minifiedResult({ count: infos.length, infos });
}

export function registerAppTools(server: McpServer): void {
  server.registerTool(
    'list_apps',
    {
      description: 'List apps in your App Store Connect account. Supports optional filters by bundleId and name.',
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional().describe('Max apps to return (default 50). Without auto_paginate this is capped at one API page (200); with auto_paginate it is the total across pages.'),
        auto_paginate: z.boolean().optional().describe('Follow links.next across pages until the limit is reached (default false). Check the pagination block in the result for has_more.'),
        bundleId: z.string().optional().describe('Exact bundle ID filter (e.g. com.example.MyApp)'),
        name: z.string().optional().describe('Exact app name filter'),
      },
      annotations: { readOnlyHint: true },
    },
    listApps
  );

  server.registerTool(
    'get_app',
    {
      description: 'Get details for a single app by App Store Connect app ID.',
      inputSchema: {
        appId: z.string().describe('App Store Connect app ID (numeric, from list_apps)'),
      },
      annotations: { readOnlyHint: true },
    },
    getApp
  );

  server.registerTool(
    'list_app_store_versions',
    {
      description: 'List App Store versions (releases) for an app, including state and platform.',
      inputSchema: {
        appId: z.string().describe('App Store Connect app ID'),
        limit: z.number().int().min(1).max(1000).optional().describe('Max versions to return (default 25). With auto_paginate this is the total across pages.'),
        auto_paginate: z.boolean().optional().describe('Follow links.next across pages until the limit is reached (default false).'),
        platform: z.enum(['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS']).optional().describe('Filter by platform'),
        appStoreState: z.string().optional().describe('Filter by state, e.g. READY_FOR_SALE, IN_REVIEW, REJECTED'),
      },
      annotations: { readOnlyHint: true },
    },
    listAppStoreVersions
  );

  server.registerTool(
    'get_app_infos',
    {
      description: 'List App Info records for an app — includes age rating and current store state.',
      inputSchema: {
        appId: z.string().describe('App Store Connect app ID'),
      },
      annotations: { readOnlyHint: true },
    },
    getAppInfos
  );
}
