#!/usr/bin/env bash
# install.sh — Bootstrap a new Vertical OS deployment from scratch.
#
# Usage:
#   bash scripts/install.sh
#
# What it does:
#   1. Checks required dependencies (Docker, Python 3.10+, Node 18+, psql client)
#   2. Copies .env.example → .env, sets a random JWT_SECRET and DB_PASSWORD
#   3. Prompts for team configuration → writes config/team.json
#   4. Starts the PostgreSQL Docker container
#   5. Creates the Python venv and installs requirements
#   6. Runs all DB migrations
#   7. Prints next steps

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "${RED}✗ ERROR:${NC} $*" >&2; exit 1; }
hdr()  { echo -e "\n${BOLD}$*${NC}"; }

# ── 1. Dependency checks ──────────────────────────────────────────────────────
hdr "Checking dependencies..."

check_cmd() {
    local cmd="$1" label="${2:-$1}"
    if ! command -v "$cmd" &>/dev/null; then
        die "$label is required but not installed. Install it and re-run."
    fi
    ok "$label found: $(command -v "$cmd")"
}

check_cmd docker   Docker
check_cmd python3  "Python 3"
check_cmd node     Node
check_cmd psql     "psql (PostgreSQL client)"

# Python version >= 3.10
PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
if [[ "$PY_MAJOR" -lt 3 || ( "$PY_MAJOR" -eq 3 && "$PY_MINOR" -lt 10 ) ]]; then
    die "Python 3.10+ required, found $PY_VER"
fi
ok "Python $PY_VER"

# Node version >= 18
NODE_VER=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 18 ]]; then
    die "Node 18+ required, found $NODE_VER"
fi
ok "Node $NODE_VER"

# Docker daemon running
if ! docker info &>/dev/null; then
    die "Docker daemon is not running. Start Docker and re-run."
fi
ok "Docker daemon running"

# ── 2. .env setup ─────────────────────────────────────────────────────────────
hdr "Setting up .env..."

if [[ -f "$REPO/.env" ]]; then
    warn ".env already exists — skipping. Edit it manually if needed."
else
    cp "$REPO/.env.example" "$REPO/.env"

    # Generate random secrets
    JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    DB_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(16))")

    # Inject into .env
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "$REPO/.env"
    sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" "$REPO/.env"

    ok ".env created with random JWT_SECRET and DB_PASSWORD"
fi

# Load .env
set -a; source "$REPO/.env"; set +a

# ── 3. Team configuration ─────────────────────────────────────────────────────
hdr "Team configuration..."

if [[ -f "$REPO/config/team.json" ]]; then
    EXISTING_NAME=$(python3 -c "import json; d=json.load(open('$REPO/config/team.json')); print(d.get('team_name',''))" 2>/dev/null || echo "")
    if [[ "$EXISTING_NAME" != "Vertical OS" && -n "$EXISTING_NAME" ]]; then
        warn "config/team.json already configured for \"$EXISTING_NAME\" — skipping."
        SKIP_CONFIG=true
    fi
fi

if [[ "${SKIP_CONFIG:-false}" == "false" ]]; then
    echo ""
    echo "Enter your team's details. Press Enter to accept the default."
    echo ""

    read -r -p "  Team name (e.g. Acme Ventures): " TEAM_NAME
    TEAM_NAME="${TEAM_NAME:-My VC Team}"

    read -r -p "  Short name / abbreviation (e.g. Acme): " TEAM_SHORT
    TEAM_SHORT="${TEAM_SHORT:-${TEAM_NAME}}"

    read -r -p "  Logo character (single letter shown in nav, e.g. A): " LOGO_CHAR
    LOGO_CHAR="${LOGO_CHAR:-${TEAM_SHORT:0:1}}"
    LOGO_CHAR="${LOGO_CHAR:0:1}"  # enforce single char

    read -r -p "  Fund name (e.g. Fund I): " FUND_NAME
    FUND_NAME="${FUND_NAME:-Fund I}"

    echo ""
    echo "  Sectors (comma-separated, e.g. SaaS, Fintech, Deep Tech):"
    read -r -p "  → " SECTORS_RAW
    SECTORS_RAW="${SECTORS_RAW:-Software, Other}"

    # Build JSON array from comma-separated input
    SECTORS_JSON=$(python3 -c "
import json, sys
raw = sys.argv[1]
sectors = [s.strip() for s in raw.split(',') if s.strip()]
if 'Other' not in sectors:
    sectors.append('Other')
print(json.dumps(sectors))
" "$SECTORS_RAW")

    python3 -c "
import json
config = {
    'team_name': '$TEAM_NAME',
    'team_short': '$TEAM_SHORT',
    'logo_char': '$LOGO_CHAR',
    'sectors': $SECTORS_JSON,
    'fund_names': ['$FUND_NAME'],
    'default_fund': '$FUND_NAME'
}
with open('$REPO/config/team.json', 'w') as f:
    json.dump(config, f, indent=2)
print('Written.')
"
    ok "config/team.json updated for \"$TEAM_NAME\""
fi

# ── 4. Start PostgreSQL ───────────────────────────────────────────────────────
hdr "Starting PostgreSQL..."

if docker ps --filter "name=platform-db" --filter "status=running" -q | grep -q .; then
    ok "PostgreSQL container already running"
else
    docker compose -f "$REPO/docker-compose.dev.yml" up -d
    echo -n "  Waiting for DB to be ready"
    for i in $(seq 1 30); do
        if docker exec platform-db pg_isready -U platform -d platform_db >/dev/null 2>&1; then
            echo " ready."
            break
        fi
        echo -n "."
        sleep 1
        if [[ "$i" -eq 30 ]]; then
            die "PostgreSQL did not become ready in 30s. Check: docker logs platform-db"
        fi
    done
    ok "PostgreSQL running"
fi

# ── 5. Python venv ────────────────────────────────────────────────────────────
hdr "Setting up Python environment..."

if [[ -d "$REPO/.venv" ]]; then
    ok "venv already exists — skipping"
else
    python3 -m venv "$REPO/.venv"
    "$REPO/.venv/bin/pip" install --quiet --upgrade pip
    "$REPO/.venv/bin/pip" install --quiet -r "$REPO/requirements.txt"
    ok "venv created and dependencies installed"
fi

# ── 6. Run migrations ─────────────────────────────────────────────────────────
hdr "Running DB migrations..."

bash "$REPO/scripts/migrate.sh"
ok "Migrations complete"

# ── 7. Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Installation complete.${NC}"
echo ""
echo "  Start the platform:    bash scripts/run_local.sh"
echo "  Start the frontend:    cd designs/figma-dashboard && npm install && npm run dev"
echo ""
echo "  Login at:              http://localhost:5173  (or :8002/app)"
echo "  Default credentials:   admin / changeme"
echo ""
echo -e "  ${YELLOW}Change the admin password via the Admin page after first login.${NC}"
echo ""
