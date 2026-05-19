# Agent: Format Bot

> No LLM. Renders overview.json and appendix.json into two branded WeasyPrint PDFs: the IC Memo and the Appendix. Optionally uploads to Google Drive.

## Identity

- **Role**: PDF renderer and delivery
- **Pipeline**: 02-dd-pipeline
- **Runs on**: Refinery (WSL2)
- **LLM**: None — HTML/CSS rendering via WeasyPrint
- **Triggered by**: Manual (after Overview Bot and Appendix Bot complete)
- **Status**: LIVE

## Mission

The Format Bot turns structured JSON into board-ready PDFs. It reads `overview.json` and `appendix.json`, renders them into styled HTML using the Plug & Play brand system, and converts to PDF via WeasyPrint. No synthesis, no judgment — pure presentation. The IC Memo is the deliverable Nate hands to the IC. The Appendix is the supporting evidence file.

## Inputs

- `workdir/[company]/overview.json`
- `workdir/[company]/appendix.json`

## Outputs

- `workdir/[company]/[company]_IC_Memo.pdf`
- `workdir/[company]/[company]_Appendix.pdf`
- Optional: `[company]_IC_Memo.html`, `[company]_Appendix.html` (debug)
- Optional: uploaded to Google Drive folder `DD Reports`

## Visual Identity (Plug & Play)

| Token | Value | Usage |
|-------|-------|-------|
| Dark Blue | `#253B49` | Headers, dark elements |
| Yellow | `#F0E545` | Accents, horizontal rules |
| Background | `#F5F5F7` | Page background |
| Body text | `#313C51` | Main content |
| Secondary | `#676E7A` | Captions, metadata |
| Supply Chain accent | `#32749A` | Section highlights |
| Font | Trebuchet MS | All text |
| Cards | 8px radius, `rgba(0,0,0,0.14)` shadow | Content blocks |

## IC Memo Sections

1. **Cover page** — company name, stage, raise amount, valuation ask, sector, recommendation badge (color-coded by verdict)
2. **Executive Summary** — key metrics grid, investment thesis, recommendation rationale
3. **Section Summaries** — per-agent 2-3 sentence narratives (financials, market, team, product, news)
4. **Cross-Agent Signals** — red/yellow/green signal chips with narrative
5. **Due Diligence Flags** — red/yellow flag cards with finding references
6. **IC Questions** — sorted by priority (high → medium → low), source-traced to finding IDs
7. **Footer** — methodology metadata, confidentiality notice

## Appendix Sections

1. **Cover page**
2. **Findings by Agent** — per-agent sections with all findings grouped by verdict
3. **All Sources Cited** — deduplicated, with agent attribution
4. **Methodology** — docs/searches/LLM passes, models used, flag rules, verdict taxonomy
5. **Footer** — confidentiality notice

## Rules

- Never modify input data. Render only what's in the JSON.
- If a key metric is null, render "N/A" — never leave blank.
- Recommendation badge colors: `strong_interest` = green, `proceed` = blue, `conditional` = yellow, `pass` = red.
- Google Drive upload is optional and gated on GDRIVE_CREDS existing — never fail the run if Drive is unavailable.

## Workflow

1. Load `overview.json` and `appendix.json`.
2. Render IC Memo HTML (Jinja-style string interpolation into HTML template).
3. Convert IC Memo HTML → PDF via WeasyPrint.
4. Render Appendix HTML.
5. Convert Appendix HTML → PDF via WeasyPrint.
6. (Optional) Upload both PDFs to Google Drive `DD Reports` folder.
7. Print output paths to terminal.

## System Prompt Core

```
None — this agent uses no LLM. All logic is deterministic HTML rendering and PDF conversion.
```

## Dependencies

- **Upstream**: Overview Bot (overview.json), Appendix Bot (appendix.json)
- **Downstream**: None (terminal output)
- **Skills**: WeasyPrint (`pip install weasyprint`), Google Drive API (optional)
- **DB Tables**: None
