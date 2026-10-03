import React from 'react';
import { Brain, MessageSquare } from 'lucide-react';
import type { ExplanationResult } from '../types';
import { Alert } from './UIKit';

interface ExplanationCardProps {
  explanation: ExplanationResult;
  audience?: 'client' | 'rm';
}

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
      <div className="flex items-center justify-between mb-4">
        <div className="card-title flex items-center gap-2">
          {audience === 'rm' ? (
            <Brain size={16} style={{ color: 'var(--primary-bright)' }} />
          ) : (
            <MessageSquare size={16} style={{ color: 'var(--accent-teal)' }} />
          )}
          {audience === 'rm' ? 'RM Notes' : 'Explanation for Client'}
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
          {explanation.source === 'llm' ? (explanation.model ?? 'LLM') : 'Template'}
        </span>
      </div>

      {/* Main text */}
      <div
        style={{
          fontSize: 14,
          lineHeight: 1.75,
          color: 'var(--on-dark-mute)',
          whiteSpace: 'pre-wrap',
          marginBottom: 20,
        }}
      >
        {text}
      </div>

      {/* Fallback reason notice */}
      {explanation.fallback_reason && (
        <Alert variant="warning" className="mb-4">
          {explanation.fallback_reason}
        </Alert>
      )}

      {/* LLM notice */}
      <Alert variant="info" className="mt-4">
        AI-generated explanation. The suitability verdict is computed deterministically
        by the rules engine — the LLM only narrates the result. Always verify with your
        qualified financial adviser.
      </Alert>
    </div>
  );
};

export default ExplanationCard;
