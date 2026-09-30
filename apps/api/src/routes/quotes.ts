import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { QuoteClient } from '../instruments/upstox-quotes';
import {
  ErrorSchema,
  MarketDataResponseSchema,
  OhlcQuotesQuerySchema,
  QuotesQuerySchema,
} from '../openapi/schemas';

function quoteResponses(description: string) {
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
      description: 'Quote client not configured',
    },
  } as const;
}

const fullQuotesRouteDef = createRoute({
  method: 'get',
  path: '/market/quotes',
  tags: ['market'],
  summary: 'Full market quotes V3 (OHLC, depth, OI, Greeks, circuits)',
  request: { query: QuotesQuerySchema },
  responses: quoteResponses('Full quotes keyed by instrument'),
});

const ohlcQuotesRouteDef = createRoute({
  method: 'get',
  path: '/market/quotes/ohlc',
  tags: ['market'],
  summary: 'OHLC quotes V3 (prev + live OHLC with volume)',
  request: { query: OhlcQuotesQuerySchema },
  responses: quoteResponses('OHLC quotes keyed by instrument'),
});

const ltpQuotesRouteDef = createRoute({
  method: 'get',
  path: '/market/quotes/ltp',
  tags: ['market'],
  summary: 'LTP quotes V3 (last price, quantity, volume, close)',
  request: { query: QuotesQuerySchema },
  responses: quoteResponses('LTP quotes keyed by instrument'),
});

const optionGreeksRouteDef = createRoute({
  method: 'get',
  path: '/market/quotes/greeks',
  tags: ['market'],
  summary: 'Option Greeks (IV, delta, theta, gamma, vega, OI)',
  request: { query: QuotesQuerySchema },
  responses: quoteResponses('Greeks keyed by instrument'),
});

export function registerQuoteRoutes(
  app: OpenAPIHono,
  getClient: () => QuoteClient | null,
): void {
  const notConfigured = {
    error: { code: 'NOT_CONFIGURED', message: 'Quote client missing' },
  } as const;

  app.openapi(fullQuotesRouteDef, async (c) => {
    const client = getClient();
    if (!client) {
      return c.json(notConfigured, 503);
    }
    const data = await client.getFullQuotes(c.req.valid('query').instrument_key);
    return c.json({ data }, 200);
  });

  app.openapi(ohlcQuotesRouteDef, async (c) => {
    const client = getClient();
    if (!client) {
      return c.json(notConfigured, 503);
    }
    const query = c.req.valid('query');
    const data = await client.getOhlcQuotes(query.instrument_key, query.interval);
    return c.json({ data }, 200);
  });

  app.openapi(ltpQuotesRouteDef, async (c) => {
    const client = getClient();
    if (!client) {
      return c.json(notConfigured, 503);
    }
    const data = await client.getLtpQuotes(c.req.valid('query').instrument_key);
    return c.json({ data }, 200);
  });

  app.openapi(optionGreeksRouteDef, async (c) => {
    const client = getClient();
    if (!client) {
      return c.json(notConfigured, 503);
    }
    const data = await client.getOptionGreeks(c.req.valid('query').instrument_key);
    return c.json({ data }, 200);
  });
}
