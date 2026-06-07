type FetchLike = typeof fetch;

export type LogoIsbasiClientConfig = {
  baseUrl: string;
  apiKey: string;
  username: string;
  password: string;
  fetchImpl?: FetchLike;
};

export type LogoIsbasiSessionExtraction = {
  accessToken: string | null;
  tenantId: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  accessTokenPresent: boolean;
  tenantIdPresent: boolean;
  userIdPresent: boolean;
  userEmailPresent: boolean;
  userNamePresent: boolean;
  missing: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNestedString(source: unknown, path: string[]) {
  let cursor = source;
  for (const segment of path) {
    if (!isRecord(cursor)) {
      return null;
    }
    cursor = cursor[segment];
  }
  return typeof cursor === 'string' && cursor.trim() ? cursor.trim() : null;
}

function readFirstString(source: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = readNestedString(source, path);
    if (value) {
      return value;
    }
  }
  return null;
}

function readBooleanLike(source: unknown, key: string) {
  if (!isRecord(source)) {
    return undefined;
  }
  const value = source[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readCodeLike(source: unknown) {
  if (!isRecord(source)) {
    return undefined;
  }
  const value = source.code;
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

function sanitizeText(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  return value
    .replace(/((?:access|refresh)?token|password|secret|api[_-]?key|authorization)\s*[:=]\s*[^&\s,}]+/gi, '$1=[redacted]')
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, '[redacted-token]')
    .slice(0, 500);
}

function tokenPreview(value: string | null) {
  if (!value) {
    return undefined;
  }
  if (value.length <= 10) {
    return `${value.slice(0, 2)}...${value.slice(-2)}`;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function extractSessionFromLoginResponse(raw: unknown): LogoIsbasiSessionExtraction {
  const accessToken = readFirstString(raw, [['data', 'accessToken'], ['data', 'access_token'], ['accessToken'], ['access_token']]);
  const tenantId = readFirstString(raw, [['data', 'tenantId'], ['tenantId']]);
  const userId = readFirstString(raw, [['data', 'userId'], ['userId']]);
  const userEmail = readFirstString(raw, [['data', 'userEmail'], ['userEmail']]);
  const userName = readFirstString(raw, [['data', 'userName'], ['userName']]);
  const missing: string[] = [];

  if (!accessToken) {
    missing.push('accessToken');
  }
  if (!tenantId) {
    missing.push('tenantId');
  }

  return {
    accessToken,
    tenantId,
    userId,
    userEmail,
    userName,
    accessTokenPresent: Boolean(accessToken),
    tenantIdPresent: Boolean(tenantId),
    userIdPresent: Boolean(userId),
    userEmailPresent: Boolean(userEmail),
    userNamePresent: Boolean(userName),
    missing,
  };
}

export function sanitizeLoginResponse(raw: unknown) {
  const session = extractSessionFromLoginResponse(raw);

  return {
    ok: readBooleanLike(raw, 'ok'),
    isError: readBooleanLike(raw, 'isError'),
    code: readCodeLike(raw),
    message: isRecord(raw) ? sanitizeText(raw.message) : undefined,
    responseKeys: isRecord(raw) ? Object.keys(raw).sort() : [],
    accessTokenPresent: session.accessTokenPresent,
    tenantIdPresent: session.tenantIdPresent,
    userIdPresent: session.userIdPresent,
    userEmailPresent: session.userEmailPresent,
    userNamePresent: session.userNamePresent,
    tokenPreview: tokenPreview(session.accessToken),
  };
}

export class LogoIsbasiClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: LogoIsbasiClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async login() {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const response = await this.fetchImpl(`${baseUrl}/api/v1.0/user/integrationLogin`, {
      method: 'POST',
      headers: {
        apiKey: this.config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
      }),
    });

    const rawText = await response.text();
    let body: unknown = null;
    if (rawText) {
      try {
        body = JSON.parse(rawText);
      } catch {
        body = { message: 'Logo İşbaşı login returned a non-JSON response.' };
      }
    }

    return {
      status: response.status,
      ok: response.ok,
      body,
    };
  }
}
