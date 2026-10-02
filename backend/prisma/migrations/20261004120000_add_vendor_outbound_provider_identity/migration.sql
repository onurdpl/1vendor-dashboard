CREATE TYPE "VendorOutboundMethod" AS ENUM ('KARGONOMI', 'VENDOR_INTEGRATION');
CREATE TYPE "VendorIntegrationProviderCode" AS ENUM ('SOPYO');

ALTER TABLE "VendorShippingConfig"
  ADD COLUMN "outboundMethod" "VendorOutboundMethod",
  ADD COLUMN "selectedIntegrationProvider" "VendorIntegrationProviderCode";

ALTER TABLE "VendorIntegrationClient"
  ADD COLUMN "providerCode" "VendorIntegrationProviderCode";

ALTER TABLE "VendorShippingConfig"
  ADD CONSTRAINT "VendorShippingConfig_outbound_selection_check"
  CHECK (
    ("outboundMethod" IS NULL AND "selectedIntegrationProvider" IS NULL)
    OR ("outboundMethod" IS NOT NULL AND "outboundMethod" = 'KARGONOMI' AND "selectedIntegrationProvider" IS NULL)
    OR ("outboundMethod" IS NOT NULL AND "outboundMethod" = 'VENDOR_INTEGRATION' AND "selectedIntegrationProvider" IS NOT NULL)
  );
