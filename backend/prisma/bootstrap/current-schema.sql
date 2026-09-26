--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: AllocationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AllocationStatus" AS ENUM (
    'ACTIVE',
    'VENDOR_BLOCKED',
    'PENDING_REASSIGNMENT',
    'REASSIGNED',
    'FULFILLED'
);


--
-- Name: AutomationActionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AutomationActionStatus" AS ENUM (
    'PENDING',
    'SUGGESTED',
    'EXECUTED',
    'SKIPPED',
    'FAILED',
    'CANCELLED'
);


--
-- Name: AutomationActionType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AutomationActionType" AS ENUM (
    'SUGGEST_REPLAY_WEBHOOK',
    'SUGGEST_RECONCILIATION',
    'SUGGEST_PAYOUT_BATCH_REVIEW',
    'SUGGEST_SHIPPING_COST_ATTACHMENT',
    'SUGGEST_STALE_FULFILLMENT_REVIEW',
    'SUGGEST_PAYOUT_REVIEW',
    'SUGGEST_NEGATIVE_PAYOUT_INVESTIGATION',
    'SUGGEST_DEAD_LETTER_INVESTIGATION',
    'AUTO_CREATE_RECONCILIATION_CANDIDATE',
    'AUTO_GENERATE_REMINDER_NOTIFICATION',
    'AUTO_PRIORITIZE_STALE_QUEUE_ITEM'
);


--
-- Name: AutomationExecutionMode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AutomationExecutionMode" AS ENUM (
    'MANUAL',
    'ASSISTED',
    'AUTO_SAFE'
);


--
-- Name: CancellationReason; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CancellationReason" AS ENUM (
    'OUT_OF_STOCK',
    'VENDOR_CANCELLED',
    'DAMAGED_INVENTORY',
    'FULFILLMENT_ISSUE'
);


--
-- Name: CustomerCancellationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CustomerCancellationStatus" AS ENUM (
    'PENDING',
    'PARTIALLY_RESOLVED',
    'APPROVED_FOR_REFUND',
    'REFUNDED_AWAITING_ORDER_CANCEL',
    'APPROVED',
    'DECLINED',
    'TOO_LATE',
    'CONFLICTED'
);


--
-- Name: FinanceEventType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."FinanceEventType" AS ENUM (
    'SALE_RECORDED',
    'COMMISSION_RESERVED',
    'COMMISSION_VAT_RESERVED',
    'VENDOR_PAYABLE_RESERVED',
    'REFUND_RECORDED',
    'COMMISSION_REVERSED',
    'COMMISSION_VAT_REVERSED',
    'VENDOR_PAYABLE_REVERSED',
    'MANUAL_ADJUSTMENT',
    'PAYOUT_PAID'
);


--
-- Name: LegacyRefundFinanceArtifactType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LegacyRefundFinanceArtifactType" AS ENUM (
    'REFUND_LEDGER',
    'SETTLEMENT_REFUND_ADJUSTMENT',
    'VENDOR_DEBT_EVENT',
    'FINANCE_EVENT'
);


--
-- Name: LegacyRefundFinanceAttribution; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LegacyRefundFinanceAttribution" AS ENUM (
    'EXACT',
    'AMBIGUOUS'
);


--
-- Name: LegacyRefundFinanceResolutionOutcome; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LegacyRefundFinanceResolutionOutcome" AS ENUM (
    'NO_CORRECTION_NEEDED',
    'CORRECTION_REQUIRED',
    'INSUFFICIENT_EVIDENCE'
);


--
-- Name: LegacyRefundFinanceReviewEventType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LegacyRefundFinanceReviewEventType" AS ENUM (
    'DETECTED',
    'ACKNOWLEDGED',
    'RESOLVED',
    'REOPENED'
);


--
-- Name: LegacyRefundFinanceReviewStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LegacyRefundFinanceReviewStatus" AS ENUM (
    'ACTIVE',
    'ACKNOWLEDGED',
    'RESOLVED'
);


--
-- Name: NotificationChannel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."NotificationChannel" AS ENUM (
    'IN_APP',
    'EMAIL_PLACEHOLDER',
    'SLACK_PLACEHOLDER'
);


--
-- Name: NotificationRecipientRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."NotificationRecipientRole" AS ENUM (
    'ADMIN',
    'VENDOR'
);


--
-- Name: NotificationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."NotificationStatus" AS ENUM (
    'PENDING',
    'DELIVERED',
    'READ',
    'DISMISSED',
    'SKIPPED',
    'FAILED'
);


--
-- Name: OperationalJobStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OperationalJobStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'RETRY_SCHEDULED',
    'RETRYING',
    'DEAD_LETTER_READY',
    'PERMANENTLY_FAILED'
);


--
-- Name: OperationalJobType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OperationalJobType" AS ENUM (
    'WEBHOOK_PROCESSING',
    'RECONCILIATION',
    'REPLAY',
    'RECOVERY',
    'FULFILLMENT_SYNC',
    'REFUND_SYNC',
    'RETURN_SYNC'
);


--
-- Name: OperationalSignalSeverity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OperationalSignalSeverity" AS ENUM (
    'INFO',
    'WARNING',
    'HIGH',
    'CRITICAL'
);


--
-- Name: OperationalSignalSourceArea; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OperationalSignalSourceArea" AS ENUM (
    'PAYOUT',
    'REFUND',
    'FULFILLMENT',
    'DIAGNOSTICS',
    'RECONCILIATION',
    'SHIPPING_COST',
    'SETTLEMENT'
);


--
-- Name: OperationalSignalStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OperationalSignalStatus" AS ENUM (
    'ACTIVE',
    'ACKNOWLEDGED',
    'RESOLVED',
    'IGNORED'
);


--
-- Name: PayoutBatchStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PayoutBatchStatus" AS ENUM (
    'DRAFT',
    'REVIEW',
    'APPROVED',
    'CANCELLED',
    'EXECUTION_PENDING',
    'PAID',
    'PAID_PLACEHOLDER'
);


--
-- Name: PayoutStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PayoutStatus" AS ENUM (
    'PENDING',
    'APPROVED',
    'PAID',
    'HOLD'
);


--
-- Name: ProductPanelVariantDisableOutboxStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ProductPanelVariantDisableOutboxStatus" AS ENUM (
    'CREATED',
    'RESOLVED',
    'RESOLVED_DRY_RUN',
    'FAILED'
);


--
-- Name: RefundTerminalEvidenceResolutionOutcome; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RefundTerminalEvidenceResolutionOutcome" AS ENUM (
    'NO_CORRECTION_NEEDED',
    'CORRECTION_REQUIRED',
    'INSUFFICIENT_EVIDENCE'
);


--
-- Name: RefundTerminalEvidenceReviewEventType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RefundTerminalEvidenceReviewEventType" AS ENUM (
    'DETECTED',
    'ACKNOWLEDGED',
    'RESOLVED',
    'REOPENED'
);


--
-- Name: RefundTerminalEvidenceReviewStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RefundTerminalEvidenceReviewStatus" AS ENUM (
    'ACTIVE',
    'ACKNOWLEDGED',
    'RESOLVED'
);


--
-- Name: SettlementApprovalLineType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementApprovalLineType" AS ENUM (
    'SALE',
    'REFUND',
    'REFUND_ADJUSTMENT'
);


--
-- Name: SettlementApprovalStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementApprovalStatus" AS ENUM (
    'DRAFT',
    'APPROVED',
    'CANCELLED'
);


--
-- Name: SettlementCommissionInvoiceProvider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementCommissionInvoiceProvider" AS ENUM (
    'LOGO_ISBASI'
);


--
-- Name: SettlementCommissionInvoiceStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementCommissionInvoiceStatus" AS ENUM (
    'PENDING',
    'CREATED',
    'FAILED',
    'CANCELLED',
    'UNKNOWN'
);


--
-- Name: SettlementFrequencyType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementFrequencyType" AS ENUM (
    'WEEKLY',
    'BIWEEKLY'
);


--
-- Name: SettlementRefundAdjustmentApplicationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementRefundAdjustmentApplicationStatus" AS ENUM (
    'ACTIVE',
    'CANCELLED'
);


--
-- Name: SettlementRefundAdjustmentEventType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementRefundAdjustmentEventType" AS ENUM (
    'CREATED',
    'PARTIALLY_APPLIED',
    'APPLIED',
    'APPLICATION_CANCELLED',
    'ADJUSTMENT_CANCELLED'
);


--
-- Name: SettlementRefundAdjustmentStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementRefundAdjustmentStatus" AS ENUM (
    'PENDING',
    'PARTIALLY_APPLIED',
    'APPLIED',
    'BLOCKED',
    'CANCELLED'
);


--
-- Name: SettlementScheduleJobRunStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementScheduleJobRunStatus" AS ENUM (
    'PROCESSING',
    'DRY_RUN',
    'COMPLETED',
    'BLOCKED',
    'FAILED'
);


--
-- Name: SettlementStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementStatus" AS ENUM (
    'PENDING',
    'ACCRUING',
    'PAYABLE',
    'PARTIALLY_REFUNDED',
    'HELD',
    'SETTLED',
    'DISPUTED'
);


--
-- Name: SettlementWeekday; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementWeekday" AS ENUM (
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY'
);


--
-- Name: ShipmentExecutionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ShipmentExecutionStatus" AS ENUM (
    'PENDING',
    'CREATED',
    'FAILED',
    'IN_TRANSIT',
    'DELIVERED',
    'RETURNED',
    'CANCELLED'
);


--
-- Name: ShippingCostSourceType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ShippingCostSourceType" AS ENUM (
    'MANUAL',
    'IMPORTED',
    'EXTERNAL_PROVIDER'
);


--
-- Name: ShippingCostStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ShippingCostStatus" AS ENUM (
    'PENDING',
    'CONFIRMED',
    'DISPUTED',
    'IGNORED'
);


--
-- Name: ShippingDeductionMode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ShippingDeductionMode" AS ENUM (
    'DISABLED',
    'FIXED',
    'EXTERNAL_PROVIDER'
);


--
-- Name: ShippingProvider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ShippingProvider" AS ENUM (
    'HEPSIJET',
    'KARGO_ENTEGRATOR',
    'TRY_OTO',
    'KARGONOMI',
    'NAVLUNGO',
    'MNG',
    'YURTICI',
    'ARAS'
);


--
-- Name: UserRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."UserRole" AS ENUM (
    'ADMIN',
    'VENDOR',
    'SUPPORT',
    'FINANCE'
);


--
-- Name: VendorBalanceEventType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."VendorBalanceEventType" AS ENUM (
    'PAYABLE_EARNED',
    'VENDOR_DEBT_CREATED',
    'VENDOR_DEBT_OFFSET',
    'MANUAL_ADJUSTMENT',
    'DEBT_WAIVED'
);


--
-- Name: VendorProfileSnapshotImpact; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."VendorProfileSnapshotImpact" AS ENUM (
    'FUTURE_LEDGER_ROWS_ONLY',
    'FUTURE_SETTLEMENT_APPROVALS_ONLY',
    'FUTURE_COMMISSION_INVOICES_ONLY',
    'FUTURE_SHIPMENTS_ONLY',
    'FUTURE_RETURNS_ONLY',
    'FUTURE_SHIPMENTS_AND_RETURNS_ONLY',
    'EXISTING_SETTLEMENTS_UNCHANGED',
    'PROVIDER_REBIND_REQUIRED',
    'FUTURE_PAYOUT_RELEVANT',
    'DIAGNOSTIC_ONLY',
    'UNKNOWN'
);


--
-- Name: WebhookStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."WebhookStatus" AS ENUM (
    'RECEIVED',
    'PROCESSING',
    'PROCESSED',
    'FAILED'
);


--
-- Name: checkApprovedDeductionCoverage(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public."checkApprovedDeductionCoverage"() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE source_vendor TEXT; source_currency TEXT; source_amount INTEGER;
DECLARE source_route TEXT; source_approval TEXT; approval_vendor TEXT; approval_currency TEXT;
BEGIN
  SELECT d."vendorId", d."currency", d."amountMinor", a."applicationRoute", a."historicalApprovedSettlementId"
    INTO source_vendor, source_currency, source_amount, source_route, source_approval
    FROM "FinancialCorrectionDeduction" d JOIN "FinancialCorrectionAuthority" a ON a."id" = d."authorityId"
    WHERE d."id" = NEW."deductionId";
  SELECT "vendorId", "currency" INTO approval_vendor, approval_currency
    FROM "SettlementApproval" WHERE "id" = NEW."settlementApprovalId";
  IF source_route NOT IN ('APPROVED_SETTLEMENT_VENDOR_DEDUCTION', 'DRAFT_PAYOUT_VENDOR_DEDUCTION', 'REVIEW_PAYOUT_VENDOR_DEDUCTION') OR
     source_approval IS DISTINCT FROM NEW."settlementApprovalId" OR
     source_vendor IS DISTINCT FROM NEW."vendorId" OR source_currency IS DISTINCT FROM NEW."currency" OR
     source_amount IS DISTINCT FROM NEW."amountMinor" OR
     approval_vendor IS DISTINCT FROM NEW."vendorId" OR approval_currency IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION 'Approved deduction coverage must match its source and origin approval';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: checkFinancialCorrectionDebtDirection(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public."checkFinancialCorrectionDebtDirection"() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE direction TEXT;
DECLARE route TEXT;
BEGIN
  IF NEW."financialCorrectionAuthorityId" IS NULL THEN RETURN NEW; END IF;
  SELECT "economicDirection", "applicationRoute" INTO direction, route FROM "FinancialCorrectionAuthority" WHERE "id" = NEW."financialCorrectionAuthorityId";
  IF direction IS DISTINCT FROM 'VENDOR_DEDUCTION' OR route IS DISTINCT FROM 'PAID_VENDOR_DEBT' THEN
    RAISE EXCEPTION 'Financial correction debt requires PAID_VENDOR_DEBT authority';
  END IF;
  IF EXISTS (SELECT 1 FROM "FinancialCorrectionCredit" WHERE "authorityId" = NEW."financialCorrectionAuthorityId") OR
     EXISTS (SELECT 1 FROM "FinancialCorrectionDeduction" WHERE "authorityId" = NEW."financialCorrectionAuthorityId") THEN
    RAISE EXCEPTION 'Financial correction cannot have multiple economic effects';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: checkFinancialCorrectionDeductionDirection(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public."checkFinancialCorrectionDeductionDirection"() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE authority_route TEXT; authority_direction TEXT; authority_vendor TEXT;
DECLARE authority_currency TEXT; authority_delta INTEGER;
BEGIN
  SELECT "applicationRoute", "economicDirection", "vendorId", "currency", "vendorPayableDifferenceMinor"
    INTO authority_route, authority_direction, authority_vendor, authority_currency, authority_delta
    FROM "FinancialCorrectionAuthority" WHERE "id" = NEW."authorityId";
  IF authority_route NOT IN ('BEFORE_SETTLEMENT_VENDOR_DEDUCTION', 'APPROVED_SETTLEMENT_VENDOR_DEDUCTION', 'DRAFT_PAYOUT_VENDOR_DEDUCTION', 'REVIEW_PAYOUT_VENDOR_DEDUCTION') OR
     authority_direction IS DISTINCT FROM 'VENDOR_DEDUCTION' OR
     authority_vendor IS DISTINCT FROM NEW."vendorId" OR
     authority_currency IS DISTINCT FROM NEW."currency" OR
     authority_delta IS DISTINCT FROM NEW."amountMinor" THEN
    RAISE EXCEPTION 'Financial correction deduction requires matching deduction authority';
  END IF;
  IF EXISTS (SELECT 1 FROM "VendorBalanceEvent" WHERE "financialCorrectionAuthorityId" = NEW."authorityId") OR
     EXISTS (SELECT 1 FROM "FinancialCorrectionCredit" WHERE "authorityId" = NEW."authorityId") THEN
    RAISE EXCEPTION 'Financial correction cannot have multiple economic effects';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: checkFinancialCorrectionEffectDirection(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public."checkFinancialCorrectionEffectDirection"() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE direction TEXT; route TEXT; authority_vendor_id TEXT; authority_currency TEXT;
DECLARE authority_difference_minor INTEGER; payout_id TEXT; payout_paid_at TIMESTAMP(3); approval_id TEXT;
BEGIN
  SELECT "economicDirection", "applicationRoute", "vendorId", "currency", "vendorPayableDifferenceMinor",
         "historicalPayoutBatchId", "historicalPayoutPaidAt", "historicalApprovedSettlementId"
  INTO direction, route, authority_vendor_id, authority_currency, authority_difference_minor,
       payout_id, payout_paid_at, approval_id
  FROM "FinancialCorrectionAuthority" WHERE "id" = NEW."authorityId";
  IF direction IS DISTINCT FROM 'VENDOR_CREDIT' OR
     NOT ((route = 'PAID_VENDOR_CREDIT' AND payout_id IS NOT NULL AND payout_paid_at IS NOT NULL AND approval_id IS NULL) OR
          (route = 'BEFORE_SETTLEMENT_VENDOR_CREDIT' AND payout_id IS NULL AND payout_paid_at IS NULL AND approval_id IS NULL) OR
          (route = 'APPROVED_SETTLEMENT_VENDOR_CREDIT' AND payout_id IS NULL AND payout_paid_at IS NULL AND approval_id IS NOT NULL) OR
          (route IN ('DRAFT_PAYOUT_VENDOR_CREDIT', 'REVIEW_PAYOUT_VENDOR_CREDIT') AND payout_id IS NOT NULL AND payout_paid_at IS NULL AND approval_id IS NOT NULL)) OR
     authority_vendor_id IS DISTINCT FROM NEW."vendorId" OR authority_currency IS DISTINCT FROM NEW."currency" OR
     authority_difference_minor IS DISTINCT FROM -NEW."amountMinor" THEN
    RAISE EXCEPTION 'Financial correction credit requires eligible VENDOR_CREDIT authority';
  END IF;
  IF EXISTS (SELECT 1 FROM "VendorBalanceEvent" WHERE "financialCorrectionAuthorityId" = NEW."authorityId") OR
     EXISTS (SELECT 1 FROM "FinancialCorrectionDeduction" WHERE "authorityId" = NEW."authorityId") THEN
    RAISE EXCEPTION 'Financial correction cannot have multiple economic effects';
  END IF;
  RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: AllocationAssignmentHistory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AllocationAssignmentHistory" (
    id text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    action text NOT NULL,
    "fromVendorId" text,
    "toVendorId" text NOT NULL,
    reason text,
    "actorUserId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: AllocationEconomicTransfer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AllocationEconomicTransfer" (
    id text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "fromVendorId" text NOT NULL,
    "toVendorId" text NOT NULL,
    "fromFinanceLedgerEntryId" text,
    "toFinanceLedgerEntryId" text,
    status text NOT NULL,
    reason text,
    "adminActorUserId" text,
    "pricingSnapshotJson" jsonb,
    "idempotencyKey" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "failedAt" timestamp(3) without time zone,
    "failureReason" text
);


--
-- Name: AllocationFullRefundTerminalFact; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AllocationFullRefundTerminalFact" (
    id text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "shopifyOrderGid" text NOT NULL,
    "verificationSource" text NOT NULL,
    "shopifyApiVersion" text NOT NULL,
    "verifiedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "evidenceJson" jsonb NOT NULL
);


--
-- Name: AllocationSplitEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AllocationSplitEvent" (
    id text NOT NULL,
    "sourceAllocationId" text NOT NULL,
    "childAllocationId" text NOT NULL,
    reason text NOT NULL,
    note text,
    "actorUserId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "movedVendorAllocationLineItemIdsJson" jsonb,
    "movedShopifyLineItemIdsJson" jsonb,
    "sourceFinanceLedgerEntryId" text,
    "remainingFinanceLedgerEntryId" text,
    "childFinanceLedgerEntryId" text,
    "metadataJson" jsonb
);


--
-- Name: AutomationAction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AutomationAction" (
    id text NOT NULL,
    "signalId" text,
    type public."AutomationActionType" NOT NULL,
    status public."AutomationActionStatus" DEFAULT 'SUGGESTED'::public."AutomationActionStatus" NOT NULL,
    "executionMode" public."AutomationExecutionMode" DEFAULT 'MANUAL'::public."AutomationExecutionMode" NOT NULL,
    "vendorId" text,
    "allocationId" text,
    "financeLedgerEntryId" text,
    "payoutBatchId" text,
    "operationalJobId" text,
    title text NOT NULL,
    description text NOT NULL,
    "resultSummary" text,
    "executedAt" timestamp(3) without time zone,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: CanonicalReconciliationRun; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CanonicalReconciliationRun" (
    id text NOT NULL,
    mode text NOT NULL,
    status text NOT NULL,
    "startedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "finishedAt" timestamp(3) without time zone,
    "durationMs" integer,
    "lookbackDays" integer NOT NULL,
    "orderLimit" integer NOT NULL,
    "ordersScanned" integer DEFAULT 0 NOT NULL,
    "repairOpportunities" integer DEFAULT 0 NOT NULL,
    "wouldRepairOrders" integer DEFAULT 0 NOT NULL,
    "wouldRepairFulfillment" integer DEFAULT 0 NOT NULL,
    "wouldRepairRefunds" integer DEFAULT 0 NOT NULL,
    "wouldRepairReturns" integer DEFAULT 0 NOT NULL,
    "wouldRepairCancellations" integer DEFAULT 0 NOT NULL,
    "wouldCreateSignals" integer DEFAULT 0 NOT NULL,
    "wouldRepairLedgers" integer DEFAULT 0 NOT NULL,
    "wouldRepairFinanceEvents" integer DEFAULT 0 NOT NULL,
    "errorsJson" jsonb,
    "perOrderDetailsJson" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: CustomerCancellationRequest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CustomerCancellationRequest" (
    id text NOT NULL,
    "shopifyOrderId" text NOT NULL,
    "shopDomain" text NOT NULL,
    "shopifyCustomerId" text NOT NULL,
    status public."CustomerCancellationStatus" DEFAULT 'PENDING'::public."CustomerCancellationStatus" NOT NULL,
    "reasonCode" text NOT NULL,
    "customerNote" text,
    "idempotencyKey" text NOT NULL,
    "requestedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "resolvedAt" timestamp(3) without time zone,
    "reviewedByUserId" text,
    "reviewReason" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: CustomerCancellationRequestItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CustomerCancellationRequestItem" (
    id text NOT NULL,
    "requestId" text NOT NULL,
    "shopifyOrderLineItemId" text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "requestedQuantity" integer NOT NULL,
    "resolvedQuantity" integer,
    status public."CustomerCancellationStatus" DEFAULT 'PENDING'::public."CustomerCancellationStatus" NOT NULL,
    "reviewedByUserId" text,
    "reviewReason" text,
    "reviewedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: FinanceEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinanceEvent" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "vendorId" text NOT NULL,
    "shopifyOrderId" text,
    "financeLedgerEntryId" text,
    "eventType" public."FinanceEventType" NOT NULL,
    "amountMinor" integer NOT NULL,
    currency text DEFAULT 'TRY'::text NOT NULL,
    "referenceType" text NOT NULL,
    "referenceId" text NOT NULL,
    "metadataJson" jsonb,
    "createdBy" text NOT NULL,
    "idempotencyKey" text NOT NULL
);


--
-- Name: FinanceIntegrityAlert; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinanceIntegrityAlert" (
    id text NOT NULL,
    "dedupeKey" text NOT NULL,
    severity text NOT NULL,
    category text NOT NULL,
    "vendorAllocationId" text,
    "allocationEconomicTransferId" text,
    "affectedLedgerIds" jsonb,
    "affectedFinanceEventIds" jsonb,
    reason text NOT NULL,
    status text NOT NULL,
    "acknowledgedAt" timestamp(3) without time zone,
    "acknowledgedByUserId" text,
    "acknowledgmentNote" text,
    "resolutionNote" text,
    "resolutionValidationJson" jsonb,
    "resolutionType" text,
    "detectedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "resolvedAt" timestamp(3) without time zone,
    "resolvedByUserId" text,
    "metadataJson" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: FinanceLedgerEntry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinanceLedgerEntry" (
    id text NOT NULL,
    "vendorAllocationId" text,
    "vendorId" text NOT NULL,
    "entryType" text NOT NULL,
    amount numeric(10,2) NOT NULL,
    "payoutStatus" public."PayoutStatus" DEFAULT 'PENDING'::public."PayoutStatus" NOT NULL,
    description text,
    "commissionPercentSnapshot" numeric(5,2),
    "commissionVatPercentSnapshot" numeric(5,2),
    "deductShippingEnabledSnapshot" boolean,
    "shippingModeSnapshot" public."ShippingDeductionMode",
    "fixedShippingFeeSnapshot" numeric(10,2),
    "shippingCostSnapshot" numeric(10,2),
    "shippingVatAmountSnapshot" numeric(10,2),
    "shippingCostSourceSnapshot" text,
    "shippingCostProviderSnapshot" text,
    "shippingCostIdSnapshot" text,
    "financialProfileIdSnapshot" text,
    "settlementDelayDaysSnapshot" integer DEFAULT 21 NOT NULL,
    "settlementStatus" public."SettlementStatus" DEFAULT 'PENDING'::public."SettlementStatus" NOT NULL,
    "settlementEligibleAt" timestamp(3) without time zone,
    "accruedAt" timestamp(3) without time zone,
    "payableAt" timestamp(3) without time zone,
    "settledAt" timestamp(3) without time zone,
    "settlementHoldReason" text,
    "voidedAt" timestamp(3) without time zone,
    "voidReason" text,
    "supersededByLedgerId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: FinancialCorrectionApprovedDeductionCoverage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinancialCorrectionApprovedDeductionCoverage" (
    id text NOT NULL,
    "deductionId" text NOT NULL,
    "settlementApprovalId" text NOT NULL,
    "vendorId" text NOT NULL,
    "amountMinor" integer NOT NULL,
    currency text DEFAULT 'TRY'::text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "releasedAt" timestamp(3) without time zone,
    CONSTRAINT "FinancialCorrectionApprovedDeductionCoverage_state_check" CHECK ((("amountMinor" > 0) AND (currency = 'TRY'::text) AND (((status = 'ACTIVE'::text) AND ("releasedAt" IS NULL)) OR ((status = 'RELEASED'::text) AND ("releasedAt" IS NOT NULL)))))
);


--
-- Name: FinancialCorrectionApprovedDeductionPayoutLine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinancialCorrectionApprovedDeductionPayoutLine" (
    id text NOT NULL,
    "coverageId" text NOT NULL,
    "payoutBatchId" text NOT NULL,
    "amountMinor" integer NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "cancelledAt" timestamp(3) without time zone,
    "paidAt" timestamp(3) without time zone,
    CONSTRAINT "FinancialCorrectionApprovedDeductionPayoutLine_state_check" CHECK ((("amountMinor" > 0) AND (((status = 'ACTIVE'::text) AND ("cancelledAt" IS NULL) AND ("paidAt" IS NULL)) OR ((status = 'CANCELLED'::text) AND ("cancelledAt" IS NOT NULL) AND ("paidAt" IS NULL)) OR ((status = 'PAID'::text) AND ("cancelledAt" IS NULL) AND ("paidAt" IS NOT NULL)))))
);


--
-- Name: FinancialCorrectionAuthority; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinancialCorrectionAuthority" (
    id text NOT NULL,
    "reviewId" text NOT NULL,
    "resolvedReviewEventId" text NOT NULL,
    "acceptedEvidenceSnapshotId" text NOT NULL,
    "incomingConflictEvidenceId" text NOT NULL,
    "sourceShopifyRefundId" text NOT NULL,
    "sourceShopifyOrderId" text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "vendorId" text NOT NULL,
    "historicalSaleFinanceLedgerEntryId" text NOT NULL,
    "acceptedRefundFinanceLedgerEntryId" text NOT NULL,
    "acceptedEvidenceHash" text NOT NULL,
    "incomingEvidenceHash" text NOT NULL,
    "acceptedEvidenceVersion" integer NOT NULL,
    "acceptedNormalizationVersion" integer NOT NULL,
    "incomingEvidenceVersion" integer NOT NULL,
    "incomingNormalizationVersion" integer NOT NULL,
    "commissionPercent" numeric(5,2) NOT NULL,
    "commissionVatPercent" numeric(5,2) NOT NULL,
    currency text NOT NULL,
    "acceptedRefundAmountMinor" integer NOT NULL,
    "acceptedCommissionReversalMinor" integer NOT NULL,
    "acceptedCommissionVatReversalMinor" integer NOT NULL,
    "acceptedVendorPayableReversalMinor" integer NOT NULL,
    "correctedRefundAmountMinor" integer NOT NULL,
    "correctedCommissionReversalMinor" integer NOT NULL,
    "correctedCommissionVatReversalMinor" integer NOT NULL,
    "correctedVendorPayableReversalMinor" integer NOT NULL,
    "refundDifferenceMinor" integer NOT NULL,
    "commissionDifferenceMinor" integer NOT NULL,
    "commissionVatDifferenceMinor" integer NOT NULL,
    "vendorPayableDifferenceMinor" integer NOT NULL,
    "economicDirection" text NOT NULL,
    "previewFingerprint" text NOT NULL,
    "historicalPayoutBatchId" text,
    "historicalPayoutPaidAt" timestamp(3) without time zone,
    "applicationRoute" text NOT NULL,
    "authorizedByUserId" text NOT NULL,
    reason text NOT NULL,
    "authorizedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "appliedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "historicalApprovedSettlementId" text,
    "historicalApprovedSettlementAt" timestamp(3) without time zone,
    "historicalApprovedSettlementNetMinor" integer,
    "historicalDraftPayoutGrossMinor" integer,
    "historicalDraftPayoutNetMinor" integer,
    "historicalDraftPayoutDebtOffsetMinor" integer,
    "historicalDraftPayoutSourceFingerprint" text,
    "historicalDraftPayoutCancelledAt" timestamp(3) without time zone,
    "historicalReviewPayoutGrossMinor" integer,
    "historicalReviewPayoutNetMinor" integer,
    "historicalReviewPayoutDebtOffsetMinor" integer,
    "historicalReviewPayoutSourceFingerprint" text,
    "historicalReviewPayoutCancelledAt" timestamp(3) without time zone,
    "reviewEftNotSentConfirmedAt" timestamp(3) without time zone,
    "reviewEftNotSentConfirmationVersion" text,
    "reviewPayoutObservedStatus" text,
    CONSTRAINT "FinancialCorrectionAuthority_review_attestation_check" CHECK ((("applicationRoute" = ANY (ARRAY['REVIEW_PAYOUT_VENDOR_CREDIT'::text, 'REVIEW_PAYOUT_VENDOR_DEDUCTION'::text])) OR (("historicalReviewPayoutGrossMinor" IS NULL) AND ("historicalReviewPayoutNetMinor" IS NULL) AND ("historicalReviewPayoutDebtOffsetMinor" IS NULL) AND ("historicalReviewPayoutSourceFingerprint" IS NULL) AND ("historicalReviewPayoutCancelledAt" IS NULL) AND ("reviewEftNotSentConfirmedAt" IS NULL) AND ("reviewEftNotSentConfirmationVersion" IS NULL) AND ("reviewPayoutObservedStatus" IS NULL)))),
    CONSTRAINT "FinancialCorrectionAuthority_route_check" CHECK (((currency = 'TRY'::text) AND ((length(TRIM(BOTH FROM reason)) >= 1) AND (length(TRIM(BOTH FROM reason)) <= 500)) AND ((("economicDirection" = 'VENDOR_DEDUCTION'::text) AND ("vendorPayableDifferenceMinor" > 0) AND ("applicationRoute" = 'PAID_VENDOR_DEBT'::text) AND ("historicalPayoutBatchId" IS NOT NULL) AND ("historicalPayoutPaidAt" IS NOT NULL) AND ("historicalApprovedSettlementId" IS NULL) AND ("historicalApprovedSettlementAt" IS NULL) AND ("historicalApprovedSettlementNetMinor" IS NULL)) OR (("economicDirection" = 'VENDOR_CREDIT'::text) AND ("vendorPayableDifferenceMinor" < 0) AND ("applicationRoute" = 'PAID_VENDOR_CREDIT'::text) AND ("historicalPayoutBatchId" IS NOT NULL) AND ("historicalPayoutPaidAt" IS NOT NULL) AND ("historicalApprovedSettlementId" IS NULL) AND ("historicalApprovedSettlementAt" IS NULL) AND ("historicalApprovedSettlementNetMinor" IS NULL)) OR (("economicDirection" = 'VENDOR_CREDIT'::text) AND ("vendorPayableDifferenceMinor" < 0) AND ("applicationRoute" = 'BEFORE_SETTLEMENT_VENDOR_CREDIT'::text) AND ("historicalPayoutBatchId" IS NULL) AND ("historicalPayoutPaidAt" IS NULL) AND ("historicalApprovedSettlementId" IS NULL) AND ("historicalApprovedSettlementAt" IS NULL) AND ("historicalApprovedSettlementNetMinor" IS NULL)) OR (("economicDirection" = 'VENDOR_DEDUCTION'::text) AND ("vendorPayableDifferenceMinor" > 0) AND ("applicationRoute" = 'BEFORE_SETTLEMENT_VENDOR_DEDUCTION'::text) AND ("historicalPayoutBatchId" IS NULL) AND ("historicalPayoutPaidAt" IS NULL) AND ("historicalApprovedSettlementId" IS NULL) AND ("historicalApprovedSettlementAt" IS NULL) AND ("historicalApprovedSettlementNetMinor" IS NULL)) OR (("economicDirection" = 'VENDOR_CREDIT'::text) AND ("vendorPayableDifferenceMinor" < 0) AND ("applicationRoute" = 'APPROVED_SETTLEMENT_VENDOR_CREDIT'::text) AND ("historicalPayoutBatchId" IS NULL) AND ("historicalPayoutPaidAt" IS NULL) AND ("historicalApprovedSettlementId" IS NOT NULL) AND ("historicalApprovedSettlementAt" IS NOT NULL) AND ("historicalApprovedSettlementNetMinor" IS NOT NULL)) OR (("economicDirection" = 'VENDOR_DEDUCTION'::text) AND ("vendorPayableDifferenceMinor" > 0) AND ("applicationRoute" = 'APPROVED_SETTLEMENT_VENDOR_DEDUCTION'::text) AND ("historicalPayoutBatchId" IS NULL) AND ("historicalPayoutPaidAt" IS NULL) AND ("historicalApprovedSettlementId" IS NOT NULL) AND ("historicalApprovedSettlementAt" IS NOT NULL) AND ("historicalApprovedSettlementNetMinor" IS NOT NULL)) OR (("economicDirection" = 'VENDOR_CREDIT'::text) AND ("vendorPayableDifferenceMinor" < 0) AND ("applicationRoute" = 'DRAFT_PAYOUT_VENDOR_CREDIT'::text) AND ("historicalPayoutBatchId" IS NOT NULL) AND ("historicalPayoutPaidAt" IS NULL) AND ("historicalApprovedSettlementId" IS NOT NULL) AND ("historicalApprovedSettlementAt" IS NOT NULL) AND ("historicalApprovedSettlementNetMinor" IS NOT NULL) AND ("historicalDraftPayoutGrossMinor" IS NOT NULL) AND ("historicalDraftPayoutNetMinor" IS NOT NULL) AND ("historicalDraftPayoutDebtOffsetMinor" IS NOT NULL) AND ("historicalDraftPayoutSourceFingerprint" IS NOT NULL) AND ("historicalDraftPayoutCancelledAt" IS NOT NULL)) OR (("economicDirection" = 'VENDOR_DEDUCTION'::text) AND ("vendorPayableDifferenceMinor" > 0) AND ("applicationRoute" = 'DRAFT_PAYOUT_VENDOR_DEDUCTION'::text) AND ("historicalPayoutBatchId" IS NOT NULL) AND ("historicalPayoutPaidAt" IS NULL) AND ("historicalApprovedSettlementId" IS NOT NULL) AND ("historicalApprovedSettlementAt" IS NOT NULL) AND ("historicalApprovedSettlementNetMinor" IS NOT NULL) AND ("historicalDraftPayoutGrossMinor" IS NOT NULL) AND ("historicalDraftPayoutNetMinor" IS NOT NULL) AND ("historicalDraftPayoutDebtOffsetMinor" IS NOT NULL) AND ("historicalDraftPayoutSourceFingerprint" IS NOT NULL) AND ("historicalDraftPayoutCancelledAt" IS NOT NULL)) OR (("economicDirection" = 'VENDOR_CREDIT'::text) AND ("vendorPayableDifferenceMinor" < 0) AND ("applicationRoute" = 'REVIEW_PAYOUT_VENDOR_CREDIT'::text) AND ("historicalPayoutBatchId" IS NOT NULL) AND ("historicalPayoutPaidAt" IS NULL) AND ("historicalApprovedSettlementId" IS NOT NULL) AND ("historicalApprovedSettlementAt" IS NOT NULL) AND ("historicalApprovedSettlementNetMinor" IS NOT NULL) AND ("historicalReviewPayoutGrossMinor" IS NOT NULL) AND ("historicalReviewPayoutNetMinor" IS NOT NULL) AND ("historicalReviewPayoutDebtOffsetMinor" IS NOT NULL) AND ("historicalReviewPayoutSourceFingerprint" IS NOT NULL) AND ("historicalReviewPayoutCancelledAt" IS NOT NULL) AND ("reviewEftNotSentConfirmedAt" IS NOT NULL) AND ("reviewEftNotSentConfirmationVersion" = 'review-eft-not-sent-v1'::text) AND ("reviewPayoutObservedStatus" = 'REVIEW'::text)) OR (("economicDirection" = 'VENDOR_DEDUCTION'::text) AND ("vendorPayableDifferenceMinor" > 0) AND ("applicationRoute" = 'REVIEW_PAYOUT_VENDOR_DEDUCTION'::text) AND ("historicalPayoutBatchId" IS NOT NULL) AND ("historicalPayoutPaidAt" IS NULL) AND ("historicalApprovedSettlementId" IS NOT NULL) AND ("historicalApprovedSettlementAt" IS NOT NULL) AND ("historicalApprovedSettlementNetMinor" IS NOT NULL) AND ("historicalReviewPayoutGrossMinor" IS NOT NULL) AND ("historicalReviewPayoutNetMinor" IS NOT NULL) AND ("historicalReviewPayoutDebtOffsetMinor" IS NOT NULL) AND ("historicalReviewPayoutSourceFingerprint" IS NOT NULL) AND ("historicalReviewPayoutCancelledAt" IS NOT NULL) AND ("reviewEftNotSentConfirmedAt" IS NOT NULL) AND ("reviewEftNotSentConfirmationVersion" = 'review-eft-not-sent-v1'::text) AND ("reviewPayoutObservedStatus" = 'REVIEW'::text)))))
);


--
-- Name: FinancialCorrectionBaselineClaim; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinancialCorrectionBaselineClaim" (
    id text NOT NULL,
    "acceptedEvidenceSnapshotId" text NOT NULL,
    "consumerType" text NOT NULL,
    "consumerId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "FinancialCorrectionBaselineClaim_type_check" CHECK (("consumerType" = ANY (ARRAY['zero_net_acknowledgement'::text, 'paid_vendor_debt'::text, 'paid_vendor_credit'::text, 'before_settlement_vendor_credit'::text, 'before_settlement_vendor_deduction'::text, 'approved_settlement_vendor_credit'::text, 'approved_settlement_vendor_deduction'::text, 'draft_payout_vendor_credit'::text, 'draft_payout_vendor_deduction'::text, 'review_payout_vendor_credit'::text, 'review_payout_vendor_deduction'::text])))
);


--
-- Name: FinancialCorrectionCredit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinancialCorrectionCredit" (
    id text NOT NULL,
    "authorityId" text NOT NULL,
    "vendorId" text NOT NULL,
    "amountMinor" integer NOT NULL,
    currency text DEFAULT 'TRY'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "FinancialCorrectionCredit_amount_check" CHECK ((("amountMinor" > 0) AND (currency = 'TRY'::text)))
);


--
-- Name: FinancialCorrectionCreditPayoutLine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinancialCorrectionCreditPayoutLine" (
    id text NOT NULL,
    "settlementCreditLineId" text NOT NULL,
    "payoutBatchId" text NOT NULL,
    "amountMinor" integer NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "cancelledAt" timestamp(3) without time zone,
    "paidAt" timestamp(3) without time zone,
    CONSTRAINT "FinancialCorrectionCreditPayoutLine_state_check" CHECK ((("amountMinor" > 0) AND (((status = 'ACTIVE'::text) AND ("cancelledAt" IS NULL) AND ("paidAt" IS NULL)) OR ((status = 'CANCELLED'::text) AND ("cancelledAt" IS NOT NULL) AND ("paidAt" IS NULL)) OR ((status = 'PAID'::text) AND ("cancelledAt" IS NULL) AND ("paidAt" IS NOT NULL)))))
);


--
-- Name: FinancialCorrectionCreditSettlementLine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinancialCorrectionCreditSettlementLine" (
    id text NOT NULL,
    "creditId" text NOT NULL,
    "settlementApprovalId" text NOT NULL,
    "amountMinor" integer NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "cancelledAt" timestamp(3) without time zone,
    CONSTRAINT "FinancialCorrectionCreditSettlementLine_state_check" CHECK ((("amountMinor" > 0) AND (((status = 'ACTIVE'::text) AND ("cancelledAt" IS NULL)) OR ((status = 'CANCELLED'::text) AND ("cancelledAt" IS NOT NULL)))))
);


--
-- Name: FinancialCorrectionDeduction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinancialCorrectionDeduction" (
    id text NOT NULL,
    "authorityId" text NOT NULL,
    "vendorId" text NOT NULL,
    "amountMinor" integer NOT NULL,
    currency text DEFAULT 'TRY'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "FinancialCorrectionDeduction_amount_check" CHECK ((("amountMinor" > 0) AND (currency = 'TRY'::text)))
);


--
-- Name: FinancialCorrectionDeductionPayoutLine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinancialCorrectionDeductionPayoutLine" (
    id text NOT NULL,
    "settlementDeductionLineId" text NOT NULL,
    "payoutBatchId" text NOT NULL,
    "amountMinor" integer NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "cancelledAt" timestamp(3) without time zone,
    "paidAt" timestamp(3) without time zone,
    CONSTRAINT "FinancialCorrectionDeductionPayoutLine_state_check" CHECK ((("amountMinor" > 0) AND (((status = 'ACTIVE'::text) AND ("cancelledAt" IS NULL) AND ("paidAt" IS NULL)) OR ((status = 'CANCELLED'::text) AND ("cancelledAt" IS NOT NULL) AND ("paidAt" IS NULL)) OR ((status = 'PAID'::text) AND ("cancelledAt" IS NULL) AND ("paidAt" IS NOT NULL)))))
);


--
-- Name: FinancialCorrectionDeductionSettlementLine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinancialCorrectionDeductionSettlementLine" (
    id text NOT NULL,
    "deductionId" text NOT NULL,
    "settlementApprovalId" text NOT NULL,
    "amountMinor" integer NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "cancelledAt" timestamp(3) without time zone,
    CONSTRAINT "FinancialCorrectionDeductionSettlementLine_state_check" CHECK ((("amountMinor" > 0) AND (((status = 'ACTIVE'::text) AND ("cancelledAt" IS NULL)) OR ((status = 'CANCELLED'::text) AND ("cancelledAt" IS NOT NULL)))))
);


--
-- Name: FinancialCorrectionZeroNetAcknowledgement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FinancialCorrectionZeroNetAcknowledgement" (
    id text NOT NULL,
    "reviewId" text NOT NULL,
    "resolvedReviewEventId" text NOT NULL,
    "sourceShopifyRefundId" text NOT NULL,
    "sourceShopifyOrderId" text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "vendorId" text NOT NULL,
    "acceptedEvidenceSnapshotId" text NOT NULL,
    "incomingConflictEvidenceId" text NOT NULL,
    "acceptedEvidenceHash" text NOT NULL,
    "incomingEvidenceHash" text NOT NULL,
    "acceptedEvidenceVersion" integer NOT NULL,
    "acceptedNormalizationVersion" integer NOT NULL,
    "incomingEvidenceVersion" integer NOT NULL,
    "incomingNormalizationVersion" integer NOT NULL,
    "historicalSaleFinanceLedgerEntryId" text NOT NULL,
    "acceptedRefundFinanceLedgerEntryId" text NOT NULL,
    "commissionPercent" numeric(5,2) NOT NULL,
    "commissionVatPercent" numeric(5,2) NOT NULL,
    currency text NOT NULL,
    "acceptedRefundAmountMinor" integer NOT NULL,
    "acceptedCommissionReversalMinor" integer NOT NULL,
    "acceptedCommissionVatReversalMinor" integer NOT NULL,
    "acceptedVendorPayableReversalMinor" integer NOT NULL,
    "correctedRefundAmountMinor" integer NOT NULL,
    "correctedCommissionReversalMinor" integer NOT NULL,
    "correctedCommissionVatReversalMinor" integer NOT NULL,
    "correctedVendorPayableReversalMinor" integer NOT NULL,
    "refundDifferenceMinor" integer NOT NULL,
    "commissionDifferenceMinor" integer NOT NULL,
    "commissionVatDifferenceMinor" integer NOT NULL,
    "vendorPayableDifferenceMinor" integer NOT NULL,
    "economicDirection" text NOT NULL,
    "previewFingerprint" text NOT NULL,
    "acknowledgedByUserId" text NOT NULL,
    note text,
    "acknowledgedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_zero_effect_check" CHECK ((("vendorPayableDifferenceMinor" = 0) AND ("economicDirection" = 'NONE'::text) AND (currency = 'TRY'::text)))
);


--
-- Name: Fulfillment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Fulfillment" (
    id text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "fulfillmentStatus" text NOT NULL,
    "trackingNumber" text,
    carrier text,
    "trackingUrl" text,
    "notifyCustomer" boolean DEFAULT true NOT NULL,
    "shopifyFulfillmentId" text,
    "shopifyFulfillmentOrderId" text,
    "fulfilledAt" timestamp(3) without time zone,
    "shipmentCreatedAt" timestamp(3) without time zone,
    "shipmentUpdatedAt" timestamp(3) without time zone,
    "syncStatus" text,
    "errorMessage" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: LegacyRefundFinanceReview; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LegacyRefundFinanceReview" (
    id text NOT NULL,
    "caseKey" text NOT NULL,
    status public."LegacyRefundFinanceReviewStatus" DEFAULT 'ACTIVE'::public."LegacyRefundFinanceReviewStatus" NOT NULL,
    "resolutionOutcome" public."LegacyRefundFinanceResolutionOutcome",
    attribution public."LegacyRefundFinanceAttribution" NOT NULL,
    "sourceShopifyRefundId" text,
    "sourceShopifyOrderId" text,
    "vendorAllocationId" text,
    "observedVendorId" text,
    "firstObservedAt" timestamp(3) without time zone NOT NULL,
    "lastObservedAt" timestamp(3) without time zone NOT NULL,
    "occurrenceCount" integer DEFAULT 1 NOT NULL,
    "projectionFingerprint" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: LegacyRefundFinanceReviewEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LegacyRefundFinanceReviewEvent" (
    id text NOT NULL,
    "reviewId" text NOT NULL,
    "eventType" public."LegacyRefundFinanceReviewEventType" NOT NULL,
    "actorUserId" text,
    note text,
    "resolutionOutcome" public."LegacyRefundFinanceResolutionOutcome",
    "sourceContextJson" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: LegacyRefundFinanceReviewSource; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LegacyRefundFinanceReviewSource" (
    id text NOT NULL,
    "reviewId" text NOT NULL,
    "artifactType" public."LegacyRefundFinanceArtifactType" NOT NULL,
    "artifactId" text NOT NULL,
    "observedAt" timestamp(3) without time zone NOT NULL,
    "sourceState" text,
    "recordedAmount" numeric(10,2),
    "recordedAmountMinor" integer,
    currency text,
    "voidedAt" timestamp(3) without time zone,
    "supersededByLedgerId" text,
    "sourceFingerprint" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: NotificationIntent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NotificationIntent" (
    id text NOT NULL,
    "signalId" text,
    "vendorId" text,
    "recipientRole" public."NotificationRecipientRole" NOT NULL,
    channel public."NotificationChannel" DEFAULT 'IN_APP'::public."NotificationChannel" NOT NULL,
    status public."NotificationStatus" DEFAULT 'PENDING'::public."NotificationStatus" NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    severity public."OperationalSignalSeverity" NOT NULL,
    "deliveredAt" timestamp(3) without time zone,
    "readAt" timestamp(3) without time zone,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: OperationalJob; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OperationalJob" (
    id text NOT NULL,
    "jobType" public."OperationalJobType" NOT NULL,
    status public."OperationalJobStatus" DEFAULT 'PENDING'::public."OperationalJobStatus" NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    payload jsonb,
    "payloadRef" text,
    "webhookEventId" text,
    "sourceShopifyOrderId" text,
    "vendorAllocationId" text,
    "refundRecordId" text,
    "returnRecordId" text,
    "customerCancellationRequestItemId" text,
    "retryCount" integer DEFAULT 0 NOT NULL,
    "maxRetries" integer DEFAULT 3 NOT NULL,
    "scheduledAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "nextRetryAt" timestamp(3) without time zone,
    "lastAttemptAt" timestamp(3) without time zone,
    "retryBackoffMs" integer,
    "startedAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    "failedAt" timestamp(3) without time zone,
    "errorSummary" text,
    "failureCategory" text,
    "escalationReason" text,
    "processingGeneration" integer DEFAULT 0 NOT NULL,
    "processingLeaseExpiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: OperationalSignal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OperationalSignal" (
    id text NOT NULL,
    type text NOT NULL,
    severity public."OperationalSignalSeverity" NOT NULL,
    "sourceArea" public."OperationalSignalSourceArea" NOT NULL,
    "vendorId" text,
    "allocationId" text,
    "financeLedgerEntryId" text,
    "payoutBatchId" text,
    "operationalJobId" text,
    title text NOT NULL,
    description text NOT NULL,
    "suggestedAction" text,
    status public."OperationalSignalStatus" DEFAULT 'ACTIVE'::public."OperationalSignalStatus" NOT NULL,
    "ruleKey" text NOT NULL,
    "triggeredAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "resolvedAt" timestamp(3) without time zone,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: OrderShippingRefundClaim; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OrderShippingRefundClaim" (
    id text NOT NULL,
    "shopifyOrderId" text NOT NULL,
    "ownerAttemptId" text NOT NULL,
    "activeOrderKey" text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "acquiredAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "releasedAt" timestamp(3) without time zone,
    "releaseReason" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: OutboundShopifyRefundAttempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OutboundShopifyRefundAttempt" (
    id text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "shopifyOrderId" text NOT NULL,
    "customerCancellationRequestItemId" text,
    status text NOT NULL,
    "restockType" text NOT NULL,
    "refundShipping" boolean DEFAULT false NOT NULL,
    "notifyCustomer" boolean DEFAULT false NOT NULL,
    note text,
    "requestedByUserId" text,
    "requestedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "refundLineItemsJson" jsonb,
    "suggestedTransactionsJson" jsonb,
    "fulfillmentOrderCancellationJson" jsonb,
    "blockersJson" jsonb,
    "warningsJson" jsonb,
    "previewHash" text,
    "previewedAt" timestamp(3) without time zone,
    "shopifyRefundId" text,
    "shopifyUserErrorsJson" jsonb,
    "mutationResponseJson" jsonb,
    "submittedAt" timestamp(3) without time zone,
    "resolvedAt" timestamp(3) without time zone,
    "failedAt" timestamp(3) without time zone,
    "failureReason" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: PayoutBatch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PayoutBatch" (
    id text NOT NULL,
    "vendorId" text NOT NULL,
    status public."PayoutBatchStatus" DEFAULT 'DRAFT'::public."PayoutBatchStatus" NOT NULL,
    "grossAmount" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "commissionAmount" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "commissionVatAmount" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "shippingDeductionAmount" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "refundAmount" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "netAmount" numeric(10,2) DEFAULT 0.00 NOT NULL,
    currency text DEFAULT 'TRY'::text NOT NULL,
    "createdByUserId" text,
    "paidAt" timestamp(3) without time zone,
    "paidByUserId" text,
    "paymentReference" text,
    "internalNote" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "correctionCreditAmount" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "correctionDeductionAmount" numeric(10,2) DEFAULT 0.00 NOT NULL
);


--
-- Name: PayoutBatchLine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PayoutBatchLine" (
    id text NOT NULL,
    "payoutBatchId" text NOT NULL,
    "financeLedgerEntryId" text NOT NULL,
    "settlementApprovalLineId" text,
    "amountSnapshot" numeric(10,2) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ProductPanelVariantDisableOutboxEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProductPanelVariantDisableOutboxEvent" (
    id text NOT NULL,
    "allocationId" text NOT NULL,
    "vendorAllocationLineItemId" text NOT NULL,
    "shopifyVariantId" text,
    "shopifyLineItemId" text NOT NULL,
    "variantSku" text,
    "vendorId" text NOT NULL,
    "vendorName" text,
    "shopifyOrderId" text NOT NULL,
    "shopifyOrderName" text,
    "reasonCode" text NOT NULL,
    "reasonText" text,
    quantity integer NOT NULL,
    "requestedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    environment text NOT NULL,
    "dryRun" boolean DEFAULT true NOT NULL,
    "attemptCount" integer DEFAULT 0 NOT NULL,
    status public."ProductPanelVariantDisableOutboxStatus" DEFAULT 'CREATED'::public."ProductPanelVariantDisableOutboxStatus" NOT NULL,
    error text,
    "idempotencyKey" text NOT NULL,
    "requestPayloadJson" jsonb,
    "responseJson" jsonb,
    "resolvedAt" timestamp(3) without time zone,
    "failedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: RefundEvidenceSnapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RefundEvidenceSnapshot" (
    id text NOT NULL,
    "sourceShopifyRefundId" text NOT NULL,
    "sourceShopifyOrderId" text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "refundRecordId" text NOT NULL,
    "refundFinanceLedgerEntryId" text NOT NULL,
    "historicalEconomicVendorId" text NOT NULL,
    "historicalSaleFinanceLedgerEntryId" text NOT NULL,
    "monetaryClassification" text NOT NULL,
    "refundTotalAmount" numeric(10,2) NOT NULL,
    currency text NOT NULL,
    "normalizedTransactionsJson" jsonb NOT NULL,
    "normalizedRefundLinesJson" jsonb NOT NULL,
    "normalizedOwnershipJson" jsonb NOT NULL,
    "normalizedEvidenceJson" jsonb NOT NULL,
    "supersededSaleLedgerIdsJson" jsonb NOT NULL,
    "evidenceHash" text NOT NULL,
    "hashAlgorithm" text NOT NULL,
    "evidenceVersion" integer NOT NULL,
    "normalizationVersion" integer NOT NULL,
    "evidenceSource" text NOT NULL,
    "capturedAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: RefundRecord; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RefundRecord" (
    id text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "sourceShopifyOrderId" text NOT NULL,
    "sourceShopifyOrderNumber" text NOT NULL,
    "sourceShopifyRefundId" text NOT NULL,
    amount numeric(10,2),
    status text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: RefundTerminalConflictEvidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RefundTerminalConflictEvidence" (
    id text NOT NULL,
    "reviewId" text NOT NULL,
    "sourceShopifyRefundId" text NOT NULL,
    "sourceShopifyOrderId" text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "economicVendorId" text NOT NULL,
    "historicalSaleFinanceLedgerEntryId" text NOT NULL,
    "supersededSaleLedgerIdsJson" jsonb NOT NULL,
    "refundTotalAmount" numeric(10,2) NOT NULL,
    currency text NOT NULL,
    "normalizedEvidenceJson" jsonb NOT NULL,
    "evidenceHash" text NOT NULL,
    "hashAlgorithm" text NOT NULL,
    "evidenceVersion" integer NOT NULL,
    "normalizationVersion" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: RefundTerminalEvidenceReview; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RefundTerminalEvidenceReview" (
    id text NOT NULL,
    "sourceShopifyRefundId" text NOT NULL,
    "sourceShopifyOrderId" text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "terminalRefundFinanceLedgerEntryId" text NOT NULL,
    "refundRecordId" text,
    "economicVendorId" text NOT NULL,
    "storedEvidenceSnapshotId" text,
    "dedupeKey" text NOT NULL,
    "conflictCategory" text NOT NULL,
    "storedEvidenceHash" text,
    "incomingEvidenceHash" text,
    "storedEvidenceSummaryJson" jsonb,
    "incomingEvidenceSummaryJson" jsonb,
    "conflictSummaryJson" jsonb NOT NULL,
    "sourceContextJson" jsonb,
    status public."RefundTerminalEvidenceReviewStatus" DEFAULT 'ACTIVE'::public."RefundTerminalEvidenceReviewStatus" NOT NULL,
    "resolutionOutcome" public."RefundTerminalEvidenceResolutionOutcome",
    "firstObservedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastObservedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "occurrenceCount" integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: RefundTerminalEvidenceReviewEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RefundTerminalEvidenceReviewEvent" (
    id text NOT NULL,
    "reviewId" text NOT NULL,
    "eventType" public."RefundTerminalEvidenceReviewEventType" NOT NULL,
    "actorUserId" text,
    note text,
    "resolutionOutcome" public."RefundTerminalEvidenceResolutionOutcome",
    "sourceContextJson" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ReturnRecord; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ReturnRecord" (
    id text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "ownerVendorId" text,
    "sourceShopifyOrderId" text NOT NULL,
    "sourceShopifyOrderNumber" text NOT NULL,
    "sourceShopifyRefundId" text,
    "sourceShopifyReturnId" text,
    "sourceShopifyReturnGid" text,
    "sourceShopifyLineItemId" text,
    "returnLifecycleStatus" text,
    "returnRequestSource" text,
    "requestCreatedAt" timestamp(3) without time zone,
    "requestUpdatedAt" timestamp(3) without time zone,
    status text NOT NULL,
    reason text,
    "returnReasonNote" text,
    "returnProvider" text,
    "returnProviderShipmentId" text,
    "returnLabel" text,
    "returnReferenceId" text,
    "navlungoReturnCreatedAt" timestamp(3) without time zone,
    "returnProviderSnapshot" jsonb,
    "returnCarrierName" text,
    "returnTrackingNumber" text,
    "returnTrackingUrl" text,
    "vendorReceivedAt" timestamp(3) without time zone,
    "vendorReviewedAt" timestamp(3) without time zone,
    "vendorDecision" text,
    "vendorDecisionReason" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: SettlementApproval; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SettlementApproval" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "vendorId" text NOT NULL,
    "periodStart" timestamp(3) without time zone,
    "periodEnd" timestamp(3) without time zone,
    status public."SettlementApprovalStatus" DEFAULT 'DRAFT'::public."SettlementApprovalStatus" NOT NULL,
    currency text DEFAULT 'TRY'::text NOT NULL,
    "grossSalesMinor" integer NOT NULL,
    "refundTotalMinor" integer NOT NULL,
    "commissionMinor" integer NOT NULL,
    "commissionVatMinor" integer NOT NULL,
    "netPayableMinor" integer NOT NULL,
    "approvedBy" text,
    "approvedAt" timestamp(3) without time zone,
    "cancelledBy" text,
    "cancelledAt" timestamp(3) without time zone,
    notes text,
    "scheduledRunDate" timestamp(3) without time zone,
    "scheduledPeriodEnd" timestamp(3) without time zone,
    "scheduledCycleKey" text,
    "sourceSnapshotJson" jsonb NOT NULL,
    "correctionCreditMinor" integer DEFAULT 0 NOT NULL,
    "correctionDeductionMinor" integer DEFAULT 0 NOT NULL
);


--
-- Name: SettlementApprovalLine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SettlementApprovalLine" (
    id text NOT NULL,
    "settlementApprovalId" text NOT NULL,
    "financeLedgerEntryId" text NOT NULL,
    "settlementRefundAdjustmentId" text,
    "settlementRefundAdjustmentApplicationId" text,
    "lineType" public."SettlementApprovalLineType" NOT NULL,
    "amountMinor" integer NOT NULL,
    "commissionMinor" integer NOT NULL,
    "commissionVatMinor" integer NOT NULL,
    "payableImpactMinor" integer NOT NULL,
    "sourceSnapshotJson" jsonb NOT NULL
);


--
-- Name: SettlementCommissionInvoice; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SettlementCommissionInvoice" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "settlementApprovalId" text NOT NULL,
    "vendorId" text NOT NULL,
    provider public."SettlementCommissionInvoiceProvider" NOT NULL,
    status public."SettlementCommissionInvoiceStatus" DEFAULT 'PENDING'::public."SettlementCommissionInvoiceStatus" NOT NULL,
    "providerInvoiceId" text,
    "providerUuid" text,
    "providerEttn" text,
    "invoiceNo" text,
    "invoiceDate" timestamp(3) without time zone,
    "invoiceTotalMinor" integer,
    "invoiceCurrency" text,
    "gibStatus" text,
    "gibStatusCode" text,
    "documentStatus" text,
    "documentStatusCode" text,
    "documentType" text,
    "documentContentType" text,
    "documentSize" integer,
    "documentFetchedAt" timestamp(3) without time zone,
    "lastProviderSyncedAt" timestamp(3) without time zone,
    "documentSnapshotJson" jsonb,
    "requestSnapshotJson" jsonb,
    "responseSnapshotJson" jsonb,
    "failureCode" text,
    "failureMessage" text,
    "failedAt" timestamp(3) without time zone,
    "unknownReason" text,
    "unknownAt" timestamp(3) without time zone,
    "reconciliationStatus" text,
    "reconciliationEvidenceJson" jsonb,
    "reconciledAt" timestamp(3) without time zone,
    "reconciledBy" text,
    "retryCount" integer DEFAULT 0 NOT NULL,
    "lastRetriedAt" timestamp(3) without time zone,
    "createdBy" text,
    "cancelledBy" text,
    "cancelledAt" timestamp(3) without time zone
);


--
-- Name: SettlementRefundAdjustment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SettlementRefundAdjustment" (
    id text NOT NULL,
    "refundRecordId" text NOT NULL,
    "refundFinanceLedgerEntryId" text NOT NULL,
    "vendorId" text NOT NULL,
    "originalOrderId" text NOT NULL,
    "originalSettlementApprovalId" text,
    "originalSettlementApprovalLineId" text,
    "originalSettlementCommissionInvoiceId" text,
    status public."SettlementRefundAdjustmentStatus" DEFAULT 'PENDING'::public."SettlementRefundAdjustmentStatus" NOT NULL,
    "amountMinor" integer NOT NULL,
    "currencyCode" text DEFAULT 'TRY'::text NOT NULL,
    reason text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "originalAmountMinor" integer DEFAULT 0 NOT NULL,
    "appliedAmountMinor" integer DEFAULT 0 NOT NULL,
    "remainingAmountMinor" integer DEFAULT 0 NOT NULL,
    "appliedSettlementApprovalId" text,
    "appliedSettlementApprovalLineId" text,
    "blockedReason" text,
    "createdBy" text
);


--
-- Name: SettlementRefundAdjustmentApplication; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SettlementRefundAdjustmentApplication" (
    id text NOT NULL,
    "settlementRefundAdjustmentId" text NOT NULL,
    "settlementApprovalId" text NOT NULL,
    "settlementApprovalLineId" text NOT NULL,
    "amountMinor" integer NOT NULL,
    "currencyCode" text DEFAULT 'TRY'::text NOT NULL,
    status public."SettlementRefundAdjustmentApplicationStatus" DEFAULT 'ACTIVE'::public."SettlementRefundAdjustmentApplicationStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: SettlementRefundAdjustmentEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SettlementRefundAdjustmentEvent" (
    id text NOT NULL,
    "settlementRefundAdjustmentId" text NOT NULL,
    "eventType" public."SettlementRefundAdjustmentEventType" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "metadataJson" jsonb
);


--
-- Name: SettlementScheduleJobRun; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SettlementScheduleJobRun" (
    id text NOT NULL,
    "runDate" timestamp(3) without time zone NOT NULL,
    status public."SettlementScheduleJobRunStatus" DEFAULT 'PROCESSING'::public."SettlementScheduleJobRunStatus" NOT NULL,
    "writesPerformed" boolean DEFAULT false NOT NULL,
    "createdDraftCount" integer DEFAULT 0 NOT NULL,
    "skippedCount" integer DEFAULT 0 NOT NULL,
    "blockedCount" integer DEFAULT 0 NOT NULL,
    "startedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "finishedAt" timestamp(3) without time zone,
    "metadataJson" jsonb
);


--
-- Name: ShipmentExecution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ShipmentExecution" (
    id text NOT NULL,
    "allocationId" text NOT NULL,
    "vendorId" text NOT NULL,
    "sourceShopifyOrderId" text,
    "sourceShopifyOrderNumber" text,
    "sourceShopifyFulfillmentId" text,
    provider public."ShippingProvider" NOT NULL,
    "providerShipmentId" text,
    "trackingNumber" text,
    "trackingUrl" text,
    "labelUrl" text,
    "shipmentStatus" public."ShipmentExecutionStatus" DEFAULT 'PENDING'::public."ShipmentExecutionStatus" NOT NULL,
    desi numeric(10,2) DEFAULT 3.00 NOT NULL,
    "cargoIntegrationId" text,
    "warehouseId" text,
    "shippingCost" numeric(10,2),
    "shippingVat" numeric(10,2),
    currency text DEFAULT 'TRY'::text NOT NULL,
    "requestSnapshot" jsonb NOT NULL,
    "responseSnapshot" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ShipmentShippingCost; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ShipmentShippingCost" (
    id text NOT NULL,
    "vendorId" text NOT NULL,
    "allocationId" text NOT NULL,
    "sourceShopifyOrderId" text NOT NULL,
    "sourceShopifyFulfillmentId" text,
    "providerName" text NOT NULL,
    "providerReference" text,
    "shippingCost" numeric(10,2) NOT NULL,
    "shippingVatAmount" numeric(10,2),
    currency text DEFAULT 'TRY'::text NOT NULL,
    status public."ShippingCostStatus" DEFAULT 'PENDING'::public."ShippingCostStatus" NOT NULL,
    "sourceType" public."ShippingCostSourceType" DEFAULT 'MANUAL'::public."ShippingCostSourceType" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ShopifyOrder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ShopifyOrder" (
    id text NOT NULL,
    "sourceShopifyOrderId" text NOT NULL,
    "sourceShopifyOrderNumber" text NOT NULL,
    "shopifyCreatedAt" timestamp(3) without time zone,
    currency text,
    "financialStatus" text,
    "cancelledAt" timestamp(3) without time zone,
    "cancelReason" text,
    "paymentGatewayName" text,
    "taxesIncluded" boolean,
    "orderTaxAmount" numeric(10,2),
    "shippingAmount" numeric(10,2),
    "discountAmount" numeric(10,2),
    "orderNote" text,
    "orderTags" text[] DEFAULT ARRAY[]::text[],
    "customerName" text,
    "customerEmail" text,
    "customerPhone" text,
    "billingFullName" text,
    "billingCompany" text,
    "billingPhone" text,
    "billingCity" text,
    "billingDistrict" text,
    "billingAddress1" text,
    "billingAddress2" text,
    "billingPostcode" text,
    "shippingCountry" text,
    "shippingPostcode" text,
    "shippingCity" text,
    "shippingDistrict" text,
    "shippingAddress" text,
    "totalPrice" numeric(10,2),
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ShopifyOrderLineItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ShopifyOrderLineItem" (
    id text NOT NULL,
    "shopifyOrderId" text NOT NULL,
    "sourceLineItemId" text NOT NULL,
    "shopifyProductId" text,
    "sourceVariantId" text,
    sku text,
    title text,
    "imageUrl" text,
    quantity integer DEFAULT 1 NOT NULL,
    "unitPrice" numeric(10,2),
    "unitPriceVatIncluded" numeric(10,2),
    "lineTotalVatIncluded" numeric(10,2),
    "lineTaxAmount" numeric(10,2),
    "vatRate" numeric(5,2),
    "originalVendorId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ShopifyRefund; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ShopifyRefund" (
    id text NOT NULL,
    "shopifyOrderId" text NOT NULL,
    "sourceShopifyOrderId" text NOT NULL,
    "sourceShopifyOrderNumber" text NOT NULL,
    "sourceShopifyRefundId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ShopifyRefundLineItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ShopifyRefundLineItem" (
    id text NOT NULL,
    "shopifyRefundId" text NOT NULL,
    "refundRecordId" text,
    "shopifyOrderLineItemId" text NOT NULL,
    "sourceRefundLineItemId" text NOT NULL,
    "sourceLineItemId" text NOT NULL,
    sku text,
    title text,
    quantity integer DEFAULT 1 NOT NULL,
    subtotal numeric(10,2),
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: SupportTicket; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SupportTicket" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdByUserId" text NOT NULL,
    "createdByRole" text NOT NULL,
    "vendorId" text NOT NULL,
    subject text NOT NULL,
    message text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    category text DEFAULT 'OTHER'::text NOT NULL,
    "assigneeUserId" text,
    "assigneeName" text,
    "vendorUnreadCount" integer DEFAULT 0 NOT NULL,
    "adminUnreadCount" integer DEFAULT 0 NOT NULL,
    "lastReplyAt" timestamp(3) without time zone,
    "lastReplyByRole" text,
    "firstResponseDueAt" timestamp(3) without time zone,
    "nextResponseDueAt" timestamp(3) without time zone,
    "escalatedAt" timestamp(3) without time zone,
    "escalationReason" text,
    "contextType" text NOT NULL,
    "contextId" text,
    "contextSnapshot" jsonb,
    "resolvedAt" timestamp(3) without time zone,
    "closedAt" timestamp(3) without time zone
);


--
-- Name: SupportTicketNote; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SupportTicketNote" (
    id text NOT NULL,
    "supportTicketId" text NOT NULL,
    "authorUserId" text NOT NULL,
    "authorName" text NOT NULL,
    "authorRole" text NOT NULL,
    content text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: SupportTicketReply; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SupportTicketReply" (
    id text NOT NULL,
    "supportTicketId" text NOT NULL,
    "authorUserId" text NOT NULL,
    "authorName" text NOT NULL,
    "authorRole" text NOT NULL,
    message text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    role public."UserRole" NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    "passwordHash" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: UserVendorAccess; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."UserVendorAccess" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "vendorId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Vendor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Vendor" (
    id text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    "restrictionReason" text,
    "restrictedByUserId" text,
    "restrictedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VendorAllocation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorAllocation" (
    id text NOT NULL,
    "sourceShopifyOrderId" text NOT NULL,
    "sourceShopifyOrderNumber" text NOT NULL,
    "originalVendorId" text NOT NULL,
    "assignedVendorId" text NOT NULL,
    "allocationStatus" public."AllocationStatus" DEFAULT 'ACTIVE'::public."AllocationStatus" NOT NULL,
    "cancellationReason" public."CancellationReason",
    "reassignmentRequired" boolean DEFAULT false NOT NULL,
    "cancelRefundReviewStatus" text,
    "cancelRefundReviewReason" text,
    "cancelRefundReviewNote" text,
    "cancelRefundReviewRequestedAt" timestamp(3) without time zone,
    "cancelRefundReviewRequestedByUserId" text,
    "fulfillmentStatus" text DEFAULT 'Pending'::text NOT NULL,
    "shippingStatus" text DEFAULT 'Awaiting Shipment'::text NOT NULL,
    "trackingNumber" text,
    carrier text,
    "vendorIntegrationTrackingUrl" text,
    "vendorIntegrationShippedAt" timestamp(3) without time zone,
    "odooSaleOrderId" text,
    "odooSaleOrderName" text,
    "odooSaleOrderSyncedAt" timestamp(3) without time zone,
    "vendorIntegrationStatus" text,
    "vendorIntegrationStatusMessage" text,
    "vendorIntegrationStatusUpdatedAt" timestamp(3) without time zone,
    "vendorIntegrationProvider" text,
    "lastVendorIntegrationRequestId" text,
    "lastVendorIntegrationShipmentRequestId" text,
    "vendorInvoiceNumber" text,
    "vendorInvoiceDate" timestamp(3) without time zone,
    "vendorInvoiceUrl" text,
    "vendorInvoiceAmount" numeric(10,2),
    "vendorInvoiceReceivedAt" timestamp(3) without time zone,
    "lastVendorIntegrationInvoiceRequestId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VendorAllocationLineItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorAllocationLineItem" (
    id text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "shopifyLineItemId" text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    "lineAmount" numeric(10,2),
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VendorBalanceEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorBalanceEvent" (
    id text NOT NULL,
    "vendorId" text NOT NULL,
    type public."VendorBalanceEventType" NOT NULL,
    "amountMinor" integer NOT NULL,
    currency text DEFAULT 'TRY'::text NOT NULL,
    "sourceType" text NOT NULL,
    "sourceId" text NOT NULL,
    "financeLedgerEntryId" text,
    "refundRecordId" text,
    "payoutBatchId" text,
    "settlementApprovalId" text,
    "metadataJson" jsonb,
    "idempotencyKey" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "financialCorrectionAuthorityId" text,
    CONSTRAINT "VendorBalanceEvent_correction_source_check" CHECK ((("sourceType" <> 'financial_correction'::text) OR (("financialCorrectionAuthorityId" IS NOT NULL) AND ("sourceId" = "financialCorrectionAuthorityId") AND (type = 'VENDOR_DEBT_CREATED'::public."VendorBalanceEventType") AND ("amountMinor" < 0) AND (currency = 'TRY'::text))))
);


--
-- Name: VendorBillingProfile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorBillingProfile" (
    id text NOT NULL,
    "vendorId" text NOT NULL,
    "legalCompanyName" text,
    "taxNumber" text,
    "taxOffice" text,
    "billingAddress" text,
    "billingCity" text,
    "billingDistrict" text,
    iban text,
    "authorizedPerson" text,
    "billingEmail" text,
    "billingPhone" text,
    "legalEntityType" text,
    "logoIsbasiCustomerCode" text,
    "logoIsbasiCustomerId" text,
    "logoIsbasiEinvoiceEligible" boolean,
    "logoIsbasiLastCheckedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VendorFinancialProfile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorFinancialProfile" (
    id text NOT NULL,
    "vendorId" text NOT NULL,
    "commissionPercent" numeric(5,2) DEFAULT 10.00 NOT NULL,
    "commissionVatPercent" numeric(5,2) DEFAULT 0.00 NOT NULL,
    "deductShippingEnabled" boolean DEFAULT false NOT NULL,
    "shippingMode" public."ShippingDeductionMode" DEFAULT 'DISABLED'::public."ShippingDeductionMode" NOT NULL,
    "fixedShippingFee" numeric(10,2),
    "settlementDelayDays" integer DEFAULT 21 NOT NULL,
    "settlementFrequencyType" public."SettlementFrequencyType" DEFAULT 'WEEKLY'::public."SettlementFrequencyType" NOT NULL,
    "weeklySettlementDay" public."SettlementWeekday" DEFAULT 'WEDNESDAY'::public."SettlementWeekday" NOT NULL,
    "autoSettlementDraftEnabled" boolean DEFAULT false NOT NULL,
    "autoSettlementApproveEnabled" boolean DEFAULT false NOT NULL,
    "autoSettlementInvoiceEnabled" boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VendorIntegrationAuditLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorIntegrationAuditLog" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "vendorIdentifier" text NOT NULL,
    method text NOT NULL,
    path text NOT NULL,
    "statusCode" integer NOT NULL,
    "requestId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: VendorIntegrationClient; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorIntegrationClient" (
    id text NOT NULL,
    "vendorIdentifier" text NOT NULL,
    "providerName" text NOT NULL,
    "tokenHash" text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    scopes text[],
    "lastUsedAt" timestamp(3) without time zone,
    "revokedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VendorIntegrationInvoiceEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorIntegrationInvoiceEvent" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "vendorIdentifier" text NOT NULL,
    "providerName" text,
    "invoiceNumber" text NOT NULL,
    "invoiceDate" timestamp(3) without time zone NOT NULL,
    "invoiceUrl" text,
    "invoiceAmount" numeric(10,2) NOT NULL,
    "idempotencyKey" text NOT NULL,
    "requestId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: VendorIntegrationShipmentEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorIntegrationShipmentEvent" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "vendorIdentifier" text NOT NULL,
    "providerName" text,
    carrier text NOT NULL,
    "trackingNumber" text NOT NULL,
    "trackingUrl" text,
    "shippedAt" timestamp(3) without time zone,
    "idempotencyKey" text NOT NULL,
    "requestId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: VendorIntegrationStatusEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorIntegrationStatusEvent" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "vendorAllocationId" text NOT NULL,
    "vendorIdentifier" text NOT NULL,
    "providerName" text,
    status text NOT NULL,
    message text,
    "idempotencyKey" text NOT NULL,
    "requestId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: VendorProfileAuditLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorProfileAuditLog" (
    id text NOT NULL,
    "vendorId" text NOT NULL,
    section text NOT NULL,
    "fieldName" text NOT NULL,
    "oldValue" jsonb,
    "newValue" jsonb,
    "changedByUserId" text,
    "changedByEmail" text,
    "changedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reason text,
    "snapshotImpact" public."VendorProfileSnapshotImpact" NOT NULL,
    source text NOT NULL
);


--
-- Name: VendorShippingConfig; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorShippingConfig" (
    id text NOT NULL,
    "vendorId" text NOT NULL,
    "preferredProvider" public."ShippingProvider" DEFAULT 'HEPSIJET'::public."ShippingProvider" NOT NULL,
    "shippingEnabled" boolean DEFAULT true NOT NULL,
    "defaultDesi" numeric(10,2) DEFAULT 3.00 NOT NULL,
    "cargoIntegrationId" text,
    "defaultWarehouseId" text,
    "shippingVatPercent" numeric(5,2) DEFAULT 18.00 NOT NULL,
    "providerMetadata" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VendorShippingWarehouse; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VendorShippingWarehouse" (
    id text NOT NULL,
    "configId" text NOT NULL,
    "vendorId" text NOT NULL,
    provider public."ShippingProvider" NOT NULL,
    "warehouseId" text NOT NULL,
    name text,
    address text,
    "isDefault" boolean DEFAULT false NOT NULL,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: WebhookEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WebhookEvent" (
    id text NOT NULL,
    "sourceShopDomain" text NOT NULL,
    topic text NOT NULL,
    "webhookId" text,
    "idempotencyKey" text,
    "payloadHash" text,
    "rawPayload" text,
    status public."WebhookStatus" DEFAULT 'RECEIVED'::public."WebhookStatus" NOT NULL,
    "receivedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "processedAt" timestamp(3) without time zone,
    "errorMessage" text,
    "shopifyOrderId" text,
    "sourceShopifyOrderId" text,
    "executionAvailableAt" timestamp(3) without time zone,
    "executionAttemptCount" integer DEFAULT 0 NOT NULL,
    "executionMaxAttempts" integer DEFAULT 3 NOT NULL,
    "processingGeneration" integer DEFAULT 0 NOT NULL,
    "processingLeaseExpiresAt" timestamp(3) without time zone
);


--
-- Name: AllocationAssignmentHistory AllocationAssignmentHistory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationAssignmentHistory"
    ADD CONSTRAINT "AllocationAssignmentHistory_pkey" PRIMARY KEY (id);


--
-- Name: AllocationEconomicTransfer AllocationEconomicTransfer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationEconomicTransfer"
    ADD CONSTRAINT "AllocationEconomicTransfer_pkey" PRIMARY KEY (id);


--
-- Name: AllocationFullRefundTerminalFact AllocationFullRefundTerminalFact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationFullRefundTerminalFact"
    ADD CONSTRAINT "AllocationFullRefundTerminalFact_pkey" PRIMARY KEY (id);


--
-- Name: AllocationSplitEvent AllocationSplitEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationSplitEvent"
    ADD CONSTRAINT "AllocationSplitEvent_pkey" PRIMARY KEY (id);


--
-- Name: AutomationAction AutomationAction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AutomationAction"
    ADD CONSTRAINT "AutomationAction_pkey" PRIMARY KEY (id);


--
-- Name: CanonicalReconciliationRun CanonicalReconciliationRun_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CanonicalReconciliationRun"
    ADD CONSTRAINT "CanonicalReconciliationRun_pkey" PRIMARY KEY (id);


--
-- Name: CustomerCancellationRequestItem CustomerCancellationRequestItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerCancellationRequestItem"
    ADD CONSTRAINT "CustomerCancellationRequestItem_pkey" PRIMARY KEY (id);


--
-- Name: CustomerCancellationRequest CustomerCancellationRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerCancellationRequest"
    ADD CONSTRAINT "CustomerCancellationRequest_pkey" PRIMARY KEY (id);


--
-- Name: FinanceEvent FinanceEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceEvent"
    ADD CONSTRAINT "FinanceEvent_pkey" PRIMARY KEY (id);


--
-- Name: FinanceIntegrityAlert FinanceIntegrityAlert_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceIntegrityAlert"
    ADD CONSTRAINT "FinanceIntegrityAlert_pkey" PRIMARY KEY (id);


--
-- Name: FinanceLedgerEntry FinanceLedgerEntry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceLedgerEntry"
    ADD CONSTRAINT "FinanceLedgerEntry_pkey" PRIMARY KEY (id);


--
-- Name: FinancialCorrectionApprovedDeductionCoverage FinancialCorrectionApprovedDeductionCoverage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionApprovedDeductionCoverage"
    ADD CONSTRAINT "FinancialCorrectionApprovedDeductionCoverage_pkey" PRIMARY KEY (id);


--
-- Name: FinancialCorrectionApprovedDeductionPayoutLine FinancialCorrectionApprovedDeductionPayoutLine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionApprovedDeductionPayoutLine"
    ADD CONSTRAINT "FinancialCorrectionApprovedDeductionPayoutLine_pkey" PRIMARY KEY (id);


--
-- Name: FinancialCorrectionAuthority FinancialCorrectionAuthority_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionAuthority"
    ADD CONSTRAINT "FinancialCorrectionAuthority_pkey" PRIMARY KEY (id);


--
-- Name: FinancialCorrectionBaselineClaim FinancialCorrectionBaselineClaim_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionBaselineClaim"
    ADD CONSTRAINT "FinancialCorrectionBaselineClaim_pkey" PRIMARY KEY (id);


--
-- Name: FinancialCorrectionCreditPayoutLine FinancialCorrectionCreditPayoutLine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionCreditPayoutLine"
    ADD CONSTRAINT "FinancialCorrectionCreditPayoutLine_pkey" PRIMARY KEY (id);


--
-- Name: FinancialCorrectionCreditSettlementLine FinancialCorrectionCreditSettlementLine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionCreditSettlementLine"
    ADD CONSTRAINT "FinancialCorrectionCreditSettlementLine_pkey" PRIMARY KEY (id);


--
-- Name: FinancialCorrectionCredit FinancialCorrectionCredit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionCredit"
    ADD CONSTRAINT "FinancialCorrectionCredit_pkey" PRIMARY KEY (id);


--
-- Name: FinancialCorrectionDeductionPayoutLine FinancialCorrectionDeductionPayoutLine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionDeductionPayoutLine"
    ADD CONSTRAINT "FinancialCorrectionDeductionPayoutLine_pkey" PRIMARY KEY (id);


--
-- Name: FinancialCorrectionDeductionSettlementLine FinancialCorrectionDeductionSettlementLine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionDeductionSettlementLine"
    ADD CONSTRAINT "FinancialCorrectionDeductionSettlementLine_pkey" PRIMARY KEY (id);


--
-- Name: FinancialCorrectionDeduction FinancialCorrectionDeduction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionDeduction"
    ADD CONSTRAINT "FinancialCorrectionDeduction_pkey" PRIMARY KEY (id);


--
-- Name: FinancialCorrectionZeroNetAcknowledgement FinancialCorrectionZeroNetAcknowledgement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionZeroNetAcknowledgement"
    ADD CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_pkey" PRIMARY KEY (id);


--
-- Name: Fulfillment Fulfillment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Fulfillment"
    ADD CONSTRAINT "Fulfillment_pkey" PRIMARY KEY (id);


--
-- Name: LegacyRefundFinanceReviewEvent LegacyRefundFinanceReviewEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LegacyRefundFinanceReviewEvent"
    ADD CONSTRAINT "LegacyRefundFinanceReviewEvent_pkey" PRIMARY KEY (id);


--
-- Name: LegacyRefundFinanceReviewSource LegacyRefundFinanceReviewSource_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LegacyRefundFinanceReviewSource"
    ADD CONSTRAINT "LegacyRefundFinanceReviewSource_pkey" PRIMARY KEY (id);


--
-- Name: LegacyRefundFinanceReview LegacyRefundFinanceReview_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LegacyRefundFinanceReview"
    ADD CONSTRAINT "LegacyRefundFinanceReview_pkey" PRIMARY KEY (id);


--
-- Name: NotificationIntent NotificationIntent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NotificationIntent"
    ADD CONSTRAINT "NotificationIntent_pkey" PRIMARY KEY (id);


--
-- Name: OperationalJob OperationalJob_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationalJob"
    ADD CONSTRAINT "OperationalJob_pkey" PRIMARY KEY (id);


--
-- Name: OperationalSignal OperationalSignal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationalSignal"
    ADD CONSTRAINT "OperationalSignal_pkey" PRIMARY KEY (id);


--
-- Name: OrderShippingRefundClaim OrderShippingRefundClaim_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OrderShippingRefundClaim"
    ADD CONSTRAINT "OrderShippingRefundClaim_pkey" PRIMARY KEY (id);


--
-- Name: OutboundShopifyRefundAttempt OutboundShopifyRefundAttempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OutboundShopifyRefundAttempt"
    ADD CONSTRAINT "OutboundShopifyRefundAttempt_pkey" PRIMARY KEY (id);


--
-- Name: PayoutBatchLine PayoutBatchLine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutBatchLine"
    ADD CONSTRAINT "PayoutBatchLine_pkey" PRIMARY KEY (id);


--
-- Name: PayoutBatch PayoutBatch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutBatch"
    ADD CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY (id);


--
-- Name: ProductPanelVariantDisableOutboxEvent ProductPanelVariantDisableOutboxEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProductPanelVariantDisableOutboxEvent"
    ADD CONSTRAINT "ProductPanelVariantDisableOutboxEvent_pkey" PRIMARY KEY (id);


--
-- Name: RefundEvidenceSnapshot RefundEvidenceSnapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundEvidenceSnapshot"
    ADD CONSTRAINT "RefundEvidenceSnapshot_pkey" PRIMARY KEY (id);


--
-- Name: RefundRecord RefundRecord_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundRecord"
    ADD CONSTRAINT "RefundRecord_pkey" PRIMARY KEY (id);


--
-- Name: RefundTerminalConflictEvidence RefundTerminalConflictEvidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalConflictEvidence"
    ADD CONSTRAINT "RefundTerminalConflictEvidence_pkey" PRIMARY KEY (id);


--
-- Name: RefundTerminalEvidenceReviewEvent RefundTerminalEvidenceReviewEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalEvidenceReviewEvent"
    ADD CONSTRAINT "RefundTerminalEvidenceReviewEvent_pkey" PRIMARY KEY (id);


--
-- Name: RefundTerminalEvidenceReview RefundTerminalEvidenceReview_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalEvidenceReview"
    ADD CONSTRAINT "RefundTerminalEvidenceReview_pkey" PRIMARY KEY (id);


--
-- Name: ReturnRecord ReturnRecord_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReturnRecord"
    ADD CONSTRAINT "ReturnRecord_pkey" PRIMARY KEY (id);


--
-- Name: SettlementApprovalLine SettlementApprovalLine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementApprovalLine"
    ADD CONSTRAINT "SettlementApprovalLine_pkey" PRIMARY KEY (id);


--
-- Name: SettlementApproval SettlementApproval_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementApproval"
    ADD CONSTRAINT "SettlementApproval_pkey" PRIMARY KEY (id);


--
-- Name: SettlementCommissionInvoice SettlementCommissionInvoice_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementCommissionInvoice"
    ADD CONSTRAINT "SettlementCommissionInvoice_pkey" PRIMARY KEY (id);


--
-- Name: SettlementRefundAdjustmentApplication SettlementRefundAdjustmentApplication_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustmentApplication"
    ADD CONSTRAINT "SettlementRefundAdjustmentApplication_pkey" PRIMARY KEY (id);


--
-- Name: SettlementRefundAdjustmentEvent SettlementRefundAdjustmentEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustmentEvent"
    ADD CONSTRAINT "SettlementRefundAdjustmentEvent_pkey" PRIMARY KEY (id);


--
-- Name: SettlementRefundAdjustment SettlementRefundAdjustment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustment"
    ADD CONSTRAINT "SettlementRefundAdjustment_pkey" PRIMARY KEY (id);


--
-- Name: SettlementScheduleJobRun SettlementScheduleJobRun_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementScheduleJobRun"
    ADD CONSTRAINT "SettlementScheduleJobRun_pkey" PRIMARY KEY (id);


--
-- Name: ShipmentExecution ShipmentExecution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShipmentExecution"
    ADD CONSTRAINT "ShipmentExecution_pkey" PRIMARY KEY (id);


--
-- Name: ShipmentShippingCost ShipmentShippingCost_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShipmentShippingCost"
    ADD CONSTRAINT "ShipmentShippingCost_pkey" PRIMARY KEY (id);


--
-- Name: ShopifyOrderLineItem ShopifyOrderLineItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShopifyOrderLineItem"
    ADD CONSTRAINT "ShopifyOrderLineItem_pkey" PRIMARY KEY (id);


--
-- Name: ShopifyOrder ShopifyOrder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShopifyOrder"
    ADD CONSTRAINT "ShopifyOrder_pkey" PRIMARY KEY (id);


--
-- Name: ShopifyRefundLineItem ShopifyRefundLineItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShopifyRefundLineItem"
    ADD CONSTRAINT "ShopifyRefundLineItem_pkey" PRIMARY KEY (id);


--
-- Name: ShopifyRefund ShopifyRefund_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShopifyRefund"
    ADD CONSTRAINT "ShopifyRefund_pkey" PRIMARY KEY (id);


--
-- Name: SupportTicketNote SupportTicketNote_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportTicketNote"
    ADD CONSTRAINT "SupportTicketNote_pkey" PRIMARY KEY (id);


--
-- Name: SupportTicketReply SupportTicketReply_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportTicketReply"
    ADD CONSTRAINT "SupportTicketReply_pkey" PRIMARY KEY (id);


--
-- Name: SupportTicket SupportTicket_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportTicket"
    ADD CONSTRAINT "SupportTicket_pkey" PRIMARY KEY (id);


--
-- Name: UserVendorAccess UserVendorAccess_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserVendorAccess"
    ADD CONSTRAINT "UserVendorAccess_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: VendorAllocationLineItem VendorAllocationLineItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorAllocationLineItem"
    ADD CONSTRAINT "VendorAllocationLineItem_pkey" PRIMARY KEY (id);


--
-- Name: VendorAllocation VendorAllocation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorAllocation"
    ADD CONSTRAINT "VendorAllocation_pkey" PRIMARY KEY (id);


--
-- Name: VendorBalanceEvent VendorBalanceEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorBalanceEvent"
    ADD CONSTRAINT "VendorBalanceEvent_pkey" PRIMARY KEY (id);


--
-- Name: VendorBillingProfile VendorBillingProfile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorBillingProfile"
    ADD CONSTRAINT "VendorBillingProfile_pkey" PRIMARY KEY (id);


--
-- Name: VendorFinancialProfile VendorFinancialProfile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorFinancialProfile"
    ADD CONSTRAINT "VendorFinancialProfile_pkey" PRIMARY KEY (id);


--
-- Name: VendorIntegrationAuditLog VendorIntegrationAuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorIntegrationAuditLog"
    ADD CONSTRAINT "VendorIntegrationAuditLog_pkey" PRIMARY KEY (id);


--
-- Name: VendorIntegrationClient VendorIntegrationClient_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorIntegrationClient"
    ADD CONSTRAINT "VendorIntegrationClient_pkey" PRIMARY KEY (id);


--
-- Name: VendorIntegrationInvoiceEvent VendorIntegrationInvoiceEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorIntegrationInvoiceEvent"
    ADD CONSTRAINT "VendorIntegrationInvoiceEvent_pkey" PRIMARY KEY (id);


--
-- Name: VendorIntegrationShipmentEvent VendorIntegrationShipmentEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorIntegrationShipmentEvent"
    ADD CONSTRAINT "VendorIntegrationShipmentEvent_pkey" PRIMARY KEY (id);


--
-- Name: VendorIntegrationStatusEvent VendorIntegrationStatusEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorIntegrationStatusEvent"
    ADD CONSTRAINT "VendorIntegrationStatusEvent_pkey" PRIMARY KEY (id);


--
-- Name: VendorProfileAuditLog VendorProfileAuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorProfileAuditLog"
    ADD CONSTRAINT "VendorProfileAuditLog_pkey" PRIMARY KEY (id);


--
-- Name: VendorShippingConfig VendorShippingConfig_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorShippingConfig"
    ADD CONSTRAINT "VendorShippingConfig_pkey" PRIMARY KEY (id);


--
-- Name: VendorShippingWarehouse VendorShippingWarehouse_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorShippingWarehouse"
    ADD CONSTRAINT "VendorShippingWarehouse_pkey" PRIMARY KEY (id);


--
-- Name: Vendor Vendor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Vendor"
    ADD CONSTRAINT "Vendor_pkey" PRIMARY KEY (id);


--
-- Name: WebhookEvent WebhookEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WebhookEvent"
    ADD CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY (id);


--
-- Name: AllocationEconomicTransfer_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AllocationEconomicTransfer_createdAt_idx" ON public."AllocationEconomicTransfer" USING btree ("createdAt");


--
-- Name: AllocationEconomicTransfer_fromVendorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AllocationEconomicTransfer_fromVendorId_idx" ON public."AllocationEconomicTransfer" USING btree ("fromVendorId");


--
-- Name: AllocationEconomicTransfer_idempotencyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AllocationEconomicTransfer_idempotencyKey_key" ON public."AllocationEconomicTransfer" USING btree ("idempotencyKey");


--
-- Name: AllocationEconomicTransfer_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AllocationEconomicTransfer_status_idx" ON public."AllocationEconomicTransfer" USING btree (status);


--
-- Name: AllocationEconomicTransfer_toVendorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AllocationEconomicTransfer_toVendorId_idx" ON public."AllocationEconomicTransfer" USING btree ("toVendorId");


--
-- Name: AllocationEconomicTransfer_vendorAllocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AllocationEconomicTransfer_vendorAllocationId_idx" ON public."AllocationEconomicTransfer" USING btree ("vendorAllocationId");


--
-- Name: AllocationFullRefundTerminalFact_shopifyOrderGid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AllocationFullRefundTerminalFact_shopifyOrderGid_idx" ON public."AllocationFullRefundTerminalFact" USING btree ("shopifyOrderGid");


--
-- Name: AllocationFullRefundTerminalFact_vendorAllocationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AllocationFullRefundTerminalFact_vendorAllocationId_key" ON public."AllocationFullRefundTerminalFact" USING btree ("vendorAllocationId");


--
-- Name: AllocationSplitEvent_actorUserId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AllocationSplitEvent_actorUserId_idx" ON public."AllocationSplitEvent" USING btree ("actorUserId");


--
-- Name: AllocationSplitEvent_childAllocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AllocationSplitEvent_childAllocationId_idx" ON public."AllocationSplitEvent" USING btree ("childAllocationId");


--
-- Name: AllocationSplitEvent_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AllocationSplitEvent_createdAt_idx" ON public."AllocationSplitEvent" USING btree ("createdAt");


--
-- Name: AllocationSplitEvent_sourceAllocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AllocationSplitEvent_sourceAllocationId_idx" ON public."AllocationSplitEvent" USING btree ("sourceAllocationId");


--
-- Name: AutomationAction_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AutomationAction_createdAt_idx" ON public."AutomationAction" USING btree ("createdAt");


--
-- Name: AutomationAction_signalId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AutomationAction_signalId_idx" ON public."AutomationAction" USING btree ("signalId");


--
-- Name: AutomationAction_status_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AutomationAction_status_type_idx" ON public."AutomationAction" USING btree (status, type);


--
-- Name: AutomationAction_vendorId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AutomationAction_vendorId_status_idx" ON public."AutomationAction" USING btree ("vendorId", status);


--
-- Name: CanonicalReconciliationRun_mode_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CanonicalReconciliationRun_mode_status_idx" ON public."CanonicalReconciliationRun" USING btree (mode, status);


--
-- Name: CanonicalReconciliationRun_startedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CanonicalReconciliationRun_startedAt_idx" ON public."CanonicalReconciliationRun" USING btree ("startedAt");


--
-- Name: CustomerCancellationRequestItem_requestId_shopifyOrderLineI_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CustomerCancellationRequestItem_requestId_shopifyOrderLineI_key" ON public."CustomerCancellationRequestItem" USING btree ("requestId", "shopifyOrderLineItemId", "vendorAllocationId");


--
-- Name: CustomerCancellationRequestItem_shopifyOrderLineItemId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CustomerCancellationRequestItem_shopifyOrderLineItemId_idx" ON public."CustomerCancellationRequestItem" USING btree ("shopifyOrderLineItemId");


--
-- Name: CustomerCancellationRequestItem_vendorAllocationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CustomerCancellationRequestItem_vendorAllocationId_status_idx" ON public."CustomerCancellationRequestItem" USING btree ("vendorAllocationId", status);


--
-- Name: CustomerCancellationRequest_shopDomain_shopifyCustomerId_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CustomerCancellationRequest_shopDomain_shopifyCustomerId_id_key" ON public."CustomerCancellationRequest" USING btree ("shopDomain", "shopifyCustomerId", "idempotencyKey");


--
-- Name: CustomerCancellationRequest_shopifyCustomerId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CustomerCancellationRequest_shopifyCustomerId_status_idx" ON public."CustomerCancellationRequest" USING btree ("shopifyCustomerId", status);


--
-- Name: CustomerCancellationRequest_shopifyOrderId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CustomerCancellationRequest_shopifyOrderId_status_idx" ON public."CustomerCancellationRequest" USING btree ("shopifyOrderId", status);


--
-- Name: FinanceEvent_eventType_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceEvent_eventType_createdAt_idx" ON public."FinanceEvent" USING btree ("eventType", "createdAt");


--
-- Name: FinanceEvent_financeLedgerEntryId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceEvent_financeLedgerEntryId_createdAt_idx" ON public."FinanceEvent" USING btree ("financeLedgerEntryId", "createdAt");


--
-- Name: FinanceEvent_idempotencyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinanceEvent_idempotencyKey_key" ON public."FinanceEvent" USING btree ("idempotencyKey");


--
-- Name: FinanceEvent_referenceType_referenceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceEvent_referenceType_referenceId_idx" ON public."FinanceEvent" USING btree ("referenceType", "referenceId");


--
-- Name: FinanceEvent_shopifyOrderId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceEvent_shopifyOrderId_createdAt_idx" ON public."FinanceEvent" USING btree ("shopifyOrderId", "createdAt");


--
-- Name: FinanceEvent_vendorId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceEvent_vendorId_createdAt_idx" ON public."FinanceEvent" USING btree ("vendorId", "createdAt");


--
-- Name: FinanceIntegrityAlert_allocationEconomicTransferId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceIntegrityAlert_allocationEconomicTransferId_idx" ON public."FinanceIntegrityAlert" USING btree ("allocationEconomicTransferId");


--
-- Name: FinanceIntegrityAlert_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceIntegrityAlert_category_idx" ON public."FinanceIntegrityAlert" USING btree (category);


--
-- Name: FinanceIntegrityAlert_dedupeKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinanceIntegrityAlert_dedupeKey_key" ON public."FinanceIntegrityAlert" USING btree ("dedupeKey");


--
-- Name: FinanceIntegrityAlert_detectedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceIntegrityAlert_detectedAt_idx" ON public."FinanceIntegrityAlert" USING btree ("detectedAt");


--
-- Name: FinanceIntegrityAlert_severity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceIntegrityAlert_severity_idx" ON public."FinanceIntegrityAlert" USING btree (severity);


--
-- Name: FinanceIntegrityAlert_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceIntegrityAlert_status_idx" ON public."FinanceIntegrityAlert" USING btree (status);


--
-- Name: FinanceIntegrityAlert_vendorAllocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceIntegrityAlert_vendorAllocationId_idx" ON public."FinanceIntegrityAlert" USING btree ("vendorAllocationId");


--
-- Name: FinanceLedgerEntry_supersededByLedgerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceLedgerEntry_supersededByLedgerId_idx" ON public."FinanceLedgerEntry" USING btree ("supersededByLedgerId");


--
-- Name: FinanceLedgerEntry_vendorId_entryType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceLedgerEntry_vendorId_entryType_idx" ON public."FinanceLedgerEntry" USING btree ("vendorId", "entryType");


--
-- Name: FinanceLedgerEntry_vendorId_settlementStatus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinanceLedgerEntry_vendorId_settlementStatus_idx" ON public."FinanceLedgerEntry" USING btree ("vendorId", "settlementStatus");


--
-- Name: FinancialCorrectionApprovedDeductionCoverage_approval_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinancialCorrectionApprovedDeductionCoverage_approval_status_id" ON public."FinancialCorrectionApprovedDeductionCoverage" USING btree ("settlementApprovalId", status);


--
-- Name: FinancialCorrectionApprovedDeductionCoverage_deductionId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionApprovedDeductionCoverage_deductionId_key" ON public."FinancialCorrectionApprovedDeductionCoverage" USING btree ("deductionId");


--
-- Name: FinancialCorrectionApprovedDeductionCoverage_vendor_currency_st; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinancialCorrectionApprovedDeductionCoverage_vendor_currency_st" ON public."FinancialCorrectionApprovedDeductionCoverage" USING btree ("vendorId", currency, status);


--
-- Name: FinancialCorrectionApprovedDeductionPayoutLine_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinancialCorrectionApprovedDeductionPayoutLine_batch_idx" ON public."FinancialCorrectionApprovedDeductionPayoutLine" USING btree ("payoutBatchId");


--
-- Name: FinancialCorrectionApprovedDeductionPayoutLine_non_cancelled_so; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionApprovedDeductionPayoutLine_non_cancelled_so" ON public."FinancialCorrectionApprovedDeductionPayoutLine" USING btree ("coverageId") WHERE (status <> 'CANCELLED'::text);


--
-- Name: FinancialCorrectionApprovedDeductionPayoutLine_source_batch_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionApprovedDeductionPayoutLine_source_batch_key" ON public."FinancialCorrectionApprovedDeductionPayoutLine" USING btree ("coverageId", "payoutBatchId");


--
-- Name: FinancialCorrectionAuthority_accepted_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionAuthority_accepted_key" ON public."FinancialCorrectionAuthority" USING btree ("acceptedEvidenceSnapshotId");


--
-- Name: FinancialCorrectionAuthority_approved_settlement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinancialCorrectionAuthority_approved_settlement_idx" ON public."FinancialCorrectionAuthority" USING btree ("historicalApprovedSettlementId");


--
-- Name: FinancialCorrectionAuthority_event_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionAuthority_event_key" ON public."FinancialCorrectionAuthority" USING btree ("resolvedReviewEventId");


--
-- Name: FinancialCorrectionAuthority_incoming_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionAuthority_incoming_key" ON public."FinancialCorrectionAuthority" USING btree ("incomingConflictEvidenceId");


--
-- Name: FinancialCorrectionAuthority_pair_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionAuthority_pair_key" ON public."FinancialCorrectionAuthority" USING btree ("acceptedEvidenceSnapshotId", "incomingConflictEvidenceId");


--
-- Name: FinancialCorrectionAuthority_review_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionAuthority_review_key" ON public."FinancialCorrectionAuthority" USING btree ("reviewId");


--
-- Name: FinancialCorrectionAuthority_vendor_applied_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinancialCorrectionAuthority_vendor_applied_idx" ON public."FinancialCorrectionAuthority" USING btree ("vendorId", "appliedAt");


--
-- Name: FinancialCorrectionBaselineClaim_accepted_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionBaselineClaim_accepted_key" ON public."FinancialCorrectionBaselineClaim" USING btree ("acceptedEvidenceSnapshotId");


--
-- Name: FinancialCorrectionBaselineClaim_consumer_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionBaselineClaim_consumer_key" ON public."FinancialCorrectionBaselineClaim" USING btree ("consumerId");


--
-- Name: FinancialCorrectionCreditPayoutLine_non_cancelled_source_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionCreditPayoutLine_non_cancelled_source_key" ON public."FinancialCorrectionCreditPayoutLine" USING btree ("settlementCreditLineId") WHERE (status <> 'CANCELLED'::text);


--
-- Name: FinancialCorrectionCreditPayoutLine_payoutBatchId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinancialCorrectionCreditPayoutLine_payoutBatchId_idx" ON public."FinancialCorrectionCreditPayoutLine" USING btree ("payoutBatchId");


--
-- Name: FinancialCorrectionCreditPayoutLine_settlementCreditLineId__key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionCreditPayoutLine_settlementCreditLineId__key" ON public."FinancialCorrectionCreditPayoutLine" USING btree ("settlementCreditLineId", "payoutBatchId");


--
-- Name: FinancialCorrectionCreditSettlementLine_active_credit_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionCreditSettlementLine_active_credit_key" ON public."FinancialCorrectionCreditSettlementLine" USING btree ("creditId") WHERE (status = 'ACTIVE'::text);


--
-- Name: FinancialCorrectionCreditSettlementLine_creditId_settlement_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionCreditSettlementLine_creditId_settlement_key" ON public."FinancialCorrectionCreditSettlementLine" USING btree ("creditId", "settlementApprovalId");


--
-- Name: FinancialCorrectionCreditSettlementLine_settlementApprovalI_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinancialCorrectionCreditSettlementLine_settlementApprovalI_idx" ON public."FinancialCorrectionCreditSettlementLine" USING btree ("settlementApprovalId");


--
-- Name: FinancialCorrectionCredit_authorityId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionCredit_authorityId_key" ON public."FinancialCorrectionCredit" USING btree ("authorityId");


--
-- Name: FinancialCorrectionCredit_vendorId_currency_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinancialCorrectionCredit_vendorId_currency_createdAt_idx" ON public."FinancialCorrectionCredit" USING btree ("vendorId", currency, "createdAt");


--
-- Name: FinancialCorrectionDeductionPayoutLine_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinancialCorrectionDeductionPayoutLine_batch_idx" ON public."FinancialCorrectionDeductionPayoutLine" USING btree ("payoutBatchId");


--
-- Name: FinancialCorrectionDeductionPayoutLine_non_cancelled_source_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionDeductionPayoutLine_non_cancelled_source_key" ON public."FinancialCorrectionDeductionPayoutLine" USING btree ("settlementDeductionLineId") WHERE (status <> 'CANCELLED'::text);


--
-- Name: FinancialCorrectionDeductionPayoutLine_source_batch_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionDeductionPayoutLine_source_batch_key" ON public."FinancialCorrectionDeductionPayoutLine" USING btree ("settlementDeductionLineId", "payoutBatchId");


--
-- Name: FinancialCorrectionDeductionSettlementLine_active_source_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionDeductionSettlementLine_active_source_key" ON public."FinancialCorrectionDeductionSettlementLine" USING btree ("deductionId") WHERE (status = 'ACTIVE'::text);


--
-- Name: FinancialCorrectionDeductionSettlementLine_settlement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinancialCorrectionDeductionSettlementLine_settlement_idx" ON public."FinancialCorrectionDeductionSettlementLine" USING btree ("settlementApprovalId");


--
-- Name: FinancialCorrectionDeductionSettlementLine_source_settlement_ke; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionDeductionSettlementLine_source_settlement_ke" ON public."FinancialCorrectionDeductionSettlementLine" USING btree ("deductionId", "settlementApprovalId");


--
-- Name: FinancialCorrectionDeduction_authorityId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FinancialCorrectionDeduction_authorityId_key" ON public."FinancialCorrectionDeduction" USING btree ("authorityId");


--
-- Name: FinancialCorrectionDeduction_vendorId_currency_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FinancialCorrectionDeduction_vendorId_currency_createdAt_idx" ON public."FinancialCorrectionDeduction" USING btree ("vendorId", currency, "createdAt");


--
-- Name: Fulfillment_vendorAllocationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Fulfillment_vendorAllocationId_key" ON public."Fulfillment" USING btree ("vendorAllocationId");


--
-- Name: LegacyRefundFinanceReviewEvent_eventType_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LegacyRefundFinanceReviewEvent_eventType_createdAt_idx" ON public."LegacyRefundFinanceReviewEvent" USING btree ("eventType", "createdAt");


--
-- Name: LegacyRefundFinanceReviewEvent_reviewId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LegacyRefundFinanceReviewEvent_reviewId_createdAt_idx" ON public."LegacyRefundFinanceReviewEvent" USING btree ("reviewId", "createdAt");


--
-- Name: LegacyRefundFinanceReviewSource_artifactType_artifactId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "LegacyRefundFinanceReviewSource_artifactType_artifactId_key" ON public."LegacyRefundFinanceReviewSource" USING btree ("artifactType", "artifactId");


--
-- Name: LegacyRefundFinanceReviewSource_reviewId_observedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LegacyRefundFinanceReviewSource_reviewId_observedAt_idx" ON public."LegacyRefundFinanceReviewSource" USING btree ("reviewId", "observedAt");


--
-- Name: LegacyRefundFinanceReview_attribution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LegacyRefundFinanceReview_attribution_idx" ON public."LegacyRefundFinanceReview" USING btree (attribution);


--
-- Name: LegacyRefundFinanceReview_caseKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "LegacyRefundFinanceReview_caseKey_key" ON public."LegacyRefundFinanceReview" USING btree ("caseKey");


--
-- Name: LegacyRefundFinanceReview_lastObservedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LegacyRefundFinanceReview_lastObservedAt_idx" ON public."LegacyRefundFinanceReview" USING btree ("lastObservedAt");


--
-- Name: LegacyRefundFinanceReview_observedVendorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LegacyRefundFinanceReview_observedVendorId_idx" ON public."LegacyRefundFinanceReview" USING btree ("observedVendorId");


--
-- Name: LegacyRefundFinanceReview_resolutionOutcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LegacyRefundFinanceReview_resolutionOutcome_idx" ON public."LegacyRefundFinanceReview" USING btree ("resolutionOutcome");


--
-- Name: LegacyRefundFinanceReview_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LegacyRefundFinanceReview_status_idx" ON public."LegacyRefundFinanceReview" USING btree (status);


--
-- Name: LegacyRefundFinanceReview_vendorAllocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "LegacyRefundFinanceReview_vendorAllocationId_idx" ON public."LegacyRefundFinanceReview" USING btree ("vendorAllocationId");


--
-- Name: NotificationIntent_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "NotificationIntent_createdAt_idx" ON public."NotificationIntent" USING btree ("createdAt");


--
-- Name: NotificationIntent_recipientRole_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "NotificationIntent_recipientRole_status_idx" ON public."NotificationIntent" USING btree ("recipientRole", status);


--
-- Name: NotificationIntent_signalId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "NotificationIntent_signalId_idx" ON public."NotificationIntent" USING btree ("signalId");


--
-- Name: NotificationIntent_vendorId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "NotificationIntent_vendorId_status_idx" ON public."NotificationIntent" USING btree ("vendorId", status);


--
-- Name: OperationalJob_customerCancellationRequestItemId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OperationalJob_customerCancellationRequestItemId_key" ON public."OperationalJob" USING btree ("customerCancellationRequestItemId");


--
-- Name: OperationalJob_jobType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationalJob_jobType_idx" ON public."OperationalJob" USING btree ("jobType");


--
-- Name: OperationalJob_sourceShopifyOrderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationalJob_sourceShopifyOrderId_idx" ON public."OperationalJob" USING btree ("sourceShopifyOrderId");


--
-- Name: OperationalJob_status_nextRetryAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationalJob_status_nextRetryAt_idx" ON public."OperationalJob" USING btree (status, "nextRetryAt");


--
-- Name: OperationalJob_status_processingLeaseExpiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationalJob_status_processingLeaseExpiresAt_idx" ON public."OperationalJob" USING btree (status, "processingLeaseExpiresAt");


--
-- Name: OperationalJob_status_scheduledAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationalJob_status_scheduledAt_idx" ON public."OperationalJob" USING btree (status, "scheduledAt");


--
-- Name: OperationalJob_vendorAllocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationalJob_vendorAllocationId_idx" ON public."OperationalJob" USING btree ("vendorAllocationId");


--
-- Name: OperationalJob_webhookEventId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationalJob_webhookEventId_idx" ON public."OperationalJob" USING btree ("webhookEventId");


--
-- Name: OperationalSignal_ruleKey_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationalSignal_ruleKey_idx" ON public."OperationalSignal" USING btree ("ruleKey");


--
-- Name: OperationalSignal_sourceArea_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationalSignal_sourceArea_status_idx" ON public."OperationalSignal" USING btree ("sourceArea", status);


--
-- Name: OperationalSignal_status_severity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationalSignal_status_severity_idx" ON public."OperationalSignal" USING btree (status, severity);


--
-- Name: OperationalSignal_triggeredAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationalSignal_triggeredAt_idx" ON public."OperationalSignal" USING btree ("triggeredAt");


--
-- Name: OperationalSignal_vendorId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationalSignal_vendorId_status_idx" ON public."OperationalSignal" USING btree ("vendorId", status);


--
-- Name: OrderShippingRefundClaim_activeOrderKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OrderShippingRefundClaim_activeOrderKey_key" ON public."OrderShippingRefundClaim" USING btree ("activeOrderKey");


--
-- Name: OrderShippingRefundClaim_ownerAttemptId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OrderShippingRefundClaim_ownerAttemptId_key" ON public."OrderShippingRefundClaim" USING btree ("ownerAttemptId");


--
-- Name: OrderShippingRefundClaim_shopifyOrderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OrderShippingRefundClaim_shopifyOrderId_idx" ON public."OrderShippingRefundClaim" USING btree ("shopifyOrderId");


--
-- Name: OrderShippingRefundClaim_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OrderShippingRefundClaim_status_idx" ON public."OrderShippingRefundClaim" USING btree (status);


--
-- Name: OutboundShopifyRefundAttempt_customerCancellationRequestIte_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OutboundShopifyRefundAttempt_customerCancellationRequestIte_key" ON public."OutboundShopifyRefundAttempt" USING btree ("customerCancellationRequestItemId");


--
-- Name: OutboundShopifyRefundAttempt_previewHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OutboundShopifyRefundAttempt_previewHash_idx" ON public."OutboundShopifyRefundAttempt" USING btree ("previewHash");


--
-- Name: OutboundShopifyRefundAttempt_shopifyOrderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OutboundShopifyRefundAttempt_shopifyOrderId_idx" ON public."OutboundShopifyRefundAttempt" USING btree ("shopifyOrderId");


--
-- Name: OutboundShopifyRefundAttempt_shopifyRefundId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OutboundShopifyRefundAttempt_shopifyRefundId_idx" ON public."OutboundShopifyRefundAttempt" USING btree ("shopifyRefundId");


--
-- Name: OutboundShopifyRefundAttempt_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OutboundShopifyRefundAttempt_status_idx" ON public."OutboundShopifyRefundAttempt" USING btree (status);


--
-- Name: OutboundShopifyRefundAttempt_vendorAllocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OutboundShopifyRefundAttempt_vendorAllocationId_idx" ON public."OutboundShopifyRefundAttempt" USING btree ("vendorAllocationId");


--
-- Name: PayoutBatchLine_financeLedgerEntryId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PayoutBatchLine_financeLedgerEntryId_idx" ON public."PayoutBatchLine" USING btree ("financeLedgerEntryId");


--
-- Name: PayoutBatchLine_payoutBatchId_settlementApprovalLineId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PayoutBatchLine_payoutBatchId_settlementApprovalLineId_key" ON public."PayoutBatchLine" USING btree ("payoutBatchId", "settlementApprovalLineId");


--
-- Name: PayoutBatchLine_settlementApprovalLineId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PayoutBatchLine_settlementApprovalLineId_idx" ON public."PayoutBatchLine" USING btree ("settlementApprovalLineId");


--
-- Name: PayoutBatch_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PayoutBatch_createdAt_idx" ON public."PayoutBatch" USING btree ("createdAt");


--
-- Name: PayoutBatch_vendorId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PayoutBatch_vendorId_status_idx" ON public."PayoutBatch" USING btree ("vendorId", status);


--
-- Name: ProductPanelVariantDisableOutboxEvent_allocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProductPanelVariantDisableOutboxEvent_allocationId_idx" ON public."ProductPanelVariantDisableOutboxEvent" USING btree ("allocationId");


--
-- Name: ProductPanelVariantDisableOutboxEvent_idempotencyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ProductPanelVariantDisableOutboxEvent_idempotencyKey_key" ON public."ProductPanelVariantDisableOutboxEvent" USING btree ("idempotencyKey");


--
-- Name: ProductPanelVariantDisableOutboxEvent_shopifyOrderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProductPanelVariantDisableOutboxEvent_shopifyOrderId_idx" ON public."ProductPanelVariantDisableOutboxEvent" USING btree ("shopifyOrderId");


--
-- Name: ProductPanelVariantDisableOutboxEvent_status_requestedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProductPanelVariantDisableOutboxEvent_status_requestedAt_idx" ON public."ProductPanelVariantDisableOutboxEvent" USING btree (status, "requestedAt");


--
-- Name: ProductPanelVariantDisableOutboxEvent_vendorAllocationLineI_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProductPanelVariantDisableOutboxEvent_vendorAllocationLineI_idx" ON public."ProductPanelVariantDisableOutboxEvent" USING btree ("vendorAllocationLineItemId");


--
-- Name: ProductPanelVariantDisableOutboxEvent_vendorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProductPanelVariantDisableOutboxEvent_vendorId_idx" ON public."ProductPanelVariantDisableOutboxEvent" USING btree ("vendorId");


--
-- Name: RefundEvidenceSnapshot_evidenceHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundEvidenceSnapshot_evidenceHash_idx" ON public."RefundEvidenceSnapshot" USING btree ("evidenceHash");


--
-- Name: RefundEvidenceSnapshot_historicalEconomicVendorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundEvidenceSnapshot_historicalEconomicVendorId_idx" ON public."RefundEvidenceSnapshot" USING btree ("historicalEconomicVendorId");


--
-- Name: RefundEvidenceSnapshot_refundFinanceLedgerEntryId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "RefundEvidenceSnapshot_refundFinanceLedgerEntryId_key" ON public."RefundEvidenceSnapshot" USING btree ("refundFinanceLedgerEntryId");


--
-- Name: RefundEvidenceSnapshot_refundRecordId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "RefundEvidenceSnapshot_refundRecordId_key" ON public."RefundEvidenceSnapshot" USING btree ("refundRecordId");


--
-- Name: RefundEvidenceSnapshot_sourceShopifyOrderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundEvidenceSnapshot_sourceShopifyOrderId_idx" ON public."RefundEvidenceSnapshot" USING btree ("sourceShopifyOrderId");


--
-- Name: RefundEvidenceSnapshot_sourceShopifyRefundId_vendorAllocati_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "RefundEvidenceSnapshot_sourceShopifyRefundId_vendorAllocati_key" ON public."RefundEvidenceSnapshot" USING btree ("sourceShopifyRefundId", "vendorAllocationId");


--
-- Name: RefundEvidenceSnapshot_vendorAllocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundEvidenceSnapshot_vendorAllocationId_idx" ON public."RefundEvidenceSnapshot" USING btree ("vendorAllocationId");


--
-- Name: RefundRecord_vendorAllocationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundRecord_vendorAllocationId_createdAt_idx" ON public."RefundRecord" USING btree ("vendorAllocationId", "createdAt");


--
-- Name: RefundTerminalConflictEvidence_economicVendorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalConflictEvidence_economicVendorId_idx" ON public."RefundTerminalConflictEvidence" USING btree ("economicVendorId");


--
-- Name: RefundTerminalConflictEvidence_evidenceHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalConflictEvidence_evidenceHash_idx" ON public."RefundTerminalConflictEvidence" USING btree ("evidenceHash");


--
-- Name: RefundTerminalConflictEvidence_historicalSaleFinanceLedgerE_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalConflictEvidence_historicalSaleFinanceLedgerE_idx" ON public."RefundTerminalConflictEvidence" USING btree ("historicalSaleFinanceLedgerEntryId");


--
-- Name: RefundTerminalConflictEvidence_reviewId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "RefundTerminalConflictEvidence_reviewId_key" ON public."RefundTerminalConflictEvidence" USING btree ("reviewId");


--
-- Name: RefundTerminalConflictEvidence_sourceShopifyOrderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalConflictEvidence_sourceShopifyOrderId_idx" ON public."RefundTerminalConflictEvidence" USING btree ("sourceShopifyOrderId");


--
-- Name: RefundTerminalConflictEvidence_sourceShopifyRefundId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalConflictEvidence_sourceShopifyRefundId_idx" ON public."RefundTerminalConflictEvidence" USING btree ("sourceShopifyRefundId");


--
-- Name: RefundTerminalConflictEvidence_vendorAllocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalConflictEvidence_vendorAllocationId_idx" ON public."RefundTerminalConflictEvidence" USING btree ("vendorAllocationId");


--
-- Name: RefundTerminalEvidenceReviewEvent_eventType_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalEvidenceReviewEvent_eventType_createdAt_idx" ON public."RefundTerminalEvidenceReviewEvent" USING btree ("eventType", "createdAt");


--
-- Name: RefundTerminalEvidenceReviewEvent_reviewId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalEvidenceReviewEvent_reviewId_createdAt_idx" ON public."RefundTerminalEvidenceReviewEvent" USING btree ("reviewId", "createdAt");


--
-- Name: RefundTerminalEvidenceReview_dedupeKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "RefundTerminalEvidenceReview_dedupeKey_key" ON public."RefundTerminalEvidenceReview" USING btree ("dedupeKey");


--
-- Name: RefundTerminalEvidenceReview_firstObservedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalEvidenceReview_firstObservedAt_idx" ON public."RefundTerminalEvidenceReview" USING btree ("firstObservedAt");


--
-- Name: RefundTerminalEvidenceReview_sourceShopifyRefundId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalEvidenceReview_sourceShopifyRefundId_idx" ON public."RefundTerminalEvidenceReview" USING btree ("sourceShopifyRefundId");


--
-- Name: RefundTerminalEvidenceReview_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalEvidenceReview_status_idx" ON public."RefundTerminalEvidenceReview" USING btree (status);


--
-- Name: RefundTerminalEvidenceReview_terminalRefundFinanceLedgerEnt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalEvidenceReview_terminalRefundFinanceLedgerEnt_idx" ON public."RefundTerminalEvidenceReview" USING btree ("terminalRefundFinanceLedgerEntryId");


--
-- Name: RefundTerminalEvidenceReview_vendorAllocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefundTerminalEvidenceReview_vendorAllocationId_idx" ON public."RefundTerminalEvidenceReview" USING btree ("vendorAllocationId");


--
-- Name: ReturnRecord_ownerVendorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ReturnRecord_ownerVendorId_idx" ON public."ReturnRecord" USING btree ("ownerVendorId");


--
-- Name: ReturnRecord_sourceShopifyReturnGid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ReturnRecord_sourceShopifyReturnGid_idx" ON public."ReturnRecord" USING btree ("sourceShopifyReturnGid");


--
-- Name: ReturnRecord_sourceShopifyReturnId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ReturnRecord_sourceShopifyReturnId_idx" ON public."ReturnRecord" USING btree ("sourceShopifyReturnId");


--
-- Name: ReturnRecord_vendorAllocationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ReturnRecord_vendorAllocationId_createdAt_idx" ON public."ReturnRecord" USING btree ("vendorAllocationId", "createdAt");


--
-- Name: SettlementApprovalLine_financeLedgerEntryId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementApprovalLine_financeLedgerEntryId_idx" ON public."SettlementApprovalLine" USING btree ("financeLedgerEntryId");


--
-- Name: SettlementApprovalLine_lineType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementApprovalLine_lineType_idx" ON public."SettlementApprovalLine" USING btree ("lineType");


--
-- Name: SettlementApprovalLine_settlementApprovalId_financeLedgerEn_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SettlementApprovalLine_settlementApprovalId_financeLedgerEn_key" ON public."SettlementApprovalLine" USING btree ("settlementApprovalId", "financeLedgerEntryId");


--
-- Name: SettlementApprovalLine_settlementRefundAdjustmentApplicatio_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SettlementApprovalLine_settlementRefundAdjustmentApplicatio_key" ON public."SettlementApprovalLine" USING btree ("settlementRefundAdjustmentApplicationId");


--
-- Name: SettlementApprovalLine_settlementRefundAdjustmentId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SettlementApprovalLine_settlementRefundAdjustmentId_key" ON public."SettlementApprovalLine" USING btree ("settlementRefundAdjustmentId");


--
-- Name: SettlementApproval_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementApproval_createdAt_idx" ON public."SettlementApproval" USING btree ("createdAt");


--
-- Name: SettlementApproval_periodStart_periodEnd_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementApproval_periodStart_periodEnd_idx" ON public."SettlementApproval" USING btree ("periodStart", "periodEnd");


--
-- Name: SettlementApproval_scheduledCycleKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SettlementApproval_scheduledCycleKey_key" ON public."SettlementApproval" USING btree ("scheduledCycleKey");


--
-- Name: SettlementApproval_vendorId_scheduledCycleKey_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementApproval_vendorId_scheduledCycleKey_idx" ON public."SettlementApproval" USING btree ("vendorId", "scheduledCycleKey");


--
-- Name: SettlementApproval_vendorId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementApproval_vendorId_status_idx" ON public."SettlementApproval" USING btree ("vendorId", status);


--
-- Name: SettlementCommissionInvoice_active_settlement_provider_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SettlementCommissionInvoice_active_settlement_provider_key" ON public."SettlementCommissionInvoice" USING btree ("settlementApprovalId", provider) WHERE (status <> 'CANCELLED'::public."SettlementCommissionInvoiceStatus");


--
-- Name: SettlementCommissionInvoice_invoiceNo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementCommissionInvoice_invoiceNo_idx" ON public."SettlementCommissionInvoice" USING btree ("invoiceNo");


--
-- Name: SettlementCommissionInvoice_providerUuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementCommissionInvoice_providerUuid_idx" ON public."SettlementCommissionInvoice" USING btree ("providerUuid");


--
-- Name: SettlementCommissionInvoice_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementCommissionInvoice_provider_idx" ON public."SettlementCommissionInvoice" USING btree (provider);


--
-- Name: SettlementCommissionInvoice_settlementApprovalId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementCommissionInvoice_settlementApprovalId_idx" ON public."SettlementCommissionInvoice" USING btree ("settlementApprovalId");


--
-- Name: SettlementCommissionInvoice_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementCommissionInvoice_status_idx" ON public."SettlementCommissionInvoice" USING btree (status);


--
-- Name: SettlementCommissionInvoice_vendorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementCommissionInvoice_vendorId_idx" ON public."SettlementCommissionInvoice" USING btree ("vendorId");


--
-- Name: SettlementRefundAdjustmentApplication_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementRefundAdjustmentApplication_createdAt_idx" ON public."SettlementRefundAdjustmentApplication" USING btree ("createdAt");


--
-- Name: SettlementRefundAdjustmentApplication_settlementApprovalId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementRefundAdjustmentApplication_settlementApprovalId_idx" ON public."SettlementRefundAdjustmentApplication" USING btree ("settlementApprovalId");


--
-- Name: SettlementRefundAdjustmentApplication_settlementApprovalLin_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SettlementRefundAdjustmentApplication_settlementApprovalLin_key" ON public."SettlementRefundAdjustmentApplication" USING btree ("settlementApprovalLineId");


--
-- Name: SettlementRefundAdjustmentApplication_settlementRefundAdjus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementRefundAdjustmentApplication_settlementRefundAdjus_idx" ON public."SettlementRefundAdjustmentApplication" USING btree ("settlementRefundAdjustmentId", status);


--
-- Name: SettlementRefundAdjustmentEvent_eventType_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementRefundAdjustmentEvent_eventType_createdAt_idx" ON public."SettlementRefundAdjustmentEvent" USING btree ("eventType", "createdAt");


--
-- Name: SettlementRefundAdjustmentEvent_settlementRefundAdjustmentI_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementRefundAdjustmentEvent_settlementRefundAdjustmentI_idx" ON public."SettlementRefundAdjustmentEvent" USING btree ("settlementRefundAdjustmentId", "createdAt");


--
-- Name: SettlementRefundAdjustment_appliedSettlementApprovalId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementRefundAdjustment_appliedSettlementApprovalId_idx" ON public."SettlementRefundAdjustment" USING btree ("appliedSettlementApprovalId");


--
-- Name: SettlementRefundAdjustment_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementRefundAdjustment_createdAt_idx" ON public."SettlementRefundAdjustment" USING btree ("createdAt");


--
-- Name: SettlementRefundAdjustment_originalOrderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementRefundAdjustment_originalOrderId_idx" ON public."SettlementRefundAdjustment" USING btree ("originalOrderId");


--
-- Name: SettlementRefundAdjustment_originalSettlementApprovalId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementRefundAdjustment_originalSettlementApprovalId_idx" ON public."SettlementRefundAdjustment" USING btree ("originalSettlementApprovalId");


--
-- Name: SettlementRefundAdjustment_originalSettlementCommissionInvo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementRefundAdjustment_originalSettlementCommissionInvo_idx" ON public."SettlementRefundAdjustment" USING btree ("originalSettlementCommissionInvoiceId");


--
-- Name: SettlementRefundAdjustment_refundFinanceLedgerEntryId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SettlementRefundAdjustment_refundFinanceLedgerEntryId_key" ON public."SettlementRefundAdjustment" USING btree ("refundFinanceLedgerEntryId");


--
-- Name: SettlementRefundAdjustment_refundRecordId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementRefundAdjustment_refundRecordId_idx" ON public."SettlementRefundAdjustment" USING btree ("refundRecordId");


--
-- Name: SettlementRefundAdjustment_vendorId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementRefundAdjustment_vendorId_status_idx" ON public."SettlementRefundAdjustment" USING btree ("vendorId", status);


--
-- Name: SettlementScheduleJobRun_finishedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementScheduleJobRun_finishedAt_idx" ON public."SettlementScheduleJobRun" USING btree ("finishedAt");


--
-- Name: SettlementScheduleJobRun_runDate_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SettlementScheduleJobRun_runDate_key" ON public."SettlementScheduleJobRun" USING btree ("runDate");


--
-- Name: SettlementScheduleJobRun_status_startedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SettlementScheduleJobRun_status_startedAt_idx" ON public."SettlementScheduleJobRun" USING btree (status, "startedAt");


--
-- Name: ShipmentExecution_allocationId_provider_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ShipmentExecution_allocationId_provider_key" ON public."ShipmentExecution" USING btree ("allocationId", provider);


--
-- Name: ShipmentExecution_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ShipmentExecution_createdAt_idx" ON public."ShipmentExecution" USING btree ("createdAt");


--
-- Name: ShipmentExecution_provider_shipmentStatus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ShipmentExecution_provider_shipmentStatus_idx" ON public."ShipmentExecution" USING btree (provider, "shipmentStatus");


--
-- Name: ShipmentExecution_sourceShopifyOrderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ShipmentExecution_sourceShopifyOrderId_idx" ON public."ShipmentExecution" USING btree ("sourceShopifyOrderId");


--
-- Name: ShipmentExecution_vendorId_shipmentStatus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ShipmentExecution_vendorId_shipmentStatus_idx" ON public."ShipmentExecution" USING btree ("vendorId", "shipmentStatus");


--
-- Name: ShipmentShippingCost_allocationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ShipmentShippingCost_allocationId_status_idx" ON public."ShipmentShippingCost" USING btree ("allocationId", status);


--
-- Name: ShipmentShippingCost_sourceShopifyOrderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ShipmentShippingCost_sourceShopifyOrderId_idx" ON public."ShipmentShippingCost" USING btree ("sourceShopifyOrderId");


--
-- Name: ShipmentShippingCost_vendorId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ShipmentShippingCost_vendorId_status_idx" ON public."ShipmentShippingCost" USING btree ("vendorId", status);


--
-- Name: ShopifyOrderLineItem_shopifyOrderId_sourceLineItemId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ShopifyOrderLineItem_shopifyOrderId_sourceLineItemId_key" ON public."ShopifyOrderLineItem" USING btree ("shopifyOrderId", "sourceLineItemId");


--
-- Name: ShopifyOrder_sourceShopifyOrderId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ShopifyOrder_sourceShopifyOrderId_key" ON public."ShopifyOrder" USING btree ("sourceShopifyOrderId");


--
-- Name: ShopifyRefundLineItem_shopifyRefundId_sourceRefundLineItemI_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ShopifyRefundLineItem_shopifyRefundId_sourceRefundLineItemI_key" ON public."ShopifyRefundLineItem" USING btree ("shopifyRefundId", "sourceRefundLineItemId");


--
-- Name: ShopifyRefund_sourceShopifyRefundId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ShopifyRefund_sourceShopifyRefundId_key" ON public."ShopifyRefund" USING btree ("sourceShopifyRefundId");


--
-- Name: SupportTicketNote_supportTicketId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicketNote_supportTicketId_createdAt_idx" ON public."SupportTicketNote" USING btree ("supportTicketId", "createdAt");


--
-- Name: SupportTicketReply_supportTicketId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicketReply_supportTicketId_createdAt_idx" ON public."SupportTicketReply" USING btree ("supportTicketId", "createdAt");


--
-- Name: SupportTicket_adminUnreadCount_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicket_adminUnreadCount_idx" ON public."SupportTicket" USING btree ("adminUnreadCount");


--
-- Name: SupportTicket_assigneeUserId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicket_assigneeUserId_idx" ON public."SupportTicket" USING btree ("assigneeUserId");


--
-- Name: SupportTicket_category_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicket_category_status_idx" ON public."SupportTicket" USING btree (category, status);


--
-- Name: SupportTicket_contextType_contextId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicket_contextType_contextId_idx" ON public."SupportTicket" USING btree ("contextType", "contextId");


--
-- Name: SupportTicket_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicket_createdAt_idx" ON public."SupportTicket" USING btree ("createdAt");


--
-- Name: SupportTicket_escalatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicket_escalatedAt_idx" ON public."SupportTicket" USING btree ("escalatedAt");


--
-- Name: SupportTicket_firstResponseDueAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicket_firstResponseDueAt_idx" ON public."SupportTicket" USING btree ("firstResponseDueAt");


--
-- Name: SupportTicket_nextResponseDueAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicket_nextResponseDueAt_idx" ON public."SupportTicket" USING btree ("nextResponseDueAt");


--
-- Name: SupportTicket_vendorId_status_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicket_vendorId_status_createdAt_idx" ON public."SupportTicket" USING btree ("vendorId", status, "createdAt");


--
-- Name: SupportTicket_vendorUnreadCount_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicket_vendorUnreadCount_idx" ON public."SupportTicket" USING btree ("vendorUnreadCount");


--
-- Name: UserVendorAccess_userId_vendorId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UserVendorAccess_userId_vendorId_key" ON public."UserVendorAccess" USING btree ("userId", "vendorId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: VendorAllocationLineItem_vendorAllocationId_shopifyLineItem_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VendorAllocationLineItem_vendorAllocationId_shopifyLineItem_key" ON public."VendorAllocationLineItem" USING btree ("vendorAllocationId", "shopifyLineItemId");


--
-- Name: VendorAllocation_cancelRefundReviewStatus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorAllocation_cancelRefundReviewStatus_idx" ON public."VendorAllocation" USING btree ("cancelRefundReviewStatus");


--
-- Name: VendorAllocation_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorAllocation_createdAt_idx" ON public."VendorAllocation" USING btree ("createdAt");


--
-- Name: VendorAllocation_odooSaleOrderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorAllocation_odooSaleOrderId_idx" ON public."VendorAllocation" USING btree ("odooSaleOrderId");


--
-- Name: VendorAllocation_vendorIntegrationStatus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorAllocation_vendorIntegrationStatus_idx" ON public."VendorAllocation" USING btree ("vendorIntegrationStatus");


--
-- Name: VendorBalanceEvent_financeLedgerEntryId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorBalanceEvent_financeLedgerEntryId_idx" ON public."VendorBalanceEvent" USING btree ("financeLedgerEntryId");


--
-- Name: VendorBalanceEvent_financialCorrectionAuthorityId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VendorBalanceEvent_financialCorrectionAuthorityId_key" ON public."VendorBalanceEvent" USING btree ("financialCorrectionAuthorityId");


--
-- Name: VendorBalanceEvent_idempotencyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VendorBalanceEvent_idempotencyKey_key" ON public."VendorBalanceEvent" USING btree ("idempotencyKey");


--
-- Name: VendorBalanceEvent_payoutBatchId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorBalanceEvent_payoutBatchId_idx" ON public."VendorBalanceEvent" USING btree ("payoutBatchId");


--
-- Name: VendorBalanceEvent_refundRecordId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorBalanceEvent_refundRecordId_idx" ON public."VendorBalanceEvent" USING btree ("refundRecordId");


--
-- Name: VendorBalanceEvent_settlementApprovalId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorBalanceEvent_settlementApprovalId_idx" ON public."VendorBalanceEvent" USING btree ("settlementApprovalId");


--
-- Name: VendorBalanceEvent_sourceType_sourceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorBalanceEvent_sourceType_sourceId_idx" ON public."VendorBalanceEvent" USING btree ("sourceType", "sourceId");


--
-- Name: VendorBalanceEvent_type_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorBalanceEvent_type_createdAt_idx" ON public."VendorBalanceEvent" USING btree (type, "createdAt");


--
-- Name: VendorBalanceEvent_vendorId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorBalanceEvent_vendorId_createdAt_idx" ON public."VendorBalanceEvent" USING btree ("vendorId", "createdAt");


--
-- Name: VendorBalanceEvent_vendorId_currency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorBalanceEvent_vendorId_currency_idx" ON public."VendorBalanceEvent" USING btree ("vendorId", currency);


--
-- Name: VendorBillingProfile_vendorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorBillingProfile_vendorId_idx" ON public."VendorBillingProfile" USING btree ("vendorId");


--
-- Name: VendorBillingProfile_vendorId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VendorBillingProfile_vendorId_key" ON public."VendorBillingProfile" USING btree ("vendorId");


--
-- Name: VendorFinancialProfile_vendorId_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorFinancialProfile_vendorId_active_idx" ON public."VendorFinancialProfile" USING btree ("vendorId", active);


--
-- Name: VendorFinancialProfile_vendorId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VendorFinancialProfile_vendorId_key" ON public."VendorFinancialProfile" USING btree ("vendorId");


--
-- Name: VendorIntegrationAuditLog_clientId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorIntegrationAuditLog_clientId_createdAt_idx" ON public."VendorIntegrationAuditLog" USING btree ("clientId", "createdAt");


--
-- Name: VendorIntegrationAuditLog_vendorIdentifier_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorIntegrationAuditLog_vendorIdentifier_createdAt_idx" ON public."VendorIntegrationAuditLog" USING btree ("vendorIdentifier", "createdAt");


--
-- Name: VendorIntegrationClient_enabled_revokedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorIntegrationClient_enabled_revokedAt_idx" ON public."VendorIntegrationClient" USING btree (enabled, "revokedAt");


--
-- Name: VendorIntegrationClient_tokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VendorIntegrationClient_tokenHash_key" ON public."VendorIntegrationClient" USING btree ("tokenHash");


--
-- Name: VendorIntegrationClient_vendorIdentifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorIntegrationClient_vendorIdentifier_idx" ON public."VendorIntegrationClient" USING btree ("vendorIdentifier");


--
-- Name: VendorIntegrationInvoiceEvent_clientId_vendorAllocationId_i_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VendorIntegrationInvoiceEvent_clientId_vendorAllocationId_i_key" ON public."VendorIntegrationInvoiceEvent" USING btree ("clientId", "vendorAllocationId", "idempotencyKey");


--
-- Name: VendorIntegrationInvoiceEvent_vendorAllocationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorIntegrationInvoiceEvent_vendorAllocationId_createdAt_idx" ON public."VendorIntegrationInvoiceEvent" USING btree ("vendorAllocationId", "createdAt");


--
-- Name: VendorIntegrationInvoiceEvent_vendorIdentifier_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorIntegrationInvoiceEvent_vendorIdentifier_createdAt_idx" ON public."VendorIntegrationInvoiceEvent" USING btree ("vendorIdentifier", "createdAt");


--
-- Name: VendorIntegrationShipmentEvent_clientId_vendorAllocationId__key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VendorIntegrationShipmentEvent_clientId_vendorAllocationId__key" ON public."VendorIntegrationShipmentEvent" USING btree ("clientId", "vendorAllocationId", "idempotencyKey");


--
-- Name: VendorIntegrationShipmentEvent_vendorAllocationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorIntegrationShipmentEvent_vendorAllocationId_createdAt_idx" ON public."VendorIntegrationShipmentEvent" USING btree ("vendorAllocationId", "createdAt");


--
-- Name: VendorIntegrationShipmentEvent_vendorIdentifier_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorIntegrationShipmentEvent_vendorIdentifier_createdAt_idx" ON public."VendorIntegrationShipmentEvent" USING btree ("vendorIdentifier", "createdAt");


--
-- Name: VendorIntegrationStatusEvent_clientId_vendorAllocationId_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VendorIntegrationStatusEvent_clientId_vendorAllocationId_id_key" ON public."VendorIntegrationStatusEvent" USING btree ("clientId", "vendorAllocationId", "idempotencyKey");


--
-- Name: VendorIntegrationStatusEvent_vendorAllocationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorIntegrationStatusEvent_vendorAllocationId_createdAt_idx" ON public."VendorIntegrationStatusEvent" USING btree ("vendorAllocationId", "createdAt");


--
-- Name: VendorIntegrationStatusEvent_vendorIdentifier_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorIntegrationStatusEvent_vendorIdentifier_createdAt_idx" ON public."VendorIntegrationStatusEvent" USING btree ("vendorIdentifier", "createdAt");


--
-- Name: VendorProfileAuditLog_fieldName_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorProfileAuditLog_fieldName_idx" ON public."VendorProfileAuditLog" USING btree ("fieldName");


--
-- Name: VendorProfileAuditLog_vendorId_changedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorProfileAuditLog_vendorId_changedAt_idx" ON public."VendorProfileAuditLog" USING btree ("vendorId", "changedAt");


--
-- Name: VendorProfileAuditLog_vendorId_section_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorProfileAuditLog_vendorId_section_idx" ON public."VendorProfileAuditLog" USING btree ("vendorId", section);


--
-- Name: VendorShippingConfig_vendorId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VendorShippingConfig_vendorId_key" ON public."VendorShippingConfig" USING btree ("vendorId");


--
-- Name: VendorShippingConfig_vendorId_shippingEnabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorShippingConfig_vendorId_shippingEnabled_idx" ON public."VendorShippingConfig" USING btree ("vendorId", "shippingEnabled");


--
-- Name: VendorShippingWarehouse_configId_isDefault_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorShippingWarehouse_configId_isDefault_idx" ON public."VendorShippingWarehouse" USING btree ("configId", "isDefault");


--
-- Name: VendorShippingWarehouse_vendorId_provider_isDefault_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VendorShippingWarehouse_vendorId_provider_isDefault_idx" ON public."VendorShippingWarehouse" USING btree ("vendorId", provider, "isDefault");


--
-- Name: VendorShippingWarehouse_vendorId_provider_warehouseId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VendorShippingWarehouse_vendorId_provider_warehouseId_key" ON public."VendorShippingWarehouse" USING btree ("vendorId", provider, "warehouseId");


--
-- Name: WebhookEvent_idempotencyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "WebhookEvent_idempotencyKey_key" ON public."WebhookEvent" USING btree ("idempotencyKey");


--
-- Name: WebhookEvent_sourceShopDomain_topic_webhookId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "WebhookEvent_sourceShopDomain_topic_webhookId_key" ON public."WebhookEvent" USING btree ("sourceShopDomain", topic, "webhookId");


--
-- Name: WebhookEvent_topic_sourceShopifyOrderId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WebhookEvent_topic_sourceShopifyOrderId_status_idx" ON public."WebhookEvent" USING btree (topic, "sourceShopifyOrderId", status);


--
-- Name: WebhookEvent_topic_status_executionAvailableAt_receivedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WebhookEvent_topic_status_executionAvailableAt_receivedAt_idx" ON public."WebhookEvent" USING btree (topic, status, "executionAvailableAt", "receivedAt");


--
-- Name: WebhookEvent_topic_status_processingLeaseExpiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WebhookEvent_topic_status_processingLeaseExpiresAt_idx" ON public."WebhookEvent" USING btree (topic, status, "processingLeaseExpiresAt");


--
-- Name: ZeroNetAck_accepted_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ZeroNetAck_accepted_key" ON public."FinancialCorrectionZeroNetAcknowledgement" USING btree ("acceptedEvidenceSnapshotId");


--
-- Name: ZeroNetAck_allocation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ZeroNetAck_allocation_idx" ON public."FinancialCorrectionZeroNetAcknowledgement" USING btree ("vendorAllocationId");


--
-- Name: ZeroNetAck_event_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ZeroNetAck_event_key" ON public."FinancialCorrectionZeroNetAcknowledgement" USING btree ("resolvedReviewEventId");


--
-- Name: ZeroNetAck_evidence_pair_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ZeroNetAck_evidence_pair_key" ON public."FinancialCorrectionZeroNetAcknowledgement" USING btree ("acceptedEvidenceSnapshotId", "incomingConflictEvidenceId");


--
-- Name: ZeroNetAck_incoming_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ZeroNetAck_incoming_key" ON public."FinancialCorrectionZeroNetAcknowledgement" USING btree ("incomingConflictEvidenceId");


--
-- Name: ZeroNetAck_review_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ZeroNetAck_review_key" ON public."FinancialCorrectionZeroNetAcknowledgement" USING btree ("reviewId");


--
-- Name: ZeroNetAck_vendor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ZeroNetAck_vendor_idx" ON public."FinancialCorrectionZeroNetAcknowledgement" USING btree ("vendorId");


--
-- Name: FinancialCorrectionApprovedDeductionCoverage FinancialCorrectionApprovedDeductionCoverage_source_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "FinancialCorrectionApprovedDeductionCoverage_source_guard" BEFORE INSERT OR UPDATE ON public."FinancialCorrectionApprovedDeductionCoverage" FOR EACH ROW EXECUTE FUNCTION public."checkApprovedDeductionCoverage"();


--
-- Name: FinancialCorrectionCredit FinancialCorrectionCredit_direction_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "FinancialCorrectionCredit_direction_guard" BEFORE INSERT OR UPDATE ON public."FinancialCorrectionCredit" FOR EACH ROW EXECUTE FUNCTION public."checkFinancialCorrectionEffectDirection"();


--
-- Name: FinancialCorrectionDeduction FinancialCorrectionDeduction_direction_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "FinancialCorrectionDeduction_direction_guard" BEFORE INSERT OR UPDATE ON public."FinancialCorrectionDeduction" FOR EACH ROW EXECUTE FUNCTION public."checkFinancialCorrectionDeductionDirection"();


--
-- Name: VendorBalanceEvent VendorBalanceEvent_correction_direction_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "VendorBalanceEvent_correction_direction_guard" BEFORE INSERT OR UPDATE ON public."VendorBalanceEvent" FOR EACH ROW EXECUTE FUNCTION public."checkFinancialCorrectionDebtDirection"();


--
-- Name: AllocationAssignmentHistory AllocationAssignmentHistory_actorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationAssignmentHistory"
    ADD CONSTRAINT "AllocationAssignmentHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AllocationAssignmentHistory AllocationAssignmentHistory_fromVendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationAssignmentHistory"
    ADD CONSTRAINT "AllocationAssignmentHistory_fromVendorId_fkey" FOREIGN KEY ("fromVendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AllocationAssignmentHistory AllocationAssignmentHistory_toVendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationAssignmentHistory"
    ADD CONSTRAINT "AllocationAssignmentHistory_toVendorId_fkey" FOREIGN KEY ("toVendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AllocationAssignmentHistory AllocationAssignmentHistory_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationAssignmentHistory"
    ADD CONSTRAINT "AllocationAssignmentHistory_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AllocationEconomicTransfer AllocationEconomicTransfer_adminActorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationEconomicTransfer"
    ADD CONSTRAINT "AllocationEconomicTransfer_adminActorUserId_fkey" FOREIGN KEY ("adminActorUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AllocationEconomicTransfer AllocationEconomicTransfer_fromFinanceLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationEconomicTransfer"
    ADD CONSTRAINT "AllocationEconomicTransfer_fromFinanceLedgerEntryId_fkey" FOREIGN KEY ("fromFinanceLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AllocationEconomicTransfer AllocationEconomicTransfer_fromVendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationEconomicTransfer"
    ADD CONSTRAINT "AllocationEconomicTransfer_fromVendorId_fkey" FOREIGN KEY ("fromVendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AllocationEconomicTransfer AllocationEconomicTransfer_toFinanceLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationEconomicTransfer"
    ADD CONSTRAINT "AllocationEconomicTransfer_toFinanceLedgerEntryId_fkey" FOREIGN KEY ("toFinanceLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AllocationEconomicTransfer AllocationEconomicTransfer_toVendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationEconomicTransfer"
    ADD CONSTRAINT "AllocationEconomicTransfer_toVendorId_fkey" FOREIGN KEY ("toVendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AllocationEconomicTransfer AllocationEconomicTransfer_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationEconomicTransfer"
    ADD CONSTRAINT "AllocationEconomicTransfer_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AllocationFullRefundTerminalFact AllocationFullRefundTerminalFact_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationFullRefundTerminalFact"
    ADD CONSTRAINT "AllocationFullRefundTerminalFact_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AllocationSplitEvent AllocationSplitEvent_actorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationSplitEvent"
    ADD CONSTRAINT "AllocationSplitEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AllocationSplitEvent AllocationSplitEvent_childAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationSplitEvent"
    ADD CONSTRAINT "AllocationSplitEvent_childAllocationId_fkey" FOREIGN KEY ("childAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AllocationSplitEvent AllocationSplitEvent_childFinanceLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationSplitEvent"
    ADD CONSTRAINT "AllocationSplitEvent_childFinanceLedgerEntryId_fkey" FOREIGN KEY ("childFinanceLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AllocationSplitEvent AllocationSplitEvent_remainingFinanceLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationSplitEvent"
    ADD CONSTRAINT "AllocationSplitEvent_remainingFinanceLedgerEntryId_fkey" FOREIGN KEY ("remainingFinanceLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AllocationSplitEvent AllocationSplitEvent_sourceAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationSplitEvent"
    ADD CONSTRAINT "AllocationSplitEvent_sourceAllocationId_fkey" FOREIGN KEY ("sourceAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AllocationSplitEvent AllocationSplitEvent_sourceFinanceLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AllocationSplitEvent"
    ADD CONSTRAINT "AllocationSplitEvent_sourceFinanceLedgerEntryId_fkey" FOREIGN KEY ("sourceFinanceLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AutomationAction AutomationAction_allocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AutomationAction"
    ADD CONSTRAINT "AutomationAction_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AutomationAction AutomationAction_financeLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AutomationAction"
    ADD CONSTRAINT "AutomationAction_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AutomationAction AutomationAction_operationalJobId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AutomationAction"
    ADD CONSTRAINT "AutomationAction_operationalJobId_fkey" FOREIGN KEY ("operationalJobId") REFERENCES public."OperationalJob"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AutomationAction AutomationAction_payoutBatchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AutomationAction"
    ADD CONSTRAINT "AutomationAction_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES public."PayoutBatch"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AutomationAction AutomationAction_signalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AutomationAction"
    ADD CONSTRAINT "AutomationAction_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES public."OperationalSignal"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AutomationAction AutomationAction_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AutomationAction"
    ADD CONSTRAINT "AutomationAction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CustomerCancellationRequestItem CustomerCancellationRequestItem_requestId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerCancellationRequestItem"
    ADD CONSTRAINT "CustomerCancellationRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES public."CustomerCancellationRequest"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CustomerCancellationRequestItem CustomerCancellationRequestItem_reviewedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerCancellationRequestItem"
    ADD CONSTRAINT "CustomerCancellationRequestItem_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: CustomerCancellationRequestItem CustomerCancellationRequestItem_shopifyOrderLineItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerCancellationRequestItem"
    ADD CONSTRAINT "CustomerCancellationRequestItem_shopifyOrderLineItemId_fkey" FOREIGN KEY ("shopifyOrderLineItemId") REFERENCES public."ShopifyOrderLineItem"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CustomerCancellationRequestItem CustomerCancellationRequestItem_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerCancellationRequestItem"
    ADD CONSTRAINT "CustomerCancellationRequestItem_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CustomerCancellationRequest CustomerCancellationRequest_reviewedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerCancellationRequest"
    ADD CONSTRAINT "CustomerCancellationRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: CustomerCancellationRequest CustomerCancellationRequest_shopifyOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerCancellationRequest"
    ADD CONSTRAINT "CustomerCancellationRequest_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES public."ShopifyOrder"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FinanceEvent FinanceEvent_financeLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceEvent"
    ADD CONSTRAINT "FinanceEvent_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: FinanceEvent FinanceEvent_shopifyOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceEvent"
    ADD CONSTRAINT "FinanceEvent_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES public."ShopifyOrder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: FinanceEvent FinanceEvent_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceEvent"
    ADD CONSTRAINT "FinanceEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FinanceIntegrityAlert FinanceIntegrityAlert_acknowledgedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceIntegrityAlert"
    ADD CONSTRAINT "FinanceIntegrityAlert_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: FinanceIntegrityAlert FinanceIntegrityAlert_allocationEconomicTransferId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceIntegrityAlert"
    ADD CONSTRAINT "FinanceIntegrityAlert_allocationEconomicTransferId_fkey" FOREIGN KEY ("allocationEconomicTransferId") REFERENCES public."AllocationEconomicTransfer"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: FinanceIntegrityAlert FinanceIntegrityAlert_resolvedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceIntegrityAlert"
    ADD CONSTRAINT "FinanceIntegrityAlert_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: FinanceIntegrityAlert FinanceIntegrityAlert_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceIntegrityAlert"
    ADD CONSTRAINT "FinanceIntegrityAlert_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: FinanceLedgerEntry FinanceLedgerEntry_supersededByLedgerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceLedgerEntry"
    ADD CONSTRAINT "FinanceLedgerEntry_supersededByLedgerId_fkey" FOREIGN KEY ("supersededByLedgerId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: FinanceLedgerEntry FinanceLedgerEntry_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceLedgerEntry"
    ADD CONSTRAINT "FinanceLedgerEntry_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: FinanceLedgerEntry FinanceLedgerEntry_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinanceLedgerEntry"
    ADD CONSTRAINT "FinanceLedgerEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FinancialCorrectionApprovedDeductionCoverage FinancialCorrectionApprovedDeductionCoverage_deductionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionApprovedDeductionCoverage"
    ADD CONSTRAINT "FinancialCorrectionApprovedDeductionCoverage_deductionId_fkey" FOREIGN KEY ("deductionId") REFERENCES public."FinancialCorrectionDeduction"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionApprovedDeductionCoverage FinancialCorrectionApprovedDeductionCoverage_settlementApproval; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionApprovedDeductionCoverage"
    ADD CONSTRAINT "FinancialCorrectionApprovedDeductionCoverage_settlementApproval" FOREIGN KEY ("settlementApprovalId") REFERENCES public."SettlementApproval"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionApprovedDeductionCoverage FinancialCorrectionApprovedDeductionCoverage_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionApprovedDeductionCoverage"
    ADD CONSTRAINT "FinancialCorrectionApprovedDeductionCoverage_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionApprovedDeductionPayoutLine FinancialCorrectionApprovedDeductionPayoutLine_coverageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionApprovedDeductionPayoutLine"
    ADD CONSTRAINT "FinancialCorrectionApprovedDeductionPayoutLine_coverageId_fkey" FOREIGN KEY ("coverageId") REFERENCES public."FinancialCorrectionApprovedDeductionCoverage"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionApprovedDeductionPayoutLine FinancialCorrectionApprovedDeductionPayoutLine_payoutBatchId_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionApprovedDeductionPayoutLine"
    ADD CONSTRAINT "FinancialCorrectionApprovedDeductionPayoutLine_payoutBatchId_fk" FOREIGN KEY ("payoutBatchId") REFERENCES public."PayoutBatch"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionAuthority FinancialCorrectionAuthority_accepted_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionAuthority"
    ADD CONSTRAINT "FinancialCorrectionAuthority_accepted_fkey" FOREIGN KEY ("acceptedEvidenceSnapshotId") REFERENCES public."RefundEvidenceSnapshot"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionAuthority FinancialCorrectionAuthority_actor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionAuthority"
    ADD CONSTRAINT "FinancialCorrectionAuthority_actor_fkey" FOREIGN KEY ("authorizedByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionAuthority FinancialCorrectionAuthority_approved_settlement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionAuthority"
    ADD CONSTRAINT "FinancialCorrectionAuthority_approved_settlement_fkey" FOREIGN KEY ("historicalApprovedSettlementId") REFERENCES public."SettlementApproval"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionAuthority FinancialCorrectionAuthority_event_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionAuthority"
    ADD CONSTRAINT "FinancialCorrectionAuthority_event_fkey" FOREIGN KEY ("resolvedReviewEventId") REFERENCES public."RefundTerminalEvidenceReviewEvent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionAuthority FinancialCorrectionAuthority_incoming_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionAuthority"
    ADD CONSTRAINT "FinancialCorrectionAuthority_incoming_fkey" FOREIGN KEY ("incomingConflictEvidenceId") REFERENCES public."RefundTerminalConflictEvidence"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionAuthority FinancialCorrectionAuthority_payout_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionAuthority"
    ADD CONSTRAINT "FinancialCorrectionAuthority_payout_fkey" FOREIGN KEY ("historicalPayoutBatchId") REFERENCES public."PayoutBatch"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionAuthority FinancialCorrectionAuthority_review_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionAuthority"
    ADD CONSTRAINT "FinancialCorrectionAuthority_review_fkey" FOREIGN KEY ("reviewId") REFERENCES public."RefundTerminalEvidenceReview"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionBaselineClaim FinancialCorrectionBaselineClaim_accepted_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionBaselineClaim"
    ADD CONSTRAINT "FinancialCorrectionBaselineClaim_accepted_fkey" FOREIGN KEY ("acceptedEvidenceSnapshotId") REFERENCES public."RefundEvidenceSnapshot"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionCreditPayoutLine FinancialCorrectionCreditPayoutLine_payoutBatchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionCreditPayoutLine"
    ADD CONSTRAINT "FinancialCorrectionCreditPayoutLine_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES public."PayoutBatch"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionCreditPayoutLine FinancialCorrectionCreditPayoutLine_settlementCreditLineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionCreditPayoutLine"
    ADD CONSTRAINT "FinancialCorrectionCreditPayoutLine_settlementCreditLineId_fkey" FOREIGN KEY ("settlementCreditLineId") REFERENCES public."FinancialCorrectionCreditSettlementLine"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionCreditSettlementLine FinancialCorrectionCreditSettlementLine_creditId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionCreditSettlementLine"
    ADD CONSTRAINT "FinancialCorrectionCreditSettlementLine_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES public."FinancialCorrectionCredit"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionCreditSettlementLine FinancialCorrectionCreditSettlementLine_settlementApproval_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionCreditSettlementLine"
    ADD CONSTRAINT "FinancialCorrectionCreditSettlementLine_settlementApproval_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES public."SettlementApproval"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionCredit FinancialCorrectionCredit_authorityId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionCredit"
    ADD CONSTRAINT "FinancialCorrectionCredit_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES public."FinancialCorrectionAuthority"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionCredit FinancialCorrectionCredit_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionCredit"
    ADD CONSTRAINT "FinancialCorrectionCredit_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionDeductionPayoutLine FinancialCorrectionDeductionPayoutLine_batch_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionDeductionPayoutLine"
    ADD CONSTRAINT "FinancialCorrectionDeductionPayoutLine_batch_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES public."PayoutBatch"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionDeductionPayoutLine FinancialCorrectionDeductionPayoutLine_source_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionDeductionPayoutLine"
    ADD CONSTRAINT "FinancialCorrectionDeductionPayoutLine_source_fkey" FOREIGN KEY ("settlementDeductionLineId") REFERENCES public."FinancialCorrectionDeductionSettlementLine"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionDeductionSettlementLine FinancialCorrectionDeductionSettlementLine_settlement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionDeductionSettlementLine"
    ADD CONSTRAINT "FinancialCorrectionDeductionSettlementLine_settlement_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES public."SettlementApproval"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionDeductionSettlementLine FinancialCorrectionDeductionSettlementLine_source_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionDeductionSettlementLine"
    ADD CONSTRAINT "FinancialCorrectionDeductionSettlementLine_source_fkey" FOREIGN KEY ("deductionId") REFERENCES public."FinancialCorrectionDeduction"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionDeduction FinancialCorrectionDeduction_authorityId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionDeduction"
    ADD CONSTRAINT "FinancialCorrectionDeduction_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES public."FinancialCorrectionAuthority"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionDeduction FinancialCorrectionDeduction_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionDeduction"
    ADD CONSTRAINT "FinancialCorrectionDeduction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionZeroNetAcknowledgement FinancialCorrectionZeroNetAcknowledgement_acceptedEvidence_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionZeroNetAcknowledgement"
    ADD CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_acceptedEvidence_fkey" FOREIGN KEY ("acceptedEvidenceSnapshotId") REFERENCES public."RefundEvidenceSnapshot"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionZeroNetAcknowledgement FinancialCorrectionZeroNetAcknowledgement_acknowledgedByUs_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionZeroNetAcknowledgement"
    ADD CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_acknowledgedByUs_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionZeroNetAcknowledgement FinancialCorrectionZeroNetAcknowledgement_incomingConflict_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionZeroNetAcknowledgement"
    ADD CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_incomingConflict_fkey" FOREIGN KEY ("incomingConflictEvidenceId") REFERENCES public."RefundTerminalConflictEvidence"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionZeroNetAcknowledgement FinancialCorrectionZeroNetAcknowledgement_resolvedReviewEv_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionZeroNetAcknowledgement"
    ADD CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_resolvedReviewEv_fkey" FOREIGN KEY ("resolvedReviewEventId") REFERENCES public."RefundTerminalEvidenceReviewEvent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FinancialCorrectionZeroNetAcknowledgement FinancialCorrectionZeroNetAcknowledgement_reviewId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FinancialCorrectionZeroNetAcknowledgement"
    ADD CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES public."RefundTerminalEvidenceReview"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Fulfillment Fulfillment_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Fulfillment"
    ADD CONSTRAINT "Fulfillment_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: LegacyRefundFinanceReviewEvent LegacyRefundFinanceReviewEvent_actorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LegacyRefundFinanceReviewEvent"
    ADD CONSTRAINT "LegacyRefundFinanceReviewEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: LegacyRefundFinanceReviewEvent LegacyRefundFinanceReviewEvent_reviewId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LegacyRefundFinanceReviewEvent"
    ADD CONSTRAINT "LegacyRefundFinanceReviewEvent_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES public."LegacyRefundFinanceReview"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: LegacyRefundFinanceReviewSource LegacyRefundFinanceReviewSource_reviewId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LegacyRefundFinanceReviewSource"
    ADD CONSTRAINT "LegacyRefundFinanceReviewSource_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES public."LegacyRefundFinanceReview"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: LegacyRefundFinanceReview LegacyRefundFinanceReview_observedVendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LegacyRefundFinanceReview"
    ADD CONSTRAINT "LegacyRefundFinanceReview_observedVendorId_fkey" FOREIGN KEY ("observedVendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: LegacyRefundFinanceReview LegacyRefundFinanceReview_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LegacyRefundFinanceReview"
    ADD CONSTRAINT "LegacyRefundFinanceReview_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: NotificationIntent NotificationIntent_signalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NotificationIntent"
    ADD CONSTRAINT "NotificationIntent_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES public."OperationalSignal"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: NotificationIntent NotificationIntent_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NotificationIntent"
    ADD CONSTRAINT "NotificationIntent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: OperationalJob OperationalJob_customerCancellationRequestItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationalJob"
    ADD CONSTRAINT "OperationalJob_customerCancellationRequestItemId_fkey" FOREIGN KEY ("customerCancellationRequestItemId") REFERENCES public."CustomerCancellationRequestItem"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OperationalJob OperationalJob_refundRecordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationalJob"
    ADD CONSTRAINT "OperationalJob_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES public."RefundRecord"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OperationalJob OperationalJob_returnRecordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationalJob"
    ADD CONSTRAINT "OperationalJob_returnRecordId_fkey" FOREIGN KEY ("returnRecordId") REFERENCES public."ReturnRecord"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OperationalJob OperationalJob_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationalJob"
    ADD CONSTRAINT "OperationalJob_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OperationalJob OperationalJob_webhookEventId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationalJob"
    ADD CONSTRAINT "OperationalJob_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES public."WebhookEvent"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OperationalSignal OperationalSignal_allocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationalSignal"
    ADD CONSTRAINT "OperationalSignal_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OperationalSignal OperationalSignal_financeLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationalSignal"
    ADD CONSTRAINT "OperationalSignal_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OperationalSignal OperationalSignal_operationalJobId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationalSignal"
    ADD CONSTRAINT "OperationalSignal_operationalJobId_fkey" FOREIGN KEY ("operationalJobId") REFERENCES public."OperationalJob"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OperationalSignal OperationalSignal_payoutBatchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationalSignal"
    ADD CONSTRAINT "OperationalSignal_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES public."PayoutBatch"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OperationalSignal OperationalSignal_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationalSignal"
    ADD CONSTRAINT "OperationalSignal_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: OrderShippingRefundClaim OrderShippingRefundClaim_ownerAttemptId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OrderShippingRefundClaim"
    ADD CONSTRAINT "OrderShippingRefundClaim_ownerAttemptId_fkey" FOREIGN KEY ("ownerAttemptId") REFERENCES public."OutboundShopifyRefundAttempt"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OutboundShopifyRefundAttempt OutboundShopifyRefundAttempt_customerCancellationRequestIt_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OutboundShopifyRefundAttempt"
    ADD CONSTRAINT "OutboundShopifyRefundAttempt_customerCancellationRequestIt_fkey" FOREIGN KEY ("customerCancellationRequestItemId") REFERENCES public."CustomerCancellationRequestItem"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OutboundShopifyRefundAttempt OutboundShopifyRefundAttempt_requestedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OutboundShopifyRefundAttempt"
    ADD CONSTRAINT "OutboundShopifyRefundAttempt_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OutboundShopifyRefundAttempt OutboundShopifyRefundAttempt_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OutboundShopifyRefundAttempt"
    ADD CONSTRAINT "OutboundShopifyRefundAttempt_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PayoutBatchLine PayoutBatchLine_financeLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutBatchLine"
    ADD CONSTRAINT "PayoutBatchLine_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PayoutBatchLine PayoutBatchLine_payoutBatchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutBatchLine"
    ADD CONSTRAINT "PayoutBatchLine_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES public."PayoutBatch"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PayoutBatchLine PayoutBatchLine_settlementApprovalLineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutBatchLine"
    ADD CONSTRAINT "PayoutBatchLine_settlementApprovalLineId_fkey" FOREIGN KEY ("settlementApprovalLineId") REFERENCES public."SettlementApprovalLine"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PayoutBatch PayoutBatch_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutBatch"
    ADD CONSTRAINT "PayoutBatch_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProductPanelVariantDisableOutboxEvent ProductPanelVariantDisableOutboxEvent_allocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProductPanelVariantDisableOutboxEvent"
    ADD CONSTRAINT "ProductPanelVariantDisableOutboxEvent_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProductPanelVariantDisableOutboxEvent ProductPanelVariantDisableOutboxEvent_vendorAllocationLine_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProductPanelVariantDisableOutboxEvent"
    ADD CONSTRAINT "ProductPanelVariantDisableOutboxEvent_vendorAllocationLine_fkey" FOREIGN KEY ("vendorAllocationLineItemId") REFERENCES public."VendorAllocationLineItem"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: RefundEvidenceSnapshot RefundEvidenceSnapshot_historicalEconomicVendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundEvidenceSnapshot"
    ADD CONSTRAINT "RefundEvidenceSnapshot_historicalEconomicVendorId_fkey" FOREIGN KEY ("historicalEconomicVendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundEvidenceSnapshot RefundEvidenceSnapshot_historicalSaleFinanceLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundEvidenceSnapshot"
    ADD CONSTRAINT "RefundEvidenceSnapshot_historicalSaleFinanceLedgerEntryId_fkey" FOREIGN KEY ("historicalSaleFinanceLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundEvidenceSnapshot RefundEvidenceSnapshot_refundFinanceLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundEvidenceSnapshot"
    ADD CONSTRAINT "RefundEvidenceSnapshot_refundFinanceLedgerEntryId_fkey" FOREIGN KEY ("refundFinanceLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundEvidenceSnapshot RefundEvidenceSnapshot_refundRecordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundEvidenceSnapshot"
    ADD CONSTRAINT "RefundEvidenceSnapshot_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES public."RefundRecord"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundEvidenceSnapshot RefundEvidenceSnapshot_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundEvidenceSnapshot"
    ADD CONSTRAINT "RefundEvidenceSnapshot_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundRecord RefundRecord_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundRecord"
    ADD CONSTRAINT "RefundRecord_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: RefundTerminalConflictEvidence RefundTerminalConflictEvidence_economicVendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalConflictEvidence"
    ADD CONSTRAINT "RefundTerminalConflictEvidence_economicVendorId_fkey" FOREIGN KEY ("economicVendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundTerminalConflictEvidence RefundTerminalConflictEvidence_historicalSaleFinanceLedger_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalConflictEvidence"
    ADD CONSTRAINT "RefundTerminalConflictEvidence_historicalSaleFinanceLedger_fkey" FOREIGN KEY ("historicalSaleFinanceLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundTerminalConflictEvidence RefundTerminalConflictEvidence_reviewId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalConflictEvidence"
    ADD CONSTRAINT "RefundTerminalConflictEvidence_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES public."RefundTerminalEvidenceReview"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundTerminalConflictEvidence RefundTerminalConflictEvidence_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalConflictEvidence"
    ADD CONSTRAINT "RefundTerminalConflictEvidence_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundTerminalEvidenceReviewEvent RefundTerminalEvidenceReviewEvent_actorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalEvidenceReviewEvent"
    ADD CONSTRAINT "RefundTerminalEvidenceReviewEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: RefundTerminalEvidenceReviewEvent RefundTerminalEvidenceReviewEvent_reviewId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalEvidenceReviewEvent"
    ADD CONSTRAINT "RefundTerminalEvidenceReviewEvent_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES public."RefundTerminalEvidenceReview"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundTerminalEvidenceReview RefundTerminalEvidenceReview_economicVendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalEvidenceReview"
    ADD CONSTRAINT "RefundTerminalEvidenceReview_economicVendorId_fkey" FOREIGN KEY ("economicVendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundTerminalEvidenceReview RefundTerminalEvidenceReview_refundRecordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalEvidenceReview"
    ADD CONSTRAINT "RefundTerminalEvidenceReview_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES public."RefundRecord"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundTerminalEvidenceReview RefundTerminalEvidenceReview_storedEvidenceSnapshotId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalEvidenceReview"
    ADD CONSTRAINT "RefundTerminalEvidenceReview_storedEvidenceSnapshotId_fkey" FOREIGN KEY ("storedEvidenceSnapshotId") REFERENCES public."RefundEvidenceSnapshot"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundTerminalEvidenceReview RefundTerminalEvidenceReview_terminalRefundFinanceLedgerEn_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalEvidenceReview"
    ADD CONSTRAINT "RefundTerminalEvidenceReview_terminalRefundFinanceLedgerEn_fkey" FOREIGN KEY ("terminalRefundFinanceLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefundTerminalEvidenceReview RefundTerminalEvidenceReview_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefundTerminalEvidenceReview"
    ADD CONSTRAINT "RefundTerminalEvidenceReview_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ReturnRecord ReturnRecord_ownerVendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReturnRecord"
    ADD CONSTRAINT "ReturnRecord_ownerVendorId_fkey" FOREIGN KEY ("ownerVendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ReturnRecord ReturnRecord_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReturnRecord"
    ADD CONSTRAINT "ReturnRecord_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementApprovalLine SettlementApprovalLine_financeLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementApprovalLine"
    ADD CONSTRAINT "SettlementApprovalLine_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementApprovalLine SettlementApprovalLine_settlementApprovalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementApprovalLine"
    ADD CONSTRAINT "SettlementApprovalLine_settlementApprovalId_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES public."SettlementApproval"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementApprovalLine SettlementApprovalLine_settlementRefundAdjustmentApplicati_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementApprovalLine"
    ADD CONSTRAINT "SettlementApprovalLine_settlementRefundAdjustmentApplicati_fkey" FOREIGN KEY ("settlementRefundAdjustmentApplicationId") REFERENCES public."SettlementRefundAdjustmentApplication"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SettlementApproval SettlementApproval_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementApproval"
    ADD CONSTRAINT "SettlementApproval_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementCommissionInvoice SettlementCommissionInvoice_settlementApprovalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementCommissionInvoice"
    ADD CONSTRAINT "SettlementCommissionInvoice_settlementApprovalId_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES public."SettlementApproval"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementCommissionInvoice SettlementCommissionInvoice_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementCommissionInvoice"
    ADD CONSTRAINT "SettlementCommissionInvoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementRefundAdjustmentApplication SettlementRefundAdjustmentApplication_settlementApprovalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustmentApplication"
    ADD CONSTRAINT "SettlementRefundAdjustmentApplication_settlementApprovalId_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES public."SettlementApproval"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementRefundAdjustmentApplication SettlementRefundAdjustmentApplication_settlementApprovalLi_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustmentApplication"
    ADD CONSTRAINT "SettlementRefundAdjustmentApplication_settlementApprovalLi_fkey" FOREIGN KEY ("settlementApprovalLineId") REFERENCES public."SettlementApprovalLine"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementRefundAdjustmentApplication SettlementRefundAdjustmentApplication_settlementRefundAdju_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustmentApplication"
    ADD CONSTRAINT "SettlementRefundAdjustmentApplication_settlementRefundAdju_fkey" FOREIGN KEY ("settlementRefundAdjustmentId") REFERENCES public."SettlementRefundAdjustment"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementRefundAdjustmentEvent SettlementRefundAdjustmentEvent_settlementRefundAdjustment_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustmentEvent"
    ADD CONSTRAINT "SettlementRefundAdjustmentEvent_settlementRefundAdjustment_fkey" FOREIGN KEY ("settlementRefundAdjustmentId") REFERENCES public."SettlementRefundAdjustment"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementRefundAdjustment SettlementRefundAdjustment_appliedSettlementApprovalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustment"
    ADD CONSTRAINT "SettlementRefundAdjustment_appliedSettlementApprovalId_fkey" FOREIGN KEY ("appliedSettlementApprovalId") REFERENCES public."SettlementApproval"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SettlementRefundAdjustment SettlementRefundAdjustment_appliedSettlementApprovalLineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustment"
    ADD CONSTRAINT "SettlementRefundAdjustment_appliedSettlementApprovalLineId_fkey" FOREIGN KEY ("appliedSettlementApprovalLineId") REFERENCES public."SettlementApprovalLine"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SettlementRefundAdjustment SettlementRefundAdjustment_originalOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustment"
    ADD CONSTRAINT "SettlementRefundAdjustment_originalOrderId_fkey" FOREIGN KEY ("originalOrderId") REFERENCES public."ShopifyOrder"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementRefundAdjustment SettlementRefundAdjustment_originalSettlementApprovalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustment"
    ADD CONSTRAINT "SettlementRefundAdjustment_originalSettlementApprovalId_fkey" FOREIGN KEY ("originalSettlementApprovalId") REFERENCES public."SettlementApproval"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SettlementRefundAdjustment SettlementRefundAdjustment_originalSettlementApprovalLineI_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustment"
    ADD CONSTRAINT "SettlementRefundAdjustment_originalSettlementApprovalLineI_fkey" FOREIGN KEY ("originalSettlementApprovalLineId") REFERENCES public."SettlementApprovalLine"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SettlementRefundAdjustment SettlementRefundAdjustment_originalSettlementCommissionInv_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustment"
    ADD CONSTRAINT "SettlementRefundAdjustment_originalSettlementCommissionInv_fkey" FOREIGN KEY ("originalSettlementCommissionInvoiceId") REFERENCES public."SettlementCommissionInvoice"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SettlementRefundAdjustment SettlementRefundAdjustment_refundFinanceLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustment"
    ADD CONSTRAINT "SettlementRefundAdjustment_refundFinanceLedgerEntryId_fkey" FOREIGN KEY ("refundFinanceLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementRefundAdjustment SettlementRefundAdjustment_refundRecordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustment"
    ADD CONSTRAINT "SettlementRefundAdjustment_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES public."RefundRecord"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SettlementRefundAdjustment SettlementRefundAdjustment_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SettlementRefundAdjustment"
    ADD CONSTRAINT "SettlementRefundAdjustment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ShipmentExecution ShipmentExecution_allocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShipmentExecution"
    ADD CONSTRAINT "ShipmentExecution_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ShipmentExecution ShipmentExecution_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShipmentExecution"
    ADD CONSTRAINT "ShipmentExecution_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ShipmentShippingCost ShipmentShippingCost_allocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShipmentShippingCost"
    ADD CONSTRAINT "ShipmentShippingCost_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ShipmentShippingCost ShipmentShippingCost_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShipmentShippingCost"
    ADD CONSTRAINT "ShipmentShippingCost_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ShopifyOrderLineItem ShopifyOrderLineItem_shopifyOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShopifyOrderLineItem"
    ADD CONSTRAINT "ShopifyOrderLineItem_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES public."ShopifyOrder"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ShopifyRefundLineItem ShopifyRefundLineItem_refundRecordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShopifyRefundLineItem"
    ADD CONSTRAINT "ShopifyRefundLineItem_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES public."RefundRecord"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ShopifyRefundLineItem ShopifyRefundLineItem_shopifyOrderLineItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShopifyRefundLineItem"
    ADD CONSTRAINT "ShopifyRefundLineItem_shopifyOrderLineItemId_fkey" FOREIGN KEY ("shopifyOrderLineItemId") REFERENCES public."ShopifyOrderLineItem"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ShopifyRefundLineItem ShopifyRefundLineItem_shopifyRefundId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShopifyRefundLineItem"
    ADD CONSTRAINT "ShopifyRefundLineItem_shopifyRefundId_fkey" FOREIGN KEY ("shopifyRefundId") REFERENCES public."ShopifyRefund"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ShopifyRefund ShopifyRefund_shopifyOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ShopifyRefund"
    ADD CONSTRAINT "ShopifyRefund_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES public."ShopifyOrder"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SupportTicketNote SupportTicketNote_authorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportTicketNote"
    ADD CONSTRAINT "SupportTicketNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SupportTicketNote SupportTicketNote_supportTicketId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportTicketNote"
    ADD CONSTRAINT "SupportTicketNote_supportTicketId_fkey" FOREIGN KEY ("supportTicketId") REFERENCES public."SupportTicket"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SupportTicketReply SupportTicketReply_authorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportTicketReply"
    ADD CONSTRAINT "SupportTicketReply_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SupportTicketReply SupportTicketReply_supportTicketId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportTicketReply"
    ADD CONSTRAINT "SupportTicketReply_supportTicketId_fkey" FOREIGN KEY ("supportTicketId") REFERENCES public."SupportTicket"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SupportTicket SupportTicket_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportTicket"
    ADD CONSTRAINT "SupportTicket_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SupportTicket SupportTicket_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportTicket"
    ADD CONSTRAINT "SupportTicket_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: UserVendorAccess UserVendorAccess_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserVendorAccess"
    ADD CONSTRAINT "UserVendorAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: UserVendorAccess UserVendorAccess_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserVendorAccess"
    ADD CONSTRAINT "UserVendorAccess_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorAllocationLineItem VendorAllocationLineItem_shopifyLineItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorAllocationLineItem"
    ADD CONSTRAINT "VendorAllocationLineItem_shopifyLineItemId_fkey" FOREIGN KEY ("shopifyLineItemId") REFERENCES public."ShopifyOrderLineItem"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorAllocationLineItem VendorAllocationLineItem_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorAllocationLineItem"
    ADD CONSTRAINT "VendorAllocationLineItem_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorAllocation VendorAllocation_assignedVendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorAllocation"
    ADD CONSTRAINT "VendorAllocation_assignedVendorId_fkey" FOREIGN KEY ("assignedVendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VendorAllocation VendorAllocation_originalVendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorAllocation"
    ADD CONSTRAINT "VendorAllocation_originalVendorId_fkey" FOREIGN KEY ("originalVendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VendorAllocation VendorAllocation_sourceShopifyOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorAllocation"
    ADD CONSTRAINT "VendorAllocation_sourceShopifyOrderId_fkey" FOREIGN KEY ("sourceShopifyOrderId") REFERENCES public."ShopifyOrder"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorBalanceEvent VendorBalanceEvent_correction_authority_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorBalanceEvent"
    ADD CONSTRAINT "VendorBalanceEvent_correction_authority_fkey" FOREIGN KEY ("financialCorrectionAuthorityId") REFERENCES public."FinancialCorrectionAuthority"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VendorBalanceEvent VendorBalanceEvent_financeLedgerEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorBalanceEvent"
    ADD CONSTRAINT "VendorBalanceEvent_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES public."FinanceLedgerEntry"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: VendorBalanceEvent VendorBalanceEvent_payoutBatchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorBalanceEvent"
    ADD CONSTRAINT "VendorBalanceEvent_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES public."PayoutBatch"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: VendorBalanceEvent VendorBalanceEvent_refundRecordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorBalanceEvent"
    ADD CONSTRAINT "VendorBalanceEvent_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES public."RefundRecord"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: VendorBalanceEvent VendorBalanceEvent_settlementApprovalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorBalanceEvent"
    ADD CONSTRAINT "VendorBalanceEvent_settlementApprovalId_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES public."SettlementApproval"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: VendorBalanceEvent VendorBalanceEvent_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorBalanceEvent"
    ADD CONSTRAINT "VendorBalanceEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorBillingProfile VendorBillingProfile_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorBillingProfile"
    ADD CONSTRAINT "VendorBillingProfile_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorFinancialProfile VendorFinancialProfile_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorFinancialProfile"
    ADD CONSTRAINT "VendorFinancialProfile_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorIntegrationAuditLog VendorIntegrationAuditLog_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorIntegrationAuditLog"
    ADD CONSTRAINT "VendorIntegrationAuditLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."VendorIntegrationClient"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorIntegrationInvoiceEvent VendorIntegrationInvoiceEvent_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorIntegrationInvoiceEvent"
    ADD CONSTRAINT "VendorIntegrationInvoiceEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."VendorIntegrationClient"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorIntegrationInvoiceEvent VendorIntegrationInvoiceEvent_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorIntegrationInvoiceEvent"
    ADD CONSTRAINT "VendorIntegrationInvoiceEvent_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorIntegrationShipmentEvent VendorIntegrationShipmentEvent_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorIntegrationShipmentEvent"
    ADD CONSTRAINT "VendorIntegrationShipmentEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."VendorIntegrationClient"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorIntegrationShipmentEvent VendorIntegrationShipmentEvent_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorIntegrationShipmentEvent"
    ADD CONSTRAINT "VendorIntegrationShipmentEvent_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorIntegrationStatusEvent VendorIntegrationStatusEvent_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorIntegrationStatusEvent"
    ADD CONSTRAINT "VendorIntegrationStatusEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."VendorIntegrationClient"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorIntegrationStatusEvent VendorIntegrationStatusEvent_vendorAllocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorIntegrationStatusEvent"
    ADD CONSTRAINT "VendorIntegrationStatusEvent_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES public."VendorAllocation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorProfileAuditLog VendorProfileAuditLog_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorProfileAuditLog"
    ADD CONSTRAINT "VendorProfileAuditLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorShippingConfig VendorShippingConfig_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorShippingConfig"
    ADD CONSTRAINT "VendorShippingConfig_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorShippingWarehouse VendorShippingWarehouse_configId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorShippingWarehouse"
    ADD CONSTRAINT "VendorShippingWarehouse_configId_fkey" FOREIGN KEY ("configId") REFERENCES public."VendorShippingConfig"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VendorShippingWarehouse VendorShippingWarehouse_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VendorShippingWarehouse"
    ADD CONSTRAINT "VendorShippingWarehouse_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: WebhookEvent WebhookEvent_shopifyOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WebhookEvent"
    ADD CONSTRAINT "WebhookEvent_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES public."ShopifyOrder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--
