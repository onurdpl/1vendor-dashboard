CREATE TABLE "VendorIntegrationClient" (
    "id" TEXT NOT NULL,
    "vendorIdentifier" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scopes" TEXT[] NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorIntegrationClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VendorIntegrationAuditLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vendorIdentifier" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorIntegrationAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorIntegrationClient_tokenHash_key" ON "VendorIntegrationClient"("tokenHash");
CREATE INDEX "VendorIntegrationClient_vendorIdentifier_idx" ON "VendorIntegrationClient"("vendorIdentifier");
CREATE INDEX "VendorIntegrationClient_enabled_revokedAt_idx" ON "VendorIntegrationClient"("enabled", "revokedAt");
CREATE INDEX "VendorIntegrationAuditLog_clientId_createdAt_idx" ON "VendorIntegrationAuditLog"("clientId", "createdAt");
CREATE INDEX "VendorIntegrationAuditLog_vendorIdentifier_createdAt_idx" ON "VendorIntegrationAuditLog"("vendorIdentifier", "createdAt");

ALTER TABLE "VendorIntegrationAuditLog"
ADD CONSTRAINT "VendorIntegrationAuditLog_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "VendorIntegrationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
