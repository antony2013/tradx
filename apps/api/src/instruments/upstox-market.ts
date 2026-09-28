import type { Logger } from '../lib/logger';
import { upstoxGet, type UpstoxGetConfig } from './upstox-fetch';

export type SmartlistParams = {
  assetType: string;
  category: string;
  pageNumber?: string;
  pageSize?: string;
};

export type OiParams = {
  instrumentKey: string;
  expiry: string;
  date: string;
  interval?: string;
  bucketInterval?: string;
};

/**
 * Upstox market-information client (v2): smartlists, OI, change-in-OI,
 * max pain, PCR. Discovery only — results are ephemeral, never stored.
 */
export class UpstoxMarketClient {
  constructor(
    private readonly config: UpstoxGetConfig,
    private readonly logger: Logger,
  ) {}

  async getOptionsSmartlist(params: SmartlistParams): Promise<unknown> {
    const data = await upstoxGet(
      this.config,
      `/market/smartlist/options?${this.smartlistQuery(params)}`,
      'Get options smartlist',
    );
    this.logger.debug('smartlist_fetched', 'Options smartlist fetched');
    return data;
  }

  async getFuturesSmartlist(params: SmartlistParams): Promise<unknown> {
    const data = await upstoxGet(
      this.config,
      `/market/smartlist/futures?${this.smartlistQuery(params)}`,
      'Get futures smartlist',
    );
    this.logger.debug('smartlist_fetched', 'Futures smartlist fetched');
    return data;
  }

  async getOI(params: OiParams): Promise<unknown> {
    return upstoxGet(
      this.config,
      `/market/oi?${this.oiQuery(params, false, false)}`,
      'Get open interest',
    );
  }

  async getChangeOI(params: OiParams): Promise<unknown> {
    return upstoxGet(
      this.config,
      `/market/change-oi?${this.oiQuery(params, true, false)}`,
      'Get change in OI',
    );
  }

  async getMaxPain(params: OiParams): Promise<unknown> {
    return upstoxGet(
      this.config,
      `/market/max-pain?${this.oiQuery(params, false, true)}`,
      'Get max pain',
    );
  }

  async getPCR(params: OiParams): Promise<unknown> {
    return upstoxGet(
      this.config,
      `/market/pcr?${this.oiQuery(params, false, true)}`,
      'Get PCR',
    );
  }

  private smartlistQuery(params: SmartlistParams): string {
    const query = new URLSearchParams({
      asset_type: params.assetType,
      category: params.category,
      page_number: params.pageNumber ?? '1',
      page_size: params.pageSize ?? '20',
    });
    return query.toString();
  }

  private oiQuery(
    params: OiParams,
    withInterval: boolean,
    withBucket: boolean,
  ): string {
    const query = new URLSearchParams({
      instrument_key: params.instrumentKey,
      expiry: params.expiry,
      date: params.date,
    });
    if (withInterval && params.interval) {
      query.set('interval', params.interval);
    }
    if (withBucket && params.bucketInterval) {
      query.set('bucket_interval', params.bucketInterval);
    }
    return query.toString();
  }
}

export type MarketClient = {
  getOptionsSmartlist(params: SmartlistParams): Promise<unknown>;
  getFuturesSmartlist(params: SmartlistParams): Promise<unknown>;
  getOI(params: OiParams): Promise<unknown>;
  getChangeOI(params: OiParams): Promise<unknown>;
  getMaxPain(params: OiParams): Promise<unknown>;
  getPCR(params: OiParams): Promise<unknown>;
};
