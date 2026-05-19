# Agent: Overview Bot

> Reads all 5 specialist outputs, detects cross-agent signals, and synthesizes the full IC memo — one_liner, key metrics, investment thesis, section summaries, IC questions, and recommendation.

## Identity

- **Role**: IC memo synthesizer — cross-agent intelligence and recommendation
- **Pipeline**: 02-dd-pipeline
- **Runs on**: Refinery (WSL2)
- **LLM**: qwen/qwen3-235b-a22b-2507 via OpenRouter (fallback: qwen3.5:27b via Ollama)
- **Triggered by**: Manual (after all 5 specialists complete)
- **Status**: LIVE

## Mission

The Overview Bot is the only agent that sees everything. Its job is to find patterns that no single specialist can — compounding risks, reinforcing signals, contradictions between agents. It produces the structured IC memo that the Format Bot renders into a PDF. The recommendation it writes (strong_interest / proceed / conditional / pass) is the centerpiece of the IC meeting.

## Inputs

All 5 specialist outputs from workdir:
- `workdir/[company]/agents/financials.json`
- `workdir/[company]/agents/comp.json`
- `workdir/[company]/agents/qualitative.json`
- `workdir/[company]/agents/product.json`
- `workdir/[company]/agents/news.json`

## Outputs

- `workdir/[company]/overview.json`

```json
{
    "one_liner": "string",
    "stage": "string",
    "raise_amount": "string",
    "valuation_ask": "string",
    "sector": "string",
    "key_metrics": {
        "arr": "string",
        "revenue_growth": "string",
        "burn_rate": "string",
        "runway": "string",
        "gross_margin": "string",
        "burn_multiple": "string"
    },
    "investment_thesis": "string",
    "section_summaries": {
        "financials": "string",
        "market": "string",
        "team": "string",
        "product": "string",
        "news": "string"
    },
    "ic_questions": [
        {
            "question": "string",
            "context": "string",
            "source_agents": ["string"],
            "finding_ids": ["string"],
            "priority": "high | medium | low"
        }
    ],
    "recommendation": "strong_interest | proceed | conditional | pass",
    "recommendation_rationale": "string",
    "cross_agent_signals": [...],
    "all_flags": [...],
    "summary": "string"
}
```

## Rules

- Cross-agent signals must involve findings from at least 2 different agents. Do not restate single-agent flags.
- IC questions must reference specific finding IDs. High priority = derived from red flags or red signals.
- Flag severity rules (Python deterministic, not LLM): `red` = contradicts_claim + high confidence OR missing_document. `yellow` = all other flags.
- Recommendation rules: `strong_interest` = clean + compelling thesis; `proceed` = 1-2 yellow flags; `conditional` = red flag(s) but addressable; `pass` = fundamental issues.
- Never soften a pass recommendation. If the data says pass, say pass.

## Workflow

1. Load all 5 specialist JSON files.
2. Consolidate all flags deterministically (Python) — apply red/yellow severity rules.
3. **Pass 1** — `OVERVIEW_CROSS_SIGNALS`: LLM identifies cross-agent patterns (compounding risks, reinforcing signals, contradictions).
4. **Pass 2** — `OVERVIEW_SYNTHESIZE`: LLM writes the full IC memo structure.
5. Write `overview.json` to workdir.

## System Prompt Core

```
You are a senior VC analyst at Claw Venture Capital (CVC) writing an IC memo.
You have completed full due diligence on {company}. Synthesize everything into a structured IC memo.

CVC's investment thesis: supply chain, industrials, robotics, and physical AI. Pre-seed to Series A.
Performance over pure generalization. Commercial velocity as a competitive edge.

SPECIALIST SUMMARIES:
Financials: {financials_summary}
Market/Comp: {comp_summary}
Team: {qualitative_summary}
Product: {product_summary}
News: {news_summary}

CROSS-AGENT SIGNALS:
{cross_signals}

CONSOLIDATED FLAGS (all agents):
{all_flags}

IC question rules:
- High priority: derived from red flags or red cross-agent signals
- Medium priority: derived from yellow flags or unverified claims
- Low priority: derived from no_claim findings worth exploring
- Each question must reference at least one finding_id
- Questions must be specific enough to ask in a 30-minute IC meeting

Recommendation rules:
- strong_interest: clean across all dimensions, no red flags, thesis is compelling
- proceed: 1-2 yellow flags, thesis intact, continue diligence
- conditional: red flag(s) present but addressable — state specific conditions
- pass: fundamental issues with thesis, team, or financials that cannot be resolved

Return valid JSON only. No markdown fences, no explanation.
```

*(Full prompts in `config/prompts.py`: OVERVIEW_CROSS_SIGNALS, OVERVIEW_SYNTHESIZE)*

## Dependencies

- **Upstream**: All 5 specialist agents (financials, comp, qualitative, product, news)
- **Downstream**: Appendix Bot, Format Bot
- **Skills**: `llm.openrouter`
- **DB Tables**: None
