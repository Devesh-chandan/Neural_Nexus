import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Building2, CheckCircle2, Lock, UserCog } from 'lucide-react';

import {
  fetchAccessTiers,
  fetchJurisdictions,
  registerRelationshipManager,
  validateCorporateEmail,
} from '../api';
import type {
  AccessTier,
  AccessTierInfo,
  Jurisdiction,
  JurisdictionInfo,
  RMSRegistrationResponse,
} from '../types';
import { Alert, Spinner } from '../components/UIKit';
import {
  InlineValidation,
  KeyValueRow,
  LockTag,
  SectionCard,
  SelectField,
  TextField,
} from '../components/Form';
import { Stepper, WizardNav, type WizardStep } from '../components/Wizard';
import { useAuth } from '../hooks/useAuth';

// ── Steps ───────────────────────────────────────────────────────────────────

const STEPS: WizardStep[] = [
  { key: 'identity', label: 'Identity' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'access', label: 'Access & branch' },
  { key: 'review', label: 'Review' },
];

// ── Form state ──────────────────────────────────────────────────────────────

interface RMFormState {
  legal_name: string;
  corporate_email: string;
  employee_id: string;
  password: string;
  regulatory_registration_number: string;
  operating_jurisdiction: Jurisdiction;
  institution: string;
  branch_code: string;
  department: string;
  access_tier: AccessTier;
  product_types_authorised: string[];
}

const INITIAL_FORM: RMFormState = {
  legal_name: '',
  corporate_email: '',
  employee_id: '',
  password: '',
  regulatory_registration_number: '',
  operating_jurisdiction: 'IN',
  institution: '',
  branch_code: '',
  department: '',
  access_tier: 'junior_rm',
  product_types_authorised: [],
};

const ALL_PRODUCT_TYPES = ['ELN', 'CPN', 'DCD'] as const;

const LOCAL_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TIER_FALLBACK: AccessTierInfo[] = [
  {
    key: 'junior_rm',
    label: 'Junior RM',
    rank: 1,
    description:
      'May load a client profile, simulate payoffs and read the suitability outcome. Cannot confirm or finalise a product configuration.',
    escalate_to: 'Senior Advisor',
    permissions: ['simulate', 'view_suitability', 'draft_configuration', 'view_client_kyc'],
    can_finalise: false,
    finalise_blocked_reason: null,
    permission_labels: {},
  },
  {
    key: 'senior_advisor',
    label: 'Senior Advisor',
    rank: 2,
    description:
      'Everything a Junior RM can do, plus confirming and finalising a product configuration for the client and issuing client-facing reports.',
    escalate_to: 'Branch Manager',
    permissions: [
      'simulate',
      'view_suitability',
      'draft_configuration',
      'finalise_configuration',
      'export_report',
      'view_client_kyc',
    ],
    can_finalise: true,
    finalise_blocked_reason: null,
    permission_labels: {},
  },
  {
    key: 'branch_manager',
    label: 'Branch Manager',
    rank: 3,
    description:
      'Full control: finalisation, suitability-override approval, branch-level reporting and product catalogue management.',
    escalate_to: null,
    permissions: [
      'simulate',
      'view_suitability',
      'draft_configuration',
      'finalise_configuration',
      'approve_override',
      'export_report',
      'view_client_kyc',
      'view_team_reports',
      'manage_product_catalogue',
    ],
    can_finalise: true,
    finalise_blocked_reason: null,
    permission_labels: {},
  },
];

const permissionLabel = (p: string) =>
  p.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// ── Validation ──────────────────────────────────────────────────────────────

interface StepErrors {
  [field: string]: string | undefined;
}

function validateIdentity(f: RMFormState): StepErrors {
  const e: StepErrors = {};
  if (f.legal_name.trim().length < 2)
    e.legal_name = 'Enter your full legal name as per your employment record.';
  const email = f.corporate_email.trim();
  if (!email) e.corporate_email = 'A corporate email address is required.';
  else if (!LOCAL_EMAIL_RE.test(email))
    e.corporate_email = 'Enter a valid email address.';
  if (f.employee_id.trim().length < 2)
    e.employee_id = 'Employee id is required and must be unique in your institution.';
  if (f.password.length < 12)
    e.password = 'Use a password with at least 12 characters.';
  return e;
}

function validateCompliance(f: RMFormState): StepErrors {
  const e: StepErrors = {};
  if (f.regulatory_registration_number.trim().length < 4)
    e.regulatory_registration_number = 'Regulatory registration number is required.';
  return e;
}

function validateAccess(f: RMFormState): StepErrors {
  const e: StepErrors = {};
  if (f.institution.trim().length < 2) e.institution = 'Institution / bank name is required.';
  if (f.branch_code.trim().length < 1) e.branch_code = 'Branch code is required.';
  return e;
}

// ── Page ────────────────────────────────────────────────────────────────────

const RMRegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { loginAsRM } = useAuth();

  const [step, setStep] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [form, setForm] = useState<RMFormState>({ ...INITIAL_FORM });

  const [tiers, setTiers] = useState<AccessTierInfo[]>(TIER_FALLBACK);
  const [jurisdictions, setJurisdictions] = useState<JurisdictionInfo[]>([]);

  // Live corporate-email validation (debounced against the backend).
  const [emailCheck, setEmailCheck] = useState<{
    state: 'idle' | 'checking' | 'pending' | 'ok' | 'error';
    message: string;
    isPublic: boolean;
  }>({ state: 'idle', message: '', isPublic: false });
  const emailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<RMSRegistrationResponse | null>(null);

  useEffect(() => {
    fetchAccessTiers()
      .then((r) => setTiers(r.tiers.length > 0 ? r.tiers : TIER_FALLBACK))
      .catch(() => setTiers(TIER_FALLBACK));
    fetchJurisdictions()
      .then((r) => setJurisdictions(r.jurisdictions))
      .catch(() => setJurisdictions([]));
  }, []);

  useEffect(() => () => { if (emailTimer.current) clearTimeout(emailTimer.current); }, []);

  const set = useCallback(
    <K extends keyof RMFormState>(key: K, value: RMFormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    []
  );

  const goTo = useCallback((index: number) => {
    setStep(Math.max(0, Math.min(STEPS.length - 1, index)));
    setError(null);
  }, []);

  const goNext = useCallback(() => {
    setMaxVisited((m) => Math.max(m, step + 1));
    goTo(step + 1);
  }, [step, goTo]);

  const goBack = useCallback(() => goTo(step - 1), [step, goTo]);

  // ── Corporate email: validate against the backend blocklist ───────────────
  const handleEmailChange = useCallback((value: string) => {
    set('corporate_email', value);
    if (emailTimer.current) clearTimeout(emailTimer.current);

    const trimmed = value.trim();
    if (!trimmed || !LOCAL_EMAIL_RE.test(trimmed)) {
      setEmailCheck({
        state: trimmed ? 'error' : 'idle',
        message: trimmed ? 'Enter a valid email address.' : '',
        isPublic: false,
      });
      return;
    }

    setEmailCheck({ state: 'checking', message: 'Checking institutional domain…', isPublic: false });
    emailTimer.current = setTimeout(() => {
      validateCorporateEmail(trimmed)
        .then((res) =>
          setEmailCheck({
            state: res.accepted ? 'ok' : 'error',
            message: res.message,
            isPublic: res.is_public_provider,
          })
        )
        .catch(() =>
          setEmailCheck({
            state: 'pending' as unknown as 'idle',
            message: 'Could not reach the compliance check. Registration will validate again.',
            isPublic: false,
          })
        );
    }, 450);
  }, [set]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const jurisdiction = useMemo(
    () => jurisdictions.find((j) => j.code === form.operating_jurisdiction) ?? null,
    [jurisdictions, form.operating_jurisdiction]
  );

  const tierInfo = useMemo(
    () => tiers.find((t) => t.key === form.access_tier) ?? null,
    [tiers, form.access_tier]
  );

  const permittedProducts = jurisdiction?.permitted_product_types ?? [];

  // Keep the requested product list inside the jurisdiction matrix.
  useEffect(() => {
    if (permittedProducts.length === 0) return;
    setForm((prev) => {
      const allowed = new Set(permittedProducts.map((p) => p.toUpperCase()));
      const clamped = prev.product_types_authorised.filter((p) => allowed.has(p));
      return clamped.length === prev.product_types_authorised.length
        ? prev
        : { ...prev, product_types_authorised: clamped };
    });
  }, [permittedProducts]);

  const toggleProduct = (pt: string) => {
    setForm((prev) => {
      const upper = pt.toUpperCase();
      const has = prev.product_types_authorised.includes(upper);
      return {
        ...prev,
        product_types_authorised: has
          ? prev.product_types_authorised.filter((p) => p !== upper)
          : [...prev.product_types_authorised, upper],
      };
    });
  };

  const identityErrors = validateIdentity(form);
  const complianceErrors = validateCompliance(form);
  const accessErrors = validateAccess(form);

  const emailRejected =
    emailCheck.state === 'error' && emailCheck.message.length > 0 && !!form.corporate_email.trim();

  const canSubmit =
    Object.keys(identityErrors).length === 0 &&
    Object.keys(complianceErrors).length === 0 &&
    Object.keys(accessErrors).length === 0 &&
    !emailRejected;

  const payload = {
    identity: {
      legal_name: form.legal_name.trim(),
      corporate_email: form.corporate_email.trim().toLowerCase(),
      employee_id: form.employee_id.trim(),
    },
    compliance: {
      regulatory_registration_number: form.regulatory_registration_number.trim().toUpperCase(),
      operating_jurisdiction: form.operating_jurisdiction,
      product_types_authorised: form.product_types_authorised,
    },
    access: {
      institution: form.institution.trim(),
      branch_code: form.branch_code.trim().toUpperCase(),
      department: form.department.trim() || null,
      access_tier: form.access_tier,
    },
    password: form.password,
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await registerRelationshipManager(payload);
      setRegistered(res);
      setMaxVisited((m) => Math.max(m, 3));
      goTo(3);
      await loginAsRM(form.corporate_email.trim().toLowerCase(), form.password);
    } catch (err: unknown) {
      const e = err as { detail?: string };
      setError(e?.detail ?? 'Registration failed. Please review your answers.');
    } finally {
      setSubmitting(false);
    }
  };

  const nextDisabled = (() => {
    if (step === 0)
      return Object.keys(identityErrors).length > 0 || emailRejected;
    if (step === 1) return Object.keys(complianceErrors).length > 0;
    if (step === 2) return Object.keys(accessErrors).length > 0;
    return false;
  })();

  return (
    <>
      <section
        className="band-dark"
        style={{ padding: '64px 0 40px', borderBottom: '1px solid var(--hairline-dark)' }}
      >
        <div className="page-container">
          <div className="hero-eyebrow" style={{ marginBottom: 16 }}>
            <UserCog size={14} style={{ color: 'var(--accent-teal)' }} aria-hidden="true" />
            Relationship Manager Onboarding
          </div>
          <h1 className="display-lg" style={{ color: 'var(--on-dark)', marginBottom: 12 }}>
            Register as an RM
          </h1>
          <p style={{ fontSize: 16, color: 'var(--on-dark-mute)', maxWidth: 660 }}>
            An RM needs an institutional email, a verifiable regulatory registration number and a
            branch assignment. Your access tier decides what you may confirm — and what you must
            escalate.
          </p>
        </div>
      </section>

      <div className="band-dark" style={{ paddingBottom: 80 }}>
        <div className="page-container page-content animate-in">
          <title>RM registration – Neural Nexus</title>
          <meta
            name="description"
            content="Relationship Manager registration: identity, regulatory compliance and role-based access control."
          />

          <Stepper steps={STEPS} current={step} maxVisited={maxVisited} onNavigate={goTo} />

          {error && <Alert variant="error" className="mb-6">{error}</Alert>}

          <div className="reg-layout">
            <div>
              {/* ── Step 0 – identity ────────────────────────────────────────── */}
              {step === 0 && (
                <div className="animate-in">
                  <SectionCard
                    title="Primary information (identity)"
                    subtitle="Your full legal name and employee id are the audit key for every action you take on this platform."
                  >
                    <div className="grid-2">
                      <TextField
                        id="rmreg-legal-name"
                        label="Full legal name"
                        value={form.legal_name}
                        onChange={(v) => set('legal_name', v)}
                        placeholder="e.g. Priya Sharma"
                        hint="As per your employment record."
                        error={identityErrors.legal_name}
                        required
                        maxLength={120}
                        autoComplete="name"
                      />
                      <TextField
                        id="rmreg-employee-id"
                        label="Employee ID"
                        value={form.employee_id}
                        onChange={(v) => set('employee_id', v.toUpperCase())}
                        placeholder="e.g. RM-4821"
                        hint="Unique within your institution."
                        error={identityErrors.employee_id}
                        required
                        maxLength={48}
                        mono
                      />
                    </div>

                    <div className="mt-6">
                      <TextField
                        id="rmreg-email"
                        label="Corporate email"
                        type="email"
                        value={form.corporate_email}
                        onChange={handleEmailChange}
                        placeholder="you@yourinstitution.com"
                        hint="Personal mailboxes (gmail, yahoo, outlook…) are rejected so client PII cannot be sent to a private inbox."
                        error={identityErrors.corporate_email}
                        required
                        maxLength={160}
                        autoComplete="email"
                      />
                      {form.corporate_email.trim() && (
                        <div style={{ marginTop: 10 }}>
                          <InlineValidation
                            tone={
                              emailCheck.state === 'ok'
                                ? 'ok'
                                : emailCheck.state === 'checking'
                                ? 'pending'
                                : emailCheck.state === 'error'
                                ? 'error'
                                : 'pending'
                            }
                          >
                            {emailCheck.state === 'checking' ? (
                              <span className="flex items-center gap-2">
                                <Spinner size={12} /> {emailCheck.message}
                              </span>
                            ) : (
                              emailCheck.message
                            )}
                            {emailCheck.isPublic && (
                              <>
                                {' '}
                                <Lock
                                  size={12}
                                  style={{ display: 'inline', verticalAlign: '-1px' }}
                                  aria-hidden="true"
                                />{' '}
                                public mailbox blocked
                              </>
                            )}
                          </InlineValidation>
                        </div>
                      )}
                    </div>

                    <div className="mt-6">
                      <TextField
                        id="rmreg-password"
                        label="Account password"
                        type="password"
                        value={form.password}
                        onChange={(value) => set('password', value)}
                        placeholder="At least 12 characters"
                        hint="Used with your institutional email to sign in."
                        error={identityErrors.password}
                        required
                        autoComplete="new-password"
                        minLength={12}
                      />
                    </div>
                  </SectionCard>
                </div>
              )}

              {/* ── Step 1 – compliance ──────────────────────────────────────── */}
              {step === 1 && (
                <div className="animate-in">
                  <SectionCard
                    title="Regulatory information (compliance)"
                    subtitle="Your registration number is checked against the format the regulator issues in your jurisdiction."
                  >
                    <div className="grid-2">
                      <SelectField<Jurisdiction>
                        id="rmreg-jurisdiction"
                        label="Operating jurisdiction"
                        value={form.operating_jurisdiction}
                        onChange={(v) => set('operating_jurisdiction', v)}
                        options={
                          jurisdictions.length > 0
                            ? jurisdictions.map((j) => ({
                                value: j.code,
                                label: `${j.code} — ${j.label}`,
                              }))
                            : [{ value: 'IN' as Jurisdiction, label: 'IN — India' }]
                        }
                        hint={
                          jurisdiction
                            ? `Regulator: ${jurisdiction.regulator}. Permitted structures: ${
                                jurisdiction.permitted_product_types.join(', ') || 'none'
                              }.`
                            : 'Where you are licensed to advise.'
                        }
                        required
                      />
                      <TextField
                        id="rmreg-reg-number"
                        label={jurisdiction?.registration_number_label ?? 'Regulatory registration number'}
                        value={form.regulatory_registration_number}
                        onChange={(v) => set('regulatory_registration_number', v.toUpperCase())}
                        placeholder={jurisdiction?.registration_number_example ?? 'e.g. INZ000000001'}
                        hint={
                          jurisdiction?.registration_number_example
                            ? `Format for ${jurisdiction.registration_number_label} (e.g. ${jurisdiction.registration_number_example}).`
                            : 'FINRA CRD, SEBI, FCA, DFSA, MAS, SFC or ASIC number.'
                        }
                        error={complianceErrors.regulatory_registration_number}
                        required
                        maxLength={32}
                        mono
                      />
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <div className="form-label" style={{ marginBottom: 8 }}>
                        Products you intend to configure
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {ALL_PRODUCT_TYPES.map((pt) => {
                          const allowed = permittedProducts.includes(pt);
                          const checked = form.product_types_authorised.includes(pt);
                          return (
                            <button
                              key={pt}
                              type="button"
                              id={`rmreg-product-${pt}`}
                              className={`picker-card ${checked ? 'selected' : ''}`}
                              onClick={() => allowed && toggleProduct(pt)}
                              disabled={!allowed}
                              aria-pressed={checked}
                              aria-disabled={!allowed}
                              style={{
                                flex: '0 0 auto',
                                minWidth: 150,
                                opacity: allowed ? 1 : 0.45,
                                cursor: allowed ? 'pointer' : 'not-allowed',
                              }}
                            >
                              <span className="picker-title">{pt}</span>
                              <span className="picker-desc">
                                {allowed ? 'Permitted in this jurisdiction' : 'Not permitted'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="form-hint" style={{ marginTop: 8 }}>
                        Greyed-out structures are not permitted in the selected jurisdiction.
                      </div>
                    </div>
                  </SectionCard>
                </div>
              )}

              {/* ── Step 2 – access ──────────────────────────────────────────── */}
              {step === 2 && (
                <div className="animate-in">
                  <SectionCard
                    title="Institution, branch & access tier (RBAC)"
                    subtitle="This SaaS deployment is multi-tenant: your RMs are scoped to one institution and one branch. The access tier is enforced server-side."
                  >
                    <div className="grid-2">
                      <TextField
                        id="rmreg-institution"
                        label="Institution / bank name"
                        value={form.institution}
                        onChange={(v) => set('institution', v)}
                        placeholder="e.g. HDFC Bank Ltd"
                        hint="Tenant boundary. RMs from different institutions cannot see each other's books."
                        error={accessErrors.institution}
                        required
                        maxLength={120}
                      />
                      <TextField
                        id="rmreg-branch"
                        label="Branch code"
                        value={form.branch_code}
                        onChange={(v) => set('branch_code', v.toUpperCase())}
                        placeholder="e.g. BAND-04"
                        hint="Sub-tenant boundary. Required for branch-level reporting."
                        error={accessErrors.branch_code}
                        required
                        maxLength={48}
                        mono
                      />
                      <TextField
                        id="rmreg-department"
                        label="Department (optional)"
                        value={form.department}
                        onChange={(v) => set('department', v)}
                        placeholder="e.g. Private Wealth"
                        hint="Free-text. Recorded for audit only."
                        maxLength={80}
                      />
                    </div>

                    <div style={{ marginTop: 20 }}>
                      <div className="form-label" style={{ marginBottom: 10 }}>
                        Access tier <span style={{ color: 'var(--accent-danger)' }}>*</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {tiers.map((t) => (
                          <TierCard
                            key={t.key}
                            tier={t}
                            selected={form.access_tier === t.key}
                            onSelect={() => set('access_tier', t.key)}
                          />
                        ))}
                      </div>
                    </div>
                  </SectionCard>
                </div>
              )}

              {/* ── Step 3 – review ──────────────────────────────────────────── */}
              {step === 3 && (
                <div className="animate-in">
                  {!registered ? (
                    <SectionCard
                      title="Review and submit"
                      subtitle="Your RM identity and clearance become part of the audit trail for every configuration you confirm."
                    >
                      {!canSubmit ? (
                        <Alert variant="warning" className="mb-6">
                          Some required answers are missing or a compliance rule rejected them. Go
                          back and fix the highlighted fields.
                        </Alert>
                      ) : null}

                      <ReviewBlock
                        form={form}
                        jurisdictionLabel={jurisdiction?.label}
                        regNumberLabel={jurisdiction?.registration_number_label}
                        tierLabel={tierInfo?.label}
                      />

                      <WizardNav
                        onBack={goBack}
                        onNext={handleSubmit}
                        nextLabel="Submit RM registration"
                        loading={submitting}
                        loadingLabel="Registering…"
                        nextDisabled={!canSubmit}
                      />
                    </SectionCard>
                  ) : (
                    <RegisteredCard
                      rm={registered}
                      onOpenWorkspace={() => navigate('/rm')}
                      onRegisterAnother={() => {
                        setRegistered(null);
                        setForm({ ...INITIAL_FORM });
                        setEmailCheck({ state: 'idle', message: '', isPublic: false });
                        setMaxVisited(0);
                        goTo(0);
                      }}
                    />
                  )}
                </div>
              )}

              {step < 3 && (
                <WizardNav
                  onBack={step > 0 ? goBack : undefined}
                  onNext={goNext}
                  nextDisabled={nextDisabled}
                />
              )}
            </div>

            {/* ── Aside ────────────────────────────────────────────────────── */}
            <aside className="reg-aside">
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="stat-label" style={{ marginBottom: 20 }}>
                  Effective clearance
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <KeyValueRow label="Tier" value={tierInfo?.label ?? form.access_tier} />
                  <KeyValueRow label="Jurisdiction" value={form.operating_jurisdiction} />
                  <KeyValueRow
                    label="Regulator"
                    value={jurisdiction?.regulator ?? '—'}
                  />
                  <KeyValueRow
                    label="Finalise"
                    value={
                      tierInfo?.can_finalise ? (
                        <span style={{ color: 'var(--accent-teal)' }}>Allowed</span>
                      ) : (
                        <span style={{ color: 'var(--accent-danger)' }}>
                          Escalate to {tierInfo?.escalate_to ?? 'a senior'}
                        </span>
                      )
                    }
                  />
                  <KeyValueRow
                    label="Structures"
                    value={
                      permittedProducts.length > 0 ? permittedProducts.join(', ') : '—'
                    }
                    last
                  />
                </div>
              </div>

              {tierInfo && step !== 2 && (
                <div className="card">
                  <div className="stat-label" style={{ marginBottom: 12 }}>
                    Permissions
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {tierInfo.permissions.map((p) => (
                      <span
                        key={p}
                        className="chip"
                        title={p}
                        style={
                          p === 'finalise_configuration'
                            ? {
                                borderColor: 'rgba(0,168,126,0.45)',
                                color: 'var(--accent-teal)',
                              }
                            : undefined
                        }
                      >
                        {tierInfo.permission_labels[p] ?? permissionLabel(p)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
    </>
  );
};

// ── TierCard ────────────────────────────────────────────────────────────────

const TierCard: React.FC<{
  tier: AccessTierInfo;
  selected: boolean;
  onSelect: () => void;
}> = ({ tier, selected, onSelect }) => (
  <button
    type="button"
    id={`rmreg-tier-${tier.key}`}
    className={`picker-card ${selected ? 'selected' : ''}`}
    onClick={onSelect}
    aria-pressed={selected}
  >
    <span style={{ minWidth: 0 }}>
      <span className="picker-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {tier.label}
        {tier.can_finalise ? (
          <LockTag>can finalise</LockTag>
        ) : (
          <span className="chip">simulate only</span>
        )}
      </span>
      <span className="picker-desc">{tier.description}</span>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
        {tier.permissions.map((p) => (
          <span key={p} className="chip">
            {tier.permission_labels[p] ?? permissionLabel(p)}
          </span>
        ))}
      </span>
    </span>
  </button>
);

// ── ReviewBlock ─────────────────────────────────────────────────────────────

const ReviewBlock: React.FC<{
  form: RMFormState;
  jurisdictionLabel?: string;
  regNumberLabel?: string;
  tierLabel?: string;
}> = ({ form, jurisdictionLabel, regNumberLabel, tierLabel }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    <div>
      <div className="stat-label" style={{ marginBottom: 10 }}>
        Identity
      </div>
      <div className="grid-2" style={{ gap: 10 }}>
        <KeyValueRow label="Legal name" value={form.legal_name || '—'} />
        <KeyValueRow label="Employee ID" value={form.employee_id || '—'} mono />
        <KeyValueRow label="Corporate email" value={form.corporate_email || '—'} />
      </div>
    </div>

    <div>
      <div className="stat-label" style={{ marginBottom: 10 }}>
        Compliance
      </div>
      <div className="grid-2" style={{ gap: 10 }}>
        <KeyValueRow
          label={regNumberLabel ?? 'Regulatory number'}
          value={form.regulatory_registration_number || '—'}
          mono
        />
        <KeyValueRow
          label="Jurisdiction"
          value={jurisdictionLabel ?? form.operating_jurisdiction}
        />
        <KeyValueRow
          label="Products"
          value={
            form.product_types_authorised.length > 0
              ? form.product_types_authorised.join(', ')
              : 'None selected'
          }
        />
      </div>
    </div>

    <div>
      <div className="stat-label" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        Access <LockTag>server enforced</LockTag>
      </div>
      <div className="grid-2" style={{ gap: 10 }}>
        <KeyValueRow label="Institution" value={form.institution || '—'} />
        <KeyValueRow label="Branch code" value={form.branch_code || '—'} mono />
        <KeyValueRow label="Department" value={form.department || '—'} />
        <KeyValueRow label="Access tier" value={tierLabel ?? form.access_tier} />
      </div>
    </div>
  </div>
);

// ── RegisteredCard ──────────────────────────────────────────────────────────

const RegisteredCard: React.FC<{
  rm: RMSRegistrationResponse;
  onOpenWorkspace: () => void;
  onRegisterAnother: () => void;
}> = ({ rm, onOpenWorkspace, onRegisterAnother }) => (
  <div className="animate-in">
    <div className="card" style={{ marginBottom: 20, borderTop: '2px solid var(--accent-teal)' }}>
      <div className="flex items-center gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
        <CheckCircle2 size={22} style={{ color: 'var(--accent-teal)' }} aria-hidden="true" />
        <div>
          <div className="card-title" style={{ fontSize: 18 }}>
            {rm.legal_name} is registered
          </div>
          <div className="card-subtitle" style={{ marginBottom: 0 }}>
            {rm.rm_id} · {rm.email_domain} · {rm.access_tier}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 10, marginBottom: 20 }}>
        <KeyValueRow label="Institution" value={rm.institution} />
        <KeyValueRow label="Branch" value={rm.branch_code} mono />
        <KeyValueRow label="Jurisdiction" value={`${rm.operating_jurisdiction} · ${rm.rbac.jurisdiction_label}`} />
        <KeyValueRow label="Regulator" value={rm.rbac.regulator} />
        <KeyValueRow
          label="Structures"
          value={
            rm.authorised_product_types.length > 0
              ? rm.authorised_product_types.join(', ')
              : 'None permitted'
          }
        />
        <KeyValueRow
          label="Finalise"
          value={
            rm.rbac.can_finalise ? (
              <span style={{ color: 'var(--accent-teal)' }}>Authorised</span>
            ) : (
              <span style={{ color: 'var(--accent-danger)' }}>
                Blocked — escalate to {rm.rbac.access_tier_label}
              </span>
            )
          }
        />
      </div>

      {rm.rbac.can_finalise ? (
        <Alert variant="info" className="mb-4">
          <strong>You may finalise configurations.</strong> Every confirmation is written to the
          audit log with your {rm.rbac.access_tier_label} clearance.
        </Alert>
      ) : (
        <Alert variant="warning" className="mb-4">
          <strong>
            <Building2 size={14} style={{ display: 'inline', verticalAlign: '-2px' }} aria-hidden="true" />{' '}
            Simulate-only clearance.
          </strong>{' '}
          {rm.rbac.finalise_blocked_reason ?? 'You cannot confirm a configuration.'}
        </Alert>
      )}

      <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-primary"
          id="rmreg-open-workspace-btn"
          onClick={onOpenWorkspace}
        >
          <Briefcase size={15} /> Open RM workspace
        </button>
        <button type="button" className="btn btn-outline-dark" onClick={onRegisterAnother}>
          Register another RM
        </button>
      </div>

    </div>
  </div>
);

export default RMRegisterPage;