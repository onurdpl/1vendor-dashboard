-- Repair only allocations with an existing, source-aligned Sopyo delivered observation.
-- The immutable observation and its first-observed timestamp are not modified.
UPDATE "VendorAllocation" AS allocation
SET "shippingStatus" = 'delivered'
FROM "AllocationDeliveredObservation" AS observation
WHERE observation."vendorAllocationId" = allocation."id"
  AND observation."outboundMethod" = 'VENDOR_INTEGRATION'
  AND observation."outboundIntegrationProvider" = 'SOPYO'
  AND allocation."outboundMethodSnapshot" = observation."outboundMethod"
  AND allocation."outboundIntegrationProviderSnapshot" = observation."outboundIntegrationProvider"
  AND lower(btrim(allocation."shippingStatus")) <> 'delivered';
