"""
api/routes/mfa.py — TOTP-based MFA management (ISO 27001 A.8.2 / NIST 3.5.3)

Endpoints (prefix /auth/mfa set in main.py):
    POST   /auth/mfa/setup    — generate TOTP secret + QR URI (user must confirm)
    POST   /auth/mfa/verify   — confirm first TOTP code to activate MFA
    DELETE /auth/mfa          — disable MFA (requires TOTP or GP override)

MFA secrets are encrypted at rest using Fernet with a key derived from JWT_SECRET.
The cryptography package is available as a transitive dep of python-jose[cryptography].
"""

import base64
import hashlib
import os

import pyotp
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.routes.auth import UserInfo, _log_auth_event, require_jwt
from core.db.connection import get_connection

router = APIRouter()

_JWT_SECRET = os.environ.get("JWT_SECRET", "")


def _get_fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(_JWT_SECRET.encode()).digest())
    return Fernet(key)


def _encrypt_secret(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode()).decode()


def _decrypt_secret(ciphertext: str) -> str:
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        raise HTTPException(status_code=500, detail="MFA secret decryption failed — contact admin")


# ── Models ────────────────────────────────────────────────────────────────────

class MFAVerifyRequest(BaseModel):
    code: str


class MFADisableRequest(BaseModel):
    code: str | None = None    # TOTP code from authenticator app
    admin_override: bool = False  # GP only, skips TOTP check


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/setup")
def mfa_setup(user: UserInfo = Depends(require_jwt)):
    """Generate a new TOTP secret and store it (unconfirmed).
    Returns the secret and an otpauth:// URI for QR code rendering.
    Must be confirmed via POST /auth/mfa/verify before MFA is active.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT mfa_enabled, mfa_confirmed FROM cvc.users WHERE id = %s",
                (user.user_id,),
            )
            row = cur.fetchone()

    if row and row["mfa_enabled"] and row["mfa_confirmed"]:
        raise HTTPException(status_code=409, detail="MFA already active. Disable it first to re-enroll.")

    secret = pyotp.random_base32()
    enc = _encrypt_secret(secret)
    totp = pyotp.TOTP(secret)

    # Use username as account label; issuer is configurable
    issuer = os.environ.get("MFA_ISSUER", "Vertical OS")
    qr_uri = totp.provisioning_uri(name=user.username, issuer_name=issuer)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.users SET mfa_secret_enc = %s, mfa_confirmed = FALSE WHERE id = %s",
                (enc, user.user_id),
            )
        conn.commit()

    return {"secret": secret, "qr_uri": qr_uri}


@router.post("/verify")
def mfa_verify(body: MFAVerifyRequest, user: UserInfo = Depends(require_jwt)):
    """Confirm the first TOTP code to activate MFA for this account."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT mfa_enabled, mfa_confirmed, mfa_secret_enc FROM cvc.users WHERE id = %s",
                (user.user_id,),
            )
            row = cur.fetchone()

    if not row or not row["mfa_secret_enc"]:
        raise HTTPException(status_code=400, detail="No MFA secret found. Call /auth/mfa/setup first.")

    if row["mfa_enabled"] and row["mfa_confirmed"]:
        raise HTTPException(status_code=409, detail="MFA already active.")

    secret = _decrypt_secret(row["mfa_secret_enc"])
    if not pyotp.TOTP(secret).verify(body.code.strip(), valid_window=1):
        _log_auth_event(
            "mfa_setup_failure",
            user_id=user.user_id,
            username=user.username,
            success=False,
            detail="Wrong code during MFA verify",
        )
        raise HTTPException(status_code=400, detail="Invalid code — check your authenticator app and try again")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.users SET mfa_enabled = TRUE, mfa_confirmed = TRUE WHERE id = %s",
                (user.user_id,),
            )
        conn.commit()

    _log_auth_event(
        "mfa_setup",
        user_id=user.user_id,
        username=user.username,
        success=True,
        detail="MFA activated",
    )
    return {"mfa_enabled": True}


@router.delete("")
def mfa_disable(body: MFADisableRequest, user: UserInfo = Depends(require_jwt)):
    """Disable MFA. Requires either:
    - A valid TOTP code from the user, OR
    - GP role with admin_override=True (for locked-out users)
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT mfa_enabled, mfa_secret_enc FROM cvc.users WHERE id = %s",
                (user.user_id,),
            )
            row = cur.fetchone()

    if not row or not row["mfa_enabled"]:
        raise HTTPException(status_code=400, detail="MFA is not enabled on this account")

    if body.admin_override:
        if user.role != "GP":
            raise HTTPException(status_code=403, detail="Only GP can use admin_override")
    else:
        if not body.code:
            raise HTTPException(status_code=400, detail="Provide your TOTP code or use admin_override (GP only)")
        secret = _decrypt_secret(row["mfa_secret_enc"])
        if not pyotp.TOTP(secret).verify(body.code.strip(), valid_window=1):
            _log_auth_event(
                "mfa_disable_failure",
                user_id=user.user_id,
                username=user.username,
                success=False,
                detail="Wrong code during MFA disable",
            )
            raise HTTPException(status_code=400, detail="Invalid TOTP code")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.users SET mfa_enabled = FALSE, mfa_confirmed = FALSE, mfa_secret_enc = NULL "
                "WHERE id = %s",
                (user.user_id,),
            )
        conn.commit()

    _log_auth_event(
        "mfa_disabled",
        user_id=user.user_id,
        username=user.username,
        success=True,
        detail="admin_override" if body.admin_override else "user self-disabled",
    )
    return {"mfa_enabled": False}
