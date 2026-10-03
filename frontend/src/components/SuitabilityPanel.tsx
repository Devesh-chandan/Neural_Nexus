import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { SuitabilityResult, RuleResult } from '../types';
import { VerdictBadge, RuleDot, ScoreRing, ProgressBar } from './UIKit';

// ── SuitabilityPanel ───────────────────────────────────────────────────────

interface SuitabilityPanelProps {
  suitability: SuitabilityResult;
  compact?: boolean;
}

const DIMENSION_LABELS: Record<string, string> = {
  p_loss: 'Loss Probability',
  worst_case: 'Worst-case Loss',
  tail_loss: 'Tail Risk (CVaR)',
  horizon: 'Investment Horizon',
  concentration: 'Concentration',
  appetite: 'Risk Appetite',
  complexity: 'Product Complexity',
  life_stage: 'Life Stage',
  affordability: 'Affordability',
  kyc_aml: 'KYC / AML',
};

const SuitabilityPanel: React.FC<SuitabilityPanelProps> = ({
  suitability,
  compact = false,
}) => {
  const [openRule, setOpenRule] = useState<string | null>(null);

  const { verdict, score, rules, score_drivers, summary_flags, mismatches, tier } = suitability;

  return (
    <div className="card animate-in" aria-label="Suitability analysis results">
      {/* Header */}
      <div className="flex items-center justify-between mb-4" style={{ gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="card-title">Suitability Assessment</div>
          <div className="card-subtitle">
            Tier {tier} product · {rules.length} rules evaluated
          </div>
        </div>
        <div className="flex items-center gap-4">
          <ScoreRing score={score} size={compact ? 80 : 110} label="Score" />
          <VerdictBadge verdict={verdict} />
        </div>
      </div>

      {/* Summary flags */}
      <div className="flex flex-wrap gap-2" style={{ marginBottom: 20 }}>
        {Object.entries(summary_flags).map(([key, status]) => (
          <span key={key} className="chip" style={{ fontSize: 12, padding: '6px 12px', gap: 8 }}>
            <RuleDot status={status} />
            {DIMENSION_LABELS[key] ?? key.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      {/* Score drivers */}
      {!compact && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--stone)', marginBottom: 12 }}>Score Drivers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {score_drivers.slice(0, 6).map((d) => (
              <div key={d.rule_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <RuleDot status={d.status} label={d.status} />
                <span style={{ fontSize: 13, color: 'var(--on-dark-mute)', flex: 1 }}>
                  {DIMENSION_LABELS[d.dimension] ?? d.dimension}
                </span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--accent-danger)' }}>
                  -{d.points_deducted.toFixed(1)}
                </span>
                <div style={{ width: 80 }}>
                  <ProgressBar
                    value={(d.points_deducted / 20) * 100}
                    color={d.status === 'RED' ? 'red' : d.status === 'AMBER' ? 'amber' : 'green'}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Mismatch rules */}
      {mismatches.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--stone)', marginBottom: 12 }}>Issues Found</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {mismatches.map((rule) => (
              <RuleCard
                key={rule.rule_id}
                rule={rule}
                open={openRule === rule.rule_id}
                onToggle={() =>
                  setOpenRule(openRule === rule.rule_id ? null : rule.rule_id)
                }
              />
            ))}
          </div>
        </>
      )}

      {/* All rules accordion */}
      {!compact && rules.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--stone)',
              userSelect: 'none',
              padding: '8px 0',
            }}
          >
            Show all {rules.length} rules
          </summary>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {rules.map((rule) => (
              <RuleCard
                key={rule.rule_id}
                rule={rule}
                open={openRule === rule.rule_id}
                onToggle={() =>
                  setOpenRule(openRule === rule.rule_id ? null : rule.rule_id)
                }
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

// ── RuleCard ───────────────────────────────────────────────────────────────

interface RuleCardProps {
  rule: RuleResult;
  open: boolean;
  onToggle: () => void;
}

const RuleCard: React.FC<RuleCardProps> = ({ rule, open, onToggle }) => {
  const borderColor =
    rule.status === 'RED'
      ? 'rgba(226,59,74,0.3)'
      : rule.status === 'AMBER'
      ? 'rgba(236,126,0,0.3)'
      : 'var(--hairline-dark)';

  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        overflow: 'hidden',
        transition: 'all 0.2s',
      }}
    >
      <button
        className="accordion-header"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`rule-${rule.rule_id}`}
        style={{ padding: '12px 14px', width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', gap: 12 }}
      >
        <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
          <RuleDot status={rule.status} />
          <span style={{ fontSize: 13, color: 'var(--on-dark-mute)', lineHeight: 1.5 }}>{rule.message}</span>
        </div>
        <ChevronDown size={16} className={`accordion-chevron ${open ? 'open' : ''}`} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--stone)' }} />
      </button>
      {open && (
        <div
          id={`rule-${rule.rule_id}`}
          style={{ padding: '10px 14px 14px', background: 'rgba(0,0,0,0.15)' }}
          role="region"
          aria-label={`Details for rule ${rule.rule_id}`}
        >
          <div style={{ fontSize: 12, color: 'var(--stone)', marginBottom: 8 }}>
            Rule <span className="mono">{rule.rule_id}</span> · {DIMENSION_LABELS[rule.dimension] ?? rule.dimension}
          </div>
          {Object.keys(rule.facts).length > 0 && (
            <div style={{ overflowX: 'auto' }}><table className="data-table" style={{ fontSize: 12 }}>
              <tbody>
                {Object.entries(rule.facts).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: 'var(--stone)', width: 160 }}>{k}</td>
                    <td className="mono">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
};

export default SuitabilityPanel;
