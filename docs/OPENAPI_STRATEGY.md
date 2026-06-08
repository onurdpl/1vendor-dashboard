# OpenAPI Strategy

OpenAPI should be the authoritative contract source for external and provider-facing API integrations.

## Principles

- OpenAPI files define implemented endpoint paths, authentication, request schemas, response schemas, headers, examples, and error responses.
- Markdown docs should provide context, workflow guidance, rollout notes, operational boundaries, and links to the OpenAPI files.
- Markdown docs should not duplicate complete endpoint schemas once an OpenAPI file exists.
- Future Swagger UI pages should render OpenAPI files directly.
- Future Postman collections should be generated from OpenAPI files.
- Avoid maintaining duplicate documentation sources for the same API contract.

## Current OpenAPI Files

```text
docs/openapi/vendor-integration.openapi.yaml
```

This file documents only the currently implemented provider-facing Vendor Integration API endpoints:

- `GET /api/vendor-integration/orders`
- `POST /api/vendor-integration/orders/{allocationId}/status`
- `POST /api/vendor-integration/orders/{allocationId}/shipment`
- `POST /api/vendor-integration/orders/{allocationId}/invoice`

## Future Direction

If new provider-facing endpoints are implemented later, add them to the OpenAPI file in the same commit as the API behavior change. Documentation pages, Swagger UI, generated SDKs, and Postman collections should then consume the OpenAPI file instead of copying endpoint schemas manually.
