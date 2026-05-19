#!/bin/bash
# db_check.sh — Quick database health check
#
# Usage (on Droplet):
#   bash /root/repos/cvc-intelligence/scripts/ops/db_check.sh
#
# Reports: company counts, task queue status, recent DD evaluations

set -uo pipefail

PSQL="psql -h localhost -U producer -d cvc_db"

echo "=== CVC DB Health Check — $(date '+%Y-%m-%d %H:%M:%S') ==="
echo ""

echo "--- Companies ---"
$PSQL -c "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE sector IS NOT NULL) AS enriched FROM cvc.companies;" 2>&1

echo ""
echo "--- Task Queue ---"
$PSQL -c "SELECT status, COUNT(*) FROM cvc.build_tasks GROUP BY status ORDER BY status;" 2>&1

echo ""
echo "--- DD Evaluations (last 10) ---"
$PSQL -c "SELECT company_name, created_at::date, recommendation FROM cvc.dd_evaluations ORDER BY created_at DESC LIMIT 10;" 2>&1

echo ""
echo "--- Agent Memory (last 5 entries) ---"
$PSQL -c "SELECT agent, date, entry_type, written_by, LEFT(content, 80) AS preview FROM cvc.agent_memory ORDER BY created_at DESC LIMIT 5;" 2>&1
