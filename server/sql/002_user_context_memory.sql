-- User context memory: conversations, preferences, semantic search history
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- conversation_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'collecting'
                    CHECK (status IN ('collecting', 'ready_to_search', 'completed', 'abandoned')),
  original_query  TEXT,
  domain          TEXT,
  filters         JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT,
  updated_by      TEXT,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS conversation_sessions_user_id_idx
  ON conversation_sessions (user_id)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS conversation_sessions_user_status_idx
  ON conversation_sessions (user_id, status)
  WHERE is_deleted = FALSE;

-- ---------------------------------------------------------------------------
-- conversation_memory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_memory (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL,
  session_id            UUID NOT NULL UNIQUE REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  questions_asked       JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_answers      JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_recommendations    JSONB NOT NULL DEFAULT '[]'::jsonb,
  conversation_summary  TEXT,
  message_log           JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            TEXT,
  updated_by            TEXT,
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS conversation_memory_user_id_idx
  ON conversation_memory (user_id)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS conversation_memory_session_id_idx
  ON conversation_memory (session_id)
  WHERE is_deleted = FALSE;

-- ---------------------------------------------------------------------------
-- user_search_history (semantic similarity via embedding)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_search_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  session_id        UUID REFERENCES conversation_sessions(id) ON DELETE SET NULL,
  original_query    TEXT NOT NULL,
  intent            TEXT,
  category          TEXT,
  subcategory       TEXT,
  filters           JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding         vector(1024),
  embedding_model   TEXT NOT NULL DEFAULT 'bge-m3',
  search_frequency  INTEGER NOT NULL DEFAULT 1,
  last_searched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT,
  updated_by        TEXT,
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS user_search_history_user_id_idx
  ON user_search_history (user_id)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS user_search_history_embedding_hnsw_idx
  ON user_search_history
  USING hnsw (embedding vector_cosine_ops)
  WHERE is_deleted = FALSE AND embedding IS NOT NULL;

-- ---------------------------------------------------------------------------
-- user_preferences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_preferences (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     TEXT NOT NULL UNIQUE,
  preferred_brands            JSONB NOT NULL DEFAULT '[]'::jsonb,
  budget                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  sizes                       JSONB NOT NULL DEFAULT '[]'::jsonb,
  colours                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  categories                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  material                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  gender                      TEXT,
  shopping_style              TEXT,
  favourite_products          JSONB NOT NULL DEFAULT '[]'::jsonb,
  frequently_purchased_cats   JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra                       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  TEXT,
  updated_by                  TEXT,
  is_deleted                  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS user_preferences_user_id_idx
  ON user_preferences (user_id)
  WHERE is_deleted = FALSE;

-- ---------------------------------------------------------------------------
-- user_context (fast snapshot for GET /api/context/latest)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_context (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL UNIQUE,
  latest_session_id     UUID REFERENCES conversation_sessions(id) ON DELETE SET NULL,
  latest_query          TEXT,
  latest_summary        TEXT,
  latest_filters        JSONB NOT NULL DEFAULT '{}'::jsonb,
  preference_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_activity_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            TEXT,
  updated_by            TEXT,
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS user_context_user_id_idx
  ON user_context (user_id)
  WHERE is_deleted = FALSE;

-- ---------------------------------------------------------------------------
-- ai_recommendation_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_recommendation_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  session_id          UUID REFERENCES conversation_sessions(id) ON DELETE SET NULL,
  query               TEXT,
  filters             JSONB NOT NULL DEFAULT '{}'::jsonb,
  products            JSONB NOT NULL DEFAULT '[]'::jsonb,
  alternatives        JSONB NOT NULL DEFAULT '[]'::jsonb,
  source              TEXT,
  match_type          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          TEXT,
  updated_by          TEXT,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS ai_recommendation_logs_user_id_idx
  ON ai_recommendation_logs (user_id)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS ai_recommendation_logs_session_id_idx
  ON ai_recommendation_logs (session_id)
  WHERE is_deleted = FALSE;
