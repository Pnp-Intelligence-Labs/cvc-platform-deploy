# DD Pipeline — ZIP Dataroom Workflow

Quick-reference for running the DD pipeline on a ZIP dataroom file.

## Inputs

- **Company name** (e.g. "10Four")
- **ZIP file** dropped into: `C:\Users\nathan\OneDrive\Desktop\WORK OPEN CLAW\DD Input and output\`

## Steps

### 0. Transfer ZIP from Windows to Droplet

Open WSL (`wsl` in PowerShell or Start Menu). Run these two commands separately — do NOT paste as one block:

```bash
# Step 1: copy to /tmp with a clean name (use glob to avoid typing the full filename)
cp "/mnt/c/Users/nathan/OneDrive/Desktop/WORK OPEN CLAW/DD Input and output/"*.zip /tmp/dd_input.zip
```

```bash
# Step 2: SCP to Droplet (Tailscale must be running)
scp /tmp/dd_input.zip root@100.95.2.44:/root/repos/cvc-intelligence/workers/dd/10Four.zip
```

Your SSH key is already authorized — no password needed.

**Note:** Long filenames with spaces break if pasted as a single multi-line command. Always do Step 1 (copy to /tmp with clean name) first, then SCP the clean path.

### 1. Extract ZIP to workdir

```bash
python3 extract_dataroom.py --zip /root/repos/cvc-intelligence/workers/dd/dataroom.zip --company "Acme Robotics"
```

Extracts to: `workers/dd/workdir/Acme Robotics/`

### 2. Run the pipeline

```bash
cd /root/repos/cvc-intelligence/workers/dd
PYTHONPATH=/root/repos/cvc-intelligence/core python3 run_three.py --company "10Four"
```

No `--skip-ingest` needed. When there's no manifest yet, the pipeline automatically runs local ingestion on the extracted files before kicking off the agents.

Pipeline steps (automatic):
1. **Local ingest** — discover files, convert to text, tag by type, route to agents, write manifest.json
2. Run 5 specialist agents (financials, comp, qualitative, product, news)
3. Overview agent (cross-agent synthesis)
4. Appendix agent
5. Format bot → IC Memo PDF + Appendix PDF
6. Excel scorecard
7. Log evaluation to database

### 3. Output location

```
C:\Users\nathan\OneDrive\Desktop\WORK OPEN CLAW\DD Input and output\10Four\
├── 10Four_IC_Memo.pdf
├── 10Four_Appendix.pdf
└── 10Four_Scorecard.xlsx
```

## One-liner (full pipeline)

```bash
cd /root/repos/cvc-intelligence/workers/dd && python3 extract_dataroom.py --zip 10Four.zip --company "$NAME" && PYTHONPATH=/root/repos/cvc-intelligence/core python3 run_three.py --company "$NAME"
```

## Notes

- Company name must match exactly between extraction and pipeline run
- If ZIP contains nested folders, extraction flattens into `workdir/[company]/`
- Large datarooms (50+ docs) take 15-30 minutes
- Pipeline logs to `dd_evaluations` table in PostgreSQL
- Forge runs post-reconciler to learn from corrections
