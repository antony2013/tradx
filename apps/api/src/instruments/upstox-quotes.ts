import type { Logger } from '../lib/logger';
import { upstoxGet, type UpstoxGetConfig } from './upstox-fetch';

/**
 * Upstox market-quote client (v3): full quotes, OHLC, LTP, option Greeks.
 * Discovery only — results are ephemeral, never stored.
 *
 * Upstream limits: 500 comma-separated keys per call (50 for Greeks).
 * Keys travel as one `instrument_key` query value, e.g.
 * "NSE_INDEX|Nifty 50,NSE_FO|73985".
 */
export class UpstoxQuoteClient {
  constructor(
    private readonly config: UpstoxGetConfig,
    private readonly logger: Logger,
  ) {}

  async getFullQuotes(instrumentKeys: string): Promise<unknown> {
    const data = await upstoxGet(
      this.config,
      `/market-quote/quotes?${this.keysQuery(instrumentKeys)}`,
      'Get full market quotes',
    );
    this.logger.debug('quotes_fetched', 'Full market quotes fetched');
    return data;
  }

  async getOhlcQuotes(
    instrumentKeys: string,
    interval?: string,
  ): Promise<unknown> {
    const query = new URLSearchParams(this.keysQuery(instrumentKeys));
    if (interval) {
      query.set('interval', interval);
    }
    return upstoxGet(
      this.config,
      `/market-quote/ohlc?${query.toString()}`,
      'Get OHLC quotes',
    );
  }

  async getLtpQuotes(instrumentKeys: string): Promise<unknown> {
    return upstoxGet(
      this.config,
      `/market-quote/ltp?${this.keysQuery(instrumentKeys)}`,
      'Get LTP quotes',
    );
  }

  async getOptionGreeks(instrumentKeys: string): Promise<unknown> {
    return upstoxGet(
      this.config,
      `/market-quote/option-greek?${this.keysQuery(instrumentKeys)}`,
      'Get option Greeks',
    );
  }

  private keysQuery(instrumentKeys: string): URLSearchParams {
    return new URLSearchParams({ instrument_key: instrumentKeys });
  }
}

export type QuoteClient = {
  getFullQuotes(instrumentKeys: string): Promise<unknown>;
  getOhlcQuotes(instrumentKeys: string, interval?: string): Promise<unknown>;
  getLtpQuotes(instrumentKeys: string): Promise<unknown>;
  getOptionGreeks(instrumentKeys: string): Promise<unknown>;
};
