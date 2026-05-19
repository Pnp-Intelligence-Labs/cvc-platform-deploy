"""
appendix/agent.py — Appendix Bot: raw findings aggregator.

Reads all specialist agent outputs and produces a structured appendix.json
with full raw findings, sources, and methodology trace for each agent.
No LLM involved — deterministic data aggregation only.

The appendix is rendered separately from the IC Memo by the Format Bot,
keeping the main document clean while preserving full methodology traceability.

Sections:
    - Per-agent findings detail (all findings, not just flags)
    - All sources cited across agents
    - Cross-agent signals (from overview.json)
    - Methodology trace (docs processed, searches run, LLM passes, timing)
    - Pipeline run metadata

Input:  workdir/[company]/agents/*.json  +  workdir/[company]/overview.json
Output: workdir/[company]/appendix.json

Run:
    python3 -m appendix.agent "Dyna Robotics"
"""

import json
import time
import argparse
from datetime import datetime

# ── Path setup ────────────────────────────────────────────────────────────────
from config.settings import WORKDIR

# ── Agent display names ───────────────────────────────────────────────────────
AGENTS = ["financials", "comp", "qualitative", "product", "news"]

AGENT_TITLES = {
    "financials":  "Financials",
    "comp":        "Market & Competitive",
    "qualitative": "Team & Founders",
    "product":     "Product & Technology",
    "news":        "News & Press",
}

AGENT_MENTAL_MODELS = {
    "financials":  "Is the financial story real and fundable? Where are the gaps?",
    "comp":        "Does this market exist, is the timing right, and can they win?",
    "qualitative": "Who are these founders? Have they done this before?",
    "product":     "Is the technology real, defensible, and differentiated?",
    "news":        "What does the public record say about this company?",
}


# ── Loaders ───────────────────────────────────────────────────────────────────

def load_agent_outputs(company: str, version: str = None) -> dict[str, dict]:
    safe_name  = company.replace(" ", "_").replace("/", "-")
    subdir     = "agents_v2" if version == "v2" else "agents"
    agents_dir = WORKDIR / safe_name / subdir
    outputs    = {}
    for agent in AGENTS:
        path = agents_dir / f"{agent}.json"
        if path.exists():
            try:
                outputs[agent] = json.loads(path.read_text())
            except json.JSONDecodeError:
                outputs[agent] = _missing(agent, "JSON parse error")
        else:
            outputs[agent] = _missing(agent, "Agent not run")
    return outputs


def load_overview(company: str, version: str = None) -> dict:
    safe_name = company.replace(" ", "_").replace("/", "-")
    suffix    = f"_{version}" if version else ""
    path      = WORKDIR / safe_name / f"overview{suffix}.json"
    if path.exists():
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def _missing(agent: str, reason: str) -> dict:
    return {
        "agent":    agent,
        "status":   "missing",
        "findings": [],
        "flags":    [],
        "summary":  f"[{agent} not run: {reason}]",
        "meta":     {},
    }


# ── Section builders ──────────────────────────────────────────────────────────

def build_agent_sections(outputs: dict[str, dict]) -> list[dict]:
    """Build per-agent detail sections for the appendix."""
    sections = []
    for agent in AGENTS:
        data = outputs.get(agent, {})
        if data.get("status") == "missing":
            continue

        findings = data.get("findings", [])
        flags    = [f for f in findings if isinstance(f, dict) and f.get("flag")]

        # Categorize findings by verdict
        by_verdict: dict[str, list] = {}
        for f in findings:
            if not isinstance(f, dict):
                continue
            v = f.get("verdict", "unknown")
            by_verdict.setdefault(v, []).append(f)

        sections.append({
            "agent":        agent,
            "title":        AGENT_TITLES.get(agent, agent.title()),
            "mental_model": AGENT_MENTAL_MODELS.get(agent, ""),
            "status":       data.get("status", "unknown"),
            "summary":      data.get("summary", ""),
            "findings":     findings,
            "flags":        flags,
            "by_verdict":   by_verdict,
            "meta":         data.get("meta", {}),
        })

    return sections


def collect_all_sources(outputs: dict[str, dict]) -> list[dict]:
    """Collect every source cited across all agents, deduplicated by URL."""
    seen_urls = set()
    all_sources = []
    for agent in AGENTS:
        data = outputs.get(agent, {})
        for finding in data.get("findings", []):
            if not isinstance(finding, dict):
                continue
            for src in finding.get("sources", []):
                if not isinstance(src, dict):
                    continue
                url = src.get("url", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    all_sources.append({
                        "agent":       agent,
                        "finding_id":  finding.get("id", ""),
                        "topic":       finding.get("topic", ""),
                        "title":       src.get("title", ""),
                        "url":         url,
                        "date":        src.get("date", ""),
                    })
    return all_sources


def build_methodology(outputs: dict[str, dict], overview: dict) -> dict:
    """Aggregate pipeline run methodology and timing."""
    agent_meta = {}
    total_docs    = 0
    total_searches = 0
    total_passes  = 0
    total_seconds = 0

    for agent in AGENTS:
        data = outputs.get(agent, {})
        meta = data.get("meta", {})
        agent_meta[agent] = meta
        total_docs     += meta.get("docs_read",    0)
        total_searches += meta.get("searches_run", 0)
        total_passes   += meta.get("passes_run",   0)
        total_seconds  += meta.get("total_seconds", 0)

    overview_meta = overview.get("meta", {})
    total_passes  += overview_meta.get("passes_run", 0)

    return {
        "total_docs_processed": total_docs,
        "total_web_searches":   total_searches,
        "total_llm_passes":     total_passes,
        "total_pipeline_seconds": total_seconds,
        "agents": agent_meta,
        "models_used": {
            "primary": "qwen/qwen3-235b-a22b-2507 (OpenRouter)",
            "fallback": "qwen3.5:27b (Ollama local)",
        },
        "flag_severity_rules": {
            "red":    "contradicts_claim + high confidence, OR missing_document topic",
            "yellow": "all other flagged findings",
        },
        "verdict_taxonomy": {
            "confirmed":         "Claim verified by independent sources",
            "contradicts_claim": "Evidence contradicts or significantly differs from claim",
            "unverified_claim":  "Claim made but could not be independently verified",
            "no_claim":          "Our finding, no corresponding company claim",
            "not_found":         "Searched but found nothing relevant",
        },
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def run(company: str, version: str = None) -> dict:
    safe_name   = company.replace(" ", "_").replace("/", "-")
    company_dir = WORKDIR / safe_name
    suffix      = f"_{version}" if version else ""
    output_path = company_dir / f"appendix{suffix}.json"

    label = f"Appendix Bot: {company}" + (f" [{version}]" if version else "")
    print(f"\n{label}")
    print("=" * 50)

    start = time.time()

    outputs  = load_agent_outputs(company, version=version)
    overview = load_overview(company, version=version)

    available = [a for a in AGENTS if outputs[a].get("status") != "missing"]
    missing   = [a for a in AGENTS if outputs[a].get("status") == "missing"]
    print(f"Agents loaded: {', '.join(available)}")
    if missing:
        print(f"Missing: {', '.join(missing)}")

    # Count all findings and flags
    total_findings = sum(len(outputs[a].get("findings", [])) for a in available)
    total_flags    = sum(len(outputs[a].get("flags",    [])) for a in available)

    print(f"Total findings: {total_findings}  |  Total flags: {total_flags}")

    # Build sections
    agent_sections = build_agent_sections(outputs)
    all_sources    = collect_all_sources(outputs)
    methodology    = build_methodology(outputs, overview)

    result = {
        "company":  company,
        "date":     datetime.now().strftime("%Y-%m-%d"),
        "agent":    "appendix",
        "status":   "complete" if available else "failed",

        # Overview cross-agent signals (for reference)
        "cross_agent_signals": overview.get("cross_agent_signals", []),
        "all_flags":           overview.get("all_flags", []),

        # Per-agent detail sections
        "agent_sections": agent_sections,

        # All sources cited
        "sources": all_sources,

        # Methodology trace
        "methodology": methodology,

        "meta": {
            "agents_used":      available,
            "agents_missing":   missing,
            "total_findings":   total_findings,
            "total_flags":      total_flags,
            "total_sources":    len(all_sources),
            "total_seconds":    int(time.time() - start),
        },
    }

    output_path.write_text(json.dumps(result, indent=2))
    print(f"\nOutput: {output_path}")
    print(f"  {total_findings} findings  |  {len(all_sources)} sources  |  "
          f"{len(agent_sections)} agent sections")

    return result


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DD Appendix Bot")
    parser.add_argument("company", help="Company name (e.g. 'Dyna Robotics')")
    args = parser.parse_args()
    run(args.company)
