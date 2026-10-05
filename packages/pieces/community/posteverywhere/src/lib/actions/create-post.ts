import { createAction, Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';
import { postEverywhereAuth } from '../auth';
import { postEverywhereApiCall } from '../common/client';
import { accountsDropdown } from '../common/props';

export const createPost = createAction({
  auth: postEverywhereAuth,
  name: 'create_post',
  classification: 'WRITE',
  displayName: 'Create Post',
  description:
    'Publish now, schedule for later, or save a draft on one or more connected accounts.',
  audience: 'both',
  aiMetadata: {
    description:
      'Creates one PostEverywhere post that goes out to one or more connected social accounts (Instagram, Facebook, X, LinkedIn, YouTube, TikTok, Threads, Pinterest, Bluesky, Telegram, Discord, WordPress). Leave Scheduled For empty to publish immediately, set it to a future ISO 8601 time to schedule, set Add to Queue to use the next free queue slot, or set Save as Draft to keep it unpublished. Account IDs are integers from the accounts list. To attach images or videos, first call Upload Media from URL and pass the returned media_id values in Media IDs. Returns the post with post_id, post_status and one destination per account. Not idempotent: each call creates a new post.',
    idempotent: false,
  },
  props: {
    content: Property.LongText({
      displayName: 'Content',
      description:
        'The text of the post. Required unless you attach media. Up to 25,000 characters; each platform applies its own limit.',
      required: false,
    }),
    account_ids: accountsDropdown,
    scheduled_for: Property.DateTime({
      displayName: 'Scheduled For',
      description:
        'When to publish. Leave empty to publish now. Must be in the future. A time with no offset is read as UTC.',
      required: false,
    }),
    timezone: Property.ShortText({
      displayName: 'Timezone',
      description:
        'IANA timezone shown with the post in PostEverywhere, for example "Europe/London". Display only: it does not change when the post is published.',
      required: false,
    }),
    media_ids: Property.Array({
      displayName: 'Media IDs',
      description:
        'IDs of media uploaded to PostEverywhere (use the Upload Media from URL action to get them).',
      required: false,
    }),
    use_queue: Property.Checkbox({
      displayName: 'Add to Queue',
      description:
        'Publish in the next free slot of your PostEverywhere posting queue. Leave Scheduled For empty when you use this.',
      required: false,
      defaultValue: false,
    }),
    draft: Property.Checkbox({
      displayName: 'Save as Draft',
      description:
        'Save the post as a draft instead of publishing or scheduling it. Drafts can be saved without accounts.',
      required: false,
      defaultValue: false,
    }),
  },
  async run(context) {
    const { content, scheduled_for, timezone, draft, use_queue } =
      context.propsValue;
    const accountIds = ((context.propsValue.account_ids ?? []) as unknown[])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id));
    const mediaIds = ((context.propsValue.media_ids ?? []) as unknown[])
      .map((id) => String(id ?? '').trim())
      .filter((id) => id.length > 0);
    const text = (content ?? '').trim();

    if (!draft && accountIds.length === 0) {
      throw new Error(
        'Choose at least one account. Only drafts can be saved without accounts.',
      );
    }
    if (use_queue && (draft || scheduled_for)) {
      throw new Error(
        'Add to Queue cannot be used with Scheduled For or Save as Draft. Clear one of them.',
      );
    }
    if (!text && mediaIds.length === 0) {
      throw new Error('Add content or at least one media ID.');
    }

    const body: Record<string, unknown> = {};
    if (text) body['content'] = content;
    if (accountIds.length > 0) body['account_ids'] = accountIds;
    if (scheduled_for) body['scheduled_for'] = scheduled_for;
    if (timezone && timezone.trim()) body['timezone'] = timezone.trim();
    if (mediaIds.length > 0) body['media_ids'] = mediaIds;
    if (draft) body['draft'] = true;
    if (use_queue) body['use_queue'] = true;

    return await postEverywhereApiCall<Record<string, unknown>>({
      apiKey: context.auth.secret_text,
      method: HttpMethod.POST,
      path: '/posts',
      body,
    });
  },
});
