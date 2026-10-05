import { createPiece, PieceCategory } from '@activepieces/pieces-framework';
import { createCustomApiCallAction } from '@activepieces/pieces-common';
import { postEverywhereAuth } from './lib/auth';
import { POSTEVERYWHERE_API_URL } from './lib/common/client';
import { createPost } from './lib/actions/create-post';
import { uploadMediaFromUrl } from './lib/actions/upload-media-from-url';
import { getPost } from './lib/actions/get-post';
import { listPosts } from './lib/actions/list-posts';
import { retryFailedPost } from './lib/actions/retry-failed-post';
import { postPublished } from './lib/triggers/post-published';
import { postFailed } from './lib/triggers/post-failed';

export const posteverywhere = createPiece({
  displayName: 'PostEverywhere',
  description:
    'Schedule and publish posts to Instagram, Facebook, X, LinkedIn, YouTube, TikTok, Threads, Pinterest, Bluesky, Telegram, Discord and WordPress from one place.',
  auth: postEverywhereAuth,
  minimumSupportedRelease: '0.82.0',
  logoUrl: 'https://posteverywhere.ai/icon-512.png',
  authors: ['posteverywhere'],
  categories: [PieceCategory.MARKETING],
  actions: [
    createPost,
    uploadMediaFromUrl,
    getPost,
    listPosts,
    retryFailedPost,
    createCustomApiCallAction({
      auth: postEverywhereAuth,
      baseUrl: () => POSTEVERYWHERE_API_URL,
      authMapping: async (auth) => ({
        Authorization: `Bearer ${auth.secret_text}`,
      }),
    }),
  ],
  triggers: [postPublished, postFailed],
});

export { postEverywhereAuth } from './lib/auth';
