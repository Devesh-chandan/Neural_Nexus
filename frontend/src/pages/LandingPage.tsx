import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight, Check, AlertTriangle, X, UserCheck, BarChart3, ShieldCheck, FileText, Lock,
  Database, TrendingUp, Brain, Calculator, Fingerprint, Scale, Sparkles, History, Layers, Users, Menu,
  ChevronLeft, LineChart, Gauge, Landmark, Eye, Workflow, Boxes, ListChecks, Cpu,
} from 'lucide-react';
import Wordmark, { WordmarkGlyph } from '../components/Wordmark';
import { useAuth } from '../hooks/useAuth';
import {
  Reveal, CountUp, useInView, PayoffSVG, FanSVG, elnReturn, pct, buildChain, GENESIS,
  type ChainRecord,
} from '../components/landing/visuals';

/* ─── Tokens (Inter + JetBrains Mono, the site's own fonts) ─────────────── */

const C = {
  ink: '#1c1c1c',
  body: '#6b6b6b',
  mute: '#8a8a8a',
  line: '#e6e6e6',
  page: '#f3f3f3',
  tile: '#f6f6f6',
  green: '#12875f',
  amber: '#c2710c',
  red: '#d33a3a',
  indigo: '#4f46e5',
};

type Status = 'PASS' | 'REVIEW' | 'FAIL';
const STATUS_COLOR: Record<Status, string> = { PASS: C.green, REVIEW: C.amber, FAIL: C.red };
const STATUS_ICON: Record<Status, React.ReactNode> = {
  PASS: <Check size={13} />,
  REVIEW: <AlertTriangle size={12} />,
  FAIL: <X size={13} />,
};

/* ─── Content: this project's own data (config/*.yaml, rules, engines) ──── */

const DEMO = { netWorth: 6_000_000, notional: 1_000_000, existing: 300_000, passLimit: 0.2, failLimit: 0.3 };
const DEMO_CONC = (DEMO.notional + DEMO.existing) / DEMO.netWorth;
const DEMO_CHECKS: { name: string; status: Status; detail: string }[] = [
  { name: 'Compliance gates', status: 'PASS', detail: 'KYC current, AML low' },
  { name: 'Risk appetite', status: 'PASS', detail: 'Aggressive client, product within level' },
  { name: 'Horizon', status: 'PASS', detail: '12M tenor within 24M horizon' },
  { name: 'Loss tolerance', status: 'PASS', detail: `Worst past period ${pct(elnReturn(0.7))} within 25%` },
  { name: 'Concentration', status: 'REVIEW', detail: `${(DEMO_CONC * 100).toFixed(1)}% vs ${DEMO.passLimit * 100}% pass limit` },
];
const inr = (v: number) => `₹${v.toLocaleString('en-IN')}`;
const SCENARIOS = [-0.3, -0.2, -0.1, 0, 0.1, 0.2];

const HERO_STATS = [
  { icon: <History size={18} />, to: 20, label: 'real past periods replayed per product' },
  { icon: <ListChecks size={18} />, to: 9, label: 'deterministic suitability checks' },
  { icon: <Fingerprint size={18} />, text: 'SHA-256', label: 'hash-chained audit trail' },
];

const BUILT_ON = ['ELN', 'CPN', 'DCD', 'NIFTY 50', 'Bank Nifty', 'Reliance', 'TCS', 'HDFC Bank', 'S&P 500', 'Apple', 'USD / INR', 'EUR / INR', 'USD / JPY'];

const PRODUCTS = [
  {
    type: 'ELN', name: 'Equity-Linked Note', subtitle: 'Barrier coupon, reverse-convertible style',
    risk: 'Aggressive', riskColor: C.amber,
    mechanic: 'Principal plus coupon, unless the underlying closes below the barrier on any day and ends below the strike. Then the client shares the fall.',
    fit: 'Moderate-to-aggressive clients who accept contingent equity downside for an enhanced coupon, and whose horizon covers the full tenor.',
    metrics: [['Default terms', '75% barrier · 10% p.a.'], ['Default tenor', '12 months'], ['Complexity', '2 of 3'],
      ['Barrier range', '40% – 95% of start'], ['Barrier observed', 'Every daily close'], ['Default principal', '₹10,00,000']],
  },
  {
    type: 'CPN', name: 'Capital-Protected Note', subtitle: 'Protection plus participation, optional cap',
    risk: 'Conservative to moderate', riskColor: C.green,
    mechanic: 'A protected share of principal is repaid at maturity (subject to issuer credit risk), plus a participation share of any rise. With no cap the upside is unlimited.',
    fit: 'Conservative clients who need principal safety and want equity upside, accepting that participation is funded by forgone interest.',
    metrics: [['Default terms', '100% protection · 80% participation'], ['Default tenor', '24 months'], ['Complexity', '1 of 3'],
      ['Protection range', '80% – 100%'], ['Participation range', '10% – 200%'], ['Cap', 'Optional']],
  },
  {
    type: 'DCD', name: 'Dual Currency Deposit', subtitle: 'FX-linked, e.g. USD / INR',
    risk: 'Moderate', riskColor: C.indigo,
    mechanic: 'Enhanced interest. If the rate ends beyond the strike, principal and interest are repaid in the other currency at the strike.',
    fit: 'Experienced clients with multi-currency cash flows who are comfortable being converted at the strike and have a matching horizon.',
    metrics: [['Default terms', '8% p.a. interest'], ['Default tenor', '6 months'], ['Complexity', '3 of 3'],
      ['Interest accrual', 'Calendar days ÷ 365'], ['Strike grid', 'Spot × 1.02 / 1.04 / 1.06'], ['Default principal', '$100,000']],
  },
];

const CHECKS = [
  ['Compliance gates', 'Vulnerable client, stale profile or US person → review. AML low passes, medium → review, high → fail. No screening on file means review.'],
  ['Risk appetite', 'Product level is the higher of its structure and its worst historical outcome. One level above the client → review, two → fail.'],
  ['Investment horizon', 'Tenor within the client’s stated horizon passes. Longer fails.'],
  ['Loss tolerance', 'The worst replayed historical period must stay within the client’s tolerance.'],
  ['Concentration', '(Investment + existing exposure) ÷ liquid net worth: conservative 10 / 15%, moderate 15 / 25%, aggressive 20 / 30%.'],
  ['Profile checks', 'Complexity against experience, life stage, affordability against income and net worth, and liquidity needs.'],
];

const TILES = [
  { icon: <TrendingUp size={26} />, label: 'Payoff curves' },
  { icon: <History size={26} />, label: 'Real-history replay' },
  { icon: <LineChart size={26} />, label: 'Monte Carlo fan chart' },
  { icon: <Gauge size={26} />, label: 'Scenario and stress table' },
  { icon: <Landmark size={26} />, label: 'Issuer credit risk figure' },
  { icon: <Brain size={26} />, label: 'Validated explanations' },
  { icon: <Eye size={26} />, label: 'Client-safe views' },
  { icon: <Database size={26} />, label: 'Offline-first market data' },
];

const SAMPLES: { status: Status; label: string; quote: string; who: string; meta: string }[] = [
  { status: 'FAIL', label: 'NOT SUITABLE', who: 'Moderate client · ELN · NIFTY 50',
    quote: '“In its worst past period this note lost 45.8%, which is a bigger loss than the 40% you said you can accept, so it does not meet your limit.”',
    meta: 'Loss tolerance: FAIL' },
  { status: 'REVIEW', label: 'REVIEW REQUIRED', who: 'Aggressive client · ELN · NIFTY 50',
    quote: `“Together with your existing holdings this would be ${(DEMO_CONC * 100).toFixed(1)}% of your liquid net worth, above the ${DEMO.passLimit * 100}% comfortable limit, so it needs a review rather than a rejection.”`,
    meta: 'Concentration: REVIEW' },
  { status: 'PASS', label: 'SUITABLE', who: 'Conservative client · CPN · NIFTY 50',
    quote: '“The note repays your protected amount at maturity and its worst past period did not lose money. Protection still depends on the issuer paying what it owes.”',
    meta: 'All checks pass' },
];

const ARCH = [
  { group: 'Quantitative engine', tag: 'Computes', icon: <Calculator size={18} />, nodes: ['One payoff implementation', 'Historical replay', 'Monte Carlo'] },
  { group: 'Rule engine', tag: 'Decides', icon: <ShieldCheck size={18} />, nodes: ['Suitability rules', 'Deterministic verdict'] },
  { group: 'AI explanation', tag: 'Explains only', icon: <Brain size={18} />, nodes: ['LLM narration', 'Output validation'] },
  { group: 'Audit system', tag: 'Records', icon: <Fingerprint size={18} />, nodes: ['SHA-256 hash chain'] },
];

const TRUST = [
  { head: 'AI assists', body: 'Narrates a result that already exists.', icon: <Sparkles size={16} /> },
  { head: 'Rules decide', body: 'Fixed, versioned thresholds set the verdict.', icon: <Scale size={16} /> },
  { head: 'Evidence supports', body: 'Every number traces to a replay or a computed fact.', icon: <BarChart3 size={16} /> },
  { head: 'Audit records', body: 'Each assessment is hash-chained.', icon: <Lock size={16} /> },
];

/* ─── Styles ────────────────────────────────────────────────────────────── */

const CSS = `
html { scroll-behavior: smooth; }
.cal-root { background:${C.page}; color:${C.ink}; font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing:antialiased; overflow-x:hidden; }
.cal-root section[id] { scroll-margin-top: 96px; }
.cal-mono { font-family:'JetBrains Mono', ui-monospace, monospace; }

/* sheet: a centred column bounded by hairlines, with section rules and "+" marks */
.cal-sheet { position:relative; max-width:1500px; margin:0 auto; border-left:1px solid ${C.line}; border-right:1px solid ${C.line}; }
.cal-in { max-width:1200px; margin:0 auto; padding:0 24px; }
.cal-rule { position:relative; height:1px; }
.cal-rule::before { content:''; position:absolute; top:0; left:50%; width:100vw; height:1px; background:${C.line}; transform:translateX(-50%); }
.cal-plus { position:absolute; top:-8px; width:17px; height:17px; background:${C.page}; }
.cal-plus::before, .cal-plus::after { content:''; position:absolute; background:#c9c9c9; }
.cal-plus::before { left:8px; top:2px; width:1px; height:13px; }
.cal-plus::after { top:8px; left:2px; height:1px; width:13px; }
.cal-plus.l { left:-9px; } .cal-plus.r { right:-9px; }
.cal-sec { padding:96px 0; }

/* floating nav */
.cal-nav { position:sticky; top:10px; z-index:60; padding:0 12px; margin-top:10px; }
.cal-nav-pill { max-width:1440px; margin:0 auto; height:70px; background:#fff; border:1px solid ${C.line}; border-radius:18px; display:flex; align-items:center; justify-content:space-between; padding:0 24px 0 38px; box-shadow:0 2px 10px rgba(0,0,0,.03); }
.cal-links { display:flex; gap:6px; }
.cal-links a { color:${C.ink}; text-decoration:none; font-size:15.5px; font-weight:500; padding:8px 18px; border-radius:10px; display:inline-flex; align-items:center; gap:6px; }
.cal-links a:hover { background:#f3f3f3; }
.cal-nav-cta { display:flex; align-items:center; gap:10px; }
.cal-signin { color:${C.ink}; text-decoration:none; font-size:15.5px; font-weight:600; padding:8px 10px; }
.cal-burger { display:none; background:none; border:0; cursor:pointer; padding:8px; color:${C.ink}; }
.cal-mobile { display:none; max-width:1440px; margin:8px auto 0; background:#fff; border:1px solid ${C.line}; border-radius:16px; padding:8px 20px; }
.cal-mobile a { display:block; padding:13px 0; color:${C.ink}; text-decoration:none; font-weight:500; border-bottom:1px solid #f1f1f1; }
.cal-mobile a:last-child { border-bottom:0; }

/* buttons */
.cal-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:46px; padding:0 22px; border-radius:11px; font-size:15.5px; font-weight:600; text-decoration:none; border:1px solid transparent; cursor:pointer; font-family:inherit; transition: background .15s, transform .15s, box-shadow .15s; }
.cal-btn:hover .cal-arrow { transform:translateX(3px); }
.cal-arrow { transition:transform .15s; opacity:.85; }
.cal-btn-dark { background:#242424; color:#fff; box-shadow:inset 0 1px 0 rgba(255,255,255,.12), 0 1px 2px rgba(0,0,0,.2); }
.cal-btn-dark:hover { background:#000; }
.cal-btn-soft { background:#f0f0f0; color:${C.ink}; border-color:#e6e6e6; }
.cal-btn-soft:hover { background:#e9e9e9; }
.cal-btn-white { background:#fff; color:${C.ink}; border-color:${C.line}; }
.cal-btn-white:hover { background:#fafafa; }
.cal-btn-sm { height:42px; padding:0 18px; font-size:15px; border-radius:10px; }
.cal-btn-wide { width:100%; }
.cal-root a:focus-visible, .cal-root button:focus-visible, .cal-root summary:focus-visible { outline:2px solid ${C.ink}; outline-offset:2px; border-radius:8px; }

/* type */
.cal-badge-pill { display:inline-flex; align-items:center; gap:8px; font-size:13.5px; font-weight:500; color:${C.ink}; padding:6px 14px; border-radius:9999px; border:1px solid ${C.line}; background:#fff; text-decoration:none; box-shadow:0 1px 2px rgba(0,0,0,.03); }
.cal-h1 { font-size:clamp(40px, 4.5vw, 68px); font-weight:600; letter-spacing:-0.055em; line-height:.98; margin:22px 0 24px; }
.cal-h2 { font-size:clamp(34px, 4.6vw, 62px); font-weight:600; letter-spacing:-0.055em; line-height:1; margin:18px 0 18px; }
.cal-lede { font-size:18.5px; line-height:1.6; color:${C.body}; max-width:640px; margin:0 auto; }
.cal-center { text-align:center; }
.cal-label { font-size:11.5px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:${C.mute}; }

/* cards */
.cal-card { background:#fff; border:1px solid ${C.line}; border-radius:20px; }
.cal-hover { transition: box-shadow .2s, transform .2s; }
.cal-hover:hover { box-shadow:0 14px 34px -14px rgba(0,0,0,.16); transform:translateY(-2px); }
.cal-num { width:40px; height:34px; border-radius:9px; background:#efefef; display:inline-flex; align-items:center; justify-content:center; font-size:14px; color:${C.body}; }
.cal-tile { background:#fff; border:1px solid ${C.line}; border-radius:18px; padding:34px 18px 26px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:18px; }
.cal-tile-ico { position:relative; width:82px; height:82px; border-radius:20px; background:${C.tile}; border:1px solid #ececec; display:flex; align-items:center; justify-content:center; color:#2b2b2b; }
.cal-tile-ico i { position:absolute; width:4px; height:4px; border-radius:50%; background:#d6d6d6; }
.cal-tile-ico i:nth-child(1){ top:9px; left:9px } .cal-tile-ico i:nth-child(2){ top:9px; right:9px } .cal-tile-ico i:nth-child(3){ bottom:9px; left:9px } .cal-tile-ico i:nth-child(4){ bottom:9px; right:9px }
.cal-chip { display:inline-block; font-size:13px; padding:5px 12px; border-radius:9999px; background:#f1f1f1; color:${C.body}; }
.cal-pill-status { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; padding:3px 10px; border-radius:9999px; }
.cal-seg { display:inline-flex; gap:2px; padding:4px; border-radius:12px; background:#f0f0f0; max-width:100%; overflow-x:auto; }
.cal-seg button { padding:8px 16px; border:0; border-radius:9px; background:none; cursor:pointer; font:inherit; font-size:14px; font-weight:500; color:${C.body}; white-space:nowrap; }
.cal-seg button[aria-selected="true"], .cal-seg button[aria-pressed="true"] { background:#fff; color:${C.ink}; box-shadow:0 1px 3px rgba(0,0,0,.1); }
.cal-term { padding:12px 14px; border-radius:12px; background:#fafafa; border:1px solid #eee; }
.cal-clip { overflow:hidden; position:relative; }
.cal-fade::after { content:''; position:absolute; left:0; right:0; bottom:0; height:60px; background:linear-gradient(transparent, #fff); pointer-events:none; }

/* grids */
.cal-g2 { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
.cal-g3 { display:grid; grid-template-columns:repeat(3,1fr); gap:20px; }
.cal-g4 { display:grid; grid-template-columns:repeat(4,1fr); gap:20px; }
.cal-hero { display:grid; grid-template-columns: 1.05fr 1fr; gap:40px; align-items:center; }
.cal-split { display:grid; grid-template-columns:1.5fr 1fr; }
.cal-split > div:first-child { border-right:1px solid ${C.line}; }

/* reveal + draw */
.cal-reveal { opacity:0; transform:translateY(16px); transition: opacity .6s ease, transform .6s ease; }
.cal-reveal.in { opacity:1; transform:none; }
.cal-draw { stroke-dasharray:1; stroke-dashoffset:1; animation: cal-draw 1.4s ease forwards .3s; }
.cal-draw-2 { animation-delay:1.5s; }
@keyframes cal-draw { to { stroke-dashoffset:0; } }

@media (max-width: 1000px) {
  .cal-links, .cal-hide-sm { display:none; }
  .cal-burger { display:inline-flex; }
  .cal-mobile.open { display:block; }
  .cal-nav-pill { padding:0 14px 0 20px; height:62px; }
  .cal-hero, .cal-g2, .cal-g3, .cal-split { grid-template-columns:1fr; }
  .cal-split > div:first-child { border-right:0; border-bottom:1px solid ${C.line}; }
  .cal-g4 { grid-template-columns:repeat(2,1fr); }
  .cal-sec { padding:64px 0; }
  .cal-sheet { border-left:0; border-right:0; }
  .cal-plus { display:none; }
}
@media (max-width: 560px) { .cal-in { padding:0 16px; } .cal-g4 { grid-template-columns:1fr 1fr; gap:12px; } .cal-btn { width:100%; } }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior:auto; }
  .cal-reveal { opacity:1; transform:none; transition:none; }
  .cal-draw { animation:none; stroke-dashoffset:0; } .cal-hover, .cal-btn { transition:none; }
}
`;

/* ─── Small pieces ──────────────────────────────────────────────────────── */

const Rule: React.FC = () => (
  <div className="cal-rule" aria-hidden="true"><span className="cal-plus l" /><span className="cal-plus r" /></div>
);

const StatusPill: React.FC<{ status: Status; label?: string }> = ({ status, label }) => (
  <span className="cal-pill-status" style={{ color: STATUS_COLOR[status], background: `${STATUS_COLOR[status]}14`, border: `1px solid ${STATUS_COLOR[status]}33` }}>
    {STATUS_ICON[status]} {label ?? status}
  </span>
);

const Pill: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <span className="cal-badge-pill">{icon}{children}</span>
);

const SectionHead: React.FC<{ icon: React.ReactNode; badge: string; title: React.ReactNode; lede?: string; actions?: boolean }> = ({ icon, badge, title, lede, actions }) => (
  <Reveal>
    <div className="cal-center" style={{ maxWidth: 820, margin: '0 auto 56px' }}>
      <Pill icon={icon}>{badge}</Pill>
      <h2 className="cal-h2">{title}</h2>
      {lede && <p className="cal-lede">{lede}</p>}
      {actions && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 26 }}>
          <Link to="/login" className="cal-btn cal-btn-dark cal-btn-sm">Sign in <ChevronRight size={15} className="cal-arrow" /></Link>
          <Link to="/client/register" className="cal-btn cal-btn-white cal-btn-sm">Register as a client <ChevronRight size={15} className="cal-arrow" /></Link>
        </div>
      )}
    </div>
  </Reveal>
);

const Kv: React.FC<{ k: string; v: React.ReactNode; accent?: string }> = ({ k, v, accent }) => (
  <div>
    <div className="cal-label" style={{ marginBottom: 4 }}>{k}</div>
    <div style={{ fontSize: 16, fontWeight: 600, color: accent ?? C.ink }}>{v}</div>
  </div>
);

/* ─── Header ────────────────────────────────────────────────────────────── */

const NAV: [string, string][] = [['Product', '#product'], ['How it works', '#how-it-works'], ['Suitability', '#suitability'], ['Products', '#products'], ['Verdicts', '#verdicts'], ['Audit', '#audit']];

const Header: React.FC = () => {
  const { user, role, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const signedIn = !loading && !!user;
  const home = role === 'rm' ? '/rm' : '/client';
  return (
    <div className="cal-nav">
      <header className="cal-nav-pill">
        <Link to="/" aria-label="Neural Nexus home" style={{ textDecoration: 'none' }}><Wordmark size={19} tone="light" /></Link>
        <nav className="cal-links" aria-label="Sections">
          {NAV.map(([l, h]) => <a key={h} href={h}>{l}</a>)}
        </nav>
        <div className="cal-nav-cta">
          {signedIn ? (
            <Link to={home} className="cal-btn cal-btn-dark cal-btn-sm">Open workspace <ChevronRight size={15} className="cal-arrow" /></Link>
          ) : (
            <>
              <Link to="/login" className="cal-signin cal-hide-sm">Sign in</Link>
              <Link to="/client/register" className="cal-btn cal-btn-dark cal-btn-sm">Get started <ChevronRight size={15} className="cal-arrow" /></Link>
            </>
          )}
          <button type="button" className="cal-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>
      <div className={`cal-mobile${open ? ' open' : ''}`}>
        {NAV.map(([l, h]) => <a key={h} href={h} onClick={() => setOpen(false)}>{l}</a>)}
        {!signedIn && <Link to="/login" style={{ display: 'block', padding: '13px 0', color: C.ink, fontWeight: 600, textDecoration: 'none' }}>Sign in</Link>}
      </div>
    </div>
  );
};

/* ─── Hero mock: a product card like Cal's booking widget ───────────────── */

const HeroMock: React.FC = () => (
  <div className="cal-card" style={{ overflow: 'hidden', marginRight: -48, boxShadow: '0 20px 50px -24px rgba(0,0,0,.18)' }}
    role="group" aria-label="Product preview: ELN on NIFTY 50 with sample data">
    <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.3fr', minWidth: 640 }}>
      <div style={{ padding: 22, borderRight: `1px solid ${C.line}` }}>
        <WordmarkGlyph size={30} tone="light" />
        <div style={{ fontSize: 13, color: C.mute, margin: '12px 0 2px' }}>Equity-Linked Note</div>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em' }}>ELN · NIFTY 50</div>
        <p style={{ fontSize: 13, color: C.body, lineHeight: 1.5, margin: '8px 0 14px' }}>Barrier coupon note. Sample terms, illustrative figures.</p>
        <div className="cal-seg" role="group" aria-label="Tenor">
          {['6m', '12m', '24m'].map((t) => <button key={t} type="button" aria-pressed={t === '12m'} style={{ padding: '6px 12px', fontSize: 13 }}>{t}</button>)}
        </div>
        <div style={{ display: 'grid', gap: 10, marginTop: 16, fontSize: 13.5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: C.body }}><ShieldCheck size={15} /> Barrier 75% · daily close</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: C.body }}><TrendingUp size={15} /> Coupon 10% p.a.</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: C.body }}><Landmark size={15} /> Principal {inr(DEMO.notional)}</div>
        </div>
      </div>
      <div style={{ padding: 22 }}>
        <div className="cal-label" style={{ marginBottom: 6 }}>Payoff at maturity</div>
        <PayoffSVG height={190} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, borderTop: `1px solid ${C.line}`, marginTop: 6 }}>
          <Kv k="Worst case" v={<>{pct(elnReturn(0.4), 0)} <span style={{ fontSize: 11, color: C.mute, fontWeight: 400 }}>at 40%</span></>} accent={C.red} />
          <StatusPill status="REVIEW" label="REVIEW REQUIRED" />
        </div>
      </div>
    </div>
  </div>
);

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
      } catch { /* crypto.subtle unavailable (non-secure context): the chain stays blank */ }
    })();
    return () => { live = false; };
  }, []);
  return (
    <div className="cal-card" style={{ padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em' }}>Hash-chained audit trail</div>
          <div style={{ fontSize: 13, color: C.mute, marginTop: 2 }}>Live SHA-256 in your browser · demo records</div>
        </div>
        <button type="button" onClick={() => setTamper((t) => !t)} aria-pressed={tamper} className="cal-btn cal-btn-white cal-btn-sm"
          style={tamper ? { color: C.red, borderColor: `${C.red}66`, background: `${C.red}0d` } : undefined}>
          {tamper ? 'Restore record A-002' : 'Tamper with record A-002'}
        </button>
      </div>
      <div className="cal-g3">
        {BASE_RECORDS.map((r, i) => {
          const hash = (tamper ? cur[i] : orig[i]) ?? '';
          const broken = tamper && i >= 1;
          const edited = tamper && i === 1;
          const color = broken ? C.red : C.green;
          return (
            <div key={r.id} style={{ padding: 16, borderRadius: 14, background: '#fafafa', border: `1px solid ${broken ? `${C.red}66` : '#eee'}`, transition: 'border-color .3s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.body }}>{r.id}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color }}>{broken ? (edited ? 'EDITED' : 'CHAIN BROKEN') : 'VALID'}</span>
              </div>
              <div className="cal-mono" style={{ fontSize: 11, color: edited ? C.red : C.body, wordBreak: 'break-all', marginBottom: 12, minHeight: 32 }}>{edited ? TAMPERED : r.payload}</div>
              <div style={{ fontSize: 11, color: C.mute, marginBottom: 3 }}>record_hash = sha256({i === 0 ? 'genesis' : `A-00${i}`} + payload)</div>
              <div className="cal-mono" style={{ fontSize: 12, color }}>{hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : '…'}</div>
              {i === 0 && <div className="cal-mono" style={{ fontSize: 10, color: C.mute, marginTop: 6 }}>prev {GENESIS.slice(0, 6)}…</div>}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 13, color: C.mute, margin: '16px 0 0', lineHeight: 1.55 }}>
        Each record’s hash covers the previous record’s hash, so changing one entry invalidates every entry after it. Tamper-evident, not tamper-proof: a prototype-grade control.
      </p>
    </div>
  );
};

/* ─── Page ──────────────────────────────────────────────────────────────── */

const LandingPage: React.FC = () => {
  const [active, setActive] = useState(0);
  const [sample, setSample] = useState(1);
  const prod = PRODUCTS[active];
  const [stepsRef] = useInView<HTMLDivElement>(0.3);

  return (
    <div className="cal-root">
      <style>{CSS}</style>
      <Header />

      <div className="cal-sheet">
        {/* 1 · HERO */}
        <section id="top" style={{ padding: '36px 12px 0' }}>
          <div className="cal-card" style={{ padding: '72px 56px 40px', maxWidth: 1440, margin: '0 auto', overflow: 'hidden' }}>
            <div className="cal-hero">
              <div>
                <a href="#suitability" className="cal-badge-pill">Deterministic suitability, explained <ChevronRight size={14} /></a>
                <h1 className="cal-h1">The better way to approve structured products</h1>
                <p style={{ fontSize: 19, lineHeight: 1.6, color: C.body, margin: '0 0 30px', maxWidth: 560 }}>
                  Configure an ELN, CPN or DCD, replay it on real market history, test it against a client’s profile with fixed rules,
                  and give the relationship manager an explanation they can defend.
                </p>
                <div style={{ display: 'grid', gap: 12, maxWidth: 600 }}>
                  <Link to="/login" className="cal-btn cal-btn-dark cal-btn-wide">Sign in to your workspace</Link>
                  <Link to="/client/register" className="cal-btn cal-btn-soft cal-btn-wide">Register as a client <ChevronRight size={15} className="cal-arrow" /></Link>
                  <span style={{ fontSize: 14, color: C.mute }}>Decision support for wealth teams · not investment advice</span>
                </div>
              </div>
              <HeroMock />
            </div>
            <div className="cal-g3" style={{ marginTop: 56, gap: 28 }}>
              {HERO_STATS.map((s) => (
                <div key={s.label} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <span className="cal-tile-ico" style={{ width: 46, height: 46, borderRadius: 12 }}>{s.icon}</span>
                  <div>
                    <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1 }}>{s.text ?? <CountUp to={s.to} />}</div>
                    <div style={{ fontSize: 13.5, color: C.body, marginTop: 4 }}>{s.label}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div style={{ height: 36 }} />
        <Rule />

        {/* 2 · BUILT ON */}
        <section aria-label="Supported products and underlyings" style={{ padding: '34px 0' }}>
          <div className="cal-in" style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, color: C.body, maxWidth: 180 }}>Products and underlyings supported today</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, flex: 1, justifyContent: 'flex-end' }}>
              {BUILT_ON.map((b) => <span key={b} className="cal-chip" style={{ background: '#fff', border: `1px solid ${C.line}`, color: C.ink, fontWeight: 500 }}>{b}</span>)}
            </div>
          </div>
        </section>
        <Rule />

        {/* 3 · PRODUCT */}
        <section id="product" className="cal-sec">
          <div className="cal-in">
            <SectionHead icon={<Layers size={14} />} badge="The product" title="One decision. Every layer visible."
              lede="From payoff mechanics to suitability verdict, every output traces back to the same simulation and rule set." actions />
            <Reveal>
              <div className="cal-card" style={{ overflow: 'hidden' }} role="group" aria-label="Dashboard preview with sample data">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderBottom: `1px solid ${C.line}`, background: '#fafafa' }}>
                  {[0, 1, 2].map((d) => <span key={d} style={{ width: 10, height: 10, borderRadius: '50%', background: '#e3e3e3' }} />)}
                  <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 600 }}>Assessment · ELN — NIFTY 50 · 12 months</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: C.mute }}>Sample data</span>
                </div>
                <div className="cal-split">
                  <div style={{ padding: 24 }}>
                    <div className="cal-label" style={{ marginBottom: 6 }}>Payoff at maturity</div>
                    <PayoffSVG height={230} animate={false} />
                    <div className="cal-label" style={{ margin: '22px 0 10px' }}>Scenario analysis · principal {inr(DEMO.notional)}</div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 440 }}>
                        <thead>
                          <tr>
                            <th scope="row" style={{ textAlign: 'left', fontWeight: 500, color: C.mute, padding: '8px 0' }}>Index move</th>
                            {SCENARIOS.map((s) => <th key={s} scope="col" style={{ textAlign: 'right', fontWeight: 600, padding: '8px 0' }}>{s === 0 ? '0%' : pct(s, 0)}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          <tr style={{ borderTop: `1px solid ${C.line}` }}>
                            <th scope="row" style={{ textAlign: 'left', fontWeight: 500, color: C.mute, padding: '10px 0' }}>Return</th>
                            {SCENARIOS.map((s) => { const r = elnReturn(1 + s); return <td key={s} style={{ textAlign: 'right', fontWeight: 600, color: r < 0 ? C.red : C.green }}>{pct(r)}</td>; })}
                          </tr>
                          <tr style={{ borderTop: `1px solid ${C.line}` }}>
                            <th scope="row" style={{ textAlign: 'left', fontWeight: 500, color: C.mute, padding: '10px 0' }}>Value</th>
                            {SCENARIOS.map((s) => <td key={s} style={{ textAlign: 'right', color: C.body }}>{inr(Math.round(DEMO.notional * (1 + elnReturn(1 + s))))}</td>)}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p style={{ fontSize: 12, color: C.mute, margin: '12px 0 0' }}>75% barrier, 10% coupon, terminal-level view. A −20% move sits above the barrier; only the −30% case loses principal.</p>
                  </div>
                  <div style={{ padding: 24, background: '#fafafa' }}>
                    <div className="cal-label" style={{ marginBottom: 12 }}>Client profile</div>
                    <dl style={{ margin: 0, display: 'grid', gap: 10, fontSize: 14 }}>
                      {[['Risk appetite', 'Aggressive'], ['Investment horizon', '24 months'], ['Loss tolerance', '25%'], ['Liquid net worth', inr(DEMO.netWorth)], ['Existing exposure', inr(DEMO.existing)]].map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><dt style={{ color: C.mute }}>{k}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd></div>
                      ))}
                    </dl>
                    <div className="cal-label" style={{ margin: '24px 0 12px' }}>Checks</div>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                      {DEMO_CHECKS.map((c) => (
                        <li key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
                          <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: STATUS_COLOR[c.status], background: `${STATUS_COLOR[c.status]}14`, flexShrink: 0 }}>{STATUS_ICON[c.status]}</span>
                          {c.name}
                        </li>
                      ))}
                    </ul>
                    <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
                      <StatusPill status="REVIEW" label="REVIEW REQUIRED" />
                      <p style={{ fontSize: 13.5, color: C.body, lineHeight: 1.55, margin: '12px 0 0' }}>
                        Concentration is {(DEMO_CONC * 100).toFixed(1)}%, above the {DEMO.passLimit * 100}% pass limit (fail above {DEMO.failLimit * 100}%).
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
        <Rule />

        {/* 4 · HOW IT WORKS: three numbered cards */}
        <section id="how-it-works" className="cal-sec">
          <div className="cal-in">
            <SectionHead icon={<Workflow size={14} />} badge="How it works" title="With us, suitability review is straightforward"
              lede="From client profile to an audited recommendation in three steps." actions />
            <div ref={stepsRef} className="cal-g3">
              {[
                { n: '01', title: 'Set up the case', desc: 'Capture the client’s risk appetite, horizon, loss tolerance and net worth, then configure the product inside validated bounds.', icon: <UserCheck size={18} />,
                  body: (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {[['Risk appetite', 'Aggressive'], ['Horizon', '24 months'], ['Barrier / coupon', '75% / 10.0%']].map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '9px 12px', borderRadius: 10, background: '#fafafa', border: '1px solid #eee' }}><span style={{ color: C.mute }}>{k}</span><b>{v}</b></div>
                      ))}
                    </div>
                  ) },
                { n: '02', title: 'Replay real history', desc: 'See the payoff, then replay 20 real past periods and 2,000 bootstrap paths to find the worst case.', icon: <BarChart3 size={18} />,
                  body: (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {[['Worst ever', '2007 – 2008', pct(elnReturn(0.4), 1)], ['Sideways', 'calmest period', pct(elnReturn(1), 1)], ['Most recent', 'latest period', pct(elnReturn(1.1), 1)]].map(([a, b, c]) => (
                        <div key={a} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '9px 12px', borderRadius: 10, background: '#fafafa', border: '1px solid #eee' }}>
                          <span><b>{a}</b> <span style={{ color: C.mute }}>· {b}</span></span><b style={{ color: c.startsWith('−') ? C.red : C.green }}>{c}</b>
                        </div>
                      ))}
                    </div>
                  ) },
                { n: '03', title: 'Get a verdict you can defend', desc: 'Fixed rules return one verdict, a plain-English reason, and a hash-chained audit record.', icon: <FileText size={18} />,
                  body: (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <StatusPill status="REVIEW" label="REVIEW REQUIRED" />
                      <p style={{ fontSize: 13, color: C.body, lineHeight: 1.5, margin: 0 }}>Concentration is above the pass limit for an aggressive client, so the case needs review rather than rejection.</p>
                    </div>
                  ) },
              ].map((s) => (
                <Reveal key={s.n}>
                  <div className="cal-card cal-hover" style={{ padding: 28, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <span className="cal-num cal-mono">{s.n}</span>
                    <h3 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em', margin: '18px 0 8px' }}>{s.title}</h3>
                    <p style={{ fontSize: 15.5, color: C.body, lineHeight: 1.55, margin: '0 0 22px' }}>{s.desc}</p>
                    <div style={{ marginTop: 'auto' }}>{s.body}</div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
        <Rule />

        {/* 5 · SUITABILITY + SIMULATION: feature cards */}
        <section id="suitability" className="cal-sec">
          <div className="cal-in">
            <SectionHead icon={<ShieldCheck size={14} />} badge="Your all-purpose suitability workbench" title="Fixed rules. One deterministic verdict."
              lede="Rules are versioned and compare the product’s worst historical outcome with the client’s limits. The language model explains the result; it never decides it." />
            <div className="cal-g2">
              <Reveal>
                <div className="cal-card" style={{ padding: 28, height: '100%' }}>
                  <h3 style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.03em', margin: '0 0 6px' }}>Nine checks, one outcome</h3>
                  <p style={{ fontSize: 15.5, color: C.body, lineHeight: 1.55, margin: '0 0 20px' }}>Any fail means not suitable, any review means a conversation first, otherwise suitable.</p>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {CHECKS.map(([t, d]) => (
                      <details key={t} style={{ border: '1px solid #eee', borderRadius: 12, padding: '12px 14px', background: '#fafafa' }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14.5, listStyle: 'none', display: 'flex', justifyContent: 'space-between' }}>{t}<ChevronRight size={16} color={C.mute} /></summary>
                        <p style={{ fontSize: 13.5, color: C.body, lineHeight: 1.55, margin: '8px 0 0' }}>{d}</p>
                      </details>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 20, fontSize: 12.5, fontWeight: 600 }}>
                    <span style={{ color: C.green }}>● SUITABLE</span><span style={{ color: C.amber }}>● REVIEW REQUIRED</span><span style={{ color: C.red }}>● NOT SUITABLE</span>
                  </div>
                </div>
              </Reveal>
              <Reveal delay={60}>
                <div className="cal-card" style={{ padding: 28, height: '100%' }}>
                  <h3 style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.03em', margin: '0 0 6px' }}>Don’t predict one outcome. Stress thousands.</h3>
                  <p style={{ fontSize: 15.5, color: C.body, lineHeight: 1.55, margin: '0 0 18px' }}>A block bootstrap resamples real daily returns in blocks of 10 days, preserving short-term clustering.</p>
                  <div className="cal-clip" style={{ border: '1px solid #eee', borderRadius: 14, padding: 14, background: '#fafafa' }}>
                    <div className="cal-label" style={{ marginBottom: 4 }}>Index level over 12 months · 2,000 paths · 5th–95th</div>
                    <FanSVG height={250} />
                  </div>
                  <p style={{ fontSize: 12.5, color: C.mute, margin: '14px 0 0', lineHeight: 1.55 }}>
                    <b style={{ color: C.amber }}>Statistical model, not a forecast.</b> The fan shape is illustrative; the product computes it from the selected underlying’s own history.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>
        <Rule />

        {/* 6 · PRODUCTS */}
        <section id="products" className="cal-sec">
          <div className="cal-in">
            <SectionHead icon={<Boxes size={14} />} badge="Products" title="Three structured product classes"
              lede="Defaults and bounds are the configuration the engine validates every input against." />
            <div className="cal-center" style={{ marginBottom: 24 }}>
              <div className="cal-seg" role="tablist" aria-label="Product detail">
                {PRODUCTS.map((p, i) => (
                  <button key={p.type} role="tab" id={`tab-${p.type}`} aria-selected={active === i} aria-controls="product-panel" onClick={() => setActive(i)}>
                    {p.type} · {p.name}
                  </button>
                ))}
              </div>
            </div>
            <div id="product-panel" role="tabpanel" aria-labelledby={`tab-${prod.type}`} className="cal-g2">
              <div className="cal-card" style={{ padding: 30 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <span className="cal-num cal-mono" style={{ width: 'auto', padding: '0 14px', fontWeight: 700, color: C.ink }}>{prod.type}</span>
                  <span className="cal-pill-status" style={{ color: prod.riskColor, background: `${prod.riskColor}14` }}>{prod.risk} profile</span>
                </div>
                <h3 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.04em', margin: '16px 0 4px' }}>{prod.name}</h3>
                <p style={{ fontSize: 14, color: C.mute, margin: '0 0 18px' }}>{prod.subtitle}</p>
                <div style={{ padding: '14px 16px', borderRadius: 12, background: '#fafafa', border: '1px solid #eee', fontSize: 15, lineHeight: 1.6 }}>
                  <span className="cal-label" style={{ display: 'block', marginBottom: 4 }}>Payoff mechanics</span>{prod.mechanic}
                </div>
              </div>
              <div className="cal-card" style={{ padding: 30, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                  {prod.metrics.map(([k, v]) => (
                    <div key={k} className="cal-term"><div className="cal-label" style={{ marginBottom: 5 }}>{k}</div><div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{v}</div></div>
                  ))}
                </div>
                <div className="cal-label" style={{ margin: '22px 0 8px' }}>Ideal client fit</div>
                <p style={{ fontSize: 15, color: C.body, lineHeight: 1.6, margin: 0 }}>{prod.fit}</p>
                <div style={{ marginTop: 'auto', paddingTop: 24, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Link to="/rm" className="cal-btn cal-btn-dark cal-btn-sm">Structure {prod.type} <ChevronRight size={15} className="cal-arrow" /></Link>
                  <Link to="/client" className="cal-btn cal-btn-white cal-btn-sm">Run suitability</Link>
                </div>
              </div>
            </div>
          </div>
        </section>
        <Rule />

        {/* 7 · …and so much more */}
        <section className="cal-sec">
          <div className="cal-in">
            <Reveal><h2 className="cal-h2 cal-center" style={{ marginBottom: 44 }}>…and so much more!</h2></Reveal>
            <div className="cal-g4" style={{ maxWidth: 1000, margin: '0 auto' }}>
              {TILES.map((t, i) => (
                <Reveal key={t.label} delay={i * 30}>
                  <div className="cal-tile">
                    <span className="cal-tile-ico"><i /><i /><i /><i />{t.icon}</span>
                    <span style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.3 }}>{t.label}</span>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
        <Rule />

        {/* 8 · VERDICTS, EXPLAINED (carousel) */}
        <section id="verdicts" className="cal-sec" style={{ overflow: 'hidden' }}>
          <div className="cal-in">
            <SectionHead icon={<Users size={14} />} badge="Explainability" title="Every verdict has a reason"
              lede="Explanations are written from validated facts the rule engine already produced. They cannot change the outcome. Sample cases below use illustrative figures." />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(320px, 600px) 1fr', gap: 24, alignItems: 'stretch', padding: '0 16px' }}>
            {[-1, 0, 1].map((off) => {
              const s = SAMPLES[(sample + off + SAMPLES.length) % SAMPLES.length];
              const center = off === 0;
              return (
                <div key={off} className="cal-card" style={{ padding: 30, opacity: center ? 1 : 0.4, minHeight: 300, display: 'flex', flexDirection: 'column', boxShadow: center ? '0 18px 40px -22px rgba(0,0,0,.2)' : undefined }} aria-hidden={!center}>
                  <StatusPill status={s.status} label={s.label} />
                  <p style={{ fontSize: center ? 21 : 18, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.35, margin: '18px 0 0' }}>{s.quote}</p>
                  <div style={{ marginTop: 'auto', paddingTop: 22, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <WordmarkGlyph size={36} tone="light" />
                    <div><div style={{ fontSize: 14, fontWeight: 600 }}>{s.who}</div><div style={{ fontSize: 13, color: C.mute }}>{s.meta}</div></div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 28 }}>
            <button type="button" className="cal-btn cal-btn-white cal-btn-sm" aria-label="Previous example" onClick={() => setSample((s) => (s + SAMPLES.length - 1) % SAMPLES.length)}><ChevronLeft size={16} /></button>
            <button type="button" className="cal-btn cal-btn-white cal-btn-sm" aria-label="Next example" onClick={() => setSample((s) => (s + 1) % SAMPLES.length)}><ChevronRight size={16} /></button>
          </div>
        </section>
        <Rule />

        {/* 9 · ARCHITECTURE + TRUST */}
        <section className="cal-sec">
          <div className="cal-in">
            <SectionHead icon={<Cpu size={14} />} badge="Architecture" title={<>Deterministic at the core.<br />Intelligent at the edge.</>}
              lede="Numbers come from the quantitative engine, decisions from the rule engine. AI only narrates, and the audit system records everything." />
            <div className="cal-g4" role="list" aria-label="System architecture, in processing order">
              {ARCH.map((g, gi) => (
                <Reveal key={g.group} delay={gi * 40}>
                  <div role="listitem" className="cal-card" style={{ padding: 22, height: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <span className="cal-tile-ico" style={{ width: 44, height: 44, borderRadius: 12 }}>{g.icon}</span>
                      <span className="cal-num cal-mono" style={{ width: 34, height: 28, fontSize: 12 }}>0{gi + 1}</span>
                    </div>
                    <span className="cal-chip">{g.tag}</span>
                    <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.03em', margin: '10px 0 14px' }}>{g.group}</div>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                      {g.nodes.map((n) => <li key={n} style={{ fontSize: 13.5, padding: '8px 10px', borderRadius: 8, background: '#fafafa', border: '1px solid #eee' }}>{n}</li>)}
                    </ul>
                  </div>
                </Reveal>
              ))}
            </div>
            <div className="cal-g4" role="list" aria-label="Trust principles" style={{ marginTop: 20 }}>
              {TRUST.map((t) => (
                <div role="listitem" key={t.head} className="cal-card" style={{ padding: 22 }}>
                  <span className="cal-tile-ico" style={{ width: 40, height: 40, borderRadius: 11, marginBottom: 14 }}>{t.icon}</span>
                  <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.03em' }}>{t.head}</div>
                  <div style={{ fontSize: 14, color: C.body, lineHeight: 1.55, marginTop: 6 }}>{t.body}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <Rule />

        {/* 10 · AUDIT */}
        <section id="audit" className="cal-sec">
          <div className="cal-in">
            <SectionHead icon={<Fingerprint size={14} />} badge="Auditability" title="Built to be explained and audited"
              lede="Every assessment, with its decision payload, is appended to a SHA-256 hash chain. Try breaking it." />
            <Reveal><AuditChain /></Reveal>
          </div>
        </section>
        <Rule />

        {/* 11 · FINAL CTA */}
        <section style={{ padding: '56px 12px' }}>
          <div className="cal-card cal-center" style={{ padding: '72px 24px', maxWidth: 1440, margin: '0 auto' }}>
            <Reveal>
              <h2 className="cal-h2" style={{ marginTop: 0 }}>Make suitability measurable.</h2>
              <p className="cal-lede" style={{ marginBottom: 30 }}>Simulate the product. Validate the client. Explain every decision.</p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 30 }}>
                <Link to="/login" className="cal-btn cal-btn-dark">Sign in <ChevronRight size={15} className="cal-arrow" /></Link>
                <Link to="/rm/register" className="cal-btn cal-btn-white">Register as an RM <ChevronRight size={15} className="cal-arrow" /></Link>
              </div>
              <p style={{ fontSize: 13.5, color: C.mute, lineHeight: 1.7, margin: 0 }}>
                Decision support only, not investment advice. Historical simulations do not predict future performance.<br />
                Final suitability must be confirmed by a qualified person.
              </p>
            </Reveal>
          </div>
        </section>
        <Rule />

        {/* FOOTER */}
        <footer style={{ padding: '34px 0' }}>
          <div className="cal-in" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Wordmark size={16} tone="light" />
              <span style={{ fontSize: 13, color: C.mute }}>© 2026 · Pricing indicative, suitability rules illustrative pending compliance review</span>
            </div>
            <nav aria-label="Footer" style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
              {[['Sign in', '/login'], ['RM workspace', '/rm'], ['Client portal', '/client'], ['Client KYC', '/client/register'], ['RM onboarding', '/rm/register']].map(([l, to]) => (
                <Link key={to} to={to} style={{ fontSize: 13.5, color: C.body, textDecoration: 'none' }}>{l}</Link>
              ))}
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default LandingPage;
