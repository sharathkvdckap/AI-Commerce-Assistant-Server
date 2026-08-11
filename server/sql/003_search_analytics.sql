-- Search analytics: zero-result, hybrid lift, CTR (impressions / clicks)
-- Requires DATABASE_URL (same Postgres as context / semantic).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- ai_search_analytics — one row per completed assistant product search
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_search_analytics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL,
  session_id            UUID,
  original_query        TEXT NOT NULL,
  filters               JSONB NOT NULL DEFAULT '{}'::jsonb,
  source                TEXT,
  match_type            TEXT,
  product_count         INTEGER NOT NULL DEFAULT 0,
  alternative_count     INTEGER NOT NULL DEFAULT 0,
  product_skus          JSONB NOT NULL DEFAULT '[]'::jsonb,
  alternative_skus      JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_zero_result        BOOLEAN NOT NULL DEFAULT FALSE,
  from_memory           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_search_analytics_created_at_idx
  ON ai_search_analytics (created_at DESC);

CREATE INDEX IF NOT EXISTS ai_search_analytics_user_id_idx
  ON ai_search_analytics (user_id);

CREATE INDEX IF NOT EXISTS ai_search_analytics_zero_idx
  ON ai_search_analytics (is_zero_result)
  WHERE is_zero_result = TRUE;

CREATE INDEX IF NOT EXISTS ai_search_analytics_source_idx
  ON ai_search_analytics (source);

-- ---------------------------------------------------------------------------
-- ai_product_events — impressions & clicks for CTR
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_product_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  session_id      UUID,
  search_id       UUID REFERENCES ai_search_analytics(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN ('impression', 'click')),
  sku             TEXT NOT NULL,
  product_id      TEXT,
  product_name    TEXT,
  product_url     TEXT,
  list_type       TEXT NOT NULL DEFAULT 'primary'
                    CHECK (list_type IN ('primary', 'alternative')),
  source          TEXT,
  position        INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_product_events_created_at_idx
  ON ai_product_events (created_at DESC);

CREATE INDEX IF NOT EXISTS ai_product_events_type_idx
  ON ai_product_events (event_type);

CREATE INDEX IF NOT EXISTS ai_product_events_session_idx
  ON ai_product_events (session_id);

CREATE INDEX IF NOT EXISTS ai_product_events_sku_idx
  ON ai_product_events (sku);
