ALTER TABLE "SupportTicket" ADD COLUMN "firstResponseDueAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN "nextResponseDueAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN "escalatedAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN "escalationReason" TEXT;

CREATE INDEX "SupportTicket_firstResponseDueAt_idx" ON "SupportTicket"("firstResponseDueAt");
CREATE INDEX "SupportTicket_nextResponseDueAt_idx" ON "SupportTicket"("nextResponseDueAt");
CREATE INDEX "SupportTicket_escalatedAt_idx" ON "SupportTicket"("escalatedAt");
