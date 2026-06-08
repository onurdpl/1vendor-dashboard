# Vendor Integration OpenAPI

The Vendor Integration API OpenAPI specification lives at:

```text
docs/openapi/vendor-integration.openapi.yaml
```

This file is now the source of truth for provider-facing Vendor Integration API documentation. Markdown documents can explain usage, operational boundaries, and rollout notes, but endpoint paths, request bodies, response bodies, authentication, scopes, and error schemas should be derived from the OpenAPI file.

## Import Into Postman

1. Open Postman.
2. Select **Import**.
3. Choose **Files**.
4. Select `docs/openapi/vendor-integration.openapi.yaml`.
5. Configure the collection authorization as Bearer Token and provide a vendor integration token.

The server URL in the spec is a placeholder:

```text
https://backend.example.com
```

Replace it with the target backend URL in the imported Postman environment.

## Generate Docs Later

Future documentation tooling should render `docs/openapi/vendor-integration.openapi.yaml` directly. Good follow-up options include:

- Swagger UI hosted behind an internal/admin-safe path.
- Static HTML generated from the OpenAPI file during documentation builds.
- Postman collections generated from the OpenAPI file instead of maintained by hand.

## Source Of Truth

OpenAPI is authoritative for implemented provider-facing Vendor Integration API contracts. Avoid maintaining separate hand-written endpoint schemas in Markdown because they drift quickly. Existing Markdown docs should point readers to the OpenAPI file for exact paths, fields, schemas, and examples.
