import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { DatabaseContainer } from '../db';
import { checkReadiness } from '../services/readiness';
import { ErrorSchema, ReadySchema } from '../openapi/schemas';

const readyRoute = createRoute({
  method: 'get',
  path: '/ready',
  tags: ['system'],
  summary: 'Readiness including dependencies',
  responses: {
    200: {
      content: { 'application/json': { schema: ReadySchema } },
      description: 'Service is ready to operate',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'A dependency is not ready',
    },
  },
});

export function registerReadyRoute(
  app: OpenAPIHono,
  database: DatabaseContainer,
): void {
  app.openapi(readyRoute, async (c) => {
    const readiness = await checkReadiness(database);
    return c.json({ status: 'ok' as const, dependencies: readiness }, 200);
  });
}
