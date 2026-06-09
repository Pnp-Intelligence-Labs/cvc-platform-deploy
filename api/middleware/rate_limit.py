"""
api/middleware/rate_limit.py — In-memory sliding-window rate limiter.

Thread-safe. Works for single-process deployments (standard uvicorn --workers 2
shares memory via fork on Linux). For multi-host deployments replace with Redis.

Usage:
    from api.middleware.rate_limit import RateLimiter
    _login_limiter = RateLimiter(max_calls=5, period_seconds=900)
    if not _login_limiter.is_allowed(ip):
        raise HTTPException(429, ...)
"""

import threading
import time
from collections import defaultdict, deque


class RateLimiter:
    """Sliding-window rate limiter keyed by an arbitrary string (typically IP)."""

    def __init__(self, max_calls: int, period_seconds: int):
        self._max = max_calls
        self._period = period_seconds
        self._calls: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def is_allowed(self, key: str) -> bool:
        """Return True if the key is within the limit, False if rate-limited."""
        now = time.monotonic()
        cutoff = now - self._period
        with self._lock:
            q = self._calls[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self._max:
                return False
            q.append(now)
            return True

    def reset(self, key: str) -> None:
        """Clear the call history for a key (e.g. after successful login)."""
        with self._lock:
            self._calls.pop(key, None)
