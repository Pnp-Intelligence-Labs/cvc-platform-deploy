#!/usr/bin/env python3
"""
scripts/enrich_company_data_async.py — Async/batched enrichment processor with resume capability.

Uses OpenRouter (Kimi K2.5) for classification with batch processing and state persistence.

Features:
- Batch processing (default 25 companies per batch)
- Resume from last processed ID
- Progress tracking in .enrichment_progress.json
- Exponential backoff on rate limits
- File logging for background execution
- 5 min break every 100 companies

Usage:
    # Start/resume processing
    python3 scripts/enrich_company_data_async.py --batch-size 25

    # Process specific range
    python3 scripts/enrich_company_data_async.py --start-id 100 --limit 500

    # Check status
    python3 scripts/enrich_company_data_async.py --status

    # Dry run (no DB updates)
    python3 scripts/enrich_company_data_async.py --batch-size 25 --dry-run
"""

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

sys.path.insert(0, '/home/nathan/repos/cvc-intelligence')
from core.db.connection import get_connection

# Configuration
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
MODEL = "moonshotai/kimi-k2.5"
PROGRESS_FILE = Path(".enrichment_progress.json")
LOG_FILE = Path("enrichment.log")

# Rate limiting
DELAY_BETWEEN_CALLS = 1.0  # seconds
BREAK_EVERY_N = 100
BREAK_DURATION = 300  # 5 minutes

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


def setup_logging():
    """Setup logging to both file and stdout."""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[
            logging.FileHandler(LOG_FILE),
            logging.StreamHandler(sys.stdout)
        ]
    )
    return logging.getLogger(__name__)


logger = setup_logging()


def load_progress() -> dict:
    """Load progress from JSON file."""
    if PROGRESS_FILE.exists():
        try:
            with open(PROGRESS_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"Could not load progress file: {e}")
    return {
        "last_company_id": 0,
        "processed_count": 0,
        "failed_ids": [],
        "last_run": None,
        "status": "idle"
    }


def save_progress(progress: dict):
    """Save progress to JSON file."""
    progress["last_run"] = datetime.now().isoformat()
    try:
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(progress, f, indent=2)
    except IOError as e:
        logger.error(f"Could not save progress file: {e}")


def validate_json_content(content: str) -> bool:
    """Validate that content is parseable JSON."""
    try:
        json.loads(content)
        return True
    except json.JSONDecodeError:
        return False


def classify_company(name: str, description: Optional[str], website: Optional[str],
                     tags: Optional[list], max_retries: int = 3) -> dict:
    """Call OpenRouter to classify a company with retry logic."""
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

    for attempt in range(max_retries):
        try:
            response = requests.post(OPENROUTER_URL, json=payload, headers=headers, timeout=120)
            response.raise_for_status()
            result = response.json()

            # Check for API errors
            if "error" in result:
                error_msg = result["error"].get("message", "Unknown API error")
                logger.warning(f"API error on attempt {attempt + 1}: {error_msg}")
                if attempt < max_retries - 1:
                    sleep_time = (2 ** attempt) + 1  # Exponential backoff
                    logger.info(f"Retrying in {sleep_time}s...")
                    time.sleep(sleep_time)
                    continue
                return {"subsector": None, "confidence": 0.0, "reasoning": f"API error: {error_msg}"}

            # Parse response - handle Kimi thinking mode where content might be null
            choice = result.get("choices", [{}])[0]
            message = choice.get("message", {})
            content = message.get("content")

            # Handle null content (Kimi thinking mode sometimes returns null)
            if content is None:
                reasoning = message.get("reasoning", "No content returned")
                logger.warning(f"Null content for {name}, reasoning: {reasoning[:100]}...")
                return {"subsector": None, "confidence": 0.0, "reasoning": f"Null content: {reasoning[:200]}"}

            content = content.strip()

            # Extract JSON from markdown code blocks
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content_parts = content.split("```")
                if len(content_parts) >= 2:
                    content = content_parts[1].strip()

            # Validate JSON before parsing
            if not validate_json_content(content):
                logger.error(f"Invalid JSON for {name}: {content[:200]}")
                logger.error(f"Full API response: {json.dumps(result, indent=2)[:1000]}")
                return {"subsector": None, "confidence": 0.0, "reasoning": f"Invalid JSON response"}

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
                    subsector = "Unknown"

            return {
                "subsector": subsector,
                "confidence": float(parsed.get("confidence", 0.0)),
                "reasoning": parsed.get("reasoning", "")
            }

        except requests.exceptions.HTTPError as e:
            if response.status_code == 429:  # Rate limited
                sleep_time = (2 ** attempt) * 10 + 5  # Longer backoff for rate limits
                logger.warning(f"Rate limited. Sleeping {sleep_time}s...")
                if attempt < max_retries - 1:
                    time.sleep(sleep_time)
                    continue
            logger.error(f"HTTP error on attempt {attempt + 1}: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            return {"subsector": None, "confidence": 0.0, "reasoning": f"HTTP error: {e}"}

        except Exception as e:
            logger.error(f"Error on attempt {attempt + 1}: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            return {"subsector": None, "confidence": 0.0, "reasoning": f"LLM error: {e}"}

    return {"subsector": None, "confidence": 0.0, "reasoning": "Max retries exceeded"}


def determine_status(confidence: float) -> tuple:
    """Determine enrichment status based on confidence score."""
    if confidence >= 0.85:
        return "auto_filled", "applied"
    elif confidence >= 0.60:
        return "manual_review", "pending"
    else:
        return "needs_research", "rejected"


def get_pending_companies(cur, start_id: int = 0, limit: Optional[int] = None) -> list:
    """Fetch companies needing enrichment."""
    query = """
        SELECT id, name, description, website, tags, subsector
        FROM cvc.companies
        WHERE subsector IS NULL
          AND (enrichment_status IS NULL OR enrichment_status = 'pending')
          AND id > %s
        ORDER BY id
    """
    params = [start_id]

    if limit:
        query += " LIMIT %s"
        params.append(limit)

    cur.execute(query, params)
    return cur.fetchall()


def process_company(cur, company: dict, dry_run: bool = False) -> dict:
    """Process a single company and return result."""
    company_id = company["id"]
    name = company["name"]

    logger.info(f"Processing: {name} (ID: {company_id})")

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

    logger.info(f"  -> {subsector} (confidence: {confidence:.2f}, status: {status})")

    if not dry_run:
        try:
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

            return {"success": True, "status": status, "company_id": company_id}

        except Exception as e:
            logger.error(f"  -> DB error: {e}")
            return {"success": False, "error": str(e), "company_id": company_id}

    return {"success": True, "status": status, "dry_run": True, "company_id": company_id}


def enrich_companies_async(batch_size: int = 25, start_id: int = 0,
                           limit: Optional[int] = None, dry_run: bool = False):
    """Main async enrichment loop with batch processing and resume capability."""

    progress = load_progress()

    # If resuming and no explicit start_id, use last_company_id
    if start_id == 0 and progress["last_company_id"] > 0:
        start_id = progress["last_company_id"]
        logger.info(f"Resuming from company ID: {start_id}")

    progress["status"] = "running"
    save_progress(progress)

    stats = {
        "processed": 0,
        "auto_filled": 0,
        "manual_review": 0,
        "needs_research": 0,
        "errors": 0,
        "failed_ids": []
    }

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                # Get batch of companies
                companies = get_pending_companies(cur, start_id, limit)

                if not companies:
                    logger.info("No companies found to process.")
                    progress["status"] = "idle"
                    save_progress(progress)
                    return

                total = len(companies)
                logger.info(f"Found {total} companies to process (batch_size={batch_size})")

                for i, company in enumerate(companies, 1):
                    # Process company
                    result = process_company(cur, company, dry_run)

                    if result["success"]:
                        if not dry_run:
                            conn.commit()
                        status = result.get("status", "unknown")
                        stats[status] = stats.get(status, 0) + 1
                        progress["last_company_id"] = company["id"]
                    else:
                        stats["errors"] += 1
                        stats["failed_ids"].append(company["id"])
                        progress["failed_ids"].append(company["id"])
                        if not dry_run:
                            conn.rollback()

                    stats["processed"] += 1
                    progress["processed_count"] += 1

                    # Save progress after each batch
                    if i % batch_size == 0:
                        save_progress(progress)
                        logger.info(f"Progress saved. Batch {i//batch_size} complete. "
                                   f"Processed: {stats['processed']}/{total}")

                    # Take a break every 100 companies
                    if stats["processed"] % BREAK_EVERY_N == 0:
                        logger.info(f"Taking {BREAK_DURATION}s break after {stats['processed']} companies...")
                        time.sleep(BREAK_DURATION)

                    # Rate limiting delay
                    time.sleep(DELAY_BETWEEN_CALLS)

                # Final save
                save_progress(progress)

                logger.info("=" * 60)
                logger.info("ENRICHMENT COMPLETE")
                logger.info("=" * 60)
                logger.info(f"Processed: {stats['processed']}")
                logger.info(f"Auto-filled: {stats.get('auto_filled', 0)}")
                logger.info(f"Manual review: {stats.get('manual_review', 0)}")
                logger.info(f"Needs research: {stats.get('needs_research', 0)}")
                logger.info(f"Errors: {stats['errors']}")
                if stats["failed_ids"]:
                    logger.info(f"Failed IDs: {stats['failed_ids']}")

                progress["status"] = "idle"
                save_progress(progress)

    except KeyboardInterrupt:
        logger.warning("Interrupted by user. Saving progress...")
        progress["status"] = "interrupted"
        save_progress(progress)
        raise
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        progress["status"] = "error"
        progress["last_error"] = str(e)
        save_progress(progress)
        raise


def show_status():
    """Display current enrichment status from progress file."""
    progress = load_progress()

    print("=" * 60)
    print("ENRICHMENT STATUS")
    print("=" * 60)
    print(f"Status: {progress.get('status', 'unknown')}")
    print(f"Last company ID: {progress.get('last_company_id', 0)}")
    print(f"Total processed: {progress.get('processed_count', 0)}")
    print(f"Failed IDs: {len(progress.get('failed_ids', []))}")
    if progress.get('failed_ids'):
        print(f"  - {progress['failed_ids']}")
    print(f"Last run: {progress.get('last_run', 'never')}")
    if progress.get('last_error'):
        print(f"Last error: {progress['last_error']}")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Async enrichment processor with resume capability"
    )
    parser.add_argument("--batch-size", type=int, default=25,
                        help="Companies per batch (default: 25)")
    parser.add_argument("--start-id", type=int, default=0,
                        help="Start from specific company ID")
    parser.add_argument("--limit", type=int, default=None,
                        help="Limit total companies to process")
    parser.add_argument("--status", action="store_true",
                        help="Show current enrichment status")
    parser.add_argument("--dry-run", action="store_true",
                        help="Process without updating database")

    args = parser.parse_args()

    if args.status:
        show_status()
        return

    if not OPENROUTER_API_KEY:
        logger.error("OPENROUTER_API_KEY environment variable not set")
        sys.exit(1)

    enrich_companies_async(
        batch_size=args.batch_size,
        start_id=args.start_id,
        limit=args.limit,
        dry_run=args.dry_run
    )


if __name__ == "__main__":
    main()
