# Agent: Patent Monitor

> Watches USPTO and PCT filings in relevant IPC codes for CVC's sectors. Surfaces new IP activity from tracked companies and emerging filers as a technology signal.

## Identity

- **Role**: Patent filing tracker — IP activity signal
- **Pipeline**: 05-trend-report
- **Runs on**: Droplet (DigitalOcean)
- **LLM**: None (structured extraction from patent APIs)
- **Triggered by**: Cron — monthly
- **Status**: DEFINED

## Mission

Patent filings are a leading indicator of where companies are investing their R&D, often 12-18 months ahead of product announcements. The Patent Monitor watches USPTO and PCT databases for filings in IPC codes relevant to robotics, automation, logistics, and industrial AI. It tracks both known companies in `cvc.companies` and surfaces new filers in CVC's sectors that may be worth investigating.

## Inputs

- USPTO Patent Full-Text and Image Database (via API or bulk download)
- PCT (WIPO) international applications
- IPC codes of interest:
  - `B25J` — Manipulators / robots
  - `G05B` — Control systems / automation
  - `B65G` — Conveying / warehousing
  - `G06Q` — Business data processing (logistics, supply chain)
  - `G06N` — Machine learning / AI systems

## Outputs

- `trend_report.patent_signals` rows

```json
{
    "company": "string",
    "patent_number": "US20260123456A1 | null (if application only)",
    "title": "string",
    "ipc_codes": ["B25J9/16", "G05B19/42"],
    "filing_date": "2026-01-10",
    "sector_tags": ["robotics", "industrial_auto"],
    "quarter": "Q1-2026"
}
```

## Rules

- Only capture filings in the defined IPC codes. Do not cast wide net.
- Cross-reference applicant name against `cvc.companies` — flag matches.
- New filers (not in CVC DB) with 3+ relevant filings in a quarter are worth surfacing to the sector analyst.
- Patent numbers for granted patents, null for applications.

## Workflow

1. Monthly: query USPTO API for new filings in target IPC codes.
2. For each filing: extract company, title, IPC codes, date.
3. Cross-reference against `cvc.companies`.
4. INSERT into `trend_report.patent_signals`.

## System Prompt Core

```
None — structured extraction from patent metadata APIs, no LLM needed.
```

## Dependencies

- **Upstream**: None
- **Downstream**: Sector Analyst (reads patent_signals as technology signal)
- **Skills**: USPTO API, WIPO PatentScope API
- **DB Tables**: Reads `cvc.companies` (cross-reference). Writes `trend_report.patent_signals`.
