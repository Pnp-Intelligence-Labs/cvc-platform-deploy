"""
CVC Enrichment Worker v5.0
Two-stage: relevance filter then full enrichment.
Runs on Refinery (WSL, RTX 3090) via ~/scripts/run_briefing_enrichment.sh.
Cron: 4:30 AM UTC daily (Refinery crontab).

LLM routing (task dispatcher):
  relevance + enrichment → qwen3:30b-a3b  via local Ollama  (GPU, free)
  podcast_synthesis      → moonshotai/kimi-k2.5 via OpenRouter (cloud)
  fallback (Ollama down) → qwen/qwen3-235b-a22b-2507 via OpenRouter

Env vars:
  LLM_API_BASE        — Ollama base URL, e.g. http://localhost:11434/v1
  CVC_DB_HOST         — DB host (100.83.104.117 from Refinery)
  CVC_DB_PASSWORD     — DB password
  OPENROUTER_API_KEY  — required for synthesis and fallback

Populates:
  - summary, key_entities, tags, sentiment → all content types
  - podcast_synthesis (JSONB) → podcast_episode only (used by weekly_briefing.py)

Usage:
  python3 enrichment_worker.py [batch_size] [relevance_threshold]
  python3 enrichment_worker.py 100 4      # process 100 items, skip below 4/10
  python3 enrichment_worker.py --backfill # backfill podcast_synthesis on already-enriched episodes

Archive:
  git tag archive/briefing-enrichment-dell-v1 — previous Dell/OpenRouter-only version
"""
import os
import re
import sys
import json
import requests
import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "core"))
from config_loader import config as _cfg
from job_logger import start_job, finish_job

OPENROUTER_URL       = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL     = "qwen/qwen3-235b-a22b-2507"       # fallback for relevance/enrichment
OPENROUTER_SYNTHESIS = "moonshotai/kimi-k2.5"             # cloud model for podcast synthesis
OLLAMA_MODEL         = "qwen3:30b-a3b"                    # local model for relevance/enrichment
OPENROUTER_API_KEY   = os.environ.get("OPENROUTER_API_KEY", "")
LLM_API_BASE         = os.environ.get("LLM_API_BASE", "")
DB_CONFIG = {
    "dbname": "cvc_db",
    "user": "producer",
    "password": os.environ["CVC_DB_PASSWORD"],
    "host": os.environ.get("CVC_DB_HOST", "100.83.104.117"),
    "port": 5432
}

RELEVANCE_PROMPT = """You are a relevance scorer for a corporate intelligence platform focused on:
{sector_focus}

Given this content title and excerpt, score its relevance from 1-10.
1 = completely irrelevant (nature documentaries, sports, celebrity gossip, personal stories)
5 = tangentially relevant (general tech, general business)
8 = highly relevant (supply chain automation, robotics funding, enterprise AI)
10 = directly actionable intelligence

Output ONLY the JSON object between [JSON_START] and [JSON_END] markers. No explanation, no markdown.

[JSON_START]
{{"score": <integer>, "reason": "<string>"}}
[JSON_END]

Title: {title}
Excerpt: {excerpt}
"""

ENRICHMENT_PROMPT = """You are an intelligence analyst for {analyst_context}

Analyze this content and extract:
1. "summary": 2-3 sentence executive summary focused on business implications
2. "insights": list of 3-5 specific actionable insights or key takeaways
3. "entities": objects with keys: companies, people, technologies (each a list)
4. "tags": 3-5 topic tags
5. "sentiment": positive/negative/neutral
6. "relevance_to_firm": one sentence on why this matters to our advisory or investment activities

Output ONLY the JSON object between [JSON_START] and [JSON_END] markers. No explanation, no markdown.

[JSON_START]
{{"summary": "...", "insights": [], "entities": {{}}, "tags": [], "sentiment": "...", "relevance_to_firm": "..."}}
[JSON_END]

Title: {title}
Content: {content}
"""

PODCAST_SYNTHESIS_PROMPT = """You are an intelligence analyst for Claw Venture Capital (CVC). {investment_thesis} {corporate_partners_context}

Extract the key intelligence signals from this podcast transcript or summary.

Rules:
- Each insight must be a specific, concrete claim or finding — not vague commentary
- Expert: "First Last, Title/Role" if clearly identifiable, otherwise empty string
- Section: the topic or theme being discussed
- Confidence: HIGH if a specific expert made a direct claim with supporting data; MEDIUM if a credible claim but less specific; LOW if speculative or unclear
- Extract 3-5 insights. Prioritize HIGH and MEDIUM confidence.

Output ONLY the JSON object between [JSON_START] and [JSON_END] markers. No explanation, no markdown.

[JSON_START]
{{"source": "<podcast show name, not episode title>", "insights": [{{"insight": "...", "expert": "...", "section": "...", "confidence": "HIGH|MEDIUM|LOW"}}]}}
[JSON_END]

Title: {title}
Content: {content}
"""


def _ollama_reachable():
    try:
        r = requests.get(LLM_API_BASE.rstrip("/v1").rstrip("/") + "/api/tags", timeout=3)
        return r.status_code == 200
    except Exception:
        return False


def _log_llm_usage(activity, model, usage):
    """Fire-and-forget: write one LLM call to cvc.llm_usage_log on Dell."""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO cvc.llm_usage_log "
                "(activity, model, prompt_tokens, completion_tokens, cost) "
                "VALUES (%s, %s, %s, %s, %s)",
                (activity, model.split("/")[-1],
                 usage.get("prompt_tokens", 0),
                 usage.get("completion_tokens", 0),
                 usage.get("cost", 0)),
            )
        conn.commit()
        conn.close()
    except Exception:
        pass


def call_llm(prompt, max_tokens=1200, task="enrichment"):
    """
    Task dispatcher:
      task="relevance"  → local Ollama (qwen3:30b-a3b), fallback OpenRouter qwen3-235b
      task="enrichment" → local Ollama (qwen3:30b-a3b), fallback OpenRouter qwen3-235b
      task="synthesis"  → OpenRouter kimi-k2.5 (no local fallback — cloud-only)
    """
    messages = [{"role": "user", "content": prompt}]

    # ── Podcast synthesis → always cloud (kimi-k2.5) ─────────────────────────
    if task == "synthesis":
        try:
            r = requests.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": OPENROUTER_SYNTHESIS,
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": 0.1,
                },
                timeout=120,
            )
            r.raise_for_status()
            _d = r.json()
            _log_llm_usage("Podcast Synthesis", OPENROUTER_SYNTHESIS, _d.get("usage", {}))
            return _d["choices"][0]["message"]["content"]
        except Exception as e:
            print(f"    OpenRouter synthesis error: {e}")
            return ""

    # ── Relevance / Enrichment → local Ollama, fallback cloud ────────────────
    if LLM_API_BASE and _ollama_reachable():
        try:
            r = requests.post(
                LLM_API_BASE.rstrip("/") + "/chat/completions",
                headers={"Content-Type": "application/json"},
                json={
                    "model": OLLAMA_MODEL,
                    "messages": messages,
                    "options": {
                        "temperature": 0.1,
                        "num_ctx": 32768,
                        "stop": ["[JSON_END]"],
                    },
                },
                timeout=180,
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
        except Exception as e:
            print(f"    Ollama error (falling back to cloud): {e}")

    # Fallback: OpenRouter qwen3-235b
    try:
        r = requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENROUTER_MODEL,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0.1,
            },
            timeout=120,
        )
        r.raise_for_status()
        _d = r.json()
        _log_llm_usage("Briefing Enrichment", OPENROUTER_MODEL, _d.get("usage", {}))
        return _d["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"    OpenRouter error: {e}")
        return ""


def parse_json(text):
    if not text:
        return None

    # 1. Strip <think>...</think> blocks
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)

    # 2. Extract content between [JSON_START] and [JSON_END] markers
    marker_match = re.search(r"\[JSON_START\](.*?)(?:\[JSON_END\]|$)", text, re.DOTALL)
    if marker_match:
        candidate = marker_match.group(1).strip()
        try:
            return json.loads(candidate)
        except Exception:
            pass  # markers present but content malformed — fall through

    # 3. Fallback: find the LAST balanced {} object in the text
    last_result = None
    depth = 0
    start = -1
    for i, c in enumerate(text):
        if c == "{":
            if depth == 0:
                start = i
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                try:
                    last_result = json.loads(text[start:i + 1])
                except Exception:
                    pass
                start = -1
    if last_result is not None:
        return last_result

    # 4. Last resort: parse the whole stripped string
    try:
        return json.loads(text.strip())
    except Exception:
        return None


def score_relevance(title, raw_text):
    excerpt = (raw_text or "")[:800]
    prompt = RELEVANCE_PROMPT.format(
        sector_focus=_cfg.get("sector_focus"),
        title=title, excerpt=excerpt,
    )
    response = call_llm(prompt, max_tokens=150, task="relevance")
    result = parse_json(response)
    if result and "score" in result:
        return result["score"], result.get("reason", "")
    return 5, "Could not parse score"


def enrich_content(title, raw_text, content_type):
    if content_type == "podcast_episode":
        content = (raw_text or "")[:8000]
    elif content_type == "company_news":
        content = (raw_text or "")[:3000]
    else:
        content = (raw_text or "")[:4000]
    prompt = ENRICHMENT_PROMPT.format(
        analyst_context=_cfg.get("analyst_context"),
        title=title, content=content,
    )
    response = call_llm(prompt, max_tokens=1200, task="enrichment")
    return parse_json(response)


def generate_podcast_synthesis(title, raw_text):
    content = (raw_text or "")[:8000]
    prompt = PODCAST_SYNTHESIS_PROMPT.format(
        investment_thesis=_cfg.get("investment_thesis"),
        corporate_partners_context=_cfg.get("corporate_partners_context"),
        title=title, content=content,
    )
    response = call_llm(prompt, max_tokens=6000, task="synthesis")
    result = parse_json(response)
    if result and "insights" in result:
        return result
    return None


def run_enrichment(batch_size=50, relevance_threshold=4):
    print(f"\nFetching up to {batch_size} raw content items...")

    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("""
        SELECT id, title, raw_text, summary, content_type
        FROM cvc.content_items
        WHERE enrichment_status = 'raw'
          AND content_type IN ('article', 'podcast_episode', 'company_news')
        ORDER BY
          CASE content_type
            WHEN 'podcast_episode' THEN 1
            WHEN 'company_news' THEN 2
            ELSE 3
          END,
          length(COALESCE(raw_text, '')) DESC
        LIMIT %s
    """, (batch_size,))

    items = cur.fetchall()
    if not items:
        print("No raw content to enrich.")
        conn.close()
        return {"enriched": 0, "skipped": 0, "failed": 0}

    print(f"Found {len(items)} items to process\n")

    enriched = skipped = failed = 0

    for i, item in enumerate(items):
        title = item["title"][:65]
        content_type = item["content_type"]
        text_len = len(item.get("raw_text") or "")

        print(f"[{i+1}/{len(items)}] ({content_type}, {text_len} chars) {title}...")

        # Stage 1: Relevance filter
        score, reason = score_relevance(item["title"], item.get("raw_text") or item.get("summary") or "")
        print(f"    Relevance: {score}/10 - {reason}")

        if score < relevance_threshold:
            cur.execute("""
                UPDATE cvc.content_items
                SET enrichment_status = 'summarized', tags = %s
                WHERE id = %s
            """, (json.dumps(["skipped", f"relevance:{score}"]), item["id"]))
            conn.commit()
            skipped += 1
            print(f"    SKIPPED (below threshold {relevance_threshold})")
            continue

        # Stage 2: Full enrichment
        result = enrich_content(item["title"], item.get("raw_text") or item.get("summary") or "", content_type)

        if result:
            summary = result.get("summary", "")
            entities = result.get("entities", {})
            tags = result.get("tags", [])
            sentiment = result.get("sentiment", "neutral")
            insights = result.get("insights", [])
            relevance = result.get("relevance_to_firm", "")

            if insights:
                summary = summary + "\n\nKey Insights:\n" + "\n".join(f"- {ins}" for ins in insights)
            if relevance:
                summary = summary + "\n\nFirm Relevance: " + relevance

            # Stage 3: Podcast synthesis (podcast_episode only)
            podcast_synthesis = None
            if content_type == "podcast_episode":
                podcast_synthesis = generate_podcast_synthesis(
                    item["title"], item.get("raw_text") or item.get("summary") or ""
                )
                if podcast_synthesis:
                    print(f"    Podcast synthesis: {len(podcast_synthesis.get('insights', []))} insights")
                else:
                    print(f"    Podcast synthesis: failed to parse")

            cur.execute("""
                UPDATE cvc.content_items
                SET summary = %s,
                    key_entities = %s,
                    tags = %s,
                    sentiment = %s,
                    podcast_synthesis = %s,
                    enrichment_status = 'fully_enriched'
                WHERE id = %s
            """, (
                summary[:5000],
                json.dumps(entities),
                json.dumps(tags),
                sentiment,
                json.dumps(podcast_synthesis) if podcast_synthesis else None,
                item["id"]
            ))
            conn.commit()
            enriched += 1
            print(f"    ENRICHED: {sentiment} | {len(tags)} tags | {len(insights)} insights")
        else:
            cur.execute("""
                UPDATE cvc.content_items SET enrichment_status = 'summarized' WHERE id = %s
            """, (item["id"],))
            conn.commit()
            failed += 1
            print(f"    FAILED to parse")

    conn.close()
    print(f"\n{'='*50}")
    print(f"ENRICHMENT: {enriched} enriched | {skipped} skipped | {failed} failed")
    print(f"{'='*50}")
    return {"enriched": enriched, "skipped": skipped, "failed": failed}


def backfill_podcast_synthesis():
    """Add podcast_synthesis to already-enriched podcasts that are missing it."""
    print("\nBackfilling podcast_synthesis for enriched podcasts...")

    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("""
        SELECT id, title, raw_text, summary
        FROM cvc.content_items
        WHERE content_type = 'podcast_episode'
          AND enrichment_status = 'fully_enriched'
          AND podcast_synthesis IS NULL
    """)
    items = cur.fetchall()

    if not items:
        print("All enriched podcasts already have podcast_synthesis.")
        conn.close()
        return

    print(f"Found {len(items)} podcasts needing synthesis\n")
    done = failed = 0

    for i, item in enumerate(items):
        title = item["title"][:65]
        print(f"[{i+1}/{len(items)}] {title}...")

        raw = item.get("raw_text") or item.get("summary") or ""
        synthesis = generate_podcast_synthesis(item["title"], raw)

        if synthesis:
            cur.execute("""
                UPDATE cvc.content_items SET podcast_synthesis = %s WHERE id = %s
            """, (json.dumps(synthesis), item["id"]))
            conn.commit()
            done += 1
            insight_count = len(synthesis.get("insights", []))
            print(f"    Done: {insight_count} insights extracted")
        else:
            failed += 1
            print(f"    Failed to parse")

    conn.close()
    print(f"\n{'='*50}")
    print(f"BACKFILL: {done} done | {failed} failed")
    print(f"{'='*50}")


if __name__ == "__main__":
    print("=" * 50)
    print("CVC ENRICHMENT WORKER v3.0")
    print("=" * 50)

    if LLM_API_BASE and _ollama_reachable():
        print(f"LLM [relevance/enrichment]: {OLLAMA_MODEL} via Ollama ({LLM_API_BASE})")
    elif OPENROUTER_API_KEY:
        print(f"LLM [relevance/enrichment]: {OPENROUTER_MODEL} via OpenRouter (Ollama unavailable)")
    else:
        print("ERROR: No LLM available — set LLM_API_BASE (Ollama) or OPENROUTER_API_KEY")
        sys.exit(1)
    if OPENROUTER_API_KEY:
        print(f"LLM [synthesis]:            {OPENROUTER_SYNTHESIS} via OpenRouter")
    else:
        print("WARNING: OPENROUTER_API_KEY not set — podcast synthesis will fail")

    if "--backfill" in sys.argv:
        backfill_podcast_synthesis()
    else:
        batch = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 50
        threshold = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 4
        run_id = start_job("Briefing Content Enrichment", "refinery")
        try:
            stats = run_enrichment(batch, threshold) or {}
            finish_job(run_id, "ok", stats)
        except Exception as e:
            finish_job(run_id, "error", error_text=str(e))
            raise
