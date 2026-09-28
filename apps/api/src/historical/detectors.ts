import type { NormalizedCandle } from './types';

export type OhlcIssue = {
  timestamp: number;
  code: 'NON_FINITE_FIELD' | 'HIGH_LOW_ORDER' | 'HIGH_BOUND' | 'LOW_BOUND' | 'NEGATIVE_VOLUME';
  detail: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Schema + OHLC integrity for one candle. Only flags structural
 * impossibilities (high < low, close outside [low, high], non-finite
 * fields, negative volume). Never judges market plausibility.
 */
export function validateCandleOhlc(candle: NormalizedCandle): OhlcIssue[] {
  const issues: OhlcIssue[] = [];
  const { timestamp, open, high, low, close, volume, openInterest } = candle;

  for (const [name, value] of Object.entries({
    open,
    high,
    low,
    close,
    volume,
  })) {
    if (!isFiniteNumber(value)) {
      issues.push({
        timestamp,
        code: 'NON_FINITE_FIELD',
        detail: `${name} is not finite`,
      });
    }
  }
  if (
    openInterest !== null &&
    openInterest !== undefined &&
    (!isFiniteNumber(openInterest) || openInterest < 0)
  ) {
    issues.push({
      timestamp,
      code: 'NON_FINITE_FIELD',
      detail: 'openInterest is not a non-negative finite number',
    });
  }
  if (issues.length > 0) {
    return issues;
  }

  if (high < low) {
    issues.push({ timestamp, code: 'HIGH_LOW_ORDER', detail: 'high < low' });
  }
  if (open > high || close > high) {
    issues.push({
      timestamp,
      code: 'HIGH_BOUND',
      detail: 'open/close above high',
    });
  }
  if (open < low || close < low) {
    issues.push({
      timestamp,
      code: 'LOW_BOUND',
      detail: 'open/close below low',
    });
  }
  if (volume < 0) {
    issues.push({
      timestamp,
      code: 'NEGATIVE_VOLUME',
      detail: 'volume is negative',
    });
  }
  return issues;
}

export type TimestampIssue = {
  timestamp: number;
  code: 'INVALID_TIMESTAMP' | 'OUT_OF_ORDER';
  detail: string;
};

/**
 * Timestamp validation over ASC-ordered candles: every timestamp must be
 * a safe integer, and the sequence must be non-decreasing. Exact
 * duplicates are left for duplicate/conflict detection, not flagged here.
 */
export function validateCandleTimestamps(
  candles: NormalizedCandle[],
): TimestampIssue[] {
  const issues: TimestampIssue[] = [];
  let previous: number | null = null;
  for (const candle of candles) {
    if (!Number.isSafeInteger(candle.timestamp)) {
      issues.push({
        timestamp: Number.isFinite(candle.timestamp)
          ? candle.timestamp
          : -1,
        code: 'INVALID_TIMESTAMP',
        detail: 'timestamp is not a safe integer',
      });
      continue;
    }
    if (previous !== null && candle.timestamp < previous) {
      issues.push({
        timestamp: candle.timestamp,
        code: 'OUT_OF_ORDER',
        detail: `timestamp goes backwards after ${previous}`,
      });
    }
    previous = candle.timestamp;
  }
  return issues;
}

export type DuplicateGroup = {
  timestamp: number;
  count: number;
  conflicting: boolean;
  sample: NormalizedCandle;
};

function candleKey(candle: NormalizedCandle): string {
  return [
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
    candle.openInterest,
  ].join('|');
}

/**
 * Duplicate + conflict detection. Same timestamp appearing more than once
 * is a duplicate; if any field differs between the rows it is a conflict
 * (same event, two stories) which is strictly worse.
 */
export function detectDuplicates(
  candles: NormalizedCandle[],
): DuplicateGroup[] {
  const byTimestamp = new Map<number, NormalizedCandle[]>();
  for (const candle of candles) {
    const rows = byTimestamp.get(candle.timestamp) ?? [];
    rows.push(candle);
    byTimestamp.set(candle.timestamp, rows);
  }

  const groups: DuplicateGroup[] = [];
  for (const [timestamp, rows] of byTimestamp) {
    if (rows.length < 2) {
      continue;
    }
    const first = rows[0] as NormalizedCandle;
    const conflicting = rows.some((row) => candleKey(row) !== candleKey(first));
    groups.push({ timestamp, count: rows.length, conflicting, sample: first });
  }
  return groups.sort((a, b) => a.timestamp - b.timestamp);
}
