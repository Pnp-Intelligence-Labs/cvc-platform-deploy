import os
import json
import logging
from typing import List, Dict, Any
from core.db.connection import get_connection
from psycopg2.extras import RealDictCursor, Json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def process_intel_step_4(company_id: str):
    """
    Step 4: Populate company_intel.score_impact with suggested score field changes 
    based on extracted signals from step 3.
    """
    logger.info(f"Processing intel step 4 for company {company_id}")
    
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM cvc.content_items 
                WHERE company_id = %s AND signal_type IS NOT NULL
                ORDER BY published_at DESC
            """, (company_id,))
            signals = cur.fetchall()
            
            cur.execute("""
                SELECT score_commercial, score_technical, score_market_timing,
                       score_partner_fit, score_capital_eff, score_irs, score_sri, score_tdf
                FROM cvc.companies WHERE id = %s
            """, (company_id,))
            company = cur.fetchone()
            
            if not company:
                logger.warning(f"Company {company_id} not found")
                return
            
            suggestions = []
            
            for signal in signals:
                signal_type = (signal.get("signal_type") or "").lower()
                summary = (signal.get("summary") or "").lower()
                title = signal.get("title", "")
                signal_id = signal["id"]
                
                if any(kw in signal_type or kw in summary for kw in ["partnership", "partner", "collaboration"]):
                    current = company.get("score_partner_fit")
                    if current is not None and current < 95:
                        suggestions.append({
                            "field": "score_partner_fit",
                            "current_value": current,
                            "suggested_value": min(100, current + 5),
                            "reason": f"Partnership signal detected: {title}",
                            "signal_ids": [signal_id]
                        })
                
                if any(kw in signal_type or kw in summary for kw in ["funding", "raised", "investment", "series"]):
                    current = company.get("score_capital_eff")
                    if current is not None and current < 95:
                        suggestions.append({
                            "field": "score_capital_eff",
                            "current_value": current,
                            "suggested_value": min(100, current + 3),
                            "reason": f"Funding event indicates capital efficiency: {title}",
                            "signal_ids": [signal_id]
                        })
                
                if any(kw in signal_type or kw in summary for kw in ["commercial", "revenue", "customer", "deal", "contract"]):
                    current = company.get("score_commercial")
                    if current is not None and current < 95:
                        suggestions.append({
                            "field": "score_commercial",
                            "current_value": current,
                            "suggested_value": min(100, current + 5),
                            "reason": f"Commercial traction signal: {title}",
                            "signal_ids": [signal_id]
                        })
                
                if any(kw in signal_type or kw in summary for kw in ["technical", "patent", "innovation", "breakthrough"]):
                    current = company.get("score_technical")
                    if current is not None and current < 95:
                        suggestions.append({
                            "field": "score_technical",
                            "current_value": current,
                            "suggested_value": min(100, current + 4),
                            "reason": f"Technical innovation signal: {title}",
                            "signal_ids": [signal_id]
                        })
                
                if any(kw in signal_type or kw in summary for kw in ["market", "growth", "expansion", "timing"]):
                    current = company.get("score_market_timing")
                    if current is not None and current < 95:
                        suggestions.append({
                            "field": "score_market_timing",
                            "current_value": current,
                            "suggested_value": min(100, current + 4),
                            "reason": f"Market timing signal: {title}",
                            "signal_ids": [signal_id]
                        })
            
            for sugg in suggestions:
                cur.execute("""
                    INSERT INTO cvc.score_suggestions 
                    (company_id, field_name, current_value, suggested_value, reason, signal_ids)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (
                    company_id, 
                    sugg["field"], 
                    sugg["current_value"], 
                    sugg["suggested_value"], 
                    sugg["reason"],
                    sugg["signal_ids"]
                ))
            
            cur.execute("""
                INSERT INTO cvc.company_intel (company_id, score_impact, last_analyzed_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (company_id) 
                DO UPDATE SET score_impact = EXCLUDED.score_impact, 
                             last_analyzed_at = NOW()
            """, (company_id, Json(suggestions)))
            
            conn.commit()
            logger.info(f"Generated {len(suggestions)} score suggestions for company {company_id}")


def run_intel_pipeline(company_id: str):
    """Run full intel pipeline steps 4-5 for a company"""
    process_intel_step_4(company_id)


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        run_intel_pipeline(sys.argv[1])
