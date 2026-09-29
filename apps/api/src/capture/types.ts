export type CaptureState =
  | 'STOPPED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'CAPTURING'
  | 'DEGRADED'
  | 'ERROR'
  | 'STOPPING';

export type CaptureStage =
  | 'RECEIVE'
  | 'DECODE'
  | 'SCHEMA_VALIDATE'
  | 'FANOUT'
  | 'HASH'
  | 'DB_WRITE';

export type FeedMode = 'ltpc' | 'full' | 'option_greeks' | 'full_d30';

export type FeedResponse = {
  type: number;
  feeds: Record<string, unknown>;
  currentTs?: string;
  marketInfo?: unknown;
};

export type DecodeIssue = {
  instrumentKey?: string;
  errorCode: string;
  errorMessage: string;
  rawPayload?: Uint8Array;
};

export type DecodedFeedResponse = {
  response: FeedResponse;
  issues: DecodeIssue[];
};

export type InstrumentMessage = {
  instrumentKey: string;
  currentTs?: number;
  ltt?: number;
  payload: unknown;
  payloadHash: string;
};

export type CaptureBatch = {
  batchId: string;
  sourceConnectionId: string;
  receivedTs: number;
  currentTs?: number;
  sessionDate: string;
  feedMode: FeedMode;
  schemaVersion: string;
  batchHash: string;
  rawPayload: Uint8Array;
  instruments: InstrumentMessage[];
};

export type CaptureErrorInput = {
  sourceConnectionId?: string;
  batchId?: string;
  instrumentKey?: string;
  receivedTs?: number;
  sessionDate?: string;
  stage: CaptureStage;
  errorCode: string;
  errorMessage: string;
  rawPayload?: Uint8Array | string;
};

export type CaptureStatus = {
  capture_enabled: boolean;
  capture_state: CaptureState;
  source_connection_id: string | null;
  session_date: string | null;
  queue_depth: number;
  queue_capacity: number;
  capture_degraded: boolean;
  capture_incomplete: boolean;
};

export type CaptureStats = {
  batches_received: number;
  batches_persisted: number;
  instrument_rows_received: number;
  instrument_rows_persisted: number;
  queue_depth: number;
  queue_capacity: number;
  queue_overflow_count: number;
  capture_error_count: number;
  average_write_latency: number;
  last_write_latency: number;
  average_batch_size: number;
  last_batch_size: number;
  max_batch_size: number;
  queue_average_wait_ms: number;
};

export type WriteBatchResult = {
  batchInserted: boolean;
  instrumentRowsInserted: number;
};

export type CaptureStoreAdapter = {
  writeBatch(batch: CaptureBatch): WriteBatchResult;
  writeBatches(batches: CaptureBatch[]): WriteBatchResult[];
  recordError(error: CaptureErrorInput): void;
  close(): void;
};

export type CaptureSourceCallbacks = {
  onConnecting: (sourceConnectionId: string) => void;
  onConnected: (sourceConnectionId: string) => void;
  onReady: (sourceConnectionId: string) => void;
  onBatch: (payload: Uint8Array, receivedTs: number) => void | Promise<void>;
  onError: (error: CaptureErrorInput) => void;
  onDisconnected: (
    sourceConnectionId: string,
    code?: number,
    reason?: string,
  ) => void;
};

export type CaptureSource = {
  start(callbacks: CaptureSourceCallbacks): void | Promise<void>;
  stop(): void | Promise<void>;
};

export type SubscriptionChange = {
  added?: string[];
  removed?: string[];
  invalid?: string[];
  missing?: string[];
};

/**
 * A live source whose instrument subscriptions can change at runtime
 * (single key or many). Implemented by the Upstox feed source.
 * Manual start/stop ride on the base CaptureSource lifecycle.
 */
export type SubscribableSource = CaptureSource & {
  getSubscribedKeys(): string[];
  getFeedMode(): string;
  subscribe(keys: string[]): SubscriptionChange;
  unsubscribe(keys: string[]): SubscriptionChange;
};

export type CaptureService = {
  start(): Promise<void>;
  stop(): Promise<void>;
  receive(payload: Uint8Array, receivedTs?: number): Promise<void>;
  getStatus(): CaptureStatus;
  getStats(): CaptureStats;
};
