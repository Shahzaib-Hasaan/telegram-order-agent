-- Tandoor & Bun — indexes for volume
--
-- The board used to fetch "everything not delivered, plus 12 hours of delivered".
-- At 1000 orders/day that is ~363 KB every 3 seconds — about 425 MB/hour, which
-- burns the whole 5 GB monthly Supabase egress allowance in half a day.
--
-- The fix is architectural: the board reads ONLY open orders (a set that stays
-- at 10-40 no matter how busy the day is), and history moves to its own
-- paginated, searchable endpoint. These indexes serve those two access paths.

-- ---------------------------------------------------------------------------
-- BOARD: open orders only. Partial index, so it stays tiny — it indexes the
-- ~30 live rows, not the 1000 finished ones.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_open
  ON orders (created_at)
  WHERE status IN ('new', 'preparing', 'on_the_way');

-- delta polling: "what changed since my last tick"
CREATE INDEX IF NOT EXISTS idx_orders_updated
  ON orders (updated_at DESC);

-- ---------------------------------------------------------------------------
-- HISTORY: newest-first paging, plus lookup by phone and by order number.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_history
  ON orders (id DESC);

CREATE INDEX IF NOT EXISTS idx_orders_phone
  ON orders (delivery_phone)
  WHERE delivery_phone IS NOT NULL;

-- "which orders had a BBQ Platter in them" — trigram so partial words work
CREATE INDEX IF NOT EXISTS idx_order_items_name_trgm
  ON order_items USING gin (product_name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Daily rollup for the stat strip. Counting a whole day of rows on every poll
-- is wasteful once the day is big; this lets Postgres answer from an index-only
-- scan over a narrow slice.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_created_status
  ON orders (created_at, status)
  INCLUDE (total);

ANALYZE orders;
ANALYZE order_items;
