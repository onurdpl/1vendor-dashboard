const REDACTED = '[redacted]';
const MAX_DEPTH = 8;
const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|x-csrf-token|csrf|password|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|secret|email|phone|address/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;

function redactString(value: string) {
  return value
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(PHONE_PATTERN, REDACTED);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return '[truncated]';
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          return [key, item ? REDACTED : item];
        }
        return [key, sanitizeValue(item, depth + 1)];
      }),
    );
  }

  return value;
}

export function sanitizeSentryData<T>(value: T): T {
  return sanitizeValue(value, 0) as T;
}
