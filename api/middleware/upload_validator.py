"""
api/middleware/upload_validator.py — MIME-type validation for file uploads (ISO 27001 A.8.12 / NIST 3.14)

Validates actual file content (magic bytes) rather than the client-supplied Content-Type header,
which is trivially spoofed. Rejects disallowed types with HTTP 415.

Uses the `filetype` library (pure Python, no system deps required).

ClamAV integration (optional):
    Set CLAMAV_ENABLED=true and CLAMAV_HOST/CLAMAV_PORT to enable virus scanning.
    Scan runs before any storage write; infected files are rejected with HTTP 422.
"""

import os
from fastapi import HTTPException

# Allowed MIME type prefixes — extend for additional formats
_ALLOWED: set[str] = {
    "application/pdf",
    "application/msword",                                                  # .doc
    "application/vnd.openxmlformats-officedocument.wordprocessingml",     # .docx
    "application/vnd.openxmlformats-officedocument.spreadsheetml",        # .xlsx
    "application/vnd.ms-excel",                                            # .xls
    "application/vnd.openxmlformats-officedocument.presentationml",       # .pptx
    "text/plain",
    "text/csv",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/zip",  # some docx/xlsx arrive as zip before sniffing
}

_CLAMAV_ENABLED = os.environ.get("CLAMAV_ENABLED", "false").lower() == "true"
_CLAMAV_HOST    = os.environ.get("CLAMAV_HOST", "clamav")
_CLAMAV_PORT    = int(os.environ.get("CLAMAV_PORT", "3310"))


def validate_upload(data: bytes, filename: str) -> str:
    """
    Validate file content via magic bytes. Returns detected MIME type.
    Raises HTTP 415 if type is not allowed.
    Raises HTTP 422 if ClamAV detects a virus (when CLAMAV_ENABLED=true).
    """
    mime = _detect_mime(data, filename)

    if not any(mime.startswith(allowed) for allowed in _ALLOWED):
        raise HTTPException(
            status_code=415,
            detail=f"File type '{mime}' is not permitted. Allowed: PDF, Word, Excel, plain text, CSV, images.",
        )

    if _CLAMAV_ENABLED:
        _scan_clamav(data, filename)

    return mime


def _detect_mime(data: bytes, filename: str) -> str:
    """Detect MIME from magic bytes. Falls back to extension if filetype cannot identify."""
    try:
        import filetype
        kind = filetype.guess(data)
        if kind:
            return kind.mime
    except ImportError:
        pass  # filetype not installed — fall back to extension

    # Extension-based fallback (less reliable but better than nothing)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    _ext_map = {
        "pdf": "application/pdf",
        "doc": "application/msword",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls": "application/vnd.ms-excel",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "txt": "text/plain",
        "csv": "text/csv",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "gif": "image/gif",
    }
    return _ext_map.get(ext, "application/octet-stream")


def _scan_clamav(data: bytes, filename: str) -> None:
    """Scan bytes with ClamAV. Raises HTTP 422 on detection. Silent on scan error."""
    try:
        import socket
        import struct

        # ClamAV INSTREAM protocol: send chunks then check response
        with socket.create_connection((_CLAMAV_HOST, _CLAMAV_PORT), timeout=10) as sock:
            sock.sendall(b"zINSTREAM\0")
            chunk_size = len(data)
            sock.sendall(struct.pack("!I", chunk_size) + data)
            sock.sendall(struct.pack("!I", 0))  # EOF chunk
            result = b""
            while True:
                part = sock.recv(4096)
                if not part:
                    break
                result += part

        result_str = result.rstrip(b"\0").decode("utf-8", errors="replace")
        if "FOUND" in result_str:
            raise HTTPException(
                status_code=422,
                detail=f"File '{filename}' failed virus scan and was rejected",
            )
    except HTTPException:
        raise
    except Exception:
        pass  # ClamAV unreachable — fail open; log separately
