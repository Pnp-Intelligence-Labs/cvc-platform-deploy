# Agent: Ingestion Bot

> Downloads a startup's Google Drive dataroom, converts all files to text, classifies and routes documents to specialist agents, and writes the manifest.

## Identity

- **Role**: Pipeline entry point — dataroom ingestion and document routing
- **Pipeline**: 02-dd-pipeline
- **Runs on**: Refinery (WSL2)
- **LLM**: qwen/qwen3-235b-a22b-2507 via OpenRouter (document classification only; fallback: qwen3.5:27b via Ollama)
- **Triggered by**: Manual — `python3 -m ingestion.ingest "Company Name" "https://drive.google.com/..."`
- **Status**: LIVE

## Mission

The Ingestion Bot is the first step in every DD run. It downloads the full dataroom from Google Drive, converts every file to plain text (PDF, DOCX, PPTX, XLSX, etc.), classifies each document by type using LLM, and routes them to the appropriate specialist agents via `manifest.json`. Nothing downstream runs without a clean manifest.

## Inputs

- Google Drive dataroom URL (passed as CLI argument)
- Google Drive OAuth credentials (`~/producer/gdrive_credentials.json`, `gdrive_token.json`)

## Outputs

- `workdir/[company]/manifest.json` — document inventory with paths, types, char counts, and routing assignments
- `workdir/[company]/docs/` — downloaded original files
- `workdir/[company]/text/` — converted plain-text versions
- Telegram summary message (file counts by type, any conversion failures)

Manifest routing keys: `financials` · `comp` · `qualitative` · `product` · `news` (always empty — news uses web only)

## Rules

- Never skip a file silently. All conversion failures must be logged in the manifest with `"conversion": "failed"`.
- If a critical document type is missing (pitch_deck, financial_model, cap_table), flag it in the manifest summary — downstream agents will surface this as a red flag.
- Truncate converted text at per-type limits (pitch_deck: 80K chars, financial_model: 25K, etc.) to stay within LLM context windows.
- Never write outside the `workdir/[company]/` directory.

## Workflow

1. Authenticate to Google Drive using stored OAuth credentials.
2. Recursively download all files from the dataroom folder.
3. Convert each file to plain text via MarkItDown (PDF, DOCX, PPTX, XLSX, images).
4. Classify each document using LLM (`DOC_TYPE_CLASSIFY` prompt).
5. Route classified documents to specialist agent queues.
6. Write `manifest.json` with full inventory, routing, and summary.
7. Send Telegram summary: file counts, types found, any failures.

## System Prompt Core

```
You are classifying a document from a startup's data room.

Filename: {filename}
First 1000 characters of content:
{content_preview}

Classify this document as exactly one of:
- pitch_deck
- financial_model
- financial_statement
- cap_table
- legal_terms
- customer_contract
- investor_qa
- team_bio
- patent_ip
- unknown

Reply with only the classification label, nothing else.
```

## Dependencies

- **Upstream**: None (pipeline entry point)
- **Downstream**: All 5 specialist agents (news, financials, comp, qualitative, product)
- **Skills**: `llm.openrouter` (classification), Google Drive API (`ingestion/drive.py`), MarkItDown (`ingestion/converter.py`)
- **DB Tables**: None — writes only to local filesystem (`workdir/`)
