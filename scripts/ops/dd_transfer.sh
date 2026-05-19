#!/bin/bash
# dd_transfer.sh — Transfer a DD dataroom from Windows to the Droplet
#
# Run this ON REFINERY (Big Claw's WSL machine, 100.114.250.70).
# BigBossHog triggers it via: ssh nathan@100.114.250.70 wsl bash ~/scripts/dd_transfer.sh "Company Name"
#
# Usage:
#   bash dd_transfer.sh "Company Name"
#   bash dd_transfer.sh "10Four" "10Four Inc"   # if folder name differs from company name
#
# Searches: C:\Users\nathan\OneDrive\Desktop\WORK OPEN CLAW\DD Input and output\
# Deposits on Droplet: /root/repos/cvc-intelligence/workers/dd/workdir/Company_Name/
#
# Handles both folders (rsync) and ZIPs (scp).
# Prints the exact run_three.py command on success.

set -uo pipefail

DD_INPUT="/mnt/c/Users/nathan/OneDrive/Desktop/WORK OPEN CLAW/DD Input and output"
DROPLET="root@100.95.2.44"
DROPLET_WORKDIR="/root/repos/cvc-intelligence/workers/dd/workdir"

SEARCH="${1:-}"
COMPANY="${2:-$SEARCH}"

if [ -z "$SEARCH" ]; then
    echo "ERROR: Company name required"
    echo "Usage: bash dd_transfer.sh \"Company Name\""
    echo ""
    echo "Available in DD Input folder:"
    ls "$DD_INPUT"
    exit 1
fi

MATCH=$(find "$DD_INPUT" -maxdepth 3 -iname "*${SEARCH}*" \( -type d -o -name "*.zip" \) | head -5)

if [ -z "$MATCH" ]; then
    echo "ERROR: Nothing matching '$SEARCH' found in DD Input folder"
    echo ""
    echo "Available:"
    ls "$DD_INPUT"
    exit 1
fi

FOLDER=$(echo "$MATCH" | grep -v "\.zip" | sort -r | head -1)
ZIP=$(echo "$MATCH" | grep "\.zip" | head -1)

if [ -n "$FOLDER" ] && [ -d "$FOLDER" ]; then
    echo "Found folder: $FOLDER"
    echo "Transferring to Droplet as: $COMPANY"
    echo ""

    ssh "$DROPLET" "mkdir -p ${DROPLET_WORKDIR}/${COMPANY}"
    rsync -avz --progress "${FOLDER}/" "${DROPLET}:${DROPLET_WORKDIR}/${COMPANY}/"
    STATUS=$?

elif [ -n "$ZIP" ] && [ -f "$ZIP" ]; then
    echo "Found ZIP: $ZIP"
    echo "Transferring to Droplet..."
    echo ""

    scp "$ZIP" "${DROPLET}:/root/repos/cvc-intelligence/workers/dd/${COMPANY}.zip"
    STATUS=$?

else
    echo "ERROR: No usable folder or ZIP found for '$SEARCH'"
    exit 1
fi

if [ $STATUS -eq 0 ]; then
    echo ""
    echo "Transfer complete."
    if [ -n "$FOLDER" ]; then
        echo ""
        echo "BigBossHog can now run:"
        echo "  bash /root/repos/cvc-intelligence/scripts/ops/dd_run.sh \"${COMPANY}\""
    else
        echo ""
        echo "BigBossHog can now run:"
        echo "  cd /root/repos/cvc-intelligence/workers/dd"
        echo "  python3 extract_dataroom.py --zip ${COMPANY}.zip --company \"${COMPANY}\""
        echo "  bash /root/repos/cvc-intelligence/scripts/ops/dd_run.sh \"${COMPANY}\""
    fi
else
    echo "ERROR: Transfer failed (exit code $STATUS)"
    exit 1
fi
