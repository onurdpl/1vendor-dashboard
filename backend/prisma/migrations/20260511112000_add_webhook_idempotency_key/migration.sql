ALTER TABLE "WebhookEvent"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ALTER COLUMN "webhookId" DROP NOT NULL;

ALTER TABLE "WebhookEvent"
  DROP CONSTRAINT IF EXISTS "WebhookEvent_sourceShopDomain_topic_webhookId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_idempotencyKey_key"
  ON "WebhookEvent"("idempotencyKey");
