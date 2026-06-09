"""
api/middleware/request_logging.py — Structured JSON request logging (ISO 27001 A.8.15 / SOC 2 CC7.2)

Every HTTP request is logged as a single JSON line to stdout:
    {"ts":"...","request_id":"...","method":"POST","path":"/auth/login",
     "status":200,"duration_ms":45,"ip":"1.2.3.4","user_agent":"...","user_id":null}

Log ingestion:
    - Local dev: stdout (readable by docker logs / journald)
    - Production: pipe to Loki via Promtail (see docker-compose.logging.yml)
    - Cloud: set LOG_LEVEL env var; ship stdout to CloudWatch / Datadog

Request-id is stored in a contextvars.ContextVar so downstream code can attach it
to their own log lines:
    from api.middleware.request_logging import request_id_var
    rid = request_id_var.get()
"""

import json
import logging
import os
import time
from contextvars import ContextVar
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Paths that generate too much noise in logs — still logged at DEBUG
_LOW_NOISE_PATHS = {"/health", "/app/assets"}

_LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, _LOG_LEVEL, logging.INFO))
_logger = logging.getLogger("platform.access")

# Context variable: set per-request so any code downstream can read the request ID
request_id_var: ContextVar[str] = ContextVar("request_id", default="")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        rid = str(uuid4())
        request_id_var.set(rid)

        # Try to extract user_id from JWT without full validation (for logging only)
        user_id: int | None = None
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            try:
                import base64
                payload_b64 = auth.split(".")[1]
                # Add padding
                payload_b64 += "=" * (-len(payload_b64) % 4)
                import json as _json
                payload = _json.loads(base64.urlsafe_b64decode(payload_b64))
                sub = payload.get("sub")
                if sub:
                    user_id = int(sub)
            except Exception:
                pass

        ip = request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or (
            request.client.host if request.client else "unknown"
        )

        t0 = time.monotonic()
        response = await call_next(request)
        duration_ms = int((time.monotonic() - t0) * 1000)

        path = request.url.path
        is_noise = any(path.startswith(p) for p in _LOW_NOISE_PATHS)

        record = {
            "ts":           time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "request_id":   rid,
            "method":       request.method,
            "path":         path,
            "status":       response.status_code,
            "duration_ms":  duration_ms,
            "ip":           ip,
            "user_agent":   request.headers.get("User-Agent", "")[:200],
            "user_id":      user_id,
        }

        level = logging.DEBUG if is_noise else (
            logging.WARNING if response.status_code >= 500 else
            logging.INFO    if response.status_code >= 400 else
            logging.INFO
        )
        _logger.log(level, json.dumps(record))

        # Attach request-id to response so clients can correlate
        response.headers["X-Request-ID"] = rid
        return response
