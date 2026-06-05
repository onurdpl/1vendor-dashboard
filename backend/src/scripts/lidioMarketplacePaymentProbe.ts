import { LidioHttpClient, type LidioHttpResponse, type StartHostedMarketplacePaymentRequest } from '../modules/lidio/lidio.client.js';
import { getLidioConfigDiagnostics, validateLidioReadOnlyConfig, type LidioEnv } from '../modules/lidio/lidio.config.js';

type ProbeLogger = Pick<Console, 'log' | 'error'>;

export type LidioMarketplacePaymentProbeOptions = {
  env?: LidioEnv;
  fetchImpl?: typeof fetch;
  logger?: ProbeLogger;
  now?: () => Date;
};

const PAYMENT_ENDPOINT = '/StartHostedPaymentProcess';
const PAYMENT_PROBE_FLAG = 'LIDIO_ALLOW_PAYMENT_PROBE';
const SANDBOX_SUBSELLER_ID = 3;
const ITEM_TOTAL_PRICE = 10;
const SUBSELLER_PAYOUT_AMOUNT = 8;
const SENSITIVE_RESPONSE_KEY_PATTERN =
  /authorization|token|secret|password|merchantkey|apikey|api_password|card|pan|cvv|redirect|url|phone|email|customer|address/i;

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

function buildMarketplacePaymentRequest(now: Date): StartHostedMarketplacePaymentRequest {
  const runId = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const orderId = `SPGMP${runId}`;

  return {
    orderId,
    merchantProcessId: `MP${runId}`,
    merchantCustomField: 'lidio-marketplace-payment-sandbox-probe',
    totalAmount: ITEM_TOTAL_PRICE,
    currency: 'TRY',
    customerInfo: {
      email: `lidio-marketplace-${runId}@example.invalid`,
      customerId: `LIDIO-CUSTOMER-${runId}`,
      name: 'Lidio Sandbox Customer',
      phone: '5000000000',
    },
    paymentInstruments: ['NewCard'],
    paymentInstrumentInfo: {
      card: {
        processType: 'sales',
        useInstallment: false,
        useLoyaltyPoints: false,
        noAmex: true,
        noForeignCard: true,
      },
    },
    basketItems: [
      {
        name: 'Lidio Sandbox Marketplace Item',
        quantity: 1,
        unitPrice: ITEM_TOTAL_PRICE,
        itemIdGivenByMerchant: `SPGMP-ITEM-${runId}`,
        itemType: 'Physical',
        marketplace: {
          subsellerId: SANDBOX_SUBSELLER_ID,
          itemTotalPrice: ITEM_TOTAL_PRICE,
          subsellerPayoutAmount: SUBSELLER_PAYOUT_AMOUNT,
        },
      },
    ],
    dontDistributeSubsellerPayout: false,
    returnUrl: 'https://example.invalid/lidio/sandbox-return',
    notificationUrl: 'https://example.invalid/lidio/sandbox-notification',
    language: 'En',
    clientType: 'Web',
    merchantUrl: 'https://example.invalid/sporgym-lidio-marketplace-payment-sandbox',
    clientIp: '127.0.0.1',
    clientUserAgent: 'Sporgym Lidio sandbox marketplace payment probe',
  };
}

function buildProbeSummary(result: LidioHttpResponse, writesPerformed: boolean) {
  const resultCode = extractResultField(result.body, 'result');
  const resultMessage = extractResultField(result.body, 'resultMessage');
  const systemTransId = extractResultField(result.body, 'systemTransId');
  const orderId = extractResultField(result.body, 'orderId');
  const redirectURL = extractResultField(result.body, 'redirectURL');

  return {
    endpoint: result.request.path,
    method: result.request.method,
    status: result.status,
    ok: result.ok,
    contentType: result.contentType,
    writesPerformed,
    result: typeof resultCode === 'string' ? resultCode : null,
    resultMessage: typeof resultMessage === 'string' || resultMessage === null ? resultMessage : null,
    systemTransIdPresent: typeof systemTransId === 'string' && systemTransId.length > 0,
    orderId: typeof orderId === 'string' ? orderId : null,
    redirectURLPresent: typeof redirectURL === 'string' && redirectURL.length > 0,
    responseBody: sanitizeResponseBody(result.body),
  };
}

export async function runLidioMarketplacePaymentProbe(options: LidioMarketplacePaymentProbeOptions = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const writesAllowed = parseBoolean(env[PAYMENT_PROBE_FLAG]);

  if (!writesAllowed) {
    const summary = {
      event: 'lidio_marketplace_payment_probe_skipped',
      endpoint: PAYMENT_ENDPOINT,
      writesPerformed: false,
      reason: `${PAYMENT_PROBE_FLAG}=true is required before any StartHostedPaymentProcess request is sent.`,
    };

    logger.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  const validation = validateLidioReadOnlyConfig(env);

  logger.log(
    JSON.stringify(
      {
        event: 'lidio_marketplace_payment_probe_config',
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
  const requestBody = buildMarketplacePaymentRequest(options.now ? options.now() : new Date());

  logger.log(
    JSON.stringify(
      {
        event: 'lidio_marketplace_payment_probe_request',
        method: 'POST',
        endpoint: PAYMENT_ENDPOINT,
        writesPerformed: true,
        testOnly: true,
        requestBodyKeys: Object.keys(requestBody).sort(),
        basketItemCount: requestBody.basketItems.length,
        marketplace: {
          subsellerId: SANDBOX_SUBSELLER_ID,
          itemTotalPrice: ITEM_TOTAL_PRICE,
          subsellerPayoutAmount: SUBSELLER_PAYOUT_AMOUNT,
        },
        includesCardData: false,
      },
      null,
      2,
    ),
  );

  const result = await client.startHostedMarketplacePayment(requestBody);
  const summary = buildProbeSummary(result, true);

  logger.log(
    JSON.stringify(
      {
        event: 'lidio_marketplace_payment_probe_response',
        ...summary,
      },
      null,
      2,
    ),
  );

  return summary;
}

export async function runLidioMarketplacePaymentProbeCli(options: LidioMarketplacePaymentProbeOptions = {}) {
  const logger = options.logger ?? console;
  const result = await runLidioMarketplacePaymentProbe({ ...options, logger });

  if ('ok' in result && !result.ok) {
    logger.error(
      JSON.stringify(
        {
          event: 'lidio_marketplace_payment_probe_failed',
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
