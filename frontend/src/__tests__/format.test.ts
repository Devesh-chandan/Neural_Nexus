import { describe, expect, it } from 'vitest';
import { compactAmount, currencySymbol, formatMaxGain, humanize } from '../lib/format';

describe('format helpers', () => {
  it('maps currency codes to symbols and falls back to the code', () => {
    expect(currencySymbol('INR')).toBe('₹');
    expect(currencySymbol('usd')).toBe('$');
    expect(currencySymbol('CHF')).toBe('CHF ');
    expect(currencySymbol(null)).toBe('₹');
  });

  it('formats amounts in the product currency, not always rupees', () => {
    expect(compactAmount(1_000_000, 'INR')).toBe('₹10.0L');
    expect(compactAmount(1_000_000, 'USD')).toBe('$1M');
  });

  it('shows unlimited upside as text, never as a number', () => {
    expect(formatMaxGain(null)).toBe('Uncapped');
    expect(formatMaxGain(null, 'Uncapped · 80% of any rise')).toBe('Uncapped · 80% of any rise');
    expect(formatMaxGain(undefined)).toBe('Uncapped');
    expect(formatMaxGain(0.1)).toBe('+10.0%');
    expect(formatMaxGain(0)).toBe('+0.0%');
  });

  it('humanizes snake_case labels', () => {
    expect(humanize('not_specified')).toBe('Not specified');
  });
});
