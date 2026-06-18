DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "InvoiceExecution"
    WHERE "provider" = 'BIRFATURA'::"InvoiceExecutionProvider"
  ) THEN
    RAISE EXCEPTION 'Cannot remove BIRFATURA from InvoiceExecutionProvider because InvoiceExecution rows still use it.';
  END IF;
END $$;

ALTER TYPE "InvoiceExecutionProvider" RENAME TO "InvoiceExecutionProvider_old";
CREATE TYPE "InvoiceExecutionProvider" AS ENUM ('BIZIMHESAP', 'PARASUT');

ALTER TABLE "InvoiceExecution"
  ALTER COLUMN "provider" TYPE "InvoiceExecutionProvider"
  USING "provider"::text::"InvoiceExecutionProvider";

DROP TYPE "InvoiceExecutionProvider_old";
