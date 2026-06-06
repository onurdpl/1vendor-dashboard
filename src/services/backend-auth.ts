import { apiClient, clearCsrfToken, setCsrfToken } from '../lib/api-client';

export type BackendAuthVendorAccess = {
  vendorId: string;
  vendorName: string;
};

export type BackendAuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'vendor' | 'support' | 'finance';
  status: string;
  vendorAccess: BackendAuthVendorAccess[];
};

export type BackendLoginResponse = {
  user: BackendAuthUser;
  csrfToken?: string | null;
};

export async function login(
  email: string,
  password: string,
  options: { authAttemptId?: string; signal?: AbortSignal } = {},
) {
  const response = await apiClient.post<BackendLoginResponse>('/auth/login', { email, password }, {
    headers: options.authAttemptId ? { 'X-Auth-Attempt-Id': options.authAttemptId } : undefined,
    skipVendorContext: true,
    signal: options.signal,
  });
  setCsrfToken(response.csrfToken);
  return response;
}

export async function me(options: { signal?: AbortSignal } = {}) {
  const response = await apiClient.get<{ user: BackendAuthUser; csrfToken?: string | null }>('/auth/me', {
    vendorId: null,
    signal: options.signal,
  });
  setCsrfToken(response.csrfToken);

  return response.user;
}

export async function logout() {
  await apiClient.post<{ ok: true }>('/auth/logout', undefined, {
    skipVendorContext: true,
  });
  clearCsrfToken();
}
