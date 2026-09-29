import { isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export const projectRoot = resolve(moduleDirectory, '../..');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().trim().min(1),
  CAPTURE_ENABLED: z.enum(['true', 'false']).default('false'),
  UPSTOX_ACCESS_TOKEN: z.string().trim().min(1).optional(),
  UPSTOX_INSTRUMENT_KEYS: z.string().trim().optional(),
  UPSTOX_FEED_MODE: z
    .enum(['ltpc', 'full', 'option_greeks', 'full_d30'])
    .default('ltpc'),
  UPSTOX_AUTHORIZE_URL: z
    .string()
    .trim()
    .url()
    .default('https://api.upstox.com/v3/feed/market-data-feed/authorize'),
  CAPTURE_ROOT_PATH: z.string().trim().min(1).default('data/capture'),
  CAPTURE_SCHEMA_VERSION: z
    .string()
    .trim()
    .min(1)
    .default('upstox-v3-raw-1'),
  CAPTURE_QUEUE_CAPACITY: z.coerce.number().int().min(1).default(1000),
  CAPTURE_MAX_WRITE_BATCH_SIZE: z.coerce.number().int().min(1).default(100),
  CAPTURE_FLUSH_INTERVAL_MS: z.coerce.number().int().min(1).default(100),
  CAPTURE_BACKPRESSURE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(1000),
  CAPTURE_RECONNECT_MIN_MS: z.coerce.number().int().min(1).default(1000),
  CAPTURE_RECONNECT_MAX_MS: z.coerce.number().int().min(1).default(30000),
  UPSTOX_HISTORY_BASE_URL: z
    .string()
    .trim()
    .url()
    .default('https://api.upstox.com/v3'),
  UPSTOX_EXPIRED_BASE_URL: z
    .string()
    .trim()
    .url()
    .default('https://api.upstox.com/v2'),
  HISTORICAL_SCHEMA_VERSION: z
    .string()
    .trim()
    .min(1)
    .default('upstox-v3-candles-1'),
  HISTORICAL_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  HISTORICAL_INITIAL_RETRY_DELAY_MS: z.coerce.number().int().min(1).default(500),
  HISTORICAL_MAX_RETRY_DELAY_MS: z.coerce.number().int().min(1).default(8000),
  // Stale-run lease: a RUNNING/PENDING dataset with no progress (no fresh
  // RUNNING chunk, no recent dataset heartbeat) older than this is treated
  // as crashed and becomes resumable instead of reused forever.
  HISTORICAL_STALE_AFTER_MS: z.coerce.number().int().min(1000).default(900000),
  // Shared Upstox HTTP timeout (historical, search, expiries, market).
  // HISTORICAL_REQUEST_TIMEOUT_MS is a deprecated alias: honored when the
  // new name is unset so existing deployments keep their tuned value.
  UPSTOX_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1).optional(),
  HISTORICAL_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1).optional(),
});

export const DEFAULT_UPSTOX_REQUEST_TIMEOUT_MS = 15000;

export type AppConfig = Omit<
  z.infer<typeof envSchema>,
  'UPSTOX_REQUEST_TIMEOUT_MS' | 'HISTORICAL_REQUEST_TIMEOUT_MS'
> & {
  requestTimeoutMs: number;
  databasePath: string;
  projectRoot: string;
};

export class EnvValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>;

  constructor(fieldErrors: Record<string, string[]>) {
    super('Invalid environment configuration');
    this.name = 'EnvValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): AppConfig {
  const parsed = envSchema.safeParse(environment);

  if (!parsed.success) {
    throw new EnvValidationError(
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
    );
  }

  const databasePath = isAbsolute(parsed.data.DATABASE_PATH)
    ? parsed.data.DATABASE_PATH
    : resolve(projectRoot, parsed.data.DATABASE_PATH);

  const requestTimeoutMs =
    parsed.data.UPSTOX_REQUEST_TIMEOUT_MS ??
    parsed.data.HISTORICAL_REQUEST_TIMEOUT_MS ??
    DEFAULT_UPSTOX_REQUEST_TIMEOUT_MS;

  const {
    UPSTOX_REQUEST_TIMEOUT_MS: _newTimeout,
    HISTORICAL_REQUEST_TIMEOUT_MS: _legacyTimeout,
    ...rest
  } = parsed.data;

  return {
    ...rest,
    requestTimeoutMs,
    databasePath,
    projectRoot,
  };
}
