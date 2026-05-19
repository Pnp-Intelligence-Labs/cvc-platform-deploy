"""
overview/agent.py — Overview Bot: IC memo synthesis.

Reads all specialist agent outputs and produces a structured IC memo
with cross-agent signal detection and full methodology traceability.

Two-pass approach:
    Pass 1 — Cross-agent signal detection (compounding risks, reinforcing
              signals, contradictions across agents)
    Pass 2 — IC memo synthesis (one-liner, key metrics, thesis, section
              summaries, IC questions, recommendation)

Flag consolidation is done in Python (deterministic) before any LLM call.
Every IC question and flag traces back to its source agent + finding ID.

Input:  workdir/[company]/agents/*.json (all specialist outputs)
Output: workdir/[company]/overview.json

Run:
    python3 -m overview.agent "Dyna Robotics"
"""

import json
import time
import argparse
from datetime import datetime

# ── Path setup ────────────────────────────────────────────────────────────────
from config.settings import WORKDIR, LLM_MODEL, LLM_TIMEOUT, LLM_MAX_TOKENS, OVERVIEW_LLM_MODEL
from config.prompts import OVERVIEW_CROSS_SIGNALS, OVERVIEW_SYNTHESIZE
from llm.openrouter import call as llm_call

# ── Agent names and load order ────────────────────────────────────────────────
AGENTS = ["financials", "comp", "qualitative", "product", "news"]


# ── Load agent outputs ────────────────────────────────────────────────────────

def load_agent_outputs(company: str, version: str = None) -> dict[str, dict]:
    """
    Load all available specialist agent JSON outputs.
    Missing agents are represented as {"status": "missing", "findings": [], ...}.
    version: None = v1 (agents/), "v2" = reconciler output (agents_v2/)
    """
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
                outputs[agent] = _missing_agent(agent, "JSON parse error")
        else:
            outputs[agent] = _missing_agent(agent, "Output file not found — agent not run")

    return outputs


def _missing_agent(agent: str, reason: str) -> dict:
    return {
        "agent":    agent,
        "status":   "missing",
        "findings": [],
        "flags":    [],
        "summary":  f"[{agent} not run: {reason}]",
    }


# ── Flag consolidation (Python — deterministic) ───────────────────────────────

def consolidate_flags(outputs: dict[str, dict]) -> list[dict]:
    """
    Pull all flags from all agent outputs and enrich each with:
      - agent name
      - severity (red if verdict=contradicts_claim or confidence=high, else yellow)
    Sorted: red first, then by agent order.
    """
    all_flags = []
    for agent in AGENTS:
        agent_data = outputs.get(agent, {})
        for f in agent_data.get("flags", []):
            if not isinstance(f, dict):
                continue
            enriched = {
                "severity":    _flag_severity(f),
                "agent":       agent,
                "finding_id":  f.get("id", ""),
                "topic":       f.get("topic", ""),
                "claimed":     f.get("claimed"),
                "our_finding": f.get("our_finding", ""),
                "delta":       f.get("delta"),
                "flag_reason": f.get("flag_reason", ""),
                "verdict":     f.get("verdict", ""),
                "confidence":  f.get("confidence", ""),
            }
            all_flags.append(enriched)

    # Sort: red first, then preserve agent order
    return sorted(all_flags, key=lambda f: (0 if f["severity"] == "red" else 1))


def _flag_severity(finding: dict) -> str:
    """Red if contradicts_claim + high confidence, or explicitly marked critical. Otherwise yellow."""
    verdict    = finding.get("verdict", "")
    confidence = finding.get("confidence", "")
    if verdict == "contradicts_claim" and confidence == "high":
        return "red"
    if finding.get("topic") in ("missing_document",):
        return "red"
    return "yellow"


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
    raw     = llm_call(prompt, model=OVERVIEW_LLM_MODEL, temperature=0.1,
                       max_tokens=LLM_MAX_TOKENS, timeout=LLM_TIMEOUT, activity="DD Pipeline")
    elapsed = int(time.time() - start)
    result  = extract_json(raw)
    status  = "error" if isinstance(result, dict) and "error" in result else "ok"
    print(f"    {status} ({elapsed}s)")
    return result


# ── Scorecard (Python — deterministic, no LLM) ───────────────────────────────

def build_scorecard(outputs: dict) -> dict:
    """
    Aggregate scores from specialist agents into a single scorecard.
    - Tech score: from product agent (tech assessment pass)
    - Business model + growth benchmark: from financials agent
    - Checklist coverage: from qualitative agent
    - Scored findings tally: any finding with a non-null score field
    """
    scorecard = {}

    # Tech score (product agent)
    product_out  = outputs.get("product", {})
    tech_score   = product_out.get("tech_score", {})
    tech_total   = tech_score.get("total")
    tech_max     = tech_score.get("max_possible", 126)
    if tech_total is not None:
        pct   = round((tech_total / tech_max) * 100) if tech_max else 0
        grade = _score_grade(pct)
        scorecard["tech_score"] = {
            "total":          tech_total,
            "max_possible":   tech_max,
            "percentage":     pct,
            "grade":          grade,
            "section_scores": tech_score.get("section_scores", {}),
        }
    else:
        scorecard["tech_score"] = {"grade": "N/A", "note": "No investor Q&A — tech assessment not run"}

    # Business model + growth benchmark (financials agent)
    fin_out = outputs.get("financials", {})
    scorecard["business_model"]   = fin_out.get("business_model", "unknown")
    scorecard["growth_benchmark"] = fin_out.get("meta", {}).get("growth_benchmark", "not determined")

    # Checklist coverage (qualitative agent)
    qual_out = outputs.get("qualitative", {})
    scorecard["checklist_coverage"] = qual_out.get("checklist_coverage", {})

    # Tally all non-null scores across every agent's findings
    total_points = 0
    scored_count = 0
    for agent_data in outputs.values():
        for finding in agent_data.get("findings", []):
            if isinstance(finding, dict) and finding.get("score") is not None:
                total_points += finding["score"]
                scored_count += 1
    if scored_count:
        scorecard["scored_findings"] = {"count": scored_count, "total_points": total_points}

    return scorecard


def _score_grade(pct: int) -> str:
    if pct >= 80: return "A"
    if pct >= 65: return "B"
    if pct >= 50: return "C"
    if pct >= 35: return "D"
    return "F"


def _scorecard_str(scorecard: dict) -> str:
    """Format scorecard as readable text for the LLM prompt."""
    lines = []
    ts = scorecard.get("tech_score", {})
    if ts.get("total") is not None:
        lines.append(f"Tech Score: {ts['total']} / {ts['max_possible']} ({ts['percentage']}% — Grade {ts['grade']})")
        for section, s in ts.get("section_scores", {}).items():
            lines.append(f"  {section}: {s.get('score', '?')} / {s.get('max_possible', '?')}")
    else:
        lines.append(f"Tech Score: {ts.get('note', 'N/A')}")

    lines.append(f"Business Model: {scorecard.get('business_model', 'unknown')}")
    lines.append(f"Growth Benchmark: {scorecard.get('growth_benchmark', 'not determined')}")

    cc = scorecard.get("checklist_coverage", {})
    if cc:
        lines.append("Checklist Coverage:")
        for section, status in cc.items():
            lines.append(f"  {section}: {status}")

    sf = scorecard.get("scored_findings", {})
    if sf:
        lines.append(f"Scored Findings: {sf['count']} scored, {sf['total_points']:+d} total points")

    return "\n".join(lines) if lines else "No scorecard data available"


# ── Prompt helpers ────────────────────────────────────────────────────────────

def _summary(outputs: dict, agent: str) -> str:
    return outputs.get(agent, {}).get("summary", f"[{agent} not available]")


def _summary_from_findings(outputs: dict, agent: str) -> str:
    """
    Build agent context from individual findings instead of the stale top-level summary.
    Used in v2 mode so the LLM sees reconciler-corrected finding text, not the original summary.
    Each finding is listed with its topic, corrected our_finding, verdict, and flag status.
    """
    data = outputs.get(agent, {})
    findings = data.get("findings", [])
    if not findings:
        return f"[{agent} not available]"

    lines = []
    for f in findings:
        if not isinstance(f, dict):
            continue
        topic      = f.get("topic", "unknown")
        finding    = f.get("our_finding", "")
        verdict    = f.get("verdict", "")
        flagged    = f.get("flag", False)

        # Label reconciler-modified findings so the LLM knows they are corrected
        tag = ""
        if verdict == "reconciler_corrected":
            tag = " [CORRECTED BY REVIEWER]"
        elif verdict == "reconciler_amended":
            tag = " [AMENDED BY REVIEWER]"
        elif flagged:
            tag = " [FLAGGED]"

        lines.append(f"- {topic}{tag}: {finding}")

    return "\n".join(lines) if lines else f"[{agent} — no findings]"


def _flags_str(outputs: dict, agent: str) -> str:
    flags = outputs.get(agent, {}).get("flags", [])
    if not flags:
        return "None"
    lines = []
    for f in flags:
        fid    = f.get("id", "?")
        topic  = f.get("topic", "?")
        reason = f.get("flag_reason", "")
        lines.append(f"  [{fid}] {topic}: {reason}")
    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def run(company: str, version: str = None) -> dict:
    safe_name   = company.replace(" ", "_").replace("/", "-")
    company_dir = WORKDIR / safe_name
    suffix      = f"_{version}" if version else ""
    output_path = company_dir / f"overview{suffix}.json"

    label = f"Overview Bot: {company}" + (f" [{version}]" if version else "")
    print(f"\n{label}")
    print("=" * 50)

    start = time.time()

    # ── Load all specialist outputs ───────────────────────────────────────────
    outputs = load_agent_outputs(company, version=version)
    available = [a for a in AGENTS if outputs[a].get("status") != "missing"]
    missing   = [a for a in AGENTS if outputs[a].get("status") == "missing"]

    print(f"\nAgents loaded: {', '.join(available)}")
    if missing:
        print(f"Missing agents: {', '.join(missing)}")

    if not available:
        print("Error: no specialist outputs found. Run specialist agents first.")
        result = _error_output(company, "No specialist agent outputs found", start)
        output_path.write_text(json.dumps(result, indent=2))
        return result

    # ── Consolidate flags + build scorecard (Python — deterministic) ─────────
    print("\nConsolidating flags...")
    all_flags    = consolidate_flags(outputs)
    red_count    = sum(1 for f in all_flags if f["severity"] == "red")
    yellow_count = sum(1 for f in all_flags if f["severity"] == "yellow")
    print(f"  {len(all_flags)} flags total: {red_count} red, {yellow_count} yellow")

    scorecard = build_scorecard(outputs)
    ts = scorecard.get("tech_score", {})
    if ts.get("total") is not None:
        print(f"  Tech score: {ts['total']} / {ts['max_possible']} (Grade {ts['grade']})")

    # ── Build agent context for LLM prompts ──────────────────────────────────
    # v2: build context from corrected individual findings (not stale top-level summary)
    # v1: use top-level summary as before
    _ctx = _summary_from_findings if version == "v2" else _summary

    # ── Pass 1: Cross-agent signal detection ──────────────────────────────────
    print("\nDetecting cross-agent signals...")
    if version == "v2":
        print("  (v2 mode: using corrected findings as context)")
    cross_prompt = OVERVIEW_CROSS_SIGNALS.format(
        company             = company,
        financials_summary  = _ctx(outputs, "financials"),
        comp_summary        = _ctx(outputs, "comp"),
        qualitative_summary = _ctx(outputs, "qualitative"),
        product_summary     = _ctx(outputs, "product"),
        news_summary        = _ctx(outputs, "news"),
        financials_flags    = _flags_str(outputs, "financials"),
        comp_flags          = _flags_str(outputs, "comp"),
        qualitative_flags   = _flags_str(outputs, "qualitative"),
        product_flags       = _flags_str(outputs, "product"),
        news_flags          = _flags_str(outputs, "news"),
    )
    cross_signals = run_pass("Cross-agent signal detection", cross_prompt)
    if not isinstance(cross_signals, list):
        cross_signals = []

    print(f"  {len(cross_signals)} cross-agent signals identified")

    # ── Pass 2: IC memo synthesis ─────────────────────────────────────────────
    print("\nSynthesizing IC memo...")
    synth_prompt = OVERVIEW_SYNTHESIZE.format(
        company             = company,
        financials_summary  = _ctx(outputs, "financials"),
        comp_summary        = _ctx(outputs, "comp"),
        qualitative_summary = _ctx(outputs, "qualitative"),
        product_summary     = _ctx(outputs, "product"),
        news_summary        = _ctx(outputs, "news"),
        scorecard           = _scorecard_str(scorecard),
        cross_signals       = json.dumps(cross_signals, indent=2),
        all_flags           = json.dumps(all_flags[:20], indent=2),  # cap at 20
    )
    memo = run_pass("IC memo synthesis", synth_prompt)

    # ── Package output ────────────────────────────────────────────────────────
    if not isinstance(memo, dict) or "error" in memo:
        result = _error_output(company, memo.get("error", "Synthesis failed"), start)
        output_path.write_text(json.dumps(result, indent=2))
        return result

    result = {
        "company":  company,
        "date":     datetime.now().strftime("%Y-%m-%d"),
        "agent":    "overview",
        "status":   "complete" if available else "failed",

        # IC memo content (from LLM)
        "one_liner":                memo.get("one_liner", ""),
        "stage":                    memo.get("stage", ""),
        "raise_amount":             memo.get("raise_amount", ""),
        "valuation_ask":            memo.get("valuation_ask", ""),
        "sector":                   memo.get("sector", ""),
        "key_metrics":              memo.get("key_metrics", {}),
        "investment_thesis":        memo.get("investment_thesis", ""),
        "section_summaries":        memo.get("section_summaries", {}),
        "ic_questions":             memo.get("ic_questions", []),
        "recommendation":           memo.get("recommendation", ""),
        "recommendation_rationale": memo.get("recommendation_rationale", ""),
        "summary":                  memo.get("summary", ""),

        # Scorecard
        "scorecard":           scorecard,

        # Cross-agent signals and consolidated flags (methodology trace)
        "cross_agent_signals": cross_signals,
        "all_flags":           all_flags,

        "meta": {
            "agents_used":    available,
            "agents_missing": missing,
            "total_flags":    len(all_flags),
            "red_flags":      red_count,
            "yellow_flags":   yellow_count,
            "cross_signals":  len(cross_signals),
            "passes_run":     2,
            "total_seconds":  int(time.time() - start),
            "version":        version or "v1",
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
        "agent":    "overview",
        "status":   "failed",
        "error":    error,
        "meta":     {"total_seconds": int(time.time() - start)},
    }


def _print_summary(result: dict):
    rec       = result.get("recommendation", "")
    summary   = result.get("summary", "")
    flags     = result.get("all_flags", [])
    signals   = result.get("cross_agent_signals", [])
    qs        = result.get("ic_questions", [])
    scorecard = result.get("scorecard", {})

    # Print scorecard first
    ts = scorecard.get("tech_score", {})
    if ts.get("total") is not None:
        print(f"\nTech Score:  {ts['total']} / {ts['max_possible']}  (Grade {ts['grade']})")
        for section, s in ts.get("section_scores", {}).items():
            bar = "#" * max(0, s.get("score", 0)) if s.get("score", 0) > 0 else ""
            print(f"  {section:<20} {s.get('score', 0):>4} / {s.get('max_possible', 0):<4}  {bar}")
    bm = scorecard.get("business_model")
    if bm:
        print(f"Business Model: {bm}  |  Growth benchmark: {scorecard.get('growth_benchmark', '—')}")
    cc = scorecard.get("checklist_coverage", {})
    if cc:
        coverage_str = "  ".join(f"{k}: {v}" for k, v in cc.items())
        print(f"Checklist: {coverage_str}")

    print(f"\nRecommendation: {rec.upper()}")
    print(f"Flags: {len(flags)} ({sum(1 for f in flags if f.get('severity')=='red')} red)")
    print(f"Cross-agent signals: {len(signals)}")
    print(f"IC questions: {len(qs)}")

    red_signals = [s for s in signals if s.get("severity") == "red"]
    if red_signals:
        print("\nRed cross-agent signals:")
        for s in red_signals:
            print(f"  {s.get('headline', '')}")

    high_qs = [q for q in qs if q.get("priority") == "high"]
    if high_qs:
        print(f"\nHigh-priority IC questions ({len(high_qs)}):")
        for q in high_qs:
            print(f"  [{', '.join(q.get('source_agents', []))}] {q.get('question', '')}")

    if summary:
        print(f"\nSummary:\n{summary[:500]}")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DD Overview Bot")
    parser.add_argument("company", help="Company name (e.g. 'Dyna Robotics')")
    args = parser.parse_args()
    run(args.company)
