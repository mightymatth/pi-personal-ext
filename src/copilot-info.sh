#!/usr/bin/env bash
set -euo pipefail

# copilot-info: Show GitHub Copilot plan, usage, available models, and billing.
# Sources:
#   - Plan + usage: GitHub internal Copilot user API via `gh`
#   - Available models: Copilot models API via /copilot_internal/user.endpoints.api
#   - Billing rates: github/docs pricing tables

FORMAT="table"

usage() {
  cat <<'EOF'
Usage: copilot-info [--json|--tsv|--table]

Shows your Copilot plan, current usage, and models currently available to your
logged-in user. Displays per-token AI credit pricing for usage-based accounts,
or premium-request multipliers for legacy request-based accounts.

Options:
  --json    Output everything as JSON
  --tsv     Output the model billing table as TSV
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
need python3

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

USER_FILE="$TMPDIR/user.json"
API_MODELS_FILE="$TMPDIR/api-models.json"
PRICE_FILE="$TMPDIR/models-and-pricing.yml"
MULTIPLIER_FILE="$TMPDIR/annual-subscriber-model-multipliers.yml"

gh api /copilot_internal/user --jq '.' > "$USER_FILE" 2>/dev/null || echo '{}' > "$USER_FILE"

API_BASE="$(USER_FILE="$USER_FILE" python3 - <<'PY'
import json
import os

try:
    with open(os.environ["USER_FILE"], "r", encoding="utf-8") as f:
        user = json.load(f)
    print(user.get("endpoints", {}).get("api") or "https://api.githubcopilot.com")
except (OSError, TypeError, ValueError):
    print("https://api.githubcopilot.com")
PY
)"

GH_TOKEN="$(gh auth token 2>/dev/null || true)"
if [[ -n "$GH_TOKEN" ]]; then
  curl -fsSL -H "Authorization: Bearer $GH_TOKEN" "$API_BASE/models" \
    -o "$API_MODELS_FILE" 2>/dev/null || echo '{"data":[]}' > "$API_MODELS_FILE"
else
  echo '{"data":[]}' > "$API_MODELS_FILE"
fi

curl -fsSL \
  "https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml" \
  -o "$PRICE_FILE"
curl -fsSL \
  "https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/annual-subscriber-model-multipliers.yml" \
  -o "$MULTIPLIER_FILE"

USER_FILE="$USER_FILE" \
API_MODELS_FILE="$API_MODELS_FILE" \
PRICE_FILE="$PRICE_FILE" \
MULTIPLIER_FILE="$MULTIPLIER_FILE" \
FORMAT="$FORMAT" \
python3 <<'PY'
import json
import os
import re
import sys
from typing import Any


def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def clean_yaml_value(value: str) -> str:
    value = value.strip()
    if value in ("", "null"):
        return ""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        value = value[1:-1]
    return value.replace("\\u2264", "≤").replace("\\_", "_").strip()


def parse_simple_yaml(path: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if line.startswith("- "):
                if current is not None:
                    rows.append(current)
                current = {}
                remainder = line[2:].strip()
                if ":" in remainder:
                    key, value = remainder.split(":", 1)
                    current[key.strip()] = clean_yaml_value(value)
            elif current is not None and re.match(r"^\s+[A-Za-z0-9_]+\s*:", line):
                key, value = line.strip().split(":", 1)
                current[key.strip()] = clean_yaml_value(value)
    if current is not None:
        rows.append(current)
    return rows


def normalize_model_name(value: str) -> str:
    return re.sub(r"\[\^[^]]+\]", "", value).strip().casefold()


def print_section(title: str) -> None:
    print(f"\n{'─' * 60}")
    print(f"  {title}")
    print(f"{'─' * 60}")


def render_table(headers: list[str], rows: list[list[str]]) -> None:
    widths = [len(header) for header in headers]
    for row in rows:
        widths = [max(width, len(cell)) for width, cell in zip(widths, row)]
    render_row = lambda cells: "  ".join(
        cell.ljust(width) for cell, width in zip(cells, widths)
    ).rstrip()
    print(render_row(headers))
    print(render_row(["-" * width for width in widths]))
    for row in rows:
        print(render_row(row))


user_data = load_json(os.environ["USER_FILE"])
api_models_data = load_json(os.environ["API_MODELS_FILE"])
price_rows = parse_simple_yaml(os.environ["PRICE_FILE"])
multiplier_rows = parse_simple_yaml(os.environ["MULTIPLIER_FILE"])
fmt = os.environ["FORMAT"]

if not isinstance(user_data, dict):
    user_data = {}
if not isinstance(api_models_data, dict):
    api_models_data = {}

plan = user_data.get("copilot_plan", "unknown")
login = user_data.get("login", "unknown")
orgs = user_data.get("organization_login_list", [])
chat_enabled = user_data.get("chat_enabled", False)
mcp_enabled = user_data.get("is_mcp_enabled", False)
assigned = user_data.get("assigned_date", "unknown")
reset_date = user_data.get("quota_reset_date", "unknown")
quotas = user_data.get("quota_snapshots", {})
premium = quotas.get("premium_interactions", {}) if isinstance(quotas, dict) else {}
chat_quota = quotas.get("chat", {}) if isinstance(quotas, dict) else {}
completions_quota = quotas.get("completions", {}) if isinstance(quotas, dict) else {}
token_based_billing = bool(
    user_data.get("token_based_billing", premium.get("token_based_billing", False))
)
billing_model = "ai_credits" if token_based_billing else "premium_requests"

entitlement = premium.get("entitlement", 0)
if token_based_billing:
    used = premium.get("credits_used", 0)
    remaining = premium.get("quota_remaining", premium.get("remaining", 0))
else:
    remaining = premium.get("remaining", 0)
    used = entitlement - remaining if entitlement else 0
percent_remaining = premium.get("percent_remaining", 100)
percent_used = max(0.0, min(100.0, 100.0 - float(percent_remaining or 0)))
overage_permitted = premium.get("overage_permitted", False)
overage_count = premium.get("overage_count", 0)

usage_info = {
    "billing_model": billing_model,
    "entitlement": entitlement,
    "used": used,
    "remaining": remaining,
    "percent_remaining": percent_remaining,
    "overage_permitted": overage_permitted,
    "overage_count": overage_count,
    "reset_date": reset_date,
}
account_info = {
    "login": login,
    "plan": plan,
    "organizations": orgs,
    "assigned_date": assigned,
    "chat_enabled": chat_enabled,
    "mcp_enabled": mcp_enabled,
    "token_based_billing": token_based_billing,
    "usage": usage_info,
    "chat": {"unlimited": chat_quota.get("unlimited", False)},
    "completions": {"unlimited": completions_quota.get("unlimited", False)},
}

prices_by_name: dict[str, list[dict[str, str]]] = {}
for row in price_rows:
    name = row.get("model")
    if name:
        prices_by_name.setdefault(normalize_model_name(name), []).append(row)

multipliers_by_name = {
    normalize_model_name(row["model"]): row.get("new_multiplier")
    for row in multiplier_rows
    if row.get("model")
}

models: list[dict[str, Any]] = []
seen: set[str] = set()
for model in api_models_data.get("data", []):
    if not isinstance(model, dict):
        continue
    model_id = model.get("id")
    if not model_id or model_id == "auto" or model_id in seen:
        continue
    if not model.get("model_picker_enabled", False):
        continue
    policy = model.get("policy") or {}
    if policy.get("state") not in (None, "", "enabled"):
        continue

    seen.add(model_id)
    name = model.get("name") or model_id
    result: dict[str, Any] = {
        "model": model_id,
        "name": name,
        "category": model.get("model_picker_category") or "",
        "vendor": model.get("vendor") or "",
        "preview": bool(model.get("preview", False)),
    }
    normalized_name = normalize_model_name(name)
    if token_based_billing:
        result["billing"] = {
            "type": "token_prices",
            "unit": "USD per 1M tokens",
            "tiers": [
                {
                    "tier": row.get("tier") or "Default",
                    "threshold": row.get("threshold") or "Not applicable",
                    "input": row.get("input") or None,
                    "cached_input": row.get("cached_input") or None,
                    "cache_write": row.get("cache_write") or None,
                    "output": row.get("output") or None,
                }
                for row in prices_by_name.get(normalized_name, [])
            ],
        }
    else:
        multiplier = multipliers_by_name.get(normalized_name)
        result["billing"] = {
            "type": "premium_request_multiplier",
            "multiplier": float(multiplier) if multiplier is not None else None,
        }
    models.append(result)

if fmt == "json":
    print(json.dumps({"account": account_info, "models": models}, indent=2))
    sys.exit(0)

model_headers: list[str]
model_rows: list[list[str]] = []
if token_based_billing:
    model_headers = [
        "MODEL_ID", "NAME", "TIER", "THRESHOLD", "INPUT", "CACHED", "WRITE", "OUTPUT",
        "CATEGORY", "VENDOR", "PREVIEW",
    ]
    for model in models:
        tiers = model["billing"]["tiers"] or [{}]
        for tier in tiers:
            model_rows.append([
                str(model["model"]),
                str(model["name"]),
                str(tier.get("tier") or "unavailable"),
                str(tier.get("threshold") or "-"),
                str(tier.get("input") or "unavailable"),
                str(tier.get("cached_input") or "-"),
                str(tier.get("cache_write") or "-"),
                str(tier.get("output") or "unavailable"),
                str(model["category"] or "-"),
                str(model["vendor"] or "-"),
                "yes" if model["preview"] else "no",
            ])
else:
    model_headers = ["MODEL_ID", "NAME", "MULT", "CATEGORY", "VENDOR", "PREVIEW"]
    for model in models:
        multiplier = model["billing"]["multiplier"]
        model_rows.append([
            str(model["model"]),
            str(model["name"]),
            "unavailable" if multiplier is None else f"{multiplier:g}x",
            str(model["category"] or "-"),
            str(model["vendor"] or "-"),
            "yes" if model["preview"] else "no",
        ])

if fmt == "tsv":
    print("\t".join(model_headers))
    for row in model_rows:
        print("\t".join(row))
    sys.exit(0)

print_section("ACCOUNT & USAGE")
print(f"  User:          {login}")
print(f"  Plan:          Copilot {str(plan).title()}")
print(f"  Orgs:          {', '.join(orgs) if orgs else 'none'}")
print(f"  Assigned:      {assigned}")
print(f"  Billing:       {'AI credits (usage-based)' if token_based_billing else 'premium requests (legacy)'}")
print(f"  Chat:          {'✓ enabled' if chat_enabled else '✗ disabled'} {'(unlimited)' if chat_quota.get('unlimited') else ''}")
print(f"  Completions:   {'unlimited' if completions_quota.get('unlimited') else 'limited'}")
print(f"  MCP:           {'✓ enabled' if mcp_enabled else '✗ disabled'}")

print_section("AI CREDIT USAGE" if token_based_billing else "PREMIUM REQUEST USAGE")
bar_width = 30
filled = int(bar_width * percent_used / 100)
bar = "█" * filled + "░" * (bar_width - filled)
unit = "credits" if token_based_billing else "requests"
print(f"  [{bar}] {percent_used:.1f}% used")
print(f"  Used:          {used:g} / {entitlement:g} {unit}")
print(f"  Remaining:     {remaining:g} {unit}")
print(f"  Overage:       {'allowed' if overage_permitted else 'blocked'} (used: {overage_count:g})")
print(f"  Reset:         {reset_date}")

print_section("AVAILABLE MODELS (CURRENT USER)")
if token_based_billing:
    print("  Prices are USD per 1M tokens; premium-request multipliers do not apply.")
else:
    print("  MULT = premium-request multiplier for legacy annual Pro/Pro+ billing.")

if not model_rows:
    print("  No models returned by the Copilot models API for this user/token.")
    sys.exit(0)

render_table(model_headers, model_rows)
print()
PY
