#!/bin/bash
# api_restart.sh — Restart the CVC Intelligence API (port 8001)
#
# Usage (on Droplet):
#   bash /root/repos/cvc-intelligence/scripts/ops/api_restart.sh
#
# Kills any existing process on port 8001, then relaunches.
# Check health at: curl http://localhost:8001/health
# Logs at: /var/log/cvc_api.log

set -uo pipefail

REPO="/root/repos/cvc-intelligence"
LOG="/var/log/cvc_api.log"
PORT=8001

echo "Restarting CVC API on port $PORT..."

# Kill existing
PID=$(lsof -ti tcp:$PORT 2>/dev/null || true)
if [ -n "$PID" ]; then
    echo "Killing existing process on port $PORT (PID $PID)"
    kill "$PID"
    sleep 2
fi

# Launch
cd "$REPO" || { echo "ERROR: Cannot cd to $REPO"; exit 1; }

nohup python3 -m uvicorn api.main:app \
    --host 0.0.0.0 \
    --port $PORT \
    >> "$LOG" 2>&1 &

NEW_PID=$!
echo "Launched (PID $NEW_PID)"
sleep 3

# Health check
HEALTH=$(curl -s --max-time 5 http://localhost:$PORT/health || echo "no response")
if echo "$HEALTH" | grep -q "ok\|healthy\|status"; then
    echo "Health check: OK"
    echo "Logs: tail -f $LOG"
    exit 0
else
    echo "WARNING: Health check returned: $HEALTH"
    echo "Check logs: tail -50 $LOG"
    exit 1
fi
