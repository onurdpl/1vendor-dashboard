ALTER TABLE "SupportTicket" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE "SupportTicket" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN "closedAt" TIMESTAMP(3);

UPDATE "SupportTicket"
SET "status" = CASE LOWER("status")
  WHEN 'open' THEN 'OPEN'
  WHEN 'in_progress' THEN 'IN_REVIEW'
  WHEN 'resolved' THEN 'RESOLVED'
  WHEN 'closed' THEN 'CLOSED'
  WHEN 'waiting_for_vendor' THEN 'WAITING_FOR_VENDOR'
  ELSE "status"
END;

UPDATE "SupportTicket"
SET "category" = CASE LOWER("contextType")
  WHEN 'order' THEN 'ORDER'
  WHEN 'return' THEN 'RETURN'
  WHEN 'shipment' THEN 'SHIPMENT'
  ELSE 'OTHER'
END
WHERE "category" = 'OTHER';

ALTER TABLE "SupportTicket" ALTER COLUMN "status" SET DEFAULT 'OPEN';

CREATE INDEX "SupportTicket_category_status_idx" ON "SupportTicket"("category", "status");

CREATE TABLE "SupportTicketNote" (
  "id" TEXT NOT NULL,
  "supportTicketId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "authorRole" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupportTicketNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTicketNote_supportTicketId_createdAt_idx" ON "SupportTicketNote"("supportTicketId", "createdAt");

ALTER TABLE "SupportTicketNote" ADD CONSTRAINT "SupportTicketNote_supportTicketId_fkey"
  FOREIGN KEY ("supportTicketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportTicketNote" ADD CONSTRAINT "SupportTicketNote_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
