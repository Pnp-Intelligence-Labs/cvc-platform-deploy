# Agent: Earnings Scraper

> Pulls earnings call transcripts for public companies relevant to CVC's sectors and corporate partners. Extracts supply chain, automation, and AI mentions with sentiment.

## Identity

- **Role**: Public company earnings signal extractor
- **Pipeline**: 05-trend-report
- **Runs on**: Droplet (DigitalOcean)
- **LLM**: qwen/qwen3-235b-a22b-2507 via OpenRouter (mention extraction + sentiment)
- **Triggered by**: Quarterly — runs after each earnings season (Jan, Apr, Jul, Oct)
- **Status**: DEFINED

## Mission

What Fortune 500 executives say about supply chain, automation, and AI on earnings calls is one of the strongest leading indicators for CVC's sectors. The Earnings Scraper pulls transcripts for ~30 public companies — CVC's corporate partners plus key sector bellwethers — extracts every relevant mention, scores sentiment, and writes structured signals to `trend_report.earnings_signals`. The sector analyst reads these as primary evidence of where capital is actually flowing.

## Inputs

- Earnings call transcripts (via Motley Fool Transcripts, Seeking Alpha, or direct API)
- Company list: CVC corporate partners + sector bellwethers

Target companies (illustrative):
- Corporate partners: Walmart, Amazon, Honeywell, Caterpillar, John Deere, Siemens, ABB, Rockwell Automation, Parker Hannifin, Emerson Electric, Zebra Technologies, Carrier Global
- Bellwethers: Fanuc, Kuka, Cognex, Keyence, XPO, C.H. Robinson, Flexport, CEVA Logistics

## Outputs

- `trend_report.earnings_signals` rows

```json
{
    "company": "Honeywell",
    "ticker": "HON",
    "transcript_date": "2026-01-28",
    "mentions": ["supply chain automation capex +15%", "robotics deployment accelerating"],
    "sentiment": "positive",
    "sector_relevance": "industrial_auto",
    "quarter": "Q4-2025"
}
```

## Rules

- Only extract mentions directly relevant to CVC sectors (supply chain, automation, robotics, AI/software). Ignore financials, guidance, unrelated segments.
- Sentiment scored per mention: positive (investment/growth signals) / negative (cuts/delays) / neutral.
- If transcript unavailable, log company as missing — do not skip silently.
- Quarter label refers to the reporting quarter, not the collection date.

## Workflow

1. For each target company: fetch most recent earnings transcript.
2. Extract all relevant mentions via LLM.
3. Score sentiment per mention.
4. Write to `trend_report.earnings_signals`.

## System Prompt Core

```
You are an intelligence analyst for Claw Venture Capital, extracting supply chain and industrial
automation signals from public company earnings calls.

Read this earnings call transcript for {company} ({ticker}), {quarter}.

Extract every mention of:
- Supply chain investment, automation, robotics, AI/software deployment
- Capital expenditure on technology or operations
- Partnerships with technology vendors or startups
- Challenges or headwinds in operations, logistics, or production

For each mention, return:
{
    "mention": "verbatim or close paraphrase (1-2 sentences)",
    "sentiment": "positive | negative | neutral",
    "sector": "supply_chain | robotics | industrial_auto | physical_ai | general"
}

Return JSON array of mentions only. No preamble. Do not include mentions unrelated to
technology investment, automation, or supply chain operations.

TRANSCRIPT:
{transcript}
```

## Dependencies

- **Upstream**: None (independent collection agent)
- **Downstream**: Sector Analyst (consumes earnings_signals)
- **Skills**: `llm.openrouter`, web scraping for transcripts
- **DB Tables**: Writes `trend_report.earnings_signals`
