"""
run_reconciler.py — Reconciler entry point.

Reads a human-reviewed scorecard and auto-generates corrected v2 outputs:
    [Company]_IC_Memo_v2.pdf
    [Company]_Appendix_v2.pdf
    [Company]_Scorecard_v2.xlsx

V1 originals are never touched.

Usage:
    python3 run_reconciler.py --company "Ranger"
    python3 run_reconciler.py --company "Ranger" --scorecard "/path/to/Reviewed_Ranger_Scorecard.xlsx"
    python3 run_reconciler.py --company "Ranger" --skip-overview   # re-use existing overview_v2.json
"""

import time
import shutil
import argparse
import traceback
from datetime import datetime

from config.settings import WORKDIR

WINDOWS_OUTPUT = Path("/mnt/c/Users/nathan/OneDrive/Desktop/CLAUDE WORK/OUTPUTS/reports/DD_Reports")


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{ts}  {msg}")


def log_step(step: str):
    print(f"\n{'─'*60}")
    log(step)
    print(f"{'─'*60}")


def copy_v2_outputs(company: str, dest_dir: Path) -> list[Path]:
    """Copy v2 PDFs and scorecard to DD_Reports folder."""
    safe    = company.replace(" ", "_").replace("/", "-")
    src_dir = WORKDIR / safe
    dest_dir.mkdir(parents=True, exist_ok=True)
    copied  = []

    for pattern in [
        f"{safe}_IC_Memo_v2.pdf",
        f"{safe}_Appendix_v2.pdf",
        f"{safe}_Scorecard_v2.xlsx",
    ]:
        src = src_dir / pattern
        if src.exists():
            dst = dest_dir / pattern
            shutil.copy2(src, dst)
            copied.append(dst)
            log(f"  Copied: {dst.name}")
        else:
            log(f"  Missing: {pattern}")

    return copied


def main():
    parser = argparse.ArgumentParser(description="Reconciler — generate v2 outputs from reviewed scorecard")
    parser.add_argument("--company",       required=True, help="Company name (e.g. 'Ranger')")
    parser.add_argument("--scorecard",     help="Path to reviewed scorecard XLSX (auto-detected if omitted)")
    parser.add_argument("--skip-overview", action="store_true", help="Skip overview re-synthesis (re-use existing overview_v2.json)")
    parser.add_argument("--output",        default=str(WINDOWS_OUTPUT), help="Output folder for copies")
    args = parser.parse_args()

    company    = args.company
    scorecard  = Path(args.scorecard) if args.scorecard else None
    output_dir = Path(args.output) / company.replace(" ", "_")
    start      = time.time()

    print(f"\n{'='*60}")
    print(f"RECONCILER — {company}")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")

    results = {}

    # ── Step 1: Apply corrections → agents_v2/*.json ──────────────────────────
    log_step("STEP 1/5 — Apply reviewer corrections")
    try:
        from reconciler.agent import run as reconciler_run
        recon_log = reconciler_run(company, scorecard_path=scorecard)
        results["reconciler"] = "ok"
        log(f"  Corrections applied: {recon_log['total_changes']}")
        log(f"    Wrong corrected:  {recon_log['summary']['wrong_corrected']}")
        log(f"    Partial amended:  {recon_log['summary']['partial_amended']}")
        log(f"    Flags removed:    {recon_log['summary']['flags_removed']}")
    except Exception as e:
        log(f"  ERROR: {e}")
        traceback.print_exc()
        results["reconciler"] = "error"
        print("\nReconciler step failed — aborting.")
        sys.exit(1)

    # ── Step 2: Re-synthesize IC memo (overview v2) ───────────────────────────
    if not args.skip_overview:
        log_step("STEP 2/5 — Re-synthesize IC Memo (overview v2)")
        try:
            from overview.agent import run as overview_run
            overview_run(company, version="v2")
            results["overview"] = "ok"
        except Exception as e:
            log(f"  ERROR: {e}")
            traceback.print_exc()
            results["overview"] = "error"
    else:
        log_step("STEP 2/5 — Overview skipped (--skip-overview)")
        results["overview"] = "skipped"

    # ── Step 3: Regenerate appendix v2 ───────────────────────────────────────
    log_step("STEP 3/5 — Regenerate Appendix (v2)")
    try:
        from appendix.agent import run as appendix_run
        appendix_run(company, version="v2")
        results["appendix"] = "ok"
    except Exception as e:
        log(f"  ERROR: {e}")
        traceback.print_exc()
        results["appendix"] = "error"

    # ── Step 4: Render PDFs v2 ────────────────────────────────────────────────
    log_step("STEP 4/5 — Render PDFs (v2)")
    try:
        from format.agent import run as format_run
        format_run(company, upload=False, version="v2")
        results["format"] = "ok"
    except Exception as e:
        log(f"  ERROR: {e}")
        traceback.print_exc()
        results["format"] = "error"

    # ── Step 5: Generate scorecard v2 ────────────────────────────────────────
    log_step("STEP 5/5 — Generate Scorecard (v2)")
    try:
        from scorecard import run as scorecard_run
        safe     = company.replace(" ", "_").replace("/", "-")
        out_path = scorecard_run(company, output_dir=WORKDIR / safe, version="v2")
        results["scorecard"] = "ok"
    except Exception as e:
        log(f"  ERROR: {e}")
        traceback.print_exc()
        results["scorecard"] = "error"

    # ── Copy to Windows output folder ─────────────────────────────────────────
    log_step(f"COPY TO {output_dir}")
    copied = copy_v2_outputs(company, output_dir)

    # ── Step 6: Run Forge — Pattern Learning ─────────────────────────────────
    log_step("STEP 6/6 — Forge: Extract feedback patterns")
    try:
        from forge import load_reconciler_log, extract_patterns, write_patterns_to_db
        log_data = load_reconciler_log(company)
        if log_data:
            patterns = extract_patterns(log_data)
            if patterns:
                count = write_patterns_to_db(patterns)
                log(f"  Extracted {count} feedback patterns for learning")
            else:
                log(f"  No corrections to learn from")
        results["forge"] = "ok"
    except Exception as e:
        log(f"  WARNING: Forge failed (non-critical): {e}")
        results["forge"] = "warning"

    results["copy"] = f"{len(copied)} files"

    # ── Summary ───────────────────────────────────────────────────────────────
    elapsed = int(time.time() - start)
    errors  = [k for k, v in results.items() if v == "error"]

    print(f"\n{'='*60}")
    print(f"RECONCILER COMPLETE — {elapsed}s")
    print(f"{'='*60}")
    for step, status in results.items():
        print(f"  {step:<15} {status}")

    if errors:
        print(f"\nErrors in: {', '.join(errors)}")
    else:
        print(f"\nV2 outputs available at:")
        print(f"  Desktop: CLAUDE WORK\\OUTPUTS\\reports\\DD_Reports\\{company.replace(' ', '_')}\\")
        print(f"  WSL:     {output_dir}")


if __name__ == "__main__":
    main()
