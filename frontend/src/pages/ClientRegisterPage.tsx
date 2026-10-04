import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  User,
  Download,
  ShieldCheck,
  Target,
  CheckCircle2,
  Lock,
  Mail,
  Eye,
  EyeOff,
} from 'lucide-react';

import {
  fetchKycProviders,
  importKyc,
  registerClient,
  runRecommend,
} from '../api';
import type {
  BrokerProvider,
  ClientRegistrationResponse,
  EmploymentStatus,
  Experience,
  ProviderInfo,
  KycImportResponse,
  RecommendationResult,
  RiskAppetite,
  SourceOfFunds,
} from '../types';
import { Alert, Disclaimer, Spinner, VerdictBadge } from '../components/UIKit';
import {
  CheckboxField,
  KeyValueRow,
  LockTag,
  NumberField,
  SectionCard,
  SelectField,
  SliderField,
  TextField,
} from '../components/Form';
import { Stepper, WizardNav, type WizardStep } from '../components/Wizard';
import { useAuth } from '../hooks/useAuth';
import { humanize } from '../lib/format';

// ── Steps ───────────────────────────────────────────────────────────────────

type EntryMode = 'manual' | 'broker';

const STEPS: WizardStep[] = [
  { key: 'start', label: 'How to register' },
  { key: 'identity', label: 'Identity' },
  { key: 'financials', label: 'Financials' },
  { key: 'suitability', label: 'Suitability' },
  { key: 'review', label: 'Review' },
];

// ── Option vocabularies ─────────────────────────────────────────────────────

const EMPLOYMENT_OPTIONS: ReadonlyArray<{ value: EmploymentStatus; label: string }> = [
  { value: 'not_specified', label: 'Prefer not to say' },
  { value: 'salaried', label: 'Salaried employee' },
  { value: 'self_employed', label: 'Self-employed / freelancer' },
  { value: 'business_owner', label: 'Business owner' },
  { value: 'professional', label: 'Professional (doctor, lawyer, etc.)' },
  { value: 'student', label: 'Student' },
  { value: 'retired', label: 'Retired' },
  { value: 'homemaker', label: 'Homemaker' },
];

const SOURCE_OF_FUNDS_OPTIONS: ReadonlyArray<{ value: SourceOfFunds; label: string }> = [
  { value: 'salary', label: 'Salary' },
  { value: 'business_income', label: 'Business income' },
  { value: 'freelance', label: 'Freelance / consulting' },
  { value: 'investment_proceeds', label: 'Sale of investments' },
  { value: 'property_sale', label: 'Sale of property' },
  { value: 'business_sale', label: 'Sale of a business' },
  { value: 'inheritance', label: 'Inheritance' },
  { value: 'gift', label: 'Gift' },
  { value: 'loan', label: 'Loan' },
  { value: 'other', label: 'Other' },
];

const RISK_OPTIONS: ReadonlyArray<{ value: RiskAppetite; label: string }> = [
  { value: 'conservative', label: 'Conservative – I prioritise safety over high returns' },
  { value: 'moderate', label: 'Moderate – I accept some movement for a better return' },
  { value: 'aggressive', label: 'Aggressive – I accept high volatility for maximum growth' },
];

const EXPERIENCE_OPTIONS: ReadonlyArray<{ value: Experience; label: string }> = [
  { value: 'novice', label: 'Novice – little or no experience' },
  { value: 'intermediate', label: 'Intermediate – some structured product experience' },
  { value: 'experienced', label: 'Experienced – regular structured product investor' },
];

// ── Form state ──────────────────────────────────────────────────────────────

interface FormState {
  legal_name: string;
  date_of_birth: string;
  employment_status: EmploymentStatus;
  national_tax_id: string;
  liquid_net_worth: number;
  annual_income: number;
  source_of_funds: SourceOfFunds | null;
  previous_investment_exposure_pct: number;
  investment_amount: number;
  risk_appetite: RiskAppetite;
  investment_horizon_years: number;
  loss_tolerance_pct: number;
  current_portfolio_concentration_pct: number;
  experience: Experience;
  // Portal credentials
  portal_email: string;
  portal_password: string;
  portal_password_confirm: string;
}

const INITIAL_FORM: FormState = {
  legal_name: '',
  date_of_birth: '',
  employment_status: 'not_specified',
  national_tax_id: '',
  liquid_net_worth: NaN,
  annual_income: NaN,
  source_of_funds: null,
  previous_investment_exposure_pct: 0,
  investment_amount: NaN,
  risk_appetite: 'moderate',
  investment_horizon_years: 3,
  loss_tolerance_pct: 15,
  current_portfolio_concentration_pct: 10,
  experience: 'novice',
  portal_email: '',
  portal_password: '',
  portal_password_confirm: '',
};

const inr = (v: number) =>
  Number.isFinite(v) ? `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—';

// ── Validation ──────────────────────────────────────────────────────────────

function ageFrom(dob: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime()) || d.getTime() > Date.now()) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

interface StepErrors {
  [field: string]: string | undefined;
}

function validateIdentity(f: FormState): StepErrors {
  const e: StepErrors = {};
  if (f.legal_name.trim().length < 2) e.legal_name = 'Enter your full legal name as on your government ID.';
  const age = ageFrom(f.date_of_birth);
  if (!f.date_of_birth) e.date_of_birth = 'Date of birth is required.';
  else if (age === null) e.date_of_birth = 'Enter a valid date of birth.';
  else if (age < 18) e.date_of_birth = 'You must be at least 18 to invest.';
  return e;
}

function validateFinancials(f: FormState): StepErrors {
  const e: StepErrors = {};
  if (!Number.isFinite(f.liquid_net_worth) || f.liquid_net_worth <= 0)
    e.liquid_net_worth = 'Liquid net worth is required.';
  if (!Number.isFinite(f.annual_income) || f.annual_income <= 0)
    e.annual_income = 'Annual income is required.';
  if (!Number.isFinite(f.investment_amount) || f.investment_amount <= 0)
    e.investment_amount = 'Enter the amount you want to invest.';
  if (
    Number.isFinite(f.investment_amount) &&
    Number.isFinite(f.liquid_net_worth) &&
    f.investment_amount > f.liquid_net_worth
  )
    e.investment_amount = 'This exceeds your liquid net worth.';
  return e;
}

function validateSuitability(f: FormState): StepErrors {
  const e: StepErrors = {};
  if (!f.risk_appetite) e.risk_appetite = 'Risk appetite is required.';
  if (!Number.isFinite(f.investment_horizon_years) || f.investment_horizon_years <= 0)
    e.investment_horizon_years = 'Investment horizon is required.';
  if (!Number.isFinite(f.loss_tolerance_pct))
    e.loss_tolerance_pct = 'Loss tolerance is required.';
  if (!Number.isFinite(f.current_portfolio_concentration_pct))
    e.current_portfolio_concentration_pct = 'Portfolio concentration is required.';
  return e;
}

// ── Page ────────────────────────────────────────────────────────────────────

const ClientRegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { loginAsClient } = useAuth();

  const [step, setStep] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);

  const [mode, setMode] = useState<EntryMode | null>(null);
  const [form, setForm] = useState<FormState>({ ...INITIAL_FORM });

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<BrokerProvider | null>(null);
  const [handle, setHandle] = useState('');
  const [imported, setImported] = useState<KycImportResponse | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [consentKyc, setConsentKyc] = useState(false);
  const [consentSof, setConsentSof] = useState(false);
  const [showPortalPassword, setShowPortalPassword] = useState(false);
  const [showPortalPasswordConfirm, setShowPortalPasswordConfirm] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<ClientRegistrationResponse | null>(null);
  const [recommending, setRecommending] = useState(false);
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null);

  useEffect(() => {
    fetchKycProviders()
      .then((r) => setProviders(r.providers))
      .catch(() => setProviders([]));
  }, []);

  const set = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    []
  );

  const goTo = useCallback((index: number) => {
    setStep(Math.max(0, Math.min(STEPS.length - 1, index)));
    setError(null);
  }, []);

  const goBack = useCallback(() => {
    goTo(step - 1);
  }, [step, goTo]);

  const goNext = useCallback(() => {
    setMaxVisited((m) => Math.max(m, step + 1));
    goTo(step + 1);
  }, [step, goTo]);

  // ── Derived summary values ────────────────────────────────────────────────
  const age = useMemo(() => ageFrom(form.date_of_birth), [form.date_of_birth]);
  const allocationPct = useMemo(() => {
    if (!Number.isFinite(form.investment_amount) || !Number.isFinite(form.liquid_net_worth)) return null;
    if (form.liquid_net_worth <= 0) return null;
    return (form.investment_amount / form.liquid_net_worth) * 100;
  }, [form.investment_amount, form.liquid_net_worth]);
  const incomeMultiple = useMemo(() => {
    if (!Number.isFinite(form.investment_amount) || !Number.isFinite(form.annual_income)) return null;
    if (form.annual_income <= 0) return null;
    return form.investment_amount / form.annual_income;
  }, [form.investment_amount, form.annual_income]);
  const totalConcentration = useMemo(() => {
    const existing = form.previous_investment_exposure_pct || 0;
    const newPct = allocationPct ?? 0;
    return existing + newPct;
  }, [form.previous_investment_exposure_pct, allocationPct]);

  // ── KYC import ───────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!provider || handle.trim().length < 2) {
      setImportError('Pick a provider and enter the account id, user id or registered email.');
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const res = await importKyc(provider, handle.trim());
      setImported(res);

      const id = res.identity as Record<string, unknown>;
      const fin = res.financials as Record<string, unknown>;

      setForm((prev) => ({
        ...prev,
        legal_name: typeof id.legal_name === 'string' ? id.legal_name : prev.legal_name,
        date_of_birth:
          typeof id.date_of_birth === 'string' ? id.date_of_birth : prev.date_of_birth,
        employment_status:
          typeof id.employment_status === 'string'
            ? (id.employment_status as EmploymentStatus)
            : prev.employment_status,
        national_tax_id:
          typeof id.national_tax_id === 'string' ? id.national_tax_id : prev.national_tax_id,
        liquid_net_worth:
          typeof fin.liquid_net_worth === 'number' ? fin.liquid_net_worth : prev.liquid_net_worth,
        annual_income:
          typeof fin.annual_income === 'number' ? fin.annual_income : prev.annual_income,
        previous_investment_exposure_pct:
          typeof fin.previous_investment_exposure_pct === 'number'
            ? fin.previous_investment_exposure_pct
            : prev.previous_investment_exposure_pct,
      }));

      // The import only ever pre-fills. Suitability and source of funds are
      // cleared so the client must answer for themselves.
      setForm((prev) => ({ ...prev, source_of_funds: null }));
      setMaxVisited((m) => Math.max(m, 2));
      goTo(2);
    } catch (err: unknown) {
      const e = err as { detail?: string };
      setImportError(e?.detail ?? 'KYC import failed. Try again or register manually.');
    } finally {
      setImporting(false);
    }
  };

  const handleManual = () => {
    setMode('manual');
    setImported(null);
    setImportError(null);
    setMaxVisited((m) => Math.max(m, 1));
    goTo(1);
  };

  const handleBrokerContinue = () => {
    setMode('broker');
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const payload = {
    identity: {
      legal_name: form.legal_name.trim(),
      date_of_birth: form.date_of_birth,
      employment_status: form.employment_status,
      national_tax_id: form.national_tax_id.trim() ? form.national_tax_id.trim().toUpperCase() : null,
    },
    financials: {
      liquid_net_worth: form.liquid_net_worth,
      annual_income: form.annual_income,
      source_of_funds: form.source_of_funds,
      previous_investment_exposure_pct: form.previous_investment_exposure_pct,
      investment_amount: form.investment_amount,
    },
    suitability: {
      risk_appetite: form.risk_appetite,
      investment_horizon_years: form.investment_horizon_years,
      loss_tolerance_pct: form.loss_tolerance_pct,
      current_portfolio_concentration_pct: form.current_portfolio_concentration_pct,
      experience: form.experience,
    },
    broker_link: mode === 'broker' && provider ? { provider, handle: handle.trim() } : null,
    consent_kyc: consentKyc,
    consent_sof: consentSof,
    // Portal login credentials
    email: form.portal_email.trim() || undefined,
    password: form.portal_password || undefined,
  };

  const canSubmit =
    Object.keys(validateIdentity(form)).length === 0 &&
    Object.keys(validateFinancials(form)).length === 0 &&
    Object.keys(validateSuitability(form)).length === 0 &&
    !!form.portal_email.trim() &&
    form.portal_password.length >= 12 &&
    form.portal_password === form.portal_password_confirm &&
    consentKyc &&
    (mode !== 'broker' || consentSof);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await registerClient(payload);
      setRegistered(res);
      setMaxVisited((m) => Math.max(m, 4));
      goTo(4);
      await loginAsClient(form.portal_email.trim(), form.portal_password);
    } catch (err: unknown) {
      const e = err as { detail?: string };
      setError(e?.detail ?? 'Registration failed. Please review your answers.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFindProducts = async () => {
    if (!registered) return;
    setRecommending(true);
    setError(null);
    try {
      const rec = await runRecommend(registered.profile, registered.case_id);
      setRecommendation(rec);
    } catch (err: unknown) {
      const e = err as { detail?: string };
      setError(e?.detail ?? 'Could not build recommendations from this profile.');
    } finally {
      setRecommending(false);
    }
  };

  // ── Step validation gate ─────────────────────────────────────────────────
  const stepValid = (() => {
    switch (step) {
      case 1:
        return mode !== null;
      case 2:
        return Object.keys(validateIdentity(form)).length === 0;
      case 3:
        return (
          Object.keys(validateIdentity(form)).length === 0 &&
          Object.keys(validateFinancials(form)).length === 0
        );
      case 4:
        return true;
      default:
        return true;
    }
  })();

  const nextDisabled = (() => {
    if (step === 0) return mode === null || (mode === 'broker' && !imported);
    if (step === 1) return Object.keys(validateIdentity(form)).length > 0;
    if (step === 2) return Object.keys(validateFinancials(form)).length > 0;
    if (step === 3)
      return Object.keys(validateSuitability(form)).length > 0 || !consentKyc;
    return false;
  })();

  const identityErrors = validateIdentity(form);
  const financialErrors = validateFinancials(form);
  const suitabilityErrors = validateSuitability(form);

  return (
    <>
      <section
        className="band-dark"
        style={{ padding: '64px 0 40px', borderBottom: '1px solid var(--hairline-dark)' }}
      >
        <div className="page-container">
          <div className="hero-eyebrow" style={{ marginBottom: 16 }}>
            <User size={14} style={{ color: 'var(--accent-teal)' }} aria-hidden="true" />
            Client Onboarding
          </div>
          <h1 className="display-lg" style={{ color: 'var(--on-dark)', marginBottom: 12 }}>
            Register to get recommendations
          </h1>
          <p style={{ fontSize: 16, color: 'var(--on-dark-mute)', maxWidth: 640 }}>
            Complete your KYC, tell us what you can afford, and answer four suitability
            questions. You can import your details from an existing brokerage app instead of
            typing them.
          </p>
        </div>
      </section>

      <div className="band-dark" style={{ paddingBottom: 80 }}>
        <div className="page-container page-content animate-in">
          <title>Client registration – Neural Nexus</title>
          <meta
            name="description"
            content="Register as a client: KYC identity, financial capacity and suitability answers."
          />

          <Stepper
            steps={STEPS}
            current={step}
            maxVisited={maxVisited}
            onNavigate={goTo}
          />

          {error && <Alert variant="error" className="mb-6">{error}</Alert>}

          <div className="reg-layout">
            {/* ── Main column ──────────────────────────────────────────────── */}
            <div>
              {/* Step 0 – entry mode */}
              {step === 0 && (
                <div className="animate-in">
                  <SectionCard
                    title="Choose how to register"
                    subtitle="Both routes ask the same four suitability questions. Importing only saves you typing the KYC and financial fields."
                  >
                    <div className="grid-2">
                      <button
                        type="button"
                        className={`picker-card ${mode === 'manual' ? 'selected' : ''}`}
                        onClick={handleManual}
                        id="register-manual-btn"
                      >
                        <ShieldCheck
                          size={20}
                          style={{ color: 'var(--primary-bright)', flexShrink: 0, marginTop: 2 }}
                          aria-hidden="true"
                        />
                        <span>
                          <span className="picker-title">Enter details manually</span>
                          <span className="picker-desc">
                            Type your identity and financial details yourself. Nothing is shared
                            with a third party.
                          </span>
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`picker-card ${mode === 'broker' ? 'selected' : ''}`}
                        onClick={handleBrokerContinue}
                        id="register-import-btn"
                      >
                        <Download
                          size={20}
                          style={{ color: 'var(--accent-teal)', flexShrink: 0, marginTop: 2 }}
                          aria-hidden="true"
                        />
                        <span>
                          <span className="picker-title">Import from my broker</span>
                          <span className="picker-desc">
                            Pull KYC and holdings from Kite, Zerodha, Groww or Cred, then confirm
                            the details.
                          </span>
                        </span>
                      </button>
                    </div>
                  </SectionCard>

                  {mode === 'broker' && (
                    <SectionCard
                      title="Import from KYC"
                      subtitle="We only request read-only scopes. Risk appetite, horizon, loss tolerance and concentration are never imported — those must come from you."
                    >
                      {providers.length > 0 && providers.every((p) => !p.connected) && (
                        <Alert variant="info" className="mb-3">
                          No broker connector is live yet, so KYC can't be imported automatically.{' '}
                          <button
                            type="button"
                            className="btn btn-outline-dark btn-sm"
                            onClick={handleManual}
                            style={{ marginLeft: 6 }}
                          >
                            Register manually
                          </button>
                        </Alert>
                      )}
                      {providers.length === 0 && (
                        <Alert variant="info">
                          Could not load the provider list. Is the backend running? You can still{' '}
                          <button
                            type="button"
                            className="btn btn-outline-dark btn-sm"
                            onClick={handleManual}
                            style={{ marginLeft: 6 }}
                          >
                            register manually
                          </button>
                        </Alert>
                      )}

                      <div className="grid-2" style={{ gap: 12, marginBottom: 20 }}>
                        {providers.map((p) => (
                          <button
                            key={p.key}
                            type="button"
                            className={`picker-card ${provider === p.key ? 'selected' : ''}`}
                            onClick={() => setProvider(p.key)}
                            disabled={!p.connected}
                            title={p.connected ? undefined : 'Not connected yet'}
                            aria-pressed={provider === p.key}
                            id={`provider-${p.key}`}
                          >
                            <span style={{ minWidth: 0 }}>
                              <span className="picker-title">{p.label}</span>
                              <span className="picker-desc">
                                {p.category} · {p.auth}{p.connected ? '' : ' · not connected'}
                              </span>
                              <span
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: 4,
                                  marginTop: 8,
                                }}
                              >
                                {p.scopes.map((s) => (
                                  <span key={s} className="chip">
                                    {s}
                                  </span>
                                ))}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>

                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <TextField
                            id="kyc-handle"
                            label="Account id, user id or registered email"
                            value={handle}
                            onChange={setHandle}
                            placeholder="e.g. AB1234 or you@examplebank.com"
                            hint="Used only to look up your profile. Stored masked."
                          />
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleImport}
                          disabled={importing || !provider}
                          aria-busy={importing}
                          id="kyc-import-btn"
                        >
                          {importing ? <Spinner size={14} label="Importing…" /> : <Download size={14} />}
                          {importing ? 'Importing…' : 'Import KYC'}
                        </button>
                      </div>

                      {importError && (
                        <Alert variant="error" className="mt-3">{importError}</Alert>
                      )}
                    </SectionCard>
                  )}
                </div>
              )}

              {/* Step 1 – identity */}
              {step === 1 && (
                <div className="animate-in">
                  <SectionCard
                    title="Primary information (KYC & identity)"
                    subtitle="Used to keep an accurate audit trail and to run the age and retirement-horizon checks."
                    badge={
                      imported ? (
                        <LockTag>
                          {imported.fields_prefilled.length} imported
                        </LockTag>
                      ) : undefined
                    }
                  >
                    {imported && (
                      <Alert variant="info" className="mb-6">
                        Pre-filled from {imported.provider_label} ({imported.handle_masked}). Check
                        each field — you remain responsible for its accuracy.
                      </Alert>
                    )}

                    <div className="grid-2">
                      <TextField
                        id="reg-legal-name"
                        label="Legal name"
                        value={form.legal_name}
                        onChange={(v) => set('legal_name', v)}
                        placeholder="e.g. Arjun Mehta"
                        hint="Exactly as it appears on your government ID."
                        error={identityErrors.legal_name}
                        required
                        maxLength={120}
                        autoComplete="name"
                      />
                      <TextField
                        id="reg-dob"
                        label="Date of birth"
                        type="date"
                        value={form.date_of_birth}
                        onChange={(v) => set('date_of_birth', v)}
                        error={identityErrors.date_of_birth}
                        hint={
                          age !== null
                            ? `Age ${age}. Drives life-stage checks.`
                            : 'Required. Used for life-stage checks.'
                        }
                        required
                      />
                      <SelectField
                        id="reg-employment"
                        label="Employment status"
                        value={form.employment_status}
                        onChange={(v) => set('employment_status', v)}
                        options={EMPLOYMENT_OPTIONS}
                        hint="Optional. Tells us whether you rely on a salary or on your investments."
                      />
                      <TextField
                        id="reg-tax-id"
                        label="National / tax ID"
                        value={form.national_tax_id}
                        onChange={(v) => set('national_tax_id', v.toUpperCase())}
                        placeholder="e.g. ABCDE1234V or XXXX1234"
                        hint="Optional. Masked values are accepted."
                        maxLength={32}
                        mono
                      />
                    </div>
                  </SectionCard>
                </div>
              )}

              {/* Step 2 – financials */}
              {step === 2 && (
                <div className="animate-in">
                  <SectionCard
                    title="Financial information (capacity)"
                    subtitle="We need a baseline of what you can absorb before matching any product to you."
                  >
                    <div className="grid-2">
                      <NumberField
                        id="reg-liquid-nw"
                        label="Liquid net worth"
                        value={form.liquid_net_worth}
                        onChange={(v) => set('liquid_net_worth', v)}
                        prefix="₹"
                        step={100000}
                        min={1}
                        error={financialErrors.liquid_net_worth}
                        hint="Cash and investments realisable within 7 days. Excludes your primary home."
                        required
                      />
                      <NumberField
                        id="reg-income"
                        label="Annual income"
                        value={form.annual_income}
                        onChange={(v) => set('annual_income', v)}
                        prefix="₹"
                        step={100000}
                        min={1}
                        error={financialErrors.annual_income}
                        hint="Expected yearly income before taxes."
                        required
                      />
                      <NumberField
                        id="reg-amount"
                        label="Amount you want to invest"
                        value={form.investment_amount}
                        onChange={(v) => set('investment_amount', v)}
                        prefix="₹"
                        step={100000}
                        min={1}
                        error={financialErrors.investment_amount}
                        hint={
                          allocationPct !== null
                            ? `${allocationPct.toFixed(1)}% of your liquid net worth.`
                            : 'This specific position.'
                        }
                        required
                      />
                      <SelectField<SourceOfFunds | ''>
                        id="reg-sof"
                        label="Source of funds"
                        value={form.source_of_funds ?? ''}
                        onChange={(v) => set('source_of_funds', v === '' ? null : v)}
                        options={[
                          { value: '', label: 'Not declared' },
                          ...SOURCE_OF_FUNDS_OPTIONS,
                        ]}
                        hint="Optional, but required above ₹50,00,000 for AML."
                      />
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <SliderField
                        id="reg-prev-exposure"
                        label="Previous investment exposure"
                        value={form.previous_investment_exposure_pct}
                        min={0}
                        max={100}
                        step={5}
                        format={(v) => `${v}%`}
                        onChange={(v) => set('previous_investment_exposure_pct', v)}
                        hint="of liquid net worth, in similar complex products"
                      />
                    </div>
                  </SectionCard>
                </div>
              )}

              {/* Step 3 – suitability */}
              {step === 3 && (
                <div className="animate-in">
                  <SectionCard
                    title="Core suitability metrics"
                    subtitle="These four answers map one-to-one onto Product Suitability requirements. They are mandatory and are never imported or defaulted."
                    badge={<LockTag>PS locked</LockTag>}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
                      <SelectField
                        id="reg-risk-appetite"
                        label="Risk appetite"
                        value={form.risk_appetite}
                        onChange={(v) => set('risk_appetite', v)}
                        options={RISK_OPTIONS}
                        required
                      />
                      <SliderField
                        id="reg-horizon"
                        label="Investment horizon"
                        value={form.investment_horizon_years}
                        min={0.25}
                        max={10}
                        step={0.25}
                        format={(v) => `${v} yr${v === 1 ? '' : 's'}`}
                        onChange={(v) => set('investment_horizon_years', v)}
                        hint="locked with no early exit"
                        valueColor="var(--on-dark)"
                      />
                      <SliderField
                        id="reg-loss-tolerance"
                        label="Loss tolerance"
                        value={form.loss_tolerance_pct}
                        min={0}
                        max={60}
                        step={1}
                        format={(v) => `${v}%`}
                        onChange={(v) => set('loss_tolerance_pct', v)}
                        hint="max you can permanently lose"
                        valueColor="var(--accent-danger)"
                      />
                      <SliderField
                        id="reg-concentration"
                        label="Current portfolio concentration"
                        value={form.current_portfolio_concentration_pct}
                        min={0}
                        max={100}
                        step={5}
                        format={(v) => `${v}%`}
                        onChange={(v) => set('current_portfolio_concentration_pct', v)}
                        hint="of total wealth in similar complex products"
                        valueColor={form.current_portfolio_concentration_pct > 35 ? 'var(--accent-danger)' : 'var(--on-dark)'}
                      />
                      <SelectField
                        id="reg-experience"
                        label="Investment experience"
                        value={form.experience}
                        onChange={(v) => set('experience', v)}
                        options={EXPERIENCE_OPTIONS}
                      />
                    </div>
                  </SectionCard>

                  <SectionCard title="Consent">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <CheckboxField
                        id="reg-consent-kyc"
                        checked={consentKyc}
                        onChange={setConsentKyc}
                        label={
                          <>
                            I consent to my KYC details being held and processed for
                            suitability assessment.{' '}
                            <span style={{ color: 'var(--accent-danger)' }}>*</span>
                          </>
                        }
                        hint="Required to create your profile."
                      />
                      {mode === 'broker' && (
                        <CheckboxField
                          id="reg-consent-sof"
                          checked={consentSof}
                          onChange={setConsentSof}
                          label={
                            <>
                              I confirm the source of funds I declared is accurate.{' '}
                              <span style={{ color: 'var(--accent-danger)' }}>*</span>
                            </>
                          }
                          hint="Anti-money-laundering attestation for clients who imported broker data."
                        />
                      )}
                    </div>
                  </SectionCard>

                  <SectionCard
                    title="Create portal login"
                    subtitle="Create an account to access the client portal. All fields are required."
                  >
                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label" htmlFor="reg-portal-email">
                          <Mail size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                          Email address
                        </label>
                        <input
                          id="reg-portal-email"
                          type="email"
                          className="form-input"
                          placeholder="your@email.com"
                          value={form.portal_email}
                          onChange={(e) => set('portal_email', e.target.value)}
                          autoComplete="email"
                          required
                        />
                        <div style={{ fontSize: 11, color: 'var(--stone)', marginTop: 4 }}>Used to log into your client portal</div>
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="reg-portal-password">
                          <Lock size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                          Password
                        </label>
                        <div style={{ position: 'relative' }}>
                          <input
                            id="reg-portal-password"
                            type={showPortalPassword ? 'text' : 'password'}
                            className="form-input"
                            placeholder="At least 12 characters"
                            value={form.portal_password}
                            onChange={(e) => set('portal_password', e.target.value)}
                            autoComplete="new-password"
                            minLength={12}
                            style={{ paddingRight: 40 }}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPortalPassword(!showPortalPassword)}
                            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--stone)', padding: 0 }}
                            aria-label={showPortalPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPortalPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                        {form.portal_password.length > 0 && form.portal_password.length < 12 && (
                          <div style={{ fontSize: 11, color: 'var(--accent-danger)', marginTop: 4 }}>
                            Use at least 12 characters.
                          </div>
                        )}
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="reg-portal-password-confirm">
                          <Lock size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                          Confirm password
                        </label>
                        <div style={{ position: 'relative' }}>
                          <input
                            id="reg-portal-password-confirm"
                            type={showPortalPasswordConfirm ? 'text' : 'password'}
                            className="form-input"
                            placeholder="Re-enter password"
                            value={form.portal_password_confirm}
                            onChange={(e) => set('portal_password_confirm', e.target.value)}
                            autoComplete="new-password"
                            required
                            style={{ paddingRight: 40 }}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPortalPasswordConfirm(!showPortalPasswordConfirm)}
                            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--stone)', padding: 0 }}
                            aria-label={showPortalPasswordConfirm ? 'Hide confirm password' : 'Show confirm password'}
                          >
                            {showPortalPasswordConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                        {form.portal_password_confirm.length > 0 && form.portal_password !== form.portal_password_confirm && (
                          <div style={{ fontSize: 11, color: 'var(--accent-danger)', marginTop: 4 }}>Passwords do not match</div>
                        )}
                      </div>
                    </div>
                  </SectionCard>
                </div>
              )}

              {/* Step 4 – review */}
              {step === 4 && (
                <div className="animate-in">
                  {!registered ? (
                    <SectionCard
                      title="Review and submit"
                      subtitle="Check every answer. Your suitability answers cannot be changed once a recommendation is generated."
                    >
                      {Object.keys(identityErrors).length > 0 ||
                      Object.keys(financialErrors).length > 0 ||
                      Object.keys(suitabilityErrors).length > 0 ? (
                        <Alert variant="warning" className="mb-6">
                          Some answers are incomplete or invalid. Go back and fix the highlighted
                          fields before submitting.
                        </Alert>
                      ) : !form.portal_email.trim() || !form.portal_password ? (
                        <Alert variant="warning" className="mb-6">
                          Enter an email address and create a password of at least 12 characters.
                        </Alert>
                      ) : form.portal_password !== form.portal_password_confirm ? (
                        <Alert variant="warning" className="mb-6">
                          Your passwords do not match.
                        </Alert>
                      ) : canSubmit ? null : (
                        <Alert variant="warning" className="mb-6">
                          Please accept the KYC consent to continue.
                        </Alert>
                      )}

                      <ReviewBlock form={form} mode={mode} providerLabel={
                        providers.find((p) => p.key === provider)?.label
                      } />

                      <WizardNav
                        onBack={goBack}
                        onNext={handleSubmit}
                        nextLabel="Submit registration"
                        loading={submitting}
                        loadingLabel="Registering…"
                        nextDisabled={!canSubmit}
                      />
                    </SectionCard>
                  ) : (
                    <RegisteredSummary
                      registered={registered}
                      recommending={recommending}
                      recommendation={recommendation}
                      onFindProducts={handleFindProducts}
                      onViewDashboard={(runId) => navigate(`/dashboard/${runId}`)}
                      onStartOver={() => {
                        setRegistered(null);
                        setRecommendation(null);
                        setForm({ ...INITIAL_FORM });
                        setMode(null);
                        setImported(null);
                        setHandle('');
                        setProvider(null);
                        setConsentKyc(false);
                        setConsentSof(false);
                        setMaxVisited(0);
                        goTo(0);
                      }}
                    />
                  )}
                </div>
              )}

              {/* Nav for steps 0–3 */}
              {step < 4 && (
                <WizardNav
                  onBack={step > 0 ? () => goTo(step - 1) : undefined}
                  onNext={step === 0 ? () => (mode === 'manual' ? handleManual() : goNext()) : goNext}
                  loading={step === 0 && mode === 'broker' ? importing : false}
                  loadingLabel="Importing…"
                  nextDisabled={!stepValid || nextDisabled}
                />
              )}
            </div>

            {/* ── Aside ────────────────────────────────────────────────────── */}
            <aside className="reg-aside">
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
                  Your profile so far
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <KeyValueRow
                    label="Name"
                    value={form.legal_name.trim() || '—'}
                  />
                  <KeyValueRow label="Age" value={age !== null ? `${age}` : '—'} />
                  <KeyValueRow
                    label="Liquid net worth"
                    value={inr(form.liquid_net_worth)}
                  />
                  <KeyValueRow label="Investable" value={inr(form.investment_amount)} />
                  <KeyValueRow
                    label="Allocation"
                    value={allocationPct !== null ? `${allocationPct.toFixed(1)}%` : '—'}
                  />
                  <KeyValueRow
                    label="Income multiple"
                    value={
                      incomeMultiple !== null ? `${incomeMultiple.toFixed(1)}×` : '—'
                    }
                  />
                  <KeyValueRow
                    label="Risk"
                    value={humanize(form.risk_appetite)}
                  />
                  <KeyValueRow
                    label="Horizon"
                    value={`${form.investment_horizon_years} yrs`}
                  />
                  <KeyValueRow label="Max loss" value={`${form.loss_tolerance_pct}%`} last />
                </div>
              </div>

              {allocationPct !== null && allocationPct > 30 && (
                <Alert variant="warning" className="mb-4">
                  This position is {allocationPct.toFixed(1)}% of your liquid net worth. That is
                  above the 30% single-product guideline — consider a smaller ticket.
                </Alert>
              )}
              {totalConcentration > 35 && (
                <Alert variant="warning" className="mb-4">
                  Post-trade structured concentration would be{' '}
                  {totalConcentration.toFixed(1)}%, above the 35% guideline.
                </Alert>
              )}


            </aside>
          </div>
        </div>
      </div>
    </>
  );
};

export default ClientRegisterPage;

// ── ReviewBlock ─────────────────────────────────────────────────────────────

const ReviewBlock: React.FC<{
  form: FormState;
  mode: EntryMode | null;
  providerLabel?: string;
}> = ({ form, mode, providerLabel }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    <div>
      <div className="stat-label" style={{ marginBottom: 10 }}>
        Identity
      </div>
      <div className="grid-2" style={{ gap: 10 }}>
        <KeyValueRow label="Legal name" value={form.legal_name || '—'} />
        <KeyValueRow label="Date of birth" value={form.date_of_birth || '—'} />
        <KeyValueRow label="Employment" value={humanize(form.employment_status)} />
        <KeyValueRow label="Tax ID" value={form.national_tax_id || 'Not provided'} />
      </div>
    </div>

    <div>
      <div className="stat-label" style={{ marginBottom: 10 }}>
        Financials
      </div>
      <div className="grid-2" style={{ gap: 10 }}>
        <KeyValueRow label="Liquid net worth" value={inr(form.liquid_net_worth)} />
        <KeyValueRow label="Annual income" value={inr(form.annual_income)} />
        <KeyValueRow label="Investment amount" value={inr(form.investment_amount)} />
        <KeyValueRow
          label="Source of funds"
          value={form.source_of_funds ? humanize(form.source_of_funds) : 'Not declared'}
        />
      </div>
    </div>

    <div>
      <div className="stat-label" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        Suitability <LockTag>PS locked</LockTag>
      </div>
      <div className="grid-2" style={{ gap: 10 }}>
        <KeyValueRow label="Risk appetite" value={humanize(form.risk_appetite)} />
        <KeyValueRow label="Horizon" value={`${form.investment_horizon_years} years`} />
        <KeyValueRow label="Loss tolerance" value={`${form.loss_tolerance_pct}%`} />
        <KeyValueRow
          label="Concentration"
          value={`${form.current_portfolio_concentration_pct}%`}
        />
      </div>
    </div>

    <div>
      <div className="stat-label" style={{ marginBottom: 10 }}>
        Registration source
      </div>
      <KeyValueRow
        label="KYC source"
        value={mode === 'broker' ? `Imported from ${providerLabel ?? 'broker'}` : 'Entered manually'}
      />
    </div>
  </div>
);

// ── RegisteredSummary ───────────────────────────────────────────────────────

const RegisteredSummary: React.FC<{
  registered: ClientRegistrationResponse;
  recommending: boolean;
  recommendation: RecommendationResult | null;
  onFindProducts: () => void;
  onViewDashboard: (runId: string) => void;
  onStartOver: () => void;
}> = ({ registered, recommending, recommendation, onFindProducts, onViewDashboard, onStartOver }) => (
  <div className="animate-in">
    <div className="card" style={{ marginBottom: 20, borderTop: '2px solid var(--accent-teal)' }}>
      <div className="flex items-center gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
        <CheckCircle2 size={22} style={{ color: 'var(--accent-teal)' }} aria-hidden="true" />
        <div>
          <div className="card-title" style={{ fontSize: 18 }}>
            You are registered, {registered.client_name}
          </div>
          <div className="card-subtitle" style={{ marginBottom: 0 }}>
            Case <span className="mono">{registered.case_id}</span> · age {registered.age_years} ·{' '}
            KYC {registered.kyc_verified ? 'verified' : 'self-attested'}
          </div>
        </div>
      </div>

      {registered.kyc_flags.length > 0 && (
        <Alert variant="info" className="mb-4">
          <strong>Open KYC items</strong>
          <ul style={{ margin: '8px 0 0 16px' }}>
            {registered.kyc_flags.map((f) => (
              <li key={f}>{f.replace(/_/g, ' ')}</li>
            ))}
          </ul>
        </Alert>
      )}

      {!recommendation ? (
        <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onFindProducts}
            disabled={recommending}
            aria-busy={recommending}
            id="reg-find-products-btn"
          >
            {recommending ? <Spinner size={16} label="Analysing…" /> : <Target size={16} />}
            {recommending ? 'Analysing your profile…' : 'Find suitable products'}
          </button>
          <Link to="/client" className="btn btn-outline-dark" id="reg-open-portal-btn">
            Open my portal
          </Link>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="card-title">{recommendation.ranking.length} candidates analysed</div>
            {recommendation.best && <VerdictBadge verdict={recommendation.best.verdict} />}
          </div>

          {recommendation.ranking.length === 0 ? (
            <Alert variant="warning">
              No product candidates could be built. Confirm your underlying preferences with your
              relationship manager.
            </Alert>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" aria-label="Recommended products">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Product</th>
                    <th>Underlying</th>
                    <th>Fit</th>
                    <th>Verdict</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recommendation.ranking.slice(0, 8).map((c, i) => (
                    <tr key={c.run_id}>
                      <td style={{ color: i === 0 ? 'var(--accent-teal)' : 'var(--stone)', fontWeight: 700 }}>
                        {i + 1}
                      </td>
                      <td>
                        <span className={`product-pill ${c.product_type}`}>{c.product_type}</span>
                      </td>
                      <td className="mono" style={{ fontSize: 13 }}>
                        {String((c.config as { underlying?: unknown }).underlying ?? '—')}
                      </td>
                      <td>{(c.fit_score * 100).toFixed(0)}</td>
                      <td>
                        <VerdictBadge verdict={c.verdict} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-outline-dark btn-sm"
                          onClick={() => onViewDashboard(c.run_id)}
                        >
                          View →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            className="btn btn-outline-dark mt-4"
            onClick={onStartOver}
          >
            Register another client
          </button>
        </div>
      )}

    </div>

    {recommendation && <Disclaimer text={recommendation.disclaimer} />}
  </div>
);
