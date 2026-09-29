import { z } from '@hono/zod-openapi';

export const HealthSchema = z
  .object({ status: z.literal('ok') })
  .openapi('Health');

export const ReadySchema = z
  .object({
    status: z.literal('ok'),
    dependencies: z.object({ database: z.literal('ready') }),
  })
  .openapi('Ready');

export const ErrorSchema = z
  .object({
    error: z.object({ code: z.string(), message: z.string() }),
  })
  .openapi('Error');

export const CaptureStatusSchema = z
  .object({
    capture_enabled: z.boolean(),
    capture_state: z.enum([
      'STOPPED',
      'CONNECTING',
      'CONNECTED',
      'CAPTURING',
      'DEGRADED',
      'ERROR',
      'STOPPING',
    ]),
    source_connection_id: z.string().nullable(),
    session_date: z.string().nullable(),
    queue_depth: z.number(),
    queue_capacity: z.number(),
    capture_degraded: z.boolean(),
    capture_incomplete: z.boolean(),
  })
  .openapi('CaptureStatus');

export const CaptureStatsSchema = z
  .object({
    batches_received: z.number(),
    batches_persisted: z.number(),
    instrument_rows_received: z.number(),
    instrument_rows_persisted: z.number(),
    queue_depth: z.number(),
    queue_capacity: z.number(),
    queue_overflow_count: z.number(),
    capture_error_count: z.number(),
    average_write_latency: z.number(),
    last_write_latency: z.number(),
    average_batch_size: z.number(),
    last_batch_size: z.number(),
    max_batch_size: z.number(),
    queue_average_wait_ms: z.number(),
  })
  .openapi('CaptureStats');

export const SubscriptionUpdateSchema = z
  .object({
    action: z.enum(['sub', 'unsub']).openapi({
      example: 'sub',
    }),
    instrumentKeys: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(500)
      .openapi({ example: ['NSE_FO|73985'] }),
  })
  .openapi('SubscriptionUpdate');

export const SubscriptionStateSchema = z
  .object({
    feed_mode: z.string(),
    instrument_keys: z.array(z.string()),
  })
  .openapi('SubscriptionState');

export const SubscriptionResultSchema = z
  .object({
    action: z.enum(['sub', 'unsub']),
    added: z.array(z.string()).optional(),
    removed: z.array(z.string()).optional(),
    invalid: z.array(z.string()).optional(),
    missing: z.array(z.string()).optional(),
    instrument_keys: z.array(z.string()),
  })
  .openapi('SubscriptionResult');

export const HistoricalRequestSchema = z
  .object({
    instrumentKey: z.string().min(1).openapi({
      example: 'NSE_INDEX|Nifty 50',
    }),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({
      example: '2026-09-01',
    }),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({
      example: '2026-09-23',
    }),
    interval: z.string().min(1).openapi({ example: '1day' }),
    source: z.string().min(1).default('upstox').openapi({
      example: 'upstox',
    }),
  })
  .openapi('HistoricalRequest');

export const HistoricalDatasetSchema = z
  .object({
    dataset_id: z.string(),
    instrument_key: z.string(),
    requested_from: z.string(),
    requested_to: z.string(),
    unit: z.enum(['minutes', 'hours', 'days', 'weeks', 'months']),
    interval: z.number(),
    source: z.string(),
    status: z.enum(['PENDING', 'RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED']),
    chunks_total: z.number(),
    chunks_completed: z.number(),
    chunks_failed: z.number(),
    record_count: z.number(),
    schema_version: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
    reused: z.boolean(),
  })
  .openapi('HistoricalDataset');

const gapValue = z.union([z.string(), z.number()]);

export const ValidationReportSchema = z
  .object({
    dataset_id: z.string(),
    verdict: z.enum(['VALID', 'INVALID', 'INCOMPLETE']),
    candle_count: z.number(),
    expected_count: z.number(),
    matched_count: z.number(),
    completeness: z.number(),
    ohlc_issue_count: z.number(),
    timestamp_issue_count: z.number(),
    duplicate_count: z.number(),
    conflict_count: z.number(),
    gap_count: z.number(),
    unexpected_count: z.number(),
    ohlc_issues: z.array(z.object({
      timestamp: z.number(),
      code: z.string(),
      detail: z.string(),
    })),
    timestamp_issues: z.array(z.object({
      timestamp: z.number(),
      code: z.string(),
      detail: z.string(),
    })),
    duplicates: z.array(z.object({
      timestamp: z.number(),
      count: z.number(),
      conflicting: z.boolean(),
      sample: z.object({
        timestamp: z.number(),
        open: z.number(),
        high: z.number(),
        low: z.number(),
        close: z.number(),
        volume: z.number(),
        openInterest: z.number().nullable(),
      }),
    })),
    gaps: z.array(gapValue),
    unexpected_sample: z.array(gapValue),
    session_template: z
      .object({ openMin: z.number(), closeMin: z.number() })
      .nullable(),
    notes: z.array(z.string()),
    schema_version: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .openapi('ValidationReport');

export const InstrumentSearchQuerySchema = z.object({
  query: z.string().min(1).max(50).openapi({ example: 'NIFTY' }),
  exchanges: z.string().optional().openapi({ example: 'NSE' }),
  segments: z.string().optional().openapi({ example: 'FO' }),
  instrument_types: z.string().optional().openapi({ example: 'CE' }),
  expiry: z.string().optional().openapi({ example: 'current_week' }),
  atm_offset: z.string().optional().openapi({ example: '0' }),
  page_number: z.string().optional().openapi({ example: '1' }),
  records: z.string().optional().openapi({ example: '10' }),
});

export const InstrumentSearchResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          instrument_key: z.string(),
          trading_symbol: z.string().optional(),
          exchange: z.string().optional(),
          segment: z.string().optional(),
          instrument_type: z.string().optional(),
          expiry: z.string().optional(),
          strike_price: z.number().optional(),
          lot_size: z.number().optional(),
        })
        .passthrough(),
    ),
    meta: z.unknown().nullable(),
  })
  .openapi('InstrumentSearchResponse');

export const ExpiriesQuerySchema = z.object({
  instrument_key: z.string().min(1).max(100).openapi({
    example: 'NSE_INDEX|Nifty 50',
  }),
});

export const ExpiriesResponseSchema = z
  .object({ data: z.unknown() })
  .openapi('ExpiriesResponse');

export const OptionContractsQuerySchema = z.object({
  instrument_key: z.string().min(1).max(100).openapi({
    example: 'NSE_INDEX|Nifty 50',
  }),
  expiry_date: z.string().min(1).max(30).optional().openapi({
    example: '2026-09-29',
  }),
});

export const OptionContractsResponseSchema = z
  .object({ data: z.unknown() })
  .openapi('OptionContractsResponse');

export const ExpiredCandlesQuerySchema = z.object({
  instrument_key: z.string().min(1).max(120).openapi({
    example: 'NSE_FO|58422|03-10-2024',
  }),
  // Upstox accepts minute multiples (verified live: 3/5/15minute) plus
  // the documented day/week/month values; anything else is rejected
  // upstream and forwarded as 400.
  interval: z
    .string()
    .regex(/^(\d+minute|day|week|month)$/)
    .openapi({ example: '3minute' }),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({
    example: '2024-10-03',
  }),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({
    example: '2024-09-01',
  }),
});

export const SmartlistQuerySchema = z.object({
  asset_type: z.string().min(1).max(20).openapi({ example: 'INDEX' }),
  category: z.string().min(1).max(40).openapi({ example: 'TOP_TRADED' }),
  page_number: z.string().optional().openapi({ example: '1' }),
  page_size: z.string().optional().openapi({ example: '20' }),
});

export const MarketOiQuerySchema = z.object({
  instrument_key: z.string().min(1).max(100).openapi({
    example: 'NSE_INDEX|Nifty 50',
  }),
  expiry: z.string().min(1).max(30).openapi({ example: '2026-09-29' }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({
    example: '2026-09-23',
  }),
  interval: z.string().min(1).max(10).optional().openapi({ example: '7' }),
  bucket_interval: z.string().min(1).max(10).optional().openapi({
    example: '30',
  }),
});

export const MarketBucketQuerySchema = MarketOiQuerySchema.extend({
  bucket_interval: z.string().min(1).max(10).openapi({ example: '30' }),
});

export const MarketDataResponseSchema = z
  .object({ data: z.unknown() })
  .openapi('MarketDataResponse');

export const ExchangeStatusQuerySchema = z.object({
  exchange: z.string().min(2).max(10).openapi({ example: 'NSE' }),
});

export const MarketTimingsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({
    example: '2026-09-29',
  }),
});

export const MarketHolidaysQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .openapi({ example: '2026-11-05' }),
});
