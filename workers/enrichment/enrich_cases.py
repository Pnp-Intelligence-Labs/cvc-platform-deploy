#!/usr/bin/env python3
"""
enrich_cases.py — Case Studies & Revenue Enrichment (Step 4)

For a given company:
  1. Run Brave search: case studies / deployment evidence
  2. Queue results as pending intel_suggestions for Human Review
  3. Run Brave search: revenue / ARR mentions
  4. LLM call to extract explicit revenue figure → write directly to DB

Run on demand (triggered from company profile Step 4):
  python3 workers/enrichment/enrich_cases.py --id 1728
  python3 workers/enrichment/enrich_cases.py --company "Xplorobot"

Run nightly (batch, cron gate: "Case Studies & Deployments"):
  python3 workers/enrichment/enrich_cases.py --limit 25
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from typing import Any, Dict, List, Optional

import requests

from db.connection import get_connection, is_job_enabled
from llm.openrouter import call as llm_call

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

MODEL    = "qwen/qwen3-235b-a22b-2507"
JOB_NAME = "Case Studies & Deployments"

# ── Brave Search ──────────────────────────────────────────────────────────────

def _brave_raw(query: str, count: int, key: str) -> list:
    resp = requests.get(
        "https://api.search.brave.com/res/v1/web/search",
        headers={"Accept": "application/json", "X-Subscription-Token": key},
        params={"q": query, "count": count},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json().get("web", {}).get("results", [])


_brave_quota_exhausted = False

def _brave_call(query: str, count: int = 5) -> list:
    global _brave_quota_exhausted
    if _brave_quota_exhausted:
        return []
    primary = os.environ.get("BRAVE_SEARCH_KEY", "")
    backup  = os.environ.get("BRAVE_SEARCH_KEY_BACKUP", "")
    for key in filter(None, [primary, backup]):
        try:
            return _brave_raw(query, count, key)
        except Exception as e:
            err = str(e)
            is_quota = any(code in err for code in ("429", "402", "QUOTA_LIMITED", "USAGE_LIMIT_EXCEEDED"))
            if is_quota:
                if key == primary and backup:
                    time.sleep(1)
                    continue
                _brave_quota_exhausted = True
                logger.error("BRAVE QUOTA EXHAUSTED — all search results will be empty this run.")
                return []
            logger.warning(f"Brave search failed for '{query}': {e}")
            return []
    return []


def log_search(company_id: int, search_type: str, query: str, result_count: int) -> None:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO cvc.brave_search_log
                        (company_id, search_type, template_id, query, result_count)
                    VALUES (%s, %s, NULL, %s, %s)
                """, (company_id, search_type, query, result_count))
                conn.commit()
    except Exception as e:
        logger.warning(f"Could not log search: {e}")


def update_batch_progress(job_id: int, current: int, total: int) -> None:
    if not job_id:
        return
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE cvc.batch_jobs SET progress_current = %s, progress_total = %s WHERE id = %s",
                    (current, total, job_id)
                )
                conn.commit()
    except Exception as e:
        logger.warning(f"Could not update batch progress: {e}")


# ── Search ────────────────────────────────────────────────────────────────────

CASE_STUDY_QUERY  = '"{name}" case study customer deployment success pilot enterprise'
REVENUE_QUERY     = '"{name}" revenue ARR "annual recurring" "run rate" customers growth traction'


def search_case_studies(name: str, company_id: int) -> List[Dict[str, str]]:
    query   = CASE_STUDY_QUERY.replace("{name}", name)
    results = _brave_call(query, count=5)
    log_search(company_id, "case_studies", query, len(results))
    logger.info(f"  [case_studies] {len(results)} results")
    return [
        {"title":   (r.get("title") or "").strip(),
         "url":     (r.get("url") or "").strip(),
         "snippet": (r.get("description") or "").strip(),
         "age":     (r.get("age") or "").strip()}
        for r in results if r.get("title") and r.get("url")
    ]


def search_revenue(name: str, company_id: int) -> str:
    """Returns concatenated text block for LLM revenue extraction."""
    query   = REVENUE_QUERY.replace("{name}", name)
    results = _brave_call(query, count=3)
    log_search(company_id, "revenue", query, len(results))
    logger.info(f"  [revenue] {len(results)} results")
    if not results:
        return ""
    return "\n".join(
        f"• {r.get('title','')}\n  {r.get('description','')}\n  {r.get('url','')}"
        for r in results
    )[:3000]


# ── Queue Case Studies ────────────────────────────────────────────────────────

def queue_case_study_suggestions(company_id: int, case_studies: List[Dict]) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            queued = 0
            for cs in case_studies:
                url = cs.get("url", "")
                if not cs.get("title") and not url:
                    continue
                cur.execute("""
                    SELECT id FROM cvc.intel_suggestions
                    WHERE company_id = %s AND suggestion_type = 'case_study'
                      AND suggested_data->>'url' = %s
                      AND status IN ('pending', 'accepted')
                    LIMIT 1
                """, (company_id, url))
                if cur.fetchone():
                    continue
                cur.execute("""
                    INSERT INTO cvc.intel_suggestions
                        (company_id, suggestion_type, field_name, suggested_data, confidence, reasoning, status)
                    VALUES (%s, 'case_study', 'case_studies', %s::jsonb, %s, %s, 'pending')
                """, (
                    company_id,
                    json.dumps({"title": cs.get("title",""), "url": url,
                                "snippet": cs.get("snippet",""), "age": cs.get("age","")}),
                    0.8,
                    "Sourced via Brave Search — commercial deployment evidence",
                ))
                queued += 1
            conn.commit()
    logger.info(f"  Queued {queued} case study suggestion(s) for human review (company {company_id})")
    return queued


# ── Revenue Extraction ────────────────────────────────────────────────────────

def extract_and_write_revenue(company_id: int, name: str, rev_context: str) -> List[str]:
    """LLM call to extract revenue figure. Returns list of fields written."""
    prompt = (
        f"You are a VC analyst. Extract revenue data for {name} from this research.\n\n"
        f"Research:\n{rev_context}\n\n"
        "Return a JSON object with only the fields you can confirm from explicit statements:\n"
        "- revenue_arr_usd: integer USD amount (ONLY if an explicit dollar figure is stated, "
        "e.g. '$30M revenue' → 30000000). Do NOT estimate.\n"
        "- revenue_period: time period string (e.g. 'H1 2025', 'as of Jan 2026', '2025')\n"
        "- revenue_source: the URL from the research where this figure appeared\n\n"
        "If no revenue data is found, return {}. Return ONLY valid JSON. No explanation."
    )
    logger.info(f"  Calling LLM for revenue extraction...")
    raw = llm_call(prompt, model=MODEL, temperature=0.1, max_tokens=200,
                   activity="Revenue Extraction")
    if not raw:
        return []

    raw = raw.strip()
    if "```" in raw:
        raw = re.sub(r"```(?:json)?", "", raw).strip().strip("```").strip()
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return []
    try:
        data = json.loads(m.group())
    except json.JSONDecodeError:
        return []

    fields = {}
    if data.get("revenue_arr_usd"):
        try: fields["revenue_arr_usd"] = int(data["revenue_arr_usd"])
        except (ValueError, TypeError): pass
    if data.get("revenue_period") and isinstance(data["revenue_period"], str):
        fields["revenue_period"] = data["revenue_period"].strip()[:100]
    if data.get("revenue_source") and isinstance(data["revenue_source"], str):
        fields["revenue_source"] = data["revenue_source"].strip()

    if not fields:
        return []

    set_clauses = [f"{k} = %s" for k in fields] + ["updated_at = NOW()"]
    params = list(fields.values()) + [company_id]
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE cvc.companies SET {', '.join(set_clauses)} WHERE id = %s", params)
    logger.info(f"  Revenue fields written: {list(fields.keys())}")
    return list(fields.keys())


# ── Core ──────────────────────────────────────────────────────────────────────

def enrich_company(company: Dict[str, Any]) -> Dict[str, Any]:
    company_id = company["id"]
    name       = company["name"]

    result: Dict[str, Any] = {
        "id": company_id, "name": name,
        "case_studies_queued": 0, "fields_written": [],
        "status": "failed", "error": None,
    }

    logger.info(f"Enriching (cases): {name} (id={company_id})")

    try:
        case_studies = search_case_studies(name, company_id)
        time.sleep(1.2)
        rev_context  = search_revenue(name, company_id)

        cs_queued = queue_case_study_suggestions(company_id, case_studies) if case_studies else 0
        result["case_studies_queued"] = cs_queued

        written = [f"case_studies_queued({cs_queued})"] if cs_queued else []

        if rev_context:
            rev_fields = extract_and_write_revenue(company_id, name, rev_context)
            written += rev_fields

        result["fields_written"] = written
        result["status"]         = "success"

    except Exception as e:
        logger.error(f"  Failed: {e}")
        result["error"] = str(e)

    # Always stamp cases_enriched_at so the status endpoint can detect completion
    # even when the worker ran but found no data.
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE cvc.companies SET cases_enriched_at = NOW() WHERE id = %s",
                    (company_id,)
                )
    except Exception as stamp_err:
        logger.warning(f"  Could not stamp cases_enriched_at: {stamp_err}")

    return result


# ── Query ─────────────────────────────────────────────────────────────────────

def get_companies(limit: int, company_name: str = None, company_id: int = None,
                  portfolio_only: bool = False, sector: str = None) -> List[Dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if company_id:
                cur.execute("SELECT id, name FROM cvc.companies WHERE id = %s", (company_id,))
            elif company_name:
                cur.execute(
                    "SELECT id, name FROM cvc.companies WHERE LOWER(name) LIKE LOWER(%s) LIMIT 5",
                    (f"%{company_name}%",)
                )
            else:
                filters = ["name IS NOT NULL"]
                params: List = []
                if portfolio_only:
                    filters.append("is_portfolio = TRUE")
                if sector:
                    filters.append("sector = %s")
                    params.append(sector)
                params.append(limit)
                cur.execute(f"""
                    SELECT id, name FROM cvc.companies
                    WHERE {' AND '.join(filters)}
                    ORDER BY id LIMIT %s
                """, params)
            return cur.fetchall()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Case studies & revenue enrichment")
    parser.add_argument("--limit",        type=int,  default=20)
    parser.add_argument("--company",      type=str,  default=None)
    parser.add_argument("--id",           type=int,  default=None)
    parser.add_argument("--no-gate",      action="store_true")
    parser.add_argument("--portfolio",    action="store_true")
    parser.add_argument("--sector",       type=str,  default=None)
    parser.add_argument("--batch-job-id", type=int,  default=None)
    args = parser.parse_args()

    if not args.company and not args.id and not args.no_gate:
        if not is_job_enabled(JOB_NAME):
            logger.info(f"Job '{JOB_NAME}' disabled in scheduler — exiting")
            sys.exit(0)

    companies = get_companies(args.limit, args.company, args.id,
                              portfolio_only=args.portfolio, sector=args.sector)
    if not companies:
        logger.info("No companies to process")
        print(json.dumps({"total": 0, "success": 0, "failed": 0,
                          "case_studies_queued": 0, "companies": []}))
        return

    total = len(companies)
    logger.info(f"Processing {total} companies")
    if args.batch_job_id:
        update_batch_progress(args.batch_job_id, 0, total)

    company_results = []
    for idx, company in enumerate(companies, 1):
        r = enrich_company(company)
        company_results.append(r)
        if args.batch_job_id:
            update_batch_progress(args.batch_job_id, idx, total)
        if total > 1:
            time.sleep(2)

    success  = sum(1 for r in company_results if r["status"] == "success")
    failed   = sum(1 for r in company_results if r["status"] == "failed")
    total_cs = sum(r["case_studies_queued"] for r in company_results)

    print(json.dumps({
        "total": len(companies), "success": success, "failed": failed,
        "case_studies_queued": total_cs,
        "brave_quota_exhausted": _brave_quota_exhausted,
        "companies": company_results,
    }))


if __name__ == "__main__":
    main()
