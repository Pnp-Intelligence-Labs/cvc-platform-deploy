#!/usr/bin/env python3
"""
Enrichment Phase 2 Worker — Pre-Scoring Data Enrichment

Pulls structured data from external sources (USPTO patents, funding structure,
commercial signals) to feed into the scoring rubric.

Run before scoring, or as part of the enrichment pipeline.

Usage:
  PYTHONPATH=/home/nathan11/repos/cvc-intelligence/core OPENROUTER_API_KEY=sk-... \
    python3 workers/enrichment/enrich_phase2.py --limit 50
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus

import requests

from db.connection import get_connection, is_job_enabled
from notifications import write_cron_error

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

PATENTSBASE_URL = "https://patents.google.com/xhr/query"
REFINERY_HOST = "nathan@100.114.250.70"  # Proxy patent requests through Refinery (Dell server IP may be blocked by Google)
TOP_TIER_INVESTORS = [
    "sequoia", "a16z", "andreessen", "benchmark", "accel", "index ventures",
    "lightspeed", "bessemer", "greylock", "kleiner perkins", "kp",
    "founders fund", "union square", "first round", "y combinator",
    "tiger global", "coatue", "insight partners", "general atlantic",
    "softbank", "temasek", "gic", "blackrock"
]

MID_TIER_INVESTORS = [
    "plug and play", "techstars", "500 startups", "sosv", "practica",
    "innovation endeavors", "khosla", "nea", "battery ventures",
    "sapphire ventures", "norwest", "madrona", "canaan"
]


# ── Patent Enrichment ────────────────────────────────────────────────────────

def search_patents(company_name: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Search Google Patents XHR API for patents related to a company.
    
    Tries direct request first. Falls back to SSH proxy through Refinery
    if Google blocks the Droplet IP.
    """
    query_url = f"{PATENTSBASE_URL}?url=assignee%3D{quote_plus(company_name)}&num={limit}&type=PUBLICATION"
    
    try:
        # Try direct first
        resp = requests.get(
            PATENTSBASE_URL,
            params={
                "url": f"assignee%3D{company_name.replace(' ', '+')}",
                "num": str(limit),
                "type": "PUBLICATION"
            },
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json"
            },
            timeout=15
        )
        
        if resp.status_code != 200:
            # Fall back to SSH proxy through Refinery
            logger.info(f"Direct patent search blocked ({resp.status_code}), proxying via Refinery for {company_name}")
            result = subprocess.run(
                [
                    "ssh",
                    "-o",
                    "ConnectTimeout=5",
                    REFINERY_HOST,
                    "curl",
                    "-s",
                    query_url,
                    "-H",
                    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "-H",
                    "Accept: application/json",
                ],
                capture_output=True,
                text=True,
                timeout=20,
            )
            if result.returncode == 0 and result.stdout.strip():
                resp_json = json.loads(result.stdout)
            else:
                logger.warning(f"Patent proxy also failed for {company_name}")
                return []
        else:
            resp_json = resp.json()
        
        patents = []
        for cluster in resp_json.get("results", {}).get("cluster", []):
            for result in cluster.get("result", []):
                p = result.get("patent", {})
                patents.append({
                    "patent_number": p.get("publication_number"),
                    "patent_title": p.get("title"),
                    "patent_date": p.get("grant_date") or p.get("publication_date"),
                    "filing_date": p.get("filing_date"),
                    "assignee": p.get("assignee", "").replace("<b>", "").replace("</b>", ""),
                    "inventor": p.get("inventor"),
                    "cpc_codes": []  # Extracted from summary separately
                })
        
        # Extract CPC codes from summary
        cpc_summary = resp_json.get("results", {}).get("summary", {}).get("cpc", [])
        cpc_codes = [c.get("key") for c in cpc_summary if c.get("key")]
        
        # Attach CPC codes to result for analyze_patents
        return patents, cpc_codes
        
    except Exception as e:
        logger.warning(f"Patent search failed for {company_name}: {e}")
        return []


def analyze_patents(patents: List[Dict], summary_cpc: Optional[List] = None) -> Dict[str, Any]:
    """Analyze patent data and return scoring signals."""
    if not patents:
        return {
            "patent_count": 0,
            "patent_recency": "none",
            "patent_ipc_codes": [],
            "patent_titles": []
        }

    count = len(patents)
    now = datetime.now()
    dates = []
    ipc_codes = set()
    titles = []

    for p in patents:
        date_str = p.get("patent_date")
        if date_str:
            try:
                d = datetime.strptime(date_str, "%Y-%m-%d")
                dates.append(d)
            except ValueError:
                pass
        for code in (p.get("cpc_codes") or []):
            if code:
                ipc_codes.add(str(code))
        title = p.get("patent_title")
        if title:
            titles.append(title)

    # Determine recency
    if dates:
        most_recent = max(dates)
        age_years = (now - most_recent).days / 365.25
        if age_years <= 2:
            recency = "recent"
        elif age_years <= 5:
            recency = "moderate"
        else:
            recency = "old"
    else:
        recency = "none"

    return {
        "patent_count": count,
        "patent_recency": recency,
        "patent_ipc_codes": list(ipc_codes)[:10],
        "patent_titles": titles[:5]
    }


# ── Funding Structure Analysis ───────────────────────────────────────────────

def classify_investor(investor_name: str) -> str:
    """Classify an investor into tiers."""
    name_lower = investor_name.lower()
    for top in TOP_TIER_INVESTORS:
        if top in name_lower:
            return "top_tier"
    for mid in MID_TIER_INVESTORS:
        if mid in name_lower:
            return "mid_tier"
    return "emerging"


def analyze_funding(company: Dict[str, Any]) -> Dict[str, Any]:
    """Analyze funding data and return structured signals."""
    stage = (company.get("stage") or "").lower()
    total_raised = company.get("total_raised_usd") or 0
    employees = company.get("employee_count") or 0
    founded = company.get("founded")

    # Infer number of rounds from stage
    stage_to_rounds = {
        "seed": 1,
        "pre-seed": 1,
        "series a": 2,
        "series b": 3,
        "series c": 4,
        "growth": 5,
        "public": 6
    }
    inferred_rounds = stage_to_rounds.get(stage, 1)

    # Build funding rounds (approximate, based on total and stage)
    rounds = []
    if total_raised > 0 and inferred_rounds > 0:
        # Rough heuristic: later rounds are larger
        if inferred_rounds == 1:
            rounds.append({
                "round_type": stage.capitalize() if stage else "Seed",
                "amount_usd": total_raised,
                "approximate": True
            })
        else:
            remaining = total_raised
            for i in range(inferred_rounds):
                # Each round gets proportionally more
                fraction = (i + 1) / sum(range(1, inferred_rounds + 1))
                amount = round(remaining * fraction)
                round_types = ["Seed", "Series A", "Series B", "Series C", "Growth"]
                rt = round_types[min(i, len(round_types) - 1)]
                rounds.append({
                    "round_type": rt,
                    "amount_usd": amount,
                    "approximate": True
                })

    # Classify investor tier from investors column
    investors = company.get("investors") or []
    investor_tiers = [classify_investor(inv) for inv in investors] if investors else []
    if "top_tier" in investor_tiers:
        investor_tier = "top_tier"
    elif "mid_tier" in investor_tiers:
        investor_tier = "mid_tier"
    elif investors:
        investor_tier = "emerging"
    else:
        investor_tier = "unknown"

    # Capital efficiency analysis
    stage_benchmarks = {
        "seed": {"min": 500000, "max": 5000000, "ideal_employees": 5},
        "series a": {"min": 3000000, "max": 20000000, "ideal_employees": 15},
        "series b": {"min": 10000000, "max": 60000000, "ideal_employees": 40},
        "series c": {"min": 30000000, "max": 150000000, "ideal_employees": 100},
        "growth": {"min": 50000000, "max": 500000000, "ideal_employees": 200},
    }
    benchmark = stage_benchmarks.get(stage, {"min": 0, "max": 999999999, "ideal_employees": 0})

    if total_raised < benchmark["min"] * 0.5:
        capital_status = "undercapitalized"
    elif total_raised > benchmark["max"] * 2:
        capital_status = "overcapitalized"
    else:
        capital_status = "normal"

    # Employee growth proxy (based on current vs. stage expectations)
    if employees > 0 and benchmark["ideal_employees"] > 0:
        emp_ratio = employees / benchmark["ideal_employees"]
        if emp_ratio > 3:
            growth_signal = "high_growth"
        elif emp_ratio > 1:
            growth_signal = "on_track"
        else:
            growth_signal = "early"
    else:
        growth_signal = "unknown"

    return {
        "funding_rounds": rounds,
        "total_raised_usd": total_raised,
        "investor_tier": investor_tier,
        "lead_investors": investors[:5] if investors else [],
        "capital_status": capital_status,
        "growth_signal": growth_signal,
        "inferred_rounds": inferred_rounds
    }


# ── Commercial Signal Detection ──────────────────────────────────────────────

def detect_commercial_signals(company: Dict[str, Any]) -> Dict[str, Any]:
    """Detect commercial traction signals from available data."""
    desc = (company.get("description") or "").lower()
    one_liner = (company.get("one_liner") or "").lower()
    sector = (company.get("sector") or "").lower()
    stage = (company.get("stage") or "").lower()
    employees = company.get("employee_count") or 0
    total_raised = company.get("total_raised_usd") or 0
    founded = company.get("founded")

    text = f"{desc} {one_liner}"

    # Enterprise customer signals
    enterprise_keywords = [
        "enterprise", "fortune 500", "corporate", "f500", "partner",
        "deployed", "production", "customer", "clients", "users",
        "revenue", "sales", "contract", "agreement", "platform"
    ]
    enterprise_score = sum(1 for kw in enterprise_keywords if kw in text)

    # Product availability signals
    product_keywords = [
        "saas", "api", "platform", "software", "service", "subscription",
        "available", "launched", "deployed", "production", "commercial"
    ]
    product_score = sum(1 for kw in product_keywords if kw in text)

    # Research/academic signals (negative for commercial)
    research_keywords = [
        "research", "laboratory", "university", "academic", "paper",
        "study", "prototype", "proof of concept", "poc", "experiment"
    ]
    research_score = sum(1 for kw in research_keywords if kw in text)

    # B2B indicators
    b2b_keywords = [
        "b2b", "enterprise", "corporate", "business", "industrial",
        "manufacturing", "logistics", "supply chain", "warehouse",
        "factory", "operations", "workflow"
    ]
    b2b_score = sum(1 for kw in b2b_keywords if kw in text)

    # Has enterprise customers?
    has_enterprise = enterprise_score >= 2 or (stage in ["series b", "series c", "growth"] and employees > 50)

    # Product available?
    product_available = product_score >= 2 or stage not in ["pre-seed", "seed"]

    # Revenue evidence
    if total_raised > 100000000 and employees > 100:
        revenue_evidence = "strong"
    elif stage in ["series b", "series c", "growth"]:
        revenue_evidence = "moderate"
    elif stage == "series a" and employees > 20:
        revenue_evidence = "emerging"
    else:
        revenue_evidence = "minimal"

    # Enterprise deployment?
    enterprise_deployment = has_enterprise and stage in ["series b", "series c", "growth"]

    # Age factor
    if founded:
        age = datetime.now(timezone.utc).year - founded
    else:
        age = 0

    return {
        "has_enterprise_customers": has_enterprise,
        "enterprise_deployment": enterprise_deployment,
        "product_available": product_available,
        "revenue_evidence": revenue_evidence,
        "b2b_focus": b2b_score >= 2,
        "research_heavy": research_score > enterprise_score,
        "enterprise_keyword_score": enterprise_score,
        "product_keyword_score": product_score,
        "research_keyword_score": research_score,
        "b2b_keyword_score": b2b_score,
        "company_age_years": age,
        "employee_count": employees,
        "total_raised_usd": total_raised
    }


# ── Main Enrichment Pipeline ─────────────────────────────────────────────────

def enrich_company(company: Dict[str, Any]) -> Dict[str, Any]:
    """Run full phase 2 enrichment on a single company."""
    company_id = company["company_id"]
    name = company["name"]

    logger.info(f"Phase 2 enriching: {name} (ID: {company_id})")

    # 1. Patent enrichment
    patent_result = search_patents(name)
    if isinstance(patent_result, tuple):
        patents, cpc_codes = patent_result
    else:
        patents = patent_result
        cpc_codes = []

    patent_signals = analyze_patents(patents)
    # Add CPC codes from summary if available
    if cpc_codes and not patent_signals["patent_ipc_codes"]:
        patent_signals["patent_ipc_codes"] = cpc_codes[:10]

    time.sleep(1)  # Rate limit between companies

    # 2. Funding structure analysis
    funding_signals = analyze_funding(company)

    # 3. Commercial signal detection
    commercial_signals = detect_commercial_signals(company)

    # 4. Combine all signals
    scoring_data = {
        "patents": patent_signals,
        "funding": funding_signals,
        "commercial": commercial_signals,
        "enriched_at": datetime.now(timezone.utc).isoformat()
    }

    return {
        "company_id": company_id,
        "patent_count": patent_signals["patent_count"],
        "patent_recency": patent_signals["patent_recency"],
        "patent_ipc_codes": patent_signals["patent_ipc_codes"],
        "funding_rounds": funding_signals["funding_rounds"],
        "lead_investors": funding_signals["lead_investors"],
        "investor_tier": funding_signals["investor_tier"],
        "commercial_signals": commercial_signals,
        "scoring_data": scoring_data
    }


def save_enrichment(company_id: int, data: Dict[str, Any]) -> bool:
    """Save enrichment results to database."""
    query = """
    UPDATE cvc.companies
    SET
        patent_count = %s,
        patent_recency = %s,
        patent_ipc_codes = %s,
        funding_rounds = %s::jsonb,
        lead_investors = %s,
        investor_tier = %s,
        commercial_signals = %s::jsonb,
        scoring_data = %s::jsonb,
        phase2_enriched_at = NOW()
    WHERE id = %s
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (
                    data["patent_count"],
                    data["patent_recency"],
                    data["patent_ipc_codes"],
                    json.dumps(data["funding_rounds"]),
                    data["lead_investors"],
                    data["investor_tier"],
                    json.dumps(data["commercial_signals"]),
                    json.dumps(data["scoring_data"]),
                    company_id
                ))
                conn.commit()
                return True
    except Exception as e:
        logger.error(f"Failed to save enrichment for company {company_id}: {e}")
        return False


def get_companies_to_enrich(limit: int) -> List[Dict[str, Any]]:
    """Fetch companies that need phase 2 enrichment."""
    query = """
    SELECT
        id as company_id,
        name,
        one_liner,
        description,
        sector,
        stage,
        employee_count,
        total_raised_usd,
        founded,
        country,
        hq_city,
        website,
        investors,
        enrichment_status
    FROM cvc.companies
    WHERE enrichment_status IN ('enriched', 'auto_filled')
    AND phase2_enriched_at IS NULL
    ORDER BY
        CASE WHEN score_composite IS NULL THEN 0 ELSE 1 END,
        total_raised_usd DESC NULLS LAST
    LIMIT %s
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (limit,))
            return cur.fetchall()


def main():
    if not is_job_enabled("Company Enrichment — Phase 2"):
        print("Job disabled in scheduler — exiting")
        sys.exit(0)

    parser = argparse.ArgumentParser(description='Phase 2 enrichment — pre-scoring data enrichment')
    parser.add_argument('--limit', type=int, default=50, help='Max companies to enrich (default: 50)')
    parser.add_argument('--status', action='store_true', help='Show enrichment status and exit')
    args = parser.parse_args()

    if args.status:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        enrichment_status,
                        COUNT(*) as total,
                        COUNT(phase2_enriched_at) as phase2_done,
                        COUNT(*) FILTER(WHERE phase2_enriched_at IS NULL) as phase2_pending
                    FROM cvc.companies
                    WHERE enrichment_status IN ('enriched', 'auto_filled')
                    GROUP BY enrichment_status
                """)
                for row in cur.fetchall():
                    logger.info(f"{row['enrichment_status']}: {row['total']} total, {row['phase2_done']} phase2 done, {row['phase2_pending']} pending")
        return

    try:
        companies = get_companies_to_enrich(args.limit)
        if not companies:
            logger.info("No companies need phase 2 enrichment.")
            return

        logger.info(f"Phase 2 enriching {len(companies)} companies...")

        success = 0
        failed = 0
        for i, company in enumerate(companies, 1):
            logger.info(f"[{i}/{len(companies)}] {company['name']}...")

            try:
                data = enrich_company(company)
                if save_enrichment(company['company_id'], data):
                    success += 1
                    logger.info(f"  ✓ Patents: {data['patent_count']}, Investor tier: {data['investor_tier']}, Revenue: {data['commercial_signals']['revenue_evidence']}")
                else:
                    failed += 1
            except Exception as e:
                logger.error(f"  ✗ Failed: {e}")
                failed += 1

            # Progress checkpoint every 10
            if i % 10 == 0:
                logger.info(f"Progress: {i}/{len(companies)} ({success} success, {failed} failed)")

        logger.info(f"\nPhase 2 complete: {success} enriched, {failed} failed out of {len(companies)}")

    except Exception as e:
        logger.error(f"Fatal error in Phase 2 enrichment worker: {e}")
        write_cron_error("Company Enrichment — Phase 2", str(e), source="enrich_phase2")
        sys.exit(1)


if __name__ == '__main__':
    main()
