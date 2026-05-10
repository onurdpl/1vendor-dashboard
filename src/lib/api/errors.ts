export type ApiErrorKind = 'network' | 'unauthorized' | 'server' | 'invalid-response';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly details?: unknown;

  constructor(message: string, kind: ApiErrorKind, options: { status?: number; details?: unknown } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status;
    this.details = options.details;
  }
}
