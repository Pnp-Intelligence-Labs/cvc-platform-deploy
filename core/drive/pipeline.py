"""
core/drive/pipeline.py — Download → convert → tag a single Drive file.

Wraps the existing DD ingestion helpers (download_file, convert_file,
tag_document) so callers don't have to manage the sys.path shim.
"""

import sys
from pathlib import Path

from core.drive.browse import EXPORT_MIME

_DD_PATH = Path(__file__).resolve().parents[2] / "plugins" / "_staging" / "workers" / "dd"


def _ensure_dd_on_path():
    p = str(_DD_PATH)
    if p not in sys.path:
        sys.path.insert(0, p)


def ingest_file(svc, file_id: str, dest_dir: Path) -> dict:
    """Download one Drive file, convert to text, tag its type.

    Returns: {drive_file_id, filename, mime_type, doc_type, chars, conversion,
              text, text_path}. `conversion` is ok | truncated | skipped |
              failed | download_failed.
    """
    _ensure_dd_on_path()
    from ingestion.converter import convert_file
    from ingestion.drive import download_file
    from ingestion.tagger import tag_document

    dest_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = dest_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    meta = svc.files().get(fileId=file_id, fields="id,name,mimeType,size").execute()
    name, mime = meta["name"], meta["mimeType"]

    if mime in EXPORT_MIME:
        _, ext = EXPORT_MIME[mime]
        dest = raw_dir / (Path(name).stem + ext)
    else:
        dest = raw_dir / name

    base = {"drive_file_id": file_id, "filename": dest.name, "mime_type": mime}

    if not download_file(svc, file_id, mime, dest):
        return {**base, "doc_type": "unknown", "chars": 0, "conversion": "download_failed", "text": "", "text_path": None}

    result = convert_file(str(dest))
    text = result["text"]

    text_path = None
    if text:
        conv_dir = dest_dir / "converted"
        conv_dir.mkdir(parents=True, exist_ok=True)
        text_path = conv_dir / (Path(dest.name).stem + ".txt")
        text_path.write_text(text, encoding="utf-8")

    doc_type = tag_document(dest.name, text)
    return {
        **base,
        "doc_type": doc_type,
        "chars": result["chars"],
        "conversion": result["status"],
        "text": text,
        "text_path": str(text_path) if text_path else None,
    }
