-- Distinguish admin refund authorization from terminal refund reconciliation.
-- This state is workflow-only and creates no Shopify or monetary side effects.

ALTER TYPE "CustomerCancellationStatus"
ADD VALUE 'APPROVED_FOR_REFUND' AFTER 'PARTIALLY_RESOLVED';
