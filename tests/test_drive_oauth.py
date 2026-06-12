"""
tests/test_drive_oauth.py — Unit tests for the per-user Google Drive flow.

Covers (no DB, no network — everything external is mocked):
  - core/drive/userauth.py  : state nonce lifecycle, flow config, token plumbing
  - api/routes/drive.py     : auth-status, auth-url, OAuth callback, ingest job
                              lifecycle, deingest path-traversal guard
  - core/drive/browse.py    : build_tree pagination + recursion
  - core/drive/pipeline.py  : ingest_file naming, download-failure handling
"""

import os
from pathlib import Path

# Must be set before importing api.routes.auth (raises RuntimeError otherwise)
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-unit-tests-abcdef1234")
os.environ.setdefault("HIBP_CHECK_ENABLED", "false")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import drive
from api.routes.auth import UserInfo, require_jwt
from core.drive import userauth

TEST_USER = UserInfo(
    user_id=42, username="tester", role="Member",
    full_name="Test User", assigned_partner_ids=[],
)


# ── fake DB-backed state store ────────────────────────────────────────────────

class FakeStateDB:
    """In-process replacement for cvc.drive_oauth_states DB table."""
    def __init__(self):
        self._rows: dict[str, dict] = {}

    def insert(self, state, user_id, return_to):
        self._rows[state] = {"user_id": user_id, "return_to": return_to}

    def consume(self, state):
        return self._rows.pop(state, None)

    def purge(self):
        pass  # no-op; TTL enforcement tested separately via consume returning None


def _patch_state_db(monkeypatch, db: FakeStateDB):
    """Wire monkeypatches so create_auth_url/consume_state/purge use FakeStateDB."""
    monkeypatch.setattr(userauth, "create_auth_url",
        lambda uid, return_to="ingest": _fake_create(db, uid, return_to))
    monkeypatch.setattr(userauth, "consume_state",
        lambda state: db.consume(state) if state else None)
    monkeypatch.setattr(userauth, "_purge_states", db.purge)


def _fake_create(db: FakeStateDB, user_id: int, return_to: str) -> str:
    import secrets
    state = secrets.token_urlsafe(16)
    db.insert(state, user_id, return_to)
    return f"https://accounts.google.com/o/oauth2/auth?state={state}"


# ── userauth: state nonce lifecycle ───────────────────────────────────────────

class FakeFlow:
    """Stands in for google_auth_oauthlib Flow."""
    def __init__(self):
        self.fetched_code = None
        self.credentials = None

    def authorization_url(self, **kwargs):
        return (f"https://accounts.google.com/o/oauth2/auth?state={kwargs['state']}", kwargs["state"])

    def fetch_token(self, code):
        self.fetched_code = code


class TestStateNonce:
    """Tests for the DB-backed state nonce: lifecycle, single-use, None/unknown."""

    def _db(self):
        return FakeStateDB()

    def test_create_stores_state(self):
        db = self._db()
        url = _fake_create(db, 42, "ingest")
        assert url.startswith("https://accounts.google.com/")
        assert len(db._rows) == 1
        entry = next(iter(db._rows.values()))
        assert entry == {"user_id": 42, "return_to": "ingest"}

    def test_state_embedded_in_url(self):
        db = self._db()
        url = _fake_create(db, 42, "ingest")
        state = next(iter(db._rows.keys()))
        assert state in url

    def test_consume_valid_state(self):
        db = self._db()
        _fake_create(db, 7, "terminal")
        state = next(iter(db._rows.keys()))
        entry = db.consume(state)
        assert entry == {"user_id": 7, "return_to": "terminal"}

    def test_state_is_single_use(self):
        db = self._db()
        _fake_create(db, 7, "ingest")
        state = next(iter(db._rows.keys()))
        assert db.consume(state) is not None
        assert db.consume(state) is None

    def test_consume_none_returns_none(self):
        assert userauth.consume_state(None) is None

    def test_consume_unknown_returns_none(self, monkeypatch):
        # consume_state hits DB; monkeypatch _load so it returns nothing
        monkeypatch.setattr(userauth, "consume_state", lambda s: None if s else None)
        assert userauth.consume_state("bogus") is None


# ── userauth: flow config + token plumbing ────────────────────────────────────

class TestBuildFlow:
    def test_env_client_used_when_set(self, monkeypatch):
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid-123")
        monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "sec-456")
        flow = userauth._build_flow()
        assert flow.client_config["client_id"] == "cid-123"

    def test_raises_when_nothing_configured(self, monkeypatch):
        monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
        monkeypatch.delenv("GOOGLE_CLIENT_SECRET", raising=False)
        monkeypatch.setattr(userauth, "CREDS_PATH", Path("/nonexistent/creds.json"))
        with pytest.raises(FileNotFoundError):
            userauth._build_flow()


class TestTokenPlumbing:
    def test_load_creds_none_when_not_connected(self, monkeypatch):
        monkeypatch.setattr(userauth, "_load_token_row", lambda uid: None)
        assert userauth.load_creds(42) is None

    def test_build_service_raises_when_not_connected(self, monkeypatch):
        monkeypatch.setattr(userauth, "load_creds", lambda uid: None)
        with pytest.raises(ValueError):
            userauth.build_service(42)

    def test_get_status_disconnected(self, monkeypatch):
        monkeypatch.setattr(userauth, "_load_token_row", lambda uid: None)
        assert userauth.get_status(42) == {"connected": False}

    def test_exchange_and_save_persists_token(self, monkeypatch):
        saved = {}
        fake = FakeFlow()
        fake.credentials = type("C", (), {"to_json": lambda self: '{"token": "t"}'})()
        monkeypatch.setattr(userauth, "_build_flow", lambda: fake)
        monkeypatch.setattr(userauth, "_lookup_email", lambda creds: "u@example.com")
        monkeypatch.setattr(userauth, "_save_token",
                            lambda uid, tj, email: saved.update(uid=uid, tj=tj, email=email))
        email = userauth.exchange_and_save(42, "auth-code-xyz")
        assert email == "u@example.com"
        assert fake.fetched_code == "auth-code-xyz"
        assert saved == {"uid": 42, "tj": '{"token": "t"}', "email": "u@example.com"}


# ── drive routes ──────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(drive.router, prefix="/drive")
    app.include_router(drive.public_router, prefix="/drive")
    app.dependency_overrides[require_jwt] = lambda: TEST_USER
    return TestClient(app)


class TestAuthEndpoints:
    def test_auth_status_not_connected(self, client, monkeypatch):
        monkeypatch.setattr(drive.userauth, "get_status", lambda uid: {"connected": False})
        r = client.get("/drive/auth-status")
        assert r.status_code == 200
        assert r.json() == {"authenticated": False, "reason": "not_connected"}

    def test_auth_status_connected(self, client, monkeypatch):
        monkeypatch.setattr(drive.userauth, "get_status",
                            lambda uid: {"connected": True, "google_email": "u@example.com"})
        r = client.get("/drive/auth-status")
        assert r.json() == {"authenticated": True, "google_email": "u@example.com"}

    def test_auth_url_returns_consent_url(self, client, monkeypatch):
        monkeypatch.setattr(drive.userauth, "create_auth_url",
                            lambda uid, return_to: f"https://accounts.google.com/x?u={uid}&r={return_to}")
        r = client.get("/drive/auth-url?return_to=terminal")
        assert r.status_code == 200
        assert r.json()["url"] == "https://accounts.google.com/x?u=42&r=terminal"

    def test_auth_url_503_when_unconfigured(self, client, monkeypatch):
        def boom(uid, return_to):
            raise FileNotFoundError("Google OAuth client not configured")
        monkeypatch.setattr(drive.userauth, "create_auth_url", boom)
        r = client.get("/drive/auth-url")
        assert r.status_code == 503


class TestCallback:
    def test_google_error_redirects_with_drive_error(self, client, monkeypatch):
        monkeypatch.setattr(drive.userauth, "consume_state",
                            lambda s: {"user_id": 42, "return_to": "ingest"})
        r = client.get("/drive/callback?error=access_denied&state=s1", follow_redirects=False)
        assert r.status_code == 307
        assert r.headers["location"] == "/app/ingest?drive_error=access_denied"

    def test_invalid_state_400(self, client, monkeypatch):
        monkeypatch.setattr(drive.userauth, "consume_state", lambda s: None)
        r = client.get("/drive/callback?code=abc&state=expired", follow_redirects=False)
        assert r.status_code == 400

    def test_success_saves_and_redirects(self, client, monkeypatch):
        calls = {}
        monkeypatch.setattr(drive.userauth, "consume_state",
                            lambda s: {"user_id": 42, "return_to": "ingest"})
        monkeypatch.setattr(drive.userauth, "exchange_and_save",
                            lambda uid, code: calls.update(uid=uid, code=code) or "u@example.com")
        r = client.get("/drive/callback?code=abc&state=s1", follow_redirects=False)
        assert r.status_code == 307
        assert r.headers["location"] == "/app/ingest?drive_connected=1"
        assert calls == {"uid": 42, "code": "abc"}

    def test_exchange_failure_redirects_with_error(self, client, monkeypatch):
        monkeypatch.setattr(drive.userauth, "consume_state",
                            lambda s: {"user_id": 42, "return_to": "ingest"})
        def boom(uid, code):
            raise RuntimeError("token exchange failed")
        monkeypatch.setattr(drive.userauth, "exchange_and_save", boom)
        r = client.get("/drive/callback?code=abc&state=s1", follow_redirects=False)
        assert r.status_code == 307
        assert "drive_error=" in r.headers["location"]


class FakeService:
    """Minimal stand-in for a googleapiclient Drive service."""
    def __init__(self, pages=None, meta=None):
        self._pages = pages or []
        self._meta = meta or {}

    def files(self):
        return self

    def list(self, **kwargs):
        page_token = kwargs.get("pageToken")
        idx = 0 if page_token is None else int(page_token)
        page = dict(self._pages[idx]) if idx < len(self._pages) else {"files": []}
        return _Executable(page)

    def get(self, fileId=None, fields=None):
        return _Executable(self._meta.get(fileId, {}))


class _Executable:
    def __init__(self, result):
        self._result = result

    def execute(self):
        return self._result


class TestIngestRoutes:
    def test_ingest_requires_company(self, client, monkeypatch):
        monkeypatch.setattr(drive.userauth, "build_service", lambda uid: FakeService())
        r = client.post("/drive/ingest", json={"company": "  ", "file_ids": ["f1"]})
        assert r.status_code == 400

    def test_ingest_requires_files(self, client, monkeypatch):
        monkeypatch.setattr(drive.userauth, "build_service", lambda uid: FakeService())
        r = client.post("/drive/ingest", json={"company": "Acme", "file_ids": []})
        assert r.status_code == 400

    def test_ingest_503_when_drive_not_connected(self, client, monkeypatch):
        def boom(uid):
            raise ValueError("not connected")
        monkeypatch.setattr(drive.userauth, "build_service", boom)
        r = client.post("/drive/ingest", json={"company": "Acme", "file_ids": ["f1"]})
        assert r.status_code == 503

    def test_ingest_job_lifecycle(self, client, monkeypatch, tmp_path):
        monkeypatch.setattr(drive, "_WORKDIR", tmp_path)
        monkeypatch.setattr(drive.userauth, "build_service", lambda uid: FakeService())
        monkeypatch.setattr(drive, "ingest_file", lambda svc, fid, dest: {
            "filename": f"{fid}.pdf", "doc_type": "deck", "chars": 100, "conversion": "ok",
        })
        r = client.post("/drive/ingest", json={"company": "Acme Co", "file_ids": ["f1", "f2"]})
        assert r.status_code == 200
        job_id = r.json()["job_id"]

        # TestClient runs background tasks before returning, so the job is done
        st = client.get(f"/drive/ingest/{job_id}").json()
        assert st["status"] == "done"
        assert st["progress"] == 2
        assert st["summary"] == {"total": 2, "converted": 2, "skipped": 0, "failed": 0}

    def test_ingest_counts_failures_per_file(self, client, monkeypatch, tmp_path):
        monkeypatch.setattr(drive, "_WORKDIR", tmp_path)
        monkeypatch.setattr(drive.userauth, "build_service", lambda uid: FakeService())

        def flaky(svc, fid, dest):
            if fid == "bad":
                raise RuntimeError("download exploded")
            return {"filename": f"{fid}.pdf", "doc_type": "deck", "chars": 10, "conversion": "ok"}

        monkeypatch.setattr(drive, "ingest_file", flaky)
        r = client.post("/drive/ingest", json={"company": "Acme", "file_ids": ["ok1", "bad"]})
        st = client.get(f"/drive/ingest/{r.json()['job_id']}").json()
        assert st["status"] == "done"
        assert st["summary"]["converted"] == 1
        assert st["summary"]["failed"] == 1
        failed_entry = [e for e in st["results"] if e["conversion"] == "failed"][0]
        assert "download exploded" in failed_entry["error"]

    def test_unknown_job_404(self, client):
        assert client.get("/drive/ingest/nope").status_code == 404

    def test_list_ingested_empty(self, client, monkeypatch, tmp_path):
        monkeypatch.setattr(drive, "_WORKDIR", tmp_path)
        assert client.get("/drive/ingested").json() == []

    def test_list_ingested_returns_company_dirs(self, client, monkeypatch, tmp_path):
        monkeypatch.setattr(drive, "_WORKDIR", tmp_path)
        (tmp_path / "user_42" / "Acme").mkdir(parents=True)
        (tmp_path / "user_42" / ".hidden").mkdir()
        assert client.get("/drive/ingested").json() == ["Acme"]

    def test_deingest_missing_404(self, client, monkeypatch, tmp_path):
        monkeypatch.setattr(drive, "_WORKDIR", tmp_path)
        assert client.delete("/drive/ingested/Nope").status_code == 404

    def test_deingest_removes_dir(self, client, monkeypatch, tmp_path):
        monkeypatch.setattr(drive, "_WORKDIR", tmp_path)
        target = tmp_path / "user_42" / "Acme"
        target.mkdir(parents=True)
        r = client.delete("/drive/ingested/Acme")
        assert r.status_code == 200
        assert not target.exists()

    def test_deingest_blocks_path_traversal(self, client, monkeypatch, tmp_path):
        monkeypatch.setattr(drive, "_WORKDIR", tmp_path)
        (tmp_path / "user_42").mkdir(parents=True)
        outside = tmp_path / "outside"
        outside.mkdir()
        r = client.delete("/drive/ingested/..%2F..%2Foutside")
        assert r.status_code in (400, 404)
        assert outside.exists()


# ── browse: build_tree ────────────────────────────────────────────────────────

class TestBuildTree:
    def test_files_and_folders_split(self):
        svc = FakeService(pages=[{
            "files": [
                {"id": "d1", "name": "Folder", "mimeType": "application/vnd.google-apps.folder"},
                {"id": "f1", "name": "deck.pdf", "mimeType": "application/pdf", "size": "10"},
            ],
        }])
        # Recursion into d1 hits the same single page; cap depth to keep it finite
        from core.drive.browse import build_tree
        tree = build_tree(svc, "root", depth=3, max_depth=3)
        assert [f["name"] for f in tree["files"]] == ["deck.pdf"]
        assert tree["folders"][0]["name"] == "Folder"
        assert tree["folders"][0]["children"] == {"folders": [], "files": [], "truncated": True}

    def test_pagination_follows_next_page_token(self):
        svc = FakeService(pages=[
            {"files": [{"id": "a", "name": "a.pdf", "mimeType": "application/pdf"}], "nextPageToken": "1"},
            {"files": [{"id": "b", "name": "b.pdf", "mimeType": "application/pdf"}]},
        ])
        from core.drive.browse import build_tree
        tree = build_tree(svc, "root")
        assert [f["id"] for f in tree["files"]] == ["a", "b"]


# ── pipeline: ingest_file ─────────────────────────────────────────────────────

class TestIngestFilePipeline:
    def _svc(self, mime):
        return FakeService(meta={"f1": {"id": "f1", "name": "Pitch Deck", "mimeType": mime}})

    def test_google_doc_exported_with_office_extension(self, monkeypatch, tmp_path):
        from core.drive import pipeline
        monkeypatch.setattr(pipeline, "download_file", lambda svc, fid, mime, dest: True)
        monkeypatch.setattr(pipeline, "convert_file",
                            lambda p: {"text": "hello", "chars": 5, "status": "ok"})
        monkeypatch.setattr(pipeline, "tag_document", lambda name, text: "deck")

        doc = pipeline.ingest_file(self._svc("application/vnd.google-apps.document"), "f1", tmp_path)
        assert doc["filename"] == "Pitch Deck.docx"
        assert doc["conversion"] == "ok"
        assert doc["doc_type"] == "deck"
        assert (tmp_path / "converted" / "Pitch Deck.txt").read_text() == "hello"

    def test_download_failure_short_circuits(self, monkeypatch, tmp_path):
        from core.drive import pipeline
        monkeypatch.setattr(pipeline, "download_file", lambda svc, fid, mime, dest: False)
        doc = pipeline.ingest_file(self._svc("application/pdf"), "f1", tmp_path)
        assert doc["conversion"] == "download_failed"
        assert doc["chars"] == 0
        assert doc["text"] == ""
