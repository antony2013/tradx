import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { CaptureService, SubscribableSource } from '../capture/types';
import {
  CaptureStatsSchema,
  CaptureStatusSchema,
  ErrorSchema,
  SubscriptionResultSchema,
  SubscriptionStateSchema,
  SubscriptionUpdateSchema,
} from '../openapi/schemas';

const statusRoute = createRoute({
  method: 'get',
  path: '/capture/status',
  tags: ['capture'],
  summary: 'Capture state and queue depth',
  responses: {
    200: {
      content: { 'application/json': { schema: CaptureStatusSchema } },
      description: 'Current capture status',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Capture service is not configured',
    },
  },
});

const statsRoute = createRoute({
  method: 'get',
  path: '/capture/stats',
  tags: ['capture'],
  summary: 'Capture counters and write latency',
  responses: {
    200: {
      content: { 'application/json': { schema: CaptureStatsSchema } },
      description: 'Current capture statistics',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Capture service is not configured',
    },
  },
});

const subscriptionsGetRoute = createRoute({
  method: 'get',
  path: '/capture/subscriptions',
  tags: ['capture'],
  summary: 'Currently subscribed instrument keys and feed mode',
  responses: {
    200: {
      content: { 'application/json': { schema: SubscriptionStateSchema } },
      description: 'Live subscription set (single key or many)',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Capture source is not configured',
    },
  },
});

const subscriptionsUpdateRoute = createRoute({
  method: 'post',
  path: '/capture/subscriptions',
  tags: ['capture'],
  summary: 'Subscribe or unsubscribe instrument keys at runtime',
  request: {
    body: {
      content: { 'application/json': { schema: SubscriptionUpdateSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SubscriptionResultSchema } },
      description: 'Updated subscription set',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid request',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Capture source is not configured',
    },
  },
});

function disabled(message: string) {
  return { error: { code: 'CAPTURE_DISABLED', message } };
}

function lifecycleResponses(description: string) {
  return {
    200: {
      content: { 'application/json': { schema: CaptureStatusSchema } },
      description,
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Capture service or source is not configured',
    },
  } as const;
}

const startRoute = createRoute({
  method: 'post',
  path: '/capture/start',
  tags: ['capture'],
  summary: 'Manually start the live capture feed (no auto-start on boot)',
  responses: lifecycleResponses('Capture state after start'),
});

const stopRoute = createRoute({
  method: 'post',
  path: '/capture/stop',
  tags: ['capture'],
  summary: 'Manually stop the live capture feed (flushes pending batches)',
  responses: lifecycleResponses('Capture state after stop'),
});

export function registerCaptureRoutes(
  app: OpenAPIHono,
  getService: () => CaptureService | null,
  getSource: () => SubscribableSource | null = () => null,
): void {
  app.openapi(statusRoute, (c) => {
    const service = getService();
    if (!service) {
      return c.json(disabled('Capture service is not configured'), 503);
    }
    return c.json(service.getStatus(), 200);
  });

  app.openapi(statsRoute, (c) => {
    const service = getService();
    if (!service) {
      return c.json(disabled('Capture service is not configured'), 503);
    }
    return c.json(service.getStats(), 200);
  });

  app.openapi(subscriptionsGetRoute, (c) => {
    const source = getSource();
    if (!source) {
      return c.json(disabled('Capture source is not configured'), 503);
    }
    return c.json({ feed_mode: source.getFeedMode(), instrument_keys: source.getSubscribedKeys() }, 200);
  });

  app.openapi(subscriptionsUpdateRoute, (c) => {
    const source = getSource();
    if (!source) {
      return c.json(disabled('Capture source is not configured'), 503);
    }
    const body = c.req.valid('json');
    const change =
      body.action === 'sub'
        ? source.subscribe(body.instrumentKeys)
        : source.unsubscribe(body.instrumentKeys);
    return c.json(
      { action: body.action, ...change, instrument_keys: source.getSubscribedKeys() },
      200,
    );
  });

  app.openapi(startRoute, async (c) => {
    const service = getService();
    const source = getSource();
    if (!service || !source) {
      return c.json(
        disabled('Capture service or source is not configured'),
        503,
      );
    }
    // Service and source start() are idempotent: a second POST is a no-op
    // that reports the current state instead of double-connecting.
    await service.start();
    return c.json(service.getStatus(), 200);
  });

  app.openapi(stopRoute, async (c) => {
    const service = getService();
    if (!service) {
      return c.json(disabled('Capture service is not configured'), 503);
    }
    await service.stop();
    return c.json(service.getStatus(), 200);
  });
}
