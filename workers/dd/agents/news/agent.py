"""
agents/news/agent.py — News & Press Coverage specialist agent.

Investor mental model:
    "What is the market saying about this company? Are there signals the
    founders aren't showing us — big wins, controversies, executive changes?"

Input:  company name (manifest.json optional — news agent ignores documents)
Output: workdir/[company]/agents/news.json

Output schema: see schemas/finding.md

Web searches:
    1. General news coverage
    2. Funding announcements
    3. Partnerships and customer wins
    4. Executive/team changes
    5. Controversies / red flags

Run:
    python3 -m agents.news.agent "Dyna Robotics"
"""

import json
import sys
from pathlib import Path
import time
import argparse
from datetime import datetime

# ── Path setup ────────────────────────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # repo root
from config.settings import WORKDIR, LLM_MODEL, LLM_TIMEOUT, LLM_MAX_TOKENS
from config.prompts import NEWS_ANALYZE

# Imports from cvc_skills package
from web.research import deep_search
from llm.openrouter import call as llm_call




# ── Search strategy ───────────────────────────────────────────────────────────

SEARCH_QUERIES = [
    "{company} news 2025 2026",
    "{company} funding round investment",
    "{company} partnership customer contract win",
    "{company} CEO CTO executive team",
    "{company} lawsuit controversy regulatory",
    "{company} incorporated founded startup state entity Crunchbase",
]


def run_searches(company: str) -> str:
    all_parts = []
    for i, template in enumerate(SEARCH_QUERIES):
        if i > 0:
            time.sleep(1.5)  # Brave API rate limit — 1 req/sec on free tier
        query = template.format(company=company)
        print(f"  Searching: {query}")
        try:
            findings = deep_search(query, n_fetch=2, pipeline="dd", agent="news")
            if findings.get("combined_text"):
                all_parts.append(f"=== {query} ===\n{findings['combined_text']}")
            elif findings.get("results"):
                snippets = [
                    f"{r['title']}: {r['description']} ({r['url']})"
                    for r in findings["results"][:5]
                ]
                all_parts.append(f"=== {query} (summaries only) ===\n" + "\n".join(snippets))
        except Exception as e:
            print(f"  Warning: search failed for '{query}': {e}")
    return "\n\n".join(all_parts)


# ── JSON extraction ───────────────────────────────────────────────────────────

def extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end   = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
    return {"error": "Failed to parse LLM JSON output", "raw": text[:2000]}


# ── Output builder ────────────────────────────────────────────────────────────

def build_output(company: str, llm_result: dict, search_chars: int, start_time: float) -> dict:
    """
    Wrap LLM result in the standard agent output envelope (see schemas/finding.md).
    """
    findings = llm_result.get("findings", [])
    summary  = llm_result.get("summary", "")
    error    = llm_result.get("error")

    # Extract flags for quick IC access
    flags = [f for f in findings if isinstance(f, dict) and f.get("flag")]

    status = "failed" if error else ("partial" if not findings else "complete")

    return {
        "company":  company,
        "date":     datetime.now().strftime("%Y-%m-%d"),
        "agent":    "news",
        "status":   status,
        "findings": findings,
        "flags":    flags,
        "summary":  summary,
        "meta": {
            "docs_read":        0,
            "sources_searched": len(SEARCH_QUERIES),
            "search_chars":     search_chars,
            "total_seconds":    int(time.time() - start_time),
        },
        **({"error": error} if error else {}),
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def run(company: str) -> dict:
    safe_name   = company.replace(" ", "_").replace("/", "-")
    company_dir = WORKDIR / safe_name
    output_dir  = company_dir / "agents"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "news.json"

    print(f"\nNews Agent: {company}")
    print("=" * 50)

    start = time.time()

    # ── Step 1: Web searches ──────────────────────────────────────────────────
    print("\nRunning web searches...")
    search_text = run_searches(company)

    if not search_text:
        print("No search results found. Check BRAVE_API_KEY.")
        result = build_output(company, {"error": "No search results", "findings": []}, 0, start)
        output_path.write_text(json.dumps(result, indent=2))
        return result

    print(f"  {len(search_text):,} chars gathered ({int(time.time() - start)}s)")

    # ── Step 2: LLM analysis ──────────────────────────────────────────────────
    print("\nAnalyzing with LLM...")
    prompt = NEWS_ANALYZE.format(company=company, search_text=search_text[:12000])

    llm_start = time.time()
    raw       = llm_call(prompt, model=LLM_MODEL, temperature=0.1, max_tokens=LLM_MAX_TOKENS, timeout=LLM_TIMEOUT, activity="DD Pipeline")
    print(f"  LLM responded in {int(time.time() - llm_start)}s ({LLM_MODEL})")

    llm_result = extract_json(raw)
    result     = build_output(company, llm_result, len(search_text), start)

    # ── Step 3: Write output ──────────────────────────────────────────────────
    output_path.write_text(json.dumps(result, indent=2))
    print(f"\nOutput: {output_path}")

    # ── Print summary ─────────────────────────────────────────────────────────
    findings = result["findings"]
    flags    = result["flags"]

    if findings:
        from collections import Counter
        by_topic = Counter(f.get("topic", "?") for f in findings if isinstance(f, dict))
        print(f"\nFindings ({len(findings)} total):")
        for topic, n in by_topic.most_common():
            print(f"  {topic}: {n}")

    if flags:
        print(f"\nFLAGS ({len(flags)}):")
        for f in flags:
            print(f"  [{f.get('confidence','?').upper()}] {f.get('topic','?')}: {f.get('our_finding','')[:100]}")
            if f.get("flag_reason"):
                print(f"    → {f['flag_reason']}")

    if result.get("summary"):
        print(f"\nSummary:\n{result['summary']}")

    return result


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DD News Agent")
    parser.add_argument("company", help="Company name (e.g. 'Dyna Robotics')")
    args = parser.parse_args()
    run(args.company)
