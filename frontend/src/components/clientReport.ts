/**
 * "Report for Client": a one-to-two page, plain-English summary of a suitability assessment,
 * written for the client (not the RM). No jargon, no compliance-screening detail, one chart.
 *
 * Built as a self-contained A4 HTML page; downloadClientReport() opens the browser's print
 * dialog on it so the RM can "Save as PDF" (vector text + chart, no PDF library needed).
 */
import type { AssessmentResponse, CheckStatus, HistoricalScenario } from '../types';

interface ReportOptions {
  clientName: string;
  rmName?: string;
}

const COLORS = { fit: '#00875f', chat: '#c46a00', no: '#c8323f', ink: '#16181a', mute: '#5c636b', line: '#e2e2e7' };

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function money(x: number, currency: string): string {
  const n = Math.round(x).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US');
  return currency === 'INR' ? `₹${n}` : `${currency} ${n}`;
}

function shortMoney(x: number, currency: string): string {
  if (currency !== 'INR') return money(x, currency);
  if (x >= 1e7) return `₹${+(x / 1e7).toFixed(2)} Cr`;
  if (x >= 1e5) return `₹${+(x / 1e5).toFixed(1)} L`;
  return money(x, currency);
}

const pct = (x: number, dp = 0) => `${+x.toFixed(dp)}%`;

/** "1-year", "3-year", "6-month": for use before a noun. */
function durationAdj(months: number): string {
  return months % 12 === 0 ? `${months / 12}-year` : `${+months.toFixed(1)}-month`;
}

const years = (y: number) => (y === 1 ? '1 year' : `${+y.toFixed(1)} years`);

const RISK_PLAIN: Record<string, { level: string; meaning: string }> = {
  CONSERVATIVE: { level: 'Low', meaning: 'you prefer your money to stay steady' },
  MODERATE: { level: 'Medium', meaning: 'some ups and downs are fine with you' },
  AGGRESSIVE: { level: 'High', meaning: 'you accept big ups and downs for a chance of higher returns' },
};

const STATUS: Record<CheckStatus, { label: string; icon: string; color: string }> = {
  PASS: { label: 'Fits you', icon: '✓', color: COLORS.fit },
  REVIEW: { label: 'Worth a conversation', icon: '!', color: COLORS.chat },
  FAIL: { label: 'Does not fit', icon: '✕', color: COLORS.no },
};

function describeProduct(p: Record<string, any>, underlyingName: string): string {
  const term = durationAdj(Number(p.tenor));
  if (p.product_type === 'ELN') {
    const barrier = p.barrier_pct != null ? ` (more than ${pct(100 - p.barrier_pct * 100)} from where it starts)` : '';
    return `A ${term} investment linked to the ${underlyingName}. It pays a fixed ${pct(p.coupon_pa * 100, 1)} a year, `
      + `but if the ${underlyingName} falls sharply${barrier}, you can lose part of the money you put in.`;
  }
  if (p.product_type === 'CPN') {
    return `A ${term} investment linked to the ${underlyingName}. It aims to give back ${pct(p.protection_pct * 100)} of your money `
      + `at the end, plus a share of any rise in the ${underlyingName}. Getting your money back depends on the issuing bank being able to pay.`;
  }
  return `A ${term} deposit paying ${pct(p.coupon_pa * 100, 1)} a year. If the ${underlyingName} exchange rate crosses `
    + `${p.strike_rate}, you may be paid back in ${p.alt_currency} instead.`;
}

function chartSvg(scenarios: HistoricalScenario[], invested: number, limit: number, currency: string): string {
  const sorted = [...scenarios].sort((a, b) => a.money_back - b.money_back);
  const W = 660, H = 250, L = 64, R = 150, T = 16, B = 34;
  // Round axis steps (1/2/2.5/5 x 10^n), about four of them.
  const peak = Math.max(invested, ...sorted.map((s) => s.money_back)) * 1.05;
  const mag = 10 ** Math.floor(Math.log10(peak / 4));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= peak / 4)!;
  const top = Math.ceil(peak / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const slot = (W - L - R) / sorted.length;

  const bars = sorted.map((s, i) => {
    const color = s.money_back >= invested ? COLORS.fit : s.money_back >= limit ? COLORS.chat : COLORS.no;
    const x = L + i * slot + slot * 0.18;
    const h = y(0) - y(s.money_back);
    return `<rect x="${x.toFixed(1)}" y="${y(s.money_back).toFixed(1)}" width="${(slot * 0.64).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}"/>`;
  }).join('');

  const worst = sorted[0];
  const worstLabel = `${worst.period.start.slice(0, 4)}–${worst.period.end.slice(0, 4)}`;
  const line = (v: number, color: string, label: string) => `
    <line x1="${L}" x2="${W - R + 6}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 4"/>
    <text x="${W - R + 12}" y="${(y(v) + 4).toFixed(1)}" font-size="11" fill="${color}" font-weight="600">${esc(label)}</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Money back in each of ${sorted.length} past periods">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${COLORS.line}"/>
      <text x="${L - 8}" y="${(y(t) + 4).toFixed(1)}" font-size="10" fill="${COLORS.mute}" text-anchor="end">${esc(shortMoney(t, currency))}</text>`).join('')}
    ${bars}
    ${line(invested, COLORS.ink, `What you put in: ${shortMoney(invested, currency)}`)}
    ${limit > 0 ? line(limit, COLORS.no, `Your limit: ${shortMoney(limit, currency)}`) : ''}
    <text x="${L + slot / 2}" y="${H - B + 16}" font-size="10" fill="${COLORS.mute}" text-anchor="middle">${esc(worstLabel)}</text>
    <text x="${(L + W - R) / 2}" y="${H - 4}" font-size="11" fill="${COLORS.mute}" text-anchor="middle">${sorted.length} real past periods, from worst to best</text>
  </svg>`;
}

export function buildClientReportHtml(result: AssessmentResponse, opts: ReportOptions): string {
  const { assessment, simulation } = result;
  const c = assessment.checks;
  const product = (simulation.audit.product ?? {}) as Record<string, any>;
  const underlyingName = String((simulation.audit.underlying as { name?: string } | undefined)?.name ?? product.underlying ?? 'market');
  const currency = simulation.currency || 'INR';
  const invested = Number(product.notional);
  const tolerance = Math.abs(c.loss_tolerance.client_limit_pct); // fraction, e.g. 0.20
  const limit = invested * (1 - tolerance);
  const scenarios = simulation.scenarios;
  const sorted = [...scenarios].sort((a, b) => a.money_back - b.money_back);
  const worst = sorted[0], best = sorted[sorted.length - 1], typical = sorted[Math.floor(sorted.length / 2)];
  const losingPeriods = scenarios.filter((s) => s.money_back < invested).length;
  const beyondLimit = scenarios.filter((s) => s.money_back < limit).length;
  const appetite = RISK_PLAIN[c.risk_appetite.client_limit_category] ?? RISK_PLAIN.CONSERVATIVE;
  const productRisk = RISK_PLAIN[c.risk_appetite.product_value_category] ?? RISK_PLAIN.AGGRESSIVE;
  const share = c.concentration_risk.product_value_pct;
  const extraChecks = assessment.additional_checks_required
    ?? Object.values(assessment.compliance_flags ?? {}).some((f) => f.status !== 'PASS');
  const worstYears = `${worst.period.start.slice(0, 4)}–${worst.period.end.slice(0, 4)}`;
  const worstLoss = invested - worst.money_back;
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const rows: { status: CheckStatus; title: string; you: string; product: string; why: Record<CheckStatus, string> }[] = [
    {
      status: c.risk_appetite.status,
      title: 'How much risk it carries',
      you: `${appetite.level}: ${appetite.meaning}.`,
      product: `${productRisk.level}: based on how it is built and how it behaved in past markets.`,
      why: { PASS: 'Its risk is within your comfort level.', REVIEW: 'It is a step riskier than you are comfortable with.', FAIL: 'It carries much more risk than you are comfortable with.' },
    },
    {
      status: c.investment_horizon.status,
      title: 'How long your money is tied up',
      you: `You can stay invested for ${years(c.investment_horizon.client_limit_years)}.`,
      product: `It needs your money for ${years(c.investment_horizon.product_value_years)}.`,
      why: { PASS: 'It fits within the time you have.', REVIEW: 'The timing needs a quick discussion.', FAIL: 'It ties up your money for longer than you planned.' },
    },
    {
      status: c.loss_tolerance.status,
      title: 'Your money in a bad market',
      you: `The most you are OK losing is ${pct(tolerance * 100)} (${money(invested * tolerance, currency)} of ${money(invested, currency)}).`,
      product: worstLoss > 0
        ? `In its worst past period (${worstYears}) it would have lost ${pct(-worst.return_pct, 1)} (${money(worstLoss, currency)}).`
        : `In every past period we tested, you would have got back at least what you put in.`,
      why: { PASS: 'Even the worst past result stays within your limit.', REVIEW: 'The worst past result is close to your limit.', FAIL: 'In a bad market it could lose more than you said you can accept.' },
    },
    {
      status: c.concentration_risk.status,
      title: 'How much of your savings it uses',
      you: `We suggest keeping no more than ${pct(c.concentration_risk.client_limit_pct * 100)} of your savings in one investment like this.`,
      product: share == null ? `We could not size this against your savings.` : `This would be about ${pct(share * 100, 1)} of your savings.`,
      why: { PASS: 'The amount is sensible for your savings.', REVIEW: 'It is a larger share of your savings than is comfortable.', FAIL: 'It would put too much of your savings in one place.' },
    },
  ];

  const concerns = rows.filter((r) => r.status === 'FAIL').concat(rows.filter((r) => r.status === 'REVIEW'));
  const positives = rows.filter((r) => r.status === 'PASS');

  const verdict = {
    SUITABLE: { color: COLORS.fit, title: 'This product fits what you told us.', sub: 'It matches your comfort with risk, your time frame and your savings.' },
    REVIEW_REQUIRED: { color: COLORS.chat, title: 'This product could work, but a few points need a conversation first.', sub: 'Nothing goes ahead until you are fully comfortable.' },
    NOT_SUITABLE: { color: COLORS.no, title: 'This product is not the right fit for you right now.', sub: 'We checked it carefully against what you told us. Protecting your money comes first, so we are not suggesting it.' },
  }[assessment.overall_status];

  const minute = [
    ...concerns.map((r) => r.why[r.status]),
    ...(positives.length ? [`The good news: ${positives.map((r) => r.why.PASS.charAt(0).toLowerCase() + r.why.PASS.slice(1).replace(/\.$/, '')).join('; ')}.`] : []),
    ...(extraChecks ? ['We also need to finish a few routine checks on our side before anything goes ahead.'] : []),
  ];

  const nextSteps = result.explanation?.client?.next_steps?.length
    ? result.explanation.client.next_steps
    : ['Talk it through with your relationship manager.'];

  const title = `Investment check – ${opts.clientName} – ${today}`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f4f4; color: ${COLORS.ink}; font: 14px/1.55 Inter, "Segoe UI", system-ui, -apple-system, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { max-width: 794px; margin: 24px auto; background: #fff; padding: 40px 44px; border-radius: 16px; }
  header { border-bottom: 1px solid ${COLORS.line}; padding-bottom: 16px; margin-bottom: 22px; }
  .brand { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #494fdf; }
  h1 { font-size: 24px; line-height: 1.2; margin: 4px 0 0; font-weight: 600; letter-spacing: -.01em; }
  .meta { font-size: 12px; color: ${COLORS.mute}; margin-top: 6px; }
  h2 { font-size: 15px; margin: 0 0 10px; font-weight: 700; }
  section { margin-bottom: 22px; break-inside: avoid; }
  section.flow { break-inside: auto; }
  h2 { break-after: avoid; }
  .verdict { border-left: 6px solid; border-radius: 10px; padding: 16px 18px; background: #fafafa; }
  .verdict .t { font-size: 19px; font-weight: 700; line-height: 1.3; }
  .verdict .s { color: ${COLORS.mute}; margin-top: 4px; }
  ul { margin: 0; padding-left: 20px; } li { margin: 4px 0; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .tile { border: 1px solid ${COLORS.line}; border-radius: 10px; padding: 12px; }
  .tile .k { font-size: 11px; color: ${COLORS.mute}; text-transform: uppercase; letter-spacing: .05em; }
  .tile .v { font-size: 18px; font-weight: 700; margin: 2px 0; }
  .tile .d { font-size: 12px; color: ${COLORS.mute}; line-height: 1.4; }
  .note { font-size: 12.5px; color: ${COLORS.mute}; margin-top: 8px; }
  .row { display: grid; grid-template-columns: 150px 1fr; gap: 14px; padding: 12px 0; border-top: 1px solid ${COLORS.line}; break-inside: avoid; }
  .row:first-of-type { border-top: 0; }
  .badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; }
  .badge i { font-style: normal; display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; color: #fff; font-size: 12px; }
  .row .title { font-weight: 600; margin-bottom: 4px; }
  .row .pair { font-size: 13px; color: ${COLORS.mute}; } .row .pair b { color: ${COLORS.ink}; font-weight: 600; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
  .stat { border-radius: 10px; padding: 10px 12px; background: #fafafa; }
  .stat .k { font-size: 11px; color: ${COLORS.mute}; text-transform: uppercase; letter-spacing: .05em; } .stat .v { font-size: 17px; font-weight: 700; }
  .stat .d { font-size: 12px; color: ${COLORS.mute}; }
  footer { border-top: 1px solid ${COLORS.line}; padding-top: 12px; font-size: 11px; color: ${COLORS.mute}; line-height: 1.5; }
  .toolbar { max-width: 794px; margin: 16px auto -8px; text-align: right; }
  .toolbar button { font: 600 14px Inter, system-ui, sans-serif; background: #191c1f; color: #fff; border: 0; border-radius: 999px; padding: 10px 20px; cursor: pointer; }
  @media (max-width: 640px) { .page { padding: 24px 18px; margin: 0; border-radius: 0; } .tiles, .stats { grid-template-columns: 1fr 1fr; } .row { grid-template-columns: 1fr; gap: 6px; } }
  @media print { body { background: #fff; } .page { margin: 0; padding: 0; max-width: none; border-radius: 0; } .toolbar { display: none; } }
</style></head>
<body>
<div class="toolbar"><button onclick="window.print()">Save as PDF</button></div>
<div class="page">
  <header>
    <div>
      <div class="brand">Neural Nexus · Investment check</div>
      <h1>Prepared for ${esc(opts.clientName)}</h1>
    </div>
    <div class="meta">${esc(today)}${opts.rmName ? ` · Prepared by ${esc(opts.rmName)}, your relationship manager` : ''}</div>
  </header>

  <section>
    <div class="verdict" style="border-color:${verdict.color}">
      <div class="t" style="color:${verdict.color}">${esc(verdict.title)}</div>
      <div class="s">${esc(verdict.sub)}</div>
    </div>
  </section>

  <section>
    <h2>In one minute</h2>
    <ul>${minute.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
  </section>

  <section>
    <h2>The product we looked at</h2>
    <div>${esc(describeProduct(product, underlyingName))}</div>
  </section>

  <section>
    <h2>What you told us</h2>
    <div class="tiles">
      <div class="tile"><div class="k">Comfort with risk</div><div class="v">${esc(appetite.level)}</div><div class="d">${esc(appetite.meaning.charAt(0).toUpperCase() + appetite.meaning.slice(1))}</div></div>
      <div class="tile"><div class="k">Time you can invest</div><div class="v">${esc(years(c.investment_horizon.client_limit_years))}</div><div class="d">Before you may need this money</div></div>
      <div class="tile"><div class="k">Most you're OK losing</div><div class="v">${esc(pct(tolerance * 100))}</div><div class="d">${esc(money(invested * tolerance, currency))} on this amount</div></div>
      <div class="tile"><div class="k">Amount considered</div><div class="v">${esc(shortMoney(invested, currency))}</div><div class="d">${share == null ? '' : `About ${esc(pct(share * 100, 1))} of your savings`}</div></div>
    </div>
    <div class="note">Your choices come first. Everything below is measured against them, not against what other investors do.</div>
  </section>

  <section class="flow">
    <h2>How this product measures up</h2>
    ${rows.map((r) => `<div class="row">
      <div><span class="badge" style="color:${STATUS[r.status].color}"><i style="background:${STATUS[r.status].color}">${STATUS[r.status].icon}</i>${esc(STATUS[r.status].label)}</span></div>
      <div><div class="title">${esc(r.title)}: ${esc(r.why[r.status])}</div>
        <div class="pair"><b>You:</b> ${esc(r.you)}<br><b>This product:</b> ${esc(r.product)}</div></div>
    </div>`).join('')}
  </section>

  <section>
    <h2>What would have happened in the past</h2>
    <div style="font-size:13px;color:${COLORS.mute};margin-bottom:6px">We tested this product on ${scenarios.length} real periods from market history. Each bar is what ${esc(money(invested, currency))} would have become.</div>
    ${chartSvg(scenarios, invested, limit, currency)}
    <div class="stats">
      <div class="stat"><div class="k">Worst period</div><div class="v" style="color:${worst.money_back < limit ? COLORS.no : COLORS.ink}">${esc(money(worst.money_back, currency))}</div><div class="d">${esc(worstYears)}</div></div>
      <div class="stat"><div class="k">Typical period</div><div class="v">${esc(money(typical.money_back, currency))}</div><div class="d">Middle of the ${scenarios.length}</div></div>
      <div class="stat"><div class="k">Best period</div><div class="v">${esc(money(best.money_back, currency))}</div><div class="d">${esc(best.period.start.slice(0, 4))}–${esc(best.period.end.slice(0, 4))}</div></div>
    </div>
    <div class="note">${losingPeriods === 0
      ? `In all ${scenarios.length} periods you would have got back at least what you put in.`
      : `You would have got back less than you put in ${losingPeriods === 1 ? 'once' : `${losingPeriods} times`} out of ${scenarios.length}${beyondLimit ? `, and ${beyondLimit === 1 ? 'once' : `${beyondLimit} times`} more than your ${esc(pct(tolerance * 100))} limit` : ''}. Bad markets are rare, but they do happen, and they are exactly when this matters.`}</div>
  </section>

  <section>
    <h2>What happens next</h2>
    <ul>${nextSteps.map((s) => `<li>${esc(s)}</li>`).join('')}<li>The final decision is always yours. Ask us anything; no question is too small.</li></ul>
  </section>

  <footer>
    About this report: we replayed this product on real past market periods. The past does not predict the future, and this report is not a promise of any result. Investments can lose value.
    Market data up to ${esc(simulation.data_as_of)} · Reference ${esc(assessment.assessment_id)}.
  </footer>
</div>
</body></html>`;
}

/** Open the browser's print dialog on the report so it can be saved as a PDF. */
export function downloadClientReport(result: AssessmentResponse, opts: ReportOptions): void {
  const html = buildClientReportHtml(result, opts);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();

  // Chrome names the saved PDF after the top-level title, so borrow it for the print.
  const previousTitle = document.title;
  document.title = doc.title;
  const cleanup = () => {
    document.title = previousTitle;
    iframe.remove();
  };
  setTimeout(() => {
    iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(cleanup, 60_000); // fallback if afterprint never fires
  }, 250);
}

/** Open the report in a new tab (with its own "Save as PDF" button). */
export function previewClientReport(result: AssessmentResponse, opts: ReportOptions): void {
  const url = URL.createObjectURL(new Blob([buildClientReportHtml(result, opts)], { type: 'text/html' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
