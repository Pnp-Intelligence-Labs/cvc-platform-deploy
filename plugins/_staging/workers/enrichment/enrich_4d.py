#!/usr/bin/env python3
"""
enrich_4d.py — 4D Classification + News Enrichment (Step 2)

For a given company:
  1. Fetch company website text
  2. Run Brave searches: news, funding, product/technology
  3. Single LLM call with all research context
  4. Write 4D taxonomy + missing profile fields + news_articles to DB

Run on demand (triggered from company profile Step 2):
  python3 workers/enrichment/enrich_4d.py --id 1728
  python3 workers/enrichment/enrich_4d.py --company "Xplorobot"

Run nightly (batch, cron gate: "4D Classification"):
  python3 workers/enrichment/enrich_4d.py --limit 25
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
JOB_NAME = "4D Classification"

VALID_ENV   = {"Structured_Indoor", "Unstructured_Outdoor", "Aerial",
               "Subsea_Underground", "Virtual_Simulated", "Environment_Agnostic"}
VALID_FUNC  = {"Manipulation", "Mobility", "Perception", "Cognition",
               "Human_Collaboration", "Infrastructure"}
VALID_STACK = {"Component", "Subsystem", "Solution", "Platform", "Intelligence", "Ops"}
VALID_BIZ   = {"Hardware_OEM", "SaaS", "RaaS", "Integration_Consulting",
               "Data_Analytics", "Marketplace", "Research_Lab"}
VALID_STAGES = {"Seed", "Series A", "Series B", "Series C", "Growth", "Public"}

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


# ── Website Fetch ─────────────────────────────────────────────────────────────

def fetch_website(url: str) -> str:
    if not url:
        return ""
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; CVCBot/1.0; research)"},
            timeout=15,
            allow_redirects=True,
        )
        resp.raise_for_status()
        html = resp.text
        html = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<style[^>]*>.*?</style>",  " ", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<[^>]+>", " ", html)
        html = re.sub(r"&[a-z]+;", " ", html)
        html = re.sub(r"\s+", " ", html).strip()
        return html[:4000]
    except Exception as e:
        logger.warning(f"Website fetch failed for {url}: {e}")
        return ""


# ── Research ──────────────────────────────────────────────────────────────────

SEARCH_TEMPLATES = [
    {"search_type": "news",    "query_template": '"{name}" news press coverage announcement 2024 2025 2026', "result_count": 5},
    {"search_type": "funding", "query_template": '"{name}" funding raised investment round investors',       "result_count": 5},
    {"search_type": "product", "query_template": '"{name}" product technology robotics automation',          "result_count": 5},
]


def research_company(name: str, website: str, company_id: int) -> Dict[str, Any]:
    sections: List[str] = []
    news_articles: List[Dict[str, str]] = []
    search_log: List[Dict] = []

    logger.info(f"  Fetching website: {website}")
    site_text = fetch_website(website)
    if site_text:
        sections.append(f"=== Company Website ({website}) ===\n{site_text}")

    time.sleep(1)

    for tmpl in SEARCH_TEMPLATES:
        query = tmpl["query_template"].replace("{name}", name)
        count = tmpl["result_count"]
        results = _brave_call(query, count=count)
        log_search(company_id, tmpl["search_type"], query, len(results))
        search_log.append({"search_type": tmpl["search_type"], "result_count": len(results)})
        logger.info(f"  [{tmpl['search_type']}] {len(results)} results")

        if results:
            if tmpl["search_type"] == "news":
                news_articles = [
                    {"title":   (r.get("title") or "").strip(),
                     "url":     (r.get("url") or "").strip(),
                     "snippet": (r.get("description") or "").strip(),
                     "age":     (r.get("age") or "").strip()}
                    for r in results if r.get("title") and r.get("url")
                ]
            text = "\n".join(
                f"• {r.get('title','')}\n  {r.get('description','')}\n  {r.get('url','')}"
                for r in results
            )[:3000]
            section_label = {"news": "Recent News & Coverage", "funding": "Funding & Investors",
                             "product": "Product & Technology"}.get(tmpl["search_type"], tmpl["search_type"])
            sections.append(f"=== {section_label} ===\n{text}")

        time.sleep(1.2)

    return {
        "context":       "\n\n".join(sections),
        "news_articles": news_articles,
        "search_log":    search_log,
    }


# ── LLM Prompt ────────────────────────────────────────────────────────────────

PROMPT_TEMPLATE = """You are a venture capital analyst enriching a company profile. Using the research below, fill in all fields you can determine with confidence.

Company: {name}
Existing data:
{existing}

Research context:
{context}

Return a JSON object with the fields below. Only include a field if you can determine it from the research. Never fabricate data.

REQUIRED — classify all four 4D dimensions (pick the closest match, never leave null):
- env_4d: Where does the technology operate?
  Allowed: Structured_Indoor, Unstructured_Outdoor, Aerial, Subsea_Underground, Virtual_Simulated, Environment_Agnostic
- func_4d: What does the technology do?
  Allowed: Manipulation, Mobility, Perception, Cognition, Human_Collaboration, Infrastructure
- stack_4d: Where in the value chain?
  Allowed: Component, Subsystem, Solution, Platform, Intelligence, Ops
- biz_model_4d: How does the company make money?
  Allowed: Hardware_OEM, SaaS, RaaS, Integration_Consulting, Data_Analytics, Marketplace, Research_Lab

OPTIONAL — only include if confidently found in the research:
- description: Clear 2-3 sentence description of what the company does and for whom
- stage: Funding stage. Allowed: Seed, Series A, Series B, Series C, Growth, Public
- employee_count: Integer estimate
- total_raised_usd: Total funding raised in USD as an integer (e.g. 5000000 for $5M)
- investors: JSON array of investor names (strings)
- tags: JSON array of 3-6 short keyword tags describing the company's focus
- hq_city: Headquarters city
- country: Two-letter country code (e.g. US, CA, DE)
- founded: Year founded as integer

Return ONLY valid JSON. No explanation. No markdown.
Example:
{{"env_4d": "Unstructured_Outdoor", "func_4d": "Perception", "stack_4d": "Solution", "biz_model_4d": "SaaS", "stage": "Seed", "employee_count": 20, "total_raised_usd": 3000000, "investors": ["Chevron Technology Ventures"], "tags": ["methane detection", "emissions", "oil and gas"]}}"""


def build_existing_summary(company: Dict[str, Any]) -> str:
    parts = []
    for field in ["sector", "stage", "one_liner", "description", "hq_city",
                  "country", "employee_count", "founded", "total_raised_usd"]:
        val = company.get(field)
        if val:
            parts.append(f"{field}: {val}")
    return "\n".join(parts) if parts else "None"


# ── Parse & Validate ──────────────────────────────────────────────────────────

def parse_response(raw: str) -> Dict[str, Any]:
    raw = raw.strip()
    if "```" in raw:
        raw = re.sub(r"```(?:json)?", "", raw).strip().strip("```").strip()
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return {}
    try:
        data = json.loads(m.group())
    except json.JSONDecodeError:
        return {}

    result = {}
    if data.get("env_4d")       in VALID_ENV:   result["env_4d"]       = data["env_4d"]
    if data.get("func_4d")      in VALID_FUNC:  result["func_4d"]      = data["func_4d"]
    if data.get("stack_4d")     in VALID_STACK: result["stack_4d"]     = data["stack_4d"]
    if data.get("biz_model_4d") in VALID_BIZ:   result["biz_model_4d"] = data["biz_model_4d"]

    if data.get("description") and isinstance(data["description"], str):
        result["description"] = data["description"].strip()
    if data.get("stage") in VALID_STAGES:
        result["stage"] = data["stage"]
    if data.get("employee_count"):
        try: result["employee_count"] = int(data["employee_count"])
        except (ValueError, TypeError): pass
    if data.get("total_raised_usd"):
        try: result["total_raised_usd"] = int(data["total_raised_usd"])
        except (ValueError, TypeError): pass
    if isinstance(data.get("investors"), list):
        result["investors"] = [str(i) for i in data["investors"] if i]
    if isinstance(data.get("tags"), list):
        result["tags"] = [str(t) for t in data["tags"] if t][:8]
    if data.get("hq_city") and isinstance(data["hq_city"], str):
        result["hq_city"] = data["hq_city"].strip()
    if data.get("country") and isinstance(data["country"], str):
        result["country"] = data["country"].strip()[:3]
    if data.get("founded"):
        try:
            yr = int(data["founded"])
            if 1900 <= yr <= 2030:
                result["founded"] = yr
        except (ValueError, TypeError): pass

    return result


# ── DB Write ──────────────────────────────────────────────────────────────────

def write_to_db(company_id: int, updates: Dict[str, Any], company: Dict[str, Any],
                news_articles: List[Dict] = None) -> None:
    PRESERVE_IF_SET = {"description", "stage", "employee_count", "total_raised_usd",
                       "hq_city", "country", "founded"}
    filtered = {k: v for k, v in updates.items()
                if not (k in PRESERVE_IF_SET and company.get(k))}

    if news_articles:
        filtered["news_articles"] = json.dumps(news_articles)

    if not filtered:
        logger.info(f"  No new fields to write for company {company_id}")
        return

    set_clauses, params = [], []
    for field, value in filtered.items():
        if field in ("investors", "tags") and isinstance(value, list):
            set_clauses.append(f"{field} = %s::text[]")
            params.append(value)
        elif field == "news_articles":
            set_clauses.append(f"{field} = %s::jsonb")
            params.append(value)
        else:
            set_clauses.append(f"{field} = %s")
            params.append(value)

    set_clauses += ["enrichment_status = %s", "enrichment_source = %s", "fourd_enriched_at = NOW()", "updated_at = NOW()"]
    params += ["enriched", "enrich_4d", company_id]

    sql = f"UPDATE cvc.companies SET {', '.join(set_clauses)} WHERE id = %s"
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            cur.execute("""
                UPDATE cvc.companies
                SET search_text = to_tsvector(
                    coalesce(name,'') || ' ' || coalesce(one_liner,'') || ' ' || coalesce(description,'')
                ) WHERE id = %s
            """, (company_id,))


# ── Core ──────────────────────────────────────────────────────────────────────

def enrich_company(company: Dict[str, Any]) -> Dict[str, Any]:
    company_id = company["id"]
    name       = company["name"]
    website    = (company.get("website") or "").rstrip("/")

    result: Dict[str, Any] = {
        "id": company_id, "name": name,
        "website_ok": False, "news_found": 0,
        "fields_written": [], "search_log": [],
        "status": "failed", "error": None,
    }

    logger.info(f"Enriching (4D): {name} (id={company_id})")
    if not website:
        logger.warning(f"  No website — Brave-only mode")

    try:
        research      = research_company(name, website, company_id)
        context       = research["context"]
        news_articles = research["news_articles"]
        search_log    = research["search_log"]

        result["website_ok"] = bool(website and "Company Website" in context)
        result["news_found"] = len(news_articles)
        result["search_log"] = search_log

        if not context:
            logger.warning(f"  No research context — skipping")
            result["status"] = "skipped"
            return result

        existing = build_existing_summary(company)
        prompt   = PROMPT_TEMPLATE.format(name=name, existing=existing, context=context[:8000])

        logger.info(f"  Calling LLM...")
        raw = llm_call(prompt, model=MODEL, temperature=0.1, max_tokens=800,
                       activity="4D Classification")

        if not raw:
            result["error"] = "empty LLM response"
            return result

        updates = parse_response(raw)
        if not updates:
            result["error"] = "LLM parse failed"
            return result

        missing_4d = [k for k in ("env_4d","func_4d","stack_4d","biz_model_4d") if not updates.get(k)]
        if missing_4d:
            logger.warning(f"  Missing 4D fields: {missing_4d}")

        write_to_db(company_id, updates, company, news_articles)

        written = list(updates.keys())
        if news_articles:
            written.append(f"news_articles({len(news_articles)})")

        result["fields_written"] = written
        result["status"]         = "success"
        logger.info(f"  Done. Fields written: {written}")
        return result

    except Exception as e:
        logger.error(f"  Failed: {e}")
        result["error"] = str(e)
        return result


# ── Query ─────────────────────────────────────────────────────────────────────

def get_companies(limit: int, company_name: str = None, company_id: int = None,
                  portfolio_only: bool = False, sector: str = None) -> List[Dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if company_id:
                cur.execute("""
                    SELECT id, name, website, one_liner, description, sector,
                           stage, employee_count, founded, hq_city, country,
                           total_raised_usd, investors, tags
                    FROM cvc.companies WHERE id = %s
                """, (company_id,))
            elif company_name:
                cur.execute("""
                    SELECT id, name, website, one_liner, description, sector,
                           stage, employee_count, founded, hq_city, country,
                           total_raised_usd, investors, tags
                    FROM cvc.companies WHERE LOWER(name) LIKE LOWER(%s) LIMIT 5
                """, (f"%{company_name}%",))
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
                    SELECT id, name, website, one_liner, description, sector,
                           stage, employee_count, founded, hq_city, country,
                           total_raised_usd, investors, tags
                    FROM cvc.companies
                    WHERE {' AND '.join(filters)}
                    ORDER BY id LIMIT %s
                """, params)
            return cur.fetchall()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="4D classification + news enrichment")
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
        print(json.dumps({"total": 0, "success": 0, "failed": 0, "skipped": 0,
                          "news_articles_written": 0, "companies": []}))
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

    success = sum(1 for r in company_results if r["status"] == "success")
    failed  = sum(1 for r in company_results if r["status"] == "failed")
    skipped = sum(1 for r in company_results if r["status"] == "skipped")
    total_news = sum(r["news_found"] for r in company_results)

    print(json.dumps({
        "total": len(companies), "success": success, "failed": failed,
        "skipped": skipped, "news_articles_written": total_news,
        "brave_quota_exhausted": _brave_quota_exhausted,
        "companies": company_results,
    }))


if __name__ == "__main__":
    main()
