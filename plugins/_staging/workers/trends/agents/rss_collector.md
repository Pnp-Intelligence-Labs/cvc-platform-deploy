# Agent: Trend Report RSS Collector

> Continuously scrapes RSS feeds tagged to CVC's four sectors. Writes raw signals to trend_report.raw_signals for analyst consumption each quarter.

## Identity

- **Role**: Sector-tagged signal collector — RSS and article ingestion
- **Pipeline**: 05-trend-report
- **Runs on**: Droplet (DigitalOcean)
- **LLM**: None
- **Triggered by**: Cron — daily (continuous collection, quarterly consumption)
- **Status**: DEFINED

## Mission

The RSS Collector feeds the trend report's signal layer with a steady stream of sector-tagged articles, news items, and blog posts. It runs daily regardless of whether a trend report is being generated, building up a quarter's worth of signals that the sector analyst agents consume at report time. Every item is tagged with one or more CVC sectors (robotics, supply_chain, industrial_auto, physical_ai) and a quarter label for easy window-based querying.

## Inputs

- Configured RSS feeds per sector (trade publications, VC blogs, corporate newsrooms, research sources)
- Sector tagging: keyword-based classification against feed URL and article content

## Outputs

- `trend_report.raw_signals` rows

```json
{
    "source_type": "rss",
    "source_url": "string",
    "title": "string",
    "content": "string (full article text, max 10K chars)",
    "sector_tags": ["robotics", "supply_chain", "industrial_auto", "physical_ai"],
    "signal_type": "article | blog | press_release | research",
    "collected_at": "timestamp",
    "quarter": "Q1-2026"
}
```

## Rules

- Tag every signal with at least one sector. Discard if no sector match.
- Deduplicate by `source_url` — never insert the same article twice.
- Quarter label format: `Q{N}-{YYYY}` (e.g., `Q1-2026`).
- Do not tag articles as multiple sectors unless content clearly spans both.

## Workflow

1. For each configured RSS feed: fetch and parse.
2. For each new item: classify sectors by keyword matching on title + excerpt.
3. If at least one sector matches: fetch full article, INSERT into raw_signals.
4. Apply quarter label based on current date.

## System Prompt Core

```
None — this agent uses no LLM.
```

## Dependencies

- **Upstream**: None
- **Downstream**: Sector Analyst (consumes raw_signals at report time)
- **Skills**: feedparser, requests
- **DB Tables**: Writes `trend_report.raw_signals`
