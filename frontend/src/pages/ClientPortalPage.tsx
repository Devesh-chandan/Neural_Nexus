import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  XCircle,
  Layers,
  Maximize2,
  PieChart as PieIcon,
  Sparkles,
  TrendingUp,
  UserCog,
  X,
} from 'lucide-react';
import { fetchCases, runAnalysis, runAssessment } from '../api';
import { useAuth } from '../hooks/useAuth';
import type {
  AnalyzeResponse,
  AssessmentCheckKey,
  AssessmentResponse,
  AssessmentStatus,
  CheckStatus,
  ClientProfile,
  ProductConfig,
} from '../types';
import { Alert, LoadingOverlay, ProductPill, Spinner, StatBox, Disclaimer } from '../components/UIKit';
import { currencySymbol } from '../lib/format';

// ── Helpers ────────────────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--stone)',
  marginBottom: 10,
};

const subCard: React.CSSProperties = {
  padding: 14,
  background: 'var(--surface-deep)',
  border: '1px solid var(--hairline-dark)',
};

const inr = (n: number) => {
  if (n >= 1_00_00_000) return `₹${+(n / 1_00_00_000).toFixed(2)}Cr`;
  if (n >= 1_00_000) return `₹${+(n / 1_00_000).toFixed(2)}L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

/** An amount in the product's own currency (USD for an S&P 500 note, the base currency for a DCD). */
const productMoney = (n: number, ccy: string) =>
  ccy === 'INR' ? inr(n) : `${currencySymbol(ccy)}${Math.round(n).toLocaleString('en-US')}`;

const PIE_COLORS = ['#4f55f1', '#ec7e00', '#5a5f6e'];

const VERDICT_CLASS: Record<AssessmentStatus, string> = {
  SUITABLE: 'SUITABLE',
  REVIEW_REQUIRED: 'CONDITIONALLY_SUITABLE',
  NOT_SUITABLE: 'NOT_SUITABLE',
};
const VERDICT_LABEL: Record<AssessmentStatus, string> = {
  SUITABLE: 'Suitable',
  REVIEW_REQUIRED: 'Review Required',
  NOT_SUITABLE: 'Not Suitable',
};

const PRODUCT_BLURB: Record<ProductConfig['product_type'], string> = {
  ELN: 'Equity-Linked Note — pays a coupon, but your capital is at risk if the underlying falls below the barrier at maturity.',
  CPN: 'Capital Protected Note — a floor protects most of your principal while you participate in part of the upside.',
  DCD: 'Dual Currency Deposit — earns enhanced interest, but may be repaid in the alternate currency at the strike rate.',
};

function keyTerms(p: ProductConfig): { label: string; value: string }[] {
  const pctf = (v: number) => `${(v * 100).toFixed(1)}%`;
  switch (p.product_type) {
    case 'ELN':
      return [
        { label: 'Coupon', value: `${pctf(p.coupon_pa)} p.a.${p.coupon_conditional ? ' (conditional)' : ''}` },
        { label: 'Barrier', value: `${pctf(p.barrier_pct)} of initial` },
        { label: 'Monitoring', value: p.barrier_monitoring },
      ];
    case 'CPN':
      return [
        { label: 'Protection', value: pctf(p.protection_pct) },
        { label: 'Participation', value: pctf(p.participation_pct) },
        { label: 'Cap', value: p.cap_pct != null ? pctf(p.cap_pct) : 'None' },
      ];
    case 'DCD':
      return [
        { label: 'Interest', value: `${pctf(p.interest_pa)} p.a.` },
        { label: 'Strike', value: String(p.strike) },
        { label: 'Currencies', value: `${p.base_currency}/${p.alt_currency}` },
      ];
  }
}

// ── Page ───────────────────────────────────────────────────────────────────

const ClientPortalPage: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [product, setProduct] = useState<ProductConfig | null>(null);
  const [assessment, setAssessment] = useState<AssessmentResponse | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [fullScreen, setFullScreen] = useState<'none' | 'whatif' | 'reasoning'>('none');

  // Load the client's own case (GET /cases returns only cases they own) with the RM's product.
  useEffect(() => {
    fetchCases()
      .then((res) => {
        const own = res.cases[0];
        if (!own) {
          setError('No client record found for your account yet. Complete your profile first.');
          return;
        }
        setCaseId(own.case_id);
        setProfile({ ...own.profile, client_name: own.profile?.client_name || own.client_name });
        setProduct(own.product_config ?? null);
      })
      .catch(() => setError('Could not load your portal. Is the backend running?'))
      .finally(() => setLoading(false));
  }, []);

  // Run the RM-recommended product against this client: Module 3 reasoning + payoff/MC for the what-if.
  const productKey = JSON.stringify(product);
  useEffect(() => {
    if (!caseId || !product || !profile) return;
    let cancelled = false;
    setInsightLoading(true);
    setInsightError(null);
    Promise.allSettled([
      runAssessment(caseId, product),
      // Read-only view of the RM's recommendation: computed fresh, not written to runs/audit.
      runAnalysis({ product, profile, include_monte_carlo: true, case_id: caseId, persist: false }),
    ]).then(([a, m]) => {
      if (cancelled) return;
      if (a.status === 'fulfilled') setAssessment(a.value);
      if (m.status === 'fulfilled') setAnalysis(m.value);
      if (a.status === 'rejected' && m.status === 'rejected') {
        setInsightError('Could not analyse the recommended product right now.');
      }
      setInsightLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, productKey]);

  useEffect(() => {
    if (fullScreen === 'none') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullScreen('none');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreen]);

  // ── Derived chart data ───────────────────────────────────────────────────

  // All slices in INR: the product's principal is converted with the backend's latest FX close.
  const allocation = useMemo(() => {
    if (!profile) return [];
    const total = profile.investable_assets || 0;
    const plannedInr = product ? analysis?.principal_inr ?? null : profile.investment_amount ?? null;
    const newAmt = Math.min(plannedInr ?? 0, total);
    const concentrated = (total * (profile.existing_exposure_underlying_pct || 0)) / 100;
    const other = Math.max(total - newAmt - concentrated, 0);
    return [
      { name: product ? 'Recommended product' : 'Planned investment', value: newAmt },
      { name: 'Largest existing position', value: concentrated },
      { name: 'Other / liquid', value: other },
    ].filter((s) => s.value > 0);
  }, [profile, product, analysis]);

  const whatIf = useMemo(() => {
    const mc = analysis?.metrics.monte_carlo;
    const curve = analysis?.metrics.payoff_curve;
    if (!analysis || !product || !profile || !mc || !curve?.length) return null;
    const total = profile.investable_assets;
    // Payoffs are in the product currency; fx converts them to INR like the client's wealth.
    const fx = analysis.fx.inr_per_unit;
    const P = product.principal;
    const pInr = analysis.principal_inr;
    const rest = Math.max(total - pInr, 0);
    const fdRate = analysis.metrics.fd_baseline.rate_pa;
    const years = product.tenor_months / 12;

    // The Monte Carlo fan holds underlying price ratios (1.0 = unchanged). Convert each to the
    // product's value with the payoff curve (value if it matured at that price), accrued
    // pro-rata over the tenor so every line starts at the amount invested.
    const sorted = [...curve].sort((x, y) => x.x - y.x);
    const payoffAt = (ratio: number) => {
      if (ratio <= sorted[0].x) return sorted[0].final;
      const last = sorted[sorted.length - 1];
      if (ratio >= last.x) return last.final;
      let i = 1;
      while (sorted[i].x < ratio) i++;
      const [l, r] = [sorted[i - 1], sorted[i]];
      return l.final + ((ratio - l.x) / (r.x - l.x)) * (r.final - l.final);
    };
    const idx = (target: number) =>
      mc.fan_percentiles.reduce((best, p, i) => (Math.abs(p - target) < Math.abs(mc.fan_percentiles[best] - target) ? i : best), 0);
    const [lo, mid, hi] = [idx(10), idx(50), idx(90)];
    const valueAt = (path: number, t: number) => rest + (P + (payoffAt(mc.fan_paths[path][t]) - P) * mc.fan_x_points[t]) * fx;

    const rows = mc.fan_x_points.map((f, i) => ({
      month: +(f * product.tenor_months).toFixed(1),
      median: Math.round(valueAt(mid, i)),
      low: Math.round(valueAt(lo, i)),
      high: Math.round(valueAt(hi, i)),
      fd: Math.round(rest + pInr * (1 + fdRate * f * years)),
    }));
    const last = rows[rows.length - 1];
    return { rows, total, last };
  }, [analysis, product, profile]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="band-dark" style={{ minHeight: '80vh' }}>
        <div className="page-container">
          <LoadingOverlay message="Loading your portal…" />
        </div>
      </div>
    );
  }

  const clientExpl = assessment?.explanation?.client;
  const metrics = analysis?.metrics;
  const clientName = profile?.client_name || user?.client_name || 'Client';

  const whatIfChart = (height: number) =>
    whatIf && (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={whatIf.rows} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="month" type="number" domain={[0, 'dataMax']} tick={{ fontSize: 10 }} stroke="var(--stone)" tickFormatter={(v) => `${Math.round(v)}m`} />
          <YAxis
            tick={{ fontSize: 10 }}
            stroke="var(--stone)"
            width={62}
            domain={[
              (min: number) => Math.floor((min * 0.995) / 10_000) * 10_000,
              (max: number) => Math.ceil((max * 1.005) / 10_000) * 10_000,
            ]}
            tickFormatter={(v) => inr(v)}
          />
          <Tooltip
            contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--hairline-dark)', borderRadius: 8, fontSize: 12, color: 'var(--on-dark)' }}
            formatter={(v: unknown, name: unknown) => [inr(Number(v)), String(name)]}
            labelFormatter={(l) => `Month ${Math.round(Number(l))}`}
          />
          <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="high" name="Good case (P90)" stroke="#00a87e" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
          <Line type="monotone" dataKey="median" name="With recommendation (median)" stroke="#4f55f1" strokeWidth={2.75} dot={false} />
          <Line type="monotone" dataKey="low" name="Weak case (P10)" stroke="#e23b4a" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
          <Line type="monotone" dataKey="fd" name="Fixed deposit instead" stroke="#ec7e00" strokeWidth={1.75} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );

  const renderReasoning = (full: boolean) => (
    <>
      {!product && (
        <EmptyState icon={<Sparkles size={36} />} title="No recommendation yet" body="Once your relationship manager recommends a product, the reasoning will appear here." />
      )}
      {product && insightLoading && !assessment && <div className="text-center py-4"><Spinner size={16} label="Preparing explanation…" /></div>}
      {product && insightError && !assessment && <Alert variant="error">{insightError}</Alert>}
      {clientExpl && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            {!full && <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--on-dark)', marginBottom: 6 }}>{clientExpl.headline}</div>}
            <p style={{ fontSize: 13, color: 'var(--on-dark-mute)', lineHeight: 1.7, margin: 0 }}>{clientExpl.summary}</p>
          </div>
          {/* The full-screen view already shows each check's explanation inside its visual card. */}
          {!full && Object.entries(clientExpl.checks).map(([k, text]) => (
            <div key={k} style={{ ...subCard, fontSize: 12.5, lineHeight: 1.6, color: 'var(--on-dark-mute)' }}>
              <div style={{ ...sectionLabel, marginBottom: 4 }}>{k.replace(/_/g, ' ')}</div>
              {text}
            </div>
          ))}
          {clientExpl.next_steps?.length > 0 && (
            <div>
              <div style={sectionLabel}>Next steps</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--on-dark-mute)', lineHeight: 1.7 }}>
                {clientExpl.next_steps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      {/* ── Header band ──────────────────────────────────────────────────── */}
      <div className="band-dark" style={{ paddingBottom: 0 }}>
        <div className="page-container" style={{ maxWidth: 1440, paddingTop: 24 }}>
          <div className="rm-nav-bar">
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--on-dark)' }}>Welcome, {clientName}</div>
              <div style={{ fontSize: 12, color: 'var(--stone)' }}>
                Your portfolio and the product your relationship manager recommends for you
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="band-dark" style={{ minHeight: '100vh', paddingBottom: 60 }}>
        <div className="page-container page-content animate-in" style={{ maxWidth: 1440, paddingTop: 16 }}>
          {error && <Alert variant="error" className="mb-4">{error}</Alert>}

          <div className="rm-3col-layout">
            {/* ── LEFT: profile + LLM reasoning ─────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <div className="rm-financial-card">
                <div style={sectionLabel} className="flex items-center gap-1">
                  <UserCog size={13} /> My Profile
                </div>
                {profile && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                    {[
                      ['Risk', profile.risk_appetite],
                      ['Horizon', `${profile.horizon_months} months`],
                      ['Max loss', `${profile.loss_tolerance_pct}%`],
                      ['Assets', inr(profile.investable_assets)],
                      ['Experience', profile.experience],
                      ['Planned amount', profile.investment_amount != null ? inr(profile.investment_amount) : 'Not stated'],
                      ...(profile.annual_income ? [['Annual income', inr(profile.annual_income)]] : []),
                      ...(profile.employment_status ? [['Employment', profile.employment_status]] : []),
                      ['KYC', profile.kyc_verified ? 'Verified' : 'Pending'],
                    ].map(([l, v]) => (
                      <div key={l} className="flex justify-between" style={{ fontSize: 13, borderBottom: '1px solid var(--hairline-dark)', paddingBottom: 8 }}>
                        <span style={{ color: 'var(--stone)' }}>{l}</span>
                        <span style={{ color: 'var(--on-dark)', fontWeight: 600, textTransform: 'capitalize' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Link to="/client/profile" className="btn btn-primary btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
                  Update my details
                </Link>
                <p style={{ fontSize: 11, color: 'var(--stone)', margin: '10px 0 0' }}>
                  Changes are saved and visible to your relationship manager.
                </p>
              </div>

            </div>

            {/* ── CENTER: recommended product ───────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <div className="rm-green-card" style={{ cursor: 'default' }}>
                <div className="rm-green-header">
                  <div className="flex items-center gap-2">
                    <span className="rm-green-badge">Recommended for you</span>
                    {product && <ProductPill type={product.product_type} />}
                  </div>
                </div>

                {!product ? (
                  <EmptyState
                    icon={<Layers size={48} />}
                    title="No product recommended yet"
                    body="Your relationship manager hasn't assigned a product to your profile. Keep your details up to date so they can tailor one for you."
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
                      <div className="card" style={subCard}>
                        <div style={sectionLabel}>1 · What it is</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--on-dark)', marginBottom: 6 }}>
                          {product.product_type} on {product.underlying}
                        </div>
                        <p style={{ fontSize: 12.5, color: 'var(--on-dark-mute)', lineHeight: 1.6, margin: 0 }}>
                          {PRODUCT_BLURB[product.product_type]}
                        </p>
                      </div>
                      <div className="card" style={subCard}>
                        <div style={sectionLabel}>2 · Key terms</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                          {[
                            { label: 'Amount', value: productMoney(product.principal, product.currency) },
                            ...(product.currency !== 'INR' && analysis ? [{ label: 'In INR', value: `≈ ${inr(analysis.principal_inr)}` }] : []),
                            { label: 'Tenor', value: `${product.tenor_months} months` },
                            ...keyTerms(product),
                          ].map((t) => (
                            <div key={t.label} className="flex justify-between">
                              <span style={{ color: 'var(--stone)' }}>{t.label}</span>
                              <span style={{ color: 'var(--on-dark)', fontWeight: 600, textTransform: 'capitalize' }}>{t.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="card" style={subCard}>
                        <div style={sectionLabel}>3 · Risk &amp; return</div>
                        {insightLoading && !metrics ? (
                          <Spinner size={14} />
                        ) : metrics ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                            <div className="flex justify-between"><span style={{ color: 'var(--stone)' }}>Best case</span><span style={{ color: 'var(--accent-teal)', fontWeight: 600 }}>+{(metrics.max_gain_pct * 100).toFixed(1)}%</span></div>
                            <div className="flex justify-between"><span style={{ color: 'var(--stone)' }}>Worst case</span><span style={{ color: 'var(--accent-danger)', fontWeight: 600 }}>{(metrics.max_loss_pct * 100).toFixed(1)}%</span></div>
                            {metrics.monte_carlo && (
                              <div className="flex justify-between"><span style={{ color: 'var(--stone)' }}>Chance of loss</span><span style={{ color: 'var(--on-dark)', fontWeight: 600 }}>{(metrics.monte_carlo.p_loss * 100).toFixed(1)}%</span></div>
                            )}
                            <div className="flex justify-between"><span style={{ color: 'var(--stone)' }}>Fixed deposit</span><span style={{ color: 'var(--on-dark)', fontWeight: 600 }}>+{(metrics.fd_baseline.annualised_return * 100).toFixed(1)}% p.a.</span></div>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--stone)' }}>Not available</span>
                        )}
                      </div>
                    </div>
                    {assessment && <Disclaimer text={assessment.disclaimer} />}
                  </div>
                )}
              </div>
            </div>

            {/* ── RIGHT: corpus + what-if ───────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <div className="rm-purple-card" style={{ cursor: 'default' }}>
                <div className="rm-purple-header">
                  <span className="rm-purple-badge flex items-center gap-1">
                    <PieIcon size={11} /> My Corpus
                  </span>
                  {profile && <span className="mono" style={{ fontSize: 12, color: 'var(--stone)' }}>{inr(profile.investable_assets)}</span>}
                </div>
                {allocation.length === 0 ? (
                  <EmptyState icon={<PieIcon size={36} />} title="No investment details" body="Add your assets in your profile." />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={210}>
                      <PieChart>
                        <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="none">
                          {allocation.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--hairline-dark)', borderRadius: 8, fontSize: 12, color: 'var(--on-dark)' }}
                          formatter={(v: unknown) => inr(Number(v))}
                        />
                        </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0 12px' }}>
                      {allocation.map((a, i) => (
                        <div key={a.name} className="flex justify-between" style={{ fontSize: 12.5 }}>
                          <span className="flex items-center gap-2" style={{ color: 'var(--on-dark-mute)' }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                            {a.name}
                          </span>
                          <span className="mono" style={{ color: 'var(--on-dark)' }}>
                            {inr(a.value)} · {((a.value / (profile?.investable_assets || 1)) * 100).toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                    {whatIf && (
                      <div className="stat-grid" style={{ marginTop: 10 }}>
                        <StatBox
                          label="After tenor (median)"
                          value={inr(whatIf.last.median)}
                          subtext={`${((whatIf.last.median / whatIf.total - 1) * 100).toFixed(1)}% vs today`}
                          color={whatIf.last.median >= whatIf.total ? 'positive' : 'negative'}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

            </div>
          </div>

          {/* ── 50 / 50: What-if beside AI rationale ───────────────────── */}
          <div className="cp-split">
            <div style={{ minWidth: 0 }}>
              <div className="rm-green-card" style={{ cursor: 'default' }}>
                <div className="rm-green-header">
                  <span className="rm-green-badge flex items-center gap-1">
                    <TrendingUp size={11} /> What-if
                  </span>
                  {whatIf && (
                    <button className="btn btn-outline-dark btn-sm" style={{ height: 30, padding: '2px 10px', fontSize: 12 }} onClick={() => setFullScreen('whatif')}>
                      <Maximize2 size={13} /> Full Screen
                    </button>
                  )}
                </div>
                {whatIf ? (
                  <>
                    <p style={{ fontSize: 12, color: 'var(--on-dark-mute)', margin: '0 0 8px' }}>
                      Projected total corpus if you follow the recommendation, compared with a fixed deposit.
                    </p>
                    {whatIfChart(400)}
                  </>
                ) : insightLoading ? (
                  <div className="text-center py-4"><Spinner size={16} label="Simulating…" /></div>
                ) : (
                  <EmptyState icon={<BarChart3 size={36} />} title="No projection yet" body="The what-if graph appears once a product is recommended." />
                )}
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="rm-purple-card" style={{ cursor: 'default' }}>
                <div className="rm-purple-header">
                  <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                    <span className="rm-purple-badge flex items-center gap-1">
                      <Sparkles size={11} /> AI Rationale
                    </span>
                    {assessment && (
                      <span className={`verdict-badge ${VERDICT_CLASS[assessment.assessment.overall_status]}`} role="status">
                        {VERDICT_LABEL[assessment.assessment.overall_status]}
                      </span>
                    )}
                  </div>
                  {clientExpl && (
                    <button className="btn btn-outline-dark btn-sm" style={{ height: 30, padding: '2px 10px', fontSize: 12 }} onClick={() => setFullScreen('reasoning')}>
                      <Maximize2 size={13} /> Full Screen
                    </button>
                  )}
                </div>
                <div style={{ maxHeight: 560, overflowY: 'auto', paddingRight: 4 }}>{renderReasoning(false)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Full-screen views ───────────────────────────────────────────── */}
      {fullScreen !== 'none' && (
        <div className="rm-fullscreen-overlay">
          <div className={`rm-fullscreen-dialog ${fullScreen === 'whatif' ? 'green-theme' : 'purple-theme'}`}>
            <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
              <span className={fullScreen === 'whatif' ? 'rm-green-badge' : 'rm-purple-badge'}>
                {fullScreen === 'whatif' ? 'What-if' : 'AI Rationale'}
              </span>
              <button className="btn btn-outline-dark btn-sm" onClick={() => setFullScreen('none')} aria-label="Close full screen">
                <X size={14} /> Close
              </button>
            </div>
            <div style={{ overflowY: 'auto' }}>
              {fullScreen === 'whatif' ? (
                whatIfChart(460)
              ) : (
                <>
                  {assessment && clientExpl && (
                    <ReasoningVisual assessment={assessment} headline={clientExpl.headline} checkText={clientExpl.checks} />
                  )}
                  {renderReasoning(true)}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ── Visual explanation (full-screen view) ──────────────────────────────────

const STATUS_COLOR: Record<CheckStatus, string> = { PASS: '#00a87e', REVIEW: '#ec7e00', FAIL: '#e23b4a' };
const STATUS_TEXT: Record<CheckStatus, string> = { PASS: 'Within your limits', REVIEW: 'Worth a conversation', FAIL: 'Outside your limits' };
const STATUS_ICON: Record<CheckStatus, React.ReactNode> = {
  PASS: <CheckCircle2 size={16} />,
  REVIEW: <AlertTriangle size={16} />,
  FAIL: <XCircle size={16} />,
};
const VERDICT_COLOR: Record<AssessmentStatus, string> = { SUITABLE: '#00a87e', REVIEW_REQUIRED: '#ec7e00', NOT_SUITABLE: '#e23b4a' };
const CHECK_TITLE: Record<AssessmentCheckKey, string> = {
  risk_appetite: 'Risk comfort',
  investment_horizon: 'Time horizon',
  loss_tolerance: 'Loss tolerance',
  concentration_risk: 'Concentration',
};
const CHECK_QUESTION: Record<AssessmentCheckKey, string> = {
  risk_appetite: 'Is this product as risky as you are comfortable with?',
  investment_horizon: 'Does the product fit the time you can keep your money invested?',
  loss_tolerance: 'Could a bad outcome stay within the loss you can accept?',
  concentration_risk: 'Would this put too much of your wealth in one place?',
};

/** Two bars on one scale: what you allow vs what the product needs. */
const LimitBars: React.FC<{ limit: number; value: number | null; unit: string; status: CheckStatus; limitLabel: string; valueLabel: string }> = ({
  limit, value, unit, status, limitLabel, valueLabel,
}) => {
  const max = Math.max(limit, value ?? 0, 1) * 1.15;
  const row = (label: string, v: number | null, color: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
      <div style={{ width: 92, color: 'var(--on-dark-mute)' }}>{label}</div>
      <div style={{ flex: 1, height: 14, background: 'rgba(255,255,255,0.06)', borderRadius: 7, overflow: 'hidden' }}>
        {v != null && <div style={{ width: `${Math.min((v / max) * 100, 100)}%`, height: '100%', background: color, borderRadius: 7, transition: 'width .6s' }} />}
      </div>
      <div style={{ width: 64, textAlign: 'right', color: 'var(--on-dark)', fontWeight: 600 }}>{v == null ? 'n/a' : `${+v.toFixed(1)}${unit}`}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {row(limitLabel, limit, '#8a90a6')}
      {row(valueLabel, value, STATUS_COLOR[status])}
    </div>
  );
};

const ReasoningVisual: React.FC<{ assessment: AssessmentResponse; headline: string; checkText?: Record<string, string> }> = ({ assessment, headline, checkText }) => {
  const { overall_status, checks } = assessment.assessment;
  const keys = Object.keys(CHECK_TITLE) as AssessmentCheckKey[];
  const counts = { PASS: 0, REVIEW: 0, FAIL: 0 } as Record<CheckStatus, number>;
  keys.forEach((k) => { counts[checks[k].status]++; });
  const worst = checks.risk_appetite.worst_simulated_return_pct;
  const color = VERDICT_COLOR[overall_status];

  const bars = (k: AssessmentCheckKey) => {
    switch (k) {
      case 'investment_horizon': {
        const c = checks.investment_horizon;
        return <LimitBars limit={c.client_limit_years} value={c.product_value_years} unit=" yrs" status={c.status} limitLabel="Your horizon" valueLabel="Product term" />;
      }
      case 'loss_tolerance': {
        const c = checks.loss_tolerance;
        return (
          <LimitBars
            limit={Math.abs(c.client_limit_pct) * 100}
            value={Math.max(0, -c.product_value_pct) * 100}
            unit="%" status={c.status} limitLabel="You can lose" valueLabel="Product could lose"
          />
        );
      }
      case 'concentration_risk': {
        const c = checks.concentration_risk;
        return (
          <LimitBars
            limit={c.client_limit_pct * 100}
            value={c.product_value_pct == null ? null : c.product_value_pct * 100}
            unit="%" status={c.status} limitLabel="Your limit" valueLabel="This investment"
          />
        );
      }
      case 'risk_appetite': {
        const c = checks.risk_appetite;
        const chip = (label: string, v: string, tone: string) => (
          <div style={{ flex: 1, minWidth: 110, padding: '8px 10px', border: `1px solid ${tone}`, borderRadius: 8 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--stone)' }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-dark)' }}>{v.replace(/_/g, ' ')}</div>
          </div>
        );
        return (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {chip('You are comfortable with', c.client_limit_category, '#8a90a6')}
            {chip('Product rated', c.product_value_category, STATUS_COLOR[c.status])}
          </div>
        );
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 20 }}>
      {/* Verdict hero */}
      <div style={{ ...subCard, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', borderColor: color }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', border: `4px solid ${color}`, display: 'grid', placeItems: 'center', color, flexShrink: 0 }}>
          {overall_status === 'SUITABLE' ? <CheckCircle2 size={34} /> : overall_status === 'REVIEW_REQUIRED' ? <AlertTriangle size={34} /> : <XCircle size={34} />}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color }}>{VERDICT_LABEL[overall_status]}</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--on-dark)', margin: '2px 0 8px' }}>{headline}</div>
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }} aria-label="Checks summary">
            {(['PASS', 'REVIEW', 'FAIL'] as CheckStatus[]).map((s) =>
              counts[s] ? <div key={s} style={{ flex: counts[s], background: STATUS_COLOR[s] }} /> : null,
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--on-dark-mute)', marginTop: 6 }}>
            {counts.PASS} of {keys.length} checks comfortably passed
            {counts.REVIEW > 0 && ` · ${counts.REVIEW} to discuss`}
            {counts.FAIL > 0 && ` · ${counts.FAIL} outside your limits`}
          </div>
        </div>
      </div>

      {/* Worst-case callout */}
      <div style={{ ...subCard, fontSize: 13, color: 'var(--on-dark-mute)', lineHeight: 1.6 }}>
        <div style={sectionLabel}>In a bad market</div>
        In our historical stress simulations, the worst outcome was a{' '}
        <strong style={{ color: worst < 0 ? '#e23b4a' : '#00a87e' }}>{worst >= 0 ? '+' : ''}{+worst.toFixed(1)}%</strong> return on your investment.
      </div>

      {/* Four checks as visual cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        {keys.map((k) => {
          const c = checks[k];
          return (
            <div key={k} style={{ ...subCard, borderLeft: `4px solid ${STATUS_COLOR[c.status]}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--on-dark)' }}>{CHECK_TITLE[k]}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: STATUS_COLOR[c.status] }}>
                  {STATUS_ICON[c.status]} {STATUS_TEXT[c.status]}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--stone)' }}>{CHECK_QUESTION[k]}</div>
              {bars(k)}
              <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--on-dark-mute)' }}>{checkText?.[k] ?? c.reason}</div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ ...subCard, fontSize: 12, color: 'var(--stone)' }}>
        Bars compare <span style={{ color: '#8a90a6' }}>what you told us</span> with what the product needs:{' '}
        <span style={{ color: STATUS_COLOR.PASS }}>green</span> is comfortable,{' '}
        <span style={{ color: STATUS_COLOR.REVIEW }}>amber</span> needs a conversation,{' '}
        <span style={{ color: STATUS_COLOR.FAIL }}>red</span> is outside your limits.
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ icon: React.ReactNode; title: string; body: string }> = ({ icon, title, body }) => (
  <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--stone)' }}>
    <div style={{ opacity: 0.3, display: 'flex', justifyContent: 'center', marginBottom: 10 }}>{icon}</div>
    <div style={{ fontSize: 15, color: 'var(--on-dark)', fontWeight: 500 }}>{title}</div>
    <div style={{ fontSize: 12.5, marginTop: 4 }}>{body}</div>
  </div>
);

export default ClientPortalPage;
