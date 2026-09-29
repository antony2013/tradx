import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { projectRoot } from '../src/config/env';
import { closeDatabase, createDatabase } from '../src/db';
import { runMigrations } from '../src/db/migrate';
import { historicalCandles, historicalDatasets } from '../src/db/schema';
import {
  readValidationReport,
  runValidation,
} from '../src/historical/validation';
import type { Logger } from '../src/lib/logger';
import { removeDirectory } from './test-utils';

const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

type Fixture = {
  directory: string;
  database: ReturnType<typeof createDatabase>;
};

let fixture: Fixture | null = null;

function createFixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'tradex-val-'));
  const database = createDatabase(join(directory, 'test.db'));
  runMigrations(database, join(projectRoot, 'drizzle'));
  fixture = { directory, database };
  return fixture;
}

async function seedDataset(
  database: Fixture['database'],
  datasetId: string,
  candles: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>,
  overrides: { instrumentKey?: string; from?: string; to?: string } = {},
) {
  await database.db.insert(historicalDatasets).values({
    datasetId,
    instrumentKey: overrides.instrumentKey ?? 'NSE_INDEX|Nifty 50',
    requestedFrom: overrides.from ?? '2026-09-14',
    requestedTo: overrides.to ?? '2026-09-18',
    unit: 'days',
    interval: 1,
    source: 'upstox',
    status: 'COMPLETE',
    chunksTotal: 1,
    chunksCompleted: 1,
    chunksFailed: 0,
    recordCount: candles.length,
    schemaVersion: 'test-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (candles.length > 0) {
    await database.db.insert(historicalCandles).values(
      candles.map((c) => ({
        datasetId,
        instrumentKey: 'NSE_INDEX|Nifty 50',
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        openInterest: null,
        unit: 'days',
        interval: 1,
      })),
    );
  }
}

const day = (iso: string) => Date.parse(`${iso}T00:00:00+05:30`);
const clean = (iso: string, open = 100) => ({
  timestamp: day(iso),
  open,
  high: open + 10,
  low: open - 10,
  close: open + 5,
  volume: 1000,
});

afterEach(async () => {
  if (!fixture) return;
  const target = fixture;
  fixture = null;
  await closeDatabase(target.database);
  await removeDirectory(target.directory);
});

describe('validation service', () => {
  it('verdicts VALID for a clean complete week', async () => {
    const { database } = createFixture();
    await seedDataset(database, 'd-valid', [
      clean('2026-09-14'),
      clean('2026-09-15'),
      clean('2026-09-16'),
      clean('2026-09-17'),
      clean('2026-09-18'),
    ]);

    const report = await runValidation(
      { db: database.db, logger: nullLogger },
      'd-valid',
    );
    expect(report?.verdict).toBe('VALID');
    expect(report?.completeness).toBe(1);
    expect(report?.gap_count).toBe(0);

    const stored = await readValidationReport(database.db, 'd-valid');
    expect(stored?.verdict).toBe('VALID');
  });

  it('verdicts INCOMPLETE with gaps when a weekday is missing', async () => {
    const { database } = createFixture();
    await seedDataset(database, 'd-gap', [
      clean('2026-09-14'),
      clean('2026-09-15'),
      clean('2026-09-17'),
      clean('2026-09-18'),
    ]);

    const report = await runValidation(
      { db: database.db, logger: nullLogger },
      'd-gap',
    );
    expect(report?.verdict).toBe('INCOMPLETE');
    expect(report?.gaps).toEqual(['2026-09-16']);
    expect(report?.completeness).toBe(0.8);
  });

  it('verdicts INVALID on OHLC violations', async () => {
    const { database } = createFixture();
    await seedDataset(database, 'd-bad', [
      clean('2026-09-14'),
      clean('2026-09-15'),
      { ...clean('2026-09-16'), high: 10, low: 90 },
      clean('2026-09-17'),
      clean('2026-09-18'),
    ]);

    const report = await runValidation(
      { db: database.db, logger: nullLogger },
      'd-bad',
    );
    expect(report?.verdict).toBe('INVALID');
    expect(report?.ohlc_issue_count).toBeGreaterThan(0);
  });

  it('returns null for unknown datasets and replaces reports on re-run', async () => {    const { database } = createFixture();
    expect(
      await runValidation({ db: database.db, logger: nullLogger }, 'nope'),
    ).toBeNull();

    await seedDataset(database, 'd-re', [clean('2026-09-14')]);
    const first = await runValidation(
      { db: database.db, logger: nullLogger },
      'd-re',
    );
    expect(first?.verdict).toBe('INCOMPLETE');
    const second = await runValidation(
      { db: database.db, logger: nullLogger },
      'd-re',
    );
    expect(second?.verdict).toBe('INCOMPLETE');
    expect(second?.created_at).toBeGreaterThanOrEqual(
      first?.created_at as number,
    );
  });

  it('verdicts VALID when the only missing day is an exchange holiday', async () => {
    const { database } = createFixture();
    // Mon 2026-09-28 .. Fri 2026-10-02; Fri is Gandhi Jayanti (real 2026
    // NSE holiday). Data covers Mon-Thu only.
    await seedDataset(
      database,
      'd-holiday',
      [
        clean('2026-09-28'),
        clean('2026-09-29'),
        clean('2026-09-30'),
        clean('2026-10-01'),
      ],
      { from: '2026-09-28', to: '2026-10-02' },
    );

    const holidays = {
      getClosedDates: async () => ({
        dates: new Set(['2026-10-02']),
        calendar: 'applied' as const,
      }),
    };
    const report = await runValidation(
      { db: database.db, logger: nullLogger, holidays },
      'd-holiday',
    );
    expect(report?.verdict).toBe('VALID');
    expect(report?.completeness).toBe(1);
    expect(report?.gap_count).toBe(0);
    expect(report?.holiday_calendar).toBe('applied');
    expect(report?.notes.some((n) => n.includes('2026-10-02') || n.includes('1 exchange-closed'))).toBe(true);
  });

  it('still verdicts INCOMPLETE for a real weekday gap with holidays applied', async () => {
    const { database } = createFixture();
    await seedDataset(
      database,
      'd-real-gap',
      [clean('2026-09-28'), clean('2026-09-30'), clean('2026-10-01')],
      { from: '2026-09-28', to: '2026-10-02' },
    );

    const holidays = {
      getClosedDates: async () => ({
        dates: new Set(['2026-10-02']),
        calendar: 'applied' as const,
      }),
    };
    const report = await runValidation(
      { db: database.db, logger: nullLogger, holidays },
      'd-real-gap',
    );
    expect(report?.verdict).toBe('INCOMPLETE');
    expect(report?.gaps).toEqual(['2026-09-29']);
  });

  it('falls back to weekdays with a note when the provider fails', async () => {
    const { database } = createFixture();
    await seedDataset(
      database,
      'd-nocal',
      [
        clean('2026-09-28'),
        clean('2026-09-29'),
        clean('2026-09-30'),
        clean('2026-10-01'),
      ],
      { from: '2026-09-28', to: '2026-10-02' },
    );

    const failing = {
      getClosedDates: async () => ({
        dates: new Set<string>(),
        calendar: 'unavailable' as const,
        note: 'Holiday calendar unavailable (test); plain weekdays used.',
      }),
    };
    const report = await runValidation(
      { db: database.db, logger: nullLogger, holidays: failing },
      'd-nocal',
    );
    expect(report?.verdict).toBe('INCOMPLETE');
    expect(report?.holiday_calendar).toBe('unavailable');
    expect(report?.notes.some((n) => n.includes('unavailable'))).toBe(true);
  });

  it('marks unavailable when no provider is configured', async () => {
    const { database } = createFixture();
    await seedDataset(database, 'd-noprov', [clean('2026-09-14')]);

    const report = await runValidation(
      { db: database.db, logger: nullLogger },
      'd-noprov',
    );
    expect(report?.holiday_calendar).toBe('unavailable');
  });
});
