import React from 'react';
import { Check } from 'lucide-react';

export interface WizardStep {
  key: string;
  label: string;
  /** Short explanation shown under the label on the active step. */
  description?: string;
}

interface StepperProps {
  steps: WizardStep[];
  current: number;
  /** Steps the user has completed and may navigate back to. */
  maxVisited: number;
  onNavigate: (index: number) => void;
}

export const Stepper: React.FC<StepperProps> = ({
  steps,
  current,
  maxVisited,
  onNavigate,
}) => (
  <nav className="wizard-steps" aria-label="Registration progress">
    <ol style={{ display: 'flex', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        const reachable = i <= maxVisited;
        const content = (
          <React.Fragment>
            <span
              className={`wizard-step-dot ${state}`}
              aria-hidden="true"
            >
              {state === 'done' ? <Check size={12} strokeWidth={3} /> : i + 1}
            </span>
            <span className="wizard-step-label">{s.label}</span>
          </React.Fragment>
        );

        return (
          <li key={s.key} style={{ flex: 1, minWidth: 0 }}>
            {reachable ? (
              <button
                type="button"
                className={`wizard-step ${state}`}
                onClick={() => onNavigate(i)}
                aria-current={state === 'active' ? 'step' : undefined}
                id={`wizard-step-${s.key}`}
              >
                {content}
              </button>
            ) : (
              <div className={`wizard-step ${state}`} aria-disabled="true">
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);

interface WizardNavProps {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  backLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  extra?: React.ReactNode;
}

export const WizardNav: React.FC<WizardNavProps> = ({
  onBack,
  onNext,
  nextLabel = 'Continue',
  backLabel = 'Back',
  nextDisabled,
  loading,
  loadingLabel = 'Working…',
  extra,
}) => (
  <div
    className="flex items-center justify-between"
    style={{ gap: 12, flexWrap: 'wrap', marginTop: 24 }}
  >
    <div>
      {onBack && (
        <button
          type="button"
          className="btn btn-outline-dark"
          onClick={onBack}
          disabled={loading}
          id="wizard-back-btn"
        >
          ← {backLabel}
        </button>
      )}
    </div>
    <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
      {extra}
      <button
        type="button"
        className="btn btn-primary"
        onClick={onNext}
        disabled={nextDisabled || loading}
        aria-busy={loading}
        id="wizard-next-btn"
        style={{ minWidth: 180, justifyContent: 'center' }}
      >
        {loading ? loadingLabel : nextLabel}
        {!loading && <span aria-hidden="true">→</span>}
      </button>
    </div>
  </div>
);
