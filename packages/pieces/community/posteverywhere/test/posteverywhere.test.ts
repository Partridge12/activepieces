import { createHmac } from 'crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createMockActionContext } from '@activepieces/pieces-framework';
import { httpClient, HttpError, HttpMethod } from '@activepieces/pieces-common';
import { createPost } from '../src/lib/actions/create-post';
import { listPosts } from '../src/lib/actions/list-posts';
import { retryFailedPost } from '../src/lib/actions/retry-failed-post';
import { postPublished } from '../src/lib/triggers/post-published';
import { postFailed } from '../src/lib/triggers/post-failed';
import {
  postEverywhereApiCall,
  PostEverywhereApiError,
} from '../src/lib/common/client';
import { isValidSignature } from '../src/lib/common/webhook';
import { posteverywhere } from '../src';

const API_KEY = 'pe_live_test';
const auth = { type: 'SECRET_TEXT', secret_text: API_KEY };

function mockResponse(data: unknown, status = 200) {
  return vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
    status,
    headers: {},
    body: { data, error: null, meta: { request_id: 'req_1' } },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function actionContext(propsValue: any): any {
  return { ...createMockActionContext({ propsValue }), auth };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('piece definition', () => {
  test('exposes the expected actions and triggers', () => {
    expect(Object.keys(posteverywhere.actions()).sort()).toEqual(
      [
        'create_post',
        'custom_api_call',
        'get_post',
        'list_posts',
        'retry_failed_post',
        'upload_media_from_url',
      ].sort(),
    );
    expect(Object.keys(posteverywhere.triggers()).sort()).toEqual([
      'post_failed',
      'post_published',
    ]);
  });
});

describe('client', () => {
  test('unwraps the data envelope and sends a bearer token', async () => {
    const spy = mockResponse({ user: { id: 1 } });
    const data = await postEverywhereApiCall({
      apiKey: API_KEY,
      method: HttpMethod.GET,
      path: '/me',
    });
    expect(data).toEqual({ user: { id: 1 } });
    const request = spy.mock.calls[0][0];
    expect(request.url).toBe('https://app.posteverywhere.ai/api/v1/me');
    expect(request.authentication).toEqual({
      type: 'BEARER_TOKEN',
      token: API_KEY,
    });
  });

  test('turns an API error into a readable message with code and request ID', async () => {
    vi.spyOn(httpClient, 'sendRequest').mockRejectedValue(
      new HttpError(undefined, {
        status: 400,
        responseBody: {
          data: null,
          error: {
            message: 'scheduled_for must be in the future',
            code: 'validation_error',
          },
          meta: { request_id: 'req_9' },
        },
      }),
    );
    const error = await postEverywhereApiCall({
      apiKey: API_KEY,
      method: HttpMethod.POST,
      path: '/posts',
      body: {},
    }).catch((e) => e);
    expect(error).toBeInstanceOf(PostEverywhereApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe(
      'scheduled_for must be in the future (HTTP 400, code: validation_error, request ID: req_9)',
    );
  });
});

describe('create post', () => {
  test('publishes now to the chosen accounts with media', async () => {
    const spy = mockResponse({ post_id: 'p1', post_status: 'publishing' });
    const result = await createPost.run(
      actionContext({
        content: 'Hello',
        account_ids: [12, '34'],
        media_ids: ['m1', ' '],
        draft: false,
      }),
    );
    expect(result).toEqual({ post_id: 'p1', post_status: 'publishing' });
    const request = spy.mock.calls[0][0];
    expect(request.method).toBe(HttpMethod.POST);
    expect(request.url).toBe('https://app.posteverywhere.ai/api/v1/posts');
    expect(request.body).toEqual({
      content: 'Hello',
      account_ids: [12, 34],
      media_ids: ['m1'],
    });
  });

  test('schedules with a time and timezone', async () => {
    const spy = mockResponse({ post_id: 'p2' });
    await createPost.run(
      actionContext({
        content: 'Later',
        account_ids: [1],
        scheduled_for: '2026-10-01T09:00:00.000Z',
        timezone: 'Europe/London',
      }),
    );
    expect(spy.mock.calls[0][0].body).toEqual({
      content: 'Later',
      account_ids: [1],
      scheduled_for: '2026-10-01T09:00:00.000Z',
      timezone: 'Europe/London',
    });
  });

  test('allows a draft without accounts', async () => {
    const spy = mockResponse({ post_id: 'p3', status: 'draft' });
    await createPost.run(actionContext({ content: 'Idea', draft: true }));
    expect(spy.mock.calls[0][0].body).toEqual({ content: 'Idea', draft: true });
  });

  test('adds a post to the queue', async () => {
    const spy = mockResponse({ post_id: 'p4', status: 'scheduled' });
    await createPost.run(
      actionContext({ content: 'Queued', account_ids: [1], use_queue: true }),
    );
    expect(spy.mock.calls[0][0].body).toEqual({
      content: 'Queued',
      account_ids: [1],
      use_queue: true,
    });
  });

  test('refuses Add to Queue with a scheduled time', async () => {
    const spy = mockResponse({});
    await expect(
      createPost.run(
        actionContext({
          content: 'Hi',
          account_ids: [1],
          use_queue: true,
          scheduled_for: '2030-01-01T00:00:00Z',
        }),
      ),
    ).rejects.toThrow('Add to Queue cannot be used');
    expect(spy).not.toHaveBeenCalled();
  });

  test('refuses a non-draft post without accounts, before calling the API', async () => {
    const spy = mockResponse({});
    await expect(
      createPost.run(actionContext({ content: 'Hi', account_ids: [] })),
    ).rejects.toThrow('Choose at least one account');
    expect(spy).not.toHaveBeenCalled();
  });

  test('refuses a post with no content and no media', async () => {
    const spy = mockResponse({});
    await expect(
      createPost.run(actionContext({ content: '  ', account_ids: [1] })),
    ).rejects.toThrow('Add content or at least one media ID');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('list posts and retry', () => {
  test('joins multi-select filters and clamps the limit', async () => {
    const spy = mockResponse({ posts: [], pagination: { has_more: false } });
    await listPosts.run(
      actionContext({
        status: ['failed', 'partially_failed'],
        platform: ['x'],
        limit: 500,
      }),
    );
    expect(spy.mock.calls[0][0].queryParams).toEqual({
      status: 'failed,partially_failed',
      platform: 'x',
      limit: '100',
      offset: '0',
    });
  });

  test('retries one post by ID', async () => {
    const spy = mockResponse({ retried_count: 1, destinations: [] });
    await retryFailedPost.run(actionContext({ post_id: ' abc/def ' }));
    expect(spy.mock.calls[0][0].url).toBe(
      'https://app.posteverywhere.ai/api/v1/posts/abc%2Fdef/retry',
    );
  });
});

describe('webhook triggers', () => {
  const secret = 'whsec_test';
  const envelope = {
    event: 'post.published',
    event_id: 'e1',
    created_at: '2026-09-30T09:00:00.000Z',
    organization_id: 'o1',
    data: { post_id: 'p1', destination_id: 'd1', platform: 'x' },
  };
  const raw = JSON.stringify(envelope);
  const signature =
    'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

  function triggerContext(store: Record<string, unknown>, payload: unknown) {
    return {
      auth,
      propsValue: {},
      webhookUrl: 'https://cloud.activepieces.com/api/v1/webhooks/flow1',
      payload,
      store: {
        put: async (k: string, v: unknown) => {
          store[k] = v;
          return v;
        },
        get: async (k: string) => store[k] ?? null,
        delete: async (k: string) => {
          delete store[k];
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  test('signature check accepts the right secret and rejects a wrong one', () => {
    expect(
      isValidSignature({
        secret,
        headers: { 'x-posteverywhere-signature': signature },
        rawBody: raw,
        body: envelope,
      }),
    ).toBe(true);
    expect(
      isValidSignature({
        secret,
        headers: { 'X-PostEverywhere-Signature': signature },
        rawBody: undefined,
        body: envelope,
      }),
    ).toBe(true);
    expect(
      isValidSignature({
        secret: 'whsec_other',
        headers: { 'x-posteverywhere-signature': signature },
        rawBody: raw,
        body: envelope,
      }),
    ).toBe(false);
    expect(
      isValidSignature({ secret, headers: {}, rawBody: raw, body: envelope }),
    ).toBe(false);
  });

  test('onEnable registers one event for the flow URL; onDisable deletes it', async () => {
    const store: Record<string, unknown> = {};
    const spy = mockResponse({ id: 'wh_1', secret });
    await postPublished.onEnable(triggerContext(store, undefined));
    const create = spy.mock.calls[0][0];
    expect(create.method).toBe(HttpMethod.POST);
    expect(create.url).toBe('https://app.posteverywhere.ai/api/v1/webhooks');
    expect(create.body).toMatchObject({
      url: 'https://cloud.activepieces.com/api/v1/webhooks/flow1',
      events: ['post.published'],
    });
    expect(store['posteverywhere_webhook_id']).toBe('wh_1');

    await postPublished.onDisable(triggerContext(store, undefined));
    const del = spy.mock.calls[1][0];
    expect(del.method).toBe(HttpMethod.DELETE);
    expect(del.url).toBe('https://app.posteverywhere.ai/api/v1/webhooks/wh_1');
    expect(store['posteverywhere_webhook_id']).toBeUndefined();
  });

  test('onDisable ignores a webhook already deleted in PostEverywhere', async () => {
    const store: Record<string, unknown> = {
      posteverywhere_webhook_id: 'gone',
    };
    vi.spyOn(httpClient, 'sendRequest').mockRejectedValue(
      new HttpError(undefined, {
        status: 404,
        responseBody: { data: null, error: { message: 'Not found' } },
      }),
    );
    await expect(
      postFailed.onDisable(triggerContext(store, undefined)),
    ).resolves.toBeUndefined();
  });

  test('run returns a signed event and drops unsigned or other events', async () => {
    const store = { posteverywhere_webhook_secret: secret };
    const good = {
      body: envelope,
      rawBody: raw,
      headers: { 'x-posteverywhere-signature': signature },
      queryParams: {},
    };
    expect(await postPublished.run(triggerContext(store, good))).toEqual([
      envelope,
    ]);

    const forged = {
      ...good,
      headers: { 'x-posteverywhere-signature': 'sha256=00' },
    };
    expect(await postPublished.run(triggerContext(store, forged))).toEqual([]);

    expect(await postFailed.run(triggerContext(store, good))).toEqual([]);
  });

  test('test() builds events from recent published destinations', async () => {
    mockResponse({
      posts: [
        {
          post_id: 'p1',
          destinations: [
            {
              destination_id: 'd1',
              platform: 'x',
              account_id: 5,
              destination_status: 'done',
              published_at: '2026-09-30T09:00:00Z',
              platform_post_id: '123',
            },
            {
              destination_id: 'd2',
              platform: 'instagram',
              account_id: 6,
              destination_status: 'failed',
              error: 'boom',
            },
          ],
        },
      ],
    });
    const events = await postPublished.test!(triggerContext({}, undefined));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'post.published',
      data: { post_id: 'p1', destination_id: 'd1', platform: 'x' },
    });
  });
});
