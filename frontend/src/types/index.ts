// ── Product configs ────────────────────────────────────────────────────────

export type ProductType = 'ELN' | 'CPN' | 'DCD';

export interface ELNConfig {
  product_type: 'ELN';
  underlying: string;
  tenor_months: number;
  principal: number;
  currency: string;
  barrier_pct: number;
  coupon_pa: number;
  coupon_conditional: boolean;
  barrier_monitoring: 'maturity' | 'daily';
}

export interface CPNConfig {
  product_type: 'CPN';
  underlying: string;
  tenor_months: number;
  principal: number;
  currency: string;
  protection_pct: number;
  participation_pct: number;
  cap_pct: number | null;
}

export interface DCDConfig {
  product_type: 'DCD';
  underlying: string;
  tenor_months: number;
  principal: number;
  currency: string;
  strike: number;
  interest_pa: number;
  base_currency: string;
  alt_currency: string;
}

export type ProductConfig = ELNConfig | CPNConfig | DCDConfig;

// ── Client profile ─────────────────────────────────────────────────────────

export type RiskAppetite = 'conservative' | 'moderate' | 'aggressive';
export type Experience = 'novice' | 'intermediate' | 'experienced';

export interface ClientProfile {
  client_name: string;
  risk_appetite: RiskAppetite;
  horizon_months: number;
  loss_tolerance_pct: number;
  investable_assets: number;
  investment_amount: number;
  existing_exposure_underlying_pct: number;
  existing_structured_pct: number;
  experience: Experience;
  target_return_pa?: number | null;
  preferred_underlying_types?: string[] | null;
  needs_liquidity_within_months?: number | null;
}

// ── Market data ────────────────────────────────────────────────────────────

export interface UnderlyingMeta {
  key: string;
  ticker: string;
  display_name: string;
  asset_class: string;
  type: string;
  currency: string;
  sector: string;
  latest_price: number | null;
  data_source: string;
  as_of: string | null;
  snapshot_id: string | null;
  vol_1y: number | null;
}

export interface UnderlyingsResponse {
  underlyings: UnderlyingMeta[];
  disclaimer: string;
}

export interface PricePoint {
  date: string;
  close: number;
}

export interface MarketHistoryResponse {
  key: string;
  series: PricePoint[];
  vol: { ewma: number | null; realised_1y: number | null };
  data_source: string;
  as_of: string;
  snapshot_id: string;
  disclaimer: string;
}

// ── Analysis / Metrics ─────────────────────────────────────────────────────

export type RuleStatus = 'GREEN' | 'AMBER' | 'RED';
export type Verdict = 'SUITABLE' | 'CONDITIONALLY_SUITABLE' | 'NOT_SUITABLE';

export interface ScenarioRow {
  shock: number;
  x: number;
  final: number;
  net_return: number;
  annualised_return: number;
  label: string;
  is_ps_scenario: boolean;
}

export interface CrisisPreset {
  name: string;
  label: string;
  start_date?: string | null;
  end_date?: string | null;
  x?: number | null;
  final?: number | null;
  net_return?: number | null;
  annualised_return?: number | null;
  breach?: boolean | null;
  available: boolean;
}

export interface HistogramBin {
  bin_start: number;
  bin_end: number;
  count: number;
  frequency: number;
}

export interface ReplayResult {
  n_windows: number;
  n_independent: number;
  p_loss: number;
  breach_frequency: number;
  worst_loss_pct: number;
  median_annualised_return: number;
  cvar5_loss_pct: number;
  crisis_presets: CrisisPreset[];
  histogram: HistogramBin[];
}

export interface MonteCarloResult {
  n_paths: number;
  seed: number;
  fan_percentiles: number[];
  fan_x_points: number[];
  fan_paths: number[][];
  p_loss: number;
  breach_frequency: number;
  worst_loss_pct: number;
  median_annualised_return: number;
  cvar5_loss_pct: number;
  histogram: HistogramBin[];
}

export interface VolatilityInfo {
  ewma: number;
  realised_1y: number;
}

export interface FDBaseline {
  rate_pa: number;
  final: number;
  annualised_return: number;
}

export interface CliffInfo {
  x_level: number;
  loss_jump_pct_points: number;
}

export interface PricingInfo {
  indicative: number;
  flag: 'ok' | 'coupon_above_indicative';
  label: string;
}

export interface PayoffPoint {
  x: number;
  final: number;
  net_return: number;
}

export interface MetricsBundle {
  max_gain_pct: number;
  max_loss_pct: number;
  break_even_x: number | null;
  scenario_table: ScenarioRow[];
  stress_loss_pct: number;
  replay: ReplayResult | null;
  monte_carlo: MonteCarloResult | null;
  volatility: VolatilityInfo;
  fd_baseline: FDBaseline;
  payoff_curve: PayoffPoint[];
  cliff: CliffInfo | null;
  pricing: PricingInfo;
}

export interface AnalyzeResponse {
  run_id: string;
  metrics: MetricsBundle;
  suitability?: SuitabilityResult | null;
  explanation?: ExplanationResult | null;
  data_source: string;
  as_of: string;
  snapshot_id: string;
  disclaimer: string;
}

// ── Suitability ────────────────────────────────────────────────────────────

export interface RuleResult {
  rule_id: string;
  dimension: string;
  status: RuleStatus;
  severity: number;
  message_key: string;
  message: string;
  facts: Record<string, unknown>;
}

export interface ScoreDriver {
  rule_id: string;
  dimension: string;
  points_deducted: number;
  status: RuleStatus;
}

export interface SummaryFlags {
  p_loss: RuleStatus;
  worst_case: RuleStatus;
  tail_loss: RuleStatus;
  horizon: RuleStatus;
  concentration: RuleStatus;
  appetite: RuleStatus;
  complexity: RuleStatus;
}

export interface SuitabilityResult {
  verdict: Verdict;
  score: number;
  score_drivers: ScoreDriver[];
  rules: RuleResult[];
  tier: number;
  mismatches: RuleResult[];
  summary_flags: SummaryFlags;
}

// ── Explanation ────────────────────────────────────────────────────────────

export interface ExplanationResult {
  client_text: string;
  rm_text: string;
  source: string;
  model: string | null;
  prompt_version: string;
  fallback_reason?: string | null;
  validation?: {
    passed: boolean;
    checks: Array<{ check_name: string; passed: boolean; detail?: string | null }>;
  };
}

// ── Recommendation ─────────────────────────────────────────────────────────

export interface ComparisonRow {
  product_type: string;
  underlying: string;
  key_params: Record<string, unknown>;
  verdict: Verdict;
  score: number;
  p_loss: number;
  cvar5: number;
  median_annualised_return: number;
  indicative_flag: string;
  fit_score: number;
  rejected_reasons: string[];
  rank: number;
}

export interface ProductCandidate {
  product_type: string;
  run_id: string;
  config: Record<string, unknown>;
  metrics_summary: Record<string, unknown>;
  suitability?: Record<string, unknown> | null;
  fit_score: number;
  verdict: Verdict;
  is_suitable: boolean;
  rejected_reasons: string[];
  rejection_note?: string | null;
}

export interface RecommendationResult {
  recommendation_id: string;
  best?: ProductCandidate | null;
  ranking: ProductCandidate[];
  comparison_table: ComparisonRow[];
  rationale_text?: string | null;
  disclaimer: string;
  data_source: string;
  as_of: string;
}

export interface FixItSuggestion {
  change_description: string;
  new_config: Record<string, unknown>;
  new_verdict: Verdict;
  new_score: number;
  tradeoff: string;
}

export interface FixItResponse {
  original_verdict: Verdict;
  original_score: number;
  suggestions: FixItSuggestion[];
  label: string;
}

// ── Cases / Runs ───────────────────────────────────────────────────────────

export interface CaseResponse {
  case_id: string;
  client_name: string;
  profile: ClientProfile;
  created_at: string;
  latest_recommendation_id?: string | null;
}

export interface RunResponse {
  run_id: string;
  case_id?: string | null;
  product: ProductConfig;
  metrics: MetricsBundle;
  suitability?: SuitabilityResult | null;
  explanation?: ExplanationResult | null;
  data_source: string;
  as_of: string;
  snapshot_id: string;
  created_at: string;
  disclaimer: string;
}

// ── Audit ──────────────────────────────────────────────────────────────────

export interface AuditRecord {
  run_id: string;
  verdict: Verdict;
  data_source: string;
  snapshot_id: string;
  record_hash: string;
  prev_hash: string | null;
  payload: Record<string, unknown>;
  model: string;
  prompt_version: string;
  created_at: string;
}

export interface AuditResponse {
  record: AuditRecord;
  chain_ok: boolean;
  verify_detail: string;
}

// ── Product defaults ───────────────────────────────────────────────────────

export interface ProductDefaults {
  product_type: string;
  defaults: Record<string, unknown>;
  bounds: Record<string, unknown>;
  grids: Record<string, unknown>;
  complexity: number;
}

// ── API error ──────────────────────────────────────────────────────────────

export interface ApiError {
  status: number;
  error_code: string;
  detail: string;
}
