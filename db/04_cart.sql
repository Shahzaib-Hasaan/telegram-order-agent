-- Tandoor & Bun — staged carts (the inline Confirm/Cancel flow)
--
-- Why this table exists: the agent must NEVER create an order off a free-text
-- "haan". It stages a priced cart, Telegram shows Confirm/Cancel buttons, and
-- only the button tap turns the cart into an order. The button carries the
-- cart id, so what the customer confirms is exactly what they were shown —
-- the model gets no second chance to re-interpret the order.

CREATE TABLE IF NOT EXISTS pending_carts (
  id             SERIAL PRIMARY KEY,
  customer_tg_id BIGINT  NOT NULL REFERENCES customers(tg_id),
  items          JSONB   NOT NULL,          -- already resolved + priced
  subtotal       INTEGER NOT NULL,
  delivery_fee   INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  note           TEXT,
  status         TEXT    NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','cancelled','superseded')),
  order_id       INTEGER REFERENCES orders(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE pending_carts ADD COLUMN IF NOT EXISTS summary TEXT;
CREATE INDEX IF NOT EXISTS idx_carts_customer ON pending_carts(customer_tg_id, status);
ALTER TABLE pending_carts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pending_carts FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- fn_stage_cart(tg_id, items, note) -> priced cart + ready-to-send summary
-- Same validation as fn_create_order, but writes nothing to orders.
-- Any older pending cart for this customer is superseded, so a stale button
-- from three messages ago cannot be tapped into an order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_stage_cart(p_tg_id BIGINT, p_items JSONB, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  cfg      shop_config%ROWTYPE;
  cust     customers%ROWTYPE;
  it       JSONB;
  m        RECORD;
  v_qty    INTEGER;
  v_sub    INTEGER := 0;
  v_fee    INTEGER;
  v_cart   INTEGER;
  resolved JSONB := '[]'::JSONB;
  lines    TEXT   := '';
BEGIN
  SELECT * INTO cfg  FROM shop_config WHERE id = 1;
  SELECT * INTO cust FROM customers   WHERE tg_id = p_tg_id;

  IF cust.tg_id IS NULL OR cust.phone IS NULL OR cust.address IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'incomplete_profile',
      'message', 'Need name, phone and address before I can place the order.',
      'have_name',    (cust.name    IS NOT NULL),
      'have_phone',   (cust.phone   IS NOT NULL),
      'have_address', (cust.address IS NOT NULL));
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_cart', 'message', 'Cart is empty.');
  END IF;

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
    lines := lines || format(E'%s x%s — Rs %s\n', m.name, v_qty, m.price * v_qty);
  END LOOP;

  IF v_sub < cfg.min_order THEN
    RETURN jsonb_build_object('ok', false, 'error', 'below_minimum',
      'message', format('Minimum order is Rs %s. This cart is Rs %s.', cfg.min_order, v_sub),
      'subtotal', v_sub, 'min_order', cfg.min_order);
  END IF;

  v_fee := CASE WHEN v_sub >= cfg.free_delivery_over THEN 0 ELSE cfg.delivery_fee END;

  UPDATE pending_carts SET status = 'superseded'
   WHERE customer_tg_id = p_tg_id AND status = 'pending';

  lines := lines || format(
    E'\nSubtotal: Rs %s\nDelivery: Rs %s\n*Total: Rs %s*\n\n📍 %s\n📞 %s\n⏱ %s min • Cash on delivery',
    v_sub, v_fee, v_sub + v_fee, cust.address, cust.phone, cfg.eta_minutes);

  INSERT INTO pending_carts (customer_tg_id, items, subtotal, delivery_fee, total, note, summary)
  VALUES (p_tg_id, resolved, v_sub, v_fee, v_sub + v_fee, NULLIF(p_note,''), lines)
  RETURNING id INTO v_cart;

  RETURN jsonb_build_object(
    'ok', true, 'cart_id', v_cart, 'items', resolved,
    'subtotal', v_sub, 'delivery_fee', v_fee, 'total', v_sub + v_fee,
    'summary', lines);
END;
$$;

-- ---------------------------------------------------------------------------
-- fn_confirm_cart(tg_id, cart_id) -> real order
-- Inserts straight from the stored resolved items. No re-pricing, no re-parsing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_confirm_cart(p_tg_id BIGINT, p_cart_id INTEGER)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  cart  pending_carts%ROWTYPE;
  cust  customers%ROWTYPE;
  cfg   shop_config%ROWTYPE;
  v_oid INTEGER;
BEGIN
  SELECT * INTO cart FROM pending_carts
   WHERE id = p_cart_id AND customer_tg_id = p_tg_id;

  IF cart.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found',
      'message', 'That cart is not yours or no longer exists.');
  END IF;
  IF cart.status = 'confirmed' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'order_id', cart.order_id,
      'message', format('Order #%s is already placed.', cart.order_id));
  END IF;
  IF cart.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale',
      'message', 'That cart expired. Tell me what you would like and I will rebuild it.');
  END IF;

  SELECT * INTO cust FROM customers   WHERE tg_id = p_tg_id;
  SELECT * INTO cfg  FROM shop_config WHERE id = 1;

  INSERT INTO orders (customer_tg_id, subtotal, delivery_fee, total,
                      delivery_name, delivery_phone, delivery_address, note)
  VALUES (p_tg_id, cart.subtotal, cart.delivery_fee, cart.total,
          cust.name, cust.phone, cust.address, cart.note)
  RETURNING id INTO v_oid;

  INSERT INTO order_items (order_id, product_id, product_name, qty, unit_price)
  SELECT v_oid, (r->>'product_id')::INTEGER, r->>'name',
         (r->>'qty')::INTEGER, (r->>'unit_price')::INTEGER
  FROM jsonb_array_elements(cart.items) r;

  UPDATE pending_carts SET status = 'confirmed', order_id = v_oid WHERE id = cart.id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_oid, 'total', cart.total,
    'eta_minutes', cfg.eta_minutes, 'address', cust.address);
END;
$$;

-- ---------------------------------------------------------------------------
-- fn_cancel_cart(tg_id, cart_id)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cancel_cart(p_tg_id BIGINT, p_cart_id INTEGER)
RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pending_carts SET status = 'cancelled'
   WHERE id = p_cart_id AND customer_tg_id = p_tg_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Nothing to cancel.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'message', 'Cart cancelled.');
END;
$$;

REVOKE ALL ON FUNCTION fn_stage_cart(BIGINT,JSONB,TEXT), fn_confirm_cart(BIGINT,INTEGER),
  fn_cancel_cart(BIGINT,INTEGER) FROM anon, authenticated;
