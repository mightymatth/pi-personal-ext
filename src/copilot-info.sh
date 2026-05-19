#!/usr/bin/env bash
set -euo pipefail

# copilot-info: Show GitHub Copilot plan, usage, available models, and multipliers.
# Sources:
#   - Plan + usage: GitHub internal Copilot user API via `gh`
#   - Model metadata (vendor/category/preview): Copilot models API via /copilot_internal/user.endpoints.api
#   - Exact multipliers: Copilot SDK list_models() via uv --with github-copilot-sdk (no explicit install)

FORMAT="table"

usage() {
  cat <<'EOF'
Usage: copilot-info [--json|--tsv|--table]

Shows your Copilot plan, current usage this month, and models currently
available to your logged-in user including premium request multipliers.

Options:
  --json    Output everything as JSON
  --tsv     Output model table as TSV
  --table   Pretty-print (default)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) FORMAT="json" ;;
    --tsv) FORMAT="tsv" ;;
    --table) FORMAT="table" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need gh
need curl
need uv
need python3

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

USER_FILE="$TMPDIR/user.json"
API_MODELS_FILE="$TMPDIR/api-models.json"
SDK_MODELS_FILE="$TMPDIR/sdk-models.json"

# Pull Copilot user info (plan, quota, orgs, API endpoint)
gh api /copilot_internal/user --jq '.' > "$USER_FILE" 2>/dev/null || echo '{}' > "$USER_FILE"

API_BASE="$(gh api /copilot_internal/user --jq '.endpoints.api // empty' 2>/dev/null || true)"
if [[ -z "$API_BASE" ]]; then
  API_BASE="https://api.githubcopilot.com"
fi

GH_TOKEN="$(gh auth token 2>/dev/null || true)"
if [[ -n "$GH_TOKEN" ]]; then
  curl -fsSL -H "Authorization: Bearer $GH_TOKEN" "$API_BASE/models" \
    -o "$API_MODELS_FILE" 2>/dev/null || echo '{"data":[]}' > "$API_MODELS_FILE"
else
  echo '{"data":[]}' > "$API_MODELS_FILE"
fi

# Pull exact model multipliers from Copilot SDK list_models() (uv ephemeral env).
uv run --with github-copilot-sdk python - > "$SDK_MODELS_FILE" <<'PY'
import asyncio
import json
from copilot import CopilotClient


async def main():
    client = CopilotClient()
    await client.start()
    try:
        models = await client.list_models()
    finally:
        await client.stop()

    out = []
    for m in models:
        out.append(
            {
                "id": m.id,
                "name": m.name,
                "policy_state": m.policy.state if m.policy else None,
                "multiplier": m.billing.multiplier if m.billing else None,
            }
        )

    print(json.dumps(out))


asyncio.run(main())
PY

USER_FILE="$USER_FILE" \
API_MODELS_FILE="$API_MODELS_FILE" \
SDK_MODELS_FILE="$SDK_MODELS_FILE" \
FORMAT="$FORMAT" \
python3 <<'PY'
import json
import os
import sys

user_file = os.environ['USER_FILE']
api_models_file = os.environ['API_MODELS_FILE']
sdk_models_file = os.environ['SDK_MODELS_FILE']
fmt = os.environ['FORMAT']

with open(user_file, 'r', encoding='utf-8') as f:
    user_data = json.load(f)

with open(api_models_file, 'r', encoding='utf-8') as f:
    api_models_data = json.load(f)

with open(sdk_models_file, 'r', encoding='utf-8') as f:
    sdk_models = json.load(f)

api_models = api_models_data.get('data', []) if isinstance(api_models_data, dict) else []
api_by_id = {m.get('id'): m for m in api_models if isinstance(m, dict) and m.get('id')}

# --- Build usage info ---
plan = user_data.get('copilot_plan', 'unknown')
login = user_data.get('login', 'unknown')
orgs = user_data.get('organization_login_list', [])
chat_enabled = user_data.get('chat_enabled', False)
mcp_enabled = user_data.get('is_mcp_enabled', False)
assigned = user_data.get('assigned_date', 'unknown')
reset_date = user_data.get('quota_reset_date', 'unknown')

quotas = user_data.get('quota_snapshots', {})
premium = quotas.get('premium_interactions', {})
prem_entitlement = premium.get('entitlement', 0)
prem_remaining = premium.get('remaining', 0)
prem_used = prem_entitlement - prem_remaining if prem_entitlement else 0
prem_pct_remaining = premium.get('percent_remaining', 100)
prem_overage_permitted = premium.get('overage_permitted', False)
prem_overage_count = premium.get('overage_count', 0)

chat_q = quotas.get('chat', {})
completions_q = quotas.get('completions', {})

account_info = {
    'login': login,
    'plan': plan,
    'organizations': orgs,
    'assigned_date': assigned,
    'chat_enabled': chat_enabled,
    'mcp_enabled': mcp_enabled,
    'premium_requests': {
        'entitlement': prem_entitlement,
        'used': round(prem_used, 1),
        'remaining': round(prem_remaining, 1),
        'percent_remaining': prem_pct_remaining,
        'overage_permitted': prem_overage_permitted,
        'overage_count': prem_overage_count,
        'reset_date': reset_date,
    },
    'chat': {'unlimited': chat_q.get('unlimited', False)},
    'completions': {'unlimited': completions_q.get('unlimited', False)},
}

# --- Build model table from SDK list (exactly what Copilot SDK exposes) ---
model_results = []
seen = set()
for m in sdk_models:
    if not isinstance(m, dict):
        continue

    model_id = m.get('id')
    if not model_id or model_id == 'auto' or model_id in seen:
        continue

    if m.get('policy_state') not in (None, '', 'enabled'):
        continue

    seen.add(model_id)

    api_m = api_by_id.get(model_id, {})

    # If API says not in picker, hide it.
    if api_m and not api_m.get('model_picker_enabled', False):
        continue

    model_results.append(
        {
            'model': model_id,
            'name': m.get('name') or model_id,
            'multiplier': m.get('multiplier'),
            'category': api_m.get('model_picker_category', ''),
            'vendor': api_m.get('vendor', ''),
            'preview': bool(api_m.get('preview', False)),
        }
    )

if fmt == 'json':
    print(json.dumps({'account': account_info, 'models': model_results}, indent=2))
    sys.exit(0)


def print_section(title):
    print(f"\n{'─' * 60}")
    print(f"  {title}")
    print(f"{'─' * 60}")


print_section('ACCOUNT & USAGE')
print(f"  User:          {login}")
print(f"  Plan:          Copilot {plan.title()}")
print(f"  Orgs:          {', '.join(orgs) if orgs else 'none'}")
print(f"  Assigned:      {assigned}")
print(f"  Chat:          {'✓ enabled' if chat_enabled else '✗ disabled'} {'(unlimited)' if chat_q.get('unlimited') else ''}")
print(f"  Completions:   {'unlimited' if completions_q.get('unlimited') else 'limited'}")
print(f"  MCP:           {'✓ enabled' if mcp_enabled else '✗ disabled'}")

print_section('PREMIUM REQUEST USAGE')
bar_width = 30
pct_used = max(0.0, min(100.0, 100.0 - float(prem_pct_remaining or 0)))
filled = int(bar_width * pct_used / 100)
bar = '█' * filled + '░' * (bar_width - filled)
print(f"  [{bar}] {pct_used:.1f}% used")
print(f"  Used:          {prem_used:.1f} / {prem_entitlement}")
print(f"  Remaining:     {prem_remaining:.1f}")
print(f"  Overage:       {'allowed' if prem_overage_permitted else 'blocked'} (used: {prem_overage_count})")
print(f"  Reset:         {reset_date}")

print_section('AVAILABLE MODELS (CURRENT USER)')
print('  MULT = premium-request multiplier from Copilot SDK list_models()')

headers = ['MODEL_ID', 'NAME', 'MULT', 'CATEGORY', 'VENDOR', 'PREVIEW']
rows = []
for r in model_results:
    mult = r['multiplier']
    mult_s = 'unknown' if mult is None else f"{mult:g}x"
    rows.append([
        r['model'],
        r['name'],
        mult_s,
        r['category'] or '-',
        r['vendor'] or '-',
        'yes' if r['preview'] else 'no',
    ])

if fmt == 'tsv':
    print('\t'.join(headers))
    for row in rows:
        print('\t'.join(str(x) for x in row))
    sys.exit(0)

if not rows:
    print('  No models returned by Copilot SDK/API for this user/token.')
    sys.exit(0)

widths = [len(h) for h in headers]
for row in rows:
    widths = [max(w, len(str(cell))) for w, cell in zip(widths, row)]

fmt_line = '  '.join('{:<' + str(w) + '}' for w in widths)
print(fmt_line.format(*headers))
print(fmt_line.format(*['-' * w for w in widths]))
for row in rows:
    print(fmt_line.format(*row))
print()
PY