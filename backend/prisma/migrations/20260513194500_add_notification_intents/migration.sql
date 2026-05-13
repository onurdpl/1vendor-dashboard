-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL_PLACEHOLDER', 'SLACK_PLACEHOLDER');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'DELIVERED', 'READ', 'DISMISSED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationRecipientRole" AS ENUM ('ADMIN', 'VENDOR');

-- CreateTable
CREATE TABLE "NotificationIntent" (
    "id" TEXT NOT NULL,
    "signalId" TEXT,
    "vendorId" TEXT,
    "recipientRole" "NotificationRecipientRole" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "OperationalSignalSeverity" NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationIntent_recipientRole_status_idx" ON "NotificationIntent"("recipientRole", "status");

-- CreateIndex
CREATE INDEX "NotificationIntent_vendorId_status_idx" ON "NotificationIntent"("vendorId", "status");

-- CreateIndex
CREATE INDEX "NotificationIntent_signalId_idx" ON "NotificationIntent"("signalId");

-- CreateIndex
CREATE INDEX "NotificationIntent_createdAt_idx" ON "NotificationIntent"("createdAt");

-- AddForeignKey
ALTER TABLE "NotificationIntent" ADD CONSTRAINT "NotificationIntent_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "OperationalSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationIntent" ADD CONSTRAINT "NotificationIntent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
