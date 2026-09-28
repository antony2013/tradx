import { resolve } from 'node:path';
import { createApp } from './app';
import { RawCaptureService } from './capture/service';
import { CaptureStore } from './capture/store';
import { UpstoxMarketFeedSource } from './capture/upstox-source';
import { loadConfig } from './config/env';
import { closeDatabase, createDatabase } from './db';
import { runMigrations } from './db/migrate';
import { UpstoxHistoricalClient } from './historical/upstox-client';
import { UpstoxExpiriesClient } from './instruments/upstox-expiries';
import { UpstoxMarketClient } from './instruments/upstox-market';
import { UpstoxSearchClient } from './instruments/upstox-search';
import { createLogger } from './lib/logger';

const config = loadConfig();
const database = createDatabase(config.databasePath);
runMigrations(database, resolve(config.projectRoot, 'drizzle'));
const logger = createLogger(config.NODE_ENV);

const captureStore = new CaptureStore(
  config.projectRoot,
  config.CAPTURE_ROOT_PATH,
  resolve(config.projectRoot, 'drizzle'),
);

function parseInstrumentKeys(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

function buildCaptureSource(): UpstoxMarketFeedSource | null {
  if (config.CAPTURE_ENABLED !== 'true') {
    return null;
  }

  if (!config.UPSTOX_ACCESS_TOKEN) {
    logger.error(
      'capture_not_started',
      'CAPTURE_ENABLED=true but UPSTOX_ACCESS_TOKEN is missing; capture stays stopped',
    );
    return null;
  }

  const instrumentKeys = parseInstrumentKeys(config.UPSTOX_INSTRUMENT_KEYS);
  if (instrumentKeys.length === 0) {
    logger.error(
      'capture_not_started',
      'CAPTURE_ENABLED=true but UPSTOX_INSTRUMENT_KEYS is empty; capture stays stopped',
    );
    return null;
  }

  return new UpstoxMarketFeedSource(
    {
      authorizeUrl: config.UPSTOX_AUTHORIZE_URL,
      accessToken: config.UPSTOX_ACCESS_TOKEN,
      instrumentKeys,
      feedMode: config.UPSTOX_FEED_MODE,
      reconnectMinMs: config.CAPTURE_RECONNECT_MIN_MS,
      reconnectMaxMs: config.CAPTURE_RECONNECT_MAX_MS,
    },
    undefined,
    logger,
  );
}

const captureSource = buildCaptureSource();
const capture =
  config.CAPTURE_ENABLED === 'true'
    ? new RawCaptureService({
        config: {
          enabled: true,
          feedMode: config.UPSTOX_FEED_MODE,
          schemaVersion: config.CAPTURE_SCHEMA_VERSION,
          queueCapacity: config.CAPTURE_QUEUE_CAPACITY,
          maxWriteBatchSize: config.CAPTURE_MAX_WRITE_BATCH_SIZE,
          flushIntervalMs: config.CAPTURE_FLUSH_INTERVAL_MS,
          backpressureTimeoutMs: config.CAPTURE_BACKPRESSURE_TIMEOUT_MS,
        },
        store: captureStore,
        source: captureSource,
        logger,
      })
    : null;

if (capture && !captureSource) {
  logger.warn(
    'capture_degraded',
    'Capture service created without a live source; it stays stopped until configured',
  );
}

export const app = createApp({
  config,
  database,
  logger,
  capture,
  captureSource,
  historicalClient: new UpstoxHistoricalClient(
    {
      baseUrl: config.UPSTOX_HISTORY_BASE_URL,
      expiredBaseUrl: config.UPSTOX_EXPIRED_BASE_URL,
      accessToken: config.UPSTOX_ACCESS_TOKEN ?? '',
      maxRetries: config.HISTORICAL_MAX_RETRIES,
      initialRetryDelayMs: config.HISTORICAL_INITIAL_RETRY_DELAY_MS,
      maxRetryDelayMs: config.HISTORICAL_MAX_RETRY_DELAY_MS,
      requestTimeoutMs: config.HISTORICAL_REQUEST_TIMEOUT_MS,
    },
    logger,
  ),
  searchClient: new UpstoxSearchClient(
    {
      baseUrl: 'https://api.upstox.com/v2',
      accessToken: config.UPSTOX_ACCESS_TOKEN ?? '',
      requestTimeoutMs: config.HISTORICAL_REQUEST_TIMEOUT_MS,
    },
    logger,
  ),
  expiriesClient: new UpstoxExpiriesClient(
    {
      baseUrl: 'https://api.upstox.com/v2',
      accessToken: config.UPSTOX_ACCESS_TOKEN ?? '',
      requestTimeoutMs: config.HISTORICAL_REQUEST_TIMEOUT_MS,
    },
    logger,
  ),
  marketClient: new UpstoxMarketClient(
    {
      baseUrl: 'https://api.upstox.com/v2',
      accessToken: config.UPSTOX_ACCESS_TOKEN ?? '',
      requestTimeoutMs: config.HISTORICAL_REQUEST_TIMEOUT_MS,
    },
    logger,
  ),
});

if (capture && captureSource) {
  capture.start().catch((error: unknown) => {
    logger.error('capture_not_started', 'Capture service failed to start', {
      detail: error instanceof Error ? error.message : 'Unknown error',
    });
  });
}

const server = Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
});

logger.info('server_started', 'API server is listening', {
  port: server.port,
});

async function shutdown(signal: string): Promise<void> {
  logger.info('server_stopping', `API server is stopping (${signal})`);
  if (capture) {
    await capture.stop().catch(() => undefined);
  }
  captureStore.close();
  await closeDatabase(database);
  server.stop();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
