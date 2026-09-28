import type { DateChunk, HistoricalUnit } from './types';

const DAY_MS = 86400000;

function toDateString(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function parseDay(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Add calendar months to a YYYY-MM-DD date, clamping the day for short
 * months. Pure UTC calendar math — deterministic and timezone-free.
 */
export function addMonths(value: string, months: number): string {
  const { year, month, day } = parseDay(value);
  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  const nextDay = Math.min(day, daysInMonth(nextYear, nextMonth));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${nextYear}-${pad(nextMonth)}-${pad(nextDay)}`;
}

export function addDays(value: string, days: number): string {
  return toDateString(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS);
}

/**
 * Maximum upstream retrieval window per unit, from the official Upstox
 * Historical Candle Data V3 page:
 * minutes 1-15 -> 1 month; minutes >15 / hours -> 1 quarter;
 * days -> 1 decade; weeks/months -> no limit (single chunk).
 */
export function chunkSpanMonths(unit: HistoricalUnit, interval: number): number {
  if (unit === 'minutes' && interval <= 15) {
    return 1;
  }
  if (unit === 'minutes' || unit === 'hours') {
    return 3;
  }
  if (unit === 'days') {
    return 120;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Split [from, to] (inclusive YYYY-MM-DD) into deterministic,
 * non-overlapping chunks covering the full range with no gaps.
 */
export function splitDateRange(
  from: string,
  to: string,
  unit: HistoricalUnit,
  interval: number,
): DateChunk[] {
  const span = chunkSpanMonths(unit, interval);
  const chunks: DateChunk[] = [];
  let start = from;
  let index = 0;

  while (start <= to) {
    const spanEnd =
      span === Number.POSITIVE_INFINITY ? to : addDays(addMonths(start, span), -1);
    const end = spanEnd > to ? to : spanEnd;
    chunks.push({ index, from: start, to: end });
    start = addDays(end, 1);
    index += 1;
  }

  return chunks;
}
