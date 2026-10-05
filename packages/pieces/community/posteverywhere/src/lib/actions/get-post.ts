import { createAction } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';
import { postEverywhereAuth } from '../auth';
import { postEverywhereApiCall } from '../common/client';
import { pathId, postIdProp } from '../common/props';

export const getPost = createAction({
  auth: postEverywhereAuth,
  name: 'get_post',
  classification: 'READ',
  displayName: 'Get Post',
  description: 'Get a post and the status of each account it goes to.',
  audience: 'both',
  aiMetadata: {
    description:
      'Fetches one PostEverywhere post by its post_id (UUID), including its overall post_status (draft, scheduled, publishing, published, partially_failed, failed) and a destinations array with one entry per account: destination_status, published_at, platform_post_id, platform_post_url and the last error. Use it to check whether a post went out and to get its live URLs. Read-only and idempotent.',
    idempotent: true,
  },
  props: {
    post_id: postIdProp,
  },
  async run(context) {
    return await postEverywhereApiCall<Record<string, unknown>>({
      apiKey: context.auth.secret_text,
      method: HttpMethod.GET,
      path: `/posts/${pathId(context.propsValue.post_id, 'Post ID')}`,
    });
  },
});
