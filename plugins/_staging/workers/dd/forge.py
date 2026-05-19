"""
forge.py — Feedback Pattern Learning Loop

Reads reconciler_log.json files after each Reconciler run.
Extracts patterns: agent/topic combos wrong most often, company types with false positives,
what correct answers looked like. Writes structured records to database.
Surfaces top failure patterns and suggests prompt improvements.

Usage:
    python3 forge.py --company "Ranger"           # Analyze single company
    python3 forge.py --scan-all                   # Scan all reconciler logs
    python3 forge.py --report                     # Print top failure patterns
    python3 forge.py --suggest-prompts            # Suggest prompt improvements
"""

import json
import argparse
from datetime import datetime
from collections import defaultdict
from typing import Optional

from config.settings import WORKDIR
from db_logger import get_connection

AGENTS = ["financials", "comp", "qualitative", "product", "news"]


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{ts}  {msg}")


def load_reconciler_log(company: str) -> Optional[dict]:
    """Load reconciler_log.json for a company."""
    safe = company.replace(" ", "_").replace("/", "-")
    log_path = WORKDIR / safe / "reconciler_log.json"
    
    if not log_path.exists():
        return None
    
    with open(log_path) as f:
        return json.load(f)


def find_all_reconciler_logs() -> list[Path]:
    """Find all reconciler_log.json files in workdir."""
    return list(WORKDIR.glob("*/reconciler_log.json"))


def extract_patterns(log_data: dict) -> list[dict]:
    """
    Extract structured patterns from reconciler log.
    
    Returns list of pattern records with:
    - agent, topic, accuracy_type, flag_pattern
    - company, company_type (from overview if available)
    - original_finding, corrected_finding
    - confidence: how often this pattern appears
    """
    patterns = []
    company = log_data.get("company", "unknown")
    
    # Try to get company type from overview
    company_type = "unknown"
    safe = company.replace(" ", "_").replace("/", "-")
    overview_path = WORKDIR / safe / "overview.json"
    if overview_path.exists():
        try:
            with open(overview_path) as f:
                overview = json.load(f)
                company_type = overview.get("scorecard", {}).get("business_model", "unknown")
        except:
            pass
    
    for agent, changes in log_data.get("changes_by_agent", {}).items():
        for correction in changes:
            topic = correction.get("topic", "unknown")
            accuracy = correction.get("accuracy", "unknown")
            flag_rating = correction.get("flag_rating", "unknown")

            # Determine pattern type
            if accuracy in {"wrong", "incorrect"}:
                pattern_type = "wrong_finding"
            elif accuracy in {"partial", "partially correct"}:
                pattern_type = "partial_finding"
            else:
                pattern_type = "other"

            # Determine flag pattern
            original_flag = correction.get("original_flag", False)
            corrected_flag = correction.get("corrected_flag", False)

            if original_flag and not corrected_flag:
                flag_pattern = "false_positive"
            elif not original_flag and corrected_flag:
                flag_pattern = "missed_flag"
            else:
                flag_pattern = "flag_unchanged"

            patterns.append({
                "company": company,
                "company_type": company_type,
                "agent": agent,
                "topic": topic,
                "pattern_type": pattern_type,
                "flag_pattern": flag_pattern,
                "accuracy": accuracy,
                "flag_rating": flag_rating,
                "original_finding": correction.get("original_finding", "")[:500],
                "corrected_finding": correction.get("corrected_finding", "")[:500],
                "reconciler_date": log_data.get("reconciler_date"),
            })
    
    return patterns


def ensure_feedback_table():
    """Create dd_feedback_patterns table if it doesn't exist."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS dd_feedback_patterns (
                    id SERIAL PRIMARY KEY,
                    company VARCHAR(255),
                    company_type VARCHAR(100),
                    agent VARCHAR(100),
                    topic VARCHAR(255),
                    pattern_type VARCHAR(50),  -- wrong_finding, partial_finding, false_positive, missed_flag
                    flag_pattern VARCHAR(50),
                    accuracy VARCHAR(50),
                    flag_rating VARCHAR(50),
                    original_finding TEXT,
                    corrected_finding TEXT,
                    reconciler_date TIMESTAMP,
                    extracted_at TIMESTAMP DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_feedback_agent ON dd_feedback_patterns(agent);
                CREATE INDEX IF NOT EXISTS idx_feedback_pattern_type ON dd_feedback_patterns(pattern_type);
                CREATE INDEX IF NOT EXISTS idx_feedback_company_type ON dd_feedback_patterns(company_type);
                CREATE INDEX IF NOT EXISTS idx_feedback_topic ON dd_feedback_patterns(topic);
            """)
            conn.commit()
            log("[DB] dd_feedback_patterns table ready")
    finally:
        conn.close()


def write_patterns_to_db(patterns: list[dict]) -> int:
    """Write extracted patterns to database. Returns count written."""
    if not patterns:
        return 0
    
    ensure_feedback_table()
    conn = get_connection()
    
    try:
        with conn.cursor() as cur:
            for p in patterns:
                cur.execute("""
                    INSERT INTO dd_feedback_patterns (
                        company, company_type, agent, topic, pattern_type,
                        flag_pattern, accuracy, flag_rating, original_finding,
                        corrected_finding, reconciler_date
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    p["company"], p["company_type"], p["agent"], p["topic"],
                    p["pattern_type"], p["flag_pattern"], p["accuracy"],
                    p["flag_rating"], p["original_finding"], p["corrected_finding"],
                    p["reconciler_date"]
                ))
            conn.commit()
            log(f"[DB] Wrote {len(patterns)} patterns")
            return len(patterns)
    finally:
        conn.close()


def analyze_patterns(agent_filter: Optional[str] = None) -> dict:
    """
    Analyze patterns in database and return aggregated stats.
    
    Returns dict with:
    - top_wrong_topics: agent/topic combos marked wrong most often
    - top_false_positive_types: company types with most over-flagging
    - agents_needing_work: agents ranked by error rate
    """
    # Ensure table exists before querying
    ensure_feedback_table()
    
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            # Top wrong topics
            cur.execute("""
                SELECT agent, topic, pattern_type, COUNT(*) as cnt
                FROM dd_feedback_patterns
                WHERE pattern_type IN ('wrong_finding', 'partial_finding')
                GROUP BY agent, topic, pattern_type
                ORDER BY cnt DESC
                LIMIT 20
            """)
            top_wrong = cur.fetchall()
            
            # Company types with most false positives
            cur.execute("""
                SELECT company_type, flag_pattern, COUNT(*) as cnt
                FROM dd_feedback_patterns
                WHERE flag_pattern = 'false_positive'
                GROUP BY company_type, flag_pattern
                ORDER BY cnt DESC
                LIMIT 10
            """)
            false_positive_types = cur.fetchall()
            
            # Agent error rates
            cur.execute("""
                SELECT agent,
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE pattern_type = 'wrong_finding') as wrong,
                    COUNT(*) FILTER (WHERE pattern_type = 'partial_finding') as partial
                FROM dd_feedback_patterns
                GROUP BY agent
                ORDER BY COUNT(*) FILTER (WHERE pattern_type IN ('wrong_finding', 'partial_finding')) DESC
            """)
            agent_stats = cur.fetchall()
            
            # Common corrections (what correct answers look like)
            cur.execute("""
                SELECT agent, topic, corrected_finding, COUNT(*) as cnt
                FROM dd_feedback_patterns
                WHERE pattern_type IN ('wrong_finding', 'partial_finding')
                    AND LENGTH(corrected_finding) > 20
                GROUP BY agent, topic, corrected_finding
                ORDER BY cnt DESC
                LIMIT 15
            """)
            common_corrections = cur.fetchall()
            
            return {
                "top_wrong_topics": top_wrong,
                "false_positive_types": false_positive_types,
                "agent_stats": agent_stats,
                "common_corrections": common_corrections,
            }
    finally:
        conn.close()


def generate_prompt_suggestions(analysis: dict) -> list[dict]:
    """Generate specific prompt improvement suggestions from pattern analysis."""
    suggestions = []
    
    # Suggest fixes for top wrong topics
    for agent, topic, pattern_type, count in analysis.get("top_wrong_topics", [])[:5]:
        if pattern_type == "wrong_finding":
            suggestions.append({
                "priority": "high" if count >= 3 else "medium",
                "agent": agent,
                "topic": topic,
                "issue": f"Finding marked wrong {count} time(s)",
                "suggestion": f"Review {agent} agent prompt for '{topic}' section. Consider adding clarifying examples of correct vs incorrect findings.",
            })
        else:
            suggestions.append({
                "priority": "medium",
                "agent": agent,
                "topic": topic,
                "issue": f"Finding partially correct {count} time(s)",
                "suggestion": f"Add nuance to {agent} agent prompt for '{topic}' — findings are directionally right but missing key details.",
            })
    
    # Suggest flag calibration for company types
    for company_type, flag_pattern, count in analysis.get("false_positive_types", [])[:3]:
        suggestions.append({
            "priority": "high",
            "agent": "all",
            "topic": f"{company_type} flagging",
            "issue": f"{count} false positive flag(s) for {company_type} companies",
            "suggestion": f"Review flag criteria for {company_type} business model — over-flagging detected. Consider raising threshold or adding company-type exceptions.",
        })
    
    # Agent-level suggestions
    for agent, total, wrong, partial in analysis.get("agent_stats", []):
        error_rate = (wrong + partial) / total if total > 0 else 0
        if error_rate > 0.3:
            suggestions.append({
                "priority": "high",
                "agent": agent,
                "topic": "overall",
                "issue": f"{error_rate:.0%} error rate ({wrong} wrong, {partial} partial out of {total})",
                "suggestion": f"Major prompt revision needed for {agent} agent. Consider adding few-shot examples and stricter output format requirements.",
            })
    
    return sorted(suggestions, key=lambda x: (x["priority"] != "high", x["priority"]))


def print_report(analysis: dict):
    """Print formatted pattern analysis report."""
    print("\n" + "="*60)
    print("FORGE — Feedback Pattern Analysis")
    print("="*60)
    
    print("\n📊 Top Agent/Topic Issues (Wrong/Partial Findings)")
    print("-"*60)
    for agent, topic, pattern_type, count in analysis.get("top_wrong_topics", [])[:10]:
        icon = "❌" if pattern_type == "wrong_finding" else "⚠️"
        print(f"  {icon} {agent:12} | {topic:25} | {count}x {pattern_type}")
    
    print("\n🏭 Company Types with False Positive Flags")
    print("-"*60)
    for company_type, flag_pattern, count in analysis.get("false_positive_types", [])[:5]:
        print(f"  🚩 {company_type:20} | {count}x over-flagged")
    
    print("\n📈 Agent Error Rates")
    print("-"*60)
    for agent, total, wrong, partial in analysis.get("agent_stats", []):
        error_rate = (wrong + partial) / total if total > 0 else 0
        status = "🔴" if error_rate > 0.3 else "🟡" if error_rate > 0.1 else "🟢"
        print(f"  {status} {agent:12} | {total:3} total | {wrong:3} wrong | {partial:3} partial | {error_rate:.0%} error")
    
    print("\n" + "="*60)


def print_suggestions(suggestions: list[dict]):
    """Print prompt improvement suggestions."""
    print("\n" + "="*60)
    print("FORGE — Prompt Improvement Suggestions")
    print("="*60)
    
    high_priority = [s for s in suggestions if s["priority"] == "high"]
    medium_priority = [s for s in suggestions if s["priority"] == "medium"]
    
    if high_priority:
        print(f"\n🔴 HIGH PRIORITY ({len(high_priority)} items)")
        print("-"*60)
        for s in high_priority:
            print(f"\n  Agent: {s['agent']}")
            print(f"  Topic: {s['topic']}")
            print(f"  Issue: {s['issue']}")
            print(f"  Fix:   {s['suggestion']}")
    
    if medium_priority:
        print(f"\n🟡 MEDIUM PRIORITY ({len(medium_priority)} items)")
        print("-"*60)
        for s in medium_priority[:5]:  # Limit output
            print(f"\n  Agent: {s['agent']} | {s['topic']}")
            print(f"  Issue: {s['issue']}")
    
    print("\n" + "="*60)


def main():
    parser = argparse.ArgumentParser(description="Forge — Feedback Pattern Learning Loop")
    parser.add_argument("--company", help="Analyze single company's reconciler log")
    parser.add_argument("--scan-all", action="store_true", help="Scan all reconciler logs")
    parser.add_argument("--report", action="store_true", help="Print pattern analysis report")
    parser.add_argument("--suggest-prompts", action="store_true", help="Generate prompt improvement suggestions")
    parser.add_argument("--write-db", action="store_true", help="Write patterns to database (default: dry run)")
    args = parser.parse_args()
    
    if args.company:
        log(f"Loading reconciler log for {args.company}...")
        log_data = load_reconciler_log(args.company)
        if not log_data:
            log(f"No reconciler log found for {args.company}")
            return 1
        
        patterns = extract_patterns(log_data)
        log(f"Extracted {len(patterns)} patterns")
        
        if patterns and args.write_db:
            count = write_patterns_to_db(patterns)
            log(f"Wrote {count} patterns to database")
        
        return 0
    
    if args.scan_all:
        logs = find_all_reconciler_logs()
        log(f"Found {len(logs)} reconciler logs")
        
        total_patterns = 0
        for log_path in logs:
            with open(log_path) as f:
                log_data = json.load(f)
            patterns = extract_patterns(log_data)
            if patterns:
                if args.write_db:
                    write_patterns_to_db(patterns)
                total_patterns += len(patterns)
                log(f"  {log_data.get('company')}: {len(patterns)} patterns")
        
        log(f"Total patterns extracted: {total_patterns}")
        return 0
    
    if args.report or args.suggest_prompts:
        analysis = analyze_patterns()
        
        if args.report:
            print_report(analysis)
        
        if args.suggest_prompts:
            suggestions = generate_prompt_suggestions(analysis)
            print_suggestions(suggestions)
        
        return 0
    
    # Default: show help
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
