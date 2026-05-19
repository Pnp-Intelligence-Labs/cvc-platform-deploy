#!/usr/bin/env python3
"""
founder_research.py — Founder Research Enrichment (Phase 0)

For a given company:
  1. Discover founders via website scrape + Brave search
  2. Research each founder: LinkedIn, Crunchbase, prior exits, background
  3. LLM synthesizes verified bios + flags credential mismatches
  4. Stores the report as a company_intel row (visible in company profile)
  5. Writes intel_suggestions for any actionable data found

Run from task queue or on demand:
  python3 workers/enrichment/founder_research.py --company-id=42
  python3 workers/enrichment/founder_research.py --company="Carrier1"
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

from db.connection import get_connection
from llm.openrouter import call as llm_call

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("founder_research")

MODEL = "qwen/qwen3-235b-a22b-2507"
MAX_FOUNDERS = 4


# ── Brave Search ──────────────────────────────────────────────────────────────

# Collects every URL returned by Brave during a run — reset at start of each research job
_run_sources: List[Dict[str, str]] = []


def _reset_sources() -> None:
    global _run_sources
    _run_sources = []


def _brave_raw(query: str, count: int, key: str) -> list:
    resp = requests.get(
        "https://api.search.brave.com/res/v1/web/search",
        headers={"Accept": "application/json", "X-Subscription-Token": key},
        params={"q": query, "count": count},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json().get("web", {}).get("results", [])


def _brave_call(query: str, count: int = 5) -> list:
    primary = os.environ.get("BRAVE_SEARCH_KEY", "")
    backup  = os.environ.get("BRAVE_SEARCH_KEY_BACKUP", "")
    for key in filter(None, [primary, backup]):
        try:
            results = _brave_raw(query, count, key)
            # Collect URLs for provenance tracking
            for r in results:
                url = r.get("url", "")
                title = r.get("title", "")
                if url:
                    _run_sources.append({"url": url, "title": title, "query": query})
            return results
        except Exception as e:
            if "429" in str(e) and key == primary and backup:
                time.sleep(2)
                continue
            logger.warning(f"Brave search failed for '{query}': {e}")
            return []
    return []


def brave_text(query: str, count: int = 5) -> str:
    """Return concatenated search snippet text for LLM context."""
    results = _brave_call(query, count)
    parts = []
    for r in results:
        title = r.get("title", "")
        desc  = r.get("description", "")
        url   = r.get("url", "")
        parts.append(f"• {title}\n  {desc}\n  {url}")
    return "\n".join(parts)[:3000]


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
        _run_sources.append({"url": url, "title": "Company Website"})
        return html[:5000]
    except Exception as e:
        logger.warning(f"Website fetch failed for {url}: {e}")
        return ""


# ── Step 1: Discover founders ──────────────────────────────────────────────────

DISCOVER_PROMPT = """You are a venture capital analyst. Given the research below about a company, identify the founders and co-founders.

Company: {name}
Website: {website}
Sector: {sector}

IMPORTANT: Only identify founders of the specific company above. Ignore any content about other companies with similar names.
{context}

Return a JSON array of founder objects. Each object must have:
- "name": full name (string)
- "role": their title or role (string, e.g. "CEO & Co-Founder", "CTO", "Co-Founder")
- "confidence": how confident you are this person is a founder (0.0-1.0)

Only include people you have good reason to believe are founders or co-founders.
If you cannot identify any founders with confidence > 0.5, return an empty array.
Return ONLY valid JSON. No explanation. No markdown fences.

Example: [{{"name": "Jane Smith", "role": "CEO & Co-Founder", "confidence": 0.95}}]"""


def discover_founders(company: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Use website + Brave search to discover founders. Returns list of {name, role, confidence}."""
    name    = company["name"]
    website = (company.get("website") or "").rstrip("/")

    from urllib.parse import urlparse
    domain = urlparse(website).netloc.replace("www.", "") if website else ""

    sections = []

    # Fetch homepage
    site_text = fetch_website(website)
    if site_text:
        sections.append(f"=== Company Website ===\n{site_text[:3000]}")
    time.sleep(1)

    # Fetch /about and /team pages — common locations for founder names
    if website:
        for subpath in ("/about", "/team", "/about-us"):
            page_text = fetch_website(f"{website}{subpath}")
            if page_text and len(page_text) > 200:
                sections.append(f"=== {subpath.strip('/')} Page ===\n{page_text[:3000]}")
                time.sleep(1)
                break  # stop after first successful subpage
        time.sleep(1)

    # When domain is known: anchor searches to the domain to avoid name conflicts
    # e.g. "Quilter" matches Quilter plc; site:quilter.ai returns the right company
    if domain:
        dom_search = brave_text(f'site:{domain} founder CEO', count=5)
        if dom_search:
            sections.append(f"=== Domain Search ===\n{dom_search}")
        time.sleep(1)

        dom_news = brave_text(f'"{domain}" founder CEO startup', count=3)
        if dom_news:
            sections.append(f"=== Domain News ===\n{dom_news}")
        time.sleep(1)
    else:
        # No domain — fall back to name-based searches (higher risk of false matches)
        search = brave_text(f'"{name}" founders team CEO CTO co-founder leadership', count=5)
        if search:
            sections.append(f"=== Search Results ===\n{search}")
        time.sleep(1)

        about = brave_text(f'"{name}" "about us" OR "our team" founders', count=3)
        if about:
            sections.append(f"=== About/Team ===\n{about}")

    if not sections:
        logger.warning("  No discovery context gathered")
        return []

    context = "\n\n".join(sections)
    prompt  = DISCOVER_PROMPT.format(
        name=name,
        website=website or "unknown",
        sector=company.get("sector") or "technology",
        context=context[:8000],
    )

    logger.info("  Calling LLM to identify founders...")
    raw = llm_call(prompt, model=MODEL, temperature=0.1, max_tokens=800,
                   activity="Founder Research")

    if not raw:
        return []

    raw = raw.strip()
    if "```" in raw:
        raw = re.sub(r"```(?:json)?", "", raw).strip().strip("```").strip()
    m = re.search(r"\[.*\]", raw, re.DOTALL)
    if not m:
        return []

    try:
        founders = json.loads(m.group())
    except json.JSONDecodeError:
        return []

    # Filter to high-confidence founders, cap at MAX_FOUNDERS
    founders = [f for f in founders if isinstance(f, dict)
                and f.get("name") and float(f.get("confidence", 0)) >= 0.5]
    founders.sort(key=lambda f: float(f.get("confidence", 0)), reverse=True)
    return founders[:MAX_FOUNDERS]


# ── Step 2: Research each founder ─────────────────────────────────────────────

def research_founder(founder_name: str, company_name: str) -> str:
    """Run Brave searches on a founder. Returns combined text for LLM context."""
    sections = []

    time.sleep(1)
    s1 = brave_text(f'"{founder_name}" "{company_name}" founder background experience', count=5)
    if s1:
        sections.append(f"=== Background & Role ===\n{s1}")

    time.sleep(1.2)
    s2 = brave_text(f'"{founder_name}" founder CEO president previously founded startup', count=5)
    if s2:
        sections.append(f"=== Prior Companies ===\n{s2}")

    time.sleep(1.2)
    s3 = brave_text(f'"{founder_name}" acquired acquisition "sold to" "acquired by" exit merger raised funding', count=5)
    if s3:
        sections.append(f"=== Exits & Acquisitions ===\n{s3}")

    time.sleep(1.2)
    s4 = brave_text(f'"{founder_name}" education university degree investor', count=3)
    if s4:
        sections.append(f"=== Education & Other Context ===\n{s4}")

    return "\n\n".join(sections)


# ── Step 3: Synthesize findings ───────────────────────────────────────────────

SYNTHESIZE_PROMPT = """You are a venture capital due diligence analyst preparing a founder background report.

Company: {company_name}
Sector: {sector}
Stage: {stage}

Founders identified: {founder_list}

Research gathered per founder:
{research_sections}

Write a structured founder background report with these sections:

## Founders Overview
Brief paragraph summarizing the founding team as a whole.

## Individual Profiles
For each founder:
- **[Name]** — [Role]
  - Background: [1-2 sentences on career history and expertise]
  - Prior Companies: [list each previous company they founded or led, with their role]
  - Exits & Acquisitions: [for each prior company — was it acquired, merged, raised significant funding, or shut down? Include acquirer name, approximate year, and deal size if known. Be specific. If none confirmed, write "None confirmed."]
  - Credibility Notes: [flag any claims that couldn't be verified or appear inconsistent]

## Exit Track Record Summary
One paragraph assessing the team's combined exit/acquisition history as a signal for investor confidence. Note whether exits were strategic acqui-hires, product acquisitions, or scaled exits. Flag if no exits exist.

## Red Flags
List any credential mismatches, unverified claims, or concerns. If none found, write "None identified."

## Investor Context
List any investors, VCs, or angels mentioned in the research. Only list if explicitly named.

Keep the report factual and grounded in what was actually found. Do not fabricate or speculate.
Be specific about what is verified vs founder-stated vs unverifiable."""

SUGGEST_PROMPT = """Based on this founder research report for {company_name}, extract any structured data points that should be suggested as updates to the company profile.

Current company data:
- Stage: {stage}
- HQ City: {hq_city}
- Country: {country}
- Current investors array: {investors}

Sources consulted (cite these by URL in your output):
{source_list}

Report:
{report}

Return a JSON array of suggestion objects. Each object must have:
- "suggestion_type": "field_update" or "new_investor"
- "confidence": float 0.0-1.0
- "reasoning": one sentence from the report that supports this
- "source_url": the single most relevant URL from the sources list above that verifies this suggestion (must be a real URL from the list above, or null if none applies)
- "source_title": the title of that source (from the list above), or null

For "field_update":
- "field_name": the field to update
- "current_value": current value (string or null)
- "suggested_value": the new value (string)
  Allowed field_name values: "stage", "hq_city", "country", "founded"

For "new_investor":
- "suggested_data": {{"investor_name": "VC Name"}}
  Only suggest investors who are clearly confirmed as having invested, not just mentioned.

Only include high-confidence suggestions (>= 0.7). Exclude any suggestion where you cannot cite a real source URL. Return empty array [] if nothing actionable.
Return ONLY valid JSON. No markdown fences."""


def synthesize_report(company: Dict[str, Any], founders: List[Dict], research: Dict[str, str]) -> str:
    """Build the full synthesis prompt and call LLM. Returns the report text."""
    founder_list = ", ".join(
        f"{f['name']} ({f.get('role', 'Founder')})" for f in founders
    )
    research_sections = []
    for f in founders:
        fname = f["name"]
        text  = research.get(fname, "No research gathered.")
        research_sections.append(f"### {fname}\n{text[:2500]}")

    prompt = SYNTHESIZE_PROMPT.format(
        company_name=company["name"],
        sector=company.get("sector") or "Unknown",
        stage=company.get("stage") or "Unknown",
        founder_list=founder_list,
        research_sections="\n\n".join(research_sections),
    )

    logger.info("  Synthesizing founder report via LLM...")
    return llm_call(prompt, model=MODEL, temperature=0.2, max_tokens=2000,
                    activity="Founder Research") or ""


def extract_suggestions(company: Dict[str, Any], report: str,
                        sources: List[Dict[str, str]] = None) -> List[Dict[str, Any]]:
    """Ask LLM to extract actionable intel_suggestions from the report."""
    investors = company.get("investors") or []
    # Build a numbered source list for the LLM to cite from
    source_lines = []
    for i, s in enumerate((sources or [])[:20], 1):
        source_lines.append(f"  [{i}] {s.get('title', '')} — {s.get('url', '')}")
    source_list = "\n".join(source_lines) if source_lines else "  (none)"
    prompt = SUGGEST_PROMPT.format(
        company_name=company["name"],
        stage=company.get("stage") or "None",
        hq_city=company.get("hq_city") or "None",
        country=company.get("country") or "None",
        investors=json.dumps(investors),
        source_list=source_list,
        report=report[:4000],
    )

    raw = llm_call(prompt, model=MODEL, temperature=0.1, max_tokens=800,
                   activity="Founder Research") or ""
    raw = raw.strip()
    if "```" in raw:
        raw = re.sub(r"```(?:json)?", "", raw).strip().strip("```").strip()

    m = re.search(r"\[.*\]", raw, re.DOTALL)
    if not m:
        return []
    try:
        suggestions = json.loads(m.group())
    except json.JSONDecodeError:
        return []

    valid_types = {"field_update", "new_investor"}
    valid_fields = {"stage", "hq_city", "country", "founded"}
    result = []
    for s in suggestions:
        if not isinstance(s, dict):
            continue
        stype = s.get("suggestion_type")
        if stype not in valid_types:
            continue
        if float(s.get("confidence", 0)) < 0.7:
            continue
        if stype == "field_update" and s.get("field_name") not in valid_fields:
            continue
        result.append(s)
    return result


# ── Step 4: Extract structured founder data ───────────────────────────────────

STRUCTURED_PROMPT = """You are a VC analyst. Given this founder research report, extract structured data for each founder.

Report:
{report}

Return a JSON array. Each object represents one founder:
{{
  "name": "Full Name",
  "role": "CEO & Co-Founder",
  "linkedin": null,
  "prior_companies": [
    {{
      "name": "Company Name",
      "role": "President & CEO",
      "exit_type": "acquisition",
      "acquirer": "Trimble or null",
      "year": 2017,
      "deal_size_usd": null
    }}
  ]
}}

exit_type must be one of: "acquisition", "ipo", "shutdown", "still_active", "unknown"
Only include prior_companies that are clearly referenced in the report (not the current company).
Set linkedin to the actual URL only if it appears in the report — otherwise null.
Return ONLY valid JSON array. No markdown fences."""


def extract_structured_founders(founders: List[Dict], report: str) -> List[Dict[str, Any]]:
    """Extract structured founder JSON from the narrative report."""
    prompt = STRUCTURED_PROMPT.format(report=report[:5000])
    raw = llm_call(prompt, model=MODEL, temperature=0.1, max_tokens=1200,
                   activity="Founder Research") or ""
    raw = raw.strip()
    if "```" in raw:
        raw = re.sub(r"```(?:json)?", "", raw).strip().strip("```").strip()
    m = re.search(r"\[.*\]", raw, re.DOTALL)
    if not m:
        # Fall back to minimal structure from the discovered founders list
        return [{"name": f["name"], "role": f.get("role", "Founder"), "linkedin": None, "prior_companies": []} for f in founders]
    try:
        return json.loads(m.group())
    except json.JSONDecodeError:
        return []


def write_founder_fields(company_id: int, structured: List[Dict[str, Any]]) -> None:
    """Write founders, is_repeat_founder, prior_exit_count directly to companies table."""
    if not structured:
        return
    exit_types = {"acquisition", "ipo"}
    is_repeat = any(
        len(f.get("prior_companies") or []) > 0
        for f in structured
    )
    exit_count = sum(
        1 for f in structured
        for pc in (f.get("prior_companies") or [])
        if (pc.get("exit_type") or "").lower() in exit_types
    )
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.companies
                SET founders = %s, is_repeat_founder = %s, prior_exit_count = %s
                WHERE id = %s
            """, (json.dumps(structured), is_repeat, exit_count, company_id))


# ── Step 5: Write to DB ───────────────────────────────────────────────────────

def write_intel(company_id: int, report: str, founder_names: List[str],
                sources: List[Dict[str, str]] = None) -> int:
    """Write the research report to company_intel. Returns the new intel row ID."""
    label   = "Founder Research — System Generated"
    summary = (f"Automated founder background research covering: {', '.join(founder_names)}"
               if founder_names else "Automated founder research (no founders confirmed)")
    # Deduplicate sources by URL, cap at 50
    seen = set()
    unique_sources = []
    for s in (sources or []):
        if s["url"] not in seen:
            seen.add(s["url"])
            unique_sources.append(s)
    signals = json.dumps({"sources": unique_sources[:50]}) if unique_sources else None
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.company_intel
                    (company_id, intel_type, label, raw_text, summary, signals,
                     uploaded_by, processed)
                VALUES (%s, 'text', %s, %s, %s, %s, 'founder_research_worker', TRUE)
                RETURNING id
            """, (company_id, label, report, summary, signals))
            return cur.fetchone()["id"]


def write_suggestions(company_id: int, intel_id: int, suggestions: List[Dict[str, Any]]) -> int:
    """Write intel_suggestions derived from the founder report. Returns count written."""
    if not suggestions:
        return 0

    written = 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            for s in suggestions:
                stype = s["suggestion_type"]
                conf  = float(s.get("confidence", 0.7))
                reason = s.get("reasoning", "")

                source_data = {}
                if s.get("source_url"):
                    source_data["source_url"] = s["source_url"]
                if s.get("source_title"):
                    source_data["source_title"] = s["source_title"]

                if stype == "field_update":
                    cur.execute("""
                        INSERT INTO cvc.intel_suggestions
                            (company_id, intel_id, suggestion_type, field_name,
                             current_value, suggested_value, suggested_data, confidence, reasoning)
                        VALUES (%s, %s, 'field_update', %s, %s, %s, %s, %s, %s)
                    """, (
                        company_id, intel_id,
                        s.get("field_name"),
                        s.get("current_value"),
                        s.get("suggested_value"),
                        json.dumps(source_data) if source_data else None,
                        conf, reason,
                    ))
                    written += 1

                elif stype == "new_investor":
                    suggested_data = {**(s.get("suggested_data") or {}), **source_data}
                    if suggested_data.get("investor_name"):
                        cur.execute("""
                            INSERT INTO cvc.intel_suggestions
                                (company_id, intel_id, suggestion_type,
                                 suggested_data, confidence, reasoning)
                            VALUES (%s, %s, 'new_investor', %s, %s, %s)
                        """, (
                            company_id, intel_id,
                            json.dumps(suggested_data),
                            conf, reason,
                        ))
                        written += 1

    return written


# ── Main research flow ────────────────────────────────────────────────────────

def _stamp_founder_ran(company_id: int) -> None:
    """Set founder_enriched_at unconditionally — marks the step as attempted even with no findings."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE cvc.companies SET founder_enriched_at = NOW() WHERE id = %s AND founder_enriched_at IS NULL",
                    (company_id,)
                )
    except Exception:
        pass


def run_founder_research(company: Dict[str, Any], known_founders: List[str] = None) -> bool:
    company_id = company["id"]
    name       = company["name"]
    _reset_sources()  # clear URL collector for this run
    logger.info(f"Starting founder research: {name} (id={company_id})")

    # Step 1: discover founders (skip if pre-specified)
    if known_founders:
        founders = [{"name": n.strip(), "role": "Founder", "confidence": 1.0} for n in known_founders if n.strip()]
        logger.info(f"  Using pre-specified founders: {[f['name'] for f in founders]}")
    else:
        logger.info("  Discovering founders...")
        founders = discover_founders(company)
    if not founders:
        logger.warning("  No founders identified — writing empty report to intel")
        report = f"# Founder Research: {name}\n\nNo founders could be identified from available public sources."
        write_intel(company_id, report, [])
        _stamp_founder_ran(company_id)
        return False

    logger.info(f"  Found {len(founders)} founder(s): {[f['name'] for f in founders]}")

    # Step 2: research each founder
    research: Dict[str, str] = {}
    for f in founders:
        fname = f["name"]
        logger.info(f"  Researching: {fname}")
        research[fname] = research_founder(fname, name)
        time.sleep(1)

    # Step 3: synthesize
    report = synthesize_report(company, founders, research)
    if not report:
        logger.warning("  Empty synthesis response — aborting")
        _stamp_founder_ran(company_id)
        return False

    logger.info("  Extracting actionable suggestions...")
    suggestions = extract_suggestions(company, report, sources=_run_sources)

    logger.info("  Extracting structured founder fields...")
    structured = extract_structured_founders(founders, report)
    write_founder_fields(company_id, structured)

    # Step 5: write to DB
    founder_names = [f["name"] for f in founders]
    intel_id      = write_intel(company_id, report, founder_names, sources=_run_sources)
    n_suggestions = write_suggestions(company_id, intel_id, suggestions)

    exits = sum(1 for f in structured for pc in (f.get("prior_companies") or []) if pc.get("exit_type") in ("acquisition", "ipo"))
    logger.info(
        f"  Done. Intel row id={intel_id}, {n_suggestions} suggestion(s), "
        f"{exits} exit(s) found. Founders: {founder_names}"
    )
    _stamp_founder_ran(company_id)
    return True


# ── DB Query ──────────────────────────────────────────────────────────────────

def get_company(company_id: int = None, company_name: str = None) -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if company_id:
                cur.execute("""
                    SELECT id, name, website, one_liner, description, sector,
                           stage, hq_city, country, founded, investors
                    FROM cvc.companies WHERE id = %s
                """, (company_id,))
            else:
                cur.execute("""
                    SELECT id, name, website, one_liner, description, sector,
                           stage, hq_city, country, founded, investors
                    FROM cvc.companies
                    WHERE LOWER(name) LIKE LOWER(%s)
                    LIMIT 1
                """, (f"%{company_name}%",))
            return cur.fetchone()


# ── Entry Point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Founder research enrichment")
    parser.add_argument("--company-id", type=int,  default=None, help="Company ID to research")
    parser.add_argument("--company",    type=str,  default=None, help="Company name to research")
    parser.add_argument("--founders",   type=str,  default=None, help="Comma-separated founder names — skips discovery step")
    args = parser.parse_args()

    if not args.company_id and not args.company:
        parser.error("Must provide --company-id or --company")

    company = get_company(company_id=args.company_id, company_name=args.company)
    if not company:
        logger.error("Company not found")
        sys.exit(1)

    known_founders = [n.strip() for n in args.founders.split(",")] if args.founders else None
    ok = run_founder_research(company, known_founders=known_founders)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
