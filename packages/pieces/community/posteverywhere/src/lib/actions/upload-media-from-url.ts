import { createAction, Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';
import { postEverywhereAuth } from '../auth';
import { postEverywhereApiCall } from '../common/client';

export const uploadMediaFromUrl = createAction({
  auth: postEverywhereAuth,
  name: 'upload_media_from_url',
  classification: 'WRITE',
  displayName: 'Upload Media from URL',
  description:
    'Import an image or MP4 video from a public URL. Returns a media ID to use in Create Post.',
  audience: 'both',
  aiMetadata: {
    description:
      'Downloads a publicly reachable image or MP4 video URL into the PostEverywhere media library and returns its media_id (plus media_status, type and size). Pass the media_id in the Media IDs field of Create Post. Videos may return media_status "uploading" while processing finishes; they can still be attached. The URL must be public http(s) (no localhost or private addresses). Not idempotent: each call imports a new copy.',
    idempotent: false,
  },
  props: {
    url: Property.ShortText({
      displayName: 'File URL',
      description: 'Public http(s) URL of the image or MP4 video.',
      required: true,
    }),
    filename: Property.ShortText({
      displayName: 'File Name',
      description: 'Optional file name to store the media under.',
      required: false,
    }),
  },
  async run(context) {
    const { url, filename } = context.propsValue;
    const body: Record<string, unknown> = { url: url.trim() };
    if (filename && filename.trim()) body['filename'] = filename.trim();

    return await postEverywhereApiCall<Record<string, unknown>>({
      apiKey: context.auth.secret_text,
      method: HttpMethod.POST,
      path: '/media/upload-from-url',
      body,
    });
  },
});
