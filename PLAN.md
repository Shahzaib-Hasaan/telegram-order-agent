# Telegram Order Agent — Master Plan

> End-to-end conversational order-taking system. Customer orders via Telegram in natural language (English/Roman Urdu), AI agent builds the cart, orders land in a database, team manages everything from a live dashboard, customers get status updates back on Telegram.
> Design decision log, kept as a record of why the system is shaped the way it is.

---

## DATABASE DECISION (resolved 2026-08-21)

No VPS with shell access, so self-hosted Postgres next to n8n is off the table.
n8n runs on a managed host we can reach over HTTPS but cannot `docker run` on.

**Chosen: a dedicated Supabase project, region East US (North Virginia).**

Why:
- Public TLS endpoint — n8n (NJ) and Vercel both reach one address, no tunnel, no private network
- ~5-10ms from the n8n box. A Sydney project was created first and scrapped: 200-240ms x 3+ queries per message is ~700ms of dead air on every order
- n8n's Postgres node and the AI Agent's Postgres Chat Memory sub-node both work against it unchanged
- Free tier: 500 MB, plenty. Point-in-time restore included
- Familiar tooling, no new platform to learn

Rejected: self-hosted (no shell), Neon (fine, but a second signup for no gain),
reusing the Hisaab/Journal project (live personal financial data — the order
agent's connection string would also grant read on 655 expense records and 13
user accounts), n8n Data Tables (awkward for relational orders + external dashboard).

**Connection modes** — Supabase free tier's *direct* connection is IPv6-only, so:
- n8n -> **Session pooler**, port 5432
- Vercel dashboard -> **Transaction pooler**, port 6543

**Security:** `public` is auto-exposed over PostgREST with the anon key, which is
public by design. `db/01_schema.sql` enables RLS with zero policies and revokes
anon/authenticated grants, so that door returns nothing. Our connections use the
`postgres` role over raw Postgres and bypass RLS entirely.

## ARCHITECTURE

```
CUSTOMER (Telegram, English/Roman Urdu)
   │ Telegram Trigger (n8n)
   ▼
n8n AI AGENT — Mistral (mistral-small-latest) + Postgres chat memory (per-chat session key)
   │ tools: get_menu · check_item · create_order · order_status · save_customer
   │ inline keyboards for: order confirmation, cancel, payment method (COD v1)
   ▼
SUPABASE POSTGRES (East US / N. Virginia)
   products · customers · orders · order_items · order_status_events
   ▼
TEAM DASHBOARD — Next.js + shadcn on Vercel
   kanban: New → Preparing → On the way → Delivered
   menu CRUD · daily stats (orders, revenue) · 3s polling
   │ status change → n8n webhook
   ▼
CUSTOMER gets Telegram status update ("Order #37 is on the way")
```

Hybrid UX (R&D-validated): agent parses free text ("2 zinger burgers aur aik coke"), inline buttons handle exact moments (confirm/cancel/payment). Both loops close: customer→team AND team→customer.

## DB SCHEMA (v1)

Lives in `db/01_schema.sql` (idempotent). Menu seed in `db/02_seed_menu.sql`.

Five tables: `products`, `customers`, `orders`, `order_items`, `order_status_events`.

Changes from the first sketch, all deliberate:
- `products.aliases TEXT[]` replaces `name_urdu` — one item needs many Roman Urdu
  spellings (`zinger`, `zingr`, `zingar`) for `check_item` to resolve real typing
- `orders` snapshots `delivery_name/phone/address` — editing a profile must not
  rewrite where a past order actually went
- `order_items` snapshots `product_name` and `unit_price` — renaming or delisting
  an item must not corrupt order history
- `orders.subtotal` + `delivery_fee` + `total` split out, since delivery is free over Rs 2,000
- `order_status_events` added — audit trail, and the queue that drives customer
  Telegram pings (`notified` flag). Populated automatically by trigger
- `pg_trgm` GIN index on `products.name` for typo-tolerant matching

## AGENT DESIGN (n8n AI Agent node)

- **LLM:** Mistral `mistral-small-latest` (50k TPM, 262k ctx). Fallback: `ministral-8b-latest` (625k TPM).
  Groq was primary until testing showed an 8,000 TPM ceiling — roughly one customer message per minute
  once tool schemas + memory are resent each round-trip. Mistral gives 6x that. Costs ~1s latency vs
  Groq's 0.31s, which no Telegram user will notice.
- **Memory:** Postgres Chat Memory sub-node, session key = Telegram chat_id, window ~10 turns.
- **Tools (n8n sub-workflow tools):**
  1. `get_menu` — available products grouped by category
  2. `check_item(name)` — fuzzy match an item, return price/availability
  3. `create_order(items[], note)` — writes order + items in a transaction, returns order #
  4. `order_status(order_id | latest)` — status lookup for this customer
  5. `save_customer(name, phone, address)` — upsert profile so repeat customers skip the form
- **System prompt core rules:** confirm the full cart with total BEFORE creating any order (inline Confirm/Cancel buttons, never free-text confirmation); collect phone + address on first order, reuse afterwards; answer menu questions from get_menu only, never invent items or prices; understand Roman Urdu; short friendly replies; on any tool failure apologize and offer retry (fallback religion).
- **Safety:** the agent can only call these 5 tools. No raw SQL, no sends outside this chat.

## DASHBOARD (Next.js, phase 2)

- `/orders` — kanban by status, click-through detail, one-tap status advance (each change fires the n8n status webhook → customer Telegram message)
- `/menu` — product CRUD, availability toggle
- `/` — today: order count, revenue, pending count
- Auth v1: single shared password (env var). It is a team tool, not public.
- Stack: Next.js 15 + shadcn + SWR (3s refetch) + pg. Deploy Vercel; DB reachable via connection string.

## BUILD PHASES

1. **Phase 1 (today):** Supabase project (East US) → schema + seeded demo menu → n8n workflow JSON (trigger → agent → tools → confirm buttons → DB write → confirmation msg). Deliverable: full order placed via Telegram, row visible in DB.
2. **Phase 2:** dashboard (kanban, CRUD, stats) + status-change webhook → customer notifications. Deliverable: full both-direction loop.
3. **Phase 3:** polish + demo video (split screen: phone ordering in Roman Urdu | dashboard updating live) + LinkedIn post(s).
4. **v2 backlog:** payment-screenshot verification (PK transfer flow), multi-shop white-label config, order editing, daily owner digest.

## DEMO BRANDING

**Tandoor & Bun** — Gulberg III, Lahore. Charcoal tandoor BBQ and desi karahi on
one side, smash burgers on the other. Full brand sheet, operating rules and agent
constraints in `RESTAURANT.md`; menu in `db/02_seed_menu.sql`.

Prices anchored to real 2026 Lahore market rates (KFC Zinger Rs 600 / Mighty
Zinger Rs 770; independents run 10-20% under). 26 items, Rs 40 to Rs 2,700.
Delivery Rs 120, free over Rs 2,000, minimum order Rs 500.

White-label underneath: swap `RESTAURANT.md` + the `products` rows and the same
system runs any other shop.

## CREDENTIALS

Kept in `CREDENTIALS.md` (local only, gitignored, NEVER committed):
- n8n instance URL + API key
- Telegram bot token (from @BotFather)
- Mistral API key (primary LLM)
- Supabase Session pooler connection string (n8n)
- Supabase Transaction pooler connection string (Vercel, phase 2)
