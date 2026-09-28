import { AppError } from '../lib/errors';
import type { HistoricalErrorCode } from './types';

const statusByCode: Record<HistoricalErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNSUPPORTED_INTERVAL: 400,
  AUTHENTICATION_ERROR: 401,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  NETWORK_ERROR: 502,
  TIMEOUT: 504,
  INVALID_RESPONSE: 502,
  PARTIAL_DATASET: 200,
};

export class HistoricalError extends AppError {
  constructor(code: HistoricalErrorCode, message: string) {
    super(code, message, statusByCode[code], statusByCode[code] < 500);
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed|unique constraint/i.test(error.message)
  );
}
