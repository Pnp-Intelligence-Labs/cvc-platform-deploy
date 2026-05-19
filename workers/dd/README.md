# DD Pipeline — Claw Venture Capital

Fully on-demand due diligence pipeline. Triggered via the platform UI — no approval queue, no nightly cron.

---

## How It Works

```
Analyst uploads dataroom files
        ↓
  Ingest + routing (manual or Auto Ingest)
        ↓
  5 Specialist Agents run in parallel
  (Financials, Market, Team, Product, News)
        ↓
  Overview Agent synthesizes IC memo
        ↓
  Appendix + Scorecard compiled
        ↓
  PDF + XLSX available in Enriched tab
        ↓
  [Step 2] Analyst annotates Scorecard
        ↓
  Reviewer Agent produces corrected memo
        ↓
  Review Memo PDF + DOCX in Enriched tab
        ↓
  Feedback stored → improves future runs
```

---

## Triggering a Run

**Via UI (preferred):**
Enrichment Queue → Add to Queue → DD Pipeline → upload files → Start DD Pipeline

**Via API:**
```
POST /admin/dd/{company_id}/trigger?mode=full
```

**Manually on Dell (debugging only):**
```bash
cd /home/nathan11/repos/cvc-intelligence/workers/dd
PYTHONPATH=/home/nathan11/repos/cvc-intelligence/core python3 run_three.py --company "Company Name"
```

---

## Pipeline Steps

| Step | Script | Description |
|---|---|---|
| Upload | UI + API | Analyst uploads files, routes per-agent |
| Ingest | `ingestion/ingest_local.py` | Parse + convert files, build manifest |
| Routing override | `run_three.py → apply_routing_override()` | Merge analyst routing into manifest |
| Financials | `agents/financials/agent.py` | P&L, cap table, projections, SAFE notes |
| Market | `agents/comp/agent.py` | Competitive landscape, market sizing, IP |
| Team | `agents/qualitative/agent.py` | Founders, board, advisors, equity docs |
| Product | `agents/product/agent.py` | Tech depth, IP filings, roadmap |
| News | `agents/news/agent.py` | Web search — press, traction, signals |
| IC Memo | `overview/agent.py` | Synthesizes all agents → recommendation |
| Appendix | `appendix/agent.py` | Full findings with source document citations |
| Format | `format/agent.py` | Renders Appendix PDF + Scorecard XLSX |

---

## File Routing

Each uploaded file is routed to one or more specialist agents:

| Route key | Agents that receive it |
|---|---|
| `financials` | Financials only |
| `comp` | Market only |
| `qualitative` | Team only |
| `product` | Product only |
| `news` | N/A — news uses web search, never documents |
| `general` | All 4 specialist agents (pitch decks, overviews) |

Auto Ingest mode skips manual routing — the ingestion tagger classifies files by filename/content signals and routes automatically. Less precise than manual routing.

Doc types that always go to all agents regardless of routing (`ALWAYS_SHARE`):
- `pitch_deck`
- `investor_qa`
- `unknown` (unclassified files)

---

## Outputs

All files written to `workdir/[CompanyName]/`:

| File | When created |
|---|---|
| `manifest.json` | After ingest |
| `agents/*.json` | After each specialist agent |
| `overview.json` | After IC memo synthesis |
| `appendix.json` | After appendix agent |
| `*_Appendix.pdf` | After format agent |
| `*_Scorecard.xlsx` | After format agent |
| `*_Scorecard_Reviewed.xlsx` | After analyst submits review |
| `review_memo.json` | After reviewer agent |
| `*_Review_Memo.pdf` | After reviewer agent (with amber banner) |
| `*_Review_Memo.docx` | After reviewer agent (editable Word) |

---

## Analyst Review (Step 2)

After the pipeline runs:

1. Download the Scorecard XLSX from the Enriched tab
2. Fill in columns G–I per finding row:
   - **Accuracy**: `correct` / `partially correct` / `wrong` / `not relevant`
   - **Flag Rating**: `flag justified` / `over-flagged` / `should have been flagged` / `n/a`
   - **Notes / Correction**: free text
3. Upload annotated scorecard at Enrichment Queue → DD Pipeline → Step 2 Analyst Review
4. The system parses feedback, stores it in `cvc.dd_feedback`, fires the Reviewer Agent
5. Review Memo PDF + DOCX appear in the Enriched tab when complete

---

## Learning Feedback Loop

After each analyst review submission:
- `cvc.dd_feedback` rows are aggregated by agent + topic + verdict
- Patterns (e.g. "financials agent over-flags revenue claims") written to `platform_settings.dd_agent_learning`
- DD agents read this key at runtime via ConfigLoader — informs flagging sensitivity on future runs

---

## Database

| Table | Purpose |
|---|---|
| `cvc.dd_evaluations` | Pipeline completion log — one row per run |
| `cvc.dd_feedback` | Per-finding analyst corrections (migration 081) |
| `cvc.platform_settings['dd_agent_learning']` | Aggregated flagging patterns for agent learning |

---

## Configuration

All in `config/settings.py`:
- `WORKDIR` — where extracted files and outputs are stored
- `LLM_MODEL` — primary model for specialist agents (`qwen/qwen3-235b-a22b-2507`)
- `OVERVIEW_LLM_MODEL` — IC memo synthesis (`moonshotai/kimi-k2`)
- `GDRIVE_*` — Google Drive credentials and output folder

---

## Key Files

```
workers/dd/
├── run_three.py              # Pipeline runner — ingest → agents → overview → format
├── scorecard.py              # Scorecard XLSX builder
├── db_logger.py              # Logs run results to cvc.dd_evaluations
├── agents/
│   ├── financials/agent.py
│   ├── comp/agent.py
│   ├── qualitative/agent.py
│   ├── product/agent.py
│   ├── news/agent.py
│   └── reviewer/agent.py     # Step 2 — corrected memo from analyst feedback
├── overview/agent.py         # IC memo synthesis (2-pass LLM)
├── appendix/agent.py         # Full findings aggregator
├── format/agent.py           # PDF + DOCX renderer (WeasyPrint + python-docx)
├── ingestion/
│   ├── ingest_local.py       # Local file ingestion
│   ├── tagger.py             # Document type classification
│   └── router.py             # Routes docs to agent buckets
└── config/
    ├── settings.py           # All config constants
    └── checklists.py         # Per-agent document routing rules
```
