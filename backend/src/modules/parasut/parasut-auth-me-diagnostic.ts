type ParasutEnv = Record<string, string | undefined>;

type HttpResult = {
  status: number;
  contentType: string | null;
  body: unknown;
};

export type ParasutAuthMeDiagnosticOptions = {
  env?: ParasutEnv;
  fetchImpl?: typeof fetch;
};

export type ParasutOAuthResponseDiagnosticOptions = {
  env?: ParasutEnv;
  fetchImpl?: typeof fetch;
};

export type ParasutEnvDiagnosticOptions = {
  env?: ParasutEnv;
};

const STAGING_BASE_URL = 'https://api.heroku-staging.parasut.com';
const REQUIRED_ENV_KEYS = [
  'PARASUT_ENABLED',
  'PARASUT_TEST_MODE',
  'PARASUT_BASE_URL',
  'PARASUT_COMPANY_ID',
  'PARASUT_CLIENT_ID',
  'PARASUT_CLIENT_SECRET',
  'PARASUT_REDIRECT_URI',
  'PARASUT_USERNAME',
  'PARASUT_PASSWORD',
] as const;
const SAFE_ENV_DIAGNOSTIC_KEYS = [
  'PARASUT_CLIENT_ID',
  'PARASUT_CLIENT_SECRET',
  'PARASUT_USERNAME',
  'PARASUT_PASSWORD',
  'PARASUT_COMPANY_ID',
  'PARASUT_REDIRECT_URI',
  'PARASUT_GRANT_TYPE',
] as const;
const PASSWORD_GRANT = 'password';
const TEST_EINVOICE_VKN = '6490512763';
const SENSITIVE_KEY_PATTERN = /access|refresh|token|secret|password|authorization|client_secret/i;
const JWT_LIKE_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER_VALUE_PATTERN = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const KEY_VALUE_SECRET_PATTERN =
  /\b(access[_-]?token|refresh[_-]?token|token|client[_-]?secret|password|authorization)\b\s*[:=]\s*([^\s,;&]+)/gi;

function readEnv(env: ParasutEnv, key: string) {
  return env[key]?.trim() ?? '';
}

function buildEnvPresence(env: ParasutEnv) {
  return Object.fromEntries(REQUIRED_ENV_KEYS.map((key) => [key, Boolean(readEnv(env, key))])) as Record<
    (typeof REQUIRED_ENV_KEYS)[number],
    boolean
  >;
}

function buildSafeEnvPresence(env: ParasutEnv) {
  return Object.fromEntries(SAFE_ENV_DIAGNOSTIC_KEYS.map((key) => [key, Boolean(readEnv(env, key))])) as Record<
    (typeof SAFE_ENV_DIAGNOSTIC_KEYS)[number],
    boolean
  >;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function summarizeBody(body: unknown) {
  if (!isRecord(body)) {
    return {
      bodyType: Array.isArray(body) ? 'array' : body === null ? 'null' : typeof body,
      bodyKeys: [] as string[],
    };
  }

  return {
    bodyType: 'object',
    bodyKeys: Object.keys(body).filter((key) => !SENSITIVE_KEY_PATTERN.test(key)).sort(),
  };
}

function sanitizeDiagnosticText(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed
    .replace(JWT_LIKE_PATTERN, '[redacted-jwt]')
    .replace(BEARER_VALUE_PATTERN, 'Bearer [redacted]')
    .replace(KEY_VALUE_SECRET_PATTERN, '$1=[redacted]');
}

function extractOAuthErrorDetails(body: unknown) {
  if (!isRecord(body)) {
    return {};
  }

  const error = sanitizeDiagnosticText(body.error);
  const errorDescription = sanitizeDiagnosticText(body.error_description);
  const message = sanitizeDiagnosticText(body.message);

  return {
    ...(error ? { error } : {}),
    ...(errorDescription ? { errorDescription } : {}),
    ...(message ? { message } : {}),
  };
}

async function readJsonResponse(response: Response): Promise<HttpResult> {
  const contentType = response.headers.get('content-type');
  const text = await response.text();
  let body: unknown = text;
  if (text && contentType?.toLowerCase().includes('json')) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, contentType, body };
}

function getAccessToken(body: unknown) {
  return isRecord(body) && typeof body.access_token === 'string' && body.access_token.trim() ? body.access_token.trim() : null;
}

function collectCandidates(value: unknown, predicate: (key: string) => boolean, output = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCandidates(item, predicate, output);
    }
    return output;
  }
  if (!isRecord(value)) {
    return output;
  }

  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }

    if (predicate(key) && (typeof item === 'string' || typeof item === 'number')) {
      const candidate = String(item).trim();
      if (candidate) {
        output.add(candidate);
      }
      continue;
    }

    collectCandidates(item, predicate, output);
  }

  return output;
}

function getDataField(body: unknown, key: 'id' | 'type') {
  return isRecord(body) && isRecord(body.data) && typeof body.data[key] === 'string' ? body.data[key] : null;
}

function extractSafeMeIdentifiers(body: unknown, configuredCompanyId: string) {
  const companyIdCandidates = [
    ...collectCandidates(body, (key) => {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      return normalized === 'id' || normalized === 'companyid' || normalized === 'companyno' || normalized === 'firmid' || normalized === 'firmano';
    }),
  ].slice(0, 10);
  const companyNameCandidates = [
    ...collectCandidates(body, (key) => {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      return normalized === 'name' || normalized === 'companyname' || normalized === 'firmname';
    }),
  ].slice(0, 10);
  const accountIdCandidates = [
    ...collectCandidates(body, (key) => {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      return normalized === 'accountid' || normalized === 'userid';
    }),
  ].slice(0, 10);

  return {
    dataId: getDataField(body, 'id'),
    dataType: getDataField(body, 'type'),
    companyIdCandidates,
    companyNameCandidates,
    accountIdCandidates,
    configuredCompanyIdMatch:
      companyIdCandidates.length || getDataField(body, 'id')
        ? new Set([...companyIdCandidates, getDataField(body, 'id') ?? '']).has(configuredCompanyId)
        : null,
  };
}

function buildBaseResponse(env: ParasutEnv) {
  return {
    envPresence: buildEnvPresence(env),
    baseUrl: readEnv(env, 'PARASUT_BASE_URL') || null,
    companyId: readEnv(env, 'PARASUT_COMPANY_ID') || null,
    oauthSuccess: false,
    meSuccess: false,
    writesPerformed: false,
  };
}

export function runParasutEnvDiagnostic(options: ParasutEnvDiagnosticOptions = {}) {
  const env = options.env ?? process.env;
  const grantType = readEnv(env, 'PARASUT_GRANT_TYPE').toLowerCase();
  const grantTypeConfigured = Boolean(grantType);
  const grantTypeIsPassword = grantType === PASSWORD_GRANT;
  const grantTypeWarning =
    grantTypeConfigured && !grantTypeIsPassword
      ? 'PARASUT_GRANT_TYPE should be password for the current Paraşüt probe flow.'
      : !grantTypeConfigured
        ? 'PARASUT_GRANT_TYPE is not configured; set it to password for the current Paraşüt probe flow.'
        : null;

  return {
    statusCode: 200,
    body: {
      ok: true,
      envPresence: buildSafeEnvPresence(env),
      grantType: {
        passwordExpectedForCurrentProbeFlow: true,
        configured: grantTypeConfigured,
        matchesPasswordGrant: grantTypeIsPassword,
        warning: grantTypeWarning,
      },
      authConfirmation: {
        companyIdConfirmedCorrect: true,
        redirectUriRegisteredCorrectly: true,
        passwordGrantAllowed: true,
        authorizationCodeRequired: false,
        clientCredentialsMustBelongToConfiguredAccountEmail: true,
        testEinvoiceVkn: TEST_EINVOICE_VKN,
      },
      writesPerformed: false,
      externalApiCallsPerformed: false,
    },
  };
}

function buildTokenParams(env: ParasutEnv) {
  return new URLSearchParams({
    grant_type: 'password',
    client_id: readEnv(env, 'PARASUT_CLIENT_ID'),
    client_secret: readEnv(env, 'PARASUT_CLIENT_SECRET'),
    username: readEnv(env, 'PARASUT_USERNAME'),
    password: readEnv(env, 'PARASUT_PASSWORD'),
    redirect_uri: readEnv(env, 'PARASUT_REDIRECT_URI'),
  });
}

function buildFailure(env: ParasutEnv, code: string, message: string, statusCode = 422, details?: Record<string, unknown>) {
  return {
    statusCode,
    body: {
      ok: false,
      ...buildBaseResponse(env),
      error: {
        code,
        message,
        ...(details ?? {}),
      },
    },
  };
}

export async function runParasutOAuthResponseDiagnostic(options: ParasutOAuthResponseDiagnosticOptions = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(readEnv(env, 'PARASUT_BASE_URL'));

  const missing = REQUIRED_ENV_KEYS.filter((key) => !readEnv(env, key));
  if (missing.length) {
    return buildFailure(env, 'parasut_env_missing', 'Required Paraşüt diagnostic env vars are missing.', 422, {
      missing,
    });
  }

  if (readEnv(env, 'PARASUT_ENABLED').toLowerCase() !== 'true') {
    return buildFailure(env, 'parasut_disabled', 'PARASUT_ENABLED=true is required for this diagnostic.');
  }

  if (readEnv(env, 'PARASUT_TEST_MODE').toLowerCase() !== 'true') {
    return buildFailure(env, 'parasut_test_mode_required', 'PARASUT_TEST_MODE=true is required for this diagnostic.');
  }

  if (baseUrl !== STAGING_BASE_URL) {
    return buildFailure(env, 'parasut_staging_base_url_required', 'PARASUT_BASE_URL must be the Paraşüt staging URL.', 422, {
      expectedBaseUrl: STAGING_BASE_URL,
      actualBaseUrl: baseUrl || null,
    });
  }

  let tokenResponse: HttpResult;
  try {
    tokenResponse = await readJsonResponse(
      await fetchImpl(`${baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: buildTokenParams(env).toString(),
      }),
    );
  } catch (error) {
    return buildFailure(env, 'parasut_oauth_fetch_failed', error instanceof Error ? error.message : 'OAuth request failed.', 502);
  }

  const oauthDetails = extractOAuthErrorDetails(tokenResponse.body);
  return {
    statusCode: 200,
    body: {
      ok: true,
      provider: 'PARASUT',
      mode: 'oauth_response_inspect',
      oauthStatus: tokenResponse.status,
      oauthResponseKeys: summarizeBody(tokenResponse.body).bodyKeys,
      oauthError: oauthDetails.error ?? null,
      oauthErrorDescription: oauthDetails.errorDescription ?? null,
      oauthMessage: oauthDetails.message ?? null,
      writesPerformed: false,
      continuedAfterAuth: false,
    },
  };
}

export async function runParasutAuthMeDiagnostic(options: ParasutAuthMeDiagnosticOptions = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = buildBaseResponse(env);
  const baseUrl = normalizeBaseUrl(readEnv(env, 'PARASUT_BASE_URL'));
  const companyId = readEnv(env, 'PARASUT_COMPANY_ID');

  const missing = REQUIRED_ENV_KEYS.filter((key) => !readEnv(env, key));
  if (missing.length) {
    return buildFailure(env, 'parasut_env_missing', 'Required Paraşüt diagnostic env vars are missing.', 422, {
      missing,
    });
  }

  if (readEnv(env, 'PARASUT_ENABLED').toLowerCase() !== 'true') {
    return buildFailure(env, 'parasut_disabled', 'PARASUT_ENABLED=true is required for this diagnostic.');
  }

  if (readEnv(env, 'PARASUT_TEST_MODE').toLowerCase() !== 'true') {
    return buildFailure(env, 'parasut_test_mode_required', 'PARASUT_TEST_MODE=true is required for this diagnostic.');
  }

  if (baseUrl !== STAGING_BASE_URL) {
    return buildFailure(env, 'parasut_staging_base_url_required', 'PARASUT_BASE_URL must be the Paraşüt staging URL.', 422, {
      expectedBaseUrl: STAGING_BASE_URL,
      actualBaseUrl: baseUrl || null,
    });
  }

  let tokenResponse: HttpResult;
  try {
    tokenResponse = await readJsonResponse(
      await fetchImpl(`${baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: buildTokenParams(env).toString(),
      }),
    );
  } catch (error) {
    return buildFailure(env, 'parasut_oauth_fetch_failed', error instanceof Error ? error.message : 'OAuth request failed.', 502);
  }

  const accessToken = getAccessToken(tokenResponse.body);
  if (tokenResponse.status < 200 || tokenResponse.status >= 300 || !accessToken) {
    return {
      statusCode: 502,
      body: {
        ok: false,
        ...base,
        oauthSuccess: false,
        oauth: {
          status: tokenResponse.status,
          contentType: tokenResponse.contentType,
          ...summarizeBody(tokenResponse.body),
          ...extractOAuthErrorDetails(tokenResponse.body),
          tokenReceived: Boolean(accessToken),
        },
        error: {
          code: 'parasut_oauth_failed',
          message: 'Paraşüt OAuth request did not return an access token.',
        },
      },
    };
  }

  let meResponse: HttpResult;
  try {
    meResponse = await readJsonResponse(
      await fetchImpl(`${baseUrl}/v4/me`, {
        method: 'GET',
        headers: {
          accept: 'application/vnd.api+json, application/json',
          authorization: `Bearer ${accessToken}`,
        },
      }),
    );
  } catch (error) {
    return buildFailure(env, 'parasut_me_fetch_failed', error instanceof Error ? error.message : '/v4/me request failed.', 502);
  }

  if (meResponse.status < 200 || meResponse.status >= 300) {
    return {
      statusCode: 502,
      body: {
        ok: false,
        ...base,
        oauthSuccess: true,
        meSuccess: false,
        me: {
          status: meResponse.status,
          contentType: meResponse.contentType,
          ...summarizeBody(meResponse.body),
        },
        error: {
          code: 'parasut_me_failed',
          message: 'Paraşüt /v4/me request failed.',
        },
      },
    };
  }

  const meIdentifiers = extractSafeMeIdentifiers(meResponse.body, companyId);
  return {
    statusCode: 200,
    body: {
      ok: true,
      ...base,
      oauthSuccess: true,
      meSuccess: true,
      me: {
        status: meResponse.status,
        contentType: meResponse.contentType,
        ...summarizeBody(meResponse.body),
        identifiers: meIdentifiers,
      },
      configuredCompanyIdMatchesMe: meIdentifiers.configuredCompanyIdMatch,
      writesPerformed: false,
    },
  };
}
