# Screenshots

Drop four PNGs in this folder and they appear automatically in the main README.
Nothing else needs editing — the image tags are already in place.

| Filename | What to capture |
|---|---|
| `board.png` | The kitchen board with several live orders across the urgency range — green, amber and a red one past the promise. Run `python db/seed_demo_orders.py` first to populate it |
| `telegram.png` | A Telegram conversation: an order in Roman Urdu through to the cart with the Confirm / Cancel buttons |
| `compact.png` | The board in compact mode during a rush. Seed ~20 orders, or press the **Compact** toggle |
| `menu.png` | The Menu page, showing the aliases under each item — this is what makes the bot understand `zingr` |

**Before you screenshot:**

- Use demo data, never real customers. `python db/seed_demo_orders.py` gives you
  a realistic board; `--clear` removes it again.
- Check nothing sensitive is on screen: connection strings, tokens, browser tabs,
  real phone numbers or addresses.
- Dark theme photographs better for the board. The Menu page reads well in either.
- Around 1440px wide is a good balance of detail and file size.
