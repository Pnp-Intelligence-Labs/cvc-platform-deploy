#!/usr/bin/env python3
"""
batch_enrichment.py — Batch enrichment runner, spawned as subprocess by admin API.

Job types map directly to the enrichment pipeline steps:
  founder      → enrich_worker.py        (Phase 1 — basic profile + founder research)
  4d           → enrich_phase2.py        (4D classification — env/func/stack/biz_model)
  funding      → enrich_funding_rounds.py (Brave Search → funding round suggestions)
  deployments  → enrich_cases.py         (Case Studies & Deployments — Brave Search)
  industrial   → enrich_industrial.py    (Industrial readiness/sovereignty scoring)
  score_refresh → score_refresh.py       (Composite score refresh)
"""
import argparse
import json
import os
import subprocess
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

WORKERS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "enrichment")
SCORING_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scoring")
REPO_ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PYTHONENV = {**os.environ, "PYTHONPATH": os.path.join(REPO_ROOT, "core")}


def run_worker(script: str, extra_args: list[str]) -> dict:
    """Run a worker script as a subprocess and return a result dict."""
    cmd = [sys.executable, script] + extra_args
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT, env=PYTHONENV)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"{script} exited with code {result.returncode}")
    # Workers may print token-cost logs to stdout alongside the JSON summary.
    # Scan lines in reverse to find the first valid JSON object.
    for line in reversed(result.stdout.splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    return {}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id",   type=int, required=True)
    parser.add_argument("--job-type", choices=["founder", "4d", "funding", "deployments", "industrial", "score_refresh"], required=True)
    parser.add_argument("--target",   choices=["sector", "portfolio", "all"], required=True)
    parser.add_argument("--sector",   default=None)
    args = parser.parse_args()

    try:
        if args.target == "sector" and not args.sector:
            raise ValueError("Sector required when target is 'sector'")

        result: dict = {}

        if args.job_type == "founder":
            # Phase 1 — basic profile enrichment + founder research
            script = os.path.join(WORKERS_DIR, "enrich_worker.py")
            extra = ["--limit", "500"]
            result = run_worker(script, extra)
            result.setdefault("type", "founder")

        elif args.job_type == "4d":
            # Phase 2 — 4D classification
            script = os.path.join(WORKERS_DIR, "enrich_phase2.py")
            extra = ["--limit", "500"]
            result = run_worker(script, extra)
            result.setdefault("type", "4d")

        elif args.job_type == "funding":
            # Funding rounds via Brave Search → intel_suggestions queue
            script = os.path.join(WORKERS_DIR, "enrich_funding_rounds.py")
            extra = ["--batch"]
            if args.target == "sector" and args.sector:
                extra.append(f"--sector={args.sector}")
            result = run_worker(script, extra)
            result.setdefault("type", "funding")

        elif args.job_type == "deployments":
            # Case Studies & Deployments via Brave Search → intel_suggestions queue
            script = os.path.join(WORKERS_DIR, "enrich_cases.py")
            extra = ["--limit", "100", "--no-gate", "--batch-job-id", str(args.job_id)]
            if args.target == "portfolio":
                extra.append("--portfolio")
            elif args.target == "sector" and args.sector:
                extra += ["--sector", args.sector]
            result = run_worker(script, extra)
            result.setdefault("type", "deployments")

        elif args.job_type == "industrial":
            # Industrial readiness/sovereignty/friction scoring
            script = os.path.join(WORKERS_DIR, "enrich_industrial.py")
            extra = ["--limit", "200"]
            result = run_worker(script, extra)
            result.setdefault("type", "industrial")

        elif args.job_type == "score_refresh":
            # Composite score refresh
            script = os.path.join(os.path.dirname(WORKERS_DIR), "scoring", "score_refresh.py")
            extra = ["--limit", "500"]
            result = run_worker(script, extra)
            result.setdefault("type", "score_refresh")

        result["job_id"] = args.job_id
        result["target"] = args.target
        if args.sector:
            result["sector"] = args.sector

        print(json.dumps(result))
        sys.exit(0)

    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
