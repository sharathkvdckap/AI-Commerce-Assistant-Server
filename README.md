# AI Commerce Assistant

Conversational product discovery for **Magento 2**. Customers describe what they need in plain language; the assistant clarifies intent, builds filters, and returns **real Magento catalog products**—never invented SKUs, prices, or stock.

| Layer | Stack |
| ----- | ----- |
| UI | React 19, Vite 8, Tailwind 4, React Router |
| API | Node 20+, Express 5, Zod, LangChain + Ollama |
| Catalog | Magento 2 GraphQL |
| Chat LLM | `qwen2.5:3b` via Ollama |
| Semantic (optional) | PostgreSQL + pgvector, embeddings `bge-m3` (1024-d) |

---

## How it works

1. Customer query (or Magento search redirect) → Ollama extracts intent / asks follow-ups (≤3 clarifying questions with option chips).
2. Structured filters → Magento GraphQL `products` query (categories + attributes).
3. Optional hybrid recall: Magento first, then pgvector enrich / fallback, then re-rank.
4. UI shows recommendation cards with live Magento name, SKU, price, image, stock, and PDP URL.

Exact SKU / clear product name can skip Q&A and go straight to Magento.

```text
Query → Assistant API → Ollama (clarify or search)
                      → Magento GraphQL (± pgvector)
                      → Product cards → Magento PDP
```

---

## Prerequisites

| Requirement | Notes |
| ----------- | ----- |
| **Node.js 20+** | Frontend + API |
| **Ollama** | Pull chat model: `ollama pull qwen2.5:3b` |
| **Magento 2 GraphQL** | Reachable endpoint (local example: `http://m248p4.local/graphql`) |
| **PostgreSQL + pgvector** | Required only if semantic search and/or context memory are enabled |

For semantic / context features also pull:

```bash
ollama pull bge-m3
```

---

## Quick start

### 1. Clone and install

```bash
git clone <repo-url> AI-Commerce-Assistant
cd AI-Commerce-Assistant

# Frontend
npm install

# API
cd server && npm install && cd ..
```

### 2. Configure environment

```bash
cp server/.env.example server/.env
# optional root copy for reference:
cp .env.example .env   # if you keep a root env; the API reads server/.env
```

Edit `server/.env` — minimum for Magento-only mode:

```env
MAGENTO_URL=http://m248p4.local
MAGENTO_GRAPHQL_URL=http://m248p4.local/graphql
MAGENTO_STORE_CODE=default
MAGENTO_GRAPHQL_USE_AUTH=false

OLLAMA_MODEL=qwen2.5:3b
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_TIMEOUT_MS=120000
PORT=3001

# Turn off until Postgres is ready
SEMANTIC_ENABLED=false
CONTEXT_MEMORY_ENABLED=false
```

Point `MAGENTO_*` at your store. Raise `OLLAMA_TIMEOUT_MS` on CPU-only machines (30–90s is common).

### 3. Run

**Terminal 1 — API**

```bash
cd server && npm run dev
```

**Terminal 2 — UI**

```bash
npm run dev
```

Or from the repo root:

```bash
npm run dev:all
```

| URL | Purpose |
| --- | ------- |
| [http://localhost:5173/ai-assistant](http://localhost:5173/ai-assistant) | Assistant UI |
| [http://localhost:3001/api/health](http://localhost:3001/api/health) | Health (Ollama, Magento, semantic, context) |

Vite proxies `/api` → `http://127.0.0.1:3001`.

---

## Environment reference

Copy from `server/.env.example`. Important keys:

| Variable | Default / example | Purpose |
| -------- | ----------------- | ------- |
| `MAGENTO_URL` | `http://m248p4.local` | Store base URL |
| `MAGENTO_GRAPHQL_URL` | `…/graphql` | GraphQL endpoint |
| `MAGENTO_STORE_CODE` | `default` | Store view |
| `MAGENTO_ACCESS_TOKEN` | *(empty)* | Integration token if auth required |
| `MAGENTO_GRAPHQL_USE_AUTH` | `false` | Send Bearer token |
| `MAGENTO_PAGE_SIZE` | `0` | Page size (0 = server default) |
| `MAGENTO_TIMEOUT_MS` | `20000` | GraphQL timeout |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Chat model |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama host |
| `OLLAMA_TIMEOUT_MS` | `120000` | LLM call timeout |
| `PORT` | `3001` | API port |
| `SEMANTIC_ENABLED` | `true` | Hybrid Magento + pgvector |
| `DATABASE_URL` | `postgresql://…/ai_commerce_assistant` | Postgres (+ pgvector) |
| `EMBEDDING_MODEL` | `bge-m3` | Embedding model |
| `EMBEDDING_DIMS` | `1024` | Must match model |
| `SEMANTIC_TOP_K` | `12` | Vector recall depth |
| `SEMANTIC_MIN_SCORE` | `0.35` | Enrich threshold |
| `SEMANTIC_FALLBACK_MIN_SCORE` | `0.55` | Fallback when Magento is weak |
| `CONTEXT_MEMORY_ENABLED` | `true` | Save / reuse prior searches |
| `CONTEXT_SIMILARITY_THRESHOLD` | `0.80` | Offer “continue previous search” |
| `DOMAIN_CONFIG_PATH` | `./domain-config.json` | Merchant vertical config |

---

## Semantic search (PostgreSQL + pgvector)

Hybrid recall when Magento keywords miss intent language (e.g. symptom or paraphrase queries).

1. Sync Magento products → Ollama **bge-m3** embeddings → Postgres `product_embeddings`.
2. Search uses Magento GraphQL first, then enriches / falls back with pgvector.
3. Hits are hydrated from Magento by SKU and re-ranked (stock, budget, keyword/SKU hit, similarity). Cards still use live Magento data.

### Setup

Ensure Postgres has the **pgvector** extension, then:

```bash
cd server

# Create tables (reads DATABASE_URL from server/.env)
npm run db:migrate
# or separately:
# npm run db:migrate:embeddings
# npm run db:migrate:context

# Pull embedding model once
ollama pull bge-m3

# Index catalog from Magento
npm run sync:embeddings
# or: curl -X POST http://localhost:3001/api/semantic/sync \
#        -H 'Content-Type: application/json' -d '{}'
```

Enable in `server/.env`:

```env
SEMANTIC_ENABLED=true
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_commerce_assistant
EMBEDDING_MODEL=bge-m3
EMBEDDING_DIMS=1024
```

| Flag | Product search | Needs embedding sync? |
| ---- | -------------- | --------------------- |
| `SEMANTIC_ENABLED=true` | Magento + pgvector hybrid | **Yes** |
| `SEMANTIC_ENABLED=false` | Magento GraphQL only | No |

Check status: `GET /api/semantic/status` or the `semantic` block on `/api/health`.

---

## User context memory (optional)

When `CONTEXT_MEMORY_ENABLED=true`, completed searches can be saved for a `userId`. A later similar query can offer **Continue previous search** (replay saved SKUs via live Magento) vs **New search**.

Requires the same Postgres + pgvector setup and `npm run db:migrate:context` (or full `db:migrate`).

---

## Merchant domain config

Vertical behavior (domains, clarify chips, attribute maps, LLM catalog hint) lives in `server/domain-config.json`.

- Default path: `server/domain-config.json`
- Non-apparel example: copy `server/domain-config.example-auto.json` → `domain-config.json`, or set `DOMAIN_CONFIG_PATH`

This keeps apparel vs industrial / auto prompts and Magento attribute mapping aligned with the catalog.

## API overview

### Health & Magento

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/health` | Model, Magento reachability, semantic, context, domain config |
| `GET` | `/api/magento/attributes` | Filterable Magento attributes |

### Assistant

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/assistant/start` | Start session with a query |
| `POST` | `/api/assistant/message` | Continue conversation / answer chips |
| `POST` | `/api/assistant/search` | Filters → Magento (± semantic) |

### Semantic

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/semantic/status` | Index / config status |
| `POST` | `/api/semantic/sync` | Magento → embeddings |
| `POST` | `/api/semantic/search` | `{ "query": "…" }` vector search |

### Context memory

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/context/status` | Context memory status |
| `POST` | `/api/context/save` | Persist search context |
| `GET` | `/api/context/latest` | Latest for user |
| `POST` | `/api/context/search` | Similar past queries |
| `POST` | `/api/context/continue` | Replay previous search |
| `POST` | `/api/context/clear` | Clear user context |

### Analytics (ROI)

Requires `DATABASE_URL` + `npm run db:migrate:analytics`.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/analytics/status` | Enabled? |
| `GET` | `/api/analytics/summary?days=30` | Zero-result, hybrid share, CTR, top queries/SKUs |
| `GET` | `/api/analytics/searches` | Recent searches (what / how / whom) |
| `POST` | `/api/analytics/track` | Product impressions & clicks |

React UI: [http://localhost:5173/analytics](http://localhost:5173/analytics)  
Magento Admin (merged into **Klizer_AiCommerceAssistant**): `/admin/aicommerceassistant/dashboard/index`

---

## Analytics setup

Search ROI metrics (zero-result rate, hybrid/semantic share, CTR) are stored in Postgres and shown in:

1. **React** — header link → `/analytics`
2. **Magento Admin** — **AI Commerce Assistant → Search ROI Dashboard** (same Node API)

`Klizer_AiCommerceAnalytics` was merged into `Klizer_AiCommerceAssistant` — maintain **one** Magento module only.

### 1. Node / Postgres

```bash
cd server
# DATABASE_URL already in .env
npm run db:migrate:analytics   # or full: npm run db:migrate
npm run dev
```

Confirm: `GET http://localhost:3001/api/analytics/status` → `"enabled": true`.

API startup should log **Search Analytics: enabled** (requires `DATABASE_URL` + migration `003`):

![Search Analytics enabled in backend](https://i.ibb.co/VcVTZqZW/image.png)

### 2. Magento module

Install/enable `Klizer_AiCommerceAssistant` (includes storefront AI + admin analytics):

```bash
# Magento root example
php bin/magento module:enable Klizer_AiCommerceAssistant
php bin/magento module:disable Klizer_AiCommerceAnalytics   # if old split module exists
php bin/magento setup:upgrade
php bin/magento cache:flush
```

**Stores → Configuration → Klizer → AI Commerce Assistant**

| Setting | Example |
| ------- | ------- |
| Enable | Yes |
| AI API Base URL | `http://127.0.0.1:3001` |
| Search Analytics → Enable Analytics Menu | Yes |
| Full Analytics Dashboard URL (optional) | `http://localhost:5173/analytics` |
| Default Window (days) | `30` |

Admin menu: **AI Commerce Assistant → Search ROI Dashboard**

### 3. How metrics update

| Event | When it is recorded |
| ----- | ------------------- |
| Search row | Each completed AI search (`/api/assistant/start` or `/message` → `search_products`) |
| Impression | Product cards shown on results (React grid **or** Magento AI PLP) |
| Click | Shopper opens a product card (React **or** Magento PLP → PDP) |

Magento PLP tracks via proxy `POST /aicommerceassistant/ajax/track` → Node `/api/analytics/track`.

Then refresh the Magento dashboard (or React `/analytics`).

### Metrics

| Metric | Meaning |
| ------ | ------- |
| Zero-result rate | Searches with no products |
| Hybrid / semantic share | Share of searches with `source` hybrid or semantic |
| CTR | Product card clicks ÷ impressions |
| What / how / whom | Query text · Magento vs hybrid · guest/`customer_*` `userId` |

---

## npm scripts

**Root (UI)**

| Script | Command |
| ------ | ------- |
| `npm run dev` | Vite UI (`:5173`) |
| `npm run dev:server` | Express API via `server` |
| `npm run dev:all` | API + UI together |
| `npm run build` | Production UI build |
| `npm run lint` | oxlint |
| `npm run preview` | Preview production build |

**`server/`**

| Script | Command |
| ------ | ------- |
| `npm run dev` | API with watch (`tsx`) |
| `npm run start` | API once |
| `npm run db:migrate` | All SQL migrations |
| `npm run db:migrate:embeddings` | Product embeddings schema |
| `npm run db:migrate:context` | User context memory schema |
| `npm run db:migrate:analytics` | Search analytics + CTR events |
| `npm run sync:embeddings` | Crawl Magento → embed → Postgres |

---

## Project layout

```text
AI-Commerce-Assistant/
├── src/                      # React assistant UI
│   ├── api/                  # Client → /api/* (incl. analytics)
│   ├── components/assistant/ # Chat, chips, product cards (+ CTR track)
│   ├── hooks/                # useAssistant
│   └── pages/                # AiAssistantPage, AnalyticsPage
├── magento/
│   └── DEMO.md               # Magento admin + storefront demos
├── server/
│   ├── .env.example
│   ├── domain-config.json
│   ├── sql/                  # Migrations (incl. 003 analytics)
│   └── src/
│       ├── ai/               # engine, prompts (Ollama)
│       ├── analytics/        # search + CTR persistence
│       ├── config/           # env, domain config
│       ├── context/          # memory, preferences
│       ├── magento/          # GraphQL client, attributes, search
│       ├── routes/           # assistant, semantic, context, analytics
│       ├── semantic/         # sync, recall, rerank
│       ├── services/         # productSearch, contextReplay
│       ├── session/          # in-memory chat sessions
│       └── scripts/          # migrate, syncEmbeddings
├── DEMO.md                     # Node / app run screenshots
└── HACKATHON_DOCUMENTATION.md  # Architecture & demo deep dive
```

Magento module lives in the Magento install (not this repo copy):  
`app/code/Klizer/AiCommerceAssistant` — storefront AI **and** Admin Search ROI (analytics merged; do not use a separate `AiCommerceAnalytics` module).

Chat sessions are **in-memory** (lost on API restart). Product truth always comes from Magento.

---

## Demo ideas

**20-min speaking guide:** [DEMO_SCRIPT_20MIN.md](./DEMO_SCRIPT_20MIN.md) (Semantic OFF vs ON)  
Screenshots: [DEMO.md](./DEMO.md) (Node) · [magento/DEMO.md](./magento/DEMO.md) (Magento)

| Scenario | Try |
| -------- | --- |
| Apparel / gym | “Something comfortable for the gym” → clarify → Magento cards |
| Industrial | “Motor shaft grinding—need replacement” → part filters → real parts |
| Direct SKU | Paste a known SKU → skip Q&A |
| Context replay | Same `userId`, similar query → Continue previous search |
| Semantic enrich | Vague query after `sync:embeddings` → `hybrid` / `semantic` source |

Confirm `/api/health` shows Magento reachable (and semantic/context green when enabled) before demos.

---

## Troubleshooting

| Symptom | What to check |
| ------- | ------------- |
| UI loads but chat fails | API on `:3001`; Vite proxy; CORS not needed for proxy path |
| Slow / timeout replies | Raise `OLLAMA_TIMEOUT_MS`; ensure Ollama is running; CPU models are slow |
| Empty / wrong products | Magento GraphQL URL, store code, auth token; `/api/health` Magento block |
| Semantic always empty | `SEMANTIC_ENABLED`, `DATABASE_URL`, pgvector, `db:migrate`, `sync:embeddings` |
| Context never offered | `CONTEXT_MEMORY_ENABLED`, migrations, similarity threshold, stable `userId` |
| Analytics CTR stays 0% | Migrate analytics; click products from React or Magento AI PLP; refresh dashboard |
| Magento analytics menu missing | Enable **Search Analytics** under Assistant config; ACL/menu after cache flush |
| Wrong clarification style | Update `server/domain-config.json` for your vertical |

---

## Further reading

- [DEMO.md](./DEMO.md) · [magento/DEMO.md](./magento/DEMO.md) — screenshots & videos
- Magento module: `app/code/Klizer/AiCommerceAssistant` (storefront + Admin analytics)
- [HACKATHON_DOCUMENTATION.md](./HACKATHON_DOCUMENTATION.md) — architecture deep dive

### Demo screenshots — Search Analytics (backend)

![Search Analytics enabled in backend](https://i.ibb.co/VcVTZqZW/image.png)

*Backend console: Search Analytics enabled (Postgres / `db:migrate:analytics`)*

