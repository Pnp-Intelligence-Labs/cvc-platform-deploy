"""
agents/qualitative/agent.py — Team & Founder specialist agent.

Investor mental model:
    "Who are these founders? Have they done this before?
    Can they attract talent, close deals, and execute under pressure?"

Multi-pass approach:
    Pass 1 — Extract team/founder claims from pitch deck + team bios + investor Q&A
    Web    — Founder backgrounds, prior companies, advisors, track record
    Pass 2 — Reconcile claims vs web research → produce findings

Input:  manifest.json (team_bio + pitch_deck + investor_qa routed to 'qualitative')
Output: workdir/[company]/agents/qualitative.json

Run:
    python3 -m agents.qualitative.agent "Dyna Robotics"
"""

import json
from pathlib import Path
import time
import argparse
from datetime import datetime
from collections import defaultdict

# ── Path setup ────────────────────────────────────────────────────────────────
from config.settings import WORKDIR, LLM_MODEL, LLM_TIMEOUT, LLM_MAX_TOKENS
from config.prompts import QUALITATIVE_ORG_ASSESSMENT, QUALITATIVE_EXTRACT_CLAIMS, QUALITATIVE_RECONCILE
from llm.openrouter import call as llm_call
from web.research import deep_search
from web.proxycurl import extract_linkedin_urls, get_profile, format_profile_for_llm


# ── Text limits per doc type (chars) ─────────────────────────────────────────
TEXT_LIMITS = {
    "pitch_deck":  20000,
    "team_bio":    15000,
    "investor_qa": 8000,
}

# ── Search queries (built dynamically from extracted founder names) ───────────
BASE_SEARCH_QUERIES = [
    "{company} founder CEO background experience",
    "{company} founder LinkedIn previous company",
    "{company} team advisor investor",
    "{company} founder research publication conference speaker",
]


# ── Document loading ──────────────────────────────────────────────────────────

def load_manifest(company: str) -> dict:
    safe_name     = company.replace(" ", "_").replace("/", "-")
    manifest_path = WORKDIR / safe_name / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}\nRun ingestion first.")
    return json.loads(manifest_path.read_text())


def load_docs_by_type(manifest: dict) -> dict[str, list[dict]]:
    agent_docs = manifest.get("routing", {}).get("qualitative", [])
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



def enrich_linkedin_profiles(docs_text: str) -> str:
    """
    Extract LinkedIn URLs from documents and fetch profiles via Proxycurl.
    Returns formatted profile text for inclusion in web research.
    """
    urls = extract_linkedin_urls(docs_text)
    if not urls:
        return ""
    
    profiles_text = ["\n=== LinkedIn Profile Data (via Proxycurl) ===\n"]
    total_cost = 0
    
    for url in urls[:3]:  # Max 3 profiles to control cost
        result = get_profile(url)
        total_cost += result.get("cost_incurred", 0)
        
        if result["found"] and result["profile"]:
            profiles_text.append(f"\n--- Profile: {url} ---\n")
            profiles_text.append(format_profile_for_llm(result["profile"]))
        elif result["error"]:
            profiles_text.append(f"\n--- Profile: {url} ---\n")
            profiles_text.append(f"[Error fetching profile: {result['error']}]")
    
    profiles_text.append(f"\n[LinkedIn enrichment cost: ~${total_cost:.2f}]")
    return "\n".join(profiles_text)

def _clean(val) -> str | None:
    """Return string value or None if null/unknown/empty."""
    if not val or str(val).lower() in ("null", "unknown", "none", ""):
        return None
    return str(val).strip()


def build_search_queries(company: str, claims: dict) -> list[str]:
    """
    Build targeted search queries using extracted founder names and prior companies.
    Base queries use company name. Then adds:
      - Per-founder background search
      - Per-founder + prior company targeted search
      - Prior company exit/outcome search
    Caps total searches at 8 to stay within Brave rate limits.
    """
    queries = [q.format(company=company) for q in BASE_SEARCH_QUERIES]

    if isinstance(claims, dict) and not claims.get("_missing"):
        founders = claims.get("founders", [])
        for founder in founders[:2]:  # limit to top 2 founders
            name = _clean(founder.get("name"))
            if not name:
                continue

            # General founder background
            queries.append(f"{name} startup founder background")

            # Parse prior companies from background string and notable_roles list
            prior_companies = []
            background = _clean(founder.get("background", ""))
            notable    = founder.get("notable_roles") or []

            # Extract company names from notable_roles (e.g. "VP Eng at Palantir" → "Palantir")
            for role in notable:
                role = str(role)
                if " at " in role:
                    co = role.split(" at ")[-1].strip()
                    if _clean(co):
                        prior_companies.append(co)

            # Targeted search: founder name + each prior company (up to 1 per founder)
            for prior_co in prior_companies[:1]:
                queries.append(f"{name} {prior_co}")

            # Prior company exit/outcome search (up to 1 per founder)
            for prior_co in prior_companies[:1]:
                queries.append(f"{prior_co} acquisition exit funding raised")

    return queries[:8]  # hard cap — 8 searches max


def run_searches(company: str, claims: dict) -> str:
    queries   = build_search_queries(company, claims)
    all_parts = []
    for i, query in enumerate(queries):
        if i > 0:
            time.sleep(1.5)  # Brave API rate limit
        print(f"  Searching: {query}")
        try:
            result = deep_search(query, n_fetch=2, pipeline="dd", agent="qualitative")
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


# ── Main ──────────────────────────────────────────────────────────────────────

def run(company: str) -> dict:
    safe_name   = company.replace(" ", "_").replace("/", "-")
    company_dir = WORKDIR / safe_name
    output_dir  = company_dir / "agents"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "qualitative.json"

    print(f"\nQualitative Agent: {company}")
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

    # ── Pass 1: Extract team claims ───────────────────────────────────────────
    pitch_text   = combine_docs(by_type.get("pitch_deck",  []), "pitch_deck")
    bio_text     = combine_docs(by_type.get("team_bio",    []), "team_bio")
    qa_text      = combine_docs(by_type.get("investor_qa", []), "investor_qa")
    claims_text  = "\n\n".join(filter(None, [bio_text, pitch_text, qa_text]))

    if claims_text:
        claims = run_pass("Extract team claims (bios + pitch + Q&A)",
                          QUALITATIVE_EXTRACT_CLAIMS.format(text=claims_text))
    else:
        claims = {"_missing": True}
        print("  Pass: Extract claims — SKIPPED (no team docs or pitch deck)")

    # ── Pass 1b: Org assessment (preliminary diligence checklist) ─────────────
    if claims_text:
        org_assessment = run_pass("Org assessment (preliminary diligence checklist)",
                                  QUALITATIVE_ORG_ASSESSMENT.format(
                                      company=company,
                                      text=claims_text,
                                  ))
    else:
        org_assessment = {"_missing": True}
        print("  Pass: Org assessment — SKIPPED (no documents)")

    # ── Web searches ──────────────────────────────────────────────────────────
    print("\nRunning web searches...")
    search_text = run_searches(company, claims)

    # Enrich with LinkedIn profiles via Proxycurl
    linkedin_data = enrich_linkedin_profiles(claims_text)
    if linkedin_data:
        search_text += "\n\n" + linkedin_data
    print(f"  {len(search_text):,} chars gathered ({int(time.time() - start)}s)")

    # ── Pass 2: Reconcile claims vs web research ──────────────────────────────
    print("\nReconciling...")
    reconcile_prompt = QUALITATIVE_RECONCILE.format(
        company      = company,
        claims       = json.dumps(claims, indent=2),
        web_research = search_text[:15000],
    )
    reconciled = run_pass("Reconcile team claims vs research", reconcile_prompt)

    # ── Package output ────────────────────────────────────────────────────────
    findings = reconciled.get("findings", []) if isinstance(reconciled, dict) else []
    summary  = reconciled.get("summary",  "") if isinstance(reconciled, dict) else ""

    # Merge org assessment findings
    checklist_coverage = {}
    if isinstance(org_assessment, dict) and "findings" in org_assessment:
        findings.extend(org_assessment.get("findings", []))
        checklist_coverage = org_assessment.get("checklist_coverage", {})

    flags = [f for f in findings if isinstance(f, dict) and f.get("flag")]

    # Flag if no team documents at all
    if not claims_text:
        missing = {
            "id":          f"qualitative_{len(findings)+1:03d}",
            "topic":       "missing_document",
            "claimed":     None,
            "our_finding": "No team bios or pitch deck found — cannot assess founder background",
            "delta":       None,
            "sources":     [],
            "verdict":     "not_found",
            "confidence":  "high",
            "flag":        True,
            "flag_reason": "No team documentation in dataroom. Request founder bios before IC.",
        }
        findings.append(missing)
        flags.append(missing)

    searches_run = len(build_search_queries(company, claims))
    status       = "failed" if not findings else ("partial" if not claims_text else "complete")

    result = {
        "company":  company,
        "date":     datetime.now().strftime("%Y-%m-%d"),
        "agent":    "qualitative",
        "status":   status,
        "findings": findings,
        "flags":    flags,
        "summary":  summary,
        "checklist_coverage": checklist_coverage,
        "meta": {
            "docs_read":        sum(len(v) for v in by_type.values()),
            "searches_run":     searches_run,
            "search_chars":     len(search_text),
            "passes_run":       sum([bool(claims_text), bool(claims_text), True]),
            "has_org_assessment": bool(claims_text),
            "total_seconds":    int(time.time() - start),
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
        "agent":    "qualitative",
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

    if result.get("checklist_coverage"):
        print("\nChecklist coverage:")
        for section, status in result["checklist_coverage"].items():
            print(f"  {section}: {status}")

    if result.get("summary"):
        print(f"\nSummary:\n{result['summary'][:400]}")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DD Qualitative Agent")
    parser.add_argument("company", help="Company name (e.g. 'Dyna Robotics')")
    args = parser.parse_args()
    run(args.company)
