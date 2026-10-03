import React from 'react';
import { Check, AlertTriangle, X, Info, ShieldAlert } from 'lucide-react';
import type { Verdict, RuleStatus } from '../types';

// ── VerdictBadge ───────────────────────────────────────────────────────────

const VERDICT_ICON: Record<Verdict, React.ReactNode> = {
  SUITABLE: <Check size={14} strokeWidth={2.5} />,
  CONDITIONALLY_SUITABLE: <AlertTriangle size={14} strokeWidth={2.5} />,
  NOT_SUITABLE: <X size={14} strokeWidth={2.5} />,
};

const VERDICT_LABEL: Record<Verdict, string> = {
  SUITABLE: 'Suitable',
  CONDITIONALLY_SUITABLE: 'Conditionally Suitable',
  NOT_SUITABLE: 'Not Suitable',
};

interface VerdictBadgeProps {
  verdict: Verdict;
  className?: string;
}

export const VerdictBadge: React.FC<VerdictBadgeProps> = ({ verdict, className = '' }) => (
  <span
    className={`verdict-badge ${verdict} ${className}`}
    aria-label={`Verdict: ${VERDICT_LABEL[verdict]}`}
    role="status"
  >
    <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
      {VERDICT_ICON[verdict]}
    </span>
    {VERDICT_LABEL[verdict]}
  </span>
);

// ── RuleDot ────────────────────────────────────────────────────────────────

interface RuleDotProps {
  status: RuleStatus;
  label?: string;
}

export const RuleDot: React.FC<RuleDotProps> = ({ status, label }) => (
  <span
    className={`rule-dot ${status}`}
    aria-label={label ?? status}
    role="img"
    title={label ?? status}
  />
);

// ── ProductPill ────────────────────────────────────────────────────────────

interface ProductPillProps {
  type: string;
}

export const ProductPill: React.FC<ProductPillProps> = ({ type }) => (
  <span className={`product-pill ${type}`} aria-label={`Product type: ${type}`}>
    {type}
  </span>
);

// ── ScoreRing ──────────────────────────────────────────────────────────────

interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}

export const ScoreRing: React.FC<ScoreRingProps> = ({
  score,
  size = 110,
  strokeWidth = 6,
  label = 'Score',
}) => {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color =
    score >= 75
      ? 'var(--accent-teal)'
      : score >= 50
      ? 'var(--accent-warning)'
      : 'var(--accent-danger)';
  const cx = size / 2;

  return (
    <div className="score-ring-container" aria-label={`${label}: ${Math.round(score)}/100`}>
      <svg width={size} height={size} aria-hidden="true">
        {/* Track */}
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="var(--hairline-dark)"
          strokeWidth={strokeWidth}
        />
        {/* Fill */}
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circ}
          strokeDashoffset={circ - fill}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)' }}
        />
        <text x={cx} y={cx + 2} textAnchor="middle" dominantBaseline="middle">
          <tspan fontSize={20} fontWeight={700} fill={color} dy={-4}>
            {Math.round(score)}
          </tspan>
          <tspan x={cx} dy={20} fontSize={10} fill="var(--stone)" fontWeight={600}>
            / 100
          </tspan>
        </text>
      </svg>
      <span className="score-ring-label">{label}</span>
    </div>
  );
};

// ── ProgressBar ────────────────────────────────────────────────────────────

interface ProgressBarProps {
  value: number; // 0–100
  color?: 'blue' | 'green' | 'amber' | 'red';
  label?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  color = 'blue',
  label,
}) => (
  <div
    className="progress-bar"
    role="progressbar"
    aria-valuenow={value}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-label={label}
  >
    <div
      className={`progress-fill ${color}`}
      style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
    />
  </div>
);

// ── Spinner ────────────────────────────────────────────────────────────────

interface SpinnerProps {
  size?: number;
  label?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({ size = 20, label = 'Loading…' }) => (
  <span
    className="spinner"
    style={{ width: size, height: size }}
    role="status"
    aria-label={label}
  />
);

// ── LoadingOverlay ─────────────────────────────────────────────────────────

interface LoadingOverlayProps {
  message?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  message = 'Computing analysis…',
}) => (
  <div className="loading-overlay" role="status" aria-live="polite">
    <Spinner size={36} />
    <span style={{ color: 'var(--on-dark-mute)', fontSize: 16, fontWeight: 500 }}>
      {message}
    </span>
  </div>
);

// ── Alert ──────────────────────────────────────────────────────────────────

type AlertVariant = 'info' | 'warning' | 'error' | 'success';

const ALERT_ICONS: Record<AlertVariant, React.ReactNode> = {
  info: <Info size={16} strokeWidth={2} />,
  warning: <AlertTriangle size={16} strokeWidth={2} />,
  error: <X size={16} strokeWidth={2} />,
  success: <Check size={16} strokeWidth={2} />,
};

interface AlertProps {
  variant?: AlertVariant;
  children: React.ReactNode;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({
  variant = 'info',
  children,
  className = '',
}) => (
  <div
    className={`alert alert-${variant} ${className}`}
    role="alert"
    aria-live="polite"
  >
    <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
      {ALERT_ICONS[variant]}
    </span>
    <div>{children}</div>
  </div>
);

// ── Tooltip ────────────────────────────────────────────────────────────────

interface TooltipProps {
  content: string;
  children: React.ReactNode;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children }) => (
  <span className="tooltip-wrapper" tabIndex={0} aria-label={content}>
    {children}
    <span className="tooltip-content" role="tooltip">{content}</span>
  </span>
);

// ── Disclaimer ─────────────────────────────────────────────────────────────

interface DisclaimerProps {
  text?: string;
  className?: string;
}

export const Disclaimer: React.FC<DisclaimerProps> = ({
  text = 'Illustrative analysis using historical data and statistical models. Past performance does not predict future results. Not investment advice.',
  className = '',
}) => (
  <div className={`disclaimer-box ${className}`} role="note">
    <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <ShieldAlert size={14} style={{ color: 'var(--accent-warning)' }} /> Disclaimer:{' '}
    </strong>
    {text}
  </div>
);

// ── StatBox ────────────────────────────────────────────────────────────────

type StatColor = 'positive' | 'negative' | 'neutral' | '';

interface StatBoxProps {
  label: string;
  value: string;
  subtext?: string;
  color?: StatColor;
}

export const StatBox: React.FC<StatBoxProps> = ({ label, value, subtext, color = '' }) => (
  <div className="stat-box">
    <div className="stat-label">{label}</div>
    <div className={`stat-value ${color}`}>{value}</div>
    {subtext && <div className="stat-subtext">{subtext}</div>}
  </div>
);
