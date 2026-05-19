"""
run_three.py — DD pipeline runner.

For each company:
    1. Run all 5 specialist agents
    2. Run overview bot
    3. Run appendix bot
    4. Run format bot (IC Memo PDF + Appendix PDF)
    5. Generate scoring Excel spreadsheet

Input ZIP dropped to:
    C:\\Users\\nathan\\OneDrive\\Desktop\\WORK OPEN CLAW\\DD Input and output\\

Outputs copied to same folder:
    C:\\Users\\nathan\\OneDrive\\Desktop\\WORK OPEN CLAW\\DD Input and output\\[Company]\\

Usage:
    python3 run_three.py --company "10Four" --skip-ingest
"""

import sys
import time
import json
import shutil
import argparse
import traceback
from datetime import datetime
from pathlib import Path

from config.settings import WORKDIR
from db_logger import log_evaluation, load_overview_json

# ── Companies ─────────────────────────────────────────────────────────────────

COMPANIES = [
    {
        "name":       "Retina Robotics",
        "drive_url":  None,   # already ingested
    },
    {
        "name":       "Onyx",
        "drive_url":  None,   # already ingested
    },
    {
        "name":       "Dyna Robotics",
        "drive_url":  "https://drive.google.com/drive/folders/1EC0OYPVu6MCVUNftkJAJHspLNeUfyHW8",
    },
    {
        "name":       "Ranger",
        "drive_url":  "https://drive.google.com/drive/folders/1xjSXw3AWe6PvSWgbLkUMK6yEFiQbvRZM",
    },
]

WINDOWS_OUTPUT = Path("/mnt/c/Users/nathan/OneDrive/Desktop/WORK OPEN CLAW/DD Input and output")

# ── Logging ───────────────────────────────────────────────────────────────────

def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{ts}  {msg}")


def log_step(company: str, step: str):
    print(f"\n{'─'*60}")
    log(f"[{company}]  {step}")
    print(f"{'─'*60}")


# ── Step runners ──────────────────────────────────────────────────────────────

def run_ingest(company: str, drive_url: str) -> bool:
    try:
        from ingestion.ingest import run
        run(company, drive_url)
        return True
    except Exception as e:
        log(f"  ERROR ingest: {e}")
        traceback.print_exc()
        return False


def run_ingest_local(company: str) -> bool:
    """Ingest from already-extracted local files (ZIP workflow)."""
    try:
        from ingestion.ingest_local import run
        run(company)
        return True
    except Exception as e:
        log(f"  ERROR ingest_local: {e}")
        traceback.print_exc()
        return False


def run_agent(module_path: str, company: str) -> bool:
    """Dynamically import and run an agent by dotted module path."""
    try:
        import importlib
        mod = importlib.import_module(module_path)
        mod.run(company)
        return True
    except Exception as e:
        log(f"  ERROR {module_path}: {e}")
        traceback.print_exc()
        return False


def run_overview(company: str) -> bool:
    return run_agent("overview.agent", company)


def run_appendix(company: str) -> bool:
    return run_agent("appendix.agent", company)


def run_format(company: str) -> bool:
    try:
        import importlib
        mod = importlib.import_module("format.agent")
        mod.run(company, upload=False)
        return True
    except Exception as e:
        log(f"  ERROR format: {e}")
        traceback.print_exc()
        return False


def run_scorecard(company: str, output_dir: Path) -> bool:
    try:
        from scorecard import run
        run(company, output_dir=output_dir)
        return True
    except Exception as e:
        log(f"  ERROR scorecard: {e}")
        traceback.print_exc()
        return False


def copy_outputs(company: str, dest_dir: Path) -> list[Path]:
    """Copy IC Memo PDF, Appendix PDF, and Scorecard XLSX to dest_dir."""
    safe     = company.replace(" ", "_").replace("/", "-")
    src_dir  = WORKDIR / safe
    dest_dir.mkdir(parents=True, exist_ok=True)
    copied   = []

    patterns = [
        f"{safe}_IC_Memo.pdf",
        f"{safe}_Appendix.pdf",
        f"{safe}_Scorecard.xlsx",
    ]
    for pattern in patterns:
        src = src_dir / pattern
        if src.exists():
            dst = dest_dir / pattern
            shutil.copy2(src, dst)
            copied.append(dst)
            log(f"  Copied: {dst}")
        else:
            log(f"  Missing: {src}")

    return copied


# ── Routing override ──────────────────────────────────────────────────────────

KNOWN_AGENTS = ["financials", "comp", "qualitative", "product", "news"]
SPECIALIST_AGENTS_ALL = ["financials", "comp", "qualitative", "product"]  # excludes news (web-only)


def apply_routing_override(company: str) -> bool:
    """
    If routing_override.json exists in the workdir, merge it into manifest.json
    before agents run.

    Override format:  { "filename.pdf": ["financials", "general"], ... }

    Behaviour:
    - Files listed in the override get ONLY the agents specified there.
      Ingestion's automatic routing for those files is discarded.
    - Files NOT in the override keep whatever ingestion decided.
    - "general" expands to all 4 specialist agents (financials, comp, qualitative, product).
    - The news agent is never affected by file routing (it uses web search only).
    """
    safe          = company.replace(" ", "_").replace("/", "-")
    workdir       = WORKDIR / safe
    manifest_path = workdir / "manifest.json"
    override_path = workdir / "routing_override.json"

    if not override_path.exists():
        return False   # nothing to do

    override: dict[str, list[str]] = json.loads(override_path.read_text())
    if not override:
        return False

    manifest = json.loads(manifest_path.read_text())
    routing: dict[str, list] = manifest.get("routing", {})

    # Build a lookup: filename → full doc object (from any agent bucket)
    all_docs: dict[str, dict] = {}
    for agent_docs in routing.values():
        for doc in agent_docs:
            all_docs[doc["filename"]] = doc

    # Also pull any docs that ingestion left unrouted (in manifest["documents"])
    for doc in manifest.get("documents", []):
        if doc["filename"] not in all_docs and doc.get("text_path"):
            all_docs[doc["filename"]] = doc

    # Remove overridden filenames from every agent bucket
    for filename in override:
        for agent in KNOWN_AGENTS:
            routing[agent] = [d for d in routing.get(agent, []) if d["filename"] != filename]

    # Add each overridden file to its specified agents
    for filename, agents in override.items():
        doc = all_docs.get(filename)
        if not doc:
            log(f"  [routing_override] WARNING: '{filename}' not found in manifest — skipping")
            continue
        # Expand "general" to all specialist agents
        expanded = []
        for agent in agents:
            if agent == "general" or agent == "generalist":
                expanded.extend(SPECIALIST_AGENTS_ALL)
            else:
                expanded.append(agent)
        for agent in expanded:
            if agent not in KNOWN_AGENTS or agent == "news":
                continue
            if not any(d["filename"] == filename for d in routing.get(agent, [])):
                routing.setdefault(agent, []).append(doc)

    manifest["routing"] = routing
    manifest_path.write_text(json.dumps(manifest, indent=2))

    applied = len(override)
    log(f"  Routing override applied: {applied} file{'s' if applied != 1 else ''} reassigned")
    return True


# ── Full pipeline for one company ─────────────────────────────────────────────

SPECIALIST_AGENTS = [
    ("agents.financials.agent",  "Financials"),
    ("agents.comp.agent",        "Comp"),
    ("agents.qualitative.agent", "Qualitative"),
    ("agents.product.agent",     "Product"),
    ("agents.news.agent",        "News"),
]


def run_company(company: str, drive_url: str | None, skip_ingest: bool,
                output_dir: Path) -> dict:
    results = {"company": company, "steps": {}}
    start   = time.time()

    # 1. Ingest
    safe         = company.replace(" ", "_").replace("/", "-")
    manifest_path = WORKDIR / safe / "manifest.json"

    if drive_url and not skip_ingest:
        log_step(company, "INGEST (Drive)")
        ok = run_ingest(company, drive_url)
        results["steps"]["ingest"] = "ok" if ok else "error"
        if not ok:
            log(f"Ingest failed — aborting {company}")
            return results
    elif not manifest_path.exists():
        # No manifest yet — run local ingestion on already-extracted files
        log_step(company, "INGEST (local files)")
        ok = run_ingest_local(company)
        results["steps"]["ingest"] = "ok" if ok else "error"
        if not ok:
            log(f"Local ingest failed — aborting {company}")
            return results
    else:
        log_step(company, "INGEST — skipped (manifest exists)")
        results["steps"]["ingest"] = "skipped"

    # 1b. Apply routing override (if present) — rewrites manifest before agents read it
    log_step(company, "ROUTING OVERRIDE")
    if apply_routing_override(company):
        log("  Custom routing applied — manifest updated")
    else:
        log("  No routing override found — using ingestion routing")

    # 2. Specialist agents
    log_step(company, "SPECIALIST AGENTS")
    for module, label in SPECIALIST_AGENTS:
        log(f"  Running {label}...")
        ok = run_agent(module, company)
        results["steps"][label.lower()] = "ok" if ok else "error"

    # 3. Overview
    log_step(company, "OVERVIEW BOT")
    ok = run_overview(company)
    results["steps"]["overview"] = "ok" if ok else "error"

    # 4. Appendix
    log_step(company, "APPENDIX BOT")
    ok = run_appendix(company)
    results["steps"]["appendix"] = "ok" if ok else "error"

    # 5. Format (PDFs)
    log_step(company, "FORMAT BOT (PDFs)")
    ok = run_format(company)
    results["steps"]["format"] = "ok" if ok else "error"

    # 6. Scorecard
    log_step(company, "SCORECARD (Excel)")
    ok = run_scorecard(company, WORKDIR / safe)
    results["steps"]["scorecard"] = "ok" if ok else "error"

    # 7. Copy to Windows
    log_step(company, f"COPY TO {output_dir}")
    copied = copy_outputs(company, output_dir)
    results["steps"]["copy"] = f"{len(copied)} files"

    results["elapsed"] = int(time.time() - start)
    log(f"\n{company} complete in {results['elapsed']}s")

    # Log to database
    try:
        overview_data = load_overview_json(company, WORKDIR)
        if overview_data:
            log_evaluation(company, overview_data, model="qwen/qwen3-235b-a22b-2507")
    except Exception as e:
        log(f"  [DB] Could not log evaluation: {e}")
    return results


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--company",      help="Run only this company")
    parser.add_argument("--skip-ingest",  action="store_true", help="Skip ingestion for all")
    parser.add_argument("--output",       default=str(WINDOWS_OUTPUT),
                        help=f"Windows output folder (default: {WINDOWS_OUTPUT})")
    args = parser.parse_args()

    output_root = Path(args.output)
    companies   = COMPANIES
    if args.company:
        # Check pre-registered list first (may have drive_url)
        registered = [c for c in COMPANIES if c["name"].lower() == args.company.lower()]
        if registered:
            companies = registered
        else:
            # Any company name works — pipeline will use local files in workdir/
            companies = [{"name": args.company, "drive_url": None}]

    print(f"\n{'='*60}")
    print(f"DD Pipeline — {len(companies)} company/companies")
    print(f"Output:  {output_root}")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    all_results = []
    for co in companies:
        dest = output_root / co["name"].replace(" ", "_")
        result = run_company(
            company     = co["name"],
            drive_url   = co.get("drive_url"),
            skip_ingest = args.skip_ingest,
            output_dir  = dest,
        )
        all_results.append(result)

    # Final summary
    print(f"\n{'='*60}")
    print("COMPLETE")
    print(f"{'='*60}")
    for r in all_results:
        errors = [k for k, v in r.get("steps", {}).items() if v == "error"]
        status = "OK" if not errors else f"ERRORS: {', '.join(errors)}"
        print(f"  {r['company']:<25} {r.get('elapsed', 0):>4}s  {status}")

    print(f"\nFiles available at:")
    print(f"  Desktop:  CLAUDE WORK\\OUTPUTS\\reports\\DD_Reports\\")
    print(f"  WSL:      {output_root}")


if __name__ == "__main__":
    main()
