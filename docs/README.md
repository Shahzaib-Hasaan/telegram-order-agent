# Screenshots

Used by the main README.

| File | Shows |
|---|---|
| `board.png` | The kitchen board — three columns, urgency rails, Urdu column heads |
| `telegram.png` | Menu plus a customer ordering in Roman Urdu |
| `telegram-cart.png` | The itemised cart with Confirm / Cancel buttons |
| `compact.png` | Board in compact mode during a rush |
| `menu.png` | Menu editor, showing the aliases the bot listens for |
| `n8n-workflow.png` | The agent workflow and its seven database tools |

## Replacing them

All are demo data from the fictional **Tandoor & Bun**. If you re-shoot:

```bash
export DATABASE_URL="..."
python db/seed_demo_orders.py          # populate the board
# take screenshots
python db/seed_demo_orders.py --clear  # tidy up
```

Before you shoot, check the frame for anything you would not publish: connection
strings, API keys, browser tabs, real customer names, phone numbers or addresses.
Blur what you cannot avoid — the Telegram screenshots here have the phone number
and delivery address blurred for exactly that reason.
