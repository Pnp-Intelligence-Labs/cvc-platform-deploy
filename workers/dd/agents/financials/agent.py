"""
agents/financials/agent.py — Financials specialist agent.

Investor mental model:
    "Are the numbers real, consistent, and growing in the right direction?
    Where does the pitch diverge from the actual model?"

Multi-pass approach:
    Pass 1 — Extract claims from pitch deck
    Pass 2 — Extract actuals from financial model + statements
    Pass 3 — Extract customer contracts
    Pass 4 — Extract cap table
    Pass 5 — Reconcile claims vs actuals → produce findings

Input:  manifest.json (docs routed to 'financials' by ingestion bot)
Output: workdir/[company]/agents/financials.json

Run:
    python3 -m agents.financials.agent "Dyna Robotics"
"""

from pathlib import Path
import json
import time
import argparse
from datetime import datetime
from collections import defaultdict

# ── Path setup ────────────────────────────────────────────────────────────────
from config.settings import WORKDIR, LLM_MODEL, LLM_MODEL_LONG_CONTEXT, LLM_TIMEOUT, LLM_MAX_TOKENS
from config.prompts import (
    FINANCIALS_DETECT_MODEL,
    FINANCIALS_EXTRACT_CLAIMS,
    FINANCIALS_EXTRACT_ACTUALS,
    FINANCIALS_EXTRACT_MODEL_METRICS,
    FINANCIALS_EXTRACT_CONTRACTS,
    FINANCIALS_EXTRACT_CAP_TABLE,
    FINANCIALS_EXTRACT_INVESTOR_QA,
    FINANCIALS_RECONCILE,
)
from llm.openrouter import call as llm_call


# ── Text limits per doc type (chars) ─────────────────────────────────────────
TEXT_LIMITS = {
    "pitch_deck":          10000,
    "financial_model":     150000,  # CSV format is compact — need room for full model
    "financial_statement": 20000,
    "customer_contract":   8000,
    "cap_table":           8000,
    "investor_qa":         8000,
}
DEFAULT_TEXT_LIMIT      = 10000
MAX_TOTAL_DOC_CHARS     = 80_000   # default total budget per combine_docs call
MAX_FINANCIAL_DOC_CHARS = 150_000  # higher budget for financial model passes


# ── Document loading ──────────────────────────────────────────────────────────

def load_manifest(company: str) -> dict:
    safe_name     = company.replace(" ", "_").replace("/", "-")
    manifest_path = WORKDIR / safe_name / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}\nRun ingestion first.")
    return json.loads(manifest_path.read_text())


def load_docs_by_type(manifest: dict) -> dict[str, list[dict]]:
    """
    Returns docs routed to financials, grouped by doc_type.
    Each doc has: filename, doc_type, text_path, conversion status.
    """
    agent_docs = manifest.get("routing", {}).get("financials", [])
    by_type    = defaultdict(list)
    for doc in agent_docs:
        by_type[doc["doc_type"]].append(doc)
    return dict(by_type)


def read_doc_text(doc: dict, max_chars: int) -> str:
    path = Path(doc.get("text_path", ""))
    if not path.exists():
        return ""
    return path.read_text(errors="ignore")[:max_chars]


def combine_docs(docs: list[dict], doc_type: str, max_total: int = MAX_TOTAL_DOC_CHARS) -> str:
    """Combine text from multiple docs with a total char budget to avoid prompt overflow."""
    base_limit = TEXT_LIMITS.get(doc_type, DEFAULT_TEXT_LIMIT)
    if not docs:
        return ""
    # Distribute budget evenly, but don't exceed per-doc limit
    per_doc_limit = min(base_limit, max(2000, max_total // len(docs)))
    parts = []
    for doc in docs:
        text = read_doc_text(doc, per_doc_limit)
        if text:
            parts.append(f"--- {doc['filename']} ---\n{text}")
    return "\n\n".join(parts)


# ── JSON extraction helper ─────────────────────────────────────────────────────

def extract_json(text: str) -> dict | list:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text  = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find outermost JSON structure
        for start_char, end_char in [('{', '}'), ('[', ']')]:
            start = text.find(start_char)
            end   = text.rfind(end_char) + 1
            if start >= 0 and end > start:
                try:
                    return json.loads(text[start:end])
                except json.JSONDecodeError:
                    pass
    return {"error": "Failed to parse LLM response", "raw": text[:500]}


# ── Pass failure detection ────────────────────────────────────────────────────

def pass_failed(result) -> bool:
    """True if an upstream pass returned a parse error instead of real data."""
    return isinstance(result, dict) and "error" in result


# ── LLM call wrapper ──────────────────────────────────────────────────────────

def run_pass(pass_name: str, prompt: str, model: str = LLM_MODEL) -> dict | list:
    print(f"  Pass: {pass_name} [{model.split('/')[-1]}]...")
    start    = time.time()
    raw      = llm_call(prompt, model=model, temperature=0.1,
                        max_tokens=LLM_MAX_TOKENS, timeout=LLM_TIMEOUT, activity="DD Pipeline")
    elapsed  = int(time.time() - start)
    result   = extract_json(raw)
    status   = "error" if isinstance(result, dict) and "error" in result else "ok"
    print(f"    {status} ({elapsed}s)")
    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def run(company: str) -> dict:
    safe_name   = company.replace(" ", "_").replace("/", "-")
    company_dir = WORKDIR / safe_name
    output_dir  = company_dir / "agents"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "financials.json"

    print(f"\nFinancials Agent: {company}")
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

    today = datetime.now().strftime("%Y-%m-%d")

    # ── Pass 0: Detect business model ─────────────────────────────────────────
    pitch_text = combine_docs(by_type.get("pitch_deck", []), "pitch_deck")
    if pitch_text:
        business_model_raw = run_pass("Detect business model",
                                      FINANCIALS_DETECT_MODEL.format(text=pitch_text))
        model_type       = business_model_raw.get("model_type", "other") if isinstance(business_model_raw, dict) else "other"
        growth_benchmark = business_model_raw.get("benchmark_growth_target", "not determined") if isinstance(business_model_raw, dict) else "not determined"
        print(f"    Model type: {model_type} | Benchmark: {growth_benchmark}")
    else:
        business_model_raw = {"model_type": "other"}
        model_type         = "other"
        growth_benchmark   = "not determined"

    # ── Pass 1: Claims from pitch deck ────────────────────────────────────────
    if pitch_text:
        claims = run_pass("Extract claims (pitch deck)",
                          FINANCIALS_EXTRACT_CLAIMS.format(text=pitch_text))
    else:
        claims = {"_missing": True}
        print("  Pass: Extract claims — SKIPPED (no pitch deck)")

    # ── Pass 2: Actuals from financial model + statements ─────────────────────
    fin_docs  = by_type.get("financial_model", []) + by_type.get("financial_statement", [])
    fin_text  = combine_docs(fin_docs, "financial_model", max_total=MAX_FINANCIAL_DOC_CHARS)
    if fin_text:
        actuals = run_pass("Extract actuals (financial model/statements)",
                           FINANCIALS_EXTRACT_ACTUALS.format(
                               text=fin_text,
                               today=today,
                           ),
                           model=LLM_MODEL_LONG_CONTEXT)
    else:
        actuals = {"_missing": True}
        print("  Pass: Extract actuals — SKIPPED (no financial model or statements)")

    # ── Pass 2b: Model-specific metrics ───────────────────────────────────────
    if fin_text:
        model_metrics = run_pass(f"Extract model metrics ({model_type})",
                                 FINANCIALS_EXTRACT_MODEL_METRICS.format(
                                     text=fin_text,
                                     today=today,
                                     model_type=model_type,
                                 ),
                                 model=LLM_MODEL_LONG_CONTEXT)
    else:
        model_metrics = {"_missing": True}
        print("  Pass: Extract model metrics — SKIPPED (no financial documents)")

    # ── Pass 3: Customer contracts ────────────────────────────────────────────
    contract_text = combine_docs(by_type.get("customer_contract", []), "customer_contract")
    if contract_text:
        contracts = run_pass("Extract contracts",
                             FINANCIALS_EXTRACT_CONTRACTS.format(text=contract_text))
    else:
        contracts = []
        print("  Pass: Extract contracts — SKIPPED (no contracts)")

    # ── Pass 3b: Investor Q&A — financially relevant clarifications ──────────
    qa_text = combine_docs(by_type.get("investor_qa", []), "investor_qa")
    if qa_text:
        investor_qa = run_pass("Extract investor Q&A (financial)",
                               FINANCIALS_EXTRACT_INVESTOR_QA.format(text=qa_text))
    else:
        investor_qa = {"_missing": True}
        print("  Pass: Extract investor Q&A — SKIPPED (no Q&A docs)")

    # ── Pass 4: Cap table ─────────────────────────────────────────────────────
    cap_text = combine_docs(by_type.get("cap_table", []), "cap_table")
    if cap_text:
        cap_table = run_pass("Extract cap table",
                             FINANCIALS_EXTRACT_CAP_TABLE.format(text=cap_text))
    else:
        cap_table = {"_missing": True}
        print("  Pass: Extract cap table — SKIPPED (no cap table)")

    # ── Pre-revenue hardtech detection ────────────────────────────────────────
    # For moonshot/hardtech with no historical actuals, shift scoring to
    # milestones and pipeline rather than ARR/growth benchmarks
    actuals_available = (
        isinstance(actuals, dict)
        and not pass_failed(actuals)
        and actuals.get("actuals_available", True)
    )
    pre_revenue = (model_type == "moonshot_hardtech") and not actuals_available
    if pre_revenue:
        print("  Pre-revenue hardtech mode — shifting scoring to milestones + pipeline")

    # ── Upstream pass failure warnings ───────────────────────────────────────
    failed_passes = []
    if pass_failed(claims):        failed_passes.append("claims")
    if pass_failed(actuals):       failed_passes.append("actuals")
    if pass_failed(model_metrics): failed_passes.append("model_metrics")
    if pass_failed(cap_table):     failed_passes.append("cap_table")
    if failed_passes:
        print(f"  WARNING: Failed passes — {', '.join(failed_passes)}. Reconcile will have gaps.")

    # ── Pass 5: Reconcile → findings ─────────────────────────────────────────
    print("\nReconciling...")
    reconcile_prompt = FINANCIALS_RECONCILE.format(
        company          = company,
        business_model   = model_type,
        growth_benchmark = growth_benchmark,
        pre_revenue      = "true" if pre_revenue else "false",
        claims           = json.dumps(claims,       indent=2),
        actuals          = json.dumps(actuals,      indent=2),
        model_metrics    = json.dumps(model_metrics, indent=2),
        contracts        = json.dumps(contracts,    indent=2),
        cap_table        = json.dumps(cap_table,    indent=2),
        investor_qa      = json.dumps(investor_qa,  indent=2),
    )
    reconciled = run_pass("Reconcile claims vs actuals", reconcile_prompt,
                          model=LLM_MODEL_LONG_CONTEXT)

    # ── Package output ────────────────────────────────────────────────────────
    findings        = reconciled.get("findings", []) if isinstance(reconciled, dict) else []
    summary         = reconciled.get("summary", "") if isinstance(reconciled, dict) else ""
    financial_score = reconciled.get("financial_score", {}) if isinstance(reconciled, dict) else {}
    flags           = [f for f in findings if isinstance(f, dict) and f.get("flag")]

    # Flag missing critical documents as findings
    missing_flags = _missing_doc_findings(by_type, len(findings))
    findings.extend(missing_flags)
    flags.extend([f for f in missing_flags if f.get("flag")])

    status = "failed" if not findings else ("partial" if missing_flags else "complete")

    result = {
        "company":         company,
        "date":            datetime.now().strftime("%Y-%m-%d"),
        "agent":           "financials",
        "status":          status,
        "business_model":  model_type,
        "findings":        findings,
        "flags":           flags,
        "summary":         summary,
        "financial_score": financial_score,
        "meta": {
            "docs_read":         sum(len(v) for v in by_type.values()),
            "passes_run":        sum([
                bool(pitch_text), bool(fin_text),
                bool(contract_text), bool(qa_text), bool(cap_text), True
            ]),
            "failed_passes":     failed_passes,
            "pre_revenue_mode":  pre_revenue,
            "growth_benchmark":  growth_benchmark,
            "total_seconds":     int(time.time() - start),
        },
    }

    output_path.write_text(json.dumps(result, indent=2))
    print(f"\nOutput: {output_path}")
    _print_summary(result)

    return result


# ── Missing doc findings ──────────────────────────────────────────────────────

CRITICAL_DOCS = {
    "financial_model":     "Financial model not found in dataroom — cannot verify actuals",
    "pitch_deck":          "Pitch deck not found — cannot extract founder claims",
    "cap_table":           "Cap table not found — ownership structure unverified",
}

def _missing_doc_findings(by_type: dict, existing_count: int) -> list[dict]:
    missing = []
    i       = existing_count + 1
    for doc_type, message in CRITICAL_DOCS.items():
        if not by_type.get(doc_type):
            missing.append({
                "id":          f"financials_{i:03d}",
                "topic":       "missing_document",
                "claimed":     None,
                "our_finding": message,
                "delta":       None,
                "sources":     [],
                "verdict":     "not_found",
                "confidence":  "high",
                "flag":        True,
                "flag_reason": f"Critical document absent: {doc_type}. Request from founder before IC.",
            })
            i += 1
    return missing


# ── Output helpers ────────────────────────────────────────────────────────────

def _error_output(company: str, error: str, start: float) -> dict:
    return {
        "company":  company,
        "date":     datetime.now().strftime("%Y-%m-%d"),
        "agent":    "financials",
        "status":   "failed",
        "findings": [],
        "flags":    [],
        "summary":  "",
        "error":    error,
        "meta":     {"docs_read": 0, "passes_run": 0, "total_seconds": int(time.time() - start)},
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
    parser = argparse.ArgumentParser(description="DD Financials Agent")
    parser.add_argument("company", help="Company name (e.g. 'Dyna Robotics')")
    args = parser.parse_args()
    run(args.company)
