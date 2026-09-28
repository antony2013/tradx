import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { HealthSchema } from '../openapi/schemas';

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  summary: 'Basic process health',
  responses: {
    200: {
      content: { 'application/json': { schema: HealthSchema } },
      description: 'Service is running',
    },
  },
});

export function registerHealthRoute(app: OpenAPIHono): void {
  app.openapi(healthRoute, (c) => c.json({ status: 'ok' as const }, 200));
}
