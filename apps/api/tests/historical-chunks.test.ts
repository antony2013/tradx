import { describe, expect, it } from 'vitest';
import { addDays, addMonths, splitDateRange } from '../src/historical/chunks';
import { HistoricalError } from '../src/historical/errors';
import {
  parseInterval,
  validateHistoricalRequest,
} from '../src/historical/validate';

describe('request validation', () => {
  const valid = {
    instrumentKey: 'NSE_INDEX|Nifty 50',
    from: '2026-09-01',
    to: '2026-09-23',
    interval: '1day',
    source: 'upstox',
  };

  it('accepts a valid request and parses the interval', () => {
    expect(validateHistoricalRequest(valid)).toEqual({
      instrumentKey: 'NSE_INDEX|Nifty 50',
      from: '2026-09-01',
      to: '2026-09-23',
      unit: 'days',
      interval: 1,
      source: 'upstox',
      expired: false,
    });
  });

  it('routes date-suffixed expired keys and rejects hours for them', () => {
    const expired = validateHistoricalRequest({
      ...valid,
      instrumentKey: 'NSE_FO|58422|03-10-2024',
    });
    expect(expired.expired).toBe(true);
    expect(() =>
      validateHistoricalRequest({
        ...valid,
        instrumentKey: 'NSE_FO|58422|03-10-2024',
        interval: '1hour',
      }),
    ).toThrow(HistoricalError);
  });

  it('defaults a missing source to upstox', () => {
    const { source } = validateHistoricalRequest({
      instrumentKey: 'X',
      from: '2026-09-01',
      to: '2026-09-02',
      interval: '1day',
    });
    expect(source).toBe('upstox');
  });

  it('rejects empty keys, bad dates, reversed and future ranges', () => {
    expect(() =>
      validateHistoricalRequest({ ...valid, instrumentKey: '  ' }),
    ).toThrow(HistoricalError);
    expect(() =>
      validateHistoricalRequest({ ...valid, from: '09-01-2026' }),
    ).toThrow(HistoricalError);
    expect(() =>
      validateHistoricalRequest({
        ...valid,
        from: '2026-09-23',
        to: '2026-09-01',
      }),
    ).toThrow(HistoricalError);
    expect(() =>
      validateHistoricalRequest({ ...valid, to: '2999-01-01' }),
    ).toThrow(HistoricalError);
  });

  it('rejects unknown sources and intervals', () => {
    expect(() =>
      validateHistoricalRequest({ ...valid, source: 'nope' }),
    ).toThrow(HistoricalError);
    expect(() =>
      validateHistoricalRequest({ ...valid, interval: '1second' }),
    ).toThrow(HistoricalError);
    expect(() =>
      validateHistoricalRequest({ ...valid, interval: '7hours' }),
    ).toThrow(HistoricalError);
    expect(() =>
      validateHistoricalRequest({ ...valid, interval: '2days' }),
    ).toThrow(HistoricalError);
  });

  it('parses every supported unit', () => {
    expect(parseInterval('1minute')).toEqual({ unit: 'minutes', interval: 1 });
    expect(parseInterval('15minutes')).toEqual({ unit: 'minutes', interval: 15 });
    expect(parseInterval('300minute')).toEqual({ unit: 'minutes', interval: 300 });
    expect(parseInterval('5hours')).toEqual({ unit: 'hours', interval: 5 });
    expect(parseInterval('1day')).toEqual({ unit: 'days', interval: 1 });
    expect(parseInterval('1week')).toEqual({ unit: 'weeks', interval: 1 });
    expect(parseInterval('1month')).toEqual({ unit: 'months', interval: 1 });
  });

  it('accepts plain day/week/month as Upstox tokens for value 1', () => {
    expect(parseInterval('day')).toEqual({ unit: 'days', interval: 1 });
    expect(parseInterval('week')).toEqual({ unit: 'weeks', interval: 1 });
    expect(parseInterval('month')).toEqual({ unit: 'months', interval: 1 });
    expect(parseInterval('DAY')).toEqual({ unit: 'days', interval: 1 });
    expect(() => parseInterval('0day')).toThrow(HistoricalError);
    expect(() => parseInterval('2days')).toThrow(HistoricalError);
  });
});

describe('date-range chunking', () => {
  it('keeps small ranges in one chunk', () => {
    expect(splitDateRange('2026-09-01', '2026-09-23', 'days', 1)).toEqual([
      { index: 0, from: '2026-09-01', to: '2026-09-23' },
    ]);
    expect(splitDateRange('2020-01-01', '2026-09-23', 'weeks', 1)).toHaveLength(1);
  });

  it('splits minute ranges into calendar months without gaps', () => {
    const chunks = splitDateRange('2026-07-15', '2026-09-23', 'minutes', 1);
    expect(chunks).toEqual([
      { index: 0, from: '2026-07-15', to: '2026-08-14' },
      { index: 1, from: '2026-08-15', to: '2026-09-14' },
      { index: 2, from: '2026-09-15', to: '2026-09-23' },
    ]);
    // No overlap, no omission: every boundary continues the previous day.
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]?.from).toBe(addDays(chunks[i - 1]?.to as string, 1));
    }
  });

  it('uses quarters for hours and decades for days', () => {
    const hours = splitDateRange('2026-01-10', '2026-09-23', 'hours', 1);
    expect(hours.map((c) => [c.from, c.to])).toEqual([
      ['2026-01-10', '2026-04-09'],
      ['2026-04-10', '2026-07-09'],
      ['2026-07-10', '2026-09-23'],
    ]);
    expect(splitDateRange('2000-01-01', '2026-09-23', 'days', 1)).toEqual([
      { index: 0, from: '2000-01-01', to: '2009-12-31' },
      { index: 1, from: '2010-01-01', to: '2019-12-31' },
      { index: 2, from: '2020-01-01', to: '2026-09-23' },
    ]);
  });

  it('clamps month ends deterministically', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
  });
});
