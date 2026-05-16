ALTER TABLE "SupportTicket" ADD COLUMN "vendorUnreadCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SupportTicket" ADD COLUMN "adminUnreadCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SupportTicket" ADD COLUMN "lastReplyAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN "lastReplyByRole" TEXT;

CREATE INDEX "SupportTicket_adminUnreadCount_idx" ON "SupportTicket"("adminUnreadCount");
CREATE INDEX "SupportTicket_vendorUnreadCount_idx" ON "SupportTicket"("vendorUnreadCount");
