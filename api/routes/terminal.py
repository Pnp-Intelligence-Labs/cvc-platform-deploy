"""
terminal.py — Per-user "My Terminal": a personal, Drive-powered workspace.

Each user connects their own Google Drive, ingests their own files, and the
platform makes sense of them (doc type + summary + key points). Everything is
scoped to the authenticated user — isolated from preexisting platform data and
from other users.

All routes require JWT. The OAuth callback itself lives on the public drive
router (Google redirects there without a JWT) and routes back here by state.
"""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from api.routes.auth import require_jwt, UserInfo
from core.db.connection import get_connection
from core.drive import userauth
from core.drive.browse import build_tree
from core.drive.pipeline import ingest_file, _DD_PATH
from core.drive.sense import make_sense, answer_question

router = APIRouter()

_TERMINAL_ROOT = _DD_PATH / "workdir" / "terminal"


def _user_dir(user_id: int) -> Path:
    return _TERMINAL_ROOT / f"user_{user_id}"


# ── Connection / OAuth ──────────────────────────────────────────────────────────

@router.get("/status")
def status(user: UserInfo = Depends(require_jwt)):
    """Whether this user has connected their Google Drive."""
    return userauth.get_status(user.user_id)


@router.get("/auth-url")
def auth_url(user: UserInfo = Depends(require_jwt)):
    """Return the Google consent URL for this user. Frontend navigates to it."""
    try:
        return {"url": userauth.create_auth_url(user.user_id, return_to="terminal")}
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/disconnect")
def disconnect(user: UserInfo = Depends(require_jwt)):
    userauth.disconnect(user.user_id)
    return {"disconnected": True}


# ── Browse ──────────────────────────────────────────────────────────────────────

@router.get("/browse")
def browse(user: UserInfo = Depends(require_jwt)):
    """Return this user's Drive tree (up to 3 folders deep)."""
    try:
        svc = userauth.build_service(user.user_id)
    except ValueError:
        raise HTTPException(status_code=503, detail="Google Drive not connected. Use 'Connect Drive'.")
    try:
        return build_tree(svc, "root")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Drive error: {e}")


# ── Ingest ──────────────────────────────────────────────────────────────────────

class IngestRequest(BaseModel):
    file_ids: list[str]


@router.post("/ingest")
def ingest(req: IngestRequest, user: UserInfo = Depends(require_jwt)):
    """Download selected Drive files into this user's workspace, convert, tag,
    and make sense of each. Persists one row per document."""
    if not req.file_ids:
        raise HTTPException(status_code=400, detail="No files selected")

    try:
        svc = userauth.build_service(user.user_id)
    except ValueError:
        raise HTTPException(status_code=503, detail="Google Drive not connected. Use 'Connect Drive'.")

    dest_dir = _user_dir(user.user_id)
    results = []

    for fid in req.file_ids:
        try:
            doc = ingest_file(svc, fid, dest_dir)
        except Exception as e:
            results.append({"filename": f"file_{fid}", "doc_type": "unknown", "chars": 0,
                            "conversion": "failed", "summary": f"Ingest error: {e}", "error": str(e)})
            continue

        sense = (make_sense(doc["filename"], doc["doc_type"], doc["text"])
                 if doc["conversion"] in ("ok", "truncated")
                 else {"summary": f"File {doc['conversion']} — no text extracted.", "key_points": []})

        row = _store_document(user.user_id, doc, sense)
        results.append({
            "id": row["id"],
            "filename": doc["filename"],
            "doc_type": doc["doc_type"],
            "chars": doc["chars"],
            "conversion": doc["conversion"],
            "summary": sense["summary"],
        })

    return {
        "ingested": len(results),
        "summary": {
            "total": len(results),
            "converted": sum(1 for d in results if d["conversion"] in ("ok", "truncated")),
            "skipped": sum(1 for d in results if d["conversion"] == "skipped"),
            "failed": sum(1 for d in results if d["conversion"] in ("failed", "download_failed")),
        },
        "documents": results,
    }


def _store_document(user_id: int, doc: dict, sense: dict) -> dict:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO cvc.drive_documents
                    (user_id, drive_file_id, filename, mime_type, doc_type, chars,
                     conversion, text_path, summary, key_points)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, drive_file_id) DO UPDATE SET
                    filename = EXCLUDED.filename,
                    mime_type = EXCLUDED.mime_type,
                    doc_type = EXCLUDED.doc_type,
                    chars = EXCLUDED.chars,
                    conversion = EXCLUDED.conversion,
                    text_path = EXCLUDED.text_path,
                    summary = EXCLUDED.summary,
                    key_points = EXCLUDED.key_points,
                    ingested_at = NOW()
                RETURNING id
                """,
                (user_id, doc["drive_file_id"], doc["filename"], doc["mime_type"],
                 doc["doc_type"], doc["chars"], doc["conversion"], doc["text_path"],
                 sense["summary"], json.dumps(sense["key_points"])),
            )
            return cur.fetchone()


# ── Documents ─────────────────────────────────────────────────────────────────

@router.get("/documents")
def list_documents(user: UserInfo = Depends(require_jwt)):
    """List this user's ingested documents (newest first)."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, filename, mime_type, doc_type, chars, conversion,
                       summary, key_points, drive_file_id, ingested_at
                FROM cvc.drive_documents
                WHERE user_id = %s
                ORDER BY ingested_at DESC
                """,
                (user.user_id,),
            )
            return {"documents": [dict(r) for r in cur.fetchall()]}


@router.get("/documents/{doc_id}")
def get_document(doc_id: int, user: UserInfo = Depends(require_jwt)):
    """Return one document with its full extracted text."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, filename, mime_type, doc_type, chars, conversion,
                       summary, key_points, text_path, ingested_at
                FROM cvc.drive_documents
                WHERE id = %s AND user_id = %s
                """,
                (doc_id, user.user_id),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    row = dict(row)
    text = ""
    if row.get("text_path"):
        p = Path(row["text_path"])
        if p.exists():
            text = p.read_text(encoding="utf-8", errors="replace")
    row["text"] = text
    row.pop("text_path", None)
    return row


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.drive_documents WHERE id = %s AND user_id = %s RETURNING text_path",
                (doc_id, user.user_id),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    # Best-effort cleanup of the extracted text file.
    if row.get("text_path"):
        Path(row["text_path"]).unlink(missing_ok=True)
    return {"deleted": doc_id}


# ── Ask ─────────────────────────────────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str


@router.post("/ask")
def ask(req: AskRequest, user: UserInfo = Depends(require_jwt)):
    """Answer a question across this user's ingested documents."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question required")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, filename, doc_type, summary, text_path FROM cvc.drive_documents "
                "WHERE user_id = %s ORDER BY ingested_at DESC LIMIT 50",
                (user.user_id,),
            )
            rows = [dict(r) for r in cur.fetchall()]

    docs = []
    for r in rows:
        text = ""
        if r.get("text_path"):
            p = Path(r["text_path"])
            if p.exists():
                text = p.read_text(encoding="utf-8", errors="replace")
        docs.append({"id": r["id"], "filename": r["filename"], "doc_type": r["doc_type"],
                     "summary": r["summary"], "text": text})

    return answer_question(req.question.strip(), docs)
