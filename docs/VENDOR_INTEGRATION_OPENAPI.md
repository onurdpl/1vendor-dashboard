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

The server URL in the spec is:

```text
https://api.sporgym.com
```

Use this production API domain for provider handoffs unless Sporgym explicitly issues a separate sandbox/staging base URL.

## Swagger UI Viewer

The backend exposes a read-only Swagger UI viewer for the Vendor Integration OpenAPI file:

```text
GET /docs/vendor-integration
```

The raw OpenAPI YAML is available at:

```text
GET /docs/openapi/vendor-integration.openapi.yaml
```

The deployed Vendor Integration documentation is available at:

```text
https://api.sporgym.com/docs/vendor-integration
https://api.sporgym.com/docs/openapi/vendor-integration.openapi.yaml
```

The viewer renders only the provider-facing Vendor Integration OpenAPI spec. It does not expose bearer tokens, provider secrets, request bodies, response bodies, or internal admin endpoints.

## Generate Docs Later

Future documentation tooling should render `docs/openapi/vendor-integration.openapi.yaml` directly. Good follow-up options include:

- Swagger UI hosted behind an internal/admin-safe path.
- Static HTML generated from the OpenAPI file during documentation builds.
- Postman collections generated from the OpenAPI file instead of maintained by hand.

## Source Of Truth

OpenAPI is authoritative for implemented provider-facing Vendor Integration API contracts. Avoid maintaining separate hand-written endpoint schemas in Markdown because they drift quickly. Existing Markdown docs should point readers to the OpenAPI file for exact paths, fields, schemas, and examples.
