import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config/env';
import { projectRoot } from '../src/config/env';
import { closeDatabase, createDatabase } from '../src/db';
import { runMigrations } from '../src/db/migrate';
import { HistoricalError } from '../src/historical/errors';
import type { QuoteClient } from '../src/instruments/upstox-quotes';
import { UpstoxQuoteClient } from '../src/instruments/upstox-quotes';
import type { Logger } from '../src/lib/logger';
import { FakeHistoricalClient } from './fake-historical';
import { FakeSearchClient } from './fake-search';
import { removeDirectory } from './test-utils';

const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(impl: (url: unknown, init?: unknown) => Promise<Response>) {
  const mock = vi.fn(impl);
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe('upstox quote client', () => {
  it('fetches full/OHLC/LTP/Greeks without leaking the token', async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({ status: 'success', data: { 'NSE_INDEX|Nifty 50': {} } }),
    );
    const client = new UpstoxQuoteClient(
      {
        baseUrl: 'https://api.upstox.com/v3',
        accessToken: 'secret-token',
        requestTimeoutMs: 5000,
      },
      nullLogger,
    );

    await client.getFullQuotes('NSE_INDEX|Nifty 50');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/market-quote/quotes?',
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'instrument_key=NSE_INDEX%7CNifty+50',
    );

    await client.getOhlcQuotes('NSE_INDEX|Nifty 50', '1d');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      '/market-quote/ohlc?',
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('interval=1d');

    await client.getLtpQuotes('NSE_INDEX|Nifty 50');
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      '/market-quote/ltp?',
    );

    await client.getOptionGreeks('NSE_FO|73887');
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain(
      '/market-quote/option-greek?',
    );

    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('secret-token');
    }
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(
      (init.headers as Record<string, string>)['Authorization'],
    ).toBe('Bearer secret-token');
  });

  it('maps auth failures without retrying', async () => {
    const fetchMock = stubFetch(async () => new Response('x', { status: 401 }));
    const client = new UpstoxQuoteClient(
      { baseUrl: 'https://x', accessToken: 't', requestTimeoutMs: 5000 },
      nullLogger,
    );
    const error = await client
      .getLtpQuotes('NSE_INDEX|Nifty 50')
      .catch((e: unknown) => e);
    expect((error as HistoricalError).code).toBe('AUTHENTICATION_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

class FakeQuoteClient implements QuoteClient {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  constructor(private readonly data: unknown = { 'NSE_INDEX|Nifty 50': {} }) {}

  private record(method: string, ...args: unknown[]): unknown {
    this.calls.push({ method, args });
    return this.data;
  }

  async getFullQuotes(keys: string): Promise<unknown> {
    return this.record('quotes', keys);
  }

  async getOhlcQuotes(keys: string, interval?: string): Promise<unknown> {
    return this.record('ohlc', keys, interval);
  }

  async getLtpQuotes(keys: string): Promise<unknown> {
    return this.record('ltp', keys);
  }

  async getOptionGreeks(keys: string): Promise<unknown> {
    return this.record('greeks', keys);
  }
}

type Fixture = {
  directory: string;
  database: ReturnType<typeof createDatabase>;
  app: ReturnType<typeof createApp>;
  quotes: FakeQuoteClient;
};

let fixture: Fixture | null = null;

function createFixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'tradex-quotes-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '4123',
    DATABASE_PATH: join(directory, 'test.db'),
  });
  const database = createDatabase(config.databasePath);
  runMigrations(database, join(projectRoot, 'drizzle'));
  const quotes = new FakeQuoteClient();
  const app = createApp({
    config,
    database,
    logger: nullLogger,
    historicalClient: new FakeHistoricalClient(new Map()),
    searchClient: new FakeSearchClient(),
    expiriesClient: null,
    marketClient: null,
    quoteClient: quotes,
  });
  fixture = { directory, database, app, quotes };
  return fixture;
}

afterEach(async () => {
  if (!fixture) return;
  const target = fixture;
  fixture = null;
  await closeDatabase(target.database);
  await removeDirectory(target.directory);
});

describe('quote endpoints', () => {
  it('serves full/OHLC/LTP/Greeks and validates params', async () => {
    const { app, quotes } = createFixture();
    const key = encodeURIComponent('NSE_INDEX|Nifty 50');

    const full = await app.request(`/market/quotes?instrument_key=${key}`);
    expect(full.status).toBe(200);
    await expect(full.json()).resolves.toEqual({
      data: { 'NSE_INDEX|Nifty 50': {} },
    });

    const ohlc = await app.request(
      `/market/quotes/ohlc?instrument_key=${key}&interval=1d`,
    );
    expect(ohlc.status).toBe(200);
    expect(quotes.calls[1]).toMatchObject({
      method: 'ohlc',
      args: ['NSE_INDEX|Nifty 50', '1d'],
    });

    const ltp = await app.request(`/market/quotes/ltp?instrument_key=${key}`);
    expect(ltp.status).toBe(200);

    const greeks = await app.request(
      `/market/quotes/greeks?instrument_key=${encodeURIComponent('NSE_FO|73887')}`,
    );
    expect(greeks.status).toBe(200);

    const missing = await app.request('/market/quotes/ltp');
    expect(missing.status).toBe(400);

    const badInterval = await app.request(
      `/market/quotes/ohlc?instrument_key=${key}&interval=hour`,
    );
    expect(badInterval.status).toBe(400);
  });

  it('returns 503 when the quote client is missing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tradex-quotes-bare-'));
    const config = loadConfig({
      NODE_ENV: 'test',
      PORT: '4123',
      DATABASE_PATH: join(directory, 'test.db'),
    });
    const database = createDatabase(config.databasePath);
    runMigrations(database, join(projectRoot, 'drizzle'));
    try {
      const bare = createApp({
        config,
        database,
        logger: nullLogger,
        historicalClient: new FakeHistoricalClient(new Map()),
        searchClient: new FakeSearchClient(),
        quoteClient: null,
      });
      const response = await bare.request(
        `/market/quotes/ltp?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50')}`,
      );
      expect(response.status).toBe(503);
    } finally {
      await closeDatabase(database);
      await removeDirectory(directory);
    }
  });

  it('appears in the OpenAPI document', async () => {
    const { app } = createFixture();
    const doc = await app.request('/openapi.json');
    const spec = (await doc.json()) as { paths: Record<string, unknown> };
    expect(spec.paths['/market/quotes']).toBeDefined();
    expect(spec.paths['/market/quotes/ohlc']).toBeDefined();
    expect(spec.paths['/market/quotes/ltp']).toBeDefined();
    expect(spec.paths['/market/quotes/greeks']).toBeDefined();
  });
});
