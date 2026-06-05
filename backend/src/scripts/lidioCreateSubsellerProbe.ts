import { LidioHttpClient, type CreateSubsellerRequest, type LidioHttpResponse } from '../modules/lidio/lidio.client.js';
import { getLidioConfigDiagnostics, validateLidioReadOnlyConfig, type LidioEnv } from '../modules/lidio/lidio.config.js';

type ProbeLogger = Pick<Console, 'log' | 'error'>;

export type LidioCreateSubsellerProbeOptions = {
  env?: LidioEnv;
  fetchImpl?: typeof fetch;
  logger?: ProbeLogger;
  now?: () => Date;
};

const WRITE_ENDPOINT = '/CreateSubseller';
const WRITE_PROBE_FLAG = 'LIDIO_ALLOW_WRITE_PROBE';
const SANDBOX_TEST_VKN = '9999999994';
const SENSITIVE_RESPONSE_KEY_PATTERN =
  /authorization|token|secret|password|merchantkey|apikey|api_password|iban|vkntckn|tax|tckn|vkn|phone|email|contact|address/i;

function parseBoolean(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

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

function extractResultField(body: unknown, key: string): unknown {
  return isRecord(body) ? body[key] : undefined;
}

function buildCreateSubsellerRequest(profileId: number, now: Date): CreateSubsellerRequest {
  const runId = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

  return {
    isActive: true,
    companyName: `Sporgym Lidio Sandbox Vendor ${runId}`,
    companyType: 'Limited',
    taxOffice: 'Sandbox Tax Office',
    vkntckn: SANDBOX_TEST_VKN,
    registeredCountry: 'TR',
    registeredCity: 'Istanbul',
    registeredDistrict: 'Kadikoy',
    registeredAddress: 'Sandbox test address for Lidio CreateSubseller probe. Not a real vendor.',
    subsellerIdGivenByMerchant: `SPORGYM-LIDIO-SANDBOX-${runId}`,
    contactName: 'Lidio Sandbox Test Vendor',
    contactPhone: '+900000000000',
    contactEmail: `lidio-sandbox-${runId}@example.invalid`,
    virtualProductPermission: false,
    merchantPanelUse: false,
    chargebacksOnSubseller: false,
    payOutNotAllowed: true,
    payOutPreventionReason: 'MerchantRequest',
    payOutBlockageAmount: 0,
    subsellerProfileId: profileId,
    acceptExistingMatchWarning: false,
    clientType: 'Web',
    merchantUrl: 'https://example.invalid/sporgym-lidio-sandbox',
    clientIp: '127.0.0.1',
    clientUserAgent: 'Sporgym Lidio sandbox CreateSubseller probe',
    subsellerContractApproval: {
      timestamp: now.toISOString(),
      ipAddress: '127.0.0.1',
    },
  };
}

function buildProbeSummary(result: LidioHttpResponse, writesPerformed: boolean) {
  const resultCode = extractResultField(result.body, 'result');
  const resultMessage = extractResultField(result.body, 'resultMessage');
  const subsellerId = extractResultField(result.body, 'subsellerId');

  return {
    endpoint: result.request.path,
    method: result.request.method,
    status: result.status,
    ok: result.ok,
    contentType: result.contentType,
    writesPerformed,
    result: typeof resultCode === 'string' ? resultCode : null,
    resultMessage: typeof resultMessage === 'string' || resultMessage === null ? resultMessage : null,
    subsellerId: typeof subsellerId === 'number' || typeof subsellerId === 'string' ? subsellerId : null,
    responseBody: sanitizeResponseBody(result.body),
  };
}

export async function runLidioCreateSubsellerProbe(options: LidioCreateSubsellerProbeOptions = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const writesAllowed = parseBoolean(env[WRITE_PROBE_FLAG]);

  if (!writesAllowed) {
    const summary = {
      event: 'lidio_create_subseller_probe_skipped',
      endpoint: WRITE_ENDPOINT,
      writesPerformed: false,
      reason: `${WRITE_PROBE_FLAG}=true is required before any CreateSubseller request is sent.`,
    };

    logger.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  const validation = validateLidioReadOnlyConfig(env);

  logger.log(
    JSON.stringify(
      {
        event: 'lidio_create_subseller_probe_config',
        diagnostics: validation.ok ? validation.diagnostics : getLidioConfigDiagnostics(env),
        writesAllowed: true,
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
  const requestBody = buildCreateSubsellerRequest(
    validation.config.subsellerProfileId,
    options.now ? options.now() : new Date(),
  );

  logger.log(
    JSON.stringify(
      {
        event: 'lidio_create_subseller_probe_request',
        method: 'POST',
        endpoint: WRITE_ENDPOINT,
        writesPerformed: true,
        testOnly: true,
        requestBodyKeys: Object.keys(requestBody).sort(),
      },
      null,
      2,
    ),
  );

  const result = await client.createSubseller(requestBody);
  const summary = buildProbeSummary(result, true);

  logger.log(
    JSON.stringify(
      {
        event: 'lidio_create_subseller_probe_response',
        ...summary,
      },
      null,
      2,
    ),
  );

  return summary;
}

export async function runLidioCreateSubsellerProbeCli(options: LidioCreateSubsellerProbeOptions = {}) {
  const logger = options.logger ?? console;
  const result = await runLidioCreateSubsellerProbe({ ...options, logger });

  if ('ok' in result && !result.ok) {
    logger.error(
      JSON.stringify(
        {
          event: 'lidio_create_subseller_probe_failed',
          status: result.status,
          endpoint: result.endpoint,
          result: result.result,
          resultMessage: result.resultMessage,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }

  return result;
}
