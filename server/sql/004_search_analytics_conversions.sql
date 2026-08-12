-- Conversion events: reached checkout vs placed order (separate event types).
-- Requires 003_search_analytics.sql.

ALTER TABLE ai_product_events
  DROP CONSTRAINT IF EXISTS ai_product_events_event_type_check;

ALTER TABLE ai_product_events
  ADD CONSTRAINT ai_product_events_event_type_check
  CHECK (event_type IN ('impression', 'click', 'checkout', 'order'));

ALTER TABLE ai_product_events
  ADD COLUMN IF NOT EXISTS quote_id TEXT,
  ADD COLUMN IF NOT EXISTS order_id TEXT,
  ADD COLUMN IF NOT EXISTS qty NUMERIC,
  ADD COLUMN IF NOT EXISTS revenue NUMERIC,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS ai_product_events_search_id_idx
  ON ai_product_events (search_id);

CREATE INDEX IF NOT EXISTS ai_product_events_quote_idx
  ON ai_product_events (quote_id)
  WHERE quote_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_product_events_order_idx
  ON ai_product_events (order_id)
  WHERE order_id IS NOT NULL;

-- One checkout row per search + sku + quote; one order row per search + sku + order.
CREATE UNIQUE INDEX IF NOT EXISTS ai_product_events_checkout_dedup_idx
  ON ai_product_events (search_id, sku, quote_id)
  WHERE event_type = 'checkout'
    AND search_id IS NOT NULL
    AND quote_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_product_events_order_dedup_idx
  ON ai_product_events (search_id, sku, order_id)
  WHERE event_type = 'order'
    AND search_id IS NOT NULL
    AND order_id IS NOT NULL;
