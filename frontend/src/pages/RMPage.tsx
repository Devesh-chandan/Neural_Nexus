import React, { useState, useEffect } from 'react';
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
  Layers,
  Sparkles,
  Send,
} from 'lucide-react';
import {
  runAnalysis,
  fetchUnderlyings,
  fetchMarketHistory,
  fetchProductDefaults,
  runFixIt,
  runHistoricalSimulation,
  fetchCases,
  updateCaseProductConfig,
  checkProductAuthorised,
} from '../api';

import type {
  AssessmentStatus,
  ClientProfile,
  ELNConfig,
  CPNConfig,
  DCDConfig,
  ProductConfig,
  ProductDefaults,
  UnderlyingMeta,
  AnalyzeResponse,
  FixItResponse,
  HistoricalSimulationResult,
} from '../types';
import {
  LoadingOverlay,
  Alert,
  VerdictBadge,
  Disclaimer,
  Spinner,
  ProductPill,
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
import { compactAmount, currencySymbol, formatMaxGain } from '../lib/format';

type ProductType = ProductConfig['product_type'];
const PRODUCT_TYPES: ProductType[] = ['ELN', 'CPN', 'DCD'];

const fitsProduct = (pt: ProductType, u: UnderlyingMeta) =>
  pt === 'DCD' ? u.asset_class === 'fx' : u.asset_class !== 'fx';

/** First configured DCD strike offset above spot (products.yaml grids.strike_offsets). */
function dcdStrike(u: UnderlyingMeta, d?: ProductDefaults): number | null {
  const offsets = (d?.grids.strike_offsets as number[] | undefined) ?? [];
  if (u.latest_price == null || offsets.length === 0) return null;
  return +(u.latest_price * offsets[0]).toFixed(4);
}

/**
 * Starting terms for a product type: the products.yaml defaults on the first underlying
 * with live data, denominated in that underlying's currency. A DCD strike starts from the
 * latest spot rate.
 */
function initialConfig(pt: ProductType, d: ProductDefaults, u: UnderlyingMeta): ProductConfig | null {
  const v = d.defaults as Record<string, never>;
  if (pt === 'ELN') {
    return {
      product_type: 'ELN', underlying: u.key, currency: u.currency,
      tenor_months: v.tenor_months, principal: v.principal, barrier_pct: v.barrier_pct,
      coupon_pa: v.coupon_pa, coupon_conditional: v.coupon_conditional, barrier_monitoring: v.barrier_monitoring,
    };
  }
  if (pt === 'CPN') {
    return {
      product_type: 'CPN', underlying: u.key, currency: u.currency,
      tenor_months: v.tenor_months, principal: v.principal, protection_pct: v.protection_pct,
      participation_pct: v.participation_pct, cap_pct: v.cap_pct ?? null,
    };
  }
  const strike = dcdStrike(u, d);
  if (strike == null || !u.base_currency || !u.alt_currency) return null;
  return {
    product_type: 'DCD', underlying: u.key, currency: u.base_currency,
    base_currency: u.base_currency, alt_currency: u.alt_currency,
    tenor_months: v.tenor_months, principal: v.principal, interest_pa: v.interest_pa, strike,
  };
}

/** Re-point terms at another underlying, keeping currencies (and a DCD strike) consistent with it. */
function withUnderlying(p: ProductConfig, u: UnderlyingMeta, d?: ProductDefaults): ProductConfig {
  if (p.product_type === 'DCD') {
    return {
      ...p,
      underlying: u.key,
      currency: u.base_currency ?? p.currency,
      base_currency: u.base_currency ?? p.base_currency,
      alt_currency: u.alt_currency ?? p.alt_currency,
      strike: dcdStrike(u, d) ?? p.strike,
    };
  }
  return { ...p, underlying: u.key, currency: u.currency };
}

/** Key-order independent comparison of two sets of terms. */
const canonical = (p: object) =>
  JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a], [b]) => a.localeCompare(b))));

const M3_TO_BADGE: Record<AssessmentStatus, string> = {
  SUITABLE: 'SUITABLE',
  REVIEW_REQUIRED: 'CONDITIONALLY_SUITABLE',
  NOT_SUITABLE: 'NOT_SUITABLE',
};

type ClientRow = {
  case_id: string;
  client_name: string;
  created_at: string;
  profile: ClientProfile;
  product_config?: ProductConfig | null;
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
  const activeRM = {
    rm_id: user?.rm_id ?? '',
    legal_name: user?.legal_name ?? '',
    institution: user?.institution ?? '',
  };

  const [productType, setProductType] = useState<ProductType>('ELN');
  const [products, setProducts] = useState<Partial<Record<ProductType, ProductConfig>>>({});
  const [defaults, setDefaults] = useState<Partial<Record<ProductType, ProductDefaults>>>({});
  const [setupError, setSetupError] = useState<string | null>(null);

  const [withProfile, setWithProfile] = useState(true);
  const [profile, setProfile] = useState<ClientProfile | null>(null);

  const [includeMC, setIncludeMC] = useState(true);

  const [underlyings, setUnderlyings] = useState<UnderlyingMeta[]>([]);
  const [priceHistory, setPriceHistory] = useState<{ date: string; close: number }[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  // The product + client the current result was computed for.
  const [analysedKey, setAnalysedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('payoff');

  const [fixIt, setFixIt] = useState<FixItResponse | null>(null);
  const [fixLoading, setFixLoading] = useState(false);

  // Real historical replay (/api/simulate) — loaded on demand in the Replay tab
  const [historicalResult, setHistoricalResult] = useState<HistoricalSimulationResult | null>(null);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalError, setHistoricalError] = useState<string | null>(null);

  // Clients (from the case store only)
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState('');
  const [loadingClients, setLoadingClients] = useState(false);

  // Recommendation to the client (RBAC-gated on the server)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [productCheck, setProductCheck] = useState<{ allowed: boolean; reason: string | null } | null>(null);

  // Assessment verdict for the selected client and terms (the audited suitability decision)
  const [m3Verdict, setM3Verdict] = useState<AssessmentStatus | null>(null);

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

  // Market data, product templates and the client list
  useEffect(() => {
    Promise.all([fetchUnderlyings(), ...PRODUCT_TYPES.map((pt) => fetchProductDefaults(pt))])
      .then(([u, ...templates]) => {
        const list = (u as Awaited<ReturnType<typeof fetchUnderlyings>>).underlyings;
        const byType = Object.fromEntries(
          PRODUCT_TYPES.map((pt, i) => [pt, templates[i] as ProductDefaults])
        ) as Record<ProductType, ProductDefaults>;
        setUnderlyings(list);
        setDefaults(byType);
        const built: Partial<Record<ProductType, ProductConfig>> = {};
        for (const pt of PRODUCT_TYPES) {
          const first = list.find((x) => fitsProduct(pt, x) && x.latest_price != null);
          const config = first ? initialConfig(pt, byType[pt], first) : null;
          if (config) built[pt] = config;
        }
        // Terms already loaded from a client's saved recommendation win.
        setProducts((prev) => ({ ...built, ...prev }));
      })
      .catch(() => setSetupError('Could not load market data and product templates. Is the backend running?'));

    setLoadingClients(true);
    fetchCases()
      .then((res) =>
        setClients(
          res.cases.map((c) => ({
            case_id: c.case_id,
            client_name: c.client_name,
            created_at: c.created_at,
            profile: c.profile,
            product_config: c.product_config ?? null,
          }))
        )
      )
      .catch(() => setSetupError('Could not load clients. Is the backend running?'))
      .finally(() => setLoadingClients(false));
  }, []);

  const product = products[productType] ?? null;
  const currentUnderlying = product?.underlying ?? '';
  const selectedClient = clients.find((c) => c.case_id === selectedClientId) ?? null;
  const analysisKey = JSON.stringify({ product, case: selectedClientId, withProfile });
  const resultIsCurrent = !!result && analysedKey === analysisKey;

  const setProduct = (p: ProductConfig) => setProducts((prev) => ({ ...prev, [p.product_type]: p }));

  useEffect(() => {
    if (!currentUnderlying) return;
    setLoadingHistory(true);
    setPriceHistory(null);
    fetchMarketHistory(currentUnderlying, 5)
      .then((r) => setPriceHistory(r.series))
      .catch(() => setPriceHistory(null))
      .finally(() => setLoadingHistory(false));
  }, [currentUnderlying]);

  // Server-side check: may this RM configure this product type in their jurisdiction?
  useEffect(() => {
    if (!activeRM.rm_id) {
      setProductCheck(null);
      return;
    }
    let cancelled = false;
    checkProductAuthorised(activeRM.rm_id, productType)
      .then((r) => !cancelled && setProductCheck({ allowed: r.allowed, reason: r.reason }))
      .catch(() => !cancelled && setProductCheck(null));
    return () => {
      cancelled = true;
    };
  }, [activeRM.rm_id, productType]);

  const handleAnalyze = async () => {
    if (!product) return;
    const key = analysisKey;
    setLoading(true);
    setError(null);
    setResult(null);
    setFixIt(null);
    setHistoricalResult(null);
    setHistoricalError(null);
    try {
      const res = await runAnalysis({
        product,
        profile: withProfile && profile ? profile : null,
        include_monte_carlo: includeMC,
        case_id: selectedClientId,
      });
      setResult(res);
      setAnalysedKey(key);
    } catch (err: unknown) {
      const e = err as { detail?: string };
      setError(e?.detail ?? 'Analysis failed. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  // Analyse as soon as a client is selected and the product templates are ready.
  useEffect(() => {
    if (selectedClientId && product) void handleAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId, !!product]);

  const loadHistoricalScenarios = async () => {
    if (!product) return;
    setHistoricalLoading(true);
    setHistoricalError(null);
    try {
      const res = await runHistoricalSimulation(product);
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
    if (!result?.suitability || !product || !profile) return;
    setFixLoading(true);
    try {
      const fi = await runFixIt(product, profile);
      setFixIt(fi);
    } catch (err: unknown) {
      setError((err as { detail?: string })?.detail ?? 'Fix-it failed.');
    } finally {
      setFixLoading(false);
    }
  };

  // Client Selection Handler – loads the client's profile and, if the RM has already
  // recommended a product to them, that product's terms. With nothing saved, the terms the
  // RM has in the builder stay as they are (the recommendation is only written by the
  // explicit "Recommend to client" button).
  const handleSelectClient = (client: ClientRow) => {
    const saved = client.product_config;
    if (saved) {
      setProductType(saved.product_type);
      setProduct(saved);
    }
    setSaveState('idle');
    setSaveError(null);
    setM3Verdict(null);
    setSelectedClientId(client.case_id);
    setWithProfile(true);
    setProfile(client.profile);
  };

  const recommendedMatches =
    !!selectedClient?.product_config && !!product && canonical(selectedClient.product_config) === canonical(product);
  const recommendBlocker: string | null = !selectedClient
    ? 'Select a client first.'
    : productCheck && !productCheck.allowed
    ? productCheck.reason
    : !resultIsCurrent || !result?.run_id
    ? 'Run the analysis on these terms for this client first.'
    : null;

  // Recommend the analysed terms to the selected client (server enforces the same rules).
  const recommendToClient = async () => {
    if (!selectedClient || !product || !result?.run_id || recommendBlocker) return;
    const caseId = selectedClient.case_id;
    setSaveState('saving');
    setSaveError(null);
    try {
      const saved = await updateCaseProductConfig(caseId, product, result.run_id);
      setClients((prev) => prev.map((c) => (c.case_id === caseId ? { ...c, product_config: saved.product_config } : c)));
      setSaveState('saved');
    } catch (err: unknown) {
      setSaveState('error');
      setSaveError((err as { detail?: string })?.detail ?? 'Could not save the recommendation.');
    }
  };

  const needle = clientFilter.toLowerCase();
  const filteredClients = clients.filter((c) =>
    c.client_name.toLowerCase().includes(needle) ||
    c.case_id.toLowerCase().includes(needle) ||
    (c.profile.risk_appetite || '').toLowerCase().includes(needle)
  );

  // The full-screen graph only has chart tabs; Suitability/Reasoning have no chart of their own there.
  const graphTab: Tab = activeTab === 'suitability' || activeTab === 'explanation' ? 'payoff' : activeTab;

  const selectedUnderlying = underlyings.find((u) => u.key === currentUnderlying);
  const barrierX = product?.product_type === 'ELN' ? product.barrier_pct : null;

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
                {' '}· Client <span style={{ color: 'var(--on-dark)', fontWeight: 600 }}>{selectedClient?.client_name ?? 'none selected'}</span>
                {selectedClient && (
                  <span style={{ marginLeft: 8, color: saveState === 'error' ? 'var(--accent-red, #ef4444)' : 'var(--stone)' }}>
                    · {saveState === 'saving'
                      ? 'Saving…'
                      : saveState === 'error'
                      ? 'Save failed'
                      : recommendedMatches
                      ? 'Recommended to client'
                      : selectedClient.product_config
                      ? 'Differs from the saved recommendation'
                      : 'Not yet recommended'}
                  </span>
                )}
              </div>
              {(saveError || (selectedClient && recommendBlocker && !recommendedMatches)) && (
                <div style={{ fontSize: 12, marginTop: 6, color: saveError ? 'var(--accent-danger)' : 'var(--accent-warning)' }}>
                  {saveError ?? recommendBlocker}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
              {m3Verdict && (
                <div className="flex items-center gap-2" title="Rule-based suitability on real historical replays (audited)">
                  <span style={{ fontSize: 11, color: 'var(--stone)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Suitability</span>
                  <VerdictBadge verdict={M3_TO_BADGE[m3Verdict] as never} />
                </div>
              )}

              <button
                id="recommend-to-client-btn"
                className="btn btn-primary btn-sm"
                onClick={recommendToClient}
                disabled={!!recommendBlocker || saveState === 'saving' || recommendedMatches}
                title={recommendBlocker ?? undefined}
              >
                <Send size={14} />{' '}
                {recommendedMatches ? 'Recommended' : `Recommend to ${selectedClient?.client_name?.split(' ')[0] ?? 'client'}`}
              </button>

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
              value={product ? `${product.tenor_months}m` : '—'}
            />
            <StatBox
              label="Principal"
              value={product ? compactAmount(product.principal, product.currency) : '—'}
              subtext={result && resultIsCurrent && product?.currency !== 'INR'
                ? `${product?.currency} · ≈ ${compactAmount(result.principal_inr, 'INR')} at ${result.fx.inr_per_unit.toFixed(2)}`
                : product?.currency}
            />
            <StatBox
              label="Max Gain"
              value={result ? formatMaxGain(result.metrics.max_gain_pct, result.metrics.max_gain_label) : '—'}
              color="positive"
            />
            <StatBox
              label="Max Loss"
              value={result ? `${(result.metrics.max_loss_pct * 100).toFixed(1)}%` : '—'}
              color="negative"
            />
            <StatBox
              label="FD Baseline"
              value={result ? `+${(result.metrics.fd_baseline.annualised_return * 100).toFixed(1)}%` : '—'}
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
                    {PRODUCT_TYPES.map((pt) => (
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

                {setupError && <Alert variant="error" className="mb-3">{setupError}</Alert>}

                {/* Underlying Asset */}
                <div className="card mb-3" style={{ padding: 14, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                  <div style={{ fontSize: 11, color: 'var(--stone)', marginBottom: 6 }}>Underlying</div>
                  <select
                    id="underlying-select"
                    className="form-select"
                    style={{ height: 42, fontSize: 13, paddingTop: 0, paddingBottom: 0 }}
                    value={currentUnderlying}
                    disabled={!product}
                    onChange={(e) => {
                      const meta = underlyings.find((u) => u.key === e.target.value);
                      if (product && meta) setProduct(withUnderlying(product, meta, defaults[productType]));
                    }}
                  >
                    {underlyings.length === 0 && <option value={currentUnderlying}>{currentUnderlying || 'Loading…'}</option>}
                    {underlyings.filter((u) => fitsProduct(productType, u)).map((u) => (
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
                          {currencySymbol(selectedUnderlying.currency)}{selectedUnderlying.latest_price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
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
                  {!product && !setupError && <div className="text-center py-2"><Spinner size={14} label="Loading terms…" /></div>}
                  {product?.product_type === 'ELN' && <ELNForm config={product} onChange={setProduct} />}
                  {product?.product_type === 'CPN' && <CPNForm config={product} onChange={setProduct} />}
                  {product?.product_type === 'DCD' && <DCDForm config={product} onChange={setProduct} />}
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
                  disabled={loading || !product}
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
                        { key: 'suitability', label: 'Model checks', icon: <Shield size={13} />, disabled: !result?.suitability },
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
                    {result?.run_id && (
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
                          barrierX={barrierX}
                          fdBaseline={result.metrics.fd_baseline.annualised_return}
                          height={240}
                        />
                      </div>
                    )}

                    {activeTab === 'scenarios' && (
                      <div className="card" style={{ background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)', padding: 16 }}>
                        <ScenarioTable rows={result.metrics.scenario_table} principal={product?.principal ?? 0} />
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
                          barrierX={barrierX}
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
                          <span className="rationale-who">{profile?.client_name ?? 'No client'}</span>
                        </header>
                        <div className="rationale-scroll">
                          <FormattedClientReasoning
                            text={result.explanation?.client_text || 'No client explanation was generated for this run.'}
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
                            text={result.explanation?.rm_text || 'No RM briefing was generated for this run.'}
                          />
                        </div>
                      </section>
                    </div>

                  </div>
                )}
              </div>

              {/* 4. Rule-based suitability on the real historical replay */}
              <SuitabilityAssessmentCard
                clientId={selectedClientId ?? ''}
                clientName={selectedClient?.client_name ?? ''}
                rmName={activeRM.legal_name}
                persisted={!!selectedClient && !!product}
                product={product}
                onResult={(r) => setM3Verdict(r?.assessment.overall_status ?? null)}
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
              <div className="rm-client-list">
                {loadingClients && <div className="text-center py-4"><Spinner size={14} label="Loading clients..." /></div>}
                {!loadingClients && filteredClients.map((client) => {
                  const isSelected = client.case_id === selectedClientId;
                  return (
                    <div
                      key={client.case_id}
                      className={`client-item-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleSelectClient(client)}
                    >
                      <div className="flex items-center justify-between mb-1" style={{ gap: 8 }}>
                        <span className="ci-ellipsis" title={client.client_name} style={{ fontWeight: 600, fontSize: 13, color: isSelected ? '#fff' : 'var(--on-dark-mute)' }}>
                          {client.client_name}
                        </span>
                        <span className="mono" style={{ fontSize: 10, color: 'var(--stone)', flexShrink: 0 }}>
                          {client.case_id}
                        </span>
                      </div>

                      <div className="flex items-center justify-between" style={{ fontSize: 11, gap: 8 }}>
                        <span className="ci-ellipsis" style={{ color: 'var(--stone)', textTransform: 'capitalize' }}>
                          Risk: <strong style={{ color: 'var(--on-dark-mute)' }}>{client.profile.risk_appetite}</strong>
                        </span>
                        <span className="mono" style={{ color: '#fff', flexShrink: 0 }}>
                          {compactAmount(client.profile.liquid_net_worth ?? client.profile.investable_assets, 'INR')} net worth
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

                {profile ? (
                  <ProfileSummary profile={profile} />
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--stone)' }}>Select a client to load their recorded profile.</div>
                )}
              </div>

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
                  {fullScreenView === 'graph' ? 'Analysis' : 'AI Rationale'}
                </span>
                <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--on-dark)' }}>
                  {productType} on {currentUnderlying} · {selectedClient?.client_name ?? 'no client selected'}
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
                        aria-selected={graphTab === t}
                        className={`seg-tab ${graphTab === t ? 'active' : ''}`}
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

                    {graphTab === 'payoff' && (
                      <div className="card" style={{ padding: 24, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                        <div className="card-title mb-2">Payoff curve &amp; break-even</div>
                        <PayoffChart
                          curve={result.metrics.payoff_curve}
                          breakEven={result.metrics.break_even_x}
                          barrierX={barrierX}
                          fdBaseline={result.metrics.fd_baseline.annualised_return}
                          height={420}
                        />
                      </div>
                    )}

                    {graphTab === 'scenarios' && (
                      <div className="card" style={{ padding: 24, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                        <ScenarioTable rows={result.metrics.scenario_table} principal={product?.principal ?? 0} />
                      </div>
                    )}

                    {graphTab === 'mc' && result.metrics.monte_carlo && (
                      <div className="card" style={{ padding: 24, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                        <div className="card-title mb-2">Monte Carlo fan chart (2,000 paths)</div>
                        <MCFanChart mc={result.metrics.monte_carlo} height={400} />
                      </div>
                    )}

                    {graphTab === 'replay' && result.metrics.replay && (
                      <div className="card" style={{ padding: 24, background: 'var(--surface-deep)', border: '1px solid var(--hairline-dark)' }}>
                        <HistogramChart bins={result.metrics.replay.histogram} title="Historical Replay Return Distribution" />
                      </div>
                    )}

                    {graphTab === 'replay' && (
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
        onChange={(v) => set('principal', v)}
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
        onChange={(v) => set('principal', v)}
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
        onChange={(v) => set('principal', v)}
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
  value: number; currency: string; onChange: (v: number) => void;
}
/** Principal in the product's currency, which follows the underlying (set by the backend config). */
const PrincipalField: React.FC<PrincipalFieldProps> = ({ value, currency, onChange }) => (
  <div className="form-group">
    <label className="form-label" htmlFor="principal-input" style={{ fontSize: 11 }}>Principal ({currency})</label>
    <input
      id="principal-input" type="number" className="form-input mono"
      style={{ height: 38, fontSize: 13 }} min={1} step={currency === 'INR' ? 100000 : 1000}
      value={value} onChange={(e) => onChange(+e.target.value)}
    />
  </div>
);

/** The client's recorded profile. It belongs to the client (they edit it in their portal),
 * so the RM sees it read-only and every analysis uses exactly what is on file. */
const ProfileSummary: React.FC<{ profile: ClientProfile }> = ({ profile }) => {
  const rows: [string, string][] = [
    ['Client', profile.client_name],
    ['Risk appetite', profile.risk_appetite ?? '—'],
    ['Horizon', profile.horizon_months != null ? `${profile.horizon_months} months` : '—'],
    ['Max loss', profile.loss_tolerance_pct != null ? `${profile.loss_tolerance_pct}%` : '—'],
    ['Liquid net worth', compactAmount(profile.liquid_net_worth ?? profile.investable_assets, 'INR')],
    ['Planned amount', profile.investment_amount != null ? compactAmount(profile.investment_amount, 'INR') : 'Not stated'],
    ['Experience', profile.experience ?? '—'],
    ['KYC', profile.kyc_verified ? 'Verified' : 'Not verified'],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(([label, value]) => (
        <div key={label} className="kv-row" style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--stone)' }}>{label}</span>
          <span style={{ color: 'var(--on-dark)', fontWeight: 600, textTransform: 'capitalize' }}>{value}</span>
        </div>
      ))}
    </div>
  );
};

export default RMPage;
