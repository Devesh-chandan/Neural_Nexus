// Auth API calls.
import api from './client';

export interface RMLoginPayload {
  corporate_email: string;
  employee_id: string;
}

export interface ClientLoginPayload {
  email: string;
  password: string;
}

export interface AuthUser {
  // RM fields
  rm_id?: string;
  legal_name?: string;
  corporate_email?: string;
  employee_id?: string;
  institution?: string;
  branch_code?: string;
  department?: string | null;
  access_tier?: string;
  operating_jurisdiction?: string;
  authorised_product_types?: string[];
  rbac?: Record<string, unknown>;
  // Client fields
  account_id?: string;
  case_id?: string;
  client_name?: string;
  email?: string;
  profile?: Record<string, unknown>;
}

export interface LoginResponse {
  token: string;
  role: 'rm' | 'client';
  user: AuthUser;
}

export interface MeResponse {
  role: 'rm' | 'client';
  user: AuthUser;
}

export async function loginRM(payload: RMLoginPayload): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/rm/login', payload);
  return data;
}

export async function loginClient(payload: ClientLoginPayload): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/client/login', payload);
  return data;
}

export async function logout(token: string): Promise<void> {
  await api.post('/auth/logout', {}, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getMe(token: string): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}
