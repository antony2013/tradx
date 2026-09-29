# Raw Market-Data Capture

Live capture of the Upstox Market Data Feed v3 WebSocket into per-session
SQLite databases. All protocol details below come from the official Upstox
documentation (see `docs/ref-web/upstox-ref.md` §10.1); nothing is guessed.

## Upstox reference

| Item | Value |
|---|---|
| Authorize | `GET https://api.upstox.com/v3/feed/market-data-feed/authorize` with `Authorization: Bearer <token>` → `data.authorized_redirect_uri` (single-use) |
| Socket | connect to `authorized_redirect_uri` |
| Control frames | **binary JSON**: `{"guid","method","data":{"mode","instrumentKeys"}}`; methods `sub` / `change_mode` / `unsub` |
| Market frames | Protobuf, schema: `MarketDataFeed.proto` (see ref §10.1) |
| Feed modes | `ltpc` (LTP + last trade time/qty + close), `full` (LTPC + 5-depth + OHLC + Greeks), `option_greeks`, `full_d30` (full + 30-depth, **Upstox Plus only**) |
| Instrument key | `SEGMENT|id`, e.g. `NSE_EQ|INE002A01018`, `NSE_FO|73985`, `NSE_INDEX|Nifty 50` — prefer over exchange tokens (ref §5.1) |

## Configuration (`.env`)

| Var | Meaning |
|---|---|
| `CAPTURE_ENABLED` | `true` builds the capture service + source (stays `STOPPED` until manual start) |
| `UPSTOX_ACCESS_TOKEN` | header-only, never logged |
| `UPSTOX_INSTRUMENT_KEYS` | comma-separated initial keys (single or many) |
| `UPSTOX_FEED_MODE` | one of the four modes above |
| `CAPTURE_QUEUE_CAPACITY` / `CAPTURE_MAX_WRITE_BATCH_SIZE` / `CAPTURE_FLUSH_INTERVAL_MS` / `CAPTURE_BACKPRESSURE_TIMEOUT_MS` | queue/writer tuning |
| `CAPTURE_RECONNECT_MIN_MS` / `CAPTURE_RECONNECT_MAX_MS` | reconnect backoff bounds |

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /capture/status` | state, connection id, session date, queue depth, degraded/incomplete flags |
| `GET /capture/stats` | batches/rows received+persisted, overflows, errors, latencies |
| `GET /capture/subscriptions` | current `feed_mode` + `instrument_keys` |
| `POST /capture/subscriptions` | `{action: "sub"\|"unsub", instrumentKeys: [...]}` — single key or many; invalid keys reported, never stored |
| `POST /capture/start` | manually start the feed (**no auto-start on boot**); idempotent — a second call reports state instead of double-connecting |
| `POST /capture/stop` | manually stop the feed; flushes pending batches first |

Subscription changes apply to the live socket immediately (`sub`/`unsub`
frames) and are replayed in full on every reconnect. Each reconnect mints
a new `source_connection_id`; lineage is
`connection → batches → instrument messages`.

## Storage

`data/capture/YYYY-MM-DD/raw.sqlite` (session date in `Asia/Kolkata`;
MVP session = weekday 09:00–15:45 IST, no holiday calendar yet).
`PRAGMA journal_mode=WAL` + `synchronous=NORMAL`: normal crash recovery
works; very recent WAL transactions may be lost on OS/power failure.
