#!/usr/bin/env bash
set -euo pipefail

# copilot-info: Show GitHub Copilot plan, usage, and model pricing.
# Sources:
#   - Plan + usage: GitHub internal Copilot user API via `gh`
#   - Available CLI models: `gh copilot -- help config`
#   - Multipliers/pricing: github/docs raw data tables

OVERAGE_USD_PER_PRU="${OVERAGE_USD_PER_PRU:-0.04}"
FORMAT="table"

usage() {
  cat <<'EOF'
Usage: copilot-info [--json|--tsv|--table]

Shows your Copilot plan, current usage this month, and all available
CLI models with multipliers and per-token pricing.

Options:
  --json    Output everything as JSON
  --tsv     Output model table as TSV
  --table   Pretty-print (default)

Env:
  OVERAGE_USD_PER_PRU   Overage price per premium request unit (default: 0.04)
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
need python3

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

HELP_FILE="$TMPDIR/config-help.txt"
MULT_FILE="$TMPDIR/multipliers.yml"
PRICE_FILE="$TMPDIR/pricing.yml"
USER_FILE="$TMPDIR/user.json"

# Pull Copilot user info (plan, quota, orgs)
gh api /copilot_internal/user --jq '.' > "$USER_FILE" 2>/dev/null || echo '{}' > "$USER_FILE"

# Pull CLI model list
gh copilot -- help config > "$HELP_FILE"

# Pull public pricing/multiplier data
curl -fsSL "https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/model-multipliers.yml" \
  -o "$MULT_FILE"
curl -fsSL "https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml" \
  -o "$PRICE_FILE"

HELP_FILE="$HELP_FILE" \
MULT_FILE="$MULT_FILE" \
PRICE_FILE="$PRICE_FILE" \
USER_FILE="$USER_FILE" \
OVERAGE_USD_PER_PRU="$OVERAGE_USD_PER_PRU" \
FORMAT="$FORMAT" \
python3 <<'PY'
import json
import os
import re
import sys

help_file = os.environ["HELP_FILE"]
mult_file = os.environ["MULT_FILE"]
price_file = os.environ["PRICE_FILE"]
user_file = os.environ["USER_FILE"]
overage = float(os.environ["OVERAGE_USD_PER_PRU"])
fmt = os.environ["FORMAT"]


# --- Helpers ---

def clean_value(v: str):
    v = v.strip()
    if v in ("", "null"):
        return ""
    if (v.startswith("'") and v.endswith("'")) or (v.startswith('"') and v.endswith('"')):
        v = v[1:-1]
    v = v.replace("\\u2264", "≤").replace("\\_", "_")
    return v.strip()


def strip_footnotes(s: str) -> str:
    return re.sub(r"\\?\[\^\d+\\?\]", "", s).strip()


def parse_simple_yaml(path: str):
    rows, cur = [], None
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if line.startswith("- "):
                if cur is not None:
                    rows.append(cur)
                cur = {}
                rest = line[2:].strip()
                if rest and ":" in rest:
                    k, v = rest.split(":", 1)
                    cur[k.strip()] = clean_value(v)
            elif cur is not None and re.match(r"^\s+[A-Za-z0-9_]+\s*:", line):
                k, v = line.strip().split(":", 1)
                cur[k.strip()] = clean_value(v)
    if cur is not None:
        rows.append(cur)
    return rows


def cli_id_to_doc_name(model_id: str) -> str:
    exact = {
        "claude-opus-4.6-fast": "Claude Opus 4.6 (fast mode) (preview)",
        "gpt-5-mini": "GPT-5 mini",
    }
    if model_id in exact:
        return exact[model_id]
    m = re.match(r"^claude-(haiku|sonnet|opus)-(\d+(?:\.\d+)?)$", model_id)
    if m:
        family, version = m.groups()
        return f"Claude {family.title()} {version}"
    m = re.match(r"^gpt-(\d+(?:\.\d+)?)(?:-(codex|mini|nano))?$", model_id)
    if m:
        version, suffix = m.groups()
        if suffix == "codex":
            return f"GPT-{version}-Codex"
        if suffix in ("mini", "nano"):
            return f"GPT-{version} {suffix}"
        return f"GPT-{version}"
    return model_id


def extract_cli_models(path: str):
    models, in_block = [], False
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("  `model`:"):
                in_block = True
                continue
            if in_block and re.match(r"^  `[^`]+`:", line):
                break
            if in_block:
                m = re.match(r'\s+- "([^"]+)"\s*$', line)
                if m:
                    models.append(m.group(1))
    return models


# --- Load data ---

with open(user_file, "r") as f:
    user_data = json.load(f)

cli_models = extract_cli_models(help_file)

mult_rows = parse_simple_yaml(mult_file)
price_rows = parse_simple_yaml(price_file)

multipliers = {strip_footnotes(r.get("name", "")): r for r in mult_rows if r.get("name")}
prices = {strip_footnotes(r.get("model", "")): r for r in price_rows if r.get("model")}


# --- Build usage info ---

plan = user_data.get("copilot_plan", "unknown")
login = user_data.get("login", "unknown")
orgs = user_data.get("organization_login_list", [])
chat_enabled = user_data.get("chat_enabled", False)
mcp_enabled = user_data.get("is_mcp_enabled", False)
assigned = user_data.get("assigned_date", "unknown")
reset_date = user_data.get("quota_reset_date", "unknown")

quotas = user_data.get("quota_snapshots", {})

premium = quotas.get("premium_interactions", {})
prem_entitlement = premium.get("entitlement", 0)
prem_remaining = premium.get("remaining", 0)
prem_used = prem_entitlement - prem_remaining if prem_entitlement else 0
prem_pct_remaining = premium.get("percent_remaining", 100)
prem_overage_permitted = premium.get("overage_permitted", False)
prem_overage_count = premium.get("overage_count", 0)

chat_q = quotas.get("chat", {})
completions_q = quotas.get("completions", {})

account_info = {
    "login": login,
    "plan": plan,
    "organizations": orgs,
    "assigned_date": assigned,
    "chat_enabled": chat_enabled,
    "mcp_enabled": mcp_enabled,
    "premium_requests": {
        "entitlement": prem_entitlement,
        "used": round(prem_used, 1),
        "remaining": round(prem_remaining, 1),
        "percent_remaining": prem_pct_remaining,
        "overage_permitted": prem_overage_permitted,
        "overage_count": prem_overage_count,
        "reset_date": reset_date,
    },
    "chat": {"unlimited": chat_q.get("unlimited", False)},
    "completions": {"unlimited": completions_q.get("unlimited", False)},
}


# --- Build model table ---

model_results = []
for model_id in cli_models:
    doc_name = cli_id_to_doc_name(model_id)
    mult = multipliers.get(doc_name, {})
    price = prices.get(doc_name, {})

    mult_paid_raw = mult.get("multiplier_paid", "unknown")
    try:
        mult_paid_num = float(mult_paid_raw)
        effective = mult_paid_num * overage
        effective_s = "$0" if effective == 0 else f"${effective:.4g}"
    except Exception:
        mult_paid_num = None
        effective_s = "unknown"

    model_results.append({
        "model": model_id,
        "docs_name": doc_name,
        "paid_multiplier": mult_paid_raw,
        "free_multiplier": mult.get("multiplier_free", "unknown"),
        "effective_overage_usd": effective_s,
        "release_status": price.get("release_status", "unknown"),
        "category": price.get("category", "unknown"),
        "input_per_1m": price.get("input", "unknown"),
        "cached_input_per_1m": price.get("cached_input", "unknown"),
        "cache_write_per_1m": price.get("cache_write", ""),
        "output_per_1m": price.get("output", "unknown"),
        "notes": price.get("notes", ""),
    })


# --- Output ---

if fmt == "json":
    print(json.dumps({
        "account": account_info,
        "overage_usd_per_pru": overage,
        "models": model_results,
    }, indent=2))
    sys.exit(0)


def print_section(title):
    print(f"\n{'─' * 60}")
    print(f"  {title}")
    print(f"{'─' * 60}")


# Account & usage
print_section("ACCOUNT & USAGE")
print(f"  User:          {login}")
print(f"  Plan:          Copilot {plan.title()}")
print(f"  Orgs:          {', '.join(orgs) if orgs else 'none'}")
print(f"  Assigned:      {assigned}")
print(f"  Chat:          {'✓ enabled' if chat_enabled else '✗ disabled'} {'(unlimited)' if chat_q.get('unlimited') else ''}")
print(f"  Completions:   {'unlimited' if completions_q.get('unlimited') else 'limited'}")
print(f"  MCP:           {'✓ enabled' if mcp_enabled else '✗ disabled'}")

print_section("PREMIUM REQUEST USAGE")
bar_width = 30
pct_used = 100 - prem_pct_remaining
filled = int(bar_width * pct_used / 100)
bar = "█" * filled + "░" * (bar_width - filled)
print(f"  [{bar}] {pct_used:.1f}% used")
print(f"  Used:          {prem_used:.1f} / {prem_entitlement}")
print(f"  Remaining:     {prem_remaining:.1f}")
print(f"  Overage:       {'allowed' if prem_overage_permitted else 'blocked'} (used: {prem_overage_count})")
print(f"  Reset:         {reset_date}")
print(f"  Overage rate:  ${overage:.2f} per premium request unit")

# Model table
print_section("AVAILABLE MODELS")
print("  MULT       = Premium request multiplier (how many PRUs one interaction costs)")
print("  OVERAGE    = Cost per interaction if you exceed your 300 included PRUs")
print("  INPUT/1M   = Price per 1M input tokens (usage-based billing, from June 2026)")
print("  OUTPUT/1M  = Price per 1M output tokens")
print("  CACHED/1M  = Price per 1M cached input tokens")
print("  WRITE/1M   = Price per 1M cache-write tokens (Anthropic only)")
print()

headers = ["MODEL", "MULT", "OVERAGE", "INPUT/1M", "OUTPUT/1M", "CACHED/1M", "WRITE/1M"]
rows = []
for r in model_results:
    mult = r["paid_multiplier"]
    mult_s = f"{mult}x" if mult not in ("unknown", "Not applicable") else mult
    rows.append([
        r["model"],
        mult_s,
        r["effective_overage_usd"],
        r["input_per_1m"],
        r["output_per_1m"],
        r["cached_input_per_1m"],
        r["cache_write_per_1m"],
    ])

if fmt == "tsv":
    print("\t".join(headers))
    for row in rows:
        print("\t".join(str(x) for x in row))
    sys.exit(0)

widths = [len(h) for h in headers]
for row in rows:
    widths = [max(w, len(str(cell))) for w, cell in zip(widths, row)]

fmt_line = "  ".join("{:<" + str(w) + "}" for w in widths)
print(fmt_line.format(*headers))
print(fmt_line.format(*["-" * w for w in widths]))
for row in rows:
    print(fmt_line.format(*row))

unknown = [r["model"] for r in model_results if r["paid_multiplier"] == "unknown" or r["input_per_1m"] == "unknown"]
if unknown:
    print(f"\n  ⚠ Not in public docs table: {', '.join(unknown)}")

print()
PY
