import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config/env';
import { closeDatabase, createDatabase } from '../src/db';
import { runMigrations } from '../src/db/migrate';
import { HistoricalError } from '../src/historical/errors';
import type { ExpiriesClient } from '../src/instruments/upstox-expiries';
import { UpstoxExpiriesClient } from '../src/instruments/upstox-expiries';
import type { MarketClient } from '../src/instruments/upstox-market';
import { UpstoxMarketClient } from '../src/instruments/upstox-market';
import { UpstoxSearchClient } from '../src/instruments/upstox-search';
import type { Logger } from '../src/lib/logger';
import { projectRoot } from '../src/config/env';
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

describe('upstox search client', () => {
  it('forwards params and returns data without leaking the token', async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({
        status: 'success',
        data: [{ instrument_key: 'NSE_FO|73985' }],
        meta_data: { page: 1 },
      }),
    );
    const client = new UpstoxSearchClient(
      {
        baseUrl: 'https://api.upstox.com/v2',
        accessToken: 'secret-token',
        requestTimeoutMs: 5000,
      },
      nullLogger,
    );

    const result = await client.search({
      query: 'NIFTY',
      segments: 'FO',
      instrumentTypes: 'CE',
    });

    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({ page: 1 });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/instruments/search?');
    expect(url).toContain('query=NIFTY');
    expect(url).toContain('segments=FO');
    expect(url).not.toContain('secret-token');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(
      (init.headers as Record<string, string>)['Authorization'],
    ).toBe('Bearer secret-token');
  });

  it('maps auth failures without retrying', async () => {
    const fetchMock = stubFetch(async () => new Response('x', { status: 401 }));
    const client = new UpstoxSearchClient(
      { baseUrl: 'https://x', accessToken: 't', requestTimeoutMs: 5000 },
      nullLogger,
    );
    const error = await client.search({ query: 'X' }).catch((e: unknown) => e);
    expect((error as HistoricalError).code).toBe('AUTHENTICATION_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps upstream rejections to INVALID_REQUEST with the reason', async () => {
    const fetchMock = stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            status: 'error',
            errors: [{ message: 'Please Enter Correct Segment And Exchange Values' }],
          }),
          { status: 400 },
        ),
    );
    const client = new UpstoxSearchClient(
      { baseUrl: 'https://x', accessToken: 't', requestTimeoutMs: 5000 },
      nullLogger,
    );
    const error = await client.search({ query: 'X' }).catch((e: unknown) => e);
    expect((error as HistoricalError).code).toBe('INVALID_REQUEST');
    expect((error as Error).message).toContain('Correct Segment');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

class FakeExpiriesClient implements ExpiriesClient {
  readonly calls: Array<{ method: string; key: string; expiry?: string }> = [];

  constructor(
    private readonly data: unknown = ['2026-09-29', '2026-10-27'],
  ) {}

  async getExpiries(key: string): Promise<unknown> {
    this.calls.push({ method: 'expiries', key });
    return this.data;
  }

  async getOptionContracts(key: string, expiry?: string): Promise<unknown> {
    this.calls.push({ method: 'contracts', key, expiry });
    return this.data;
  }

  async getExpiredOptionContracts(
    key: string,
    expiry: string,
  ): Promise<unknown> {
    this.calls.push({ method: 'expired', key, expiry });
    return this.data;
  }

  async getExpiredFutureContracts(
    key: string,
    expiry: string,
  ): Promise<unknown> {
    this.calls.push({ method: 'expired-fut', key, expiry });
    return this.data;
  }

  async getExpiredCandles(
    key: string,
    interval: string,
    to: string,
    from: string,
  ): Promise<unknown> {
    this.calls.push({ method: 'expired-candles', key, expiry: `${interval}/${from}/${to}` });
    return this.data;
  }
}

describe('upstox expiries client', () => {
  it('fetches expiries for an underlying key', async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({ status: 'success', data: ['2026-09-29'] }),
    );
    const client = new UpstoxExpiriesClient(
      {
        baseUrl: 'https://api.upstox.com/v2',
        accessToken: 'secret-token',
        requestTimeoutMs: 5000,
      },
      nullLogger,
    );

    const data = await client.getExpiries('NSE_INDEX|Nifty 50');
    expect(data).toEqual(['2026-09-29']);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/expired-instruments/expiries?');
    expect(url).toContain(encodeURIComponent('NSE_INDEX|Nifty 50'));
    expect(url).not.toContain('secret-token');
  });

  it('maps auth failures without retrying', async () => {
    const fetchMock = stubFetch(async () => new Response('x', { status: 401 }));
    const client = new UpstoxExpiriesClient(
      { baseUrl: 'https://x', accessToken: 't', requestTimeoutMs: 5000 },
      nullLogger,
    );
    const error = await client
      .getExpiries('NSE_INDEX|Nifty 50')
      .catch((e: unknown) => e);
    expect((error as HistoricalError).code).toBe('AUTHENTICATION_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

class FakeMarketClient implements MarketClient {
  readonly calls: Array<{ method: string; params: unknown }> = [];

  constructor(private readonly data: unknown = { total_calls: 1 }) {}

  private record(method: string, params: unknown): unknown {
    this.calls.push({ method, params });
    return this.data;
  }

  async getOptionsSmartlist(params: unknown): Promise<unknown> {
    return this.record('options', params);
  }

  async getFuturesSmartlist(params: unknown): Promise<unknown> {
    return this.record('futures', params);
  }

  async getOI(params: unknown): Promise<unknown> {
    return this.record('oi', params);
  }

  async getChangeOI(params: unknown): Promise<unknown> {
    return this.record('change-oi', params);
  }

  async getMaxPain(params: unknown): Promise<unknown> {
    return this.record('max-pain', params);
  }

  async getPCR(params: unknown): Promise<unknown> {
    return this.record('pcr', params);
  }
}

describe('upstox market client', () => {
  it('fetches smartlists and OI analytics without leaking the token', async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({ status: 'success', data: { total_calls: 5 } }),
    );
    const client = new UpstoxMarketClient(
      {
        baseUrl: 'https://api.upstox.com/v2',
        accessToken: 'secret-token',
        requestTimeoutMs: 5000,
      },
      nullLogger,
    );

    const smart = await client.getOptionsSmartlist({
      assetType: 'INDEX',
      category: 'TOP_TRADED',
    });
    expect(smart).toEqual({ total_calls: 5 });
    const smartUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(smartUrl).toContain('/market/smartlist/options?');
    expect(smartUrl).toContain('asset_type=INDEX');
    expect(smartUrl).not.toContain('secret-token');

    await client.getPCR({
      instrumentKey: 'NSE_INDEX|Nifty 50',
      expiry: '2026-09-29',
      date: '2026-09-23',
    });
    const pcrUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(pcrUrl).toContain('/market/pcr?');
  });

  it('maps auth failures without retrying', async () => {
    const fetchMock = stubFetch(async () => new Response('x', { status: 401 }));
    const client = new UpstoxMarketClient(
      { baseUrl: 'https://x', accessToken: 't', requestTimeoutMs: 5000 },
      nullLogger,
    );
    const error = await client
      .getOI({ instrumentKey: 'X', expiry: 'Y', date: '2026-09-23' })
      .catch((e: unknown) => e);
    expect((error as HistoricalError).code).toBe('AUTHENTICATION_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

type Fixture = {
  directory: string;
  database: ReturnType<typeof createDatabase>;
  app: ReturnType<typeof createApp>;
};

let fixture: Fixture | null = null;

function createFixture(search: FakeSearchClient): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'tradex-inst-'));
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
    historicalClient: new FakeHistoricalClient(new Map()),
    searchClient: search,
    expiriesClient: new FakeExpiriesClient(),
    marketClient: new FakeMarketClient(),
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

describe('instrument search endpoint', () => {
  it('returns matching instruments and forwards filters', async () => {
    const search = new FakeSearchClient();
    const { app } = createFixture(search);

    const response = await app.request(
      '/instruments/search?query=NIFTY&segments=FO&instrument_types=CE&records=5',
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['data']).toEqual([
      {
        instrument_key: 'NSE_FO|73985',
        trading_symbol: 'NIFTY 23500 CE 29 SEP 26',
      },
    ]);
    expect(search.calls[0]).toMatchObject({
      query: 'NIFTY',
      segments: 'FO',
      instrumentTypes: 'CE',
      records: '5',
    });
  });

  it('rejects a missing query with 400 and maps auth errors to 401', async () => {
    const { app } = createFixture(new FakeSearchClient());
    const bad = await app.request('/instruments/search?records=5');
    expect(bad.status).toBe(400);

    const authed = createFixture(
      new FakeSearchClient(
        { data: [], meta: null },
        new HistoricalError('AUTHENTICATION_ERROR', 'nope'),
      ),
    );
    const denied = await authed.app.request('/instruments/search?query=X');
    expect(denied.status).toBe(401);
  });

  it('appears in the OpenAPI document', async () => {
    const { app } = createFixture(new FakeSearchClient());
    const doc = await app.request('/openapi.json');
    const spec = (await doc.json()) as { paths: Record<string, unknown> };
    expect(spec.paths['/instruments/search']).toBeDefined();
    expect(spec.paths['/instruments/expiries']).toBeDefined();
    expect(spec.paths['/instruments/option-contracts']).toBeDefined();
    expect(spec.paths['/instruments/expired-future-contracts']).toBeDefined();
    expect(spec.paths['/instruments/expired-candles']).toBeDefined();
    expect(spec.paths['/instruments/expired-option-contracts']).toBeDefined();
    expect(spec.paths['/market/smartlists/options']).toBeDefined();
    expect(spec.paths['/market/smartlists/futures']).toBeDefined();
    expect(spec.paths['/market/oi']).toBeDefined();
    expect(spec.paths['/market/change-oi']).toBeDefined();
    expect(spec.paths['/market/max-pain']).toBeDefined();
    expect(spec.paths['/market/pcr']).toBeDefined();
  });

  it('serves expiries and option contracts', async () => {
    const { app } = createFixture(new FakeSearchClient());

    const expiries = await app.request(
      `/instruments/expiries?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50')}`,
    );
    expect(expiries.status).toBe(200);
    await expect(expiries.json()).resolves.toEqual({
      data: ['2026-09-29', '2026-10-27'],
    });

    const contracts = await app.request(
      `/instruments/option-contracts?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50')}&expiry_date=2026-09-29`,
    );
    expect(contracts.status).toBe(200);

    const expired = await app.request(
      `/instruments/expired-option-contracts?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50')}&expiry_date=2026-09-29`,
    );
    expect(expired.status).toBe(200);

    const missingExpiry = await app.request(
      `/instruments/expired-option-contracts?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50')}`,
    );
    expect(missingExpiry.status).toBe(400);

    const futures = await app.request(
      `/instruments/expired-future-contracts?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50')}&expiry_date=2026-09-29`,
    );
    expect(futures.status).toBe(200);

    const candles = await app.request(
      `/instruments/expired-candles?instrument_key=${encodeURIComponent('NSE_FO|58422|03-10-2024')}&interval=day&to_date=2024-10-03&from_date=2024-09-01`,
    );
    expect(candles.status).toBe(200);

    const badInterval = await app.request(
      `/instruments/expired-candles?instrument_key=${encodeURIComponent('NSE_FO|58422|03-10-2024')}&interval=hour&to_date=2024-10-03&from_date=2024-09-01`,
    );
    expect(badInterval.status).toBe(400);

    const missingKey = await app.request('/instruments/expiries');
    expect(missingKey.status).toBe(400);
  });

  it('serves market smartlists and OI analytics', async () => {
    const { app } = createFixture(new FakeSearchClient());

    const options = await app.request(
      '/market/smartlists/options?asset_type=INDEX&category=TOP_TRADED',
    );
    expect(options.status).toBe(200);
    await expect(options.json()).resolves.toEqual({
      data: { total_calls: 1 },
    });

    const futures = await app.request(
      '/market/smartlists/futures?asset_type=STOCK&category=MOST_ACTIVE&page_size=5',
    );
    expect(futures.status).toBe(200);

    const oi = await app.request(
      `/market/oi?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50')}&expiry=2026-09-29&date=2026-09-23`,
    );
    expect(oi.status).toBe(200);

    const changeOi = await app.request(
      `/market/change-oi?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50')}&expiry=2026-09-29&date=2026-09-23&interval=7`,
    );
    expect(changeOi.status).toBe(200);

    const maxPain = await app.request(
      `/market/max-pain?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50')}&expiry=2026-09-29&date=2026-09-23&bucket_interval=30`,
    );
    expect(maxPain.status).toBe(200);

    const pcr = await app.request(
      `/market/pcr?instrument_key=${encodeURIComponent('NSE_INDEX|Nifty 50')}&expiry=2026-09-29&date=2026-09-23&bucket_interval=30`,
    );
    expect(pcr.status).toBe(200);

    const missing = await app.request('/market/oi?expiry=2026-09-29');
    expect(missing.status).toBe(400);
  });
});
