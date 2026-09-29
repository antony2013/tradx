import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { projectRoot } from '../src/config/env';
import { closeDatabase, createDatabase } from '../src/db';
import { runMigrations } from '../src/db/migrate';
import {
  historicalCandles,
  historicalChunks,
  historicalDatasets,
  historicalRawResponses,
} from '../src/db/schema';
import { HistoricalError } from '../src/historical/errors';
import {
  prepareHistoricalDataset,
} from '../src/historical/service';
import { computeDatasetId } from '../src/historical/dataset-id';
import { validateHistoricalRequest } from '../src/historical/validate';
import type { Logger } from '../src/lib/logger';
import { candle, FakeHistoricalClient } from './fake-historical';
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
  const directory = mkdtempSync(join(tmpdir(), 'tradex-hist-'));
  const database = createDatabase(join(directory, 'test.db'));
  runMigrations(database, join(projectRoot, 'drizzle'));
  fixture = { directory, database };
  return fixture;
}

function deps(client: FakeHistoricalClient) {
  if (!fixture) throw new Error('no fixture');
  return {
    db: fixture.database.db,
    client,
    logger: nullLogger,
    config: { schemaVersion: 'test-1' },
  };
}

const baseRequest = {
  instrumentKey: 'NSE_INDEX|Nifty 50',
  from: '2026-07-01',
  to: '2026-09-23',
  interval: '1minute',
  source: 'upstox',
};

afterEach(async () => {
  if (!fixture) return;
  const target = fixture;
  fixture = null;
  await closeDatabase(target.database);
  await removeDirectory(target.directory);
});

describe('historical acquisition service', () => {
  it('acquires an expired key through a single expired chunk', async () => {
    createFixture();
    const client = new FakeHistoricalClient(
      new Map([[0, [{ kind: 'data', candles: [candle('2024-10-01', 100)] }]]]),
    );

    const result = await prepareHistoricalDataset(deps(client), {
      instrumentKey: 'NSE_FO|58422|03-10-2024',
      from: '2024-09-01',
      to: '2024-10-03',
      interval: '1day',
      source: 'upstox',
    });

    expect(result.status).toBe('COMPLETE');
    expect(result.chunks_total).toBe(1);
    expect(result.record_count).toBe(1);
    expect(result.instrument_key).toBe('NSE_FO|58422|03-10-2024');
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      from: '2024-09-01',
      to: '2024-10-03',
      expired: true,
    });

    const { database } = fixture as Fixture;
    const candles = await database.db
      .select()
      .from(historicalCandles)
      .where(eq(historicalCandles.datasetId, result.dataset_id));
    expect(candles).toHaveLength(1);
    expect(candles[0]?.instrumentKey).toBe('NSE_FO|58422|03-10-2024');
  });

  it('acquires chunks sequentially with raw + normalized persistence', async () => {
    createFixture();
    const client = new FakeHistoricalClient(
      new Map([
        [0, [{ kind: 'data', candles: [candle('2026-07-02', 100)] }]],
        [1, [{ kind: 'data', candles: [candle('2026-08-02', 110)] }]],
        [2, [{ kind: 'data', candles: [candle('2026-09-02', 120)] }]],
      ]),
    );

    const result = await prepareHistoricalDataset(deps(client), baseRequest);

    expect(result.status).toBe('COMPLETE');
    expect(result.reused).toBe(false);
    expect(result.chunks_total).toBe(3);
    expect(result.chunks_completed).toBe(3);
    expect(result.record_count).toBe(3);
    // Sequential deterministic order.
    expect(client.calls.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
    expect(client.calls[0]).toMatchObject({
      from: '2026-07-01',
      to: '2026-07-31',
    });

    const { database } = fixture as Fixture;
    const raws = await database.db.select().from(historicalRawResponses);
    expect(raws).toHaveLength(3);
    for (const raw of raws) {
      const body = JSON.parse(raw.rawPayload) as { status: string };
      expect(body.status).toBe('success');
    }
    const candles = await database.db.select().from(historicalCandles);
    expect(candles.map((c) => c.timestamp)).toEqual(
      [...candles.map((c) => c.timestamp)].sort((a, b) => a - b),
    );
    // Only supplied fields stored; open interest absent stays null.
    expect(candles[0]).toMatchObject({ open: 100, openInterest: null });
    const chunks = await database.db.select().from(historicalChunks);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.status).toBe('COMPLETE');
      expect(chunk.responseHash).toBeTruthy();
      expect(chunk.requestedAt).toBeTruthy();
    }
  });

  it('reuses a complete dataset without refetching', async () => {
    createFixture();
    const first = new FakeHistoricalClient(
      new Map([[0, [{ kind: 'data', candles: [candle('2026-09-02', 120)] }]]]),
    );
    const single = { ...baseRequest, from: '2026-09-01', to: '2026-09-23' };
    const created = await prepareHistoricalDataset(deps(first), single);
    expect(created.status).toBe('COMPLETE');

    const second = new FakeHistoricalClient(new Map());
    const reused = await prepareHistoricalDataset(deps(second), single);
    expect(reused.dataset_id).toBe(created.dataset_id);
    expect(reused.reused).toBe(true);
    expect(second.calls).toHaveLength(0);
  });

  it('keeps prior chunks on auth failure and stops without retrying it', async () => {
    createFixture();
    const client = new FakeHistoricalClient(
      new Map([
        [0, [{ kind: 'data', candles: [candle('2026-07-02', 100)] }]],
        [
          1,
          [
            {
              kind: 'error',
              code: 'AUTHENTICATION_ERROR',
              message: 'token expired',
            },
          ],
        ],
        [2, [{ kind: 'data', candles: [candle('2026-09-02', 120)] }]],
      ]),
    );

    await expect(
      prepareHistoricalDataset(deps(client), baseRequest),
    ).rejects.toThrow(HistoricalError);

    // Chunk 2 never attempted; chunk 0 preserved.
    expect(client.calls.map((c) => c.chunkIndex)).toEqual([0, 1]);

    const { database } = fixture as Fixture;
    const datasets = await database.db.select().from(historicalDatasets);
    expect(datasets[0]?.status).toBe('PARTIAL');
    const candles = await database.db.select().from(historicalCandles);
    expect(candles).toHaveLength(1);

    // A later retry with valid auth resumes only the missing chunks.
    const retry = new FakeHistoricalClient(
      new Map([
        [1, [{ kind: 'data', candles: [candle('2026-08-02', 110)] }]],
        [2, [{ kind: 'data', candles: [candle('2026-09-02', 120)] }]],
      ]),
    );
    const resumed = await prepareHistoricalDataset(deps(retry), baseRequest);
    expect(resumed.status).toBe('COMPLETE');
    expect(retry.calls.map((c) => c.chunkIndex)).toEqual([1, 2]);
    const all = await database.db.select().from(historicalCandles);
    expect(all).toHaveLength(3);
  });

  it('marks FAILED when nothing was acquired before auth failure', async () => {
    createFixture();
    const client = new FakeHistoricalClient(
      new Map([
        [
          0,
          [
            {
              kind: 'error',
              code: 'AUTHENTICATION_ERROR',
              message: 'bad token',
            },
          ],
        ],
      ]),
    );
    await expect(
      prepareHistoricalDataset(deps(client), {
        ...baseRequest,
        from: '2026-09-01',
        to: '2026-09-23',
      }),
    ).rejects.toThrow(HistoricalError);

    const { database } = fixture as Fixture;
    const datasets = await database.db.select().from(historicalDatasets);
    expect(datasets[0]?.status).toBe('FAILED');

    // A later retry reuses the same logical dataset id.
    const retry = new FakeHistoricalClient(
      new Map([[0, [{ kind: 'data', candles: [candle('2026-09-02', 120)] }]]]),
    );
    const retried = await prepareHistoricalDataset(deps(retry), {
      ...baseRequest,
      from: '2026-09-01',
      to: '2026-09-23',
    });
    expect(retried.dataset_id).toBe(datasets[0]?.datasetId);
    expect(retried.status).toBe('COMPLETE');
  });

  it('lets one concurrent race winner own the acquisition', async () => {
    createFixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = new FakeHistoricalClient(
      new Map([
        [
          0,
          [
            {
              kind: 'gate',
              gate,
              then: { kind: 'data', candles: [candle('2026-09-02', 120)] },
            },
          ],
        ],
      ]),
    );
    const single = { ...baseRequest, from: '2026-09-01', to: '2026-09-23' };

    const first = prepareHistoricalDataset(deps(client), single);
    // Force overlap: the second request arrives while chunk 0 is in flight.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = prepareHistoricalDataset(deps(client), single);
    release();
    const [winner, loser] = await Promise.all([first, second]);

    expect(winner.dataset_id).toBe(loser.dataset_id);
    expect(loser.reused).toBe(true);
    // Exactly one logical acquisition happened.
    expect(client.calls).toHaveLength(1);

    const { database } = fixture as Fixture;
    const datasets = await database.db.select().from(historicalDatasets);
    expect(datasets).toHaveLength(1);
    expect(datasets[0]?.status).toBe('COMPLETE');
  });

  it('returns a stale RUNNING dataset without competing with it', async () => {
    createFixture();
    const { database } = fixture as Fixture;
    const staleInput = {
      ...baseRequest,
      from: '2026-09-01',
      to: '2026-09-23',
      interval: '1day',
    };
    const staleId = computeDatasetId(validateHistoricalRequest(staleInput));
    await database.db.insert(historicalDatasets).values({
      datasetId: staleId,
      instrumentKey: 'NSE_INDEX|Nifty 50',
      requestedFrom: '2026-09-01',
      requestedTo: '2026-09-23',
      unit: 'days',
      interval: 1,
      source: 'upstox',
      status: 'RUNNING',
      chunksTotal: 1,
      chunksCompleted: 0,
      chunksFailed: 0,
      recordCount: 0,
      schemaVersion: 'test-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const client = new FakeHistoricalClient(new Map());
    const result = await prepareHistoricalDataset(deps(client), staleInput);
    expect(client.calls).toHaveLength(0);
    expect(result.dataset_id).toBe(staleId);
    expect(result.status).toBe('RUNNING');
    expect(result.reused).toBe(true);
  });

  it('resumes partial datasets reusing completed chunks', async () => {
    createFixture();
    const flaky = new FakeHistoricalClient(
      new Map([
        [0, [{ kind: 'data', candles: [candle('2026-07-02', 100)] }]],
        [1, [{ kind: 'error', code: 'UPSTREAM_ERROR' }]],
        [2, [{ kind: 'data', candles: [candle('2026-09-02', 120)] }]],
      ]),
    );
    const partial = await prepareHistoricalDataset(deps(flaky), baseRequest);
    expect(partial.status).toBe('PARTIAL');
    expect(partial.chunks_failed).toBe(1);

    const retry = new FakeHistoricalClient(
      new Map([[1, [{ kind: 'data', candles: [candle('2026-08-02', 110)] }]]]),
    );
    const completed = await prepareHistoricalDataset(deps(retry), baseRequest);
    expect(completed.status).toBe('COMPLETE');
    expect(retry.calls.map((c) => c.chunkIndex)).toEqual([1]);

    const { database } = fixture as Fixture;
    const candles = await database.db.select().from(historicalCandles);
    expect(candles).toHaveLength(3);
    const raws = await database.db.select().from(historicalRawResponses);
    expect(raws).toHaveLength(3);
  });

  it('persists an 8,200-row chunk in batches without hitting bound limits', async () => {
    createFixture();
    const base = Date.parse('2026-09-01T00:00:00Z');
    // 11 columns x 8,200 rows = 90,200 params: a single INSERT would fail.
    const candles = Array.from({ length: 8200 }, (_, i) => ({
      timestamp: base + i * 60000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
      openInterest: null,
    }));
    const client = new FakeHistoricalClient(
      new Map([[0, [{ kind: 'data', candles }]]]),
    );

    const result = await prepareHistoricalDataset(deps(client), {
      ...baseRequest,
      from: '2026-09-01',
      to: '2026-09-23',
    });

    expect(result.status).toBe('COMPLETE');
    expect(result.chunks_total).toBe(1);
    expect(result.record_count).toBe(8200);

    const { database } = fixture as Fixture;
    const stored = await database.db
      .select()
      .from(historicalCandles)
      .where(eq(historicalCandles.datasetId, result.dataset_id));
    expect(stored).toHaveLength(8200);
  });

  it('rolls back the whole chunk when a late batch fails', async () => {
    createFixture();
    const base = Date.parse('2026-09-01T00:00:00Z');
    const candles = Array.from({ length: 8000 }, (_, i) => ({
      timestamp: base + i * 60000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
      openInterest: null,
    }));
    // Poison a row in the LAST batch (index 7,500 of 8,000 at 500/batch):
    // batches 1-15 insert fine, then the transaction must roll back all.
    candles[7500] = {
      timestamp: null as unknown as number,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
      openInterest: null,
    };
    const client = new FakeHistoricalClient(
      new Map([[0, [{ kind: 'data', candles }]]]),
    );

    const result = await prepareHistoricalDataset(deps(client), {
      ...baseRequest,
      from: '2026-09-01',
      to: '2026-09-23',
    });

    expect(result.status).toBe('PARTIAL');
    expect(result.record_count).toBe(0);

    const { database } = fixture as Fixture;
    const stored = await database.db
      .select()
      .from(historicalCandles)
      .where(eq(historicalCandles.datasetId, result.dataset_id));
    expect(stored).toHaveLength(0);
    const chunks = await database.db
      .select()
      .from(historicalChunks)
      .where(eq(historicalChunks.datasetId, result.dataset_id));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.status).toBe('FAILED');
    const raws = await database.db
      .select()
      .from(historicalRawResponses)
      .where(eq(historicalRawResponses.datasetId, result.dataset_id));
    expect(raws).toHaveLength(0);
  });
});
