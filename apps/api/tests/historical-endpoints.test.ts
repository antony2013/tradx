import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config/env';
import { closeDatabase, createDatabase } from '../src/db';
import { runMigrations } from '../src/db/migrate';
import type { Logger } from '../src/lib/logger';
import { projectRoot } from '../src/config/env';
import { candle, FakeHistoricalClient } from './fake-historical';
import { FakeSearchClient } from './fake-search';
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
  app: ReturnType<typeof createApp>;
};

let fixture: Fixture | null = null;

function createFixture(client: FakeHistoricalClient): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'tradex-hist-ep-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '4123',
    DATABASE_PATH: join(directory, 'test.db'),
  });
  const database = createDatabase(config.databasePath);
  runMigrations(database, join(projectRoot, 'drizzle'));
  const app = createApp({
    config,
    database,
    logger: nullLogger,
    historicalClient: client,
    searchClient: new FakeSearchClient(),
  });
  fixture = { directory, database, app };
  return fixture;
}

afterEach(async () => {
  if (!fixture) return;
  const target = fixture;
  fixture = null;
  await closeDatabase(target.database);
  await removeDirectory(target.directory);
});

describe('historical endpoints', () => {
  it('acquires, reuses and reads back a dataset', async () => {
    const client = new FakeHistoricalClient(
      new Map([[0, [{ kind: 'data', candles: [candle('2026-09-02', 120)] }]]]),
    );
    const { app } = createFixture(client);
    const body = {
      instrumentKey: 'NSE_INDEX|Nifty 50',
      from: '2026-09-01',
      to: '2026-09-23',
      interval: '1day',
      source: 'upstox',
    };

    const first = await app.request('/historical/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);
    const created = (await first.json()) as Record<string, unknown>;
    expect(created['status']).toBe('COMPLETE');
    expect(created['record_count']).toBe(1);
    expect(created['reused']).toBe(false);

    const second = await app.request('/historical/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const reused = (await second.json()) as Record<string, unknown>;
    expect(reused['dataset_id']).toBe(created['dataset_id']);
    expect(reused['reused']).toBe(true);
    expect(client.calls).toHaveLength(1);

    const read = await app.request(
      `/historical/datasets/${created['dataset_id']}`,
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      dataset_id: created['dataset_id'],
      status: 'COMPLETE',
    });

    const missing = await app.request('/historical/datasets/nope');
    expect(missing.status).toBe(404);
  });

  it('acquires an expired contract key end to end', async () => {
    const client = new FakeHistoricalClient(
      new Map([[0, [{ kind: 'data', candles: [candle('2024-10-01', 100)] }]]]),
    );
    const { app } = createFixture(client);
    const response = await app.request('/historical/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instrumentKey: 'NSE_FO|58422|03-10-2024',
        from: '2024-09-01',
        to: '2024-10-03',
        interval: '1day',
        source: 'upstox',
      }),
    });
    expect(response.status).toBe(200);
    const created = (await response.json()) as Record<string, unknown>;
    expect(created['status']).toBe('COMPLETE');
    expect(created['record_count']).toBe(1);
    expect(client.calls[0]).toMatchObject({ expired: true });
  });

  it('rejects invalid requests with 400', async () => {
    const { app } = createFixture(new FakeHistoricalClient(new Map()));
    const response = await app.request('/historical/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instrumentKey: 'NSE_INDEX|Nifty 50',
        from: '2026-09-23',
        to: '2026-09-01',
        interval: '1day',
        source: 'upstox',
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('returns 401 when upstream authentication fails', async () => {
    const client = new FakeHistoricalClient(
      new Map([
        [0, [{ kind: 'error', code: 'AUTHENTICATION_ERROR' }]],
      ]),
    );
    const { app } = createFixture(client);
    const response = await app.request('/historical/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instrumentKey: 'NSE_INDEX|Nifty 50',
        from: '2026-09-01',
        to: '2026-09-23',
        interval: '1day',
        source: 'upstox',
      }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'AUTHENTICATION_ERROR' },
    });
  });

  it('lists historical paths in the OpenAPI document', async () => {
    const { app } = createFixture(new FakeHistoricalClient(new Map()));
    const doc = await app.request('/openapi.json');
    const spec = (await doc.json()) as { paths: Record<string, unknown> };
    expect(spec.paths['/historical/datasets']).toBeDefined();
    expect(spec.paths['/historical/datasets/{datasetId}']).toBeDefined();
    expect(
      spec.paths['/historical/datasets/{datasetId}/validation'],
    ).toBeDefined();
  });

  it('validates a dataset and reads the stored report', async () => {
    const client = new FakeHistoricalClient(
      new Map([[0, [{ kind: 'data', candles: [candle('2026-09-14', 120)] }]]]),
    );
    const { app } = createFixture(client);
    const create = await app.request('/historical/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instrumentKey: 'NSE_INDEX|Nifty 50',
        from: '2026-09-14',
        to: '2026-09-18',
        interval: '1day',
        source: 'upstox',
      }),
    });
    const created = (await create.json()) as Record<string, unknown>;
    const id = created['dataset_id'] as string;

    const missing = await app.request(`/historical/datasets/nope/validation`);
    expect(missing.status).toBe(404);

    const run = await app.request(`/historical/datasets/${id}/validation`, {
      method: 'POST',
    });
    expect(run.status).toBe(200);
    const report = (await run.json()) as Record<string, unknown>;
    // One weekday present out of five expected.
    expect(report).toMatchObject({ verdict: 'INCOMPLETE', candle_count: 1 });

    const read = await app.request(`/historical/datasets/${id}/validation`);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      dataset_id: id,
      verdict: 'INCOMPLETE',
    });

    const noReport = await app.request(
      `/historical/datasets/nope/validation`,
    );
    expect(noReport.status).toBe(404);
  });
});
