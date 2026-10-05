import {
  AuthenticationType,
  httpClient,
  HttpError,
  HttpMethod,
  QueryParams,
} from '@activepieces/pieces-common';

export const POSTEVERYWHERE_API_URL = 'https://app.posteverywhere.ai/api/v1';

/**
 * Every PostEverywhere v1 response uses the envelope `{ data, error, meta }`.
 * `error` is null on success and `{ message, code }` on failure.
 */
export type PostEverywhereEnvelope<T> = {
  data: T;
  error: { message?: string; code?: string } | null;
  meta?: { request_id?: string; timestamp?: string };
};

export async function postEverywhereApiCall<T>({
  apiKey,
  method,
  path,
  query,
  body,
}: {
  apiKey: string;
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}): Promise<T> {
  const queryParams: QueryParams = {};
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        queryParams[key] = String(value);
      }
    }
  }

  try {
    const response = await httpClient.sendRequest<PostEverywhereEnvelope<T>>({
      method,
      url: `${POSTEVERYWHERE_API_URL}${path}`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: apiKey,
      },
      headers: { Accept: 'application/json' },
      queryParams,
      body,
    });
    return unwrapEnvelope<T>(response.body);
  } catch (e) {
    throw toReadableError(e);
  }
}

export function unwrapEnvelope<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as PostEverywhereEnvelope<T>).data;
  }
  return body as T;
}

/** Error thrown for a non-2xx API response. */
export class PostEverywhereApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'PostEverywhereApiError';
  }
}

/**
 * Turns an HttpError into an Error whose message is the API's own message,
 * plus the error code and request ID so support can trace it.
 */
export function toReadableError(e: unknown): Error {
  if (!(e instanceof HttpError)) {
    return e instanceof Error ? e : new Error(String(e));
  }
  const status = e.response.status;
  let body: unknown = e.response.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // Not JSON (for example a proxy error page).
    }
  }
  const envelope = (body && typeof body === 'object' ? body : {}) as Partial<
    PostEverywhereEnvelope<unknown>
  >;
  const message =
    envelope.error?.message ?? `PostEverywhere API returned HTTP ${status}`;
  const details = [
    `HTTP ${status}`,
    envelope.error?.code ? `code: ${envelope.error.code}` : undefined,
    envelope.meta?.request_id
      ? `request ID: ${envelope.meta.request_id}`
      : undefined,
  ].filter(Boolean);
  return new PostEverywhereApiError(
    `${message} (${details.join(', ')})`,
    status,
    envelope.error?.code,
  );
}
