-- Tandoor & Bun — Telegram Order Agent
-- Schema v1. Target: Supabase Postgres 17 (East US / North Virginia).
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  name        TEXT    NOT NULL,
  aliases     TEXT[]  NOT NULL DEFAULT '{}',   -- Roman Urdu / colloquial spellings for fuzzy match
  description TEXT,
  price       INTEGER NOT NULL CHECK (price >= 0),   -- whole PKR
  category    TEXT    NOT NULL,
  available   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  image_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- customers  (Telegram identity is the primary key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  tg_id       BIGINT PRIMARY KEY,
  tg_username TEXT,
  name        TEXT,
  phone       TEXT,
  address     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- orders
-- Delivery details are SNAPSHOTTED, not read live off customers, so editing a
-- profile never rewrites where a past order actually went.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id               SERIAL PRIMARY KEY,
  customer_tg_id   BIGINT NOT NULL REFERENCES customers(tg_id),
  status           TEXT   NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new','preparing','on_the_way','delivered','cancelled')),
  subtotal         INTEGER NOT NULL CHECK (subtotal >= 0),
  delivery_fee     INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  total            INTEGER NOT NULL CHECK (total >= 0),
  payment_method   TEXT    NOT NULL DEFAULT 'cod' CHECK (payment_method IN ('cod','transfer')),
  -- snapshot of delivery details at time of order
  delivery_name    TEXT,
  delivery_phone   TEXT,
  delivery_address TEXT,
  note             TEXT,
  cancelled_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- order_items
-- product_name / unit_price snapshotted so renaming or delisting a product
-- never corrupts order history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT    NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  unit_price   INTEGER NOT NULL CHECK (unit_price >= 0),
  line_total   INTEGER GENERATED ALWAYS AS (qty * unit_price) STORED
);

-- ---------------------------------------------------------------------------
-- status_events — audit trail; also what drives the customer Telegram pings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_status_events (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  TEXT NOT NULL DEFAULT 'dashboard',
  notified    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created      ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer     ON orders(customer_tg_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order   ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_products_available  ON products(available, category);
CREATE INDEX IF NOT EXISTS idx_status_events_order ON order_status_events(order_id);

-- trigram index so check_item can fuzzy-match typos ("zingr", "biriyani")
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated  ON products;
DROP TRIGGER IF EXISTS trg_customers_updated ON customers;
DROP TRIGGER IF EXISTS trg_orders_updated    ON orders;

CREATE TRIGGER trg_products_updated  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated    BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- log every status change automatically
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_status_change() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO order_status_events (order_id, from_status, to_status)
    VALUES (NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_status_log ON orders;
CREATE TRIGGER trg_orders_status_log AFTER UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION log_status_change();

-- ---------------------------------------------------------------------------
-- SECURITY: lock the PostgREST door.
-- Supabase auto-exposes the `public` schema over its REST API using the anon
-- key, and that key is public by design. We never use that path — n8n and the
-- dashboard both connect as the `postgres` role over raw Postgres, which
-- bypasses RLS. Enabling RLS with ZERO policies means anon/authenticated REST
-- requests return nothing, while our connections keep full access.
-- ---------------------------------------------------------------------------
ALTER TABLE products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON products, customers, orders, order_items, order_status_events
  FROM anon, authenticated;
