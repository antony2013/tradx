import { sha256Hex } from '../capture/canonical';
import type { Logger } from '../lib/logger';
import { HistoricalError } from './errors';
import type {
  FetchedChunk,
  HistoricalClient,
  HistoricalUnit,
  NormalizedCandle,
} from './types';

export type UpstoxHistoricalClientConfig = {
  baseUrl: string;
  expiredBaseUrl: string;
  accessToken: string;
  maxRetries: number;
  initialRetryDelayMs: number;
  maxRetryDelayMs: number;
  requestTimeoutMs: number;
};

export type FetchChunkInput = {
  instrumentKey: string;
  unit: HistoricalUnit;
  interval: number;
  from: string;
  to: string;
  datasetId: string;
  chunkIndex: number;
};

export type FetchExpiredChunkInput = {
  expiredKey: string;
  unit: HistoricalUnit;
  interval: number;
  from: string;
  to: string;
  datasetId: string;
  chunkIndex: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function backoffMs(attempt: number, initial: number, max: number): number {
  const exponential = initial * 2 ** Math.min(attempt, 10);
  return Math.min(exponential + Math.floor(Math.random() * 250), max);
}

/**
 * Parse one upstream candle array into a normalized record.
 * Only fields actually supplied by Upstox are stored; nothing is
 * fabricated. Throws INVALID_RESPONSE for malformed rows.
 */
export function normalizeCandleArray(
  row: unknown,
  chunkRef: string,
): NormalizedCandle {
  if (!Array.isArray(row) || row.length < 6) {
    throw new HistoricalError(
      'INVALID_RESPONSE',
      `Malformed candle row in ${chunkRef}`,
    );
  }

  const [timestampRaw, open, high, low, close, volume, openInterest] = row as [
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown?,
  ];

  const timestamp =
    typeof timestampRaw === 'number'
      ? timestampRaw
      : typeof timestampRaw === 'string'
        ? Date.parse(timestampRaw)
        : Number.NaN;

  const numbers = { open, high, low, close, volume };
  for (const [name, value] of Object.entries(numbers)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new HistoricalError(
        'INVALID_RESPONSE',
        `Malformed candle field ${name} in ${chunkRef}`,
      );
    }
  }

  if (!Number.isSafeInteger(timestamp)) {
    throw new HistoricalError(
      'INVALID_RESPONSE',
      `Malformed candle timestamp in ${chunkRef}`,
    );
  }

  return {
    timestamp,
    open: open as number,
    high: high as number,
    low: low as number,
    close: close as number,
    volume: volume as number,
    openInterest:
      openInterest === undefined || openInterest === null
        ? null
        : typeof openInterest === 'number' && Number.isFinite(openInterest)
          ? openInterest
          : null,
  };
}

/**
 * Upstox Historical Candle Data V3 client.
 * The access token travels only in the Authorization header and is
 * never logged. Authentication failures are NOT retried.
 */
export class UpstoxHistoricalClient implements HistoricalClient {
  constructor(
    private readonly config: UpstoxHistoricalClientConfig,
    private readonly logger: Logger,
  ) {}

  async fetchChunk(input: FetchChunkInput): Promise<FetchedChunk> {
    const url =
      `${this.config.baseUrl}/historical-candle/` +
      `${encodeURIComponent(input.instrumentKey)}/` +
      `${input.unit}/${input.interval}/${input.to}/${input.from}`;
    return this.fetchWithRetry(
      url,
      `dataset ${input.datasetId} chunk ${input.chunkIndex}`,
      input.datasetId,
      input.chunkIndex,
    );
  }

  async fetchExpiredChunk(
    input: FetchExpiredChunkInput,
  ): Promise<FetchedChunk> {
    const intervalToken =
      input.unit === 'minutes'
        ? `${input.interval}minute`
        : input.unit === 'days'
          ? 'day'
          : input.unit === 'weeks'
            ? 'week'
            : 'month';
    const url =
      `${this.config.expiredBaseUrl}/expired-instruments/historical-candle/` +
      `${encodeURIComponent(input.expiredKey)}/` +
      `${intervalToken}/${input.to}/${input.from}`;
    return this.fetchWithRetry(
      url,
      `dataset ${input.datasetId} expired chunk ${input.chunkIndex}`,
      input.datasetId,
      input.chunkIndex,
    );
  }

  private async fetchWithRetry(
    url: string,
    chunkRef: string,
    datasetId: string,
    chunkIndex: number,
  ): Promise<FetchedChunk> {
    let attempt = 0;
    for (;;) {
      const startedAt = Date.now();
      try {
        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.config.accessToken}`,
          },
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });

        if (response.status === 401 || response.status === 403) {
          throw new HistoricalError(
            'AUTHENTICATION_ERROR',
            'Upstox authentication failed; a valid access token is required',
          );
        }
        if (response.status === 429) {
          throw new HistoricalError(
            'RATE_LIMITED',
            'Upstox rate limit exceeded',
          );
        }
        if (response.status === 400 || response.status === 404) {
          throw new HistoricalError(
            'INVALID_REQUEST',
            `Upstox rejected the request with ${response.status}`,
          );
        }
        if (!response.ok) {
          throw new HistoricalError(
            'UPSTREAM_ERROR',
            `Upstox responded with ${response.status}`,
          );
        }

        const rawText = await response.text();
        const respondedAt = Date.now();
        const body = JSON.parse(rawText) as {
          status?: string;
          data?: { candles?: unknown };
        };
        if (body.status !== 'success' || !Array.isArray(body.data?.candles)) {
          throw new HistoricalError(
            'INVALID_RESPONSE',
            `Unexpected response shape in ${chunkRef}`,
          );
        }

        const candles = (body.data.candles as unknown[])
          .map((row) => normalizeCandleArray(row, chunkRef))
          .sort((left, right) => left.timestamp - right.timestamp);

        this.logger.debug('chunk_fetched', 'Upstream chunk fetched', {
          datasetId,
          chunkIndex,
          recordCount: candles.length,
          durationMs: respondedAt - startedAt,
        });

        return {
          candles,
          rawText,
          responseHash: sha256Hex(rawText),
          respondedAt,
        };
      } catch (error) {
        if (error instanceof HistoricalError) {
          if (
            error.code === 'AUTHENTICATION_ERROR' ||
            error.code === 'INVALID_REQUEST' ||
            error.code === 'INVALID_RESPONSE'
          ) {
            throw error;
          }
          if (attempt >= this.config.maxRetries) {
            throw error;
          }
          this.logger.warn('chunk_retry', 'Retrying chunk request', {
            datasetId,
            chunkIndex,
            attempt: attempt + 1,
            errorCode: error.code,
          });
          await sleep(
            backoffMs(
              attempt,
              this.config.initialRetryDelayMs,
              this.config.maxRetryDelayMs,
            ),
          );
          attempt += 1;
          continue;
        }

        const isTimeout =
          error instanceof Error && error.name === 'TimeoutError';
        const retryable = new HistoricalError(
          isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
          `${isTimeout ? 'Upstream timeout' : 'Upstream network failure'}: ${errorMessage(error)}`,
        );
        if (attempt >= this.config.maxRetries) {
          throw retryable;
        }
        this.logger.warn('chunk_retry', 'Retrying chunk request', {
          datasetId,
          chunkIndex,
          attempt: attempt + 1,
          errorCode: retryable.code,
        });
        await sleep(
          backoffMs(
            attempt,
            this.config.initialRetryDelayMs,
            this.config.maxRetryDelayMs,
          ),
        );
        attempt += 1;
      }
    }
  }
}
