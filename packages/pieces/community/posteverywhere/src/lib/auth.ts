import { PieceAuth } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';
import { postEverywhereApiCall, PostEverywhereApiError } from './common/client';

export const postEverywhereAuth = PieceAuth.SecretText({
  displayName: 'API Key',
  description: `To get your API key:
1. Sign in to [PostEverywhere](https://app.posteverywhere.ai).
2. Go to **Settings → Developers**.
3. Create a new API key with the **read** and **write** scopes (the default).
4. Copy the key (it starts with \`pe_live_\`) and paste it here.`,
  required: true,
  validate: async ({ auth }) => {
    try {
      await postEverywhereApiCall({
        apiKey: auth,
        method: HttpMethod.GET,
        path: '/me',
      });
      return { valid: true };
    } catch (e) {
      if (e instanceof PostEverywhereApiError && e.status === 401) {
        return {
          valid: false,
          error:
            'Invalid API key. Check that you copied the full pe_live_ key.',
        };
      }
      return {
        valid: false,
        error: `Could not validate the API key: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  },
});
