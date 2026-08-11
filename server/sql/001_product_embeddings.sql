-- Product semantic search: Magento catalog → BGE-M3 embeddings → pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- product_embeddings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_embeddings (
  sku               TEXT PRIMARY KEY,
  magento_id        TEXT,
  name              TEXT NOT NULL,
  search_text       TEXT NOT NULL,
  price             DOUBLE PRECISION,
  currency          TEXT NOT NULL DEFAULT 'USD',
  in_stock          BOOLEAN NOT NULL DEFAULT TRUE,
  image_url         TEXT,
  product_url       TEXT,
  embedding         vector(1024),
  embedding_model   TEXT NOT NULL DEFAULT 'bge-m3',
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Reconcile installs created by an earlier column layout
-- (content / model / stock_status instead of search_text / embedding_model / in_stock)
-- ---------------------------------------------------------------------------
ALTER TABLE product_embeddings ADD COLUMN IF NOT EXISTS magento_id TEXT;
ALTER TABLE product_embeddings ADD COLUMN IF NOT EXISTS search_text TEXT;
ALTER TABLE product_embeddings ADD COLUMN IF NOT EXISTS price DOUBLE PRECISION;
ALTER TABLE product_embeddings ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';
ALTER TABLE product_embeddings ADD COLUMN IF NOT EXISTS in_stock BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE product_embeddings ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE product_embeddings ADD COLUMN IF NOT EXISTS product_url TEXT;
ALTER TABLE product_embeddings ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE product_embeddings ADD COLUMN IF NOT EXISTS embedding_model TEXT DEFAULT 'bge-m3';

DO $$
DECLARE
  has_column BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_embeddings' AND column_name = 'content'
  ) INTO has_column;
  IF has_column THEN
    EXECUTE 'UPDATE product_embeddings SET search_text = content WHERE search_text IS NULL';
    EXECUTE 'ALTER TABLE product_embeddings ALTER COLUMN content DROP NOT NULL';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_embeddings' AND column_name = 'model'
  ) INTO has_column;
  IF has_column THEN
    EXECUTE 'UPDATE product_embeddings SET embedding_model = model WHERE embedding_model IS NULL';
    EXECUTE 'ALTER TABLE product_embeddings ALTER COLUMN model SET DEFAULT ''bge-m3''';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_embeddings' AND column_name = 'stock_status'
  ) INTO has_column;
  IF has_column THEN
    EXECUTE $sql$
      UPDATE product_embeddings
      SET in_stock = (UPPER(COALESCE(stock_status, 'IN_STOCK')) = 'IN_STOCK')
      WHERE stock_status IS NOT NULL
    $sql$;
    EXECUTE 'ALTER TABLE product_embeddings ALTER COLUMN stock_status DROP NOT NULL';
  END IF;

  -- Legacy embedding NOT NULL blocks metadata-only upserts
  EXECUTE 'ALTER TABLE product_embeddings ALTER COLUMN embedding DROP NOT NULL';

  IF NOT EXISTS (SELECT 1 FROM product_embeddings WHERE search_text IS NULL) THEN
    EXECUTE 'ALTER TABLE product_embeddings ALTER COLUMN search_text SET NOT NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM product_embeddings WHERE embedding_model IS NULL) THEN
    EXECUTE 'ALTER TABLE product_embeddings ALTER COLUMN embedding_model SET NOT NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM product_embeddings WHERE currency IS NULL) THEN
    EXECUTE 'ALTER TABLE product_embeddings ALTER COLUMN currency SET NOT NULL';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS product_embeddings_embedding_hnsw_idx
  ON product_embeddings
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS product_embeddings_synced_at_idx
  ON product_embeddings (synced_at DESC);
