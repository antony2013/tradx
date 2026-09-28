import { HistoricalError } from '../historical/errors';
import type { Logger } from '../lib/logger';

export type InstrumentSearchParams = {
  query: string;
  exchanges?: string;
  segments?: string;
  instrumentTypes?: string;
  expiry?: string;
  atmOffset?: string;
  pageNumber?: string;
  records?: string;
};

export type InstrumentSearchResult = {
  data: Array<Record<string, unknown> & { instrument_key: string }>;
  meta: unknown;
};

export type InstrumentSearchClient = {
  search(params: InstrumentSearchParams): Promise<InstrumentSearchResult>;
};

export type UpstoxSearchClientConfig = {
  baseUrl: string;
  accessToken: string;
  requestTimeoutMs: number;
};

async function safeUpstreamMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      errors?: Array<{ message?: string }>;
    };
    const first = body.errors?.[0]?.message;
    if (typeof first === 'string' && first.length > 0) {
      return first.slice(0, 200);
    }
  } catch {
    // fall through to status-only message
  }
  return `request rejected with ${response.status}`;
}

/**
 * Upstox Instrument Search (v2) client. Discovery only — results are
 * ephemeral and never stored. Token travels in the header, never in the
 * URL or logs.
 */
export class UpstoxSearchClient implements InstrumentSearchClient {
  constructor(
    private readonly config: UpstoxSearchClientConfig,
    private readonly logger: Logger,
  ) {}

  async search(params: InstrumentSearchParams): Promise<InstrumentSearchResult> {
    const query = new URLSearchParams({ query: params.query });
    if (params.exchanges) query.set('exchanges', params.exchanges);
    if (params.segments) query.set('segments', params.segments);
    if (params.instrumentTypes) {
      query.set('instrument_types', params.instrumentTypes);
    }
    if (params.expiry) query.set('expiry', params.expiry);
    if (params.atmOffset) query.set('atm_offset', params.atmOffset);
    if (params.pageNumber) query.set('page_number', params.pageNumber);
    if (params.records) query.set('records', params.records);

    let response: Response;
    try {
      response = await fetch(
        `${this.config.baseUrl}/instruments/search?${query.toString()}`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.config.accessToken}`,
          },
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        },
      );
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      throw new HistoricalError(
        isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        isTimeout ? 'Instrument search timed out' : 'Instrument search failed',
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new HistoricalError(
        'AUTHENTICATION_ERROR',
        'Upstox authentication failed; a valid access token is required',
      );
    }
    if (response.status === 429) {
      throw new HistoricalError('RATE_LIMITED', 'Upstox rate limit exceeded');
    }
    if (response.status === 400 || response.status === 404) {
      throw new HistoricalError(
        'INVALID_REQUEST',
        `Upstox rejected the search: ${await safeUpstreamMessage(response)}`,
      );
    }
    if (!response.ok) {
      throw new HistoricalError(
        'UPSTREAM_ERROR',
        `Instrument search responded with ${response.status}`,
      );
    }

    const body = (await response.json()) as {
      status?: string;
      data?: unknown;
      meta_data?: unknown;
    };
    if (body.status !== 'success' || !Array.isArray(body.data)) {
      throw new HistoricalError(
        'INVALID_RESPONSE',
        'Unexpected instrument search response shape',
      );
    }

    this.logger.debug('instrument_search', 'Instrument search completed', {
      resultCount: body.data.length,
    });
    return {
      data: body.data as Array<Record<string, unknown> & { instrument_key: string }>,
      meta: body.meta_data ?? null,
    };
  }
}
