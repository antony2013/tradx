export type HistoricalUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months';

export type HistoricalSource = 'upstox';

export type DatasetStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETE'
  | 'PARTIAL'
  | 'FAILED';

export type ChunkStatus = 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED';

export type HistoricalErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_INTERVAL'
  | 'AUTHENTICATION_ERROR'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'PARTIAL_DATASET';

export type HistoricalRequestInput = {
  instrumentKey: string;
  from: string;
  to: string;
  interval: string;
  source?: string;
};

export type ValidatedHistoricalRequest = {
  instrumentKey: string;
  from: string;
  to: string;
  unit: HistoricalUnit;
  interval: number;
  source: HistoricalSource;
  expired: boolean;
};

export type DateChunk = {
  index: number;
  from: string;
  to: string;
};

export type NormalizedCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number | null;
};

export type FetchedChunk = {
  candles: NormalizedCandle[];
  rawText: string;
  responseHash: string;
  respondedAt: number;
};

export type HistoricalClient = {
  fetchChunk(input: {
    instrumentKey: string;
    unit: HistoricalUnit;
    interval: number;
    from: string;
    to: string;
    datasetId: string;
    chunkIndex: number;
  }): Promise<FetchedChunk>;
  fetchExpiredChunk(input: {
    expiredKey: string;
    unit: HistoricalUnit;
    interval: number;
    from: string;
    to: string;
    datasetId: string;
    chunkIndex: number;
  }): Promise<FetchedChunk>;
};

export type HistoricalResult = {
  dataset_id: string;
  instrument_key: string;
  requested_from: string;
  requested_to: string;
  unit: HistoricalUnit;
  interval: number;
  source: HistoricalSource;
  status: DatasetStatus;
  chunks_total: number;
  chunks_completed: number;
  chunks_failed: number;
  record_count: number;
  schema_version: string;
  created_at: number;
  updated_at: number;
  reused: boolean;
};
