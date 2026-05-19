#!/usr/bin/env python3
"""
Backfill news insights for a past briefing week.

Fetches news/article items from content_items using published_at windowing
(same logic as weekly_briefing.py), runs LLM synthesis, and inserts any
insights not already present in briefing_insights for that week.

Usage:
  python3 backfill_news_insights.py --start 2026-04-13 --end 2026-04-19
  python3 backfill_news_insights.py --week 2026-04-16   # any date in the week
  python3 backfill_news_insights.py --start 2026-04-13 --end 2026-04-19 --dry-run
"""
import os, sys, json, argparse, requests, psycopg2, psycopg2.extras
from datetime import date, timedelta

DB_CONFIG = {
    "dbname":   "cvc_db",
    "user":     "producer",
    "password": os.environ["CVC_DB_PASSWORD"],
    "host":     os.environ.get("CVC_DB_HOST", "localhost"),
    "port":     5432,
}

OPENROUTER_URL    = "https://openrouter.ai/api/v1/chat/completions"
MODEL             = "qwen/qwen3-235b-a22b-2507"
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

# ── Sector keyword classification (mirrors weekly_briefing.py) ────────────────

_NEWS_KEYWORDS = {
    "Supply Chain":          ["supply chain","logistics","freight","warehouse","fulfillment","last mile","inventory","distribution","3pl","cold chain","shipping","port","cargo","procurement"],
    "Robotics":              ["robot","robotics","autonomous","amr","agv","cobot","manipulation","pick and place","end effector","lidar","slam","navigation","mobile robot"],
    "Physical AI":           ["physical ai","foundation model","embodied","world model","generalist robot","dexterous","sim-to-real","neural network robot"],
    "Industrial Automation": ["automation","plc","scada","industrial iot","iiot","opc-ua","motion control","servo","cnc","machine vision","edge computing","factory","smart manufacturing"],
    "Manufacturing":         ["manufacturing","production","assembly","erp","mes","sap","oracle manufacturing","lean","six sigma","oem","tier 1","machining","fabrication"],
}

def _classify_news_sector(text: str) -> str:
    t = text.lower()
    for sector, kws in _NEWS_KEYWORDS.items():
        if any(kw in t for kw in kws):
            return sector
    return "General"

# ── Week window ───────────────────────────────────────────────────────────────

def _get_week_window(ref: date):
    """Return (monday, sunday) for the week containing ref."""
    monday = ref - timedelta(days=ref.weekday())
    return monday, monday + timedelta(days=6)

# ── LLM usage log ─────────────────────────────────────────────────────────────

def _log_llm(activity, model, usage):
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO cvc.llm_usage_log (activity, model, prompt_tokens, completion_tokens, cost) "
                "VALUES (%s,%s,%s,%s,%s)",
                (activity, model.split("/")[-1],
                 usage.get("prompt_tokens",0), usage.get("completion_tokens",0), usage.get("cost",0)),
            )
        conn.commit(); conn.close()
    except Exception: pass

# ── Fetch news items for window ───────────────────────────────────────────────

def fetch_news(conn, week_start, week_end):
    """Return fully-enriched news/article items published in the window."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id, content_type, title, url, summary, tags, created_at, published_at
            FROM cvc.content_items
            WHERE enrichment_status = 'fully_enriched'
              AND content_type IN ('company_news', 'article')
              AND COALESCE(published_at, created_at) >= %s
              AND COALESCE(published_at, created_at) < %s
            ORDER BY COALESCE(published_at, created_at) DESC
        """, (week_start, week_end + timedelta(days=1)))
        return cur.fetchall()

# ── Existing source URLs for this week ────────────────────────────────────────

def existing_news_urls(conn, week_start):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT source_url FROM cvc.briefing_insights "
            "WHERE week_start = %s AND source_type = 'news'",
            (week_start,)
        )
        return {r[0] for r in cur.fetchall() if r[0]}

# ── LLM news synthesis ────────────────────────────────────────────────────────

def synthesize_news(news_items):
    if not news_items:
        return []

    lines, item_map = [], {}
    for idx, item in enumerate(news_items[:40]):
        summary = (item.get("summary") or item.get("title") or "").strip()[:400]
        if summary:
            lines.append(f"[{idx}] {item['title']}\n  {summary}")
            item_map[idx] = item

    if not lines:
        return []

    context = "\n\n".join(lines)
    prompt = f"""You are a business intelligence analyst for Claw Venture Capital (CVC).
CVC is a pre-seed to Series A fund focused on supply chain, industrials, and robotics.
Corporate partners include: Walmart, Amazon, Honeywell, Caterpillar, John Deere, Siemens, ABB,
Rockwell Automation, Parker Hannifin, Emerson Electric, Zebra Technologies, Carrier Global, and others.

Review this week's news. Identify the 6 most signal-rich items for CVC —
things that affect our corporate partners, our investment thesis, or our deal pipeline.

NEWS THIS WEEK:
{context}

Respond with exactly 6 items as a JSON array. Each item:
{{"index": <source index from above>, "insight": "<one sentence what happened + one sentence why it matters for CVC>"}}

JSON only — no preamble, no markdown fences."""

    try:
        resp = requests.post(
            OPENROUTER_URL,
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
            json={"model": MODEL, "messages": [{"role":"user","content":prompt}],
                  "max_tokens": 900, "temperature": 0.2},
            timeout=120,
        )
        resp.raise_for_status()
        d = resp.json()
        _log_llm("Briefing News Backfill", MODEL, d.get("usage", {}))
        raw = d["choices"][0]["message"]["content"].strip().strip("` \n")
        if raw.startswith("json"): raw = raw[4:].strip()
        parsed = json.loads(raw)
        results = []
        for entry in parsed:
            src = item_map.get(entry.get("index"), {})
            results.append({
                "title":   src.get("title",""),
                "url":     src.get("url",""),
                "insight": entry.get("insight",""),
            })
        return results
    except Exception as e:
        print(f"[LLM error: {e}]"); return []

# ── Insert insights ────────────────────────────────────────────────────────────

def insert_news_insights(conn, week_start, insights, skip_urls, dry_run=False):
    rows = []
    for ins in insights:
        url = ins.get("url","")
        if url and url in skip_urls:
            print(f"  skip (already exists): {ins['title'][:60]}")
            continue
        sector = _classify_news_sector(ins.get("insight","") + " " + ins.get("title",""))
        rows.append((week_start, "news", ins["title"], url, None, ins["insight"], None, None, sector))

    if dry_run:
        print(f"\n[dry-run] Would insert {len(rows)} news insight(s):")
        for r in rows:
            print(f"  [{r[8]}] {r[2][:70]}")
            print(f"    → {r[5][:100]}")
        return len(rows)

    if not rows:
        print("Nothing new to insert.")
        return 0

    with conn.cursor() as cur:
        cur.executemany("""
            INSERT INTO cvc.briefing_insights
                (week_start, source_type, source_title, source_url, show_name,
                 insight, expert, confidence, sector)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, rows)
    conn.commit()
    return len(rows)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=str, help="Week start date (YYYY-MM-DD)")
    parser.add_argument("--end",   type=str, help="Week end date (YYYY-MM-DD)")
    parser.add_argument("--week",  type=str, help="Any date in the target week (YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.start and args.end:
        week_start = date.fromisoformat(args.start)
        week_end   = date.fromisoformat(args.end)
    elif args.week:
        week_start, week_end = _get_week_window(date.fromisoformat(args.week))
    else:
        parser.error("Provide --start/--end or --week")

    print(f"📅 Backfilling news insights for {week_start} → {week_end}")

    conn = psycopg2.connect(**DB_CONFIG)

    news_items = fetch_news(conn, week_start, week_end)
    print(f"   Found {len(news_items)} news/article items in window")
    if not news_items:
        print("   Nothing to synthesize."); conn.close(); return

    # Show which items are available (helps verify late arrivals are captured)
    for item in news_items:
        pub = item.get("published_at") or item.get("created_at")
        print(f"   • {str(pub)[:10]}  {item['title'][:70]}")

    print(f"\n   Running LLM synthesis ({MODEL})…")
    insights = synthesize_news(news_items)
    print(f"   LLM returned {len(insights)} insights\n")

    skip_urls = existing_news_urls(conn, week_start)
    inserted  = insert_news_insights(conn, week_start, insights, skip_urls, dry_run=args.dry_run)

    conn.close()
    print(f"\n✓ Done — {inserted} insight(s) {'would be ' if args.dry_run else ''}inserted for {week_start}")

if __name__ == "__main__":
    main()
