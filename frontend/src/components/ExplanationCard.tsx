import React from 'react';
import {
  Brain,
  MessageSquare,
  Info,
  TrendingUp,
  AlertTriangle,
  Shield,
  HelpCircle,
  CheckCircle2,
  AlertOctagon,
} from 'lucide-react';
import type { ExplanationResult } from '../types';
import { Alert } from './UIKit';

interface ExplanationCardProps {
  explanation: ExplanationResult;
  audience?: 'client' | 'rm';
}

// ── Inline Markdown Formatter ───────────────────────────────────────────────
export const renderInlineMarkdown = (text: string) => {
  if (!text) return null;
  // Replace **bold** with styled strong tag
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} style={{ color: 'var(--on-dark)', fontWeight: 600 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
};

// ── Section Card Component for Client Rationale ─────────────────────────────
interface ClientSectionProps {
  icon: React.ReactNode;
  title: string;
  content: string;
  badgeColor?: string;
  accentBg?: string;
}

const ClientSectionCard: React.FC<ClientSectionProps> = ({
  icon,
  title,
  content,
  badgeColor = 'var(--primary-bright)',
  accentBg = 'rgba(255,255,255,0.02)',
}) => {
  // If content contains bullet questions like "Questions to raise with your RM: ..."
  const isQuestions = title.toLowerCase().includes('discuss') || title.toLowerCase().includes('questions');
  let cleanContent = content;
  let questions: string[] = [];

  if (isQuestions) {
    cleanContent = content.replace(/^Questions to raise with your RM:\s*/i, '');
    questions = cleanContent
      .split(/\?\s+/)
      .map((q) => q.trim())
      .filter((q) => q.length > 0)
      .map((q) => (q.endsWith('?') ? q : `${q}?`));
  }

  return (
    <div
      className="card mb-3"
      style={{
        background: accentBg,
        border: '1px solid var(--hairline-dark)',
        padding: '16px 20px',
        borderRadius: 'var(--r-md)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: 'var(--divider-soft)',
            color: badgeColor,
          }}
        >
          {icon}
        </span>
        <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--on-dark)', margin: 0 }}>
          {title}
        </h4>
      </div>

      {isQuestions && questions.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {questions.map((q, idx) => (
            <div key={idx} className="flex items-start gap-2" style={{ fontSize: 13, color: 'var(--on-dark-mute)' }}>
              <span style={{ color: badgeColor, marginTop: 2 }}>•</span>
              <span>{q}</span>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--on-dark-mute)',
          }}
        >
          {renderInlineMarkdown(cleanContent)}
        </div>
      )}
    </div>
  );
};

// ── Client Explanation Parser ───────────────────────────────────────────────
export const FormattedClientReasoning: React.FC<{ text: string }> = ({ text }) => {
  if (!text) return null;

  // Check if text uses standard markdown section headers **Header**
  const sectionRegex = /\*\*([^*]+)\*\*\n([\s\S]*?)(?=\*\*|$)/g;
  const sections: Array<{ title: string; body: string }> = [];
  let match;

  while ((match = sectionRegex.exec(text)) !== null) {
    sections.push({
      title: match[1].trim(),
      body: match[2].trim(),
    });
  }

  if (sections.length === 0) {
    // Fallback for non-structured text
    return (
      <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--on-dark-mute)' }}>
        {renderInlineMarkdown(text)}
      </div>
    );
  }

  const getIcon = (title: string) => {
    const t = title.toLowerCase();
    if (t.includes('does') || t.includes('what this')) return <Info size={14} />;
    if (t.includes('earn') || t.includes('yield') || t.includes('gain')) return <TrendingUp size={14} />;
    if (t.includes('lose') || t.includes('risk') || t.includes('downside')) return <AlertTriangle size={14} />;
    if (t.includes('fit') || t.includes('suitability')) return <Shield size={14} />;
    if (t.includes('discuss') || t.includes('questions')) return <HelpCircle size={14} />;
    return <MessageSquare size={14} />;
  };

  const getColor = (title: string) => {
    const t = title.toLowerCase();
    if (t.includes('earn')) return 'var(--accent-teal)';
    if (t.includes('lose')) return 'var(--accent-warning)';
    if (t.includes('fit')) return 'var(--primary-bright)';
    if (t.includes('discuss')) return 'var(--stone)';
    return 'var(--primary-bright)';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sections.map((sec, i) => (
        <ClientSectionCard
          key={i}
          icon={getIcon(sec.title)}
          title={sec.title}
          content={sec.body}
          badgeColor={getColor(sec.title)}
        />
      ))}
    </div>
  );
};

// ── RM Compliance Explanation Parser ─────────────────────────────────────────
export const FormattedRMReasoning: React.FC<{ text: string }> = ({ text }) => {
  if (!text) return null;

  // Split into lines or sections
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Extract Header Summary line (Verdict, Score, Risk Tier)
  const verdictLine = lines.find((l) => l.includes('Verdict:') || l.includes('Suitability score:'));
  
  // Extract Risk metrics lines
  const riskMetricLines = lines.filter((l) => l.startsWith('- Max gain:') || l.startsWith('- Stress loss:') || l.startsWith('- P(loss)') || l.startsWith('- Replay') || l.startsWith('- Indicative'));

  // Extract Triggered rules lines
  const ruleLines = lines.filter((l) => l.startsWith('- [AMBER]') || l.startsWith('- [RED]') || l.startsWith('- [GREEN]'));

  // Extract general narrative text
  const otherLines = lines.filter(
    (l) =>
      !l.startsWith('**RM Technical Summary') &&
      !l.includes('Verdict:') &&
      !l.startsWith('**Risk metrics:**') &&
      !l.startsWith('**Rules triggered:**') &&
      !l.startsWith('- Max gain:') &&
      !l.startsWith('- Stress loss:') &&
      !l.startsWith('- P(loss)') &&
      !l.startsWith('- Replay') &&
      !l.startsWith('- Indicative') &&
      !l.startsWith('- [AMBER]') &&
      !l.startsWith('- [RED]') &&
      !l.startsWith('- [GREEN]') &&
      !l.startsWith('*Data source')
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      
      {/* Header Verdict & Score Summary Bar */}
      {verdictLine && (
        <div
          style={{
            background: 'var(--surface-deep)',
            border: '1px solid var(--hairline-dark)',
            borderRadius: 'var(--r-md)',
            padding: '12px 16px',
            fontSize: 13,
            color: 'var(--on-dark-mute)',
          }}
        >
          {renderInlineMarkdown(verdictLine)}
        </div>
      )}

      {/* Structured Risk Metrics Grid if present */}
      {riskMetricLines.length > 0 && (
        <div style={{ background: 'rgba(0,0,0,0.3)', padding: 14, borderRadius: 'var(--r-md)', border: '1px solid var(--hairline-dark)' }}>
          <div className="stat-label mb-2" style={{ fontSize: 11 }}>Risk Metrics & Simulated Parameters</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {riskMetricLines.map((line, idx) => (
              <div key={idx} className="flex items-center gap-2" style={{ fontSize: 13, color: 'var(--on-dark-mute)' }}>
                <span className="mono" style={{ color: 'var(--primary-bright)' }}>•</span>
                <span>{renderInlineMarkdown(line.replace(/^- /, ''))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Triggered Regulatory Rules */}
      {ruleLines.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="stat-label" style={{ fontSize: 11 }}>Regulatory Rules Evaluation & Warnings</div>
          {ruleLines.map((rule, idx) => {
            const isAmber = rule.includes('[AMBER]');
            const isRed = rule.includes('[RED]');
            const statusColor = isRed ? 'var(--accent-danger)' : isAmber ? 'var(--accent-warning)' : 'var(--accent-teal)';
            const statusBg = isRed ? 'rgba(226,59,74,0.1)' : isAmber ? 'rgba(236,126,0,0.1)' : 'rgba(0,168,126,0.1)';

            return (
              <div
                key={idx}
                style={{
                  background: statusBg,
                  border: `1px solid ${statusColor}40`,
                  borderRadius: 'var(--r-md)',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <span style={{ color: statusColor, marginTop: 2 }}>
                  {isRed ? <AlertOctagon size={14} /> : isAmber ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                </span>
                <div style={{ fontSize: 13, color: 'var(--on-dark-mute)', lineHeight: 1.5 }}>
                  {renderInlineMarkdown(rule.replace(/^- /, ''))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Additional Narrative Text */}
      {otherLines.length > 0 && (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--on-dark-mute)' }}>
          {otherLines.map((l, i) => (
            <p key={i} style={{ marginBottom: 6 }}>
              {renderInlineMarkdown(l)}
            </p>
          ))}
        </div>
      )}

      {lines.some((l) => l.startsWith('*Data source')) && (
        <div style={{ fontSize: 11, color: 'var(--stone)', fontStyle: 'italic', marginTop: 4 }}>
          *Data source and snapshot hash are recorded in the audit trail.
        </div>
      )}
    </div>
  );
};

// ── ExplanationCard Main Component ──────────────────────────────────────────
const ExplanationCard: React.FC<ExplanationCardProps> = ({
  explanation,
  audience = 'client',
}) => {
  const text =
    audience === 'rm' && explanation.rm_text
      ? explanation.rm_text
      : explanation.client_text;

  return (
    <div className="card animate-in" aria-label="AI-generated explanation">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-hairline-dark">
        <div className="card-title flex items-center gap-2" style={{ fontSize: 16 }}>
          {audience === 'rm' ? (
            <Brain size={18} style={{ color: 'var(--primary-bright)' }} />
          ) : (
            <MessageSquare size={18} style={{ color: 'var(--accent-teal)' }} />
          )}
          {audience === 'rm' ? 'RM Technical & Compliance Rationale' : 'Client-Facing Explanation'}
        </div>
        <span
          style={{
            fontSize: 11,
            color: 'var(--stone)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: explanation.source === 'llm' ? 'var(--accent-teal)' : 'var(--accent-warning)',
              display: 'inline-block',
            }}
            aria-hidden="true"
          />
          {explanation.source === 'llm' ? (explanation.model ?? 'LLM Engine') : 'Deterministic Template'}
        </span>
      </div>

      {/* Rich Formatted Content */}
      <div className="mb-4">
        {audience === 'rm' ? (
          <FormattedRMReasoning text={text} />
        ) : (
          <FormattedClientReasoning text={text} />
        )}
      </div>

      {/* Fallback reason notice */}
      {explanation.fallback_reason && (
        <Alert variant="warning" className="mb-4">
          {explanation.fallback_reason}
        </Alert>
      )}

      {/* LLM notice */}
      <Alert variant="info" className="mt-4">
        <span style={{ fontSize: 12 }}>
          AI-generated narrative. The suitability verdict and risk metrics are calculated deterministically by the rules engine — the LLM strictly narrates the computed facts.
        </span>
      </Alert>
    </div>
  );
};

export default ExplanationCard;
