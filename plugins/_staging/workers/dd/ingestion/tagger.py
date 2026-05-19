"""
tagger.py — Classify each document into a type.
Uses filename signals first (fast, free). Falls back to content signals.
LLM classification is available but not used by default — too slow for ingestion.
"""

from pathlib import Path

# Filename/content keyword signals per document type.
# Listed in priority order — first match wins.
DOC_TYPE_SIGNALS: list[tuple[str, list[str]]] = [
    ("cap_table",           ["cap table", "captable", "capitalization", "equity ownership", "share structure",
                              "stock ledger", "stockholder", "option pool"]),
    ("financial_model",     ["financial model", "pro-forma", "pro forma", "projections", "forecast model",
                              "revenue model", "unit economics"]),
    ("financial_statement", ["balance sheet", "income statement", "profit and loss", "p&l", "cash flow statement", "audited",
                              "statement of operations", "trial balance"]),
    # Investment-relevant legal docs — sent to financials + qualitative agents
    ("legal_terms",         ["stock purchase agreement", "voting agreement", "investors rights",
                              "board consent", "disclosure schedule", "right of first refusal", "amendment", "waiver",
                              "indemnification", "equity incentive", "incentive plan", "restricted stock",
                              "safe note", "convertible note", "term sheet", "side letter",
                              "founders agreement", "advisor agreement", "consulting agreement",
                              "restricted stock grant"]),
    # Formation/compliance docs — filed for reference, not analyzed by agents
    ("legal_formation",     ["bylaws", "bylaw", "articles of incorporation", "articles of organization",
                              "operating agreement", "certificate of formation", "certificate of good standing",
                              "registered agent", "statement of domestication", "qualification filing",
                              "incorporation filing", "conversion filing", "initial creation", "corp art",
                              "employer identification", "beneficial ownership", "boir",
                              "cp575", "ein notice", "secretary of state", "department of state",
                              "domestication", "docusign"]),
    ("customer_contract",   ["statement of work", "sow", "letter of intent", "loi", "master service agreement",
                              "customer agreement", "pilot agreement", "purchase order", "master terms",
                              "terms of service", "onboarding agreement", "grant funding agreement",
                              "service agreement"]),
    ("patent_ip",           ["patent", "provisional patent", "intellectual property", "ip filing", "trade secret",
                              "patent claims", "prior art", "patent office", "uspto"]),
    ("investor_qa",         ["investor q&a", "investor qa", "faq", "questions and answers", "q&a"]),
    ("team_bio",            ["team", "founder", "bio", "resume", "cv", "linkedin", "people", "management",
                              "hiring plan", "org chart", "team overview"]),
    ("pitch_deck",          ["pitch deck", "investor presentation", "overview", "one pager", "company overview", "deck",
                              "slide deck", "pitch_vc", "pitch vc", "investor deck"]),
]


def tag_document(filename: str, text: str) -> str:
    """
    Classify a document by type.
    Checks filename first (3× weight), then content preview.
    Returns the best matching type, or 'unknown'.
    """
    fname = filename.lower()
    content = text[:8000].lower() if text else ""

    scores: dict[str, int] = {doc_type: 0 for doc_type, _ in DOC_TYPE_SIGNALS}

    for doc_type, signals in DOC_TYPE_SIGNALS:
        for signal in signals:
            if signal in fname:
                scores[doc_type] += 3
            if signal in content:
                scores[doc_type] += 1

    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "unknown"


def tag_all(documents: list[dict]) -> list[dict]:
    """Add doc_type to each document dict."""
    for doc in documents:
        doc["doc_type"] = tag_document(
            doc.get("filename", ""),
            doc.get("text", "")
        )
    return documents
