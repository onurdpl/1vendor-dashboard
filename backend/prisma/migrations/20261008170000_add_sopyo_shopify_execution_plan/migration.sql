ALTER TYPE "SopyoShipmentIntentStatus" ADD VALUE 'PLAN_READY';

ALTER TABLE "SopyoShipmentIntent" DROP CONSTRAINT "SopyoShipmentIntent_conflict_check";
ALTER TABLE "SopyoShipmentIntent" ADD CONSTRAINT "SopyoShipmentIntent_conflict_check" CHECK (
  ("status" = 'CONFLICT' AND "conflictReasonCode" IN
    ('CARGO_MISMATCH', 'SHOPIFY_PLAN_UNSAFE', 'SHOPIFY_PLAN_CHANGED', 'SHOPIFY_READ_INCOMPLETE')
    AND "conflictObservedAt" IS NOT NULL)
  OR ("status" <> 'CONFLICT' AND "conflictReasonCode" IS NULL AND "conflictObservedAt" IS NULL)
);

CREATE TABLE "SopyoShopifyExecutionPlan" (
  "id" TEXT NOT NULL,
  "sopyoShipmentIntentId" TEXT NOT NULL,
  "shopifyOrderGid" TEXT NOT NULL,
  "shopifyLocationGid" TEXT NOT NULL,
  "baselineFulfillmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "plannedAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC', clock_timestamp()),
  CONSTRAINT "SopyoShopifyExecutionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SopyoShopifyExecutionPlanLine" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "vendorAllocationLineItemId" TEXT NOT NULL,
  "fulfillmentOrderGid" TEXT NOT NULL,
  "fulfillmentOrderLineItemGid" TEXT NOT NULL,
  "shopifyOrderLineItemGid" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "SopyoShopifyExecutionPlanLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SopyoShopifyExecutionPlanLine_quantity_check" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "SopyoShopifyExecutionPlan_sopyoShipmentIntentId_key"
  ON "SopyoShopifyExecutionPlan"("sopyoShipmentIntentId");
CREATE UNIQUE INDEX "SopyoShopifyPlanLine_plan_foLine_key"
  ON "SopyoShopifyExecutionPlanLine"("planId", "fulfillmentOrderLineItemGid");
CREATE INDEX "SopyoShopifyExecutionPlanLine_vendorAllocationLineItemId_idx"
  ON "SopyoShopifyExecutionPlanLine"("vendorAllocationLineItemId");

ALTER TABLE "SopyoShopifyExecutionPlan" ADD CONSTRAINT "SopyoShopifyExecutionPlan_sopyoShipmentIntentId_fkey"
  FOREIGN KEY ("sopyoShipmentIntentId") REFERENCES "SopyoShipmentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SopyoShopifyExecutionPlanLine" ADD CONSTRAINT "SopyoShopifyExecutionPlanLine_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "SopyoShopifyExecutionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_sopyo_shopify_plan_rewrite"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sopyo Shopify execution plan is immutable';
END;
$$;
CREATE TRIGGER "SopyoShopifyExecutionPlan_no_rewrite"
  BEFORE UPDATE ON "SopyoShopifyExecutionPlan"
  FOR EACH ROW EXECUTE FUNCTION "reject_sopyo_shopify_plan_rewrite"();
CREATE TRIGGER "SopyoShopifyExecutionPlanLine_no_rewrite"
  BEFORE UPDATE ON "SopyoShopifyExecutionPlanLine"
  FOR EACH ROW EXECUTE FUNCTION "reject_sopyo_shopify_plan_rewrite"();
