from fastapi import APIRouter
from typing import List
from core.db.connection import get_connection

router = APIRouter()


@router.get("/sectors")
async def list_sectors():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT unnest(sector_tags) as sector
                FROM trend_report.raw_signals
                WHERE sector_tags IS NOT NULL AND sector_tags != '{}'
                ORDER BY sector
            """)
            rows = cur.fetchall()
    return {"sectors": [r["sector"] for r in rows if r["sector"]]}


@router.get("/quarters")
async def list_quarters():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT quarter
                FROM trend_report.raw_signals
                WHERE quarter IS NOT NULL
                ORDER BY quarter DESC
            """)
            rows = cur.fetchall()
    return {"quarters": [r["quarter"] for r in rows if r["quarter"]]}


@router.get("/dashboard")
async def get_dashboard(sector: str, quarter: str):
    with get_connection() as conn:
        # Step 1 — get signal type counts
        with conn.cursor() as cur:
            cur.execute("""
                SELECT signal_type, COUNT(*) as cnt
                FROM trend_report.raw_signals
                WHERE %s = ANY(sector_tags) AND quarter = %s
                GROUP BY signal_type
                ORDER BY cnt DESC
            """, (sector, quarter))
            type_counts = cur.fetchall()

        # Step 2 — get top items per signal type (separate cursor)
        signals = []
        with conn.cursor() as cur:
            for row in type_counts:
                cur.execute("""
                    SELECT id, source_name, title, llm_summary, published_at
                    FROM trend_report.raw_signals
                    WHERE %s = ANY(sector_tags) AND quarter = %s AND signal_type = %s
                    ORDER BY published_at DESC
                    LIMIT 3
                """, (sector, quarter, row["signal_type"]))
                items = []
                for x in cur.fetchall():
                    summary = x["llm_summary"]
                    items.append({
                        "id": x["id"],
                        "source": x["source_name"],
                        "title": x["title"],
                        "summary": (summary[:150] + "...") if summary and len(summary) > 150 else summary,
                        "date": x["published_at"].isoformat() if x["published_at"] else None,
                    })
                signals.append({
                    "signal_type": row["signal_type"],
                    "count": row["cnt"],
                    "top_items": items,
                })

    signal_counts = [{"signal_type": s["signal_type"], "cnt": s["count"]} for s in signals]
    signals_by_type = {}
    for s in signals:
        signals_by_type[s["signal_type"]] = [
            {
                "id":           item["id"],
                "title":        item["title"],
                "source_name":  item["source"],
                "llm_summary":  item["summary"],
                "published_at": item["date"],
                "signal_type":  s["signal_type"],
            }
            for item in s["top_items"]
        ]

    return {
        "sector":          sector,
        "quarter":         quarter,
        "signal_counts":   signal_counts,
        "signals_by_type": signals_by_type,
        "total_signals":   sum(s["count"] for s in signals),
    }


@router.get("/funding")
async def get_funding(sector: str, quarter: str):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT company_name, amount_usd, round_type, event_date, source_url
                FROM trend_report.funding_events
                WHERE %s = ANY(sector_tags) AND quarter = %s
                ORDER BY amount_usd DESC NULLS LAST
                LIMIT 20
            """, (sector, quarter))
            rows = cur.fetchall()
    return {"sector": sector, "quarter": quarter, "funding_events": [dict(r) for r in rows]}
