import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCaptureBatch } from '../src/capture/batch';
import { CaptureStore } from '../src/capture/store';
import type { CaptureBatch } from '../src/capture/types';
import { projectRoot } from '../src/config/env';
import { createDatabase } from '../src/db';
import { removeDirectory } from './test-utils';

let directory = '';
let store: CaptureStore | null = null;

function createStore(): CaptureStore {
  directory = mkdtempSync(join(tmpdir(), 'tradex-store-'));
  store = new CaptureStore(
    directory,
    'capture',
    join(projectRoot, 'drizzle'),
  );
  return store;
}

afterEach(async () => {
  store?.close();
  store = null;
  if (directory) {
    const target = directory;
    directory = '';
    await removeDirectory(target);
  }
});

function batch(feeds: Record<string, unknown>, seed: number): CaptureBatch {
  return buildCaptureBatch({
    response: { type: 1, feeds, currentTs: '1758604202000' },
    rawPayload: new Uint8Array([seed]),
    sourceConnectionId: 'conn-1',
    receivedTs: 1758604202500,
    sessionDate: '2026-09-23',
    feedMode: 'full',
    schemaVersion: 'upstox-v3-raw-1',
  });
}

function sessionClient() {
  return createDatabase(
    join(directory, 'capture', '2026-09-23', 'raw.sqlite'),
  );
}

describe('capture store', () => {
  it('persists one batch row and N instrument rows', () => {
    const capture = createStore();
    const result = capture.writeBatch(
      batch(
        {
          'NSE_EQ|A': { ltpc: { ltp: 1 } },
          'NSE_EQ|B': { ltpc: { ltp: 2 } },
        },
        1,
      ),
    );

    expect(result).toEqual({ batchInserted: true, instrumentRowsInserted: 2 });

    const db = sessionClient();
    try {
      const batches = db.client
        .query('SELECT batch_id, received_ts, current_ts FROM raw_batches')
        .all() as Array<{
        batch_id: string;
        received_ts: number;
        current_ts: number;
      }>;
      expect(batches).toHaveLength(1);
      expect(typeof batches[0]?.received_ts).toBe('number');
      expect(batches[0]?.current_ts).toBe(1758604202000);

      const messages = db.client
        .query(
          'SELECT instrument_key, current_ts, ltt, received_ts, raw_payload FROM raw_market_messages ORDER BY instrument_key',
        )
        .all() as Array<{
        instrument_key: string;
        current_ts: number;
        received_ts: number;
        raw_payload: string;
      }>;
      expect(messages).toHaveLength(2);
      expect(messages[0]?.instrument_key).toBe('NSE_EQ|A');
      // Each instrument row holds only its own feed slice.
      expect(JSON.parse(messages[0]?.raw_payload ?? '')).toEqual({
        ltpc: { ltp: 1 },
      });
      expect(messages[0]?.current_ts).toBe(1758604202000);
      expect(messages[0]?.received_ts).toBe(1758604202500);
    } finally {
      db.client.close();
    }
  });

  it('deduplicates identical batches without losing distinct payloads', () => {
    const capture = createStore();
    const feeds = { 'NSE_EQ|A': { ltpc: { ltp: 1 } } };

    const first = capture.writeBatch(batch(feeds, 1));
    expect(first.batchInserted).toBe(true);

    // Same logical content -> same batch hash -> rejected.
    const duplicate = capture.writeBatch(batch(feeds, 2));
    expect(duplicate).toEqual({
      batchInserted: false,
      instrumentRowsInserted: 0,
    });

    // Different payload at the same timestamp -> kept.
    const changed = capture.writeBatch(batch({ 'NSE_EQ|A': { ltpc: { ltp: 2 } } }, 3));
    expect(changed.batchInserted).toBe(true);
    expect(changed.instrumentRowsInserted).toBe(1);

    const db = sessionClient();
    try {
      const batches = db.client.query('SELECT * FROM raw_batches').all();
      expect(batches).toHaveLength(2);
      const messages = db.client
        .query(
          "SELECT * FROM raw_market_messages WHERE instrument_key = 'NSE_EQ|A'",
        )
        .all();
      expect(messages).toHaveLength(2);
    } finally {
      db.client.close();
    }
  });

  it('records pre-fanout errors with nullable lineage', () => {
    const capture = createStore();
    capture.recordError({
      stage: 'DECODE',
      errorCode: 'MALFORMED_PROTOBUF',
      errorMessage: 'boom',
      receivedTs: 1758604202500,
      sessionDate: '2026-09-23',
      rawPayload: new Uint8Array([1, 2]),
    });

    // Unknown batch id must not violate the foreign key.
    capture.recordError({
      stage: 'DB_WRITE',
      errorCode: 'DB_WRITE_FAILED',
      errorMessage: 'nope',
      batchId: 'missing-batch',
      sessionDate: '2026-09-23',
    });

    const db = sessionClient();
    try {
      const errors = db.client
        .query(
          'SELECT stage, error_code, batch_id, instrument_key FROM capture_errors ORDER BY id',
        )
        .all() as Array<{
        stage: string;
        error_code: string;
        batch_id: string | null;
        instrument_key: string | null;
      }>;
      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatchObject({
        stage: 'DECODE',
        error_code: 'MALFORMED_PROTOBUF',
        batch_id: null,
        instrument_key: null,
      });
      expect(errors[1]?.batch_id).toBeNull();
    } finally {
      db.client.close();
    }
  });
});
