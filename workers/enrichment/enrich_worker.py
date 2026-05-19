#!/usr/bin/env python3
"""
Company Enrichment Worker
Finds pending companies and enriches missing fields using LLM + web context.
"""

import argparse
import json
import sys
import logging
from typing import Optional, Dict, Any, List

from db.connection import get_connection, is_job_enabled
from llm.openrouter import call as llm_call
from job_logger import start_job, finish_job
from notifications import write_cron_error

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

VALID_SECTORS = ["Robotics", "Supply Chain", "Industrial Automation", "Physical AI", "Other"]
VALID_STAGES = ["Seed", "Series A", "Series B", "Series C", "Growth", "Public"]
MODEL_NAME = "qwen/qwen3-235b-a22b-2507"


def build_prompt(company: Dict[str, Any]) -> str:
    """Build enrichment prompt for a company."""
    fields = []
    
    if company.get('name'):
        fields.append(f"Company Name: {company['name']}")
    if company.get('website'):
        fields.append(f"Website: {company['website']}")
    if company.get('one_liner'):
        fields.append(f"One Liner: {company['one_liner']}")
    if company.get('description'):
        fields.append(f"Description: {company['description']}")
    if company.get('sector'):
        fields.append(f"Current Sector: {company['sector']}")
    if company.get('stage'):
        fields.append(f"Current Stage: {company['stage']}")
    if company.get('hq_city'):
        fields.append(f"Current HQ City: {company['hq_city']}")
    if company.get('country'):
        fields.append(f"Current Country: {company['country']}")
    if company.get('employee_count'):
        fields.append(f"Current Employee Count: {company['employee_count']}")
    if company.get('founded'):
        fields.append(f"Current Founded Year: {company['founded']}")
    
    existing_info = "\n".join(fields) if fields else "No existing information."
    
    prompt = f"""You are a company data enrichment assistant for Claw Venture Capital (CVC), a pre-seed to Series A fund focused on supply chain, industrials, and robotics.

Existing Information:
{existing_info}

Task: Infer and fill missing values. Return valid JSON with only the fields that are missing or need correction.

SECTOR CLASSIFICATION RULES (5 approved sectors):
Use this priority hierarchy when a company fits multiple sectors:
1. Physical AI — if the core innovation is a neural network, foundation model, or vision system that can be applied across machines/embodiments. "The brain" over "the body."
2. Robotics — if the company builds physical machines with mechanical actuators, cobots, drones, or end-effectors that move. "Has a body and moves."
3. Supply Chain — if the value is in movement of goods between locations: fleet management, last-mile, freight, warehousing, 3PL. Applies outside factory walls.
4. Industrial Automation — if it is a software/sensor layer that improves efficiency of existing production lines (PLC software, SCADA, legacy integration). Does not create new machines.
5. Manufacturing — if it is about creating a physical product or material: 3D printing, CNC, digital twins, chemicals, materials science.

Assign:
- sector: primary sector (one of the 5 above, or "Other" if truly none fit)
- secondary_sector: second-best sector if the company meaningfully spans two (e.g. a robotic arm company with its own foundation model gets Robotics primary, Physical AI secondary). Omit if clearly one sector.
- sector_confidence: integer 1–100 reflecting certainty in the primary sector assignment
- sector_rationale: one sentence explaining the primary sector choice and any tie-breaker applied

Fields to infer:
- sector, secondary_sector, sector_confidence, sector_rationale (always assign these)
- stage: one of: Seed, Series A, Series B, Series C, Growth, Public
- hq_city, country, employee_count (integer), founded (4-digit year)
- one_liner: one sentence description (if missing or poor quality)

Return ONLY a JSON object with fields to update. Example:
{{"sector": "Robotics", "secondary_sector": "Physical AI", "sector_confidence": 82, "sector_rationale": "Builds physical AMRs (Robotics) but its navigation stack is a transferable foundation model (Physical AI secondary).", "stage": "Series A", "hq_city": "San Francisco", "country": "USA", "employee_count": 50, "founded": 2020, "one_liner": "Builds autonomous warehouse robots powered by a generalist navigation model."}}

JSON Response:"""
    
    return prompt


def parse_enrichment_response(response: str) -> Dict[str, Any]:
    """Parse LLM response to extract JSON fields."""
    try:
        response = response.strip()
        if "```json" in response:
            start = response.find("```json") + 7
            end = response.find("```", start)
            response = response[start:end].strip()
        elif "```" in response:
            start = response.find("```") + 3
            end = response.find("```", start)
            response = response[start:end].strip()
        
        data = json.loads(response)
        
        result = {}
        
        if 'sector' in data:
            sector = data['sector']
            if sector in VALID_SECTORS:
                result['sector'] = sector
            else:
                result['sector'] = 'Other'

        if 'secondary_sector' in data and data['secondary_sector']:
            sec = data['secondary_sector']
            result['secondary_sector'] = sec if sec in VALID_SECTORS else None

        if 'sector_confidence' in data:
            try:
                conf = int(data['sector_confidence'])
                if 1 <= conf <= 100:
                    result['sector_confidence'] = conf
            except (ValueError, TypeError):
                pass

        if 'sector_rationale' in data and data['sector_rationale']:
            result['sector_rationale'] = str(data['sector_rationale']).strip()[:500]
                
        if 'stage' in data and data['stage'] in VALID_STAGES:
            result['stage'] = data['stage']
            
        if 'hq_city' in data and data['hq_city']:
            result['hq_city'] = str(data['hq_city'])
            
        if 'country' in data and data['country']:
            result['country'] = str(data['country'])
            
        if 'employee_count' in data:
            try:
                result['employee_count'] = int(data['employee_count'])
            except (ValueError, TypeError):
                pass
                
        if 'founded' in data:
            try:
                year = int(data['founded'])
                if 1800 <= year <= 2030:
                    result['founded'] = year
            except (ValueError, TypeError):
                pass
                
        if 'one_liner' in data and data['one_liner']:
            result['one_liner'] = str(data['one_liner']).strip()
            
        return result
        
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON response: {e}")
        return {}
    except Exception as e:
        logger.error(f"Error parsing response: {e}")
        return {}


def enrich_company(company: Dict[str, Any]) -> bool:
    """Enrich a single company. Returns True if successful."""
    company_id = company['id']
    name = company.get('name', 'Unknown')
    
    try:
        prompt = build_prompt(company)
        response = llm_call(prompt, model=MODEL_NAME, activity="4D Classification")
        
        if not response:
            logger.warning(f"Empty LLM response for company {company_id} ({name})")
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE cvc.companies 
                        SET enrichment_status = 'failed', updated_at = NOW()
                        WHERE id = %s
                    """, (company_id,))
                    conn.commit()
            return False
        
        updates = parse_enrichment_response(response)
        
        set_clauses = []
        params = []
        
        for field, value in updates.items():
            set_clauses.append(f"{field} = %s")
            params.append(value)
        
        set_clauses.append("enrichment_status = %s")
        params.append('enriched')
        set_clauses.append("enrichment_source = %s")
        params.append('llm_infer')
        set_clauses.append("updated_at = NOW()")
        
        params.append(company_id)
        
        with get_connection() as conn:
            with conn.cursor() as cur:
                sql = f"UPDATE cvc.companies SET {', '.join(set_clauses)} WHERE id = %s"
                cur.execute(sql, params)
                
                cur.execute("""
                    UPDATE cvc.companies 
                    SET search_text = to_tsvector(
                        coalesce(name, '') || ' ' || 
                        coalesce(one_liner, '') || ' ' || 
                        coalesce(description, '')
                    )
                    WHERE id = %s
                """, (company_id,))
                
                conn.commit()
        
        logger.info(f"Successfully enriched company {company_id} ({name}) with fields: {list(updates.keys())}")
        return True
        
    except Exception as e:
        logger.error(f"Error enriching company {company_id} ({name}): {e}")
        
        try:
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE cvc.companies 
                        SET enrichment_status = 'failed', updated_at = NOW()
                        WHERE id = %s
                    """, (company_id,))
                    conn.commit()
        except Exception as db_err:
            logger.error(f"Failed to mark company {company_id} as failed: {db_err}")
        
        return False


def get_pending_companies(limit: int) -> List[Dict[str, Any]]:
    """Fetch pending companies from database."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, name, one_liner, description, website, 
                       sector, stage, employee_count, total_raised_usd, 
                       founded, hq_city, country
                FROM cvc.companies 
                WHERE enrichment_status = 'pending'
                ORDER BY id 
                LIMIT %s
            """, (limit,))
            return cur.fetchall()


def main():
    if not is_job_enabled("Company Enrichment — Phase 1"):
        logger.info("Job disabled in scheduler — exiting")
        sys.exit(0)

    parser = argparse.ArgumentParser(description='Enrich company data using LLM')
    parser.add_argument('--limit', type=int, default=50, help='Number of companies to process (default: 50)')
    args = parser.parse_args()

    logger.info(f"Starting enrichment worker with limit={args.limit}")

    run_id = start_job("Company Enrichment — Phase 1", "dell")

    try:
        companies = get_pending_companies(args.limit)
        logger.info(f"Found {len(companies)} pending companies")

        if not companies:
            logger.info("No pending companies to enrich")
            finish_job(run_id, "ok", {"total": 0, "enriched": 0, "failed": 0})
            return

        success_count = 0
        fail_count = 0

        for idx, company in enumerate(companies, 1):
            success = enrich_company(company)
            if success:
                success_count += 1
            else:
                fail_count += 1

            if idx % 10 == 0:
                print(f"Progress: {idx}/{len(companies)} companies processed ({success_count} success, {fail_count} failed)")

        print(f"Enrichment complete. Success: {success_count}, Failed: {fail_count}, Total: {len(companies)}")
        finish_job(run_id, "ok", {"total": len(companies), "enriched": success_count, "failed": fail_count})

    except Exception as e:
        logger.error(f"Fatal error in enrichment worker: {e}")
        finish_job(run_id, "error", error_text=str(e))
        write_cron_error("Company Enrichment — Phase 1", str(e), source="enrich_worker")
        sys.exit(1)


if __name__ == "__main__":
    main()
