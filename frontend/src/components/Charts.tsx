import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import type {
  MetricsBundle,
  PayoffPoint,
  HistogramBin,
  MonteCarloResult,
  ScenarioRow,
  HistoricalScenario,
} from '../types';
import { StatBox } from './UIKit';

// ── PayoffChart ────────────────────────────────────────────────────────────

interface PayoffChartProps {
  curve: PayoffPoint[];
  breakEven?: number | null;
  barrierX?: number | null;
  fdBaseline?: number;
  height?: number;
}

export const PayoffChart: React.FC<PayoffChartProps> = ({
  curve,
  breakEven,
  barrierX,
  fdBaseline,
  height = 280,
}) => {
  const data = curve.map((p) => ({
    x: p.x,
    net_return: +(p.net_return * 100).toFixed(2),
    final: +p.final.toFixed(2),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 22, right: 24, left: 0, bottom: 16 }}>
        <defs>
          <linearGradient id="payoffGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="x"
          tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          stroke="var(--stone)"
          tick={{ fontSize: 11 }}
          label={{ value: 'Underlying Level', position: 'insideBottom', offset: -12, fontSize: 11, fill: 'var(--stone)' }}
        />
        <YAxis
          tickFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
          stroke="var(--stone)"
          tick={{ fontSize: 11 }}
          width={52}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--surface-elevated)',
            border: '1px solid var(--hairline-dark)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--on-dark)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: '10px 14px',
          }}
          formatter={(val: any, name: any) => [
            name === 'net_return' ? `${Number(val) > 0 ? '+' : ''}${Number(val).toFixed(2)}%` : val,
            name === 'net_return' ? 'Net Return' : 'Final Value',
          ]}
          labelFormatter={(l: any) => `Underlying: ${(Number(l ?? 0) * 100).toFixed(1)}%`}
        />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
        {breakEven != null && (
          <ReferenceLine
            x={breakEven}
            stroke="var(--accent-teal)"
            strokeDasharray="5 3"
            label={{ value: 'Break-even', fontSize: 10, fill: 'var(--accent-teal)', position: 'top' }}
          />
        )}
        {barrierX != null && (
          <ReferenceLine
            x={barrierX}
            stroke="var(--accent-danger)"
            strokeDasharray="5 3"
            label={{ value: 'Barrier', fontSize: 10, fill: 'var(--accent-danger)', position: 'top' }}
          />
        )}
        {fdBaseline != null && (
          <ReferenceLine
            y={fdBaseline * 100}
            stroke="var(--accent-warning)"
            strokeDasharray="5 3"
            label={{ value: 'FD', fontSize: 10, fill: 'var(--accent-warning)', position: 'insideTopRight' }}
          />
        )}
        <Area
          type="monotone"
          dataKey="net_return"
          stroke="#4f55f1"
          strokeWidth={2}
          fill="url(#payoffGrad)"
          dot={false}
          activeDot={{ r: 4, fill: '#4f55f1' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

// ── HistogramChart ─────────────────────────────────────────────────────────

interface HistogramChartProps {
  bins: HistogramBin[];
  height?: number;
  title?: string;
}

export const HistogramChart: React.FC<HistogramChartProps> = ({
  bins,
  height = 220,
  title,
}) => {
  const data = bins.map((b) => ({
    label: `${(b.bin_start * 100).toFixed(0)}%`,
    freq: +(b.frequency * 100).toFixed(2),
    isLoss: b.bin_end <= 0,
  }));

  return (
    <div>
      {title && <div className="stat-label" style={{ marginBottom: 8 }}>{title}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--stone)" />
          <YAxis
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 10 }}
            stroke="var(--stone)"
            width={36}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--surface-elevated)',
              border: '1px solid var(--hairline-dark)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--on-dark)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              padding: '10px 14px',
            }}
            formatter={(v: any) => [`${Number(v ?? 0).toFixed(2)}%`, 'Frequency']}
          />
          <Bar dataKey="freq" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.isLoss ? 'rgba(226,59,74,0.75)' : 'rgba(79,85,241,0.75)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

// ── MCFanChart ─────────────────────────────────────────────────────────────

interface MCFanChartProps {
  mc: MonteCarloResult;
  height?: number;
}

export const MCFanChart: React.FC<MCFanChartProps> = ({ mc, height = 240 }) => {
  const data = mc.fan_x_points.map((t, i) => {
    const row: Record<string, number> = { t: +(t * 100).toFixed(1) };
    mc.fan_percentiles.forEach((p, pi) => {
      row[`p${p}`] = +(mc.fan_paths[pi][i] * 100).toFixed(2);
    });
    return row;
  });

  const colors = ['#e23b4a', '#ec7e00', '#4f55f1', '#00a87e', '#a855f7'];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="t"
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 10 }}
          stroke="var(--stone)"
          label={{ value: 'Time (% of tenor)', position: 'insideBottom', offset: -12, fontSize: 11, fill: 'var(--stone)' }}
        />
        <YAxis
          tickFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
          tick={{ fontSize: 10 }}
          stroke="var(--stone)"
          width={48}
        />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
        <Tooltip
          contentStyle={{
            background: 'var(--surface-elevated)',
            border: '1px solid var(--hairline-dark)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--on-dark)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: '10px 14px',
          }}
          formatter={(v: any, name: any) => [`${Number(v ?? 0) > 0 ? '+' : ''}${Number(v ?? 0).toFixed(2)}%`, `P${String(name ?? '').slice(1)}`]}
        />
        {mc.fan_percentiles.map((p, pi) => (
          <Line
            key={p}
            type="monotone"
            dataKey={`p${p}`}
            stroke={colors[pi % colors.length]}
            strokeWidth={p === 50 ? 2.5 : 1.5}
            dot={false}
            strokeDasharray={p === 50 ? undefined : '4 2'}
            name={`p${p}`}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

// ── PriceChart ─────────────────────────────────────────────────────────────

interface PriceChartProps {
  series: { date: string; close: number }[];
  height?: number;
  color?: string;
}

export const PriceChart: React.FC<PriceChartProps> = ({
  series,
  height = 200,
  color = '#4f55f1',
}) => {
  // Downsample for performance if needed
  const data = useMemo(() => {
    if (series.length <= 300) return series;
    const step = Math.ceil(series.length / 300);
    return series.filter((_, i) => i % step === 0);
  }, [series]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10 }}
          stroke="var(--stone)"
          tickFormatter={(d) => d.slice(0, 7)}
          interval="preserveStartEnd"
        />
        <YAxis tick={{ fontSize: 10 }} stroke="var(--stone)" width={56} />
        <Tooltip
          contentStyle={{
            background: 'var(--surface-elevated)',
            border: '1px solid var(--hairline-dark)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--on-dark)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: '10px 14px',
          }}
          formatter={(v: any) => [Number(v ?? 0).toFixed(2), 'Close']}
        />
        <Area
          type="monotone"
          dataKey="close"
          stroke={color}
          strokeWidth={1.5}
          fill="url(#priceGrad)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

// ── MetricsSummary ─────────────────────────────────────────────────────────

interface MetricsSummaryProps {
  metrics: MetricsBundle;
}

export const MetricsSummary: React.FC<MetricsSummaryProps> = ({ metrics }) => {
  const replay = metrics.replay;
  const mc = metrics.monte_carlo;
  const statsSource = mc ?? replay;

  return (
    <div className="stat-grid">
      <StatBox
        label="Max Gain"
        value={`+${(metrics.max_gain_pct * 100).toFixed(1)}%`}
        color="positive"
        subtext="Total return"
      />
      <StatBox
        label="Max Loss"
        value={`${(metrics.max_loss_pct * 100).toFixed(1)}%`}
        color="negative"
        subtext="Total return"
      />
      <StatBox
        label="Stress Loss"
        value={`${(metrics.stress_loss_pct * 100).toFixed(1)}%`}
        color="negative"
        subtext="Configured stress shock"
      />
      {statsSource && (
        <>
          <StatBox
            label="P(Loss)"
            value={`${(statsSource.p_loss * 100).toFixed(1)}%`}
            color={statsSource.p_loss > 0.3 ? 'negative' : statsSource.p_loss > 0.15 ? 'neutral' : 'positive'}
            subtext={mc ? 'Monte Carlo' : 'Historical replay'}
          />
          <StatBox
            label="CVaR 5%"
            value={`${(statsSource.cvar5_loss_pct * 100).toFixed(1)}%`}
            color="negative"
            subtext="Tail loss"
          />
          <StatBox
            label="Median Ann. Return"
            value={`${statsSource.median_annualised_return > 0 ? '+' : ''}${(statsSource.median_annualised_return * 100).toFixed(1)}%`}
            color={statsSource.median_annualised_return >= 0 ? 'positive' : 'negative'}
            subtext="p.a."
          />
        </>
      )}
      <StatBox
        label="FD Baseline"
        value={`+${(metrics.fd_baseline.annualised_return * 100).toFixed(1)}%`}
        subtext={`${(metrics.fd_baseline.rate_pa * 100).toFixed(1)}% p.a.`}
      />
      <StatBox
        label="Volatility (EWMA)"
        value={`${(metrics.volatility.ewma * 100).toFixed(1)}%`}
        subtext="Annualised"
      />
    </div>
  );
};

// ── ScenarioTable ──────────────────────────────────────────────────────────

interface ScenarioTableProps {
  rows: ScenarioRow[];
  principal: number;
}

export const ScenarioTable: React.FC<ScenarioTableProps> = ({ rows, principal }) => (
  <div style={{ overflowX: 'auto' }}>
    <table className="data-table" aria-label="Scenario analysis table">
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Underlying Δ</th>
          <th>Level</th>
          <th>Final Value</th>
          <th>Net Return</th>
          <th>Ann. Return</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const isPositive = row.net_return >= 0;
          return (
            <tr key={i} style={row.is_ps_scenario ? { background: 'rgba(73,79,223,0.06)' } : {}}>
              <td style={{ fontWeight: row.is_ps_scenario ? 600 : 400 }}>
                {row.label}
                {row.is_ps_scenario && (
                  <span className="product-pill ELN" style={{ marginLeft: 6, fontSize: 10 }}>PS</span>
                )}
              </td>
              <td className={row.shock >= 0 ? 'text-green' : 'text-red'}>
                {row.shock > 0 ? '+' : ''}{(row.shock * 100).toFixed(0)}%
              </td>
              <td>{(row.x * 100).toFixed(1)}%</td>
              <td className="mono">{principal > 0 ? row.final.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}</td>
              <td className={isPositive ? 'text-green' : 'text-red'}>
                {isPositive ? '+' : ''}{(row.net_return * 100).toFixed(2)}%
              </td>
              <td className={row.annualised_return >= 0 ? 'text-green' : 'text-red'}>
                {row.annualised_return >= 0 ? '+' : ''}{(row.annualised_return * 100).toFixed(2)}%
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

// ── HistoricalScenarioTable ───────────────────────────────────────────────
// Real historical replay (module2_simulation_engine): 20 real past market periods,
// dated and narrated, as opposed to the synthetic shocks in ScenarioTable above.

interface HistoricalScenarioTableProps {
  scenarios: HistoricalScenario[];
  currency: string;
}

export const HistoricalScenarioTable: React.FC<HistoricalScenarioTableProps> = ({
  scenarios,
  currency,
}) => {
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const fmtMoney = (v: number) =>
    `${currency} ${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" aria-label="Historical scenario replay table">
        <thead>
          <tr>
            <th>Situation</th>
            <th>Period</th>
            <th>Market Move</th>
            <th>Barrier Hit</th>
            <th>Money Back</th>
            <th>Return</th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((s) => {
            const isPositive = s.return_pct >= 0;
            const isOpen = expanded === s.id;
            return (
              <React.Fragment key={s.id}>
                <tr
                  onClick={() => setExpanded(isOpen ? null : s.id)}
                  style={{ cursor: 'pointer' }}
                  title="Click for the full story"
                >
                  <td style={{ fontWeight: 500 }}>{s.situation}</td>
                  <td className="mono">{s.period.start} → {s.period.end}</td>
                  <td className={s.market_move_pct >= 0 ? 'text-green' : 'text-red'}>
                    {s.market_move_pct > 0 ? '+' : ''}{s.market_move_pct.toFixed(2)}%
                  </td>
                  <td>
                    {s.barrier_hit ? (
                      <span className="product-pill DCD" style={{ fontSize: 10 }}>HIT</span>
                    ) : (
                      <span style={{ opacity: 0.5 }}>—</span>
                    )}
                  </td>
                  <td className="mono">{fmtMoney(s.money_back)}</td>
                  <td className={isPositive ? 'text-green' : 'text-red'}>
                    {isPositive ? '+' : ''}{s.return_pct.toFixed(2)}%
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={6} style={{ opacity: 0.85, fontSize: 13, padding: '8px 12px' }}>
                      {s.story}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
