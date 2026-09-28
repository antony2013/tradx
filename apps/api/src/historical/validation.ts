import { asc, eq } from 'drizzle-orm';
import type { DatabaseContainer } from '../db';
import { historicalCandles, historicalDatasets } from '../db/schema';
import { validationReports } from '../db/schema';
import type { Logger } from '../lib/logger';
import {
  detectDuplicates,
  validateCandleOhlc,
  validateCandleTimestamps,
  type DuplicateGroup,
  type OhlcIssue,
  type TimestampIssue,
} from './detectors';
import {
  DEFAULT_SESSION,
  expectedSessions,
  type SessionTemplate,
} from './sessions';
import type { HistoricalUnit, NormalizedCandle } from './types';

export type IntegrityVerdict = 'VALID' | 'INVALID' | 'INCOMPLETE';

export type IntegrityReport = {
  dataset_id: string;
  verdict: IntegrityVerdict;
  candle_count: number;
  expected_count: number;
  matched_count: number;
  completeness: number;
  ohlc_issue_count: number;
  timestamp_issue_count: number;
  duplicate_count: number;
  conflict_count: number;
  gap_count: number;
  unexpected_count: number;
  ohlc_issues: OhlcIssue[];
  timestamp_issues: TimestampIssue[];
  duplicates: DuplicateGroup[];
  gaps: Array<string | number>;
  unexpected_sample: Array<string | number>;
  session_template: SessionTemplate | null;
  notes: string[];
  schema_version: string;
  created_at: number;
  updated_at: number;
};

export const VALIDATION_SCHEMA_VERSION = 'integrity-report-1';
const MAX_STORED_ITEMS = 200;

export type ValidationDeps = {
  db: DatabaseContainer['db'];
  logger: Logger;
};

/**
 * Stage 2 integrity analysis over a stored dataset. Read-only against
 * candle data; persists exactly one report row per dataset (replaced on
 * re-validation). Returns null when the dataset does not exist.
 */
export async function runValidation(
  deps: ValidationDeps,
  datasetId: string,
  session: SessionTemplate = DEFAULT_SESSION,
): Promise<IntegrityReport | null> {
  const { db, logger } = deps;
  const datasets = await db
    .select()
    .from(historicalDatasets)
    .where(eq(historicalDatasets.datasetId, datasetId));
  const dataset = datasets[0];
  if (!dataset) {
    return null;
  }

  const rows = await db
    .select()
    .from(historicalCandles)
    .where(eq(historicalCandles.datasetId, datasetId))
    .orderBy(asc(historicalCandles.timestamp));

  const candles: NormalizedCandle[] = rows.map((row) => ({
    timestamp: row.timestamp,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    openInterest: row.openInterest,
  }));

  const ohlcIssues = candles.flatMap(validateCandleOhlc);
  const timestampIssues = validateCandleTimestamps(candles);
  const duplicates = detectDuplicates(candles);
  const conflicts = duplicates.filter((group) => group.conflicting);

  const unit = dataset.unit as HistoricalUnit;
  const expected = expectedSessions(
    dataset.requestedFrom,
    dataset.requestedTo,
    unit,
    dataset.interval,
    session,
  );
  const present = new Set<string | number>();
  for (const candle of candles) {
    present.add(expected.keyOf(candle.timestamp));
  }
  const gaps = expected.values.filter((value) => !present.has(value));
  const expectedSet = new Set<string | number>(expected.values);
  const unexpected = [...present].filter((key) => !expectedSet.has(key));

  const expectedCount = expected.values.length;
  const matchedCount = expectedCount - gaps.length;
  const completeness =
    expectedCount === 0 ? 1 : matchedCount / expectedCount;

  let verdict: IntegrityVerdict = 'VALID';
  if (
    ohlcIssues.length > 0 ||
    timestampIssues.length > 0 ||
    conflicts.length > 0
  ) {
    verdict = 'INVALID';
  } else if (completeness < 1) {
    verdict = 'INCOMPLETE';
  }

  const notes: string[] = [];
  if (unit === 'days') {
    notes.push(
      'Expected sessions are Mon-Fri calendar days; no exchange-holiday calendar exists, so holidays appear as gaps.',
    );
  }
  if (unit === 'minutes' || unit === 'hours') {
    notes.push(
      `Intraday grid assumes ${session.openMin}-${session.closeMin} IST slots; per-exchange templates are a TODO.`,
    );
  }
  if (expectedCount === 0) {
    notes.push('No expected sessions in range; completeness is vacuous.');
  }

  const now = Date.now();
  const report: IntegrityReport = {
    dataset_id: datasetId,
    verdict,
    candle_count: candles.length,
    expected_count: expectedCount,
    matched_count: matchedCount,
    completeness: Number(completeness.toFixed(6)),
    ohlc_issue_count: ohlcIssues.length,
    timestamp_issue_count: timestampIssues.length,
    duplicate_count: duplicates.length,
    conflict_count: conflicts.length,
    gap_count: gaps.length,
    unexpected_count: unexpected.length,
    ohlc_issues: ohlcIssues.slice(0, MAX_STORED_ITEMS),
    timestamp_issues: timestampIssues.slice(0, MAX_STORED_ITEMS),
    duplicates: duplicates.slice(0, MAX_STORED_ITEMS),
    gaps: gaps.slice(0, MAX_STORED_ITEMS),
    unexpected_sample: unexpected.slice(0, 5),
    session_template:
      unit === 'minutes' || unit === 'hours' ? session : null,
    notes,
    schema_version: VALIDATION_SCHEMA_VERSION,
    created_at: now,
    updated_at: now,
  };

  await db
    .insert(validationReports)
    .values({
      datasetId,
      verdict,
      candleCount: report.candle_count,
      expectedCount: report.expected_count,
      matchedCount: report.matched_count,
      completeness: report.completeness,
      details: JSON.stringify(report),
      schemaVersion: VALIDATION_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: validationReports.datasetId,
      set: {
        verdict,
        candleCount: report.candle_count,
        expectedCount: report.expected_count,
        matchedCount: report.matched_count,
        completeness: report.completeness,
        details: JSON.stringify(report),
        schemaVersion: VALIDATION_SCHEMA_VERSION,
        updatedAt: now,
      },
    });

  logger.info('validation_completed', 'Integrity validation completed', {
    datasetId,
    verdict,
    completeness: report.completeness,
  });
  return report;
}

export async function readValidationReport(
  db: DatabaseContainer['db'],
  datasetId: string,
): Promise<IntegrityReport | null> {
  const rows = await db
    .select()
    .from(validationReports)
    .where(eq(validationReports.datasetId, datasetId));
  const row = rows[0];
  if (!row) {
    return null;
  }
  return JSON.parse(row.details) as IntegrityReport;
}
