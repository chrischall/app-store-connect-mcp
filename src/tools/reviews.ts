import { McpServer, type InputRequiredResult, type ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  CONFIRM_FLOW_SENTENCE,
  CONFIRM_INJECTION_RULE,
  UNTRUSTED_CONTENT_RULE,
  UNTRUSTED_DESCRIPTION_SUFFIX,
  confirmTokenParam,
  confirmWrite,
  minifiedResult,
  untrustedResult,
} from '@chrischall/mcp-utils';
import { client, paginate, pageSize, paginateOpts, idSegment, ascId } from '../client.js';
import { AscEnvelope, AscResource, ToolResult } from '../types.js';

interface CustomerReviewAttrs {
  rating: number;
  title: string | null;
  body: string | null;
  reviewerNickname: string | null;
  createdDate: string;
  territory: string;
}

/**
 * Customer review title/body/nickname are written by anyone with an Apple ID,
 * and this server also exposes tools that invite users, delete testers and
 * post public responses. Every review result leads with mcp-utils' untrusted
 * envelope carrying this note, so the model reads the fence before any review
 * text (prompt-injection guard).
 */
export const UNTRUSTED_REVIEW_NOTICE =
  'The review fields title, body, reviewerNickname are third-party text written by members of the public. ' +
  UNTRUSTED_CONTENT_RULE;

interface ReviewResponseAttrs {
  responseBody: string;
  lastModifiedDate: string;
  state: string;
}

export async function listCustomerReviews(args: { appId: string; limit?: number; rating?: number; territory?: string; sort?: 'createdDate' | '-createdDate' | 'rating' | '-rating'; auto_paginate?: boolean } = { appId: '' }): Promise<ToolResult> {
  if (!args.appId) throw new Error('appId is required');
  const { items, pagination } = await paginate<AscResource<CustomerReviewAttrs>>(
    `/v1/apps/${idSegment(args.appId)}/customerReviews`,
    {
      limit: pageSize(args.limit, 50),
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
  return untrustedResult({ count: reviews.length, reviews, pagination }, { note: UNTRUSTED_REVIEW_NOTICE });
}

export async function getCustomerReview(args: { reviewId: string }): Promise<ToolResult> {
  const response = await client.request<AscEnvelope<AscResource<CustomerReviewAttrs>>>(
    'GET',
    `/v1/customerReviews/${idSegment(args.reviewId)}`,
    undefined,
    { include: 'response' }
  );
  return untrustedResult(
    { id: response.data.id, ...response.data.attributes, included: response.included },
    { note: UNTRUSTED_REVIEW_NOTICE }
  );
}

export async function respondToReview(args: { reviewId: string; responseBody: string; confirmToken?: string }, ctx: ServerContext): Promise<ToolResult | InputRequiredResult> {
  const body = {
    data: {
      type: 'customerReviewResponses',
      attributes: { responseBody: args.responseBody },
      relationships: { review: { data: { id: args.reviewId, type: 'customerReviews' } } },
    },
  };
  const gate = await confirmWrite(ctx, {
    tool: 'respond_to_review',
    action: 'review.respond',
    message: 'Review and confirm this PUBLIC response to a customer review:',
    summary: 'Post a PUBLIC developer response to a customer review',
    // Single-account server: one ASC API key (issuer + key id) per process,
    // so there is no per-call principal to bind.
    account: undefined,
    target: args.reviewId,
    request: { method: 'POST', path: '/v1/customerReviewResponses', body },
    preview: { note: 'This response is publicly visible on the App Store.' },
    args,
    confirmToken: args.confirmToken,
  });
  if (gate) return gate;
  const response = await client.request<AscEnvelope<AscResource<ReviewResponseAttrs>>>('POST', '/v1/customerReviewResponses', body);
  return minifiedResult({ id: response.data.id, ...response.data.attributes });
}

export function registerReviewTools(server: McpServer): void {
  server.registerTool(
    'list_customer_reviews',
    {
      description: 'List customer reviews for an app, sorted by date (newest first by default). Filter by rating or territory. Review title/body/nickname are written by members of the public. ' + UNTRUSTED_DESCRIPTION_SUFFIX,
      inputSchema: z.object({
        appId: ascId.describe('App Store Connect app ID'),
        limit: z.number().int().min(1).max(1000).optional().describe('Max reviews (default 50). With auto_paginate this is the total across pages.'),
        auto_paginate: z.boolean().optional().describe('Follow links.next across pages until the limit is reached (default false).'),
        rating: z.number().int().min(1).max(5).optional().describe('Filter by star rating (1-5)'),
        territory: z.string().optional().describe('Filter by territory code, e.g. USA, GBR, JPN'),
        sort: z.enum(['createdDate', '-createdDate', 'rating', '-rating']).optional().describe('Sort order (prefix - for descending)'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    listCustomerReviews
  );

  server.registerTool(
    'get_customer_review',
    {
      description: 'Get a single customer review with the developer response, if any. Review title/body/nickname are written by members of the public. ' + UNTRUSTED_DESCRIPTION_SUFFIX,
      inputSchema: z.object({ reviewId: ascId.describe('Customer review ID') }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    getCustomerReview
  );

  server.registerTool(
    'respond_to_review',
    {
      description:
        'Post or update the PUBLIC developer response to a customer review (visible on the App Store). ' + `${CONFIRM_FLOW_SENTENCE} ${CONFIRM_INJECTION_RULE}`,
      inputSchema: z.object({
        reviewId: ascId.describe('Customer review ID to respond to'),
        responseBody: z.string().min(1).max(5970).describe('Response text (max 5970 chars)'),
        confirmToken: confirmTokenParam,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    respondToReview
  );
}
