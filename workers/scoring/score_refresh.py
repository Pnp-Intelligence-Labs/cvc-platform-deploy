#!/usr/bin/env python3
"""
Company Scoring Refresh Worker

Recalculates composite scores for companies in cvc.companies that have
enrichment_status=enriched but score_composite IS NULL, or scored_at < NOW()-90days.

Uses 5-dimension scoring model:
- Commercial Velocity (30%)
- Technical Maturity (25%)
- Market Timing (20%)
- Partner Fit (15%)
- Capital Efficiency (10%)
"""

import argparse
import json
import sys
from typing import Optional, Dict, Any, List

from db.connection import get_connection, is_job_enabled
from llm.openrouter import call as llm_call
from notifications import write_cron_error

# Scoring weights
WEIGHTS = {
    'commercial': 0.30,
    'technical': 0.25,
    'market_timing': 0.20,
    'partner_fit': 0.15,
    'capital_eff': 0.10
}

MODEL = "qwen/qwen3-235b-a22b-2507"

SCORING_PROMPT_TEMPLATE = """You are a venture capital analyst evaluating a startup for corporate partnership potential.

Company Information:
- Name: {name}
- One Liner: {one_liner}
- Description: {description}
- Sector: {sector}
- Stage: {stage}
- Employee Count: {employee_count}
- Total Raised (USD): {total_raised_usd}
- Founded: {founded}
- Country: {country}

Score this company on 5 dimensions (0-100 scale):

1. Commercial Velocity (30% weight): Signs of real revenue, deployments, enterprise customers. Look for evidence of actual commercial traction, paying customers, and revenue growth.

2. Technical Maturity (25% weight): Product is production-ready, not research. Evaluate if the technology is deployable at scale, has been tested in real environments, and is beyond prototype/PoC stage.

3. Market Timing (20% weight): Sector is hot now, company is positioned for tailwinds. Consider current market conditions, sector growth trends, and whether the company is well-positioned to capitalize on emerging opportunities.

4. Partner Fit (15% weight): Relevant to Fortune 500 corporate innovation (manufacturing, logistics, warehousing). Assess how well this company aligns with the innovation needs of large industrial and logistics corporations.

5. Capital Efficiency (10% weight): Stage-appropriate funding, not over-capitalized. Evaluate if the company has raised reasonable amounts for its stage and traction, showing capital discipline.

Return ONLY a JSON object with this exact structure:
{{
  "score_commercial": <int 0-100>,
  "score_technical": <int 0-100>,
  "score_market_timing": <int 0-100>,
  "score_partner_fit": <int 0-100>,
  "score_capital_eff": <int 0-100>,
  "reasoning": "<brief explanation of the scores>"
}}

Do not include any other text outside the JSON object."""


def get_companies_to_score(limit: int) -> List[Dict[str, Any]]:
    """Fetch companies that need scoring."""
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
        country
    FROM cvc.companies
    WHERE enrichment_status = 'enriched'
    AND (
        score_composite IS NULL 
        OR scored_at < NOW() - INTERVAL '90 days'
    )
    ORDER BY 
        CASE WHEN score_composite IS NULL THEN 0 ELSE 1 END,
        scored_at ASC NULLS FIRST
    LIMIT %s
    """
    
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (limit,))
            return cur.fetchall()


def score_company(company: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Score a single company using LLM."""
    prompt = SCORING_PROMPT_TEMPLATE.format(
        name=company['name'] or 'Unknown',
        one_liner=company['one_liner'] or '',
        description=company['description'] or '',
        sector=company['sector'] or 'Unknown',
        stage=company['stage'] or 'Unknown',
        employee_count=company['employee_count'] if company['employee_count'] is not None else 'Unknown',
        total_raised_usd=company['total_raised_usd'] if company['total_raised_usd'] is not None else 0,
        founded=company['founded'] if company['founded'] is not None else 'Unknown',
        country=company['country'] or 'Unknown'
    )
    
    try:
        response = llm_call(
            model=MODEL,
            prompt=prompt,
            temperature=0.1,
            max_tokens=1000,
            activity="Score Refresh",
        )
        
        # Parse JSON response
        content = response.strip()
        if content.startswith('```json'):
            content = content[7:]
        if content.startswith('```'):
            content = content[3:]
        if content.endswith('```'):
            content = content[:-3]
        content = content.strip()
        
        scores = json.loads(content)
        
        # Validate required fields
        required_fields = [
            'score_commercial', 'score_technical', 'score_market_timing',
            'score_partner_fit', 'score_capital_eff', 'reasoning'
        ]
        
        for field in required_fields:
            if field not in scores:
                raise ValueError(f"Missing required field: {field}")
        
        # Ensure scores are integers 0-100
        for field in required_fields[:-1]:  # Exclude reasoning
            score = int(scores[field])
            if not 0 <= score <= 100:
                raise ValueError(f"Score {field} out of range: {score}")
            scores[field] = score
        
        # Calculate composite score
        composite = (
            WEIGHTS['commercial'] * scores['score_commercial'] +
            WEIGHTS['technical'] * scores['score_technical'] +
            WEIGHTS['market_timing'] * scores['score_market_timing'] +
            WEIGHTS['partner_fit'] * scores['score_partner_fit'] +
            WEIGHTS['capital_eff'] * scores['score_capital_eff']
        )
        scores['score_composite'] = round(composite, 2)
        
        return scores
        
    except Exception as e:
        print(f"Error scoring company {company['company_id']} ({company['name']}): {e}", file=sys.stderr)
        return None


def update_company_scores(company_id: int, scores: Dict[str, Any]) -> bool:
    """Update company record with new scores."""
    query = """
    UPDATE cvc.companies 
    SET 
        score_commercial = %s,
        score_technical = %s,
        score_market_timing = %s,
        score_partner_fit = %s,
        score_capital_eff = %s,
        score_composite = %s,
        scored_at = NOW()
    WHERE id = %s
    """
    
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (
                    scores['score_commercial'],
                    scores['score_technical'],
                    scores['score_market_timing'],
                    scores['score_partner_fit'],
                    scores['score_capital_eff'],
                    scores['score_composite'],
                    company_id
                ))
                conn.commit()
                return True
    except Exception as e:
        print(f"Error updating company {company_id}: {e}", file=sys.stderr)
        return False


def main():
    if not is_job_enabled("Scoring Refresh"):
        print("Job disabled in scheduler — exiting")
        sys.exit(0)

    parser = argparse.ArgumentParser(description='Refresh company scores')
    parser.add_argument('--limit', type=int, default=25, help='Maximum companies to score (default: 25)')
    args = parser.parse_args()

    try:
        print(f"Fetching up to {args.limit} companies to score...")
        companies = get_companies_to_score(args.limit)

        if not companies:
            print("No companies need scoring.")
            return

        print(f"Found {len(companies)} companies to score.")

        scored_companies = []
        failed_count = 0

        for i, company in enumerate(companies, 1):
            print(f"[{i}/{len(companies)}] Scoring: {company['name']}...")

            scores = score_company(company)
            if scores is None:
                failed_count += 1
                continue

            success = update_company_scores(company['company_id'], scores)
            if success:
                scored_companies.append({
                    'company_id': company['company_id'],
                    'name': company['name'],
                    'composite': scores['score_composite'],
                    'scores': scores
                })
                print(f"  -> Composite: {scores['score_composite']}")
            else:
                failed_count += 1

        # Print summary
        print(f"\n{len(scored_companies)} companies scored, avg composite score: ", end="")

        if scored_companies:
            avg_score = sum(c['composite'] for c in scored_companies) / len(scored_companies)
            print(f"{avg_score:.2f}")

            # Top 5 by score
            top_5 = sorted(scored_companies, key=lambda x: x['composite'], reverse=True)[:5]
            print("\nTop 5 by score:")
            for i, c in enumerate(top_5, 1):
                print(f"  {i}. {c['name']} - {c['composite']}")
        else:
            print("N/A (no successful scores)")

    except Exception as e:
        print(f"Fatal error in scoring worker: {e}")
        write_cron_error("Scoring Refresh", str(e), source="score_refresh")
        sys.exit(1)


if __name__ == '__main__':
    main()
