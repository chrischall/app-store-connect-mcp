import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult } from '@chrischall/mcp-utils';
import { client } from '../client.js';
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

export async function listCustomerReviews(args: { appId: string; limit?: number; rating?: number; territory?: string; sort?: 'createdDate' | '-createdDate' | 'rating' | '-rating' } = { appId: '' }): Promise<ToolResult> {
  if (!args.appId) throw new Error('appId is required');
  const response = await client.request<AscEnvelope<AscResource<CustomerReviewAttrs>[]>>(
    'GET',
    `/v1/apps/${args.appId}/customerReviews`,
    undefined,
    {
      limit: args.limit ?? 50,
      'filter[rating]': args.rating === undefined ? undefined : String(args.rating),
      'filter[territory]': args.territory,
      sort: args.sort ?? '-createdDate',
    }
  );
  const reviews = response.data.map((r) => ({
    id: r.id,
    rating: r.attributes?.rating,
    title: r.attributes?.title,
    body: r.attributes?.body,
    reviewerNickname: r.attributes?.reviewerNickname,
    createdDate: r.attributes?.createdDate,
    territory: r.attributes?.territory,
  }));
  return textResult({ count: reviews.length, reviews });
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

export async function respondToReview(args: { reviewId: string; responseBody: string }): Promise<ToolResult> {
  const body = {
    data: {
      type: 'customerReviewResponses',
      attributes: { responseBody: args.responseBody },
      relationships: { review: { data: { id: args.reviewId, type: 'customerReviews' } } },
    },
  };
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
        limit: z.number().int().min(1).max(200).optional().describe('Max reviews (default 50)'),
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
      description: "Post or update the developer response to a customer review.",
      inputSchema: {
        reviewId: z.string().describe('Customer review ID to respond to'),
        responseBody: z.string().min(1).max(5970).describe('Response text (max 5970 chars)'),
      },
      annotations: { destructiveHint: false },
    },
    respondToReview
  );
}
