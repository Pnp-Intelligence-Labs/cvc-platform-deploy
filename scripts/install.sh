#!/usr/bin/env bash
# install.sh — Bootstrap a new Vertical OS deployment from scratch.
#
# Usage:
#   bash scripts/install.sh
#
# What it does:
#   1. Checks required dependencies (Docker, Python 3.10+, Node 18+, psql client)
#   2. Copies .env.example → .env, sets a random JWT_SECRET
#   3. Prompts for team configuration → writes config/team.json
#   4. Builds the React frontend (npm install + npm run build)
#   5. Starts the PostgreSQL Docker container
#   6. Creates the Python venv and installs requirements
#   7. Runs all DB migrations
#   8. Installs plugins (copies from _staging/packages/ → installed/)
#   9. Prints next steps

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
    MINIO_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")

    # Inject into .env (GNU sed vs BSD/macOS sed)
    if sed --version 2>/dev/null | grep -q GNU; then
        sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "$REPO/.env"
        sed -i "s|^MINIO_SECRET_KEY=.*|MINIO_SECRET_KEY=${MINIO_SECRET}|" "$REPO/.env"
    else
        sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "$REPO/.env"
        sed -i '' "s|^MINIO_SECRET_KEY=.*|MINIO_SECRET_KEY=${MINIO_SECRET}|" "$REPO/.env"
    fi

    ok ".env created with random JWT_SECRET and MINIO_SECRET_KEY"
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

    python3 - "$TEAM_NAME" "$TEAM_SHORT" "$LOGO_CHAR" "$FUND_NAME" "$REPO" <<PYEOF
import json, sys
team_name, team_short, logo_char, fund_name, repo = sys.argv[1:]
sectors = $SECTORS_JSON
config = {
    'team_name': team_name,
    'team_short': team_short,
    'logo_char': logo_char,
    'sectors': sectors,
    'fund_names': [fund_name],
    'default_fund': fund_name,
}
with open(f'{repo}/config/team.json', 'w') as f:
    json.dump(config, f, indent=2)
print('Written.')
PYEOF
    ok "config/team.json updated for \"$TEAM_NAME\""
fi

# ── 4. Build frontend ─────────────────────────────────────────────────────────
hdr "Building frontend..."

FRONTEND_DIR="$REPO/designs/figma-dashboard"

if [[ ! -d "$FRONTEND_DIR" ]]; then
    die "Frontend directory not found at $FRONTEND_DIR"
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    echo "  Installing Node dependencies..."
    npm --prefix "$FRONTEND_DIR" install --silent
    ok "Node dependencies installed"
else
    ok "Node dependencies already installed"
fi

echo "  Building React app → api/static/app..."
npm --prefix "$FRONTEND_DIR" run build
ok "Frontend built"

# ── 5. Start PostgreSQL ───────────────────────────────────────────────────────
hdr "Starting PostgreSQL..."

# Fix Docker credential store issue common on WSL2 — desktop.exe creds fail in non-GUI sessions
DOCKER_CFG="${HOME}/.docker/config.json"
if [[ -f "$DOCKER_CFG" ]] && python3 -c "import json; d=json.load(open('$DOCKER_CFG')); exit(0 if 'credsStore' in d else 1)" 2>/dev/null; then
    warn "Docker credential store detected (may fail in WSL2/SSH) — removing credsStore..."
    python3 -c "
import json
with open('$DOCKER_CFG') as f: cfg = json.load(f)
cfg.pop('credsStore', None)
with open('$DOCKER_CFG', 'w') as f: json.dump(cfg, f, indent=2)
"
    ok "Docker config patched"
fi

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

# ── 6. Python venv ────────────────────────────────────────────────────────────
hdr "Setting up Python environment..."

if [[ -d "$REPO/.venv" ]]; then
    ok "venv already exists — skipping"
else
    # Try standard venv first; fall back to --without-pip if python3-venv is missing
    # (common on Ubuntu 24.04 where python3-venv requires apt and may not be installed)
    if python3 -m venv "$REPO/.venv" 2>/dev/null; then
        ok "venv created"
    else
        warn "python3-venv not available — bootstrapping without pip..."
        python3 -m venv --without-pip "$REPO/.venv"
        curl -sSL https://bootstrap.pypa.io/get-pip.py | "$REPO/.venv/bin/python3"
        ok "venv created (pip bootstrapped)"
    fi
    "$REPO/.venv/bin/pip" install --quiet --upgrade pip
    "$REPO/.venv/bin/pip" install --quiet -r "$REPO/requirements.txt"
    ok "Python dependencies installed"
fi

# ── 7. Run migrations ─────────────────────────────────────────────────────────
hdr "Running DB migrations..."

bash "$REPO/scripts/migrate.sh"
ok "Migrations complete"

# ── 8. Install plugins ────────────────────────────────────────────────────────
hdr "Installing plugins..."

STAGING_PKGS="$REPO/plugins/_staging/packages"
INSTALLED="$REPO/plugins/installed"
mkdir -p "$INSTALLED"

# Core plugins installed by default (can be extended by the team)
DEFAULT_PLUGINS=(
    "enrichment"
    "industrial-matrix"
    "intelligence-feed"
    "lp-portal"
    "news-feed"
    "trend-reports"
    "data-explorer"
)

echo ""
echo "  Available plugins (default: all selected)."
echo "  Press ENTER to accept, or type 'n' to skip each one."
echo ""

for slug in "${DEFAULT_PLUGINS[@]}"; do
    src="$STAGING_PKGS/$slug"
    dst="$INSTALLED/$slug"

    if [[ ! -d "$src" ]]; then
        warn "Plugin '$slug' not found in _staging/packages — skipping"
        continue
    fi

    if [[ -d "$dst" ]]; then
        ok "Plugin already installed: $slug"
        continue
    fi

    read -rp "  Install plugin '$slug'? [Y/n] " choice
    choice="${choice:-Y}"
    if [[ "$choice" =~ ^[Yy]$ ]]; then
        cp -r "$src" "$dst"
        ok "Installed: $slug"
        # Run plugin-specific migrations if present
        if [[ -d "$dst/migrations" ]]; then
            for mig in $(ls "$dst/migrations"/*.sql 2>/dev/null | sort); do
                echo "    → migration: $(basename "$mig")"
                PGPASSWORD="${DB_PASSWORD:-platform_local}" psql \
                    -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" \
                    -U "${DB_USER:-platform}" -d "${DB_NAME:-platform_db}" \
                    -v ON_ERROR_STOP=0 -q -f "$mig" 2>/dev/null || true
            done
        fi
    else
        warn "Skipped: $slug"
    fi
done

echo ""

# ── 9. Demo seed (optional) ───────────────────────────────────────────────────
hdr "Demo data..."
echo ""
echo "  Load 30 sample companies, 4 partners, and pipeline data so the platform"
echo "  looks populated on first login? Useful for demos and evaluation."
echo ""
read -rp "  Load demo data? [y/N] " seed_choice
seed_choice="${seed_choice:-N}"
if [[ "$seed_choice" =~ ^[Yy]$ ]]; then
    "$REPO/.venv/bin/python3" "$REPO/scripts/seed_demo.py" && ok "Demo data loaded"
else
    warn "Skipped demo data — run 'python3 scripts/seed_demo.py' anytime to load it"
fi

echo ""

# ── 10. Done ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Installation complete.${NC}"
echo ""
echo "  Start the API:         bash scripts/run_local.sh"
echo "  Dev frontend:          cd designs/figma-dashboard && npm run dev"
echo "  Production frontend:   already built → served at http://localhost:8002/app"
echo ""
echo "  Login at:              http://localhost:5173  (dev)  or  :8002/app  (production)"
echo "  Default credentials:   admin / changeme"
echo ""
echo -e "  ${YELLOW}Change the admin password via the Admin page after first login.${NC}"
echo -e "  ${YELLOW}See config/team.example.json for what to customize next.${NC}"
echo -e "  ${YELLOW}Add/remove plugins: copy folders between plugins/_staging/packages/ and plugins/installed/.${NC}"
echo ""
