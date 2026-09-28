import type { Logger } from '../lib/logger';
import { buildCaptureBatch } from './batch';
import { decodeFeedResponse } from './protobuf';
import { BoundedQueue } from './queue';
import { IstSessionResolver, type SessionResolver } from './session';
import { CaptureStateMachine } from './state';
import type {
  CaptureBatch,
  CaptureErrorInput,
  CaptureService,
  CaptureSource,
  CaptureSourceCallbacks,
  CaptureStats,
  CaptureState,
  CaptureStatus,
  CaptureStoreAdapter,
  FeedMode,
} from './types';

export type CaptureServiceConfig = {
  enabled: boolean;
  feedMode: FeedMode;
  schemaVersion: string;
  queueCapacity: number;
  maxWriteBatchSize: number;
  flushIntervalMs: number;
  backpressureTimeoutMs: number;
};

export type CaptureServiceDependencies = {
  config: CaptureServiceConfig;
  store: CaptureStoreAdapter;
  source: CaptureSource | null;
  logger: Logger;
  sessionResolver?: SessionResolver;
};

const QUEUE_PRESSURE_RATIO = 0.8;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Raw capture orchestrator.
 *
 * Pipeline: source/receiver -> bounded queue -> batch writer -> SQLite.
 * The receiver never writes to SQLite directly; persistence happens only
 * in the periodic writer flush inside batched transactions.
 *
 * Queue overflow is never silent: it flips the service to DEGRADED,
 * records a RECEIVE/QUEUE_OVERFLOW error row and permanently marks the
 * dataset incomplete for this process lifetime.
 */
export class RawCaptureService implements CaptureService {
  private readonly machine = new CaptureStateMachine();
  private readonly queue: BoundedQueue<CaptureBatch>;
  private readonly sessionResolver: SessionResolver;
  private sourceConnectionId: string | null = null;
  private sessionDate: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private degraded = false;
  private incomplete = false;
  private batchesReceived = 0;
  private batchesPersisted = 0;
  private instrumentRowsReceived = 0;
  private instrumentRowsPersisted = 0;
  private errorCount = 0;
  private writeLatencyTotal = 0;
  private writeLatencyCount = 0;
  private lastWriteLatency = 0;
  private batchSizeTotal = 0;
  private batchSizeCount = 0;
  private lastBatchSize = 0;
  private maxBatchSize = 0;

  constructor(private readonly deps: CaptureServiceDependencies) {
    this.queue = new BoundedQueue<CaptureBatch>(deps.config.queueCapacity);
    this.sessionResolver =
      deps.sessionResolver ?? new IstSessionResolver();
  }

  get state(): CaptureState {
    return this.machine.state;
  }

  async start(): Promise<void> {
    const { config, source, logger } = this.deps;

    if (!config.enabled) {
      logger.info(
        'capture_started',
        'Capture disabled; service remains stopped',
      );
      return;
    }

    this.tryTransition('CONNECTING');
    this.stopping = false;
    this.startWriter();
    logger.info('capture_started', 'Capture service starting', {
      feedMode: config.feedMode,
      schemaVersion: config.schemaVersion,
      queueCapacity: config.queueCapacity,
    });

    if (source) {
      await source.start(this.callbacks());
    } else {
      this.tryTransition('CONNECTED');
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.tryTransition('STOPPING');

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.flush();

    const { source, logger } = this.deps;
    if (source) {
      await source.stop();
    }

    this.tryTransition('STOPPED');
    logger.info('capture_stopped', 'Capture service stopped', {
      batchesReceived: this.batchesReceived,
      batchesPersisted: this.batchesPersisted,
    });
  }

  async receive(
    payload: Uint8Array,
    receivedTs: number = Date.now(),
  ): Promise<void> {
    const { config, logger } = this.deps;
    this.batchesReceived += 1;

    const session = this.sessionResolver.resolve(receivedTs);
    this.sessionDate = session.sessionDate;

    let decoded: ReturnType<typeof decodeFeedResponse>;
    try {
      decoded = decodeFeedResponse(payload);
    } catch (error) {
      this.record({
        stage: 'DECODE',
        errorCode: 'MALFORMED_PROTOBUF',
        errorMessage: errorMessage(error),
        rawPayload: payload,
        receivedTs,
        sessionDate: this.sessionDate,
      });
      return;
    }

    for (const issue of decoded.issues) {
      this.record({
        stage: 'DECODE',
        errorCode: issue.errorCode,
        errorMessage: issue.errorMessage,
        instrumentKey: issue.instrumentKey,
        rawPayload: issue.rawPayload,
        receivedTs,
        sessionDate: this.sessionDate,
      });
    }

    const feedKeys = Object.keys(decoded.response.feeds);
    if (feedKeys.length === 0 && decoded.issues.length > 0) {
      return;
    }

    let batch: CaptureBatch;
    try {
      batch = buildCaptureBatch({
        response: decoded.response,
        rawPayload: payload,
        sourceConnectionId: this.sourceConnectionId ?? 'unknown',
        receivedTs,
        sessionDate: this.sessionDate,
        feedMode: config.feedMode,
        schemaVersion: config.schemaVersion,
      });
    } catch (error) {
      this.record({
        stage: 'SCHEMA_VALIDATE',
        errorCode: 'INVALID_BATCH',
        errorMessage: errorMessage(error),
        rawPayload: payload,
        receivedTs,
        sessionDate: this.sessionDate,
      });
      return;
    }

    this.instrumentRowsReceived += batch.instruments.length;

    const accepted = await this.queue.enqueue(
      batch,
      config.backpressureTimeoutMs,
    );
    if (!accepted) {
      this.degraded = true;
      this.incomplete = true;
      this.tryTransition('DEGRADED');
      this.record({
        stage: 'RECEIVE',
        errorCode: 'QUEUE_OVERFLOW',
        errorMessage: `Bounded queue full (${config.queueCapacity}); batch dropped under backpressure`,
        receivedTs,
        sessionDate: this.sessionDate,
      });
      logger.warn('queue_overflow', 'Queue saturated; batch dropped', {
        queueDepth: this.queue.depth,
        queueCapacity: this.queue.capacity,
        overflowCount: this.queue.overflowCount,
      });
      logger.warn('capture_degraded', 'Capture degraded after overflow');
      return;
    }

    if (
      this.queue.depth >=
      Math.floor(config.queueCapacity * QUEUE_PRESSURE_RATIO)
    ) {
      logger.warn('queue_pressure', 'Queue filling up', {
        queueDepth: this.queue.depth,
        queueCapacity: this.queue.capacity,
      });
    }

    if (this.machine.state === 'CONNECTED') {
      this.tryTransition('CAPTURING');
    }

    logger.debug('batch_received', 'Batch received', {
      instrumentCount: batch.instruments.length,
      queueDepth: this.queue.depth,
    });
  }

  getStatus(): CaptureStatus {
    return {
      capture_enabled: this.deps.config.enabled,
      capture_state: this.machine.state,
      source_connection_id: this.sourceConnectionId,
      session_date: this.sessionDate,
      queue_depth: this.queue.depth,
      queue_capacity: this.queue.capacity,
      capture_degraded: this.degraded || this.machine.state === 'DEGRADED',
      capture_incomplete: this.incomplete,
    };
  }

  getStats(): CaptureStats {
    return {
      batches_received: this.batchesReceived,
      batches_persisted: this.batchesPersisted,
      instrument_rows_received: this.instrumentRowsReceived,
      instrument_rows_persisted: this.instrumentRowsPersisted,
      queue_depth: this.queue.depth,
      queue_capacity: this.queue.capacity,
      queue_overflow_count: this.queue.overflowCount,
      capture_error_count: this.errorCount,
      average_write_latency:
        this.writeLatencyCount === 0
          ? 0
          : this.writeLatencyTotal / this.writeLatencyCount,
      last_write_latency: this.lastWriteLatency,
      average_batch_size:
        this.batchSizeCount === 0
          ? 0
          : this.batchSizeTotal / this.batchSizeCount,
      last_batch_size: this.lastBatchSize,
      max_batch_size: this.maxBatchSize,
      queue_average_wait_ms: this.queue.averageWaitMs,
    };
  }

  private callbacks(): CaptureSourceCallbacks {
    return {
      onConnecting: (sourceConnectionId) => {
        this.sourceConnectionId = sourceConnectionId;
        this.tryTransition('CONNECTING');
      },
      onConnected: (sourceConnectionId) => {
        this.sourceConnectionId = sourceConnectionId;
        this.tryTransition('CONNECTED');
        this.deps.logger.info(
          'websocket_connected',
          'Market-data source connected',
        );
      },
      onReady: (sourceConnectionId) => {
        this.sourceConnectionId = sourceConnectionId;
        this.tryTransition('CAPTURING');
      },
      onBatch: (payload, receivedTs) => this.receive(payload, receivedTs),
      onError: (error) => {
        this.record(error);
        if (error.errorCode === 'AUTHORIZE_FAILED') {
          this.incomplete = true;
          this.tryTransition('ERROR');
        }
      },
      onDisconnected: (_sourceConnectionId, code, reason) => {
        this.deps.logger.info(
          'websocket_disconnected',
          'Market-data source disconnected',
          { code, reason },
        );
        if (!this.stopping) {
          this.tryTransition('ERROR');
        }
      },
    };
  }

  private record(input: CaptureErrorInput): void {
    this.errorCount += 1;
    try {
      this.deps.store.recordError({
        ...input,
        sourceConnectionId:
          input.sourceConnectionId ?? this.sourceConnectionId ?? undefined,
      });
    } catch (error) {
      this.deps.logger.error(
        'capture_error',
        'Failed to record capture error',
        { detail: errorMessage(error) },
      );
    }
    this.deps.logger.warn('capture_error', 'Capture error recorded', {
      stage: input.stage,
      errorCode: input.errorCode,
    });
  }

  private startWriter(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.flush();
    }, this.deps.config.flushIntervalMs);
  }

  private async flush(): Promise<void> {
    const drained = this.queue.drain(this.deps.config.maxWriteBatchSize);
    if (drained.length === 0) {
      return;
    }

    const startedAt = performance.now();
    try {
      const results = this.deps.store.writeBatches(drained);
      const latency = performance.now() - startedAt;

      let persisted = 0;
      let rows = 0;
      for (const result of results) {
        if (result.batchInserted) {
          persisted += 1;
        }
        rows += result.instrumentRowsInserted;
      }

      this.batchesPersisted += persisted;
      this.instrumentRowsPersisted += rows;
      this.writeLatencyTotal += latency;
      this.writeLatencyCount += 1;
      this.lastWriteLatency = latency;
      this.batchSizeTotal += drained.length;
      this.batchSizeCount += 1;
      this.lastBatchSize = drained.length;
      this.maxBatchSize = Math.max(this.maxBatchSize, drained.length);

      if (this.degraded && this.queue.depth === 0) {
        this.degraded = false;
        this.tryTransition('CAPTURING');
      }

      this.deps.logger.debug('batch_persisted', 'Writer flushed batches', {
        batches: drained.length,
        persisted,
        instrumentRows: rows,
        latencyMs: Number(latency.toFixed(2)),
      });
    } catch (error) {
      this.incomplete = true;
      this.record({
        stage: 'DB_WRITE',
        errorCode: 'DB_WRITE_FAILED',
        errorMessage: errorMessage(error),
        receivedTs: Date.now(),
        sessionDate: this.sessionDate ?? undefined,
      });
      this.tryTransition('DEGRADED');
    }
  }

  private tryTransition(next: CaptureState): boolean {
    try {
      this.machine.transition(next);
      return true;
    } catch {
      return false;
    }
  }
}
