-- Add nullable return owner snapshot foundation for future Model B return ownership hardening.
ALTER TABLE "ReturnRecord" ADD COLUMN "ownerVendorId" TEXT;

CREATE INDEX "ReturnRecord_ownerVendorId_idx" ON "ReturnRecord"("ownerVendorId");

ALTER TABLE "ReturnRecord"
  ADD CONSTRAINT "ReturnRecord_ownerVendorId_fkey"
  FOREIGN KEY ("ownerVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
