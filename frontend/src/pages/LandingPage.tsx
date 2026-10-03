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
  ChevronRight,
  Sparkles,
  ArrowUpRight,
  ShieldCheck,
  Check,
} from 'lucide-react';

interface ProductSpec {
  type: string;
  name: string;
  underlying: string;
  barrier: string;
  coupon: string;
  tenor: string;
  risk: string;
  accentColor: string;
  badgeBg: string;
  desc: string;
  fitFor: string;
  rationale: string;
}

const PRODUCTS_CATALOG: Record<string, ProductSpec> = {
  ELN: {
    type: 'ELN',
    name: 'Equity-Linked Note (NIFTY 50)',
    underlying: 'NIFTY 50 Index (INR)',
    barrier: '75.0% Knock-In Barrier',
    coupon: '12.0% p.a. Fixed Coupon',
    tenor: '12 Months',
    risk: 'Medium-High',
    accentColor: '#00a87e',
    badgeBg: 'rgba(0, 168, 126, 0.12)',
    desc: 'Barrier-coupon structure earning enhanced fixed returns provided the underlying index does not cross the 75% barrier at maturity.',
    fitFor: 'Moderate to Aggressive investors seeking yield premium with contingent downside protection.',
    rationale:
      'Client exhibits Moderate risk capacity (₹10.0L liquid). Coupon of 12% p.a. provides strong yield premium over FD (7.0%). Historical block-bootstrap indicates 8.5% barrier breach probability.',
  },
  CPN: {
    type: 'CPN',
    name: 'Capital-Protected Note (BANKNIFTY)',
    underlying: 'Nifty Bank Index (INR)',
    barrier: '100% Capital Protection Level',
    coupon: '7.5% Minimum + 60% Upside',
    tenor: '24 Months',
    risk: 'Low-Medium',
    accentColor: '#007bc2',
    badgeBg: 'rgba(0, 123, 194, 0.12)',
    desc: 'Principal-guaranteed structured note providing complete capital preservation plus upside participation up to cap.',
    fitFor: 'Conservative & Risk-Averse clients requiring absolute principal safety with inflation hedge.',
    rationale:
      '100% principal guarantee matches strict risk budget. Tail loss (CVaR 5%) is 0%. Provides downside safety while capturing equity upside potential up to 14.5% max return.',
  },
  DCD: {
    type: 'DCD',
    name: 'Dual Currency Deposit (USD/INR)',
    underlying: 'USD / INR Spot Exchange Rate',
    barrier: 'Strike Rate: 84.50',
    coupon: '10.5% p.a. Enhanced Interest',
    tenor: '3 Months',
    risk: 'Medium',
    accentColor: '#ec7e00',
    badgeBg: 'rgba(236, 126, 0, 0.12)',
    desc: 'FX-linked deposit yielding premium interest rate, settled in alternate currency if spot crosses strike rate.',
    fitFor: 'Sophisticated clients with multi-currency cash flows or international treasury operations.',
    rationale:
      'Short 3-month duration mitigates long-term volatility. High 10.5% p.a. yield compensates FX conversion risk. Ideal for clients holding passive USD/INR reserves.',
  },
};

const ENGINE_FEATURES = [
  {
    icon: <TrendingUp size={22} />,
    title: 'Payoff Curve Engineering',
    desc: 'Interactive payoff curves with barrier breach simulation for ELN, CPN, and DCD structures.',
    color: '#00a87e',
  },
  {
    icon: <ShieldCheck size={22} />,
    title: 'Deterministic Suitability Engine',
    desc: 'Multi-layer SEBI compliance audit evaluating liquidity, loss tolerance, experience, and concentration.',
    color: '#494fdf',
  },
  {
    icon: <BarChart3 size={22} />,
    title: 'Block Bootstrap & Monte Carlo',
    desc: '2,000-path stochastic fan charts combined with empirical historical stress testing.',
    color: '#007bc2',
  },
  {
    icon: <Brain size={22} />,
    title: 'Dual LLM Rationale Generation',
    desc: 'Translates complex quantitative risk metrics into plain prose for Clients and technical details for RMs.',
    color: '#e61e49',
  },
  {
    icon: <Lock size={22} />,
    title: 'Cryptographic Audit Chain',
    desc: 'Every assessment appended to an immutable SHA-256 hash ledger stored locally in SQLite.',
    color: '#ec7e00',
  },
  {
    icon: <Zap size={22} />,
    title: 'Zero-Dependency Resilience',
    desc: 'Seamless multi-tier data fallback: Live Market → Disk Cache → Bundled Historical CSV.',
    color: '#00a87e',
  },
];

const LandingPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('ELN');
  const currentProduct = PRODUCTS_CATALOG[activeTab];

  return (
    <div style={{ background: '#000000', color: '#ffffff', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      {/* ── 1. HERO BAND (Dark Mode - True Black #000000) ───────────────── */}
      <section
        className="hero-band-dark"
        style={{
          background: '#000000',
          padding: '100px 0 80px',
          textAlign: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          {/* Badge Tag */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 16px',
              borderRadius: 9999,
              background: '#16181a',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              fontSize: 13,
              fontWeight: 500,
              color: '#ffffff',
              marginBottom: 32,
            }}
          >
            <Sparkles size={14} style={{ color: '#00a87e' }} />
            <span>Revolut-Grade Fintech Architecture & SEBI Suitability Engine</span>
          </div>

          {/* Headline (Aeonik Pro 500 / Inter 500 style, 80px tight tracking) */}
          <h1
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 'clamp(42px, 6vw, 80px)',
              fontWeight: 500,
              lineHeight: 1.0,
              letterSpacing: '-0.8px',
              color: '#ffffff',
              marginBottom: 24,
              maxWidth: 960,
              margin: '0 auto 24px',
            }}
          >
            Payoff Simulation & Beyond.
            <br />
            <span style={{ color: 'rgba(255, 255, 255, 0.72)' }}>For Structured Wealth Products</span>
          </h1>

          {/* Body Prose */}
          <p
            style={{
              fontSize: 18,
              fontWeight: 400,
              lineHeight: 1.56,
              letterSpacing: '-0.09px',
              color: 'rgba(255, 255, 255, 0.72)',
              maxWidth: 620,
              margin: '0 auto 48px',
            }}
          >
            Configure payoff profiles, run 2,000-path Monte Carlo simulations, and verify deterministic client suitability across ELN, CPN, and DCD products.
          </p>

          {/* CTAs - Revolut Primary (White Pill) & Outline Dark */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              flexWrap: 'wrap',
              marginBottom: 64,
            }}
          >
            <Link to="/rm" className="btn btn-primary" id="hero-rm-cta">
              Launch RM Workspace
              <ArrowRight size={18} />
            </Link>
            <Link to="/client" className="btn btn-outline-dark" id="hero-client-cta">
              Client Questionnaire
            </Link>
            <Link
              to="/login"
              className="btn btn-soft"
              style={{ background: '#16181a', color: '#ffffff' }}
              id="hero-login-cta"
            >
              Portal Login
            </Link>
          </div>

          {/* Hero Product Mockup Band (Full-bleed product container inside dark canvas) */}
          <div
            style={{
              borderRadius: 28,
              background: '#16181a',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              padding: '40px 32px',
              textAlign: 'left',
              maxWidth: 1100,
              margin: '0 auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 16,
                paddingBottom: 24,
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                marginBottom: 28,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#00a87e',
                  }}
                />
                <span style={{ fontSize: 16, fontWeight: 600, color: '#ffffff', letterSpacing: '0.16px' }}>
                  Interactive Payoff Engine Preview
                </span>
              </div>

              {/* Sub-nav Pill Chips */}
              <div style={{ display: 'flex', gap: 8 }}>
                {['ELN', 'CPN', 'DCD'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setActiveTab(type)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 9999,
                      border: 'none',
                      background: activeTab === type ? '#ffffff' : 'rgba(255, 255, 255, 0.06)',
                      color: activeTab === type ? '#000000' : '#ffffff',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {type} Note
                  </button>
                ))}
              </div>
            </div>

            {/* Mockup Inner Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 32 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: 24, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.32px' }}>
                    {currentProduct.name}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '4px 12px',
                      borderRadius: 9999,
                      background: currentProduct.badgeBg,
                      color: currentProduct.accentColor,
                      textTransform: 'uppercase',
                    }}
                  >
                    {currentProduct.risk} Risk
                  </span>
                </div>

                <p style={{ fontSize: 16, color: 'rgba(255, 255, 255, 0.72)', lineHeight: 1.5, marginBottom: 24 }}>
                  {currentProduct.desc}
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 12,
                      background: '#0a0a0a',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <div style={{ fontSize: 13, color: '#8d969e' }}>Underlying Asset</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#ffffff', marginTop: 4 }}>
                      {currentProduct.underlying}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 12,
                      background: '#0a0a0a',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <div style={{ fontSize: 13, color: '#8d969e' }}>Yield / Return</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: currentProduct.accentColor, marginTop: 4 }}>
                      {currentProduct.coupon}
                    </div>
                  </div>
                </div>
              </div>

              {/* Rationale Card */}
              <div
                style={{
                  padding: 24,
                  borderRadius: 20,
                  background: '#0a0a0a',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Brain size={18} style={{ color: currentProduct.accentColor }} />
                    <span style={{ fontSize: 16, fontWeight: 600, color: '#ffffff' }}>AI Suitability Rationale</span>
                  </div>
                  <p
                    style={{
                      fontSize: 14,
                      color: 'rgba(255, 255, 255, 0.72)',
                      lineHeight: 1.6,
                      fontStyle: 'italic',
                      marginBottom: 16,
                    }}
                  >
                    "{currentProduct.rationale}"
                  </p>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 16,
                    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                  }}
                >
                  <span style={{ fontSize: 13, color: '#8d969e' }}>Deterministic SEBI Audit Pass</span>
                  <Link
                    to="/rm"
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#ffffff',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span>Full Analysis</span>
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. WHITE CATALOGUE BAND (Canvas Light #FFFFFF) ───────────────── */}
      <section
        className="band-light"
        style={{
          background: '#ffffff',
          color: '#191c1f',
          padding: '88px 0',
        }}
      >
        <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2
              style={{
                fontSize: 48,
                fontWeight: 500,
                lineHeight: 1.21,
                letterSpacing: '-0.48px',
                color: '#191c1f',
                marginBottom: 16,
              }}
            >
              Supported Structured Products
            </h2>
            <p style={{ fontSize: 18, color: '#505a63', maxWidth: 580, margin: '0 auto' }}>
              Deterministic payoff profiles engineered for varying client risk budgets and market forecasts.
            </p>
          </div>

          {/* 3-Up Feature Cards on White */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
            {Object.values(PRODUCTS_CATALOG).map((p) => (
              <div
                key={p.type}
                className="feature-card-light"
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e2e7',
                  borderRadius: 20,
                  padding: 32,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  transition: 'border-color 0.2s',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        padding: '4px 12px',
                        borderRadius: 9999,
                        background: '#f4f4f4',
                        color: p.accentColor,
                      }}
                    >
                      {p.type} Note
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#505a63', textTransform: 'uppercase' }}>
                      {p.risk} Risk
                    </span>
                  </div>

                  <h3 style={{ fontSize: 24, fontWeight: 500, color: '#191c1f', marginBottom: 12, letterSpacing: '0' }}>
                    {p.name}
                  </h3>

                  <p style={{ fontSize: 16, color: '#505a63', lineHeight: 1.5, marginBottom: 24 }}>
                    {p.desc}
                  </p>

                  <div style={{ background: '#f4f4f4', padding: 16, borderRadius: 12, marginBottom: 24 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#505a63', textTransform: 'uppercase', marginBottom: 4 }}>
                      Ideal Client Fit
                    </div>
                    <div style={{ fontSize: 14, color: '#1f2226', lineHeight: 1.43 }}>{p.fitFor}</div>
                  </div>
                </div>

                <Link
                  to="/rm"
                  className="btn btn-dark"
                  style={{ width: '100%', height: 48, borderRadius: 9999, textDecoration: 'none' }}
                >
                  <span>Select {p.type} Structure</span>
                  <ChevronRight size={18} />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3. DARK STORYTELLING BAND (Canvas Dark #000000) ──────────────── */}
      <section
        className="band-dark"
        style={{
          background: '#000000',
          padding: '88px 0',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2
              style={{
                fontSize: 48,
                fontWeight: 500,
                lineHeight: 1.21,
                letterSpacing: '-0.48px',
                color: '#ffffff',
                marginBottom: 16,
              }}
            >
              Engineered for Institutional Rigor
            </h2>
            <p style={{ fontSize: 18, color: 'rgba(255, 255, 255, 0.72)', maxWidth: 600, margin: '0 auto' }}>
              Six core technology building blocks powering zero-downtime, deterministic decision support.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
            {ENGINE_FEATURES.map((f, i) => (
              <div
                key={i}
                className="feature-card-dark"
                style={{
                  background: '#16181a',
                  borderRadius: 20,
                  padding: 32,
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  transition: 'background 0.2s',
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: '#000000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: f.color,
                    marginBottom: 20,
                  }}
                >
                  {f.icon}
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', marginBottom: 8 }}>{f.title}</h3>
                <p style={{ fontSize: 16, color: 'rgba(255, 255, 255, 0.72)', lineHeight: 1.5, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. WORKSPACE TIERS BAND (Dark #000000 with Featured Cobalt #494FDF) ── */}
      <section
        style={{
          background: '#000000',
          padding: '88px 0',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2
              style={{
                fontSize: 48,
                fontWeight: 500,
                lineHeight: 1.21,
                letterSpacing: '-0.48px',
                color: '#ffffff',
                marginBottom: 16,
              }}
            >
              Choose Your Workspace Tier
            </h2>
            <p style={{ fontSize: 18, color: 'rgba(255, 255, 255, 0.72)', maxWidth: 540, margin: '0 auto' }}>
              Select the workspace profile matching your advisory or investment workflow.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
            {/* Plan Card 1: Client Portal */}
            <div
              className="plan-card"
              style={{
                background: '#16181a',
                borderRadius: 20,
                padding: 32,
                border: '1px solid rgba(255, 255, 255, 0.12)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#8d969e', textTransform: 'uppercase', marginBottom: 8 }}>
                  Investor Tier
                </div>
                <h3 style={{ fontSize: 32, fontWeight: 500, color: '#ffffff', marginBottom: 16, letterSpacing: '-0.32px' }}>
                  Client Portal
                </h3>
                <p style={{ fontSize: 16, color: 'rgba(255, 255, 255, 0.72)', lineHeight: 1.5, marginBottom: 24 }}>
                  Self-service risk profiling, mock KYC import, and transparent suitability analysis.
                </p>

                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    'Instant KYC import (Kite, Zerodha, Groww, Cred)',
                    'Multi-dimensional risk questionnaire',
                    'Product fit score ranking',
                    'Client natural language rationale summaries',
                  ].map((item, idx) => (
                    <li key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#ffffff' }}>
                      <Check size={16} style={{ color: '#00a87e', flexShrink: 0 }} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Link to="/client" className="btn btn-outline-dark" style={{ width: '100%', height: 48, borderRadius: 9999 }}>
                Start Client Assessment
              </Link>
            </div>

            {/* Plan Card 2: FEATURED RM TIER (Cobalt Violet #494FDF) */}
            <div
              className="plan-card-featured"
              style={{
                background: '#494fdf',
                color: '#ffffff',
                borderRadius: 20,
                padding: 32,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative',
                boxShadow: '0 20px 40px rgba(73, 79, 223, 0.35)',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 12px',
                    borderRadius: 9999,
                    background: '#ffffff',
                    color: '#494fdf',
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    marginBottom: 16,
                  }}
                >
                  <Sparkles size={14} />
                  <span>RECOMMENDED ADVISORY TIER</span>
                </div>

                <h3 style={{ fontSize: 32, fontWeight: 500, color: '#ffffff', marginBottom: 16, letterSpacing: '-0.32px' }}>
                  RM Workspace
                </h3>
                <p style={{ fontSize: 16, color: 'rgba(255, 255, 255, 0.9)', lineHeight: 1.5, marginBottom: 24 }}>
                  Full structuring toolset, 2,000 Monte Carlo paths, and compliance audit trail.
                </p>

                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    'Full payoff curve parameter customizer',
                    '2,000-path Monte Carlo & historical replay',
                    'Automated compliant rationale generator',
                    'Client database management & SEBI audit logs',
                  ].map((item, idx) => (
                    <li key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#ffffff' }}>
                      <Check size={16} style={{ color: '#ffffff', flexShrink: 0 }} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Link to="/rm" className="btn btn-primary" style={{ width: '100%', height: 48, borderRadius: 9999 }}>
                Launch RM Workspace
              </Link>
            </div>

            {/* Plan Card 3: Compliance & Audit */}
            <div
              className="plan-card"
              style={{
                background: '#16181a',
                borderRadius: 20,
                padding: 32,
                border: '1px solid rgba(255, 255, 255, 0.12)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#8d969e', textTransform: 'uppercase', marginBottom: 8 }}>
                  Governance Tier
                </div>
                <h3 style={{ fontSize: 32, fontWeight: 500, color: '#ffffff', marginBottom: 16, letterSpacing: '-0.32px' }}>
                  Audit & Ledger
                </h3>
                <p style={{ fontSize: 16, color: 'rgba(255, 255, 255, 0.72)', lineHeight: 1.5, marginBottom: 24 }}>
                  Cryptographic SHA-256 hash ledger for regulatory verification and compliance logs.
                </p>

                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    'SHA-256 hash-chain verification',
                    'SQLite persistent audit records',
                    'SEBI jurisdictional rule inspector',
                    'Exportable audit certificates',
                  ].map((item, idx) => (
                    <li key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#ffffff' }}>
                      <Check size={16} style={{ color: '#ec7e00', flexShrink: 0 }} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Link to="/login" className="btn btn-outline-dark" style={{ width: '100%', height: 48, borderRadius: 9999 }}>
                Access Audit Logs
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. GLOBAL FOOTER (Canvas Dark #000000) ────────────────────────── */}
      <footer
        className="footer"
        style={{
          background: '#000000',
          padding: '80px 24px 48px',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          color: 'rgba(255, 255, 255, 0.72)',
          fontSize: 14,
        }}
      >
        <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
          {/* Regulatory Disclaimer Box */}
          <div
            style={{
              padding: 20,
              borderRadius: 12,
              background: '#16181a',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: 13,
              lineHeight: 1.6,
              color: '#8d969e',
              marginBottom: 48,
              display: 'flex',
              gap: 12,
            }}
          >
            <AlertTriangle size={18} style={{ color: '#ec7e00', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ color: '#ffffff' }}>Important Regulatory Disclosure: </strong>
              Neural Nexus is a decision-support prototype for wealth management teams. It does not constitute investment advice.
              Suitability rules are illustrative and governed by deterministic logic. Pricing models (Black-Scholes, Monte Carlo) use indicative parameters.
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16,
              fontSize: 13,
              color: '#5c5e60',
              paddingTop: 24,
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            <span>© 2026 Neural Nexus · Revolut-Design Inspired Structured Product Engine</span>
            <div style={{ display: 'flex', gap: 24 }}>
              <Link to="/login" style={{ color: 'rgba(255, 255, 255, 0.72)', textDecoration: 'none' }}>
                Portal Login
              </Link>
              <Link to="/rm" style={{ color: 'rgba(255, 255, 255, 0.72)', textDecoration: 'none' }}>
                RM Workspace
              </Link>
              <Link to="/client" style={{ color: 'rgba(255, 255, 255, 0.72)', textDecoration: 'none' }}>
                Client Portal
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
