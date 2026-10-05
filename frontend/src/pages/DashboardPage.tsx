import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Home,
  TrendingUp,
  Table,
  RotateCcw,
  Dices,
  Shield,
  MessageSquare,
  Lock,
  Download,
  FileText,
  Check,
  X,
  ArrowLeft,
} from 'lucide-react';
import { fetchRun, fetchAudit, exportRunJson, exportRunHtml } from '../api';
import { useAuth } from '../hooks/useAuth';
import type { RunResponse, AuditResponse } from '../types';
import {
  LoadingOverlay,
  Alert,
  VerdictBadge,
  Disclaimer,
  ProductPill,
  ScoreRing,
  StatBox,
  Spinner,
} from '../components/UIKit';
import {
  PayoffChart,
  HistogramChart,
  MCFanChart,
  MetricsSummary,
  ScenarioTable,
} from '../components/Charts';
import SuitabilityPanel from '../components/SuitabilityPanel';
import ExplanationCard from '../components/ExplanationCard';
import { compactAmount, currencySymbol, formatMaxGain } from '../lib/format';

type Tab = 'overview' | 'payoff' | 'scenarios' | 'replay' | 'mc' | 'suitability' | 'explanation' | 'audit';

const DashboardPage: React.FC = () => {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();

  const [run, setRun] = useState<RunResponse | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    // Audit records are RM-only.
    Promise.all([fetchRun(runId), role === 'rm' ? fetchAudit(runId).catch(() => null) : Promise.resolve(null)])
      .then(([r, a]) => {
        setRun(r);
        setAudit(a);
      })
      .catch((err: { detail?: string }) => {
        setError(err?.detail ?? 'Failed to load run.');
      })
      .finally(() => setLoading(false));
  }, [runId, role]);

  const handleExport = async () => {
    if (!runId) return;
    setExporting(true);
    try {
      const data = await exportRunJson(runId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexus-run-${runId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('JSON export failed.');
    } finally {
      setExporting(false);
    }
  };

  const handleHtmlExport = async () => {
    if (!runId) return;
    // Open the tab synchronously so the popup blocker allows it, then fill it once the
    // authenticated request returns.
    const tab = window.open('', '_blank');
    try {
      const html = await exportRunHtml(runId);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: unknown) {
      tab?.close();
      setExportError((err as { detail?: string })?.detail ?? 'HTML export failed.');
    }
  };

  if (loading) {
    return (
      <div className="band-dark" style={{ minHeight: '80vh' }}>
        <div className="page-container">
          <LoadingOverlay message={`Loading run ${runId?.slice(0, 12)}…`} />
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="band-dark page-container page-content">
        <Alert variant="error">{error ?? 'Run not found.'}</Alert>
        <button className="btn btn-ghost mt-4" onClick={() => navigate(-1)}>
          ← Go Back
        </button>
      </div>
    );
  }

  const product = run.product;
  const metrics = run.metrics;
  const suitability = run.suitability;
  const explanation = run.explanation;
  const productType = product.product_type;

  const barrierX =
    productType === 'ELN' ? (product as { barrier_pct: number }).barrier_pct : null;

  const tabs: { key: Tab; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { key: 'overview', label: 'Overview', icon: <Home size={14} /> },
    { key: 'payoff', label: 'Payoff', icon: <TrendingUp size={14} /> },
    { key: 'scenarios', label: 'Scenarios', icon: <Table size={14} /> },
    { key: 'replay', label: 'Replay', icon: <RotateCcw size={14} />, disabled: !metrics.replay },
    { key: 'mc', label: 'Monte Carlo', icon: <Dices size={14} />, disabled: !metrics.monte_carlo },
    { key: 'suitability', label: 'Suitability', icon: <Shield size={14} />, disabled: !suitability },
    { key: 'explanation', label: 'Explanation', icon: <MessageSquare size={14} />, disabled: !explanation },
    { key: 'audit', label: 'Audit', icon: <Lock size={14} /> },
  ];

  return (
    <>
      {/* ── Header band ──────────────────────────────────────────────────── */}
      <section
        className="band-dark"
        style={{ padding: '48px 0 32px', borderBottom: '1px solid var(--hairline-dark)' }}
      >
        <div className="page-container">
          <div
            className="flex items-center justify-between"
            style={{ flexWrap: 'wrap', gap: 16 }}
          >
            <div>
              <div className="flex items-center gap-3 mb-2">
                <button
                  className="btn btn-outline-dark btn-sm"
                  onClick={() => navigate(-1)}
                  aria-label="Go back"
                >
                  <ArrowLeft size={14} /> Back
                </button>
                <ProductPill type={productType} />
              </div>
              <h1 className="display-lg" style={{ color: 'var(--on-dark)', marginBottom: 8 }}>
                Analysis Dashboard
              </h1>
              <div style={{ fontSize: 13, color: 'var(--stone)' }}>
                Run: <span className="mono">{runId}</span>
                {run.case_id && (
                  <>
                    {' '}· Case: <span className="mono">{run.case_id.slice(0, 8)}</span>
                  </>
                )}
                {' '}· {run.data_source} · As of {run.as_of}
              </div>
            </div>

            <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
              {suitability && (
                <div className="flex items-center gap-3">
                  <ScoreRing score={suitability.score} size={64} label="Score" />
                  <VerdictBadge verdict={suitability.verdict} />
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  id="export-json-btn"
                  className="btn btn-outline-dark btn-sm"
                  onClick={() => { setExportError(null); void handleExport(); }}
                  disabled={exporting}
                  aria-label="Export run as JSON"
                >
                  {exporting ? <Spinner size={12} /> : <Download size={14} />} JSON
                </button>
                <button
                  id="export-html-btn"
                  className="btn btn-outline-dark btn-sm"
                  onClick={() => { setExportError(null); void handleHtmlExport(); }}
                  aria-label="Export run as HTML report"
                >
                  <FileText size={14} /> HTML
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Key metrics bar ───────────────────────────────────────────────── */}
      <div className="band-dark" style={{ borderBottom: '1px solid var(--hairline-dark)' }}>
        <div className="page-container">
          <div
            className="stat-grid"
            style={{ borderRadius: 0 }}
          >
            <StatBox
              label="Product"
              value={productType}
              subtext={(product as { underlying?: string }).underlying ?? ''}
            />
            <StatBox
              label="Tenor"
              value={`${(product as { tenor_months: number }).tenor_months}m`}
            />
            <StatBox
              label="Principal"
              value={compactAmount(
                (product as { principal: number }).principal,
                (product as { currency: string }).currency,
              )}
              subtext={(product as { currency: string }).currency}
            />
            <StatBox label="Max Gain" value={formatMaxGain(metrics.max_gain_pct, metrics.max_gain_label)} color="positive" />
            <StatBox label="Max Loss" value={`${(metrics.max_loss_pct * 100).toFixed(1)}%`} color="negative" />
            <StatBox
              label="FD Baseline"
              value={`+${(metrics.fd_baseline.annualised_return * 100).toFixed(1)}%`}
              subtext="p.a."
            />
          </div>
          {exportError && (
            <Alert variant="error" className="mt-3">
              {exportError}
            </Alert>
          )}
          {metrics.issuer_credit && (
            <Alert variant="info" className="mt-3">
              <strong>Issuer credit risk (illustrative):</strong> a generic bank issuer has about{' '}
              {(metrics.issuer_credit.default_probability * 100).toFixed(1)}% chance of default over this
              note's life (expected loss {(metrics.issuer_credit.expected_loss_pct * 100).toFixed(2)}% of
              principal). Principal protection is only as strong as the issuer. {metrics.issuer_credit.label}
            </Alert>
          )}
          {metrics.pricing.flag === 'coupon_above_indicative' && (
            <Alert variant="warning" className="mt-3">
              Coupon exceeds the indicative fair value. Review with issuer.
            </Alert>
          )}
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="band-dark page-content">
        <div className="page-container animate-in">
          {/* Tabs */}
          <div
            className="tab-list"
            role="tablist"
            aria-label="Dashboard tabs"
          >
            {tabs.map((t) => (
              <button
                key={t.key}
                id={`dash-tab-${t.key}`}
                className={`tab-btn ${activeTab === t.key ? 'active' : ''}`}
                onClick={() => !t.disabled && setActiveTab(t.key)}
                role="tab"
                aria-selected={activeTab === t.key}
                aria-controls={`dash-panel-${t.key}`}
                disabled={t.disabled}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id={`dash-panel-${activeTab}`}
            aria-labelledby={`dash-tab-${activeTab}`}
          >
            {/* ── Overview ──────────────────────────────────────────────── */}
            {activeTab === 'overview' && (
              <div className="animate-in">
                <div className="grid-2" style={{ gap: 20, alignItems: 'start' }}>
                  {/* Left */}
                  <div>
                    <div className="card mb-4">
                      <div className="card-title mb-3">Risk Metrics</div>
                      <MetricsSummary metrics={metrics} skipHeadline />
                    </div>
                    <div className="card">
                      <div className="card-title mb-3">Product Parameters</div>
                      <table className="data-table">
                        <tbody>
                          {Object.entries(product).map(([k, v]) => (
                            <tr key={k}>
                              <td className="stat-label" style={{ width: 180 }}>{k.replace(/_/g, ' ')}</td>
                              <td className="mono" style={{ fontSize: 13 }}>{String(v)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Right */}
                  <div>
                    <div className="card mb-4">
                      <div className="card-title mb-2">Payoff Curve</div>
                      <PayoffChart
                        curve={metrics.payoff_curve}
                        breakEven={metrics.break_even_x}
                        barrierX={barrierX}
                        fdBaseline={metrics.fd_baseline.annualised_return}
                        height={220}
                      />
                    </div>
                    {suitability && <SuitabilityPanel suitability={suitability} compact />}
                  </div>
                </div>

                {explanation && (
                  <div className="mt-4">
                    <ExplanationCard explanation={explanation} audience="client" />
                  </div>
                )}
              </div>
            )}

            {/* ── Payoff ────────────────────────────────────────────────── */}
            {activeTab === 'payoff' && (
              <div className="card animate-in">
                <div className="card-title mb-1">Payoff Curve</div>
                <div className="card-subtitle">Net return at maturity vs underlying level</div>
                <PayoffChart
                  curve={metrics.payoff_curve}
                  breakEven={metrics.break_even_x}
                  barrierX={barrierX}
                  fdBaseline={metrics.fd_baseline.annualised_return}
                  height={360}
                />
                {metrics.cliff && (
                  <Alert variant="warning" className="mt-3">
                    Cliff detected: loss jumps by {metrics.cliff.loss_jump_pct_points.toFixed(1)}pp near{' '}
                    {(metrics.cliff.x_level * 100).toFixed(0)}% level.
                  </Alert>
                )}
              </div>
            )}

            {/* ── Scenarios ─────────────────────────────────────────────── */}
            {activeTab === 'scenarios' && (
              <div className="card animate-in">
                <div className="card-title mb-1">Scenario Analysis</div>
                <div className="card-subtitle mb-4">
                  Principal: {currencySymbol((product as { currency: string }).currency)}
                  {(product as { principal: number }).principal.toLocaleString('en-IN')}
                </div>
                <ScenarioTable
                  rows={metrics.scenario_table}
                  principal={(product as { principal: number }).principal}
                />
              </div>
            )}

            {/* ── Replay ────────────────────────────────────────────────── */}
            {activeTab === 'replay' && metrics.replay && (
              <div className="card animate-in">
                <div className="card-title mb-1">Historical Replay</div>
                <div className="card-subtitle mb-4">
                  {metrics.replay.n_windows} total windows · {metrics.replay.n_independent} independent
                </div>
                <div className="stat-grid mb-4">
                  <StatBox label="P(Loss)" value={`${(metrics.replay.p_loss * 100).toFixed(1)}%`} color="negative" />
                  <StatBox
                    label="Breach Frequency"
                    value={`${(metrics.replay.breach_frequency * 100).toFixed(1)}%`}
                    color="negative"
                  />
                  <StatBox
                    label="Worst Loss"
                    value={`${(metrics.replay.worst_loss_pct * 100).toFixed(1)}%`}
                    color="negative"
                  />
                  <StatBox
                    label="Median Ann. Return"
                    value={`${metrics.replay.median_annualised_return >= 0 ? '+' : ''}${(
                      metrics.replay.median_annualised_return * 100
                    ).toFixed(1)}%`}
                    color={metrics.replay.median_annualised_return >= 0 ? 'positive' : 'negative'}
                  />
                  <StatBox
                    label="CVaR 5%"
                    value={`${(metrics.replay.cvar5_loss_pct * 100).toFixed(1)}%`}
                    color="negative"
                    subtext="Tail loss"
                  />
                </div>
                <HistogramChart
                  bins={metrics.replay.histogram}
                  title="Return Distribution (Historical Replay)"
                  height={240}
                />
                {metrics.replay.crisis_presets.filter((c) => c.available).length > 0 && (
                  <div style={{ marginTop: 28 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: 'var(--on-dark)',
                        marginBottom: 14,
                      }}
                    >
                      Crisis Scenario Analysis
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table" aria-label="Crisis scenarios">
                        <thead>
                          <tr>
                            <th>Crisis Event</th>
                            <th>Start</th>
                            <th>End</th>
                            <th>Underlying Δ</th>
                            <th>Net Return</th>
                            <th>Ann. Return</th>
                            <th>Breach</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metrics.replay.crisis_presets
                            .filter((c) => c.available)
                            .map((c) => (
                              <tr key={c.name}>
                                <td style={{ fontWeight: 600, color: 'var(--on-dark)' }}>
                                  {c.label}
                                </td>
                                <td className="mono" style={{ fontSize: 12 }}>
                                  {c.start_date?.slice(0, 10) ?? '—'}
                                </td>
                                <td className="mono" style={{ fontSize: 12 }}>
                                  {c.end_date?.slice(0, 10) ?? '—'}
                                </td>
                                <td
                                  className={
                                    c.x != null && c.x < 1 ? 'text-red' : 'text-green'
                                  }
                                >
                                  {c.x != null ? `${((c.x - 1) * 100).toFixed(1)}%` : '—'}
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
                                <td
                                  className={
                                    c.annualised_return != null && c.annualised_return < 0
                                      ? 'text-red'
                                      : 'text-green'
                                  }
                                >
                                  {c.annualised_return != null
                                    ? `${(c.annualised_return * 100).toFixed(2)}%`
                                    : '—'}
                                </td>
                                <td>
                                  {c.breach != null ? (
                                    c.breach ? (
                                      <span className="text-red flex items-center gap-1" aria-label="Barrier breached">
                                        <X size={14} /> Breach
                                      </span>
                                    ) : (
                                      <span className="text-green flex items-center gap-1" aria-label="No barrier breach">
                                        <Check size={14} /> Held
                                      </span>
                                    )
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

            {/* ── Monte Carlo ───────────────────────────────────────────── */}
            {activeTab === 'mc' && metrics.monte_carlo && (
              <div className="card animate-in">
                <div className="card-title mb-1">Monte Carlo Simulation</div>
                <div className="card-subtitle mb-4">
                  {metrics.monte_carlo.n_paths.toLocaleString()} paths · Block-bootstrap · Seed{' '}
                  {metrics.monte_carlo.seed}
                </div>
                <Alert variant="info" className="mb-4">
                  Statistical model-based simulation using block-bootstrap on historical data. Not
                  a forecast.
                </Alert>
                <MCFanChart mc={metrics.monte_carlo} height={300} />
                <div className="stat-grid mt-4">
                  <StatBox
                    label="P(Loss)"
                    value={`${(metrics.monte_carlo.p_loss * 100).toFixed(1)}%`}
                    color="negative"
                    subtext="Monte Carlo"
                  />
                  <StatBox
                    label="CVaR 5%"
                    value={`${(metrics.monte_carlo.cvar5_loss_pct * 100).toFixed(1)}%`}
                    color="negative"
                    subtext="Expected tail loss"
                  />
                  <StatBox
                    label="Median Ann. Return"
                    value={`${metrics.monte_carlo.median_annualised_return >= 0 ? '+' : ''}${(
                      metrics.monte_carlo.median_annualised_return * 100
                    ).toFixed(1)}%`}
                    color={
                      metrics.monte_carlo.median_annualised_return >= 0 ? 'positive' : 'negative'
                    }
                  />
                  <StatBox
                    label="Worst Loss"
                    value={`${(metrics.monte_carlo.worst_loss_pct * 100).toFixed(1)}%`}
                    color="negative"
                  />
                </div>
                <div className="mt-4">
                  <HistogramChart
                    bins={metrics.monte_carlo.histogram}
                    title="Return Distribution (Monte Carlo)"
                    height={240}
                  />
                </div>
              </div>
            )}

            {/* ── Suitability ───────────────────────────────────────────── */}
            {activeTab === 'suitability' && suitability && (
              <SuitabilityPanel suitability={suitability} />
            )}

            {/* ── Explanation ───────────────────────────────────────────── */}
            {activeTab === 'explanation' && explanation && (
              <div className="grid-2 animate-in" style={{ gap: 20, alignItems: 'start' }}>
                <ExplanationCard explanation={explanation} audience="client" />
                <ExplanationCard explanation={explanation} audience="rm" />
              </div>
            )}

            {/* ── Audit ─────────────────────────────────────────────────── */}
            {activeTab === 'audit' && (
              <div className="card animate-in">
                <div className="card-title mb-1 flex items-center gap-2">
                  <Lock size={18} style={{ color: 'var(--accent-warning)' }} />
                  Audit Record
                </div>
                <div className="card-subtitle mb-4">
                  Tamper-evident SHA-256 hash chain · Prototype-grade control
                </div>
                {audit ? (
                  <>
                    {/* Chain status */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '14px 18px',
                        borderRadius: 'var(--r-md)',
                        background: audit.chain_ok
                          ? 'rgba(0,168,126,0.08)'
                          : 'rgba(226,59,74,0.08)',
                        border: `1px solid ${
                          audit.chain_ok
                            ? 'rgba(0,168,126,0.3)'
                            : 'rgba(226,59,74,0.3)'
                        }`,
                        marginBottom: 24,
                      }}
                      role="status"
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center' }} aria-hidden="true">
                        {audit.chain_ok ? (
                          <Check size={20} style={{ color: 'var(--accent-teal)' }} />
                        ) : (
                          <X size={20} style={{ color: 'var(--accent-danger)' }} />
                        )}
                      </span>
                      <div>
                        <div
                          style={{
                            fontWeight: 700,
                            color: audit.chain_ok ? 'var(--accent-teal)' : 'var(--accent-danger)',
                          }}
                        >
                          Chain {audit.chain_ok ? 'OK' : 'INVALID'}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--stone)' }}>
                          {audit.verify_detail}
                        </div>
                      </div>
                    </div>

                    {/* Audit fields */}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {[
                        ['Run ID', audit.record.run_id],
                        ['Verdict', audit.record.verdict],
                        ['Data Source', audit.record.data_source],
                        ['Snapshot ID', audit.record.snapshot_id],
                        ['Model', audit.record.model],
                        ['Prompt Version', audit.record.prompt_version],
                        ['Created At', audit.record.created_at],
                      ].map(([label, val]) => (
                        <div
                          key={label}
                          className="flex"
                          style={{
                            gap: 12,
                            borderBottom: '1px solid var(--hairline-dark)',
                            padding: '10px 0',
                          }}
                        >
                          <span className="stat-label" style={{ width: 140, flexShrink: 0 }}>
                            {label}
                          </span>
                          <span className="mono" style={{ fontSize: 13, wordBreak: 'break-all', color: 'var(--on-dark-mute)' }}>
                            {val}
                          </span>
                        </div>
                      ))}
                      <div
                        className="flex"
                        style={{
                          gap: 12,
                          borderBottom: '1px solid var(--hairline-dark)',
                          padding: '10px 0',
                        }}
                      >
                        <span className="stat-label" style={{ width: 140, flexShrink: 0 }}>
                          Record Hash
                        </span>
                        <span
                          className="mono"
                          style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--stone)' }}
                        >
                          {audit.record.record_hash}
                        </span>
                      </div>
                      {audit.record.prev_hash && (
                        <div className="flex" style={{ gap: 12, padding: '10px 0' }}>
                          <span className="stat-label" style={{ width: 140, flexShrink: 0 }}>
                            Prev Hash
                          </span>
                          <span
                            className="mono"
                            style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--stone)' }}
                          >
                            {audit.record.prev_hash}
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <Alert variant="info">
                    No audit record for this run. Audit is only created when a full analysis
                    (product + profile + suitability + explanation) is completed.
                  </Alert>
                )}
              </div>
            )}
          </div>

          <Disclaimer text={run.disclaimer} className="mt-6" />
        </div>
      </div>
    </>
  );
};

export default DashboardPage;
