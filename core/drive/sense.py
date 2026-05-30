"""
core/drive/sense.py — "Make sense" layer for ingested documents.

Turns raw extracted text into something the software understands: a short
summary and key points per document, plus a corpus question-answerer.

Uses OpenRouter when OPENROUTER_API_KEY is set (richer output). Falls back to a
fully offline extractive method otherwise, so the feature works out of the box.
"""

import os
import re
import json

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
_MODEL = os.environ.get("OPENROUTER_MODEL", "qwen/qwen3-235b-a22b-2507")


# ── LLM transport ───────────────────────────────────────────────────────────────

def _llm_enabled() -> bool:
    return bool(os.environ.get("OPENROUTER_API_KEY"))


def _openrouter_chat(messages: list[dict], max_tokens: int = 700) -> str | None:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        return None
    try:
        import requests
        resp = requests.post(
            _OPENROUTER_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": _MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2},
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return None


# ── Text helpers ────────────────────────────────────────────────────────────────

def _clean(text: str) -> str:
    # Collapse whitespace, drop empty lines and obvious table noise.
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln and not set(ln) <= {"|", "-", " ", ":"}]
    return "\n".join(lines)


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    return [p.strip() for p in parts if len(p.strip()) > 25]


# ── Per-document sense ──────────────────────────────────────────────────────────

def make_sense(filename: str, doc_type: str, text: str) -> dict:
    """Return {summary, key_points} for one document."""
    text = _clean(text or "")
    if not text:
        return {"summary": "No readable text could be extracted from this file.", "key_points": []}

    if _llm_enabled():
        out = _llm_sense(filename, doc_type, text)
        if out:
            return out

    return _extractive_sense(text)


def _llm_sense(filename: str, doc_type: str, text: str) -> dict | None:
    prompt = (
        f"You are analyzing a document named '{filename}' (type: {doc_type}).\n"
        "Return STRICT JSON with two fields:\n"
        '  "summary": a 2-3 sentence plain-English synopsis of what this document is and contains.\n'
        '  "key_points": an array of 3-6 short factual bullet strings (numbers, names, terms).\n'
        "Return ONLY the JSON object, no prose.\n\n"
        f"DOCUMENT:\n{text[:12000]}"
    )
    raw = _openrouter_chat([{"role": "user", "content": prompt}])
    if not raw:
        return None
    try:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(match.group(0) if match else raw)
        summary = str(data.get("summary", "")).strip()
        points = [str(p).strip() for p in data.get("key_points", []) if str(p).strip()]
        if summary:
            return {"summary": summary, "key_points": points[:6]}
    except Exception:
        return None
    return None


def _extractive_sense(text: str) -> dict:
    sents = _sentences(text)
    summary = " ".join(sents[:3])[:600] if sents else text[:600]

    # Key points: lines that carry signal — contain digits, %, $, or look like headings.
    points: list[str] = []
    for ln in text.splitlines():
        s = ln.strip(" -•\t")
        if not s or len(s) > 160:
            continue
        if re.search(r"\d|%|\$|€|£", s) or (s[:1].isupper() and len(s.split()) <= 10):
            points.append(s)
        if len(points) >= 6:
            break

    return {"summary": summary or "Document ingested.", "key_points": points}


# ── Corpus Q&A ──────────────────────────────────────────────────────────────────

def _score(question: str, doc: dict) -> int:
    terms = {t for t in re.findall(r"[a-z0-9]{3,}", question.lower())}
    hay = f"{doc.get('filename','')} {doc.get('summary','')} {doc.get('text','')}".lower()
    return sum(hay.count(t) for t in terms)


def answer_question(question: str, docs: list[dict]) -> dict:
    """Answer a question across the user's ingested documents.
    docs: list of {id, filename, doc_type, summary, text}. Returns {answer, sources}."""
    if not docs:
        return {"answer": "You haven't ingested any documents yet. Connect Drive and ingest files first.", "sources": []}

    ranked = sorted(docs, key=lambda d: _score(question, d), reverse=True)
    top = [d for d in ranked if _score(question, d) > 0][:3] or ranked[:1]
    sources = [{"id": d["id"], "filename": d["filename"], "doc_type": d.get("doc_type")} for d in top]

    if _llm_enabled():
        context = "\n\n".join(
            f"[{d['filename']}]\n{(d.get('text') or d.get('summary') or '')[:6000]}" for d in top
        )
        raw = _openrouter_chat(
            [
                {"role": "system", "content": "Answer ONLY from the provided documents. If the answer isn't there, say so. Cite filenames inline."},
                {"role": "user", "content": f"Documents:\n{context}\n\nQuestion: {question}"},
            ],
            max_tokens=600,
        )
        if raw:
            return {"answer": raw.strip(), "sources": sources}

    # Offline fallback: return the most relevant snippets.
    snippets = []
    qterms = {t for t in re.findall(r"[a-z0-9]{3,}", question.lower())}
    for d in top:
        for sent in _sentences(d.get("text") or d.get("summary") or ""):
            if any(t in sent.lower() for t in qterms):
                snippets.append(f"• ({d['filename']}) {sent}")
            if len(snippets) >= 6:
                break
        if len(snippets) >= 6:
            break

    if not snippets:
        body = "No direct match found. Most relevant document(s): " + ", ".join(d["filename"] for d in top)
    else:
        body = "Based on your documents:\n" + "\n".join(snippets)
    return {"answer": body, "sources": sources}
