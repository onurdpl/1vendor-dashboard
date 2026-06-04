import { LidioHttpClient, type LidioHttpResponse } from '../modules/lidio/lidio.client.js';
import { getLidioConfigDiagnostics, validateLidioReadOnlyConfig, type LidioEnv } from '../modules/lidio/lidio.config.js';

type ProbeLogger = Pick<Console, 'log' | 'error'>;

export type LidioSandboxProbeOptions = {
  env?: LidioEnv;
  fetchImpl?: typeof fetch;
  logger?: ProbeLogger;
};

const READ_ONLY_ENDPOINT = '/GetSubsellerList';
const SENSITIVE_RESPONSE_KEY_PATTERN =
  /authorization|token|secret|password|merchantkey|apikey|api_password|iban|vkntckn|tax|tckn|vkn|phone|email|contact/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeResponseBody(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeResponseBody(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_RESPONSE_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeResponseBody(item),
    ]),
  );
}

function buildProbeSummary(result: LidioHttpResponse) {
  return {
    endpoint: result.request.path,
    method: result.request.method,
    status: result.status,
    ok: result.ok,
    contentType: result.contentType,
    responseBody: sanitizeResponseBody(result.body),
  };
}

export async function runLidioSandboxProbe(options: LidioSandboxProbeOptions = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const validation = validateLidioReadOnlyConfig(env);

  logger.log(
    JSON.stringify(
      {
        event: 'lidio_sandbox_probe_config',
        diagnostics: validation.ok ? validation.diagnostics : getLidioConfigDiagnostics(env),
      },
      null,
      2,
    ),
  );

  if (!validation.ok) {
    throw new Error(`${validation.message} Missing: ${validation.missing.join(', ') || 'none'}.`);
  }

  const client = new LidioHttpClient({
    config: validation.config,
    fetchImpl: options.fetchImpl,
  });

  logger.log(
    JSON.stringify(
      {
        event: 'lidio_sandbox_probe_request',
        method: 'POST',
        endpoint: READ_ONLY_ENDPOINT,
        writesPerformed: false,
      },
      null,
      2,
    ),
  );

  const result = await client.request({
    path: READ_ONLY_ENDPOINT,
    body: {},
  });
  const summary = buildProbeSummary(result);

  logger.log(
    JSON.stringify(
      {
        event: 'lidio_sandbox_probe_response',
        ...summary,
      },
      null,
      2,
    ),
  );

  return summary;
}

export async function runLidioSandboxProbeCli(options: LidioSandboxProbeOptions = {}) {
  const logger = options.logger ?? console;
  const result = await runLidioSandboxProbe({ ...options, logger });

  if (!result.ok) {
    logger.error(
      JSON.stringify(
        {
          event: 'lidio_sandbox_probe_failed',
          status: result.status,
          endpoint: result.endpoint,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }

  return result;
}
