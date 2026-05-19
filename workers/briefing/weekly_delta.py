#!/usr/bin/env python3
"""
weekly_delta.py — WoW (Week-over-Week) shift detection for the Sunday briefing.

Computes three delta signals from cvc.weekly_signals:
  1. Velocity Spikes   — entities with >100% mention growth WoW (or new appearance)
  2. Emerging Tags     — tags present this week, absent in the prior 3 weeks
  3. Sentiment Drift   — net sentiment score moved ≥ 0.2 pts WoW

Sends deltas to LLM → generates a "Strategic Implications" markdown section
that gets appended to the weekly briefing by weekly_briefing.py.

Standalone usage (test/debug):
  PYTHONPATH=/home/nathan11/repos/cvc-intelligence/core python3 weekly_delta.py
  python3 weekly_delta.py --week 2026-04-13

Import usage (from weekly_briefing.py):
  from weekly_delta import generate_delta_section
  delta_md = generate_delta_section(conn, week_start)
"""

import os
import sys
import json
import logging
import requests
import psycopg2
import psycopg2.extras
import argparse
from datetime import date, timedelta
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "core"))
from config_loader import config as _cfg

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

OPENROUTER_URL     = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL   = "qwen/qwen3-235b-a22b-2507"
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

DB_CONFIG = {
    "dbname":   "cvc_db",
    "user":     "producer",
    "password": os.environ["CVC_DB_PASSWORD"],
    "host":     os.environ.get("CVC_DB_HOST", "localhost"),
    "port":     5432,
}

# Minimum drift magnitude to flag sentiment shift
SENTIMENT_DRIFT_THRESHOLD = 0.2

# Minimum growth % to flag as a velocity spike (100 = >100%)
VELOCITY_THRESHOLD_PCT = 100


# ── Delta Computation ─────────────────────────────────────────────────────────

def compute_partner_momentum(conn, current_week: date, prior_week: date) -> list:
    """
    Count how many times each CVC partner was mentioned in content_items
    for the current vs prior week. Returns partners with ≥ 2 current-week
    mentions that are new (0 prior) or grew ≥ 50% WoW.

    Joins content_items.key_entities → cvc.entities (by name) → cvc.partners.
    """
    next_week = current_week + timedelta(days=7)

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                WITH weekly_mentions AS (
                    SELECT
                        e.partner_id,
                        COALESCE(ci.published_at, ci.created_at)::date AS item_date
                    FROM cvc.content_items ci
                    CROSS JOIN LATERAL
                        jsonb_array_elements_text(ci.key_entities->'companies') AS company_name
                    JOIN cvc.entities e
                        ON lower(trim(company_name)) = lower(e.name)
                    WHERE ci.key_entities IS NOT NULL
                      AND ci.key_entities ? 'companies'
                      AND e.partner_id IS NOT NULL
                      AND COALESCE(ci.published_at, ci.created_at)::date >= %s
                      AND COALESCE(ci.published_at, ci.created_at)::date < %s
                )
                SELECT
                    p.name                                                  AS partner,
                    COUNT(*) FILTER (WHERE wm.item_date >= %s)             AS current_n,
                    COUNT(*) FILTER (WHERE wm.item_date < %s)              AS prior_n
                FROM weekly_mentions wm
                JOIN cvc.partners p ON p.id = wm.partner_id
                GROUP BY p.id, p.name
                HAVING COUNT(*) FILTER (WHERE wm.item_date >= %s) >= 2
                ORDER BY current_n DESC
            """, (prior_week, next_week, current_week, current_week, current_week))
            rows = cur.fetchall()
    except Exception as e:
        logger.warning(f"weekly_delta: partner momentum query failed ({e})")
        return []

    momentum = []
    for r in rows:
        curr_n = int(r["current_n"])
        prior_n = int(r["prior_n"])

        if prior_n == 0:
            momentum.append({
                "partner": r["partner"],
                "current": curr_n,
                "prior":   0,
                "label":   "new appearance",
                "pct":     None,
            })
        else:
            pct = round((curr_n - prior_n) / prior_n * 100)
            if pct >= 50:
                momentum.append({
                    "partner": r["partner"],
                    "current": curr_n,
                    "prior":   prior_n,
                    "label":   f"+{pct}%",
                    "pct":     pct,
                })

    # Sort: % growth first (desc), then new appearances
    momentum.sort(key=lambda x: (x["pct"] is None, -(x["pct"] or 0)))
    return momentum


def _sentiment_score(row: dict) -> Optional[float]:
    """Net sentiment score: (positive - negative) / total. None if no items."""
    total = row.get("total_items") or 0
    if total == 0:
        return None
    return (row["sentiment_positive"] - row["sentiment_negative"]) / total


def compute_deltas(conn, current_week: date) -> dict:
    """
    Load the last 4 weeks from cvc.weekly_signals and compute WoW deltas.
    Returns a structured dict. 'insufficient_data' is True if < 2 weeks exist.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT week_start, total_items,
                   sentiment_positive, sentiment_negative,
                   top_companies, top_tags
            FROM cvc.weekly_signals
            WHERE week_start <= %s
            ORDER BY week_start DESC
            LIMIT 4
        """, (current_week,))
        rows = cur.fetchall()

    if len(rows) < 2:
        logger.warning(
            f"weekly_delta: only {len(rows)} week(s) in weekly_signals — "
            "need ≥ 2 for delta analysis"
        )
        return {
            "insufficient_data": True,
            "weeks_available": len(rows),
            "week_start": str(current_week),
        }

    current = rows[0]
    prior   = rows[1]
    prior_3 = rows[1:]   # up to 3 prior weeks for emerging-tag lookback

    # ── 1. Velocity Spikes ────────────────────────────────────────────────────
    curr_cos  = {r["company"]: r["count"] for r in (current["top_companies"] or [])}
    prior_cos = {r["company"]: r["count"] for r in (prior["top_companies"] or [])}

    spikes = []
    for company, curr_n in curr_cos.items():
        prior_n = prior_cos.get(company, 0)
        if prior_n == 0:
            spikes.append({
                "company": company,
                "current": curr_n,
                "prior": 0,
                "label": "new appearance",
                "pct": None,
            })
        else:
            pct = (curr_n - prior_n) / prior_n * 100
            if pct >= VELOCITY_THRESHOLD_PCT:
                spikes.append({
                    "company": company,
                    "current": curr_n,
                    "prior": prior_n,
                    "label": f"+{round(pct)}%",
                    "pct": round(pct),
                })

    # Sort: explicit % spikes first (descending), then new appearances
    spikes.sort(key=lambda x: (x["pct"] is None, -(x["pct"] or 0)))

    # ── 2. Emerging Tags ──────────────────────────────────────────────────────
    curr_tags  = {r["tag"] for r in (current["top_tags"] or [])}
    prior_tags = set()
    for row in prior_3:
        for r in (row["top_tags"] or []):
            prior_tags.add(r["tag"])
    emerging_tags = sorted(curr_tags - prior_tags)

    # ── 3. Sentiment Drift ────────────────────────────────────────────────────
    curr_sent  = _sentiment_score(current)
    prior_sent = _sentiment_score(prior)

    sentiment_drift = None
    if curr_sent is not None and prior_sent is not None:
        drift = curr_sent - prior_sent
        if abs(drift) >= SENTIMENT_DRIFT_THRESHOLD:
            sentiment_drift = {
                "current":   round(curr_sent, 3),
                "prior":     round(prior_sent, 3),
                "drift":     round(drift, 3),
                "direction": "more positive" if drift > 0 else "more negative",
            }

    partner_momentum = compute_partner_momentum(
        conn, current["week_start"], prior["week_start"]
    )

    return {
        "insufficient_data":  False,
        "week_start":         str(current["week_start"]),
        "prior_week_start":   str(prior["week_start"]),
        "current_total":      current["total_items"],
        "prior_total":        prior["total_items"],
        "velocity_spikes":    spikes,
        "emerging_tags":      emerging_tags,
        "sentiment_drift":    sentiment_drift,
        "partner_momentum":   partner_momentum,
    }


# ── LLM Synthesis ─────────────────────────────────────────────────────────────

def _build_delta_prompt(deltas: dict) -> str:
    lines = [
        f"You are a strategic analyst for Claw Venture Capital.",
        f"{_cfg.get('investment_thesis')}",
        f"{_cfg.get('corporate_partners_context')}",
        "",
        f"Below are the WoW (Week-over-Week) shifts detected in our industrial intelligence feed.",
        f"Current week: {deltas['week_start']}  |  Prior week: {deltas['prior_week_start']}",
        f"Content volume: {deltas['current_total']} items this week vs {deltas['prior_total']} prior",
        "",
    ]

    if deltas["velocity_spikes"]:
        lines.append("VELOCITY SPIKES (>100% mention growth WoW):")
        for s in deltas["velocity_spikes"][:5]:
            lines.append(f"  • {s['company']}: {s['current']} mentions ({s['label']})")
    else:
        lines.append("VELOCITY SPIKES: none detected this week.")

    lines.append("")

    if deltas["emerging_tags"]:
        lines.append("EMERGING THEMES (new this week, absent prior 3 weeks):")
        for tag in deltas["emerging_tags"][:8]:
            lines.append(f"  • {tag}")
    else:
        lines.append("EMERGING THEMES: no new themes this week.")

    lines.append("")

    if deltas["sentiment_drift"]:
        sd = deltas["sentiment_drift"]
        lines.append(
            f"SENTIMENT DRIFT: {sd['direction']} — "
            f"score moved from {sd['prior']} to {sd['current']} (Δ {sd['drift']:+.3f})"
        )
    else:
        lines.append("SENTIMENT DRIFT: within normal range (<0.2 pts).")

    lines.append("")

    if deltas.get("partner_momentum"):
        lines.append("PARTNER SIGNALS (CVC corporate partners with elevated WoW mentions):")
        for p in deltas["partner_momentum"][:6]:
            lines.append(f"  • {p['partner']}: {p['current']} mentions ({p['label']})")
    else:
        lines.append("PARTNER SIGNALS: no partner momentum detected this week.")

    lines += [
        "",
        "TASK: Do not summarize the news. Synthesize these SHIFTS.",
        "Write 2-3 sentences that answer: what changed in the industrial tech landscape this week",
        "that wasn't true last Sunday, and why should an industrial tech investor care?",
        "",
        "Be specific and direct. Reference the actual companies and themes above.",
        "Output plain text only — no headers, no bullet points, no markdown.",
    ]

    return "\n".join(lines)


def synthesize_deltas(deltas: dict) -> str:
    """Call LLM to generate the Strategic Implications paragraph. Returns plain text."""
    if not OPENROUTER_API_KEY:
        logger.warning("weekly_delta: OPENROUTER_API_KEY not set — skipping LLM synthesis")
        return ""

    prompt = _build_delta_prompt(deltas)
    try:
        resp = requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENROUTER_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 300,
                "temperature": 0.3,
            },
            timeout=60,
        )
        resp.raise_for_status()
        return (resp.json()["choices"][0]["message"]["content"] or "").strip()
    except Exception as e:
        logger.warning(f"weekly_delta: LLM synthesis failed ({e})")
        return ""


# ── Markdown Formatter ────────────────────────────────────────────────────────

def _format_delta_markdown(deltas: dict, synthesis: str) -> str:
    """
    Format delta signals + LLM synthesis into a markdown section
    ready to append to the weekly briefing.
    """
    lines = ["", "📊 **STRATEGIC SHIFTS**", ""]

    # Velocity spikes
    if deltas["velocity_spikes"]:
        lines.append("*Velocity spikes (>100% WoW):*")
        for s in deltas["velocity_spikes"][:5]:
            lines.append(f"• {s['company']} — {s['label']}")
        lines.append("")

    # Emerging tags
    if deltas["emerging_tags"]:
        tags_str = " · ".join(deltas["emerging_tags"][:6])
        lines.append(f"*New themes this week:* {tags_str}")
        lines.append("")

    # Sentiment drift
    if deltas["sentiment_drift"]:
        sd = deltas["sentiment_drift"]
        lines.append(
            f"*Sentiment drift:* {sd['direction']} "
            f"({sd['prior']:+.2f} → {sd['current']:+.2f})"
        )
        lines.append("")

    # Partner momentum
    if deltas.get("partner_momentum"):
        lines.append("*Partner signals:*")
        for p in deltas["partner_momentum"][:6]:
            lines.append(f"• {p['partner']} — {p['current']} mentions ({p['label']})")
        lines.append("")

    # LLM synthesis
    if synthesis:
        lines.append("*Strategic Implications:*")
        lines.append(synthesis)
        lines.append("")

    return "\n".join(lines)


# ── Public API ────────────────────────────────────────────────────────────────

def generate_delta_section(conn, current_week: date) -> str:
    """
    Called by weekly_briefing.py. Returns a markdown section string.
    Returns empty string if insufficient data or any error.
    """
    try:
        deltas = compute_deltas(conn, current_week)
        if deltas.get("insufficient_data"):
            weeks = deltas.get("weeks_available", 0)
            return (
                f"\n📊 **STRATEGIC SHIFTS**\n\n"
                f"_Delta analysis requires ≥ 2 weeks of history. "
                f"Currently {weeks} week(s) in the database._\n"
            )
        synthesis = synthesize_deltas(deltas)
        return _format_delta_markdown(deltas, synthesis)
    except Exception as e:
        logger.error(f"weekly_delta: generate_delta_section failed ({e})")
        return ""


# ── Standalone ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="WoW delta analysis for weekly briefing")
    parser.add_argument(
        "--week", type=str, default=None,
        help="Any date in the target week (YYYY-MM-DD). Default: most recent week in DB."
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Output raw delta JSON instead of formatted markdown."
    )
    args = parser.parse_args()

    conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        if args.week:
            week_date = date.fromisoformat(args.week)
        else:
            with conn.cursor() as cur:
                cur.execute("SELECT MAX(week_start) as latest FROM cvc.weekly_signals")
                row = cur.fetchone()
            week_date = row["latest"] if row and row["latest"] else date.today()

        deltas = compute_deltas(conn, week_date)

        if args.json:
            print(json.dumps(deltas, indent=2, default=str))
            return

        if deltas.get("insufficient_data"):
            print(f"Insufficient data: {deltas['weeks_available']} week(s) available. Need ≥ 2.")
            return

        print(f"Delta analysis for week of {deltas['week_start']}")
        print(f"vs prior week of {deltas['prior_week_start']}")
        print(f"Volume: {deltas['current_total']} → {deltas['prior_total']} items\n")

        print(f"Velocity spikes ({len(deltas['velocity_spikes'])}):")
        for s in deltas["velocity_spikes"]:
            print(f"  {s['company']}: {s['prior']} → {s['current']} ({s['label']})")

        print(f"\nEmerging tags ({len(deltas['emerging_tags'])}):")
        for t in deltas["emerging_tags"]:
            print(f"  {t}")

        if deltas["sentiment_drift"]:
            sd = deltas["sentiment_drift"]
            print(f"\nSentiment drift: {sd['direction']} ({sd['prior']} → {sd['current']}, Δ{sd['drift']:+.3f})")
        else:
            print("\nSentiment drift: within normal range")

        print("\n--- LLM Synthesis ---")
        synthesis = synthesize_deltas(deltas)
        print(synthesis or "(synthesis skipped — no API key)")

        print("\n--- Formatted Section ---")
        print(_format_delta_markdown(deltas, synthesis))

    finally:
        conn.close()


if __name__ == "__main__":
    main()
