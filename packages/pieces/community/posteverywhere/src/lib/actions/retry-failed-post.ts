import { createAction } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';
import { postEverywhereAuth } from '../auth';
import { postEverywhereApiCall } from '../common/client';
import { pathId, postIdProp } from '../common/props';

export const retryFailedPost = createAction({
  auth: postEverywhereAuth,
  name: 'retry_failed_post',
  classification: 'WRITE',
  displayName: 'Retry Failed Post',
  description: 'Retry every failed account of one post.',
  audience: 'both',
  aiMetadata: {
    description:
      'Re-queues every failed destination of one PostEverywhere post (by post_id) for another publish attempt. Destinations that already published are not touched, so a post is never sent twice to the same account. Returns retried_count and the destinations that were re-queued. Fix the cause first (for example reconnect an account) or the retry fails again.',
    idempotent: false,
  },
  props: {
    post_id: postIdProp,
  },
  async run(context) {
    return await postEverywhereApiCall<Record<string, unknown>>({
      apiKey: context.auth.secret_text,
      method: HttpMethod.POST,
      path: `/posts/${pathId(context.propsValue.post_id, 'Post ID')}/retry`,
    });
  },
});
