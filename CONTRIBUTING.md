# Contributing

Issues and pull requests are welcome.

## The one rule

**Business rules belong in the database, not the prompt.**

If a change would let the AI decide a price, skip a minimum, bypass the confirm
button, or read another customer's order, it belongs in SQL instead. A prompt can
be talked out of a rule; a database function cannot. This is the whole idea
behind the project, and PRs that move logic the other way will be asked to move
it back.

## Before opening a PR

- **Never commit secrets.** `CREDENTIALS.md`, `.env`, `.env.local` and
  `.n8n_creds.json` are gitignored. Check `git diff --staged` before committing.
- **Keep SQL migrations additive and numbered.** Add `08_*.sql` rather than
  editing an existing file, so anyone who already ran the earlier ones can catch
  up by running only what is new.
- **Do not hardcode a restaurant.** Menu, fees and hours come from the `products`
  and `shop_config` tables. Country-specific logic (phone formats, currency)
  should be easy to swap out.
- **Type-check the dashboard:** `cd dashboard && npx tsc --noEmit`
- **Check the build:** `cd dashboard && npm run build`
- **Python scripts** should stay dependency-light — standard library plus
  `psycopg2` only.

## Good first contributions

- Phone validation for other countries (see `db/06_phone.sql`)
- Enforcing opening hours
- Per-user dashboard accounts instead of one shared password
- Online payment flow
- Translations of the customer-facing message strings

## Reporting a bug

Include what you sent the bot, what it replied, and the relevant n8n execution
trace if you have it. Redact tokens and customer details first.
