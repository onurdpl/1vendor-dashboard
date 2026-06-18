import type { AppEnv } from '../../config/env.js';

export type LogoExecutionEnvironment = 'test' | 'production';

export type LogoExecutionTenantValidationStatus =
  | 'skipped'
  | 'passed'
  | 'blocked_missing_actual'
  | 'blocked_mismatch';

export type LogoExecutionTenantValidation = {
  expectedTenantConfigured: boolean;
  expectedTenantIdPresent: boolean;
  expectedTenantId: string | null;
  actualTenantPresent: boolean;
  actualTenantIdPresent: boolean;
  actualTenantId: string | null;
  tenantValidationStatus: LogoExecutionTenantValidationStatus;
  status: LogoExecutionTenantValidationStatus;
};

export type LogoExecutionEnvironmentGuardResult = {
  allowed: boolean;
  environment: LogoExecutionEnvironment | null;
  expectedTenantConfigured: boolean;
  actualTenantPresent: boolean;
  tenantValidationStatus: LogoExecutionTenantValidationStatus;
  tenantValidation: LogoExecutionTenantValidation;
  blockers: string[];
  warnings: string[];
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
  deferTenantValidationUntilLogin?: boolean;
};

const TENANT_VALIDATION_SKIPPED_WARNING =
  'Tenant validation skipped because LOGO_ISBASI_EXPECTED_TENANT_ID is not configured.';

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
  deferTenantValidationUntilLogin?: boolean;
}): LogoExecutionTenantValidation {
  if (!input.expectedTenantId) {
    return {
      expectedTenantConfigured: false,
      expectedTenantIdPresent: false,
      expectedTenantId: null,
      actualTenantPresent: Boolean(input.actualTenantId),
      actualTenantIdPresent: Boolean(input.actualTenantId),
      actualTenantId: input.actualTenantId,
      tenantValidationStatus: 'skipped',
      status: 'skipped',
    };
  }

  if (!input.actualTenantId) {
    const status = input.deferTenantValidationUntilLogin ? 'skipped' : 'blocked_missing_actual';
    return {
      expectedTenantConfigured: true,
      expectedTenantIdPresent: true,
      expectedTenantId: input.expectedTenantId,
      actualTenantPresent: false,
      actualTenantIdPresent: false,
      actualTenantId: null,
      tenantValidationStatus: status,
      status,
    };
  }

  const matched = input.expectedTenantId === input.actualTenantId;
  const status = matched ? 'passed' : 'blocked_mismatch';
  return {
    expectedTenantConfigured: true,
    expectedTenantIdPresent: true,
    expectedTenantId: input.expectedTenantId,
    actualTenantPresent: true,
    actualTenantIdPresent: true,
    actualTenantId: input.actualTenantId,
    tenantValidationStatus: status,
    status,
  };
}

export function validateLogoExecutionEnvironment(
  input: ValidateLogoExecutionEnvironmentInput,
): LogoExecutionEnvironmentGuardResult {
  const environment = normalizeEnvironment(input.env.LOGO_ISBASI_CREATE_ENVIRONMENT);
  const baseUrl = readString(input.env.LOGO_ISBASI_BASE_URL);
  const expectedTenantId = readString(input.env.LOGO_ISBASI_EXPECTED_TENANT_ID);
  const actualTenantId = readString(input.actualTenantId);
  const tenantValidation = buildTenantValidation({
    expectedTenantId,
    actualTenantId,
    deferTenantValidationUntilLogin: input.deferTenantValidationUntilLogin,
  });
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.env.LOGO_ISBASI_CREATE_ENABLED !== true) {
    blockers.push('LOGO_ISBASI_CREATE_ENABLED must be true before Logo invoice execution.');
  }

  if (!environment) {
    blockers.push('LOGO_ISBASI_CREATE_ENVIRONMENT must be test or production before Logo invoice execution.');
  }

  if (!baseUrl) {
    blockers.push('LOGO_ISBASI_BASE_URL is required before Logo invoice execution.');
  }

  if (!tenantValidation.expectedTenantConfigured) {
    warnings.push(TENANT_VALIDATION_SKIPPED_WARNING);
  }

  if (tenantValidation.status === 'blocked_missing_actual') {
    blockers.push('Logo tenant id was not returned by login response; cannot validate expected tenant.');
  }

  if (tenantValidation.status === 'blocked_mismatch') {
    blockers.push('Logo tenant mismatch. Authenticated Logo tenant does not match LOGO_ISBASI_EXPECTED_TENANT_ID.');
  }

  return {
    allowed: blockers.length === 0,
    environment,
    expectedTenantConfigured: tenantValidation.expectedTenantConfigured,
    actualTenantPresent: tenantValidation.actualTenantPresent,
    tenantValidationStatus: tenantValidation.tenantValidationStatus,
    tenantValidation,
    blockers,
    warnings,
  };
}
