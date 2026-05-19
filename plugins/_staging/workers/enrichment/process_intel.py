"""
Intel processing worker — reads unprocessed company_intel rows, extracts structured
signals via LLM, and writes suggestions to cvc.intel_suggestions.

Workers call this; it can also be triggered manually or via API.

Usage (on Dell server):
    cd /home/nathan11/repos/cvc-intelligence
    PYTHONPATH=core python3 workers/enrichment/process_intel.py
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone

from db.connection import get_connection
from llm.openrouter import call as llm_call

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("process_intel")

MODEL = "qwen/qwen3-235b-a22b-2507"

SYSTEM_PROMPT = """You are an investment data analyst for Claw Venture Capital.
You are given a company's current profile and a piece of analyst-uploaded intelligence.
Your job is to extract structured, actionable suggestions for what should be updated.

Rules:
- Only suggest changes you are confident the intel actually supports
- Confidence: 0.0–1.0. Be conservative — 0.9+ means you are certain from explicit text
- Do not suggest changes the intel does not directly support
- For funding rounds: only suggest if the intel explicitly states an amount, round type, or close date
- Return valid JSON only, no markdown fences
"""

EXTRACT_PROMPT = """Current company profile:
{profile}

Analyst-uploaded intel:
  Type: {intel_type}
  Description: {label}
{intent_directive}Content:
{content}

Extract suggestions as a JSON array. Each suggestion must have:
  "suggestion_type": "new_funding_round" | "field_update" | "new_investor" | "new_case_study" | "new_commercial_deployment"
  "confidence": float 0.0–1.0
  "reasoning": one sentence explaining what in the intel supports this

IMPORTANT — sources: Every suggestion must include "suggested_data" with a "sources" field:
  "sources": list of URLs extracted verbatim from the intel content that directly support this suggestion.
  If the intel itself IS a URL (intel_type="url"), include that URL in sources.
  If the intel is a document or paste with no extractable URLs, use an empty list [].
  Never fabricate URLs.

For "new_funding_round", include in "suggested_data":
  "round_type": string,
  "amount_usd": integer or null,
  "announced_date": "YYYY-MM-DD" or null,
  "investors": [list of strings],
  "source_url": first URL from sources or null,
  "sources": [list of URLs]

For "field_update", include:
  "field_name": one of [stage, one_liner, hq_city, country, employee_count, website]
  "current_value": string (current value from profile, or null)
  "suggested_value": string
  "suggested_data": {{"sources": [list of URLs]}}

For "new_investor", include:
  "suggested_value": investor name to add
  "suggested_data": {{"sources": [list of URLs]}}

For "new_case_study", include in "suggested_data":
  "title": string — one-line description of the deployment or case study
  "customer_name": string or null — customer or partner name if mentioned
  "snippet": string — 1-2 sentence excerpt from the intel describing the deployment
  "sources": [list of URLs — required, must not be empty if intel has a URL]

For "new_commercial_deployment", include in "suggested_data":
  "customer_name": string — customer name (use "Undisclosed" if confidential)
  "deployment_type": one of "Paid Pilot" | "Commercial Deployment" | "Enterprise" | "Government Contract"
  "contract_value_usd": integer or null
  "start_date": "YYYY-MM-DD" or null
  "stealth": true if customer anonymity is indicated, false otherwise
  "notes": string or null — any additional context
  "sources": [list of URLs — required, must not be empty if intel has a URL]

If no suggestions can be confidently extracted, return [].
"""

INTENT_DIRECTIVES = {
    "funding": (
        "Analyst intent: FUNDING ROUND — Focus primarily on extracting funding round data. "
        "Look for round type, amount raised, close date, and lead investors. "
        "Prioritize 'new_funding_round' suggestions.\n"
    ),
    "commercial_deployment": (
        "Analyst intent: COMMERCIAL DEPLOYMENT — Focus on customer contracts, paid pilots, "
        "enterprise deals, government contracts, or partnership announcements. "
        "Prefer 'new_commercial_deployment' and 'new_case_study' suggestion types. "
        "Also extract 'field_update' if stage or one_liner should change.\n"
    ),
    "team": (
        "Analyst intent: TEAM / LEADERSHIP — Focus on leadership changes, new hires, "
        "headcount updates, or founder background. Extract as 'field_update' suggestions.\n"
    ),
    "product": (
        "Analyst intent: PRODUCT / TECH — Focus on product launches, technical milestones, "
        "IP filings, or capability announcements. Extract as 'field_update' for one_liner or stage.\n"
    ),
    "press": (
        "Analyst intent: PRESS / NEWS — Extract any factual updates about the company that "
        "differ from the current profile. Apply broad extraction across all suggestion types.\n"
    ),
}


def build_profile_summary(company: dict, existing_rounds: list) -> str:
    rounds_text = ""
    if existing_rounds:
        lines = []
        for r in existing_rounds:
            amt = f"${r['amount_usd']:,}" if r.get("amount_usd") else "Undisclosed"
            date = r.get("announced_date") or "date unknown"
            approx = " (approximate)" if r.get("approximate") else ""
            lines.append(f"  - {r['round_type']}: {amt}, {date}{approx}")
        rounds_text = "Known funding rounds:\n" + "\n".join(lines)
    else:
        rounds_text = "Known funding rounds: none on record"

    investors = ", ".join(company.get("investors") or []) or "none on record"
    return f"""Company: {company['name']}
Stage: {company.get('stage') or 'unknown'}
Sector: {company.get('sector') or 'unknown'}
HQ: {company.get('hq_city') or '?'}, {company.get('country') or '?'}
Employees: {company.get('employee_count') or 'unknown'}
One-liner: {company.get('one_liner') or 'none'}
Investors: {investors}
{rounds_text}
"""


def process_item(intel_item: dict) -> int:
    """Process one intel item. Returns number of suggestions created."""
    company_id = intel_item["company_id"]
    intel_id   = intel_item["id"]
    intel_type = intel_item["intel_type"]
    label      = intel_item["label"] or ""
    raw_text   = intel_item["raw_text"] or ""
    intent     = intel_item.get("intent") or []

    if not raw_text.strip():
        log.warning(f"Intel {intel_id}: no raw_text — skipping")
        return 0

    # Build intent directive string from analyst-specified tags
    intent_directive = ""
    for tag in intent:
        directive = INTENT_DIRECTIVES.get(tag)
        if directive:
            intent_directive = directive
            break  # Use the first matching intent

    # Truncate to avoid token waste
    content = raw_text[:6000]

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Fetch company profile
            cur.execute("""
                SELECT id, name, stage, sector, one_liner, hq_city, country,
                       employee_count, website, investors
                FROM cvc.companies WHERE id = %s
            """, (company_id,))
            company = cur.fetchone()
            if not company:
                log.warning(f"Intel {intel_id}: company {company_id} not found")
                return 0

            # Fetch existing funding rounds
            cur.execute("""
                SELECT round_type, amount_usd, announced_date, approximate
                FROM cvc.funding_rounds
                WHERE company_id = %s
                ORDER BY announced_date DESC NULLS LAST
            """, (company_id,))
            existing_rounds = [dict(r) for r in cur.fetchall()]

    profile_summary = build_profile_summary(dict(company), existing_rounds)

    prompt = EXTRACT_PROMPT.format(
        profile=profile_summary,
        intel_type=intel_type,
        label=label,
        intent_directive=intent_directive,
        content=content,
    )

    full_prompt = SYSTEM_PROMPT + "\n\n" + prompt
    try:
        raw = llm_call(
            prompt=full_prompt,
            model=MODEL,
            temperature=0.1,
            max_tokens=2000,
            activity="Intel Processing",
        )
    except Exception as e:
        log.error(f"Intel {intel_id}: LLM call failed: {e}")
        return 0

    # Strip markdown fences if present
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]

    try:
        suggestions = json.loads(raw.strip())
    except json.JSONDecodeError as e:
        log.warning(f"Intel {intel_id}: JSON parse failed: {e} | raw: {raw[:200]}")
        return 0

    if not isinstance(suggestions, list):
        log.warning(f"Intel {intel_id}: LLM returned non-list")
        return 0

    if not suggestions:
        log.info(f"Intel {intel_id}: LLM found no suggestions")
        return 0

    count = 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            for s in suggestions:
                stype      = s.get("suggestion_type")
                confidence = float(s.get("confidence", 0))
                reasoning  = s.get("reasoning", "")

                if stype not in ("new_funding_round", "field_update", "new_investor",
                                 "new_case_study", "new_commercial_deployment"):
                    continue
                if not (0.0 <= confidence <= 1.0):
                    continue

                field_name      = s.get("field_name")
                current_value   = s.get("current_value")
                suggested_value = s.get("suggested_value")
                suggested_data  = s.get("suggested_data")

                # Skip duplicates: same company + type + key data already pending
                if stype == "new_funding_round" and suggested_data:
                    cur.execute("""
                        SELECT id FROM cvc.intel_suggestions
                        WHERE company_id = %s
                          AND suggestion_type = 'new_funding_round'
                          AND status = 'pending'
                          AND suggested_data->>'round_type' = %s
                    """, (company_id, suggested_data.get("round_type")))
                    if cur.fetchone():
                        log.info(f"  Skipping duplicate pending round: {suggested_data.get('round_type')}")
                        continue

                cur.execute("""
                    INSERT INTO cvc.intel_suggestions
                        (company_id, intel_id, suggestion_type, field_name,
                         current_value, suggested_value, suggested_data,
                         confidence, reasoning)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    company_id,
                    intel_id,
                    stype,
                    field_name,
                    str(current_value) if current_value is not None else None,
                    str(suggested_value) if suggested_value is not None else None,
                    json.dumps(suggested_data) if suggested_data else None,
                    round(confidence, 3),
                    reasoning,
                ))
                count += 1

            # Mark intel as processed
            cur.execute("""
                UPDATE cvc.company_intel SET processed = TRUE WHERE id = %s
            """, (intel_id,))
            conn.commit()

    log.info(f"Intel {intel_id} ({label}): {count} suggestions created")
    return count


def run():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, company_id, intel_type, label, source_url,
                       raw_text, uploaded_at, intent
                FROM cvc.company_intel
                WHERE processed = FALSE
                ORDER BY uploaded_at ASC
            """)
            items = [dict(r) for r in cur.fetchall()]

    if not items:
        log.info("No unprocessed intel — nothing to do")
        return

    log.info(f"Processing {len(items)} intel item(s)")
    total = 0
    for item in items:
        try:
            total += process_item(item)
        except Exception as e:
            log.error(f"Intel {item['id']}: unexpected error: {e}", exc_info=True)

    log.info(f"Done. {total} total suggestions created.")


if __name__ == "__main__":
    run()
