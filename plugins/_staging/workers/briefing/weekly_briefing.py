#!/usr/bin/env python3
"""
CVC Weekly Intelligence Briefing
Covers the previous Mon–Sun calendar week.
Sources: podcast_episode, company_news, article — all fully_enriched content.

Outputs a Telegram-ready briefing to stdout.
Stores per-week aggregates in weekly_signals table for year-end trend analysis.

Usage:
  python3 weekly_briefing.py           # previous complete Mon-Sun week
  python3 weekly_briefing.py --dry-run # print briefing, skip DB write
  python3 weekly_briefing.py --week 2026-03-02  # specific week (any date in that week)
"""
import os
import re
import sys
import json
import requests
import argparse
import psycopg2
import psycopg2.extras
from collections import Counter
from datetime import datetime, timedelta, date
from urllib.parse import urlparse as _urlparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "core"))
from config_loader import config as _cfg
from weekly_delta import generate_delta_section
from job_logger import start_job, finish_job
from notifications import write_cron_error

# ── Config ────────────────────────────────────────────────────────────────────

DB_CONFIG = {
    "dbname": "cvc_db",
    "user": "producer",
    "password": os.environ["CVC_DB_PASSWORD"],
    "host": os.environ.get("CVC_DB_HOST", "localhost"),
    "port": 5432
}

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "moonshotai/kimi-k2.5"
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")



def _log_llm_usage(activity, model, usage):
    """Fire-and-forget: write one LLM call to cvc.llm_usage_log."""
    try:
        import psycopg2
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

# ── Date helpers ───────────────────────────────────────────────────────────────

def get_week_window(ref_date=None):
    """Return (monday, sunday) for the previous complete Mon–Sun week."""
    today = ref_date or date.today()
    days_since_monday = today.weekday()  # 0=Mon, 6=Sun
    if days_since_monday == 6:
        # Today IS Sunday — the current week just ended, use Mon-today
        last_monday = today - timedelta(days=6)
    else:
        # Mid-week — report on the previous complete Mon-Sun week
        last_monday = today - timedelta(days=days_since_monday + 7)
    last_sunday = last_monday + timedelta(days=6)
    return last_monday, last_sunday


# ── DB helpers ────────────────────────────────────────────────────────────────

def get_week_content(conn, week_start, week_end):
    """Pull all fully_enriched content for the given Mon–Sun window.

    Uses published_at for articles/news (when it was published) so that
    backfilled content still lands in the correct week's briefing.
    Falls back to created_at when published_at is null (podcasts).
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            id, content_type, title, url,
            summary, tags, sentiment,
            key_entities, podcast_synthesis, article_synthesis,
            created_at
        FROM cvc.content_items
        WHERE enrichment_status = 'fully_enriched'
          AND COALESCE(published_at, created_at) >= %s
          AND COALESCE(published_at, created_at) < %s
          AND content_type IN ('podcast_episode', 'company_news', 'article')
        ORDER BY content_type, COALESCE(published_at, created_at) DESC
    """, (week_start, week_end + timedelta(days=1)))
    rows = cur.fetchall()
    cur.close()
    return rows


def aggregate_signals(items):
    """Extract sentiment counts, top tags, top companies/technologies."""
    sentiment_counts = Counter()
    tag_counts = Counter()
    company_counts = Counter()
    tech_counts = Counter()

    for item in items:
        # Sentiment
        s = (item.get("sentiment") or "neutral").lower()
        if s in ("positive", "bullish"):
            sentiment_counts["positive"] += 1
        elif s in ("negative", "bearish"):
            sentiment_counts["negative"] += 1
        else:
            sentiment_counts["neutral"] += 1

        # Tags
        tags = item.get("tags") or []
        if isinstance(tags, str):
            try:
                tags = json.loads(tags)
            except:
                tags = []
        for t in tags:
            if isinstance(t, str) and len(t) > 2:
                tag_counts[t.lower()] += 1

        # Entities
        entities = item.get("key_entities") or {}
        if isinstance(entities, str):
            try:
                entities = json.loads(entities)
            except:
                entities = {}
        for company in entities.get("companies", []):
            if company and len(company) > 2:
                company_counts[company] += 1
        for tech in entities.get("technologies", []):
            if tech and len(tech) > 2:
                tech_counts[tech] += 1

    return {
        "sentiment": sentiment_counts,
        "top_tags": tag_counts.most_common(10),
        "top_companies": company_counts.most_common(10),
        "top_technologies": tech_counts.most_common(8),
    }


def save_weekly_signals(conn, week_start, week_end, items, signals, briefing_text, dry_run=False):
    """Store per-week aggregates in weekly_signals."""
    by_type = Counter(i["content_type"] for i in items)
    s = signals["sentiment"]

    data = {
        "week_start": week_start,
        "week_end": week_end,
        "total_items": len(items),
        "podcast_count": by_type.get("podcast_episode", 0),
        "news_count": by_type.get("company_news", 0),
        "article_count": by_type.get("article", 0),
        "sentiment_positive": s.get("positive", 0),
        "sentiment_neutral": s.get("neutral", 0),
        "sentiment_negative": s.get("negative", 0),
        "top_tags": json.dumps([{"tag": t, "count": c} for t, c in signals["top_tags"]]),
        "top_companies": json.dumps([{"company": c, "count": n} for c, n in signals["top_companies"]]),
        "top_technologies": json.dumps([{"tech": t, "count": n} for t, n in signals["top_technologies"]]),
        "briefing_text": briefing_text,
    }

    if dry_run:
        print("\n[dry-run] Would write to weekly_signals:")
        for k, v in data.items():
            if k != "briefing_text":
                print(f"  {k}: {v}")
        return

    cur = conn.cursor()
    cur.execute("""
        INSERT INTO cvc.weekly_signals
            (week_start, week_end, total_items, podcast_count, news_count, article_count,
             sentiment_positive, sentiment_neutral, sentiment_negative,
             top_tags, top_companies, top_technologies, briefing_text)
        VALUES
            (%(week_start)s, %(week_end)s, %(total_items)s, %(podcast_count)s,
             %(news_count)s, %(article_count)s,
             %(sentiment_positive)s, %(sentiment_neutral)s, %(sentiment_negative)s,
             %(top_tags)s, %(top_companies)s, %(top_technologies)s, %(briefing_text)s)
        ON CONFLICT (week_start) DO UPDATE SET
            total_items = EXCLUDED.total_items,
            podcast_count = EXCLUDED.podcast_count,
            news_count = EXCLUDED.news_count,
            article_count = EXCLUDED.article_count,
            sentiment_positive = EXCLUDED.sentiment_positive,
            sentiment_neutral = EXCLUDED.sentiment_neutral,
            sentiment_negative = EXCLUDED.sentiment_negative,
            top_tags = EXCLUDED.top_tags,
            top_companies = EXCLUDED.top_companies,
            top_technologies = EXCLUDED.top_technologies,
            briefing_text = EXCLUDED.briefing_text,
            created_at = now()
    """, data)
    conn.commit()
    cur.close()


# ── LLM synthesis ─────────────────────────────────────────────────────────────

def extract_podcast_insights(podcasts):
    """Pull structured insights already extracted by the enrichment pipeline.

    Caps at 2 insights per episode so no single podcast floods the pool.
    Returns up to 20 insights for format_briefing to apply its own diversity pass.
    """
    insights = []
    seen_text: set = set()
    for ep in podcasts:
        synthesis = ep.get("podcast_synthesis")
        if isinstance(synthesis, str):
            try:
                synthesis = json.loads(synthesis)
            except:
                synthesis = None
        if not synthesis:
            continue
        source = synthesis.get("source", ep.get("title", ""))
        ep_title = ep.get("title", "")
        ep_url   = ep.get("url", "")
        count = 0
        conf_order = {"HIGH": 0, "MEDIUM": 1}
        sorted_insights = sorted(
            (synthesis.get("insights") or []),
            key=lambda x: conf_order.get(x.get("confidence", ""), 2)
        )
        for item in sorted_insights:
            if count >= 2:  # max 2 per episode
                break
            text = item.get("insight", "")
            if not text or item.get("confidence") not in ("HIGH", "MEDIUM"):
                continue
            # Deduplicate by first 80 chars of insight text
            key = text[:80].lower().strip()
            if key in seen_text:
                continue
            seen_text.add(key)
            expert = item.get("expert", "")
            insights.append({
                "source":     source,
                "episode":    ep_title,
                "url":        ep_url,
                "expert":     expert,
                "insight":    text,
                "section":    item.get("section", ""),
                "confidence": item.get("confidence", ""),
            })
            count += 1
    return insights[:20]


def synthesize_news(news_items):
    """Run LLM on news summaries to extract the week's key signals.

    Returns a list of dicts: [{title, url, insight}] for structured storage.
    Falls back to [] on failure.
    """
    if not news_items:
        return []

    lines = []
    item_map = {}  # index → item for url lookup
    for idx, item in enumerate(news_items[:40]):
        summary = (item.get("summary") or item.get("title") or "").strip()[:400]
        if summary:
            lines.append(f"[{idx}] {item['title']}\n  {summary}")
            item_map[idx] = item

    context = "\n\n".join(lines)

    prompt = f"""You are a business intelligence analyst for Claw Venture Capital (CVC).
{_cfg.get("investment_thesis")}
{_cfg.get("corporate_partners_context")}

Review this week's news. Identify the 8 most signal-rich items for CVC —
things that affect our corporate partners, our investment thesis, or our deal pipeline.
Prioritise items with real-world impact: funding rounds, product launches, customer wins,
regulatory shifts, M&A. Do not include opinion pieces or general commentary.

NEWS THIS WEEK:
{context}

Respond with up to 8 items as a JSON array. Each item:
{{"index": <source index from above>, "insight": "<one sentence what happened + one sentence why it matters for CVC>"}}

JSON only — no preamble, no markdown fences."""

    try:
        resp = requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "qwen/qwen3-235b-a22b-2507",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 1400,
                "temperature": 0.2,
            },
            timeout=120,
        )
        resp.raise_for_status()
        _d = resp.json()
        _log_llm_usage("Weekly Briefing News", "qwen/qwen3-235b-a22b-2507", _d.get("usage", {}))
        raw = (_d["choices"][0]["message"]["content"] or "").strip()
        # Strip markdown fences if model added them
        raw = raw.strip("` \n")
        if raw.startswith("json"):
            raw = raw[4:].strip()
        parsed = json.loads(raw)
        results = []
        for entry in parsed:
            idx = entry.get("index")
            source_item = item_map.get(idx, {})
            results.append({
                "title":   source_item.get("title", ""),
                "url":     source_item.get("url", ""),
                "insight": entry.get("insight", ""),
            })
        return results
    except Exception as e:
        print(f"[news synthesis error: {e}]", flush=True)
        return []


# ── Display section classification ───────────────────────────────────────────

# Ordered: first match wins. Keyword scanning on insight text + source name.
DISPLAY_SECTIONS = [
    ("Artificial Intelligence",    "🤖", [
        "large language model", "foundation model", "language model", "llm", "gpt-",
        "chatgpt", "claude", "gemini", "openai", "anthropic", "deepseek", "mistral",
        "machine learning", "deep learning", "neural network", "generative ai",
        "transformer model", "inference", "training run", "fine-tun",
        "ai agent", "agentic", "multi-agent",
    ]),
    ("Robotics & Physical AI",     "🦾", [
        "physical ai", "embodied ai", "humanoid robot", "humanoid",
        "autonomous mobile robot", "amr", "cobot", "collaborative robot",
        "robotic arm", "dexterous", "manipulation", "actuator",
        "robot", "robotics",
    ]),
    ("Supply Chain & Logistics",   "🚚", [
        "supply chain", "logistics", "freight", "warehouse", "fulfillment",
        "last-mile", "last mile", "trucking", "shipper", "carrier",
        "3pl", "distribution center", "parcel", "cold chain",
        "port congestion", "ocean freight", "air cargo",
    ]),
    ("Manufacturing & Industrial", "🏭", [
        "manufacturing", "industrial automation", "factory", "shop floor",
        "plc", "scada", "mes ", "erp ", "sap ", "opc-ua",
        "plant operations", "production line", "assembly", "cnc",
        "additive manufacturing", "3d printing",
    ]),
    ("Semiconductors & Hardware",  "💾", [
        "semiconductor", "chip shortage", "chip ", "nvidia", "intel ", "amd ",
        "tsmc", "samsung foundry", "foundry", "silicon ", "wafer",
        "gpu ", "cpu ", "fpga", "asic", "arm chip", "packaging",
    ]),
    ("Defense & Government",       "🛡", [
        "defense", "military", "pentagon", "department of defense", "dod",
        "darpa", "nato", "national security", "drone strike", "uav",
        "autonomous weapon", "export control", "sanctions", "dod contract",
        "government contract", "federal procurement",
    ]),
    ("Macro & Markets",            "📊", [
        "macro", "gdp", "inflation", "federal reserve", "fed funds", "interest rate",
        "recession", "tariff", "trade war", "geopolit", "s&p 500", "nasdaq",
        "equity market", "stock market", "oil price", "hedge fund",
        "central bank", "monetary policy", "fiscal", "debt ceiling",
    ]),
    ("Venture Capital & Funding",  "💰", [
        "venture capital", "series a", "series b", "series c", "seed round",
        "raised ", "funding round", "led by ", "valuation", "unicorn",
        "ipo ", "acquisition", "m&a", "spac", "carried interest",
        "limited partner", " lp ", "general partner", " gp ",
        "startup funding", "portfolio company",
    ]),
]


def _classify_display_section(text: str) -> str:
    """Return the display section name for an insight. First keyword match wins."""
    lower = text.lower()
    for name, _emoji, keywords in DISPLAY_SECTIONS:
        if any(kw in lower for kw in keywords):
            return name
    return "General"


# ── Sector tagging ────────────────────────────────────────────────────────────

# Maps briefing_sources.category (lowercased) → CVC canonical sector(s)
_CATEGORY_TO_SECTORS = {
    "supply chain":             ["Supply Chain"],
    "supply chain / robotics":  ["Supply Chain", "Robotics"],
    "robotics":                 ["Robotics"],
    "robotics ":                ["Robotics"],   # trailing-space variant in DB
    "robotics / industrial":    ["Robotics", "Industrial Automation"],
    "robotics / physical ai":   ["Robotics", "Physical AI"],
    "robotics / agtech":        ["Robotics"],
    "physical ai":              ["Physical AI"],
    "physical ai / robotics":   ["Physical AI", "Robotics"],
    "industrial automation":    ["Industrial Automation"],
    "erp / enterprise":         ["Manufacturing"],
    "erp / enterprise software":["Manufacturing"],
    "tech / physical ai":       ["Physical AI"],
    "markets":                  ["General"],
    "tech":                     ["General"],
    "tech / ai":                ["General"],
    "tech / vc":                ["General"],
    "vc":                       ["General"],
    "vc / funding":             ["General"],
    "vc / macro":               ["General"],
    "canadian tech":            ["General"],
}

# Keyword → sector for news insight text classification
_NEWS_KEYWORDS = {
    "Supply Chain":          ["supply chain", "logistics", "freight", "warehouse", "fulfillment", "shipper", "trucking", "last.mile"],
    "Robotics":              ["robot", "robotics", "autonomous", "amr", "cobots", "manipulation"],
    "Physical AI":           ["physical ai", "embodied ai", "humanoid", "foundation model", "physical intelligence"],
    "Industrial Automation": ["automation", "plc", "scada", "industrial", "manufacturing execution", "mes", "factory"],
    "Manufacturing":         ["manufacturing", "erp", "sap", "production", "plant"],
}


def _source_sectors(conn, show_name: str) -> list[str]:
    """Look up a source's category from briefing_sources and map to CVC sectors."""
    if not show_name:
        return ["General"]
    with conn.cursor() as cur:
        cur.execute(
            "SELECT category FROM cvc.briefing_sources WHERE lower(name) = lower(%s) LIMIT 1",
            (show_name.strip(),)
        )
        row = cur.fetchone()
    if not row or not row[0]:
        return ["General"]
    sectors = _CATEGORY_TO_SECTORS.get(row[0].strip().lower(), ["General"])
    return sectors


def _classify_news_sector(text: str) -> str:
    """Simple keyword scan on insight text to assign a sector. Returns first match."""
    lower = text.lower()
    for sector, keywords in _NEWS_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            return sector
    return "General"


def collect_partner_signals(conn, week_start, week_end):
    """
    Find content items from this week that mention CVC partners (via entity resolution).
    Returns a list of dicts: {partner_name, title, url, summary, content_type}

    One row per (partner, content_item) pair. Caps at 4 items per partner to avoid flooding.
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute("""
            SELECT DISTINCT ON (p.name, ci.id)
                p.name          AS partner_name,
                ci.title        AS title,
                ci.url          AS url,
                ci.content_type AS content_type,
                COALESCE(ci.summary, '') AS summary,
                COALESCE(ci.published_at, ci.created_at)::date AS pub_date
            FROM cvc.content_items ci
            CROSS JOIN LATERAL
                jsonb_array_elements_text(ci.key_entities->'companies') AS cn(company_name)
            JOIN cvc.entities e
                ON lower(trim(cn.company_name)) = lower(e.name)
            JOIN cvc.partners p ON p.id = e.partner_id
            WHERE ci.key_entities IS NOT NULL
              AND ci.key_entities ? 'companies'
              AND e.partner_id IS NOT NULL
              AND COALESCE(ci.published_at, ci.created_at) >= %s
              AND COALESCE(ci.published_at, ci.created_at) < %s
              AND ci.enrichment_status IN ('fully_enriched', 'summarized')
            ORDER BY p.name, ci.id, pub_date DESC
        """, (week_start, week_end + timedelta(days=1)))
        rows = cur.fetchall()
    except Exception as e:
        print(f"[partner signals error: {e}]", flush=True)
        return []
    finally:
        cur.close()

    # Cap at 4 items per partner
    partner_counts: Counter = Counter()
    results = []
    for r in rows:
        pname = r["partner_name"]
        if partner_counts[pname] >= 4:
            continue
        partner_counts[pname] += 1
        results.append({
            "partner_name": pname,
            "title":        r["title"] or "",
            "url":          r["url"] or "",
            "content_type": r["content_type"] or "article",
            "summary":      r["summary"] or "",
            "pub_date":     str(r["pub_date"]) if r["pub_date"] else "",
        })
    return results


def save_insights(conn, week_start, podcast_insights, news_insights, partner_signals=None, portfolio_news=None, dry_run=False):
    """Write individual insights to cvc.briefing_insights with sector tags."""
    if dry_run:
        print(f"[dry-run] Would write {len(podcast_insights)} podcast + {len(news_insights)} news insights + {len(partner_signals or [])} partner signals + {len(portfolio_news or [])} portfolio items")
        return

    rows = []
    for ins in podcast_insights:
        show = ins.get("source", "")
        sectors = _source_sectors(conn, show)
        # One row per sector (podcast may span two sectors e.g. supply chain + robotics)
        for sector in sectors:
            rows.append((
                week_start, "podcast",
                ins.get("episode", ""), ins.get("url", ""),
                show, ins.get("insight", ""),
                ins.get("expert", ""), ins.get("confidence", ""),
                sector,
            ))
    for ins in news_insights:
        sector = _classify_news_sector(ins.get("insight", "") + " " + ins.get("title", ""))
        rows.append((
            week_start, "news",
            ins.get("title", ""), ins.get("url", ""),
            None, ins.get("insight", ""),
            None, None,
            sector,
        ))

    # Partner signals — one row per (partner, article) pair
    for sig in (partner_signals or []):
        rows.append((
            week_start, "partner_signal",
            sig.get("title", ""), sig.get("url", ""),
            sig.get("partner_name", ""), sig.get("summary", ""),
            None, None,
            "Partners",
        ))

    # Portfolio news is rendered directly from briefing_text (Portfolio Pulse section)
    # — not stored in briefing_insights to avoid leaking into the Podcasts tab

    if not rows:
        return

    with conn.cursor() as cur:
        # Delete existing rows for this week before re-inserting so re-runs don't duplicate
        source_types = list({r[1] for r in rows})
        cur.execute("""
            DELETE FROM cvc.briefing_insights
            WHERE week_start = %s AND source_type = ANY(%s)
        """, (week_start, source_types))
        cur.executemany("""
            INSERT INTO cvc.briefing_insights
                (week_start, source_type, source_title, source_url, show_name,
                 insight, expert, confidence, sector)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, rows)
    conn.commit()


def get_portfolio_news(conn, week_start, week_end):
    """
    Pull news for portfolio companies from the past week.
    Sources:
      1. portco_announcements posted during the week window
      2. news_articles JSONB on companies (scraped by portco_news_worker) with recent age strings
    Returns list of {company_name, title, url, snippet, type}
    """
    results = []
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # 1. Manual / curated announcements posted this week
    cur.execute("""
        SELECT c.name AS company_name,
               pa.title, pa.source_url AS url,
               LEFT(pa.body, 300) AS snippet,
               'announcement' AS type
        FROM cvc.portco_announcements pa
        JOIN cvc.companies c ON c.id = pa.company_id
        WHERE pa.announced_date >= %s
          AND pa.announced_date <= %s
          AND pa.is_public = TRUE
        ORDER BY pa.announced_date DESC
        LIMIT 20
    """, (week_start, week_end + timedelta(days=1)))
    results.extend(dict(r) for r in cur.fetchall())

    # 2. Scraped news articles — only include if date falls within the briefing week
    # Articles with no parseable date are saved to DB but not shown in the briefing
    cur.execute("""
        SELECT c.name AS company_name,
               art->>'title'   AS title,
               art->>'url'     AS url,
               LEFT(art->>'snippet', 300) AS snippet,
               art->>'age'     AS age,
               'scraped'       AS type
        FROM cvc.companies c
        CROSS JOIN LATERAL jsonb_array_elements(c.news_articles) AS art
        WHERE c.is_portfolio = TRUE
          AND c.news_articles IS NOT NULL
          AND jsonb_array_length(c.news_articles) > 0
        LIMIT 300
    """)
    for row in cur.fetchall():
        age_str = (row.get("age") or "").strip()
        if not age_str:
            continue  # no date — skip briefing, still in DB for company pages
        include = False
        # Relative strings — treat as this week
        if any(k in age_str.lower() for k in ("hour", "day", "yesterday", "week")):
            include = True
        else:
            # Try to parse absolute date strings
            for fmt in ("%b %d, %Y", "%B %d, %Y", "%Y-%m-%d", "%m/%d/%Y"):
                try:
                    parsed_date = datetime.strptime(age_str[:20].strip(), fmt).date()
                    if week_start <= parsed_date <= week_end:
                        include = True
                    break
                except ValueError:
                    continue
        if include:
            results.append(dict(row))
    cur.close()

    # Deduplicate by URL (or title), cap at 2 per company for variety
    seen: set = set()
    co_seen: Counter = Counter()
    deduped = []
    for r in results:
        co = r.get("company_name", "")
        if co_seen[co] >= 2:
            continue
        key = (r.get("url") or r.get("title") or "").strip().lower()
        if key and key not in seen:
            seen.add(key)
            co_seen[co] += 1
            deduped.append(r)

    return deduped[:20]


def format_briefing(week_start, week_end, items, signals, podcast_insights, news_insights, portfolio_news=None):
    """Compose the final briefing, grouped by display section.

    Podcast and news insights are mixed together and bucketed into themed
    sections (AI, Robotics, Supply Chain, etc.) rather than one flat list.
    """
    by_type = Counter(i["content_type"] for i in items)
    top_companies = [c for c, _ in signals["top_companies"][:5]]

    lines = []
    lines.append(f"🦀 **Weekly Intel — {week_start.strftime('%b %d')} to {week_end.strftime('%b %d, %Y')}**\n")
    lines.append(
        f"_{by_type.get('podcast_episode', 0)} podcasts · "
        f"{by_type.get('company_news', 0) + by_type.get('article', 0)} news items_\n"
    )

    # ── Step 1: build a flat pool of formatted bullet strings, each tagged with a section ──

    pool: list[tuple[str, str]] = []   # (section_name, bullet_string)

    # Podcast: diversity-aware selection (max 2 per episode, HIGH first)
    if podcast_insights:
        selected_pod = []
        ep_counts: Counter = Counter()
        seen_ikeys: set = set()
        for ins in podcast_insights:
            ep_key = ins.get("episode") or ins["source"]
            ikey = ins["insight"][:80].lower().strip()
            if ins["confidence"] == "HIGH" and ep_counts[ep_key] == 0 and ikey not in seen_ikeys:
                selected_pod.append(ins)
                ep_counts[ep_key] += 1
                seen_ikeys.add(ikey)
            if len(selected_pod) >= 8:
                break
        for ins in podcast_insights:
            if len(selected_pod) >= 8:
                break
            ep_key = ins.get("episode") or ins["source"]
            ikey = ins["insight"][:80].lower().strip()
            if ep_counts[ep_key] < 2 and ikey not in seen_ikeys:
                selected_pod.append(ins)
                ep_counts[ep_key] += 1
                seen_ikeys.add(ikey)

        for ins in selected_pod:
            expert_short = ins["expert"].split(",")[0] if ins["expert"] else ""
            show = ins.get("source", "").strip()
            url  = ins.get("url", "").strip()
            if expert_short and show:
                attr = f"{expert_short} — {show}"
            elif expert_short:
                attr = expert_short
            else:
                attr = show or "Podcast"
            tag     = f" [[{attr}]({url})]" if url else f" [{attr}]"
            bullet  = f"• {ins['insight']}{tag}"
            section = _classify_display_section(ins["insight"] + " " + show)
            pool.append((section, bullet))

    # News: up to 10 structured insights
    for ins in news_insights[:10]:
        title  = ins.get("title", "")
        url    = ins.get("url", "")
        tag    = f" [[{title}]({url})]" if url and title else (f" [{title}]" if title else "")
        bullet = f"• {ins['insight']}{tag}"
        section = _classify_display_section(ins.get("insight", "") + " " + title)
        pool.append((section, bullet))

    # ── Step 2: group by section, preserving DISPLAY_SECTIONS order ──

    section_order = [name for name, _, _ in DISPLAY_SECTIONS] + ["General"]
    section_emoji = {name: emoji for name, emoji, _ in DISPLAY_SECTIONS}
    section_emoji["General"] = "📌"

    grouped: dict[str, list[str]] = {s: [] for s in section_order}
    for section, bullet in pool:
        if section not in grouped:
            grouped[section] = []
        grouped[section].append(bullet)

    # ── Step 3: render each non-empty section ──

    any_section = False
    for section in section_order:
        bullets = grouped.get(section, [])
        if not bullets:
            continue
        emoji = section_emoji.get(section, "📌")
        lines.append(f"{emoji} **{section.upper()}**")
        lines.extend(bullets)
        lines.append("")
        any_section = True

    if not any_section:
        lines.append("_No signals this week._\n")

    # Portfolio Pulse — this week's portco news, max 2 per company, max 10 total
    if portfolio_news:
        lines.append("📈 **PORTFOLIO PULSE**")
        co_counts: Counter = Counter()
        pulse_count = 0
        for item in portfolio_news:
            if pulse_count >= 10:
                break
            co    = item.get("company_name", "")
            title = item.get("title", "")
            url   = item.get("url", "")
            if not co or not title:
                continue
            if co_counts[co] >= 2:
                continue
            # Use the bare domain as link text — scraped article titles are
            # often noisy 200-char snippets. Domain is always clean and short.
            if url:
                domain = _urlparse(url).netloc.replace("www.", "") or url
                tag = f" [[{domain}]({url})]"
            else:
                # No URL — show a truncated title
                short = title[:60].rstrip() + ("…" if len(title) > 60 else "")
                tag = f" {short}"
            lines.append(f"• **{co}**{tag}")
            co_counts[co] += 1
            pulse_count += 1
        lines.append("")

    # Companies in focus (compact footer)
    if top_companies:
        lines.append(f"🏢 _Companies in focus: {', '.join(top_companies)}_\n")

    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def _is_job_enabled(name: str) -> bool:
    """Fail-open: returns True if job not found or DB unreachable."""
    try:
        conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)
        with conn.cursor() as cur:
            cur.execute("SELECT active FROM cvc.cron_jobs WHERE name = %s LIMIT 1", (name,))
            row = cur.fetchone()
        conn.close()
        return bool(row["active"]) if row else True
    except Exception:
        return True


def run(week_ref=None, dry_run=False, force_start=None, force_end=None):
    if not _is_job_enabled("Weekly Briefing Generation"):
        print("Job disabled in scheduler — exiting", flush=True)
        return 0

    if force_start and force_end:
        week_start, week_end = force_start, force_end
    else:
        week_start, week_end = get_week_window(week_ref)
    print(f"📅 Week: {week_start} to {week_end}\n", flush=True)

    conn = psycopg2.connect(**DB_CONFIG)
    items = get_week_content(conn, week_start, week_end)

    if not items:
        msg = (
            f"🦀 **Weekly Intel — {week_start.strftime('%b %d')} to {week_end.strftime('%b %d, %Y')}**\n\n"
            f"No enriched content found for this week.\n"
            f"Check that the Researcher collection worker and Refinery enrichment pipeline ran."
        )
        print(msg)
        conn.close()
        return 1

    podcasts   = [i for i in items if i["content_type"] == "podcast_episode"]
    news       = [i for i in items if i["content_type"] in ("company_news", "article")]

    signals          = aggregate_signals(items)
    podcast_insights = extract_podcast_insights(podcasts)
    news_insights    = synthesize_news(news)
    partner_signals  = collect_partner_signals(conn, week_start, week_end)
    portfolio_news   = get_portfolio_news(conn, week_start, week_end)
    print(f"Partner signals: {len(partner_signals)} items across {len(set(s['partner_name'] for s in partner_signals))} partners", flush=True)
    print(f"Portfolio news: {len(portfolio_news)} items across {len(set(i['company_name'] for i in portfolio_news))} companies", flush=True)

    briefing = format_briefing(week_start, week_end, items, signals, podcast_insights, news_insights, portfolio_news=portfolio_news)

    delta_section = generate_delta_section(conn, week_start)
    if delta_section:
        briefing += delta_section

    save_weekly_signals(conn, week_start, week_end, items, signals, briefing, dry_run=dry_run)
    save_insights(conn, week_start, podcast_insights, news_insights, partner_signals=partner_signals, portfolio_news=portfolio_news, dry_run=dry_run)
    conn.close()

    print(briefing)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Skip DB write")
    parser.add_argument("--week", type=str, default=None,
                        help="Any date in the target week (YYYY-MM-DD). Default: previous week.")
    parser.add_argument("--start", type=str, default=None, help="Force window start (YYYY-MM-DD)")
    parser.add_argument("--end",   type=str, default=None, help="Force window end (YYYY-MM-DD)")
    args = parser.parse_args()

    week_ref     = date.fromisoformat(args.week)  if args.week  else None
    force_start  = date.fromisoformat(args.start) if args.start else None
    force_end    = date.fromisoformat(args.end)   if args.end   else None

    run_id = start_job("Weekly Briefing Generation", "dell")
    try:
        exit_code = run(week_ref=week_ref, dry_run=args.dry_run,
                        force_start=force_start, force_end=force_end)
        finish_job(run_id, "ok" if exit_code == 0 else "error", {"exit_code": exit_code})
    except Exception as e:
        finish_job(run_id, "error", error_text=str(e))
        write_cron_error("Weekly Briefing Generation", str(e), source="weekly_briefing")
        exit_code = 1
    sys.exit(exit_code)
