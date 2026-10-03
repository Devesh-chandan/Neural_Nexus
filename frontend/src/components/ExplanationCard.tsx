import React from 'react';
import { Brain, MessageSquare } from 'lucide-react';
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

// ── Client Explanation Parser ───────────────────────────────────────────────
const splitQuestions = (body: string): string[] =>
  body
    .replace(/^Questions to raise with your RM:\s*/i, '')
    .split(/\?\s*/)
    .map((q) => q.replace(/^[•\-\s]+/, '').trim())
    .filter((q) => q.length > 0)
    .map((q) => `${q}?`);

export const FormattedClientReasoning: React.FC<{ text: string }> = ({ text }) => {
  if (!text) return null;

  // Sections are written as "**Header**\nbody"
  const sectionRegex = /\*\*([^*]+)\*\*\n([\s\S]*?)(?=\*\*|$)/g;
  const sections: Array<{ title: string; body: string }> = [];
  let match;
  while ((match = sectionRegex.exec(text)) !== null) {
    sections.push({ title: match[1].trim(), body: match[2].trim() });
  }

  if (sections.length === 0) {
    return <p className="rz-body">{renderInlineMarkdown(text)}</p>;
  }

  return (
    <div className="rz-sections">
      {sections.map((sec, i) => {
        const t = sec.title.toLowerCase();
        const isQuestions = t.includes('discuss') || t.includes('questions');
        return (
          <div key={i} className="rz-section">
            <h5 className="rz-title">{sec.title}</h5>
            {isQuestions ? (
              <ul className="rz-list">
                {splitQuestions(sec.body).map((q, idx) => (
                  <li key={idx}>{q}</li>
                ))}
              </ul>
            ) : (
              <p className="rz-body">{renderInlineMarkdown(sec.body)}</p>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── RM Compliance Explanation Parser ─────────────────────────────────────────
const stripMd = (s: string) => s.replace(/\*\*/g, '').trim();

/** "**A:** x | **B:** y" → [{label: 'A', value: 'x'}, …] */
const toPairs = (line: string) =>
  line
    .replace(/^- /, '')
    .split('|')
    .map((part) => {
      const clean = stripMd(part);
      const i = clean.indexOf(':');
      return i === -1
        ? { label: clean, value: '' }
        : { label: clean.slice(0, i).trim(), value: clean.slice(i + 1).trim() };
    })
    .filter((p) => p.label);

const verdictTone = (v: string) =>
  v.includes('NOT') ? 'red' : v.includes('CONDITION') ? 'amber' : v.includes('SUITABLE') ? 'green' : '';

export const FormattedRMReasoning: React.FC<{ text: string }> = ({ text }) => {
  if (!text) return null;

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const isMetric = (l: string) =>
    ['- Max gain:', '- Stress loss:', '- P(loss)', '- Replay', '- Indicative'].some((k) => l.startsWith(k));
  const isRule = (l: string) => /^- \[(AMBER|RED|GREEN)\]/.test(l);

  const verdictLine = lines.find((l) => l.includes('Verdict:') || l.includes('Suitability score:'));
  const metrics = lines.filter(isMetric).flatMap(toPairs);
  const rules = lines.filter(isRule);
  const narrative = lines.filter(
    (l) =>
      l !== verdictLine &&
      !isMetric(l) &&
      !isRule(l) &&
      !l.startsWith('**RM Technical Summary') &&
      !l.startsWith('**Risk metrics') &&
      !l.startsWith('**Rules triggered') &&
      !l.startsWith('*Data source')
  );

  return (
    <div className="rz-sections">
      {verdictLine && (
        <div className="rz-stats">
          {toPairs(verdictLine).map((p, i) => (
            <div key={i} className="rz-stat">
              <span className="rz-stat-label">{p.label}</span>
              <span className={`rz-stat-value ${p.label.toLowerCase() === 'verdict' ? `tone-${verdictTone(p.value)}` : ''}`}>
                {p.value.replace(/_/g, ' ')}
              </span>
            </div>
          ))}
        </div>
      )}

      {metrics.length > 0 && (
        <div className="rz-section">
          <h5 className="rz-title">Risk metrics</h5>
          <dl className="rz-kv">
            {metrics.map((m, i) => (
              <div key={i}>
                <dt>{m.label}</dt>
                <dd className="mono">{m.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {rules.length > 0 && (
        <div className="rz-section">
          <h5 className="rz-title">Rules triggered</h5>
          <ul className="rz-rules">
            {rules.map((rule, idx) => {
              const tone = rule.includes('[RED]') ? 'red' : rule.includes('[AMBER]') ? 'amber' : 'green';
              return (
                <li key={idx}>
                  <span className={`rz-dot tone-${tone}`} aria-hidden="true" />
                  <span>{renderInlineMarkdown(rule.replace(/^- \[(AMBER|RED|GREEN)\]\s*/, ''))}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {narrative.length > 0 && (
        <div className="rz-section">
          {narrative.map((l, i) => (
            <p key={i} className="rz-body">{renderInlineMarkdown(l.replace(/^- /, ''))}</p>
          ))}
        </div>
      )}

      {lines.some((l) => l.startsWith('*Data source')) && (
        <p className="rz-footnote">Data source and snapshot hash are recorded in the audit trail.</p>
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


    </div>
  );
};

export default ExplanationCard;
