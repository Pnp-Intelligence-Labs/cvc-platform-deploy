"""
api/middleware/ext_api_log.py — Audit logger for outbound third-party API calls.
(ISO 27001 A.5.19 / SOC 2 CC9.2 / NIST 3.13)

Writes to cvc.external_api_calls (migration 141).

Usage:
    from api.middleware.ext_api_log import log_ext_call

    with log_ext_call("openrouter", endpoint="document-analysis",
                       user_id=user.user_id, data_class="confidential",
                       pii_stripped=True, rows_sent=1):
        result = llm_call(prompt)

The context manager records duration_ms and response_status automatically.
Call succeeds even if the DB write fails (never blocks the external call).
"""

import time
from contextlib import contextmanager
from typing import Iterator

from core.db.connection import get_connection


def log_ext_call(
    service: str,
    *,
    endpoint: str | None = None,
    user_id: int | None = None,
    data_class: str = "internal",
    pii_stripped: bool = False,
    rows_sent: int = 0,
    detail: str | None = None,
) -> "_ExtCallContext":
    return _ExtCallContext(
        service=service,
        endpoint=endpoint,
        user_id=user_id,
        data_class=data_class,
        pii_stripped=pii_stripped,
        rows_sent=rows_sent,
        detail=detail,
    )


class _ExtCallContext:
    def __init__(self, **kwargs):
        self._kwargs = kwargs
        self._t0: float = 0.0
        self._status: int | None = None

    def set_status(self, status: int) -> None:
        self._status = status

    def __enter__(self):
        self._t0 = time.monotonic()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        duration_ms = int((time.monotonic() - self._t0) * 1000)
        status = self._status if self._status is not None else (500 if exc_type else 200)
        _write(duration_ms=duration_ms, response_status=status, **self._kwargs)
        return False  # never suppress exceptions


def _write(
    service: str,
    endpoint: str | None,
    user_id: int | None,
    data_class: str,
    pii_stripped: bool,
    rows_sent: int,
    detail: str | None,
    response_status: int,
    duration_ms: int,
) -> None:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO cvc.external_api_calls
                        (service, endpoint, user_id, data_class, pii_stripped,
                         rows_sent, response_status, duration_ms, detail)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (service, endpoint, user_id, data_class, pii_stripped,
                     rows_sent, response_status, duration_ms, detail),
                )
            conn.commit()
    except Exception:
        pass  # logging must never block the calling flow
