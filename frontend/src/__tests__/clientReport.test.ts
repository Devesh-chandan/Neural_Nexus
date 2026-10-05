import { describe, expect, it } from 'vitest';
import { buildClientReportHtml } from '../components/clientReport';

const scenario = (money_back: number, i: number) => ({
  id: i, situation: 's', period: { start: `20${10 + i}-01-01`, end: `20${11 + i}-01-01` },
  market_move_pct: -10, barrier_hit: false, money_back, return_pct: (money_back / 1_000_000 - 1) * 100, story: '',
});

const result: any = {
  assessment: {
    overall_status: 'REVIEW_REQUIRED',
    checks: {
      risk_appetite: { status: 'REVIEW', client_limit_category: 'MODERATE', product_value_category: 'AGGRESSIVE' },
      investment_horizon: { status: 'PASS', client_limit_years: 3, product_value_years: 1 },
      loss_tolerance: { status: 'FAIL', client_limit_pct: 0.2 },
      concentration_risk: { status: 'PASS', client_limit_pct: 0.1, product_value_pct: 0.05 },
    },
    compliance_flags: {},
  },
  simulation: {
    currency: 'INR',
    audit: { product: { product_type: 'ELN', tenor: 12, coupon_pa: 0.1, barrier_pct: 0.75, notional: 1_000_000, underlying: 'NIFTY50' }, underlying: { name: 'Nifty 50' } },
    scenarios: [600_000, 900_000, 1_100_000, 1_100_000].map(scenario),
  },
  explanation: null,
};

describe('client report', () => {
  it('states the worst past loss and the verdict in plain language', () => {
    const html = buildClientReportHtml(result, { clientName: 'Asha Rao' });
    expect(html).toContain('Asha Rao');
    expect(html).toContain('a few points need a conversation');
    expect(html).toContain('40%'); // worst past period lost 40%
  });

  it('escapes user-controlled text (no HTML injection into the report)', () => {
    const html = buildClientReportHtml(result, { clientName: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
