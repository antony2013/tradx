import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashCanonical } from '../src/capture/canonical';
import { RawCaptureService } from '../src/capture/service';
import { CaptureStore } from '../src/capture/store';
import type { Logger } from '../src/lib/logger';
import { projectRoot } from '../src/config/env';
import { createDatabase } from '../src/db';
import {
  encodeFeed,
  encodeFeedResponse,
  encodeLtpc,
} from './encode-feed';
import { FakeCaptureSource } from './fake-source';
import { removeDirectory } from './test-utils';

// Tuesday 2026-09-22 10:00 IST (UTC+5:30).
const RECEIVED_TS = Date.UTC(2026, 8, 22, 4, 30, 0, 0);

const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function twoInstrumentBatch(): Uint8Array {
  return encodeFeedResponse({
    type: 2,
    currentTs: 1758604202000,
    feeds: {
      'NSE_EQ|INE002A01018': encodeFeed(
        encodeLtpc({ ltp: 2431.5, ltt: 1758604200000, ltq: 10, cp: 2400 }),
      ),
      'NSE_EQ|INE238A01034': encodeFeed(
        encodeLtpc({ ltp: 512.25, ltt: 1758604201000, ltq: 5, cp: 500 }),
      ),
    },
  });
}

type Fixture = {
  directory: string;
  store: CaptureStore;
  service: RawCaptureService;
  source: FakeCaptureSource;
};

let fixture: Fixture | null = null;

function createFixture(
  overrides: Partial<{
    queueCapacity: number;
    backpressureTimeoutMs: number;
    flushIntervalMs: number;
  }> = {},
): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'tradex-svc-'));
  const store = new CaptureStore(
    directory,
    'capture',
    join(projectRoot, 'drizzle-capture'),
  );
  const source = new FakeCaptureSource('test-connection-1');
  const service = new RawCaptureService({
    config: {
      enabled: true,
      feedMode: 'full',
      schemaVersion: 'upstox-v3-raw-1',
      queueCapacity: overrides.queueCapacity ?? 100,
      maxWriteBatchSize: 10,
      flushIntervalMs: overrides.flushIntervalMs ?? 10,
      backpressureTimeoutMs: overrides.backpressureTimeoutMs ?? 1000,
    },
    store,
    source,
    logger: nullLogger,
  });
  fixture = { directory, store, service, source };
  return fixture;
}

function sessionRows(directory: string, sessionDate: string) {
  const db = createDatabase(
    join(directory, 'capture', sessionDate, 'raw.sqlite'),
  );
  try {
    const batches = db.client.query('SELECT * FROM raw_batches').all() as Array<
      Record<string, unknown>
    >;
    const messages = db.client
      .query('SELECT * FROM raw_market_messages ORDER BY instrument_key')
      .all() as Array<Record<string, unknown>>;
    const errors = db.client.query('SELECT * FROM capture_errors').all();
    return { batches, messages, errors };
  } finally {
    db.client.close();
  }
}

afterEach(async () => {
  if (fixture) {
    const target = fixture;
    fixture = null;
    await target.service.stop().catch(() => undefined);
    target.store.close();
    await removeDirectory(target.directory);
  }
});

describe('capture integration (fake source)', () => {
  it('persists 1 batch -> N instrument rows with hashes and lineage', async () => {
    const { service, source, directory } = createFixture();
    await service.start();

    await source.push(twoInstrumentBatch(), RECEIVED_TS);
    await service.stop();

    const { batches, messages, errors } = sessionRows(
      directory,
      '2026-09-22',
    );
    expect(errors).toHaveLength(0);
    expect(batches).toHaveLength(1);
    expect(messages).toHaveLength(2);

    const storedBatch = batches[0];
    expect(storedBatch?.['source_connection_id']).toBe('test-connection-1');
    expect(storedBatch?.['session_date']).toBe('2026-09-22');
    expect(storedBatch?.['feed_mode']).toBe('full');
    expect(typeof storedBatch?.['batch_hash']).toBe('string');

    for (const message of messages) {
      expect(message?.['batch_id']).toBe(storedBatch?.['batch_id']);
      expect(message?.['session_date']).toBe('2026-09-22');
      // Only the instrument's own slice is stored per row.
      const payload = JSON.parse(message?.['raw_payload'] as string) as Record<
        string,
        unknown
      >;
      expect(Object.keys(payload)).toEqual(['ltpc']);
      expect(message?.['instrument_payload_hash']).toBe(
        hashCanonical(payload),
      );
      expect(message?.['instrument_payload_hash']).not.toBe(
        storedBatch?.['batch_hash'],
      );
    }

    const stats = service.getStats();
    expect(stats.batches_received).toBe(1);
    expect(stats.batches_persisted).toBe(1);
    expect(stats.instrument_rows_received).toBe(2);
    expect(stats.instrument_rows_persisted).toBe(2);
    expect(stats.queue_overflow_count).toBe(0);
    expect(stats.capture_error_count).toBe(0);
    expect(stats.average_write_latency).toBeGreaterThanOrEqual(0);
    expect(stats.last_batch_size).toBe(1);
  });

  it('mints a new source_connection_id on reconnect', async () => {
    const { service, source, directory } = createFixture();
    await service.start();

    await source.push(twoInstrumentBatch(), RECEIVED_TS);
    expect(service.getStatus().source_connection_id).toBe('test-connection-1');

    source.reconnect('test-connection-2');
    expect(service.getStatus().source_connection_id).toBe('test-connection-2');

    const distinct = encodeFeedResponse({
      type: 2,
      currentTs: 1758604300000,
      feeds: {
        'NSE_EQ|INE002A01018': encodeFeed(encodeLtpc({ ltp: 2432 })),
      },
    });
    await source.push(distinct, RECEIVED_TS + 1000);
    await service.stop();

    const { batches } = sessionRows(directory, '2026-09-22');
    expect(batches).toHaveLength(2);
    const connections = batches
      .map((row) => row?.['source_connection_id'])
      .sort();
    expect(connections).toEqual(['test-connection-1', 'test-connection-2']);
  });

  it('records malformed input without crashing capture', async () => {
    const { service, source, directory } = createFixture();
    await service.start();

    await source.push(new Uint8Array([0xff]), RECEIVED_TS);
    await source.push(twoInstrumentBatch(), RECEIVED_TS);
    await service.stop();

    const { batches, messages, errors } = sessionRows(
      directory,
      '2026-09-22',
    );
    expect(errors).toHaveLength(1);
    expect(batches).toHaveLength(1);
    expect(messages).toHaveLength(2);

    const stats = service.getStats();
    expect(stats.capture_error_count).toBe(1);
    expect(service.getStatus().capture_state).toBe('STOPPED');
  });

  it('exposes overflow without silent loss', async () => {
    const { service, source } = createFixture({
      queueCapacity: 1,
      backpressureTimeoutMs: 0,
      flushIntervalMs: 60000,
    });
    await service.start();

    await source.push(twoInstrumentBatch(), RECEIVED_TS);
    await source.push(twoInstrumentBatch(), RECEIVED_TS + 1);

    const status = service.getStatus();
    expect(status.capture_state).toBe('DEGRADED');
    expect(status.capture_degraded).toBe(true);
    expect(status.capture_incomplete).toBe(true);

    const stats = service.getStats();
    expect(stats.queue_overflow_count).toBeGreaterThan(0);
    expect(stats.capture_error_count).toBeGreaterThan(0);
  });
});
