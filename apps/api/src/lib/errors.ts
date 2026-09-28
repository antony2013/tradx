import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HTTPException } from 'hono/http-exception';
import type { AppConfig } from '../config/env';
import type { Logger } from './logger';

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly expose: boolean;

  constructor(
    code: string,
    message: string,
    status = 400,
    expose = status < 500,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.expose = expose;
  }
}

export function handleError(
  error: unknown,
  c: Context,
  logger: Logger,
  config: AppConfig,
): Response {
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let status = 500;

  if (error instanceof HTTPException) {
    status = error.status;
    code = `HTTP_${status}`;
    message = status >= 500 ? 'Internal server error' : error.message;
  } else if (error instanceof AppError) {
    code = error.code;
    status = error.status;
    message = error.expose ? error.message : 'Internal server error';
  } else {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    logger.error('unhandled_error', detail, {
      stack: config.NODE_ENV === 'production' ? undefined : error instanceof Error ? error.stack : undefined,
    });
  }

  return c.json(
    {
      error: {
        code,
        message,
      },
    },
    status as ContentfulStatusCode,
  );
}
