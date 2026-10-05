import { Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';
import { postEverywhereAuth } from '../auth';
import { postEverywhereApiCall } from './client';

type SocialAccount = {
  id: number;
  platform: string;
  account_name: string;
  is_active: boolean;
  health?: {
    status?: string;
    can_post?: boolean;
    needs_reconnection?: boolean;
  };
};

export const accountsDropdown = Property.MultiSelectDropdown({
  auth: postEverywhereAuth,
  displayName: 'Accounts',
  description:
    'The connected social accounts to post to. Connect accounts in PostEverywhere first.',
  refreshers: [],
  required: false,
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Connect your PostEverywhere account first.',
      };
    }
    const data = await postEverywhereApiCall<{ accounts: SocialAccount[] }>({
      apiKey: auth.secret_text,
      method: HttpMethod.GET,
      path: '/accounts',
    });
    const accounts = data.accounts ?? [];
    if (accounts.length === 0) {
      return {
        disabled: true,
        options: [],
        placeholder:
          'No accounts found. Connect a social account in PostEverywhere first.',
      };
    }
    return {
      disabled: false,
      options: accounts.map((account) => ({
        label: `${account.account_name} (${account.platform})${
          account.health?.needs_reconnection ? ' - needs reconnection' : ''
        }`,
        value: account.id,
      })),
    };
  },
});

export const postIdProp = Property.ShortText({
  displayName: 'Post ID',
  description:
    'The post ID (a UUID), as returned by Create Post or List Posts.',
  required: true,
});

export const POST_STATUSES = [
  { label: 'Draft', value: 'draft' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Publishing', value: 'publishing' },
  { label: 'Published', value: 'published' },
  { label: 'Partially failed', value: 'partially_failed' },
  { label: 'Failed', value: 'failed' },
];

export const PLATFORMS = [
  { label: 'Instagram', value: 'instagram' },
  { label: 'Facebook', value: 'facebook' },
  { label: 'X (Twitter)', value: 'x' },
  { label: 'LinkedIn', value: 'linkedin' },
  { label: 'YouTube', value: 'youtube' },
  { label: 'TikTok', value: 'tiktok' },
  { label: 'Threads', value: 'threads' },
  { label: 'Pinterest', value: 'pinterest' },
  { label: 'Bluesky', value: 'bluesky' },
  { label: 'Telegram', value: 'telegram' },
  { label: 'Discord', value: 'discord' },
  { label: 'WordPress', value: 'wordpress' },
];

/** Encodes a user-supplied ID for use in a URL path. */
export function pathId(value: unknown, name: string): string {
  const v = String(value ?? '').trim();
  if (!v) {
    throw new Error(`${name} is required.`);
  }
  return encodeURIComponent(v);
}
