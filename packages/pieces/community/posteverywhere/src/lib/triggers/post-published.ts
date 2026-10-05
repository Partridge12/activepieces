import { createPostEventTrigger } from './post-event-trigger';

export const postPublished = createPostEventTrigger({
  name: 'post_published',
  event: 'post.published',
  displayName: 'Post Published',
  description: 'Triggers when a post is published to an account.',
  aiDescription:
    'Fires once per account each time a PostEverywhere post is successfully published to that account (a post sent to three accounts fires three times). The payload carries post_id, destination_id, platform, account_id, account_name, published_at and platform_post_id. Use it to log, notify or follow up on content that went live. Registers a PostEverywhere webhook while the flow is on and deletes it when the flow is turned off.',
  sampleData: {
    event: 'post.published',
    event_id: '6c1f5a2e-2b1d-4c8e-9a51-3f0f1d2c7b10',
    created_at: '2026-09-30T09:00:05.000Z',
    organization_id: '0b8e7c6d-5a4f-4e3d-9c2b-1a0f9e8d7c6b',
    workspace_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    workspace_external_id: null,
    data: {
      post_id: '9f2c1a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      destination_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      platform: 'linkedin',
      account_id: 2280,
      account_name: 'Acme Co',
      published_at: '2026-09-30T09:00:03.000Z',
      platform_post_id: 'urn:li:share:7100000000000000000',
    },
  },
});
