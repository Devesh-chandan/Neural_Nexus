import api from './client';
import type {
  AccessTiersResponse,
  AnalyzeResponse,
  AuditResponse,
  BranchRoster,
  BrokerProvider,
  CaseResponse,
  ClientProfile,
  ClientRegistrationPayload,
  ClientRegistrationResponse,
  EmailCheckResponse,
  FinaliseResponse,
  FixItResponse,
  JurisdictionInfo,
  KycImportResponse,
  MarketHistoryResponse,
  ProductConfig,
  ProductDefaults,
  ProvidersResponse,
  RecommendationResult,
  RMSRegistrationPayload,
  RMSRegistrationResponse,
  RunResponse,
  UnderlyingsResponse,
} from '../types';

// ── Market ─────────────────────────────────────────────────────────────────

export async function fetchUnderlyings(): Promise<UnderlyingsResponse> {
  const { data } = await api.get<UnderlyingsResponse>('/underlyings');
  return data;
}

export async function fetchMarketHistory(
  key: string,
  years = 10
): Promise<MarketHistoryResponse> {
  const { data } = await api.get<MarketHistoryResponse>('/market/history', {
    params: { key, years },
  });
  return data;
}

export async function fetchProductDefaults(
  productType: string
): Promise<ProductDefaults> {
  const { data } = await api.get<ProductDefaults>(
    `/product-defaults/${productType}`
  );
  return data;
}

// ── Analysis ───────────────────────────────────────────────────────────────

export interface AnalyzeParams {
  product: ProductConfig;
  profile?: ClientProfile | null;
  include_monte_carlo?: boolean;
  case_id?: string | null;
}

export async function runAnalysis(params: AnalyzeParams): Promise<AnalyzeResponse> {
  const { data } = await api.post<AnalyzeResponse>('/analyze', params);
  return data;
}

export interface SuitabilityOnlyParams {
  product: ProductConfig;
  profile: ClientProfile;
}

export async function runSuitabilityOnly(params: SuitabilityOnlyParams) {
  const { data } = await api.post('/suitability', params);
  return data as {
    suitability: AnalyzeResponse['suitability'];
    data_source: string;
    as_of: string;
    snapshot_id: string;
  };
}

// ── Recommend ──────────────────────────────────────────────────────────────

export async function runRecommend(
  profile: ClientProfile,
  filters?: Record<string, unknown>
): Promise<RecommendationResult> {
  const { data } = await api.post<RecommendationResult>('/recommend', {
    profile,
    filters,
  });
  return data;
}

export async function runFixIt(
  product: ProductConfig,
  profile: ClientProfile
): Promise<FixItResponse> {
  const { data } = await api.post<FixItResponse>('/fixit', { product, profile });
  return data;
}

// ── Cases & Runs ───────────────────────────────────────────────────────────

export async function createCase(profile: ClientProfile): Promise<{ case_id: string; client_name: string }> {
  const { data } = await api.post('/cases', { profile });
  return data;
}

export async function fetchCases(): Promise<{ cases: Array<{ case_id: string; client_name: string; created_at: string; profile: ClientProfile }>; count: number }> {
  const { data } = await api.get('/cases');
  return data;
}

export async function fetchRMs(): Promise<{ rms: RMSRegistrationResponse[]; count: number }> {
  const { data } = await api.get('/registration/rms');
  return data;
}

export async function fetchCase(caseId: string): Promise<CaseResponse> {
  const { data } = await api.get<CaseResponse>(`/cases/${caseId}`);
  return data;
}

export async function fetchRun(runId: string): Promise<RunResponse> {
  const { data } = await api.get<RunResponse>(`/runs/${runId}`);
  return data;
}

export async function exportRunJson(runId: string): Promise<unknown> {
  const { data } = await api.get(`/runs/${runId}/export`, { params: { format: 'json' } });
  return data;
}

// ── Audit ──────────────────────────────────────────────────────────────────

export async function fetchAudit(runId: string): Promise<AuditResponse> {
  const { data } = await api.get<AuditResponse>(`/audit/${runId}`);
  return data;
}

export async function verifyAuditChain(): Promise<{ ok: boolean; detail: string; count: number }> {
  const { data } = await api.get('/audit/verify-chain');
  return data;
}

// ── Health ─────────────────────────────────────────────────────────────────

export async function fetchHealth(): Promise<{ status: string; version: string }> {
  const { data } = await api.get('/health');
  return data;
}

// ── KYC import ──────────────────────────────────────────────────────────────

export async function fetchKycProviders(): Promise<ProvidersResponse> {
  const { data } = await api.get<ProvidersResponse>('/kyc/providers');
  return data;
}

/**
 * Import KYC from an existing brokerage / wealth app.
 *
 * Returns a pre-fill only: identity and capacity fields arrive populated,
 * while the four PS-locked suitability answers and the source of funds must
 * still be supplied by the client.
 */
export async function importKyc(
  provider: BrokerProvider,
  handle: string
): Promise<KycImportResponse> {
  const { data } = await api.post<KycImportResponse>('/kyc/import', { provider, handle });
  return data;
}

// ── Client registration ─────────────────────────────────────────────────────

export async function registerClient(
  payload: ClientRegistrationPayload
): Promise<ClientRegistrationResponse> {
  const { data } = await api.post<ClientRegistrationResponse>('/registration/client', payload);
  return data;
}

export async function fetchRegisteredClient(caseId: string): Promise<{
  case_id: string;
  client_name: string;
  created_at: string;
  profile: ClientProfile;
}> {
  const { data } = await api.get(`/registration/client/${caseId}`);
  return data;
}

// ── RM registration & RBAC ─────────────────────────────────────────────────

export async function validateCorporateEmail(email: string): Promise<EmailCheckResponse> {
  const { data } = await api.post<EmailCheckResponse>('/registration/validate/email', { email });
  return data;
}

export async function fetchAccessTiers(): Promise<AccessTiersResponse> {
  const { data } = await api.get<AccessTiersResponse>('/registration/access-tiers');
  return data;
}

export async function fetchJurisdictions(): Promise<{ jurisdictions: JurisdictionInfo[] }> {
  const { data } = await api.get<{ jurisdictions: JurisdictionInfo[] }>(
    '/registration/jurisdictions'
  );
  return data;
}

export async function registerRelationshipManager(
  payload: RMSRegistrationPayload
): Promise<RMSRegistrationResponse> {
  const { data } = await api.post<RMSRegistrationResponse>('/registration/rm', payload);
  return data;
}

export async function fetchRM(rmId: string): Promise<RMSRegistrationResponse> {
  const { data } = await api.get(`/registration/rm/${rmId}`);
  return data;
}

export async function fetchBranchRoster(rmId: string): Promise<BranchRoster> {
  const { data } = await api.get<BranchRoster>(`/registration/rm/${rmId}/branch`);
  return data;
}

/**
 * Ask the backend whether this RM may configure a product type in their
 * jurisdiction. Server-side check – the UI never decides this.
 */
export async function checkProductAuthorised(
  rmId: string,
  productType: string
): Promise<{ allowed: boolean; product_type: string; jurisdiction: string; reason: string | null }> {
  const { data } = await api.post(`/registration/rm/${rmId}/product-check`, {
    rm_id: rmId,
    product_type: productType,
  });
  return data;
}

/** RBAC gate on confirming a product configuration. */
export async function finaliseConfiguration(
  rmId: string,
  runId: string,
  note?: string
): Promise<FinaliseResponse> {
  const { data } = await api.post<FinaliseResponse>(`/registration/rm/${rmId}/finalise`, {
    rm_id: rmId,
    run_id: runId,
    note,
  });
  return data;
}
