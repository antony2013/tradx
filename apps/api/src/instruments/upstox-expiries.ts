import type { Logger } from '../lib/logger';
import { upstoxGet } from './upstox-fetch';

export type ExpiriesClientConfig = {
  baseUrl: string;
  accessToken: string;
  requestTimeoutMs: number;
};

/**
 * Upstox expiries + option-contract client (v2).
 * Discovery only — results are ephemeral and never stored.
 * Expired-instrument APIs require Upstox Plus.
 */
export class UpstoxExpiriesClient {
  constructor(
    private readonly config: ExpiriesClientConfig,
    private readonly logger: Logger,
  ) {}

  async getExpiries(instrumentKey: string): Promise<unknown> {
    const data = await upstoxGet(
      this.config,
      `/expired-instruments/expiries?instrument_key=${encodeURIComponent(instrumentKey)}`,
      'Get expiries',
    );
    this.logger.debug('expiries_fetched', 'Expiries fetched', {
      instrumentKey,
    });
    return data;
  }

  async getOptionContracts(
    instrumentKey: string,
    expiryDate?: string,
  ): Promise<unknown> {
    const params = new URLSearchParams({ instrument_key: instrumentKey });
    if (expiryDate) {
      params.set('expiry_date', expiryDate);
    }
    return upstoxGet(
      this.config,
      `/option/contract?${params.toString()}`,
      'Get option contracts',
    );
  }

  async getExpiredOptionContracts(
    instrumentKey: string,
    expiryDate: string,
  ): Promise<unknown> {
    const params = new URLSearchParams({
      instrument_key: instrumentKey,
      expiry_date: expiryDate,
    });
    return upstoxGet(
      this.config,
      `/expired-instruments/option/contract?${params.toString()}`,
      'Get expired option contracts',
    );
  }

  async getExpiredFutureContracts(
    instrumentKey: string,
    expiryDate: string,
  ): Promise<unknown> {
    const params = new URLSearchParams({
      instrument_key: instrumentKey,
      expiry_date: expiryDate,
    });
    return upstoxGet(
      this.config,
      `/expired-instruments/future/contract?${params.toString()}`,
      'Get expired future contracts',
    );
  }

  async getExpiredCandles(
    expiredKey: string,
    interval: string,
    toDate: string,
    fromDate: string,
  ): Promise<unknown> {
    return upstoxGet(
      this.config,
      `/expired-instruments/historical-candle/${encodeURIComponent(expiredKey)}/${interval}/${toDate}/${fromDate}`,
      'Get expired historical candles',
    );
  }
}

export type ExpiriesClient = {
  getExpiries(instrumentKey: string): Promise<unknown>;
  getOptionContracts(instrumentKey: string, expiryDate?: string): Promise<unknown>;
  getExpiredOptionContracts(
    instrumentKey: string,
    expiryDate: string,
  ): Promise<unknown>;
  getExpiredFutureContracts(
    instrumentKey: string,
    expiryDate: string,
  ): Promise<unknown>;
  getExpiredCandles(
    expiredKey: string,
    interval: string,
    toDate: string,
    fromDate: string,
  ): Promise<unknown>;
};
