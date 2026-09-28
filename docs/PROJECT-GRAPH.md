# Tradex Project Graph

Generated from the actual repository (imports, routes, migrations, tests).
Mermaid diagrams render on GitHub / VS Code.

> Scope (2026-09-27): TypeScript backend only (`apps/api`, 40 src files).
> Python `apps/agents` and `apps/agent-ui` were removed by the owner.

## 1. System map

```mermaid
flowchart TB
    subgraph Upstox[Upstox API]
        WS[V3 Market Feed WS]
        HIST[V3 Historical Candles]
        SEARCH[V2 Instrument Search]
        EXP[V2 Expired Instruments]
    end
    subgraph TS[Bun + TypeScript — apps/api]
        CAP[Raw Capture<br/>WS → queue → SQLite]
        HACQ[Historical Acquisition<br/>chunk → normalize → SQLite]
        VAL[Validation<br/>VALID / INVALID / INCOMPLETE]
        INST[Instruments<br/>search + expiries + contracts]
        HTTP[Hono API + /docs]
    end
    subgraph Store[SQLite — data/ ~120MB]
        T[(9 tables)]
    end
    WS --> CAP --> T
    HIST --> HACQ --> T
    SEARCH --> INST
    EXP --> INST
    HTTP --> T
```

## 2. Module dependencies

```mermaid
flowchart TB
    SERVER[src/server.ts] --> APP[src/app.ts]
    SERVER --> CAPSVC[src/capture/service.ts]
    SERVER --> CAPSTORE[src/capture/store.ts]
    SERVER --> WS2[src/capture/upstox-source.ts]
    SERVER --> HISTCLI[src/historical/upstox-client.ts]
    SERVER --> SEARCHCLI[src/instruments/upstox-search.ts]
    SERVER --> EXPCLI[src/instruments/upstox-expiries.ts]
    APP --> R1[src/routes/health.ts]
    APP --> R2[src/routes/ready.ts]
    APP --> R3[src/routes/capture.ts]
    APP --> R4[src/routes/historical.ts]
    APP --> R5[src/routes/instruments.ts]
    APP --> SCH[src/openapi/schemas.ts]
    R4 --> HSVC[src/historical/service.ts]
    R4 --> HVAL[src/historical/validation.ts]
    HSVC --> HCH[src/historical/chunks.ts]
    HSVC --> HID[src/historical/dataset-id.ts]
    HSVC --> HV[src/historical/validate.ts]
    HVAL --> HDET[src/historical/detectors.ts]
    HVAL --> HSES[src/historical/sessions.ts]
    HID --> CANON[src/capture/canonical.ts]
    CAPSVC --> BATCH[src/capture/batch.ts]
    CAPSVC --> PB[src/capture/protobuf.ts]
    CAPSVC --> Q[src/capture/queue.ts]
    HSVC --> DBSCH[src/db/schema.ts]
    CAPSTORE --> DBSCH
```

## 3. HTTP endpoints (14)

| Method | Path |
|---|---|
| GET | `/health` |
| GET | `/ready` |
| GET | `/capture/status` |
| GET | `/capture/stats` |
| GET | `/capture/subscriptions` |
| POST | `/capture/subscriptions` |
| POST | `/historical/datasets` |
| GET | `/historical/datasets/{datasetId}` |
| POST | `/historical/datasets/{datasetId}/validation` |
| GET | `/historical/datasets/{datasetId}/validation` |
| GET | `/instruments/search` |
| GET | `/instruments/expiries` |
| GET | `/instruments/option-contracts` |
| GET | `/instruments/expired-option-contracts` |
| GET | `/instruments/expired-future-contracts` |
| GET | `/instruments/expired-candles` |
| GET | `/openapi.json`, `/docs` |

## 4. Database tables (data/research.db + data/capture/)

| Table | Writer |
|---|---|
| `database_probe` | foundation |
| `raw_batches`, `raw_market_messages`, `capture_errors` | capture/store.ts → `data/capture/YYYY-MM-DD/raw.sqlite` |
| `historical_datasets`, `historical_chunks`, `historical_raw_responses`, `historical_candles` | historical/service.ts |
| `validation_reports` | historical/validation.ts |

## 5. Tests — 104 pass, 0 fail (19 files: `bun test` + vitest + `tsc`)

Capture (protobuf/batch/queue/store/service/subscriptions) · historical
(chunks/client/dataset/service/endpoints/validation) · instruments
(search/expiries/contracts) · app/config/database.

## 6. Key contracts

- `instrumentKey` is the canonical instrument identity (no resolver).
- `dataset_id` = SHA-256(canonical request) — single identity scheme.
- Instrument discovery is read-only; nothing is stored.
- Expired keys carry a date suffix (`NSE_FO|58422|03-10-2024`).
- Upstox minute intervals are open-ended (`\d+minute` verified live).
