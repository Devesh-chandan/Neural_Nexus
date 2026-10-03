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
  age_years?: number | null;

  // KYC & identity (set by client registration)
  date_of_birth?: string | null;
  employment_status?: EmploymentStatus | null;
  national_tax_id?: string | null;
  kyc_verified?: boolean;
  kyc_source?: KycSource | null;
  kyc_provider?: string | null;

  // Financial capacity (set by client registration)
  liquid_net_worth?: number | null;
  annual_income?: number | null;
  source_of_funds?: SourceOfFunds | null;
  previous_investment_exposure_pct?: number | null;
}

// ── KYC & client registration ───────────────────────────────────────────────

export type EmploymentStatus =
  | 'salaried'
  | 'self_employed'
  | 'business_owner'
  | 'professional'
  | 'student'
  | 'retired'
  | 'homemaker'
  | 'not_specified';

export type SourceOfFunds =
  | 'salary'
  | 'business_income'
  | 'freelance'
  | 'investment_proceeds'
  | 'property_sale'
  | 'inheritance'
  | 'business_sale'
  | 'gift'
  | 'loan'
  | 'other';

export type BrokerProvider = 'kite' | 'zerodha_console' | 'groww' | 'cred';
export type KycSource = 'manual' | 'broker_import';

export interface KYCIdentity {
  legal_name: string;
  date_of_birth: string;
  employment_status: EmploymentStatus;
  national_tax_id: string | null;
}

export interface KYCFinancials {
  liquid_net_worth: number;
  annual_income: number;
  source_of_funds: SourceOfFunds | null;
  previous_investment_exposure_pct: number;
  investment_amount: number;
}

/** The four PS-locked questions. Every one of them is mandatory. */
export interface SuitabilityAnswers {
  risk_appetite: RiskAppetite;
  investment_horizon_years: number;
  loss_tolerance_pct: number;
  current_portfolio_concentration_pct: number;
  experience: Experience;
}

export interface BrokerLinkPayload {
  provider: BrokerProvider;
  handle: string;
}

export interface ClientRegistrationPayload {
  identity: KYCIdentity;
  financials: KYCFinancials;
  suitability: SuitabilityAnswers;
  broker_link: BrokerLinkPayload | null;
  consent_kyc: boolean;
  consent_sof: boolean;
}

export interface ClientRegistrationResponse {
  case_id: string;
  client_name: string;
  kyc_source: KycSource;
  kyc_verified: boolean;
  kyc_flags: string[];
  age_years: number;
  profile: ClientProfile;
  next_step: string;
}

export interface ProviderInfo {
  key: BrokerProvider;
  label: string;
  category: string;
  auth: string;
  scopes: string[];
  notes: string;
}

export interface ProvidersResponse {
  providers: ProviderInfo[];
  disclaimer: string;
}

export interface KycImportResponse {
  provider: BrokerProvider;
  provider_label: string;
  handle_masked: string;
  linked_at: string;
  scope_granted: string[];
  identity: Record<string, unknown>;
  financials: Record<string, unknown>;
  kyc_verified: boolean;
  kyc_flags: string[];
  fields_prefilled: string[];
  fields_still_required: string[];
  disclaimer: string;
}

// ── RM registration & RBAC ──────────────────────────────────────────────────

export type AccessTier = 'junior_rm' | 'senior_advisor' | 'branch_manager';

export type Jurisdiction = 'IN' | 'US' | 'UK' | 'AE' | 'SG' | 'EU' | 'HK' | 'AU';

export interface RMSIdentity {
  legal_name: string;
  corporate_email: string;
  employee_id: string;
}

export interface RMSCompliance {
  regulatory_registration_number: string;
  operating_jurisdiction: Jurisdiction;
  product_types_authorised: string[];
}

export interface RMSAccess {
  institution: string;
  branch_code: string;
  department: string | null;
  access_tier: AccessTier;
}

export interface RMSRegistrationPayload {
  identity: RMSIdentity;
  compliance: RMSCompliance;
  access: RMSAccess;
  password: string;
}

export interface RbacSummary {
  access_tier: AccessTier;
  access_tier_label: string;
  permissions: string[];
  permission_labels: Record<string, string>;
  can_finalise: boolean;
  finalise_blocked_reason: string | null;
  permitted_product_types: string[];
  jurisdiction_label: string;
  regulator: string;
}

export interface RMSRegistrationResponse {
  rm_id: string;
  legal_name: string;
  corporate_email: string;
  email_domain: string;
  employee_id: string;
  institution: string;
  branch_code: string;
  department: string | null;
  access_tier: AccessTier;
  regulatory_registration_number: string;
  operating_jurisdiction: Jurisdiction;
  authorised_product_types: string[];
  rbac: RbacSummary;
  registered_at: string;
  next_step: string;
}

export interface AccessTierInfo {
  key: AccessTier;
  label: string;
  rank: number | null;
  description: string;
  escalate_to: string | null;
  permissions: string[];
  can_finalise: boolean;
  finalise_blocked_reason: string | null;
  permission_labels: Record<string, string>;
}

export interface AccessTiersResponse {
  tiers: AccessTierInfo[];
  permission_vocabulary: string[];
}

export interface JurisdictionInfo {
  code: Jurisdiction;
  label: string;
  regulator: string;
  currency: string;
  permitted_product_types: string[];
  registration_number_label: string;
  registration_number_example?: string | null;
}

export interface EmailCheckResponse {
  email: string;
  accepted: boolean;
  domain: string | null;
  is_public_provider: boolean;
  message: string;
}

export interface FinaliseResponse {
  allowed: boolean;
  rm_id: string;
  run_id: string;
  access_tier: AccessTier;
  reason: string | null;
  escalate_to: string | null;
  finalised_at: string | null;
}

export interface BranchRoster {
  institution: string;
  branch_code: string;
  count: number;
  members: Array<{
    rm_id: string;
    legal_name: string;
    employee_id: string;
    access_tier: AccessTier;
    department: string | null;
    operating_jurisdiction: string;
    created_at: string;
  }>;
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
  life_stage: RuleStatus;
  affordability: RuleStatus;
  kyc_aml: RuleStatus;
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

// ── Historical simulation (module2_simulation_engine) ─────────────────────

export interface HistoricalScenario {
  id: number;
  situation: string;
  period: { start: string; end: string };
  market_move_pct: number;
  barrier_hit: boolean;
  money_back: number;
  return_pct: number;
  story: string;
}

export interface SimulationWarning {
  code: string;
  message: string;
}

export interface HistoricalSimulationResult {
  run_id: string;
  product_id: string;
  data_as_of: string;
  currency: string;
  scenarios: HistoricalScenario[];
  warnings: SimulationWarning[];
  audit: {
    engine_version: string;
    market_data: { fingerprint: string; [key: string]: unknown };
    [key: string]: unknown;
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

// ── Module 3: suitability assessment on Module 2's historical replay (POST /api/assess) ──

export type AssessmentStatus = 'SUITABLE' | 'REVIEW_REQUIRED' | 'NOT_SUITABLE';
export type CheckStatus = 'PASS' | 'REVIEW' | 'FAIL';
export type AssessmentCheckKey = 'risk_appetite' | 'investment_horizon' | 'loss_tolerance' | 'concentration_risk';

export interface AssessmentChecks {
  risk_appetite: {
    status: CheckStatus;
    client_limit_category: string;
    product_value_category: string;
    structural_category: string;
    historical_category: string;
    worst_simulated_return_pct: number;
    reason: string;
  };
  investment_horizon: { status: CheckStatus; client_limit_years: number; product_value_years: number; reason: string };
  loss_tolerance: { status: CheckStatus; client_limit_pct: number; product_value_pct: number; reason: string };
  concentration_risk: { status: CheckStatus; client_limit_pct: number; product_value_pct: number | null; reason: string };
}

export interface SuitabilityAssessment {
  assessment_id: string;
  client_id: string;
  product_id: string;
  simulation_run_id: string;
  timestamp: string;
  overall_status: AssessmentStatus;
  checks: AssessmentChecks;
  /** RM responses only. */
  compliance_flags?: Record<string, { status: CheckStatus; reason: string }>;
  /** Client responses only (compliance detail is withheld from clients). */
  additional_checks_required?: boolean;
  audit_meta: { engine_version: string; rule_set_version: string; note: string };
}

interface AssessmentExplanationBase {
  headline: string;
  summary: string;
  checks: Record<AssessmentCheckKey, string>;
  source: 'llm' | 'template';
  fallback_reason: string | null;
}

export interface ClientAssessmentExplanation extends AssessmentExplanationBase {
  next_steps: string[];
}

export interface RMAssessmentExplanation extends AssessmentExplanationBase {
  compliance: string;
  actions: string[];
}

export interface AssessmentResponse {
  assessment: SuitabilityAssessment;
  simulation: HistoricalSimulationResult;
  data_gaps: string[];
  explanation: {
    client: ClientAssessmentExplanation;
    /** RM responses only. */
    rm?: RMAssessmentExplanation;
    model: string | null;
    prompt_version: string;
  } | null;
  disclaimer: string;
}
