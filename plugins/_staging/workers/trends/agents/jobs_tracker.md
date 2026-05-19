# Agent: Jobs Tracker

> Tracks job posting velocity for companies in cvc.companies. A company raising AND actively hiring is a stronger signal than funding alone.

## Identity

- **Role**: Hiring velocity signal tracker
- **Pipeline**: 05-trend-report
- **Runs on**: Droplet (DigitalOcean)
- **LLM**: None (structured scraping)
- **Triggered by**: Cron — bi-weekly snapshot
- **Status**: DEFINED

## Mission

Hiring velocity is one of the best real-time signals of company trajectory — often more current than funding data. The Jobs Tracker takes bi-weekly snapshots of open roles at companies in `cvc.companies`, categorizes them by function (engineering, sales, ops, field/deployment), and writes the counts to `trend_report.hiring_signals`. Companies with high engineering + deployment hiring alongside recent funding are the strongest signals for the sector analyst to highlight.

## Inputs

- Job boards for each company in `cvc.companies` (LinkedIn, Greenhouse, Lever, Workday, company careers pages)
- Company website URLs from `cvc.companies.website`

## Outputs

- `trend_report.hiring_signals` rows

```json
{
    "company": "string",
    "role_count": 24,
    "role_categories": ["engineering", "deployment", "sales", "operations"],
    "snapshot_date": "2026-01-15",
    "quarter": "Q1-2026"
}
```

## Rules

- Snapshot every two weeks for all companies in `cvc.companies` with a known website.
- Role categories: `engineering` (software/hardware/ML), `deployment` (field/installation/ops), `sales` (AE/SDR/CS), `operations` (supply chain/logistics ops), `other`.
- A company with 0 open roles is still a valid data point — log it.
- Do not de-list jobs within a snapshot — count what's open at the snapshot moment.

## Workflow

1. For each company in `cvc.companies` with `website IS NOT NULL`:
2. Scrape careers page or query job board API for open roles.
3. Categorize roles by function keyword matching.
4. INSERT snapshot into `trend_report.hiring_signals`.

## System Prompt Core

```
None — structured scraping and keyword-based categorization, no LLM needed.
```

## Dependencies

- **Upstream**: None (reads company list from cvc.companies)
- **Downstream**: Sector Analyst (cross-references hiring velocity with funding data)
- **Skills**: `web.scrapling`, LinkedIn API (if available)
- **DB Tables**: Reads `cvc.companies`. Writes `trend_report.hiring_signals`.
