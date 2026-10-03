import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Trophy, ArrowRight } from 'lucide-react';
import { runRecommend, createCase } from '../api';
import type { ClientProfile, RecommendationResult } from '../types';
import { LoadingOverlay, Alert, VerdictBadge, Disclaimer, StatBox } from '../components/UIKit';
import { ProductPill } from '../components/UIKit';

// ── Step types ─────────────────────────────────────────────────────────────

type Step = 'profile' | 'results';

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_PROFILE: ClientProfile = {
  client_name: '',
  risk_appetite: 'moderate',
  horizon_months: 12,
  loss_tolerance_pct: 15,
  investable_assets: 10_000_000,
  investment_amount: 1_000_000,
  existing_exposure_underlying_pct: 0,
  existing_structured_pct: 0,
  experience: 'novice',
  target_return_pa: null,
  preferred_underlying_types: null,
  needs_liquidity_within_months: null,
};

// ── ClientPage ─────────────────────────────────────────────────────────────

const ClientPage: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('profile');
  const [profile, setProfile] = useState<ClientProfile>({ ...DEFAULT_PROFILE });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);

  const update = useCallback(<K extends keyof ClientProfile>(key: K, value: ClientProfile[K]) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile.client_name.trim()) {
      setError('Please enter a client name.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { case_id } = await createCase(profile);
      setCaseId(case_id);
      const rec = await runRecommend(profile);
      setResult(rec);
      setStep('results');
    } catch (err: unknown) {
      const e = err as { detail?: string };
      setError(e?.detail ?? 'Failed to get recommendations. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDashboard = (runId: string) => {
    navigate(`/dashboard/${runId}`);
  };

  if (loading) {
    return (
      <div className="band-dark" style={{ minHeight: '80vh' }}>
        <div className="page-container">
          <LoadingOverlay message="Analysing your profile and ranking products…" />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Page header band ─────────────────────────────────────────────── */}
      <section
        className="band-dark"
        style={{ padding: '64px 0 48px', borderBottom: '1px solid var(--hairline-dark)' }}
      >
        <div className="page-container">
          <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div className="hero-eyebrow" style={{ marginBottom: 16 }}>
                <User size={14} style={{ color: 'var(--accent-teal)' }} aria-hidden="true" />
                Client Portal
              </div>
              <h1 className="display-lg" style={{ color: 'var(--on-dark)', marginBottom: 12 }}>
                Investment Questionnaire
              </h1>
              <p style={{ fontSize: 16, color: 'var(--on-dark-mute)', maxWidth: 520 }}>
                Tell us about your investment profile and we'll recommend suitable structured products.
              </p>
            </div>
            {step === 'results' && (
              <button
                className="btn btn-outline-dark"
                onClick={() => { setStep('profile'); setResult(null); }}
                style={{ alignSelf: 'flex-start' }}
              >
                ← Start Over
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="band-dark" style={{ paddingBottom: 80 }}>
        <div className="page-container page-content animate-in">
          <meta
            name="description"
            content="Client investment questionnaire – get personalised structured product recommendations"
          />

          {error && <Alert variant="error" className="mb-6">{error}</Alert>}

          {step === 'profile' && (
            <ProfileForm profile={profile} update={update} onSubmit={handleSubmit} />
          )}

          {step === 'results' && result && (
            <RecommendationView
              result={result}
              profile={profile}
              caseId={caseId}
              onViewDashboard={handleViewDashboard}
            />
          )}
        </div>
      </div>
    </>
  );
};

// ── ProfileForm ────────────────────────────────────────────────────────────

interface ProfileFormProps {
  profile: ClientProfile;
  update: <K extends keyof ClientProfile>(key: K, val: ClientProfile[K]) => void;
  onSubmit: (e: React.FormEvent) => void;
}

const SectionCard: React.FC<{
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ title, children, style }) => (
  <div className="card" style={{ marginBottom: 20, ...style }}>
    <div
      style={{
        fontFamily: 'Inter, sans-serif',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--stone)',
        marginBottom: 20,
      }}
    >
      {title}
    </div>
    {children}
  </div>
);

const ProfileForm: React.FC<ProfileFormProps> = ({ profile, update, onSubmit }) => {
  const concentrationPct =
    profile.investable_assets > 0
      ? ((profile.investment_amount / profile.investable_assets) * 100).toFixed(1)
      : '—';

  return (
    <form onSubmit={onSubmit} aria-label="Client profile questionnaire" noValidate>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 300px',
          gap: 24,
          alignItems: 'start',
        }}
      >
        {/* Left: form sections */}
        <div>
          {/* Personal Details */}
          <SectionCard title="Personal Details">
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label" htmlFor="client-name">Client Name *</label>
                <input
                  id="client-name"
                  className="form-input"
                  type="text"
                  value={profile.client_name}
                  onChange={(e) => update('client_name', e.target.value)}
                  placeholder="e.g. Arjun Mehta"
                  required
                  autoComplete="name"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="experience">Investment Experience</label>
                <select
                  id="experience"
                  className="form-select"
                  value={profile.experience}
                  onChange={(e) => update('experience', e.target.value as ClientProfile['experience'])}
                >
                  <option value="novice">Novice – little or no experience</option>
                  <option value="intermediate">Intermediate – some structured product experience</option>
                  <option value="experienced">Experienced – regular structured product investor</option>
                </select>
              </div>
            </div>
          </SectionCard>

          {/* Risk Profile */}
          <SectionCard title="Risk Profile">
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label" htmlFor="risk-appetite">Risk Appetite</label>
                <select
                  id="risk-appetite"
                  className="form-select"
                  value={profile.risk_appetite}
                  onChange={(e) => update('risk_appetite', e.target.value as ClientProfile['risk_appetite'])}
                >
                  <option value="conservative">Conservative</option>
                  <option value="moderate">Moderate</option>
                  <option value="aggressive">Aggressive</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="target-return">Target Return p.a. (optional, %)</label>
                <input
                  id="target-return"
                  className="form-input"
                  type="number"
                  min={0}
                  max={50}
                  step={0.5}
                  placeholder="e.g. 8"
                  value={profile.target_return_pa ?? ''}
                  onChange={(e) =>
                    update('target_return_pa', e.target.value ? +e.target.value / 100 : null)
                  }
                />
              </div>

              {/* Horizon slider */}
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label" htmlFor="horizon">
                  Investment Horizon
                  <span style={{ color: 'var(--on-dark)', fontWeight: 700, marginLeft: 8 }}>
                    {profile.horizon_months} months
                  </span>
                </label>
                <input
                  id="horizon"
                  type="range"
                  min={3}
                  max={36}
                  step={1}
                  value={profile.horizon_months}
                  onChange={(e) => update('horizon_months', +e.target.value)}
                  aria-valuenow={profile.horizon_months}
                  aria-valuemin={3}
                  aria-valuemax={36}
                />
                <div className="flex justify-between">
                  <span className="form-hint">3 months</span>
                  <span className="form-hint">36 months</span>
                </div>
              </div>

              {/* Loss tolerance slider */}
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label" htmlFor="loss-tol">
                  Max Acceptable Loss
                  <span style={{ color: 'var(--accent-danger)', fontWeight: 700, marginLeft: 8 }}>
                    {profile.loss_tolerance_pct}%
                  </span>
                </label>
                <input
                  id="loss-tol"
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={profile.loss_tolerance_pct}
                  onChange={(e) => update('loss_tolerance_pct', +e.target.value)}
                  aria-valuenow={profile.loss_tolerance_pct}
                  aria-valuemin={0}
                  aria-valuemax={50}
                />
                <div className="flex justify-between">
                  <span className="form-hint">0%</span>
                  <span className="form-hint">50%</span>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Portfolio Details */}
          <SectionCard title="Portfolio Details">
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label" htmlFor="investable">Investable Assets (₹)</label>
                <input
                  id="investable"
                  className="form-input mono"
                  type="number"
                  min={1}
                  step={100000}
                  value={profile.investable_assets}
                  onChange={(e) => update('investable_assets', +e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="inv-amount">
                  Investment Amount (₹)
                  <span className="text-muted" style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
                    ({concentrationPct}% of assets)
                  </span>
                </label>
                <input
                  id="inv-amount"
                  className="form-input mono"
                  type="number"
                  min={1}
                  step={100000}
                  value={profile.investment_amount}
                  onChange={(e) => update('investment_amount', +e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="existing-exp">
                  Existing Exposure to Underlying
                  <span style={{ color: 'var(--on-dark)', fontWeight: 700, marginLeft: 8 }}>
                    {profile.existing_exposure_underlying_pct}%
                  </span>
                </label>
                <input
                  id="existing-exp"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={profile.existing_exposure_underlying_pct}
                  onChange={(e) => update('existing_exposure_underlying_pct', +e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="structured-pct">
                  Existing Structured Products
                  <span style={{ color: 'var(--on-dark)', fontWeight: 700, marginLeft: 8 }}>
                    {profile.existing_structured_pct}%
                  </span>
                </label>
                <input
                  id="structured-pct"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={profile.existing_structured_pct}
                  onChange={(e) => update('existing_structured_pct', +e.target.value)}
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label" htmlFor="liquidity">
                  Needs liquidity within (months, optional)
                </label>
                <input
                  id="liquidity"
                  className="form-input"
                  type="number"
                  min={1}
                  max={120}
                  placeholder="Leave blank if not applicable"
                  value={profile.needs_liquidity_within_months ?? ''}
                  onChange={(e) =>
                    update('needs_liquidity_within_months', e.target.value ? +e.target.value : null)
                  }
                  style={{ maxWidth: 220 }}
                />
              </div>
            </div>
          </SectionCard>

          <Disclaimer className="mb-6" />
        </div>

        {/* Right: sticky summary */}
        <div style={{ position: 'sticky', top: 80 }}>
          <div className="card" style={{ marginBottom: 16 }}>
            <div
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--stone)',
                marginBottom: 20,
              }}
            >
              Profile Summary
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Risk', value: profile.risk_appetite || '—' },
                { label: 'Horizon', value: `${profile.horizon_months}m` },
                { label: 'Max Loss', value: `${profile.loss_tolerance_pct}%` },
                {
                  label: 'Assets',
                  value: profile.investable_assets
                    ? `₹${(profile.investable_assets / 1_00_000).toFixed(0)}L`
                    : '—',
                },
                { label: 'Experience', value: profile.experience || '—' },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex justify-between"
                  style={{ fontSize: 14, borderBottom: '1px solid var(--hairline-dark)', paddingBottom: 8 }}
                >
                  <span style={{ color: 'var(--stone)', textTransform: 'capitalize' }}>{row.label}</span>
                  <span style={{ color: 'var(--on-dark)', fontWeight: 600, textTransform: 'capitalize' }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            id="get-recommendations-btn"
            type="submit"
            form="client-questionnaire-form"
            className="btn btn-primary w-full"
            style={{ height: 52, fontSize: 16 }}
            aria-label="Submit profile and get product recommendations"
            onClick={onSubmit as unknown as React.MouseEventHandler}
          >
            Get Recommendations
            <span aria-hidden="true">→</span>
          </button>
          <p style={{ fontSize: 12, color: 'var(--stone)', marginTop: 12, textAlign: 'center' }}>
            Analysis runs in seconds
          </p>
        </div>
      </div>
    </form>
  );
};

// ── RecommendationView ─────────────────────────────────────────────────────

interface RecViewProps {
  result: RecommendationResult;
  profile: ClientProfile;
  caseId: string | null;
  onViewDashboard: (runId: string) => void;
}

const RecommendationView: React.FC<RecViewProps> = ({
  result,
  profile,
  caseId,
  onViewDashboard,
}) => {
  return (
    <div className="animate-in">
      {/* Summary */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="card-title">Recommendations for {profile.client_name}</div>
            <div className="card-subtitle">
              {result.ranking.length} candidates analysed · As of {result.as_of}
              {caseId && <> · Case <span className="mono">{caseId.slice(0, 8)}</span></>}
            </div>
          </div>
          {result.best && <VerdictBadge verdict={result.best.verdict} />}
        </div>

        {result.rationale_text && (
          <div
            style={{
              fontSize: 14,
              color: 'var(--on-dark-mute)',
              lineHeight: 1.7,
              padding: '14px 16px',
              background: 'rgba(73,79,223,0.07)',
              borderRadius: 'var(--r-md)',
              borderLeft: '3px solid var(--primary)',
            }}
          >
            {result.rationale_text}
          </div>
        )}
      </div>

      {/* Best pick */}
      {result.best && (
        <div
          className="card"
          style={{ marginBottom: 20, borderTop: '2px solid var(--accent-teal)' }}
        >
          <div className="flex items-center gap-3 mb-4">
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--r-sm)',
                background: 'rgba(0,168,126,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Trophy size={18} style={{ color: 'var(--accent-teal)' }} />
            </span>
            <div>
              <div className="card-title" style={{ fontSize: 18 }}>Best Match</div>
              <div className="card-subtitle" style={{ marginBottom: 0 }}>
                Highest suitability fit for your profile
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
              <ProductPill type={result.best.product_type} />
              <VerdictBadge verdict={result.best.verdict} />
            </div>
          </div>
          <div className="stat-grid mb-4">
            <StatBox label="Fit Score" value={`${(result.best.fit_score * 100).toFixed(0)}/100`} color="positive" />
            <StatBox
              label="P(Loss)"
              value={`${((result.best.metrics_summary as { p_loss?: number }).p_loss ?? 0 * 100).toFixed(1)}%`}
            />
            <StatBox
              label="Underlying"
              value={String((result.best.config as { underlying?: unknown }).underlying ?? '—')}
              subtext={result.best.product_type}
            />
          </div>
          <button
            id="best-view-dashboard-btn"
            className="btn btn-primary"
            onClick={() => onViewDashboard(result.best!.run_id)}
            aria-label="View full dashboard for best recommendation"
          >
            View Full Analysis <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* Ranking table */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title mb-4">All Candidates (Ranked)</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" aria-label="Product ranking table">
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Underlying</th>
                <th>Fit Score</th>
                <th>Verdict</th>
                <th>P(Loss)</th>
                <th>Median Ann. Return</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {result.ranking.map((candidate, i) => {
                const ms = candidate.metrics_summary as {
                  p_loss?: number;
                  median_annualised_return?: number;
                };
                return (
                  <tr key={candidate.run_id}>
                    <td
                      style={{
                        fontWeight: 700,
                        color: i === 0 ? 'var(--accent-teal)' : 'var(--stone)',
                      }}
                    >
                      {i === 0 ? <Trophy size={14} style={{ color: 'var(--accent-teal)' }} /> : i + 1}
                    </td>
                    <td><ProductPill type={candidate.product_type} /></td>
                    <td className="mono" style={{ fontSize: 13 }}>
                      {String((candidate.config as { underlying?: unknown }).underlying ?? '—')}
                    </td>
                    <td>
                      <span
                        className={`stat-value ${
                          candidate.fit_score >= 0.7
                            ? 'positive'
                            : candidate.fit_score >= 0.4
                            ? 'neutral'
                            : 'negative'
                        }`}
                        style={{ fontSize: 14 }}
                      >
                        {(candidate.fit_score * 100).toFixed(0)}
                      </span>
                    </td>
                    <td><VerdictBadge verdict={candidate.verdict} /></td>
                    <td className={ms.p_loss && ms.p_loss > 0.3 ? 'text-red' : ''}>
                      {ms.p_loss != null ? `${(ms.p_loss * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td
                      className={
                        ms.median_annualised_return != null && ms.median_annualised_return >= 0
                          ? 'text-green'
                          : 'text-red'
                      }
                    >
                      {ms.median_annualised_return != null
                        ? `${ms.median_annualised_return >= 0 ? '+' : ''}${(ms.median_annualised_return * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td>
                      <button
                        className="btn btn-outline-dark btn-sm"
                        onClick={() => onViewDashboard(candidate.run_id)}
                        aria-label={`View analysis for candidate ${i + 1}`}
                        id={`view-candidate-${i + 1}-btn`}
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Disclaimer text={result.disclaimer} />
    </div>
  );
};

export default ClientPage;
