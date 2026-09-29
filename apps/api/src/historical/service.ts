import { and, asc, count, eq } from 'drizzle-orm';
import type { DatabaseContainer } from '../db';
import {
  historicalCandles,
  historicalChunks,
  historicalDatasets,
  historicalRawResponses,
} from '../db/schema';
import type { Logger } from '../lib/logger';
import { splitDateRange } from './chunks';
import { computeDatasetId } from './dataset-id';
import { HistoricalError, isUniqueViolation } from './errors';
import type {
  ChunkStatus,
  DatasetStatus,
  HistoricalClient,
  HistoricalRequestInput,
  HistoricalResult,
  ValidatedHistoricalRequest,
} from './types';
import { validateHistoricalRequest } from './validate';

export type HistoricalServiceConfig = {
  schemaVersion: string;
  /**
   * Stale-run lease (ms). Optional in code, required via env at the route
   * layer; defaults to DEFAULT_STALE_AFTER_MS so unit fixtures stay small.
   */
  staleAfterMs?: number;
  /**
   * Max overlapping chunk fetches. Persistence needs no lock: the event
   * loop serializes the synchronous, single-transaction chunk writes.
   * Defaults to DEFAULT_FETCH_CONCURRENCY.
   */
  fetchConcurrency?: number;
};

/** Default stale-run lease: 15 minutes without progress. */
export const DEFAULT_STALE_AFTER_MS = 900000;

/** Default chunk fetch parallelism. */
export const DEFAULT_FETCH_CONCURRENCY = 3;

// Rows per candle INSERT inside a chunk transaction: 500 rows x 11 columns
// stays far below SQLite's bound-parameter ceiling.
export const CANDLE_INSERT_BATCH_SIZE = 500;

export type HistoricalServiceDeps = {
  db: DatabaseContainer['db'];
  client: HistoricalClient;
  logger: Logger;
  config: HistoricalServiceConfig;
};

type DatasetRow = typeof historicalDatasets.$inferSelect;
type ChunkRow = typeof historicalChunks.$inferSelect;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function errorCode(error: unknown): string {
  return error instanceof HistoricalError ? error.code : 'UPSTREAM_ERROR';
}

/**
 * Lease check for a non-owned RUNNING/PENDING dataset.
 *
 * Live = a RUNNING chunk with a fresh start stamp, or a recently stamped
 * dataset row (claim/resume/chunk-outcome heartbeat). Anything else older
 * than the lease is a crashed run and becomes resumable.
 *
 * Residual risk (documented, benign): a live fetch slower than the lease
 * looks dead and gets a redundant twin. Twin writes are idempotent
 * (UNIQUE + onConflictDoNothing), so the only cost is duplicate upstream
 * calls — never corrupt data, never a third competitor (the twin stamps
 * fresh heartbeats, so further arrivals see a live run).
 */
async function hasLiveProgress(
  db: DatabaseContainer['db'],
  dataset: DatasetRow,
  staleAfterMs: number,
): Promise<boolean> {
  const now = Date.now();
  if (now - dataset.updatedAt < staleAfterMs) {
    return true;
  }
  const chunks = await db
    .select({ status: historicalChunks.status, requestedAt: historicalChunks.requestedAt })
    .from(historicalChunks)
    .where(eq(historicalChunks.datasetId, dataset.datasetId));
  return chunks.some(
    (chunk) =>
      chunk.status === 'RUNNING' &&
      chunk.requestedAt !== null &&
      now - chunk.requestedAt < staleAfterMs,
  );
}

/**
 * Stage 1 acquisition: validate -> deterministic id -> claim-or-reconcile
 * via the UNIQUE(dataset_id) row -> sequential chunk acquisition ->
 * raw + normalized persistence -> metadata.
 *
 * Concurrency is guarded by the database UNIQUE constraint, never by
 * check-then-insert alone. The loser of a claim race re-reads the winner's
 * row and returns/reuses/resumes it without starting a second acquisition.
 *
 * Stale RUNNING/PENDING rows (crashed runs past the lease) are taken over
 * via the same resume path; see hasLiveProgress. Manual recovery docs in
 * README remain valid for operator-driven repair.
 */
export async function prepareHistoricalDataset(
  deps: HistoricalServiceDeps,
  input: HistoricalRequestInput,
): Promise<HistoricalResult> {
  const { db, client, logger, config } = deps;
  const request = validateHistoricalRequest(input);
  const datasetId = computeDatasetId(request);

  logger.info('historical_request_started', 'Historical request started', {
    datasetId,
    instrumentKey: request.instrumentKey,
    from: request.from,
    to: request.to,
    unit: request.unit,
    interval: request.interval,
    source: request.source,
  });

  const claimed = await claimDataset(db, logger, config, datasetId, request);
  let dataset = claimed.dataset;

  if (!claimed.owned) {
    if (dataset.status === 'COMPLETE') {
      logger.info('dataset_reused', 'Reusing complete dataset', {
        datasetId,
      });
      return toResult(dataset, true);
    }
    if (dataset.status === 'RUNNING' || dataset.status === 'PENDING') {
      const staleAfterMs = config.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
      if (await hasLiveProgress(db, dataset, staleAfterMs)) {
        // A live acquisition owns this dataset. Never compete with it.
        logger.info('dataset_reused', 'Existing acquisition in progress', {
          datasetId,
          status: dataset.status,
        });
        return toResult(dataset, true);
      }
      logger.info('dataset_stale_takeover', 'Stale run past the lease; taking over', {
        datasetId,
        status: dataset.status,
      });
      // Fall through to the resume path below: non-COMPLETE chunks reset
      // to PENDING, counters recount from COMPLETE rows.
    } else {
      logger.info('dataset_resume_started', 'Resuming dataset', {
        datasetId,
        status: dataset.status,
      });
    }
    // Reset every non-complete chunk (a crash may leave RUNNING rows).
    // COMPLETE chunks are never touched: their data is reused as-is.
    // Counters restart from the reused COMPLETE rows so the resumed run
    // accumulates correct totals.
    const incomplete = await db
      .select()
      .from(historicalChunks)
      .where(eq(historicalChunks.datasetId, datasetId));
    let alreadyCompleted = 0;
    for (const chunk of incomplete) {
      if (chunk.status === 'COMPLETE') {
        alreadyCompleted += 1;
      } else {
        await db
          .update(historicalChunks)
          .set({ status: 'PENDING', errorCode: null, errorMessage: null })
          .where(eq(historicalChunks.id, chunk.id));
      }
    }
    await db
      .update(historicalDatasets)
      .set({
        status: 'RUNNING',
        chunksCompleted: alreadyCompleted,
        chunksFailed: 0,
        updatedAt: Date.now(),
      })
      .where(eq(historicalDatasets.datasetId, datasetId));
    dataset = await readDatasetOrThrow(db, datasetId);
  }

  const pending = await db
    .select()
    .from(historicalChunks)
    .where(
      and(
        eq(historicalChunks.datasetId, datasetId),
        eq(historicalChunks.status, 'PENDING'),
      ),
    )
    .orderBy(asc(historicalChunks.chunkIndex));

  let completed = dataset.chunksCompleted;
  let failed = dataset.chunksFailed;
  let authHalt = false;

  // Bounded worker pool over pending chunks. Only FETCHES overlap; each
  // chunk's persistence is one synchronous transaction, so writes never
  // interleave. Totals are order-free (UNIQUE + recount at finalize), so
  // the result is identical to sequential. AUTH_HALT stops new fetches;
  // in-flight chunks settle, then the dataset finalizes halted.
  const queue = [...pending];
  const workerCount = Math.max(
    1,
    Math.min(config.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY, queue.length),
  );
  const runWorker = async (): Promise<void> => {
    while (queue.length > 0) {
      if (authHalt) {
        return;
      }
      const chunk = queue.shift() as ChunkRow;
      const outcome = await acquireChunk(deps, datasetId, request, chunk);
      // Halt flag FIRST and synchronously: anything already in flight
      // settles, but no worker starts another fetch after this point.
      if (outcome === 'AUTH_HALT') {
        authHalt = true;
      }
      if (outcome === 'COMPLETE') {
        completed += 1;
      } else {
        failed += 1;
      }
      await db
        .update(historicalDatasets)
        .set({
          chunksCompleted: completed,
          chunksFailed: failed,
          updatedAt: Date.now(),
        })
        .where(eq(historicalDatasets.datasetId, datasetId));
    }
  };
  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker()),
  );

  if (authHalt) {
    const terminal: DatasetStatus = completed > 0 ? 'PARTIAL' : 'FAILED';
    const finished = await finalizeDataset(db, datasetId, terminal);
    logger.info(
      terminal === 'PARTIAL' ? 'dataset_partial' : 'dataset_completed',
      `Dataset ${terminal} after authentication failure`,
      { datasetId },
    );
    throw new HistoricalError(
      'AUTHENTICATION_ERROR',
      'Upstox authentication failed; provide a valid access token and retry',
    );
  }

  const terminal: DatasetStatus = failed === 0 ? 'COMPLETE' : 'PARTIAL';
  const finished = await finalizeDataset(db, datasetId, terminal);
  logger.info(
    terminal === 'COMPLETE' ? 'dataset_completed' : 'dataset_partial',
    `Dataset ${terminal}`,
    {
      datasetId,
      chunksCompleted: completed,
      chunksFailed: failed,
      recordCount: finished.recordCount,
    },
  );
  return toResult(finished, !claimed.owned);
}

async function claimDataset(
  db: DatabaseContainer['db'],
  logger: Logger,
  config: HistoricalServiceConfig,
  datasetId: string,
  request: ValidatedHistoricalRequest,
): Promise<{ dataset: DatasetRow; owned: boolean }> {
  const existing = await readDataset(db, datasetId);
  if (existing) {
    return { dataset: existing, owned: false };
  }

  const now = Date.now();
  try {
    await db.insert(historicalDatasets).values({
      datasetId,
      instrumentKey: request.instrumentKey,
      requestedFrom: request.from,
      requestedTo: request.to,
      unit: request.unit,
      interval: request.interval,
      source: request.source,
      status: 'PENDING',
      chunksTotal: 0,
      chunksCompleted: 0,
      chunksFailed: 0,
      recordCount: 0,
      schemaVersion: config.schemaVersion,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    logger.info('dataset_reused', 'Lost dataset claim race; reconciling', {
      datasetId,
    });
    return { dataset: await readDatasetOrThrow(db, datasetId), owned: false };
  }

  logger.info('dataset_created', 'Dataset claimed', { datasetId });
  // Expired contracts fetch through a single wide-range request —
  // the expired-candles API accepts multi-year spans directly.
  const chunks = request.expired
    ? [{ index: 0, from: request.from, to: request.to }]
    : splitDateRange(
        request.from,
        request.to,
        request.unit,
        request.interval,
      );
  if (chunks.length > 0) {
    // Idempotent: a crash between dataset insert and chunk insert (or
    // leftover rows) must resume, not 500 on UNIQUE(dataset, index).
    await db
      .insert(historicalChunks)
      .values(
        chunks.map((chunk) => ({
          datasetId,
          chunkIndex: chunk.index,
          chunkFrom: chunk.from,
          chunkTo: chunk.to,
          status: 'PENDING' as ChunkStatus,
          attempts: 0,
          recordCount: 0,
        })),
      )
      .onConflictDoNothing();
  }
  await db
    .update(historicalDatasets)
    .set({ status: 'RUNNING', chunksTotal: chunks.length, updatedAt: Date.now() })
    .where(eq(historicalDatasets.datasetId, datasetId));

  return { dataset: await readDatasetOrThrow(db, datasetId), owned: true };
}

async function acquireChunk(
  deps: HistoricalServiceDeps,
  datasetId: string,
  request: ValidatedHistoricalRequest,
  chunk: ChunkRow,
): Promise<'COMPLETE' | 'FAILED' | 'AUTH_HALT'> {  const { db, client, logger } = deps;
  const chunkRef = `chunk ${chunk.chunkIndex} [${chunk.chunkFrom}..${chunk.chunkTo}]`;

  await db
    .update(historicalChunks)
    .set({
      status: 'RUNNING',
      attempts: chunk.attempts + 1,
      requestedAt: Date.now(),
      errorCode: null,
      errorMessage: null,
    })
    .where(eq(historicalChunks.id, chunk.id));
  logger.info('chunk_started', `Chunk started ${chunkRef}`, {
    datasetId,
    chunkIndex: chunk.chunkIndex,
  });

  try {
    const fetched = request.expired
      ? await client.fetchExpiredChunk({
          expiredKey: request.instrumentKey,
          unit: request.unit,
          interval: request.interval,
          from: chunk.chunkFrom,
          to: chunk.chunkTo,
          datasetId,
          chunkIndex: chunk.chunkIndex,
        })
      : await client.fetchChunk({
          instrumentKey: request.instrumentKey,
          unit: request.unit,
          interval: request.interval,
          from: chunk.chunkFrom,
          to: chunk.chunkTo,
          datasetId,
          chunkIndex: chunk.chunkIndex,
        });

    // One transaction per chunk: raw response + ALL candle batches + the
    // COMPLETE stamp commit atomically. Candle inserts are batched because
    // a single .values() call with full-chunk rows exceeds SQLite's bound
    // parameter limit (a 1-minute month is ~8,000 rows x 11 columns).
    // NOTE: the callback MUST stay synchronous with .run() — bun:sqlite
    // native transactions cannot span awaits (statements after the first
    // await run in autocommit). Any throw rolls everything back: zero
    // partial candles, chunk stays non-COMPLETE so resume/retry re-fetches
    // it cleanly.
    const candleRows = fetched.candles.map((candle) => ({
      datasetId,
      instrumentKey: request.instrumentKey,
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      openInterest: candle.openInterest,
      unit: request.unit,
      interval: request.interval,
    }));
    // Awaited (not merely called): the vitest better-sqlite3 shim wraps
    // transactions in an async function, so only await propagates a
    // mid-chunk throw back into the catch below on both runners.
    await db.transaction((tx) => {
      tx.insert(historicalRawResponses)
        .values({
          datasetId,
          chunkIndex: chunk.chunkIndex,
          rawPayload: fetched.rawText,
          responseHash: fetched.responseHash,
          acquiredAt: Date.now(),
        })
        .onConflictDoNothing()
        .run();
      for (
        let offset = 0;
        offset < candleRows.length;
        offset += CANDLE_INSERT_BATCH_SIZE
      ) {
        tx.insert(historicalCandles)
          .values(candleRows.slice(offset, offset + CANDLE_INSERT_BATCH_SIZE))
          .onConflictDoNothing()
          .run();
      }
      tx.update(historicalChunks)
        .set({
          status: 'COMPLETE',
          recordCount: fetched.candles.length,
          responseHash: fetched.responseHash,
          respondedAt: fetched.respondedAt,
        })
        .where(eq(historicalChunks.id, chunk.id))
        .run();
    });
    logger.info('chunk_completed', `Chunk completed ${chunkRef}`, {
      datasetId,
      chunkIndex: chunk.chunkIndex,
      recordCount: fetched.candles.length,
    });
    return 'COMPLETE';
  } catch (error) {
    const code = errorCode(error);
    const message = errorMessage(error);
    await db
      .update(historicalChunks)
      .set({ status: 'FAILED', errorCode: code, errorMessage: message })
      .where(eq(historicalChunks.id, chunk.id));
    logger.warn('chunk_failed', `Chunk failed ${chunkRef}`, {
      datasetId,
      chunkIndex: chunk.chunkIndex,
      errorCode: code,
    });
    if (code === 'AUTHENTICATION_ERROR') {
      logger.error('authentication_failed', 'Upstox authentication failed', {
        datasetId,
        chunkIndex: chunk.chunkIndex,
      });
      return 'AUTH_HALT';
    }
    return 'FAILED';
  }
}

async function finalizeDataset(
  db: DatabaseContainer['db'],
  datasetId: string,
  status: DatasetStatus,
): Promise<DatasetRow> {
  const countRows = await db
    .select({ value: count() })
    .from(historicalCandles)
    .where(eq(historicalCandles.datasetId, datasetId));
  const recordCount = countRows[0]?.value ?? 0;
  await db
    .update(historicalDatasets)
    .set({ status, recordCount, updatedAt: Date.now() })
    .where(eq(historicalDatasets.datasetId, datasetId));
  return readDatasetOrThrow(db, datasetId);
}

async function readDataset(
  db: DatabaseContainer['db'],
  datasetId: string,
): Promise<DatasetRow | null> {
  const rows = await db
    .select()
    .from(historicalDatasets)
    .where(eq(historicalDatasets.datasetId, datasetId));
  return rows[0] ?? null;
}

async function readDatasetOrThrow(
  db: DatabaseContainer['db'],
  datasetId: string,
): Promise<DatasetRow> {
  const dataset = await readDataset(db, datasetId);
  if (!dataset) {
    throw new HistoricalError(
      'UPSTREAM_ERROR',
      'Dataset row missing after claim',
    );
  }
  return dataset;
}

function toResult(dataset: DatasetRow, reused: boolean): HistoricalResult {
  return {
    dataset_id: dataset.datasetId,
    instrument_key: dataset.instrumentKey,
    requested_from: dataset.requestedFrom,
    requested_to: dataset.requestedTo,
    unit: dataset.unit as HistoricalResult['unit'],
    interval: dataset.interval,
    source: dataset.source as HistoricalResult['source'],
    status: dataset.status as DatasetStatus,
    chunks_total: dataset.chunksTotal,
    chunks_completed: dataset.chunksCompleted,
    chunks_failed: dataset.chunksFailed,
    record_count: dataset.recordCount,
    schema_version: dataset.schemaVersion,
    created_at: dataset.createdAt,
    updated_at: dataset.updatedAt,
    reused,
  };
}

export async function readHistoricalDataset(
  db: DatabaseContainer['db'],
  datasetId: string,
): Promise<HistoricalResult | null> {
  const dataset = await readDataset(db, datasetId);
  return dataset ? toResult(dataset, true) : null;
}
