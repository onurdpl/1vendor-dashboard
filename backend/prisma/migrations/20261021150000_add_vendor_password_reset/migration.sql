ALTER TABLE "User" ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "VendorPasswordResetAudit" (
    "operationId" TEXT NOT NULL,
    "actorAdminUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'PASSWORD_RESET',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "credentialVersion" INTEGER NOT NULL,
    CONSTRAINT "VendorPasswordResetAudit_pkey" PRIMARY KEY ("operationId"),
    CONSTRAINT "VendorPasswordResetAudit_eventType_check" CHECK ("eventType" = 'PASSWORD_RESET')
);

CREATE INDEX "VendorPasswordResetAudit_targetUserId_createdAt_idx" ON "VendorPasswordResetAudit"("targetUserId", "createdAt");
CREATE INDEX "VendorPasswordResetAudit_vendorId_createdAt_idx" ON "VendorPasswordResetAudit"("vendorId", "createdAt");

ALTER TABLE "VendorPasswordResetAudit" ADD CONSTRAINT "VendorPasswordResetAudit_actorAdminUserId_fkey" FOREIGN KEY ("actorAdminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorPasswordResetAudit" ADD CONSTRAINT "VendorPasswordResetAudit_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorPasswordResetAudit" ADD CONSTRAINT "VendorPasswordResetAudit_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
