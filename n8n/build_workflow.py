"""Build + deploy the Tandoor & Bun order agent workflow to n8n.

Re-runnable: updates the workflow in place if it already exists (matched by name),
so iterating means editing this file and running it again.
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

WF_NAME = 'Tandoor & Bun — Order Agent'
PG   = {'id': CREDS['postgres']['id'],        'name': CREDS['postgres']['name']}
OPENAI = {'id': CREDS['openAiApi']['id'], 'name': CREDS['openAiApi']['name']}
TGC  = {'id': CREDS['telegramApi']['id'],     'name': CREDS['telegramApi']['name']}

def uid(seed):
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, 'tandoor.' + seed))

# Bare expression, NO braces. Every use site wraps it in {{ }} itself — putting
# braces here too produced "={{ {{ ... }} }}" and n8n rejected it as invalid syntax.
#
# .first() not .item: sub-nodes (memory + tools) re-evaluate their expressions on
# every agent round-trip, and after a tool call the item-pairing chain back to
# Normalize is broken, so .item resolves to nothing -> "Key parameter is empty".
# One Telegram update = one item, so .first() is equivalent and always resolves.
CHAT_ID = "$('Normalize').first().json.chatId"
USERNAME = "$('Normalize').first().json.username"
AGENT_OUT = "$('Clean Reply').first().json.text"

SYSTEM_PROMPT = """You are the order-taking assistant for Tandoor & Bun, a restaurant at 12-C Main Boulevard, Gulberg III, Lahore.

LANGUAGE
Reply in whatever language the customer writes. Roman Urdu in, Roman Urdu out. English in, English out. Keep replies to 1-3 short lines. Warm, quick, a little informal. At most one emoji.

SHOP FACTS
Hours 12:00 PM to 2:00 AM daily. Delivery Rs 120, free over Rs 2000. Minimum order Rs 500. Delivery takes 35-45 minutes. Cash on delivery only.
We deliver to Gulberg, Model Town, Johar Town, Garden Town and DHA Phase 1-5. Anywhere else, apologise and offer pickup.

YOUR TOOLS - you may use ONLY these
- get_menu: the whole menu. Use it for "what do you have" style questions.
- check_item: look up one item by name. Use it before quoting ANY price.
- get_profile: see what you already know about this customer.
- save_customer: save the customer's name, phone or address.
- stage_order: build the cart for confirmation. THIS DOES NOT PLACE THE ORDER.
- order_status: look up an existing order.
- cancel_order: cancel an existing order.

HARD RULES
1. Never state a price or an item name that did not come back from get_menu or check_item. If you are unsure, call the tool. Never guess, never invent a deal.
2. To place an order you must call stage_order. It returns a cart which the customer confirms by tapping a button. After stage_order, tell them you have sent the order for confirmation and ask them to tap Confirm. NEVER say the order is placed.
3. Never treat "haan", "yes", "ok", "theek hai", "confirm" or any typed text as confirmation. Only the button confirms an order.
4. Before stage_order the customer needs a name, phone and address on file. Call get_profile first. If something is missing, ask for it and save it with save_customer. For a returning customer, read back the saved address and ask if it is still right rather than asking from scratch.
5. If a tool comes back with ok:false, tell the customer what its message says, in their language. Never invent an order number.
6. If the customer asks for something not on the menu, say so plainly and suggest the closest thing that IS on the menu.
7. Stay on topic: this restaurant, its menu, and its orders. Nothing else.

FIRST CONTACT
If the customer sends /start, "hi", "salam" or any greeting, welcome them to Tandoor & Bun in ONE line, say what we do in a few words, and offer to show the menu. Do not dump the whole menu unless they ask for it.

MENU
When you call get_menu, send its output back to the customer EXACTLY as it comes, character for character. Do not reformat it, do not shorten item names, do not drop prices. "Zinger Burger" is not "Zinger". "Soft Drink 345ml" is not "Soft Drink". You may add one short line before it and one after.

DELIVERY DETAILS - read this twice
ALWAYS call get_profile first. It tells you `known`, what we already have, and a `missing` list.

RETURNING CUSTOMER (known = true, missing is empty):
Do NOT ask for anything again. Read back the saved address in one short line and ask only "yehi address theek hai?" If they say yes, go straight to stage_order. Only if they give a NEW address do you call save_customer.

NEW OR INCOMPLETE (missing is not empty):
Ask ONLY for what `missing` lists, ONE thing at a time. Save each answer with save_customer as soon as you get it.

name, phone and address are THREE SEPARATE things.
NEVER pull a name or a phone number out of an address. A house number is not a phone number. A street name is not a person's name. If the customer sends only an address, save ONLY the address and then ask for the rest.

PHONE
Must be a Pakistani mobile: 11 digits starting 03, like 0300-1234567. Landlines are not accepted. Ask for it plainly: "Apna mobile number bhi bata dein (03xx-xxxxxxx)".
If save_customer returns bad_phone, do NOT retry with a different guess. Tell the customer the number looks wrong and ask them to send it again.

AFTER stage_order
The itemised cart, the total and the Confirm button are sent to the customer automatically. Reply with ONE short line only, such as "Order tayyar hai, Confirm dabayein." NEVER repeat the items, the prices or the total.

FORMATTING
Write PLAIN TEXT only. Do not use markdown - no **bold**, no __underline__, no backticks. Telegram shows those characters literally and it looks broken. Use line breaks and emoji for structure instead. Keep any single reply under 3000 characters.
"""

def tool(name, seed, desc, query, replacement=None, pos=(0, 0)):
    params = {
        'descriptionType': 'manual',
        'toolDescription': desc,
        'operation': 'executeQuery',
        'query': query,
        'options': {},
    }
    if replacement:
        params['options']['queryReplacement'] = '=' + replacement
    return {
        'parameters': params,
        'type': 'n8n-nodes-base.postgresTool',
        'typeVersion': 2.6,
        'position': list(pos),
        'id': uid(seed),
        'name': name,
        'credentials': {'postgres': PG},
    }

nodes = []

# ---------------------------------------------------------------- trigger
nodes.append({
    'parameters': {'updates': ['message', 'callback_query'], 'additionalFields': {}},
    'type': 'n8n-nodes-base.telegramTrigger', 'typeVersion': 1.2,
    'position': [-720, 0], 'id': uid('trigger'), 'name': 'Telegram Trigger',
    'webhookId': uid('webhook'),
    'credentials': {'telegramApi': TGC},
})

# ---------------------------------------------------------------- normalize
NORMALIZE = r"""
const u = $input.first().json;
const cb = u.callback_query;

if (cb) {
  const parts = (cb.data || '').split(':');
  return [{ json: {
    kind: 'button',
    chatId: cb.message.chat.id,
    userId: cb.from.id,
    username: cb.from.username || '',
    firstName: cb.from.first_name || '',
    action: parts[0] || '',
    cartId: parseInt(parts[1] || '0', 10),
    callbackQueryId: cb.id,
    messageId: cb.message.message_id,
    text: ''
  }}];
}

const m = u.message || {};
return [{ json: {
  kind: 'text',
  chatId: m.chat ? m.chat.id : null,
  userId: m.from ? m.from.id : null,
  username: (m.from && m.from.username) || '',
  firstName: (m.from && m.from.first_name) || '',
  action: '', cartId: 0, callbackQueryId: '', messageId: m.message_id,
  text: m.text || ''
}}];
"""
nodes.append({
    'parameters': {'jsCode': NORMALIZE.strip()},
    'type': 'n8n-nodes-base.code', 'typeVersion': 2,
    'position': [-500, 0], 'id': uid('normalize'), 'name': 'Normalize',
})

# ---------------------------------------------------------------- router
nodes.append({
    'parameters': {
        'conditions': {
            'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
            'conditions': [{
                'id': uid('cond-button'),
                'leftValue': '={{ $json.kind }}',
                'rightValue': 'button',
                'operator': {'type': 'string', 'operation': 'equals'},
            }],
            'combinator': 'and',
        },
        'looseTypeValidation': True,
        'options': {},
    },
    'type': 'n8n-nodes-base.if', 'typeVersion': 2.3,
    'position': [-280, 0], 'id': uid('router'), 'name': 'Button or Message?',
})

# ================================================================ BUTTON BRANCH
nodes.append({
    'parameters': {
        'conditions': {
            'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
            'conditions': [{
                'id': uid('cond-confirm'),
                'leftValue': '={{ $json.action }}',
                'rightValue': 'confirm',
                'operator': {'type': 'string', 'operation': 'equals'},
            }],
            'combinator': 'and',
        },
        'looseTypeValidation': True,
        'options': {},
    },
    'type': 'n8n-nodes-base.if', 'typeVersion': 2.3,
    'position': [-60, -260], 'id': uid('is-confirm'), 'name': 'Confirm or Cancel?',
})

nodes.append({
    'parameters': {
        'operation': 'executeQuery',
        'query': 'SELECT fn_confirm_cart($1::bigint, $2::int) AS result;',
        'options': {'queryReplacement': '={{ [$json.chatId, $json.cartId] }}'},
    },
    'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.6,
    'position': [160, -360], 'id': uid('do-confirm'), 'name': 'Confirm Cart',
    'credentials': {'postgres': PG},
})

nodes.append({
    'parameters': {
        'operation': 'executeQuery',
        'query': 'SELECT fn_cancel_cart($1::bigint, $2::int) AS result;',
        'options': {'queryReplacement': '={{ [$json.chatId, $json.cartId] }}'},
    },
    'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.6,
    'position': [160, -160], 'id': uid('do-cancel'), 'name': 'Cancel Cart',
    'credentials': {'postgres': PG},
})

CONFIRM_MSG = r"""
const r = $input.first().json.result;
let text;
if (r.ok && r.already) {
  text = `Order #${r.order_id} is already placed. 👍`;
} else if (r.ok) {
  text = `✅ *Order #${r.order_id} confirmed!*\n\nTotal: Rs ${r.total}\n📍 ${r.address}\n⏱ ${r.eta_minutes} min\n\nShukriya! Rider raasty mein hoga jald.`;
} else {
  text = r.message || 'Something went wrong. Please try again.';
}
return [{ json: { text } }];
"""
nodes.append({
    'parameters': {'jsCode': CONFIRM_MSG.strip()},
    'type': 'n8n-nodes-base.code', 'typeVersion': 2,
    'position': [380, -360], 'id': uid('fmt-confirm'), 'name': 'Format Confirmation',
})

CANCEL_MSG = r"""
const r = $input.first().json.result;
return [{ json: { text: r.ok
  ? 'Order cancel kar diya. Jab dil karay dobara order kar dijiye 🙂'
  : (r.message || 'Nothing to cancel.') } }];
"""
nodes.append({
    'parameters': {'jsCode': CANCEL_MSG.strip()},
    'type': 'n8n-nodes-base.code', 'typeVersion': 2,
    'position': [380, -160], 'id': uid('fmt-cancel'), 'name': 'Format Cancellation',
})

nodes.append({
    'parameters': {
        'chatId': '={{ %s }}' % CHAT_ID,
        'text': '={{ $json.text }}',
        'additionalFields': {'appendAttribution': False, 'parse_mode': 'Markdown'},
    },
    'type': 'n8n-nodes-base.telegram', 'typeVersion': 1.2,
    'position': [620, -260], 'id': uid('send-button-reply'), 'name': 'Send Button Reply',
    'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 2000,
    'credentials': {'telegramApi': TGC},
})

# ================================================================ MESSAGE BRANCH
nodes.append({
    'parameters': {
        'promptType': 'define',
        'text': '={{ $json.text }}',
        'options': {'systemMessage': SYSTEM_PROMPT, 'maxIterations': 8},
    },
    'type': '@n8n/n8n-nodes-langchain.agent', 'typeVersion': 3.1,
    'position': [-60, 220], 'id': uid('agent'), 'name': 'Order Agent',
    'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 2000,
})

# Swapped from Mistral to OpenAI on 2026-08-21. Mistral held tool discipline
# in isolation but degraded under the full agent load (7 tools + long prompt +
# memory), occasionally narrating a tool call instead of emitting one.
nodes.append({
    'parameters': {
        'model': {'__rl': True, 'value': 'gpt-5.5', 'mode': 'list', 'cachedResultName': 'gpt-5.5'},
        'builtInTools': {},
        'options': {},
    },
    'type': '@n8n/n8n-nodes-langchain.lmChatOpenAi', 'typeVersion': 1.3,
    'position': [-260, 460], 'id': uid('llm'), 'name': 'OpenAI Chat Model',
    'credentials': {'openAiApi': OPENAI},
})

nodes.append({
    'parameters': {
        'sessionIdType': 'customKey',
        'sessionKey': '={{ %s }}' % CHAT_ID,
        'tableName': 'n8n_chat_histories',
        'contextWindowLength': 10,
    },
    'type': '@n8n/n8n-nodes-langchain.memoryPostgresChat', 'typeVersion': 1.3,
    'position': [-100, 460], 'id': uid('memory'), 'name': 'Chat Memory',
    'credentials': {'postgres': PG},
})

# ---------------------------------------------------------------- agent tools
nodes.append(tool('get_menu', 'tool-menu',
    'Returns the full Tandoor & Bun menu with every item and its price, grouped by category. '
    'Use this when the customer asks what is available, what the menu is, or what you sell.',
    'SELECT fn_get_menu() AS menu;', None, (60, 460)))

nodes.append(tool('check_item', 'tool-check',
    'Looks up one menu item by name and returns its real price and availability. Handles Roman Urdu '
    'and misspellings ("zingr", "adha karahi", "thanda"). ALWAYS call this before quoting a price. '
    'Returns up to 4 matches - if more than one comes back, ask the customer which they meant.',
    'SELECT name, price, category, available FROM fn_check_item($1);',
    "{{ [$fromAI('item_name', 'the item the customer mentioned, exactly as they typed it', 'string')] }}",
    (220, 460)))

nodes.append(tool('get_profile', 'tool-profile',
    'Returns what we already know about this customer: known (true/false), name, phone, address, '
    'past_orders, and a "missing" list of fields still needed. ALWAYS call this before asking for '
    'any delivery detail, so a returning customer is never asked twice.',
    'SELECT fn_get_profile($1::bigint) AS result;',
    '{{ [%s] }}' % CHAT_ID,
    (380, 460)))

nodes.append(tool('save_customer', 'tool-save',
    'Saves or updates the customer name, phone number and delivery address. Pass empty string for '
    'anything you do not have yet - blank values never overwrite something already saved.',
    'SELECT fn_save_customer($1::bigint, $2, $3, $4, $5) AS result;',
    "{{ [%s, $fromAI('name','customer full name, empty string if unknown','string'), "
    "$fromAI('phone','customer phone number, empty string if unknown','string'), "
    "$fromAI('address','full delivery address, empty string if unknown','string'), "
    "%s] }}" % (CHAT_ID, USERNAME),
    (540, 460)))

nodes.append(tool('stage_order', 'tool-stage',
    'Builds the cart and sends it to the customer for button confirmation. THIS DOES NOT PLACE THE '
    'ORDER - the customer must tap Confirm. Prices are looked up server-side, so pass item names and '
    'quantities only. Returns ok:false with a message if an item is unknown, the customer profile is '
    'incomplete, or the cart is under the Rs 500 minimum.',
    'SELECT fn_stage_cart($1::bigint, $2::jsonb, $3) AS result;',
    "{{ [%s, $fromAI('items', 'JSON array of the cart, e.g. [{\"name\":\"Zinger Burger\",\"qty\":2},"
    "{\"name\":\"Coke\",\"qty\":1}]', 'string'), "
    "$fromAI('note','any special instruction such as extra spicy, empty string if none','string')] }}" % CHAT_ID,
    (700, 460)))

nodes.append(tool('order_status', 'tool-status',
    'Looks up one of THIS customer\'s orders and returns its status, items and total. '
    'Pass 0 for the order number to get their most recent order.',
    'SELECT fn_order_status($1::bigint, NULLIF($2,0)::int) AS result;',
    "{{ [%s, $fromAI('order_id','the order number the customer asked about, or 0 for their latest','number')] }}" % CHAT_ID,
    (860, 460)))

nodes.append(tool('cancel_order', 'tool-cancel-order',
    'Cancels one of THIS customer\'s existing orders. Only works while the order is still new or '
    'preparing. Returns ok:false with a reason otherwise.',
    'SELECT fn_cancel_order($1::bigint, $2::int, $3) AS result;',
    "{{ [%s, $fromAI('order_id','the order number to cancel','number'), "
    "$fromAI('reason','why they are cancelling, empty string if not given','string')] }}" % CHAT_ID,
    (1020, 460)))

# ---------------------------------------------------------------- sanitiser
# Mistral occasionally narrates a tool call instead of emitting one, and
# LangChain hands that straight through as the final answer. Order #2 showed a
# customer the literal string:
#   [Used tools: Tool: save_customer, Input: {"name": ...}]}
# Nothing downstream should ever be able to put an internal trace in front of a
# customer, so it is caught here rather than trusted to the prompt.
CLEAN_REPLY = r"""
const raw = ($('Order Agent').first().json.output ?? '').toString();

const isTrace =
  /^\s*\[?\s*used\s+tools?\s*:/i.test(raw) ||
  /Tool:\s*\w+\s*,\s*Input:/i.test(raw) ||
  /^\s*\{?\s*"?(action|tool_calls?|function_call)"?\s*:/i.test(raw);

const empty = raw.trim().length === 0;

return [{ json: {
  text: (isTrace || empty)
    ? 'Maaf kijiye, woh message theek se process nahi hua. Dobara bhej dein?'
    : raw,
  flagged: isTrace || empty,
  raw
}}];
"""
nodes.append({
    'parameters': {'jsCode': CLEAN_REPLY.strip()},
    'type': 'n8n-nodes-base.code', 'typeVersion': 2,
    'position': [110, 220], 'id': uid('clean-reply'), 'name': 'Clean Reply',
})

# ---------------------------------------------------------------- post-agent
nodes.append({
    'parameters': {
        'operation': 'executeQuery',
        'query': (
            "SELECT id AS cart_id, summary FROM pending_carts "
            "WHERE customer_tg_id = $1::bigint AND status = 'pending' "
            "ORDER BY id DESC LIMIT 1;"
        ),
        'options': {'queryReplacement': '={{ [%s] }}' % CHAT_ID},
    },
    'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.6,
    'position': [300, 220], 'id': uid('fetch-cart'), 'name': 'Any Cart Awaiting Confirm?',
    'alwaysOutputData': True,
    'credentials': {'postgres': PG},
})

nodes.append({
    'parameters': {
        'conditions': {
            'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
            'conditions': [{
                'id': uid('cond-cart'),
                'leftValue': '={{ $json.cart_id }}',
                'rightValue': '',
                'operator': {'type': 'number', 'operation': 'exists', 'singleValue': True},
            }],
            'combinator': 'and',
        },
        'looseTypeValidation': True,
        'options': {},
    },
    'type': 'n8n-nodes-base.if', 'typeVersion': 2.3,
    'position': [520, 220], 'id': uid('has-cart'), 'name': 'Cart Staged?',
})

# cart staged -> ONLY the server-built summary + inline keyboard.
# Order #1 printed the whole cart twice: once written by the model, once from
# summary. The summary is authoritative (real prices, real profile), so the
# model's version is dropped here and the prompt tells it to send one line.
nodes.append({
    'parameters': {
        'chatId': '={{ %s }}' % CHAT_ID,
        'text': "={{ $json.summary }}",
        'replyMarkup': 'inlineKeyboard',
        'inlineKeyboard': {
            'rows': [{
                'row': {
                    'buttons': [
                        {'text': '✅ Confirm', 'additionalFields': {'callback_data': '=confirm:{{ $json.cart_id }}'}},
                        {'text': '❌ Cancel',  'additionalFields': {'callback_data': '=cancel:{{ $json.cart_id }}'}},
                    ]
                }
            }]
        },
        'additionalFields': {'appendAttribution': False, 'parse_mode': 'Markdown'},
    },
    'type': 'n8n-nodes-base.telegram', 'typeVersion': 1.2,
    'position': [760, 120], 'id': uid('send-cart'), 'name': 'Send Cart + Buttons',
    'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 2000,
    'credentials': {'telegramApi': TGC},
})

# no cart -> plain agent reply
nodes.append({
    'parameters': {
        'chatId': '={{ %s }}' % CHAT_ID,
        'text': "={{ " + AGENT_OUT + " }}",
        'additionalFields': {'appendAttribution': False},
    },
    'type': 'n8n-nodes-base.telegram', 'typeVersion': 1.2,
    'position': [760, 320], 'id': uid('send-plain'), 'name': 'Send Reply',
    'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 2000,
    'credentials': {'telegramApi': TGC},
})

# ---------------------------------------------------------------- connections
def m(*targets):
    return [[{'node': t, 'type': 'main', 'index': 0} for t in targets]]

connections = {
    'Telegram Trigger':        {'main': m('Normalize')},
    'Normalize':               {'main': m('Button or Message?')},
    'Button or Message?':      {'main': [
        [{'node': 'Confirm or Cancel?', 'type': 'main', 'index': 0}],   # true  = button
        [{'node': 'Order Agent',        'type': 'main', 'index': 0}],   # false = text
    ]},
    'Confirm or Cancel?':      {'main': [
        [{'node': 'Confirm Cart', 'type': 'main', 'index': 0}],
        [{'node': 'Cancel Cart',  'type': 'main', 'index': 0}],
    ]},
    'Confirm Cart':            {'main': m('Format Confirmation')},
    'Cancel Cart':             {'main': m('Format Cancellation')},
    'Format Confirmation':     {'main': m('Send Button Reply')},
    'Format Cancellation':     {'main': m('Send Button Reply')},
    'Order Agent':             {'main': m('Clean Reply')},
    'Clean Reply':             {'main': m('Any Cart Awaiting Confirm?')},
    'Any Cart Awaiting Confirm?': {'main': m('Cart Staged?')},
    'Cart Staged?':            {'main': [
        [{'node': 'Send Cart + Buttons', 'type': 'main', 'index': 0}],
        [{'node': 'Send Reply',          'type': 'main', 'index': 0}],
    ]},
    # sub-nodes attach TO the agent
    'OpenAI Chat Model': {'ai_languageModel': [[{'node': 'Order Agent', 'type': 'ai_languageModel', 'index': 0}]]},
    'Chat Memory':  {'ai_memory':        [[{'node': 'Order Agent', 'type': 'ai_memory',        'index': 0}]]},
}
for t in ['get_menu', 'check_item', 'get_profile', 'save_customer',
          'stage_order', 'order_status', 'cancel_order']:
    connections[t] = {'ai_tool': [[{'node': 'Order Agent', 'type': 'ai_tool', 'index': 0}]]}

workflow = {
    'name': WF_NAME,
    'nodes': nodes,
    'connections': connections,
    'settings': {'executionOrder': 'v1'},
}


# ---------------------------------------------------------------- deploy
def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    rq = urllib.request.Request(BASE + path, data=data, method=method,
                                headers={'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(rq, timeout=180))
    except urllib.error.HTTPError as e:
        print('HTTP %s on %s %s\n%s' % (e.code, method, path, e.read().decode()[:900]))
        raise


def assert_no_nested_braces():
    """n8n rejects "={{ {{ x }} }}" as invalid syntax, and the error surfaces on
    whatever sub-node happens to touch it first — which sent me hunting a Postgres
    bug that did not exist. Fail loudly here instead."""
    bad = []

    def walk(o, path):
        if isinstance(o, str):
            if re.search(r'\{\{[^}]*\{\{', o):
                bad.append((path, o[:120]))
        elif isinstance(o, dict):
            for k, v in o.items():
                walk(v, path + '.' + str(k))
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, path + '[%d]' % i)

    for n in nodes:
        walk(n['parameters'], n['name'])
    if bad:
        for path, snippet in bad:
            print('NESTED BRACES  %s\n   %s' % (path, snippet))
        sys.exit('refusing to deploy: %d nested-brace expression(s)' % len(bad))


if __name__ == '__main__':
    assert_no_nested_braces()
    existing = None
    for w in call('GET', '/workflows?limit=100')['data']:
        if w['name'] == WF_NAME:
            existing = w['id']
            break

    if existing:
        # PUT on a LIVE workflow makes n8n tear down and re-register the Telegram
        # webhook mid-update; when that call is slow the whole PUT 400s with
        # "The connection timed out" even though the nodes were already written.
        # Deactivating first keeps the update and the webhook churn separate.
        try:
            call('POST', '/workflows/%s/deactivate' % existing)
            print('deactivated before update')
        except urllib.error.HTTPError:
            pass
        call('PUT', '/workflows/' + existing, workflow)
        wf_id = existing
        print('updated workflow %s' % wf_id)
    else:
        wf_id = call('POST', '/workflows', workflow)['id']
        print('created workflow %s' % wf_id)

    active = False
    for attempt in range(3):
        try:
            active = call('POST', '/workflows/%s/activate' % wf_id).get('active')
            if active:
                break
        except urllib.error.HTTPError as e:
            print('activate attempt %d failed (%s), retrying' % (attempt + 1, e.code))

    print('%d nodes | active: %s' % (len(nodes), active))
    if not active:
        sys.exit('WORKFLOW IS NOT ACTIVE — activate it in the UI before testing')
    print('open: %s' % (BASE.replace('/api/v1', '') + '/workflow/' + wf_id))
