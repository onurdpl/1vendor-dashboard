export type LidioEnv = Record<string, string | undefined>;

export type LidioReadOnlyConfig = {
  enabled: true;
  baseUrl: string;
  merchantCode: string;
  authorizationScheme: string;
  authorizationToken: string;
  merchantKey?: string;
  apiPassword?: string;
  subsellerProfileId: number;
};

export type LidioConfigDiagnostics = {
  enabled: boolean;
  baseUrl: string | null;
  merchantCode: string | null;
  authorizationScheme: string | null;
  authorizationTokenPresent: boolean;
  merchantKeyPresent: boolean;
  apiPasswordPresent: boolean;
  subsellerProfileId: number | null;
};

export type LidioReadOnlyConfigValidation =
  | {
      ok: true;
      config: LidioReadOnlyConfig;
      diagnostics: LidioConfigDiagnostics;
    }
  | {
      ok: false;
      message: string;
      missing: string[];
      diagnostics: LidioConfigDiagnostics;
    };

const EXPECTED_AUTHORIZATION_SCHEME = 'MxS2S';

function readEnvValue(env: LidioEnv, key: string) {
  return env[key]?.trim() ?? '';
}

function parseBoolean(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function parsePositiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function getLidioConfigDiagnostics(env: LidioEnv = process.env): LidioConfigDiagnostics {
  const profileId = readEnvValue(env, 'LIDIO_SUBSELLER_PROFILE_ID');

  return {
    enabled: parseBoolean(env.LIDIO_ENABLED),
    baseUrl: readEnvValue(env, 'LIDIO_BASE_URL') || null,
    merchantCode: readEnvValue(env, 'LIDIO_MERCHANT_CODE') || null,
    authorizationScheme: readEnvValue(env, 'LIDIO_AUTHORIZATION_SCHEME') || null,
    authorizationTokenPresent: Boolean(readEnvValue(env, 'LIDIO_AUTHORIZATION_TOKEN')),
    merchantKeyPresent: Boolean(readEnvValue(env, 'LIDIO_MERCHANT_KEY')),
    apiPasswordPresent: Boolean(readEnvValue(env, 'LIDIO_API_PASSWORD')),
    subsellerProfileId: profileId ? parsePositiveInteger(profileId) : null,
  };
}

export function validateLidioReadOnlyConfig(env: LidioEnv = process.env): LidioReadOnlyConfigValidation {
  const diagnostics = getLidioConfigDiagnostics(env);
  const baseUrl = readEnvValue(env, 'LIDIO_BASE_URL');
  const merchantCode = readEnvValue(env, 'LIDIO_MERCHANT_CODE');
  const authorizationScheme = readEnvValue(env, 'LIDIO_AUTHORIZATION_SCHEME') || EXPECTED_AUTHORIZATION_SCHEME;
  const authorizationToken = readEnvValue(env, 'LIDIO_AUTHORIZATION_TOKEN');
  const merchantKey = readEnvValue(env, 'LIDIO_MERCHANT_KEY');
  const apiPassword = readEnvValue(env, 'LIDIO_API_PASSWORD');
  const subsellerProfileIdRaw = readEnvValue(env, 'LIDIO_SUBSELLER_PROFILE_ID');
  const subsellerProfileId = subsellerProfileIdRaw ? parsePositiveInteger(subsellerProfileIdRaw) : 3;
  const missing = [
    diagnostics.enabled ? null : 'LIDIO_ENABLED=true',
    baseUrl ? null : 'LIDIO_BASE_URL',
    merchantCode ? null : 'LIDIO_MERCHANT_CODE',
    authorizationToken ? null : 'LIDIO_AUTHORIZATION_TOKEN',
  ].filter((key): key is string => Boolean(key));

  if (missing.length) {
    return {
      ok: false,
      message: 'Required Lidio sandbox env vars are missing.',
      missing,
      diagnostics,
    };
  }

  if (!baseUrl || !merchantCode || !authorizationToken || !subsellerProfileId) {
    return {
      ok: false,
      message: 'Required Lidio sandbox env vars are missing.',
      missing: [],
      diagnostics,
    };
  }

  if (authorizationScheme !== EXPECTED_AUTHORIZATION_SCHEME) {
    return {
      ok: false,
      message: `LIDIO_AUTHORIZATION_SCHEME must be ${EXPECTED_AUTHORIZATION_SCHEME}.`,
      missing: [],
      diagnostics,
    };
  }

  return {
    ok: true,
    config: {
      enabled: true,
      baseUrl: normalizeBaseUrl(baseUrl),
      merchantCode,
      authorizationScheme,
      authorizationToken,
      merchantKey: merchantKey || undefined,
      apiPassword: apiPassword || undefined,
      subsellerProfileId,
    },
    diagnostics: {
      ...diagnostics,
      baseUrl: normalizeBaseUrl(baseUrl),
      authorizationScheme,
      subsellerProfileId,
    },
  };
}
