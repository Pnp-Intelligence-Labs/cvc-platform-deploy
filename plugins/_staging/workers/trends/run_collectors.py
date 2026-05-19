"""Collector-only entry point — runs signal collection agents only."""

import json
import logging
import os
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "core"))
from job_logger import start_job, finish_job


def _is_job_enabled(name: str) -> bool:
    """Fail-open: returns True if job not found or DB unreachable."""
    try:
        cfg = {
            "host":   os.environ.get("CVC_DB_HOST", "100.83.104.117"),
            "port":   int(os.environ.get("CVC_DB_PORT", "5432")),
            "dbname": os.environ.get("CVC_DB_NAME", "cvc_db"),
            "user":   os.environ.get("CVC_DB_USER", "producer"),
            "password": os.environ["CVC_DB_PASSWORD"],
        }
        conn = psycopg2.connect(**cfg, cursor_factory=psycopg2.extras.RealDictCursor)
        with conn.cursor() as cur:
            cur.execute("SELECT active FROM cvc.cron_jobs WHERE name = %s LIMIT 1", (name,))
            row = cur.fetchone()
        conn.close()
        return bool(row["active"]) if row else True
    except Exception:
        return True

# Add skills to path

# Ensure output directory exists before configuring log file handler
Path("output").mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("output/collectors.log"),
    ]
)

from agents.rss_collector.agent import RSSCollector
from agents.funding_tracker.agent import FundingTracker
from agents.jobs_tracker.agent import JobsTracker
from agents.patent_monitor.agent import PatentMonitor
from agents.earnings_scraper.agent import EarningsScraper


def load_manifest(quarter: str) -> dict:
    path = Path(f"manifests/{quarter}.json")
    if not path.exists():
        raise FileNotFoundError(f"No manifest for {quarter}")
    return json.loads(path.read_text())


def run_collectors(quarter: str):
    log = logging.getLogger("collectors")
    manifest = load_manifest(quarter)
    results = []

    log.info(f"=== Running Signal Collectors for {quarter} ===")

    for AgentClass in [RSSCollector, FundingTracker, JobsTracker,
                       PatentMonitor, EarningsScraper]:
        agent = AgentClass(manifest)
        result = agent.safe_run()
        results.append(result)
        log.info(f"  {result['agent']}: {result['status']}")
        if result["status"] == "success":
            log.info(f"    Result: {result.get('result', {})}")

    log.info("=== COLLECTORS COMPLETE ===")
    success = sum(1 for r in results if r["status"] == "success")
    failed = sum(1 for r in results if r["status"] == "error")
    log.info(f"  Success: {success}, Failed: {failed}")

    for r in results:
        if r["status"] == "error":
            log.error(f"  FAILED: {r['agent']}: {r['error']}")

    return results


if __name__ == "__main__":
    if not _is_job_enabled("RSS / Content Collection"):
        logging.getLogger("collectors").info("Job disabled in scheduler — exiting")
        sys.exit(0)
    quarter = sys.argv[1] if len(sys.argv) > 1 else "Q2-2026"
    run_id = start_job("RSS / Content Collection", "dell")
    try:
        results = run_collectors(quarter)
        success = sum(1 for r in results if r["status"] == "success") if results else 0
        failed = sum(1 for r in results if r["status"] == "error") if results else 0
        finish_job(run_id, "ok", {"success": success, "failed": failed})
    except Exception as e:
        finish_job(run_id, "error", error_text=str(e))
        raise
