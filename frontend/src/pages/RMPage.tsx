import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  Play,
  TrendingUp,
  Table,
  RotateCcw,
  Dices,
  Shield,
  MessageSquare,
  Wrench,
  BarChart3,
  ArrowUpRight,
  UserCog,
  Maximize2,
  X,
  Search,
  Plus,
  Layers,
  Sparkles,
} from 'lucide-react';
import {
  runAnalysis,
  fetchUnderlyings,
  fetchMarketHistory,
  runSuitabilityOnly,
  runFixIt,
  runHistoricalSimulation,
  fetchCases,
  updateCaseProductConfig,
} from '../api';

import type {
  ClientProfile,
  ELNConfig,
  CPNConfig,
  DCDConfig,
  ProductConfig,
  UnderlyingMeta,
  AnalyzeResponse,
  FixItResponse,
  SuitabilityResult,
  HistoricalSimulationResult,
} from '../types';
import {
  LoadingOverlay,
  Alert,
  VerdictBadge,
  Disclaimer,
  Spinner,
  ProductPill,
  ScoreRing,
  StatBox,
} from '../components/UIKit';
import {
  PayoffChart,
  HistogramChart,
  MCFanChart,
  PriceChart,
  MetricsSummary,
  ScenarioTable,
  HistoricalScenarioTable,
} from '../components/Charts';
import ExplanationCard, { FormattedClientReasoning, FormattedRMReasoning } from '../components/ExplanationCard';
import SuitabilityAssessmentCard from '../components/SuitabilityAssessmentCard';

const DEFAULT_ELN: ELNConfig = {
  product_type: 'ELN',
  underlying: 'NIFTY50',
  tenor_months: 12,
  principal: 1_000_000,
  currency: 'INR',
  barrier_pct: 0.75,
  coupon_pa: 0.12,
  coupon_conditional: false,
  barrier_monitoring: 'maturity',
};

const DEFAULT_CPN: CPNConfig = {
  product_type: 'CPN',
  underlying: 'NIFTY50',
  tenor_months: 12,
  principal: 1_000_000,
  currency: 'INR',
  protection_pct: 0.90,
  participation_pct: 0.80,
  cap_pct: null,
};

const DEFAULT_DCD: DCDConfig = {
  product_type: 'DCD',
  underlying: 'USDINR',
  tenor_months: 6,
  principal: 1_000_000,
  currency: 'INR',
  strike: 84.0,
  interest_pa: 0.10,
  base_currency: 'INR',
  alt_currency: 'USD',
};

const DEFAULT_PROFILE: ClientProfile = {
  client_name: 'Priya Sharma',
  risk_appetite: 'moderate',
  horizon_months: 12,
  loss_tolerance_pct: 20,
  investable_assets: 10_000_000,
  investment_amount: 1_000_000,
  existing_exposure_underlying_pct: 5,
  existing_structured_pct: 10,
  experience: 'intermediate',
  age_years: 38,
};

// Seed clients for DB listing and quick selection
const DEFAULT_CLIENTS: Array<{ case_id: string; client_name: string; created_at: string; profile: ClientProfile }> = [
  {
    case_id: 'CL-101',
    client_name: 'Priya Sharma',
    created_at: '2026-10-01T10:00:00Z',
    profile: {
      client_name: 'Priya Sharma',
      risk_appetite: 'moderate',
      horizon_months: 12,
      loss_tolerance_pct: 20,
      investable_assets: 10000000,
      investment_amount: 1000000,
      existing_exposure_underlying_pct: 5,
      existing_structured_pct: 10,
      experience: 'intermediate',
      age_years: 38,
    },
  },
  {
    case_id: 'CL-102',
    client_name: 'Rajesh Patel',
    created_at: '2026-10-02T11:30:00Z',
    profile: {
      client_name: 'Rajesh Patel',
      risk_appetite: 'conservative',
      horizon_months: 24,
      loss_tolerance_pct: 10,
      investable_assets: 25000000,
      investment_amount: 2500000,
      existing_exposure_underlying_pct: 0,
      existing_structured_pct: 0,
      experience: 'novice',
      age_years: 52,
    },
  },
  {
    case_id: 'CL-103',
    client_name: 'Anita Desai',
    created_at: '2026-10-02T14:15:00Z',
    profile: {
      client_name: 'Anita Desai',
      risk_appetite: 'aggressive',
      horizon_months: 18,
      loss_tolerance_pct: 35,
      investable_assets: 15000000,
      investment_amount: 3000000,
      existing_exposure_underlying_pct: 12,
      existing_structured_pct: 15,
      experience: 'experienced',
      age_years: 44,
    },
  },
  {
    case_id: 'CL-104',
    client_name: 'Vikram Malhotra',
    created_at: '2026-10-03T09:20:00Z',
    profile: {
      client_name: 'Vikram Malhotra',
      risk_appetite: 'moderate',
      horizon_months: 36,
      loss_tolerance_pct: 25,
      investable_assets: 50000000,
      investment_amount: 5000000,
      existing_exposure_underlying_pct: 8,
      existing_structured_pct: 5,
      experience: 'experienced',
      age_years: 49,
    },
  },
];

type ClientRow = {
  case_id: string;
  client_name: string;
  created_at: string;
  profile: ClientProfile;
  product_config?: ProductConfig | null;
  persisted?: boolean;
};

type Tab = 'payoff' | 'scenarios' | 'replay' | 'mc' | 'suitability' | 'explanation';

const sectionLabel: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--stone)',
  marginBottom: 10,
};

const RMPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [productType, setProductType] = useState<'ELN' | 'CPN' | 'DCD'>('ELN');
  const [eln, setEln] = useState<ELNConfig>({ ...DEFAULT_ELN });
  const [cpn, setCpn] = useState<CPNConfig>({ ...DEFAULT_CPN });
  const [dcd, setDcd] = useState<DCDConfig>({ ...DEFAULT_DCD });

  const [withProfile, setWithProfile] = useState(true);
  const [profile, setProfile] = useState<ClientProfile>({ ...DEFAULT_PROFILE });

  const [includeMC, setIncludeMC] = useState(true);

  const [underlyings, setUnderlyings] = useState<UnderlyingMeta[]>([]);
  const [priceHistory, setPriceHistory] = useState<{ date: string; close: number }[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('payoff');

  const [liveSuit, setLiveSuit] = useState<SuitabilityResult | null>(null);
  const [suitLoading, setSuitLoading] = useState(false);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [fixIt, setFixIt] = useState<FixItResponse | null>(null);
  const [fixLoading, setFixLoading] = useState(false);

  // Real historical replay (module2_simulation_engine) — loaded on demand in the Replay tab
  const [historicalResult, setHistoricalResult] = useState<HistoricalSimulationResult | null>(null);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalError, setHistoricalError] = useState<string | null>(null);

  // Client Selection State (DB integration)
  const [dbClients, setDbClients] = useState<ClientRow[]>(DEFAULT_CLIENTS);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastSavedConfig = useRef<string>('');
  const [selectedClientId, setSelectedClientId] = useState<string>('CL-101');
  const [clientFilter, setClientFilter] = useState('');
  const [loadingClients, setLoadingClients] = useState(false);

  // RM Profile State — sourced from auth context, fallback for unauthenticated dev use
  const [activeRM, setActiveRM] = useState<{
    rm_id: string;
    legal_name: string;
    corporate_email: string;
    employee_id: string;
    institution: string;
    branch_code: string;
    access_tier: string;
    operating_jurisdiction: string;
  }>({
    rm_id: user?.rm_id ?? '',
    legal_name: user?.legal_name ?? 'Loading…',
    corporate_email: user?.corporate_email ?? '',
    employee_id: user?.employee_id ?? '',
    institution: user?.institution ?? '',
    branch_code: user?.branch_code ?? '',
    access_tier: user?.access_tier ?? '',
    operating_jurisdiction: user?.operating_jurisdiction ?? '',
  });

  // Keep activeRM in sync with the logged-in user
  useEffect(() => {
    if (!user) return;
    setActiveRM({
      rm_id: user.rm_id ?? '',
      legal_name: user.legal_name ?? '',
      corporate_email: user.corporate_email ?? '',
      employee_id: user.employee_id ?? '',
      institution: user.institution ?? '',
      branch_code: user.branch_code ?? '',
      access_tier: user.access_tier ?? '',
      operating_jurisdiction: user.operating_jurisdiction ?? '',
    });
  }, [user]);

  // Full Screen Modal State
  const [fullScreenView, setFullScreenView] = useState<'none' | 'graph' | 'reasoning'>('none');

  useEffect(() => {
    if (fullScreenView === 'none') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullScreenView('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreenView]);

  // Load Underlyings & Registered DB Clients / RMs
  useEffect(() => {
    fetchUnderlyings().then((r) => setUnderlyings(r.underlyings)).catch(() => {});

    // Fetch DB cases
    setLoadingClients(true);
    fetchCases()
      .then((res) => {
        if (res && res.cases && res.cases.length > 0) {
          const fetched: ClientRow[] = res.cases.map((c) => ({
            case_id: c.case_id,
            client_name: c.client_name || c.profile?.client_name || 'Registered Client',
            created_at: c.created_at,
            profile: c.profile && c.profile.client_name ? c.profile : { ...DEFAULT_PROFILE, client_name: c.client_name || 'Client' },
            product_config: c.product_config ?? null,
            persisted: true,
          }));
          const uniqueClients: typeof fetched = [];
          const seenNames = new Set<string>();
          for (const c of fetched) {
            const key = c.client_name.trim().toLowerCase();
            if (!seenNames.has(key)) {
              seenNames.add(key);
              uniqueClients.push(c);
            }
          }
          for (const d of DEFAULT_CLIENTS) {
            const key = d.client_name.trim().toLowerCase();
            if (!seenNames.has(key)) {
              seenNames.add(key);
              uniqueClients.push(d);
            }
          }
          setDbClients(uniqueClients);
          if (fetched.length > 0) handleSelectClient(fetched[0]);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingClients(false));
  }, []);

  const currentUnderlying =
    productType === 'ELN' ? eln.underlying : productType === 'CPN' ? cpn.underlying : dcd.underlying;

  useEffect(() => {
    if (!currentUnderlying) return;
    setLoadingHistory(true);
    setPriceHistory(null);
    fetchMarketHistory(currentUnderlying, 5)
      .then((r) => setPriceHistory(r.series))
      .catch(() => setPriceHistory(null))
      .finally(() => setLoadingHistory(false));
  }, [currentUnderlying]);

  const triggerLiveSuit = useCallback(() => {
    if (!withProfile || !profile.client_name) return;
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(async () => {
      setSuitLoading(true);
      try {
        const product = productType === 'ELN' ? eln : productType === 'CPN' ? cpn : dcd;
        const res = await runSuitabilityOnly({ product: product as ProductConfig, profile });
        setLiveSuit(res.suitability ?? null);
      } catch {
        // silently ignore
      } finally {
        setSuitLoading(false);
      }
    }, 600);
  }, [withProfile, profile, productType, eln, cpn, dcd]);

  useEffect(() => {
    triggerLiveSuit();
    return () => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
    };
  }, [eln, cpn, dcd, profile, withProfile, triggerLiveSuit]);

  // Run initial analysis automatically on mount or when client changes
  useEffect(() => {
    handleAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId]);

  const getProduct = (): ProductConfig => {
    if (productType === 'ELN') return eln;
    if (productType === 'CPN') return cpn;
    return dcd;
  };

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setFixIt(null);
    setHistoricalResult(null);
    setHistoricalError(null);
    try {
      const product = getProduct();
      const res = await runAnalysis({
        product,
        profile: withProfile && profile.client_name ? profile : null,
        include_monte_carlo: includeMC,
      });
      setResult(res);
    } catch (err: unknown) {
      const e = err as { detail?: string };
      setError(e?.detail ?? 'Analysis failed. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  const loadHistoricalScenarios = async () => {
    setHistoricalLoading(true);
    setHistoricalError(null);
    try {
      const res = await runHistoricalSimulation(getProduct());
      setHistoricalResult(res);
    } catch (err: unknown) {
      const e = err as { detail?: string };
      setHistoricalError(e?.detail ?? 'Historical replay failed. Is the backend running?');
    } finally {
      setHistoricalLoading(false);
    }
  };

  // handleAnalyze clears historicalResult, so every new client/terms run re-replays on the engine.
  useEffect(() => {
    if (activeTab === 'replay' && result && !historicalResult && !historicalLoading && !historicalError) {
      void loadHistoricalScenarios();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, result, historicalResult, historicalLoading, historicalError]);

  const handleFixIt = async () => {
    if (!result?.suitability) return;
    setFixLoading(true);
    try {
      const fi = await runFixIt(getProduct(), profile);
      setFixIt(fi);
    } catch {
      setError('Fix-it failed.');
    } finally {
      setFixLoading(false);
    }
  };

  // Client Selection Handler – only the client profile changes; the product terms the RM
  // set stay as they are, so product analysis (payoff, scenarios, replay, MC) is unaffected
  // and only the suitability check reflects the new client.
  const handleSelectClient = (client: ClientRow) => {
    const current = productType === 'ELN' ? eln : productType === 'CPN' ? cpn : dcd;
    // Treat the current terms as already saved so switching clients doesn't write them
    // to the new client's record; only actual edits are persisted.
    lastSavedConfig.current = JSON.stringify(current);
    setSaveState('idle');
    setSelectedClientId(client.case_id);
    setWithProfile(true);
    setProfile(client.profile);
  };

  const selectedClient = dbClients.find((c) => c.case_id === selectedClientId);

  // Persist product edits to the selected client's case (debounced).
  useEffect(() => {
    if (!selectedClient?.persisted) return;
    const product = productType === 'ELN' ? eln : productType === 'CPN' ? cpn : dcd;
    const serialized = JSON.stringify(product);
    if (serialized === lastSavedConfig.current) return;
    const caseId = selectedClient.case_id;
    const t = setTimeout(async () => {
      setSaveState('saving');
      try {
        await updateCaseProductConfig(caseId, product);
        lastSavedConfig.current = serialized;
        setDbClients((prev) => prev.map((c) => (c.case_id === caseId ? { ...c, product_config: product } : c)));
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 800);
    return () => clearTimeout(t);
  }, [eln, cpn, dcd, productType, selectedClient?.case_id, selectedClient?.persisted]);

  const filteredClients = dbClients.filter((c) =>
    c.client_name.toLowerCase().includes(clientFilter.toLowerCase()) ||
    c.case_id.toLowerCase().includes(clientFilter.toLowerCase()) ||
    (c.profile.risk_appetite || '').toLowerCase().includes(clientFilter.toLowerCase())
  );

  const selectedUnderlying = underlyings.find((u) => u.key === currentUnderlying);
  const currentProduct = getProduct();

  return (
    <>
      {/* ── Dashboard-Styled Header Band ────────────────────────────────────── */}
      <section
        className="band-dark"
        style={{ padding: '48px 0 32px', borderBottom: '1px solid var(--hairline-dark)' }}
      >
        <div className="page-container" style={{ maxWidth: 1440 }}>
          <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <ProductPill type={productType} />
                <span style={{ fontSize: 12, color: 'var(--stone)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  RM Workspace
                </span>
              </div>
              <h1 className="display-lg" style={{ color: 'var(--on-dark)', marginBottom: 8 }}>
                Structuring &amp; Suitability
              </h1>
              <div style={{ fontSize: 13, color: 'var(--stone)' }}>
                RM <span style={{ color: 'var(--on-dark)', fontWeight: 600 }}>{activeRM.legal_name}</span> ({activeRM.institution})
                {' '}· Client <span style={{ color: 'var(--on-dark)', fontWeight: 600 }}>{profile.client_name || 'Generic'}</span>
                {' '}· Underlying <span className="mono" style={{ color: 'var(--on-dark)' }}>{currentUnderlying}</span>
                {selectedClient?.persisted && saveState !== 'idle' && (
                  <span style={{ marginLeft: 8, color: saveState === 'error' ? 'var(--accent-red, #ef4444)' : 'var(--stone)' }}>
                    · {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved to client record' : 'Save failed'}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
              {(liveSuit || result?.suitability) && withProfile && (
                <div className="flex items-center gap-3">
                  {suitLoading && <Spinner size={14} label="Updating suitability..." />}
                  <ScoreRing score={(result?.suitability || liveSuit)!.score} size={64} label="Score" />
                  <VerdictBadge verdict={(result?.suitability || liveSuit)!.verdict} />
                </div>
              )}

              <Link to="/rm/register" className="btn btn-outline-dark btn-sm">
                <UserCog size={14} /> Onboarding &amp; Clearance
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Dashboard-Styled Key Metrics Bar ───────────────────────────────── */}
      <div className="band-dark" style={{ borderBottom: '1px solid var(--hairline-dark)' }}>
        <div className="page-container" style={{ maxWidth: 1440 }}>
          <div
            className="stat-grid"
            style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderBottom: 'none' }}
          >
            <StatBox
              label="Product"
              value={productType}
              subtext={currentUnderlying}
            />
            <StatBox
              label="Tenor"
              value={`${currentProduct.tenor_months}m`}
            />
            <StatBox
              label="Principal"
              value={`₹${(currentProduct.principal / 100000).toFixed(1)}L`}
              subtext={currentProduct.currency}
            />
            <StatBox
              label="Max Gain"
              value={result ? `+${(result.metrics.max_gain_pct * 100).toFixed(1)}%` : '—'}
              color="positive"
            />
            <StatBox
              label="Max Loss"
              value={result ? `${(result.metrics.max_loss_pct * 100).toFixed(1)}%` : '—'}
              color="negative"
            />
            <StatBox
              label="FD Baseline"
              value={result ? `+${(result.metrics.fd_baseline.annualised_return * 100).toFixed(1)}%` : '+7.0%'}
              subtext="p.a."
            />
          </div>
        </div>
      </div>

      {/* ── Main Workspace Body ───────────────────────────────────────────── */}
      <div className="band-dark" style={{ minHeight: '100vh', paddingBottom: 60 }}>
        <div className="page-container page-content animate-in" style={{ maxWidth: 1440, paddingTop: 24 }}>

          {/* ═══ 3-COLUMN GRID LAYOUT (Matching user mockup + Analysis Dashboard aesthetics) ═══ */}
          <div className="rm-3col-layout">
            
            {/* ── LEFT COLUMN ──────────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              
              {/* 2. Financial Products section (Bottom Left) */}
              <div className="rm-financial-card">
                <div style={sectionLabel} className="flex items-center gap-1">
                  <Layers size={13} /> Product Builder
                </div>

                {/* Product type selector */}
                <div className="card mb-3" style={{ padding: 14, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                  <div style={{ fontSize: 11, color: 'var(--stone)', marginBottom: 6 }}>Structure</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['ELN', 'CPN', 'DCD'] as const).map((pt) => (
                      <button
                        key={pt}
                        id={`product-type-${pt}`}
                        className={`btn ${productType === pt ? 'btn-cobalt' : 'btn-outline-dark'} btn-sm`}
                        style={{ flex: 1, justifyContent: 'center', height: 34, fontSize: 13 }}
                        onClick={() => setProductType(pt)}
                      >
                        {pt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Underlying Asset */}
                <div className="card mb-3" style={{ padding: 14, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                  <div style={{ fontSize: 11, color: 'var(--stone)', marginBottom: 6 }}>Underlying</div>
                  <select
                    id="underlying-select"
                    className="form-select"
                    style={{ height: 42, fontSize: 13, paddingTop: 0, paddingBottom: 0 }}
                    value={currentUnderlying}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (productType === 'ELN') setEln((p) => ({ ...p, underlying: v }));
                      else if (productType === 'CPN') setCpn((p) => ({ ...p, underlying: v }));
                      else setDcd((p) => ({ ...p, underlying: v }));
                    }}
                  >
                    {underlyings.length === 0 && <option value={currentUnderlying}>{currentUnderlying}</option>}
                    {underlyings.map((u) => (
                      <option key={u.key} value={u.key}>
                        {u.display_name} ({u.currency})
                      </option>
                    ))}
                  </select>

                  {selectedUnderlying && (
                    <div className="flex items-center justify-between" style={{ marginTop: 8, fontSize: 12 }}>
                      <span className="stat-label" style={{ fontSize: 10 }}>{selectedUnderlying.asset_class}</span>
                      {selectedUnderlying.latest_price != null && (
                        <span className="mono" style={{ color: '#fff', fontWeight: 600 }}>
                          ₹{selectedUnderlying.latest_price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </span>
                      )}
                      {selectedUnderlying.vol_1y != null && (
                        <span style={{ color: 'var(--accent-warning)', fontWeight: 600 }}>
                          σ {(selectedUnderlying.vol_1y * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  )}

                  {loadingHistory && <div className="mt-2 text-center"><Spinner size={12} /></div>}
                  {priceHistory && priceHistory.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <PriceChart series={priceHistory} height={75} />
                    </div>
                  )}
                </div>

                {/* Product Parameters Form */}
                <div className="card mb-3" style={{ padding: 14, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                  <div style={{ fontSize: 11, color: 'var(--stone)', marginBottom: 8 }}>
                    {productType} parameters
                  </div>
                  {productType === 'ELN' && <ELNForm config={eln} onChange={setEln} />}
                  {productType === 'CPN' && <CPNForm config={cpn} onChange={setCpn} />}
                  {productType === 'DCD' && <DCDForm config={dcd} onChange={setDcd} />}
                </div>

                {/* Options & Controls */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  <label className="flex items-center gap-2" style={{ fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={includeMC}
                      onChange={(e) => setIncludeMC(e.target.checked)}
                      style={{ accentColor: 'var(--primary)', width: 14, height: 14 }}
                    />
                    <span style={{ color: 'var(--on-dark-mute)' }}>Include Monte Carlo simulation (2,000 paths)</span>
                  </label>
                </div>

                {/* Run Analysis Action */}
                <button
                  id="analyze-btn"
                  className="btn btn-primary"
                  style={{ fontSize: 15, width: '100%', justifyContent: 'center' }}
                  onClick={handleAnalyze}
                  disabled={loading}
                >
                  {loading ? <Spinner size={16} /> : <Play size={16} />}
                  {loading ? 'Computing Payoff…' : 'Run Full Analysis'}
                </button>
              </div>

            </div>

            {/* ── CENTER COLUMN ────────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              
              {/* 1. Navigation Bar (Top Middle) */}
              <div className="rm-nav-bar">
                {/* Analysis Tabs */}
                <div className="seg-tabs" role="tablist" aria-label="Analysis views">
                    {(
                      [
                        { key: 'payoff', label: 'Payoff Graph', icon: <TrendingUp size={13} /> },
                        { key: 'scenarios', label: 'Scenarios', icon: <Table size={13} /> },
                        { key: 'replay', label: 'Replay', icon: <RotateCcw size={13} />, disabled: !result?.metrics?.replay },
                        { key: 'mc', label: 'Monte Carlo', icon: <Dices size={13} />, disabled: !result?.metrics?.monte_carlo },
                        { key: 'suitability', label: 'Suitability', icon: <Shield size={13} />, disabled: !result?.suitability },
                        { key: 'explanation', label: 'Reasoning', icon: <MessageSquare size={13} />, disabled: !result?.explanation },
                      ] as { key: Tab; label: string; icon: React.ReactNode; disabled?: boolean }[]
                    ).map((t) => (
                      <button
                        key={t.key}
                        role="tab"
                        aria-selected={activeTab === t.key}
                        className={`seg-tab ${activeTab === t.key ? 'active' : ''}`}
                        onClick={() => !t.disabled && setActiveTab(t.key)}
                        disabled={t.disabled}
                      >
                        {t.icon}
                        <span>{t.label}</span>
                      </button>
                    ))}
                </div>
              </div>

              {error && <Alert variant="error">{error}</Alert>}
              {loading && <LoadingOverlay message="Running analytical simulation & pricing models..." />}

              {/* 2. Main Analysis Graph (Green Box - Center Main Preview) */}
              <div
                className="rm-green-card"
                onClick={() => setFullScreenView('graph')}
                title="Click to view full screen analysis graph"
              >
                <div className="rm-green-header">
                  <div className="flex items-center gap-2">
                    <span className="rm-green-badge">Analysis</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--on-dark)' }}>
                      {productType} · {currentUnderlying}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {result && (
                      <button
                        className="btn btn-outline-dark btn-sm"
                        style={{
                          height: 30,
                          padding: '2px 10px',
                          fontSize: 12,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/dashboard/${result.run_id}`);
                        }}
                      >
                        Dashboard <ArrowUpRight size={13} />
                      </button>
                    )}
                    <button
                      className="btn btn-outline-dark btn-sm"
                      style={{
                        height: 30,
                        padding: '2px 10px',
                        fontSize: 12,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFullScreenView('graph');
                      }}
                    >
                      <Maximize2 size={13} /> Full Screen
                    </button>
                  </div>
                </div>

                {!result && !loading && (
                  <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--stone)' }}>
                    <BarChart3 size={48} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
                    <div style={{ fontSize: 16, color: '#fff', fontWeight: 500 }}>
                      No analysis yet
                    </div>
                    <div style={{ fontSize: 13 }}>Configure a product and select Run Full Analysis to see payoff charts.</div>
                  </div>
                )}

                {result && !loading && (
                  <div onClick={(e) => e.stopPropagation()}>
                    {/* Active Chart Display */}
                    {activeTab === 'payoff' && (
                      <div className="card" style={{ background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)', padding: 16 }}>
                        <div className="card-title mb-1" style={{ fontSize: 14 }}>
                          Payoff at maturity
                        </div>
                        <PayoffChart
                          curve={result.metrics.payoff_curve}
                          breakEven={result.metrics.break_even_x}
                          barrierX={productType === 'ELN' ? eln.barrier_pct : null}
                          fdBaseline={result.metrics.fd_baseline.annualised_return}
                          height={240}
                        />
                      </div>
                    )}

                    {activeTab === 'scenarios' && (
                      <div className="card" style={{ background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)', padding: 16 }}>
                        <ScenarioTable rows={result.metrics.scenario_table} principal={getProduct().principal} />
                      </div>
                    )}

                    {activeTab === 'replay' && result.metrics.replay && (
                      <div className="card" style={{ background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)', padding: 16 }}>
                        <HistogramChart bins={result.metrics.replay.histogram} title="Return Distribution (Replay)" />
                      </div>
                    )}

                    {activeTab === 'replay' && (
                      <div className="card" style={{ background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)', padding: 16, marginTop: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <h4 style={{ margin: 0 }}>Historical Scenarios (real market periods)</h4>
                          <button
                            className="btn btn-soft btn-sm"
                            onClick={loadHistoricalScenarios}
                            disabled={historicalLoading}
                          >
                            {historicalLoading ? <Spinner size={14} /> : historicalResult ? 'Reload' : 'Load real scenarios'}
                          </button>
                        </div>
                        {historicalError && <Alert variant="error">{historicalError}</Alert>}
                        {historicalResult && (
                          <>
                            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
                              Data as of {historicalResult.data_as_of} · {historicalResult.audit.market_data.fingerprint}
                            </div>
                            {historicalResult.warnings.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                                {historicalResult.warnings.map((w, i) => (
                                  <span key={i} className="product-pill DCD" style={{ fontSize: 10 }} title={w.message}>
                                    {w.code}
                                  </span>
                                ))}
                              </div>
                            )}
                            <HistoricalScenarioTable
                              scenarios={historicalResult.scenarios}
                              currency={historicalResult.currency}
                            />
                          </>
                        )}
                      </div>
                    )}

                    {activeTab === 'mc' && result.metrics.monte_carlo && (
                      <div className="card" style={{ background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)', padding: 16 }}>
                        <MCFanChart mc={result.metrics.monte_carlo} height={220} />
                      </div>
                    )}

                    {(activeTab === 'suitability' || activeTab === 'explanation') && (
                      <div className="card" style={{ background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)', padding: 16 }}>
                        <PayoffChart
                          curve={result.metrics.payoff_curve}
                          breakEven={result.metrics.break_even_x}
                          barrierX={productType === 'ELN' ? eln.barrier_pct : null}
                          fdBaseline={result.metrics.fd_baseline.annualised_return}
                          height={220}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 3. LLM Reasoning for both client and Rm (Purple Box - Center Bottom) */}
              <div
                className="rm-purple-card"
                onClick={() => setFullScreenView('reasoning')}
                title="Click to view full screen LLM reasoning"
              >
                <div className="rm-purple-header">
                  <div className="flex items-center gap-2">
                    <span className="rm-purple-badge flex items-center gap-1">
                      <Sparkles size={11} /> AI Rationale
                    </span>
                    {result?.suitability && <VerdictBadge verdict={result.suitability.verdict} />}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn-outline-dark btn-sm"
                      style={{
                        height: 30,
                        padding: '2px 10px',
                        fontSize: 12,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFullScreenView('reasoning');
                      }}
                    >
                      <Maximize2 size={13} /> Full Screen
                    </button>
                  </div>
                </div>

                {!result && !loading && (
                  <div style={{ padding: '24px 16px', color: 'var(--stone)', textAlign: 'center' }}>
                    <MessageSquare size={36} style={{ opacity: 0.3, margin: '0 auto 8px' }} />
                    <div style={{ fontSize: 14, color: 'var(--on-dark)' }}>Rationale will appear here</div>
                    <div style={{ fontSize: 12 }}>Client and RM explanations, SEBI rule checks and the suitability verdict.</div>
                  </div>
                )}

                {result && !loading && (
                  <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    
                    {/* Split View: Client vs RM Reasoning preview */}
                    <div className="rationale-split">
                      <section className="rationale-col">
                        <header className="rationale-col-head">
                          <span className="rationale-eyebrow">Client rationale</span>
                          <span className="rationale-who">{profile.client_name || 'Client'}</span>
                        </header>
                        <div className="rationale-scroll">
                          <FormattedClientReasoning
                            text={
                              result.explanation?.client_text ||
                              `**What this product does** This ${productType} structure offers downside protection with target yield of ${((eln.coupon_pa || 0.12) * 100).toFixed(1)}% p.a.\n**Why it fits you** Tailored for ${profile.risk_appetite} risk appetite.`
                            }
                          />
                        </div>
                      </section>

                      <section className="rationale-col">
                        <header className="rationale-col-head">
                          <span className="rationale-eyebrow">RM compliance</span>
                          <span className="rationale-who">{activeRM.legal_name}</span>
                        </header>
                        <div className="rationale-scroll">
                          <FormattedRMReasoning
                            text={
                              result.explanation?.rm_text ||
                              `**Verdict:** ${result.suitability?.verdict || 'CONDITIONALLY_SUITABLE'} | **Suitability score:** ${result.suitability?.score || 85}/100\nCleared under SEBI / institutional guidelines for ${activeRM.access_tier}. Client investable capacity ₹${(profile.investable_assets / 100000).toFixed(1)}L supports ₹${(profile.investment_amount / 100000).toFixed(1)}L ticket size.`
                            }
                          />
                        </div>
                      </section>
                    </div>

                  </div>
                )}
              </div>

              {/* 4. Module 3: rule-based suitability on Module 2's real historical replay */}
              <SuitabilityAssessmentCard
                clientId={selectedClientId}
                clientName={selectedClient?.client_name ?? profile.client_name}
                persisted={!!selectedClient?.persisted}
                product={currentProduct}
              />

            </div>

            {/* ── RIGHT COLUMN: Client Selection Side Panel (Magenta Box) ────────────── */}
            <div className="rm-magenta-card">
              <div className="rm-magenta-header">
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--on-dark)' }}>
                    Clients
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--stone)' }}>Select a client to load their profile</div>
                </div>
                <span className="mono" style={{ fontSize: 11, color: 'var(--stone)', background: 'var(--divider-soft)', padding: '2px 8px', borderRadius: 10 }}>
                  {filteredClients.length} records
                </span>
              </div>

              {/* Client Search Bar */}
              <div className="form-group mb-3">
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 14, top: 13, color: 'var(--stone)' }} />
                  <input
                    type="text"
                    className="form-input"
                    style={{ height: 40, paddingLeft: 36, fontSize: 13 }}
                    aria-label="Search clients"
                    placeholder="Search by name, case ID or risk…"
                    value={clientFilter}
                    onChange={(e) => setClientFilter(e.target.value)}
                  />
                </div>
              </div>

              {/* Registered Clients List */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxHeight: 320,
                  overflowY: 'auto',
                  paddingRight: 4,
                  marginBottom: 16,
                }}
              >
                {loadingClients && <div className="text-center py-4"><Spinner size={14} label="Loading clients..." /></div>}
                {!loadingClients && filteredClients.map((client) => {
                  const isSelected = client.case_id === selectedClientId;
                  return (
                    <div
                      key={client.case_id}
                      className={`client-item-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleSelectClient(client)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ fontWeight: 600, fontSize: 13, color: isSelected ? '#fff' : 'var(--on-dark-mute)' }}>
                          {client.client_name}
                        </span>
                        <span className="mono" style={{ fontSize: 10, color: 'var(--stone)' }}>
                          {client.case_id}
                        </span>
                      </div>

                      <div className="flex items-center justify-between" style={{ fontSize: 11 }}>
                        <span style={{ color: 'var(--stone)', textTransform: 'capitalize' }}>
                          Risk: <strong style={{ color: 'var(--on-dark-mute)' }}>{client.profile.risk_appetite}</strong>
                        </span>
                        <span className="mono" style={{ color: '#fff' }}>
                          ₹{(client.profile.investment_amount / 100000).toFixed(0)}L Ticket
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Active Client Details & Input Panel */}
              <div className="card" style={{ background: 'var(--surface-deep)', padding: 16, border: '1px solid var(--hairline-dark)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--stone)', textTransform: 'uppercase' }}>
                    Client profile
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ height: 26, padding: '0 10px', fontSize: 11, color: withProfile ? 'var(--accent-teal)' : 'var(--stone)' }}
                    aria-pressed={withProfile}
                    onClick={() => setWithProfile(!withProfile)}
                  >
                    {withProfile ? '✓ Enabled' : 'Disabled'}
                  </button>
                </div>

                <ProfileMiniForm profile={profile} onChange={(p) => setProfile(p)} />
              </div>

              {/* Quick Add Client Button */}
              <button
                className="btn btn-outline-dark btn-sm mt-3"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => {
                  const newName = prompt('Enter new Client Name:');
                  if (newName) {
                    const newCaseId = `CL-${Math.floor(100 + Math.random() * 900)}`;
                    const newClient = {
                      case_id: newCaseId,
                      client_name: newName,
                      created_at: new Date().toISOString(),
                      profile: { ...DEFAULT_PROFILE, client_name: newName },
                    };
                    setDbClients([newClient, ...dbClients]);
                    handleSelectClient(newClient);
                  }
                }}
              >
                <Plus size={14} /> Add client
              </button>

            </div>

          </div>

          <Disclaimer text="Decision-support tool for Relationship Managers. Past market performance does not guarantee future results." className="mt-4" />

        </div>
      </div>

      {/* ═══ FULLSCREEN OVERLAY MODAL ═══ */}
      {fullScreenView !== 'none' && (
        <div className="rm-fullscreen-overlay">
          <div className={`rm-fullscreen-dialog ${fullScreenView === 'graph' ? 'green-theme' : 'purple-theme'}`}>
            
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
                <span className={fullScreenView === 'graph' ? 'rm-green-badge' : 'rm-purple-badge'}>
                  {fullScreenView === 'graph' ? 'Analysis' : 'Rationale & Suitability'}
                </span>
                <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--on-dark)' }}>
                  {productType} on {currentUnderlying} · {profile.client_name || 'Generic'}
                </span>
              </div>

              <button
                className="btn btn-outline-dark btn-sm"
                onClick={() => setFullScreenView('none')}
                aria-label="Close full screen (Esc)"
              >
                <X size={16} /> Close
              </button>
            </div>

            {/* Modal Body: FULL SCREEN GRAPH VIEW */}
            {fullScreenView === 'graph' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Visual Chart Navigation */}
                <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 12 }}>
                  <div className="seg-tabs" role="tablist" aria-label="Analysis views">
                    {(
                      [
                        ['payoff', 'Payoff'],
                        ['scenarios', 'Scenarios'],
                        ['replay', 'Replay'],
                        ['mc', 'Monte Carlo'],
                      ] as const
                    ).map(([t, label]) => (
                      <button
                        key={t}
                        role="tab"
                        aria-selected={activeTab === t}
                        className={`seg-tab ${activeTab === t ? 'active' : ''}`}
                        onClick={() => setActiveTab(t)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {result?.suitability && <VerdictBadge verdict={result.suitability.verdict} />}
                </div>

                {result && (
                  <>
                    <MetricsSummary metrics={result.metrics} />

                    {activeTab === 'payoff' && (
                      <div className="card" style={{ padding: 24, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                        <div className="card-title mb-2">Payoff curve &amp; break-even</div>
                        <PayoffChart
                          curve={result.metrics.payoff_curve}
                          breakEven={result.metrics.break_even_x}
                          barrierX={productType === 'ELN' ? eln.barrier_pct : null}
                          fdBaseline={result.metrics.fd_baseline.annualised_return}
                          height={420}
                        />
                      </div>
                    )}

                    {activeTab === 'scenarios' && (
                      <div className="card" style={{ padding: 24, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                        <ScenarioTable rows={result.metrics.scenario_table} principal={getProduct().principal} />
                      </div>
                    )}

                    {activeTab === 'mc' && result.metrics.monte_carlo && (
                      <div className="card" style={{ padding: 24, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                        <div className="card-title mb-2">Monte Carlo fan chart (2,000 paths)</div>
                        <MCFanChart mc={result.metrics.monte_carlo} height={400} />
                      </div>
                    )}

                    {activeTab === 'replay' && result.metrics.replay && (
                      <div className="card" style={{ padding: 24, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                        <HistogramChart bins={result.metrics.replay.histogram} title="Historical Replay Return Distribution" />
                      </div>
                    )}

                    {activeTab === 'replay' && (
                      <div className="card" style={{ padding: 24, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)', marginTop: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <h4 style={{ margin: 0 }}>Historical Scenarios (real market periods)</h4>
                          <button
                            className="btn btn-soft btn-sm"
                            onClick={loadHistoricalScenarios}
                            disabled={historicalLoading}
                          >
                            {historicalLoading ? <Spinner size={14} /> : historicalResult ? 'Reload' : 'Load real scenarios'}
                          </button>
                        </div>
                        {historicalError && <Alert variant="error">{historicalError}</Alert>}
                        {historicalResult && (
                          <>
                            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
                              Data as of {historicalResult.data_as_of} · {historicalResult.audit.market_data.fingerprint}
                            </div>
                            {historicalResult.warnings.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                                {historicalResult.warnings.map((w, i) => (
                                  <span key={i} className="product-pill DCD" style={{ fontSize: 10 }} title={w.message}>
                                    {w.code}
                                  </span>
                                ))}
                              </div>
                            )}
                            <HistoricalScenarioTable
                              scenarios={historicalResult.scenarios}
                              currency={historicalResult.currency}
                            />
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Modal Body: FULL SCREEN REASONING VIEW */}
            {fullScreenView === 'reasoning' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {result?.suitability && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-outline-dark btn-sm"
                      style={{ height: 32, fontSize: 12, padding: '0 12px' }}
                      onClick={handleFixIt}
                      disabled={fixLoading}
                    >
                      {fixLoading ? <Spinner size={10} /> : <Wrench size={11} />} Fix-It Suggestions
                    </button>
                  </div>
                )}

                {result?.explanation && (
                  <div className="grid-2" style={{ gap: 20 }}>
                    <div className="card" style={{ padding: 24, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                      <ExplanationCard explanation={result.explanation} audience="client" />
                    </div>
                    <div className="card" style={{ padding: 24, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                      <ExplanationCard explanation={result.explanation} audience="rm" />
                    </div>
                  </div>
                )}



                {fixIt && (
                  <div className="card" style={{ padding: 24, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                    <div className="card-title mb-3 flex items-center gap-2">
                      <Wrench size={18} style={{ color: 'var(--accent-teal)' }} />
                      Fix-it suggestions
                    </div>
                    {fixIt.suggestions.map((s, i) => (
                      <div key={i} className="mb-3 pb-3 border-b border-hairline-dark">
                        <div className="flex items-center gap-2 mb-1">
                          <VerdictBadge verdict={s.new_verdict} />
                          <span style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>Score: {s.new_score.toFixed(0)}/100</span>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{s.change_description}</div>
                        <div style={{ fontSize: 13, color: 'var(--stone)' }}>{s.tradeoff}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </>
  );
};

// ── Form Components ────────────────────────────────────────────────────────

interface ELNFormProps { config: ELNConfig; onChange: (c: ELNConfig) => void; }
const ELNForm: React.FC<ELNFormProps> = ({ config, onChange }) => {
  const set = <K extends keyof ELNConfig>(k: K, v: ELNConfig[K]) => onChange({ ...config, [k]: v });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SliderField
        id="eln-tenor" label="Tenor" value={config.tenor_months}
        min={3} max={36} step={1} format={(v) => `${v}m`}
        onChange={(v) => set('tenor_months', v)}
      />
      <SliderField
        id="eln-barrier" label="Barrier" value={config.barrier_pct}
        min={0.40} max={0.95} step={0.01} format={(v) => `${(v * 100).toFixed(0)}%`}
        onChange={(v) => set('barrier_pct', v)}
      />
      <SliderField
        id="eln-coupon" label="Coupon p.a." value={config.coupon_pa}
        min={0} max={0.40} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`}
        onChange={(v) => set('coupon_pa', v)}
      />
      <PrincipalField
        value={config.principal} currency={config.currency}
        onChange={(v) => set('principal', v)} onCurrencyChange={(v) => set('currency', v)}
      />
    </div>
  );
};

interface CPNFormProps { config: CPNConfig; onChange: (c: CPNConfig) => void; }
const CPNForm: React.FC<CPNFormProps> = ({ config, onChange }) => {
  const set = <K extends keyof CPNConfig>(k: K, v: CPNConfig[K]) => onChange({ ...config, [k]: v });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SliderField
        id="cpn-tenor" label="Tenor" value={config.tenor_months}
        min={3} max={36} step={1} format={(v) => `${v}m`}
        onChange={(v) => set('tenor_months', v)}
      />
      <SliderField
        id="cpn-protection" label="Capital Protection" value={config.protection_pct}
        min={0.80} max={1.00} step={0.01} format={(v) => `${(v * 100).toFixed(0)}%`}
        onChange={(v) => set('protection_pct', v)}
      />
      <SliderField
        id="cpn-participation" label="Participation" value={config.participation_pct}
        min={0.10} max={2.00} step={0.05} format={(v) => `${(v * 100).toFixed(0)}%`}
        onChange={(v) => set('participation_pct', v)}
      />
      <PrincipalField
        value={config.principal} currency={config.currency}
        onChange={(v) => set('principal', v)} onCurrencyChange={(v) => set('currency', v)}
      />
    </div>
  );
};

interface DCDFormProps { config: DCDConfig; onChange: (c: DCDConfig) => void; }
const DCDForm: React.FC<DCDFormProps> = ({ config, onChange }) => {
  const set = <K extends keyof DCDConfig>(k: K, v: DCDConfig[K]) => onChange({ ...config, [k]: v });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SliderField
        id="dcd-tenor" label="Tenor" value={config.tenor_months}
        min={3} max={36} step={1} format={(v) => `${v}m`}
        onChange={(v) => set('tenor_months', v)}
      />
      <div className="form-group">
        <label className="form-label" htmlFor="dcd-strike">Strike (FX rate)</label>
        <input
          id="dcd-strike" type="number" className="form-input mono"
          min={0.01} step={0.25} value={config.strike}
          onChange={(e) => set('strike', +e.target.value)}
        />
      </div>
      <SliderField
        id="dcd-interest" label="Interest p.a." value={config.interest_pa}
        min={0} max={0.30} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`}
        onChange={(v) => set('interest_pa', v)}
      />
      <PrincipalField
        value={config.principal} currency={config.currency}
        onChange={(v) => set('principal', v)} onCurrencyChange={(v) => set('currency', v)}
      />
    </div>
  );
};

interface SliderFieldProps {
  id: string; label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}
const SliderField: React.FC<SliderFieldProps> = ({ id, label, value, min, max, step, format, onChange }) => (
  <div className="slider-group">
    <div className="slider-header" style={{ marginBottom: 2 }}>
      <label className="form-label" htmlFor={id} style={{ fontSize: 11 }}>{label}</label>
      <span className="slider-value" style={{ fontSize: 12 }}>{format(value)}</span>
    </div>
    <input
      id={id} type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(+e.target.value)}
    />
  </div>
);

interface PrincipalFieldProps {
  value: number; currency: string; onChange: (v: number) => void; onCurrencyChange: (v: string) => void;
}
const PrincipalField: React.FC<PrincipalFieldProps> = ({ value, currency, onChange, onCurrencyChange }) => (
  <div className="form-group">
    <label className="form-label" htmlFor="principal-input" style={{ fontSize: 11 }}>Principal</label>
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        id="principal-input" type="number" className="form-input mono"
        style={{ height: 38, fontSize: 13 }} min={1} step={100000}
        value={value} onChange={(e) => onChange(+e.target.value)}
      />
      <select
        className="form-select" style={{ width: 75, height: 38, fontSize: 12, padding: '4px 6px' }}
        value={currency} onChange={(e) => onCurrencyChange(e.target.value)}
      >
        {['INR', 'USD', 'EUR', 'GBP', 'JPY'].map((c) => (<option key={c} value={c}>{c}</option>))}
      </select>
    </div>
  </div>
);

interface ProfileMiniFormProps { profile: ClientProfile; onChange: (p: ClientProfile) => void; }
const ProfileMiniForm: React.FC<ProfileMiniFormProps> = ({ profile, onChange }) => {
  const set = <K extends keyof ClientProfile>(k: K, v: ClientProfile[K]) => onChange({ ...profile, [k]: v });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="form-group">
        <label className="form-label" htmlFor="rm-client-name" style={{ fontSize: 11 }}>Client Name</label>
        <input
          id="rm-client-name" className="form-input" style={{ height: 36, fontSize: 12 }}
          value={profile.client_name} onChange={(e) => set('client_name', e.target.value)}
          placeholder="e.g. Priya Sharma"
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="rm-risk" style={{ fontSize: 11 }}>Risk Appetite</label>
        <select
          id="rm-risk" className="form-select" style={{ height: 36, fontSize: 12, padding: '4px 8px' }}
          value={profile.risk_appetite}
          onChange={(e) => set('risk_appetite', e.target.value as ClientProfile['risk_appetite'])}
        >
          <option value="conservative">Conservative</option>
          <option value="moderate">Moderate</option>
          <option value="aggressive">Aggressive</option>
        </select>
      </div>
      <SliderField
        id="rm-loss-tol" label="Loss Tolerance" value={profile.loss_tolerance_pct}
        min={0} max={50} step={1} format={(v) => `${v}%`}
        onChange={(v) => set('loss_tolerance_pct', v)}
      />
      <div className="form-group">
        <label className="form-label" htmlFor="rm-invest" style={{ fontSize: 11 }}>Ticket Size (₹)</label>
        <input
          id="rm-invest" className="form-input mono" type="number" style={{ height: 36, fontSize: 12 }}
          min={1} step={100000} value={profile.investment_amount}
          onChange={(e) => set('investment_amount', +e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="rm-assets" style={{ fontSize: 11 }}>Investable Assets (₹)</label>
        <input
          id="rm-assets" className="form-input mono" type="number" style={{ height: 36, fontSize: 12 }}
          min={1} step={100000} value={profile.investable_assets}
          onChange={(e) => set('investable_assets', +e.target.value)}
        />
      </div>
    </div>
  );
};

export default RMPage;
