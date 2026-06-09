"""
tests/test_core_features.py — Unit tests for core platform features.

Covers pure-logic, no-DB modules only:
  - RateLimiter (sliding-window logic)
  - upload_validator (MIME detection + allowlist)
  - config_loader (safe defaults, singleton, unknown key)
  - auth JWT helpers (_create_access_token, _create_refresh_token, _decode_token)
  - auth password policy (_check_password_policy)
  - home.py pure helpers (_parse_ts, _current_stage)
  - security_headers (_HEADERS constants)
"""

import os
import time

# JWT_SECRET must be set before importing api.routes.auth (raises RuntimeError otherwise)
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-unit-tests-abcdef1234")
os.environ.setdefault("HIBP_CHECK_ENABLED", "false")  # disable network call in tests

import pytest
from fastapi import HTTPException


# ── RateLimiter ───────────────────────────────────────────────────────────────

class TestRateLimiter:
    def _make(self, max_calls=3, period=60):
        from api.middleware.rate_limit import RateLimiter
        return RateLimiter(max_calls=max_calls, period_seconds=period)

    def test_allows_within_limit(self):
        rl = self._make(max_calls=3)
        assert rl.is_allowed("ip1") is True
        assert rl.is_allowed("ip1") is True
        assert rl.is_allowed("ip1") is True

    def test_blocks_at_limit(self):
        rl = self._make(max_calls=2)
        rl.is_allowed("ip2")
        rl.is_allowed("ip2")
        assert rl.is_allowed("ip2") is False

    def test_reset_clears_history(self):
        rl = self._make(max_calls=1)
        rl.is_allowed("ip3")
        assert rl.is_allowed("ip3") is False
        rl.reset("ip3")
        assert rl.is_allowed("ip3") is True

    def test_keys_are_independent(self):
        rl = self._make(max_calls=1)
        assert rl.is_allowed("key-a") is True
        assert rl.is_allowed("key-b") is True
        assert rl.is_allowed("key-a") is False
        assert rl.is_allowed("key-b") is False

    def test_sliding_window_expires_old_calls(self):
        rl = self._make(max_calls=2, period=1)
        rl.is_allowed("ip4")
        rl.is_allowed("ip4")
        assert rl.is_allowed("ip4") is False
        time.sleep(1.1)
        assert rl.is_allowed("ip4") is True


# ── upload_validator ──────────────────────────────────────────────────────────

class TestDetectMime:
    def _detect(self, data: bytes, filename: str) -> str:
        from api.middleware.upload_validator import _detect_mime
        return _detect_mime(data, filename)

    def test_pdf_extension_fallback(self):
        mime = self._detect(b"not-real-bytes", "document.pdf")
        assert mime == "application/pdf"

    def test_jpg_extension_fallback(self):
        mime = self._detect(b"not-real-bytes", "photo.jpg")
        assert mime == "image/jpeg"

    def test_unknown_extension_returns_octet_stream(self):
        mime = self._detect(b"random", "file.xyz")
        assert mime == "application/octet-stream"

    def test_no_extension_returns_octet_stream(self):
        mime = self._detect(b"data", "noextension")
        assert mime == "application/octet-stream"

    def test_csv_extension_fallback(self):
        mime = self._detect(b"col1,col2\n1,2\n", "data.csv")
        assert mime == "text/csv"


class TestValidateUpload:
    def test_allowed_pdf_passes(self):
        from api.middleware.upload_validator import validate_upload
        # Use extension-based fallback (filetype may not detect empty PDF bytes)
        mime = validate_upload(b"not-real-bytes", "report.pdf")
        assert mime == "application/pdf"

    def test_disallowed_type_raises_415(self):
        from api.middleware.upload_validator import validate_upload
        with pytest.raises(HTTPException) as exc:
            validate_upload(b"data", "script.sh")
        assert exc.value.status_code == 415

    def test_allowed_image_passes(self):
        from api.middleware.upload_validator import validate_upload
        mime = validate_upload(b"data", "photo.png")
        assert mime == "image/png"


# ── config_loader ─────────────────────────────────────────────────────────────

class TestConfigLoader:
    def _fresh_loader(self):
        """Return a fresh, uncached ConfigLoader instance for isolation."""
        from core.config_loader import _ConfigLoader, SAFE_DEFAULTS
        loader = _ConfigLoader.__new__(_ConfigLoader)
        loader._cache = {}
        loader._loaded = False
        return loader, SAFE_DEFAULTS

    def test_returns_safe_default_when_db_unavailable(self):
        loader, defaults = self._fresh_loader()
        # DB load will fail (no DB in test env) → safe defaults active
        result = loader.get("investment_thesis")
        assert result == defaults["investment_thesis"]

    def test_returns_empty_string_for_unknown_key(self):
        loader, _ = self._fresh_loader()
        result = loader.get("nonexistent_key_xyz")
        assert result == ""

    def test_cache_overrides_default(self):
        loader, _ = self._fresh_loader()
        loader._loaded = True  # bypass DB load
        loader._cache["investment_thesis"] = "custom thesis"
        assert loader.get("investment_thesis") == "custom thesis"

    def test_reload_clears_cache(self):
        loader, defaults = self._fresh_loader()
        loader._loaded = True
        loader._cache["investment_thesis"] = "custom"
        loader.reload()
        # After reload, DB fails → safe default
        assert loader.get("investment_thesis") == defaults["investment_thesis"]


# ── Auth JWT helpers ──────────────────────────────────────────────────────────

_TEST_USER = {
    "id": 42,
    "username": "testuser",
    "role": "Ventures",
    "full_name": "Test User",
    "assigned_partner_ids": [1, 2],
}


class TestJWTHelpers:
    def test_access_token_is_string(self):
        from api.routes.auth import _create_access_token
        token = _create_access_token(_TEST_USER)
        assert isinstance(token, str)
        assert len(token) > 0

    def test_access_token_decode_round_trip(self):
        from api.routes.auth import _create_access_token, _decode_token
        token = _create_access_token(_TEST_USER)
        payload = _decode_token(token)
        assert payload["username"] == "testuser"
        assert payload["role"] == "Ventures"
        assert payload["typ"] == "access"
        assert payload["sub"] == "42"

    def test_refresh_token_has_correct_type(self):
        from api.routes.auth import _create_refresh_token, _decode_token
        token = _create_refresh_token(_TEST_USER)
        payload = _decode_token(token)
        assert payload["typ"] == "refresh"
        assert payload["sub"] == "42"

    def test_tampered_token_raises_401(self):
        from api.routes.auth import _decode_token
        with pytest.raises(HTTPException) as exc:
            _decode_token("not.a.valid.jwt")
        assert exc.value.status_code == 401

    def test_different_users_produce_different_tokens(self):
        from api.routes.auth import _create_access_token
        user_b = {**_TEST_USER, "id": 99, "username": "other"}
        t1 = _create_access_token(_TEST_USER)
        t2 = _create_access_token(user_b)
        assert t1 != t2


# ── Password policy ───────────────────────────────────────────────────────────

class TestPasswordPolicy:
    def _check(self, pw: str):
        from api.routes.auth import _check_password_policy
        _check_password_policy(pw)

    def test_strong_password_passes(self):
        self._check("Str0ng!PassWord#99")

    def test_too_short_raises(self):
        with pytest.raises(HTTPException) as exc:
            self._check("Short1!")
        assert "12 characters" in exc.value.detail

    def test_no_uppercase_raises(self):
        with pytest.raises(HTTPException) as exc:
            self._check("lowercase1234!!")
        assert "uppercase" in exc.value.detail

    def test_no_digit_raises(self):
        with pytest.raises(HTTPException) as exc:
            self._check("NoDigitsHere!!")
        assert "digit" in exc.value.detail

    def test_no_special_char_raises(self):
        with pytest.raises(HTTPException) as exc:
            self._check("NoSpecial1234Abc")
        assert "special" in exc.value.detail

    def test_multiple_failures_combined(self):
        with pytest.raises(HTTPException) as exc:
            self._check("short")
        # Should mention multiple issues
        assert exc.value.status_code == 400


# ── home.py pure helpers ──────────────────────────────────────────────────────

class TestParsTs:
    def _parse(self, s):
        from api.routes.home import _parse_ts
        return _parse_ts(s)

    def test_valid_iso_string(self):
        dt = self._parse("2025-06-01T12:00:00")
        assert dt is not None
        assert dt.year == 2025

    def test_z_suffix_parsed(self):
        dt = self._parse("2025-06-01T12:00:00Z")
        assert dt is not None

    def test_invalid_string_returns_none(self):
        assert self._parse("not-a-date") is None

    def test_empty_string_returns_none(self):
        assert self._parse("") is None


class TestCurrentStage:
    def _stage(self, intros):
        from api.routes.home import _current_stage
        return _current_stage(intros)

    def test_empty_list_returns_none(self):
        assert self._stage([]) is None

    def test_single_intro_returns_its_outcome(self):
        intros = [{"outcome": "Pilot"}]
        assert self._stage(intros) == "Pilot"

    def test_highest_rank_wins(self):
        intros = [
            {"outcome": "NDA"},
            {"outcome": "Commercial Agreement"},
            {"outcome": "PoC"},
        ]
        result = self._stage(intros)
        assert result == "Commercial Agreement"

    def test_unknown_outcome_ranked_lowest(self):
        intros = [{"outcome": "Unknown Stage"}, {"outcome": "Pilot"}]
        assert self._stage(intros) == "Pilot"

    def test_case_insensitive_ranking(self):
        intros = [{"outcome": "pilot"}, {"outcome": "NDA"}]
        assert self._stage(intros) == "pilot"


# ── security_headers constants ────────────────────────────────────────────────

class TestSecurityHeaders:
    def test_hsts_header_present(self):
        from api.middleware.security_headers import _HEADERS
        assert "Strict-Transport-Security" in _HEADERS
        assert "max-age=" in _HEADERS["Strict-Transport-Security"]

    def test_x_frame_options_deny(self):
        from api.middleware.security_headers import _HEADERS
        assert _HEADERS.get("X-Frame-Options") == "DENY"

    def test_x_content_type_nosniff(self):
        from api.middleware.security_headers import _HEADERS
        assert _HEADERS.get("X-Content-Type-Options") == "nosniff"

    def test_csp_present(self):
        from api.middleware.security_headers import _HEADERS
        assert "Content-Security-Policy" in _HEADERS
        csp = _HEADERS["Content-Security-Policy"]
        assert "default-src" in csp
        assert "frame-ancestors 'none'" in csp

    def test_referrer_policy_present(self):
        from api.middleware.security_headers import _HEADERS
        assert "Referrer-Policy" in _HEADERS
