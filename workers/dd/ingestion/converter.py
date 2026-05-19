"""
converter.py — Convert dataroom files to plain text.
Uses pandas CSV for XLSX/XLS (more LLM-friendly than markdown tables).
Uses MarkItDown for PDF, DOCX, PPTX, and everything else.
Returns clean text per document — no giant blobs.
"""

from pathlib import Path
from config.settings import SUPPORTED_EXTENSIONS, MAX_CHARS_PER_DOC

SPREADSHEET_EXTENSIONS = {".xlsx", ".xls"}


def _xlsx_to_csv_text(p: Path) -> str:
    """Convert Excel file to CSV text, one section per sheet."""
    import pandas as pd
    engine = "openpyxl" if p.suffix.lower() == ".xlsx" else "xlrd"
    sheets = pd.read_excel(str(p), sheet_name=None, engine=engine)
    parts = []
    for sheet_name, df in sheets.items():
        if df.empty:
            continue
        parts.append(f"## {sheet_name}")
        parts.append(df.to_csv(index=False))
    return "\n\n".join(parts)


def convert_file(local_path: str) -> dict:
    """
    Convert a file to plain text.
    Returns:
        {
            "text":     str,
            "status":   "ok" | "truncated" | "failed" | "skipped",
            "chars":    int,
        }
    """
    p = Path(local_path)

    if p.suffix.lower() not in SUPPORTED_EXTENSIONS:
        return {"text": "", "status": "skipped", "chars": 0}

    # ── XLSX/XLS: use pandas CSV — more compact and LLM-friendly than markdown tables
    if p.suffix.lower() in SPREADSHEET_EXTENSIONS:
        try:
            text = _xlsx_to_csv_text(p)
            if not text or len(text.strip()) < 10:
                return {"text": "", "status": "failed", "chars": 0}
            chars = len(text)
            if chars > MAX_CHARS_PER_DOC:
                text = text[:MAX_CHARS_PER_DOC]
                return {"text": text, "status": "truncated", "chars": chars}
            return {"text": text, "status": "ok", "chars": chars}
        except Exception as e:
            return {"text": "", "status": "failed", "chars": 0}

    try:
        from markitdown import MarkItDown
        md = MarkItDown()
        result = md.convert(str(p))

        if not result or not result.text_content or len(result.text_content.strip()) < 50:
            return {"text": "", "status": "failed", "chars": 0}

        text = result.text_content
        chars = len(text)

        if chars > MAX_CHARS_PER_DOC:
            text = text[:MAX_CHARS_PER_DOC]
            return {"text": text, "status": "truncated", "chars": chars}

        return {"text": text, "status": "ok", "chars": chars}

    except Exception as e:
        return {"text": "", "status": "failed", "chars": 0}


def convert_all(downloaded: list[dict], converted_dir: Path) -> list[dict]:
    """
    Convert all downloaded files to text.
    Saves .txt files alongside originals in converted_dir.
    Returns enriched list with conversion results added.
    """
    converted_dir.mkdir(parents=True, exist_ok=True)
    results = []

    for doc in downloaded:
        if not doc.get("success"):
            results.append({**doc, "text": "", "text_path": None, "conversion": "download_failed", "chars": 0})
            continue

        result = convert_file(doc["local_path"])

        # Save text file — preserve relative path structure to avoid filename collisions
        # e.g. subdir/Overview.pdf → converted/subdir/Overview.txt
        text_path = None
        if result["text"]:
            text_path = converted_dir / Path(doc["rel_path"]).with_suffix(".txt")
            text_path.parent.mkdir(parents=True, exist_ok=True)
            text_path.write_text(result["text"], encoding="utf-8")

        results.append({
            **doc,
            "text":       result["text"],
            "text_path":  str(text_path) if text_path else None,
            "conversion": result["status"],
            "chars":      result["chars"],
        })

    return results
