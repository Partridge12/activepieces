import { createTrigger, TriggerStrategy } from '@activepieces/pieces-framework';
import { postEverywhereAuth } from '../auth';
import {
  deleteWebhook,
  isValidSignature,
  PostEverywhereWebhookEvent,
  recentEventsForTest,
  registerWebhook,
  WEBHOOK_ID_KEY,
  WEBHOOK_SECRET_KEY,
  WebhookEnvelope,
} from '../common/webhook';

/**
 * Builds a webhook trigger for one PostEverywhere event. On enable it
 * registers a webhook for the flow's URL; on disable it deletes it.
 */
export function createPostEventTrigger({
  name,
  event,
  displayName,
  description,
  aiDescription,
  sampleData,
}: {
  name: string;
  event: PostEverywhereWebhookEvent;
  displayName: string;
  description: string;
  aiDescription: string;
  sampleData: WebhookEnvelope;
}) {
  return createTrigger({
    auth: postEverywhereAuth,
    name,
    classification: 'READ',
    displayName,
    description,
    aiMetadata: { description: aiDescription },
    type: TriggerStrategy.WEBHOOK,
    props: {},
    sampleData,
    async onEnable(context) {
      const webhook = await registerWebhook({
        apiKey: context.auth.secret_text,
        url: context.webhookUrl,
        event,
        name: `Activepieces: ${displayName}`,
      });
      await context.store.put(WEBHOOK_ID_KEY, webhook.id);
      await context.store.put(WEBHOOK_SECRET_KEY, webhook.secret);
    },
    async onDisable(context) {
      const webhookId = await context.store.get<string>(WEBHOOK_ID_KEY);
      if (webhookId) {
        await deleteWebhook({
          apiKey: context.auth.secret_text,
          webhookId,
        });
      }
      await context.store.delete(WEBHOOK_ID_KEY);
      await context.store.delete(WEBHOOK_SECRET_KEY);
    },
    async test(context) {
      return await recentEventsForTest({
        apiKey: context.auth.secret_text,
        event,
      });
    },
    async run(context) {
      const secret = await context.store.get<string>(WEBHOOK_SECRET_KEY);
      if (
        secret &&
        !isValidSignature({
          secret,
          headers: context.payload.headers,
          rawBody: context.payload.rawBody,
          body: context.payload.body,
        })
      ) {
        // Not signed by PostEverywhere with this flow's secret: ignore it.
        return [];
      }
      const body = context.payload.body as Partial<WebhookEnvelope> | undefined;
      if (!body || body.event !== event) {
        return [];
      }
      return [body];
    },
  });
}
