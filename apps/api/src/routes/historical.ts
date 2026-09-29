import { createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import type { AppConfig } from '../config/env';
import type { DatabaseContainer } from '../db';
import {
  prepareHistoricalDataset,
  readHistoricalDataset,
} from '../historical/service';
import { createUpstoxHolidayProvider } from '../historical/holidays';
import {
  readValidationReport,
  runValidation,
} from '../historical/validation';
import type { HistoricalClient } from '../historical/types';
import type { MarketClient } from '../instruments/upstox-market';
import type { Logger } from '../lib/logger';
import {
  ErrorSchema,
  HistoricalDatasetSchema,
  HistoricalRequestSchema,
  ValidationReportSchema,
} from '../openapi/schemas';
import type { OpenAPIHono } from '@hono/zod-openapi';

export type HistoricalDeps = {
  config: AppConfig;
  database: DatabaseContainer;
  client: HistoricalClient;
  logger: Logger;
  market?: MarketClient | null;
};

const createRouteDef = createRoute({
  method: 'post',
  path: '/historical/datasets',
  tags: ['historical'],
  summary: 'Acquire a historical candle dataset (Stage 1)',
  request: {
    body: {
      content: { 'application/json': { schema: HistoricalRequestSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: HistoricalDatasetSchema } },
      description: 'Dataset acquired, reused, resumed or partial',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid request',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Valid Upstox authentication required',
    },
  },
});

const getRouteDef = createRoute({
  method: 'get',
  path: '/historical/datasets/{datasetId}',
  tags: ['historical'],
  summary: 'Read acquisition metadata for a dataset',
  request: {
    params: z.object({ datasetId: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: HistoricalDatasetSchema } },
      description: 'Dataset metadata',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Dataset not found',
    },
  },
});

const validateRouteDef = createRoute({
  method: 'post',
  path: '/historical/datasets/{datasetId}/validation',
  tags: ['historical'],
  summary: 'Run integrity validation over a dataset (Stage 2)',
  request: {
    params: z.object({ datasetId: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ValidationReportSchema } },
      description: 'Integrity report with VALID / INVALID / INCOMPLETE verdict',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Dataset not found',
    },
  },
});

const readReportRouteDef = createRoute({
  method: 'get',
  path: '/historical/datasets/{datasetId}/validation',
  tags: ['historical'],
  summary: 'Read the stored integrity report for a dataset',
  request: {
    params: z.object({ datasetId: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ValidationReportSchema } },
      description: 'Stored integrity report',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Validation report not found',
    },
  },
});

export function registerHistoricalRoutes(
  app: OpenAPIHono,
  deps: HistoricalDeps,
): void {
  app.openapi(createRouteDef, async (c) => {
    const body = c.req.valid('json');
    const result = await prepareHistoricalDataset(
      {
        db: deps.database.db,
        client: deps.client,
        logger: deps.logger,
        config: {
          schemaVersion: deps.config.HISTORICAL_SCHEMA_VERSION,
          staleAfterMs: deps.config.HISTORICAL_STALE_AFTER_MS,
          fetchConcurrency: deps.config.HISTORICAL_FETCH_CONCURRENCY,
        },
      },
      {
        instrumentKey: body.instrumentKey,
        from: body.from,
        to: body.to,
        interval: body.interval,
        source: body.source,
      },
    );
    return c.json(result, 200);
  });

  app.openapi(getRouteDef, async (c) => {
    const { datasetId } = c.req.valid('param');
    const result = await readHistoricalDataset(
      deps.database.db,
      datasetId,
    );
    if (!result) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Dataset not found' } },
        404,
      );
    }
    return c.json(result, 200);
  });

  app.openapi(validateRouteDef, async (c) => {
    const { datasetId } = c.req.valid('param');
    const report = await runValidation(
      {
        db: deps.database.db,
        logger: deps.logger,
        holidays: deps.market
          ? createUpstoxHolidayProvider(deps.market, deps.logger)
          : undefined,
      },
      datasetId,
    );
    if (!report) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Dataset not found' } },
        404,
      );
    }
    return c.json(report, 200);
  });

  app.openapi(readReportRouteDef, async (c) => {
    const { datasetId } = c.req.valid('param');
    const report = await readValidationReport(deps.database.db, datasetId);
    if (!report) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Validation report not found' } },
        404,
      );
    }
    return c.json(report, 200);
  });
}
