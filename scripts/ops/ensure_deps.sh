#!/bin/bash
# ensure_deps.sh — Install/sync Python dependencies from requirements.txt
# Run this after any git pull on the Droplet to ensure all deps are present.
# Safe to run repeatedly — pip is idempotent.

set -euo pipefail

REPO="/root/repos/cvc-intelligence"
REQ="$REPO/requirements.txt"

echo "[ensure_deps] Installing dependencies from $REQ..."
pip install -r "$REQ" --break-system-packages -q

echo "[ensure_deps] Done."
