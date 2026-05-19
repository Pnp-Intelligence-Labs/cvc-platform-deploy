# Agent: Funding Tracker

> Monitors funding rounds, M&A events, and exits in CVC's four sectors. Writes structured funding events to trend_report.funding_events for quarterly analysis.

## Identity

- **Role**: Funding and M&A signal tracker
- **Pipeline**: 05-trend-report
- **Runs on**: Droplet (DigitalOcean)
- **LLM**: qwen/qwen3-235b-a22b-2507 via OpenRouter (extraction from news)
- **Triggered by**: Cron — weekly (continuous collection, quarterly consumption)
- **Status**: DEFINED

## Mission

Money flow is the clearest signal of where a market is moving. The Funding Tracker monitors Crunchbase, TechCrunch, and sector news for funding rounds, acquisitions, and exits in CVC's four sectors. It structures each event with amount, round type, investors, and sector tags so the Sector Analyst can open a quarter's analysis with hard funding data rather than anecdotes.

## Inputs

- Crunchbase API (funding rounds by sector/date)
- TechCrunch, The Information, PitchBook alerts (via RSS or scraping)
- `trend_report.raw_signals` (funding mentions in RSS articles)

## Outputs

- `trend_report.funding_events` rows

```json
{
    "company": "string",
    "round_type": "pre-seed | seed | series_a | series_b | series_c | growth | acquisition | ipo | exit",
    "amount": 15000000,
    "investors": ["Sequoia", "a16z"],
    "event_date": "2026-01-15",
    "sector_tags": ["robotics"],
    "source_url": "string",
    "quarter": "Q1-2026"
}
```

## Rules

- Only track companies in CVC's four sectors. Use sector_tags from cvc.companies if company is known, otherwise infer from press.
- Amount in USD (integer). Use null if undisclosed.
- Round type must be normalized to the enum — map "Series A" → "series_a", "Seed Round" → "seed", etc.
- Cross-reference against `cvc.companies` — if the company is in CVC's DB, include the company_id.
- Dedup by (company, round_type, event_date) — don't insert duplicate events.

## Workflow

1. Weekly: query Crunchbase API for new rounds in target sectors.
2. Scan `trend_report.raw_signals` for funding-related articles not yet captured.
3. Extract structured event data via LLM where needed.
4. Normalize round type and amount.
5. INSERT into `trend_report.funding_events`.

## System Prompt Core

```
You are extracting a funding event from a news article for CVC's trend report database.

Extract the following fields from this article:
- company: company name
- round_type: pre-seed | seed | series_a | series_b | series_c | growth | acquisition | ipo | exit
- amount: dollar amount as integer (null if undisclosed)
- investors: list of investor names
- event_date: YYYY-MM-DD (approximate if exact date not given)
- sector_tags: list from [robotics, supply_chain, industrial_auto, physical_ai]

Return JSON only. If the article does not describe a funding event, return null.

ARTICLE:
{article}
```

## Dependencies

- **Upstream**: RSS Collector (raw_signals as supplementary source)
- **Downstream**: Sector Analyst (primary quantitative signal)
- **Skills**: `llm.openrouter`, Crunchbase API, `web.research`
- **DB Tables**: Reads `trend_report.raw_signals`, `cvc.companies`. Writes `trend_report.funding_events`.
