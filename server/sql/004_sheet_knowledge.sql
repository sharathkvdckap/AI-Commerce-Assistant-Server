-- Merchant knowledge RAG: Google Sheet / CSV rows → BGE-M3 → pgvector
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS sheet_chunks (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  topic           TEXT,
  sku             TEXT,
  content         TEXT NOT NULL,
  embedding       vector(1024),
  embedding_model TEXT NOT NULL DEFAULT 'bge-m3',
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sheet_chunks_embedding_hnsw_idx
  ON sheet_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS sheet_chunks_sku_idx
  ON sheet_chunks (sku)
  WHERE sku IS NOT NULL AND sku <> '';

CREATE INDEX IF NOT EXISTS sheet_chunks_source_idx
  ON sheet_chunks (source);
