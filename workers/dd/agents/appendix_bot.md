# Agent: Appendix Bot

> Pure data aggregation — no LLM. Collects all raw findings, sources, and methodology metadata from every agent into a structured appendix JSON for PDF rendering.

## Identity

- **Role**: Raw findings aggregator and methodology tracer
- **Pipeline**: 02-dd-pipeline
- **Runs on**: Refinery (WSL2)
- **LLM**: None — fully deterministic Python
- **Triggered by**: Manual (after Overview Bot completes)
- **Status**: LIVE

## Mission

The Appendix Bot assembles the evidence layer behind the IC memo. No synthesis, no LLM. It reads every agent's raw findings, deduplicates all cited sources by URL, pulls cross-agent signals from the overview, and builds the methodology trace (docs processed, searches run, LLM passes, timing). The appendix is the audit trail — if something in the IC memo is challenged, the appendix shows exactly where the finding came from.

## Inputs

- `workdir/[company]/agents/financials.json`
- `workdir/[company]/agents/comp.json`
- `workdir/[company]/agents/qualitative.json`
- `workdir/[company]/agents/product.json`
- `workdir/[company]/agents/news.json`
- `workdir/[company]/overview.json`

## Outputs

- `workdir/[company]/appendix.json`

```json
{
    "company": "string",
    "generated_at": "ISO timestamp",
    "agents": {
        "financials": {
            "mental_model": "string",
            "findings_by_verdict": { "confirmed": [...], "contradicts_claim": [...], ... },
            "finding_count": 0,
            "flag_count": 0,
            "metadata": { "docs_processed": 0, "llm_passes": 0, "duration_seconds": 0 }
        },
        ... (same for comp, qualitative, product, news)
    },
    "all_sources": [
        { "title": "string", "url": "string", "date": "string", "cited_by": ["agent_names"] }
    ],
    "cross_agent_signals": [...],
    "all_flags": [...],
    "methodology": {
        "total_docs_processed": 0,
        "total_web_searches": 0,
        "total_llm_passes": 0,
        "total_pipeline_seconds": 0,
        "models_used": { "primary": "qwen/qwen3-235b-a22b-2507", "fallback": "qwen3.5:27b (Ollama)" },
        "flag_severity_rules": "...",
        "verdict_taxonomy": { "confirmed": "...", "contradicts_claim": "...", ... }
    }
}
```

Agent mental models (displayed in appendix PDF):
- **Financials**: "Is the financial story real and fundable? Where are the gaps?"
- **Comp**: "Does this market exist, is the timing right, and can they win?"
- **Qualitative**: "Who are these founders? Have they done this before?"
- **Product**: "Is the technology real, defensible, and differentiated?"
- **News**: "What does the public record say about this company?"

## Rules

- Never call LLM. Pure Python data assembly only.
- Deduplicate sources by URL — if two agents cite the same URL, merge with both agents listed in `cited_by`.
- Pull `cross_agent_signals` and `all_flags` directly from `overview.json` — do not recompute.
- If any agent JSON is missing, include an error entry for that agent rather than skipping silently.

## Workflow

1. Load all 5 agent JSON files and `overview.json`.
2. Group each agent's findings by verdict.
3. Collect all sources across all agents, deduplicate by URL.
4. Pull cross-agent signals and flags from overview.
5. Compute methodology totals (docs, searches, LLM passes, timing) from agent metadata.
6. Write `appendix.json` to workdir.

## System Prompt Core

```
None — this agent uses no LLM. All logic is deterministic Python aggregation.
```

## Dependencies

- **Upstream**: Overview Bot (needs cross_agent_signals and all_flags)
- **Downstream**: Format Bot
- **Skills**: None (pure Python)
- **DB Tables**: None
