"""
db/connection.py — Database connection management.

All credentials come from environment variables or a local .env file.
"""

import os
import psycopg2
import psycopg2.extras
import psycopg2.pool
from contextlib import contextmanager
from pathlib import Path
from threading import Lock

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv:
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")

_DEFAULTS = {
    "host":   "localhost",
    "port":   "5432",
    "dbname": "platform_db",
    "user":   "platform",
}

_pool: psycopg2.pool.ThreadedConnectionPool | None = None
_pool_lock = Lock()


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if value:
        return value
    raise RuntimeError(f"{name} is required. Set it in the environment or local .env file.")


def _config() -> dict:
    return {
        "host":     os.getenv("DB_HOST",     _DEFAULTS["host"]),
        "port":     int(os.getenv("DB_PORT", _DEFAULTS["port"])),
        "dbname":   os.getenv("DB_NAME",     _DEFAULTS["dbname"]),
        "user":     os.getenv("DB_USER",     _DEFAULTS["user"]),
        "password": _required_env("DB_PASSWORD"),
    }


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = psycopg2.pool.ThreadedConnectionPool(
                    minconn=2,
                    maxconn=20,
                    cursor_factory=psycopg2.extras.RealDictCursor,
                    **_config(),
                )
    return _pool


def is_job_enabled(job_name: str) -> bool:
    """
    Check cvc.cron_jobs.active for the given job name.
    Returns True if enabled or if the job isn't in the table (fail-open).
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT active FROM cvc.cron_jobs WHERE name = %s LIMIT 1",
                    (job_name,)
                )
                row = cur.fetchone()
        if row is None:
            return True
        return bool(row["active"])
    except Exception:
        return True


@contextmanager
def get_connection(cursor_factory=psycopg2.extras.RealDictCursor):
    """
    Context manager that yields a pooled psycopg2 connection.
    Commits on clean exit, rolls back on exception, returns connection to pool on exit.
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as _c:
            _c.execute("SET app.audit_source = 'app'")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)
