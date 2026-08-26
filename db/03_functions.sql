-- Tandoor & Bun — agent tool functions
-- Every tool the AI Agent can call is one function here. n8n attaches a
-- Postgres Tool node per function; the agent never writes SQL.
--
-- Design rules enforced in SQL, not in the prompt (a prompt can be talked out of
-- a rule; a function cannot):
--   * prices are ALWAYS looked up from products — never taken from the model
--   * minimum order and delivery-fee logic live here
--   * order_status is scoped to the calling customer, so nobody reads someone
--     else's order by guessing an id

-- ---------------------------------------------------------------------------
-- shop config — single row, white-label
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_config (
  id             INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name           TEXT    NOT NULL,
  delivery_fee   INTEGER NOT NULL DEFAULT 120,
  free_delivery_over INTEGER NOT NULL DEFAULT 2000,
  min_order      INTEGER NOT NULL DEFAULT 500,
  open_time      TIME    NOT NULL DEFAULT '12:00',
  close_time     TIME    NOT NULL DEFAULT '02:00',
  eta_minutes    TEXT    NOT NULL DEFAULT '35-45'
);
ALTER TABLE shop_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON shop_config FROM anon, authenticated;

INSERT INTO shop_config (id, name) VALUES (1, 'Tandoor & Bun')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- ---------------------------------------------------------------------------
-- fn_get_menu() -> compact text menu
-- Text, not JSON: this goes into the LLM context on tool calls, and the text
-- form is roughly a third of the tokens.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_get_menu()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT string_agg(cat_block, E'\n')
  FROM (
    SELECT category || ': ' || string_agg(name || ' Rs' || price, ', ' ORDER BY sort_order) AS cat_block,
           MIN(sort_order) AS o
    FROM products
    WHERE available
    GROUP BY category
    ORDER BY MIN(sort_order)
  ) t;
$$;

-- ---------------------------------------------------------------------------
-- fn_check_item(query) -> matching items
-- Layered match: exact alias > alias contains > name contains > trigram.
-- Returns up to 4 so the agent can disambiguate ("chicken ya beef biryani?")
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_check_item(q TEXT)
RETURNS TABLE (id INTEGER, name TEXT, price INTEGER, category TEXT, available BOOLEAN, score REAL)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.name, p.price, p.category, p.available,
         GREATEST(
           CASE WHEN lower(q) = ANY(SELECT lower(a) FROM unnest(p.aliases) a) THEN 1.0 ELSE 0 END,
           CASE WHEN EXISTS (SELECT 1 FROM unnest(p.aliases) a WHERE a ILIKE '%'||q||'%') THEN 0.9 ELSE 0 END,
           CASE WHEN p.name ILIKE '%'||q||'%' THEN 0.8 ELSE 0 END,
           similarity(p.name, q)
         )::REAL AS score
  FROM products p
  WHERE lower(q) = ANY(SELECT lower(a) FROM unnest(p.aliases) a)
     OR EXISTS (SELECT 1 FROM unnest(p.aliases) a WHERE a ILIKE '%'||q||'%')
     OR p.name ILIKE '%'||q||'%'
     OR similarity(p.name, q) > 0.3
  ORDER BY score DESC, p.sort_order
  LIMIT 4;
$$;

-- ---------------------------------------------------------------------------
-- fn_save_customer(...) -> upsert profile
-- COALESCE so a partial update never blanks a field the customer already gave.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_save_customer(
  p_tg_id BIGINT, p_name TEXT DEFAULT NULL, p_phone TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL, p_username TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE c customers%ROWTYPE;
BEGIN
  INSERT INTO customers (tg_id, name, phone, address, tg_username)
  VALUES (p_tg_id, p_name, p_phone, p_address, p_username)
  ON CONFLICT (tg_id) DO UPDATE SET
    name        = COALESCE(NULLIF(EXCLUDED.name,''),    customers.name),
    phone       = COALESCE(NULLIF(EXCLUDED.phone,''),   customers.phone),
    address     = COALESCE(NULLIF(EXCLUDED.address,''), customers.address),
    tg_username = COALESCE(NULLIF(EXCLUDED.tg_username,''), customers.tg_username)
  RETURNING * INTO c;

  RETURN jsonb_build_object('ok', true, 'tg_id', c.tg_id, 'name', c.name,
    'phone', c.phone, 'address', c.address,
    'profile_complete', (c.name IS NOT NULL AND c.phone IS NOT NULL AND c.address IS NOT NULL));
END;
$$;

-- ---------------------------------------------------------------------------
-- fn_create_order(tg_id, items jsonb, note) -> order summary
-- items: [{"name":"Zinger Burger","qty":2}, ...]
-- Resolves every name against products and reads the price from the table.
-- Rejects: unknown item, unavailable item, missing profile, below minimum.
-- Whole thing is one function call = one transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_create_order(p_tg_id BIGINT, p_items JSONB, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  cfg        shop_config%ROWTYPE;
  cust       customers%ROWTYPE;
  it         JSONB;
  m          RECORD;
  v_qty      INTEGER;
  v_sub      INTEGER := 0;
  v_fee      INTEGER;
  v_order_id INTEGER;
  resolved   JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO cfg FROM shop_config WHERE id = 1;
  SELECT * INTO cust FROM customers WHERE tg_id = p_tg_id;

  IF cust.tg_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_profile',
      'message', 'Customer profile missing. Call save_customer with name, phone and address first.');
  END IF;
  IF cust.phone IS NULL OR cust.address IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'incomplete_profile',
      'message', 'Need phone and address before ordering.');
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_cart', 'message', 'Cart is empty.');
  END IF;

  -- resolve every line against the real menu
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(COALESCE((it->>'qty')::INTEGER, 1), 1);

    SELECT f.id, f.name, f.price, f.available INTO m
    FROM fn_check_item(it->>'name') f ORDER BY f.score DESC LIMIT 1;

    IF m.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unknown_item',
        'message', format('"%s" is not on the menu.', it->>'name'));
    END IF;
    IF NOT m.available THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unavailable',
        'message', format('%s is sold out right now.', m.name));
    END IF;

    v_sub := v_sub + (m.price * v_qty);
    resolved := resolved || jsonb_build_object(
      'product_id', m.id, 'name', m.name, 'qty', v_qty,
      'unit_price', m.price, 'line_total', m.price * v_qty);
  END LOOP;

  IF v_sub < cfg.min_order THEN
    RETURN jsonb_build_object('ok', false, 'error', 'below_minimum',
      'message', format('Minimum order is Rs %s. Current subtotal is Rs %s.', cfg.min_order, v_sub),
      'subtotal', v_sub, 'min_order', cfg.min_order);
  END IF;

  v_fee := CASE WHEN v_sub >= cfg.free_delivery_over THEN 0 ELSE cfg.delivery_fee END;

  INSERT INTO orders (customer_tg_id, subtotal, delivery_fee, total,
                      delivery_name, delivery_phone, delivery_address, note)
  VALUES (p_tg_id, v_sub, v_fee, v_sub + v_fee,
          cust.name, cust.phone, cust.address, NULLIF(p_note,''))
  RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, product_id, product_name, qty, unit_price)
  SELECT v_order_id, (r->>'product_id')::INTEGER, r->>'name',
         (r->>'qty')::INTEGER, (r->>'unit_price')::INTEGER
  FROM jsonb_array_elements(resolved) r;

  RETURN jsonb_build_object(
    'ok', true, 'order_id', v_order_id, 'items', resolved,
    'subtotal', v_sub, 'delivery_fee', v_fee, 'total', v_sub + v_fee,
    'eta_minutes', cfg.eta_minutes, 'address', cust.address, 'payment', 'cod');
END;
$$;

-- ---------------------------------------------------------------------------
-- fn_order_status(tg_id, order_id) -> status of one order
-- order_id NULL = that customer's latest. Always filtered by tg_id, so a
-- customer cannot read another customer's order by guessing a number.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_order_status(p_tg_id BIGINT, p_order_id INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE o RECORD;
BEGIN
  SELECT ord.id, ord.status, ord.total, ord.created_at,
         (SELECT string_agg(oi.product_name || ' x' || oi.qty, ', ')
            FROM order_items oi WHERE oi.order_id = ord.id) AS items
  INTO o
  FROM orders ord
  WHERE ord.customer_tg_id = p_tg_id
    AND (p_order_id IS NULL OR ord.id = p_order_id)
  ORDER BY ord.id DESC LIMIT 1;

  IF o.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found',
      'message', 'No order found for you with that number.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', o.id, 'status', o.status,
    'items', o.items, 'total', o.total, 'placed_at', o.created_at);
END;
$$;

-- ---------------------------------------------------------------------------
-- fn_cancel_order(tg_id, order_id) -> only while still cancellable
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cancel_order(p_tg_id BIGINT, p_order_id INTEGER, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE cur_status TEXT;
BEGIN
  SELECT status INTO cur_status FROM orders
   WHERE id = p_order_id AND customer_tg_id = p_tg_id;

  IF cur_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Order not found.');
  END IF;
  IF cur_status NOT IN ('new','preparing') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_late',
      'message', format('Order #%s is already %s and cannot be cancelled.', p_order_id, cur_status));
  END IF;

  UPDATE orders SET status = 'cancelled', cancelled_reason = p_reason WHERE id = p_order_id;
  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION fn_get_menu(), fn_check_item(TEXT),
  fn_save_customer(BIGINT,TEXT,TEXT,TEXT,TEXT), fn_create_order(BIGINT,JSONB,TEXT),
  fn_order_status(BIGINT,INTEGER), fn_cancel_order(BIGINT,INTEGER,TEXT)
  FROM anon, authenticated;
