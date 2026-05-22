ALTER TABLE "ReturnRecord" ADD COLUMN "returnProvider" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN "returnProviderShipmentId" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN "returnLabel" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN "returnReferenceId" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN "navlungoReturnCreatedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRecord" ADD COLUMN "returnProviderSnapshot" JSONB;
