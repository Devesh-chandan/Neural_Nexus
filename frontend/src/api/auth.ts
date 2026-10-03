import api from './client';
import { requireSupabase } from '../lib/supabase';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthUser {
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
  case_id?: string;
  client_name?: string;
  email?: string;
  profile?: Record<string, unknown>;
  date_of_birth?: string;
  employment_status?: string;
  national_tax_id?: string | null;
  liquid_net_worth?: number;
  annual_income?: number;
  source_of_funds?: string | null;
  previous_investment_exposure_pct?: number;
  risk_appetite?: string;
  investment_horizon_years?: number;
  loss_tolerance_pct?: number;
  current_portfolio_concentration_pct?: number;
  experience?: string;
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

async function signIn(
  payload: LoginPayload,
  expectedRole: LoginResponse['role']
): Promise<LoginResponse> {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword(payload);
  if (error) throw error;
  if (!data.session) throw new Error('Supabase did not return an authenticated session.');

  const verified = await getMe(data.session.access_token);
  if (verified.role !== expectedRole) {
    await client.auth.signOut();
    throw new Error(`This account is registered for the ${verified.role} portal.`);
  }
  return { token: data.session.access_token, ...verified };
}

export const loginRM = (payload: LoginPayload) => signIn(payload, 'rm');
export const loginClient = (payload: LoginPayload) => signIn(payload, 'client');

export async function logout(): Promise<void> {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
}

export async function getMe(token: string): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}
