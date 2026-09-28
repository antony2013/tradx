import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { ExpiriesClient } from '../instruments/upstox-expiries';
import type { InstrumentSearchClient } from '../instruments/upstox-search';
import type { MarketClient } from '../instruments/upstox-market';
import {
  ErrorSchema,
  ExpiriesQuerySchema,
  ExpiriesResponseSchema,
  ExpiredCandlesQuerySchema,
  InstrumentSearchQuerySchema,
  InstrumentSearchResponseSchema,
  MarketBucketQuerySchema,
  MarketDataResponseSchema,
  MarketOiQuerySchema,
  OptionContractsQuerySchema,
  OptionContractsResponseSchema,
  SmartlistQuerySchema,
} from '../openapi/schemas';

const searchRouteDef = createRoute({
  method: 'get',
  path: '/instruments/search',
  tags: ['instruments'],
  summary: 'Search Upstox instruments (discovery only, nothing stored)',
  request: { query: InstrumentSearchQuerySchema },
  responses: {
    200: {
      content: {
        'application/json': { schema: InstrumentSearchResponseSchema },
      },
      description: 'Matching instruments with canonical instrument_key values',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid search parameters',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Valid Upstox authentication required',
    },
  },
});

const expiriesRouteDef = createRoute({
  method: 'get',
  path: '/instruments/expiries',
  tags: ['instruments'],
  summary: 'List weekly/monthly expiries for an underlying (Plus only)',
  request: { query: ExpiriesQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: ExpiriesResponseSchema } },
      description: 'Available expiry dates for the underlying',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid instrument key',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Valid Upstox authentication required',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Expiries client not configured',
    },
  },
});

const optionContractsRouteDef = createRoute({
  method: 'get',
  path: '/instruments/option-contracts',
  tags: ['instruments'],
  summary: 'Active option contracts for an underlying and expiry',
  request: { query: OptionContractsQuerySchema },
  responses: {
    200: {
      content: {
        'application/json': { schema: OptionContractsResponseSchema },
      },
      description: 'CE/PE contracts with strikes, lots and keys',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid parameters',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Valid Upstox authentication required',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Expiries client not configured',
    },
  },
});

const expiredContractsRouteDef = createRoute({
  method: 'get',
  path: '/instruments/expired-option-contracts',
  tags: ['instruments'],
  summary: 'Expired option contracts for F&O history (Plus only)',
  request: { query: OptionContractsQuerySchema },
  responses: {
    200: {
      content: {
        'application/json': { schema: OptionContractsResponseSchema },
      },
      description: 'Expired CE/PE contracts for backtest history',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid parameters',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Valid Upstox authentication required',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Expiries client not configured',
    },
  },
});

export type InstrumentRouteDeps = {
  search: InstrumentSearchClient;
  expiries: ExpiriesClient | null;
  market?: MarketClient | null;
};

function marketResponses(description: string) {
  return {
    200: {
      content: { 'application/json': { schema: MarketDataResponseSchema } },
      description,
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid parameters',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Valid Upstox authentication required',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Market client not configured',
    },
  } as const;
}

const optionsSmartlistRouteDef = createRoute({
  method: 'get',
  path: '/market/smartlists/options',
  tags: ['instruments'],
  summary: 'Options smartlist by asset type and category',
  request: { query: SmartlistQuerySchema },
  responses: marketResponses('Ranked option contracts'),
});

const futuresSmartlistRouteDef = createRoute({
  method: 'get',
  path: '/market/smartlists/futures',
  tags: ['instruments'],
  summary: 'Futures smartlist by asset type and category',
  request: { query: SmartlistQuerySchema },
  responses: marketResponses('Ranked futures contracts'),
});

const oiRouteDef = createRoute({
  method: 'get',
  path: '/market/oi',
  tags: ['instruments'],
  summary: 'Strike-wise open interest for an underlying and expiry',
  request: { query: MarketOiQuerySchema },
  responses: marketResponses('Total and strike-wise OI'),
});

const changeOiRouteDef = createRoute({
  method: 'get',
  path: '/market/change-oi',
  tags: ['instruments'],
  summary: 'Total and strike-wise change in open interest',
  request: { query: MarketOiQuerySchema },
  responses: marketResponses('OI changes'),
});

const maxPainRouteDef = createRoute({
  method: 'get',
  path: '/market/max-pain',
  tags: ['instruments'],
  summary: 'Max pain, spot price and intraday insights',
  request: { query: MarketBucketQuerySchema },
  responses: marketResponses('Max pain data'),
});

const pcrRouteDef = createRoute({
  method: 'get',
  path: '/market/pcr',
  tags: ['instruments'],
  summary: 'Put-call ratio, spot price and intraday insights',
  request: { query: MarketBucketQuerySchema },
  responses: marketResponses('PCR data'),
});

const notConfigured = {
  error: { code: 'NOT_CONFIGURED', message: 'Expiries client missing' },
} as const;

const expiredFuturesRouteDef = createRoute({
  method: 'get',
  path: '/instruments/expired-future-contracts',
  tags: ['instruments'],
  summary: 'Expired futures for an underlying and expiry (Plus only)',
  request: { query: OptionContractsQuerySchema },
  responses: {
    200: {
      content: {
        'application/json': { schema: OptionContractsResponseSchema },
      },
      description: 'Expired futures contracts',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid parameters',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Valid Upstox authentication required',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Expiries client not configured',
    },
  },
});

const expiredCandlesRouteDef = createRoute({
  method: 'get',
  path: '/instruments/expired-candles',
  tags: ['instruments'],
  summary: 'OHLC history for an expired contract key',
  request: { query: ExpiredCandlesQuerySchema },
  responses: {
    200: {
      content: {
        'application/json': { schema: OptionContractsResponseSchema },
      },
      description: 'Expired contract candles',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid parameters',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Valid Upstox authentication required',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Expiries client not configured',
    },
  },
});

export function registerInstrumentRoutes(
  app: OpenAPIHono,
  client: InstrumentSearchClient | InstrumentRouteDeps,
): void {
  const search = isDeps(client) ? client.search : client;
  const expiries: ExpiriesClient | null = isDeps(client)
    ? client.expiries
    : null;
  const market: MarketClient | null =
    isDeps(client) && client.market ? client.market : null;

  const needMarket = () => {
    if (!market) {
      return {
        error: { code: 'NOT_CONFIGURED', message: 'Market client missing' },
      } as const;
    }
    return null;
  };

  app.openapi(searchRouteDef, async (c) => {
    const query = c.req.valid('query');
    const result = await search.search({
      query: query.query,
      exchanges: query.exchanges,
      segments: query.segments,
      instrumentTypes: query.instrument_types,
      expiry: query.expiry,
      atmOffset: query.atm_offset,
      pageNumber: query.page_number,
      records: query.records,
    });
    return c.json(result, 200);
  });

  app.openapi(expiriesRouteDef, async (c) => {
    if (!expiries) {
      return c.json(
        { error: { code: 'NOT_CONFIGURED', message: 'Expiries client missing' } },
        503,
      );
    }
    const query = c.req.valid('query');
    const data = await expiries.getExpiries(query.instrument_key);
    return c.json({ data }, 200);
  });

  app.openapi(optionContractsRouteDef, async (c) => {
    if (!expiries) {
      return c.json(
        { error: { code: 'NOT_CONFIGURED', message: 'Expiries client missing' } },
        503,
      );
    }
    const query = c.req.valid('query');
    const data = await expiries.getOptionContracts(
      query.instrument_key,
      query.expiry_date,
    );
    return c.json({ data }, 200);
  });

  app.openapi(expiredContractsRouteDef, async (c) => {
    if (!expiries) {
      return c.json(notConfigured, 503);
    }
    const query = c.req.valid('query');
    if (!query.expiry_date) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'expiry_date is required for expired contracts',
          },
        },
        400,
      );
    }
    const data = await expiries.getExpiredOptionContracts(
      query.instrument_key,
      query.expiry_date,
    );
    return c.json({ data }, 200);
  });

  app.openapi(expiredFuturesRouteDef, async (c) => {
    if (!expiries) {
      return c.json(notConfigured, 503);
    }
    const query = c.req.valid('query');
    if (!query.expiry_date) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'expiry_date is required for expired contracts',
          },
        },
        400,
      );
    }
    const data = await expiries.getExpiredFutureContracts(
      query.instrument_key,
      query.expiry_date,
    );
    return c.json({ data }, 200);
  });

  app.openapi(expiredCandlesRouteDef, async (c) => {
    if (!expiries) {
      return c.json(notConfigured, 503);
    }
    const query = c.req.valid('query');
    const data = await expiries.getExpiredCandles(
      query.instrument_key,
      query.interval,
      query.to_date,
      query.from_date,
    );
    return c.json({ data }, 200);
  });

  app.openapi(optionsSmartlistRouteDef, async (c) => {
    const missing = needMarket();
    if (missing || !market) {
      return c.json(missing ?? notConfigured, 503);
    }
    const query = c.req.valid('query');
    const data = await market.getOptionsSmartlist({
      assetType: query.asset_type,
      category: query.category,
      pageNumber: query.page_number,
      pageSize: query.page_size,
    });
    return c.json({ data }, 200);
  });

  app.openapi(futuresSmartlistRouteDef, async (c) => {
    const missing = needMarket();
    if (missing || !market) {
      return c.json(missing ?? notConfigured, 503);
    }
    const query = c.req.valid('query');
    const data = await market.getFuturesSmartlist({
      assetType: query.asset_type,
      category: query.category,
      pageNumber: query.page_number,
      pageSize: query.page_size,
    });
    return c.json({ data }, 200);
  });

  const oiParams = (
    query: Record<string, string | undefined>,
  ): {
    instrumentKey: string;
    expiry: string;
    date: string;
    interval?: string;
    bucketInterval?: string;
  } => ({
    instrumentKey: query['instrument_key'] as string,
    expiry: query['expiry'] as string,
    date: query['date'] as string,
    interval: query['interval'],
    bucketInterval: query['bucket_interval'],
  });

  app.openapi(oiRouteDef, async (c) => {
    const missing = needMarket();
    if (missing || !market) {
      return c.json(missing ?? notConfigured, 503);
    }
    const data = await market.getOI(oiParams(c.req.valid('query')));
    return c.json({ data }, 200);
  });

  app.openapi(changeOiRouteDef, async (c) => {
    const missing = needMarket();
    if (missing || !market) {
      return c.json(missing ?? notConfigured, 503);
    }
    const data = await market.getChangeOI(oiParams(c.req.valid('query')));
    return c.json({ data }, 200);
  });

  app.openapi(maxPainRouteDef, async (c) => {
    const missing = needMarket();
    if (missing || !market) {
      return c.json(missing ?? notConfigured, 503);
    }
    const data = await market.getMaxPain(oiParams(c.req.valid('query')));
    return c.json({ data }, 200);
  });

  app.openapi(pcrRouteDef, async (c) => {
    const missing = needMarket();
    if (missing || !market) {
      return c.json(missing ?? notConfigured, 503);
    }
    const data = await market.getPCR(oiParams(c.req.valid('query')));
    return c.json({ data }, 200);
  });
}

function isDeps(
  client: InstrumentSearchClient | InstrumentRouteDeps,
): client is InstrumentRouteDeps {
  return (
    typeof client === 'object' &&
    client !== null &&
    'search' in client &&
    'expiries' in client
  );
}
