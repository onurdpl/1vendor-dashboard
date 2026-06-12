import type { AppEnv } from '../../config/env.js';

export type LogoExecutionEnvironment = 'test' | 'production';

export type LogoExecutionTenantValidation = {
  expectedTenantIdPresent: boolean;
  expectedTenantId: string | null;
  actualTenantIdPresent: boolean;
  actualTenantId: string | null;
  status: 'not_checked' | 'matched' | 'mismatch' | 'missing_expected_tenant';
};

export type LogoExecutionEnvironmentGuardResult = {
  allowed: boolean;
  environment: LogoExecutionEnvironment | null;
  tenantValidation: LogoExecutionTenantValidation;
  blockers: string[];
};

export type ValidateLogoExecutionEnvironmentInput = {
  env: Pick<
    AppEnv,
    | 'LOGO_ISBASI_CREATE_ENABLED'
    | 'LOGO_ISBASI_CREATE_ENVIRONMENT'
    | 'LOGO_ISBASI_EXPECTED_TENANT_ID'
    | 'LOGO_ISBASI_BASE_URL'
  >;
  actualTenantId?: string | null;
};

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeEnvironment(value: unknown): LogoExecutionEnvironment | null {
  const normalized = readString(value)?.toLowerCase();
  return normalized === 'test' || normalized === 'production' ? normalized : null;
}

function buildTenantValidation(input: {
  expectedTenantId: string | null;
  actualTenantId: string | null;
}): LogoExecutionTenantValidation {
  if (!input.expectedTenantId) {
    return {
      expectedTenantIdPresent: false,
      expectedTenantId: null,
      actualTenantIdPresent: Boolean(input.actualTenantId),
      actualTenantId: input.actualTenantId,
      status: 'missing_expected_tenant',
    };
  }

  if (!input.actualTenantId) {
    return {
      expectedTenantIdPresent: true,
      expectedTenantId: input.expectedTenantId,
      actualTenantIdPresent: false,
      actualTenantId: null,
      status: 'not_checked',
    };
  }

  const matched = input.expectedTenantId === input.actualTenantId;
  return {
    expectedTenantIdPresent: true,
    expectedTenantId: input.expectedTenantId,
    actualTenantIdPresent: true,
    actualTenantId: input.actualTenantId,
    status: matched ? 'matched' : 'mismatch',
  };
}

export function validateLogoExecutionEnvironment(
  input: ValidateLogoExecutionEnvironmentInput,
): LogoExecutionEnvironmentGuardResult {
  const environment = normalizeEnvironment(input.env.LOGO_ISBASI_CREATE_ENVIRONMENT);
  const baseUrl = readString(input.env.LOGO_ISBASI_BASE_URL);
  const expectedTenantId = readString(input.env.LOGO_ISBASI_EXPECTED_TENANT_ID);
  const actualTenantId = readString(input.actualTenantId);
  const tenantValidation = buildTenantValidation({ expectedTenantId, actualTenantId });
  const blockers: string[] = [];

  if (input.env.LOGO_ISBASI_CREATE_ENABLED !== true) {
    blockers.push('LOGO_ISBASI_CREATE_ENABLED must be true before Logo invoice execution.');
  }

  if (!environment) {
    blockers.push('LOGO_ISBASI_CREATE_ENVIRONMENT must be test or production before Logo invoice execution.');
  }

  if (!baseUrl) {
    blockers.push('LOGO_ISBASI_BASE_URL is required before Logo invoice execution.');
  }

  if (tenantValidation.status === 'missing_expected_tenant') {
    blockers.push('LOGO_ISBASI_EXPECTED_TENANT_ID is required before Logo invoice execution.');
  }

  if (tenantValidation.status === 'mismatch') {
    blockers.push('Logo tenant mismatch. Authenticated Logo tenant does not match LOGO_ISBASI_EXPECTED_TENANT_ID.');
  }

  return {
    allowed: blockers.length === 0,
    environment,
    tenantValidation,
    blockers,
  };
}
