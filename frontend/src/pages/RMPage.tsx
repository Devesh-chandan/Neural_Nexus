import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sliders,
  Play,
  TrendingUp,
  Table,
  RotateCcw,
  Dices,
  Shield,
  MessageSquare,
  Wrench,
  Settings,
  BarChart3,
  ArrowUpRight,
} from 'lucide-react';
import {
  runAnalysis,
  fetchUnderlyings,
  fetchMarketHistory,
  runSuitabilityOnly,
  runFixIt,
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
} from '../types';
import {
  LoadingOverlay,
  Alert,
  VerdictBadge,
  Disclaimer,
  Spinner,
  Tooltip,
  ProductPill,
  ScoreRing,
  RuleDot,
} from '../components/UIKit';
import {
  PayoffChart,
  HistogramChart,
  MCFanChart,
  PriceChart,
  MetricsSummary,
  ScenarioTable,
} from '../components/Charts';
import SuitabilityPanel from '../components/SuitabilityPanel';
import ExplanationCard from '../components/ExplanationCard';

// ── Default configs ────────────────────────────────────────────────────────

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
  client_name: '',
  risk_appetite: 'moderate',
  horizon_months: 12,
  loss_tolerance_pct: 20,
  investable_assets: 10_000_000,
  investment_amount: 1_000_000,
  existing_exposure_underlying_pct: 0,
  existing_structured_pct: 0,
  experience: 'intermediate',
};

type Tab = 'payoff' | 'scenarios' | 'replay' | 'mc' | 'suitability' | 'explanation';

// ── Label style ───────────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--stone)',
  marginBottom: 14,
};

// ── RMPage ─────────────────────────────────────────────────────────────────

const RMPage: React.FC = () => {
  const navigate = useNavigate();

  const [productType, setProductType] = useState<'ELN' | 'CPN' | 'DCD'>('ELN');
  const [eln, setEln] = useState<ELNConfig>({ ...DEFAULT_ELN });
  const [cpn, setCpn] = useState<CPNConfig>({ ...DEFAULT_CPN });
  const [dcd, setDcd] = useState<DCDConfig>({ ...DEFAULT_DCD });

  const [withProfile, setWithProfile] = useState(false);
  const [profile, setProfile] = useState<ClientProfile>({ ...DEFAULT_PROFILE });

  const [includeMC, setIncludeMC] = useState(false);

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

  useEffect(() => {
    fetchUnderlyings().then((r) => setUnderlyings(r.underlyings)).catch(() => { });
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
    return () => { if (liveTimer.current) clearTimeout(liveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eln, cpn, dcd, profile, withProfile]);

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
    try {
      const product = getProduct();
      const res = await runAnalysis({
        product,
        profile: withProfile && profile.client_name ? profile : null,
        include_monte_carlo: includeMC,
      });
      setResult(res);
      setActiveTab('payoff');
    } catch (err: unknown) {
      const e = err as { detail?: string };
      setError(e?.detail ?? 'Analysis failed. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

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

  const selectedUnderlying = underlyings.find((u) => u.key === currentUnderlying);

  return (
    <>
      {/* ── Header band ──────────────────────────────────────────────────── */}
      <section
        className="band-dark"
        style={{ padding: '64px 0 48px', borderBottom: '1px solid var(--hairline-dark)' }}
      >
        <div className="page-container">
          <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div className="hero-eyebrow" style={{ marginBottom: 16 }}>
                <Sliders size={14} style={{ color: 'var(--primary-bright)' }} aria-hidden="true" />
                Relationship Manager
              </div>
              <h1 className="display-lg" style={{ color: 'var(--on-dark)', marginBottom: 12 }}>
                RM Workspace
              </h1>
              <p style={{ fontSize: 16, color: 'var(--on-dark-mute)', maxWidth: 520 }}>
                Configure structured products, run full analysis and check client suitability.
              </p>
            </div>
            {liveSuit && withProfile && (
              <div className="flex items-center gap-3">
                {suitLoading && <Spinner size={14} label="Updating suitability…" />}
                <VerdictBadge verdict={liveSuit.verdict} />
                <span style={{ fontSize: 12, color: 'var(--stone)' }}>Live</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Main layout ──────────────────────────────────────────────────── */}
      <div className="band-dark" style={{ paddingBottom: 80 }}>
        <div className="page-container page-content animate-in">
          <title>RM Workspace – Neural Nexus</title>
          <meta
            name="description"
            content="Relationship Manager workspace: configure structured products, run analysis and check client suitability."
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '320px 1fr',
              gap: 24,
              alignItems: 'start',
            }}
          >
            {/* ── Left: Config Panel ──────────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Product type selector */}
              <div className="card">
                <div style={sectionLabel}>Product Type</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['ELN', 'CPN', 'DCD'] as const).map((pt) => (
                    <button
                      key={pt}
                      id={`product-type-${pt}`}
                      className={`btn ${productType === pt ? 'btn-cobalt' : 'btn-outline-dark'} btn-sm`}
                      style={{ flex: 1, justifyContent: 'center' }}
                      onClick={() => setProductType(pt)}
                      aria-pressed={productType === pt}
                      aria-label={`Select ${pt} product type`}
                    >
                      {pt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Underlying selector */}
              <div className="card">
                <div style={sectionLabel}>Underlying Asset</div>
                <select
                  id="underlying-select"
                  className="form-select"
                  value={currentUnderlying}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (productType === 'ELN') setEln((p) => ({ ...p, underlying: v }));
                    else if (productType === 'CPN') setCpn((p) => ({ ...p, underlying: v }));
                    else setDcd((p) => ({ ...p, underlying: v }));
                  }}
                  aria-label="Select underlying asset"
                >
                  {underlyings.length === 0 && (
                    <option value={currentUnderlying}>{currentUnderlying}</option>
                  )}
                  {underlyings.map((u) => (
                    <option key={u.key} value={u.key}>
                      {u.display_name} ({u.currency})
                    </option>
                  ))}
                </select>

                {selectedUnderlying && (
                  <div className="flex items-center gap-3" style={{ marginTop: 10 }}>
                    <span className="stat-label">{selectedUnderlying.asset_class}</span>
                    {selectedUnderlying.latest_price != null && (
                      <span className="mono" style={{ fontSize: 13, color: 'var(--on-dark)' }}>
                        ₹{selectedUnderlying.latest_price.toLocaleString('en-IN', {
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    )}
                    {selectedUnderlying.vol_1y != null && (
                      <Tooltip content="1-year realised volatility">
                        <span style={{ fontSize: 12, color: 'var(--accent-warning)', fontWeight: 600 }}>
                          σ {(selectedUnderlying.vol_1y * 100).toFixed(1)}%
                        </span>
                      </Tooltip>
                    )}
                  </div>
                )}

                {loadingHistory && (
                  <div style={{ marginTop: 10 }}>
                    <Spinner size={14} />
                  </div>
                )}
                {priceHistory && priceHistory.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <PriceChart series={priceHistory} height={90} />
                  </div>
                )}
              </div>

              {/* Product params */}
              <div className="card">
                <div style={sectionLabel}>
                  {productType === 'ELN' && 'ELN Parameters'}
                  {productType === 'CPN' && 'CPN Parameters'}
                  {productType === 'DCD' && 'DCD Parameters'}
                </div>
                {productType === 'ELN' && <ELNForm config={eln} onChange={setEln} />}
                {productType === 'CPN' && <CPNForm config={cpn} onChange={setCpn} />}
                {productType === 'DCD' && <DCDForm config={dcd} onChange={setDcd} />}
              </div>

              {/* Options */}
              <div className="card">
                <div style={sectionLabel}>Options</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <label
                    className="flex items-center gap-3"
                    style={{ fontSize: 14, cursor: 'pointer' }}
                  >
                    <input
                      id="include-mc-check"
                      type="checkbox"
                      checked={includeMC}
                      onChange={(e) => setIncludeMC(e.target.checked)}
                      aria-label="Include Monte Carlo simulation"
                      style={{ accentColor: 'var(--primary)', width: 16, height: 16 }}
                    />
                    <span style={{ color: 'var(--on-dark-mute)' }}>
                      Include Monte Carlo
                      <span style={{ color: 'var(--stone)', marginLeft: 6 }}>
                        ({includeMC ? '2000 paths' : 'slower'})
                      </span>
                    </span>
                  </label>
                  <label
                    className="flex items-center gap-3"
                    style={{ fontSize: 14, cursor: 'pointer' }}
                  >
                    <input
                      id="with-profile-check"
                      type="checkbox"
                      checked={withProfile}
                      onChange={(e) => setWithProfile(e.target.checked)}
                      aria-label="Include client suitability check"
                      style={{ accentColor: 'var(--primary)', width: 16, height: 16 }}
                    />
                    <span style={{ color: 'var(--on-dark-mute)' }}>
                      Include Client Profile & Suitability
                    </span>
                  </label>
                </div>
              </div>

              {/* Client profile (conditional) */}
              {withProfile && (
                <div className="card animate-scale">
                  <div style={sectionLabel}>Client Profile</div>
                  <ProfileMiniForm profile={profile} onChange={setProfile} />
                </div>
              )}

              {/* Analyze button */}
              <button
                id="analyze-btn"
                className="btn btn-primary"
                style={{ height: 52, fontSize: 16, width: '100%', justifyContent: 'center' }}
                onClick={handleAnalyze}
                disabled={loading}
                aria-label="Run analysis"
                aria-busy={loading}
              >
                {loading ? <Spinner size={16} /> : <Play size={16} />}
                {loading ? 'Computing…' : 'Run Analysis'}
              </button>

              {result && (
                <button
                  id="view-dashboard-btn"
                  className="btn btn-outline-dark"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => navigate(`/dashboard/${result.run_id}`)}
                  aria-label="Open full dashboard for this run"
                >
                  Open Dashboard <ArrowUpRight size={16} />
                </button>
              )}
            </div>

            {/* ── Right: Results Panel ─────────────────────────────────────── */}
            <div style={{ minWidth: 0 }}>
              {error && <Alert variant="error" className="mb-4">{error}</Alert>}

              {loading && <LoadingOverlay message="Running analysis…" />}

              {!loading && !result && (
                <div
                  className="card"
                  style={{
                    textAlign: 'center',
                    padding: 80,
                    borderStyle: 'dashed',
                    border: '1px dashed var(--hairline-dark)',
                    background: 'transparent',
                  }}
                >
                  <div
                    style={{ fontSize: 48, marginBottom: 16, opacity: 0.2, display: 'flex', justifyContent: 'center' }}
                    aria-hidden="true"
                  >
                    <BarChart3 size={48} strokeWidth={1} />
                  </div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 500,
                      color: 'var(--on-dark-mute)',
                      marginBottom: 8,
                    }}
                  >
                    Configure a product and click Run Analysis
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--stone)' }}>
                    Results will appear here
                  </div>
                </div>
              )}

              {result && !loading && (
                <div className="animate-in">
                  {/* Run header */}
                  <div
                    className="flex items-center justify-between mb-4"
                    style={{ flexWrap: 'wrap', gap: 8 }}
                  >
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <ProductPill type={result.metrics ? productType : 'ELN'} />
                        <span
                          style={{
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 18,
                            fontWeight: 500,
                            color: 'var(--on-dark)',
                          }}
                        >
                          Analysis Results
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--stone)', marginTop: 2 }}>
                        Run <span className="mono">{result.run_id.slice(0, 12)}…</span>
                        {' '}· {result.data_source} · As of {result.as_of}
                      </div>
                    </div>
                    {result.suitability && (
                      <div className="flex items-center gap-3">
                        <ScoreRing score={result.suitability.score} size={60} label="Score" />
                        <VerdictBadge verdict={result.suitability.verdict} />
                      </div>
                    )}
                  </div>

                  {/* Metrics summary */}
                  <div className="card mb-4">
                    <MetricsSummary metrics={result.metrics} />
                    {result.metrics.pricing.flag === 'coupon_above_indicative' && (
                      <Alert variant="warning" className="mt-3">
                        Coupon is above the indicative fair value. Discuss with issuer.
                      </Alert>
                    )}
                    {result.metrics.cliff && (
                      <Alert variant="warning" className="mt-2">
                        Cliff: a {result.metrics.cliff.loss_jump_pct_points.toFixed(1)}pp jump
                        in loss near {(result.metrics.cliff.x_level * 100).toFixed(0)}% barrier.
                      </Alert>
                    )}
                  </div>

                  {/* Tabs */}
                  <div className="tab-list" role="tablist" aria-label="Analysis tabs">
                    {(
                      [
                        { key: 'payoff', label: 'Payoff', icon: <TrendingUp size={14} /> },
                        { key: 'scenarios', label: 'Scenarios', icon: <Table size={14} /> },
                        { key: 'replay', label: 'Replay', icon: <RotateCcw size={14} />, disabled: !result.metrics.replay },
                        {
                          key: 'mc',
                          label: 'Monte Carlo',
                          icon: <Dices size={14} />,
                          disabled: !result.metrics.monte_carlo,
                        },
                        {
                          key: 'suitability',
                          label: 'Suitability',
                          icon: <Shield size={14} />,
                          disabled: !result.suitability,
                        },
                        {
                          key: 'explanation',
                          label: 'Explanation',
                          icon: <MessageSquare size={14} />,
                          disabled: !result.explanation,
                        },
                      ] as { key: Tab; label: string; icon: React.ReactNode; disabled?: boolean }[]
                    ).map((t) => (
                      <button
                        key={t.key}
                        id={`tab-${t.key}`}
                        className={`tab-btn ${activeTab === t.key ? 'active' : ''}`}
                        onClick={() => !t.disabled && setActiveTab(t.key)}
                        role="tab"
                        aria-selected={activeTab === t.key}
                        aria-controls={`panel-${t.key}`}
                        disabled={t.disabled}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        {t.icon}
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {/* Tab panels */}
                  <div
                    role="tabpanel"
                    id={`panel-${activeTab}`}
                    aria-labelledby={`tab-${activeTab}`}
                  >
                    {activeTab === 'payoff' && (
                      <div className="card animate-in">
                        <div className="card-title mb-1">Payoff Curve</div>
                        <div className="card-subtitle">Net return at maturity vs underlying level</div>
                        <PayoffChart
                          curve={result.metrics.payoff_curve}
                          breakEven={result.metrics.break_even_x}
                          barrierX={productType === 'ELN' ? eln.barrier_pct : null}
                          fdBaseline={result.metrics.fd_baseline.annualised_return}
                          height={300}
                        />
                      </div>
                    )}

                    {activeTab === 'scenarios' && (
                      <div className="card animate-in">
                        <div className="card-title mb-1">Scenario Analysis</div>
                        <div className="card-subtitle mb-4">
                          Principal: ₹{getProduct().principal.toLocaleString('en-IN')}
                        </div>
                        <ScenarioTable
                          rows={result.metrics.scenario_table}
                          principal={getProduct().principal}
                        />
                      </div>
                    )}

                    {activeTab === 'replay' && result.metrics.replay && (
                      <div className="card animate-in">
                        <div className="card-title mb-1">Historical Replay</div>
                        <div className="card-subtitle mb-4">
                          {result.metrics.replay.n_windows} windows ·{' '}
                          {result.metrics.replay.n_independent} independent
                        </div>
                        <div className="stat-grid mb-4">
                          <div className="stat-box">
                            <div className="stat-label">P(Loss)</div>
                            <div className="stat-value negative">
                              {(result.metrics.replay.p_loss * 100).toFixed(1)}%
                            </div>
                          </div>
                          <div className="stat-box">
                            <div className="stat-label">Barrier Breach Freq</div>
                            <div className="stat-value negative">
                              {(result.metrics.replay.breach_frequency * 100).toFixed(1)}%
                            </div>
                          </div>
                          <div className="stat-box">
                            <div className="stat-label">Worst Loss</div>
                            <div className="stat-value negative">
                              {result.metrics.replay.worst_loss_pct.toFixed(1)}%
                            </div>
                          </div>
                          <div className="stat-box">
                            <div className="stat-label">CVaR 5%</div>
                            <div className="stat-value negative">
                              {result.metrics.replay.cvar5_loss_pct.toFixed(1)}%
                            </div>
                          </div>
                        </div>
                        <HistogramChart
                          bins={result.metrics.replay.histogram}
                          title="Return Distribution (Replay)"
                        />
                        {result.metrics.replay.crisis_presets.filter((c) => c.available).length >
                          0 && (
                            <div style={{ marginTop: 24 }}>
                              <div
                                style={{
                                  fontSize: 14,
                                  fontWeight: 600,
                                  color: 'var(--on-dark)',
                                  marginBottom: 12,
                                }}
                              >
                                Crisis Scenarios
                              </div>
                              <div style={{ overflowX: 'auto' }}>
                                <table className="data-table">
                                  <thead>
                                    <tr>
                                      <th>Event</th>
                                      <th>Period</th>
                                      <th>Net Return</th>
                                      <th>Barrier Breach</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {result.metrics.replay.crisis_presets
                                      .filter((c) => c.available)
                                      .map((c) => (
                                        <tr key={c.name}>
                                          <td>{c.label}</td>
                                          <td className="mono" style={{ fontSize: 12 }}>
                                            {c.start_date?.slice(0, 10)} →{' '}
                                            {c.end_date?.slice(0, 10)}
                                          </td>
                                          <td
                                            className={
                                              c.net_return != null && c.net_return < 0
                                                ? 'text-red'
                                                : 'text-green'
                                            }
                                          >
                                            {c.net_return != null
                                              ? `${(c.net_return * 100).toFixed(2)}%`
                                              : '—'}
                                          </td>
                                          <td>
                                            {c.breach != null ? (
                                              <RuleDot
                                                status={c.breach ? 'RED' : 'GREEN'}
                                                label={c.breach ? 'Breach' : 'No breach'}
                                              />
                                            ) : (
                                              '—'
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                      </div>
                    )}

                    {activeTab === 'mc' && result.metrics.monte_carlo && (
                      <div className="card animate-in">
                        <div className="card-title mb-1">Monte Carlo Simulation</div>
                        <div className="card-subtitle mb-4">
                          {result.metrics.monte_carlo.n_paths.toLocaleString()} paths · Seed{' '}
                          {result.metrics.monte_carlo.seed}
                        </div>
                        <MCFanChart mc={result.metrics.monte_carlo} height={260} />
                        <div className="stat-grid mt-4">
                          <div className="stat-box">
                            <div className="stat-label">P(Loss)</div>
                            <div className="stat-value negative">
                              {(result.metrics.monte_carlo.p_loss * 100).toFixed(1)}%
                            </div>
                          </div>
                          <div className="stat-box">
                            <div className="stat-label">CVaR 5%</div>
                            <div className="stat-value negative">
                              {result.metrics.monte_carlo.cvar5_loss_pct.toFixed(1)}%
                            </div>
                          </div>
                          <div className="stat-box">
                            <div className="stat-label">Median Ann. Return</div>
                            <div className="stat-value positive">
                              {(result.metrics.monte_carlo.median_annualised_return * 100).toFixed(1)}%
                            </div>
                          </div>
                        </div>
                        <div className="mt-4">
                          <HistogramChart
                            bins={result.metrics.monte_carlo.histogram}
                            title="Return Distribution (MC)"
                          />
                        </div>
                      </div>
                    )}

                    {activeTab === 'suitability' && result.suitability && (
                      <div className="animate-in">
                        <SuitabilityPanel suitability={result.suitability} />
                        {result.suitability.verdict !== 'SUITABLE' && withProfile && (
                          <div className="card mt-4">
                            <div className="flex items-center justify-between mb-4">
                              <div className="card-title flex items-center gap-2">
                                <Wrench size={16} style={{ color: 'var(--accent-teal)' }} />
                                Fix-It Suggestions
                              </div>
                              <button
                                id="fixit-btn"
                                className="btn btn-outline-dark btn-sm"
                                onClick={handleFixIt}
                                disabled={fixLoading}
                                aria-label="Get parameter adjustment suggestions"
                              >
                                {fixLoading ? <Spinner size={14} /> : <Settings size={14} />}
                                {fixLoading ? 'Computing…' : 'Get Suggestions'}
                              </button>
                            </div>
                            {fixIt && (
                              <div className="animate-in">
                                <div
                                  className="flex items-center gap-2"
                                  style={{ marginBottom: 12 }}
                                >
                                  <span className="stat-label">Original verdict:</span>
                                  <VerdictBadge verdict={fixIt.original_verdict} />
                                  <span className="stat-label">
                                    Score: {fixIt.original_score.toFixed(0)}/100
                                  </span>
                                </div>
                                {fixIt.suggestions.map((s, i) => (
                                  <div
                                    key={i}
                                    style={{
                                      borderTop: '1px solid var(--hairline-dark)',
                                      paddingTop: 14,
                                      marginTop: 14,
                                    }}
                                  >
                                    <div className="flex items-center gap-2 mb-2">
                                      <VerdictBadge verdict={s.new_verdict} />
                                      <span className="stat-label">
                                        Score: {s.new_score.toFixed(0)}/100
                                      </span>
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 14,
                                        fontWeight: 600,
                                        color: 'var(--on-dark)',
                                        marginBottom: 4,
                                      }}
                                    >
                                      {s.change_description}
                                    </div>
                                    <div style={{ fontSize: 13, color: 'var(--stone)' }}>
                                      {s.tradeoff}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === 'explanation' && result.explanation && (
                      <ExplanationCard explanation={result.explanation} audience="rm" />
                    )}
                  </div>

                  <Disclaimer text={result.disclaimer} className="mt-4" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

// ── ELNForm ────────────────────────────────────────────────────────────────

interface ELNFormProps { config: ELNConfig; onChange: (c: ELNConfig) => void; }

const ELNForm: React.FC<ELNFormProps> = ({ config, onChange }) => {
  const set = <K extends keyof ELNConfig>(k: K, v: ELNConfig[K]) =>
    onChange({ ...config, [k]: v });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
      <div className="form-group">
        <label className="form-label" htmlFor="eln-monitoring">Barrier Monitoring</label>
        <select
          id="eln-monitoring"
          className="form-select"
          value={config.barrier_monitoring}
          onChange={(e) =>
            set('barrier_monitoring', e.target.value as ELNConfig['barrier_monitoring'])
          }
        >
          <option value="maturity">At maturity only</option>
          <option value="daily">Daily (continuous)</option>
        </select>
      </div>
      <div className="form-group">
        <label
          className="flex items-center gap-3"
          style={{ fontSize: 14, cursor: 'pointer', fontWeight: 400 }}
        >
          <input
            id="eln-conditional"
            type="checkbox"
            checked={config.coupon_conditional}
            onChange={(e) => set('coupon_conditional', e.target.checked)}
            style={{ accentColor: 'var(--primary)', width: 16, height: 16 }}
          />
          <span style={{ color: 'var(--on-dark-mute)' }}>Coupon conditional on barrier</span>
        </label>
      </div>
      <PrincipalField
        value={config.principal}
        currency={config.currency}
        onChange={(v) => set('principal', v)}
        onCurrencyChange={(v) => set('currency', v)}
      />
    </div>
  );
};

// ── CPNForm ────────────────────────────────────────────────────────────────

interface CPNFormProps { config: CPNConfig; onChange: (c: CPNConfig) => void; }

const CPNForm: React.FC<CPNFormProps> = ({ config, onChange }) => {
  const set = <K extends keyof CPNConfig>(k: K, v: CPNConfig[K]) =>
    onChange({ ...config, [k]: v });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
      <div className="form-group">
        <label className="form-label" htmlFor="cpn-cap">Cap (optional, %)</label>
        <input
          id="cpn-cap"
          type="number"
          className="form-input"
          min={0} max={500} step={5}
          placeholder="No cap"
          value={config.cap_pct != null ? config.cap_pct * 100 : ''}
          onChange={(e) => set('cap_pct', e.target.value ? +e.target.value / 100 : null)}
        />
      </div>
      <PrincipalField
        value={config.principal}
        currency={config.currency}
        onChange={(v) => set('principal', v)}
        onCurrencyChange={(v) => set('currency', v)}
      />
    </div>
  );
};

// ── DCDForm ────────────────────────────────────────────────────────────────

interface DCDFormProps { config: DCDConfig; onChange: (c: DCDConfig) => void; }

const DCDForm: React.FC<DCDFormProps> = ({ config, onChange }) => {
  const set = <K extends keyof DCDConfig>(k: K, v: DCDConfig[K]) =>
    onChange({ ...config, [k]: v });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SliderField
        id="dcd-tenor" label="Tenor" value={config.tenor_months}
        min={3} max={36} step={1} format={(v) => `${v}m`}
        onChange={(v) => set('tenor_months', v)}
      />
      <div className="form-group">
        <label className="form-label" htmlFor="dcd-strike">Strike (FX rate)</label>
        <input
          id="dcd-strike"
          type="number"
          className="form-input mono"
          min={0.01} step={0.25}
          value={config.strike}
          onChange={(e) => set('strike', +e.target.value)}
        />
      </div>
      <SliderField
        id="dcd-interest" label="Interest p.a." value={config.interest_pa}
        min={0} max={0.30} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`}
        onChange={(v) => set('interest_pa', v)}
      />
      <div className="grid-2" style={{ gap: 10 }}>
        <div className="form-group">
          <label className="form-label" htmlFor="dcd-base">Base Currency</label>
          <input
            id="dcd-base"
            className="form-input"
            value={config.base_currency}
            onChange={(e) => set('base_currency', e.target.value.toUpperCase())}
            maxLength={3}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="dcd-alt">Alt Currency</label>
          <input
            id="dcd-alt"
            className="form-input"
            value={config.alt_currency}
            onChange={(e) => set('alt_currency', e.target.value.toUpperCase())}
            maxLength={3}
          />
        </div>
      </div>
      <PrincipalField
        value={config.principal}
        currency={config.currency}
        onChange={(v) => set('principal', v)}
        onCurrencyChange={(v) => set('currency', v)}
      />
    </div>
  );
};

// ── SliderField ────────────────────────────────────────────────────────────

interface SliderFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

const SliderField: React.FC<SliderFieldProps> = ({
  id, label, value, min, max, step, format, onChange,
}) => (
  <div className="slider-group">
    <div className="slider-header">
      <label className="form-label" htmlFor={id}>{label}</label>
      <span className="slider-value">{format(value)}</span>
    </div>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(+e.target.value)}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={format(value)}
    />
  </div>
);

// ── PrincipalField ─────────────────────────────────────────────────────────

interface PrincipalFieldProps {
  value: number;
  currency: string;
  onChange: (v: number) => void;
  onCurrencyChange: (v: string) => void;
}

const PrincipalField: React.FC<PrincipalFieldProps> = ({
  value, currency, onChange, onCurrencyChange,
}) => (
  <div className="form-group">
    <label className="form-label" htmlFor="principal-input">Principal</label>
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        id="principal-input"
        type="number"
        className="form-input mono"
        min={1} step={100000}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={{ flex: 1 }}
      />
      <select
        className="form-select"
        value={currency}
        onChange={(e) => onCurrencyChange(e.target.value)}
        style={{ width: 80 }}
        aria-label="Currency"
      >
        {['INR', 'USD', 'EUR', 'GBP', 'JPY'].map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </div>
  </div>
);

// ── ProfileMiniForm ────────────────────────────────────────────────────────

interface ProfileMiniFormProps {
  profile: ClientProfile;
  onChange: (p: ClientProfile) => void;
}

const ProfileMiniForm: React.FC<ProfileMiniFormProps> = ({ profile, onChange }) => {
  const set = <K extends keyof ClientProfile>(k: K, v: ClientProfile[K]) =>
    onChange({ ...profile, [k]: v });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="form-group">
        <label className="form-label" htmlFor="rm-client-name">Client Name</label>
        <input
          id="rm-client-name"
          className="form-input"
          value={profile.client_name}
          onChange={(e) => set('client_name', e.target.value)}
          placeholder="e.g. Priya Sharma"
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="rm-risk">Risk Appetite</label>
        <select
          id="rm-risk"
          className="form-select"
          value={profile.risk_appetite}
          onChange={(e) => set('risk_appetite', e.target.value as ClientProfile['risk_appetite'])}
        >
          <option value="conservative">Conservative</option>
          <option value="moderate">Moderate</option>
          <option value="aggressive">Aggressive</option>
        </select>
      </div>
      <SliderField
        id="rm-horizon" label="Horizon" value={profile.horizon_months}
        min={3} max={36} step={1} format={(v) => `${v}m`}
        onChange={(v) => set('horizon_months', v)}
      />
      <SliderField
        id="rm-loss-tol" label="Loss Tolerance" value={profile.loss_tolerance_pct}
        min={0} max={50} step={1} format={(v) => `${v}%`}
        onChange={(v) => set('loss_tolerance_pct', v)}
      />
      <div className="form-group">
        <label className="form-label" htmlFor="rm-invest">Investment Amount (₹)</label>
        <input
          id="rm-invest"
          className="form-input mono"
          type="number"
          min={1} step={100000}
          value={profile.investment_amount}
          onChange={(e) => set('investment_amount', +e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="rm-assets">Investable Assets (₹)</label>
        <input
          id="rm-assets"
          className="form-input mono"
          type="number"
          min={1} step={100000}
          value={profile.investable_assets}
          onChange={(e) => set('investable_assets', +e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="rm-exp">Experience</label>
        <select
          id="rm-exp"
          className="form-select"
          value={profile.experience}
          onChange={(e) => set('experience', e.target.value as ClientProfile['experience'])}
        >
          <option value="novice">Novice</option>
          <option value="intermediate">Intermediate</option>
          <option value="experienced">Experienced</option>
        </select>
      </div>
    </div>
  );
};

export default RMPage;
