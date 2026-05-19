"""
agents/reviewer/agent.py — Analyst Review Agent.

Reads overview.json + appendix.json + analyst feedback from cvc.dd_feedback
and produces a corrected IC memo that:
  1. Applies analyst corrections (over-flagged items softened, missed flags added)
  2. Incorporates analyst notes as context
  3. Produces a final recommendation-ready memo

Input:  workdir/[company]/overview.json
        workdir/[company]/appendix.json
        cvc.dd_feedback rows for this company

Output: workdir/[company]/review_memo.json
        workdir/[company]/[company]_Review_Memo.pdf  (via format bot)

Run:
    python3 -m agents.reviewer.agent "Company Name"
"""

import json
import time
import argparse
from datetime import datetime
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from config.settings import WORKDIR, OVERVIEW_LLM_MODEL, LLM_TIMEOUT, LLM_MAX_TOKENS
from llm.openrouter import call as llm_call

try:
    import psycopg2
    import psycopg2.extras
    DB_AVAILABLE = True
except ImportError:
    DB_AVAILABLE = False

DB_CONFIG = {
    "host": "localhost",
    "dbname": "cvc_db",
    "user": "producer",
    "password": os.environ["CVC_DB_PASSWORD"],
}


REVIEW_PROMPT = """\
You are a senior venture capital partner reviewing an AI-generated due diligence memo.
An analyst has gone through every finding and flagged errors, over-flags, missed items, and corrections.

Your job is to produce a final, corrected IC memo that incorporates the analyst's feedback.

---
ORIGINAL IC MEMO:
{overview_json}

---
ANALYST FEEDBACK SUMMARY:
Total findings reviewed: {total_reviewed}
Confirmed correct: {n_correct}
Partially correct: {n_partial}
Wrong: {n_wrong}
Over-flagged: {n_over_flagged}
Should have been flagged (missed): {n_missed}

FINDING-LEVEL CORRECTIONS:
{corrections_text}

---
APPENDIX CROSS-SIGNALS:
{cross_signals}

---
Produce a revised IC memo JSON with the same structure as the original but with:
1. Corrections applied — remove or soften over-flagged items, add missed flags
2. Analyst notes incorporated where relevant
3. Recommendation updated if corrections materially change the picture
4. A "review_delta" section summarizing what changed from the original

Respond ONLY with valid JSON. Same schema as the original overview.json plus a top-level "review_delta" object:
{{
  "review_delta": {{
    "flags_removed": ["..."],
    "flags_added": ["..."],
    "recommendation_changed": true/false,
    "original_recommendation": "...",
    "analyst_summary": "2-3 sentence summary of what the analyst corrected"
  }},
  ... (full revised memo fields)
}}
"""


def _load_json(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def _load_feedback(company_name: str) -> list[dict]:
    if not DB_AVAILABLE:
        return []
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = True
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM cvc.dd_feedback WHERE company_name = %s ORDER BY id",
                (company_name,)
            )
            rows = cur.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"  [DB] Could not load feedback: {e}")
        return []


def _build_corrections_text(feedback: list[dict]) -> str:
    lines = []
    for f in feedback:
        if not any([f.get("accuracy_rating"), f.get("flag_rating"), f.get("analyst_notes")]):
            continue
        parts = [f"  [{f.get('agent','?').upper()} / {f.get('topic','?')}]"]
        parts.append(f"    Finding: {f.get('our_finding','—')}")
        if f.get("accuracy_rating"):
            parts.append(f"    Accuracy: {f['accuracy_rating']}")
        if f.get("flag_rating"):
            parts.append(f"    Flag rating: {f['flag_rating']}")
        if f.get("analyst_notes"):
            parts.append(f"    Analyst note: {f['analyst_notes']}")
        lines.append("\n".join(parts))
    return "\n\n".join(lines) if lines else "No specific corrections provided."


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
    return {"error": "Failed to parse LLM response", "raw": text[:500]}


def run(company: str) -> dict:
    safe = company.replace(" ", "_").replace("/", "-")
    company_dir = WORKDIR / safe
    output_path = company_dir / "review_memo.json"

    print(f"\nReviewer Agent: {company}")
    print("=" * 50)

    start = time.time()

    overview = _load_json(company_dir / "overview.json")
    appendix = _load_json(company_dir / "appendix.json")
    feedback = _load_feedback(company)

    if not overview:
        print("  ERROR: overview.json not found — run DD pipeline first")
        return {"status": "failed", "error": "overview.json not found"}

    print(f"  Feedback rows loaded: {len(feedback)}")

    # Count feedback categories
    n_correct      = sum(1 for f in feedback if f.get("accuracy_rating") == "correct")
    n_partial      = sum(1 for f in feedback if f.get("accuracy_rating") == "partially correct")
    n_wrong        = sum(1 for f in feedback if f.get("accuracy_rating") == "wrong")
    n_over_flagged = sum(1 for f in feedback if f.get("flag_rating") == "over-flagged")
    n_missed       = sum(1 for f in feedback if f.get("flag_rating") == "should have been flagged")

    corrections_text = _build_corrections_text(feedback)
    cross_signals = json.dumps(appendix.get("cross_agent_signals", []), indent=2)

    prompt = REVIEW_PROMPT.format(
        overview_json    = json.dumps(overview, indent=2)[:12000],
        total_reviewed   = len(feedback),
        n_correct        = n_correct,
        n_partial        = n_partial,
        n_wrong          = n_wrong,
        n_over_flagged   = n_over_flagged,
        n_missed         = n_missed,
        corrections_text = corrections_text[:6000],
        cross_signals    = cross_signals[:2000],
    )

    print("  Calling LLM for corrected memo...")
    raw = llm_call(
        prompt,
        model       = OVERVIEW_LLM_MODEL,
        temperature = 0.1,
        max_tokens  = LLM_MAX_TOKENS,
        timeout     = LLM_TIMEOUT,
        activity    = "DD Review",
    )

    result = _extract_json(raw)
    result["company"]        = company
    result["date"]           = datetime.now().strftime("%Y-%m-%d")
    result["agent"]          = "reviewer"
    result["status"]         = "complete" if "error" not in result else "failed"
    result["feedback_count"] = len(feedback)
    result["meta"] = {
        "total_seconds":   int(time.time() - start),
        "n_correct":       n_correct,
        "n_partial":       n_partial,
        "n_wrong":         n_wrong,
        "n_over_flagged":  n_over_flagged,
        "n_missed":        n_missed,
    }

    output_path.write_text(json.dumps(result, indent=2))
    print(f"  Output: {output_path}")

    # Render Review Memo PDF via format bot
    try:
        from format.agent import render_review_memo
        pdf_path = render_review_memo(company, result)
        print(f"  PDF: {pdf_path}")
    except Exception as e:
        print(f"  [format] Could not render PDF: {e}")

    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("company", help="Company name")
    args = parser.parse_args()
    run(args.company)
