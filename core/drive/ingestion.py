"""
core/drive/ingestion.py — Download → convert → tag helpers for Drive ingestion.

Replaces the proprietary dd-worker ingestion module (removed from this repo in
ffd56c9) with a clean, tracked implementation. Same contract as before:

    download_file(svc, file_id, mime, dest) -> bool
    convert_file(path)                      -> {text, chars, status}
    tag_document(filename, text)            -> doc_type

status: ok | truncated | skipped | failed
"""

import io
import re
from pathlib import Path

from core.drive.browse import EXPORT_MIME

# Cap extracted text so one giant file can't blow up the DB row / LLM context.
MAX_TEXT_CHARS = 400_000

# Extensions we never try to convert (binary/media).
_SKIP_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg", ".ico", ".webp",
    ".mp3", ".mp4", ".mov", ".avi", ".wav", ".zip", ".gz", ".tar", ".rar",
    ".exe", ".dmg", ".iso", ".woff", ".woff2", ".ttf",
}

_PLAIN_EXTS = {".txt", ".md", ".csv", ".tsv", ".json", ".log", ".yaml", ".yml", ".html", ".htm"}


# ── Download ────────────────────────────────────────────────────────────────────

def download_file(svc, file_id: str, mime: str, dest: Path) -> bool:
    """Download a Drive file to `dest`. Google-native files are exported to the
    Office format in EXPORT_MIME. Returns False on any failure."""
    from googleapiclient.http import MediaIoBaseDownload

    try:
        if mime in EXPORT_MIME:
            export_mime, _ = EXPORT_MIME[mime]
            request = svc.files().export_media(fileId=file_id, mimeType=export_mime)
        else:
            request = svc.files().get_media(fileId=file_id, supportsAllDrives=True)

        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()

        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(buf.getvalue())
        return True
    except Exception:
        return False


# ── Convert ─────────────────────────────────────────────────────────────────────

def convert_file(path: str) -> dict:
    """Extract plain text from a file. Returns {text, chars, status}."""
    p = Path(path)
    ext = p.suffix.lower()

    if ext in _SKIP_EXTS:
        return {"text": "", "chars": 0, "status": "skipped"}

    text = None
    if ext in _PLAIN_EXTS:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            text = None

    if text is None:
        text = _convert_markitdown(p)

    if text is None and ext == ".pdf":
        text = _convert_pdfplumber(p)

    if text is None:
        return {"text": "", "chars": 0, "status": "failed"}

    text = text.strip()
    if len(text) > MAX_TEXT_CHARS:
        return {"text": text[:MAX_TEXT_CHARS], "chars": MAX_TEXT_CHARS, "status": "truncated"}
    return {"text": text, "chars": len(text), "status": "ok"}


def _convert_markitdown(p: Path) -> str | None:
    try:
        from markitdown import MarkItDown
        result = MarkItDown(enable_plugins=False).convert(str(p))
        return result.text_content or ""
    except Exception:
        return None


def _convert_pdfplumber(p: Path) -> str | None:
    try:
        import pdfplumber
        pages = []
        with pdfplumber.open(str(p)) as pdf:
            for page in pdf.pages:
                pages.append(page.extract_text() or "")
        return "\n\n".join(pages)
    except Exception:
        return None


# ── Tag ─────────────────────────────────────────────────────────────────────────

# Ordered: first match wins. Patterns checked against filename + first 4k chars.
_DOC_TYPE_RULES: list[tuple[str, list[str]]] = [
    ("pitch_deck",  [r"pitch", r"deck", r"investor presentation", r"company overview"]),
    ("financials",  [r"financial", r"p&l", r"profit\s*(and|&)\s*loss", r"balance sheet",
                     r"income statement", r"cash flow", r"budget", r"forecast", r"revenue model"]),
    ("cap_table",   [r"cap\s*table", r"capitalization", r"share(holder)? register", r"equity ledger"]),
    ("legal",       [r"\bnda\b", r"non-disclosure", r"agreement", r"contract", r"term sheet",
                     r"\bsafe\b", r"articles of (incorporation|association)", r"bylaws", r"\bmsa\b"]),
    ("memo",        [r"\bmemo\b", r"investment memo", r"ic memo", r"due diligence", r"\bdd\b"]),
    ("report",      [r"report", r"market (analysis|research|map)", r"landscape", r"benchmark", r"survey"]),
    ("meeting_notes", [r"meeting", r"minutes", r"notes", r"standup", r"sync", r"agenda", r"call with"]),
    ("metrics",     [r"\bkpi\b", r"metrics", r"dashboard", r"traction", r"\bmrr\b", r"\barr\b", r"cohort"]),
]


def tag_document(filename: str, text: str) -> str:
    """Heuristic doc-type tag from filename + leading text."""
    hay = f"{filename}\n{(text or '')[:4000]}".lower()
    for doc_type, patterns in _DOC_TYPE_RULES:
        if any(re.search(pat, hay) for pat in patterns):
            return doc_type
    return "other"
