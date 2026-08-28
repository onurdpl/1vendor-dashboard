-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'VENDOR', 'SUPPORT', 'FINANCE');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('ACTIVE', 'VENDOR_BLOCKED', 'PENDING_REASSIGNMENT', 'REASSIGNED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('OUT_OF_STOCK', 'VENDOR_CANCELLED', 'DAMAGED_INVENTORY', 'FULFILLMENT_ISSUE');

-- CreateEnum
CREATE TYPE "ProductPanelVariantDisableOutboxStatus" AS ENUM ('CREATED', 'RESOLVED', 'RESOLVED_DRY_RUN', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'HOLD');

-- CreateEnum
CREATE TYPE "OperationalJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRY_SCHEDULED', 'RETRYING', 'DEAD_LETTER_READY', 'PERMANENTLY_FAILED');

-- CreateEnum
CREATE TYPE "OperationalJobType" AS ENUM ('WEBHOOK_PROCESSING', 'RECONCILIATION', 'REPLAY', 'RECOVERY', 'FULFILLMENT_SYNC', 'REFUND_SYNC', 'RETURN_SYNC');

-- CreateEnum
CREATE TYPE "ShippingDeductionMode" AS ENUM ('DISABLED', 'FIXED', 'EXTERNAL_PROVIDER');

-- CreateEnum
CREATE TYPE "SettlementFrequencyType" AS ENUM ('WEEKLY', 'BIWEEKLY');

-- CreateEnum
CREATE TYPE "SettlementWeekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY');

-- CreateEnum
CREATE TYPE "SettlementScheduleJobRunStatus" AS ENUM ('PROCESSING', 'DRY_RUN', 'COMPLETED', 'BLOCKED', 'FAILED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'ACCRUING', 'PAYABLE', 'PARTIALLY_REFUNDED', 'HELD', 'SETTLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "SettlementApprovalStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementApprovalLineType" AS ENUM ('SALE', 'REFUND', 'REFUND_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SettlementCommissionInvoiceProvider" AS ENUM ('LOGO_ISBASI');

-- CreateEnum
CREATE TYPE "SettlementCommissionInvoiceStatus" AS ENUM ('PENDING', 'CREATED', 'FAILED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SettlementRefundAdjustmentStatus" AS ENUM ('PENDING', 'PARTIALLY_APPLIED', 'APPLIED', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementRefundAdjustmentApplicationStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementRefundAdjustmentEventType" AS ENUM ('CREATED', 'PARTIALLY_APPLIED', 'APPLIED', 'APPLICATION_CANCELLED', 'ADJUSTMENT_CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutBatchStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'CANCELLED', 'EXECUTION_PENDING', 'PAID', 'PAID_PLACEHOLDER');

-- CreateEnum
CREATE TYPE "VendorBalanceEventType" AS ENUM ('PAYABLE_EARNED', 'VENDOR_DEBT_CREATED', 'VENDOR_DEBT_OFFSET', 'MANUAL_ADJUSTMENT', 'DEBT_WAIVED');

-- CreateEnum
CREATE TYPE "FinanceEventType" AS ENUM ('SALE_RECORDED', 'COMMISSION_RESERVED', 'COMMISSION_VAT_RESERVED', 'VENDOR_PAYABLE_RESERVED', 'REFUND_RECORDED', 'COMMISSION_REVERSED', 'COMMISSION_VAT_REVERSED', 'VENDOR_PAYABLE_REVERSED', 'MANUAL_ADJUSTMENT', 'PAYOUT_PAID');

-- CreateEnum
CREATE TYPE "ShippingCostSourceType" AS ENUM ('MANUAL', 'IMPORTED', 'EXTERNAL_PROVIDER');

-- CreateEnum
CREATE TYPE "ShippingCostStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISPUTED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ShippingProvider" AS ENUM ('HEPSIJET', 'KARGO_ENTEGRATOR', 'TRY_OTO', 'KARGONOMI', 'NAVLUNGO', 'MNG', 'YURTICI', 'ARAS');

-- CreateEnum
CREATE TYPE "ShipmentExecutionStatus" AS ENUM ('PENDING', 'CREATED', 'FAILED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OperationalSignalSeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "OperationalSignalStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "OperationalSignalSourceArea" AS ENUM ('PAYOUT', 'REFUND', 'FULFILLMENT', 'DIAGNOSTICS', 'RECONCILIATION', 'SHIPPING_COST', 'SETTLEMENT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL_PLACEHOLDER', 'SLACK_PLACEHOLDER');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'DELIVERED', 'READ', 'DISMISSED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationRecipientRole" AS ENUM ('ADMIN', 'VENDOR');

-- CreateEnum
CREATE TYPE "AutomationActionStatus" AS ENUM ('PENDING', 'SUGGESTED', 'EXECUTED', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutomationExecutionMode" AS ENUM ('MANUAL', 'ASSISTED', 'AUTO_SAFE');

-- CreateEnum
CREATE TYPE "AutomationActionType" AS ENUM ('SUGGEST_REPLAY_WEBHOOK', 'SUGGEST_RECONCILIATION', 'SUGGEST_PAYOUT_BATCH_REVIEW', 'SUGGEST_SHIPPING_COST_ATTACHMENT', 'SUGGEST_STALE_FULFILLMENT_REVIEW', 'SUGGEST_PAYOUT_REVIEW', 'SUGGEST_NEGATIVE_PAYOUT_INVESTIGATION', 'SUGGEST_DEAD_LETTER_INVESTIGATION', 'AUTO_CREATE_RECONCILIATION_CANDIDATE', 'AUTO_GENERATE_REMINDER_NOTIFICATION', 'AUTO_PRIORITIZE_STALE_QUEUE_ITEM');

-- CreateEnum
CREATE TYPE "VendorProfileSnapshotImpact" AS ENUM ('FUTURE_LEDGER_ROWS_ONLY', 'FUTURE_SETTLEMENT_APPROVALS_ONLY', 'FUTURE_COMMISSION_INVOICES_ONLY', 'FUTURE_SHIPMENTS_ONLY', 'FUTURE_RETURNS_ONLY', 'FUTURE_SHIPMENTS_AND_RETURNS_ONLY', 'EXISTING_SETTLEMENTS_UNCHANGED', 'PROVIDER_REBIND_REQUIRED', 'FUTURE_PAYOUT_RELEVANT', 'DIAGNOSTIC_ONLY', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "restrictionReason" TEXT,
    "restrictedByUserId" TEXT,
    "restrictedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "assigneeUserId" TEXT,
    "assigneeName" TEXT,
    "vendorUnreadCount" INTEGER NOT NULL DEFAULT 0,
    "adminUnreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplyAt" TIMESTAMP(3),
    "lastReplyByRole" TEXT,
    "firstResponseDueAt" TIMESTAMP(3),
    "nextResponseDueAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "escalationReason" TEXT,
    "contextType" TEXT NOT NULL,
    "contextId" TEXT,
    "contextSnapshot" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "VendorFinancialProfile" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    "commissionVatPercent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "deductShippingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "shippingMode" "ShippingDeductionMode" NOT NULL DEFAULT 'DISABLED',
    "fixedShippingFee" DECIMAL(10,2),
    "settlementDelayDays" INTEGER NOT NULL DEFAULT 21,
    "settlementFrequencyType" "SettlementFrequencyType" NOT NULL DEFAULT 'WEEKLY',
    "weeklySettlementDay" "SettlementWeekday" NOT NULL DEFAULT 'WEDNESDAY',
    "autoSettlementDraftEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoSettlementApproveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoSettlementInvoiceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorFinancialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBillingProfile" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "legalCompanyName" TEXT,
    "taxNumber" TEXT,
    "taxOffice" TEXT,
    "billingAddress" TEXT,
    "billingCity" TEXT,
    "billingDistrict" TEXT,
    "iban" TEXT,
    "authorizedPerson" TEXT,
    "billingEmail" TEXT,
    "billingPhone" TEXT,
    "legalEntityType" TEXT,
    "logoIsbasiCustomerCode" TEXT,
    "logoIsbasiCustomerId" TEXT,
    "logoIsbasiEinvoiceEligible" BOOLEAN,
    "logoIsbasiLastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorProfileAuditLog" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "changedByUserId" TEXT,
    "changedByEmail" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "snapshotImpact" "VendorProfileSnapshotImpact" NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "VendorProfileAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserVendorAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserVendorAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorIntegrationClient" (
    "id" TEXT NOT NULL,
    "vendorIdentifier" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorIntegrationClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "ShopifyOrder" (
    "id" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "sourceShopifyOrderNumber" TEXT NOT NULL,
    "shopifyCreatedAt" TIMESTAMP(3),
    "currency" TEXT,
    "financialStatus" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "paymentGatewayName" TEXT,
    "taxesIncluded" BOOLEAN,
    "orderTaxAmount" DECIMAL(10,2),
    "shippingAmount" DECIMAL(10,2),
    "discountAmount" DECIMAL(10,2),
    "orderNote" TEXT,
    "orderTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "billingFullName" TEXT,
    "billingCompany" TEXT,
    "billingPhone" TEXT,
    "billingCity" TEXT,
    "billingDistrict" TEXT,
    "billingAddress1" TEXT,
    "billingAddress2" TEXT,
    "billingPostcode" TEXT,
    "shippingCountry" TEXT,
    "shippingPostcode" TEXT,
    "shippingCity" TEXT,
    "shippingDistrict" TEXT,
    "shippingAddress" TEXT,
    "totalPrice" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyOrderLineItem" (
    "id" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "sourceLineItemId" TEXT NOT NULL,
    "shopifyProductId" TEXT,
    "sourceVariantId" TEXT,
    "sku" TEXT,
    "title" TEXT,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2),
    "unitPriceVatIncluded" DECIMAL(10,2),
    "lineTotalVatIncluded" DECIMAL(10,2),
    "lineTaxAmount" DECIMAL(10,2),
    "vatRate" DECIMAL(5,2),
    "originalVendorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyOrderLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorAllocation" (
    "id" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "sourceShopifyOrderNumber" TEXT NOT NULL,
    "originalVendorId" TEXT NOT NULL,
    "assignedVendorId" TEXT NOT NULL,
    "allocationStatus" "AllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancellationReason" "CancellationReason",
    "reassignmentRequired" BOOLEAN NOT NULL DEFAULT false,
    "cancelRefundReviewStatus" TEXT,
    "cancelRefundReviewReason" TEXT,
    "cancelRefundReviewNote" TEXT,
    "cancelRefundReviewRequestedAt" TIMESTAMP(3),
    "cancelRefundReviewRequestedByUserId" TEXT,
    "fulfillmentStatus" TEXT NOT NULL DEFAULT 'Pending',
    "shippingStatus" TEXT NOT NULL DEFAULT 'Awaiting Shipment',
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "vendorIntegrationTrackingUrl" TEXT,
    "vendorIntegrationShippedAt" TIMESTAMP(3),
    "odooSaleOrderId" TEXT,
    "odooSaleOrderName" TEXT,
    "odooSaleOrderSyncedAt" TIMESTAMP(3),
    "vendorIntegrationStatus" TEXT,
    "vendorIntegrationStatusMessage" TEXT,
    "vendorIntegrationStatusUpdatedAt" TIMESTAMP(3),
    "vendorIntegrationProvider" TEXT,
    "lastVendorIntegrationRequestId" TEXT,
    "lastVendorIntegrationShipmentRequestId" TEXT,
    "vendorInvoiceNumber" TEXT,
    "vendorInvoiceDate" TIMESTAMP(3),
    "vendorInvoiceUrl" TEXT,
    "vendorInvoiceAmount" DECIMAL(10,2),
    "vendorInvoiceReceivedAt" TIMESTAMP(3),
    "lastVendorIntegrationInvoiceRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundShopifyRefundAttempt" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "restockType" TEXT NOT NULL,
    "refundShipping" BOOLEAN NOT NULL DEFAULT false,
    "notifyCustomer" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "requestedByUserId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundLineItemsJson" JSONB,
    "suggestedTransactionsJson" JSONB,
    "fulfillmentOrderCancellationJson" JSONB,
    "blockersJson" JSONB,
    "warningsJson" JSONB,
    "previewHash" TEXT,
    "previewedAt" TIMESTAMP(3),
    "shopifyRefundId" TEXT,
    "shopifyUserErrorsJson" JSONB,
    "mutationResponseJson" JSONB,
    "submittedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundShopifyRefundAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderShippingRefundClaim" (
    "id" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "ownerAttemptId" TEXT NOT NULL,
    "activeOrderKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderShippingRefundClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorIntegrationInvoiceEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "vendorIdentifier" TEXT NOT NULL,
    "providerName" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "invoiceUrl" TEXT,
    "invoiceAmount" DECIMAL(10,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorIntegrationInvoiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorIntegrationShipmentEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "vendorIdentifier" TEXT NOT NULL,
    "providerName" TEXT,
    "carrier" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "trackingUrl" TEXT,
    "shippedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorIntegrationShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorIntegrationStatusEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "vendorIdentifier" TEXT NOT NULL,
    "providerName" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorIntegrationStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorAllocationLineItem" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "lineAmount" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorAllocationLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPanelVariantDisableOutboxEvent" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "vendorAllocationLineItemId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "shopifyLineItemId" TEXT NOT NULL,
    "variantSku" TEXT,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT,
    "quantity" INTEGER NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "environment" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductPanelVariantDisableOutboxStatus" NOT NULL DEFAULT 'CREATED',
    "error" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestPayloadJson" JSONB,
    "responseJson" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPanelVariantDisableOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationAssignmentHistory" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromVendorId" TEXT,
    "toVendorId" TEXT NOT NULL,
    "reason" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationSplitEvent" (
    "id" TEXT NOT NULL,
    "sourceAllocationId" TEXT NOT NULL,
    "childAllocationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movedVendorAllocationLineItemIdsJson" JSONB,
    "movedShopifyLineItemIdsJson" JSONB,
    "sourceFinanceLedgerEntryId" TEXT,
    "remainingFinanceLedgerEntryId" TEXT,
    "childFinanceLedgerEntryId" TEXT,
    "metadataJson" JSONB,

    CONSTRAINT "AllocationSplitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationEconomicTransfer" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "fromVendorId" TEXT NOT NULL,
    "toVendorId" TEXT NOT NULL,
    "fromFinanceLedgerEntryId" TEXT,
    "toFinanceLedgerEntryId" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "adminActorUserId" TEXT,
    "pricingSnapshotJson" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "AllocationEconomicTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceIntegrityAlert" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "vendorAllocationId" TEXT,
    "allocationEconomicTransferId" TEXT,
    "affectedLedgerIds" JSONB,
    "affectedFinanceEventIds" JSONB,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByUserId" TEXT,
    "acknowledgmentNote" TEXT,
    "resolutionNote" TEXT,
    "resolutionValidationJson" JSONB,
    "resolutionType" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceIntegrityAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fulfillment" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "fulfillmentStatus" TEXT NOT NULL,
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "trackingUrl" TEXT,
    "notifyCustomer" BOOLEAN NOT NULL DEFAULT true,
    "shopifyFulfillmentId" TEXT,
    "shopifyFulfillmentOrderId" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "shipmentCreatedAt" TIMESTAMP(3),
    "shipmentUpdatedAt" TIMESTAMP(3),
    "syncStatus" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRecord" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "ownerVendorId" TEXT,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "sourceShopifyOrderNumber" TEXT NOT NULL,
    "sourceShopifyRefundId" TEXT,
    "sourceShopifyReturnId" TEXT,
    "sourceShopifyReturnGid" TEXT,
    "sourceShopifyLineItemId" TEXT,
    "returnLifecycleStatus" TEXT,
    "returnRequestSource" TEXT,
    "requestCreatedAt" TIMESTAMP(3),
    "requestUpdatedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "returnReasonNote" TEXT,
    "returnProvider" TEXT,
    "returnProviderShipmentId" TEXT,
    "returnLabel" TEXT,
    "returnReferenceId" TEXT,
    "navlungoReturnCreatedAt" TIMESTAMP(3),
    "returnProviderSnapshot" JSONB,
    "returnCarrierName" TEXT,
    "returnTrackingNumber" TEXT,
    "returnTrackingUrl" TEXT,
    "vendorReceivedAt" TIMESTAMP(3),
    "vendorReviewedAt" TIMESTAMP(3),
    "vendorDecision" TEXT,
    "vendorDecisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRecord" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "sourceShopifyOrderNumber" TEXT NOT NULL,
    "sourceShopifyRefundId" TEXT NOT NULL,
    "amount" DECIMAL(10,2),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyRefund" (
    "id" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "sourceShopifyOrderNumber" TEXT NOT NULL,
    "sourceShopifyRefundId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyRefundLineItem" (
    "id" TEXT NOT NULL,
    "shopifyRefundId" TEXT NOT NULL,
    "refundRecordId" TEXT,
    "shopifyOrderLineItemId" TEXT NOT NULL,
    "sourceRefundLineItemId" TEXT NOT NULL,
    "sourceLineItemId" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyRefundLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceLedgerEntry" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT,
    "vendorId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "commissionPercentSnapshot" DECIMAL(5,2),
    "commissionVatPercentSnapshot" DECIMAL(5,2),
    "deductShippingEnabledSnapshot" BOOLEAN,
    "shippingModeSnapshot" "ShippingDeductionMode",
    "fixedShippingFeeSnapshot" DECIMAL(10,2),
    "shippingCostSnapshot" DECIMAL(10,2),
    "shippingVatAmountSnapshot" DECIMAL(10,2),
    "shippingCostSourceSnapshot" TEXT,
    "shippingCostProviderSnapshot" TEXT,
    "shippingCostIdSnapshot" TEXT,
    "financialProfileIdSnapshot" TEXT,
    "settlementDelayDaysSnapshot" INTEGER NOT NULL DEFAULT 21,
    "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "settlementEligibleAt" TIMESTAMP(3),
    "accruedAt" TIMESTAMP(3),
    "payableAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "settlementHoldReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "supersededByLedgerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendorId" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "financeLedgerEntryId" TEXT,
    "eventType" "FinanceEventType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "FinanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementApproval" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vendorId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "status" "SettlementApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "grossSalesMinor" INTEGER NOT NULL,
    "refundTotalMinor" INTEGER NOT NULL,
    "commissionMinor" INTEGER NOT NULL,
    "commissionVatMinor" INTEGER NOT NULL,
    "netPayableMinor" INTEGER NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "scheduledRunDate" TIMESTAMP(3),
    "scheduledPeriodEnd" TIMESTAMP(3),
    "scheduledCycleKey" TEXT,
    "sourceSnapshotJson" JSONB NOT NULL,

    CONSTRAINT "SettlementApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementScheduleJobRun" (
    "id" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL,
    "status" "SettlementScheduleJobRunStatus" NOT NULL DEFAULT 'PROCESSING',
    "writesPerformed" BOOLEAN NOT NULL DEFAULT false,
    "createdDraftCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "metadataJson" JSONB,

    CONSTRAINT "SettlementScheduleJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementApprovalLine" (
    "id" TEXT NOT NULL,
    "settlementApprovalId" TEXT NOT NULL,
    "financeLedgerEntryId" TEXT NOT NULL,
    "settlementRefundAdjustmentId" TEXT,
    "settlementRefundAdjustmentApplicationId" TEXT,
    "lineType" "SettlementApprovalLineType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "commissionMinor" INTEGER NOT NULL,
    "commissionVatMinor" INTEGER NOT NULL,
    "payableImpactMinor" INTEGER NOT NULL,
    "sourceSnapshotJson" JSONB NOT NULL,

    CONSTRAINT "SettlementApprovalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementCommissionInvoice" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settlementApprovalId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "provider" "SettlementCommissionInvoiceProvider" NOT NULL,
    "status" "SettlementCommissionInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "providerInvoiceId" TEXT,
    "providerUuid" TEXT,
    "providerEttn" TEXT,
    "invoiceNo" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "invoiceTotalMinor" INTEGER,
    "invoiceCurrency" TEXT,
    "gibStatus" TEXT,
    "gibStatusCode" TEXT,
    "documentStatus" TEXT,
    "documentStatusCode" TEXT,
    "documentType" TEXT,
    "documentContentType" TEXT,
    "documentSize" INTEGER,
    "documentFetchedAt" TIMESTAMP(3),
    "lastProviderSyncedAt" TIMESTAMP(3),
    "documentSnapshotJson" JSONB,
    "requestSnapshotJson" JSONB,
    "responseSnapshotJson" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "failedAt" TIMESTAMP(3),
    "unknownReason" TEXT,
    "unknownAt" TIMESTAMP(3),
    "reconciliationStatus" TEXT,
    "reconciliationEvidenceJson" JSONB,
    "reconciledAt" TIMESTAMP(3),
    "reconciledBy" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetriedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "SettlementCommissionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRefundAdjustment" (
    "id" TEXT NOT NULL,
    "refundRecordId" TEXT NOT NULL,
    "refundFinanceLedgerEntryId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "originalOrderId" TEXT NOT NULL,
    "originalSettlementApprovalId" TEXT,
    "originalSettlementApprovalLineId" TEXT,
    "originalSettlementCommissionInvoiceId" TEXT,
    "status" "SettlementRefundAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "amountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'TRY',
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "originalAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "appliedAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "remainingAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "appliedSettlementApprovalId" TEXT,
    "appliedSettlementApprovalLineId" TEXT,
    "blockedReason" TEXT,
    "createdBy" TEXT,

    CONSTRAINT "SettlementRefundAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRefundAdjustmentEvent" (
    "id" TEXT NOT NULL,
    "settlementRefundAdjustmentId" TEXT NOT NULL,
    "eventType" "SettlementRefundAdjustmentEventType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" JSONB,

    CONSTRAINT "SettlementRefundAdjustmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRefundAdjustmentApplication" (
    "id" TEXT NOT NULL,
    "settlementRefundAdjustmentId" TEXT NOT NULL,
    "settlementApprovalId" TEXT NOT NULL,
    "settlementApprovalLineId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'TRY',
    "status" "SettlementRefundAdjustmentApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementRefundAdjustmentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentShippingCost" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "sourceShopifyFulfillmentId" TEXT,
    "providerName" TEXT NOT NULL,
    "providerReference" TEXT,
    "shippingCost" DECIMAL(10,2) NOT NULL,
    "shippingVatAmount" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "status" "ShippingCostStatus" NOT NULL DEFAULT 'PENDING',
    "sourceType" "ShippingCostSourceType" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentShippingCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorShippingConfig" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "preferredProvider" "ShippingProvider" NOT NULL DEFAULT 'HEPSIJET',
    "shippingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultDesi" DECIMAL(10,2) NOT NULL DEFAULT 3.00,
    "cargoIntegrationId" TEXT,
    "defaultWarehouseId" TEXT,
    "shippingVatPercent" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
    "providerMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorShippingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorShippingWarehouse" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "provider" "ShippingProvider" NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "name" TEXT,
    "address" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorShippingWarehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentExecution" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT,
    "sourceShopifyOrderNumber" TEXT,
    "sourceShopifyFulfillmentId" TEXT,
    "provider" "ShippingProvider" NOT NULL,
    "providerShipmentId" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "labelUrl" TEXT,
    "shipmentStatus" "ShipmentExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "desi" DECIMAL(10,2) NOT NULL DEFAULT 3.00,
    "cargoIntegrationId" TEXT,
    "warehouseId" TEXT,
    "shippingCost" DECIMAL(10,2),
    "shippingVat" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "requestSnapshot" JSONB NOT NULL,
    "responseSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "grossAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "commissionAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "commissionVatAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "shippingDeductionAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "refundAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "netAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "createdByUserId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "paymentReference" TEXT,
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatchLine" (
    "id" TEXT NOT NULL,
    "payoutBatchId" TEXT NOT NULL,
    "financeLedgerEntryId" TEXT NOT NULL,
    "settlementApprovalLineId" TEXT,
    "amountSnapshot" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutBatchLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBalanceEvent" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "VendorBalanceEventType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "financeLedgerEntryId" TEXT,
    "refundRecordId" TEXT,
    "payoutBatchId" TEXT,
    "settlementApprovalId" TEXT,
    "metadataJson" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorBalanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "sourceShopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "webhookId" TEXT,
    "idempotencyKey" TEXT,
    "payloadHash" TEXT,
    "rawPayload" TEXT,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "shopifyOrderId" TEXT,
    "sourceShopifyOrderId" TEXT,
    "executionAvailableAt" TIMESTAMP(3),
    "executionAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "executionMaxAttempts" INTEGER NOT NULL DEFAULT 3,
    "processingGeneration" INTEGER NOT NULL DEFAULT 0,
    "processingLeaseExpiresAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalJob" (
    "id" TEXT NOT NULL,
    "jobType" "OperationalJobType" NOT NULL,
    "status" "OperationalJobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "payloadRef" TEXT,
    "webhookEventId" TEXT,
    "sourceShopifyOrderId" TEXT,
    "vendorAllocationId" TEXT,
    "refundRecordId" TEXT,
    "returnRecordId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextRetryAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "retryBackoffMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorSummary" TEXT,
    "failureCategory" TEXT,
    "escalationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalReconciliationRun" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "lookbackDays" INTEGER NOT NULL,
    "orderLimit" INTEGER NOT NULL,
    "ordersScanned" INTEGER NOT NULL DEFAULT 0,
    "repairOpportunities" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairOrders" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairFulfillment" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairRefunds" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairReturns" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairCancellations" INTEGER NOT NULL DEFAULT 0,
    "wouldCreateSignals" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairLedgers" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairFinanceEvents" INTEGER NOT NULL DEFAULT 0,
    "errorsJson" JSONB,
    "perOrderDetailsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalSignal" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "OperationalSignalSeverity" NOT NULL,
    "sourceArea" "OperationalSignalSourceArea" NOT NULL,
    "vendorId" TEXT,
    "allocationId" TEXT,
    "financeLedgerEntryId" TEXT,
    "payoutBatchId" TEXT,
    "operationalJobId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "suggestedAction" TEXT,
    "status" "OperationalSignalStatus" NOT NULL DEFAULT 'ACTIVE',
    "ruleKey" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalSignal_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "AutomationAction" (
    "id" TEXT NOT NULL,
    "signalId" TEXT,
    "type" "AutomationActionType" NOT NULL,
    "status" "AutomationActionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "executionMode" "AutomationExecutionMode" NOT NULL DEFAULT 'MANUAL',
    "vendorId" TEXT,
    "allocationId" TEXT,
    "financeLedgerEntryId" TEXT,
    "payoutBatchId" TEXT,
    "operationalJobId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resultSummary" TEXT,
    "executedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "SupportTicket_vendorId_status_createdAt_idx" ON "SupportTicket"("vendorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_category_status_idx" ON "SupportTicket"("category", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_assigneeUserId_idx" ON "SupportTicket"("assigneeUserId");

-- CreateIndex
CREATE INDEX "SupportTicket_adminUnreadCount_idx" ON "SupportTicket"("adminUnreadCount");

-- CreateIndex
CREATE INDEX "SupportTicket_vendorUnreadCount_idx" ON "SupportTicket"("vendorUnreadCount");

-- CreateIndex
CREATE INDEX "SupportTicket_firstResponseDueAt_idx" ON "SupportTicket"("firstResponseDueAt");

-- CreateIndex
CREATE INDEX "SupportTicket_nextResponseDueAt_idx" ON "SupportTicket"("nextResponseDueAt");

-- CreateIndex
CREATE INDEX "SupportTicket_escalatedAt_idx" ON "SupportTicket"("escalatedAt");

-- CreateIndex
CREATE INDEX "SupportTicket_contextType_contextId_idx" ON "SupportTicket"("contextType", "contextId");

-- CreateIndex
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- CreateIndex
CREATE INDEX "SupportTicketNote_supportTicketId_createdAt_idx" ON "SupportTicketNote"("supportTicketId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicketReply_supportTicketId_createdAt_idx" ON "SupportTicketReply"("supportTicketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorFinancialProfile_vendorId_key" ON "VendorFinancialProfile"("vendorId");

-- CreateIndex
CREATE INDEX "VendorFinancialProfile_vendorId_active_idx" ON "VendorFinancialProfile"("vendorId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBillingProfile_vendorId_key" ON "VendorBillingProfile"("vendorId");

-- CreateIndex
CREATE INDEX "VendorBillingProfile_vendorId_idx" ON "VendorBillingProfile"("vendorId");

-- CreateIndex
CREATE INDEX "VendorProfileAuditLog_vendorId_changedAt_idx" ON "VendorProfileAuditLog"("vendorId", "changedAt");

-- CreateIndex
CREATE INDEX "VendorProfileAuditLog_vendorId_section_idx" ON "VendorProfileAuditLog"("vendorId", "section");

-- CreateIndex
CREATE INDEX "VendorProfileAuditLog_fieldName_idx" ON "VendorProfileAuditLog"("fieldName");

-- CreateIndex
CREATE UNIQUE INDEX "UserVendorAccess_userId_vendorId_key" ON "UserVendorAccess"("userId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorIntegrationClient_tokenHash_key" ON "VendorIntegrationClient"("tokenHash");

-- CreateIndex
CREATE INDEX "VendorIntegrationClient_vendorIdentifier_idx" ON "VendorIntegrationClient"("vendorIdentifier");

-- CreateIndex
CREATE INDEX "VendorIntegrationClient_enabled_revokedAt_idx" ON "VendorIntegrationClient"("enabled", "revokedAt");

-- CreateIndex
CREATE INDEX "VendorIntegrationAuditLog_clientId_createdAt_idx" ON "VendorIntegrationAuditLog"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorIntegrationAuditLog_vendorIdentifier_createdAt_idx" ON "VendorIntegrationAuditLog"("vendorIdentifier", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOrder_sourceShopifyOrderId_key" ON "ShopifyOrder"("sourceShopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOrderLineItem_shopifyOrderId_sourceLineItemId_key" ON "ShopifyOrderLineItem"("shopifyOrderId", "sourceLineItemId");

-- CreateIndex
CREATE INDEX "VendorAllocation_createdAt_idx" ON "VendorAllocation"("createdAt");

-- CreateIndex
CREATE INDEX "VendorAllocation_odooSaleOrderId_idx" ON "VendorAllocation"("odooSaleOrderId");

-- CreateIndex
CREATE INDEX "VendorAllocation_vendorIntegrationStatus_idx" ON "VendorAllocation"("vendorIntegrationStatus");

-- CreateIndex
CREATE INDEX "VendorAllocation_cancelRefundReviewStatus_idx" ON "VendorAllocation"("cancelRefundReviewStatus");

-- CreateIndex
CREATE INDEX "OutboundShopifyRefundAttempt_vendorAllocationId_idx" ON "OutboundShopifyRefundAttempt"("vendorAllocationId");

-- CreateIndex
CREATE INDEX "OutboundShopifyRefundAttempt_shopifyOrderId_idx" ON "OutboundShopifyRefundAttempt"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "OutboundShopifyRefundAttempt_status_idx" ON "OutboundShopifyRefundAttempt"("status");

-- CreateIndex
CREATE INDEX "OutboundShopifyRefundAttempt_shopifyRefundId_idx" ON "OutboundShopifyRefundAttempt"("shopifyRefundId");

-- CreateIndex
CREATE INDEX "OutboundShopifyRefundAttempt_previewHash_idx" ON "OutboundShopifyRefundAttempt"("previewHash");

-- CreateIndex
CREATE UNIQUE INDEX "OrderShippingRefundClaim_ownerAttemptId_key" ON "OrderShippingRefundClaim"("ownerAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderShippingRefundClaim_activeOrderKey_key" ON "OrderShippingRefundClaim"("activeOrderKey");

-- CreateIndex
CREATE INDEX "OrderShippingRefundClaim_shopifyOrderId_idx" ON "OrderShippingRefundClaim"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "OrderShippingRefundClaim_status_idx" ON "OrderShippingRefundClaim"("status");

-- CreateIndex
CREATE INDEX "VendorIntegrationInvoiceEvent_vendorAllocationId_createdAt_idx" ON "VendorIntegrationInvoiceEvent"("vendorAllocationId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorIntegrationInvoiceEvent_vendorIdentifier_createdAt_idx" ON "VendorIntegrationInvoiceEvent"("vendorIdentifier", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorIntegrationInvoiceEvent_clientId_vendorAllocationId_i_key" ON "VendorIntegrationInvoiceEvent"("clientId", "vendorAllocationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "VendorIntegrationShipmentEvent_vendorAllocationId_createdAt_idx" ON "VendorIntegrationShipmentEvent"("vendorAllocationId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorIntegrationShipmentEvent_vendorIdentifier_createdAt_idx" ON "VendorIntegrationShipmentEvent"("vendorIdentifier", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorIntegrationShipmentEvent_clientId_vendorAllocationId__key" ON "VendorIntegrationShipmentEvent"("clientId", "vendorAllocationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "VendorIntegrationStatusEvent_vendorAllocationId_createdAt_idx" ON "VendorIntegrationStatusEvent"("vendorAllocationId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorIntegrationStatusEvent_vendorIdentifier_createdAt_idx" ON "VendorIntegrationStatusEvent"("vendorIdentifier", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorIntegrationStatusEvent_clientId_vendorAllocationId_id_key" ON "VendorIntegrationStatusEvent"("clientId", "vendorAllocationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "VendorAllocationLineItem_vendorAllocationId_shopifyLineItem_key" ON "VendorAllocationLineItem"("vendorAllocationId", "shopifyLineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPanelVariantDisableOutboxEvent_idempotencyKey_key" ON "ProductPanelVariantDisableOutboxEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProductPanelVariantDisableOutboxEvent_allocationId_idx" ON "ProductPanelVariantDisableOutboxEvent"("allocationId");

-- CreateIndex
CREATE INDEX "ProductPanelVariantDisableOutboxEvent_vendorAllocationLineI_idx" ON "ProductPanelVariantDisableOutboxEvent"("vendorAllocationLineItemId");

-- CreateIndex
CREATE INDEX "ProductPanelVariantDisableOutboxEvent_vendorId_idx" ON "ProductPanelVariantDisableOutboxEvent"("vendorId");

-- CreateIndex
CREATE INDEX "ProductPanelVariantDisableOutboxEvent_shopifyOrderId_idx" ON "ProductPanelVariantDisableOutboxEvent"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "ProductPanelVariantDisableOutboxEvent_status_requestedAt_idx" ON "ProductPanelVariantDisableOutboxEvent"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "AllocationSplitEvent_sourceAllocationId_idx" ON "AllocationSplitEvent"("sourceAllocationId");

-- CreateIndex
CREATE INDEX "AllocationSplitEvent_childAllocationId_idx" ON "AllocationSplitEvent"("childAllocationId");

-- CreateIndex
CREATE INDEX "AllocationSplitEvent_actorUserId_idx" ON "AllocationSplitEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "AllocationSplitEvent_createdAt_idx" ON "AllocationSplitEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationEconomicTransfer_idempotencyKey_key" ON "AllocationEconomicTransfer"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AllocationEconomicTransfer_vendorAllocationId_idx" ON "AllocationEconomicTransfer"("vendorAllocationId");

-- CreateIndex
CREATE INDEX "AllocationEconomicTransfer_fromVendorId_idx" ON "AllocationEconomicTransfer"("fromVendorId");

-- CreateIndex
CREATE INDEX "AllocationEconomicTransfer_toVendorId_idx" ON "AllocationEconomicTransfer"("toVendorId");

-- CreateIndex
CREATE INDEX "AllocationEconomicTransfer_status_idx" ON "AllocationEconomicTransfer"("status");

-- CreateIndex
CREATE INDEX "AllocationEconomicTransfer_createdAt_idx" ON "AllocationEconomicTransfer"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceIntegrityAlert_dedupeKey_key" ON "FinanceIntegrityAlert"("dedupeKey");

-- CreateIndex
CREATE INDEX "FinanceIntegrityAlert_status_idx" ON "FinanceIntegrityAlert"("status");

-- CreateIndex
CREATE INDEX "FinanceIntegrityAlert_category_idx" ON "FinanceIntegrityAlert"("category");

-- CreateIndex
CREATE INDEX "FinanceIntegrityAlert_severity_idx" ON "FinanceIntegrityAlert"("severity");

-- CreateIndex
CREATE INDEX "FinanceIntegrityAlert_detectedAt_idx" ON "FinanceIntegrityAlert"("detectedAt");

-- CreateIndex
CREATE INDEX "FinanceIntegrityAlert_vendorAllocationId_idx" ON "FinanceIntegrityAlert"("vendorAllocationId");

-- CreateIndex
CREATE INDEX "FinanceIntegrityAlert_allocationEconomicTransferId_idx" ON "FinanceIntegrityAlert"("allocationEconomicTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "Fulfillment_vendorAllocationId_key" ON "Fulfillment"("vendorAllocationId");

-- CreateIndex
CREATE INDEX "ReturnRecord_sourceShopifyReturnGid_idx" ON "ReturnRecord"("sourceShopifyReturnGid");

-- CreateIndex
CREATE INDEX "ReturnRecord_sourceShopifyReturnId_idx" ON "ReturnRecord"("sourceShopifyReturnId");

-- CreateIndex
CREATE INDEX "ReturnRecord_ownerVendorId_idx" ON "ReturnRecord"("ownerVendorId");

-- CreateIndex
CREATE INDEX "ReturnRecord_vendorAllocationId_createdAt_idx" ON "ReturnRecord"("vendorAllocationId", "createdAt");

-- CreateIndex
CREATE INDEX "RefundRecord_vendorAllocationId_createdAt_idx" ON "RefundRecord"("vendorAllocationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyRefund_sourceShopifyRefundId_key" ON "ShopifyRefund"("sourceShopifyRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyRefundLineItem_shopifyRefundId_sourceRefundLineItemI_key" ON "ShopifyRefundLineItem"("shopifyRefundId", "sourceRefundLineItemId");

-- CreateIndex
CREATE INDEX "FinanceLedgerEntry_vendorId_entryType_idx" ON "FinanceLedgerEntry"("vendorId", "entryType");

-- CreateIndex
CREATE INDEX "FinanceLedgerEntry_vendorId_settlementStatus_idx" ON "FinanceLedgerEntry"("vendorId", "settlementStatus");

-- CreateIndex
CREATE INDEX "FinanceLedgerEntry_supersededByLedgerId_idx" ON "FinanceLedgerEntry"("supersededByLedgerId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceEvent_idempotencyKey_key" ON "FinanceEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinanceEvent_vendorId_createdAt_idx" ON "FinanceEvent"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceEvent_shopifyOrderId_createdAt_idx" ON "FinanceEvent"("shopifyOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceEvent_financeLedgerEntryId_createdAt_idx" ON "FinanceEvent"("financeLedgerEntryId", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceEvent_eventType_createdAt_idx" ON "FinanceEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceEvent_referenceType_referenceId_idx" ON "FinanceEvent"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementApproval_scheduledCycleKey_key" ON "SettlementApproval"("scheduledCycleKey");

-- CreateIndex
CREATE INDEX "SettlementApproval_vendorId_status_idx" ON "SettlementApproval"("vendorId", "status");

-- CreateIndex
CREATE INDEX "SettlementApproval_vendorId_scheduledCycleKey_idx" ON "SettlementApproval"("vendorId", "scheduledCycleKey");

-- CreateIndex
CREATE INDEX "SettlementApproval_periodStart_periodEnd_idx" ON "SettlementApproval"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "SettlementApproval_createdAt_idx" ON "SettlementApproval"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementScheduleJobRun_runDate_key" ON "SettlementScheduleJobRun"("runDate");

-- CreateIndex
CREATE INDEX "SettlementScheduleJobRun_status_startedAt_idx" ON "SettlementScheduleJobRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "SettlementScheduleJobRun_finishedAt_idx" ON "SettlementScheduleJobRun"("finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementApprovalLine_settlementRefundAdjustmentId_key" ON "SettlementApprovalLine"("settlementRefundAdjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementApprovalLine_settlementRefundAdjustmentApplicatio_key" ON "SettlementApprovalLine"("settlementRefundAdjustmentApplicationId");

-- CreateIndex
CREATE INDEX "SettlementApprovalLine_financeLedgerEntryId_idx" ON "SettlementApprovalLine"("financeLedgerEntryId");

-- CreateIndex
CREATE INDEX "SettlementApprovalLine_lineType_idx" ON "SettlementApprovalLine"("lineType");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementApprovalLine_settlementApprovalId_financeLedgerEn_key" ON "SettlementApprovalLine"("settlementApprovalId", "financeLedgerEntryId");

-- CreateIndex
CREATE INDEX "SettlementCommissionInvoice_settlementApprovalId_idx" ON "SettlementCommissionInvoice"("settlementApprovalId");

-- CreateIndex
CREATE INDEX "SettlementCommissionInvoice_vendorId_idx" ON "SettlementCommissionInvoice"("vendorId");

-- CreateIndex
CREATE INDEX "SettlementCommissionInvoice_provider_idx" ON "SettlementCommissionInvoice"("provider");

-- CreateIndex
CREATE INDEX "SettlementCommissionInvoice_status_idx" ON "SettlementCommissionInvoice"("status");

-- CreateIndex
CREATE INDEX "SettlementCommissionInvoice_providerUuid_idx" ON "SettlementCommissionInvoice"("providerUuid");

-- CreateIndex
CREATE INDEX "SettlementCommissionInvoice_invoiceNo_idx" ON "SettlementCommissionInvoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRefundAdjustment_refundFinanceLedgerEntryId_key" ON "SettlementRefundAdjustment"("refundFinanceLedgerEntryId");

-- CreateIndex
CREATE INDEX "SettlementRefundAdjustment_vendorId_status_idx" ON "SettlementRefundAdjustment"("vendorId", "status");

-- CreateIndex
CREATE INDEX "SettlementRefundAdjustment_refundRecordId_idx" ON "SettlementRefundAdjustment"("refundRecordId");

-- CreateIndex
CREATE INDEX "SettlementRefundAdjustment_originalOrderId_idx" ON "SettlementRefundAdjustment"("originalOrderId");

-- CreateIndex
CREATE INDEX "SettlementRefundAdjustment_originalSettlementApprovalId_idx" ON "SettlementRefundAdjustment"("originalSettlementApprovalId");

-- CreateIndex
CREATE INDEX "SettlementRefundAdjustment_originalSettlementCommissionInvo_idx" ON "SettlementRefundAdjustment"("originalSettlementCommissionInvoiceId");

-- CreateIndex
CREATE INDEX "SettlementRefundAdjustment_appliedSettlementApprovalId_idx" ON "SettlementRefundAdjustment"("appliedSettlementApprovalId");

-- CreateIndex
CREATE INDEX "SettlementRefundAdjustment_createdAt_idx" ON "SettlementRefundAdjustment"("createdAt");

-- CreateIndex
CREATE INDEX "SettlementRefundAdjustmentEvent_settlementRefundAdjustmentI_idx" ON "SettlementRefundAdjustmentEvent"("settlementRefundAdjustmentId", "createdAt");

-- CreateIndex
CREATE INDEX "SettlementRefundAdjustmentEvent_eventType_createdAt_idx" ON "SettlementRefundAdjustmentEvent"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRefundAdjustmentApplication_settlementApprovalLin_key" ON "SettlementRefundAdjustmentApplication"("settlementApprovalLineId");

-- CreateIndex
CREATE INDEX "SettlementRefundAdjustmentApplication_settlementRefundAdjus_idx" ON "SettlementRefundAdjustmentApplication"("settlementRefundAdjustmentId", "status");

-- CreateIndex
CREATE INDEX "SettlementRefundAdjustmentApplication_settlementApprovalId_idx" ON "SettlementRefundAdjustmentApplication"("settlementApprovalId");

-- CreateIndex
CREATE INDEX "SettlementRefundAdjustmentApplication_createdAt_idx" ON "SettlementRefundAdjustmentApplication"("createdAt");

-- CreateIndex
CREATE INDEX "ShipmentShippingCost_vendorId_status_idx" ON "ShipmentShippingCost"("vendorId", "status");

-- CreateIndex
CREATE INDEX "ShipmentShippingCost_allocationId_status_idx" ON "ShipmentShippingCost"("allocationId", "status");

-- CreateIndex
CREATE INDEX "ShipmentShippingCost_sourceShopifyOrderId_idx" ON "ShipmentShippingCost"("sourceShopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorShippingConfig_vendorId_key" ON "VendorShippingConfig"("vendorId");

-- CreateIndex
CREATE INDEX "VendorShippingConfig_vendorId_shippingEnabled_idx" ON "VendorShippingConfig"("vendorId", "shippingEnabled");

-- CreateIndex
CREATE INDEX "VendorShippingWarehouse_configId_isDefault_idx" ON "VendorShippingWarehouse"("configId", "isDefault");

-- CreateIndex
CREATE INDEX "VendorShippingWarehouse_vendorId_provider_isDefault_idx" ON "VendorShippingWarehouse"("vendorId", "provider", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "VendorShippingWarehouse_vendorId_provider_warehouseId_key" ON "VendorShippingWarehouse"("vendorId", "provider", "warehouseId");

-- CreateIndex
CREATE INDEX "ShipmentExecution_sourceShopifyOrderId_idx" ON "ShipmentExecution"("sourceShopifyOrderId");

-- CreateIndex
CREATE INDEX "ShipmentExecution_vendorId_shipmentStatus_idx" ON "ShipmentExecution"("vendorId", "shipmentStatus");

-- CreateIndex
CREATE INDEX "ShipmentExecution_provider_shipmentStatus_idx" ON "ShipmentExecution"("provider", "shipmentStatus");

-- CreateIndex
CREATE INDEX "ShipmentExecution_createdAt_idx" ON "ShipmentExecution"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentExecution_allocationId_provider_key" ON "ShipmentExecution"("allocationId", "provider");

-- CreateIndex
CREATE INDEX "PayoutBatch_vendorId_status_idx" ON "PayoutBatch"("vendorId", "status");

-- CreateIndex
CREATE INDEX "PayoutBatch_createdAt_idx" ON "PayoutBatch"("createdAt");

-- CreateIndex
CREATE INDEX "PayoutBatchLine_financeLedgerEntryId_idx" ON "PayoutBatchLine"("financeLedgerEntryId");

-- CreateIndex
CREATE INDEX "PayoutBatchLine_settlementApprovalLineId_idx" ON "PayoutBatchLine"("settlementApprovalLineId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBatchLine_payoutBatchId_settlementApprovalLineId_key" ON "PayoutBatchLine"("payoutBatchId", "settlementApprovalLineId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBalanceEvent_idempotencyKey_key" ON "VendorBalanceEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "VendorBalanceEvent_vendorId_createdAt_idx" ON "VendorBalanceEvent"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorBalanceEvent_vendorId_currency_idx" ON "VendorBalanceEvent"("vendorId", "currency");

-- CreateIndex
CREATE INDEX "VendorBalanceEvent_type_createdAt_idx" ON "VendorBalanceEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "VendorBalanceEvent_sourceType_sourceId_idx" ON "VendorBalanceEvent"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "VendorBalanceEvent_financeLedgerEntryId_idx" ON "VendorBalanceEvent"("financeLedgerEntryId");

-- CreateIndex
CREATE INDEX "VendorBalanceEvent_refundRecordId_idx" ON "VendorBalanceEvent"("refundRecordId");

-- CreateIndex
CREATE INDEX "VendorBalanceEvent_payoutBatchId_idx" ON "VendorBalanceEvent"("payoutBatchId");

-- CreateIndex
CREATE INDEX "VendorBalanceEvent_settlementApprovalId_idx" ON "VendorBalanceEvent"("settlementApprovalId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_idempotencyKey_key" ON "WebhookEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WebhookEvent_topic_status_executionAvailableAt_receivedAt_idx" ON "WebhookEvent"("topic", "status", "executionAvailableAt", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_topic_status_processingLeaseExpiresAt_idx" ON "WebhookEvent"("topic", "status", "processingLeaseExpiresAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_topic_sourceShopifyOrderId_status_idx" ON "WebhookEvent"("topic", "sourceShopifyOrderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_sourceShopDomain_topic_webhookId_key" ON "WebhookEvent"("sourceShopDomain", "topic", "webhookId");

-- CreateIndex
CREATE INDEX "OperationalJob_status_scheduledAt_idx" ON "OperationalJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "OperationalJob_status_nextRetryAt_idx" ON "OperationalJob"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "OperationalJob_jobType_idx" ON "OperationalJob"("jobType");

-- CreateIndex
CREATE INDEX "OperationalJob_webhookEventId_idx" ON "OperationalJob"("webhookEventId");

-- CreateIndex
CREATE INDEX "OperationalJob_vendorAllocationId_idx" ON "OperationalJob"("vendorAllocationId");

-- CreateIndex
CREATE INDEX "OperationalJob_sourceShopifyOrderId_idx" ON "OperationalJob"("sourceShopifyOrderId");

-- CreateIndex
CREATE INDEX "CanonicalReconciliationRun_startedAt_idx" ON "CanonicalReconciliationRun"("startedAt");

-- CreateIndex
CREATE INDEX "CanonicalReconciliationRun_mode_status_idx" ON "CanonicalReconciliationRun"("mode", "status");

-- CreateIndex
CREATE INDEX "OperationalSignal_status_severity_idx" ON "OperationalSignal"("status", "severity");

-- CreateIndex
CREATE INDEX "OperationalSignal_vendorId_status_idx" ON "OperationalSignal"("vendorId", "status");

-- CreateIndex
CREATE INDEX "OperationalSignal_sourceArea_status_idx" ON "OperationalSignal"("sourceArea", "status");

-- CreateIndex
CREATE INDEX "OperationalSignal_ruleKey_idx" ON "OperationalSignal"("ruleKey");

-- CreateIndex
CREATE INDEX "OperationalSignal_triggeredAt_idx" ON "OperationalSignal"("triggeredAt");

-- CreateIndex
CREATE INDEX "NotificationIntent_recipientRole_status_idx" ON "NotificationIntent"("recipientRole", "status");

-- CreateIndex
CREATE INDEX "NotificationIntent_vendorId_status_idx" ON "NotificationIntent"("vendorId", "status");

-- CreateIndex
CREATE INDEX "NotificationIntent_signalId_idx" ON "NotificationIntent"("signalId");

-- CreateIndex
CREATE INDEX "NotificationIntent_createdAt_idx" ON "NotificationIntent"("createdAt");

-- CreateIndex
CREATE INDEX "AutomationAction_status_type_idx" ON "AutomationAction"("status", "type");

-- CreateIndex
CREATE INDEX "AutomationAction_vendorId_status_idx" ON "AutomationAction"("vendorId", "status");

-- CreateIndex
CREATE INDEX "AutomationAction_signalId_idx" ON "AutomationAction"("signalId");

-- CreateIndex
CREATE INDEX "AutomationAction_createdAt_idx" ON "AutomationAction"("createdAt");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketNote" ADD CONSTRAINT "SupportTicketNote_supportTicketId_fkey" FOREIGN KEY ("supportTicketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketNote" ADD CONSTRAINT "SupportTicketNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketReply" ADD CONSTRAINT "SupportTicketReply_supportTicketId_fkey" FOREIGN KEY ("supportTicketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketReply" ADD CONSTRAINT "SupportTicketReply_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorFinancialProfile" ADD CONSTRAINT "VendorFinancialProfile_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillingProfile" ADD CONSTRAINT "VendorBillingProfile_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorProfileAuditLog" ADD CONSTRAINT "VendorProfileAuditLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVendorAccess" ADD CONSTRAINT "UserVendorAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVendorAccess" ADD CONSTRAINT "UserVendorAccess_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIntegrationAuditLog" ADD CONSTRAINT "VendorIntegrationAuditLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "VendorIntegrationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyOrderLineItem" ADD CONSTRAINT "ShopifyOrderLineItem_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocation" ADD CONSTRAINT "VendorAllocation_sourceShopifyOrderId_fkey" FOREIGN KEY ("sourceShopifyOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocation" ADD CONSTRAINT "VendorAllocation_originalVendorId_fkey" FOREIGN KEY ("originalVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocation" ADD CONSTRAINT "VendorAllocation_assignedVendorId_fkey" FOREIGN KEY ("assignedVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundShopifyRefundAttempt" ADD CONSTRAINT "OutboundShopifyRefundAttempt_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundShopifyRefundAttempt" ADD CONSTRAINT "OutboundShopifyRefundAttempt_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderShippingRefundClaim" ADD CONSTRAINT "OrderShippingRefundClaim_ownerAttemptId_fkey" FOREIGN KEY ("ownerAttemptId") REFERENCES "OutboundShopifyRefundAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIntegrationInvoiceEvent" ADD CONSTRAINT "VendorIntegrationInvoiceEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "VendorIntegrationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIntegrationInvoiceEvent" ADD CONSTRAINT "VendorIntegrationInvoiceEvent_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIntegrationShipmentEvent" ADD CONSTRAINT "VendorIntegrationShipmentEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "VendorIntegrationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIntegrationShipmentEvent" ADD CONSTRAINT "VendorIntegrationShipmentEvent_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIntegrationStatusEvent" ADD CONSTRAINT "VendorIntegrationStatusEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "VendorIntegrationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIntegrationStatusEvent" ADD CONSTRAINT "VendorIntegrationStatusEvent_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocationLineItem" ADD CONSTRAINT "VendorAllocationLineItem_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocationLineItem" ADD CONSTRAINT "VendorAllocationLineItem_shopifyLineItemId_fkey" FOREIGN KEY ("shopifyLineItemId") REFERENCES "ShopifyOrderLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPanelVariantDisableOutboxEvent" ADD CONSTRAINT "ProductPanelVariantDisableOutboxEvent_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPanelVariantDisableOutboxEvent" ADD CONSTRAINT "ProductPanelVariantDisableOutboxEvent_vendorAllocationLine_fkey" FOREIGN KEY ("vendorAllocationLineItemId") REFERENCES "VendorAllocationLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationAssignmentHistory" ADD CONSTRAINT "AllocationAssignmentHistory_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationAssignmentHistory" ADD CONSTRAINT "AllocationAssignmentHistory_fromVendorId_fkey" FOREIGN KEY ("fromVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationAssignmentHistory" ADD CONSTRAINT "AllocationAssignmentHistory_toVendorId_fkey" FOREIGN KEY ("toVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationAssignmentHistory" ADD CONSTRAINT "AllocationAssignmentHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationSplitEvent" ADD CONSTRAINT "AllocationSplitEvent_sourceAllocationId_fkey" FOREIGN KEY ("sourceAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationSplitEvent" ADD CONSTRAINT "AllocationSplitEvent_childAllocationId_fkey" FOREIGN KEY ("childAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationSplitEvent" ADD CONSTRAINT "AllocationSplitEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationSplitEvent" ADD CONSTRAINT "AllocationSplitEvent_sourceFinanceLedgerEntryId_fkey" FOREIGN KEY ("sourceFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationSplitEvent" ADD CONSTRAINT "AllocationSplitEvent_remainingFinanceLedgerEntryId_fkey" FOREIGN KEY ("remainingFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationSplitEvent" ADD CONSTRAINT "AllocationSplitEvent_childFinanceLedgerEntryId_fkey" FOREIGN KEY ("childFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationEconomicTransfer" ADD CONSTRAINT "AllocationEconomicTransfer_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationEconomicTransfer" ADD CONSTRAINT "AllocationEconomicTransfer_fromVendorId_fkey" FOREIGN KEY ("fromVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationEconomicTransfer" ADD CONSTRAINT "AllocationEconomicTransfer_toVendorId_fkey" FOREIGN KEY ("toVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationEconomicTransfer" ADD CONSTRAINT "AllocationEconomicTransfer_fromFinanceLedgerEntryId_fkey" FOREIGN KEY ("fromFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationEconomicTransfer" ADD CONSTRAINT "AllocationEconomicTransfer_toFinanceLedgerEntryId_fkey" FOREIGN KEY ("toFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationEconomicTransfer" ADD CONSTRAINT "AllocationEconomicTransfer_adminActorUserId_fkey" FOREIGN KEY ("adminActorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceIntegrityAlert" ADD CONSTRAINT "FinanceIntegrityAlert_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceIntegrityAlert" ADD CONSTRAINT "FinanceIntegrityAlert_allocationEconomicTransferId_fkey" FOREIGN KEY ("allocationEconomicTransferId") REFERENCES "AllocationEconomicTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceIntegrityAlert" ADD CONSTRAINT "FinanceIntegrityAlert_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceIntegrityAlert" ADD CONSTRAINT "FinanceIntegrityAlert_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRecord" ADD CONSTRAINT "ReturnRecord_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRecord" ADD CONSTRAINT "ReturnRecord_ownerVendorId_fkey" FOREIGN KEY ("ownerVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRecord" ADD CONSTRAINT "RefundRecord_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyRefund" ADD CONSTRAINT "ShopifyRefund_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyRefundLineItem" ADD CONSTRAINT "ShopifyRefundLineItem_shopifyRefundId_fkey" FOREIGN KEY ("shopifyRefundId") REFERENCES "ShopifyRefund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyRefundLineItem" ADD CONSTRAINT "ShopifyRefundLineItem_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES "RefundRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyRefundLineItem" ADD CONSTRAINT "ShopifyRefundLineItem_shopifyOrderLineItemId_fkey" FOREIGN KEY ("shopifyOrderLineItemId") REFERENCES "ShopifyOrderLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceLedgerEntry" ADD CONSTRAINT "FinanceLedgerEntry_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceLedgerEntry" ADD CONSTRAINT "FinanceLedgerEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceLedgerEntry" ADD CONSTRAINT "FinanceLedgerEntry_supersededByLedgerId_fkey" FOREIGN KEY ("supersededByLedgerId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEvent" ADD CONSTRAINT "FinanceEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEvent" ADD CONSTRAINT "FinanceEvent_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEvent" ADD CONSTRAINT "FinanceEvent_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementApproval" ADD CONSTRAINT "SettlementApproval_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementApprovalLine" ADD CONSTRAINT "SettlementApprovalLine_settlementApprovalId_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementApprovalLine" ADD CONSTRAINT "SettlementApprovalLine_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementApprovalLine" ADD CONSTRAINT "SettlementApprovalLine_settlementRefundAdjustmentApplicati_fkey" FOREIGN KEY ("settlementRefundAdjustmentApplicationId") REFERENCES "SettlementRefundAdjustmentApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementCommissionInvoice" ADD CONSTRAINT "SettlementCommissionInvoice_settlementApprovalId_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementCommissionInvoice" ADD CONSTRAINT "SettlementCommissionInvoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES "RefundRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_refundFinanceLedgerEntryId_fkey" FOREIGN KEY ("refundFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_originalOrderId_fkey" FOREIGN KEY ("originalOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_originalSettlementApprovalId_fkey" FOREIGN KEY ("originalSettlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_originalSettlementApprovalLineI_fkey" FOREIGN KEY ("originalSettlementApprovalLineId") REFERENCES "SettlementApprovalLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_originalSettlementCommissionInv_fkey" FOREIGN KEY ("originalSettlementCommissionInvoiceId") REFERENCES "SettlementCommissionInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_appliedSettlementApprovalId_fkey" FOREIGN KEY ("appliedSettlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_appliedSettlementApprovalLineId_fkey" FOREIGN KEY ("appliedSettlementApprovalLineId") REFERENCES "SettlementApprovalLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustmentEvent" ADD CONSTRAINT "SettlementRefundAdjustmentEvent_settlementRefundAdjustment_fkey" FOREIGN KEY ("settlementRefundAdjustmentId") REFERENCES "SettlementRefundAdjustment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustmentApplication" ADD CONSTRAINT "SettlementRefundAdjustmentApplication_settlementRefundAdju_fkey" FOREIGN KEY ("settlementRefundAdjustmentId") REFERENCES "SettlementRefundAdjustment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustmentApplication" ADD CONSTRAINT "SettlementRefundAdjustmentApplication_settlementApprovalId_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundAdjustmentApplication" ADD CONSTRAINT "SettlementRefundAdjustmentApplication_settlementApprovalLi_fkey" FOREIGN KEY ("settlementApprovalLineId") REFERENCES "SettlementApprovalLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentShippingCost" ADD CONSTRAINT "ShipmentShippingCost_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentShippingCost" ADD CONSTRAINT "ShipmentShippingCost_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorShippingConfig" ADD CONSTRAINT "VendorShippingConfig_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorShippingWarehouse" ADD CONSTRAINT "VendorShippingWarehouse_configId_fkey" FOREIGN KEY ("configId") REFERENCES "VendorShippingConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorShippingWarehouse" ADD CONSTRAINT "VendorShippingWarehouse_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentExecution" ADD CONSTRAINT "ShipmentExecution_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentExecution" ADD CONSTRAINT "ShipmentExecution_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatch" ADD CONSTRAINT "PayoutBatch_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatchLine" ADD CONSTRAINT "PayoutBatchLine_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatchLine" ADD CONSTRAINT "PayoutBatchLine_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatchLine" ADD CONSTRAINT "PayoutBatchLine_settlementApprovalLineId_fkey" FOREIGN KEY ("settlementApprovalLineId") REFERENCES "SettlementApprovalLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBalanceEvent" ADD CONSTRAINT "VendorBalanceEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBalanceEvent" ADD CONSTRAINT "VendorBalanceEvent_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBalanceEvent" ADD CONSTRAINT "VendorBalanceEvent_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES "RefundRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBalanceEvent" ADD CONSTRAINT "VendorBalanceEvent_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBalanceEvent" ADD CONSTRAINT "VendorBalanceEvent_settlementApprovalId_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalJob" ADD CONSTRAINT "OperationalJob_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "WebhookEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalJob" ADD CONSTRAINT "OperationalJob_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalJob" ADD CONSTRAINT "OperationalJob_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES "RefundRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalJob" ADD CONSTRAINT "OperationalJob_returnRecordId_fkey" FOREIGN KEY ("returnRecordId") REFERENCES "ReturnRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalSignal" ADD CONSTRAINT "OperationalSignal_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalSignal" ADD CONSTRAINT "OperationalSignal_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "VendorAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalSignal" ADD CONSTRAINT "OperationalSignal_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalSignal" ADD CONSTRAINT "OperationalSignal_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalSignal" ADD CONSTRAINT "OperationalSignal_operationalJobId_fkey" FOREIGN KEY ("operationalJobId") REFERENCES "OperationalJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationIntent" ADD CONSTRAINT "NotificationIntent_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "OperationalSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationIntent" ADD CONSTRAINT "NotificationIntent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "OperationalSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "VendorAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_operationalJobId_fkey" FOREIGN KEY ("operationalJobId") REFERENCES "OperationalJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
