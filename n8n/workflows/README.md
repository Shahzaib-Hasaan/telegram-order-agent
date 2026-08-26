# Importable workflows

Drag either file into the n8n canvas, or use **Workflows → Import from File**.

| File | Nodes | What it is |
|---|---|---|
| `order-agent.json` | 24 | Takes Telegram messages, runs the AI, handles the Confirm button |
| `status-notifier.json` | 4 | Every 20s, messages customers whose order status changed |

## After importing

Credential references are intentionally blank — they are specific to whoever
exported them and would be meaningless on your instance. n8n will show each node
with an empty credential picker.

Open each node with a warning triangle and select your own credential:

| Credential | Used by |
|---|---|
| **Postgres** | The 7 tool nodes, chat memory, cart lookup, confirm/cancel |
| **OpenAI** (or any chat model) | `OpenAI Chat Model` |
| **Telegram** | The trigger and all send nodes |

Then activate the workflow. The Telegram trigger registers its own webhook on
activation, so nothing else is needed.

> **Postgres credential:** set SSL to `require` **and** enable "Ignore SSL
> Issues". Supabase signs pooler certificates with its own CA, which Node does
> not trust, so verification fails without it.

## Import or scripts?

These JSON files are the easy way to read the workflow and try it. For anything
you intend to maintain, prefer the builders in the parent folder:

```bash
python n8n/build_workflow.py
python n8n/build_notifier.py
```

They are idempotent, keep credentials out of files entirely, and carry comments
explaining *why* each node is shaped the way it is. **These JSON exports are
generated from those scripts** — if you change a workflow, change the script and
re-export, or the two will drift.

## Regenerating

```bash
N8N_URL=https://placeholder.invalid N8N_API_KEY=placeholder \
  python n8n/export_workflows.py
```

The placeholder values satisfy the scripts' startup checks; nothing is contacted.
