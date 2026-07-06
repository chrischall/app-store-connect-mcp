import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, schemaConfirm } from '@chrischall/mcp-utils';
import { client, paginate, pageSize, paginateOpts } from '../client.js';
import { AscEnvelope, AscResource, ToolResult } from '../types.js';

interface CustomerReviewAttrs {
  rating: number;
  title: string | null;
  body: string | null;
  reviewerNickname: string | null;
  createdDate: string;
  territory: string;
}

interface ReviewResponseAttrs {
  responseBody: string;
  lastModifiedDate: string;
  state: string;
}

export async function listCustomerReviews(args: { appId: string; limit?: number; rating?: number; territory?: string; sort?: 'createdDate' | '-createdDate' | 'rating' | '-rating'; auto_paginate?: boolean } = { appId: '' }): Promise<ToolResult> {
  if (!args.appId) throw new Error('appId is required');
  const { items, pagination } = await paginate<AscResource<CustomerReviewAttrs>>(
    `/v1/apps/${args.appId}/customerReviews`,
    {
      limit: pageSize(args.limit, 50, args.auto_paginate),
      'filter[rating]': args.rating === undefined ? undefined : String(args.rating),
      'filter[territory]': args.territory,
      sort: args.sort ?? '-createdDate',
    },
    paginateOpts(args, 50)
  );
  const reviews = items.map((r) => ({
    id: r.id,
    rating: r.attributes?.rating,
    title: r.attributes?.title,
    body: r.attributes?.body,
    reviewerNickname: r.attributes?.reviewerNickname,
    createdDate: r.attributes?.createdDate,
    territory: r.attributes?.territory,
  }));
  return textResult({ count: reviews.length, reviews, pagination });
}

export async function getCustomerReview(args: { reviewId: string }): Promise<ToolResult> {
  const response = await client.request<AscEnvelope<AscResource<CustomerReviewAttrs>>>(
    'GET',
    `/v1/customerReviews/${args.reviewId}`,
    undefined,
    { include: 'response' }
  );
  return textResult({ id: response.data.id, ...response.data.attributes, included: response.included });
}

export async function respondToReview(args: { reviewId: string; responseBody: string; confirm?: boolean }): Promise<ToolResult> {
  const body = {
    data: {
      type: 'customerReviewResponses',
      attributes: { responseBody: args.responseBody },
      relationships: { review: { data: { id: args.reviewId, type: 'customerReviews' } } },
    },
  };
  if (args.confirm !== true) {
    return textResult({
      dryRun: true,
      action: 'Post a PUBLIC developer response to a customer review',
      method: 'POST',
      path: '/v1/customerReviewResponses',
      willSend: body,
      note: 'This response is publicly visible on the App Store. Dry run — re-run with confirm:true to post it.',
    });
  }
  const response = await client.request<AscEnvelope<AscResource<ReviewResponseAttrs>>>('POST', '/v1/customerReviewResponses', body);
  return textResult({ id: response.data.id, ...response.data.attributes });
}

export function registerReviewTools(server: McpServer): void {
  server.registerTool(
    'list_customer_reviews',
    {
      description: 'List customer reviews for an app, sorted by date (newest first by default). Filter by rating or territory.',
      inputSchema: {
        appId: z.string().describe('App Store Connect app ID'),
        limit: z.number().int().min(1).max(1000).optional().describe('Max reviews (default 50). With auto_paginate this is the total across pages.'),
        auto_paginate: z.boolean().optional().describe('Follow links.next across pages until the limit is reached (default false).'),
        rating: z.number().int().min(1).max(5).optional().describe('Filter by star rating (1-5)'),
        territory: z.string().optional().describe('Filter by territory code, e.g. USA, GBR, JPN'),
        sort: z.enum(['createdDate', '-createdDate', 'rating', '-rating']).optional().describe('Sort order (prefix - for descending)'),
      },
      annotations: { readOnlyHint: true },
    },
    listCustomerReviews
  );

  server.registerTool(
    'get_customer_review',
    {
      description: 'Get a single customer review with the developer response, if any.',
      inputSchema: { reviewId: z.string().describe('Customer review ID') },
      annotations: { readOnlyHint: true },
    },
    getCustomerReview
  );

  server.registerTool(
    'respond_to_review',
    {
      description:
        'Post or update the PUBLIC developer response to a customer review (visible on the App Store). Without confirm:true this returns a dry-run preview and makes NO network call; with confirm:true it posts the response.',
      inputSchema: {
        reviewId: z.string().describe('Customer review ID to respond to'),
        responseBody: z.string().min(1).max(5970).describe('Response text (max 5970 chars)'),
        confirm: schemaConfirm,
      },
      annotations: { destructiveHint: true },
    },
    respondToReview
  );
}
