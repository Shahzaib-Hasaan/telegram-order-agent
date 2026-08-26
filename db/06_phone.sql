-- Tandoor & Bun — strict Pakistani mobile handling
--
-- Requirement: collect an 11-digit Pakistani mobile (03XXXXXXXXX) and remember
-- it for the same customer.
--
-- Remembering is already handled: `customers` is keyed on tg_id, which Telegram
-- guarantees is stable per person, and it is passed from the trigger — never
-- from the model. So a returning customer is recognised automatically.
--
-- What was missing was the format check. The old rule was "10 to 13 digits",
-- which would have accepted a landline, a CNIC fragment, or a random 10-digit
-- number. Now only a real PK mobile passes, and it is normalised on the way in
-- so the same person can type it five different ways and we store one value.

-- ---------------------------------------------------------------------------
-- fn_normalize_pk_mobile(text) -> '03XXXXXXXXX', or NULL if it is not one
-- Accepts:  0300-1234567 · 03001234567 · +92 300 1234567 · 0092 300 1234567
--           92 300 1234567 · 300 1234567 · 3001234567
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_normalize_pk_mobile(p_raw TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d TEXT;
BEGIN
  IF p_raw IS NULL OR trim(p_raw) = '' THEN RETURN NULL; END IF;

  d := regexp_replace(p_raw, '\D', '', 'g');   -- digits only

  IF    d ~ '^0092[3][0-9]{9}$' THEN d := '0' || substring(d from 5);   -- 0092 3xx…
  ELSIF d ~ '^92[3][0-9]{9}$'   THEN d := '0' || substring(d from 3);   -- 92 3xx…
  ELSIF d ~ '^[3][0-9]{9}$'     THEN d := '0' || d;                     -- 3xx… (no 0)
  END IF;

  -- canonical form: 03 + 9 digits = 11 total
  IF d ~ '^03[0-9]{9}$' THEN RETURN d; END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- fn_fmt_phone('03001234567') -> '0300-1234567'   (display only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fmt_phone(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p ~ '^03[0-9]{9}$'
              THEN substring(p from 1 for 4) || '-' || substring(p from 5)
              ELSE p END;
$$;

-- backfill anything already stored in a non-canonical form
UPDATE customers
   SET phone = fn_normalize_pk_mobile(phone)
 WHERE phone IS NOT NULL
   AND fn_normalize_pk_mobile(phone) IS NOT NULL
   AND phone <> fn_normalize_pk_mobile(phone);

-- drop values that were never valid phone numbers (e.g. '284' from order #1)
UPDATE customers SET phone = NULL
 WHERE phone IS NOT NULL AND fn_normalize_pk_mobile(phone) IS NULL;

-- ---------------------------------------------------------------------------
-- fn_save_customer — normalise + reject anything that is not a PK mobile
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_save_customer(
  p_tg_id BIGINT, p_name TEXT DEFAULT NULL, p_phone TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL, p_username TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  c      customers%ROWTYPE;
  v_norm TEXT;
BEGIN
  IF p_phone IS NOT NULL AND trim(p_phone) <> '' THEN
    v_norm := fn_normalize_pk_mobile(p_phone);
    IF v_norm IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'bad_phone',
        'message', format('"%s" is not a valid Pakistani mobile number. It must be 11 digits '
                          || 'starting with 03, like 0300-1234567. Ask the customer for their '
                          || 'mobile number. Do NOT take digits out of their address.', p_phone));
    END IF;
  END IF;

  IF p_name IS NOT NULL AND trim(p_name) <> '' AND length(trim(p_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_name',
      'message', 'That name looks wrong. Ask the customer for their name.');
  END IF;

  INSERT INTO customers (tg_id, name, phone, address, tg_username)
  VALUES (p_tg_id, NULLIF(trim(coalesce(p_name,'')),''), v_norm,
                   NULLIF(trim(coalesce(p_address,'')),''),
                   NULLIF(trim(coalesce(p_username,'')),''))
  ON CONFLICT (tg_id) DO UPDATE SET
    name        = COALESCE(NULLIF(trim(coalesce(EXCLUDED.name,'')),''),    customers.name),
    phone       = COALESCE(EXCLUDED.phone,                                 customers.phone),
    address     = COALESCE(NULLIF(trim(coalesce(EXCLUDED.address,'')),''), customers.address),
    tg_username = COALESCE(NULLIF(trim(coalesce(EXCLUDED.tg_username,'')),''), customers.tg_username)
  RETURNING * INTO c;

  RETURN jsonb_build_object('ok', true, 'tg_id', c.tg_id, 'name', c.name,
    'phone', fn_fmt_phone(c.phone), 'address', c.address,
    'missing', trim(CASE WHEN c.name    IS NULL THEN 'name '    ELSE '' END ||
                    CASE WHEN c.phone   IS NULL THEN 'phone '   ELSE '' END ||
                    CASE WHEN c.address IS NULL THEN 'address'  ELSE '' END),
    'profile_complete', (c.name IS NOT NULL AND c.phone IS NOT NULL AND c.address IS NOT NULL));
END;
$$;

-- ---------------------------------------------------------------------------
-- fn_get_profile(tg_id) — what we already know about a returning customer
-- Replaces the raw SELECT the tool node used, so the agent gets an explicit
-- returning-customer signal instead of having to infer it from empty columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_get_profile(p_tg_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE c customers%ROWTYPE; n INTEGER;
BEGIN
  SELECT * INTO c FROM customers WHERE tg_id = p_tg_id;
  IF c.tg_id IS NULL THEN
    RETURN jsonb_build_object('known', false, 'missing', 'name phone address',
      'message', 'New customer. You will need their name, mobile number and address.');
  END IF;
  SELECT count(*) INTO n FROM orders WHERE customer_tg_id = p_tg_id AND status <> 'cancelled';
  RETURN jsonb_build_object('known', true, 'name', c.name,
    'phone', fn_fmt_phone(c.phone), 'address', c.address, 'past_orders', n,
    'missing', trim(CASE WHEN c.name    IS NULL THEN 'name '   ELSE '' END ||
                    CASE WHEN c.phone   IS NULL THEN 'phone '  ELSE '' END ||
                    CASE WHEN c.address IS NULL THEN 'address' ELSE '' END),
    'profile_complete', (c.name IS NOT NULL AND c.phone IS NOT NULL AND c.address IS NOT NULL));
END;
$$;

-- ---------------------------------------------------------------------------
-- show the stored phone in the cart using the pretty form
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
      'missing', trim(CASE WHEN cust.name    IS NULL THEN 'name '   ELSE '' END ||
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

  lines := E'🛒 *Order confirm karein*\n\n' || lines
    || format(E'\nSubtotal:  Rs %s\nDelivery:  Rs %s\n*Total:     Rs %s*\n\n👤 %s\n📞 %s\n📍 %s\n⏱ %s min • Cash on delivery\n\nTap ✅ Confirm to place it.',
              v_sub, v_fee, v_sub + v_fee,
              regexp_replace(cust.name, '[*_`\[\]]', '', 'g'),
              fn_fmt_phone(cust.phone),
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

REVOKE ALL ON FUNCTION fn_normalize_pk_mobile(TEXT), fn_fmt_phone(TEXT),
  fn_get_profile(BIGINT) FROM anon, authenticated;
