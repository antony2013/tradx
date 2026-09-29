import { describe, expect, it } from 'vitest';
import {
  detectDuplicates,
  validateCandleOhlc,
  validateCandleTimestamps,
} from '../src/historical/detectors';
import {
  expectedIntradaySlots,
  expectedSessions,
  expectedWeekdayDates,
  istDateString,
} from '../src/historical/sessions';
import type { NormalizedCandle } from '../src/historical/types';

function candle(timestamp: number, overrides: Partial<NormalizedCandle> = {}): NormalizedCandle {
  return {
    timestamp,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000,
    openInterest: null,
    ...overrides,
  };
}

describe('ohlc validation', () => {
  it('accepts a clean candle', () => {
    expect(validateCandleOhlc(candle(1))).toEqual([]);
  });

  it('flags structural impossibilities only', () => {
    expect(
      validateCandleOhlc(candle(1, { high: 80, low: 90 })).map((i) => i.code),
    ).toContain('HIGH_LOW_ORDER');
    expect(
      validateCandleOhlc(candle(2, { close: 200 })).map((i) => i.code),
    ).toContain('HIGH_BOUND');
    expect(
      validateCandleOhlc(candle(3, { open: 10 })).map((i) => i.code),
    ).toContain('LOW_BOUND');
    expect(
      validateCandleOhlc(candle(4, { volume: -5 })).map((i) => i.code),
    ).toContain('NEGATIVE_VOLUME');
    expect(
      validateCandleOhlc(candle(5, { open: Number.NaN })).map((i) => i.code),
    ).toContain('NON_FINITE_FIELD');
  });
});

describe('timestamp validation', () => {
  it('accepts ordered safe timestamps', () => {
    expect(
      validateCandleTimestamps([candle(1), candle(1), candle(2)]),
    ).toEqual([]);
  });

  it('flags backwards and unsafe timestamps', () => {
    const issues = validateCandleTimestamps([candle(5), candle(3)]);
    expect(issues.map((i) => i.code)).toEqual(['OUT_OF_ORDER']);
  });
});

describe('duplicate and conflict detection', () => {
  it('ignores unique timestamps', () => {
    expect(detectDuplicates([candle(1), candle(2)])).toEqual([]);
  });

  it('reports identical repeats as non-conflicting duplicates', () => {
    const groups = detectDuplicates([candle(1), candle(1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      timestamp: 1,
      count: 2,
      conflicting: false,
    });
  });

  it('reports differing repeats as conflicts', () => {
    const groups = detectDuplicates([candle(1), candle(1, { close: 999 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.conflicting).toBe(true);
  });
});

describe('expected sessions', () => {
  it('uses IST calendar days and skips weekends', () => {
    // 2026-09-12 Sat, 13 Sun, 14 Mon.
    expect(expectedWeekdayDates('2026-09-12', '2026-09-14')).toEqual([
      '2026-09-14',
    ]);
    expect(istDateString(Date.parse('2026-09-14T00:00:00+05:30'))).toBe(
      '2026-09-14',
    );
  });

  it('builds an intraday grid from the session template', () => {
    const slots = expectedIntradaySlots('2026-09-14', '2026-09-14', 'hours', 1);
    expect(slots).toHaveLength(7);
    expect(slots[0]).toBe(Date.parse('2026-09-14T09:15:00+05:30'));
    expect(slots[6]).toBe(Date.parse('2026-09-14T15:15:00+05:30'));
  });

  it('ends the 1-minute grid at 15:29 IST (live-verified, not 15:30)', () => {
    // Live 2026-09-29: a full Nifty 1-minute day is 09:15 → 15:29
    // (375 candles, active and expired keys). A 15:30 close would add
    // one phantom slot — one false gap per complete day.
    const one = expectedIntradaySlots('2026-09-28', '2026-09-28', 'minutes', 1);
    expect(one).toHaveLength(375);
    expect(one[0]).toBe(Date.parse('2026-09-28T09:15:00+05:30'));
    expect(one[374]).toBe(Date.parse('2026-09-28T15:29:00+05:30'));

    const five = expectedIntradaySlots('2026-09-28', '2026-09-28', 'minutes', 5);
    expect(five).toHaveLength(75);
    expect(five[74]).toBe(Date.parse('2026-09-28T15:25:00+05:30'));
  });

  it('selects buckets for weeks and months', () => {
    const weeks = expectedSessions('2026-09-01', '2026-09-23', 'weeks', 1);
    expect(weeks.values).toHaveLength(4);
    const months = expectedSessions('2026-01-15', '2026-03-10', 'months', 1);
    expect(months.values).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});
