#!/usr/bin/env python3
"""
scripts/enrich_company_data.py — Auto-classify missing subsector/sector/stage using LLM.

Uses OpenRouter (Kimi K2.5) for classification.
Classifies companies with NULL subsector into predefined taxonomy.

Status mapping:
- confidence >= 0.85: enrichment_status='auto_filled', apply prediction
- confidence 0.60-0.84: enrichment_status='manual_review', flag for queue
- confidence < 0.60: enrichment_status='needs_research'

Usage:
    python3 scripts/enrich_company_data.py --limit 10 --dry-run
    python3 scripts/enrich_company_data.py --limit 100
    python3 scripts/enrich_company_data.py --all
"""

import argparse
import json
import os
import sys
import time
from typing import Optional

import requests

sys.path.insert(0, '/home/nathan/repos/cvc-intelligence')
from core.db.connection import get_connection

# OpenRouter API configuration
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
MODEL = "moonshotai/kimi-k2.5"

# Valid subsectors from taxonomy
VALID_SUBSECTORS = [
    "Manufacturing",
    "Warehouse Automation", 
    "Agricultural Robotics",
    "Construction Technology",
    "Industrial Automation",
    "Semiconductor Design",
    "Logistics",
    "Aerial Robotics",
    "Industrial Robotics",
    "Computer Vision",
    "Precision Agriculture",
    "Industrial IoT",
    "Industrial Safety",
    "Automotive",
    "Aerospace",
    "E-commerce",
    "AI Services",
    "Agriculture Technology",
    "Construction"
]

CLASSIFICATION_PROMPT = """Company: {name}
Description: {description}
Website: {website}
Tags: {tags}

Classify into ONE subsector from: Manufacturing, Warehouse Automation, Agricultural Robotics, Construction Technology, Industrial Automation, Semiconductor Design, Logistics, Aerial Robotics, Industrial Robotics, Computer Vision, Precision Agriculture, Industrial IoT, Industrial Safety, Automotive, Aerospace, E-commerce, AI Services, Agriculture Technology, Construction

Return ONLY JSON: {{"subsector": "...", "confidence": 0.0-1.0, "reasoning": "brief explanation"}}"""


def classify_company(name: str, description: Optional[str], website: Optional[str], tags: Optional[list]) -> dict:
    """Call OpenRouter to classify a company."""
    prompt = CLASSIFICATION_PROMPT.format(
        name=name,
        description=description or "No description available",
        website=website or "Not provided",
        tags=", ".join(tags) if tags else "None"
    )

    if not OPENROUTER_API_KEY:
        return {"subsector": None, "confidence": 0.0, "reasoning": "OPENROUTER_API_KEY not set"}

    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "You are a company classification assistant. Return only valid JSON."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1,
        "max_tokens": 2000
    }

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }

    try:
        response = requests.post(OPENROUTER_URL, json=payload, headers=headers, timeout=120)
        response.raise_for_status()
        result = response.json()

        # Parse JSON from response
        content = result["choices"][0]["message"]["content"].strip()
        
        # Extract JSON from response (handle markdown code blocks)
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
        
        parsed = json.loads(content)
        
        # Validate subsector is in taxonomy
        subsector = parsed.get("subsector", "").strip()
        if subsector not in VALID_SUBSECTORS:
            # Try case-insensitive match
            for valid in VALID_SUBSECTORS:
                if subsector.lower() == valid.lower():
                    subsector = valid
                    break
            else:
                subsector = "Unknown"  # Will trigger manual_review
        
        return {
            "subsector": subsector,
            "confidence": float(parsed.get("confidence", 0.0)),
            "reasoning": parsed.get("reasoning", "")
        }
        
    except json.JSONDecodeError as e:
        return {"subsector": None, "confidence": 0.0, "reasoning": f"JSON parse error: {e}"}
    except Exception as e:
        return {"subsector": None, "confidence": 0.0, "reasoning": f"LLM error: {e}"}


def determine_status(confidence: float) -> tuple:
    """Determine enrichment status based on confidence score."""
    if confidence >= 0.85:
        return "auto_filled", "applied"
    elif confidence >= 0.60:
        return "manual_review", "pending"
    else:
        return "needs_research", "rejected"


def enrich_companies(limit: Optional[int] = None, dry_run: bool = False):
    """Main enrichment loop."""
    
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Query companies with NULL subsector
            query = """
                SELECT id, name, description, website, tags, subsector
                FROM cvc.companies
                WHERE subsector IS NULL
                  AND (enrichment_status IS NULL OR enrichment_status = 'pending')
                ORDER BY id
            """
            if limit:
                query += f" LIMIT {limit}"
            
            cur.execute(query)
            companies = cur.fetchall()
            
            print(f"Found {len(companies)} companies needing enrichment")
            
            stats = {
                "processed": 0,
                "auto_filled": 0,
                "manual_review": 0,
                "needs_research": 0,
                "errors": 0
            }
            
            for company in companies:
                company_id = company["id"]
                name = company["name"]
                
                print(f"\n[{stats['processed']+1}/{len(companies)}] Processing: {name}")
                
                # Call LLM
                result = classify_company(
                    name=name,
                    description=company["description"],
                    website=company["website"],
                    tags=company["tags"]
                )
                
                confidence = result["confidence"]
                subsector = result["subsector"]
                reasoning = result["reasoning"]
                
                status, action = determine_status(confidence)
                
                print(f"  Predicted: {subsector} (confidence: {confidence:.2f})")
                print(f"  Status: {status} | Action: {action}")
                print(f"  Reasoning: {reasoning[:80]}...")
                
                stats["processed"] += 1
                
                if not dry_run:
                    try:
                        # Update database
                        if status == "auto_filled":
                            cur.execute("""
                                UPDATE cvc.companies
                                SET subsector = %s,
                                    enrichment_status = %s,
                                    enrichment_confidence = %s,
                                    enrichment_source = 'llm_auto',
                                    predicted_subsector = %s
                                WHERE id = %s
                            """, (subsector, status, confidence, subsector, company_id))
                        else:
                            cur.execute("""
                                UPDATE cvc.companies
                                SET enrichment_status = %s,
                                    enrichment_confidence = %s,
                                    enrichment_source = 'llm_auto',
                                    predicted_subsector = %s
                                WHERE id = %s
                            """, (status, confidence, subsector, company_id))
                        
                        conn.commit()
                        print(f"  ✓ Updated")
                        
                    except Exception as e:
                        print(f"  ✗ DB error: {e}")
                        stats["errors"] += 1
                        conn.rollback()
                        continue
                else:
                    print(f"  [DRY RUN - no changes]")
                
                stats[status] += 1

                # Rate limiting - respect OpenRouter
                time.sleep(0.5)
            
            print("\n" + "="*50)
            print("ENRICHMENT COMPLETE")
            print("="*50)
            print(f"Processed: {stats['processed']}")
            print(f"Auto-filled: {stats['auto_filled']}")
            print(f"Manual review: {stats['manual_review']}")
            print(f"Needs research: {stats['needs_research']}")
            print(f"Errors: {stats['errors']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Enrich company data using LLM classification")
    parser.add_argument("--limit", type=int, help="Limit number of companies to process")
    parser.add_argument("--dry-run", action="store_true", help="Show predictions without updating DB")
    parser.add_argument("--all", action="store_true", help="Process all pending companies")
    
    args = parser.parse_args()
    
    if not args.limit and not args.all:
        print("Use --limit N or --all to specify batch size")
        sys.exit(1)
    
    enrich_companies(limit=args.limit, dry_run=args.dry_run)
