# Upstox Developer API Reference

> **Snapshot date:** 19 September 2026  
> **Primary source:** [Upstox Developer API documentation](https://upstox.com/developer/api-documentation/api-overview)  
> **Machine-readable index:** [llms.txt](https://upstox.com/developer/api-documentation/llms.txt)  
> **OpenAPI page:** [OpenAPI definition](https://upstox.com/developer/api-documentation/openapi-definition)
>
> This file is a structured, implementation-oriented reference based on the official Upstox documentation. Endpoint behavior, limits, plans, and regulatory requirements can change; use the linked source pages as the authority before production deployment. When citing Upstox content externally, Upstox asks publishers to append `?utm_source={your_unique_identifier}` to source URLs.

## Contents

1. [Quick start and architecture](#1-quick-start-and-architecture)
2. [Authentication and tokens](#2-authentication-and-tokens)
3. [Common request, response, and error contract](#3-common-request-response-and-error-contract)
4. [Rate limits](#4-rate-limits)
5. [Instruments](#5-instruments)
6. [Account and funds](#6-account-and-funds)
7. [Orders and trading](#7-orders-and-trading)
8. [Portfolio, mutual funds, and P&L](#8-portfolio-mutual-funds-and-pnl)
9. [Market data](#9-market-data)
10. [Realtime streaming and webhooks](#10-realtime-streaming-and-webhooks)
11. [Sandbox, SDKs, MCP, and agent skills](#11-sandbox-sdks-mcp-and-agent-skills)
12. [Appendix values and implementation notes](#12-appendix-values-and-implementation-notes)
13. [Current migration and operational notes](#13-current-migration-and-operational-notes)
14. [Official source map](#14-official-source-map)

---

## 1. Quick start and architecture

### 1.1 Base URLs

| Surface | Base URL | Use |
|---|---|---|
| Standard REST | `https://api.upstox.com/v2` or `https://api.upstox.com/v3` | Account, portfolio, market data, GTT, IPO, and other non-HFT endpoints |
| Enhanced order REST | `https://api-hft.upstox.com/v2` or `https://api-hft.upstox.com/v3` | Place, modify, and cancel order APIs |
| Sandbox | `https://sandbox.upstox.com/v2` and corresponding V3 paths | Simulated order testing only |
| Market-data WebSocket | `wss://api.upstox.com/v3/feed/market-data-feed` | Live market-data feed V3 |
| Portfolio WebSocket | `wss://api.upstox.com/v2/feed/portfolio-stream-feed` | Live order, position, holding, and GTT updates |
| MCP | `https://mcp.upstox.com/mcp` | Read-only AI-assistant access |

### 1.2 Minimal OAuth flow

1. Create an app at [Upstox Developer Apps](https://account.upstox.com/developer/apps).
2. Redirect the user to:

   ```text
   https://api.upstox.com/v2/login/authorization/dialog
       ?response_type=code
       &client_id={API_KEY}
       &redirect_uri={REGISTERED_REDIRECT_URI}
       &state={RANDOM_STATE}
   ```

3. Upstox redirects to the registered URI with a single-use `code`.
4. Exchange the code server-side:

   ```http
   POST https://api.upstox.com/v2/login/authorization/token
   Accept: application/json
   Content-Type: application/x-www-form-urlencoded

   code={AUTH_CODE}&client_id={API_KEY}&client_secret={API_SECRET}
   &redirect_uri={REGISTERED_REDIRECT_URI}&grant_type=authorization_code
   ```

5. Store the returned `access_token` securely and call APIs with:

   ```http
   Authorization: Bearer {ACCESS_TOKEN}
   Accept: application/json
   ```

The standard access token normally expires at **03:30 the following day**. Never expose `client_secret` or tokens in browser code, mobile bundles, logs, or source control.

### 1.3 Minimal REST example

```bash
curl -X GET \
  'https://api.upstox.com/v2/user/profile' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer {ACCESS_TOKEN}'
```

### 1.4 Main API groups

| Group | Capabilities |
|---|---|
| Getting Started | API structure, limits, instruments, OAuth, login, sandbox, SDK, MCP, agent setup |
| Account & Funds | Profile, funds, margin, brokerage, kill switch, static IP, pay-ins, payouts |
| Orders & Trading | V2/V3 orders, multi-order, GTT, IPO, order book, trades, exit-all |
| Portfolio | Positions, holdings, MTF positions, conversions, mutual funds, P&L |
| Market Data | Quotes, candles, options, market information, fundamentals, news, smartlists |
| Realtime & Streaming | Market-data WebSocket, portfolio WebSocket, webhooks |
| Appendix | Enumerations, field patterns, Postman, SDK and agent references |

---

## 2. Authentication and tokens

### 2.1 OAuth authorize

```http
GET https://api.upstox.com/v2/login/authorization/dialog
```

| Parameter | Required | Description |
|---|---:|---|
| `client_id` | Yes | App API key; it is not the customer UCC |
| `redirect_uri` | Yes | Must exactly match the registered redirect URI |
| `response_type` | Yes | Always `code` |
| `state` | No | Opaque value returned unchanged; use a random value and validate it |

A redirect ending in `.php` or a similar extension may be blocked. QR-code login is not compatible with the API authorization flow.

### 2.2 Get token

```http
POST https://api.upstox.com/v2/login/authorization/token
Accept: application/json
Content-Type: application/x-www-form-urlencoded
```

Form fields:

```text
code
client_id
client_secret
redirect_uri
grant_type=authorization_code
```

The authorization code is single-use even if the token exchange fails. Keep the exchange on a backend.

### 2.3 TOTP login

```http
POST https://api.upstox.com/v2/totp-login/authorization/token
Accept: application/json
Content-Type: application/json
x-api-key: {API_KEY}
```

```json
{
  "totp": "123456",
  "pin": "123456"
}
```

Both values must be six digits and TOTP must be enabled on the user account. Issuing a token this way revokes the existing active access token.

### 2.4 Access-token request / notifier webhook

```http
POST https://api.upstox.com/v3/login/auth/token/request/{client_id}
Accept: application/json
Content-Type: application/json
```

```json
{
  "client_secret": "{API_SECRET}"
}
```

After the user approves the request, Upstox sends an unauthenticated HTTPS `POST` to the configured notifier URL:

```json
{
  "client_id": "...",
  "user_id": "...",
  "access_token": "...",
  "token_type": "Bearer",
  "expires_at": "...",
  "issued_at": "...",
  "message_type": "access_token"
}
```

Treat the notifier payload as a secret: use TLS, restrict access, validate `client_id` and `user_id`, deduplicate deliveries, and never log the token.

### 2.5 Logout

```http
DELETE https://api.upstox.com/v2/logout
Accept: application/json
Authorization: Bearer {ACCESS_TOKEN}
```

A successful response is:

```json
{
  "status": "success",
  "data": true
}
```

### 2.6 Analytics Token

The Analytics Token is generated from the Developer Apps console and is:

- Valid for one year.
- Read-only and GET-only.
- Limited to one active token per account.
- Sent as `Authorization: Bearer {ANALYTICS_TOKEN}`.
- Not usable for order placement, modification, cancellation, or other write operations.

| Category | Static IP required with Analytics Token? |
|---|---:|
| Market Quote, Historical Data, Option Chain, Market Information, Fundamentals, News, IPO, WebSocket | No |
| User, Payments, Orders, GTT, Portfolio, Mutual Fund, Trade P&L | Yes |

Example:

```http
GET https://api.upstox.com/v2/portfolio/long-term-holdings
Accept: application/json
Authorization: Bearer {ANALYTICS_TOKEN}
```

### 2.7 Token comparison

| Token | Typical validity | Access | Reauthorization |
|---|---:|---|---:|
| Standard OAuth access token | Until approximately 03:30 next day | Read and write according to endpoint | Daily |
| Extended token | Longer-lived response field; endpoint support varies | Do not assume every endpoint accepts it | Follow endpoint documentation |
| Analytics Token | One year | Read-only GET | No daily reauthorization |
| Sandbox token | 30 days | Sandbox only | Regenerate when expired |

---

## 3. Common request, response, and error contract

### 3.1 Common headers

```http
Accept: application/json
Authorization: Bearer {ACCESS_TOKEN}
```

Use `Content-Type: application/json` for JSON request bodies and `Content-Type: application/x-www-form-urlencoded` for OAuth form bodies. URL-encode `|`, spaces, and other special characters in path/query values.

V3 Funds & Margin uses:

```http
Api-Version: 3.0
```

### 3.2 Success envelope

Single object:

```json
{
  "status": "success",
  "data": {
    "key": "value"
  }
}
```

Array:

```json
{
  "status": "success",
  "data": [
    { "key": "value" }
  ]
}
```

Some V3 order responses also contain `metadata`, such as `metadata.latency`.

### 3.3 Error envelope

```json
{
  "status": "error",
  "errors": [
    {
      "error_code": "UDAPI100016",
      "message": "Invalid Credentials",
      "property_path": null,
      "invalid_value": null
    }
  ]
}
```

Prefer snake_case fields. Older camelCase fields such as `errorCode`, `propertyPath`, and `invalidValue` are deprecated.

| HTTP status | Meaning |
|---:|---|
| `400` | Bad request or invalid parameters |
| `401` | Missing/invalid credentials or token |
| `403` | Forbidden or permission/plan restriction |
| `404` | Resource not found |
| `405` | Method not allowed |
| `406` | Requested response format is not JSON |
| `410` | Resource removed/deprecated |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `503` | Service unavailable or maintenance |

Implement bounded exponential backoff for transient network, `429`, and `5XX` responses. Do not blindly retry `401`; refresh or reauthorize first.

---

## 4. Rate limits

Limits are enforced per API and per user.

| Category | Per second | Per minute | Per 30 minutes |
|---|---:|---:|---:|
| Regular algo order operations: place, modify, cancel, multi-order, GTT | 10 | 500 | 2,000 |
| SEBI-registered algo order operations | 50 | 500 | 2,000 |
| Standard APIs: holdings, positions, funds, candles, quotes, etc. | 50 | 500 | 2,000 |
| Standard payout reads: pay-ins, payouts, payout modes | 10 | 500 | 2,000 |
| Restricted payout actions: request, modify, cancel | — | 10 | 300 |
| Apply IPO | 1 | 10 | 300 |
| TOTP login | 1 | 10 | 60 |

Exceeding limits can temporarily suspend access. Queue requests, preserve idempotency where possible, and use jittered backoff.

---

## 5. Instruments

### 5.1 Identifier guidance

Prefer `instrument_key` (for example `NSE_EQ|INE002A01018`) over `exchange_token`. Exchange tokens can be reused after an instrument expires. Order payloads may call the field `instrument_token`, but its value is normally the instrument key from the instrument master.

### 5.2 Instrument files

| File | URL |
|---|---|
| BOD complete | `https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz` |
| NSE | `https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz` |
| BSE | `https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz` |
| MCX | `https://assets.upstox.com/market-quote/instruments/exchange/MCX.json.gz` |
| Mutual funds | `https://assets.upstox.com/market-quote/instruments/exchange/mf-instruments.json.gz` |
| Suspended instruments | `https://assets.upstox.com/market-quote/instruments/exchange/suspended-instrument.json.gz` |
| MTF | `https://assets.upstox.com/market-quote/instruments/exchange/MTF.json.gz` |
| NSE MIS | `https://assets.upstox.com/market-quote/instruments/exchange/NSE_MIS.json.gz` |
| BSE MIS | `https://assets.upstox.com/market-quote/instruments/exchange/BSE_MIS.json.gz` |
| Global instruments | `https://assets.upstox.com/market-quote/instruments/exchange/global.json.gz` |

BOD files are normally refreshed around 06:00 and exclude delisted securities and expired contracts for the next trading day. JSON is preferred; CSV instrument files are deprecated.

Typical equity record:

```json
{
  "segment": "NSE_EQ",
  "name": "RELIANCE INDUSTRIES LTD",
  "exchange": "NSE",
  "isin": "INE002A01018",
  "instrument_type": "EQ",
  "instrument_key": "NSE_EQ|INE002A01018",
  "lot_size": 1,
  "freeze_quantity": 100000,
  "exchange_token": "2885",
  "tick_size": 10,
  "trading_symbol": "RELIANCE",
  "security_type": "NORMAL"
}
```

### 5.3 Instrument Search

```http
GET https://api.upstox.com/v2/instruments/search
Accept: application/json
Authorization: Bearer {ACCESS_TOKEN}
```

| Parameter | Required | Details |
|---|---:|---|
| `query` | Yes | Text or ISIN; maximum 50 characters |
| `exchanges` | No | `ALL`, `NSE`, `BSE`, `MCX`; default `ALL` |
| `segments` | No | `ALL`, `EQ`, `FO`, `CURR`, `COMM`, `INDEX`, `OPT`, `FUT` |
| `instrument_types` | No | Comma-separated values such as `CE,PE` |
| `expiry` | No | `current_week`, `next_month`, or `YYYY-MM-DD` |
| `atm_offset` | No | `0` for ATM; positive/negative offset |
| `page_number` | No | Default `1`, minimum `1` |
| `records` | No | Default `10`, maximum `30` |

Response contains `data[]` and `meta_data.page`. Search cannot find exchange tokens by token value; use the instrument files for that lookup.

---

## 6. Account and Funds

### 6.1 User and funds endpoints

| API | Method and URL | Purpose | Key parameters / response | Access |
|---|---|---|---|---|
| Get Profile | `GET https://api.upstox.com/v2/user/profile` | User/account capabilities | `email`, `exchanges`, `products`, `order_types`, `user_id`, `user_name`, `poa`, `ddpi`, `is_active` | OAuth; Analytics Token with static IP |
| Get Fund and Margin V2 | `GET https://api.upstox.com/v2/user/get-funds-and-margin` | Equity/commodity funds and margins | Optional `segment=SEC` or `COM`; `equity`, `commodity`, `used_margin`, `available_margin` | OAuth; Analytics Token with static IP |
| Get Fund and Margin V3 | `GET https://api.upstox.com/v3/user/get-funds-and-margin` | Detailed cash, pledge, available and unavailable balances | Header `Api-Version: 3.0`; nested `available_to_trade`, `unavailable_to_trade`, `cash`, `pledge`, `margin_used` | OAuth; Analytics Token with static IP |
| Margin Details | `POST https://api.upstox.com/v2/charges/margin` | Pre-trade margin calculation | JSON `instruments[]`; max 20; response `required_margin`, `final_margin`, `margins[]` | OAuth only |
| Brokerage Details | `GET https://api.upstox.com/v2/charges/brokerage` | Brokerage/tax estimate | Required `instrument_token`, `quantity`, `product`, `transaction_type`, `price`; response `charges.total`, `brokerage`, `taxes`, `other_charges` | OAuth or Analytics Token; no static IP for brokerage |

V3 funds response highlights:

```text
data.available_to_trade.total
data.available_to_trade.cash_available_to_trade.cash.*
data.available_to_trade.cash_available_to_trade.margin_used.*
data.available_to_trade.pledge_available_to_trade.*
data.unavailable_to_trade.cash_unavailable_to_trade.*
data.unavailable_to_trade.pledge_unavailable_to_trade.*
```

The funds service is unavailable overnight, approximately 00:00–05:30 IST, and may return `423 Locked`.

### 6.2 Kill switch

| API | Method and URL | Purpose |
|---|---|---|
| Kill Switch Status | `GET https://api.upstox.com/v2/user/kill-switch` | Read segment status and whether the kill switch is enabled |
| Update Kill Switch | `POST https://api.upstox.com/v2/user/kill-switch` | Enable/disable trading segments |

Update body:

```json
[
  {
    "segment": "NSE_FO",
    "action": "DISABLE"
  }
]
```

`action` is `ENABLE` or `DISABLE`. Disabling a segment requires open positions to be closed, cancels open orders, and has a 12-hour cooling period before re-enable. Regenerate the access token after an update.

### 6.3 Static IPs

| API | Method and URL | Purpose |
|---|---|---|
| Get Static IPs | `GET https://api.upstox.com/v2/user/ip` | Read `primary_ip`, optional `secondary_ip`, and update timestamps |
| Update Static IPs | `PUT https://api.upstox.com/v2/user/ip` | Set primary and optional secondary IP |

Update body:

```json
{
  "primary_ip": "203.0.113.10",
  "secondary_ip": "203.0.113.11"
}
```

IPs must be valid IPv4 or IPv6, primary and secondary must differ, changes are limited to once per calendar week, and a successful update invalidates existing access tokens.

### 6.4 Payments

| API | Method and URL | Purpose | Key response |
|---|---|---|---|
| Get Payins | `GET https://api.upstox.com/v2/user/payments/payin` | Latest 20 pay-ins | `amount`, `mode`, `status`, `currency`, `bank_name`, `transaction_id`, `created_at` |
| Get Payouts | `GET https://api.upstox.com/v2/user/payments/payout` | Latest 20 payouts | `transaction_id`, `status`, `mode`, `amount`, `currency`, `eta`, `bank_name` |
| Get Payout Modes | `GET https://api.upstox.com/v2/user/payments/payout/modes` | NEFT/IMPS eligibility and limits | `neft`, `imps`, `eligible`, `min_amount`, `max_amount`, `eligible_amount` |
| Payout Request | `POST https://api.upstox.com/v2/user/payments/payout` | Start NEFT/IMPS withdrawal | `transaction_id`, `status`, `mode`, `amount`, `eta` |
| Modify Payout | `PUT https://api.upstox.com/v2/user/payments/payout/{transaction_id}` | Change a received payout amount | Updated payout object |
| Cancel Payout | `DELETE https://api.upstox.com/v2/user/payments/payout/{transaction_id}` | Cancel a received payout | `transaction_id`, `message` |

Payout request body:

```json
{
  "mode": "IMPS",
  "amount": 5000
}
```

Only one active withdrawal request is allowed. IMPS cannot be modified or cancelled after initiation. IMPS eligibility is checked in real time and requires market availability, request time between 10:00 and 19:00, active account, no open F&O positions/orders, and the current daily limit.

---

## 7. Orders and Trading

### 7.1 Order API versions

| Version | Host | Status |
|---|---|---|
| V3 | `https://api-hft.upstox.com/v3` | Preferred for place/modify/cancel |
| V2 | `https://api-hft.upstox.com/v2` | Legacy/deprecated for place/modify/cancel |

V3 adds `slice` auto-slicing, `metadata.latency`, enhanced validation, and current static-IP/algo enforcement. V3 Place Order returns `data.order_ids[]`; V2 returns `data.order_id`.

### 7.2 Place, modify, and cancel

| API | Method and URL | Key request fields | Key response |
|---|---|---|---|
| Place Order V3 | `POST https://api-hft.upstox.com/v3/order/place` | `instrument_token`, `transaction_type`, `product`, `validity`, `order_type`, `price`, `quantity`, `disclosed_quantity`, `trigger_price`, optional `tag`, `is_amo`, `slice`, `market_protection` | `data.order_ids[]`, `metadata.latency` |
| Place Order V2 | `POST https://api-hft.upstox.com/v2/order/place` | Same core fields; no V3 `slice` | `data.order_id` |
| Modify Order V3 | `PUT https://api-hft.upstox.com/v3/order/modify` | `order_id`, `quantity`, `validity`, `price`, `order_type`, `disclosed_quantity`, `trigger_price`, `market_protection` | `data.order_id`, `metadata.latency` |
| Modify Order V2 | `PUT https://api-hft.upstox.com/v2/order/modify` | Same core fields | `data.order_id` |
| Cancel Order V3 | `DELETE https://api-hft.upstox.com/v3/order/cancel?order_id={ORDER_ID}` | Path/query `order_id` | `data.order_id`, `metadata.latency` |
| Cancel Order V2 | `DELETE https://api-hft.upstox.com/v2/order/cancel?order_id={ORDER_ID}` | `order_id` | `data.order_id` |

Common product values are `I`, `D`, `CO`, and `MTF` where supported. Common order types are `MARKET`, `LIMIT`, `SL`, and `SL-M`; validity is normally `DAY` or `IOC`. Current regulatory restrictions can block MARKET or specific segments, so use `LIMIT` unless the current endpoint/account explicitly permits otherwise.

### 7.3 Multi-order and exit-all

| API | Method and URL | Key parameters / behavior |
|---|---|---|
| Place Multi Order | `POST https://api.upstox.com/v2/order/multi/place` | JSON array; max 10 lines; each line has `correlation_id` and normal order fields; response has per-line `order_id`, summary, and errors |
| Cancel Multi Order | `DELETE https://api.upstox.com/v2/order/multi/cancel` | Optional `segment` and `tag`; max 10 open orders; response has `order_ids[]`, summary, and errors |
| Exit All Positions | `POST https://api.upstox.com/v2/order/positions/exit` | Optional `segment` and `tag`; creates opposite-leg MARKET orders; max 10 positions; slicing and market protection are applied by default |

### 7.4 Order and trade reads

| API | Method and URL | Purpose / key fields |
|---|---|---|
| Get Order Details | `GET https://api.upstox.com/v2/order/details?order_id={ORDER_ID}` | Latest order state; `status`, `quantity`, `filled_quantity`, `pending_quantity`, `average_price`, `instrument_token` |
| Get Order History | `GET https://api.upstox.com/v2/order/history?order_id={ORDER_ID}` or `?tag={TAG}` | Ordered state transitions; at least one identifier required |
| Get Order Book | `GET https://api.upstox.com/v2/order/retrieve-all` | All orders for the current trading day |
| Get Trades for the Day | `GET https://api.upstox.com/v2/order/trades/get-trades-for-day` | Current-day executed trades |
| Get Trades by Order | `GET https://api.upstox.com/v2/order/trades?order_id={ORDER_ID}` | Fills for one order; `trade_id`, `quantity`, `price`, timestamps |
| Get Historical Trades | `GET https://api.upstox.com/v2/charges/historical-trades` | Date/segment filtered historical trades; `segment`, `start_date`, `end_date`, `page_number`, `page_size` |

Common order fields include `exchange`, `product`, `price`, `quantity`, `status`, `tag`, `instrument_token`, `trading_symbol`, `order_type`, `validity`, `trigger_price`, `disclosed_quantity`, `transaction_type`, `average_price`, `filled_quantity`, `pending_quantity`, `status_message`, `exchange_order_id`, `parent_order_id`, `order_id`, `order_timestamp`, `exchange_timestamp`, `is_amo`, `variety`, and `placed_by`.

### 7.5 GTT orders

Current GTT endpoints use V3:

| API | Method and URL | Key parameters / behavior |
|---|---|---|
| Place GTT Order | `POST https://api.upstox.com/v3/order/gtt/place` | `type` (`SINGLE`/`MULTIPLE`), `quantity`, `product`, `instrument_token`, `transaction_type`, `rules[]`; `ENTRY` mandatory |
| Modify GTT Order | `PUT https://api.upstox.com/v3/order/gtt/modify` | `gtt_order_id`, `type`, `quantity`, `rules[]`; open-order quantity cannot be changed |
| Cancel GTT Order | `DELETE https://api.upstox.com/v3/order/gtt/cancel` | JSON `{ "gtt_order_id": "..." }`; cancels untriggered GTT and legs |
| Get GTT Order Details | `GET https://api.upstox.com/v3/order/gtt?gtt_order_id={GTT_ID}` | `type`, `exchange`, `quantity`, `product`, `instrument_token`, `expires_at`, `created_at`, `rules[]` |

Rule fields include `strategy` (`ENTRY`, `TARGET`, `STOPLOSS`), `trigger_type` (`BELOW`, `ABOVE`, `IMMEDIATE`), `trigger_price`, optional `trailing_gap`, and `market_protection`. `SINGLE` requires one rule; `MULTIPLE` supports two or three. SELL legs require applicable EDIS authorization.

### 7.6 IPO APIs

All current IPO application endpoints use V2:

| API | Method and URL | Key parameters / response |
|---|---|---|
| Get IPOs | `GET https://api.upstox.com/v2/ipos` | Optional `status`, `issue_type`, `page_number`, `records`; returns IPO list and pagination |
| Get IPO Details | `GET https://api.upstox.com/v2/ipos/{id}` | Price band, lot size, timeline, registrar, subscription, listing data |
| Apply IPO | `POST https://api.upstox.com/v2/ipos/orders` | JSON `id`, `upi`, `category`, `bids[]`; returns `order_id`; user must approve UPI mandate |
| Get IPO Orders | `GET https://api.upstox.com/v2/ipos/orders` | Paginated applications; bids, mandate, exchange submission, allotment, status |
| Get IPO Order Details | `GET https://api.upstox.com/v2/ipos/orders/{order_id}` | One application object |
| Cancel IPO Order | `DELETE https://api.upstox.com/v2/ipos/orders/{order_id}` | Cancel while bidding window is open; verify final status through details endpoint |

IPO application limits: one to three bids, quantity must respect lot size/minimum quantity, and price must be within the band or equal to cut-off price.

---

## 8. Portfolio, Mutual Funds, and P&L

### 8.1 Portfolio endpoints

| API | Method and URL | Purpose | Key response | Access |
|---|---|---|---|---|
| Get Positions | `GET https://api.upstox.com/v2/portfolio/short-term-positions` | Current-day trading positions | `exchange`, `instrument_token`, `product`, quantities, prices, `pnl`, `realised`, `unrealised` | OAuth; Analytics Token + static IP |
| Get MTF Positions | `GET https://api.upstox.com/v3/portfolio/mtf-positions` | Open Margin Trade Funding positions | Position rows with `product: MTF`, value and margin details | OAuth; Analytics Token + static IP |
| Convert Positions | `PUT https://api.upstox.com/v2/portfolio/convert-position` | Convert open position product | `data.status`; OAuth only |
| Get Holdings | `GET https://api.upstox.com/v2/portfolio/long-term-holdings` | Demat/long-term holdings | `isin`, `instrument_token`, `quantity`, `average_price`, `last_price`, `pnl`, collateral fields | OAuth; Analytics Token + static IP |

Position conversion body:

```json
{
  "instrument_token": "NSE_EQ|INE528G01020",
  "old_product": "I",
  "new_product": "D",
  "transaction_type": "BUY",
  "quantity": 1
}
```

The current schema documents `I` and `D` for conversion; do not assume MTF is accepted without checking the live endpoint.

### 8.2 Mutual Fund endpoints

| API | Method and URL | Purpose | Key parameters / response |
|---|---|---|---|
| Get Mutual Fund Orders | `GET https://api.upstox.com/v2/mf/orders` | Paginated MF order book | `status`, `transaction_type`, `page_number`, `records`; order rows and `meta_data.page` |
| Get MF Order Details | `GET https://api.upstox.com/v2/mf/orders/{order_id}` | One MF order | `fund`, `folio`, `instrument_key`, `status`, `amount`, `quantity`, `price`, timestamps |
| Get MF SIPs | `GET https://api.upstox.com/v2/mf/sips` | Active/paused SIP registrations | `sip_id`, `instrument_key`, `fund`, `frequency`, `instalment_amount`, `status`, pagination |
| Get MF Holdings | `GET https://api.upstox.com/v2/mf/holdings` | Current mutual-fund holdings | `instrument_key`, `folio`, `fund`, `quantity`, `average_price`, `last_price`, `pnl`, `pledged_quantity` |

The current MF suite is retrieval-oriented; it does not document MF order placement or SIP management operations.

### 8.3 Trade P&L endpoints

Common query parameters:

- `segment`: `EQ`, `FO`, `COM`, or `CD`
- `financial_year`: concatenated start/end year, e.g. `2324`
- `from_date`: optional `dd-mm-yyyy`
- `to_date`: optional `dd-mm-yyyy`

| API | Method and URL | Purpose | Key response |
|---|---|---|---|
| Get Report Metadata | `GET https://api.upstox.com/v2/trade/profit-loss/metadata` | Trade count and page-size limit | `data.trades_count`, `data.page_size_limit` |
| Get Profit and Loss Report | `GET https://api.upstox.com/v2/trade/profit-loss/data` | Paginated trade-wise realized P&L | `data[]`, `metadata.page`; required `page_number`, `page_size` |
| Get Trade Charges | `GET https://api.upstox.com/v2/trade/profit-loss/charges` | Aggregate brokerage/tax/charge breakdown | `data.charges_breakdown.total`, `brokerage`, `taxes`, `charges` |

Recommended sequence: metadata → report pagination → charges using the same segment/year/date range.

---

## 9. Market Data

### 9.1 Historical and intraday candles

| API | Method and exact URL | Parameters | Response / status |
|---|---|---|---|
| Historical Candle V3 | `GET https://api.upstox.com/v3/historical-candle/{instrument_key}/{unit}/{interval}/{to_date}[/{from_date}]` | `unit=minutes|hours|days|weeks|months`; interval limits documented per unit; dates `YYYY-MM-DD` | `data.candles[]`; each candle `[timestamp, open, high, low, close, volume, open_interest]`; preferred V3 |
| Historical Candle V2 | `GET https://api.upstox.com/v2/historical-candle/{instrument_key}/{interval}/{to_date}[/{from_date}]` | `interval=1minute|30minute|day|week|month` | Same candle envelope; deprecated |
| Intraday Candle V3 | `GET https://api.upstox.com/v3/historical-candle/intraday/{instrument_key}/{unit}/{interval}` | `unit=minutes|hours|days`; current trading day | Same candle envelope; preferred V3 |
| Intraday Candle V2 | `GET https://api.upstox.com/v2/historical-candle/intraday/{instrument_key}/{interval}` | `1minute` or `30minute`; current trading day | Same envelope; deprecated |

V3 historical availability: minute/hour data from January 2022, daily/weekly/monthly from January 2000. Retrieval windows vary by interval. Encode `|` and spaces in `instrument_key`.

### 9.2 Expired instruments and backtesting

| API | Method and URL | Purpose |
|---|---|---|
| Get Expiries | `GET https://api.upstox.com/v2/expired-instruments/expiries?instrument_key={UNDERLYING_KEY}` | List available weekly/monthly expiry dates |
| Get Expired Option Contracts | `GET https://api.upstox.com/v2/expired-instruments/option/contract?instrument_key={UNDERLYING_KEY}&expiry_date={DATE}` | List expired CE/PE contracts |
| Get Expired Future Contracts | `GET https://api.upstox.com/v2/expired-instruments/future/contract?instrument_key={UNDERLYING_KEY}&expiry_date={DATE}` | List expired futures |
| Expired Historical Candle Data | `GET https://api.upstox.com/v2/expired-instruments/historical-candle/{EXPIRED_KEY}/{interval}/{to_date}/{from_date}` | OHLC for expired contracts |

Expired-instrument APIs require Upstox Plus. Backtesting has no dedicated REST endpoint; use Instrument Search → V3 candles for active instruments, or underlying search → expiries → expired contracts → expired candles for F&O history.

### 9.3 Quotes and options

| API | Method and URL | Parameters / limits | Key response |
|---|---|---|---|
| OHLC V3 | `GET https://api.upstox.com/v3/market-quote/ohlc?instrument_key={KEYS}&interval={1d|I1|I30}` | Up to 500 comma-separated keys | `last_price`, `instrument_token`, `prev_ohlc`, `live_ohlc`; OHLC includes `volume`, `ts` |
| OHLC V2 | `GET https://api.upstox.com/v2/market-quote/ohlc` | Up to 500 keys | `ohlc`, `last_price`, `instrument_token`; deprecated |
| LTP V3 | `GET https://api.upstox.com/v3/market-quote/ltp?instrument_key={KEYS}` | Up to 500 keys | `last_price`, `instrument_token`, `ltq`, `volume`, `cp` |
| LTP V2 | `GET https://api.upstox.com/v2/market-quote/ltp` | Up to 500 keys | `last_price`, `instrument_token`; deprecated |
| Full Market Quote V3 | `GET https://api.upstox.com/v3/market-quote/quotes?instrument_key={KEYS}` | Up to 500 keys | `ohlc`, `depth`, `timestamp`, `last_price`, `volume`, `average_price`, `oi`, `net_change`, circuit limits, year high/low, previous OI, CAS fields |
| Full Market Quote V2 | `GET https://api.upstox.com/v2/market-quote/quotes` | Up to 500 keys | Core OHLC/depth/quote fields; no CAS fields |
| Option Contracts | `GET https://api.upstox.com/v2/option/contract?instrument_key={UNDERLYING_KEY}&expiry_date={DATE_OR_KEYWORD}` | Underlying key; optional expiry keyword/date | `instrument_key`, `trading_symbol`, `expiry`, `strike_price`, `instrument_type`, `lot_size`, `tick_size` |
| Put/Call Option Chain | `GET https://api.upstox.com/v2/option/chain?instrument_key={UNDERLYING_KEY}&expiry_date={DATE_OR_KEYWORD}` | Underlying key and expiry required; no MCX | `strike_price`, `pcr`, `call_options`, `put_options`, market data and Greeks |
| Option Greeks | `GET https://api.upstox.com/v3/market-quote/option-greek?instrument_key={KEYS}` | Up to 50 keys | `iv`, `vega`, `gamma`, `theta`, `delta`, `oi`, `last_price` |

V3 Full Quote CAS fields include `indicative_equilibrium_price`, `indicative_equilibrium_quantity`, `indicative_imbalance_quantity_total`, `indicative_imbalance_quantity_market`, `reference_price`, and `cas_eligible`.

### 9.4 Market information and analytics

| API | Method and URL | Key parameters / response |
|---|---|---|
| Exchange Status | `GET https://api.upstox.com/v2/market/status/{EXCHANGE}` | `data.exchange`, `data.status`, `data.last_updated`, optional CAS status |
| Market Timings | `GET https://api.upstox.com/v2/market/timings/{YYYY-MM-DD}` | `data[]` with `exchange`, `start_time`, `end_time` |
| Market Holidays | `GET https://api.upstox.com/v2/market/holidays[/{YYYY-MM-DD}]` | `date`, `description`, `holiday_type`, `closed_exchanges`, `open_exchanges` |
| FII Activity | `GET https://api.upstox.com/v2/market/fii?data_type={SEGMENT}&interval={1D|1M}&from={DATE}` | Segment map with buy/sell amount, contracts, OI, long/short positions |
| DII Activity | `GET https://api.upstox.com/v2/market/dii?data_type=NSE_EQ%7CCASH&interval={1D|1M}&from={DATE}` | DII cash activity records |
| Open Interest | `GET https://api.upstox.com/v2/market/oi?instrument_key={UNDERLYING}&expiry={DATE_OR_KEYWORD}&date={DATE}` | `total_puts`, `total_calls`, strike-wise call/put OI |
| Change in OI | `GET https://api.upstox.com/v2/market/change-oi?instrument_key={UNDERLYING}&expiry={DATE_OR_KEYWORD}&date={DATE}&interval={DAYS}` | Total and strike-wise OI changes |
| Max Pain | `GET https://api.upstox.com/v2/market/max-pain?instrument_key={UNDERLYING}&expiry={DATE_OR_KEYWORD}&date={DATE}&bucket_interval={MINUTES}` | `max_pain`, spot price, intraday insights |
| Put-Call Ratio | `GET https://api.upstox.com/v2/market/pcr?instrument_key={UNDERLYING}&expiry={DATE_OR_KEYWORD}&date={DATE}&bucket_interval={MINUTES}` | `pcr`, spot price, intraday insights |

### 9.5 Smartlists

| API | Method and URL | Required parameters |
|---|---|---|
| Futures Smartlist | `GET https://api.upstox.com/v2/market/smartlist/futures?asset_type={INDEX|STOCK|COMMODITY}&category={CATEGORY}&page_number=1&page_size=20` | `asset_type`, `category` |
| Options Smartlist | `GET https://api.upstox.com/v2/market/smartlist/options?asset_type={INDEX|STOCK|COMMODITY}&category={CATEGORY}&page_number=1&page_size=20` | `asset_type`, `category` |
| MTF Smartlist | `GET https://api.upstox.com/v2/market/smartlist/mtf?page_number=1&page_size=20` | None; response is stock/MTF ranked by margin saved |

Categories include `TOP_TRADED`, `MOST_ACTIVE`, `OI_GAINERS`, `OI_LOSERS`, price gainers/losers, premium/discount, IV gainers/losers, and under-5000/under-10000 where supported.

### 9.6 Fundamentals

All fundamentals endpoints use `GET https://api.upstox.com/v2/fundamentals/{ISIN}/...`.

| API | URL suffix | Key parameters / response |
|---|---|---|
| Balance Sheet | `/balance-sheet?type=consolidated|standalone&fs=true` | `history[]`, optional `full_statement[]` |
| Cash Flow | `/cash-flow?type=consolidated|standalone&fs=true` | Operating/investing/financing categories, optional full statement |
| Company Profile | `/profile` | `company_profile`, `sector`, sector market cap INR/USD |
| Competitors | `/competitors` | Competitor `instrument_key`, profile, sector, market cap |
| Corporate Actions | `/corporate-actions` | Dividend, bonus, split, rights events and dates |
| Income Statement | `/income-statement?type=consolidated|standalone&time_period=yearly|quarterly&fs=true` | Revenue, operating profit, net profit, optional full statement |
| Key Ratios | `/key-ratios` | P/E, P/B, ROA, ROE, ROCE, EV/EBITDA versus sector |
| Share Holdings | `/share-holdings` | Promoter, FII, other DII, mutual fund, retail/other history |

Financial statement monetary values are documented in INR crore. Fundamentals support Analytics Token and do not require static IP.

### 9.7 News

```http
GET https://api.upstox.com/v2/news
```

Required query:

- `category=instrument_keys`, `positions`, or `holdings`
- For `instrument_keys`, `instrument_keys` is required, comma-separated, maximum 30 keys.
- Optional `page_number` (1–100, default 1) and `page_size` (1–100, default 100).

Response `data` is keyed by instrument key. Articles contain `heading`, `summary`, `thumbnail`, `article_link`, and `published_time` in Unix milliseconds. News supports Analytics Token and does not require static IP.

---

## 10. Realtime Streaming and Webhooks

### 10.1 Market Data Feed V3

Obtain a one-time authorized WebSocket URI:

```http
GET https://api.upstox.com/v3/feed/market-data-feed/authorize
Accept: application/json
Authorization: Bearer {ACCESS_TOKEN}
```

Response:

```json
{
  "status": "success",
  "data": {
    "authorized_redirect_uri": "wss://.../feeds?requestId=...&code=..."
  }
}
```

Connect to `authorized_redirect_uri`, or connect to `wss://api.upstox.com/v3/feed/market-data-feed` and follow the server redirect. The authorization code is single-use.

V3 control frames are **binary JSON**:

```json
{
  "guid": "unique-request-id",
  "method": "sub",
  "data": {
    "mode": "full",
    "instrumentKeys": ["NSE_INDEX|Nifty 50"]
  }
}
```

Methods:

| Method | Purpose |
|---|---|
| `sub` | Subscribe; default mode is `ltpc` |
| `change_mode` | Change mode for subscribed keys |
| `unsub` | Remove subscriptions |

Modes:

| Mode | Data |
|---|---|
| `ltpc` | LTP, last traded time/quantity, close |
| `full` | LTPC, five-depth, OHLC, extended metadata, Greeks |
| `option_greeks` | Greeks |
| `full_d30` | Full with 30-depth; Upstox Plus |

V3 market payloads are Protobuf, not JSON. The official schema is [MarketDataFeed.proto](https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto). Let the WebSocket client handle ping/pong, resend subscriptions after reconnect, and refresh authorization after token expiry.

### 10.2 Legacy Market Data Feed V2

```text
GET https://api.upstox.com/v2/feed/market-data-feed/authorize
wss://api.upstox.com/v2/feed/market-data-feed
```

V2 is discontinued. Its modes were `ltpc`, `full`, and `option_chain`; its Protobuf schema is [MarketDataFeed.proto](https://assets.upstox.com/feed/market-data-feed/v1.1/MarketDataFeed.proto). Migrate to V3.

### 10.3 Portfolio Stream Feed

```http
GET https://api.upstox.com/v2/feed/portfolio-stream-feed/authorize
Authorization: Bearer {ACCESS_TOKEN}
Accept: application/json
```

Socket:

```text
wss://api.upstox.com/v2/feed/portfolio-stream-feed?update_types=order,gtt_order,position,holding
```

If `update_types` is omitted, order updates are the default. Portfolio messages are JSON with `update_type` and one of:

- `order`
- `gtt_order`
- `position`
- `holding`

Use snake_case fields. `tradingsymbol` is deprecated; use `trading_symbol`.

### 10.4 Webhooks

| Webhook | Purpose | Configuration |
|---|---|---|
| Order/GTT webhook | Real-time order and GTT notifications | HTTPS `POST` endpoint; return `2XX`; order updates default, GTT must be enabled in app settings |
| Notifier webhook | Receives approved access-token payload | HTTPS `POST`; configure during app creation; acknowledge with plain text or JSON |

The documented flow does not specify HMAC signatures, retry ordering, or guaranteed idempotency. Treat payloads as untrusted, validate identifiers, deduplicate by `order_id`/`gtt_order_id`/timestamps, and protect the endpoint. Upstox rejects unstable or suspicious webhook URLs, including many dynamic-DNS, phishing, malware, spam, or proxy-avoidance domains.

---

## 11. Sandbox, SDKs, MCP, and Agent Skills

### 11.1 Sandbox

Create a sandbox app at [Developer Apps → Sandbox](https://account.upstox.com/developer/apps#sandbox).

- One sandbox app per user.
- Sandbox token validity: 30 days.
- Sandbox tokens cannot be used for live transactions.
- Documented sandbox coverage includes place, modify, and cancel orders; the sandbox page also lists multi-order placement.

Examples:

```http
POST https://sandbox.upstox.com/v2/order/place
PUT  https://sandbox.upstox.com/v2/order/modify
DELETE https://sandbox.upstox.com/v2/order/cancel?order_id={ORDER_ID}
```

### 11.2 Official SDKs

| Language | Package / install |
|---|---|
| Python | `pip install --upgrade upstox-python-sdk` |
| Node.js | `npm install upstox-js-sdk --save` |
| Java | Maven artifact `com.upstox.api:upstox-java-sdk` |
| PHP | `composer require upstox/upstox-php-sdk` |
| .NET | `dotnet add package upstox-dotnet-sdk` |

Python configuration:

```python
import os
import upstox_client

configuration = upstox_client.Configuration()
configuration.access_token = os.environ["UPSTOX_ACCESS_TOKEN"]
api_client = upstox_client.ApiClient(configuration)

profile = upstox_client.UserApi(api_client).get_profile("2.0")
```

Sandbox:

```python
configuration = upstox_client.Configuration(sandbox=True)
configuration.access_token = os.environ["UPSTOX_SANDBOX_ACCESS_TOKEN"]
```

Use environment variables or a secret manager. Do not hardcode credentials.

### 11.3 MCP Integration

MCP endpoint:

```text
https://mcp.upstox.com/mcp
```

MCP is read-only and supports holdings, orders, positions, mutual funds, funds, and profile. It cannot place or modify orders. First use requires OAuth and daily reauthorization.

Generic configuration:

```json
{
  "mcpServers": {
    "Upstox MCP": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.upstox.com/mcp"]
    }
  }
}
```

### 11.4 Agent Skills

For an agent that can execute trading workflows:

```bash
npx skills add upstox/upstox-skills --skill upstox
```

The skill uses the official Python SDK and includes guardrails such as explicit confirmation before place/modify/cancel, LIMIT-by-default pricing, F&O lot-size validation, Market Price Protection, kill-switch support, sandbox-first testing, and no hardcoded secrets. MCP is the appropriate choice for read-only analysis; Agent Skills are not read-only.

---

## 12. Appendix Values and Implementation Notes

### 12.1 Exchange codes

| Code | Meaning |
|---|---|
| `NSE` | National Stock Exchange equities |
| `NFO` | NSE futures and options |
| `CDS` | Currency derivatives |
| `BSE` | Bombay Stock Exchange equities |
| `BFO` | BSE futures and options |
| `BCD` | BSE currency derivatives |
| `MCX` | Commodity futures |
| `NSCOM` | NSE commodity derivatives |

Instrument-key prefixes can differ from exchange codes: for example `NSE` maps to `NSE_EQ`, `NSE_FO`, `NSE_INDEX`, and `NSE_COM`; `CDS` maps to `NCD_FO`.

### 12.2 Equity security types

| Value | Meaning |
|---|---|
| `SME` | Small and medium enterprise equity |
| `RELIST` | Relisted equity |
| `PCA` | Equity under regulatory oversight |
| `IPO` | IPO equity |
| `NORMAL` | Normal equity |

### 12.3 Order statuses

Treat these as exact, case-sensitive strings:

`validation pending`, `modify pending`, `trigger pending`, `put order req received`, `modify after market order req received`, `cancelled after market order`, `open`, `complete`, `modify validation pending`, `after market order req received`, `modified`, `not cancelled`, `cancel pending`, `rejected`, `cancelled`, `open pending`, `not modified`.

### 12.4 Market statuses

Base statuses include `NORMAL_OPEN`, `NORMAL_CLOSE`, `PRE_OPEN_START`, `PRE_OPEN_END`, `CLOSING_START`, and `CLOSING_END`. CAS statuses include `CTS_CLOSE`, `CAS_LM_START`, `CAS_M_STOP`, and `CAS_STOP`. Pre-open includes `PRE_OPEN_M_END`.

### 12.5 Field patterns

Published patterns include:

```text
order_id: ^[-a-zA-Z0-9]+

financial_year: ^(0|[1-9][0-9]*)$

exchange: ^(\s*|(?:NSE|NFO|CDS|BSE|BFO|BCD|MCX|NSCOM)+)$
```

The published instrument patterns contain a duplicated anchor and legacy exchange names; validate actual instrument keys against the current instrument master instead of relying on the regex alone.

### 12.6 Common product, order, and transaction values

| Field | Common values |
|---|---|
| Product | `I` intraday, `D` delivery, `CO` cover, `MTF` margin trade funding |
| Order type | `MARKET`, `LIMIT`, `SL`, `SL-M` |
| Validity | `DAY`, `IOC` |
| Transaction | `BUY`, `SELL` |
| GTT type | `SINGLE`, `MULTIPLE` |
| GTT strategy | `ENTRY`, `TARGET`, `STOPLOSS` |
| GTT trigger | `BELOW`, `ABOVE`, `IMMEDIATE` |

### 12.7 Security and production checklist

- Keep `client_secret`, access tokens, extended tokens, Analytics Tokens, and sandbox tokens out of source control and logs.
- Perform OAuth token exchange on a backend.
- Use a random `state` and validate it on callback.
- Use the exact registered redirect URI.
- Use TLS for every callback and webhook.
- Store tokens encrypted and rotate them on logout, static-IP changes, or suspected exposure.
- Use `instrument_key` from current instrument files or Instrument Search.
- Implement rate-limit queues and retry policies.
- Handle unknown enum values and free-form IPO status strings gracefully.
- Use LIMIT orders unless current account/endpoint rules explicitly permit MARKET.
- Test destructive workflows in Sandbox first.
- Confirm kill-switch, static-IP, algo-registration, and segment restrictions before enabling live trading.

---

## 13. Current Migration and Operational Notes

### 13.1 V2 to V3 migration

Upstox documents V2 phase-out/migration for:

- Place Order → V3 Place Order
- Modify Order → V3 Modify Order
- Cancel Order → V3 Cancel Order
- Historical Candle Data → V3 Historical Candle Data
- Intraday Candle Data → V3 Intraday Candle Data
- OHLC Quotes → V3 OHLC Quotes
- LTP Quotes → V3 LTP Quotes
- Market Data Feed → V3 Market Data Feed
- Market Data Feed Authorize → V3 Market Data Feed Authorize

V3 order differences:

- Host changes to `api-hft.upstox.com`.
- Place response changes from `data.order_id` to `data.order_ids[]`.
- `slice` enables automatic exchange freeze-quantity slicing.
- `metadata.latency` is added.
- Static-IP and algo-name enforcement can affect order requests.

Market Data Feeder V2 is discontinued; use Market Data Feed V3. CSV instrument files are deprecated in favor of JSON.

### 13.2 Static IP and algo requirements

Current documentation and regulatory notices require API order traffic to originate from a registered static IP for place, modify, cancel, multi-order, GTT, and exit-all operations. One primary and one secondary IP are supported; changes are limited to once per calendar week and invalidate existing tokens.

The published material distinguishes regular algo traffic from SEBI-registered algo traffic at the rate-limit level. It also describes an algo-name header requirement for approved algo strategies, while the current V3 order page describes `X-Algo-Name` as conditional. Test the current endpoint with the actual app/account before production launch and do not send an Algo ID where the endpoint expects an Algo Name.

### 13.3 Current order restrictions

The current V3 references document possible restrictions on MARKET orders and MCX API orders, plus static-IP and algo validation errors. Market Price Protection values include:

- `-1`: automatic/default protection
- `1`–`25`: custom percentage
- `0`: no protection; MARKET may be rejected under current restrictions

Use `LIMIT` by default and re-check the live docs/announcements before relying on MARKET execution.

### 13.4 Recent implementation-critical changes

- CAS market-data fields were added to Full Market Quotes V3 and Market Data Feed V3.
- CAS-eligible equities have separate closing-auction order-flow statuses.
- Analytics Token now supports selected account/trade/portfolio GET APIs when called from a registered static IP.
- Fund and Margin V3 provides nested cash, pledge, available, unavailable, and margin-used breakdowns.
- Payments, mutual funds, IPO application, smartlists, fundamentals, news, expired instruments, GTT, multi-order, and exit-all APIs expand the current surface beyond the original order/quote APIs.
- Webhook URLs are subject to security validation.
- V2 WebSocket and several V2 market-data endpoints are deprecated or discontinued.

---

## 14. Official Source Map

### 14.1 Getting Started

- [API Overview](https://upstox.com/developer/api-documentation/api-overview)
- [API Structure](https://upstox.com/developer/api-documentation/request-response)
- [Request Structure](https://upstox.com/developer/api-documentation/request-structure)
- [Response Structure](https://upstox.com/developer/api-documentation/response-structure)
- [Error Codes](https://upstox.com/developer/api-documentation/error-codes)
- [Rate Limits](https://upstox.com/developer/api-documentation/rate-limiting)
- [Instruments](https://upstox.com/developer/api-documentation/instrument)
- [Instrument Files](https://upstox.com/developer/api-documentation/instruments)
- [Instrument Search](https://upstox.com/developer/api-documentation/instrument-search)
- [Authentication](https://upstox.com/developer/api-documentation/authentication)
- [Authorize](https://upstox.com/developer/api-documentation/authorize)
- [Get Token](https://upstox.com/developer/api-documentation/get-token)
- [Access Token Request](https://upstox.com/developer/api-documentation/access-token-request)
- [Logout](https://upstox.com/developer/api-documentation/logout)
- [Analytics Token](https://upstox.com/developer/api-documentation/analytics-token)
- [Sandbox](https://upstox.com/developer/api-documentation/sandbox)
- [SDK](https://upstox.com/developer/api-documentation/sdk)
- [Installing SDK](https://upstox.com/developer/api-documentation/installing-sdk)
- [MCP Integration](https://upstox.com/developer/api-documentation/mcp-integration)
- [Agent Quickstart](https://upstox.com/developer/api-documentation/agent-quickstart)

### 14.2 Account and Funds

- [User](https://upstox.com/developer/api-documentation/user)
- [Get Profile](https://upstox.com/developer/api-documentation/get-profile)
- [Get Fund and Margin](https://upstox.com/developer/api-documentation/get-user-fund-margin)
- [Get Fund and Margin V3](https://upstox.com/developer/api-documentation/get-funds-and-margin-v3)
- [Margin Details](https://upstox.com/developer/api-documentation/margin)
- [Brokerage Details](https://upstox.com/developer/api-documentation/get-brokerage)
- [Kill Switch](https://upstox.com/developer/api-documentation/update-kill-switch)
- [Kill Switch Status](https://upstox.com/developer/api-documentation/get-kill-switch)
- [Get Static IPs](https://upstox.com/developer/api-documentation/get-app-static-ips)
- [Update Static IPs](https://upstox.com/developer/api-documentation/update-app-static-ips)
- [Payments](https://upstox.com/developer/api-documentation/payments)
- [Get Payins](https://upstox.com/developer/api-documentation/get-user-payins)
- [Get Payouts](https://upstox.com/developer/api-documentation/get-user-payouts)
- [Get Payout Modes](https://upstox.com/developer/api-documentation/get-payout-modes)
- [Payout Request](https://upstox.com/developer/api-documentation/payout-request)
- [Modify Payout](https://upstox.com/developer/api-documentation/modify-payout)
- [Cancel Payout](https://upstox.com/developer/api-documentation/cancel-payout)

### 14.3 Orders and Trading

- [Orders](https://upstox.com/developer/api-documentation/orders)
- [Place Order V3](https://upstox.com/developer/api-documentation/v3/place-order)
- [Place Order](https://upstox.com/developer/api-documentation/place-order)
- [Modify Order V3](https://upstox.com/developer/api-documentation/v3/modify-order)
- [Modify Order](https://upstox.com/developer/api-documentation/modify-order)
- [Cancel Order V3](https://upstox.com/developer/api-documentation/v3/cancel-order)
- [Cancel Order](https://upstox.com/developer/api-documentation/cancel-order)
- [Place Multi Order](https://upstox.com/developer/api-documentation/place-multi-order)
- [Cancel Multi Order](https://upstox.com/developer/api-documentation/cancel-multi-order)
- [Exit All Positions](https://upstox.com/developer/api-documentation/exit-all-positions)
- [Get Order Details](https://upstox.com/developer/api-documentation/get-order-details)
- [Get Order History](https://upstox.com/developer/api-documentation/get-order-history)
- [Get Order Book](https://upstox.com/developer/api-documentation/get-order-book)
- [Get Trades](https://upstox.com/developer/api-documentation/get-trade-history)
- [Get Order Trades](https://upstox.com/developer/api-documentation/get-trades-by-order)
- [Get Historical Trades](https://upstox.com/developer/api-documentation/get-historical-trades)
- [GTT Orders](https://upstox.com/developer/api-documentation/gtt-orders)
- [Place GTT Order](https://upstox.com/developer/api-documentation/place-gtt-order)
- [Modify GTT Order](https://upstox.com/developer/api-documentation/modify-gtt-order)
- [Cancel GTT Order](https://upstox.com/developer/api-documentation/cancel-gtt-order)
- [Get GTT Order Details](https://upstox.com/developer/api-documentation/get-gtt-order-details)
- [IPO](https://upstox.com/developer/api-documentation/ipo)
- [Get IPOs](https://upstox.com/developer/api-documentation/get-ipos)
- [Get IPO Details](https://upstox.com/developer/api-documentation/get-ipo-details)
- [Apply IPO](https://upstox.com/developer/api-documentation/apply-ipo)
- [Get IPO Orders](https://upstox.com/developer/api-documentation/get-ipo-orders)
- [Get IPO Order Details](https://upstox.com/developer/api-documentation/get-ipo-order-details)
- [Cancel IPO Order](https://upstox.com/developer/api-documentation/cancel-ipo-order)

### 14.4 Portfolio and P&L

- [Portfolio](https://upstox.com/developer/api-documentation/portfolio)
- [Get Positions](https://upstox.com/developer/api-documentation/get-positions)
- [Get MTF Positions](https://upstox.com/developer/api-documentation/get-mtf-positions)
- [Convert Positions](https://upstox.com/developer/api-documentation/convert-positions)
- [Get Holdings](https://upstox.com/developer/api-documentation/get-holdings)
- [Mutual Fund](https://upstox.com/developer/api-documentation/mutual-fund)
- [Get Mutual Fund Orders](https://upstox.com/developer/api-documentation/get-mutual-fund-orders)
- [Get Mutual Fund Order Details](https://upstox.com/developer/api-documentation/get-mutual-fund-order-by-id)
- [Get Mutual Fund SIPs](https://upstox.com/developer/api-documentation/get-mutual-fund-sips)
- [Get Mutual Fund Holdings](https://upstox.com/developer/api-documentation/get-mutual-fund-holdings)
- [Trade Profit And Loss](https://upstox.com/developer/api-documentation/trade-profit-and-loss)
- [Get Report Metadata](https://upstox.com/developer/api-documentation/get-report-meta-data)
- [Get Profit and Loss Report](https://upstox.com/developer/api-documentation/get-profit-and-loss-report)
- [Get Trade Charges](https://upstox.com/developer/api-documentation/get-trade-charges)

### 14.5 Market Data

- [Historical Data](https://upstox.com/developer/api-documentation/historical-data)
- [Historical Candle V3](https://upstox.com/developer/api-documentation/v3/get-historical-candle-data)
- [Historical Candle](https://upstox.com/developer/api-documentation/get-historical-candle-data)
- [Intraday Candle V3](https://upstox.com/developer/api-documentation/v3/get-intra-day-candle-data)
- [Intraday Candle](https://upstox.com/developer/api-documentation/get-intra-day-candle-data)
- [Expired Instruments](https://upstox.com/developer/api-documentation/expired-instruments)
- [Get Expiries](https://upstox.com/developer/api-documentation/get-expiries)
- [Get Expired Option Contracts](https://upstox.com/developer/api-documentation/get-expired-option-contracts)
- [Get Expired Future Contracts](https://upstox.com/developer/api-documentation/get-expired-future-contracts)
- [Expired Historical Candle Data](https://upstox.com/developer/api-documentation/get-expired-historical-candle-data)
- [Backtesting](https://upstox.com/developer/api-documentation/backtesting)
- [Market Quote](https://upstox.com/developer/api-documentation/market-quote)
- [OHLC V3](https://upstox.com/developer/api-documentation/get-market-quote-ohlc-v3)
- [OHLC](https://upstox.com/developer/api-documentation/get-market-quote-ohlc)
- [LTP V3](https://upstox.com/developer/api-documentation/ltp-v3)
- [LTP](https://upstox.com/developer/api-documentation/ltp)
- [Full Market Quote V3](https://upstox.com/developer/api-documentation/get-full-market-quote-v3)
- [Full Market Quote](https://upstox.com/developer/api-documentation/get-full-market-quote)
- [Option Chain](https://upstox.com/developer/api-documentation/option-chain)
- [Option Contracts](https://upstox.com/developer/api-documentation/get-option-contracts)
- [Put/Call Option Chain](https://upstox.com/developer/api-documentation/get-pc-option-chain)
- [Option Greeks](https://upstox.com/developer/api-documentation/option-greek)
- [Market Information](https://upstox.com/developer/api-documentation/market-information)
- [Exchange Status](https://upstox.com/developer/api-documentation/get-market-status)
- [Market Timings](https://upstox.com/developer/api-documentation/get-market-timings)
- [Market Holidays](https://upstox.com/developer/api-documentation/get-market-holidays)
- [FII Activity](https://upstox.com/developer/api-documentation/get-fii-data)
- [DII Activity](https://upstox.com/developer/api-documentation/get-dii-data)
- [Open Interest](https://upstox.com/developer/api-documentation/get-oi)
- [Change in OI](https://upstox.com/developer/api-documentation/get-change-oi)
- [Max Pain](https://upstox.com/developer/api-documentation/get-max-pain)
- [PCR](https://upstox.com/developer/api-documentation/get-pcr)
- [Futures Smartlist](https://upstox.com/developer/api-documentation/get-futures-smartlist)
- [Options Smartlist](https://upstox.com/developer/api-documentation/get-options-smartlist)
- [MTF Smartlist](https://upstox.com/developer/api-documentation/get-mtf-smartlist)
- [Fundamentals](https://upstox.com/developer/api-documentation/fundamentals)
- [Balance Sheet](https://upstox.com/developer/api-documentation/get-balance-sheet)
- [Cash Flow](https://upstox.com/developer/api-documentation/get-cash-flow)
- [Company Profile](https://upstox.com/developer/api-documentation/get-company-profile)
- [Competitors](https://upstox.com/developer/api-documentation/get-competitors)
- [Corporate Actions](https://upstox.com/developer/api-documentation/get-corporate-actions)
- [Income Statement](https://upstox.com/developer/api-documentation/get-income-statement)
- [Key Ratios](https://upstox.com/developer/api-documentation/get-key-ratios)
- [Share Holdings](https://upstox.com/developer/api-documentation/get-share-holdings)
- [News](https://upstox.com/developer/api-documentation/news)
- [Get News](https://upstox.com/developer/api-documentation/get-news)

### 14.6 Realtime, SDK, and appendix

- [WebSocket](https://upstox.com/developer/api-documentation/websocket)
- [Market Data Feed V3](https://upstox.com/developer/api-documentation/v3/get-market-data-feed)
- [Market Data Feed Authorize V3](https://upstox.com/developer/api-documentation/get-market-data-feed-authorize-v3)
- [Market Data Feed](https://upstox.com/developer/api-documentation/get-market-data-feed)
- [Market Data Feed Authorize](https://upstox.com/developer/api-documentation/get-market-data-feed-authorize)
- [Portfolio Stream Feed](https://upstox.com/developer/api-documentation/get-portfolio-stream-feed)
- [Portfolio Stream Authorize](https://upstox.com/developer/api-documentation/get-portfolio-stream-feed-authorize)
- [WebSocket Implementation](https://upstox.com/developer/api-documentation/websocket-implementation)
- [Streamer Functions](https://upstox.com/developer/api-documentation/streamer-function)
- [Webhook](https://upstox.com/developer/api-documentation/webhook)
- [Sample Implementation](https://upstox.com/developer/api-documentation/sample-implementation)
- [Code Samples](https://upstox.com/developer/api-documentation/code-samples)
- [Appendix](https://upstox.com/developer/api-documentation/appendix)
- [Exchange Codes](https://upstox.com/developer/api-documentation/appendix/exchange)
- [Equity Security Type](https://upstox.com/developer/api-documentation/appendix/equity-security-type)
- [Order Status](https://upstox.com/developer/api-documentation/appendix/order-status)
- [Market Status](https://upstox.com/developer/api-documentation/appendix/market-status)
- [Field Pattern](https://upstox.com/developer/api-documentation/appendix/field-pattern)
- [Instant Withdrawal Eligibility](https://upstox.com/developer/api-documentation/appendix/instant-withdrawal-eligibility)
- [Notifier Webhook Endpoint](https://upstox.com/developer/api-documentation/appendix/notifier-webhook-endpoint)
- [Postman Collection](https://upstox.com/developer/api-documentation/appendix/postman-collection)
- [Agent Skills](https://upstox.com/developer/api-documentation/agent-skills)
- [Announcements](https://upstox.com/developer/api-documentation/announcements)
- [V2 Deprecation Notice](https://upstox.com/developer/api-documentation/announcements/deprecation-notice-v2)
- [Market Data Feeder V3 / V2 Discontinuation](https://upstox.com/developer/api-documentation/announcements/new-market-feeder-v3)
- [Static IP and Algo Requirements](https://upstox.com/developer/api-documentation/announcements/algo-trading-circular)
- [Market Quote V3](https://upstox.com/developer/api-documentation/announcements/market-quote-v3)
- [CAS Market Data](https://upstox.com/developer/api-documentation/announcements/market-quote-v3-full-quotes)
- [Analytics Token](https://upstox.com/developer/api-documentation/announcements/analytics-token)
- [Analytics Token for Account APIs](https://upstox.com/developer/api-documentation/announcements/analytics-token-static-ip)
- [Fund and Margin V3](https://upstox.com/developer/api-documentation/announcements/get-funds-and-margin-v3)
- [Webhook URL Security Policy](https://upstox.com/developer/api-documentation/announcements/webhook-url-security-policy)

---

## Source and maintenance note

This reference was assembled from the official Upstox Developer API pages and their current machine-readable index. It intentionally separates stable endpoint documentation from dated announcements. Re-check the official pages before changing production order routing, authentication, static-IP logic, market-data parsing, or payout behavior.
