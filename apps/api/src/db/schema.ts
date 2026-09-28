import {
  blob,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const databaseProbe = sqliteTable('database_probe', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  marker: text('marker').notNull(),
});

export const rawBatches = sqliteTable(
  'raw_batches',
  {
    batchId: text('batch_id').primaryKey(),
    sourceConnectionId: text('source_connection_id').notNull(),
    receivedTs: integer('received_ts').notNull(),
    currentTs: integer('current_ts'),
    sessionDate: text('session_date').notNull(),
    feedMode: text('feed_mode').notNull(),
    schemaVersion: text('schema_version').notNull(),
    batchHash: text('batch_hash').notNull(),
    rawPayload: blob('raw_payload').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    batchHashUnique: uniqueIndex('raw_batches_batch_hash_unique').on(
      table.batchHash,
    ),
  }),
);

export const rawMarketMessages = sqliteTable(
  'raw_market_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    batchId: text('batch_id').notNull(),
    instrumentKey: text('instrument_key').notNull(),
    currentTs: integer('current_ts'),
    ltt: integer('ltt'),
    receivedTs: integer('received_ts').notNull(),
    sessionDate: text('session_date').notNull(),
    feedMode: text('feed_mode').notNull(),
    schemaVersion: text('schema_version').notNull(),
    instrumentPayloadHash: text('instrument_payload_hash').notNull(),
    rawPayload: text('raw_payload').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    batchForeignKey: foreignKey({
      columns: [table.batchId],
      foreignColumns: [rawBatches.batchId],
      name: 'raw_market_messages_batch_id_fk',
    }).onDelete('cascade'),
    instrumentDedupUnique: uniqueIndex(
      'raw_market_messages_instrument_dedup_unique',
    ).on(
      table.instrumentKey,
      table.currentTs,
      table.instrumentPayloadHash,
    ),
    batchIdIndex: index('raw_market_messages_batch_id_idx').on(
      table.batchId,
    ),
  }),
);
export const captureErrors = sqliteTable(
  'capture_errors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceConnectionId: text('source_connection_id'),
    batchId: text('batch_id'),
    instrumentKey: text('instrument_key'),
    receivedTs: integer('received_ts'),
    sessionDate: text('session_date'),
    stage: text('stage').notNull(),
    errorCode: text('error_code').notNull(),
    errorMessage: text('error_message').notNull(),
    rawPayload: text('raw_payload'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    batchForeignKey: foreignKey({
      columns: [table.batchId],
      foreignColumns: [rawBatches.batchId],
      name: 'capture_errors_batch_id_fk',
    }).onDelete('set null'),
  }),
);

export const historicalDatasets = sqliteTable(
  'historical_datasets',
  {
    datasetId: text('dataset_id').primaryKey(),
    instrumentKey: text('instrument_key').notNull(),
    requestedFrom: text('requested_from').notNull(),
    requestedTo: text('requested_to').notNull(),
    unit: text('unit').notNull(),
    interval: integer('interval').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull(),
    chunksTotal: integer('chunks_total').notNull(),
    chunksCompleted: integer('chunks_completed').notNull().default(0),
    chunksFailed: integer('chunks_failed').notNull().default(0),
    recordCount: integer('record_count').notNull().default(0),
    schemaVersion: text('schema_version').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    instrumentIndex: index('historical_datasets_instrument_idx').on(
      table.instrumentKey,
    ),
  }),
);

export const historicalChunks = sqliteTable(
  'historical_chunks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    datasetId: text('dataset_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    chunkFrom: text('chunk_from').notNull(),
    chunkTo: text('chunk_to').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    recordCount: integer('record_count').notNull().default(0),
    responseHash: text('response_hash'),
    requestedAt: integer('requested_at'),
    respondedAt: integer('responded_at'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (table) => ({
    datasetForeignKey: foreignKey({
      columns: [table.datasetId],
      foreignColumns: [historicalDatasets.datasetId],
      name: 'historical_chunks_dataset_id_fk',
    }).onDelete('cascade'),
    datasetChunkUnique: uniqueIndex(
      'historical_chunks_dataset_chunk_unique',
    ).on(table.datasetId, table.chunkIndex),
  }),
);

export const historicalRawResponses = sqliteTable(
  'historical_raw_responses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    datasetId: text('dataset_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    rawPayload: text('raw_payload').notNull(),
    responseHash: text('response_hash').notNull(),
    acquiredAt: integer('acquired_at').notNull(),
  },
  (table) => ({
    datasetForeignKey: foreignKey({
      columns: [table.datasetId],
      foreignColumns: [historicalDatasets.datasetId],
      name: 'historical_raw_responses_dataset_id_fk',
    }).onDelete('cascade'),
    datasetChunkUnique: uniqueIndex(
      'historical_raw_responses_dataset_chunk_unique',
    ).on(table.datasetId, table.chunkIndex),
  }),
);

export const historicalCandles = sqliteTable(
  'historical_candles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    datasetId: text('dataset_id').notNull(),
    instrumentKey: text('instrument_key').notNull(),
    timestamp: integer('timestamp').notNull(),
    open: real('open').notNull(),
    high: real('high').notNull(),
    low: real('low').notNull(),
    close: real('close').notNull(),
    volume: real('volume').notNull(),
    openInterest: real('open_interest'),
    unit: text('unit').notNull(),
    interval: integer('interval').notNull(),
  },
  (table) => ({
    datasetForeignKey: foreignKey({
      columns: [table.datasetId],
      foreignColumns: [historicalDatasets.datasetId],
      name: 'historical_candles_dataset_id_fk',
    }).onDelete('cascade'),
    datasetTimestampUnique: uniqueIndex(
      'historical_candles_dataset_timestamp_unique',
    ).on(table.datasetId, table.timestamp),
    datasetTimestampIndex: index(
      'historical_candles_dataset_timestamp_idx',
    ).on(table.timestamp),
  }),
);

export const validationReports = sqliteTable('validation_reports', {
  datasetId: text('dataset_id')
    .primaryKey()
    .references(() => historicalDatasets.datasetId, { onDelete: 'cascade' }),
  verdict: text('verdict').notNull(),
  candleCount: integer('candle_count').notNull(),
  expectedCount: integer('expected_count').notNull(),
  matchedCount: integer('matched_count').notNull(),
  completeness: real('completeness').notNull(),
  details: text('details').notNull(),
  schemaVersion: text('schema_version').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
