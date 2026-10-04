const SYMBOLS: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };

/** Currency symbol for an ISO code, falling back to the code itself ("CHF "). */
export const currencySymbol = (code?: string | null): string => {
  if (!code) return '₹';
  return SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `;
};

/** Compact amount in the product's own currency: ₹10.0L for INR, $1.0M for everything else. */
export const compactAmount = (value: number, code?: string | null): string => {
  const sym = currencySymbol(code);
  if (!code || code.toUpperCase() === 'INR') return `${sym}${(value / 100000).toFixed(1)}L`;
  return `${sym}${value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })}`;
};

/** "not_specified" -> "Not specified" */
export const humanize = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
