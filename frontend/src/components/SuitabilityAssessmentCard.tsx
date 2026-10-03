import React, { useEffect, useState } from 'react';
import { ShieldCheck, Play, RotateCcw, Sparkles, FileText } from 'lucide-react';
import { runAssessment } from '../api';
import type {
  AssessmentCheckKey,
  AssessmentChecks,
  AssessmentResponse,
  AssessmentStatus,
  CheckStatus,
  ProductConfig,
} from '../types';
import { Alert, Spinner } from './UIKit';

// Module 3 status -> existing verdict-badge / rule-dot colour classes.
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
const DOT_CLASS: Record<CheckStatus, string> = { PASS: 'GREEN', REVIEW: 'AMBER', FAIL: 'RED' };
const STATUS_COLOR: Record<CheckStatus, string> = {
  PASS: 'var(--accent-teal)',
  REVIEW: 'var(--accent-warning)',
  FAIL: 'var(--accent-danger)',
};

const CHECK_LABEL: Record<AssessmentCheckKey, string> = {
  risk_appetite: 'Risk appetite',
  investment_horizon: 'Investment horizon',
  loss_tolerance: 'Loss tolerance',
  concentration_risk: 'Concentration',
};
const CHECK_KEYS = Object.keys(CHECK_LABEL) as AssessmentCheckKey[];

const pct = (fraction: number | null) => (fraction == null ? 'n/a' : `${(fraction * 100).toFixed(1)}%`);

function limitVsValue(key: AssessmentCheckKey, checks: AssessmentChecks): string {
  switch (key) {
    case 'risk_appetite':
      return `${checks.risk_appetite.client_limit_category.toLowerCase()} client · ${checks.risk_appetite.product_value_category.toLowerCase()} product`;
    case 'investment_horizon':
      return `${checks.investment_horizon.client_limit_years}y horizon · ${checks.investment_horizon.product_value_years}y tenor`;
    case 'loss_tolerance':
      return `max loss ${pct(Math.abs(checks.loss_tolerance.client_limit_pct))} · worst ${pct(checks.loss_tolerance.product_value_pct)}`;
    case 'concentration_risk':
      return `${pct(checks.concentration_risk.product_value_pct)} · limit ${pct(checks.concentration_risk.client_limit_pct)}`;
  }
}

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--stone)',
};

interface Props {
  /** Case ID of the selected client; only registered (persisted) clients can be assessed. */
  clientId: string;
  clientName: string;
  persisted: boolean;
  product: ProductConfig;
}

const SuitabilityAssessmentCard: React.FC<Props> = ({ clientId, clientName, persisted, product }) => {
  const [result, setResult] = useState<AssessmentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A result is only valid for the client and terms it was run on.
  const productKey = JSON.stringify(product);
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [clientId, productKey]);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await runAssessment(clientId, product));
    } catch (err: unknown) {
      const e = err as { detail?: string };
      setError(e?.detail ?? 'Assessment failed. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  const assessment = result?.assessment;
  const client = result?.explanation?.client;
  const rm = result?.explanation?.rm;
  const usedTemplate = [client, rm].some((e) => e?.source === 'template');
  const fallbackReason = rm?.fallback_reason ?? client?.fallback_reason ?? undefined;
  const worst = result
    ? result.simulation.scenarios.reduce((a, b) => (b.return_pct < a.return_pct ? b : a))
    : null;

  return (
    <div className="rm-purple-card" style={{ cursor: 'default' }}>
      <div className="rm-purple-header">
        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
          <span className="rm-purple-badge flex items-center gap-1">
            <ShieldCheck size={11} /> Suitability Assessment
          </span>
          {assessment && (
            <span className={`verdict-badge ${VERDICT_CLASS[assessment.overall_status]}`} role="status">
              {VERDICT_LABEL[assessment.overall_status]}
            </span>
          )}
          {result?.explanation && (
            <span
              className="mono"
              title={usedTemplate && fallbackReason ? `Template fallback: ${fallbackReason}` : undefined}
              style={{ fontSize: 11, color: 'var(--stone)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              {usedTemplate ? <FileText size={11} /> : <Sparkles size={11} />}
              {usedTemplate ? 'Template explanation' : `Groq · ${result.explanation.model}`}
            </span>
          )}
        </div>
        <button
          className="btn btn-outline-dark btn-sm"
          style={{ height: 30, padding: '2px 12px', fontSize: 12 }}
          onClick={run}
          disabled={!persisted || loading}
        >
          {loading ? <Spinner size={12} /> : result ? <RotateCcw size={13} /> : <Play size={13} />}
          {result ? 'Re-run' : 'Run assessment'}
        </button>
      </div>

      {!persisted && (
        <div style={{ fontSize: 13, color: 'var(--stone)' }}>
          Select a registered client (e.g. CLT-IN-0001) to run the rule-based suitability assessment on these terms.
        </div>
      )}

      {persisted && !result && !loading && !error && (
        <div style={{ fontSize: 13, color: 'var(--stone)' }}>
          Replays these terms on 20 real past market periods, checks them against {clientName || 'the client'}'s
          profile with the suitability rules, and explains the result for the client and for you.
        </div>
      )}

      {loading && (
        <div style={{ fontSize: 13, color: 'var(--stone)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Spinner size={14} /> Replaying history, applying the rules and writing the explanation…
        </div>
      )}

      {error && <Alert variant="error">{error}</Alert>}

      {assessment && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {rm && <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--on-dark)' }}>{rm.headline}</div>}

          {/* The four rule checks: status, limit vs value, RM explanation */}
          <div style={{ border: '1px solid var(--hairline-dark)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            {CHECK_KEYS.map((key, i) => {
              const status = assessment.checks[key].status;
              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px 12px',
                    padding: '10px 14px',
                    borderTop: i ? '1px solid var(--hairline-dark)' : undefined,
                  }}
                >
                  <div style={{ flex: '0 1 190px', minWidth: 0 }}>
                    <div className="flex items-center gap-2">
                      <span className={`rule-dot ${DOT_CLASS[status]}`} aria-hidden="true" />
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-dark)' }}>{CHECK_LABEL[key]}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[status] }}>{status}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--stone)', marginTop: 3 }}>
                      {limitVsValue(key, assessment.checks)}
                    </div>
                  </div>
                  <div style={{ flex: '1 1 260px', minWidth: 0, fontSize: 13, color: 'var(--on-dark-mute)', lineHeight: 1.5 }}>
                    {rm?.checks[key] ?? assessment.checks[key].reason}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Compliance gates (RM only) */}
          {assessment.compliance_flags && (
            <div style={{ padding: '10px 14px', border: '1px solid var(--hairline-dark)', borderRadius: 'var(--r-md)' }}>
              <div className="flex items-center gap-3" style={{ flexWrap: 'wrap', marginBottom: rm ? 6 : 0 }}>
                <span style={eyebrow}>Compliance</span>
                {Object.entries(assessment.compliance_flags).map(([name, flag]) => (
                  <span key={name} className="flex items-center gap-1" style={{ fontSize: 12, color: 'var(--on-dark-mute)' }} title={flag.reason}>
                    <span className={`rule-dot ${DOT_CLASS[flag.status]}`} aria-hidden="true" />
                    {name.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
              {rm && <div style={{ fontSize: 13, color: 'var(--on-dark-mute)', lineHeight: 1.5 }}>{rm.compliance}</div>}
            </div>
          )}

          {/* Client explanation vs RM briefing */}
          {client && (
            <div className="rationale-split">
              <section className="rationale-col">
                <header className="rationale-col-head">
                  <span className="rationale-eyebrow">What the client sees</span>
                  <span className="rationale-who">{clientName}</span>
                </header>
                <div className="rationale-scroll" style={{ fontSize: 13, color: 'var(--on-dark-mute)', lineHeight: 1.55 }}>
                  <p style={{ fontWeight: 600, color: 'var(--on-dark)', margin: '10px 0 6px' }}>{client.headline}</p>
                  <p style={{ margin: '0 0 10px' }}>{client.summary}</p>
                  <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                    {CHECK_KEYS.map((key) => (
                      <li key={key} style={{ marginBottom: 4 }}>{client.checks[key]}</li>
                    ))}
                  </ul>
                  <div style={eyebrow}>Next steps</div>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {client.next_steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              </section>

              {rm && (
                <section className="rationale-col">
                  <header className="rationale-col-head">
                    <span className="rationale-eyebrow">RM briefing</span>
                    <span className="rationale-who mono">{assessment.audit_meta.rule_set_version}</span>
                  </header>
                  <div className="rationale-scroll" style={{ fontSize: 13, color: 'var(--on-dark-mute)', lineHeight: 1.55 }}>
                    <p style={{ margin: '10px 0' }}>{rm.summary}</p>
                    <div style={eyebrow}>Actions</div>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {rm.actions.map((a, i) => <li key={i} style={{ marginBottom: 4 }}>{a}</li>)}
                    </ul>
                    {result.data_gaps.length > 0 && (
                      <>
                        <div style={{ ...eyebrow, marginTop: 10 }}>Data gaps</div>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                          {result.data_gaps.map((g, i) => <li key={i}>{g}</li>)}
                        </ul>
                      </>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}

          <div className="mono" style={{ fontSize: 11, color: 'var(--stone)', lineHeight: 1.6 }}>
            {worst && (
              <>
                Worst past period {worst.period.start} → {worst.period.end}: {worst.return_pct.toFixed(1)}% ·{' '}
              </>
            )}
            data as of {result.simulation.data_as_of} · {assessment.assessment_id}
            <div style={{ fontFamily: 'Inter, sans-serif', marginTop: 4 }}>{result.disclaimer}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuitabilityAssessmentCard;
