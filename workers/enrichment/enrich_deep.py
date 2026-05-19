#!/usr/bin/env python3
"""
enrich_deep.py — Deep Company Enrichment

For each unclassified company:
  1. Fetch company website text
  2. Run Brave searches: recent news, funding, product/technology
  3. Single LLM call with all research context
  4. Write 4D taxonomy + missing profile fields to DB

Run nightly (cron gate: "Case Studies & Deployments") or on demand:
  python3 workers/enrichment/enrich_deep.py
  python3 workers/enrichment/enrich_deep.py --company "Xplorobot"
  python3 workers/enrichment/enrich_deep.py --id 1728
  python3 workers/enrichment/enrich_deep.py --limit 25
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

MODEL   = "qwen/qwen3-235b-a22b-2507"
JOB_NAME = "Case Studies & Deployments"

VALID_ENV     = {"Structured_Indoor", "Unstructured_Outdoor", "Aerial",
                 "Subsea_Underground", "Virtual_Simulated", "Environment_Agnostic"}
VALID_FUNC    = {"Manipulation", "Mobility", "Perception", "Cognition",
                 "Human_Collaboration", "Infrastructure"}
VALID_STACK   = {"Component", "Subsystem", "Solution", "Platform", "Intelligence", "Ops"}
VALID_BIZ     = {"Hardware_OEM", "SaaS", "RaaS", "Integration_Consulting",
                 "Data_Analytics", "Marketplace", "Research_Lab"}
VALID_SECTORS = {"Robotics", "Supply Chain", "Manufacturing",
                 "Industrial Automation", "Physical AI", "Other"}
VALID_STAGES  = {"Seed", "Series A", "Series B", "Series C", "Growth", "Public"}

# ── Brave Search ──────────────────────────────────────────────────────────────

def _brave_raw(query: str, count: int, key: str) -> list:
    """Single Brave API call — returns raw result list."""
    resp = requests.get(
        "https://api.search.brave.com/res/v1/web/search",
        headers={"Accept": "application/json", "X-Subscription-Token": key},
        params={"q": query, "count": count},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json().get("web", {}).get("results", [])


_brave_quota_exhausted = False  # module-level flag to avoid log spam

def _brave_call(query: str, count: int = 5) -> list:
    """Run Brave search with primary/backup key failover. Returns raw result list."""
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
                # Both keys exhausted
                _brave_quota_exhausted = True
                logger.error("BRAVE QUOTA EXHAUSTED — all search results will be empty this run. "
                             "Raise the spend cap or wait for monthly reset.")
                return []
            logger.warning(f"Brave search failed for '{query}': {e}")
            return []
    return []


# ── Search Templates + Logging ────────────────────────────────────────────────

DEFAULT_TEMPLATES = [
    {"id": None, "search_type": "news",         "query_template": '"{name}" news press coverage announcement 2024 2025 2026', "result_count": 5},
    {"id": None, "search_type": "funding",       "query_template": '"{name}" funding raised investment round investors -site:crunchbase.com -site:pitchbook.com',       "result_count": 5},
    {"id": None, "search_type": "product",       "query_template": '"{name}" product technology robotics automation',          "result_count": 5},
    {"id": None, "search_type": "case_studies",  "query_template": '"{name}" case study customer deployment success pilot enterprise',     "result_count": 5},
    {"id": None, "search_type": "revenue",       "query_template": '"{name}" revenue ARR "annual recurring" "run rate" customers growth traction', "result_count": 3},
]


def load_search_templates() -> List[Dict]:
    """Load active search templates from DB. Falls back to hardcoded defaults."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, search_type, label, query_template, result_count
                    FROM cvc.brave_search_templates
                    WHERE active = TRUE
                    ORDER BY id
                """)
                rows = cur.fetchall()
                if rows:
                    return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"Could not load search templates: {e} — using defaults")
    return DEFAULT_TEMPLATES


def update_batch_progress(job_id: int, current: int, total: int) -> None:
    """Write live progress to batch_jobs. Non-fatal."""
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


def log_search(company_id: int, search_type: str, template_id: Optional[int],
               query: str, result_count: int) -> None:
    """Log a Brave search execution. Non-fatal — never raises."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO cvc.brave_search_log
                        (company_id, search_type, template_id, query, result_count)
                    VALUES (%s, %s, %s, %s, %s)
                """, (company_id, search_type, template_id, query, result_count))
                conn.commit()
    except Exception as e:
        logger.warning(f"Could not log search: {e}")


def brave_search(query: str, count: int = 5) -> str:
    """Search Brave and return concatenated title + description snippets (for LLM context)."""
    results = _brave_call(query, count)
    parts = []
    for r in results:
        title = r.get("title", "")
        desc  = r.get("description", "")
        url   = r.get("url", "")
        parts.append(f"• {title}\n  {desc}\n  {url}")
    return "\n".join(parts)[:3000]


def brave_search_structured(query: str, count: int = 5) -> List[Dict[str, str]]:
    """Search Brave and return structured article records for DB storage.

    Each record: {title, url, snippet, age}
    """
    results = _brave_call(query, count)
    articles = []
    for r in results:
        title = (r.get("title") or "").strip()
        url   = (r.get("url") or "").strip()
        if not title or not url:
            continue
        articles.append({
            "title":   title,
            "url":     url,
            "snippet": (r.get("description") or "").strip(),
            "age":     (r.get("age") or "").strip(),
        })
    return articles


# ── Website Fetch ─────────────────────────────────────────────────────────────

def fetch_website(url: str) -> str:
    """Fetch website and return stripped plain text (max 4000 chars)."""
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

        # Strip scripts, styles, tags
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

def research_company(name: str, website: str, company_id: int,
                     templates: List[Dict],
                     skip_cases: bool = False,
                     cases_only: bool = False) -> Dict[str, Any]:
    """Run website fetch + Brave searches using configurable templates.

    Modes:
        Default (skip_cases=False, cases_only=False):
            Full pass — website + news + funding + product (LLM context) + case_studies search.
        skip_cases=True:
            4D-only pass — website + news + funding + product for LLM. Skips case_studies search.
        cases_only=True:
            Case studies pass — only runs case_studies search. No website fetch, no LLM context.

    Returns:
        context:        str  — combined text block for LLM prompt
        news_articles:  list — structured [{title, url, snippet, age}] written directly to DB
        case_studies:   list — structured [{title, url, snippet, age}] queued for Human Review
        search_log:     list — [{search_type, result_count}] for summary reporting
    """
    # Index templates by search_type for lookup
    tmpl = {t["search_type"]: t for t in templates}

    sections: List[str] = []
    news_articles: List[Dict[str, str]] = []
    case_studies:  List[Dict[str, str]] = []
    search_log:    List[Dict] = []

    def _run_search(search_type: str) -> list:
        """Run one templated search, log it, return raw results."""
        t = tmpl.get(search_type)
        if not t:
            return []
        query = t["query_template"].replace("{name}", name)
        count = t.get("result_count", 5)
        results = _brave_call(query, count=count)
        log_search(company_id, search_type, t.get("id"), query, len(results))
        search_log.append({"search_type": search_type, "result_count": len(results)})
        logger.info(f"  [{search_type}] {len(results)} results — query: {query[:80]}")
        return results

    # cases_only: skip everything except the case_studies and revenue searches
    if cases_only:
        cs_results = _run_search("case_studies")
        if cs_results:
            case_studies = [
                {"title":   (r.get("title") or "").strip(),
                 "url":     (r.get("url") or "").strip(),
                 "snippet": (r.get("description") or "").strip(),
                 "age":     (r.get("age") or "").strip()}
                for r in cs_results if r.get("title") and r.get("url")
            ]

        time.sleep(1.2)

        # Also run revenue search so the LLM can extract ARR/run-rate figures
        rev_results = _run_search("revenue")
        rev_context = ""
        if rev_results:
            rev_context = "\n".join(
                f"• {r.get('title','')}\n  {r.get('description','')}\n  {r.get('url','')}"
                for r in rev_results
            )[:3000]

        return {
            "context":       rev_context,
            "news_articles": [],
            "case_studies":  case_studies,
            "search_log":    search_log,
        }

    # Website
    logger.info(f"  Fetching website: {website}")
    site_text = fetch_website(website)
    if site_text:
        sections.append(f"=== Company Website ({website}) ===\n{site_text}")

    time.sleep(1)

    # News — structured (stored) + text (LLM context)
    news_results = _run_search("news")
    if news_results:
        news_articles = [
            {"title":   (r.get("title") or "").strip(),
             "url":     (r.get("url") or "").strip(),
             "snippet": (r.get("description") or "").strip(),
             "age":     (r.get("age") or "").strip()}
            for r in news_results if r.get("title") and r.get("url")
        ]
        text = "\n".join(
            f"• {r.get('title','')}\n  {r.get('description','')}\n  {r.get('url','')}"
            for r in news_results
        )[:3000]
        sections.append(f"=== Recent News & Coverage ===\n{text}")

    time.sleep(1.2)

    # Funding — LLM context only
    funding_results = _run_search("funding")
    if funding_results:
        text = "\n".join(
            f"• {r.get('title','')}\n  {r.get('description','')}\n  {r.get('url','')}"
            for r in funding_results
        )[:3000]
        sections.append(f"=== Funding & Investors ===\n{text}")

    time.sleep(1.2)

    # Product — LLM context only
    product_results = _run_search("product")
    if product_results:
        text = "\n".join(
            f"• {r.get('title','')}\n  {r.get('description','')}\n  {r.get('url','')}"
            for r in product_results
        )[:3000]
        sections.append(f"=== Product & Technology ===\n{text}")

    time.sleep(1.2)

    # Case studies — structured, queued for Human Review (not in LLM context)
    if not skip_cases:
        cs_results = _run_search("case_studies")
        if cs_results:
            case_studies = [
                {"title":   (r.get("title") or "").strip(),
                 "url":     (r.get("url") or "").strip(),
                 "snippet": (r.get("description") or "").strip(),
                 "age":     (r.get("age") or "").strip()}
                for r in cs_results if r.get("title") and r.get("url")
            ]

    return {
        "context":       "\n\n".join(sections),
        "news_articles": news_articles,
        "case_studies":  case_studies,
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
- revenue_arr_usd: ARR or annualized run rate in USD as an integer — only if an explicit dollar figure is stated (e.g. "$30M revenue" → 30000000). Do NOT estimate.
- revenue_period: Time period for the revenue figure (e.g. "H1 2025", "Q1 2026", "as of Jan 2026", "2025")
- revenue_source: The URL from the research where this revenue figure was found

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
    """Extract and validate JSON from LLM response."""
    raw = raw.strip()
    # Strip markdown fences
    if "```" in raw:
        raw = re.sub(r"```(?:json)?", "", raw).strip().strip("```").strip()
    # Find first { ... }
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return {}
    try:
        data = json.loads(m.group())
    except json.JSONDecodeError:
        return {}

    result = {}

    # 4D — validate against allowed sets
    if data.get("env_4d")      in VALID_ENV:   result["env_4d"]      = data["env_4d"]
    if data.get("func_4d")     in VALID_FUNC:  result["func_4d"]     = data["func_4d"]
    if data.get("stack_4d")    in VALID_STACK: result["stack_4d"]    = data["stack_4d"]
    if data.get("biz_model_4d") in VALID_BIZ:  result["biz_model_4d"] = data["biz_model_4d"]

    # Profile fields — only overwrite if currently missing
    if data.get("description") and isinstance(data["description"], str):
        result["description"] = data["description"].strip()
    if data.get("stage") in VALID_STAGES:
        result["stage"] = data["stage"]
    if data.get("employee_count"):
        try:
            result["employee_count"] = int(data["employee_count"])
        except (ValueError, TypeError):
            pass
    if data.get("total_raised_usd"):
        try:
            result["total_raised_usd"] = int(data["total_raised_usd"])
        except (ValueError, TypeError):
            pass
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
        except (ValueError, TypeError):
            pass

    if data.get("revenue_arr_usd"):
        try:
            result["revenue_arr_usd"] = int(data["revenue_arr_usd"])
        except (ValueError, TypeError):
            pass
    if data.get("revenue_period") and isinstance(data["revenue_period"], str):
        result["revenue_period"] = data["revenue_period"].strip()[:100]
    if data.get("revenue_source") and isinstance(data["revenue_source"], str):
        result["revenue_source"] = data["revenue_source"].strip()

    return result


# ── DB Write ──────────────────────────────────────────────────────────────────

def write_to_db(
    company_id: int,
    updates: Dict[str, Any],
    company: Dict[str, Any],
    news_articles: List[Dict] = None,
    case_studies: List[Dict] = None,
) -> None:
    """Write enrichment results. Don't overwrite profile fields that already have good data.
    News/case studies are always overwritten (fresher is better).
    """
    # For profile fields (not 4D), only write if currently null
    # Revenue fields always overwrite — fresher data wins
    PRESERVE_IF_SET = {"description", "stage", "employee_count", "total_raised_usd",
                       "hq_city", "country", "founded"}
    filtered = {}
    for k, v in updates.items():
        if k in PRESERVE_IF_SET and company.get(k):
            continue  # already has data — skip
        filtered[k] = v

    # Always write news articles directly (supplementary, low-stakes)
    if news_articles:
        filtered["news_articles"] = json.dumps(news_articles)

    # Case studies route through Human Review (intel_suggestions) — NOT direct write
    # They are queued here and written to companies.case_studies only when an analyst approves.

    if not filtered and not case_studies:
        logger.info(f"  No new fields to write for company {company_id}")
        return

    set_clauses = []
    params = []

    for field, value in filtered.items():
        if field in ("investors", "tags") and isinstance(value, list):
            set_clauses.append(f"{field} = %s::text[]")
            params.append(value)
        elif field in ("news_articles",):
            set_clauses.append(f"{field} = %s::jsonb")
            params.append(value)
        else:
            set_clauses.append(f"{field} = %s")
            params.append(value)

    if set_clauses:
        set_clauses += [
            "enrichment_status = %s",
            "enrichment_source = %s",
            "updated_at = NOW()",
        ]
        params += ["enriched", "deep_enrich", company_id]

        sql = f"UPDATE cvc.companies SET {', '.join(set_clauses)} WHERE id = %s"
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                # Refresh search text
                cur.execute("""
                    UPDATE cvc.companies
                    SET search_text = to_tsvector(
                        coalesce(name, '') || ' ' ||
                        coalesce(one_liner, '') || ' ' ||
                        coalesce(description, '')
                    )
                    WHERE id = %s
                """, (company_id,))

    # Case studies are queued by enrich_company() after write_to_db() — not here


def _queue_case_study_suggestions(company_id: int, case_studies: List[Dict]) -> int:
    """Insert each Brave-sourced case study as a pending intel_suggestion for human review.
    Returns the number of new suggestions queued."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            queued = 0
            for cs in case_studies:
                title = cs.get("title", "")
                url   = cs.get("url", "")
                if not title and not url:
                    continue
                # Skip if this URL is already queued/accepted for this company
                cur.execute("""
                    SELECT id FROM cvc.intel_suggestions
                    WHERE company_id = %s
                      AND suggestion_type = 'case_study'
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
                    json.dumps({
                        "title":   cs.get("title", ""),
                        "url":     cs.get("url", ""),
                        "snippet": cs.get("snippet", ""),
                        "age":     cs.get("age", ""),
                    }),
                    0.8,
                    "Sourced via Brave Search — commercial deployment evidence",
                ))
                queued += 1
            conn.commit()
    logger.info(f"  Queued {queued} case study suggestion(s) for human review (company {company_id})")
    return queued


# ── Core enrichment function ──────────────────────────────────────────────────

def enrich_company(company: Dict[str, Any],
                   skip_cases: bool = False,
                   cases_only: bool = False) -> Dict[str, Any]:
    """Enrich a single company. Returns a result dict with per-company Brave + LLM outcome.

    skip_cases=True: Step 2 (4D) only — skips case_studies search.
    cases_only=True: Step 4 (Case Studies) only — skips website, news/funding/product searches, and LLM.
    Default: full pass (Steps 2+4 together).
    """
    company_id = company["id"]
    name       = company["name"]
    website    = (company.get("website") or "").rstrip("/")

    result: Dict[str, Any] = {
        "id":                  company_id,
        "name":                name,
        "website_ok":          False,
        "news_found":          0,
        "case_studies_queued": 0,
        "fields_written":      [],
        "search_log":          [],
        "status":              "failed",
        "error":               None,
    }

    logger.info(f"Enriching: {name} (id={company_id})"
                + (" [4D only]" if skip_cases else " [cases only]" if cases_only else ""))

    if not website and not cases_only:
        logger.warning(f"  No website — Brave-only mode")

    try:
        templates = load_search_templates()
        research = research_company(name, website, company_id, templates,
                                    skip_cases=skip_cases, cases_only=cases_only)
        context       = research["context"]
        news_articles = research["news_articles"]
        case_studies  = research["case_studies"]
        search_log    = research.get("search_log", [])

        result["website_ok"] = bool(website and "Company Website" in context)
        result["news_found"] = len(news_articles)
        result["search_log"] = search_log

        # cases_only: queue case studies + run targeted revenue LLM if we got revenue search results
        if cases_only:
            cs_queued = 0
            if case_studies:
                cs_queued = _queue_case_study_suggestions(company_id, case_studies)
            result["case_studies_queued"] = cs_queued
            written = [f"case_studies_queued({cs_queued})"] if cs_queued else []

            if context:
                rev_prompt = (
                    f"You are a VC analyst. Extract revenue data for {name} from this research.\n\n"
                    f"Research:\n{context}\n\n"
                    "Return a JSON object with only the fields you can confirm from explicit statements:\n"
                    "- revenue_arr_usd: integer USD amount (ONLY if an explicit dollar figure is stated, e.g. '$30M revenue' → 30000000)\n"
                    "- revenue_period: time period string (e.g. 'H1 2025', 'as of Jan 2026')\n"
                    "- revenue_source: the URL where the figure appeared\n\n"
                    "If no revenue data is found, return {}. Return ONLY valid JSON. No explanation."
                )
                logger.info(f"  Calling LLM for revenue extraction...")
                raw = llm_call(rev_prompt, model=MODEL, temperature=0.1, max_tokens=200,
                               activity="Revenue Extraction")
                if raw:
                    rev_updates = parse_response(raw)
                    rev_fields = {k: v for k, v in rev_updates.items()
                                  if k in ("revenue_arr_usd", "revenue_period", "revenue_source")}
                    if rev_fields:
                        write_to_db(company_id, rev_fields, company)
                        written += list(rev_fields.keys())
                        logger.info(f"  Revenue fields written: {list(rev_fields.keys())}")

            result["status"] = "success"
            result["fields_written"] = written
            return result

        if not context:
            logger.warning(f"  No research context gathered — skipping")
            result["status"] = "skipped"
            return result

        existing = build_existing_summary(company)
        prompt   = PROMPT_TEMPLATE.format(
            name=name,
            existing=existing,
            context=context[:8000],
        )

        logger.info(f"  Calling LLM...")
        activity_label = "4D Classification" if skip_cases else "4D Classification + Case Studies"
        raw = llm_call(prompt, model=MODEL, temperature=0.1, max_tokens=1000,
                       activity=activity_label)

        if not raw:
            logger.warning(f"  Empty LLM response")
            result["error"] = "empty LLM response"
            return result

        updates = parse_response(raw)
        if not updates:
            logger.warning(f"  Could not parse LLM response")
            result["error"] = "LLM parse failed"
            return result

        # Check 4D completeness
        four_d = {k: updates.get(k) for k in ("env_4d", "func_4d", "stack_4d", "biz_model_4d")}
        missing_4d = [k for k, v in four_d.items() if not v]
        if missing_4d:
            logger.warning(f"  Missing 4D fields: {missing_4d} — still writing what we got")

        write_to_db(company_id, updates, company, news_articles, case_studies)

        written = list(updates.keys())
        if news_articles:
            written.append(f"news_articles({len(news_articles)})")

        # case_studies go to human review — track count separately
        cs_queued = 0
        if case_studies:
            cs_queued = _queue_case_study_suggestions(company_id, case_studies)
            written.append(f"case_studies_queued({cs_queued})")

        logger.info(f"  Done. Fields written: {written}")

        result["fields_written"]      = written
        result["case_studies_queued"] = cs_queued
        result["search_log"]          = search_log
        result["status"]              = "success"
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
                    FROM cvc.companies
                    WHERE LOWER(name) LIKE LOWER(%s)
                    LIMIT 5
                """, (f"%{company_name}%",))
            else:
                filters = ["name IS NOT NULL"]
                params: List = []
                if portfolio_only:
                    filters.append("is_portfolio = TRUE")
                if sector:
                    filters.append("sector = %s")
                    params.append(sector)
                where = " AND ".join(filters)
                params.append(limit)
                cur.execute(f"""
                    SELECT id, name, website, one_liner, description, sector,
                           stage, employee_count, founded, hq_city, country,
                           total_raised_usd, investors, tags
                    FROM cvc.companies
                    WHERE {where}
                    ORDER BY id
                    LIMIT %s
                """, params)
            return cur.fetchall()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Deep company enrichment with Brave Search + LLM")
    parser.add_argument("--limit",        type=int,  default=20,   help="Max companies to process")
    parser.add_argument("--company",      type=str,  default=None, help="Run for a specific company name")
    parser.add_argument("--id",           type=int,  default=None, help="Run for a specific company ID")
    parser.add_argument("--no-gate",      action="store_true",     help="Skip cron job gate check")
    parser.add_argument("--portfolio",    action="store_true",     help="Restrict to portfolio companies only")
    parser.add_argument("--sector",       type=str,  default=None, help="Restrict to a specific sector")
    parser.add_argument("--batch-job-id", type=int,  default=None, help="batch_jobs.id for live progress tracking")
    parser.add_argument("--skip-cases",   action="store_true",     help="Step 2 only — skip case_studies search (4D + news)")
    parser.add_argument("--cases-only",   action="store_true",     help="Step 4 only — skip website/LLM, only run case_studies search")
    args = parser.parse_args()

    if args.skip_cases and args.cases_only:
        logger.error("--skip-cases and --cases-only are mutually exclusive")
        sys.exit(1)

    if not args.company and not args.id and not args.no_gate:
        if not is_job_enabled(JOB_NAME):
            logger.info(f"Job '{JOB_NAME}' disabled in scheduler — exiting")
            sys.exit(0)

    companies = get_companies(args.limit, args.company, args.id,
                              portfolio_only=args.portfolio,
                              sector=args.sector)
    if not companies:
        logger.info("No companies to process")
        print(json.dumps({"total": 0, "success": 0, "failed": 0, "skipped": 0,
                          "news_articles_written": 0, "case_studies_queued": 0, "companies": []}))
        return

    total = len(companies)
    logger.info(f"Processing {total} companies")
    if args.batch_job_id:
        update_batch_progress(args.batch_job_id, 0, total)

    company_results = []
    for idx, company in enumerate(companies, 1):
        r = enrich_company(company, skip_cases=args.skip_cases, cases_only=args.cases_only)
        company_results.append(r)
        if args.batch_job_id:
            update_batch_progress(args.batch_job_id, idx, total)
        if total > 1:
            time.sleep(2)  # be polite to Brave rate limits between companies

    success  = sum(1 for r in company_results if r["status"] == "success")
    failed   = sum(1 for r in company_results if r["status"] == "failed")
    skipped  = sum(1 for r in company_results if r["status"] == "skipped")
    total_news = sum(r["news_found"] for r in company_results)
    total_cs   = sum(r["case_studies_queued"] for r in company_results)

    # Aggregate per-search-type performance from all company search logs
    type_stats: Dict[str, Dict] = {}
    for r in company_results:
        for entry in r.get("search_log", []):
            st = entry["search_type"]
            if st not in type_stats:
                type_stats[st] = {"runs": 0, "total_results": 0, "zero_result_runs": 0}
            type_stats[st]["runs"] += 1
            type_stats[st]["total_results"] += entry["result_count"]
            if entry["result_count"] == 0:
                type_stats[st]["zero_result_runs"] += 1

    search_performance = {}
    for st, s in type_stats.items():
        search_performance[st] = {
            "runs":            s["runs"],
            "avg_results":     round(s["total_results"] / s["runs"], 1) if s["runs"] else 0,
            "zero_result_pct": round(100 * s["zero_result_runs"] / s["runs"], 1) if s["runs"] else 0,
        }

    summary = {
        "total":                 len(companies),
        "success":               success,
        "failed":                failed,
        "skipped":               skipped,
        "news_articles_written": total_news,
        "case_studies_queued":   total_cs,
        "brave_quota_exhausted": _brave_quota_exhausted,
        "search_performance":    search_performance,
        "companies":             company_results,
    }
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
