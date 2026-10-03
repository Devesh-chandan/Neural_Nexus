import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Shield, TrendingUp, BarChart3, Brain, Lock, Zap, FlaskConical, AlertTriangle } from 'lucide-react';

const FEATURES = [
  {
    icon: <TrendingUp size={20} />,
    title: 'Payoff Simulation',
    desc: 'Interactive payoff curves with barrier visualisation for ELN, CPN and DCD structures.',
    color: 'var(--primary-bright)',
  },
  {
    icon: <Shield size={20} />,
    title: 'Suitability Engine',
    desc: 'Deterministic rules-based suitability assessment across 7 risk dimensions. LLM only narrates.',
    color: 'var(--accent-teal)',
  },
  {
    icon: <BarChart3 size={20} />,
    title: 'Historical Replay & Monte Carlo',
    desc: 'Block-bootstrap replay over 15 years of data + optional Monte Carlo fan charts.',
    color: 'var(--accent-teal)',
  },
  {
    icon: <Brain size={20} />,
    title: 'AI Recommendation',
    desc: 'Client questionnaire → ranked product candidates with fit scores and fix-it suggestions.',
    color: 'var(--primary-bright)',
  },
  {
    icon: <Lock size={20} />,
    title: 'Tamper-Evident Audit',
    desc: 'Every analysis appended to a SHA-256 hash chain stored in SQLite. Offline-first.',
    color: 'var(--accent-warning)',
  },
  {
    icon: <Zap size={20} />,
    title: 'Offline-First',
    desc: 'Fallback order: live yfinance → disk cache → bundled seed CSV. Always works in demo.',
    color: 'var(--accent-teal)',
  },
];

const PRODUCTS = [
  {
    type: 'ELN',
    name: 'Equity-Linked Note',
    desc: 'Barrier-coupon / reverse-convertible structure. Enhanced yield if barrier holds.',
    risk: 'Medium–High',
    riskColor: 'var(--accent-warning)',
  },
  {
    type: 'CPN',
    name: 'Capital-Protected Note',
    desc: 'Principal protection with upside participation. Optional cap on gains.',
    risk: 'Low–Medium',
    riskColor: 'var(--accent-teal)',
  },
  {
    type: 'DCD',
    name: 'Dual Currency Deposit',
    desc: 'FX-linked deposit with strike. Higher interest; repayment in alt currency if struck.',
    risk: 'Medium',
    riskColor: 'var(--accent-warning)',
  },
];

const LandingPage: React.FC = () => {
  return (
    <>
      {/* ── Hero Band (dark) ──────────────────────────────────────────────── */}
      <section className="hero-band" aria-label="Hero">
        <div className="page-container">
          <div className="hero-eyebrow" style={{ marginBottom: 28 }}>
            <FlaskConical size={14} style={{ color: 'var(--primary-bright)' }} aria-hidden="true" />
            Decision-Support Prototype · Not Investment Advice
          </div>

          <h1
            className="display-xl"
            style={{
              color: 'var(--on-dark)',
              marginBottom: 24,
              maxWidth: 760,
              margin: '0 auto 24px',
            }}
          >
            Suitability-Aware
            <br />
            <span style={{ color: 'var(--on-dark-mute)' }}>Payoff Simulator</span>
          </h1>

          <p
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 18,
              fontWeight: 400,
              lineHeight: 1.56,
              letterSpacing: '-0.09px',
              color: 'var(--on-dark-mute)',
              maxWidth: 560,
              margin: '0 auto 48px',
            }}
          >
            Configure, visualise and check client suitability for ELN, CPN and DCD structured
            products — backed by 15 years of market data and a tamper-evident audit chain.
          </p>

          <div className="flex items-center justify-center gap-4" style={{ flexWrap: 'wrap' }}>
            <Link
              to="/rm"
              className="btn btn-primary btn-lg"
              id="hero-rm-cta"
              aria-label="Open Relationship Manager workspace"
            >
              RM Workspace
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link
              to="/client"
              className="btn btn-outline-dark btn-lg"
              id="hero-client-cta"
              aria-label="Open Client questionnaire"
            >
              Client Questionnaire
            </Link>
          </div>
        </div>
      </section>

      {/* ── Products (light band) ─────────────────────────────────────────── */}
      <section
        className="band-light"
        aria-labelledby="products-heading"
        style={{ padding: '88px 0' }}
      >
        <div className="page-container">
          <h2
            id="products-heading"
            className="display-lg text-center"
            style={{ color: 'var(--ink)', marginBottom: 48 }}
          >
            Supported Products
          </h2>
          <div className="grid-3">
            {PRODUCTS.map((p) => (
              <article
                key={p.type}
                className="card-light"
                aria-label={`${p.name} product card`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  transition: 'border-color 0.2s',
                }}
              >
                <div className="flex items-center gap-3">
                  <span className={`product-pill ${p.type}`}>{p.type}</span>
                  <span
                    style={{
                      fontSize: 12,
                      color: p.riskColor,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {p.risk}
                  </span>
                </div>
                <div className="card-title-light">{p.name}</div>
                <p style={{ fontSize: 15, color: 'var(--mute)', lineHeight: 1.6, margin: 0 }}>
                  {p.desc}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features (dark band) ──────────────────────────────────────────── */}
      <section
        className="band-dark"
        aria-labelledby="features-heading"
        style={{ padding: '88px 0' }}
      >
        <div className="page-container">
          <h2
            id="features-heading"
            className="display-lg text-center"
            style={{ color: 'var(--on-dark)', marginBottom: 48 }}
          >
            What's Inside
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 1,
              background: 'var(--hairline-dark)',
              borderRadius: 'var(--r-lg)',
              overflow: 'hidden',
            }}
          >
            {FEATURES.map((f) => (
              <article
                key={f.title}
                aria-label={f.title}
                style={{
                  background: 'var(--surface-elevated)',
                  padding: 32,
                  display: 'flex',
                  gap: 16,
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = 'var(--surface-deep)')
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = 'var(--surface-elevated)')
                }
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--canvas-dark)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: f.color,
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                >
                  {f.icon}
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontSize: 16,
                      fontWeight: 600,
                      color: 'var(--on-dark)',
                      marginBottom: 6,
                    }}
                  >
                    {f.title}
                  </div>
                  <p
                    style={{
                      fontSize: 14,
                      color: 'var(--on-dark-mute)',
                      lineHeight: 1.6,
                      margin: 0,
                    }}
                  >
                    {f.desc}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA band (dark) ───────────────────────────────────────────────── */}
      <section
        className="band-dark"
        style={{
          padding: '80px 0',
          borderTop: '1px solid var(--hairline-dark)',
          textAlign: 'center',
        }}
      >
        <div className="page-container">
          <h2
            className="heading-lg"
            style={{ color: 'var(--on-dark)', marginBottom: 12 }}
          >
            Ready to get started?
          </h2>
          <p
            style={{
              fontSize: 16,
              color: 'var(--on-dark-mute)',
              marginBottom: 36,
            }}
          >
            Choose your workflow below.
          </p>
          <div className="flex items-center justify-center gap-4" style={{ flexWrap: 'wrap' }}>
            <Link to="/client" className="btn btn-primary btn-lg" id="cta-client-btn">
              Start as Client
            </Link>
            <Link to="/rm" className="btn btn-outline-dark btn-lg" id="cta-rm-btn">
              Open RM Workspace
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer
        className="band-dark"
        style={{
          borderTop: '1px solid var(--divider-soft)',
          padding: '48px 24px 32px',
        }}
      >
        <div className="page-container">
          <div
            style={{
              borderTop: '1px solid var(--divider-soft)',
              paddingTop: 24,
              fontSize: 13,
              color: 'var(--stone)',
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: 'var(--on-dark-mute)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={14} style={{ color: 'var(--accent-warning)' }} /> Important:{' '}
            </strong>
            This is a decision-support prototype for wealth management teams. It does not constitute
            investment advice. Suitability rules are illustrative and pending compliance review. No
            real authentication — route-based mode only. Pricing is indicative (Black-Scholes,
            simplified assumptions). Past performance does not predict future results.
          </div>
          <div
            style={{
              marginTop: 24,
              fontSize: 12,
              color: 'var(--ash)',
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <span>© 2026 Neural Nexus · Prototype · Not for distribution</span>
            <span>Neural Nexus v0.1-alpha</span>
          </div>
        </div>
      </footer>
    </>
  );
};

export default LandingPage;
