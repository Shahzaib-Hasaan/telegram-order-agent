-- Tandoor & Bun — fixes from the first live order (order #1, 2026-08-21)
--
-- What went wrong in production:
--   1. Customer typed only an address. The agent invented name='Abdul Haque'
--      (the street) and phone='284' (the house number) to satisfy stage_order's
--      profile requirement. A prompt rule alone will not stop that under pressure,
--      so phone is now validated in SQL.
--   2. fn_get_menu returned one comma-run per category, so the model reformatted
--      it freely and renamed items ("Zinger Burger" -> "Zinger"). Now it returns
--      display-ready text the model is told to pass through verbatim.
--   3. The cart printed twice — once by the model, once from summary.

-- ---------------------------------------------------------------------------
-- 1. fn_get_menu — display-ready, one item per line, real names
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_get_menu()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT string_agg(block, E'\n\n' ORDER BY o)
  FROM (
    SELECT
      CASE category
        WHEN 'Burgers'  THEN '🍔 BURGERS'
        WHEN 'Desi'     THEN '🍛 DESI'
        WHEN 'BBQ'      THEN '🔥 BBQ'
        WHEN 'Sides'    THEN '🍟 SIDES'
        WHEN 'Breads'   THEN '🥖 BREADS'
        WHEN 'Drinks'   THEN '🥤 DRINKS'
        WHEN 'Desserts' THEN '🍮 DESSERTS'
        ELSE upper(category)
      END
      || E'\n'
      || string_agg('  ' || name || ' — Rs ' || price, E'\n' ORDER BY sort_order) AS block,
      MIN(sort_order) AS o
    FROM products
    WHERE available
    GROUP BY category
  ) t;
$$;

-- ---------------------------------------------------------------------------
-- 2. fn_save_customer — validate phone, never accept junk
-- A Pakistani mobile is 11 digits starting 03, or +92/92 followed by 3XXXXXXXXX.
-- Landlines are 9-11 digits with an area code. Anything under 10 digits after
-- stripping separators is not a phone number — reject it and say so, so the
-- agent has to go back and actually ask the customer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_save_customer(
  p_tg_id BIGINT, p_name TEXT DEFAULT NULL, p_phone TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL, p_username TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  c      customers%ROWTYPE;
  digits TEXT;
BEGIN
  IF p_phone IS NOT NULL AND p_phone <> '' THEN
    digits := regexp_replace(p_phone, '\D', '', 'g');
    IF length(digits) < 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'bad_phone',
        'message', format('"%s" is not a valid phone number. Ask the customer for their '
                          || 'full mobile number, e.g. 0300-1234567. Do NOT take digits '
                          || 'out of their address.', p_phone));
    END IF;
    IF length(digits) > 13 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'bad_phone',
        'message', 'That phone number has too many digits. Ask the customer to repeat it.');
    END IF;
  END IF;

  IF p_name IS NOT NULL AND p_name <> '' AND length(trim(p_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_name',
      'message', 'That name looks wrong. Ask the customer for their name.');
  END IF;

  INSERT INTO customers (tg_id, name, phone, address, tg_username)
  VALUES (p_tg_id, NULLIF(trim(coalesce(p_name,'')),''),
                   NULLIF(trim(coalesce(p_phone,'')),''),
                   NULLIF(trim(coalesce(p_address,'')),''),
                   NULLIF(trim(coalesce(p_username,'')),''))
  ON CONFLICT (tg_id) DO UPDATE SET
    name        = COALESCE(NULLIF(trim(coalesce(EXCLUDED.name,'')),''),    customers.name),
    phone       = COALESCE(NULLIF(trim(coalesce(EXCLUDED.phone,'')),''),   customers.phone),
    address     = COALESCE(NULLIF(trim(coalesce(EXCLUDED.address,'')),''), customers.address),
    tg_username = COALESCE(NULLIF(trim(coalesce(EXCLUDED.tg_username,'')),''), customers.tg_username)
  RETURNING * INTO c;

  RETURN jsonb_build_object('ok', true, 'tg_id', c.tg_id, 'name', c.name,
    'phone', c.phone, 'address', c.address,
    'missing', (CASE WHEN c.name    IS NULL THEN 'name '    ELSE '' END ||
                CASE WHEN c.phone   IS NULL THEN 'phone '   ELSE '' END ||
                CASE WHEN c.address IS NULL THEN 'address'  ELSE '' END),
    'profile_complete', (c.name IS NOT NULL AND c.phone IS NOT NULL AND c.address IS NOT NULL));
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. fn_stage_cart — self-contained summary with its own header
-- The Telegram node now sends ONLY this text, so the model can no longer
-- duplicate the cart by writing its own copy above it.
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

  IF cust.tg_id IS NULL OR cust.name IS NULL OR cust.phone IS NULL OR cust.address IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'incomplete_profile',
      'message', 'Cannot place the order yet. Ask the customer for whatever is still missing, '
                 || 'one thing at a time, and save it. Never guess these from the address.',
      'missing', (CASE WHEN cust.name    IS NULL THEN 'name '   ELSE '' END ||
                  CASE WHEN cust.phone   IS NULL THEN 'phone '  ELSE '' END ||
                  CASE WHEN cust.address IS NULL THEN 'address' ELSE '' END));
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
    lines := lines || format(E'  %s x%s — Rs %s\n', m.name, v_qty, m.price * v_qty);
  END LOOP;

  IF v_sub < cfg.min_order THEN
    RETURN jsonb_build_object('ok', false, 'error', 'below_minimum',
      'message', format('Minimum order is Rs %s. This cart is Rs %s.', cfg.min_order, v_sub),
      'subtotal', v_sub, 'min_order', cfg.min_order);
  END IF;

  v_fee := CASE WHEN v_sub >= cfg.free_delivery_over THEN 0 ELSE cfg.delivery_fee END;

  UPDATE pending_carts SET status = 'superseded'
   WHERE customer_tg_id = p_tg_id AND status = 'pending';

  -- The summary is sent with parse_mode=Markdown, and name/phone/address are
  -- customer-typed. A stray * _ ` [ ] would make Telegram reject the whole
  -- message, so strip those from the user-supplied parts only.
  lines := E'🛒 *Order confirm karein*\n\n' || lines
    || format(E'\nSubtotal:  Rs %s\nDelivery:  Rs %s\n*Total:     Rs %s*\n\n👤 %s\n📞 %s\n📍 %s\n⏱ %s min • Cash on delivery\n\nTap ✅ Confirm to place it.',
              v_sub, v_fee, v_sub + v_fee,
              regexp_replace(cust.name,    '[*_`\[\]]', '', 'g'),
              regexp_replace(cust.phone,   '[*_`\[\]]', '', 'g'),
              regexp_replace(cust.address, '[*_`\[\]]', '', 'g'),
              cfg.eta_minutes);

  INSERT INTO pending_carts (customer_tg_id, items, subtotal, delivery_fee, total, note, summary)
  VALUES (p_tg_id, resolved, v_sub, v_fee, v_sub + v_fee, NULLIF(p_note,''), lines)
  RETURNING id INTO v_cart;

  RETURN jsonb_build_object(
    'ok', true, 'cart_id', v_cart, 'items', resolved,
    'subtotal', v_sub, 'delivery_fee', v_fee, 'total', v_sub + v_fee,
    'note_to_agent', 'Cart is staged and the itemised summary has ALREADY been sent to the '
                     || 'customer with Confirm/Cancel buttons. Reply with ONE short line only. '
                     || 'Do NOT repeat the items, prices or total.');
END;
$$;
