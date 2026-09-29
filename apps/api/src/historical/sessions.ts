import type { HistoricalUnit } from './types';

export type SessionTemplate = {
  /** Minutes after IST midnight, e.g. 555 = 09:15. */
  openMin: number;
  /** Inclusive last slot start, e.g. 930 = 15:30. */
  closeMin: number;
};

/**
 * Default NSE cash session. Assumption documented in the report.
 * TODO: per-exchange / per-instrument session templates.
 *
 * Verified live 2026-09-29 (NSE Nifty 50, full trading day 2026-09-28):
 * 1-minute candles run 09:15 → 15:29 IST (375 rows, active AND expired
 * keys), NOT 15:30. Coarser steps floor from 09:15 within the same bound
 * (5-min → 15:25, 15-min/1-hour → 15:15 — all observed). A 15:30 close
 * would manufacture one false gap per complete intraday day.
 */
export const DEFAULT_SESSION: SessionTemplate = {
  openMin: 9 * 60 + 15,
  closeMin: 15 * 60 + 29,
};

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
});

export function istDateString(timestamp: number): string {
  return dayFormatter.format(new Date(timestamp));
}

function isWeekday(timestamp: number): boolean {
  const day = weekdayFormatter.format(new Date(timestamp));
  return day !== 'Sat' && day !== 'Sun';
}

function parseDay(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

const DAY_MS = 86400000;

const NO_HOLIDAYS: ReadonlySet<string> = new Set();

/**
 * All Mon–Fri dates in [from, to], minus exchange holidays.
 * Holidays come from the /market/holidays-fed provider (never hardcoded);
 * an empty set preserves the plain-weekday behavior.
 */
export function expectedWeekdayDates(
  from: string,
  to: string,
  holidays: ReadonlySet<string> = NO_HOLIDAYS,
): string[] {
  const dates: string[] = [];
  for (let t = parseDay(from); t <= parseDay(to); t += DAY_MS) {
    if (isWeekday(t + DAY_MS / 2)) {
      const date = new Date(t).toISOString().slice(0, 10);
      if (!holidays.has(date)) {
        dates.push(date);
      }
    }
  }
  return dates;
}

function istMidnightUtcMs(yyyyMmDd: string): number {
  return Date.parse(`${yyyyMmDd}T00:00:00+05:30`);
}

/**
 * Expected intraday slot starts (epoch ms) for weekdays in range.
 * Step comes from the dataset interval. Slots are exact grid points;
 * a candle matches a slot only on exact equality.
 */
export function expectedIntradaySlots(
  from: string,
  to: string,
  unit: HistoricalUnit,
  interval: number,
  session: SessionTemplate = DEFAULT_SESSION,
  holidays: ReadonlySet<string> = NO_HOLIDAYS,
): number[] {
  const stepMin = unit === 'minutes' ? interval : interval * 60;
  const slots: number[] = [];
  for (const date of expectedWeekdayDates(from, to, holidays)) {
    const midnight = istMidnightUtcMs(date);
    for (let m = session.openMin; m <= session.closeMin; m += stepMin) {
      slots.push(midnight + m * 60000);
    }
  }
  return slots;
}

/** Monday (00:00 IST) bucket key for weekly comparison. */
export function istWeekBucket(timestamp: number): string {
  const date = istDateString(timestamp);
  const noonUtc = parseDay(date) + DAY_MS / 2;
  const weekday = new Date(noonUtc).getUTCDay();
  const back = (weekday + 6) % 7;
  return new Date(noonUtc - back * DAY_MS).toISOString().slice(0, 10);
}

/** Month bucket key YYYY-MM in IST. */
export function istMonthBucket(timestamp: number): string {
  return istDateString(timestamp).slice(0, 7);
}

function expectedWeekBuckets(from: string, to: string): string[] {
  const buckets: string[] = [];
  let current = istWeekBucket(parseDay(from) + DAY_MS / 2);
  const end = istWeekBucket(parseDay(to) + DAY_MS / 2);
  while (current <= end) {
    buckets.push(current);
    const next = parseDay(current) + 7 * DAY_MS;
    current = istWeekBucket(next + DAY_MS / 2);
  }
  return buckets;
}

function expectedMonthBuckets(from: string, to: string): string[] {
  const buckets: string[] = [];
  let [year, month] = from.split('-').map(Number) as [number, number];
  const [endYear, endMonth] = to.split('-').map(Number) as [number, number];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    buckets.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return buckets;
}

export type ExpectedSet =
  | { kind: 'dates'; values: string[]; keyOf: (ts: number) => string }
  | { kind: 'slots'; values: number[]; keyOf: (ts: number) => number }
  | { kind: 'buckets'; values: string[]; keyOf: (ts: number) => string };

/** Expected sessions for a dataset range + unit. */
export function expectedSessions(
  from: string,
  to: string,
  unit: HistoricalUnit,
  interval: number,
  session: SessionTemplate = DEFAULT_SESSION,
  holidays: ReadonlySet<string> = NO_HOLIDAYS,
): ExpectedSet {
  if (unit === 'minutes' || unit === 'hours') {
    return {
      kind: 'slots',
      values: expectedIntradaySlots(from, to, unit, interval, session, holidays),
      keyOf: (ts) => ts,
    };
  }
  if (unit === 'weeks') {
    return {
      kind: 'buckets',
      values: expectedWeekBuckets(from, to),
      keyOf: istWeekBucket,
    };
  }
  if (unit === 'months') {
    return {
      kind: 'buckets',
      values: expectedMonthBuckets(from, to),
      keyOf: istMonthBucket,
    };
  }
  return {
    kind: 'dates',
    values: expectedWeekdayDates(from, to, holidays),
    keyOf: istDateString,
  };
}
