# AI Commerce Assistant

Conversational product discovery for Magento 2.

## Phase 3 (current)

- Dynamic AI questions via **Ollama + LangChain**
- Live product results via **Magento 2 GraphQL** (Magento database — no static mock catalog)

### Prerequisites

- Node.js 20+
- Ollama with `qwen2.5:3b`
- Magento 2 GraphQL reachable (local example: `http://m248p4.local/graphql`)

### Configure Magento

```bash
cp server/.env.example server/.env
```

Key values:

```env
MAGENTO_URL=http://m248p4.local
MAGENTO_GRAPHQL_URL=http://m248p4.local/graphql
MAGENTO_STORE_CODE=default
MAGENTO_GRAPHQL_USE_AUTH=false
MAGENTO_FALLBACK_MOCK=true
```

### Run

Terminal 1 — API:

```bash
cd server && npm install && npm run dev
```

Terminal 2 — UI:

```bash
npm install && npm run dev
```

Open [http://localhost:5173/ai-assistant](http://localhost:5173/ai-assistant)

Health check: [http://localhost:3001/api/health](http://localhost:3001/api/health)

### Flow

1. Customer query → Ollama extracts intent / asks follow-ups
2. Structured filters → Magento GraphQL `products` query
3. Magento returns real name, SKU, price, image, stock, URL
4. UI shows recommendation cards (AI never invents products)

### APIs

- `POST /api/assistant/start`
- `POST /api/assistant/message`
- `POST /api/assistant/search` — filters → Magento (or mock fallback)

### Magento 2 search bar (Option B module)

Module installed on the local Magento store:

`/var/www/html/magento248p4/app/code/Klizer/AiCommerceAssistant`

What it does:

1. Rewrites the storefront search form action via a plugin on `Magento\Search\Helper\Data::getResultUrl()`
2. Optionally redirects `/catalogsearch/result/?q=...` to the assistant
3. Admin-configurable URL (works with the existing `Klizer_ImageRecognition` search template)

Enable / refresh Magento:

```bash
cd /var/www/html/magento248p4
php bin/magento module:enable Klizer_AiCommerceAssistant
php bin/magento setup:upgrade
php bin/magento cache:flush
```

Admin config:

**Stores → Configuration → Klizer → AI Commerce Assistant**

| Setting | Default |
|---------|---------|
| Enable AI Search Redirect | Yes |
| Assistant URL | `http://localhost:5173/ai-assistant` |
| Redirect Magento Search Results Page | Yes |

Keep the AI UI + API running, then search from `http://m248p4.local` — you should land on:

`http://localhost:5173/ai-assistant?q=Your+Query`

## Phase 4 — Semantic search (PostgreSQL + pgvector)

Hybrid recall when Magento keywords miss intent language:

1. Sync Magento products → Ollama **bge-m3** embeddings → Postgres `product_embeddings`
2. Search uses Magento GraphQL first, then enriches / falls back with pgvector
3. Product cards still use real Magento SKUs (no invented products)

### Setup

Postgres + pgvector must be available. Schema:

```bash
cd server
npm run db:migrate:embeddings
# optional user memory:
npm run db:migrate:context
# or both:
npm run db:migrate
```

Migrations read `DATABASE_URL` from `server/.env` (no need to export it in the shell).

`server/.env`:

```env
SEMANTIC_ENABLED=true
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_commerce_assistant
EMBEDDING_MODEL=bge-m3
EMBEDDING_DIMS=1024
SEMANTIC_TOP_K=12
SEMANTIC_MIN_SCORE=0.35
SEMANTIC_FALLBACK_MIN_SCORE=0.55
```

Pull embedding model (once):

```bash
ollama pull bge-m3
```

Index catalog:

```bash
cd server && npm run sync:embeddings
# or: curl -X POST http://localhost:3001/api/semantic/sync -H 'Content-Type: application/json' -d '{}'
```

Assistant search then runs **Magento GraphQL + pgvector**, merges SKUs, and **re-ranks** by stock, budget, keyword/SKU hit, and semantic similarity. Product cards still use live Magento data (no invented SKUs).

### Semantic APIs

- `GET /api/semantic/status`
- `POST /api/semantic/sync` — Magento → embeddings
- `POST /api/semantic/search` — `{ "query": "grinding motor shaft" }`

Health includes a `semantic` block when enabled.
