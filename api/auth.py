"""
api/auth.py — JWT shim for backward compatibility.

Phase 1.5: Basic Auth has been removed. All authentication is now JWT.
require_auth delegates to require_jwt so the 100+ existing call sites
don't need to be updated individually.

All new code should use require_jwt directly from api.routes.auth.
"""

from fastapi import Depends
from api.routes.auth import require_jwt, UserInfo


def require_auth(user: UserInfo = Depends(require_jwt)) -> dict:
    """Backward-compat shim — returns dict so existing user.get('username') calls work.
    All new endpoints should use require_jwt directly.
    """
    return {"username": user.username, "role": user.role, "full_name": user.full_name}
