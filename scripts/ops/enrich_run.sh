#!/bin/bash
# enrich_run.sh — Run company enrichment worker
#
# Usage (on Droplet):
#   bash /root/repos/cvc-intelligence/scripts/ops/enrich_run.sh           # default 100 companies
#   bash /root/repos/cvc-intelligence/scripts/ops/enrich_run.sh 250       # custom limit
#
# Fills sector, stage, city for companies where sector IS NULL.
# Logs to: /var/log/cvc_enrichment.log

set -uo pipefail

REPO="/root/repos/cvc-intelligence"
PYTHONPATH_VAL="/root/repos/cvc-intelligence/core"
LOG="/var/log/cvc_enrichment.log"
LIMIT="${1:-100}"

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
    echo "ERROR: Limit must be a number, got: $LIMIT"
    exit 1
fi

echo "Running enrichment — limit $LIMIT companies"
echo "Log: $LOG"
echo ""

cd "$REPO" || { echo "ERROR: Cannot cd to $REPO"; exit 1; }

PYTHONPATH="$PYTHONPATH_VAL" \
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
python3 workers/enrichment/enrich_worker.py --limit "$LIMIT" 2>&1 | tee -a "$LOG"

STATUS=${PIPESTATUS[0]}

if [ $STATUS -eq 0 ]; then
    echo "Enrichment complete."
else
    echo "ERROR: Enrichment exited with code $STATUS"
fi

exit $STATUS
