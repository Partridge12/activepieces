import { createHmac, timingSafeEqual } from 'crypto';
import { HttpMethod } from '@activepieces/pieces-common';
import { postEverywhereApiCall, PostEverywhereApiError } from './client';

export const WEBHOOK_ID_KEY = 'posteverywhere_webhook_id';
export const WEBHOOK_SECRET_KEY = 'posteverywhere_webhook_secret';

export type PostEverywhereWebhookEvent = 'post.published' | 'post.failed';

/** Body PostEverywhere POSTs to the webhook URL. */
export type WebhookEnvelope = {
  event: string;
  event_id: string;
  created_at: string;
  organization_id: string | null;
  workspace_id?: string | null;
  workspace_external_id?: string | null;
  data: Record<string, unknown>;
};

export async function registerWebhook({
  apiKey,
  url,
  event,
  name,
}: {
  apiKey: string;
  url: string;
  event: PostEverywhereWebhookEvent;
  name: string;
}): Promise<{ id: string; secret: string }> {
  return await postEverywhereApiCall<{ id: string; secret: string }>({
    apiKey,
    method: HttpMethod.POST,
    path: '/webhooks',
    body: {
      url,
      events: [event],
      name,
      description:
        'Created by an Activepieces flow. Deleted when the flow is turned off.',
    },
  });
}

export async function deleteWebhook({
  apiKey,
  webhookId,
}: {
  apiKey: string;
  webhookId: string;
}): Promise<void> {
  try {
    await postEverywhereApiCall({
      apiKey,
      method: HttpMethod.DELETE,
      path: `/webhooks/${encodeURIComponent(webhookId)}`,
    });
  } catch (e) {
    // Already deleted in the dashboard: nothing left to clean up.
    if (e instanceof PostEverywhereApiError && e.status === 404) {
      return;
    }
    throw e;
  }
}

function header(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  return key ? headers[key] : undefined;
}

/**
 * PostEverywhere signs each delivery with
 * `X-PostEverywhere-Signature: sha256=<hex HMAC-SHA256(raw body, secret)>`.
 * When the raw body is not available, the parsed body is serialised again.
 * PostEverywhere sends compact JSON.stringify output, so that gives the same bytes.
 */
export function isValidSignature({
  secret,
  headers,
  rawBody,
  body,
}: {
  secret: string;
  headers: Record<string, string> | undefined;
  rawBody: unknown;
  body: unknown;
}): boolean {
  const signature = header(headers, 'x-posteverywhere-signature');
  if (!signature) return false;
  const payload =
    typeof rawBody === 'string'
      ? rawBody
      : Buffer.isBuffer(rawBody)
        ? rawBody.toString('utf8')
        : JSON.stringify(body);
  const expected =
    'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

type ListedPost = {
  post_id: string;
  content?: string | null;
  destinations?: {
    destination_id: string;
    account_id?: number | null;
    account_name?: string | null;
    platform?: string;
    destination_status?: string;
    published_at?: string | null;
    platform_post_id?: string | null;
    platform_post_url?: string | null;
    error?: unknown;
  }[];
};

/**
 * Builds test events from real recent posts, in the same shape a live
 * delivery has, so users can map fields before the first real event.
 */
export async function recentEventsForTest({
  apiKey,
  event,
}: {
  apiKey: string;
  event: PostEverywhereWebhookEvent;
}): Promise<WebhookEnvelope[]> {
  const published = event === 'post.published';
  const data = await postEverywhereApiCall<{ posts: ListedPost[] }>({
    apiKey,
    method: HttpMethod.GET,
    path: '/posts',
    query: {
      status: published
        ? 'published,partially_failed'
        : 'failed,partially_failed',
      sort: published ? 'published_at' : 'updated_at',
      order: 'desc',
      limit: 10,
    },
  });

  const events: WebhookEnvelope[] = [];
  for (const post of data.posts ?? []) {
    for (const d of post.destinations ?? []) {
      const matches = published
        ? d.destination_status === 'done'
        : d.destination_status === 'failed';
      if (!matches) continue;
      events.push({
        event,
        event_id: `test-${d.destination_id}`,
        created_at: new Date().toISOString(),
        organization_id: null,
        data: published
          ? {
              post_id: post.post_id,
              destination_id: d.destination_id,
              platform: d.platform ?? null,
              account_id: d.account_id ?? null,
              account_name: d.account_name ?? null,
              published_at: d.published_at ?? null,
              platform_post_id: d.platform_post_id ?? null,
            }
          : {
              post_id: post.post_id,
              destination_id: d.destination_id,
              platform: d.platform ?? null,
              account_id: d.account_id ?? null,
              account_name: d.account_name ?? null,
              error: d.error ?? null,
            },
      });
      if (events.length >= 5) return events;
    }
  }
  return events;
}
