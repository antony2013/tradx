import { describe, expect, it, vi } from 'vitest';
import {
  createUpstoxHolidayProvider,
  type MarketHolidaysClient,
} from '../src/historical/holidays';
import type { Logger } from '../src/lib/logger';

const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

// Live /v2/market/holidays shape (2026): TRADING_HOLIDAY closes every
// segment, SETTLEMENT_HOLIDAY only settlement segments, SPECIAL_TIMING
// days stay open for the listed absentees.
const LIVE_SHAPED = {
  status: 'success',
  data: [
    {
      date: '2026-10-02',
      description: 'Gandhi Jayanti',
      holiday_type: 'TRADING_HOLIDAY',
      closed_exchanges: ['NSE', 'NFO', 'CDS', 'BSE', 'BFO', 'BCD', 'MCX', 'NSCOM'],
      open_exchanges: [],
    },
    {
      date: '2026-03-19',
      description: 'Settlement',
      holiday_type: 'SETTLEMENT_HOLIDAY',
      closed_exchanges: ['CDS', 'BCD'],
      open_exchanges: ['NSE', 'NFO', 'BSE', 'BFO', 'MCX', 'NSCOM'],
    },
    {
      date: '2026-02-01',
      description: 'Budget session',
      holiday_type: 'SPECIAL_TIMING',
      closed_exchanges: ['CDS', 'BCD'],
      open_exchanges: ['NSE', 'NFO', 'BSE', 'BFO', 'MCX', 'NSCOM'],
    },
  ],
};

function stubClient(data: unknown = LIVE_SHAPED): MarketHolidaysClient {
  return {
    getMarketHolidays: vi.fn(async () => data),
  };
}

describe('upstox holiday provider', () => {
  it('excludes only dates closed for the dataset segment', async () => {
    const provider = createUpstoxHolidayProvider(stubClient(), nullLogger);

    const fo = await provider.getClosedDates(
      '2026-09-28',
      '2026-10-03',
      'NSE_FO|73985',
    );
    // Gandhi Jayanti closes NFO; settlement/special days do not.
    expect(fo.calendar).toBe('applied');
    expect([...fo.dates]).toEqual(['2026-10-02']);

    const eq = await provider.getClosedDates(
      '2026-03-16',
      '2026-03-20',
      'NSE_EQ|INE002A01018',
    );
    expect([...eq.dates]).toEqual([]);
  });

  it('matches index underlyings to their exchange code', async () => {
    const provider = createUpstoxHolidayProvider(stubClient(), nullLogger);
    const index = await provider.getClosedDates(
      '2026-09-28',
      '2026-10-03',
      'NSE_INDEX|Nifty 50',
    );
    expect([...index.dates]).toEqual(['2026-10-02']);
  });

  it('falls back conservatively for unknown segments with a note', async () => {
    const provider = createUpstoxHolidayProvider(stubClient(), nullLogger);
    const unknown = await provider.getClosedDates(
      '2026-09-28',
      '2026-10-03',
      'XYZ_QQ|123',
    );
    expect(unknown.calendar).toBe('applied');
    expect(unknown.dates.size).toBe(0);
    expect(unknown.note).toContain('XYZ_QQ');
  });

  it('falls back to weekdays with a note when the provider fails', async () => {
    const failing: MarketHolidaysClient = {
      getMarketHolidays: vi.fn(async () => {
        throw new Error('upstream down');
      }),
    };
    const provider = createUpstoxHolidayProvider(failing, nullLogger);
    const result = await provider.getClosedDates(
      '2026-09-28',
      '2026-10-03',
      'NSE_FO|73985',
    );
    expect(result.calendar).toBe('unavailable');
    expect(result.dates.size).toBe(0);
    expect(result.note).toContain('unavailable');
  });

  it('treats malformed payloads as an empty applied calendar', async () => {
    const provider = createUpstoxHolidayProvider(stubClient({}), nullLogger);
    const result = await provider.getClosedDates(
      '2026-09-28',
      '2026-10-03',
      'NSE_FO|73985',
    );
    expect(result.calendar).toBe('applied');
    expect(result.dates.size).toBe(0);
  });
});
