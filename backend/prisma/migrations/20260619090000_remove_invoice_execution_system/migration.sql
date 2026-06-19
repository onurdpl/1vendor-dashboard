-- C4 prerequisite: production InvoiceExecution metadata was exported from
-- GET /admin/diagnostics/cleanup/invoice-execution-archive before this schema removal.
-- Verified archive source: vendor_dashboard_h8fb, archiveStatus READY_FOR_EXPORT, totalRows 4.

DROP TABLE IF EXISTS "InvoiceExecution";
DROP TYPE IF EXISTS "InvoiceExecutionProvider";
DROP TYPE IF EXISTS "InvoiceExecutionStatus";
