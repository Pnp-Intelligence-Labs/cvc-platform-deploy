# workers/briefing — Weekly Intelligence Briefing Pipeline

Owned by Sharp Claw. Produces the Monday morning briefing delivered via Telegram.

---

## Architecture

```
4:30 AM UTC daily   run_briefing_enrichment.sh  (Refinery)
  │
  ├─ Step 1a: fetch_articles.py      — RSS articles from cvc.briefing_sources
  │
  ├─ Step 1b: fetch_podcasts.py      — YouTube channels in cvc.briefing_sources
  │              ↓ tries local GPU diarization first (diarize_podcast.py)
  │              ↓ falls back to YouTube captions if GPU unavailable/fails
  │
  └─ Step 2:  enrichment_worker.py   — relevance filter + full enrichment
                   ↓ relevance scoring via qwen3:30b-a3b (Ollama, Refinery GPU)
                   ↓ content enrichment via qwen3:30b-a3b (Ollama)
                   ↓ podcast synthesis via moonshotai/kimi-k2.5 (OpenRouter)
              → populates cvc.content_items

5:00 AM UTC Sunday  weekly_briefing.py     (Dell server)
                         ↓ pulls fully_enriched content from DB
                         ↓ WoW delta analysis via weekly_delta.py
                         ↓ synthesizes news via moonshotai/kimi-k2.5 (OpenRouter)
                    → writes to cvc.weekly_signals + prints briefing text
```

---

## Files

| File | Purpose |
|---|---|
| `enrichment_worker.py` | Main enrichment worker — relevance filter, full enrichment, podcast synthesis |
| `fetch_articles.py` | RSS article collector — pulls from cvc.briefing_sources |
| `fetch_podcasts.py` | Podcast transcript fetcher — tries local diarization, falls back to YT captions |
| `diarize_podcast.py` | Local GPU diarization — WhisperX large-v3 + Pyannote 3.1 (RTX 3090 only) |
| `weekly_briefing.py` | Sunday briefing generator — pulls enriched content, runs delta, calls LLM for synthesis |
| `weekly_delta.py` | WoW shift detection — velocity spikes, tag emergence, sentiment drift, partner signals |
| `entity_resolver.py` | Named entity pipeline — ingests content_items mentions → cvc.entities, resolves to companies |
| `strategic_matcher_worker.py` | Partner signal resolution — embeds entities + partners, cosine similarity → partner_id |
| `run_briefing_pdf.py` | PDF export of briefing (manual use) |
| `test_local_parse.py` | Unit tests for `parse_json()` — run after any parser changes |

---

## LLM Routing

The enrichment worker uses a task dispatcher (`call_llm(task=...)`):

| Task | Model | Where | Why |
|---|---|---|---|
| Relevance scoring | `qwen3:30b-a3b` | Refinery Ollama | Fast, free, high volume |
| Content enrichment | `qwen3:30b-a3b` | Refinery Ollama | Fast, free, high volume |
| Podcast synthesis | `moonshotai/kimi-k2.5` | OpenRouter cloud | Best quality for final briefing output |
| Fallback (Ollama down) | `qwen/qwen3-235b-a22b-2507` | OpenRouter cloud | Ensures briefing isn't delayed |

---

## Running

### Scheduled (automatic)
Cron on Refinery at 4:30 AM UTC via `~/scripts/run_briefing_enrichment.sh`.

### Manual backfill
```bash
# On Refinery — backfill podcast_synthesis on already-enriched episodes
LLM_API_BASE=http://localhost:11434/v1 \
CVC_DB_HOST=100.83.104.117 \
CVC_DB_PASSWORD=<db-password> \
OPENROUTER_API_KEY=<key> \
PYTHONPATH=~/repos/cvc-intelligence/core \
python3 ~/repos/cvc-intelligence/workers/briefing/enrichment_worker.py --backfill
```

### Manual enrichment run
```bash
bash ~/scripts/run_briefing_enrichment.sh
```

---

## Parse JSON Fix (2026-04-13)

Thinking models (kimi-k2.5, qwen3) output `<think>...</think>` blocks before answering.
These blocks often contain trial JSON snippets that previously broke parsing.

Current `parse_json()` pipeline:
1. Strip `<think>...</think>` blocks
2. Extract content between `[JSON_START]` and `[JSON_END]` markers (primary path)
3. Fall back to the **last** balanced `{}` object (not first — avoids stray trial JSON)
4. Last resort: `json.loads()` on stripped text

All three prompts instruct the model to wrap output in `[JSON_START]`/`[JSON_END]` markers.

Run `python3 test_local_parse.py` to verify parser behaviour after any changes.

---

## Archive

The previous Dell-only/OpenRouter-only version is preserved at:
```
git tag archive/briefing-enrichment-dell-v1
```
To restore: `git checkout archive/briefing-enrichment-dell-v1 -- workers/briefing/enrichment_worker.py`
