# Nifty 50 Trading Research API

Bun, TypeScript, Hono, SQLite, and Drizzle foundation with a raw
Upstox Market Data Feed v3 capture layer.

## Commands

```bash
bun install
bun run db:generate
bun run db:migrate
bun test
bun run test:vitest
bun run typecheck
bun run dev
```

The local database is configured through `DATABASE_PATH`. See `.env.example`
for placeholder values (never commit real tokens).

## Raw market-data capture

Pipeline:

```text
Upstox WebSocket -> receiver -> bounded queue -> batch writer -> SQLite
```

Per-session databases live under `data/capture/YYYY-MM-DD/raw.sqlite`
(session date in `Asia/Kolkata`; MVP session is weekday 09:00-15:45 IST —
no exchange-holiday calendar yet, see `src/capture/session.ts`).

Enable live capture (single key or comma-separated many):

```bash
CAPTURE_ENABLED=true
UPSTOX_ACCESS_TOKEN=<token>
UPSTOX_INSTRUMENT_KEYS="NSE_INDEX|Nifty 50"
UPSTOX_FEED_MODE=ltpc
```

Tunable knobs: `CAPTURE_QUEUE_CAPACITY`, `CAPTURE_MAX_WRITE_BATCH_SIZE`,
`CAPTURE_FLUSH_INTERVAL_MS`, `CAPTURE_BACKPRESSURE_TIMEOUT_MS`,
`CAPTURE_RECONNECT_MIN_MS/MAX_MS`.

Endpoints: `GET /health`, `GET /ready`, `GET /capture/status`,
`GET /capture/stats`, `GET /capture/subscriptions`,
`POST /capture/subscriptions` (`{action: "sub"|"unsub", instrumentKeys: [...]}`).

Full protocol reference (Upstox authorize, feed modes, control frames,
instrument keys, lineage, durability): `../../docs/CAPTURE.md`.

### Durability note (intentional MVP tradeoff)

Session databases use `PRAGMA journal_mode=WAL` +
`PRAGMA synchronous=NORMAL`. Normal application crash recovery is
supported, but very recent WAL transactions may be lost during OS/power
failure. Do not change this silently.

### Scope boundary

Capture stores raw feed bytes immutably with lineage
(`source_connection_id -> batch_id -> instrument rows`). It does NOT
compute indicators, OHLC aggregation, features, signals, backtests,
strategies, or orders. Those belong to later phases.

## Instruments: search, expiries & option contracts

```bash
curl 'http://localhost:3000/instruments/search?query=NIFTY&segments=FO&instrument_types=CE&records=5'
curl 'http://localhost:3000/instruments/expiries?instrument_key=NSE_INDEX%7CNifty%2050'
curl 'http://localhost:3000/instruments/option-contracts?instrument_key=NSE_INDEX%7CNifty%2050&expiry_date=2026-09-29'
```

Discovery only — nothing is stored. Expired-instrument endpoints need
Upstox Plus. Reference: `../../docs/INSTRUMENTS.md`.

## Historical acquisition (Stage 1)

```bash
curl -X POST http://localhost:3000/historical/datasets \
  -H 'Content-Type: application/json' \
  -d '{"instrumentKey":"NSE_INDEX|Nifty 50","from":"2026-09-01","to":"2026-09-23","interval":"1day","source":"upstox"}'
```

Intervals: `1minute`..`300minute`, `1hour`..`5hour`, `1day`, `1week`,
`1month`. Ranges are chunked per the official Upstox V3 retrieval windows
(minutes 1-15: 1 month; minutes >15 / hours: 1 quarter; days: 1 decade;
weeks/months: single request) and fetched sequentially with bounded
retries. Auth failures stop the run and mark the dataset PARTIAL
(or FAILED if nothing was acquired); repeat the request later to resume.

Expired contracts: date-suffixed keys (`NSE_FO|58422|03-10-2024`) route to
the expired-candles API (single wide-range chunk; minutes/days/weeks/months
only, no hours) and persist into the same tables with full lineage.

Tables: `historical_datasets` (UNIQUE `dataset_id` = idempotency guard),
`historical_chunks`, `historical_raw_responses`, `historical_candles`.

### Stale RUNNING recovery (known Stage 1 limitation)

No heartbeat/lease recovery exists yet. If the process crashes mid-run, a
dataset can stay `RUNNING` forever. Inspect and recover manually:

```sql
SELECT dataset_id, status, chunks_total, chunks_completed, chunks_failed
FROM historical_datasets WHERE status IN ('RUNNING', 'PENDING');

-- After confirming no acquisition is actually running:
UPDATE historical_datasets
SET status = 'FAILED', updated_at = <now_epoch_ms>
WHERE dataset_id = '<id>';
```

The next `POST /historical/datasets` for the same request will then retry
the missing chunks under the same `dataset_id`.

TODO: heartbeat/lease-based stale-run recovery; dataset revisioning for
upstream restatements (Stage 1 treats datasets as immutable).

## Historical validation (Stage 2)

```bash
curl -X POST http://localhost:3000/historical/datasets/<dataset_id>/validation
curl http://localhost:3000/historical/datasets/<dataset_id>/validation
```

Pipeline: schema/OHLC checks → timestamp order → duplicate/conflict scan →
expected-session gaps (IST weekdays for daily; 09:15–15:30 grid for
intraday; week/month buckets) → completeness score → `VALID` / `INVALID` /
`INCOMPLETE`. Reports persist in `validation_reports` (one row per dataset,
replaced on re-run). Verdict rules: any OHLC/timestamp violation or
conflicting rows → `INVALID`; otherwise gaps → `INCOMPLETE`; else `VALID`.

Known limits: no exchange-holiday calendar (holidays appear as gaps);
per-exchange intraday templates are a TODO (NSE cash default);
duplicate/conflicting rows are structurally blocked by
UNIQUE(dataset_id, timestamp), so those detectors are defense-in-depth,
unit-tested against crafted rows.
