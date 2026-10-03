import api from './client';
import type {
  AnalyzeResponse,
  AuditResponse,
  CaseResponse,
  ClientProfile,
  FixItResponse,
  MarketHistoryResponse,
  ProductConfig,
  ProductDefaults,
  RecommendationResult,
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
