# Instruments: Search, Expiries & Option Contracts

Discovery-only Upstox wrappers. Nothing is stored; results are ephemeral.
All endpoint shapes come from the official Upstox documentation
(see `docs/ref-web/upstox-ref.md` §5.3, §9.2–9.3).

## Upstox reference

| Our endpoint | Upstox API | Notes |
|---|---|---|
| `GET /instruments/search` | `GET /v2/instruments/search` | `query` required (text/ISIN, ≤50 chars); filters `exchanges`, `segments`, `instrument_types`, `expiry`, `atm_offset`; page ≤30 records |
| `GET /instruments/expiries` | `GET /v2/expired-instruments/expiries?instrument_key=` | weekly/monthly expiry dates for an underlying; **Plus only** |
| `GET /instruments/option-contracts` | `GET /v2/option/contract?instrument_key=&expiry_date=` | active CE/PE contracts: key, symbol, expiry, strike, lot, tick |
| `GET /instruments/expired-option-contracts` | `GET /v2/expired-instruments/option/contract` | expired CE/PE contracts for F&O history; `expiry_date` required; **Plus only** |
| `GET /instruments/expired-future-contracts` | `GET /v2/expired-instruments/future/contract` | expired futures; `expiry_date` required; **Plus only** |
| `GET /instruments/expired-candles` | `GET /v2/expired-instruments/historical-candle/{key}/{interval}/{to}/{from}` | OHLC for an expired contract key; `interval` 1minute/30minute/day/week/month; **Plus only** |

## Market information (OI analytics & smartlists)

| Our endpoint | Upstox API | Notes |
|---|---|---|
| `GET /market/smartlists/options` | `GET /v2/market/smartlist/options?asset_type=&category=` | ranked options by category (`TOP_TRADED`, `OI_GAINERS`, …); `page_number`/`page_size` |
| `GET /market/smartlists/futures` | `GET /v2/market/smartlist/futures?...` | ranked futures, same params |
| `GET /market/oi` | `GET /v2/market/oi?instrument_key=&expiry=&date=` | total + strike-wise put/call OI |
| `GET /market/change-oi` | `GET /v2/market/change-oi?...&interval=` | total + strike-wise OI change over N days |
| `GET /market/max-pain` | `GET /v2/market/max-pain?...&bucket_interval=` | max pain, spot, intraday insights |
| `GET /market/pcr` | `GET /v2/market/pcr?...&bucket_interval=` | put-call ratio, spot, intraday insights |

## Market status, timings & holidays

| Our endpoint | Upstox API | Notes |
|---|---|---|
| `GET /market/status?exchange=` | `GET /v2/market/status/{EXCHANGE}` | live status (`PRE_OPEN_START`, `NORMAL_OPEN`, …), `last_updated`; verified live: NSE `PRE_OPEN_START` at 08:5x IST |
| `GET /market/timings?date=` | `GET /v2/market/timings/{YYYY-MM-DD}` | per-exchange `start_time`/`end_time` (epoch ms) |
| `GET /market/holidays` | `GET /v2/market/holidays[/{YYYY-MM-DD}]` | `date`, `description`, `holiday_type`, `closed_exchanges`; verified live: 2026-10-02 Gandhi Jayanti `TRADING_HOLIDAY`; use for gap analysis |

Discovery only — nothing is stored.

`expiry` accepts a date or keyword; `date` is `YYYY-MM-DD`; `interval` is
days, `bucket_interval` minutes. Discovery only — nothing is stored.

Typical F&O history chain (ref §9.2): underlying search → expiries →
expired contracts → expired candles (`POST /historical/datasets` does not
take expired keys today — active keys only).

## Instrument keys

Canonical form `SEGMENT|id` (`NSE_EQ|INE002A01018`, `NSE_FO|73985`,
`NSE_INDEX|Nifty 50`). Prefer keys over exchange tokens (tokens are reused
after expiry). Resolve names via `/instruments/search` — never invent keys.

## Errors

`400` invalid params (Upstox reason forwarded), `401` bad token,
`429` rate-limited, `5xx` upstream. Token travels in the Authorization
header only — never in URLs or logs.
