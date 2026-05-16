ALTER TABLE "SupportTicket" ADD COLUMN "assigneeUserId" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN "assigneeName" TEXT;

CREATE INDEX "SupportTicket_assigneeUserId_idx" ON "SupportTicket"("assigneeUserId");

CREATE TABLE "SupportTicketReply" (
  "id" TEXT NOT NULL,
  "supportTicketId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "authorRole" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupportTicketReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTicketReply_supportTicketId_createdAt_idx" ON "SupportTicketReply"("supportTicketId", "createdAt");

ALTER TABLE "SupportTicketReply" ADD CONSTRAINT "SupportTicketReply_supportTicketId_fkey"
  FOREIGN KEY ("supportTicketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportTicketReply" ADD CONSTRAINT "SupportTicketReply_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
