#!/bin/bash
# dd_run.sh — Run the full DD pipeline for a single company
#
# Usage (on Droplet):
#   bash /root/repos/cvc-intelligence/scripts/ops/dd_run.sh "Company Name"
#
# Prerequisites:
#   - Company files already in workdir/ (transferred via dd_transfer.sh on Refinery)
#   - OR a matching ZIP at /root/repos/cvc-intelligence/workers/dd/Company_Name.zip
#
# Outputs:
#   workdir/Company_Name/Company_Name_IC_Memo.pdf
#   workdir/Company_Name/Company_Name_Appendix.pdf
#   workdir/Company_Name/Company_Name_Scorecard.xlsx
#   Copies land at: C:\Users\nathan\OneDrive\Desktop\WORK OPEN CLAW\DD Input and output\Company_Name\

set -uo pipefail

COMPANY="${1:-}"

if [ -z "$COMPANY" ]; then
    echo "ERROR: Company name required"
    echo "Usage: bash dd_run.sh \"Company Name\""
    exit 1
fi

DD_DIR="/root/repos/cvc-intelligence/workers/dd"
PYTHONPATH_VAL="/root/repos/cvc-intelligence/core"

echo "========================================"
echo "DD Pipeline — $COMPANY"
echo "Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

cd "$DD_DIR" || { echo "ERROR: Cannot cd to $DD_DIR"; exit 1; }

PYTHONPATH="$PYTHONPATH_VAL" python3 run_three.py --company "$COMPANY"
STATUS=$?

if [ $STATUS -eq 0 ]; then
    echo ""
    echo "Done. Outputs at:"
    echo "  Droplet:  $DD_DIR/workdir/$(echo "$COMPANY" | tr ' ' '_')/"
    echo "  Windows:  DD Input and output\\$(echo "$COMPANY" | tr ' ' '_')\\"
else
    echo ""
    echo "ERROR: Pipeline exited with code $STATUS — check output above"
fi

exit $STATUS
