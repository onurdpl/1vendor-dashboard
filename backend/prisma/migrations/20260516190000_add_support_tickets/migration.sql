CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdByRole" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "status" TEXT NOT NULL DEFAULT 'open',
  "contextType" TEXT NOT NULL,
  "contextId" TEXT,
  "contextSnapshot" JSONB,

  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTicket_vendorId_status_createdAt_idx" ON "SupportTicket"("vendorId", "status", "createdAt");
CREATE INDEX "SupportTicket_contextType_contextId_idx" ON "SupportTicket"("contextType", "contextId");
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
