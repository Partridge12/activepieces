import { createAction, Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';
import { postEverywhereAuth } from '../auth';
import { postEverywhereApiCall } from '../common/client';
import { PLATFORMS, POST_STATUSES } from '../common/props';

type ListPostsResponse = {
  posts: Record<string, unknown>[];
  pagination?: {
    total?: number;
    limit?: number;
    offset?: number;
    has_more?: boolean;
  };
};

export const listPosts = createAction({
  auth: postEverywhereAuth,
  name: 'list_posts',
  classification: 'READ',
  displayName: 'List Posts',
  description: 'List posts, newest first, with optional filters.',
  audience: 'both',
  aiMetadata: {
    description:
      'Lists PostEverywhere posts in the workspace, newest first by creation time, with optional filters for status (draft, scheduled, publishing, published, partially_failed, failed), platform, a single account ID and a case-insensitive text search on content. Returns up to Limit posts (max 100) with their destinations, plus pagination (total, has_more). Use Offset to page. Read-only and idempotent.',
    idempotent: true,
  },
  props: {
    status: Property.StaticMultiSelectDropdown({
      displayName: 'Status',
      description:
        'Only return posts with these statuses. Leave empty for all.',
      required: false,
      options: { disabled: false, options: POST_STATUSES },
    }),
    platform: Property.StaticMultiSelectDropdown({
      displayName: 'Platform',
      description:
        'Only return posts that go to these platforms. Leave empty for all.',
      required: false,
      options: { disabled: false, options: PLATFORMS },
    }),
    account_id: Property.Number({
      displayName: 'Account ID',
      description: 'Only return posts that go to this account (integer ID).',
      required: false,
    }),
    search: Property.ShortText({
      displayName: 'Search',
      description: 'Only return posts whose content contains this text.',
      required: false,
    }),
    limit: Property.Number({
      displayName: 'Limit',
      description: 'How many posts to return (1 to 100).',
      required: false,
      defaultValue: 20,
    }),
    offset: Property.Number({
      displayName: 'Offset',
      description: 'How many posts to skip, for paging.',
      required: false,
      defaultValue: 0,
    }),
  },
  async run(context) {
    const { status, platform, account_id, search, limit, offset } =
      context.propsValue;
    const safeLimit = Math.min(Math.max(Math.trunc(limit ?? 20), 1), 100);
    const safeOffset = Math.max(Math.trunc(offset ?? 0), 0);

    return await postEverywhereApiCall<ListPostsResponse>({
      apiKey: context.auth.secret_text,
      method: HttpMethod.GET,
      path: '/posts',
      query: {
        status: status && status.length > 0 ? status.join(',') : undefined,
        platform:
          platform && platform.length > 0 ? platform.join(',') : undefined,
        account_id: account_id ?? undefined,
        search: search?.trim() || undefined,
        limit: safeLimit,
        offset: safeOffset,
      },
    });
  },
});
