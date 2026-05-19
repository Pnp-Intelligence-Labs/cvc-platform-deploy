"""
job_logger.py — Lightweight job run tracker for CVC nightly workers.
Writes to cvc.job_runs. Fail-open: never crashes the calling worker.

Usage:
    from job_logger import start_job, finish_job

    run_id = start_job("Company Enrichment — Phase 1", "dell")
    try:
        ...
        finish_job(run_id, "ok", {"enriched": 42, "failed": 2})
    except Exception as e:
        finish_job(run_id, "error", error_text=str(e))
        raise
"""
import json
import os
import psycopg2
from typing import Optional

_DB = dict(
    host=os.environ.get("CVC_DB_HOST", "100.83.104.117"),
    port=int(os.environ.get("CVC_DB_PORT", "5432")),
    dbname="cvc_db",
    user="producer",
    password=os.environ["CVC_DB_PASSWORD"],
)


def start_job(name: str, machine: str) -> Optional[int]:
    """Insert a running row. Returns run_id or None on failure."""
    try:
        conn = psycopg2.connect(**_DB)
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO cvc.job_runs (job_name, machine, started_at, status) "
                "VALUES (%s, %s, NOW(), 'running') RETURNING id",
                (name, machine),
            )
            run_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return run_id
    except Exception as e:
        print(f"[job_logger] start_job failed (non-fatal): {e}")
        return None


def finish_job(
    run_id: Optional[int],
    status: str = "ok",
    summary: Optional[dict] = None,
    error_text: Optional[str] = None,
) -> None:
    """Update run row with outcome. No-op if run_id is None."""
    if run_id is None:
        return
    try:
        conn = psycopg2.connect(**_DB)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.job_runs "
                "SET finished_at = NOW(), status = %s, summary = %s, error_text = %s "
                "WHERE id = %s",
                (status, json.dumps(summary or {}), error_text, run_id),
            )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[job_logger] finish_job failed (non-fatal): {e}")
