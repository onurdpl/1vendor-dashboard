export type ApiErrorKind = 'network' | 'unauthorized' | 'server' | 'invalid-response';

export type ApiErrorDiagnostics = {
  endpoint: string;
  status: number | null;
  requestId: string | null;
  hasAuthHeader: boolean;
  hasVendorHeader: boolean;
  selectedVendorPresent: boolean;
  readinessState: string;
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly details?: unknown;
  readonly diagnostics?: ApiErrorDiagnostics;

  constructor(
    message: string,
    kind: ApiErrorKind,
    options: { status?: number; details?: unknown; diagnostics?: ApiErrorDiagnostics } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status;
    this.details = options.details;
    this.diagnostics = options.diagnostics;
  }
}

export function getApiErrorDiagnostics(error: unknown) {
  return error instanceof ApiError ? error.diagnostics ?? null : null;
}
