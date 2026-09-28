import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { loadConfig } from '../src/config/env';
import { closeDatabase, createDatabase, type DatabaseContainer } from '../src/db';
import { createLogger } from '../src/lib/logger';
import { FakeHistoricalClient } from './fake-historical';
import { FakeSearchClient } from './fake-search';

type TestContext = {
  directory: string;
  database: DatabaseContainer;
  app: ReturnType<typeof createApp>;
};

let context: TestContext | undefined;

function createTestContext(): TestContext {
  const directory = mkdtempSync(join(tmpdir(), 'tradex-api-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '4123',
    DATABASE_PATH: join(directory, 'test.db'),
  });
  const database = createDatabase(config.databasePath);
  const app = createApp({
    config,
    database,
    logger: createLogger('test'),
    historicalClient: new FakeHistoricalClient(new Map()),
    searchClient: new FakeSearchClient(),
  });

  return { directory, database, app };
}

afterEach(async () => {
  if (!context) {
    return;
  }

  await closeDatabase(context.database);
  rmSync(context.directory, { recursive: true, force: true });
  context = undefined;
});

describe('Hono application', () => {
  it('initializes the application', () => {
    context = createTestContext();
    expect(context.app).toBeDefined();
  });

  it('returns a health response', async () => {
    context = createTestContext();
    const response = await context.app.request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('returns a ready response after checking SQLite', async () => {
    context = createTestContext();
    const response = await context.app.request('/ready');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      dependencies: { database: 'ready' },
    });
  });
});
