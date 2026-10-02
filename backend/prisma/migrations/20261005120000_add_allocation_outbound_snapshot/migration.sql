ALTER TABLE "VendorAllocation"
  ADD COLUMN "outboundMethodSnapshot" "VendorOutboundMethod",
  ADD COLUMN "outboundIntegrationProviderSnapshot" "VendorIntegrationProviderCode";

ALTER TABLE "VendorAllocation"
  ADD CONSTRAINT "VendorAllocation_outbound_snapshot_check"
  CHECK (
    ("outboundMethodSnapshot" IS NULL AND "outboundIntegrationProviderSnapshot" IS NULL)
    OR ("outboundMethodSnapshot" IS NOT NULL AND "outboundMethodSnapshot" = 'KARGONOMI' AND "outboundIntegrationProviderSnapshot" IS NULL)
    OR ("outboundMethodSnapshot" IS NOT NULL AND "outboundMethodSnapshot" = 'VENDOR_INTEGRATION' AND "outboundIntegrationProviderSnapshot" IS NOT NULL)
  );
