import { createPostEventTrigger } from './post-event-trigger';

export const postFailed = createPostEventTrigger({
  name: 'post_failed',
  event: 'post.failed',
  displayName: 'Post Failed',
  description:
    'Triggers when a post fails on an account after all automatic retries.',
  aiDescription:
    'Fires once per account when a PostEverywhere post fails to publish to that account for good (after automatic retries are used up, or on a permanent error such as a disconnected account). The payload carries post_id, destination_id, platform, account_id, account_name and error. Use it to alert someone or to call Retry Failed Post after fixing the cause. Registers a PostEverywhere webhook while the flow is on and deletes it when the flow is turned off.',
  sampleData: {
    event: 'post.failed',
    event_id: '7d2a6b3f-3c2e-4d9f-8b62-4a1e2d3c8c21',
    created_at: '2026-09-30T09:00:05.000Z',
    organization_id: '0b8e7c6d-5a4f-4e3d-9c2b-1a0f9e8d7c6b',
    workspace_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    workspace_external_id: null,
    data: {
      post_id: '9f2c1a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      destination_id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
      platform: 'instagram',
      account_id: 2281,
      account_name: 'acme.co',
      error: 'The Instagram account needs to be reconnected.',
    },
  },
});
