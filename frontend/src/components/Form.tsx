import React from 'react';
import { Check, AlertTriangle } from 'lucide-react';

// ── SectionCard ─────────────────────────────────────────────────────────────

const SECTION_LABEL: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--stone)',
  marginBottom: 20,
};

interface SectionCardProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  title,
  subtitle,
  badge,
  children,
  className = '',
  style,
}) => (
  <div className={`card ${className}`} style={style}>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: subtitle ? 4 : 20,
      }}
    >
      <div style={SECTION_LABEL}>{title}</div>
      {badge}
    </div>
    {subtitle && (
      <div
        style={{
          fontSize: 13,
          color: 'var(--stone)',
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        {subtitle}
      </div>
    )}
    {children}
  </div>
);

// ── SliderField ─────────────────────────────────────────────────────────────

interface SliderFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
  valueColor?: string;
}

export const SliderField: React.FC<SliderFieldProps> = ({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  hint,
  valueColor,
}) => (
  <div className="slider-group">
    <div className="slider-header">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <span className="slider-value" style={valueColor ? { color: valueColor } : undefined}>
        {format(value)}
      </span>
    </div>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(+e.target.value)}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={format(value)}
    />
    <div className="flex justify-between">
      <span className="form-hint">{format(min)}</span>
      {hint && <span className="form-hint">{hint}</span>}
      <span className="form-hint">{format(max)}</span>
    </div>
  </div>
);

// ── TextField ───────────────────────────────────────────────────────────────

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  type?: 'text' | 'email' | 'date' | 'password';
  autoComplete?: string;
  maxLength?: number;
  minLength?: number;
  mono?: boolean;
}

export const TextField: React.FC<TextFieldProps> = ({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  required,
  type = 'text',
  autoComplete,
  maxLength,
  minLength,
  mono,
}) => (
  <div className="form-group">
    <label className="form-label" htmlFor={id}>
      {label}
      {required && <span style={{ color: 'var(--accent-danger)' }}> *</span>}
    </label>
    <input
      id={id}
      className={`form-input${mono ? ' mono' : ''}`}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      maxLength={maxLength}
      minLength={minLength}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      style={error ? { borderColor: 'var(--accent-danger)' } : undefined}
    />
    {error ? (
      <div className="form-error" id={`${id}-error`} role="alert">
        {error}
      </div>
    ) : hint ? (
      <div className="form-hint" id={`${id}-hint`}>
        {hint}
      </div>
    ) : null}
  </div>
);

// ── SelectField ─────────────────────────────────────────────────────────────

interface SelectFieldProps<T extends string> {
  id: string;
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
}

export function SelectField<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  hint,
  required,
  disabled,
}: SelectFieldProps<T>) {
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>
        {label}
        {required && <span style={{ color: 'var(--accent-danger)' }}> *</span>}
      </label>
      <select
        id={id}
        className="form-select"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <div className="form-hint" id={`${id}-hint`}>
          {hint}
        </div>
      )}
    </div>
  );
}

// ── NumberField ─────────────────────────────────────────────────────────────

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
  error?: string | null;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
}

export const NumberField: React.FC<NumberFieldProps> = ({
  id,
  label,
  value,
  onChange,
  prefix,
  suffix,
  hint,
  error,
  min,
  max,
  step,
  required,
}) => (
  <div className="form-group">
    <label className="form-label" htmlFor={id}>
      {label}
      {required && <span style={{ color: 'var(--accent-danger)' }}> *</span>}
    </label>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {prefix && (
        <span style={{ color: 'var(--stone)', fontSize: 15, fontWeight: 600 }}>{prefix}</span>
      )}
      <input
        id={id}
        className="form-input mono"
        type="number"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? NaN : +e.target.value)}
        min={min}
        max={max}
        step={step}
        required={required}
        aria-invalid={error ? true : undefined}
        style={error ? { borderColor: 'var(--accent-danger)' } : undefined}
      />
      {suffix && <span style={{ color: 'var(--stone)', fontSize: 14 }}>{suffix}</span>}
    </div>
    {error ? (
      <div className="form-error" role="alert">
        {error}
      </div>
    ) : hint ? (
      <div className="form-hint">{hint}</div>
    ) : null}
  </div>
);

// ── CheckboxField ───────────────────────────────────────────────────────────

interface CheckboxFieldProps {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  hint?: string;
}

export const CheckboxField: React.FC<CheckboxFieldProps> = ({
  id,
  checked,
  onChange,
  label,
  hint,
}) => (
  <label
    htmlFor={id}
    className="flex items-start gap-3"
    style={{ fontSize: 14, cursor: 'pointer', alignItems: 'flex-start' }}
  >
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      style={{ accentColor: 'var(--primary)', width: 16, height: 16, marginTop: 2, flexShrink: 0 }}
    />
    <span>
      <span style={{ color: 'var(--on-dark-mute)' }}>{label}</span>
      {hint && (
        <span style={{ display: 'block', color: 'var(--stone)', fontSize: 12, marginTop: 2 }}>
          {hint}
        </span>
      )}
    </span>
  </label>
);

// ── LockTag ─────────────────────────────────────────────────────────────────

export const LockTag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--accent-teal)',
      background: 'rgba(0,168,126,0.12)',
      padding: '3px 8px',
      borderRadius: 'var(--r-full)',
    }}
  >
    <Check size={11} strokeWidth={3} aria-hidden="true" />
    {children}
  </span>
);

// ── InlineValidation ────────────────────────────────────────────────────────

export const InlineValidation: React.FC<{
  tone: 'ok' | 'error' | 'pending';
  children: React.ReactNode;
}> = ({ tone, children }) => {
  const color =
    tone === 'ok' ? 'var(--accent-teal)' : tone === 'error' ? 'var(--accent-danger)' : 'var(--stone)';
  return (
    <div
      style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color, lineHeight: 1.6 }}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', marginTop: 1, flexShrink: 0 }}>
        {tone === 'ok' ? (
          <Check size={14} strokeWidth={2.5} />
        ) : tone === 'error' ? (
          <AlertTriangle size={14} strokeWidth={2.5} />
        ) : (
          <AlertTriangle size={14} strokeWidth={2} style={{ opacity: 0.5 }} />
        )}
      </span>
      <span>{children}</span>
    </div>
  );
};

// ── KeyValueRow ─────────────────────────────────────────────────────────────

export const KeyValueRow: React.FC<{
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  last?: boolean;
}> = ({ label, value, mono, last }) => (
  <div
    className="flex justify-between"
    style={{
      fontSize: 14,
      borderBottom: last ? 'none' : '1px solid var(--hairline-dark)',
      paddingBottom: last ? 0 : 8,
      gap: 12,
      alignItems: 'baseline',
    }}
  >
    <span style={{ color: 'var(--stone)' }}>{label}</span>
    <span
      className={mono ? 'mono' : undefined}
      style={{ color: 'var(--on-dark)', fontWeight: 600, textAlign: 'right' }}
    >
      {value}
    </span>
  </div>
);

export { SECTION_LABEL };
