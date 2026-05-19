"""
agents/generalist/agent.py — Generalist triage agent.

Receives all documents the tagger could not classify (doc_type = 'unknown').
For each document, asks the LLM:
    1. What type of document is this?
    2. What is relevant here for a VC investment decision?

Does not re-route to specialist agents — surfaces findings directly for the
overview agent to incorporate as "Additional findings from unclassified documents."

Input:  manifest.json (docs routed to 'generalist' by ingestion bot)
Output: workdir/[company]/agents/generalist.json

Run:
    python3 -m agents.generalist.agent "Dyna Robotics"
"""

import json
import time
import argparse
from pathlib import Path
from datetime import datetime

from config.settings import WORKDIR, LLM_MODEL, LLM_TIMEOUT, LLM_MAX_TOKENS
from llm.openrouter import call as llm_call


MAX_CHARS_PER_DOC = 10_000

TRIAGE_PROMPT = """\
You are a venture capital analyst reviewing a document from a startup's dataroom.
This document was not automatically classified — your job is to triage it.

Document filename: {filename}

Document content:
{text}

Respond with a JSON object:
{{
  "inferred_type": "<what type of document this appears to be>",
  "relevance": "<high | medium | low | none>",
  "summary": "<2-4 sentence summary of what this document contains>",
  "vc_relevant_findings": [
    "<specific finding relevant to an investment decision>",
    ...
  ],
  "flags": [
    "<anything unusual, concerning, or that warrants follow-up>",
    ...
  ]
}}

Be concise. If the document contains no investment-relevant information, set relevance to "none" and leave findings and flags empty.
"""


def load_manifest(company: str) -> dict:
    safe          = company.replace(" ", "_").replace("/", "-")
    manifest_path = WORKDIR / safe / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}\nRun ingestion first.")
    return json.loads(manifest_path.read_text())


def read_doc_text(doc: dict, max_chars: int = MAX_CHARS_PER_DOC) -> str:
    path = Path(doc.get("text_path", ""))
    if not path.exists():
        return ""
    return path.read_text(errors="ignore")[:max_chars]


def extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text  = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
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
    return {"error": "Failed to parse LLM response", "raw": text[:500]}


def triage_document(doc: dict) -> dict:
    filename = doc.get("filename", "unknown")
    text     = read_doc_text(doc)

    if not text.strip():
        return {
            "filename":             filename,
            "inferred_type":        "empty_or_unreadable",
            "relevance":            "none",
            "summary":              "Document could not be read or was empty.",
            "vc_relevant_findings": [],
            "flags":                ["Document produced no readable text — may be image-only PDF or corrupt file."],
        }

    prompt = TRIAGE_PROMPT.format(filename=filename, text=text)
    start  = time.time()
    raw    = llm_call(prompt, model=LLM_MODEL, temperature=0.1,
                      max_tokens=LLM_MAX_TOKENS, timeout=LLM_TIMEOUT, activity="DD Pipeline")
    result = extract_json(raw)
    result["filename"]      = filename
    result["triage_seconds"] = int(time.time() - start)
    return result


def run(company: str) -> dict:
    safe        = company.replace(" ", "_").replace("/", "-")
    company_dir = WORKDIR / safe
    output_dir  = company_dir / "agents"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "generalist.json"

    print(f"\nGeneralist Agent: {company}")
    print("=" * 50)

    start = time.time()

    try:
        manifest = load_manifest(company)
    except FileNotFoundError as e:
        print(f"Error: {e}")
        result = _error_output(company, str(e), start)
        output_path.write_text(json.dumps(result, indent=2))
        return result

    unknown_docs = manifest.get("routing", {}).get("generalist", [])

    if not unknown_docs:
        print("  No unclassified documents — nothing to triage.")
        result = {
            "company":   company,
            "date":      datetime.now().strftime("%Y-%m-%d"),
            "agent":     "generalist",
            "status":    "complete",
            "doc_count": 0,
            "documents": [],
            "findings":  [],
            "flags":     [],
            "summary":   "No unclassified documents found in dataroom.",
            "meta":      {"docs_read": 0, "total_seconds": 0},
        }
        output_path.write_text(json.dumps(result, indent=2))
        return result

    print(f"  {len(unknown_docs)} unclassified document(s) to triage")

    triaged   = []
    all_flags = []

    for i, doc in enumerate(unknown_docs, 1):
        print(f"  [{i}/{len(unknown_docs)}] {doc.get('filename', '?')}...")
        doc_result = triage_document(doc)
        triaged.append(doc_result)

        relevance = doc_result.get("relevance", "none")
        n_findings = len(doc_result.get("vc_relevant_findings", []))
        n_flags    = len(doc_result.get("flags", []))
        print(f"    relevance={relevance}  findings={n_findings}  flags={n_flags}")

        for flag in doc_result.get("flags", []):
            all_flags.append({
                "source":   doc.get("filename", "?"),
                "flag":     flag,
            })

    # Aggregate findings across all triaged docs (relevance high/medium only)
    findings = []
    for doc_result in triaged:
        if doc_result.get("relevance") in ("high", "medium"):
            for f in doc_result.get("vc_relevant_findings", []):
                findings.append({
                    "source":  doc_result.get("filename", "?"),
                    "type":    doc_result.get("inferred_type", "unknown"),
                    "finding": f,
                })

    status = "complete" if triaged else "empty"

    result = {
        "company":   company,
        "date":      datetime.now().strftime("%Y-%m-%d"),
        "agent":     "generalist",
        "status":    status,
        "doc_count": len(unknown_docs),
        "documents": triaged,
        "findings":  findings,
        "flags":     all_flags,
        "summary":   _build_summary(triaged, findings, all_flags),
        "meta": {
            "docs_read":     len(unknown_docs),
            "total_seconds": int(time.time() - start),
        },
    }

    output_path.write_text(json.dumps(result, indent=2))
    print(f"\nOutput: {output_path}")
    print(f"  Triaged: {len(triaged)} docs | Findings: {len(findings)} | Flags: {len(all_flags)}")

    return result


def _build_summary(triaged: list, findings: list, flags: list) -> str:
    if not triaged:
        return "No unclassified documents found."
    high    = sum(1 for d in triaged if d.get("relevance") == "high")
    medium  = sum(1 for d in triaged if d.get("relevance") == "medium")
    low     = sum(1 for d in triaged if d.get("relevance") in ("low", "none"))
    parts   = [f"Triaged {len(triaged)} unclassified document(s)."]
    if high or medium:
        parts.append(f"{high} high-relevance, {medium} medium-relevance.")
    if findings:
        parts.append(f"{len(findings)} investment-relevant finding(s) surfaced.")
    if flags:
        parts.append(f"{len(flags)} flag(s) require follow-up.")
    if low == len(triaged):
        parts.append("No investment-relevant content found in unclassified documents.")
    return " ".join(parts)


def _error_output(company: str, error: str, start: float) -> dict:
    return {
        "company":  company,
        "date":     datetime.now().strftime("%Y-%m-%d"),
        "agent":    "generalist",
        "status":   "failed",
        "doc_count": 0,
        "documents": [],
        "findings": [],
        "flags":    [],
        "summary":  "",
        "error":    error,
        "meta":     {"docs_read": 0, "total_seconds": int(time.time() - start)},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DD Generalist Triage Agent")
    parser.add_argument("company", help="Company name (e.g. 'Dyna Robotics')")
    args = parser.parse_args()
    run(args.company)
