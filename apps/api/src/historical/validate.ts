import { z } from 'zod';
import { HistoricalError } from './errors';
import type {
  HistoricalRequestInput,
  HistoricalSource,
  HistoricalUnit,
  ValidatedHistoricalRequest,
} from './types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EXPIRY_SUFFIX_PATTERN = /^\d{2}-\d{2}-\d{4}$/;
const INTERVAL_PATTERN = /^(\d+)(minutes?|hours?|day|week|month)$/;

const requestShape = z.object({
  instrumentKey: z.string().trim().min(1),
  from: z.string().trim().regex(DATE_PATTERN),
  to: z.string().trim().regex(DATE_PATTERN),
  interval: z.string().trim().min(1),
  source: z.string().trim().min(1).default('upstox'),
});

function parseDate(value: string, field: string): number {
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isSafeInteger(time)) {
    throw new HistoricalError('INVALID_REQUEST', `Invalid date: ${field}`);
  }
  return time;
}

export function parseInterval(raw: string): {
  unit: HistoricalUnit;
  interval: number;
} {
  const match = INTERVAL_PATTERN.exec(raw.trim().toLowerCase());
  if (!match) {
    throw new HistoricalError(
      'UNSUPPORTED_INTERVAL',
      `Unsupported interval: ${raw}`,
    );
  }

  const value = Number(match[1]);
  const unitWord = match[2] as string;
  const unit: HistoricalUnit =
    unitWord === 'day'
      ? 'days'
      : unitWord === 'week'
        ? 'weeks'
        : unitWord === 'month'
          ? 'months'
          : unitWord.startsWith('hour')
            ? 'hours'
            : 'minutes';

  const valid =
    unit === 'minutes'
      ? Number.isSafeInteger(value) && value >= 1 && value <= 300
      : unit === 'hours'
        ? Number.isSafeInteger(value) && value >= 1 && value <= 5
        : value === 1;

  if (!valid) {
    throw new HistoricalError(
      'UNSUPPORTED_INTERVAL',
      `Unsupported interval: ${raw}`,
    );
  }

  return { unit, interval: value };
}

/**
 * Expired contract keys carry a date suffix: SEGMENT|token|DD-MM-YYYY
 * (e.g. NSE_FO|58422|03-10-2024). They route to the expired-candles API,
 * which accepts minute multiples plus day/week/month — never hours.
 */
export function isExpiredInstrumentKey(key: string): boolean {
  const parts = key.split('|');
  return (
    parts.length === 3 &&
    (parts[0]?.trim().length ?? 0) > 0 &&
    (parts[1]?.trim().length ?? 0) > 0 &&
    EXPIRY_SUFFIX_PATTERN.test(parts[2]?.trim() ?? '')
  );
}

export function validateHistoricalRequest(
  input: HistoricalRequestInput,
): ValidatedHistoricalRequest {
  const parsed = requestShape.safeParse(input);
  if (!parsed.success) {
    throw new HistoricalError(
      'INVALID_REQUEST',
      'Invalid historical request',
    );
  }

  const { unit, interval } = parseInterval(parsed.data.interval);

  const expired = isExpiredInstrumentKey(parsed.data.instrumentKey);
  if (expired && unit === 'hours') {
    throw new HistoricalError(
      'UNSUPPORTED_INTERVAL',
      'Expired candles do not support hour intervals',
    );
  }

  if (parsed.data.source !== 'upstox') {
    throw new HistoricalError(
      'INVALID_REQUEST',
      `Unsupported source: ${parsed.data.source}`,
    );
  }

  const fromTime = parseDate(parsed.data.from, 'from');
  const toTime = parseDate(parsed.data.to, 'to');
  if (fromTime > toTime) {
    throw new HistoricalError(
      'INVALID_REQUEST',
      'Invalid range: from is after to',
    );
  }

  const nowDays = Math.floor(Date.now() / 86400000);
  if (Math.floor(toTime / 86400000) > nowDays + 1) {
    throw new HistoricalError(
      'INVALID_REQUEST',
      'Invalid range: to is in the future',
    );
  }

  const source: HistoricalSource = 'upstox';
  return {
    instrumentKey: parsed.data.instrumentKey,
    from: parsed.data.from,
    to: parsed.data.to,
    unit,
    interval,
    source,
    expired,
  };
}
