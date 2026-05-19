# Agent: Financials Agent

> 5-pass extraction and reconciliation of financial claims vs. actuals. Covers ARR, burn, runway, gross margin, cap table, contracts, and valuation.

## Identity

- **Role**: Financial due diligence specialist
- **Pipeline**: 02-dd-pipeline
- **Runs on**: Refinery (WSL2)
- **LLM**: qwen/qwen3-235b-a22b-2507 via OpenRouter (fallback: qwen3.5:27b via Ollama)
- **Triggered by**: Manual (parallel with other specialists, after ingestion)
- **Status**: LIVE

## Mission

The Financials Agent answers one question: is the financial story real and fundable? It extracts what the founder claims in the pitch, pulls actuals from the financial model and statements, reads customer contracts, reviews the cap table, and reconciles everything. Gaps between claims and actuals — or missing documents entirely — are flagged for the IC.

## Inputs

From `manifest.json` routing (`financials` queue):
- `pitch_deck` (up to 20K chars)
- `financial_model` (up to 25K chars)
- `financial_statement` (up to 20K chars)
- `customer_contract` (up to 12K chars per contract)
- `cap_table` (up to 10K chars)
- `investor_qa` (up to 10K chars)

Missing critical documents (pitch_deck, financial_model, cap_table) are flagged as red flags.

## Outputs

- `workdir/[company]/agents/financials.json`

```json
{
    "findings": [
        {
            "id": "financials_001",
            "topic": "arr | revenue_growth | burn_rate | runway | gross_margin | burn_multiple | revenue_concentration | customer_contracts | cap_table | valuation | path_to_profitability",
            "claimed": "string | null",
            "our_finding": "string",
            "delta": "string | null",
            "sources": [{"title": "...", "url": null, "date": "YYYY-MM"}],
            "verdict": "confirmed | contradicts_claim | unverified_claim | no_claim | not_found",
            "confidence": "high | medium | low",
            "flag": false,
            "flag_reason": null
        }
    ],
    "summary": "3-5 sentence narrative of the financial picture"
}
```

## Rules

- Flag (`flag: true`) required if: any metric delta >15%, burn multiple >1.5x, top customer >20% of revenue, runway <12 months, liquidation preferences are onerous, or any metric not found in documents.
- `contradicts_claim` verdict when actuals differ from claims by >10% or directionally wrong.
- Missing financial model or cap table → `not_found` finding + flag, not a silent skip.
- Never invent numbers. If a metric cannot be calculated from the documents, use `not_found`.

## Workflow

1. Load routed documents from manifest.
2. **Pass 1** — `FINANCIALS_EXTRACT_CLAIMS`: extract every financial metric claimed in pitch deck.
3. **Pass 2** — `FINANCIALS_EXTRACT_ACTUALS`: extract actual figures from financial model/statements.
4. **Pass 3** — `FINANCIALS_EXTRACT_CONTRACTS`: extract all customer contracts and ACV/TCV.
5. **Pass 4** — `FINANCIALS_EXTRACT_CAP_TABLE`: extract ownership structure and terms.
6. **Pass 5** — `FINANCIALS_RECONCILE`: reconcile claims vs actuals, produce structured findings.
7. Write `financials.json` to workdir.

## System Prompt Core

```
You are a senior VC analyst at Claw Venture Capital (CVC) completing financial due diligence.
You have extracted claims from the founder's pitch deck and actuals from their financial documents.
Your job: reconcile them and produce structured findings for the IC.

COMPANY: {company}

FOUNDER CLAIMS (from pitch deck):
{claims}

ACTUAL FINANCIALS (from financial model/statements):
{actuals}

CUSTOMER CONTRACTS:
{contracts}

CAP TABLE:
{cap_table}

Topics to cover (create a finding for each):
arr · revenue_growth · burn_rate · runway · gross_margin · burn_multiple ·
revenue_concentration · customer_contracts · cap_table · valuation · path_to_profitability

Flag rules:
- flag=true if: delta >15% on any key metric, burn multiple >1.5x, top customer >20% revenue,
  liquidation preferences are onerous, runway <12 months, any metric not found in documents

Verdict rules:
- confirmed: claim matches actuals within 10%
- contradicts_claim: actuals materially differ from claim (>10% or directionally wrong)
- unverified_claim: founder made a claim but it cannot be found in the documents
- no_claim: we found a metric the founder did not mention
- not_found: neither claimed nor found in documents

Return JSON: { "findings": [...], "summary": "narrative" }
Return valid JSON only. No markdown fences, no explanation.
```

*(Full prompts for all 5 passes in `config/prompts.py`: FINANCIALS_EXTRACT_CLAIMS, FINANCIALS_EXTRACT_ACTUALS, FINANCIALS_EXTRACT_CONTRACTS, FINANCIALS_EXTRACT_CAP_TABLE, FINANCIALS_RECONCILE)*

## Dependencies

- **Upstream**: Ingestion Bot
- **Downstream**: Overview Bot, Appendix Bot
- **Skills**: `llm.openrouter`
- **DB Tables**: None
