# AI Commerce Assistant

Node.js conversational product discovery for Magento 2 catalogs. Customers describe what they need in plain language; the assistant clarifies intent, builds filters, and returns **real Magento catalog products** via GraphQL—never invented SKUs, prices, or stock.

| Layer | Stack |
| ----- | ----- |
| UI | React 19, Vite 8, Tailwind 4, React Router |
| API | Node 20+, Express 5, Zod, LangChain + Ollama |
| Catalog | Magento 2 GraphQL (configured in `server/.env`) |
| Chat LLM | `qwen2.5:3b` via Ollama |
| Semantic (optional) | PostgreSQL + pgvector, embeddings `bge-m3` (1024-d) |
| Analytics (optional) | Postgres search logs + CTR (`/analytics`) |

---

## How it works

1. Customer query → Ollama extracts intent / asks follow-ups (≤3 clarifying questions with option chips).
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
| **Magento 2 GraphQL URL** | Reachable from the Node server (set in `server/.env`) |
| **PostgreSQL + pgvector** | For semantic search, context memory, and/or analytics |

For semantic / context / analytics embeddings:

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
```

Edit `server/.env` — minimum for Magento GraphQL–only mode:

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

Point `MAGENTO_*` at your GraphQL store. Raise `OLLAMA_TIMEOUT_MS` on CPU-only machines (30–90s is common).

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
| [http://localhost:5173/analytics](http://localhost:5173/analytics) | Search analytics dashboard |
| [http://localhost:3001/api/health](http://localhost:3001/api/health) | Health (Ollama, Magento GraphQL, semantic, context, analytics) |

Vite proxies `/api` → `http://127.0.0.1:3001`.

### Demo screenshots (Node)

![Frontend UI run](https://i.ibb.co/pjyCtNw1/image.png)

*Frontend UI run (`npm run dev`)*

![AI Commerce Assistant app UI](https://i.ibb.co/4RFMNNVK/image.png)

*Assistant app running for test*

![Backend run](https://i.ibb.co/5g3q0B0P/image.png)

*Backend run (`cd server && npm run dev`)*

![Search Analytics enabled in backend](https://i.ibb.co/VcVTZqZW/image.png)

*Backend console: Search Analytics enabled (Postgres + `db:migrate:analytics`)*

More Node screenshots: **[DEMO.md](./DEMO.md)**.

---

## Environment reference

Copy from `server/.env.example`. Important keys:

| Variable | Default / example | Purpose |
| -------- | ----------------- | ------- |
| `MAGENTO_URL` | `http://m248p4.local` | Store base URL (PDP links) |
| `MAGENTO_GRAPHQL_URL` | `…/graphql` | GraphQL endpoint |
| `MAGENTO_STORE_CODE` | `default` | Store view header |
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

Hybrid recall when Magento keywords miss intent language.

```bash
cd server
npm run db:migrate              # or db:migrate:embeddings
ollama pull bge-m3
npm run sync:embeddings
```

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

---

## User context memory (optional)

When `CONTEXT_MEMORY_ENABLED=true`, completed searches can be saved for a `userId`. A later similar query can offer **Continue previous search** vs **New search**.

Requires Postgres + `npm run db:migrate:context` (or full `db:migrate`).

---

## Merchant domain config

Vertical behavior lives in `server/domain-config.json` (domains, clarify chips, attribute maps, LLM hint).

- Default: `server/domain-config.json`
- Non-apparel example: copy `server/domain-config.example-auto.json`

---

## Analytics setup (Node)

Search ROI metrics (zero-result rate, hybrid/semantic share, CTR) are stored in Postgres and shown at **[http://localhost:5173/analytics](http://localhost:5173/analytics)**.

```bash
cd server
npm run db:migrate:analytics   # or full: npm run db:migrate
npm run dev
```

Confirm: `GET http://localhost:3001/api/analytics/status` → `"enabled": true`.

API startup should log analytics enabled:

![Search Analytics enabled in backend](https://i.ibb.co/VcVTZqZW/image.png)

| Event | When |
| ----- | ---- |
| Search row | Completed assistant search (`search_products`) |
| Impression | Product cards shown in the React grid |
| Click | Shopper clicks **View Product** |

| Metric | Meaning |
| ------ | ------- |
| Zero-result rate | Searches with no products |
| Hybrid / semantic share | Share of searches with `source` hybrid or semantic |
| CTR | Product card clicks ÷ impressions |
| What / how / whom | Query · Magento vs hybrid · guest `userId` |

---

## API overview

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/health` | Model, Magento GraphQL, semantic, context, analytics |
| `GET` | `/api/magento/attributes` | Filterable Magento attributes |
| `POST` | `/api/assistant/start` | Start session with a query |
| `POST` | `/api/assistant/message` | Continue conversation / answer chips |
| `POST` | `/api/assistant/search` | Filters → Magento (± semantic) |
| `GET` | `/api/semantic/status` | Index / config status |
| `POST` | `/api/semantic/sync` | Magento → embeddings |
| `POST` | `/api/semantic/search` | `{ "query": "…" }` vector search |
| `GET` | `/api/context/status` | Context memory status |
| `POST` | `/api/context/save` | Persist search context |
| `GET` | `/api/context/latest` | Latest for user |
| `POST` | `/api/context/search` | Similar past queries |
| `POST` | `/api/context/continue` | Replay previous search |
| `POST` | `/api/context/clear` | Clear user context |
| `GET` | `/api/analytics/status` | Analytics enabled? |
| `GET` | `/api/analytics/summary?days=30` | Zero-result, hybrid share, CTR |
| `GET` | `/api/analytics/searches?page=1&limit=10` | Recent searches (paginated) |
| `POST` | `/api/analytics/track` | Product impressions & clicks |

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
├── src/                      # React assistant UI + /analytics
├── server/
│   ├── .env.example
│   ├── domain-config.json
│   ├── sql/                  # Migrations (incl. 003 analytics)
│   └── src/
│       ├── ai/
│       ├── analytics/
│       ├── config/
│       ├── context/
│       ├── magento/          # GraphQL client (Node)
│       ├── routes/
│       ├── semantic/
│       ├── services/
│       ├── session/
│       └── scripts/
├── DEMO.md                   # Node / app screenshots
```

Chat sessions are **in-memory** (lost on API restart). Product truth always comes from Magento GraphQL.

---

## Demo ideas

**Node screenshots:** [DEMO.md](./DEMO.md)

| Scenario | Try |
| -------- | --- |
| Apparel / gym | “Something comfortable for the gym” → clarify → Magento cards |
| Industrial | “Motor shaft grinding—need replacement” → part filters → real parts |
| Direct SKU | Paste a known SKU → skip Q&A |
| Context replay | Same `userId`, similar query → Continue previous search |
| Semantic enrich | Vague query after `sync:embeddings` → `hybrid` / `semantic` source |
| Analytics | Searches + View Product → `/analytics` |

Confirm `/api/health` before demos.

---

## Troubleshooting

| Symptom | What to check |
| ------- | ------------- |
| UI loads but chat fails | API on `:3001`; Vite proxy |
| Slow / timeout replies | Raise `OLLAMA_TIMEOUT_MS`; Ollama running |
| Empty / wrong products | GraphQL URL, store code, auth; `/api/health` Magento block |
| Semantic always empty | `SEMANTIC_ENABLED`, `DATABASE_URL`, pgvector, migrate, `sync:embeddings` |
| Context never offered | `CONTEXT_MEMORY_ENABLED`, migrations, threshold, stable `userId` |
| Analytics CTR stays 0% | `db:migrate:analytics`; click **View Product**; refresh `/analytics` |
| Wrong clarification style | Update `server/domain-config.json` |

---

## Further reading

- [DEMO.md](./DEMO.md) — Node / app run screenshots     
