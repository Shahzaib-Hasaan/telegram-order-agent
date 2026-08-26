"""Export both workflows as importable JSON, with credentials stripped.

The builders are the source of truth. This regenerates n8n/workflows/*.json from
them so the repo always ships something a reader can drag onto a canvas without
running anything or owning an API key.

Credential ids identify a specific n8n instance, so they are blanked. So are
webhook ids, which n8n regenerates on import and which can otherwise collide.

    N8N_URL=https://placeholder.invalid N8N_API_KEY=placeholder \
        python n8n/export_workflows.py
"""
import copy, importlib.util, io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'workflows')

# The builders validate these at import time. Nothing is contacted.
os.environ.setdefault('N8N_URL', 'https://placeholder.invalid')
os.environ.setdefault('N8N_API_KEY', 'placeholder')


def _load(filename, modname):
    path = os.path.join(HERE, filename)
    spec = importlib.util.spec_from_file_location(modname, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[modname] = mod
    spec.loader.exec_module(mod)
    return mod


def _export(mod, outfile, label):
    wf = copy.deepcopy({
        'name': mod.WF_NAME,
        'nodes': mod.nodes,
        'connections': mod.connections,
        'settings': mod.workflow.get('settings', {'executionOrder': 'v1'}),
    })
    blanked = 0
    for node in wf['nodes']:
        for ctype in (node.get('credentials') or {}):
            # Keep the credential TYPE so n8n shows the right picker on import,
            # drop the id and name, which are instance-specific.
            node['credentials'][ctype] = {'id': '', 'name': ''}
            blanked += 1
        node.pop('webhookId', None)

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, outfile)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(wf, indent=2, ensure_ascii=False) + '\n')
    print('  %-18s %2d nodes, %2d credential refs blanked -> workflows/%s'
          % (label, len(wf['nodes']), blanked, outfile))


if __name__ == '__main__':
    _export(_load('build_workflow.py', '_bw'), 'order-agent.json', 'Order Agent')
    _export(_load('build_notifier.py', '_bn'), 'status-notifier.json', 'Status Notifier')
    print('\nDone. Verify no real credential ids slipped in before committing.')
