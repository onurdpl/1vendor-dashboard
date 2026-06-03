import type { FastifyRequest } from 'fastify';

export const SESSION_COOKIE_NAME = 'sporgym_session';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const COOKIE_PATH = '/';

function readCookieHeader(request: FastifyRequest | { headers?: Record<string, unknown> }) {
  const cookie = request.headers?.cookie;
  return Array.isArray(cookie) ? cookie[0] ?? '' : typeof cookie === 'string' ? cookie : '';
}

export function parseCookies(request: FastifyRequest | { headers?: Record<string, unknown> }) {
  const entries = readCookieHeader(request)
    .split(';')
    .map((entry: string) => entry.trim())
    .filter(Boolean);
  const cookies = new Map<string, string>();

  for (const entry of entries) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const name = entry.slice(0, separatorIndex).trim();
    const rawValue = entry.slice(separatorIndex + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      cookies.set(name, rawValue);
    }
  }

  return cookies;
}

export function getSessionCookieToken(request: FastifyRequest | { headers?: Record<string, unknown> }) {
  return parseCookies(request).get(SESSION_COOKIE_NAME)?.trim() || null;
}

function serializeCookie(input: {
  name: string;
  value: string;
  maxAgeSeconds: number;
  httpOnly?: boolean;
  secure: boolean;
}) {
  const attributes = [
    `${input.name}=${encodeURIComponent(input.value)}`,
    `Max-Age=${Math.max(0, Math.floor(input.maxAgeSeconds))}`,
    `Path=${COOKIE_PATH}`,
    'SameSite=Lax',
  ];

  if (input.httpOnly) {
    attributes.push('HttpOnly');
  }

  if (input.secure) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

export function createSessionCookie(token: string, maxAgeSeconds: number, secure: boolean) {
  return serializeCookie({
    name: SESSION_COOKIE_NAME,
    value: token,
    maxAgeSeconds,
    httpOnly: true,
    secure,
  });
}

export function createClearSessionCookie(secure: boolean) {
  return serializeCookie({
    name: SESSION_COOKIE_NAME,
    value: '',
    maxAgeSeconds: 0,
    httpOnly: true,
    secure,
  });
}
