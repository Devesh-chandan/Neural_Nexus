import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  TrendingUp,
  BarChart3,
  Brain,
  Lock,
  Zap,
  AlertTriangle,
  ShieldCheck,
  Check,
} from 'lucide-react';

/* ─── Data ─────────────────────────────────────────────────────────────── */

const PRODUCTS = [
  {
    type: 'ELN',
    name: 'Equity-Linked Note',
    subtitle: 'NIFTY 50 Index',
    yield: '12.0% p.a.',
    tenor: '12 Months',
    risk: 'Medium-High',
    riskColor: '#ec7e00',
    accent: '#00a87e',
    desc: 'Barrier-coupon structure earning enhanced fixed returns provided the underlying index does not breach the 75% knock-in barrier at maturity.',
    fit: 'Moderate to Aggressive investors seeking yield premium with contingent downside protection.',
  },
  {
    type: 'CPN',
    name: 'Capital-Protected Note',
    subtitle: 'BANKNIFTY Index',
    yield: '7.5% + 60% Upside',
    tenor: '24 Months',
    risk: 'Low-Medium',
    riskColor: '#00a87e',
    accent: '#007bc2',
    desc: 'Principal-guaranteed structured note providing 100% capital preservation with full equity upside participation up to cap.',
    fit: 'Conservative clients requiring absolute principal safety with inflation hedge.',
  },
  {
    type: 'DCD',
    name: 'Dual Currency Deposit',
    subtitle: 'USD / INR Spot',
    yield: '10.5% p.a.',
    tenor: '3 Months',
    risk: 'Medium',
    riskColor: '#494fdf',
    accent: '#ec7e00',
    desc: 'FX-linked deposit yielding premium interest rate, settled in alternate currency if spot crosses the agreed strike rate.',
    fit: 'Sophisticated clients with multi-currency cash flows or international treasury operations.',
  },
];

const FEATURES = [
  {
    icon: <TrendingUp size={20} />,
    title: 'Payoff Engineering',
    desc: 'Interactive payoff curves with real-time barrier breach simulation for ELN, CPN, and DCD structures.',
    accent: '#00a87e',
  },
  {
    icon: <ShieldCheck size={20} />,
    title: 'SEBI Suitability Engine',
    desc: 'Multi-layer deterministic compliance audit evaluating liquidity, loss tolerance, experience, and concentration.',
    accent: '#494fdf',
  },
  {
    icon: <BarChart3 size={20} />,
    title: 'Monte Carlo Simulation',
    desc: '2,000-path stochastic fan charts combined with empirical historical block-bootstrap stress testing.',
    accent: '#007bc2',
  },
  {
    icon: <Brain size={20} />,
    title: 'Dual LLM Rationale',
    desc: 'Translates quantitative risk metrics into plain prose for Clients and technical rationale for RMs.',
    accent: '#e61e49',
  },
  {
    icon: <Lock size={20} />,
    title: 'Cryptographic Audit',
    desc: 'Every assessment appended to an immutable SHA-256 hash ledger stored persistently in SQLite.',
    accent: '#ec7e00',
  },
  {
    icon: <Zap size={20} />,
    title: 'Zero-Dependency Resilience',
    desc: 'Seamless multi-tier data fallback: Live Market → Disk Cache → Bundled Historical CSV.',
    accent: '#00a87e',
  },
];

const STATS = [
  { value: '2,000+', label: 'Simulation paths per run' },
  { value: '3', label: 'Structured product classes' },
  { value: '100%', label: 'Deterministic audit trail' },
  { value: '<300ms', label: 'Median engine latency' },
];

/* ─── Component ─────────────────────────────────────────────────────────── */

const LandingPage: React.FC = () => {
  const [activeProduct, setActiveProduct] = useState(0);
  const prod = PRODUCTS[activeProduct];

  return (
    <div style={{ background: '#000', color: '#fff', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── HERO ───────────────────────────────────────────────────────────── */}
      <section style={{
        padding: '120px 24px 100px',
        textAlign: 'center',
        background: '#000',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {/* Eyebrow pill */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 14px', borderRadius: 9999,
            background: 'rgba(73,79,223,0.12)',
            border: '1px solid rgba(73,79,223,0.25)',
            fontSize: 13, fontWeight: 500, color: '#7c82f0',
            marginBottom: 40,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#494fdf', display: 'inline-block' }} />
            SEBI-Compliant Structured Product Engine
          </div>

          {/* Headline */}
          <h1 style={{
            fontSize: 'clamp(44px, 7vw, 88px)',
            fontWeight: 500, lineHeight: 1.0,
            letterSpacing: '-1.5px',
            color: '#fff', margin: '0 0 28px',
          }}>
            Structured wealth.<br />
            <span style={{ color: 'rgba(255,255,255,0.36)' }}>Built on rigor.</span>
          </h1>

          {/* Sub-headline */}
          <p style={{
            fontSize: 18, fontWeight: 400,
            lineHeight: 1.6, letterSpacing: '-0.1px',
            color: 'rgba(255,255,255,0.56)',
            maxWidth: 560, margin: '0 auto 48px',
          }}>
            Configure payoff profiles, run 2,000-path Monte Carlo simulations, and verify deterministic SEBI suitability — in one workspace.
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Link to="/rm" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '14px 28px', borderRadius: 9999, height: 52,
              background: '#fff', color: '#000',
              fontSize: 15, fontWeight: 600, textDecoration: 'none',
              transition: 'opacity 0.15s',
            }}>
              Launch RM Workspace <ArrowRight size={16} />
            </Link>
            <Link to="/client" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '14px 28px', borderRadius: 9999, height: 52,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#fff',
              fontSize: 15, fontWeight: 600, textDecoration: 'none',
            }}>
              Client Assessment
            </Link>
          </div>
        </div>
      </section>

      {/* ── STATS ROW ──────────────────────────────────────────────────────── */}
      <section style={{
        background: '#0a0a0a',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '48px 24px',
      }}>
        <div style={{
          maxWidth: 960, margin: '0 auto',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))',
          gap: '32px 0',
        }}>
          {STATS.map((s, i) => (
            <div key={i} style={{
              textAlign: 'center', padding: '0 16px',
              borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.07)' : 'none',
            }}>
              <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.5px', color: '#fff', marginBottom: 6 }}>
                {s.value}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2px' }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRODUCT EXPLORER ───────────────────────────────────────────────── */}
      <section style={{ padding: '96px 24px', background: '#000' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          {/* Section header */}
          <div style={{ marginBottom: 56 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#494fdf', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 12 }}>
              Products
            </p>
            <h2 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 500, letterSpacing: '-0.5px', color: '#fff', marginBottom: 16, maxWidth: 520 }}>
              Three structured product classes.
            </h2>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.48)', maxWidth: 480, lineHeight: 1.6 }}>
              Deterministic payoff profiles engineered for varying client risk budgets and market forecasts.
            </p>
          </div>

          {/* Tab selector */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 40, borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 0, overflowX: 'auto' }}>
            {PRODUCTS.map((p, i) => (
              <button key={p.type} onClick={() => setActiveProduct(i)} style={{
                padding: '10px 20px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 600,
                color: activeProduct === i ? '#fff' : 'rgba(255,255,255,0.36)',
                borderBottom: activeProduct === i ? '2px solid #fff' : '2px solid transparent',
                marginBottom: -1,
                transition: 'color 0.15s',
              }}>
                {p.type}
              </button>
            ))}
          </div>

          {/* Product detail card */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
            gap: 24,
          }}>
            {/* Left: specs */}
            <div style={{
              background: '#0d0d0d',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 20, padding: 36,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase',
                  color: prod.riskColor, padding: '3px 10px',
                  background: `${prod.riskColor}18`, borderRadius: 9999,
                }}>{prod.risk} Risk</span>
              </div>
              <h3 style={{ fontSize: 26, fontWeight: 500, color: '#fff', letterSpacing: '-0.3px', marginBottom: 4 }}>
                {prod.name}
              </h3>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.36)', marginBottom: 24 }}>{prod.subtitle}</p>

              <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 1.65, marginBottom: 32 }}>
                {prod.desc}
              </p>

              {/* Key metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Yield / Return', value: prod.yield, highlight: true },
                  { label: 'Tenor', value: prod.tenor, highlight: false },
                ].map((m) => (
                  <div key={m.label} style={{
                    padding: '16px 18px', borderRadius: 12,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.36)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: m.highlight ? prod.accent : '#fff' }}>
                      {m.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: fit + CTA */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{
                flex: 1,
                background: '#0d0d0d',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 20, padding: 36,
                display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>
                  Ideal Client Fit
                </div>
                <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.64)', lineHeight: 1.65, flex: 1 }}>
                  {prod.fit}
                </p>
                <div style={{ marginTop: 32, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Link to="/rm" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '11px 22px', borderRadius: 9999,
                    background: '#fff', color: '#000',
                    fontSize: 14, fontWeight: 600, textDecoration: 'none',
                  }}>
                    Structure {prod.type} <ArrowRight size={14} />
                  </Link>
                  <Link to="/client" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '11px 22px', borderRadius: 9999,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.72)',
                    fontSize: 14, fontWeight: 600, textDecoration: 'none',
                  }}>
                    Run Suitability
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────────────────────────── */}
      <section style={{
        padding: '96px 24px',
        background: '#fff', color: '#000',
        borderTop: '1px solid rgba(0,0,0,0.06)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ marginBottom: 56 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#494fdf', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 12 }}>
              Technology
            </p>
            <h2 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 500, letterSpacing: '-0.5px', color: '#000', marginBottom: 16, maxWidth: 520 }}>
              Engineered for institutional rigor.
            </h2>
            <p style={{ fontSize: 16, color: '#505a63', maxWidth: 480, lineHeight: 1.6 }}>
              Six core building blocks powering zero-downtime, deterministic decision support.
            </p>
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 1,
            background: '#e2e2e7', border: '1px solid #e2e2e7', borderRadius: 20, overflow: 'hidden',
          }}>
            {FEATURES.map((f, i) => (
              <div key={i} style={{
                padding: '32px',
                background: '#fff',
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: `${f.accent}12`,
                  color: f.accent,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 20,
                }}>
                  {f.icon}
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 600, color: '#000', marginBottom: 8, letterSpacing: '-0.2px' }}>
                  {f.title}
                </h3>
                <p style={{ fontSize: 14, color: '#505a63', lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WORKSPACE TIERS ────────────────────────────────────────────────── */}
      <section style={{ padding: '96px 24px', background: '#000' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#494fdf', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 12 }}>
              Access
            </p>
            <h2 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 500, letterSpacing: '-0.5px', color: '#fff', marginBottom: 16 }}>
              Choose your workspace.
            </h2>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.44)', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
              Select the profile matching your advisory or investment workflow.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 16 }}>
            {/* Client Portal */}
            <div style={{
              background: '#0d0d0d',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 20, padding: 36,
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.36)', marginBottom: 16 }}>
                Investor Tier
              </div>
              <h3 style={{ fontSize: 26, fontWeight: 500, color: '#fff', letterSpacing: '-0.3px', marginBottom: 12 }}>Client Portal</h3>
              <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.48)', lineHeight: 1.6, marginBottom: 28, flex: 1 }}>
                Self-service risk profiling, mock KYC import, and transparent suitability analysis.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  'KYC import (Kite, Zerodha, Groww, Cred)',
                  'Multi-dimensional risk questionnaire',
                  'Product fit score ranking',
                  'Client natural language rationale',
                ].map((item, idx) => (
                  <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: 'rgba(255,255,255,0.72)' }}>
                    <Check size={14} style={{ color: '#00a87e', flexShrink: 0, marginTop: 2 }} />
                    {item}
                  </li>
                ))}
              </ul>
              <Link to="/client" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '13px 24px', borderRadius: 9999, height: 48,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff', fontSize: 14, fontWeight: 600, textDecoration: 'none',
              }}>
                Start Client Assessment
              </Link>
            </div>

            {/* RM Workspace — FEATURED */}
            <div style={{
              background: '#494fdf',
              borderRadius: 20, padding: 36,
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center',
                padding: '4px 12px', borderRadius: 9999,
                background: 'rgba(255,255,255,0.18)',
                fontSize: 11, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase',
                color: '#fff', marginBottom: 16, width: 'fit-content',
              }}>
                Recommended
              </div>
              <h3 style={{ fontSize: 26, fontWeight: 500, color: '#fff', letterSpacing: '-0.3px', marginBottom: 12 }}>RM Workspace</h3>
              <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, marginBottom: 28, flex: 1 }}>
                Full structuring toolset, 2,000 Monte Carlo paths, and immutable compliance audit trail.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  'Full payoff curve parameter customizer',
                  '2,000-path Monte Carlo & historical replay',
                  'Automated compliant rationale generator',
                  'Client database & SEBI audit logs',
                ].map((item, idx) => (
                  <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>
                    <Check size={14} style={{ color: '#fff', flexShrink: 0, marginTop: 2 }} />
                    {item}
                  </li>
                ))}
              </ul>
              <Link to="/rm" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '13px 24px', borderRadius: 9999, height: 48,
                background: '#fff', color: '#494fdf',
                fontSize: 14, fontWeight: 600, textDecoration: 'none',
              }}>
                Launch RM Workspace <ArrowRight size={14} />
              </Link>
            </div>

            {/* Audit & Ledger */}
            <div style={{
              background: '#0d0d0d',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 20, padding: 36,
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.36)', marginBottom: 16 }}>
                Governance Tier
              </div>
              <h3 style={{ fontSize: 26, fontWeight: 500, color: '#fff', letterSpacing: '-0.3px', marginBottom: 12 }}>Audit & Ledger</h3>
              <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.48)', lineHeight: 1.6, marginBottom: 28, flex: 1 }}>
                Cryptographic SHA-256 hash ledger for regulatory verification and compliance logs.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  'SHA-256 hash-chain verification',
                  'SQLite persistent audit records',
                  'SEBI jurisdictional rule inspector',
                  'Exportable audit certificates',
                ].map((item, idx) => (
                  <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: 'rgba(255,255,255,0.72)' }}>
                    <Check size={14} style={{ color: '#ec7e00', flexShrink: 0, marginTop: 2 }} />
                    {item}
                  </li>
                ))}
              </ul>
              <Link to="/login" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '13px 24px', borderRadius: 9999, height: 48,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff', fontSize: 14, fontWeight: 600, textDecoration: 'none',
              }}>
                Access Audit Logs
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────────────── */}
      <footer style={{
        background: '#000',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: '48px 24px',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          {/* Regulatory notice */}
          <div style={{
            display: 'flex', gap: 12, alignItems: 'flex-start',
            padding: '16px 20px', borderRadius: 12,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            marginBottom: 40,
          }}>
            <AlertTriangle size={16} style={{ color: '#ec7e00', flexShrink: 0, marginTop: 2 }} />
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.36)', lineHeight: 1.6, margin: 0 }}>
              <strong style={{ color: 'rgba(255,255,255,0.56)', fontWeight: 600 }}>Regulatory Disclosure: </strong>
              Neural Nexus is a decision-support prototype. It does not constitute investment advice. Suitability rules are illustrative and governed by deterministic logic. Pricing models use indicative parameters only.
            </p>
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexWrap: 'wrap', gap: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src="/logo.png" alt="" aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'contain' }} />
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.36)' }}>© 2026 Neural Nexus</span>
            </div>

            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              {[
                { label: 'Login', to: '/login' },
                { label: 'RM Workspace', to: '/rm' },
                { label: 'Client Portal', to: '/client' },
              ].map((l) => (
                <Link key={l.to} to={l.to} style={{
                  fontSize: 13, color: 'rgba(255,255,255,0.4)',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}>{l.label}</Link>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
