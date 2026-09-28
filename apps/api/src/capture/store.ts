import { resolve } from 'node:path';
import { createDatabase, type DatabaseContainer } from '../db';
import { runMigrations } from '../db/migrate';
import type {
  CaptureBatch,
  CaptureErrorInput,
  CaptureStoreAdapter,
  WriteBatchResult,
} from './types';

type SqliteClient = DatabaseContainer['client'];

export class CaptureStore implements CaptureStoreAdapter {
  private readonly databases = new Map<string, SqliteClient>();
  private closed = false;

  constructor(
    private readonly projectRoot: string,
    private readonly captureRoot: string,
    private readonly migrationsFolder: string,
  ) {}

  writeBatch(batch: CaptureBatch): WriteBatchResult {
    return this.writeBatches([batch])[0] ?? {
      batchInserted: false,
      instrumentRowsInserted: 0,
    };
  }

  writeBatches(batches: CaptureBatch[]): WriteBatchResult[] {
    if (this.closed || batches.length === 0) {
      return batches.map(() => ({
        batchInserted: false,
        instrumentRowsInserted: 0,
      }));
    }

    const grouped = new Map<string, CaptureBatch[]>();
    for (const batch of batches) {
      const rows = grouped.get(batch.sessionDate) ?? [];
      rows.push(batch);
      grouped.set(batch.sessionDate, rows);
    }

    const results: WriteBatchResult[] = [];
    for (const [sessionDate, sessionBatches] of grouped) {
      const client = this.databaseFor(sessionDate);
      // bun:sqlite transaction() returns a callable — invoke it to run.
      const sessionResults = client.transaction(() =>
        sessionBatches.map((batch) => this.writeOne(client, batch)),
      )();
      results.push(...(sessionResults as WriteBatchResult[]));
    }
    return results;
  }

  recordError(error: CaptureErrorInput): void {
    if (this.closed) {
      return;
    }

    const sessionDate = error.sessionDate ?? 'unknown';
    const client = this.databaseFor(sessionDate);
    const rawPayload =
      typeof error.rawPayload === 'string'
        ? error.rawPayload
        : error.rawPayload === undefined
          ? null
          : Buffer.from(error.rawPayload).toString('base64');

    const insert = (batchId: string | null | undefined) => {
      client
        .query(
          `INSERT INTO capture_errors (
            source_connection_id,
            batch_id,
            instrument_key,
            received_ts,
            session_date,
            stage,
            error_code,
            error_message,
            raw_payload,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          error.sourceConnectionId ?? null,
          batchId ?? null,
          error.instrumentKey ?? null,
          error.receivedTs ?? null,
          sessionDate,
          error.stage,
          error.errorCode,
          error.errorMessage,
          rawPayload,
          Date.now(),
        );
    };

    try {
      insert(error.batchId);
    } catch (errorValue) {
      if (
        error.batchId &&
        errorValue instanceof Error &&
        errorValue.message.includes('FOREIGN KEY')
      ) {
        insert(null);
        return;
      }
      throw errorValue;
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const client of this.databases.values()) {
      client.close();
    }
    this.databases.clear();
  }

  private writeOne(client: SqliteClient, batch: CaptureBatch): WriteBatchResult {
    const createdAt = Date.now();
    const batchResult = client
      .query(
        `INSERT INTO raw_batches (
          batch_id,
          source_connection_id,
          received_ts,
          current_ts,
          session_date,
          feed_mode,
          schema_version,
          batch_hash,
          raw_payload,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(batch_hash) DO NOTHING`,
      )
      .run(
        batch.batchId,
        batch.sourceConnectionId,
        batch.receivedTs,
        batch.currentTs ?? null,
        batch.sessionDate,
        batch.feedMode,
        batch.schemaVersion,
        batch.batchHash,
        batch.rawPayload,
        createdAt,
      );

    const batchInserted = (batchResult.changes ?? 0) > 0;
    if (!batchInserted) {
      return { batchInserted: false, instrumentRowsInserted: 0 };
    }

    let instrumentRowsInserted = 0;
    for (const instrument of batch.instruments) {
      const result = client
        .query(
          `INSERT INTO raw_market_messages (
            batch_id,
            instrument_key,
            current_ts,
            ltt,
            received_ts,
            session_date,
            feed_mode,
            schema_version,
            instrument_payload_hash,
            raw_payload,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(instrument_key, current_ts, instrument_payload_hash) DO NOTHING`,
        )
        .run(
          batch.batchId,
          instrument.instrumentKey,
          instrument.currentTs ?? null,
          instrument.ltt ?? null,
          batch.receivedTs,
          batch.sessionDate,
          batch.feedMode,
          batch.schemaVersion,
          instrument.payloadHash,
          JSON.stringify(instrument.payload) ?? 'null',
          createdAt,
        );
      instrumentRowsInserted += result.changes ?? 0;
    }

    return { batchInserted, instrumentRowsInserted };
  }

  private databaseFor(sessionDate: string): SqliteClient {
    if (!this.databases.has(sessionDate)) {
      const databasePath = resolve(
        this.projectRoot,
        this.captureRoot,
        sessionDate,
        'raw.sqlite',
      );
      const database = createDatabase(databasePath);
      // MVP durability/throughput tradeoff (see README):
      // WAL + synchronous=NORMAL gives normal crash recovery, but very
      // recent WAL transactions may be lost on OS/power failure.
      // exec() is used instead of a pragma helper so both bun:sqlite
      // and the node:sqlite test shim work.
      database.client.exec('PRAGMA foreign_keys = ON');
      database.client.exec('PRAGMA journal_mode = WAL');
      database.client.exec('PRAGMA synchronous = NORMAL');
      runMigrations(database, this.migrationsFolder);
      this.databases.set(sessionDate, database.client);
    }
    return this.databases.get(sessionDate) as SqliteClient;
  }
}
