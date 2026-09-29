import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import type { CaptureService, SubscribableSource } from './capture/types';
import type { AppConfig } from './config/env';
import type { DatabaseContainer } from './db';
import type { HistoricalClient } from './historical/types';
import type { ExpiriesClient } from './instruments/upstox-expiries';
import type { InstrumentSearchClient } from './instruments/upstox-search';
import type { MarketClient } from './instruments/upstox-market';
import { handleError } from './lib/errors';
import type { Logger } from './lib/logger';
import { registerCaptureRoutes } from './routes/capture';
import { registerHealthRoute } from './routes/health';
import { registerHistoricalRoutes } from './routes/historical';
import { registerInstrumentRoutes } from './routes/instruments';
import { registerReadyRoute } from './routes/ready';

export type AppDependencies = {
  config: AppConfig;
  database: DatabaseContainer;
  logger: Logger;
  capture?: CaptureService | null;
  captureSource?: SubscribableSource | null;
  historicalClient: HistoricalClient;
  searchClient: InstrumentSearchClient;
  expiriesClient?: ExpiriesClient | null;
  marketClient?: MarketClient | null;
};

export function createApp(dependencies: AppDependencies): OpenAPIHono {
  const {
    config,
    database,
    logger,
    capture = null,
    captureSource = null,
    historicalClient,
    searchClient,
    expiriesClient = null,
    marketClient = null,
  } = dependencies;
  const app = new OpenAPIHono();

  app.use(async (c, next) => {
    const startedAt = performance.now();
    await next();
    logger.info('http_request', 'Request completed', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    });
  });

  registerHealthRoute(app);
  registerReadyRoute(app, database);
  registerCaptureRoutes(app, () => capture, () => captureSource);
  registerHistoricalRoutes(app, {
    config,
    database,
    client: historicalClient,
    logger,
    market: marketClient,
  });
  registerInstrumentRoutes(app, { search: searchClient, expiries: expiriesClient, market: marketClient });
  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Nifty 50 Trading Research API',
      description:
        'Health, readiness and raw Upstox market-data capture endpoints.',
    },
  });
  app.get('/docs', Scalar({ url: '/openapi.json' }));

  app.onError((error, c) => handleError(error, c, logger, config));

  return app;
}
