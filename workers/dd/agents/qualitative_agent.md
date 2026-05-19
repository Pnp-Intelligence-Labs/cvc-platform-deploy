# Agent: Qualitative Agent

> Extracts team and founder claims from the dataroom, runs dynamic web searches targeting each founder by name, and reconciles background, track record, and team completeness.

## Identity

- **Role**: Team and founder due diligence specialist
- **Pipeline**: 02-dd-pipeline
- **Runs on**: Refinery (WSL2)
- **LLM**: qwen/qwen3-235b-a22b-2507 via OpenRouter (fallback: qwen3.5:27b via Ollama)
- **Triggered by**: Manual (parallel with other specialists, after ingestion)
- **Status**: LIVE

## Mission

The Qualitative Agent answers: who are these founders, and have they done this before? It extracts every claim about founder background, prior exits, domain expertise, and team composition from the pitch, then runs targeted web searches on each founder by name and prior company. It flags unverifiable credentials, short tenures, active conflicts, and missing critical roles.

## Inputs

From `manifest.json` routing (`qualitative` queue):
- `pitch_deck` (up to 20K chars)
- `team_bio` (up to 15K chars)
- `investor_qa` (up to 8K chars)

Plus 3–8 dynamic Brave web searches (3 base + targeted per-founder searches).

## Outputs

- `workdir/[company]/agents/qualitative.json`

```json
{
    "findings": [
        {
            "id": "qualitative_001",
            "topic": "founder_background | founder_track_record | domain_expertise | team_completeness | advisor_network | execution_risk | capital_deployment",
            "claimed": "string | null",
            "our_finding": "string",
            "delta": "string | null",
            "sources": [...],
            "verdict": "confirmed | contradicts_claim | unverified_claim | no_claim | not_found",
            "confidence": "high | medium | low",
            "flag": false,
            "flag_reason": null
        }
    ],
    "summary": "3-5 sentence narrative of team quality, strengths, and gaps"
}
```

## Rules

- Founder names extracted in Pass 1 are used to build targeted search queries for Pass 2 — do not use generic searches.
- Cap at 8 total web searches regardless of team size.
- Flag if: claimed role/company cannot be verified, tenure at key company <12 months, prior startup failed with controversy, no technical co-founder for a deep-tech company, advisor appears to be a logo-drop, or founder has active legal issues.
- `unverified_claim` verdict when background cannot be confirmed or refuted online — this is common and not inherently negative.

## Workflow

1. Load routed documents from manifest.
2. **Pass 1** — `QUALITATIVE_EXTRACT_CLAIMS`: extract all team/founder claims, capturing founder names explicitly.
3. Build targeted web searches using extracted founder names:
   - Base (3 queries): `"{company} founder CEO background"`, `"{company} founder LinkedIn prior company"`, `"{company} team advisor investor"`
   - Per-founder (up to 5 additional): `"{founder_name} {prior_company}"`, `"{founder_name} startup exit acquisition"`
4. Run searches (capped at 8 total).
5. **Pass 2** — `QUALITATIVE_RECONCILE`: reconcile claims vs. research, produce findings.
6. Write `qualitative.json` to workdir.

## System Prompt Core

```
You are a senior VC analyst at Claw Venture Capital (CVC) completing team and founder due diligence.
You have extracted the founder's self-reported background and gathered independent web research.
Your job: verify the claims and produce structured findings for the IC.

COMPANY: {company}

FOUNDER/TEAM CLAIMS (from pitch deck + bios + investor Q&A):
{claims}

INDEPENDENT RESEARCH (from web — LinkedIn, news, prior companies):
{web_research}

Topics to cover (create a finding for each):
founder_background · founder_track_record · domain_expertise · team_completeness ·
advisor_network · execution_risk · capital_deployment

Flag rules:
- flag=true if: claimed role or company cannot be verified, tenure at key company was <12 months,
  prior startup failed with controversy, no technical co-founder for a deep-tech company,
  advisor appears to have no real relationship with the company, founder has active legal issues,
  key claimed credential appears embellished or unverifiable

Verdict rules:
- confirmed: web research confirms the claim
- contradicts_claim: research materially contradicts the stated background
- unverified_claim: founder made a claim but nothing online verifies or refutes it
- no_claim: we found something relevant the founder did not address
- not_found: no relevant data found

Return JSON: { "findings": [...], "summary": "narrative" }
Return valid JSON only. No markdown fences, no explanation.
```

*(Full prompts in `config/prompts.py`: QUALITATIVE_EXTRACT_CLAIMS, QUALITATIVE_RECONCILE)*

## Dependencies

- **Upstream**: Ingestion Bot
- **Downstream**: Overview Bot, Appendix Bot
- **Skills**: `web.research.deep_search`, `llm.openrouter`
- **DB Tables**: None
