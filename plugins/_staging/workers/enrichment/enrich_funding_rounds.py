"""
Funding Round Enrichment Worker
Task #143: Validates and backfills funding history via Brave Search + LLM extraction.
Test run: target company_id=1185 (Zipline) first.

Usage (on Dell server):
    cd /home/nathan11/repos/cvc-intelligence
    PYTHONPATH=core python3 workers/enrichment/enrich_funding_rounds.py
    # batch mode (prioritizes approximate rounds):
    PYTHONPATH=core python3 workers/enrichment/enrich_funding_rounds.py --batch
    # sector mode (all companies in a sector):
    PYTHONPATH=core python3 workers/enrichment/enrich_funding_rounds.py --sector="Physical AI"
    PYTHONPATH=core python3 workers/enrichment/enrich_funding_rounds.py --sector="Robotics"
"""

import json
import logging
import re
import time
import sys
from datetime import datetime
from typing import List, Dict, Optional, Any

import requests

from db.connection import get_connection
from web.brave import search as brave_search
from llm.openrouter import call as llm_call

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("enrich_funding_rounds")

MODEL = "qwen/qwen3-235b-a22b-2507"

EXTRACT_PROMPT = """You are a funding data analyst. Extract all funding rounds for {company_name} from the search results below.

Return a JSON array only — no markdown. Each object must have:
  "round_type": string (e.g. "Seed", "Series A", "Series B" — Title Case)
  "amount_usd": integer in USD (e.g. 10000000 for $10M, 800000000 for $800M), or null
  "announced_date": "YYYY-MM-DD" or null
  "investors": list of investor name strings
  "valuation_usd": integer or null (only if explicitly stated)
  "approximate": boolean (true if amount described as "around", "up to", "approximately", etc.)
  "source_url": the URL this data came from

Rules:
- Only include rounds explicitly raised by {company_name}
- Normalize round types to Title Case (Series A, not series_a)
- Amounts must be integers in USD
- If no rounds found, return []

Search results:
{search_text}
"""

MEDIUM_TRUST_DOMAINS = ["linkedin.com", "medium.com", "news.ycombinator.com"]

# Fallback domain lists — used when DB template is unavailable
_DEFAULT_PREFERRED = [
    "prnewswire.com", "businesswire.com", "globenewswire.com",
    "accesswire.com", "sec.gov",
    "techcrunch.com", "reuters.com", "bloomberg.com", "cnbc.com",
    "forbes.com", "wsj.com", "ft.com", "axios.com",
    "facilitiesdive.com", "supplychaindive.com", "manufacturingdive.com",
    "logisticsmgmt.com", "dcvelocity.com", "therobotreport.com",
    "geekwire.com", "siliconangle.com", "venturebeat.com",
]
_DEFAULT_EXCLUDED = ["crunchbase.com", "pitchbook.com"]


def _load_funding_domain_prefs() -> tuple[list[str], list[str]]:
    """Load preferred/excluded domain lists from brave_search_templates.
    Returns (preferred_domains, excluded_domains). Falls back to hardcoded defaults."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT preferred_domains, excluded_domains
                    FROM cvc.brave_search_templates
                    WHERE search_type = 'funding' AND active = TRUE
                    LIMIT 1
                """)
                row = cur.fetchone()
                if row:
                    preferred = list(row["preferred_domains"] or []) or _DEFAULT_PREFERRED
                    excluded  = list(row["excluded_domains"]  or []) or _DEFAULT_EXCLUDED
                    return preferred, excluded
    except Exception as e:
        log.warning(f"Could not load domain prefs from DB: {e} — using defaults")
    return _DEFAULT_PREFERRED, _DEFAULT_EXCLUDED


# Loaded once at startup
OPEN_HIGH_TRUST_DOMAINS, PAYWALLED_DOMAINS = _load_funding_domain_prefs()

# Appended to every funding Brave query to exclude paywalled results
_PAYWALL_EXCLUSIONS = " ".join(f"-site:{d}" for d in PAYWALLED_DOMAINS)


def source_quality(url: Optional[str]) -> float:
    if not url:
        return 0.5
    u = url.lower()
    for d in PAYWALLED_DOMAINS:
        if d in u:
            return 0.3   # paywalled — low confidence, won't clear the 0.5 threshold
    for d in OPEN_HIGH_TRUST_DOMAINS:
        if d in u:
            return 0.95
    for d in MEDIUM_TRUST_DOMAINS:
        if d in u:
            return 0.75
    return 0.6


def calc_confidence(r: dict, sq: float) -> float:
    c = sq
    if r.get("approximate"):
        c *= 0.85
    if not r.get("amount_usd"):
        c *= 0.8
    if not r.get("announced_date"):
        c *= 0.9
    if not r.get("investors"):
        c *= 0.95
    return round(min(c, 1.0), 3)


_FETCH_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CVCBot/1.0; research)"}


def _fetch_page(url: str) -> str:
    """Fetch a webpage and return cleaned text (no HTML tags). Empty string on failure."""
    if not url:
        return ""
    try:
        r = requests.get(url, headers=_FETCH_HEADERS, timeout=12, allow_redirects=True)
        r.raise_for_status()
        html = r.text
        html = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<style[^>]*>.*?</style>",  " ", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<[^>]+>", " ", html)
        html = re.sub(r"&[a-z#0-9]+;", " ", html)
        html = re.sub(r"\s+", " ", html).strip()
        return html[:5000]
    except Exception as e:
        log.debug(f"Page fetch failed {url}: {e}")
        return ""


def _gather_website_context(company_name: str, website: str) -> str:
    """
    Fetch the company's own website for funding announcements.
    Tries homepage + common press/news/investor subpages.
    Returns labelled text block for LLM context.
    """
    if not website:
        return ""
    website = website.rstrip("/")
    sections = []

    # Homepage
    text = _fetch_page(website)
    if text:
        sections.append(f"=== {website} ===\n{text[:2000]}")
    time.sleep(1)

    # Press/news/investor pages — stop at first hit
    for subpath in ("/press", "/news", "/newsroom", "/blog", "/investors", "/funding"):
        text = _fetch_page(f"{website}{subpath}")
        if text and len(text) > 300:
            sections.append(f"=== {website}{subpath} ===\n{text[:3000]}")
            time.sleep(1)
            break

    return "\n\n".join(sections)


def stamp_funding_enriched(company_id: int) -> None:
    """Mark that the funding enrichment step ran for this company (even if no rounds found)."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.companies SET funding_enriched_at = NOW() WHERE id = %s",
                (company_id,)
            )
            conn.commit()


def get_existing_rounds(company_id: int) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT round_type, amount_usd, announced_date, approximate
                FROM cvc.funding_rounds WHERE company_id = %s
            """, (company_id,))
            return [dict(r) for r in cur.fetchall()]


def is_duplicate(extracted: dict, existing: list) -> bool:
    ext_type = (extracted.get("round_type") or "").lower().strip()
    ext_amount = extracted.get("amount_usd")
    ext_date = extracted.get("announced_date")

    for row in existing:
        if (row.get("round_type") or "").lower().strip() != ext_type:
            continue
        exist_amount = row.get("amount_usd")
        if ext_amount and exist_amount:
            if abs(ext_amount - exist_amount) <= max(ext_amount * 0.1, 500_000):
                return True
        exist_date = row.get("announced_date")
        if ext_date and exist_date:
            if str(exist_date)[:10] == str(ext_date)[:10]:
                return True
    return False


def insert_suggestion(company_id: int, r: dict, confidence: float) -> bool:
    suggested_data = {
        "round_type": r.get("round_type"),
        "amount_usd": r.get("amount_usd"),
        "announced_date": r.get("announced_date"),
        "investors": r.get("investors") or [],
        "valuation_usd": r.get("valuation_usd"),
        "source_url": r.get("source_url"),
    }
    reasoning = (
        f"Brave Search result from {r.get('source_url') or 'unknown source'}. "
        f"Approximate: {r.get('approximate', False)}."
    )

    # Skip if identical pending suggestion already exists
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id FROM cvc.intel_suggestions
                WHERE company_id = %s
                  AND suggestion_type = 'new_funding_round'
                  AND status = 'pending'
                  AND suggested_data->>'round_type' = %s
            """, (company_id, r.get("round_type")))
            if cur.fetchone():
                return False

            cur.execute("""
                INSERT INTO cvc.intel_suggestions
                    (company_id, suggestion_type, suggested_data, confidence, reasoning)
                VALUES (%s, 'new_funding_round', %s, %s, %s)
            """, (
                company_id,
                json.dumps(suggested_data),
                confidence,
                reasoning,
            ))
            conn.commit()
    return True


def enrich_company(company_id: int, company_name: str, website: str = "") -> dict:
    result = {"company_id": company_id, "name": company_name,
              "extracted": 0, "suggestions": 0, "errors": []}

    existing = get_existing_rounds(company_id)

    context_parts = []

    # ── Layer 1: Company website (press/news/investor pages) ──────────────────
    if website:
        log.info(f"  Fetching company website: {website}")
        site_ctx = _gather_website_context(company_name, website)
        if site_ctx:
            context_parts.append(site_ctx)

    # ── Layer 2: Press release wires — highest trust, most specific ───────────
    from urllib.parse import urlparse
    domain = urlparse(website).netloc.replace("www.", "") if website else ""
    anchor = f'site:{domain}' if domain else f'"{company_name}"'

    for pr_site in ("prnewswire.com", "businesswire.com", "globenewswire.com"):
        pr_hits = brave_search(f'site:{pr_site} {anchor} funding raised', count=3)
        if pr_hits:
            pr_text = "\n\n".join(
                f"[{h.get('title','')}] {h.get('url','')}\n{h.get('description') or h.get('snippet','')}"
                for h in pr_hits
            )
            context_parts.append(f"=== {pr_site} ===\n{pr_text}")
        time.sleep(0.5)

    # ── Layer 3: General Brave search — broader coverage ─────────────────────
    query = f"{company_name} funding rounds raised series investment {_PAYWALL_EXCLUSIONS}"
    log.info(f"  General search: {company_name}")
    hits = brave_search(query, count=10)
    if hits:
        general_text = "\n\n".join(
            f"[{h.get('title','')}] {h.get('url','')}\n{h.get('description') or h.get('snippet','')}"
            for h in hits
        )
        context_parts.append(f"=== Web Search ===\n{general_text}")

    if not context_parts:
        result["errors"].append("No data found from any source")
        stamp_funding_enriched(company_id)
        return result

    search_text = "\n\n".join(context_parts)
    prompt = EXTRACT_PROMPT.format(company_name=company_name, search_text=search_text[:8000])

    try:
        raw = llm_call(
            prompt=prompt,
            model=MODEL,
            temperature=0.1,
            max_tokens=2000,
            activity="Funding Rounds",
        )
    except Exception as e:
        result["errors"].append(f"LLM error: {e}")
        stamp_funding_enriched(company_id)
        return result

    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]

    try:
        rounds = json.loads(raw.strip())
    except json.JSONDecodeError as e:
        result["errors"].append(f"JSON parse failed: {e}")
        stamp_funding_enriched(company_id)
        return result

    if not isinstance(rounds, list):
        result["errors"].append("LLM returned non-list")
        stamp_funding_enriched(company_id)
        return result

    result["extracted"] = len(rounds)

    for r in rounds:
        if is_duplicate(r, existing):
            log.info(f"  Skipping duplicate: {r.get('round_type')}")
            continue
        sq = source_quality(r.get("source_url"))
        confidence = calc_confidence(r, sq)
        if confidence < 0.35:
            log.info(f"  Skipping low-confidence ({confidence}): {r.get('round_type')}")
            continue
        if insert_suggestion(company_id, r, confidence):
            result["suggestions"] += 1
            log.info(f"  Suggestion created: {r.get('round_type')} "
                     f"${r.get('amount_usd')} conf={confidence}")

    stamp_funding_enriched(company_id)
    return result


def get_target_companies(
    limit: int = 100,
    specific_id: Optional[int] = None,
    sector: Optional[str] = None,
) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if specific_id:
                cur.execute("SELECT id, name, website FROM cvc.companies WHERE id = %s", (specific_id,))
                return [{"company_id": r["id"], "name": r["name"], "website": r["website"] or ""} for r in cur.fetchall()]

            if sector:
                cur.execute("""
                    SELECT id, name, website FROM cvc.companies
                    WHERE sector = %s
                    ORDER BY name
                """, (sector,))
                return [{"company_id": r["id"], "name": r["name"], "website": r["website"] or ""} for r in cur.fetchall()]

            # Default batch: prioritize companies with approximate funding rounds
            cur.execute("""
                SELECT c.id, c.name, c.website, COUNT(fr.id) AS approx_count
                FROM cvc.companies c
                JOIN cvc.funding_rounds fr ON c.id = fr.company_id AND fr.approximate = TRUE
                GROUP BY c.id, c.name, c.website
                ORDER BY approx_count DESC
                LIMIT %s
            """, (limit,))
            return [{"company_id": r["id"], "name": r["name"], "website": r["website"] or ""} for r in cur.fetchall()]


def run(
    test_mode: bool = True,
    specific_id: Optional[int] = None,
    batch_limit: int = 100,
    sector: Optional[str] = None,
):
    if specific_id:
        log.info(f"TEST MODE — company_id={specific_id}")
        companies = get_target_companies(specific_id=specific_id)
    elif sector:
        log.info(f"SECTOR MODE — sector='{sector}'")
        companies = get_target_companies(sector=sector)
    elif not test_mode:
        log.info(f"BATCH MODE — up to {batch_limit} companies")
        companies = get_target_companies(limit=batch_limit)
    else:
        log.info("TEST MODE — company_id=1185 (Zipline)")
        companies = get_target_companies(specific_id=1185)

    if not companies:
        log.warning("No companies found")
        return

    log.info(f"Processing {len(companies)} companies...")
    total_suggestions = 0
    for c in companies:
        try:
            res = enrich_company(c["company_id"], c["name"], c.get("website", ""))
            total_suggestions += res["suggestions"]
            if res["errors"]:
                log.warning(f"  Errors for {c['name']}: {res['errors']}")
            time.sleep(1)  # rate limit between companies
        except Exception as e:
            log.error(f"Fatal error on {c['name']}: {e}", exc_info=True)

    log.info(f"Done. {total_suggestions} suggestions created across {len(companies)} companies.")


if __name__ == "__main__":
    sector = None
    specific_id = None
    batch_mode = "--batch" in sys.argv

    for arg in sys.argv[1:]:
        if arg.startswith("--company-id="):
            specific_id = int(arg.split("=", 1)[1])
        elif arg.startswith("--sector="):
            sector = arg.split("=", 1)[1]

    run(test_mode=not batch_mode, specific_id=specific_id, sector=sector)
