# Security Policy

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue:
message [Shahzaib Hassan on LinkedIn](https://www.linkedin.com/in/shahzaib-hassan-ai-developer).

Include what you found, how to reproduce it, and what an attacker could do with
it. Expect an acknowledgement within a few days.

## Never commit credentials

This project deliberately keeps every secret out of the repository. The following
are gitignored and must stay that way:

| File | Holds |
|---|---|
| `CREDENTIALS.md` | Bot token, n8n API key, database password |
| `.env` / `.env.local` | Connection strings, dashboard password, session secret |
| `.n8n_creds.json` | n8n credential IDs, specific to your instance |

All scripts read their configuration from environment variables. If you find
yourself pasting a secret into a tracked file, stop — that is a bug.

Before every commit:

```bash
git diff --staged
```

## If a secret leaks

Assume anything ever committed to git is public forever, even after a force-push.
**Rotate first, clean history second.** Rotation is what actually protects you.

| Leaked | What to do |
|---|---|
| **Telegram bot token** | Message [@BotFather](https://t.me/BotFather), `/revoke`, select the bot. Update the credential in n8n |
| **n8n API key** | Settings → n8n API → delete the key, create a new one, update your `.env` |
| **Database password** | Supabase → Settings → Database → Reset password. Update every connection string: n8n credential, `dashboard/.env.local`, Vercel env vars |
| **OpenAI API key** | Revoke at platform.openai.com → API keys, create a new one, update the n8n credential |
| **Dashboard password / session secret** | Change in `.env.local` and Vercel. Changing `SESSION_SECRET` signs everyone out, which is what you want |

## Notes on this system's security posture

- The Supabase `public` schema has Row Level Security enabled with **no
  policies**, so the anon REST API returns nothing. The application connects as
  the `postgres` role over raw Postgres, which bypasses RLS.
- The dashboard uses one shared team password with an HMAC-signed cookie. It is
  an internal tool and was never designed to be exposed to the public internet.
  Put it behind a VPN or IP allowlist if that matters to you.
- Customer order lookups are always filtered by Telegram user ID, so one customer
  cannot read another's order by guessing an order number.
- Supabase pooler connections use TLS. Certificate-chain verification is off by
  default because Supabase signs with its own CA; set `SUPABASE_CA_CERT` to
  verify properly.
