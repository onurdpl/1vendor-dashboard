# Database Source Consistency

Finance, settlement, invoice, and payout audits must state which database produced the evidence. Local validation is not deployed validation unless the database source is proven to match.

## Runtime Diagnostics

Use `GET /health` or `GET /health/db` before interpreting finance audit results. The response includes:

- `databaseSource.databaseHost`
- `databaseSource.databaseName`
- `databaseSource.databaseSourceLabel`
- `databaseSource.duplicateDatabaseUrlDefinitionsDetected`
- `databaseSource.warnings`
- `financeAuditMetadata.environment`
- `financeAuditMetadata.databaseHost`
- `financeAuditMetadata.databaseName`
- `financeAuditMetadata.schemaReady`

These fields intentionally exclude usernames, passwords, and full connection strings.

## Duplicate DATABASE_URL Warning

If multiple `DATABASE_URL` keys are present in local env source files, diagnostics return:

`Multiple DATABASE_URL definitions detected. Audit results may not represent deployed environment.`

Treat all local finance evidence as local-only until the resolved DB host and DB name are confirmed.

## Local DB Audit

A local audit should report:

- command or endpoint used
- `financeAuditMetadata`
- whether duplicate `DATABASE_URL` definitions were detected
- whether the audited DB is local or remote

If `databaseSourceLabel` is `local`, do not use the results as deployed truth.

## Deployed DB Audit

A deployed audit should be run through the deployed backend or direct read-only deployed DB access. Public health endpoints can confirm DB reachability and expose secret-safe DB identity, but row-level checks still require authenticated admin access or read-only database credentials.

Do not infer deployed `VendorBillingProfile`, Logo binding, settlement approval, invoice record, or payout state from local database evidence.

## InvoiceExecution Cleanup Readiness

C4 `InvoiceExecution` removal requires production evidence from:

`GET /admin/diagnostics/cleanup/invoice-execution-readiness`

The endpoint is admin-only and read-only. It reports secret-safe database identity, total `InvoiceExecution` row count, provider/status counts, oldest/newest timestamps, and a cleanup readiness classification:

- `READY_TO_REMOVE`: no production rows were found
- `ARCHIVE_REQUIRED`: production rows exist and must be exported or archived before schema removal
- `UNKNOWN`: the readiness query failed or the table/model is unavailable

Local `InvoiceExecution` row counts are not valid production evidence for C4 schema removal.

When readiness returns `ARCHIVE_REQUIRED`, save the production output from:

`GET /admin/diagnostics/cleanup/invoice-execution-archive`

This endpoint is admin-only and read-only. It returns safe metadata only: row ids, provider/status, provider invoice identifiers, timestamps, snapshot presence booleans, and linked finance ledger/order identifiers. It must not be replaced by a local DB archive because local rows do not prove production history.
