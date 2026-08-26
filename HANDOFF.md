# Tandoor & Bun — System Handoff

Plain-English description of what this system does, how it behaves, and how it is
put together. No prior knowledge of the codebase assumed.

Last updated 2026-08-21.

---

## 1. What this is, in one paragraph

A restaurant takes orders through a Telegram chatbot. The customer types normally
— in English, Roman Urdu, or a mix — and an AI assistant works out what they
want, checks it against the real menu, collects their delivery details, and shows
them a cart to confirm with a button. The order lands in a database. The kitchen
staff see it appear on a live board on a screen, and move it along with one tap
as it gets cooked and delivered. Every time they tap, the customer automatically
gets a message on Telegram telling them what is happening.

Two people are served by this system and they never talk to each other directly:
the **customer**, who only ever sees Telegram, and the **kitchen**, who only ever
sees the board.

The demo restaurant is **Tandoor & Bun**, 12-C Main Boulevard, Gulberg III,
Lahore. It is fictional. Everything about it — the name, the menu, the prices,
the delivery rules — is configuration, so the same system runs any other shop by
swapping those values.

---

## 2. What the customer experiences

The customer opens Telegram and messages the bot (your own, created via
@BotFather — see the README setup guide).

**They say hello.** The bot greets them in one line and offers the menu. It
replies in whatever language they wrote in — Roman Urdu in, Roman Urdu out.

**They ask for the menu.** They get the full list, grouped by category with real
prices, exactly as it exists in the database. The bot cannot shorten item names
or make prices up.

**They order in their own words.** Something like *"Ek zinger, ek loaded fries or
ek mineral water krdo"*. The bot works out that this means three specific menu
items and the quantity of each.

**It asks for anything it does not know about them** — their name, then their
phone number, then their address, one at a time. It never asks for something it
already has.

**It shows them the cart.** An itemised list with each line total, the subtotal,
the delivery fee, the grand total, and their delivery details, followed by two
buttons: **✅ Confirm** and **❌ Cancel**.

**They tap Confirm.** The order is created and they get an order number, the
total, the address and the delivery time.

**They get told what is happening**, without asking:
- when the kitchen starts cooking
- when the rider leaves, with the address and the amount to pay
- when it is delivered
- if it gets cancelled

**They can ask anything at any point** — *"Kia status h?"*, *"Zinger kitne ka
hai?"*, *"Mera order cancel kar do"* — and the bot answers from live data.

---

## 3. What the kitchen experiences

Staff open the board in a browser and sign in with one shared team password.

**The board** shows three columns — **New**, **Cooking**, **Out** — and every
live order sits in one of them. Orders that are finished leave the board.

**A new order announces itself.** A chime plays and the ticket flashes as it
lands. The chime can be switched off.

**Each ticket shows** the order number, the items and quantities, each line
price, the total, any special instruction the customer added, and how long the
order has been alive. Tapping "Customer" reveals the name, phone (tappable to
call), address and delivery fee.

**Every ticket has a coloured bar down its left edge.** It fills upward as the
order ages and changes colour: green while on time, yellow past halfway, orange
running late, red past the promised 45 minutes. Across a room you can see which
orders are in trouble without reading anything.

**The header shows the one number that matters** — the age of the oldest open
order — plus how many are past the promise, today's order count and today's
takings.

**One tap moves an order on.** `Start cooking` → `Hand to rider` → `Mark
delivered`. Each tap messages the customer automatically.

**Mistakes are recoverable.** After a tap, a message appears with an **Undo**
button for two minutes.

**When it gets busy**, the board automatically switches from big cards to
compact rows so about twenty orders fit per column instead of four. There is a
manual toggle too.

**Other screens:**
- **Menu** — add items, change prices inline, mark things sold out, remove items
- **History** — every finished order, searchable by order number, phone, customer
  name or item, 50 at a time
- **Theme** — light, dark, or follow the computer's setting

---

## 4. Every feature, listed

### Understanding what people type

| Feature | What it does |
|---|---|
| Roman Urdu and English | Replies in whichever the customer used, or a mix |
| Nicknames and typos | Each menu item carries a list of alternative spellings. `zingr`, `zingar`, `singer burger` all find the Zinger Burger |
| Local words | `thanda` finds a soft drink, `paani` finds water, `adha karahi` finds the half karahi, `dahi` finds raita |
| Fuzzy matching | Even spellings nobody listed can match, using text-similarity search in the database |
| Ambiguity handling | `biryani` returns both Chicken and Beef, so the bot asks which one |
| Unknown items | `sushi hai?` gets a plain "not on the menu" plus a suggestion of something that is |

### Remembering the customer

This is keyed to the customer's Telegram account, which Telegram guarantees is
unique and stable per person. It comes from Telegram itself, never from the AI,
so it cannot be faked or mixed up between chats.

| Feature | What it does |
|---|---|
| Name, phone, address stored | Saved the first time, reused forever after |
| Repeat customers are not re-asked | On the next order the bot reads back the saved address and just asks "yehi address theek hai?" |
| Partial memory | If it only knows the name, it asks only for the phone and address |
| Updating details | A new address given later replaces the old one |
| Nothing gets wiped | A blank answer never overwrites something already saved |
| Order count | The bot knows how many times this person has ordered before |
| Conversation memory | The last ~10 messages of the chat are remembered, so "make it two instead" works |

### Phone numbers

| Feature | What it does |
|---|---|
| Pakistani mobiles only | Must be 11 digits starting `03` |
| Any format accepted | `0300-1234567`, `03001234567`, `+92 300 1234567`, `0092 300 1234567`, `3001234567`, `(0300) 1234567` all work |
| Stored one way | Everything is converted to `03001234567` so the same person is never stored twice |
| Displayed nicely | Shown as `0300-1234567` |
| Junk rejected | House numbers, landlines, too-short and too-long numbers are all refused, and the bot is told to go back and ask properly |

> This exists because of a real failure. On the very first live order the
> customer sent only an address — a house number followed by a street name —
> and the AI, needing a name and phone to proceed, invented them by slicing the
> address apart: it took the street as the person's name and the house number as
> the phone. The rule is now enforced by the database, not by asking the AI
> nicely.

### Addresses

| Feature | What it does |
|---|---|
| Asked for separately | Never extracted from anything else |
| Delivery area | Gulberg, Model Town, Johar Town, Garden Town, DHA Phase 1–5. Outside those, the bot apologises and offers pickup |
| Frozen onto the order | Each order keeps its own copy of the address, so editing a profile never rewrites where a past order actually went |
| Safe to display | Characters that would break Telegram's formatting are stripped before sending |

### Building and placing an order

| Feature | What it does |
|---|---|
| Prices come from the database | The AI is never trusted with a price. It sends item names and quantities; the database looks up what they cost |
| Minimum order Rs 500 | Enforced in the database. Under that, the order is refused with an explanation |
| Delivery fee Rs 120 | Automatically waived when the subtotal reaches Rs 2,000 |
| Sold-out items | Refused with the item named |
| Special instructions | "extra spicy" and similar are attached to the order and shown to the kitchen in yellow |
| Confirmation by button only | Typing "haan", "yes", "ok" or "confirm" never places an order. Only the button does |
| The cart is stored before confirming | What the customer taps Confirm on is exactly what they were shown — the AI gets no second chance to reinterpret it |
| Old buttons die | Building a new cart kills the previous one, so a stale button from earlier in the chat cannot be tapped into an order |
| Double-tap is safe | Tapping Confirm twice gives "already placed", not two orders |
| Buttons are per-customer | Someone else's button cannot be used, even with the right order number |

### After the order

| Feature | What it does |
|---|---|
| Status on request | "Kia status h?" answers from live data |
| Own orders only | A customer can only ever see their own orders, even if they guess another number |
| Customer cancellation | Allowed while the order is New or Cooking; refused with a reason once it is out for delivery |
| Automatic updates | A message on every status change, without the customer asking |
| Full audit trail | Every status change is recorded with time, from-status and to-status |

### The kitchen board

| Feature | What it does |
|---|---|
| Live updates | Refreshes every 3 seconds |
| Sound on arrival | A two-note chime, on by default, can be muted |
| Urgency colour bar | Green → yellow → orange → red as an order ages against the 45-minute promise |
| Oldest-order headline | The age of the longest-waiting order, in large type |
| Late counter | How many orders are past the promise |
| One-tap advance | Moves the order and messages the customer |
| Instant response | The ticket moves the moment you tap; it does not wait for the server |
| Undo | Two minutes to take back a mis-tap |
| Cancel with confirmation | Two-step, so it cannot be hit by accident |
| Automatic density | Switches to compact rows when a column gets busy |
| Cannot skip steps | An order cannot jump from New to Delivered, even from a stale browser tab |
| Two people, one winner | If two staff tap the same ticket at once, only one move takes effect |
| Today's numbers | Order count and takings, counted on Pakistan time so a 1am order belongs to the night shift |
| Light and dark | Follows the computer's setting, or force either |

### Menu management

| Feature | What it does |
|---|---|
| Add items | Name, price, category, and the spellings the bot should listen for |
| Change prices | Click the price, type, press Enter |
| Sell out / restock | One click. Sold-out items are instantly refused by the bot |
| Remove items | Two-step confirm. Past orders are unaffected — they keep their own copy of the name and price |
| Search | By name, category, or by the alternative spellings |

### History

| Feature | What it does |
|---|---|
| Finished orders | Delivered and cancelled, newest first |
| Search | Order number, phone, customer name, or item |
| Filter | All, delivered only, or cancelled only |
| Paging | 50 at a time, and page 40 is as fast as page 1 |

---

## 5. How it is put together

Five pieces. Only the middle one holds anything permanently.

```
   CUSTOMER                                          KITCHEN
   Telegram app                                      web browser
        |                                                 |
        v                                                 v
 ┌──────────────┐    ┌──────────────────┐    ┌────────────────────┐
 │  ORDER AGENT │    │     DATABASE     │    │   TANDOOR PASS     │
 │  (n8n, USA)  │<-->│ (Supabase, USA)  │<-->│ (Next.js dashboard)│
 └──────────────┘    └──────────────────┘    └────────────────────┘
        ^                     ^
        |                     |
        |            ┌────────────────────┐
        └────────────│  STATUS NOTIFIER   │
                     │    (n8n, USA)      │
                     └────────────────────┘
```

**1. The Order Agent** — an automation running on n8n at
`YOUR_N8N_INSTANCE`. It receives every Telegram message, hands it to
the AI along with the conversation history, lets the AI call a fixed set of
database actions, and sends the reply back. 24 steps.

**2. The AI** — OpenAI `gpt-5.5`. It reads the customer's message and decides
which actions to take. It has no direct access to anything; it can only ask for
one of seven specific operations. It cannot write its own database queries.

**3. The database** — Supabase (managed PostgreSQL) in East US. Holds the menu,
customers, orders, carts and conversation history. **All the business rules live
here**, not in the AI's instructions.

**4. The Status Notifier** — a second, separate n8n automation. Every 20 seconds
it looks for status changes nobody has been told about yet and sends the Telegram
message. Separate on purpose, so editing it can never break order-taking.

**5. Tandoor Pass** — the kitchen dashboard. Next.js, reads and writes the same
database.

### The seven things the AI is allowed to do

| Action | What it does |
|---|---|
| `get_menu` | Fetch the menu |
| `check_item` | Look up one item by name and get its real price |
| `get_profile` | See what we already know about this customer |
| `save_customer` | Save a name, phone or address |
| `stage_order` | Build a cart and send it for button confirmation. **Does not place the order** |
| `order_status` | Look up one of this customer's orders |
| `cancel_order` | Cancel one of this customer's orders |

That is the complete list. There is no eighth thing it can do.

### Where the data lives

| Table | Holds |
|---|---|
| `products` | The 26 menu items, prices, categories, alternative spellings |
| `customers` | One row per Telegram user: name, phone, address |
| `orders` | One row per order, with a frozen copy of the delivery details |
| `order_items` | The lines of each order, with frozen names and prices |
| `pending_carts` | Carts shown to the customer but not yet confirmed |
| `order_status_events` | Every status change, and whether the customer was told |
| `shop_config` | Delivery fee, free-delivery threshold, minimum order, hours, delivery time |
| `n8n_chat_histories` | Recent conversation, so the bot remembers context |

---

## 6. The rules, and why they live in the database

An AI can be talked out of an instruction. A database cannot. Every rule that
matters is enforced in the database, so it holds no matter what the AI does or
which AI model is being used.

| Rule | Enforced by |
|---|---|
| Prices are real | `stage_order` looks up every price itself and ignores anything the AI suggests |
| Minimum order Rs 500 | Checked before a cart can be created |
| Delivery fee, and the Rs 2,000 waiver | Calculated in the database |
| Name, phone and address required | A cart cannot be built without all three |
| Phone must be a real Pakistani mobile | Format-checked and converted on save |
| Sold-out items cannot be ordered | Availability checked when the cart is built |
| A customer sees only their own orders | Every lookup is filtered by their Telegram ID |
| Only the button confirms | Orders are only created by a button press carrying a stored cart ID |
| Orders follow the correct sequence | The dashboard checks the current status before allowing a move |
| Status changes are always recorded | A database trigger writes the record automatically |
| Customers are never told twice | Each notification is claimed once, atomically |

**Two safety nets in the chat itself:**

- **The reply cleaner** — if the AI ever outputs internal debugging text instead
  of a sentence, it is caught and replaced with a polite retry message. A
  customer can never see the system's internals. (This happened in testing.)
- **Retry on failure** — network hiccups between the system and Telegram retry
  three times before giving up, so a blip cannot swallow a customer's reply.

---

## 7. Running costs and limits

| Item | Status |
|---|---|
| Supabase database | Free tier, 500 MB. Currently using 11 MB, most of which is PostgreSQL's own overhead rather than order data |
| Data transfer | Free tier gives 5 GB/month. The board uses roughly 30 MB/hour while open, and this does **not** grow with order volume |
| n8n | Already running on an existing server |
| OpenAI | Pay per message. The only per-order cost |
| Telegram | Free |
| Dashboard hosting | Not yet deployed. Vercel's free tier is sufficient |

**Why transfer does not grow with volume:** the board only ever loads orders that
are still open — realistically 10 to 40 at any moment, however busy the day is.
Finished orders live on the History page and are loaded 50 at a time. An earlier
version loaded the whole day's history every 3 seconds, which at 1,000 orders a
day would have used 425 MB/hour and exhausted the monthly allowance in half a
day.

---

## 8. Known limitations

- **The dashboard is not deployed yet.** It runs locally on port 4400.
- **Telegram is blocked in Pakistan.** The system itself is unaffected because
  everything that talks to Telegram runs in the USA, but *testing* from a
  Pakistani connection needs a VPN.
- **Cash on delivery only.** No online payment.
- **One shared password** for the whole team. No individual accounts, so the
  board cannot tell you who moved an order.
- **No printed tickets.**
- **No rider tracking** beyond the "on the way" status.
- **Opening hours are not enforced** — the bot will take an order at 4am.
- **One restaurant.** The design supports more, but it is not built.

---

## 9. How to change things

**Menu, prices, availability** — use the Menu page on the dashboard. Changes are
live immediately for the bot. When adding an item, fill in the alternative
spellings, or customers who type it differently will not be understood.

**Delivery fee, minimum order, delivery time** — one row in the `shop_config`
table. No code change.

**The restaurant's identity** — `RESTAURANT.md` in this folder.

**What the bot says and how it behaves** — the instructions live inside the
Order Agent automation in n8n, editable in its interface.

**The AI model** — swap the model node in n8n. The database rules do not care
which model is used. Mistral was used first and OpenAI `gpt-5.5` replaced it.

> If you edit the workflow in n8n, be aware that re-running
> `n8n/build_workflow.py` rebuilds it from the script and would overwrite your
> change. The script has been updated to match the current OpenAI setup, but any
> future manual edit should be copied back into it.

---

## 10. Files in this folder

| File | What it is |
|---|---|
| `HANDOFF.md` | This document |
| `PLAN.md` | The original plan and the decisions taken along the way |
| `RESTAURANT.md` | The demo restaurant's identity and operating rules |
| `CREDENTIALS.md` | **Secrets. Never share or commit this.** |
| `db/01_schema.sql` | Tables |
| `db/02_seed_menu.sql` | The 26 menu items |
| `db/03_functions.sql` | The actions the AI can call |
| `db/04_cart.sql` | The confirm-button flow |
| `db/05_fixes.sql` | Menu formatting and profile fixes from live testing |
| `db/06_phone.sql` | Pakistani mobile handling |
| `db/07_scale.sql` | Indexes for volume |
| `db/seed_demo_orders.py` | Fills the board with fake orders for a demo |
| `n8n/build_workflow.py` | Rebuilds the Order Agent |
| `n8n/build_notifier.py` | Rebuilds the Status Notifier |
| `dashboard/` | The kitchen board (Next.js) |

## 11. Access

Everything needed to run this is in `CREDENTIALS.md`: the n8n address and API
key, the Telegram bot token, and the database connection string. That file holds
live secrets — it is excluded from version control and must not be shared,
screenshotted or shown in a demo video.

The dashboard's own password is set in `dashboard/.env.local`.
