"""
Weekly Briefing — Retry failed podcast syntheses + generate PDF to Downloads.
Usage: python3 run_briefing_pdf.py
"""
import sys
import json
import os
import requests
import psycopg2
import psycopg2.extras
from datetime import date, timedelta
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "qwen3:32b"
DB_CONFIG = dict(dbname="cvc_db", user="producer", password=os.environ["CVC_DB_PASSWORD"],
                 host="100.95.2.44", port=5432)
DOWNLOADS = Path("/mnt/c/Users/nathan/OneDrive/Desktop/CLAUDE WORK/OUTPUTS/reports")
OUTPUT_PDF = DOWNLOADS / f"CVC_Weekly_Briefing_{date.today().strftime('%Y-%m-%d')}.pdf"

PODCAST_SYNTHESIS_PROMPT = """Think carefully then answer.
You are an intelligence analyst for Claw Venture Capital (CVC), a pre-seed to Series A fund
focused on supply chain, industrials, and robotics. CVC advises ~25 Fortune 500 corporate partners.

Extract key intelligence signals from this podcast transcript or summary.

Rules:
- Each insight must be specific and concrete, not vague commentary
- Expert: "First Last, Title/Role" if clearly identifiable, otherwise empty string
- Section: the topic or theme being discussed
- Confidence: HIGH if a specific expert made a direct claim with data; MEDIUM if credible but less specific; LOW if speculative

Respond with ONLY a valid JSON object:
{{
    "source": "<podcast show name, not episode title>",
    "insights": [
        {{
            "insight": "<specific insight, 1-2 sentences>",
            "expert": "<Name, Title or empty string>",
            "section": "<topic>",
            "confidence": "HIGH|MEDIUM|LOW"
        }}
    ]
}}

Extract 3-5 insights. Prioritize HIGH and MEDIUM confidence.

Title: {title}
Content: {content}
"""

# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_json(text):
    depth = 0; start = -1
    for i, c in enumerate(text):
        if c == '{':
            if depth == 0: start = i
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0 and start >= 0:
                try: return json.loads(text[start:i+1])
                except: start = -1; continue
    try: return json.loads(text.strip())
    except: return None

def call_ollama(prompt, max_tokens=1500):
    try:
        r = requests.post(OLLAMA_URL, json={
            "model": MODEL, "prompt": prompt, "stream": False,
            "options": {"temperature": 0.2, "num_predict": max_tokens}
        }, timeout=300)
        return r.json().get("response", "")
    except Exception as e:
        print(f"  Ollama error: {e}"); return ""

# ── Step 1: Retry failed podcast syntheses ────────────────────────────────────

def retry_failed_syntheses(conn):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT id, title, raw_text, summary FROM cvc.content_items
        WHERE content_type = 'podcast_episode'
          AND enrichment_status = 'fully_enriched'
          AND podcast_synthesis IS NULL
    """)
    items = cur.fetchall()
    if not items:
        print("No failed podcast syntheses to retry.")
        return

    print(f"Retrying {len(items)} failed podcast syntheses...\n")
    for i, item in enumerate(items):
        print(f"[{i+1}/{len(items)}] {item['title'][:70]}...")
        raw = item.get("raw_text") or item.get("summary") or ""
        prompt = PODCAST_SYNTHESIS_PROMPT.format(
            title=item["title"], content=raw[:8000]
        )
        result = parse_json(call_ollama(prompt))
        if result and "insights" in result:
            cur.execute("UPDATE cvc.content_items SET podcast_synthesis = %s WHERE id = %s",
                        (json.dumps(result), item["id"]))
            conn.commit()
            print(f"  Done: {len(result.get('insights', []))} insights")
        else:
            print(f"  Failed again — skipping")
    cur.close()

# ── Step 2: Re-run briefing for current week ──────────────────────────────────

def get_week_window():
    today = date.today()
    days_since_monday = today.weekday()  # 0=Mon, 6=Sun
    if days_since_monday == 6:
        # Today IS Sunday — the current week just ended, use Mon-today
        last_monday = today - timedelta(days=6)
    else:
        # Mid-week — report on the previous complete Mon-Sun week
        last_monday = today - timedelta(days=days_since_monday + 7)
    last_sunday = last_monday + timedelta(days=6)
    return last_monday, last_sunday

def fetch_briefing_data(conn, week_start, week_end):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT id, content_type, title, url, summary, tags, sentiment,
               key_entities, podcast_synthesis, created_at
        FROM cvc.content_items
        WHERE enrichment_status = 'fully_enriched'
          AND created_at >= %s AND created_at < %s
          AND content_type IN ('podcast_episode', 'company_news', 'article')
        ORDER BY content_type, created_at DESC
    """, (week_start, week_end + timedelta(days=1)))
    rows = cur.fetchall()
    cur.close()
    return rows

# Show name → category mapping (tier info is overwritten by enrichment, so we hard-code it)
SHOW_CATEGORIES = {
    # Supply chain / vertical
    "supply chain now": "supply_chain",
    "freightwaves": "supply_chain",
    "the robot report": "supply_chain",
    "iltb": "supply_chain",
    "iltb podcast": "supply_chain",
    "eric kimberling": "supply_chain",
    # VC / investing
    "all-in": "vc_investing",
    "all in": "vc_investing",
    "bg2": "vc_investing",
    "bg2 pod": "vc_investing",
    "20vc": "vc_investing",
    "this week in startups": "vc_investing",
    "tbpn": "vc_investing",
    "tbpn live": "vc_investing",
    "diet tbpn": "vc_investing",
    "a16z": "vc_investing",
    "capital allocators": "vc_investing",
    "acquired": "vc_investing",
    "acquired fm": "vc_investing",
    "founders podcast": "vc_investing",
    "founders": "vc_investing",
    "long-term capital": "vc_investing",
    # AI / tech
    "lex fridman": "ai_tech",
    "dwarkesh patel": "ai_tech",
    "big technology": "ai_tech",
    # Macro / markets
    "risk reversal": "macro_markets",
    "risk reversal media": "macro_markets",
    "the compound": "macro_markets",
}

# Keyword fallback for categorization when show not in map
CATEGORY_KEYWORDS = {
    "supply_chain": ["supply chain", "freight", "logistics", "transport", "warehouse", "inventory",
                     "manufacturing", "industrial", "robot report", "erp", "procurement"],
    "ai_tech": ["gpt", "openai", "anthropic", "claude", "llm", "artificial intelligence", "machine learning",
                "coding", "software", "agent", "cursor", "vibe cod", "saas", "databricks"],
    "vc_investing": ["venture", "invest", "startup", "fund", "portfolio", "private equity", "valuation",
                     "deal flow", "pre-seed", "series a", "vc ", "hedge fund", "allocator"],
    "macro_markets": ["market", "economy", "macro", "tariff", "trade war", "rates", "recession",
                      "europe", "china", "geopolit", "defense", "iran", "fed ", "inflation"],
}

CATEGORY_META = {
    "supply_chain": {"label": "Supply Chain & Industrials", "icon": "🏭"},
    "ai_tech":      {"label": "AI & Technology",            "icon": "🤖"},
    "vc_investing": {"label": "VC & Investing",             "icon": "💼"},
    "macro_markets":{"label": "Macro & Markets",            "icon": "📈"},
    "other":        {"label": "Other",                      "icon": "🔍"},
}


def categorize_source(source, insight_text=""):
    key = source.lower().strip()
    # Direct show lookup
    for show, cat in SHOW_CATEGORIES.items():
        if show in key:
            return cat
    # Keyword fallback on source + insight text
    combined = (source + " " + insight_text).lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        if any(kw in combined for kw in keywords):
            return cat
    return "other"


def extract_podcast_insights(podcasts):
    """Extract up to 3 HIGH/MEDIUM insights per show, grouped by category."""
    # Map: source_key -> list of insights
    by_source = {}

    for ep in podcasts:
        synthesis = ep.get("podcast_synthesis")
        if isinstance(synthesis, str):
            try: synthesis = json.loads(synthesis)
            except: synthesis = None
        if not synthesis: continue

        source = synthesis.get("source", ep.get("title", ""))
        source_key = source.lower().strip()
        if source_key in by_source:
            continue  # already have this show

        ep_insights = []
        for item in (synthesis.get("insights") or []):
            if item.get("insight") and item.get("confidence") in ("HIGH", "MEDIUM"):
                ep_insights.append({
                    "source": source,
                    "expert": item.get("expert", ""),
                    "insight": item["insight"],
                    "section": item.get("section", ""),
                    "confidence": item.get("confidence", ""),
                })
        # HIGH first, then MEDIUM; take best 3 per show
        ep_insights.sort(key=lambda x: 0 if x["confidence"] == "HIGH" else 1)
        if ep_insights:
            by_source[source_key] = ep_insights[:3]

    # Assign categories and bucket
    categorized = {cat: [] for cat in CATEGORY_META}
    for source_key, insights in by_source.items():
        cat = categorize_source(insights[0]["source"], insights[0]["insight"])
        categorized[cat].extend(insights)

    return categorized

def synthesize_news(news_items):
    if not news_items: return ""
    lines = []
    for item in news_items[:40]:
        summary = (item.get("summary") or item.get("title") or "").strip()[:400]
        if summary: lines.append(f"• {item['title']}\n  {summary}")
    context = "\n\n".join(lines)
    prompt = f"""You are a business intelligence analyst for Claw Venture Capital (CVC).
CVC is a pre-seed to Series A fund focused on supply chain, industrials, and robotics.
Corporate partners include: Walmart, Amazon, Honeywell, Caterpillar, John Deere, Siemens, ABB,
Rockwell Automation, Parker Hannifin, Emerson Electric, Zebra Technologies, Carrier Global, and others.

Review this week's news. Identify the 5 most signal-rich items for CVC.

NEWS THIS WEEK:
{context}

Respond with exactly 5 bullet points. Each bullet:
- Starts with the company/topic in bold
- One sentence on what happened
- One sentence on why it matters for CVC
No preamble, no summary — just the 5 bullets."""
    try:
        resp = requests.post(OLLAMA_URL, json={
            "model": MODEL, "prompt": prompt, "stream": False,
            "options": {"temperature": 0.2, "num_predict": 800, "num_ctx": 8192}
        }, timeout=300)
        if resp.status_code == 200:
            return resp.json().get("response", "").strip()
        return ""
    except Exception as e:
        return f"[news synthesis unavailable: {e}]"

# ── Step 3: Generate PDF ──────────────────────────────────────────────────────

HTML_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Trebuchet+MS&display=swap');
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: 'Trebuchet MS', Arial, sans-serif;
    background: #F5F5F7;
    color: #1a1a1a;
    padding: 40px;
    font-size: 13px;
    line-height: 1.6;
  }}
  .header {{
    background: #253B49;
    color: white;
    padding: 28px 32px;
    border-radius: 10px;
    margin-bottom: 24px;
  }}
  .header h1 {{
    font-size: 22px;
    font-weight: bold;
    letter-spacing: 0.5px;
  }}
  .header .subtitle {{
    color: #F0E545;
    font-size: 13px;
    margin-top: 4px;
  }}
  .header .meta {{
    color: #aac4d0;
    font-size: 11px;
    margin-top: 6px;
  }}
  .section {{
    background: white;
    border-radius: 8px;
    padding: 20px 24px;
    margin-bottom: 16px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.07);
  }}
  .section-title {{
    font-size: 12px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #253B49;
    border-bottom: 2px solid #F0E545;
    padding-bottom: 6px;
    margin-bottom: 14px;
  }}
  .insight {{
    padding: 8px 0;
    border-bottom: 1px solid #f0f0f0;
  }}
  .insight:last-child {{ border-bottom: none; }}
  .insight-text {{ color: #1a1a1a; }}
  .insight-source {{
    font-size: 11px;
    color: #888;
    margin-top: 2px;
  }}
  .news-item {{ padding: 8px 0; border-bottom: 1px solid #f0f0f0; }}
  .news-item:last-child {{ border-bottom: none; }}
  .news-item strong {{ color: #253B49; }}
  .stats-grid {{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 12px;
  }}
  .stat-box {{
    background: #F5F5F7;
    border-radius: 6px;
    padding: 10px 14px;
    text-align: center;
  }}
  .stat-num {{
    font-size: 22px;
    font-weight: bold;
    color: #253B49;
  }}
  .stat-label {{
    font-size: 10px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }}
  .tag {{
    display: inline-block;
    background: #e8f0f4;
    color: #253B49;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    margin: 2px;
  }}
  .sentiment-bar {{
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    margin: 8px 0;
  }}
  .sent-pos {{ background: #4CAF50; }}
  .sent-neu {{ background: #9E9E9E; }}
  .sent-neg {{ background: #F44336; }}
  .sentiment-labels {{
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: #888;
  }}
  .footer {{
    text-align: center;
    font-size: 10px;
    color: #aaa;
    margin-top: 24px;
    padding-top: 12px;
    border-top: 1px solid #ddd;
  }}
</style>
</head>
<body>
{body}
</body>
</html>"""

def build_html(week_start, week_end, items, podcast_insights, news_synthesis):
    from collections import Counter
    podcasts = [i for i in items if i["content_type"] == "podcast_episode"]
    news = [i for i in items if i["content_type"] in ("company_news", "article")]

    # Sentiment counts
    s = Counter()
    for item in items:
        sent = (item.get("sentiment") or "neutral").lower()
        if sent in ("positive", "bullish"): s["pos"] += 1
        elif sent in ("negative", "bearish"): s["neg"] += 1
        else: s["neu"] += 1
    total = len(items) or 1
    pos_pct = round(s["pos"] / total * 100)
    neu_pct = round(s["neu"] / total * 100)
    neg_pct = 100 - pos_pct - neu_pct

    # Top tags
    tag_counts = Counter()
    for item in items:
        tags = item.get("tags") or []
        if isinstance(tags, str):
            try: tags = json.loads(tags)
            except: tags = []
        for t in tags:
            if isinstance(t, str) and len(t) > 2:
                tag_counts[t.lower()] += 1
    top_tags = [t for t, _ in tag_counts.most_common(8)]

    # Top companies
    co_counts = Counter()
    for item in items:
        ents = item.get("key_entities") or {}
        if isinstance(ents, str):
            try: ents = json.loads(ents)
            except: ents = {}
        for c in ents.get("companies", []):
            if c and len(c) > 2: co_counts[c] += 1
    top_cos = [c for c, _ in co_counts.most_common(6)]

    # Podcast signals HTML — one section per category
    pod_html = ""
    if podcast_insights:
        for cat_key, meta in CATEGORY_META.items():
            insights = podcast_insights.get(cat_key, [])
            if not insights:
                continue
            items_html = ""
            for ins in insights:
                expert_part = ins["expert"].split(",")[0] if ins.get("expert") else ""
                source_part = ins.get("source", "")
                attribution = expert_part if expert_part else source_part
                section_part = ins.get("section", "")
                items_html += f"""<div class="insight">
                    <div class="insight-text">{ins['insight']}</div>
                    <div class="insight-source">{attribution[:60]} &mdash; {section_part}</div>
                </div>"""
            pod_html += f"""<div class="section">
                <div class="section-title">{meta['icon']} {meta['label']}</div>
                {items_html}
            </div>"""

    # News signals HTML
    news_html = ""
    if news_synthesis and not news_synthesis.startswith("[news synthesis unavailable"):
        lines = news_synthesis.strip().split("\n")
        items_html = ""
        for line in lines:
            line = line.strip().lstrip("•-").strip()
            if line:
                items_html += f'<div class="news-item">{line}</div>'
        news_html = f"""<div class="section">
            <div class="section-title">📰 News Signals</div>
            {items_html}
        </div>"""

    # Tags HTML
    tags_html = "".join(f'<span class="tag">{t}</span>' for t in top_tags)
    cos_html = "".join(f'<span class="tag">{c}</span>' for c in top_cos)

    body = f"""
    <div class="header">
        <div class="h1">🦀 CVC Weekly Intelligence Briefing</div>
        <div class="subtitle">{week_start.strftime('%B %d')} &ndash; {week_end.strftime('%B %d, %Y')}</div>
        <div class="meta">{len(podcasts)} podcasts &middot; {len(news)} news items &middot; Generated {date.today().strftime('%B %d, %Y')}</div>
    </div>

    {pod_html}

    {news_html}

    <div class="section">
        <div class="section-title">📊 Week in Numbers</div>
        <div class="stats-grid">
            <div class="stat-box"><div class="stat-num">{len(items)}</div><div class="stat-label">Total Items</div></div>
            <div class="stat-box"><div class="stat-num">{len(podcasts)}</div><div class="stat-label">Podcasts</div></div>
            <div class="stat-box"><div class="stat-num">{len(news)}</div><div class="stat-label">News Items</div></div>
        </div>
        <div class="sentiment-bar">
            <div class="sent-pos" style="width:{pos_pct}%"></div>
            <div class="sent-neu" style="width:{neu_pct}%"></div>
            <div class="sent-neg" style="width:{neg_pct}%"></div>
        </div>
        <div class="sentiment-labels">
            <span>{pos_pct}% Positive</span>
            <span>{neu_pct}% Neutral</span>
            <span>{neg_pct}% Negative</span>
        </div>
        <div style="margin-top:14px">
            <div style="font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Top Themes</div>
            {tags_html}
        </div>
        <div style="margin-top:10px">
            <div style="font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Companies in Focus</div>
            {cos_html}
        </div>
    </div>

    <div class="footer">
        Claw Venture Capital &middot; Confidential &middot; {date.today().strftime('%Y')}
    </div>
    """
    return HTML_TEMPLATE.format(body=body)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--week", help="Week start date YYYY-MM-DD (default: auto)")
    args = parser.parse_args()

    print("=" * 55)
    print("CVC Weekly Briefing — PDF Generator")
    print("=" * 55)

    conn = psycopg2.connect(**DB_CONFIG)

    # Step 1: Retry failed podcast syntheses
    retry_failed_syntheses(conn)

    # Step 2: Fetch data for specified or current week
    if args.week:
        from datetime import datetime
        week_start = datetime.strptime(args.week, "%Y-%m-%d").date()
        week_end = week_start + timedelta(days=6)
    else:
        week_start, week_end = get_week_window()
    print(f"\nBuilding briefing for {week_start} to {week_end}...")
    items = fetch_briefing_data(conn, week_start, week_end)
    print(f"Found {len(items)} enriched items")

    if not items:
        print("No enriched content found for this week.")
        conn.close()
        sys.exit(1)

    podcasts = [i for i in items if i["content_type"] == "podcast_episode"]
    news = [i for i in items if i["content_type"] in ("company_news", "article")]

    podcast_insights = extract_podcast_insights(podcasts)
    total_pod_insights = sum(len(v) for v in podcast_insights.values())
    print(f"Extracted {total_pod_insights} podcast insights across {sum(1 for v in podcast_insights.values() if v)} categories")
    print(f"Running news synthesis on {len(news)} items...")
    news_synthesis = synthesize_news(news)

    # Step 3: Generate PDF
    print(f"\nGenerating PDF...")
    html = build_html(week_start, week_end, items, podcast_insights, news_synthesis)

    import weasyprint
    weasyprint.HTML(string=html).write_pdf(str(OUTPUT_PDF))
    print(f"\nDone: {OUTPUT_PDF}")

    conn.close()

if __name__ == "__main__":
    main()
