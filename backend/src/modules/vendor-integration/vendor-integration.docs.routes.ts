import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const OPENAPI_SPEC_PATH = resolve(CURRENT_DIR, '../../../../docs/openapi/vendor-integration.openapi.yaml');
const OPENAPI_SPEC_ROUTE = '/docs/openapi/vendor-integration.openapi.yaml';

async function readVendorIntegrationOpenApiSpec(reply: FastifyReply) {
  try {
    return await readFile(OPENAPI_SPEC_PATH, 'utf8');
  } catch {
    return reply.code(500).send({
      message: 'Vendor Integration OpenAPI spec is unavailable.',
    });
  }
}

function renderSwaggerHtml() {
  const specRouteJson = JSON.stringify(OPENAPI_SPEC_ROUTE);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vendor Integration API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body {
        margin: 0;
        background: #f7f7f8;
      }

      .swagger-ui .topbar {
        display: none;
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.addEventListener('load', () => {
        window.ui = SwaggerUIBundle({
          url: ${specRouteJson},
          dom_id: '#swagger-ui',
          deepLinking: true,
          supportedSubmitMethods: [],
          tryItOutEnabled: false,
          presets: [
            SwaggerUIBundle.presets.apis
          ],
          plugins: [
            SwaggerUIBundle.plugins.DownloadUrl
          ],
          layout: 'BaseLayout'
        });
      });
    </script>
  </body>
</html>`;
}

export function registerVendorIntegrationDocsRoutes(app: FastifyInstance) {
  app.get('/docs/vendor-integration', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderSwaggerHtml());
  });

  app.get(OPENAPI_SPEC_ROUTE, async (_request, reply) => {
    const spec = await readVendorIntegrationOpenApiSpec(reply);
    if (typeof spec !== 'string') {
      return spec;
    }

    return reply.type('application/yaml; charset=utf-8').send(spec);
  });
}
