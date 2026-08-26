"""Deploy the status notifier — a separate n8n workflow from the order agent.

Why this exists: order_status_events already records every transition with a
`notified` flag, but nothing drained it. The dashboard tries to send directly,
which works from Vercel but never from a machine in Pakistan, where Telegram is
blocked. n8n sits in New Jersey and can always reach Telegram, so it becomes the
single reliable sender.

This also means a status change made ANY way — dashboard, psql, a future admin
tool — reaches the customer. The queue is the contract, not the caller.

Runs on its own workflow id so it can be paused or edited without ever touching
the live order agent.
"""
import io, re, json, uuid, os, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _env(name, hint):
    """Read a required setting from the environment, or explain how to set it."""
    v = os.environ.get(name, '').strip()
    if not v:
        sys.exit(
            'Missing %s\n\n  %s\n\n'
            'Set it in your shell, or copy .env.example to .env and load it:\n'
            '  export %s="..."      # macOS / Linux\n'
            '  $env:%s = "..."      # Windows PowerShell\n' % (name, hint, name, name)
        )
    return v


N8N_URL = _env('N8N_URL', 'Base URL of your n8n instance, e.g. https://n8n.example.com')
API_KEY = _env('N8N_API_KEY', 'n8n API key: Settings > n8n API > Create an API key')
BASE = N8N_URL.rstrip('/') + '/api/v1'

# Credential IDs are created once in the n8n UI, then referenced here by id.
# See README "Set up n8n" for how to find them.
_CREDS_PATH = os.path.join(ROOT, '.n8n_creds.json')
if not os.path.exists(_CREDS_PATH):
    sys.exit(
        'Missing .n8n_creds.json\n\n'
        '  Copy .n8n_creds.example.json to .n8n_creds.json and fill in the\n'
        '  credential IDs from your own n8n instance (see README).\n'
    )
CREDS = json.load(io.open(_CREDS_PATH, encoding='utf-8'))

WF_NAME = 'Tandoor & Bun — Status Notifier'
PG = {'id': CREDS['postgres']['id'], 'name': CREDS['postgres']['name']}
TGC = {'id': CREDS['telegramApi']['id'], 'name': CREDS['telegramApi']['name']}


def uid(seed):
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, 'tandoor.notify.' + seed))


# Claim rows and mark them sent in ONE statement. If two ticks overlap, the
# second finds nothing left to claim, so a customer can never be told twice.
CLAIM_SQL = """
WITH claimed AS (
  SELECT e.id
    FROM order_status_events e
   WHERE NOT e.notified
     AND e.to_status IN ('preparing','on_the_way','delivered','cancelled')
     AND e.created_at > now() - interval '2 hours'
   ORDER BY e.id
   LIMIT 20
   FOR UPDATE SKIP LOCKED
), marked AS (
  UPDATE order_status_events SET notified = true
   WHERE id IN (SELECT id FROM claimed)
  RETURNING id, order_id, to_status
)
SELECT m.id            AS event_id,
       m.to_status     AS status,
       o.id            AS order_id,
       o.total,
       o.delivery_address AS address,
       o.customer_tg_id   AS chat_id,
       c.eta_minutes
  FROM marked m
  JOIN orders o ON o.id = m.order_id
  CROSS JOIN shop_config c
 WHERE c.id = 1;
"""

COMPOSE = r"""
// One Telegram message per claimed event, in the customer's language.
const MSG = {
  preparing: (o) =>
    `👨‍🍳 Order #${o.order_id} tayyar ho raha hai.\n\nAap ka khana tandoor par hai. ${o.eta_minutes} min mein pohanch jayega.`,
  on_the_way: (o) =>
    `🛵 Order #${o.order_id} raasty mein hai!\n\nRider nikal chuka hai — ${o.address}\nRs ${o.total} cash on delivery.`,
  delivered: (o) =>
    `✅ Order #${o.order_id} deliver ho gaya.\n\nShukriya! Umeed hai maza aya. Dobara order karna ho to bas message kar dein. 🙂`,
  cancelled: (o) =>
    `❌ Order #${o.order_id} cancel kar diya gaya hai.\n\nKoi masla ho to batayein.`,
};

return $input.all()
  .filter((i) => i.json && i.json.order_id && MSG[i.json.status])
  .map((i) => ({ json: {
    chatId: i.json.chat_id,
    text: MSG[i.json.status](i.json),
    eventId: i.json.event_id,
    orderId: i.json.order_id,
    status: i.json.status,
  }}));
"""

nodes = [
    {
        'parameters': {'rule': {'interval': [{'field': 'seconds', 'secondsInterval': 20}]}},
        'type': 'n8n-nodes-base.scheduleTrigger', 'typeVersion': 1.2,
        'position': [-460, 0], 'id': uid('cron'), 'name': 'Every 20s',
    },
    {
        'parameters': {
            'operation': 'executeQuery',
            'query': CLAIM_SQL.strip(),
            'options': {},
        },
        'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.6,
        'position': [-240, 0], 'id': uid('claim'), 'name': 'Claim Unsent',
        'alwaysOutputData': True,
        'retryOnFail': True, 'maxTries': 2, 'waitBetweenTries': 1500,
        'credentials': {'postgres': PG},
    },
    {
        'parameters': {'jsCode': COMPOSE.strip()},
        'type': 'n8n-nodes-base.code', 'typeVersion': 2,
        'position': [-20, 0], 'id': uid('compose'), 'name': 'Compose',
    },
    {
        'parameters': {
            'chatId': '={{ $json.chatId }}',
            'text': '={{ $json.text }}',
            'additionalFields': {'appendAttribution': False},
        },
        'type': 'n8n-nodes-base.telegram', 'typeVersion': 1.2,
        'position': [200, 0], 'id': uid('send'), 'name': 'Tell Customer',
        # If Telegram is briefly unreachable, retry rather than lose the message.
        'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 3000,
        # The row is already marked sent; on a hard failure keep going so one bad
        # chat id cannot block the queue behind it.
        'onError': 'continueRegularOutput',
        'credentials': {'telegramApi': TGC},
    },
]

connections = {
    'Every 20s': {'main': [[{'node': 'Claim Unsent', 'type': 'main', 'index': 0}]]},
    'Claim Unsent': {'main': [[{'node': 'Compose', 'type': 'main', 'index': 0}]]},
    'Compose': {'main': [[{'node': 'Tell Customer', 'type': 'main', 'index': 0}]]},
}

workflow = {
    'name': WF_NAME,
    'nodes': nodes,
    'connections': connections,
    'settings': {'executionOrder': 'v1', 'saveDataSuccessExecution': 'none'},
}


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    rq = urllib.request.Request(BASE + path, data=data, method=method,
                                headers={'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(rq, timeout=180))
    except urllib.error.HTTPError as e:
        print('HTTP %s on %s %s\n%s' % (e.code, method, path, e.read().decode()[:600]))
        raise


if __name__ == '__main__':
    existing = None
    for w in call('GET', '/workflows?limit=100')['data']:
        if w['name'] == WF_NAME:
            existing = w['id']
            break

    if existing:
        try:
            call('POST', '/workflows/%s/deactivate' % existing)
        except urllib.error.HTTPError:
            pass
        call('PUT', '/workflows/' + existing, workflow)
        wf_id = existing
        print('updated %s' % wf_id)
    else:
        wf_id = call('POST', '/workflows', workflow)['id']
        print('created %s' % wf_id)

    active = False
    for _ in range(3):
        try:
            active = call('POST', '/workflows/%s/activate' % wf_id).get('active')
            if active:
                break
        except urllib.error.HTTPError:
            pass
    print('%d nodes | active: %s' % (len(nodes), active))
    if not active:
        sys.exit('NOT ACTIVE — turn it on in the UI')
    print('open: %s' % (BASE.replace('/api/v1', '') + '/workflow/' + wf_id))
