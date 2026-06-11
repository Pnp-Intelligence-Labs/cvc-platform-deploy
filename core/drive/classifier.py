"""
core/drive/classifier.py — Route ingested documents to the platform tab where
that kind of data lives.

The TAB_REGISTRY is the single source of truth for "where data lives": each
platform tab with its frontend path and the backing tables. classify() maps an
ingested document (filename + doc_type + text) onto one of those tabs.

Uses OpenRouter when OPENROUTER_API_KEY is set; otherwise a keyword heuristic,
so classification works out of the box (same pattern as core/drive/sense.py).
"""

import json
import re

from core.drive.sense import _llm_enabled, _openrouter_chat

# Where data lives, per tab. Keys are stable identifiers stored in
# cvc.drive_documents.target_tab; `path` matches the SPA route.
TAB_REGISTRY: dict[str, dict] = {
    "home": {
        "label": "Home / My Desk",
        "path": "/",
        "tables": ["cvc.drive_documents", "cvc.users"],
        "holds": "personal workspace docs, notes, meeting summaries, personal Drive ingests",
    },
    "ventures": {
        "label": "Ventures",
        "path": "/ventures",
        "tables": ["cvc.companies", "cvc.funding_rounds", "cvc.company_lifecycle", "cvc.shortlists"],
        "holds": "startup/company data: pitch decks, sourcing lists, dealflow, diligence memos, portfolio company updates",
    },
    "partners": {
        "label": "Partners",
        "path": "/partners",
        "tables": ["cvc.partners", "cvc.partner_documents", "cvc.partner_intros"],
        "holds": "corporate partner data: partner contracts, partnership agreements, partner briefings",
    },
    "sales": {
        "label": "Sales",
        "path": "/sales",
        "tables": ["cvc.term_sheets", "cvc.fund_metrics"],
        "holds": "commercial material: term sheets, fund financials, LP material, fundraising decks",
    },
    "requests": {
        "label": "Requests",
        "path": "/requests",
        "tables": ["cvc.trend_reports", "cvc.report_requests"],
        "holds": "research output: trend reports, market landscapes, analyst reports, benchmarks",
    },
}

_DEFAULT_TAB = "home"

# Heuristic routing: doc_type (from the tagger) → tab.
_DOC_TYPE_TO_TAB = {
    "pitch_deck": "ventures",
    "memo": "ventures",
    "cap_table": "ventures",
    "metrics": "ventures",
    "financials": "sales",
    "legal": "partners",
    "report": "requests",
    "meeting_notes": "home",
}

# Content keywords that override the doc_type default (checked in order).
_KEYWORD_TO_TAB: list[tuple[str, list[str]]] = [
    ("partners", [r"partner(ship)? agreement", r"corporate partner", r"\bmou\b", r"master service"]),
    ("sales",    [r"term sheet", r"\blp\b", r"limited partner", r"fund (i|ii|iii|iv|\d)", r"management fee"]),
    ("ventures", [r"startup", r"series [abc]", r"seed round", r"valuation", r"due diligence", r"portfolio company"]),
    ("requests", [r"market (map|landscape|research)", r"trend report", r"industry analysis"]),
]


def classify(filename: str, doc_type: str, text: str) -> dict:
    """Return {tab, label, path, confidence, reason} for one document."""
    if _llm_enabled():
        out = _llm_classify(filename, doc_type, text)
        if out:
            return out
    return _heuristic_classify(filename, doc_type, text)


def _result(tab: str, confidence: str, reason: str) -> dict:
    entry = TAB_REGISTRY.get(tab, TAB_REGISTRY[_DEFAULT_TAB])
    return {
        "tab": tab if tab in TAB_REGISTRY else _DEFAULT_TAB,
        "label": entry["label"],
        "path": entry["path"],
        "confidence": confidence,
        "reason": reason,
    }


def _heuristic_classify(filename: str, doc_type: str, text: str) -> dict:
    hay = f"{filename}\n{(text or '')[:4000]}".lower()
    for tab, patterns in _KEYWORD_TO_TAB:
        for pat in patterns:
            if re.search(pat, hay):
                return _result(tab, "medium", f"matched '{pat}' in content")
    if doc_type in _DOC_TYPE_TO_TAB:
        return _result(_DOC_TYPE_TO_TAB[doc_type], "medium", f"doc type '{doc_type}'")
    return _result(_DEFAULT_TAB, "low", "no strong signal — kept in personal workspace")


def _llm_classify(filename: str, doc_type: str, text: str) -> dict | None:
    tabs_desc = "\n".join(
        f"- {key}: {v['label']} ({v['path']}) — holds {v['holds']}; tables: {', '.join(v['tables'])}"
        for key, v in TAB_REGISTRY.items()
    )
    prompt = (
        "You are routing an ingested document to the platform tab where that kind of data lives.\n"
        f"Tabs:\n{tabs_desc}\n\n"
        f"Document: '{filename}' (type: {doc_type})\n"
        f"Content:\n{(text or '')[:8000]}\n\n"
        'Return STRICT JSON: {"tab": "<one tab key>", "confidence": "high|medium|low", '
        '"reason": "<one short sentence>"}. Return ONLY the JSON object.'
    )
    raw = _openrouter_chat([{"role": "user", "content": prompt}], max_tokens=200)
    if not raw:
        return None
    try:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(match.group(0) if match else raw)
        tab = str(data.get("tab", "")).strip()
        if tab in TAB_REGISTRY:
            return _result(
                tab,
                str(data.get("confidence", "medium")),
                str(data.get("reason", "LLM classification")),
            )
    except Exception:
        return None
    return None
