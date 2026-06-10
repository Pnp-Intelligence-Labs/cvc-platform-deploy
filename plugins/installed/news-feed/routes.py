"""
News Feed plugin — routes.py
Prefix: /news
Tag:    news-feed

Endpoints:
  GET    /news/companies                — list watched companies
  POST   /news/companies                — add company to watch list
  DELETE /news/companies/{id}           — remove from watch list
  PATCH  /news/companies/{id}/toggle    — toggle active
  GET    /news/                         — list news articles (paginated, filterable)
  GET    /news/stats                    — article counts by type + top companies
  GET    /news/recent                   — recent articles across all watched companies
  GET    /news/sales                    — news for companies in sales pipeline
  GET    /news/partner/{partner_id}     — news for a specific partner
  DELETE /news/article/{article_id}     — hide article
  POST   /news/deduplicate              — remove duplicate articles (SQL-only, safe)

Dropped from staging:
  POST /news/fetch — launches news_fetcher.py subprocess, which doesn't exist in platform
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.routes.auth import require_jwt, UserInfo
from core.db.connection import get_connection

router = APIRouter()


# ── Models ────────────────────────────────────────────────────────────────────

class WatchCompanyCreate(BaseModel):
    company_name: str
    ticker: Optional[str] = None


# ── Watch list CRUD ──────────────────────────────────────────────────────────

@router.get("/companies")
async def list_watch_companies(
    active_only: bool = Query(True),
    q: Optional[str] = Query(None),
    user: UserInfo = Depends(require_jwt),
):
    """List all watched companies, optionally filtered by search query."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            clauses = []
            params = []
            if active_only:
                clauses.append("active = TRUE")
            if q:
                clauses.append("(company_name ILIKE %s OR ticker ILIKE %s)")
                params.extend([f"%{q}%", f"%{q}%"])
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            cur.execute(
                f"SELECT * FROM news_watch_companies {where} ORDER BY company_name",
                params,
            )
            return cur.fetchall()


@router.post("/companies")
async def add_watch_company(body: WatchCompanyCreate, user: UserInfo = Depends(require_jwt)):
    """Add a company to the watch list."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO news_watch_companies (company_name, category, ticker)
                VALUES (%s, 'watch', %s)
                ON CONFLICT DO NOTHING
                RETURNING *
            """, (body.company_name, body.ticker))
            row = cur.fetchone()
            if not row:
                raise HTTPException(409, "Company already exists in watch list")
            conn.commit()
            return row


@router.delete("/companies/{company_id}")
async def remove_watch_company(company_id: int, user: UserInfo = Depends(require_jwt)):
    """Remove a company from the watch list (hard delete)."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM news_watch_companies WHERE id = %s RETURNING id",
                (company_id,),
            )
            if not cur.fetchone():
                raise HTTPException(404, "Company not found")
            conn.commit()
            return {"deleted": True}


@router.patch("/companies/{company_id}/toggle")
async def toggle_watch_company(company_id: int, user: UserInfo = Depends(require_jwt)):
    """Toggle active/inactive status of a watched company."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE news_watch_companies SET active = NOT active WHERE id = %s RETURNING *",
                (company_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Company not found")
            conn.commit()
            return row


# ── News articles ────────────────────────────────────────────────────────────

@router.get("/")
async def list_news(
    company: Optional[str] = Query(None),
    activity_type: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: UserInfo = Depends(require_jwt),
):
    """List news articles, sorted by published_at DESC. Filter by company or activity type."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            clauses = []
            params = []
            if company:
                clauses.append("company_name ILIKE %s")
                params.append(f"%{company}%")
            if activity_type:
                clauses.append("activity_type = %s")
                params.append(activity_type)
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

            cur.execute(f"SELECT COUNT(*) as total FROM category_news {where}", list(params))
            total = cur.fetchone()["total"]

            params.extend([limit, offset])
            cur.execute(
                f"SELECT * FROM category_news {where} ORDER BY published_at DESC LIMIT %s OFFSET %s",
                params,
            )
            return {"articles": cur.fetchall(), "total": total}


@router.get("/stats")
async def news_stats(user: UserInfo = Depends(require_jwt)):
    """Article counts by activity type and top companies."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COALESCE(activity_type, 'general') as activity_type, COUNT(*) as count
                FROM category_news
                GROUP BY activity_type
                ORDER BY count DESC
            """)
            by_type = cur.fetchall()

            cur.execute("""
                SELECT company_name, COUNT(*) as article_count, MAX(published_at) as latest_article
                FROM category_news
                GROUP BY company_name
                ORDER BY article_count DESC
                LIMIT 20
            """)
            by_company = cur.fetchall()

            cur.execute("""
                SELECT COUNT(*) as total_articles,
                       COUNT(DISTINCT company_name) as total_companies,
                       MAX(published_at) as latest_article
                FROM category_news
            """)
            totals = cur.fetchone()

    return {"totals": totals, "by_type": by_type, "by_company": by_company}


@router.get("/recent")
async def recent_news(
    limit: int = Query(50, ge=1, le=200),
    user: UserInfo = Depends(require_jwt),
):
    """Most recent articles across all watched companies."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, link, company_name, title, published_at,
                       activity_type, formatted_date
                FROM category_news
                ORDER BY published_at DESC
                LIMIT %s
            """, (limit,))
            articles = cur.fetchall()

            cur.execute("""
                SELECT COUNT(*) as total_articles,
                       COUNT(DISTINCT company_name) as companies_tracked,
                       (SELECT COUNT(*) FROM news_watch_companies WHERE active = TRUE) as watch_list_size
                FROM category_news
            """)
            stats = cur.fetchone()

    return {"articles": articles, "stats": stats}


@router.get("/sales")
async def sales_news(
    days: int = Query(7, ge=1, le=90),
    activity_type: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=300),
    user: UserInfo = Depends(require_jwt),
):
    """Recent news for all companies in the sales pipeline."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            type_clause = "AND cn.activity_type = %(activity_type)s" if activity_type else ""
            cur.execute(f"""
                SELECT
                    cn.id,
                    cn.link,
                    cn.company_name,
                    cn.title,
                    cn.published_at,
                    cn.activity_type,
                    cn.formatted_date,
                    (
                        SELECT stage FROM sales_targets
                        WHERE company_name = cn.company_name
                        ORDER BY
                            CASE stage
                                WHEN 'proposal'    THEN 1
                                WHEN 'nurturing'   THEN 2
                                WHEN 'target'      THEN 3
                                WHEN 'closed_won'  THEN 4
                                WHEN 'closed_lost' THEN 5
                            END
                        LIMIT 1
                    ) AS stage,
                    (
                        SELECT string_agg(DISTINCT assigned_to, ', ')
                        FROM sales_targets
                        WHERE company_name = cn.company_name
                          AND assigned_to IS NOT NULL
                    ) AS assigned_to
                FROM category_news cn
                WHERE cn.company_name IN (SELECT DISTINCT company_name FROM sales_targets)
                  AND cn.published_at >= NOW() - INTERVAL '1 day' * %(days)s
                  AND cn.hidden IS NOT TRUE
                  {type_clause}
                ORDER BY cn.published_at DESC
                LIMIT %(limit)s
            """, {"days": days, "activity_type": activity_type, "limit": limit})
            articles = cur.fetchall()

            cur.execute("""
                SELECT COUNT(DISTINCT company_name) as companies_with_news
                FROM category_news
                WHERE company_name IN (SELECT DISTINCT company_name FROM sales_targets)
                  AND published_at >= NOW() - INTERVAL '7 days'
            """)
            stats = cur.fetchone()

    return {"articles": articles, "stats": stats}


@router.get("/partner/{partner_id}")
async def partner_news(
    partner_id: int,
    limit: int = Query(30, ge=1, le=100),
    activity_type: Optional[str] = Query(None),
    user: UserInfo = Depends(require_jwt),
):
    """Recent news for a specific partner (by partner_id or watch list company name)."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT company_name FROM news_watch_companies
                WHERE partner_id = %s AND active = TRUE
                LIMIT 1
            """, (partner_id,))
            watch_row = cur.fetchone()

            clauses = ["(partner_id = %s"]
            params: list = [partner_id]

            if watch_row:
                clauses[0] += " OR company_name = %s)"
                params.append(watch_row["company_name"])
            else:
                clauses[0] += ")"

            if activity_type:
                clauses.append("activity_type = %s")
                params.append(activity_type)

            where = "WHERE " + " AND ".join(clauses)
            params.append(limit)

            cur.execute(f"""
                SELECT id, link, company_name, title, published_at,
                       activity_type, formatted_date
                FROM category_news
                {where}
                AND hidden IS NOT TRUE
                ORDER BY published_at DESC
                LIMIT %s
            """, params)
            articles = cur.fetchall()

            cur.execute("""
                SELECT COUNT(*) as total
                FROM category_news
                WHERE partner_id = %s OR company_name = (
                    SELECT company_name FROM news_watch_companies
                    WHERE partner_id = %s AND active = TRUE LIMIT 1
                )
            """, (partner_id, partner_id))
            total = cur.fetchone()["total"]

    return {"articles": articles, "total": total}


# ── Hide article ─────────────────────────────────────────────────────────────

@router.delete("/article/{article_id}", status_code=204)
async def hide_article(article_id: int, user: UserInfo = Depends(require_jwt)):
    """Mark an article as hidden — excluded from all feed queries."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE category_news SET hidden = TRUE WHERE id = %s RETURNING id",
                (article_id,),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Article not found")
            conn.commit()


# ── Deduplicate ───────────────────────────────────────────────────────────────

@router.post("/deduplicate")
async def deduplicate_news(user: UserInfo = Depends(require_jwt)):
    """Remove duplicate articles by title + company_name."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM category_news a
                USING category_news b
                WHERE a.id > b.id
                  AND a.title = b.title
                  AND a.company_name = b.company_name
            """)
            deleted = cur.rowcount
            conn.commit()
    return {"duplicates_removed": deleted}
