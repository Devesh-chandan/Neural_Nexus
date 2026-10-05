import React, { useEffect, useRef, useState } from 'react';

/* ─── Motion primitives ─────────────────────────────────────────────────── */

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useInView<T extends HTMLElement>(threshold = 0.2): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen];
}

export const Reveal: React.FC<{ children: React.ReactNode; delay?: number; style?: React.CSSProperties }> = ({
  children,
  delay = 0,
  style,
}) => {
  const [ref, seen] = useInView<HTMLDivElement>(0.12);
  return (
    <div ref={ref} className={`cal-reveal${seen ? ' in' : ''}`} style={{ transitionDelay: `${delay}ms`, ...style }}>
      {children}
    </div>
  );
};

export const CountUp: React.FC<{ to: number; decimals?: number; prefix?: string; suffix?: string; duration?: number }> = ({
  to,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 1000,
}) => {
  const [ref, seen] = useInView<HTMLSpanElement>(0.4);
  const [val, setVal] = useState(prefersReducedMotion() ? to : 0);
  useEffect(() => {
    if (!seen) return;
    if (prefersReducedMotion()) {
      setVal(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setVal(Math.max(0, to * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, to, duration]);
  return (
    <span ref={ref}>
      {prefix}
      {val.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
};

/* ─── ELN payoff maths (mirrors backend/app/simulation/sim_engine/payoffs.py, maturity monitoring) ── */

export const ELN_DEMO = { barrier: 0.75, couponPa: 0.1, tenorYears: 1 };

/** Total return on principal for terminal level x = S_T / S_0. */
export const elnReturn = (x: number): number => {
  const coupon = ELN_DEMO.couponPa * ELN_DEMO.tenorYears;
  return (x < ELN_DEMO.barrier ? x : 1) - 1 + coupon;
};

export const pct = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)}%`;

/* ─── Payoff curve ──────────────────────────────────────────────────────── */

const X_MIN = 0.4;
const X_MAX = 1.6;
const Y_MIN = -0.55;
const Y_MAX = 0.2;

export const PayoffSVG: React.FC<{ height?: number; animate?: boolean; showStress?: boolean }> = ({
  height = 200,
  animate = true,
  showStress = true,
}) => {
  const W = 420;
  const H = 220;
  const pad = { l: 40, r: 12, t: 14, b: 26 };
  const sx = (x: number) => pad.l + ((x - X_MIN) / (X_MAX - X_MIN)) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + ((Y_MAX - y) / (Y_MAX - Y_MIN)) * (H - pad.t - pad.b);
  const b = ELN_DEMO.barrier;
  const lower = `M ${sx(X_MIN)} ${sy(elnReturn(X_MIN))} L ${sx(b - 0.0001)} ${sy(elnReturn(b - 0.0001))}`;
  const upper = `M ${sx(b)} ${sy(elnReturn(b))} L ${sx(X_MAX)} ${sy(elnReturn(X_MAX))}`;
  const jump = `M ${sx(b)} ${sy(elnReturn(b - 0.0001))} L ${sx(b)} ${sy(elnReturn(b))}`;
  const yTicks = [0.1, 0, -0.2, -0.4];
  const xTicks = [0.5, 0.75, 1, 1.25, 1.5];
  const stressX = 0.7;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img"
      aria-label="ELN payoff at maturity: flat 10 percent return above the 75 percent barrier, losses below it"
      style={{ display: 'block' }}>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke={t === 0 ? '#9ca3af' : '#eef0f3'} />
          <text x={pad.l - 6} y={sy(t) + 3.5} textAnchor="end" fontSize="10" fill="#6b7280">{t === 0 ? '0%' : pct(t, 0)}</text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={t} x={sx(t)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b7280">{Math.round(t * 100)}%</text>
      ))}
      {/* loss region */}
      <rect x={sx(X_MIN)} y={sy(0)} width={sx(X_MAX) - sx(X_MIN)} height={sy(Y_MIN) - sy(0)} fill="rgba(226,59,74,0.05)" />
      {/* barrier */}
      <line x1={sx(b)} x2={sx(b)} y1={pad.t} y2={H - pad.b} stroke="#ec7e00" strokeDasharray="4 4" strokeOpacity="0.8" />
      <text x={sx(b) - 5} y={pad.t + 9} textAnchor="end" fontSize="10" fill="#ec7e00">Barrier 75%</text>
      {/* spot */}
      <line x1={sx(1)} x2={sx(1)} y1={pad.t} y2={H - pad.b} stroke="#9ca3af" strokeDasharray="2 4" />
      <text x={sx(1) + 5} y={pad.t + 9} fontSize="10" fill="#6b7280">Spot 100%</text>

      <path d={lower} className={animate ? 'cal-draw' : undefined} pathLength={1} fill="none" stroke="#e23b4a" strokeWidth="2.25" strokeLinecap="round" />
      <path d={jump} fill="none" stroke="#9ca3af" strokeDasharray="3 3" />
      <path d={upper} className={animate ? 'cal-draw cal-draw-2' : undefined} pathLength={1} fill="none" stroke="#00a87e" strokeWidth="2.25" strokeLinecap="round" />

      {showStress && (
        <g>
          <circle cx={sx(stressX)} cy={sy(elnReturn(stressX))} r="4.5" fill="#fff" stroke="#111827" strokeWidth="1.5" />
          <text x={sx(stressX) + 9} y={sy(elnReturn(stressX)) + 4} fontSize="10" fill="#111827">−30% stress → {pct(elnReturn(stressX))}</text>
        </g>
      )}
    </svg>
  );
};

/* ─── Monte Carlo fan (illustrative shape) ──────────────────────────────── */

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const gauss = (rnd: () => number) => {
  const u = Math.max(rnd(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};

export const FanSVG: React.FC<{ height?: number }> = ({ height = 280 }) => {
  const W = 640;
  const H = 280;
  const pad = { l: 44, r: 14, t: 12, b: 26 };
  const N = 24;
  const SIGMA = 0.16;
  const MU = 0.04;
  const lo = 0.55;
  const hi = 1.9;
  const sx = (t: number) => pad.l + t * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const q = (z: number, t: number) => Math.exp((MU - 0.5 * SIGMA * SIGMA) * t + z * SIGMA * Math.sqrt(t));
  const ts = Array.from({ length: N + 1 }, (_, i) => i / N);
  const band = (zl: number, zh: number) =>
    ts.map((t, i) => `${i ? 'L' : 'M'} ${sx(t)} ${sy(q(zh, t))}`).join(' ') + ' ' +
    [...ts].reverse().map((t) => `L ${sx(t)} ${sy(q(zl, t))}`).join(' ') + ' Z';
  const line = (z: number) => ts.map((t, i) => `${i ? 'L' : 'M'} ${sx(t)} ${sy(q(z, t))}`).join(' ');

  const rnd = mulberry32(42);
  const paths = Array.from({ length: 28 }, () => {
    let v = 1;
    return ts
      .map((t, i) => {
        if (i) v *= Math.exp((MU - 0.5 * SIGMA * SIGMA) / N + (SIGMA / Math.sqrt(N)) * gauss(rnd));
        return `${i ? 'L' : 'M'} ${sx(t)} ${sy(v)}`;
      })
      .join(' ');
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img"
      aria-label="Illustrative Monte Carlo fan chart with 5th to 95th percentile bands" style={{ display: 'block' }}>
      {[0.6, 0.8, 1, 1.25, 1.5, 1.8].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} stroke={v === 1 ? '#9ca3af' : '#eef0f3'} />
          <text x={pad.l - 6} y={sy(v) + 3.5} textAnchor="end" fontSize="10" fill="#6b7280">{Math.round(v * 100)}%</text>
        </g>
      ))}
      {[0, 3, 6, 9, 12].map((m) => (
        <text key={m} x={sx(m / 12)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b7280">{m}M</text>
      ))}
      <path d={band(-1.645, 1.645)} fill="rgba(79,70,229,0.10)" />
      <path d={band(-0.674, 0.674)} fill="rgba(79,70,229,0.20)" />
      {paths.map((d, i) => (<path key={i} d={d} fill="none" stroke="rgba(17,24,39,0.14)" strokeWidth="0.8" />))}
      <path d={line(0)} fill="none" stroke="#4f46e5" strokeWidth="2" />
      <line x1={pad.l} x2={W - pad.r} y1={sy(0.75)} y2={sy(0.75)} stroke="#ec7e00" strokeDasharray="4 4" strokeOpacity="0.8" />
      <text x={W - pad.r - 4} y={sy(0.75) - 5} textAnchor="end" fontSize="10" fill="#ec7e00">Barrier 75%</text>
      <text x={sx(1) - 6} y={sy(q(1.645, 1)) - 6} textAnchor="end" fontSize="10" fill="#6b7280">95th</text>
      <text x={sx(1) - 6} y={sy(q(0, 1)) - 6} textAnchor="end" fontSize="10" fill="#4f46e5">Median</text>
      <text x={sx(1) - 6} y={sy(q(-1.645, 1)) + 14} textAnchor="end" fontSize="10" fill="#6b7280">5th</text>
    </svg>
  );
};

/* ─── Real SHA-256 chain demo ───────────────────────────────────────────── */

const sha256 = async (text: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const GENESIS = '0'.repeat(64);

export interface ChainRecord {
  id: string;
  payload: string;
}

/** record_hash = sha256(prev_hash + sha256(payload)), the same construction as backend/app/store/audit.py. */
export async function buildChain(records: ChainRecord[]): Promise<{ payloadHash: string; recordHash: string }[]> {
  const out: { payloadHash: string; recordHash: string }[] = [];
  let prev = GENESIS;
  for (const r of records) {
    const payloadHash = await sha256(r.payload);
    const recordHash = await sha256(prev + payloadHash);
    out.push({ payloadHash, recordHash });
    prev = recordHash;
  }
  return out;
}
