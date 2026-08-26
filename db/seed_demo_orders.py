"""Fill the board with demo tickets spread across the heat ramp.

Ages are chosen so every band is represented — teal, amber, ember, red — which
is what you want on screen for a demo video. Run with --clear to remove them.
Demo customers use tg_id 7000000xx so they never collide with real Telegram ids.
"""
import io, re, json, os, sys, psycopg2

DB_URL = os.environ.get('DATABASE_URL', '').strip()
if not DB_URL:
    sys.exit(
        'Missing DATABASE_URL\n\n'
        '  Your Postgres connection string, e.g.\n'
        '  postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require\n\n'
        '  export DATABASE_URL="..."      # macOS / Linux\n'
        '  $env:DATABASE_URL = "..."      # Windows PowerShell\n'
    )

c = psycopg2.connect(DB_URL, connect_timeout=30); c.autocommit = True; cur = c.cursor()

PEOPLE = [(700000001,'Ayesha Tariq','03001112233','21-B Model Town, Lahore'),
          (700000002,'Bilal Ahmed','03214445566','House 9, Johar Town Blk C'),
          (700000003,'Hina Sheikh','03337778899','44 Garden Town, Lahore'),
          (700000004,'Usman Raza','03459990011','12 DHA Phase 4, Lahore'),
          (700000005,'Zara Malik','03012223344','7-C Gulberg III, Lahore')]

if '--clear' in sys.argv:
    ids = tuple(p[0] for p in PEOPLE)
    cur.execute("DELETE FROM pending_carts WHERE customer_tg_id IN %s", (ids,))
    cur.execute("DELETE FROM orders        WHERE customer_tg_id IN %s", (ids,))
    cur.execute("DELETE FROM customers     WHERE tg_id          IN %s", (ids,))
    cur.execute("SELECT count(*) FROM orders")
    print('demo cleared — orders remaining:', cur.fetchone()[0])
    raise SystemExit

for tg, n, p, a in PEOPLE:
    cur.execute("SELECT fn_save_customer(%s,%s,%s,%s,'demo')", (tg, n, p, a))

# (tg, items, status, minutes_ago)
DEMO = [(700000001,[("Zinger Burger",2),("Soft Drink 345ml",1)],'new',3),
        (700000002,[("Chicken Biryani",2),("Raita",1),("Garlic Naan",2)],'new',26),
        (700000003,[("BBQ Platter",1),("Sweet Lassi",2)],'preparing',14),
        (700000004,[("Chicken Karahi (Half)",1),("Garlic Naan",4)],'preparing',39),
        (700000005,[("Mighty Zinger",1),("Loaded Fries",1),("Kheer",2)],'on_the_way',52),
        (700000001,[("Seekh Kabab (4 pc)",2),("Roghni Naan",3)],'on_the_way',31),
        (700000003,[("Beef Biryani",1),("Mineral Water",2)],'delivered',95)]

for tg, items, st, mins in DEMO:
    cur.execute("SELECT fn_stage_cart(%s,%s::jsonb,%s)", (tg,
        json.dumps([{"name": n, "qty": q} for n, q in items]),
        'extra spicy' if mins == 26 else None))
    r = cur.fetchone()[0]
    if not r.get('ok'):
        print('skipped:', r); continue
    cur.execute("SELECT fn_confirm_cart(%s,%s)", (tg, r['cart_id']))
    oid = cur.fetchone()[0]['order_id']
    cur.execute("UPDATE orders SET created_at = now() - (%s||' minutes')::interval,"
                " updated_at = now() - (%s||' minutes')::interval, status = %s WHERE id = %s",
                (mins, mins, st, oid))

cur.execute("SELECT status, count(*) FROM orders GROUP BY status ORDER BY 1")
print('seeded:', cur.fetchall())
