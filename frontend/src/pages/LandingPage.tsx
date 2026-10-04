import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, ArrowUp, Check, AlertTriangle, X, UserCheck, SlidersHorizontal,
  BarChart3, ShieldCheck, FileText, Lock, Database, TrendingUp, Brain, ChevronDown,
  Calculator, Fingerprint, Scale, Sparkles,
} from 'lucide-react';
import Wordmark from '../components/Wordmark';
import {
  Reveal, CountUp, useInView, PayoffSVG, FanSVG, elnReturn, pct, buildChain, GENESIS,
  type ChainRecord,
} from '../components/landing/visuals';

/* ─── Tokens ────────────────────────────────────────────────────────────── */

const C = {
  blue: '#494fdf',
  blueSoft: '#7c82f0',
  green: '#00a87e',
  amber: '#ec7e00',
  red: '#e23b4a',
  text2: 'rgba(255,255,255,0.68)',
  text3: 'rgba(255,255,255,0.5)',
  line: 'rgba(255,255,255,0.08)',
  panel: '#0d0d0d',
};

type Status = 'PASS' | 'REVIEW' | 'FAIL';
const STATUS_COLOR: Record<Status, string> = { PASS: C.green, REVIEW: C.amber, FAIL: C.red };
const STATUS_ICON: Record<Status, React.ReactNode> = {
  PASS: <Check size={14} />,
  REVIEW: <AlertTriangle size={13} />,
  FAIL: <X size={14} />,
};

/* ─── Data (mirrors backend config and module 3 rules) ──────────────────── */

const METRICS = [
  { to: 3, label: 'Structured product classes', note: 'ELN · CPN · DCD' },
  { to: 10, label: 'Whitelisted underlyings', note: 'Indian & global equities, plus USD/INR, EUR/INR, USD/JPY' },
  { to: 2000, label: 'Bootstrap paths per run', note: 'Block size 10, fixed seed' },
  { to: 5, label: 'Deterministic suitability checks', note: 'Versioned rules, no model' },
];

const CHECKS: { title: string; rule: string; short: string }[] = [
  { title: 'Compliance gates', short: 'Compliance', rule: 'Vulnerable client, stale profile or US-person (FATCA) → REVIEW. AML low → PASS, medium → REVIEW, high → FAIL.' },
  { title: 'Risk appetite', short: 'Risk appetite', rule: 'Product level is the higher of its structural level and its worst simulated outcome. One level above the client → REVIEW, two → FAIL.' },
  { title: 'Investment horizon', short: 'Horizon', rule: 'Tenor within the client’s stated horizon → PASS. Longer → FAIL.' },
  { title: 'Loss tolerance', short: 'Loss tolerance', rule: 'Worst simulated scenario loss within the client’s tolerance → PASS. Beyond it → FAIL.' },
  { title: 'Concentration', short: 'Concentration', rule: '(Notional + existing exposure) ÷ liquid net worth against appetite limits: Conservative 10% / 15%, Moderate 15% / 25%, Aggressive 20% / 30%.' },
];

const VERDICTS = [
  { label: 'SUITABLE', note: 'Every check passes', color: C.green },
  { label: 'REVIEW REQUIRED', note: 'No fails, at least one review', color: C.amber },
  { label: 'NOT SUITABLE', note: 'Any check fails', color: C.red },
];

/* Demo case: figures below are illustrative, and the concentration result is derived from the rule above. */
const DEMO = { netWorth: 6_000_000, notional: 1_000_000, existing: 300_000, passLimit: 0.2, failLimit: 0.3 };
const DEMO_CONC = (DEMO.notional + DEMO.existing) / DEMO.netWorth;
const DEMO_CHECKS: { name: string; status: Status; detail: string }[] = [
  { name: 'Compliance', status: 'PASS', detail: 'KYC current, AML low' },
  { name: 'Risk appetite', status: 'PASS', detail: 'Aggressive client, product within level' },
  { name: 'Horizon', status: 'PASS', detail: '12M tenor ≤ 24M horizon' },
  { name: 'Loss tolerance', status: 'PASS', detail: `Stress ${pct(elnReturn(0.7))} within 25%` },
  { name: 'Concentration', status: 'REVIEW', detail: `${(DEMO_CONC * 100).toFixed(1)}% vs ${DEMO.passLimit * 100}% pass limit` },
];
const inr = (v: number) => `₹${v.toLocaleString('en-IN')}`;

const PRODUCTS = [
  {
    type: 'ELN', name: 'Equity-Linked Note', subtitle: 'Barrier-coupon, reverse-convertible style',
    risk: 'Aggressive', riskColor: C.amber, accent: C.green,
    mechanic: 'Fixed coupon, plus full principal if the index closes at or above the barrier. Below it, the client takes the equity loss.',
    desc: 'Pays a fixed coupon each year. If the underlying closes at or above the barrier at maturity, principal is returned in full. Below the barrier, the client takes the equity loss. A close exactly at the barrier is not a breach.',
    fit: 'Moderate-to-aggressive clients who accept contingent equity downside in exchange for an enhanced coupon, and whose horizon covers the full tenor.',
    metrics: [
      { label: 'Default terms', value: '75% barrier · 10% p.a.' },
      { label: 'Default tenor', value: '12 months' },
      { label: 'Complexity', value: '2 of 3' },
      { label: 'Tenor range', value: '3 – 36 months' },
      { label: 'Barrier range', value: '40% – 95% of spot' },
      { label: 'Default principal', value: '₹10,00,000' },
    ],
    underlyings: 'NIFTY 50 · Bank Nifty · Reliance · TCS · HDFC Bank · S&P 500 · Apple',
  },
  {
    type: 'CPN', name: 'Capital-Protected Note', subtitle: 'Protection + participation, optional cap',
    risk: 'Conservative to Moderate', riskColor: C.green, accent: '#007bc2',
    mechanic: 'A protected share of principal is guaranteed, plus a participation share of the underlying’s upside.',
    desc: 'Guarantees a protected share of principal at maturity and adds a participation share of the underlying’s upside, optionally capped. At 100% protection the structural risk is the lowest of the three products.',
    fit: 'Conservative clients who need principal safety and want equity upside, accepting that participation is funded by forgone interest.',
    metrics: [
      { label: 'Default terms', value: '100% protection · 80% participation' },
      { label: 'Default tenor', value: '24 months' },
      { label: 'Complexity', value: '1 of 3' },
      { label: 'Tenor range', value: '3 – 36 months' },
      { label: 'Protection range', value: '80% – 100%' },
      { label: 'Participation range', value: '10% – 200%' },
    ],
    underlyings: 'NIFTY 50 · Bank Nifty · S&P 500 · single equities',
  },
  {
    type: 'DCD', name: 'Dual Currency Deposit', subtitle: 'USD / INR, quoted INR per USD',
    risk: 'Moderate', riskColor: C.blue, accent: C.amber,
    mechanic: 'Enhanced interest. If spot ends beyond the strike, principal and interest convert to the alternate currency at the strike.',
    desc: 'A deposit paying an enhanced interest rate. If spot finishes beyond the agreed strike, principal and interest are converted into the alternate currency at the strike rate instead of being repaid in the base currency.',
    fit: 'Experienced clients with multi-currency cash flows who are comfortable being converted at the strike and have a matching horizon.',
    metrics: [
      { label: 'Default terms', value: '8% p.a. interest' },
      { label: 'Default tenor', value: '6 months' },
      { label: 'Complexity', value: '3 of 3' },
      { label: 'Tenor range', value: '3 – 36 months' },
      { label: 'Strike grid', value: 'Spot × 1.02 / 1.04 / 1.06' },
      { label: 'Default principal', value: '$100,000' },
    ],
    underlyings: 'USD / INR',
  },
];

const COMPARE = [
  { type: 'ELN', a: 'Enhanced yield', b: 'Higher equity downside', c: 'Aggressive profile', color: C.amber },
  { type: 'CPN', a: 'Capital protection', b: 'Lower downside', c: 'Conservative / moderate', color: C.green },
  { type: 'DCD', a: 'Yield + FX exposure', b: 'Currency conversion risk', c: 'Moderate / aggressive', color: C.blue },
];

const WORKFLOW = [
  { icon: <UserCheck size={18} />, title: 'Profile', desc: 'Capture risk appetite, horizon, tolerance, net worth and compliance flags.' },
  { icon: <SlidersHorizontal size={18} />, title: 'Configure', desc: 'Set underlying, tenor and terms inside validated bounds.' },
  { icon: <BarChart3 size={18} />, title: 'Simulate', desc: 'Replay history and stress 2,000 bootstrap paths.' },
  { icon: <ShieldCheck size={18} />, title: 'Validate', desc: 'Five fixed rules return one verdict.' },
  { icon: <FileText size={18} />, title: 'Explain & audit', desc: 'Plain-English reasons, then a hash-chained record.' },
];

const ARCH: { group: string; tag: string; color: string; icon: React.ReactNode; nodes: string[] }[] = [
  { group: 'Quantitative engine', tag: 'Computes', color: C.blueSoft, icon: <Calculator size={20} />, nodes: ['Product configuration', 'Payoff engine', 'Monte Carlo simulation'] },
  { group: 'Rule engine', tag: 'Decides', color: C.green, icon: <ShieldCheck size={20} />, nodes: ['Suitability rules', 'Deterministic verdict'] },
  { group: 'AI explanation', tag: 'Explains only', color: C.amber, icon: <Brain size={20} />, nodes: ['LLM narration', 'Output validation'] },
  { group: 'Audit system', tag: 'Records', color: '#b3b8c2', icon: <Fingerprint size={20} />, nodes: ['SHA-256 hash chain'] },
];

const TRUST = [
  { head: 'AI assists', body: 'Narrates a result that already exists.', icon: <Sparkles size={18} />, color: C.amber },
  { head: 'Rules decide', body: 'Fixed, versioned thresholds set the verdict.', icon: <Scale size={18} />, color: C.green },
  { head: 'Evidence supports', body: 'Every number traces to a simulation run.', icon: <BarChart3 size={18} />, color: C.blueSoft },
  { head: 'Audit records', body: 'Each assessment is hash-chained.', icon: <Lock size={18} />, color: '#b3b8c2' },
];

const PLATFORM_ITEMS = [
  { icon: <TrendingUp size={18} />, title: 'Payoff curves', desc: '101 points across 40–160% of spot (80–125% for USD/INR).' },
  { icon: <BarChart3 size={18} />, title: 'Monte Carlo fan chart', desc: '5th–95th percentile bands from block bootstrap.' },
  { icon: <ShieldCheck size={18} />, title: 'Scenario & stress table', desc: 'Spot shocks −30% to +20%, against a 7.0% p.a. FD baseline.' },
  { icon: <Brain size={18} />, title: 'Validated explanations', desc: 'Checked against the facts, else replaced by a fixed template.' },
  { icon: <Lock size={18} />, title: 'Tamper-evident audit', desc: 'Append-only log; any edit breaks the chain.' },
  { icon: <Database size={18} />, title: 'Offline-first data', desc: 'Live data, then a 12-hour cache, then bundled history.' },
];

const SCENARIOS = [-0.3, -0.2, -0.1, 0, 0.1, 0.2];

/* ─── Styles ────────────────────────────────────────────────────────────── */

const CSS = `
html { scroll-behavior: smooth; }
.nx-root { background:#000; color:#f5f5f5; font-family: Inter, system-ui, sans-serif; overflow-x:hidden; }
.nx-root section[id] { scroll-margin-top: 72px; }
.nx-wrap { max-width: 1160px; margin: 0 auto; padding: 0 24px; }
.nx-eyebrow { font-size:13px; font-weight:600; letter-spacing:.8px; text-transform:uppercase; color:${C.blueSoft}; margin:0 0 14px; }
.nx-h2 { font-size: clamp(34px, 5vw, 58px); font-weight:500; letter-spacing:-1px; line-height:1.05; margin:0 0 18px; color:#f5f5f5; }
.nx-lede { font-size:17px; line-height:1.6; color:${C.text2}; max-width:600px; margin:0; }
.nx-sec { padding: 104px 0; border-top:1px solid rgba(255,255,255,0.06); }
.nx-panel { background:${C.panel}; border:1px solid ${C.line}; border-radius:20px; }
.nx-hover { transition: border-color .2s, transform .2s; }
.nx-hover:hover { border-color: rgba(124,130,240,0.45); transform: translateY(-2px); }
.nx-reveal { opacity:0; transform: translateY(18px); transition: opacity .6s ease, transform .6s ease; }
.nx-reveal.in { opacity:1; transform:none; }
.nx-btn { display:inline-flex; align-items:center; gap:8px; height:52px; padding:0 28px; border-radius:9999px; font-size:15px; font-weight:600; text-decoration:none; transition: transform .15s, background .15s, opacity .15s; }
.nx-btn:hover { transform: translateY(-1px); }
.nx-btn:hover .nx-arrow { transform: translateX(3px); }
.nx-arrow { transition: transform .15s; }
.nx-btn-primary { background:#f5f5f5; color:#000; }
.nx-btn-primary:hover { background:#fff; }
.nx-btn-ghost { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); color:#f5f5f5; }
.nx-btn-ghost:hover { background:rgba(255,255,255,0.1); }
.nx-root a:focus-visible, .nx-root button:focus-visible, .nx-root summary:focus-visible { outline:2px solid ${C.blueSoft}; outline-offset:3px; border-radius:8px; }
.nx-mono { font-family:'JetBrains Mono', ui-monospace, monospace; }

.nx-hero-grid { display:grid; grid-template-columns: 1.08fr .92fr; gap:56px; align-items:center; }
.nx-two { display:grid; grid-template-columns: 1fr 1fr; gap:20px; }
.nx-dash { display:grid; grid-template-columns: 1.55fr 1fr; gap:0; }
.nx-dash > div:first-child { border-right:1px solid ${C.line}; }
.nx-three { display:grid; grid-template-columns: repeat(3,1fr); gap:16px; }
.nx-four { display:grid; grid-template-columns: repeat(4,1fr); gap:16px; }
.nx-five { display:grid; grid-template-columns: repeat(5,1fr); gap:16px; }
.nx-arch { display:grid; grid-template-columns: repeat(4,1fr); gap:16px; }
.nx-steps { position:relative; display:grid; grid-template-columns: repeat(5,1fr); gap:16px; }
.nx-steps-line { position:absolute; top:22px; left:10%; right:10%; height:2px; background:rgba(255,255,255,0.08); }
.nx-steps-line > span { display:block; height:100%; width:0; background:linear-gradient(90deg, ${C.blue}, ${C.green}); transition: width 1.6s ease .2s; }
.nx-steps.in .nx-steps-line > span { width:100%; }
.nx-chain { display:grid; grid-template-columns: repeat(3,1fr); gap:12px; }

.nx-icon { width:40px; height:40px; border-radius:12px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; }
.nx-pill { display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; padding:4px 10px; border-radius:9999px; }
.nx-arch-card { position:relative; padding:24px 22px 22px; overflow:visible; }
.nx-arch-card::before { content:''; position:absolute; inset:0 0 auto 0; height:3px; border-radius:20px 20px 0 0; background:var(--c); }
.nx-arch-arrow { position:absolute; top:50%; right:-17px; margin-top:-12px; width:24px; height:24px; border-radius:50%; background:#000; border:1px solid rgba(255,255,255,0.18); color:rgba(255,255,255,0.7); display:inline-flex; align-items:center; justify-content:center; z-index:2; }
.nx-nodes { list-style:none; margin:0; padding:0; position:relative; display:grid; gap:8px; }
.nx-nodes::before { content:''; position:absolute; left:11px; top:14px; bottom:14px; width:1px; background:rgba(255,255,255,0.12); }
.nx-nodes li { position:relative; display:flex; align-items:center; gap:12px; padding:9px 12px 9px 8px; border-radius:10px; background:#111; border:1px solid rgba(255,255,255,0.08); font-size:13.5px; }
.nx-nodes li > i { width:7px; height:7px; border-radius:50%; background:var(--c); margin:0 4px 0 1px; flex-shrink:0; box-shadow:0 0 0 3px #111; position:relative; }
.nx-trust { position:relative; padding:22px; overflow:hidden; height:100%; }
.nx-trust::after { content:''; position:absolute; inset:auto -30% -60% auto; width:180px; height:180px; border-radius:50%; background:var(--c); opacity:.07; filter:blur(30px); pointer-events:none; }

.nx-cmp { text-align:left; cursor:pointer; font:inherit; color:inherit; width:100%; padding:22px; position:relative; }
.nx-cmp[aria-pressed="true"] { border-color:var(--c); background:linear-gradient(180deg, color-mix(in srgb, var(--c) 9%, #0d0d0d), #0d0d0d); }
.nx-cmp-row { display:flex; align-items:flex-start; gap:10px; font-size:14px; line-height:1.4; color:rgba(255,255,255,0.68); }
.nx-cmp-row svg { flex-shrink:0; margin-top:2px; }

.nx-tabs { display:inline-flex; gap:4px; padding:4px; border-radius:9999px; background:#111; border:1px solid rgba(255,255,255,0.08); max-width:100%; overflow-x:auto; margin-bottom:24px; }
.nx-tab { padding:10px 20px; border:none; border-radius:9999px; background:none; cursor:pointer; white-space:nowrap; font:inherit; font-size:14.5px; font-weight:600; color:rgba(255,255,255,0.55); transition:background .15s, color .15s; }
.nx-tab:hover { color:#fff; }
.nx-tab[aria-selected="true"] { background:#f5f5f5; color:#000; }
.nx-chip { display:inline-block; font-size:13px; padding:6px 12px; border-radius:9999px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:rgba(255,255,255,0.8); }
.nx-term { padding:12px 14px; border-radius:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); }
.nx-details { margin-top:18px; border-top:1px solid rgba(255,255,255,0.08); padding-top:14px; font-size:14px; color:rgba(255,255,255,0.68); }
.nx-details summary { cursor:pointer; font-weight:600; color:#f5f5f5; list-style:none; display:flex; align-items:center; justify-content:space-between; }
.nx-details summary::-webkit-details-marker { display:none; }
.nx-details[open] summary svg { transform:rotate(180deg); }

.nx-draw { stroke-dasharray:1; stroke-dashoffset:1; animation: nx-draw 1.4s ease forwards .3s; }
.nx-draw-2 { animation-delay: 1.5s; }
@keyframes nx-draw { to { stroke-dashoffset:0; } }
.nx-pop { opacity:0; animation: nx-pop .5s ease forwards 2.6s; }
@keyframes nx-pop { from { opacity:0; transform:scale(.9);} to { opacity:1; transform:none; } }
.nx-sticky-nav-sentinel { position:absolute; }

@media (max-width: 1000px) {
  .nx-hero-grid { grid-template-columns: 1fr; gap:48px; }
  .nx-dash { grid-template-columns: 1fr; }
  .nx-dash > div:first-child { border-right:none; border-bottom:1px solid ${C.line}; }
  .nx-four, .nx-arch { grid-template-columns: repeat(2,1fr); }
  .nx-five { grid-template-columns: repeat(2,1fr); }
  .nx-three, .nx-chain { grid-template-columns: 1fr; }
  .nx-two { grid-template-columns: 1fr; }
  .nx-steps { grid-template-columns: 1fr; gap:12px; }
  .nx-steps-line { display:none; }
  .nx-pipe-arrow, .nx-arch-arrow { display:none; }
  .nx-sec { padding: 72px 0; }
}
@media (max-width: 560px) {
  .nx-tab-name { display:none; }
  .nx-four, .nx-arch, .nx-five { grid-template-columns: 1fr; }
  .nx-wrap { padding: 0 16px; }
  .nx-btn { width:100%; justify-content:center; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior:auto; }
  .nx-reveal { opacity:1; transform:none; transition:none; }
  .nx-draw { animation:none; stroke-dashoffset:0; }
  .nx-pop { animation:none; opacity:1; }
  .nx-steps-line > span { width:100%; transition:none; }
  .nx-hover, .nx-btn { transition:none; }
}
`;

/* ─── Small pieces ──────────────────────────────────────────────────────── */

const Badge: React.FC<{ status: Status; label?: string }> = ({ status, label }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: '.4px',
    padding: '4px 10px', borderRadius: 9999, color: STATUS_COLOR[status],
    background: `${STATUS_COLOR[status]}1a`, border: `1px solid ${STATUS_COLOR[status]}40`,
  }}>
    {STATUS_ICON[status]} {label ?? status}
  </span>
);

const Kv: React.FC<{ k: string; v: React.ReactNode; accent?: string }> = ({ k, v, accent }) => (
  <div>
    <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>{k}</div>
    <div style={{ fontSize: 15, fontWeight: 600, color: accent ?? '#f5f5f5' }}>{v}</div>
  </div>
);

const Head: React.FC<{ eyebrow: string; title: React.ReactNode; lede?: string }> = ({ eyebrow, title, lede }) => (
  <Reveal style={{ marginBottom: 56 }}>
    <p className="nx-eyebrow">{eyebrow}</p>
    <h2 className="nx-h2">{title}</h2>
    {lede && <p className="nx-lede">{lede}</p>}
  </Reveal>
);

const VerdictPill: React.FC<{ status: Status; text: string }> = ({ status, text }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 9999,
    background: `${STATUS_COLOR[status]}1a`, border: `1px solid ${STATUS_COLOR[status]}55`,
    color: STATUS_COLOR[status], fontWeight: 700, fontSize: 13, letterSpacing: '.5px',
  }}>{STATUS_ICON[status]} {text}</div>
);

/* ─── Hero preview ──────────────────────────────────────────────────────── */

const HeroPreview: React.FC = () => (
  <div className="nx-panel nx-hover" style={{ padding: 24, boxShadow: '0 40px 120px -40px rgba(73,79,223,0.35)' }}
    role="group" aria-label="Product preview: ELN on NIFTY 50">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 600 }}>ELN — NIFTY 50</div>
        <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>12 months</div>
      </div>
      <span style={{ fontSize: 11, color: C.text3, border: `1px solid ${C.line}`, borderRadius: 9999, padding: '3px 10px' }}>Illustrative</span>
    </div>
    <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>Payoff at maturity · return vs. index level</div>
    <PayoffSVG height={190} />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: '16px 0', borderTop: `1px solid ${C.line}`, marginTop: 8 }}>
      <Kv k="Barrier" v={<CountUp to={75} suffix="%" />} accent={C.amber} />
      <Kv k="Coupon" v={<CountUp to={10} decimals={1} suffix="% p.a." />} accent={C.green} />
      <Kv k="Worst case" v={<span>{pct(elnReturn(0.4), 0)} <span style={{ fontSize: 11, color: C.text3, fontWeight: 400 }}>at 40%</span></span>} accent={C.red} />
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
      <span style={{ fontSize: 12, color: C.text3, textTransform: 'uppercase', letterSpacing: '.5px' }}>Suitability</span>
      <span className="nx-pop"><Badge status="PASS" label="SUITABLE" /></span>
    </div>
  </div>
);

/* ─── Surfaces fragments ────────────────────────────────────────────────── */

const SURFACES = [
  {
    who: 'Client', verb: 'Understand', to: '/client', cta: 'Run client assessment',
    line: 'A plain-language recommendation, with the reasons behind it.',
    fragment: (
      <div>
        <Badge status="REVIEW" label="NEEDS REVIEW" />
        <p style={{ fontSize: 13, color: C.text2, lineHeight: 1.55, margin: '12px 0 0' }}>
          This note is within your risk level, but together with your existing holdings it would be a larger share of your wealth than we allow without review.
        </p>
      </div>
    ),
  },
  {
    who: 'Relationship Manager', verb: 'Decide', to: '/rm', cta: 'Open RM workspace',
    line: 'Configure, simulate and assess any client case in one screen.',
    fragment: (
      <div style={{ display: 'grid', gap: 8 }}>
        {[['Product', 'ELN · NIFTY 50'], ['Tenor', '12 months'], ['Barrier / Coupon', '75% / 10.0%']].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '7px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
            <span style={{ color: C.text3 }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    who: 'Client + RM', verb: 'Verify', to: '/login', cta: 'Sign in to review',
    line: 'The full analysis and its audit record, identical for both.',
    fragment: (
      <div className="nx-mono" style={{ fontSize: 11.5, color: C.text2, lineHeight: 1.9 }}>
        <div>run_id <span style={{ color: C.blueSoft }}>sim_…</span></div>
        <div>rules <span style={{ color: C.green }}>versioned</span></div>
        <div>record <span style={{ color: C.amber }}>sha256(prev + payload)</span></div>
      </div>
    ),
  },
];

/* ─── Audit chain interactive ───────────────────────────────────────────── */

const BASE_RECORDS: ChainRecord[] = [
  { id: 'A-001', payload: '{"verdict":"SUITABLE","product":"CPN"}' },
  { id: 'A-002', payload: '{"verdict":"REVIEW_REQUIRED","product":"ELN"}' },
  { id: 'A-003', payload: '{"verdict":"NOT_SUITABLE","product":"DCD"}' },
];
const TAMPERED = '{"verdict":"SUITABLE","product":"ELN"}';

const AuditChain: React.FC = () => {
  const [tamper, setTamper] = useState(false);
  const [orig, setOrig] = useState<string[]>([]);
  const [cur, setCur] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const a = await buildChain(BASE_RECORDS);
        const b = await buildChain(BASE_RECORDS.map((r, i) => (i === 1 ? { ...r, payload: TAMPERED } : r)));
        if (live) { setOrig(a.map((x) => x.recordHash)); setCur(b.map((x) => x.recordHash)); }
      } catch { /* crypto.subtle unavailable (non-secure context): chain stays blank */ }
    })();
    return () => { live = false; };
  }, []);

  return (
    <div className="nx-panel" style={{ padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Hash-chained audit trail</div>
          <div style={{ fontSize: 13, color: C.text3, marginTop: 2 }}>Live SHA-256 in your browser · demo records</div>
        </div>
        <button type="button" onClick={() => setTamper((t) => !t)} aria-pressed={tamper}
          style={{
            cursor: 'pointer', padding: '9px 18px', borderRadius: 9999, fontSize: 13, fontWeight: 600,
            background: tamper ? `${C.red}1f` : 'rgba(255,255,255,0.06)',
            border: `1px solid ${tamper ? C.red + '66' : 'rgba(255,255,255,0.16)'}`,
            color: tamper ? C.red : '#f5f5f5',
          }}>
          {tamper ? 'Restore record A-002' : 'Tamper with record A-002'}
        </button>
      </div>

      <div className="nx-chain">
        {BASE_RECORDS.map((r, i) => {
          const hash = (tamper ? cur[i] : orig[i]) ?? '';
          const broken = tamper && i >= 1;
          const edited = tamper && i === 1;
          const color = broken ? C.red : C.green;
          return (
            <div key={r.id} style={{ position: 'relative', padding: 16, borderRadius: 14, background: '#111', border: `1px solid ${broken ? C.red + '66' : C.line}`, transition: 'border-color .3s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text2 }}>{r.id}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color }}>{broken ? (edited ? 'EDITED' : 'CHAIN BROKEN') : 'VALID'}</span>
              </div>
              <div className="nx-mono" style={{ fontSize: 11, color: edited ? C.red : C.text2, wordBreak: 'break-all', marginBottom: 12, minHeight: 32 }}>
                {edited ? TAMPERED : r.payload}
              </div>
              <div style={{ fontSize: 10.5, color: C.text3, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>
                record_hash = sha256({i === 0 ? 'genesis' : `A-00${i}`} + payload)
              </div>
              <div className="nx-mono" style={{ fontSize: 12, color }}>{hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : '…'}</div>
              {i === 0 && <div className="nx-mono" style={{ fontSize: 10, color: C.text3, marginTop: 6 }}>prev {GENESIS.slice(0, 6)}…</div>}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 13, color: C.text3, margin: '16px 0 0', lineHeight: 1.55 }}>
        Each record’s hash covers the previous record’s hash, so changing one entry invalidates every entry after it.
        Tamper-evident, not tamper-proof: a prototype-grade control.
      </p>
    </div>
  );
};

/* ─── Page ──────────────────────────────────────────────────────────────── */

const LandingPage: React.FC = () => {
  const [active, setActive] = useState(0);
  const [more, setMore] = useState(false);
  const [stepsRef, stepsSeen] = useInView<HTMLDivElement>(0.3);
  const prod = PRODUCTS[active];

  return (
    <div className="nx-root">
      <style>{CSS}</style>

      {/* HERO */}
      <section id="top" style={{ padding: '96px 0 88px' }}>
        <div className="nx-wrap nx-hero-grid">
          <div>
            <h1 style={{ fontSize: 'clamp(46px, 7vw, 88px)', fontWeight: 500, lineHeight: 1, letterSpacing: '-2px', margin: '0 0 28px' }}>
              See the payoff.<br />
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>Prove the suitability.</span>
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.6, color: C.text2, maxWidth: 540, margin: '0 0 40px' }}>
              Simulate structured-product outcomes, test every recommendation against deterministic suitability rules,
              and give relationship managers an explanation they can defend.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link to="/login" className="nx-btn nx-btn-primary">Sign in <ArrowRight size={16} className="nx-arrow" /></Link>
              <Link to="/client/register" className="nx-btn nx-btn-ghost">Register as a client</Link>
            </div>
          </div>
          <HeroPreview />
        </div>
      </section>

      {/* METRICS */}
      <section aria-label="System capabilities" style={{ background: '#0a0a0a', borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
        <div className="nx-wrap" style={{ padding: '44px 24px' }}>
          <div className="nx-eyebrow" style={{ textAlign: 'center', color: C.text3, marginBottom: 28 }}>System capabilities</div>
          <div className="nx-four">
            {METRICS.map((m) => (
              <div key={m.label} style={{ textAlign: 'center', padding: '4px 8px' }}>
                <div style={{ fontSize: 40, fontWeight: 500, letterSpacing: '-1px' }}><CountUp to={m.to} /></div>
                <div style={{ fontSize: 14, color: '#f5f5f5', marginTop: 4 }}>{m.label}</div>
                <div style={{ fontSize: 12.5, color: C.text3, marginTop: 4 }}>{m.note}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SURFACES */}
      <section className="nx-sec" style={{ borderTop: 'none' }}>
        <div className="nx-wrap">
          <Head eyebrow="Access" title="One engine. Three surfaces."
            lede="The client, the RM and the reviewer all see numbers from the same simulation and rule set." />
          <div className="nx-three">
            {SURFACES.map((s, i) => (
              <Reveal key={s.who} delay={i * 80}>
                <div className="nx-panel nx-hover" style={{ padding: 28, height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '.6px' }}>{s.who}</div>
                  <h3 style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-.5px', margin: '6px 0 8px' }}>{s.verb}</h3>
                  <p style={{ fontSize: 15, color: C.text2, lineHeight: 1.55, margin: '0 0 22px' }}>{s.line}</p>
                  <div style={{ flex: 1, padding: 16, borderRadius: 14, background: '#111', border: `1px solid ${C.line}`, marginBottom: 20 }}>{s.fragment}</div>
                  <Link to={s.to} style={{ color: C.blueSoft, fontSize: 14, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {s.cta} <ArrowRight size={14} />
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* DASHBOARD PREVIEW */}
      <section id="platform" className="nx-sec" style={{ background: '#0a0a0a' }}>
        <div className="nx-wrap">
          <Head eyebrow="The product" title="One decision. Every layer visible."
            lede="From payoff mechanics to suitability verdict, every output is traceable to the same simulation and rule set." />
          <Reveal>
            <div className="nx-panel" style={{ overflow: 'hidden' }} role="group" aria-label="Dashboard preview with sample data">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 24px', borderBottom: `1px solid ${C.line}`, background: '#111' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Assessment · ELN — NIFTY 50 · 12 months</span>
                <span style={{ fontSize: 12, color: C.text3 }}>Demo data</span>
              </div>
              <div className="nx-dash">
                {/* main */}
                <div style={{ padding: 24 }}>
                  <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Payoff at maturity</div>
                  <PayoffSVG height={230} animate={false} />
                  <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '.5px', margin: '20px 0 10px' }}>Scenario analysis · 12M, principal {inr(DEMO.notional)}</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 440 }}>
                      <thead>
                        <tr>
                          <th scope="row" style={{ textAlign: 'left', fontWeight: 500, color: C.text3, padding: '8px 0' }}>Index move</th>
                          {SCENARIOS.map((s) => <th key={s} scope="col" style={{ textAlign: 'right', fontWeight: 600, padding: '8px 0' }}>{s === 0 ? '0%' : pct(s, 0)}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ borderTop: `1px solid ${C.line}` }}>
                          <th scope="row" style={{ textAlign: 'left', fontWeight: 500, color: C.text3, padding: '10px 0' }}>Return</th>
                          {SCENARIOS.map((s) => {
                            const r = elnReturn(1 + s);
                            return <td key={s} style={{ textAlign: 'right', fontWeight: 600, color: r < 0 ? C.red : C.green }}>{pct(r)}</td>;
                          })}
                        </tr>
                        <tr style={{ borderTop: `1px solid ${C.line}` }}>
                          <th scope="row" style={{ textAlign: 'left', fontWeight: 500, color: C.text3, padding: '10px 0' }}>Value</th>
                          {SCENARIOS.map((s) => (
                            <td key={s} style={{ textAlign: 'right', color: C.text2 }}>{inr(Math.round(DEMO.notional * (1 + elnReturn(1 + s))))}</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p style={{ fontSize: 12, color: C.text3, margin: '12px 0 0' }}>
                    Computed from the 75% barrier / 10% coupon terms at maturity. A −20% move sits above the barrier, so only the −30% case loses principal.
                  </p>
                </div>

                {/* side */}
                <div style={{ padding: 24 }}>
                  <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Client profile</div>
                  <dl style={{ margin: 0, display: 'grid', gap: 10, fontSize: 14 }}>
                    {[
                      ['Risk appetite', 'Aggressive'], ['Investment horizon', '24 months'], ['Loss tolerance', '25%'],
                      ['Liquid net worth', inr(DEMO.netWorth)], ['Existing structured exposure', inr(DEMO.existing)],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <dt style={{ color: C.text3 }}>{k}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '.5px', margin: '24px 0 12px' }}>Suitability</div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                    {DEMO_CHECKS.map((c) => (
                      <li key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
                        <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: STATUS_COLOR[c.status], background: `${STATUS_COLOR[c.status]}1a` }}>{STATUS_ICON[c.status]}</span>
                        {c.name}
                      </li>
                    ))}
                  </ul>
                  <div style={{ marginTop: 22, paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
                    <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Final verdict</div>
                    <VerdictPill status="REVIEW" text="REVIEW REQUIRED" />
                    <div style={{ fontSize: 13, fontWeight: 600, margin: '18px 0 4px' }}>Why?</div>
                    <p style={{ fontSize: 13.5, color: C.text2, lineHeight: 1.55, margin: 0 }}>
                      Concentration is {(DEMO_CONC * 100).toFixed(1)}%, above the {DEMO.passLimit * 100}% pass limit for an Aggressive client (fail above {DEMO.failLimit * 100}%).
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SUITABILITY */}
      <section id="suitability" className="nx-sec">
        <div className="nx-wrap">
          <Head eyebrow="Suitability engine" title={<>Five checks.<br />One deterministic verdict.</>}
            lede="Rules are fixed and versioned. The language model explains the result — it never decides it." />

          <Reveal>
            <div className="nx-five" role="list" aria-label="Decision pipeline" style={{ marginBottom: 40 }}>
              {['Client profile', 'Product risk', 'Simulation', '5 suitability checks', 'Deterministic verdict'].map((s, i, a) => (
                <div role="listitem" key={s} style={{ position: 'relative', padding: '16px 18px', borderRadius: 14, border: `1px solid ${i === 4 ? C.green + '66' : C.line}`, background: i === 4 ? `${C.green}0f` : C.panel }}>
                  <div style={{ fontSize: 11, color: C.text3, marginBottom: 4 }}>STEP {i + 1}</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{s}</div>
                  {i < a.length - 1 && <ArrowRight size={14} aria-hidden="true" className="nx-pipe-arrow" style={{ position: 'absolute', right: -14, top: '50%', marginTop: -7, color: C.text3, zIndex: 1 }} />}
                </div>
              ))}
            </div>
          </Reveal>

          <div className="nx-three" style={{ marginBottom: 32 }}>
            {CHECKS.map((c, i) => (
              <Reveal key={c.title} delay={i * 50}>
                <div className="nx-panel nx-hover" style={{ padding: 26, height: '100%' }}>
                  <div className="nx-mono" style={{ fontSize: 13, color: C.blueSoft, marginBottom: 12 }}>0{i + 1}</div>
                  <h3 style={{ fontSize: 21, fontWeight: 600, margin: '0 0 10px', letterSpacing: '-.3px' }}>{c.title}</h3>
                  <p style={{ fontSize: 14.5, color: C.text2, lineHeight: 1.6, margin: 0 }}>{c.rule}</p>
                </div>
              </Reveal>
            ))}
            <Reveal delay={250}>
              <div className="nx-panel" style={{ padding: 26, height: '100%', background: '#111' }}>
                <div style={{ fontSize: 12, color: C.text3, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 14 }}>Three possible outcomes</div>
                <div style={{ display: 'grid', gap: 12 }}>
                  {VERDICTS.map((v) => (
                    <div key={v.label}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: v.color, letterSpacing: '.4px' }}>{v.label}</div>
                      <div style={{ fontSize: 13, color: C.text3 }}>{v.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* EXPLAINABILITY */}
      <section className="nx-sec" style={{ background: '#0a0a0a' }}>
        <div className="nx-wrap">
          <Head eyebrow="Explainability" title="Every verdict has a reason."
            lede="The explanation is written from validated facts the rule engine already produced. It cannot change the outcome." />
          <Reveal>
            <div className="nx-two" style={{ alignItems: 'stretch' }}>
              <div className="nx-panel" style={{ padding: 28 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.6px', color: C.green }}>RULE ENGINE</span>
                  <span style={{ fontSize: 12, color: C.text3 }}>Deterministic</span>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {DEMO_CHECKS.map((c) => (
                    <li key={c.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: `1px solid ${C.line}` }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 12.5, color: C.text3, marginTop: 2 }}>{c.detail}</div>
                      </div>
                      <Badge status={c.status} />
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 20 }}><VerdictPill status="REVIEW" text="VERDICT: REVIEW REQUIRED" /></div>
              </div>

              <div className="nx-panel" style={{ padding: 28, borderColor: 'rgba(124,130,240,0.3)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.6px', color: C.blueSoft }}>AI EXPLANATION</span>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', color: C.amber, border: `1px solid ${C.amber}55`, borderRadius: 9999, padding: '3px 10px' }}>LLM: EXPLANATION ONLY</span>
                </div>
                <p style={{ fontSize: 17, lineHeight: 1.65, margin: '0 0 20px', color: '#f5f5f5' }}>
                  “The proposed allocation, together with the client’s existing structured holdings, comes to {(DEMO_CONC * 100).toFixed(1)}% of liquid net worth.
                  That is above the {DEMO.passLimit * 100}% pass limit for an Aggressive client but within the {DEMO.failLimit * 100}% ceiling, so the case needs review rather than rejection.
                  All other checks passed.”
                </p>
                <div style={{ marginTop: 'auto', paddingTop: 18, borderTop: `1px solid ${C.line}`, display: 'grid', gap: 8, fontSize: 13, color: C.text2 }}>
                  <div style={{ display: 'flex', gap: 8 }}><Check size={14} color={C.green} style={{ marginTop: 3, flexShrink: 0 }} /> Every number is checked against the computed facts.</div>
                  <div style={{ display: 'flex', gap: 8 }}><Check size={14} color={C.green} style={{ marginTop: 3, flexShrink: 0 }} /> Verdict wording must match the rule engine, else a fixed template is used.</div>
                  <div style={{ display: 'flex', gap: 8 }}><Check size={14} color={C.green} style={{ marginTop: 3, flexShrink: 0 }} /> Clients see a version without AML or FATCA detail.</div>
                </div>
              </div>
            </div>
          </Reveal>
          <p style={{ fontSize: 12.5, color: C.text3, margin: '16px 0 0' }}>Sample case with illustrative figures. Wording shown is an example of the style, not a live model output.</p>
        </div>
      </section>

      {/* ARCHITECTURE + TRUST */}
      <section className="nx-sec">
        <div className="nx-wrap">
          <Head eyebrow="Architecture" title={<>Deterministic at the core.<br />Intelligent at the edge.</>}
            lede="Numbers come from the quantitative engine, decisions from the rule engine. AI only narrates, and the audit system records everything." />
          <Reveal>
            <div className="nx-arch" role="list" aria-label="System architecture, in processing order">
              {ARCH.map((g, gi) => (
                <div role="listitem" key={g.group} className="nx-panel nx-arch-card" style={{ '--c': g.color } as React.CSSProperties}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                    <span className="nx-icon" style={{ background: `${g.color}1f`, color: g.color }}>{g.icon}</span>
                    <span className="nx-mono" style={{ fontSize: 12, color: C.text3 }}>0{gi + 1}</span>
                  </div>
                  <span className="nx-pill" style={{ color: g.color, background: `${g.color}1a` }}>{g.tag}</span>
                  <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-.2px', margin: '10px 0 18px' }}>{g.group}</div>
                  <ul className="nx-nodes">
                    {g.nodes.map((n) => (<li key={n}><i />{n}</li>))}
                  </ul>
                  {gi < ARCH.length - 1 && <span className="nx-arch-arrow" aria-hidden="true"><ArrowRight size={13} /></span>}
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal style={{ marginTop: 56 }}>
            <div className="nx-four" role="list" aria-label="Trust principles">
              {TRUST.map((t) => (
                <div role="listitem" key={t.head} className="nx-panel nx-hover nx-trust" style={{ '--c': t.color } as React.CSSProperties}>
                  <span className="nx-icon" style={{ background: `${t.color}1f`, color: t.color, marginBottom: 16 }}>{t.icon}</span>
                  <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-.2px' }}>{t.head}</div>
                  <div style={{ fontSize: 14.5, color: C.text2, lineHeight: 1.55, marginTop: 6 }}>{t.body}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* PRODUCTS */}
      <section id="products" className="nx-sec" style={{ background: '#0a0a0a' }}>
        <div className="nx-wrap">
          <Head eyebrow="Products" title="Three structured product classes."
            lede="Defaults and bounds are the configuration the engine validates against." />

          <Reveal>
            <div className="nx-three" style={{ marginBottom: 40 }}>
              {COMPARE.map((c, i) => (
                <button key={c.type} type="button" className="nx-panel nx-hover nx-cmp" aria-pressed={active === i}
                  onClick={() => { setActive(i); setMore(false); }} style={{ '--c': c.color } as React.CSSProperties}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <span className="nx-icon nx-mono" style={{ width: 'auto', padding: '0 14px', fontSize: 18, fontWeight: 700, background: `${c.color}1f`, color: c.color }}>{c.type}</span>
                    <span style={{ fontSize: 12, color: active === i ? c.color : C.text3, fontWeight: 600 }}>{active === i ? 'Viewing' : 'View details'}</span>
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div className="nx-cmp-row"><Check size={15} color={C.green} />{c.a}</div>
                    <div className="nx-cmp-row"><AlertTriangle size={14} color={C.amber} />{c.b}</div>
                  </div>
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`, fontSize: 12, color: C.text3, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                    Suits <span style={{ display: 'block', marginTop: 3, fontSize: 14, color: '#f5f5f5', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>{c.c}</span>
                  </div>
                </button>
              ))}
            </div>
          </Reveal>

          <div className="nx-tabs" role="tablist" aria-label="Product detail">
            {PRODUCTS.map((p, i) => (
              <button key={p.type} className="nx-tab" role="tab" id={`tab-${p.type}`} aria-selected={active === i} aria-controls="product-panel"
                onClick={() => { setActive(i); setMore(false); }}>
                {p.type}<span className="nx-tab-name"> · {p.name}</span>
              </button>
            ))}
          </div>

          <div id="product-panel" role="tabpanel" aria-labelledby={`tab-${prod.type}`} className="nx-two" style={{ gridTemplateColumns: undefined }}>
            <div className="nx-panel" style={{ padding: 32, boxShadow: `inset 0 3px 0 ${prod.accent}`, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span className="nx-icon nx-mono" style={{ width: 'auto', padding: '0 14px', fontSize: 16, fontWeight: 700, background: `${prod.accent}1f`, color: prod.accent }}>{prod.type}</span>
                <span className="nx-pill" style={{ color: prod.riskColor, background: `${prod.riskColor}1f` }}>{prod.risk} profile</span>
              </div>
              <h3 style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-.5px', margin: '18px 0 4px' }}>{prod.name}</h3>
              <p style={{ fontSize: 14, color: C.text3, margin: '0 0 20px' }}>{prod.subtitle}</p>
              <div style={{ padding: '14px 16px', borderRadius: 12, background: `${prod.accent}10`, borderLeft: `3px solid ${prod.accent}`, fontSize: 15, lineHeight: 1.55, marginBottom: 22 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: prod.accent, display: 'block', marginBottom: 4 }}>Payoff mechanics</span>
                {prod.mechanic}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                {prod.metrics.slice(0, more ? 6 : 3).map((m, i) => (
                  <div key={m.label} className="nx-term">
                    <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>{m.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, color: i === 0 ? prod.accent : '#f5f5f5' }}>{m.value}</div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
                style={{ marginTop: 'auto', alignSelf: 'flex-start', background: 'none', border: 'none', color: C.blueSoft, fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '18px 0 0' }}>
                {more ? 'Fewer terms' : 'All terms and bounds'}
                {more ? <ArrowUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>

            <div className="nx-panel" style={{ padding: 32, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.5px', textTransform: 'uppercase', color: C.text3, marginBottom: 10 }}>Ideal client fit</div>
              <p style={{ fontSize: 16, color: C.text2, lineHeight: 1.65, margin: '0 0 24px' }}>{prod.fit}</p>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.5px', textTransform: 'uppercase', color: C.text3, marginBottom: 10 }}>Supported underlyings</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {prod.underlyings.split(' · ').map((u) => (<span key={u} className="nx-chip">{u}</span>))}
              </div>
              <details className="nx-details">
                <summary>How it behaves <ChevronDown size={16} style={{ transition: 'transform .2s' }} /></summary>
                <p style={{ lineHeight: 1.65, margin: '10px 0 0' }}>{prod.desc}</p>
              </details>
              <div style={{ marginTop: 'auto', paddingTop: 28, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link to="/rm" className="nx-btn nx-btn-primary" style={{ height: 46, padding: '0 22px', fontSize: 14 }}>Structure {prod.type} <ArrowRight size={14} className="nx-arrow" /></Link>
                <Link to="/client" className="nx-btn nx-btn-ghost" style={{ height: 46, padding: '0 22px', fontSize: 14 }}>Run suitability</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SIMULATION */}
      <section className="nx-sec">
        <div className="nx-wrap">
          <Head eyebrow="Simulation" title={<>Don’t predict one outcome.<br />Stress thousands of them.</>}
            lede="Historical block bootstrap resamples real daily returns in blocks of 10 days, preserving short-term clustering. Stress cases sit alongside." />
          <Reveal>
            <div className="nx-panel" style={{ padding: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 600 }}>Index level over 12 months</div>
                  <div style={{ fontSize: 13, color: C.text3, marginTop: 2 }}>2,000 bootstrap paths · 5th–95th percentile</div>
                </div>
                <div style={{ display: 'flex', gap: 14, fontSize: 12, color: C.text2, flexWrap: 'wrap' }}>
                  <span><i style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(73,79,223,0.3)', borderRadius: 2, marginRight: 6 }} />25th–75th</span>
                  <span><i style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(73,79,223,0.14)', borderRadius: 2, marginRight: 6 }} />5th–95th</span>
                  <span><i style={{ display: 'inline-block', width: 14, height: 2, background: C.blueSoft, marginRight: 6, verticalAlign: 3 }} />Median</span>
                </div>
              </div>
              <FanSVG height={290} />
              <p style={{ fontSize: 12.5, color: C.text3, margin: '16px 0 0', lineHeight: 1.55 }}>
                <strong style={{ color: C.amber }}>Statistical model, not a forecast.</strong>{' '}
                Fan shape here is illustrative; the product computes it from the selected underlying’s own history.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* AUDIT */}
      <section className="nx-sec" style={{ background: '#0a0a0a' }}>
        <div className="nx-wrap">
          <Head eyebrow="Auditability" title="Built to be explained and audited."
            lede="Every assessment, with its decision payload, is appended to a SHA-256 hash chain. Try breaking it." />
          <Reveal><AuditChain /></Reveal>
          <div className="nx-three" style={{ marginTop: 20 }}>
            {PLATFORM_ITEMS.map((f, i) => (
              <Reveal key={f.title} delay={i * 40}>
                <div style={{ display: 'flex', gap: 14, padding: '18px 4px', alignItems: 'flex-start' }}>
                  <span style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(73,79,223,0.14)', color: C.blueSoft }}>{f.icon}</span>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{f.title}</div>
                    <div style={{ fontSize: 14, color: C.text2, lineHeight: 1.55 }}>{f.desc}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* WORKFLOW */}
      <section id="how-it-works" className="nx-sec">
        <div className="nx-wrap">
          <Head eyebrow="How it works" title="From client profile to audited recommendation." />
          <div ref={stepsRef} className={`nx-steps${stepsSeen ? ' in' : ''}`} role="list">
            <div className="nx-steps-line" aria-hidden="true"><span /></div>
            {WORKFLOW.map((w, i) => (
              <div role="listitem" key={w.title} style={{ position: 'relative' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', background: '#000', border: `2px solid ${C.blue}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.blueSoft, marginBottom: 16, position: 'relative', zIndex: 1,
                }}>{w.icon}</div>
                <div className="nx-mono" style={{ fontSize: 12, color: C.text3, marginBottom: 4 }}>0{i + 1}</div>
                <h3 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 6px' }}>{w.title}</h3>
                <p style={{ fontSize: 14.5, color: C.text2, lineHeight: 1.55, margin: 0 }}>{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="nx-sec" style={{ textAlign: 'center', background: 'radial-gradient(ellipse at 50% 0%, rgba(73,79,223,0.18), transparent 60%), #000' }}>
        <div className="nx-wrap" style={{ maxWidth: 820 }}>
          <Reveal>
            <h2 className="nx-h2" style={{ fontSize: 'clamp(40px, 6vw, 72px)', marginBottom: 20 }}>Make suitability measurable.</h2>
            <p style={{ fontSize: 19, color: C.text2, lineHeight: 1.55, margin: '0 auto 40px', maxWidth: 560 }}>
              Simulate the product. Validate the client. Explain every decision.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', margin: '0 0 40px' }}>
              <Link to="/login" className="nx-btn nx-btn-primary">Sign in <ArrowRight size={16} className="nx-arrow" /></Link>
              <Link to="/rm/register" className="nx-btn nx-btn-ghost">Register as an RM</Link>
            </div>
            <p style={{ fontSize: 13.5, color: C.text3, lineHeight: 1.7, margin: 0 }}>
              Decision support only, not investment advice.<br />
              Historical simulations do not predict future performance.<br />
              Final suitability must be confirmed by a qualified person.
            </p>
          </Reveal>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: `1px solid ${C.line}`, padding: '36px 0' }}>
        <div className="nx-wrap" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wordmark size={15} />
            <span style={{ fontSize: 13, color: C.text3 }}>© 2026 · Pricing indicative, suitability rules illustrative pending compliance review</span>
          </div>
          <nav aria-label="Footer" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {[['Log in', '/login'], ['RM Workspace', '/rm'], ['Client Portal', '/client'], ['Client KYC', '/client/register'], ['RM Onboarding', '/rm/register']].map(([l, to]) => (
              <Link key={to} to={to} style={{ fontSize: 13, color: C.text2, textDecoration: 'none' }}>{l}</Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
