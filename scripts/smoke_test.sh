#!/usr/bin/env bash
# smoke_test.sh — API smoke test for Vertical OS
#
# Usage:
#   bash scripts/smoke_test.sh [BASE_URL] [USERNAME] [PASSWORD]
#
# Defaults:
#   BASE_URL  = http://localhost:8002
#   USERNAME  = admin
#   PASSWORD  = changeme
#
# Exit code: 0 = all checks pass, 1 = one or more checks failed

BASE_URL="${1:-http://localhost:8002}"
USERNAME="${2:-admin}"
PASSWORD="${3:-changeme}"

PASS=0
FAIL=0
RESULTS=()

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
RESET="\033[0m"

pass() { echo -e "  ${GREEN}PASS${RESET}  $1"; PASS=$((PASS+1)); RESULTS+=("PASS: $1"); }
fail() { echo -e "  ${RED}FAIL${RESET}  $1${2:+ — }${2:-}"; FAIL=$((FAIL+1)); RESULTS+=("FAIL: $1${2:+ — }${2:-}"); }
section() { echo -e "\n${YELLOW}── $1 ──${RESET}"; }

# ── Helper: HTTP status check ─────────────────────────────────────────────────
# check NAME URL [EXPECTED_STATUS] [EXTRA_CURL_ARGS...]
check() {
    local name="$1"
    local url="$2"
    local expected="${3:-200}"
    shift 3
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" "$@" "$url")
    if [[ "$status" == "$expected" ]]; then
        pass "$name (HTTP $status)"
    else
        fail "$name" "expected HTTP $expected, got $status"
    fi
}

# ── Helper: JSON field check ──────────────────────────────────────────────────
# json_check NAME URL JSON_FIELD EXPECTED_VALUE [EXTRA_CURL_ARGS...]
json_check() {
    local name="$1"
    local url="$2"
    local field="$3"
    local expected="$4"
    shift 4
    local body
    body=$(curl -s "$@" "$url")
    local actual
    actual=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$field',''))" 2>/dev/null)
    if [[ "$actual" == "$expected" ]]; then
        pass "$name ($field=$expected)"
    else
        fail "$name" "expected $field='$expected', got '$actual'"
    fi
}

echo ""
echo "========================================"
echo "  Vertical OS — Smoke Test"
echo "  ${BASE_URL}"
echo "========================================"

# ── 1. Health check (no auth) ─────────────────────────────────────────────────
section "Health"
json_check "/health endpoint" "${BASE_URL}/health" "status" "ok"

# ── 2. Login ──────────────────────────────────────────────────────────────────
section "Authentication"

LOGIN_BODY=$(curl -s -X POST "${BASE_URL}/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")

TOKEN=$(echo "$LOGIN_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null)

if [[ -z "$TOKEN" || "$TOKEN" == "None" ]]; then
    fail "Login as ${USERNAME}" "no token returned — is the API running? Is the user seeded?"
    echo ""
    echo -e "${RED}Cannot continue without a valid token. Aborting.${RESET}"
    exit 1
else
    pass "Login as ${USERNAME} → Bearer token obtained"
fi

AUTH=(-H "Authorization: Bearer ${TOKEN}")

# Confirm /auth/me works
check "/auth/me" "${BASE_URL}/auth/me" 200 "${AUTH[@]}"

# ── 3. Core data routes ───────────────────────────────────────────────────────
section "Core Data Routes"
check "GET /companies/"          "${BASE_URL}/companies/"          200 "${AUTH[@]}"
check "GET /companies/sectors"   "${BASE_URL}/companies/sectors"   200 "${AUTH[@]}"
check "GET /partners/"           "${BASE_URL}/partners/"           200 "${AUTH[@]}"
check "GET /sourcing/"           "${BASE_URL}/sourcing/"           200 "${AUTH[@]}"
check "GET /requests"            "${BASE_URL}/requests"            200 "${AUTH[@]}"
check "GET /sales/targets"       "${BASE_URL}/sales/targets"       200 "${AUTH[@]}"
check "GET /shortlists/"         "${BASE_URL}/shortlists/"         200 "${AUTH[@]}"
check "GET /dealflow/"           "${BASE_URL}/dealflow/"           200 "${AUTH[@]}"

# ── 4. Home / dashboard routes ────────────────────────────────────────────────
section "Home & Dashboard"
check "GET /home/team-activity"  "${BASE_URL}/home/team-activity"  200 "${AUTH[@]}"
check "GET /home/dashboard"      "${BASE_URL}/home/dashboard"       200 "${AUTH[@]}"
check "GET /home/leaderboards"   "${BASE_URL}/home/leaderboards"    200 "${AUTH[@]}"

# ── 5. Admin routes ───────────────────────────────────────────────────────────
section "Admin Routes"
check "GET /admin/kpis"              "${BASE_URL}/admin/kpis"              200 "${AUTH[@]}"
check "GET /admin/plugins/health"    "${BASE_URL}/admin/plugins/health"    200 "${AUTH[@]}"
check "GET /auth/users"              "${BASE_URL}/auth/users"              200 "${AUTH[@]}"

# ── 6. Config routes ──────────────────────────────────────────────────────────
section "Config"
check "GET /config/plugins"          "${BASE_URL}/config/plugins"          200

# ── 7. Ventures (assignments) ─────────────────────────────────────────────────
section "Ventures"
check "GET /ventures/assignments"    "${BASE_URL}/ventures/assignments"    200 "${AUTH[@]}"

# ── 8. Data checks ───────────────────────────────────────────────────────────
section "Data Integrity"

COMPANY_COUNT=$(curl -s "${AUTH[@]}" "${BASE_URL}/companies/" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else d.get('count', d.get('total', '?')))" 2>/dev/null)

if [[ "$COMPANY_COUNT" == "?" ]] || [[ -z "$COMPANY_COUNT" ]]; then
    fail "Company count" "could not parse response"
elif [[ "$COMPANY_COUNT" -eq 0 ]]; then
    fail "Company count" "0 companies — run seed_demo.py or import data"
else
    pass "Company count > 0 ($COMPANY_COUNT companies found)"
fi

PARTNER_COUNT=$(curl -s "${AUTH[@]}" "${BASE_URL}/partners/" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else d.get('count', d.get('total', '?')))" 2>/dev/null)

if [[ "$PARTNER_COUNT" =~ ^[0-9]+$ ]] && [[ "$PARTNER_COUNT" -gt 0 ]]; then
    pass "Partner count > 0 ($PARTNER_COUNT partners found)"
else
    fail "Partner count" "0 partners or unreadable — add partners or run seed_demo.py"
fi

# ── 9. Optional plugin routes ─────────────────────────────────────────────────
section "Plugin Routes (skipped if not installed)"

check_plugin() {
    local name="$1"
    local url="$2"
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$url")
    if [[ "$status" == "200" ]]; then
        pass "${name} (installed, HTTP 200)"
    elif [[ "$status" == "404" || "$status" == "000" ]]; then
        echo -e "  ${YELLOW}SKIP${RESET}  ${name} (not installed)"
    else
        fail "${name}" "unexpected HTTP $status"
    fi
}

check_plugin "Enrichment plugin   GET /enrichment/requests"  "${BASE_URL}/enrichment/requests"
check_plugin "LP Portal plugin    GET /lp/overview"          "${BASE_URL}/lp/overview"
check_plugin "News Feed plugin    GET /news/companies"       "${BASE_URL}/news/companies"
check_plugin "Intel Feed plugin   GET /intel/"               "${BASE_URL}/intel/"
check_plugin "Trend Reports       GET /reports/"             "${BASE_URL}/reports/"
check_plugin "Industrial Matrix   GET /industrial/matrix"    "${BASE_URL}/industrial/matrix"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
printf "  PASS: %d   FAIL: %d\n" "$PASS" "$FAIL"
echo "========================================"

if [[ "$FAIL" -gt 0 ]]; then
    echo ""
    echo -e "${RED}Failed checks:${RESET}"
    for r in "${RESULTS[@]}"; do
        if [[ "$r" == FAIL:* ]]; then
            echo "  $r"
        fi
    done
    echo ""
    exit 1
else
    echo -e "\n${GREEN}All checks passed.${RESET}\n"
    exit 0
fi
