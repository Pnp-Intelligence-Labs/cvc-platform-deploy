"""
agents/comp/agent.py — Competitive & Market specialist agent.

Investor mental model:
    "Is this market real, is it the right size, and can this company
    actually win it? What are they not telling us about the competition?"

Multi-pass approach:
    Pass 1 — Extract market claims from pitch deck + investor Q&A
    Web    — Market size, competitor landscape, comparable rounds, market timing
    Pass 2 — Reconcile claims vs web research → produce findings

Input:  manifest.json (pitch_deck + investor_qa routed to 'comp' by ingestion bot)
Output: workdir/[company]/agents/comp.json

Run:
    python3 -m agents.comp.agent "Dyna Robotics"
"""

import json
from pathlib import Path
import time
import argparse
from datetime import datetime
from collections import defaultdict

# ── Path setup ────────────────────────────────────────────────────────────────
from config.settings import WORKDIR, LLM_MODEL, LLM_TIMEOUT, LLM_MAX_TOKENS
from config.prompts import COMP_EXTRACT_CLAIMS, COMP_RECONCILE
from llm.openrouter import call as llm_call
from web.research import deep_search
from db.search import get_company, get_comps


# ── Text limits per doc type (chars) ─────────────────────────────────────────
TEXT_LIMITS = {
    "pitch_deck":  25000,
    "investor_qa": 8000,
}

# ── Search queries ────────────────────────────────────────────────────────────
SEARCH_QUERIES = [
    "{company} total addressable market size industry report",
    "{company} competitors alternative companies funding",
    "{company} market growth trends 2025 2026",
    "{company} comparable startup funding valuation series round",
    "{company} customers buyers enterprise SMB who uses decision maker",
    "{company} market barriers to entry regulatory moat competitive advantage",
]


# ── Document loading ──────────────────────────────────────────────────────────

def load_manifest(company: str) -> dict:
    safe_name     = company.replace(" ", "_").replace("/", "-")
    manifest_path = WORKDIR / safe_name / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}\nRun ingestion first.")
    return json.loads(manifest_path.read_text())


def load_docs_by_type(manifest: dict) -> dict[str, list[dict]]:
    agent_docs = manifest.get("routing", {}).get("comp", [])
    by_type    = defaultdict(list)
    for doc in agent_docs:
        by_type[doc["doc_type"]].append(doc)
    return dict(by_type)


def combine_docs(docs: list[dict], doc_type: str) -> str:
    limit = TEXT_LIMITS.get(doc_type, 5000)
    parts = []
    for doc in docs:
        path = Path(doc.get("text_path", ""))
        if path.exists():
            text = path.read_text(errors="ignore")[:limit]
            if text:
                parts.append(f"--- {doc['filename']} ---\n{text}")
    return "\n\n".join(parts)


# ── Web search ────────────────────────────────────────────────────────────────

def run_searches(company: str) -> str:
    all_parts = []
    for i, template in enumerate(SEARCH_QUERIES):
        if i > 0:
            time.sleep(1.5)  # Brave API rate limit
        query = template.format(company=company)
        print(f"  Searching: {query}")
        try:
            result = deep_search(query, n_fetch=2, pipeline="dd", agent="comp")
            if result.get("combined_text"):
                all_parts.append(f"=== {query} ===\n{result['combined_text']}")
            elif result.get("results"):
                snippets = [
                    f"{r['title']}: {r['description']} ({r['url']})"
                    for r in result["results"][:5]
                ]
                all_parts.append(f"=== {query} (summaries only) ===\n" + "\n".join(snippets))
        except Exception as e:
            print(f"  Warning: search failed for '{query}': {e}")
    return "\n\n".join(all_parts)


# ── JSON extraction helper ─────────────────────────────────────────────────────

def extract_json(text: str) -> dict | list:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text  = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        for start_char, end_char in [('{', '}'), ('[', ']')]:
            start = text.find(start_char)
            end   = text.rfind(end_char) + 1
            if start >= 0 and end > start:
                try:
                    return json.loads(text[start:end])
                except json.JSONDecodeError:
                    pass
    return {"error": "Failed to parse LLM response", "raw": text[:500]}


# ── LLM call wrapper ──────────────────────────────────────────────────────────

def run_pass(pass_name: str, prompt: str) -> dict | list:
    print(f"  Pass: {pass_name}...")
    start   = time.time()
    raw     = llm_call(prompt, model=LLM_MODEL, temperature=0.1,
                       max_tokens=LLM_MAX_TOKENS, timeout=LLM_TIMEOUT, activity="DD Pipeline")
    elapsed = int(time.time() - start)
    result  = extract_json(raw)
    status  = "error" if isinstance(result, dict) and "error" in result else "ok"
    print(f"    {status} ({elapsed}s)")
    return result


# ── CVC DB comps lookup ───────────────────────────────────────────────────────

def get_db_comps(company: str) -> str:
    """
    Look up company in CVC DB and fetch similar companies.
    Returns a formatted string for injection into COMP_RECONCILE prompt.
    Returns a 'not found' note if company isn't in the DB yet.
    """
    try:
        record = get_company(name=company)
        if not record:
            return f"Company '{company}' not yet in CVC database — no proprietary comps available."

        comps = get_comps(company_id=record["id"], n=5)
        if not comps:
            return f"Company found in CVC DB (sector={record.get('sector')}, stage={record.get('stage')}) but no comparable companies found."

        lines = [
            f"Target: {record['name']} | sector={record.get('sector')} | stage={record.get('stage')} | raised=${record.get('total_raised_usd') or 'undisclosed'}",
            "",
            "Comparable companies from CVC database:",
        ]
        for c in comps:
            raised = f"${c.get('total_raised_usd'):,}" if c.get("total_raised_usd") else "undisclosed"
            lines.append(
                f"  - {c['name']} | {c.get('sector')} | {c.get('stage')} | raised={raised} | {c.get('one_liner', '')[:80]}"
            )
        return "\n".join(lines)
    except Exception as e:
        return f"DB comps lookup failed: {e}"


# ── Main ──────────────────────────────────────────────────────────────────────

def run(company: str) -> dict:
    safe_name   = company.replace(" ", "_").replace("/", "-")
    company_dir = WORKDIR / safe_name
    output_dir  = company_dir / "agents"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "comp.json"

    print(f"\nComp Agent: {company}")
    print("=" * 50)

    start = time.time()

    # ── Load manifest + docs ──────────────────────────────────────────────────
    try:
        manifest = load_manifest(company)
    except FileNotFoundError as e:
        print(f"Error: {e}")
        result = _error_output(company, str(e), start)
        output_path.write_text(json.dumps(result, indent=2))
        return result

    by_type = load_docs_by_type(manifest)

    print(f"\nDocs available:")
    for doc_type, docs in by_type.items():
        print(f"  {doc_type}: {len(docs)} file(s)")

    # ── Pass 1: Extract market claims from pitch deck + investor Q&A ──────────
    pitch_text  = combine_docs(by_type.get("pitch_deck",  []), "pitch_deck")
    qa_text     = combine_docs(by_type.get("investor_qa", []), "investor_qa")
    claims_text = "\n\n".join(filter(None, [pitch_text, qa_text]))

    if claims_text:
        claims = run_pass("Extract market claims (pitch deck + Q&A)",
                          COMP_EXTRACT_CLAIMS.format(text=claims_text))
    else:
        claims = {"_missing": True}
        print("  Pass: Extract claims — SKIPPED (no pitch deck or investor Q&A)")

    # ── Web searches ──────────────────────────────────────────────────────────
    print("\nRunning web searches...")
    search_text = run_searches(company)
    print(f"  {len(search_text):,} chars gathered ({int(time.time() - start)}s)")

    # ── CVC DB comps ──────────────────────────────────────────────────────────
    print("\nFetching CVC DB comps...")
    db_comps_text = get_db_comps(company)
    print(f"  {db_comps_text.splitlines()[0]}")

    # ── Pass 2: Reconcile claims vs web research ──────────────────────────────
    print("\nReconciling...")
    reconcile_prompt = COMP_RECONCILE.format(
        company      = company,
        claims       = json.dumps(claims, indent=2),
        web_research = search_text[:15000],
        db_comps     = db_comps_text,
    )
    reconciled = run_pass("Reconcile claims vs market research", reconcile_prompt)

    # ── Package output ────────────────────────────────────────────────────────
    findings = reconciled.get("findings", []) if isinstance(reconciled, dict) else []
    summary  = reconciled.get("summary",  "") if isinstance(reconciled, dict) else ""
    flags    = [f for f in findings if isinstance(f, dict) and f.get("flag")]

    # Flag missing pitch deck
    if not claims_text:
        missing = {
            "id":          f"comp_{len(findings)+1:03d}",
            "topic":       "missing_document",
            "claimed":     None,
            "our_finding": "Pitch deck not found — cannot extract market claims",
            "delta":       None,
            "sources":     [],
            "verdict":     "not_found",
            "confidence":  "high",
            "flag":        True,
            "flag_reason": "No pitch deck in dataroom. Cannot assess market sizing or competitive positioning.",
        }
        findings.append(missing)
        flags.append(missing)

    status = "failed" if not findings else ("partial" if not claims_text else "complete")

    result = {
        "company":  company,
        "date":     datetime.now().strftime("%Y-%m-%d"),
        "agent":    "comp",
        "status":   status,
        "findings": findings,
        "flags":    flags,
        "summary":  summary,
        "meta": {
            "docs_read":    sum(len(v) for v in by_type.values()),
            "searches_run": len(SEARCH_QUERIES),
            "search_chars": len(search_text),
            "db_comps_found": "not found" not in db_comps_text and "failed" not in db_comps_text,
            "passes_run":   sum([bool(claims_text), True]),
            "total_seconds": int(time.time() - start),
        },
    }

    output_path.write_text(json.dumps(result, indent=2))
    print(f"\nOutput: {output_path}")
    _print_summary(result)

    return result


# ── Output helpers ────────────────────────────────────────────────────────────

def _error_output(company: str, error: str, start: float) -> dict:
    return {
        "company":  company,
        "date":     datetime.now().strftime("%Y-%m-%d"),
        "agent":    "comp",
        "status":   "failed",
        "findings": [],
        "flags":    [],
        "summary":  "",
        "error":    error,
        "meta":     {"docs_read": 0, "searches_run": 0, "total_seconds": int(time.time() - start)},
    }


def _print_summary(result: dict):
    findings = result["findings"]
    flags    = result["flags"]

    if findings:
        from collections import Counter
        by_verdict = Counter(f.get("verdict", "?") for f in findings if isinstance(f, dict))
        print(f"\nFindings ({len(findings)} total):")
        for verdict, n in by_verdict.most_common():
            print(f"  {verdict}: {n}")

    if flags:
        print(f"\nFLAGS ({len(flags)}):")
        for f in flags:
            topic  = f.get("topic", "?")
            reason = f.get("flag_reason", "")
            print(f"  [{f.get('confidence','?').upper()}] {topic}: {reason[:100]}")

    if result.get("summary"):
        print(f"\nSummary:\n{result['summary'][:400]}")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DD Comp Agent")
    parser.add_argument("company", help="Company name (e.g. 'Dyna Robotics')")
    args = parser.parse_args()
    run(args.company)
