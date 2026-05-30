import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult } from '@chrischall/mcp-utils';
import { client } from '../client.js';
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

export async function listApps(args: { limit?: number; bundleId?: string; name?: string } = {}): Promise<ToolResult> {
  const response = await client.request<AscEnvelope<AscResource<AppAttrs>[]>>('GET', '/v1/apps', undefined, {
    limit: args.limit ?? 50,
    'filter[bundleId]': args.bundleId,
    'filter[name]': args.name,
  });
  const apps = response.data.map(compactApp);
  return textResult({ count: apps.length, apps });
}

export async function getApp(args: { appId: string }): Promise<ToolResult> {
  const response = await client.request<AscEnvelope<AscResource<AppAttrs>>>('GET', `/v1/apps/${args.appId}`);
  return textResult({ id: response.data.id, ...response.data.attributes });
}

export async function listAppStoreVersions(args: { appId: string; limit?: number; platform?: string; appStoreState?: string }): Promise<ToolResult> {
  const response = await client.request<AscEnvelope<AscResource<AppVersionAttrs>[]>>('GET', `/v1/apps/${args.appId}/appStoreVersions`, undefined, {
    limit: args.limit ?? 25,
    'filter[platform]': args.platform,
    'filter[appStoreState]': args.appStoreState,
  });
  const versions = response.data.map((r) => ({
    id: r.id,
    versionString: r.attributes?.versionString,
    platform: r.attributes?.platform,
    appStoreState: r.attributes?.appStoreState,
    releaseType: r.attributes?.releaseType,
    createdDate: r.attributes?.createdDate,
  }));
  return textResult({ count: versions.length, versions });
}

export async function getAppInfos(args: { appId: string }): Promise<ToolResult> {
  const response = await client.request<AscEnvelope<AscResource<AppInfoAttrs>[]>>('GET', `/v1/apps/${args.appId}/appInfos`);
  const infos = response.data.map((r) => ({ id: r.id, ...r.attributes }));
  return textResult({ count: infos.length, infos });
}

export function registerAppTools(server: McpServer): void {
  server.registerTool(
    'list_apps',
    {
      description: 'List apps in your App Store Connect account. Supports optional filters by bundleId and name.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('Maximum number of apps to return (default 50, max 200)'),
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
        limit: z.number().int().min(1).max(200).optional().describe('Max versions to return (default 25)'),
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
