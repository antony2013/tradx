import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoricalError } from '../src/historical/errors';
import { UpstoxHistoricalClient } from '../src/historical/upstox-client';
import type { Logger } from '../src/lib/logger';

const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const baseConfig = {
  baseUrl: 'https://api.upstox.com/v3',
  expiredBaseUrl: 'https://api.upstox.com/v2',
  accessToken: 'test-token',
  maxRetries: 2,
  initialRetryDelayMs: 1,
  maxRetryDelayMs: 5,
  requestTimeoutMs: 5000,
};

const input = {
  instrumentKey: 'NSE_INDEX|Nifty 50',
  unit: 'days' as const,
  interval: 1,
  from: '2026-09-01',
  to: '2026-09-02',
  datasetId: 'd1',
  chunkIndex: 0,
};

function successResponse() {
  return new Response(
    JSON.stringify({
      status: 'success',
      data: {
        candles: [
          ['2026-09-01T00:00:00+05:30', 100, 110, 90, 105, 1000, null],
          ['2026-09-02T00:00:00+05:30', 105, 115, 95, 110, 2000, null],
        ],
      },
    }),
    { status: 200 },
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;

function stubFetch(
  impl: (url: unknown, init?: unknown) => Promise<Response>,
) {
  const mock = vi.fn(impl);
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe('upstox historical client', () => {
  it('fetches and normalizes candles in chronological order', async () => {
    const fetchMock = stubFetch(async () => successResponse());

    const client = new UpstoxHistoricalClient(baseConfig, nullLogger);
    const result = await client.fetchChunk(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/historical-candle/');
    expect(url).toContain(encodeURIComponent('NSE_INDEX|Nifty 50'));
    // No token in the URL; it travels in the header only.
    expect(url).not.toContain('test-token');
    expect(result.candles.map((c) => c.timestamp)).toEqual(
      [Date.parse('2026-09-01T00:00:00+05:30'), Date.parse('2026-09-02T00:00:00+05:30')],
    );
    expect(result.candles[0]).toMatchObject({ open: 100, volume: 1000 });
    expect(result.responseHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fetches expired chunks through the expired-candles API', async () => {
    const fetchMock = stubFetch(async () => successResponse());

    const client = new UpstoxHistoricalClient(baseConfig, nullLogger);
    const result = await client.fetchExpiredChunk({
      expiredKey: 'NSE_FO|58422|03-10-2024',
      unit: 'days',
      interval: 1,
      from: '2024-09-01',
      to: '2024-10-03',
      datasetId: 'd-exp',
      chunkIndex: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('https://api.upstox.com/v2/expired-instruments/historical-candle/');
    expect(url).toContain(encodeURIComponent('NSE_FO|58422|03-10-2024'));
    expect(url).toContain('/day/2024-10-03/2024-09-01');
    expect(result.candles).toHaveLength(2);
  });

  it('retries transient failures within the configured limit', async () => {
    const fetchMock = stubFetch(async () => successResponse())
      .mockRejectedValueOnce(new TypeError('socket hang up'))
      .mockResolvedValueOnce(new Response('oops', { status: 500 }));

    const client = new UpstoxHistoricalClient(baseConfig, nullLogger);
    const result = await client.fetchChunk(input);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.candles).toHaveLength(2);
  });

  it('gives up after max retries', async () => {
    const fetchMock = stubFetch(
      async () => new Response('bad', { status: 500 }),
    );

    const client = new UpstoxHistoricalClient(baseConfig, nullLogger);
    await expect(client.fetchChunk(input)).rejects.toThrow(HistoricalError);
    // Initial attempt + 2 retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never retries authentication failures', async () => {
    const fetchMock = stubFetch(
      async () => new Response('x', { status: 401 }),
    );

    const client = new UpstoxHistoricalClient(baseConfig, nullLogger);
    const error = await client.fetchChunk(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HistoricalError);
    expect((error as HistoricalError).code).toBe('AUTHENTICATION_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid response shapes without retrying', async () => {
    const fetchMock = stubFetch(
      async () =>
        new Response(JSON.stringify({ status: 'success', data: {} }), {
          status: 200,
        }),
    );

    const client = new UpstoxHistoricalClient(baseConfig, nullLogger);
    const error = await client.fetchChunk(input).catch((e: unknown) => e);
    expect((error as HistoricalError).code).toBe('INVALID_RESPONSE');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
