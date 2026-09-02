-- Represent canonically verified product refund before Shopify order cancellation confirmation.
-- This state is workflow-only and does not call Shopify or mutate money.

ALTER TYPE "CustomerCancellationStatus"
ADD VALUE 'REFUNDED_AWAITING_ORDER_CANCEL' AFTER 'APPROVED_FOR_REFUND';
