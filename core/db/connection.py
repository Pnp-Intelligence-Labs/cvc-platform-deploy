"""
db/connection.py — CVC database connection management.

All credentials come from environment variables or a local .env file.
"""

import json
import os
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv:
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")

_DEFAULTS = {
    "host":     "localhost",
    "port":     "5432",
    "dbname":   "cvc_db",
    "user":     "producer",
}


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if value:
        return value
    raise RuntimeError(f"{name} is required. Set it in the environment or local .env file.")


def _config() -> dict:
    return {
        "host":     os.getenv("CVC_DB_HOST",     _DEFAULTS["host"]),
        "port":     int(os.getenv("CVC_DB_PORT", _DEFAULTS["port"])),
        "dbname":   os.getenv("CVC_DB_NAME",     _DEFAULTS["dbname"]),
        "user":     os.getenv("CVC_DB_USER",     _DEFAULTS["user"]),
        "password": _required_env("CVC_DB_PASSWORD"),
    }


def is_job_enabled(job_name: str) -> bool:
    """
    Check cvc.cron_jobs.active for the given job name.
    Returns True if enabled or if the job isn't in the table (fail-open).
    Call at the top of each cron worker before doing any work.
    """
    try:
        cfg = _config()
        conn = psycopg2.connect(**cfg, cursor_factory=psycopg2.extras.RealDictCursor)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT active FROM cvc.cron_jobs WHERE name = %s LIMIT 1",
                (job_name,)
            )
            row = cur.fetchone()
        conn.close()
        if row is None:
            return True   # not in table → don't block
        return bool(row["active"])
    except Exception:
        return True       # DB unreachable → don't block


@contextmanager
def get_connection(cursor_factory=psycopg2.extras.RealDictCursor):
    """
    Context manager that yields an open psycopg2 connection.
    Commits on clean exit, rolls back on exception.

    Args:
        cursor_factory: default RealDictCursor so rows are dicts not tuples.
                        Pass None for raw tuple rows.
    """
    cfg = _config()
    conn = psycopg2.connect(**cfg, cursor_factory=cursor_factory)
    try:
        # Mark this connection as application-originated so the db_direct
        # audit trigger skips it (the API and workers handle their own logging).
        with conn.cursor() as _c:
            _c.execute("SET app.audit_source = 'app'")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
