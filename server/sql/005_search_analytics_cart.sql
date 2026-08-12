-- Reached cart page as its own event (separate from checkout and order).
-- Requires 004_search_analytics_conversions.sql.

ALTER TABLE ai_product_events
  DROP CONSTRAINT IF EXISTS ai_product_events_event_type_check;

ALTER TABLE ai_product_events
  ADD CONSTRAINT ai_product_events_event_type_check
  CHECK (event_type IN ('impression', 'click', 'cart', 'checkout', 'order'));

CREATE UNIQUE INDEX IF NOT EXISTS ai_product_events_cart_dedup_idx
  ON ai_product_events (search_id, sku, quote_id)
  WHERE event_type = 'cart'
    AND search_id IS NOT NULL
    AND quote_id IS NOT NULL;
