import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { client } from '../src/client.js';
import { listCustomerReviews, getCustomerReview, respondToReview } from '../src/tools/reviews.js';

describe('reviews tools', () => {
  let reqSpy: ReturnType<typeof vi.spyOn<typeof client, 'request'>>;

  beforeEach(() => {
    reqSpy = vi.spyOn(client, 'request');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listCustomerReviews: requires appId', async () => {
    await expect(listCustomerReviews({ appId: '' })).rejects.toThrow('appId is required');
  });

  it('listCustomerReviews: GET /v1/apps/{id}/customerReviews with default sort', async () => {
    reqSpy.mockResolvedValueOnce({
      data: [
        {
          type: 'customerReviews',
          id: 'r1',
          attributes: { rating: 5, title: 'Great', body: 'Love it', reviewerNickname: 'Jane', createdDate: '2025-09-01', territory: 'USA' },
        },
      ],
    } as never);
    const result = await listCustomerReviews({ appId: '999', rating: 5, territory: 'USA' });
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/apps/999/customerReviews', undefined, {
      limit: 50,
      'filter[rating]': '5',
      'filter[territory]': 'USA',
      sort: '-createdDate',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.reviews[0].rating).toBe(5);
  });

  it('getCustomerReview: include=response', async () => {
    reqSpy.mockResolvedValueOnce({
      data: { type: 'customerReviews', id: 'r9', attributes: { rating: 4, title: 't', body: 'b', reviewerNickname: 'n', createdDate: 'd', territory: 'USA' } },
      included: [],
    } as never);
    await getCustomerReview({ reviewId: 'r9' });
    expect(reqSpy).toHaveBeenCalledWith('GET', '/v1/customerReviews/r9', undefined, { include: 'response' });
  });

  it('respondToReview: POST /v1/customerReviewResponses with relationship', async () => {
    reqSpy.mockResolvedValueOnce({
      data: { type: 'customerReviewResponses', id: 'resp1', attributes: { responseBody: 'Thanks!', state: 'PUBLISHED', lastModifiedDate: '2025-10-10' } },
    } as never);
    await respondToReview({ reviewId: 'r9', responseBody: 'Thanks!', confirm: true });
    expect(reqSpy).toHaveBeenCalledWith('POST', '/v1/customerReviewResponses', {
      data: {
        type: 'customerReviewResponses',
        attributes: { responseBody: 'Thanks!' },
        relationships: { review: { data: { id: 'r9', type: 'customerReviews' } } },
      },
    });
  });

  it('respondToReview: without confirm returns a dry-run preview and makes NO network call', async () => {
    const result = await respondToReview({ reviewId: 'r9', responseBody: 'Thanks!' });
    expect(reqSpy).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.willSend.data.attributes.responseBody).toBe('Thanks!');
  });
});
