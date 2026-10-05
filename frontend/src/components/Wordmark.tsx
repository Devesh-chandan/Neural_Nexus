import React from 'react';

/** Minimal Neural Nexus mark: two nodes joined by a diagonal link inside an "N". */
export const WordmarkGlyph: React.FC<{ size?: number; tone?: 'dark' | 'light' }> = ({ size = 26, tone = 'dark' }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
    <rect x="0.75" y="0.75" width="26.5" height="26.5" rx="7.5" fill={tone === 'dark' ? '#0a0a0a' : '#111827'} stroke={tone === 'dark' ? 'rgba(255,255,255,0.18)' : '#111827'} strokeWidth="1.5" />
    <path d="M9 19.5V8.5L19 19.5V8.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="9" cy="8.5" r="2" fill="#494fdf" />
    <circle cx="19" cy="19.5" r="2" fill="#494fdf" />
  </svg>
);

const Wordmark: React.FC<{ size?: number; glyph?: boolean; tone?: 'dark' | 'light' }> = ({ size = 17, glyph = true, tone = 'dark' }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
    {glyph && <WordmarkGlyph size={Math.round(size * 1.5)} tone={tone} />}
    <span style={{ fontSize: size, letterSpacing: '-0.3px', lineHeight: 1, whiteSpace: 'nowrap' }}>
      <span style={{ fontWeight: 600, color: tone === 'dark' ? '#fff' : '#111827' }}>Neural</span>
      <span style={{ fontWeight: 400, color: tone === 'dark' ? 'rgba(255,255,255,0.62)' : '#6b7280', marginLeft: 5 }}>Nexus</span>
    </span>
  </span>
);

export default Wordmark;
