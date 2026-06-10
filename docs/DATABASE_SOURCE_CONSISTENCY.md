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
