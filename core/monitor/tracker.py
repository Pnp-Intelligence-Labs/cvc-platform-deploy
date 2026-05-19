"""
tracker.py — Skill performance monitoring.

Every skill call is logged: what was asked, what came back,
how long it took, whether it succeeded.

Stored in SQLite at ~/.cvc-skills/metrics.db — queryable at any time.
Use monitor/report.py to see which skills are underperforming.
"""

import sqlite3
import time
import functools
from datetime import datetime
from cvc_config import MONITOR_DB


def _get_conn():
    conn = sqlite3.connect(str(MONITOR_DB))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS skill_calls (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          TEXT    NOT NULL,
            skill       TEXT    NOT NULL,
            pipeline    TEXT,
            agent       TEXT,
            query       TEXT,
            status      TEXT    NOT NULL,
            result_count INTEGER,
            latency_ms  INTEGER,
            error       TEXT,
            notes       TEXT
        )
    """)
    conn.commit()
    return conn


def log_call(
    skill: str,
    query: str,
    status: str,           # "ok" | "empty" | "error" | "timeout"
    result_count: int = 0,
    latency_ms: int = 0,
    pipeline: str = None,
    agent: str = None,
    error: str = None,
    notes: str = None,
):
    """Log a single skill call to the metrics DB."""
    try:
        conn = _get_conn()
        conn.execute(
            """INSERT INTO skill_calls
               (ts, skill, pipeline, agent, query, status, result_count, latency_ms, error, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                datetime.utcnow().isoformat(),
                skill, pipeline, agent,
                query[:500] if query else None,  # cap query length
                status, result_count, latency_ms,
                str(error)[:500] if error else None,
                notes,
            )
        )
        conn.commit()
        conn.close()
    except Exception:
        pass  # never let monitoring break the pipeline


def track(skill_name: str, pipeline: str = None, agent: str = None):
    """
    Decorator that automatically tracks any skill function.

    The decorated function must:
    - Accept 'query' as first positional arg or keyword arg
    - Return a dict with optional 'results' list or 'count' key

    Usage:
        @track("brave", pipeline="dd", agent="qualitative")
        def search(query, count=5):
            ...
    """
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            query = args[0] if args else kwargs.get("query", "")
            start = time.time()
            try:
                result = fn(*args, **kwargs)
                latency = int((time.time() - start) * 1000)

                # Try to count results
                count = 0
                if isinstance(result, list):
                    count = len(result)
                elif isinstance(result, dict):
                    count = len(result.get("results", result.get("items", [])))

                status = "ok" if count > 0 else "empty"
                log_call(skill_name, query, status, count, latency, pipeline, agent)
                return result

            except TimeoutError as e:
                latency = int((time.time() - start) * 1000)
                log_call(skill_name, query, "timeout", 0, latency, pipeline, agent, error=str(e))
                raise
            except Exception as e:
                latency = int((time.time() - start) * 1000)
                log_call(skill_name, query, "error", 0, latency, pipeline, agent, error=str(e))
                raise

        return wrapper
    return decorator
