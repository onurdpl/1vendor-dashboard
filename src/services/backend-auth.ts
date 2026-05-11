import { apiClient } from '../lib/api-client';

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
  token: string;
  user: BackendAuthUser;
};

export async function login(email: string, password: string) {
  return apiClient.post<BackendLoginResponse>('/auth/login', { email, password }, { vendorId: null });
}

export async function me(token: string) {
  const response = await apiClient.get<{ user: BackendAuthUser }>('/auth/me', {
    token,
    vendorId: null,
  });

  return response.user;
}
