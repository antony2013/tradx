import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { RawCaptureService } from '../src/capture/service';
import { CaptureStore } from '../src/capture/store';
import type { SubscribableSource } from '../src/capture/types';
import { loadConfig } from '../src/config/env';
import { closeDatabase, createDatabase } from '../src/db';
import type { Logger } from '../src/lib/logger';
import { projectRoot } from '../src/config/env';
import { encodeFeed, encodeFeedResponse, encodeLtpc } from './encode-feed';
import { FakeHistoricalClient } from './fake-historical';
import { FakeSearchClient } from './fake-search';
import { removeDirectory } from './test-utils';

const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

class FakeSubscribableSource implements SubscribableSource {
  private readonly keys = new Set<string>();

  constructor(
    initial: string[] = [],
    private readonly feedMode = 'ltpc',
  ) {
    for (const key of initial) {
      this.keys.add(key);
    }
  }

  getSubscribedKeys(): string[] {
    return [...this.keys].sort();
  }

  getFeedMode(): string {
    return this.feedMode;
  }

  subscribe(keys: string[]) {
    const added = keys.filter((key) => !this.keys.has(key));
    for (const key of added) {
      this.keys.add(key);
    }
    return { added, invalid: [] };
  }

  unsubscribe(keys: string[]) {
    const removed = keys.filter((key) => this.keys.has(key));
    const missing = keys.filter((key) => !this.keys.has(key));
    for (const key of removed) {
      this.keys.delete(key);
    }
    return { removed, missing };
  }
}

type Fixture = {
  directory: string;
  store: CaptureStore;
  service: RawCaptureService;
  source: FakeSubscribableSource;
  app: ReturnType<typeof createApp>;
  database: ReturnType<typeof createDatabase>;
};

let fixture: Fixture | null = null;

function createFixture(withCapture: boolean): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'tradex-ep-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '4123',
    DATABASE_PATH: join(directory, 'test.db'),
  });
  const database = createDatabase(config.databasePath);

  let store: CaptureStore | undefined;
  let service: RawCaptureService | undefined;
  let source: FakeSubscribableSource | undefined;
  if (withCapture) {
    store = new CaptureStore(directory, 'capture', join(projectRoot, 'drizzle'));
    service = new RawCaptureService({
      config: {
        enabled: true,
        feedMode: 'ltpc',
        schemaVersion: 'upstox-v3-raw-1',
        queueCapacity: 100,
        maxWriteBatchSize: 10,
        flushIntervalMs: 10,
        backpressureTimeoutMs: 1000,
      },
      store,
      source: null,
      logger: nullLogger,
    });
  }

  if (withCapture) {
    source = new FakeSubscribableSource(['NSE_FO|1']);
  }

  const app = createApp({
    config,
    database,
    logger: nullLogger,
    capture: service ?? null,
    captureSource: source ?? null,
    historicalClient: new FakeHistoricalClient(new Map()),
    searchClient: new FakeSearchClient(),
  });
  fixture = {
    directory,
    store: store as CaptureStore,
    service: service as RawCaptureService,
    source: source as FakeSubscribableSource,
    app,
    database,
  };
  return fixture;
}

afterEach(async () => {
  if (!fixture) {
    return;
  }
  const target = fixture;
  fixture = null;
  await target.service?.stop().catch(() => undefined);
  target.store?.close();
  await closeDatabase(target.database);
  await removeDirectory(target.directory);
});

describe('health endpoint contracts', () => {
  it('serves /health and /ready', async () => {
    const { app } = createFixture(true);

    const health = await app.request('/health');
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: 'ok' });

    const ready = await app.request('/ready');
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({
      status: 'ok',
      dependencies: { database: 'ready' },
    });
  });

  it('serves /capture/status and /capture/stats with stable keys', async () => {
    const { app, service } = createFixture(true);
    await service.start();
    await service.receive(
      encodeFeedResponse({
        type: 1,
        currentTs: 1758604202000,
        feeds: {
          'NSE_EQ|INE002A01018': encodeFeed(encodeLtpc({ ltp: 1 })),
        },
      }),
      Date.UTC(2026, 8, 23, 4, 30, 0, 0),
    );

    const status = await app.request('/capture/status');
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as Record<string, unknown>;
    expect(Object.keys(statusBody).sort()).toEqual(
      [
        'capture_degraded',
        'capture_enabled',
        'capture_incomplete',
        'capture_state',
        'queue_capacity',
        'queue_depth',
        'session_date',
        'source_connection_id',
      ].sort(),
    );
    expect(statusBody).toMatchObject({
      capture_enabled: true,
      capture_state: 'CAPTURING',
      session_date: '2026-09-23',
      queue_capacity: 100,
    });

    const stats = await app.request('/capture/stats');
    expect(stats.status).toBe(200);
    const statsBody = (await stats.json()) as Record<string, unknown>;
    expect(Object.keys(statsBody).sort()).toEqual(
      [
        'average_batch_size',
        'average_write_latency',
        'batches_persisted',
        'batches_received',
        'capture_error_count',
        'instrument_rows_persisted',
        'instrument_rows_received',
        'last_batch_size',
        'last_write_latency',
        'max_batch_size',
        'queue_average_wait_ms',
        'queue_capacity',
        'queue_depth',
        'queue_overflow_count',
      ].sort(),
    );
    expect(statsBody['batches_received']).toBe(1);
    expect(statsBody['instrument_rows_received']).toBe(1);
  });

  it('returns 503 for capture endpoints when capture is not configured', async () => {    const { app } = createFixture(false);

    const status = await app.request('/capture/status');
    expect(status.status).toBe(503);
    await expect(status.json()).resolves.toEqual({
      error: {
        code: 'CAPTURE_DISABLED',
        message: 'Capture service is not configured',
      },
    });

    const stats = await app.request('/capture/stats');
    expect(stats.status).toBe(503);
  });

  it('serves the OpenAPI document and Scalar UI', async () => {    const { app } = createFixture(true);

    const doc = await app.request('/openapi.json');
    expect(doc.status).toBe(200);
    const spec = (await doc.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(spec.openapi).toBe('3.0.0');
    expect(Object.keys(spec.paths).sort()).toEqual(
      [
        '/capture/stats',
        '/capture/status',
        '/capture/subscriptions',
        '/health',
        '/historical/datasets',
        '/historical/datasets/{datasetId}',
        '/historical/datasets/{datasetId}/validation',
        '/instruments/expired-candles',
        '/instruments/expired-future-contracts',
        '/instruments/expired-option-contracts',
        '/instruments/expiries',
        '/instruments/option-contracts',
        '/instruments/search',
        '/market/change-oi',
        '/market/holidays',
        '/market/max-pain',
        '/market/oi',
        '/market/pcr',
        '/market/smartlists/futures',
        '/market/smartlists/options',
        '/market/status',
        '/market/timings',
        '/ready',
      ].sort(),
    );

    const ui = await app.request('/docs');
    expect(ui.status).toBe(200);
    expect(ui.headers.get('content-type')).toContain('text/html');
  });

  it('manages subscriptions for one or many instruments', async () => {
    const { app } = createFixture(true);

    const initial = await app.request('/capture/subscriptions');
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toEqual({
      feed_mode: 'ltpc',
      instrument_keys: ['NSE_FO|1'],
    });

    const post = (body: unknown) =>
      app.request('/capture/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const sub = await post({
      action: 'sub',
      instrumentKeys: ['NSE_FO|2', 'NSE_INDEX|Nifty 50'],
    });
    expect(sub.status).toBe(200);
    await expect(sub.json()).resolves.toMatchObject({
      action: 'sub',
      added: ['NSE_FO|2', 'NSE_INDEX|Nifty 50'],
    });

    const unsub = await post({
      action: 'unsub',
      instrumentKeys: ['NSE_FO|1', 'NSE_FO|9'],
    });
    expect(unsub.status).toBe(200);
    await expect(unsub.json()).resolves.toMatchObject({
      action: 'unsub',
      removed: ['NSE_FO|1'],
      missing: ['NSE_FO|9'],
      instrument_keys: ['NSE_FO|2', 'NSE_INDEX|Nifty 50'],
    });

    const bad = await post({ action: 'sub', instrumentKeys: [] });
    expect(bad.status).toBe(400);
  });

  it('returns 503 for subscription endpoints when source is missing', async () => {
    const { app } = createFixture(false);

    expect((await app.request('/capture/subscriptions')).status).toBe(503);
    const post = await app.request('/capture/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sub', instrumentKeys: ['NSE_FO|1'] }),
    });
    expect(post.status).toBe(503);
  });
});
