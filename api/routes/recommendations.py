"""
GET /recommendations/startups  — PnPbert-ranked startups for the current user
GET /recommendations/feed      — PnPbert-ranked news + activity for the current user

Scoring uses PnPbert: each user is represented as a set of interest vectors
built from their role, recent activity sectors, and assigned partner focus areas.
Each startup / feed item is represented as a set of semantic facet vectors.
Relevance is the MaxSim late-interaction score across those vector sets.
"""
import json
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from api.auth import require_auth
from core.db.connection import get_connection
from core.pnpbert.cache import EmbeddingCache
from core.pnpbert.engine import PnPbert

router = APIRouter()

# Shared engine instance backed by a persistent embedding cache: document facets
# are encoded once and reused across requests/restarts, so each request only
# encodes its small query and runs numpy MaxSim against cached vectors.
_engine = PnPbert(cache=EmbeddingCache(get_connection))


def warm_engine() -> None:
    """Load the encoder model ahead of the first request (called at app startup).

    Cold model load is ~10s; doing it eagerly means real requests hit an
    already-loaded model and resolve in milliseconds against the cached vectors.
    """
    _engine._try_load_encoder()


# ------------------------------------------------------------------
# Response models
# ------------------------------------------------------------------

class RankedStartup(BaseModel):
    id: int
    name: str
    sector: Optional[str] = None
    subsector: Optional[str] = None
    stage: Optional[str] = None
    location: Optional[str] = None
    one_liner: Optional[str] = None
    score_composite: Optional[float] = None
    pnpbert_score: float
    intro_count: int = 0
    intro_partners: list[str] = []
    is_portfolio: Optional[bool] = None


class RankedFeedItem(BaseModel):
    item_type: str            # "news" | "briefing" | "activity"
    title: str
    body: Optional[str] = None
    company_id: Optional[int] = None
    company_name: Optional[str] = None
    sector: Optional[str] = None
    source_url: Optional[str] = None
    occurred_at: Optional[str] = None
    pnpbert_score: float


# ------------------------------------------------------------------
# User context builder
# ------------------------------------------------------------------

def _build_user_query(user: dict, conn) -> list[str]:
    """
    Build multi-vector user query from role, recent activity sectors,
    and assigned corporate partner focus areas.
    Each string becomes one independent query vector in PnPbert MaxSim.
    """
    username = user.get("username", "")
    role = user.get("role", "venture capital analyst")

    vectors = [f"venture capital {role} startup evaluation investment thesis"]

    with conn.cursor() as cur:
        # Sectors the user has recently touched (last 60 days)
        cur.execute("""
            SELECT DISTINCT c.sector, c.subsector
            FROM cvc.company_activity_log al
            JOIN cvc.companies c ON c.id = al.company_id
            WHERE al.changed_by = %s
              AND al.changed_at > NOW() - INTERVAL '60 days'
              AND c.sector IS NOT NULL
            LIMIT 8
        """, [username])
        for r in cur.fetchall():
            s = " ".join(filter(None, [r["sector"], r["subsector"]]))
            if s.strip():
                vectors.append(f"{s} technology startup")

        # Assigned corporate partners' focus areas
        cur.execute("""
            SELECT p.sectors_of_interest, p.challenge_areas
            FROM cvc.partners p
            WHERE p.id = ANY(
                SELECT UNNEST(assigned_partner_ids) FROM cvc.users WHERE username = %s
            )
        """, [username])
        for r in cur.fetchall():
            for item in (r["sectors_of_interest"] or []):
                vectors.append(f"corporate partner focus {item}")
            for item in (r["challenge_areas"] or []):
                vectors.append(f"enterprise challenge {item}")

    # Always have at least two vectors so MaxSim has signal
    if len(vectors) < 2:
        vectors.append("deep tech b2b saas industrial software early stage")

    return vectors


# ------------------------------------------------------------------
# Document builders
# ------------------------------------------------------------------

def _startup_doc(row: dict) -> list[str]:
    """Build multi-facet document from a startup DB row."""
    facets: list[str] = []

    if row.get("one_liner"):
        facets.append(row["one_liner"])
    if row.get("description"):
        facets.append(row["description"][:300])

    sector_line = " ".join(filter(None, [row.get("sector"), row.get("subsector"), row.get("stage")]))
    if sector_line.strip():
        facets.append(sector_line)

    news = row.get("news_articles")
    if isinstance(news, list):
        for item in news[:3]:
            if isinstance(item, dict):
                snippet = item.get("snippet") or item.get("title") or ""
                if snippet:
                    facets.append(snippet[:150])
    elif isinstance(news, str):
        try:
            parsed = json.loads(news)
            for item in (parsed[:3] if isinstance(parsed, list) else []):
                snippet = (item.get("snippet") or item.get("title") or "")[:150]
                if snippet:
                    facets.append(snippet)
        except (json.JSONDecodeError, AttributeError):
            pass

    if not facets:
        facets.append(row.get("name", "startup"))

    return facets


def _news_doc(title: str, snippet: Optional[str], sector: Optional[str]) -> list[str]:
    facets = [title]
    if snippet:
        facets.append(snippet[:200])
    if sector:
        facets.append(f"{sector} technology industry news")
    return facets


def _briefing_doc(insight: str, sector: Optional[str]) -> list[str]:
    facets = [insight[:300]]
    if sector:
        facets.append(f"{sector} market signal intelligence")
    return facets


def _activity_doc(company_name: str, sector: Optional[str], field_name: Optional[str], new_value: Optional[str]) -> list[str]:
    facets = [f"{company_name} company update"]
    if sector:
        facets.append(f"{sector} startup activity change")
    if field_name and new_value:
        facets.append(f"{field_name} updated {new_value}"[:150])
    return facets


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------

@router.get("/startups", response_model=dict)
async def recommend_startups(
    limit: int = Query(10, ge=1, le=50),
    exclude_portfolio: bool = Query(False),
    user=Depends(require_auth),
):
    """
    Return the top startups ranked by PnPbert relevance to the current user.
    Candidates are drawn from non-portfolio companies with a composite score
    or recent activity; PnPbert re-ranks them by semantic fit to user context.
    """
    with get_connection() as conn:
        query_vectors = _build_user_query(user, conn)

        with conn.cursor() as cur:
            where = "WHERE 1=1"
            params: list = []
            if exclude_portfolio:
                where += " AND (is_portfolio IS NULL OR is_portfolio = FALSE)"

            cur.execute(f"""
                SELECT
                    id, name, sector, subsector, stage,
                    hq_city, country,
                    one_liner, description,
                    score_composite,
                    news_articles,
                    is_portfolio,
                    intro_count,
                    intro_partners
                FROM cvc.companies
                {where}
                ORDER BY score_composite DESC NULLS LAST
                LIMIT 200
            """, params)
            rows = cur.fetchall()

    if not rows:
        return {"startups": [], "scored_by": "pnpbert"}

    documents = [_startup_doc(dict(r)) for r in rows]
    ids = [r["id"] for r in rows]
    row_map = {r["id"]: r for r in rows}

    scored = _engine.rank(query_vectors, documents, ids=ids)

    results: list[RankedStartup] = []
    for score, company_id in scored[:limit]:
        r = row_map[company_id]
        city = r.get("hq_city") or ""
        country = r.get("country") or ""
        location = f"{city}, {country}".strip(", ") or None
        intros = r.get("intro_partners")
        if isinstance(intros, str):
            try:
                intros = json.loads(intros)
            except Exception:
                intros = []

        results.append(RankedStartup(
            id=company_id,
            name=r["name"],
            sector=r.get("sector"),
            subsector=r.get("subsector"),
            stage=r.get("stage"),
            location=location,
            one_liner=r.get("one_liner"),
            score_composite=r.get("score_composite"),
            pnpbert_score=round(score, 4),
            intro_count=int(r.get("intro_count") or 0),
            intro_partners=list(intros) if intros else [],
            is_portfolio=r.get("is_portfolio"),
        ))

    return {"startups": [s.model_dump() for s in results], "scored_by": "pnpbert"}


@router.get("/feed", response_model=dict)
async def recommend_feed(
    limit: int = Query(20, ge=1, le=50),
    days_back: int = Query(14, ge=1, le=90),
    user=Depends(require_auth),
):
    """
    Return the most relevant recent news, briefing insights, and company activity
    ranked by PnPbert relevance to the current user.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days_back)

    with get_connection() as conn:
        query_vectors = _build_user_query(user, conn)
        raw_items: list[dict] = []

        with conn.cursor() as cur:
            # Recent briefing insights
            cur.execute("""
                SELECT id, insight, sector, source_title, source_url, created_at
                FROM cvc.briefing_insights
                WHERE created_at >= %s
                ORDER BY created_at DESC
                LIMIT 60
            """, [since])
            for r in cur.fetchall():
                raw_items.append({
                    "item_type": "briefing",
                    "title": r["source_title"] or "Briefing Insight",
                    "body": r["insight"],
                    "sector": r["sector"],
                    "source_url": r["source_url"],
                    "occurred_at": str(r["created_at"]) if r["created_at"] else None,
                    "company_id": None,
                    "company_name": None,
                    "_doc": _briefing_doc(r["insight"] or "", r["sector"]),
                })

            # Recent company activity events (grouped per company, latest change)
            cur.execute("""
                SELECT DISTINCT ON (al.company_id)
                    al.company_id,
                    c.name AS company_name,
                    c.sector,
                    al.field_name,
                    al.new_value,
                    al.changed_at
                FROM cvc.company_activity_log al
                JOIN cvc.companies c ON c.id = al.company_id
                WHERE al.changed_at >= %s
                ORDER BY al.company_id, al.changed_at DESC
                LIMIT 80
            """, [since])
            for r in cur.fetchall():
                raw_items.append({
                    "item_type": "activity",
                    "title": f"{r['company_name']} — {r['field_name'] or 'update'}",
                    "body": r.get("new_value"),
                    "sector": r["sector"],
                    "source_url": None,
                    "occurred_at": str(r["changed_at"]) if r["changed_at"] else None,
                    "company_id": r["company_id"],
                    "company_name": r["company_name"],
                    "_doc": _activity_doc(
                        r["company_name"], r["sector"],
                        r.get("field_name"), r.get("new_value")
                    ),
                })

            # News articles from tracked companies (from JSONB field)
            cur.execute("""
                SELECT id, name, sector, news_articles
                FROM cvc.companies
                WHERE news_articles IS NOT NULL
                  AND jsonb_array_length(news_articles) > 0
                LIMIT 60
            """)
            for r in cur.fetchall():
                news = r["news_articles"]
                items = news if isinstance(news, list) else []
                for article in items[:4]:
                    if not isinstance(article, dict):
                        continue
                    title = article.get("title") or ""
                    snippet = article.get("snippet") or ""
                    url = article.get("url") or ""
                    if not title:
                        continue
                    raw_items.append({
                        "item_type": "news",
                        "title": title,
                        "body": snippet,
                        "sector": r["sector"],
                        "source_url": url,
                        "occurred_at": None,
                        "company_id": r["id"],
                        "company_name": r["name"],
                        "_doc": _news_doc(title, snippet, r["sector"]),
                    })

    if not raw_items:
        return {"feed": [], "scored_by": "pnpbert"}

    documents = [item["_doc"] for item in raw_items]
    scored = _engine.rank(query_vectors, documents)

    results: list[RankedFeedItem] = []
    for score, idx in scored[:limit]:
        item = raw_items[idx]
        results.append(RankedFeedItem(
            item_type=item["item_type"],
            title=item["title"],
            body=item.get("body"),
            company_id=item.get("company_id"),
            company_name=item.get("company_name"),
            sector=item.get("sector"),
            source_url=item.get("source_url"),
            occurred_at=item.get("occurred_at"),
            pnpbert_score=round(score, 4),
        ))

    return {"feed": [f.model_dump() for f in results], "scored_by": "pnpbert"}
