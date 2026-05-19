"""
api/routes/portfolio.py — CVC portfolio company endpoints.

Serves only companies where is_portfolio = TRUE.
"""
from fastapi import APIRouter, Query, Depends, HTTPException
from typing import Optional, List
from pydantic import BaseModel
from core.db.connection import get_connection
from api.auth import require_auth
import json, re, datetime as _dt
from urllib.parse import urlparse as _urlparse


# ── News article helpers ──────────────────────────────────────────────────────

_MONTH_MAP = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'jun': 6, 'jul': 7, 'aug': 8,
    'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}

# URL patterns that indicate category/tag/pagination pages (not articles)
_JUNK_URL_RE   = re.compile(r'/category/|/tag/|/archive|/page/\d|/author/', re.I)
# Title patterns that are clearly navigation/chrome
_JUNK_TITLE_RE = re.compile(
    r'^(«\s*(older|newer)|older entries|next\s*»|page\s+\d+|view all|full\s+\w+\s+list'
    r'|read more|load more|←|→|»|«|see all|all posts)$',
    re.I
)

# URL paths that indicate a dedicated press/news page — always pass
_NEWS_PATH_RE  = re.compile(
    r'/(news|press|newsroom|media|announcements|press-releases?|in-the-news|updates)/',
    re.I
)
# URL paths that are blog/content-marketing — require a signal keyword to pass
_BLOG_PATH_RE  = re.compile(r'/(blog|blogs|article|articles|insights|resources|learn|guides?)/', re.I)
# Signal keywords that indicate actual company events vs. thought-leadership content
_SIGNAL_RE     = re.compile(
    r'\b(announc|launch|rais(es|ed|ing)?|funded|funding|partner(s|ed|ship)?|award|named'
    r'|appoint|secur(es|ed)|signs?|signed|clos(es|ed)|acqui|invest|ipo|spac|merg'
    r'|series [a-e]|seed round|listed|deploy(s|ed)|contract|milestone|approv(es|ed)'
    r'|certif|expand(s|ed)|wins?|won|case stud|customer win|new hire)\b',
    re.I
)

# "Articles", "Videos", "All Blogs", "Press Release", "Media Coverage" type prefixes
_TITLE_TYPE_PFX = re.compile(
    r'^(press releases?|media coverage|featured articles?|articles?|videos?|all blogs?'
    r'|news|blog)\s*:?\s*',
    re.I
)
# Leading date (with optional category word) like "March 16, 2026 Specialty Chemicals "
_TITLE_DATE_PFX = re.compile(
    r'^(?:(?:january|february|march|april|may|june|july|august|september|october|november|december'
    r'|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s+\d{4}'
    r'|\d{1,2}/\d{1,2}/\d{4})\s*'
    r'(?:press releases?|media coverage|featured articles?|specialty chemicals|pharmaceuticals?'
    r'|personal care|events?(?:\s*&\s*media)?|sourcing education|predictive procurement'
    r'|news|blog|press)?\s*',
    re.I
)
# Trailing "Mmm DD, YYYY <teaser text>" — strip date + everything after (Arkestro pattern)
_TITLE_DATE_SFX = re.compile(
    r'\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s+\d{4}.*$',
    re.I
)
_TITLE_MDY_SFX  = re.compile(r'\s+\d{1,2}/\d{1,2}/\d{4}\s*$')
# Date embedded in title for age extraction
_DATE_IN_TITLE  = re.compile(
    r'((?:january|february|march|april|may|june|july|august|september|october|november|december'
    r'|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s+\d{4}'
    r'|\d{1,2}/\d{1,2}/\d{4})',
    re.I
)


def _is_junk(title: str, url: str) -> bool:
    if _JUNK_URL_RE.search(url):
        return True
    t = title.strip()
    if len(t) < 15:
        return True
    if _JUNK_TITLE_RE.match(t):
        return True
    # "Feb 16, 2026 | News" — date + pipe + single word
    if re.match(r'^[\w\s,/]+\s*\|\s*\w+\s*$', t) and len(t) < 50:
        return True
    return False


def _is_signal_article(raw_title: str, url: str) -> bool:
    """
    Portfolio news quality gate.

    Rules:
    - Press/news/newsroom URL paths: always pass (company chose to put it there)
    - Blog/article/insights URL paths: only pass if the title contains a signal keyword
      indicating an actual company event (funding, partnership, award, case study, etc.)
    - All other paths (e.g. /post/): pass through (too varied to categorize)

    Signal keywords: fundraise, launch, partnership, award, named, appointed, case study,
    deploys, secures, signs contract, IPO, acquires, expands, wins, approved, certified.
    Content marketing (how-to guides, thought-leadership, industry commentary) is blocked.
    """
    if _NEWS_PATH_RE.search(url):
        return True
    if _BLOG_PATH_RE.search(url):
        return bool(_SIGNAL_RE.search(raw_title))
    return True


def _clean_title(title: str) -> str:
    t = title.strip()
    # Strip type prefix ("Press Release ", "Articles ", etc.)
    t = _TITLE_TYPE_PFX.sub('', t).strip()
    # Strip leading date + optional category label
    t = _TITLE_DATE_PFX.sub('', t).strip()
    # Strip trailing date + teaser (Arkestro pattern)
    t = _TITLE_DATE_SFX.sub('', t).strip()
    # Strip trailing m/d/yyyy
    t = _TITLE_MDY_SFX.sub('', t).strip()
    # Strip trailing "Read More"
    t = re.sub(r'\s+Read More\s*$', '', t, flags=re.I).strip()
    # Deduplicate: "XYZ XYZ" → "XYZ" (Atmo AI pattern)
    n = len(t)
    for split in range(n // 3, n // 2 + 1):
        chunk = t[:split].rstrip()
        if t[split:].lstrip().startswith(chunk):
            t = chunk
            break
    return t.strip()


def _extract_date_from_title(title: str) -> str:
    """Pull the first date string out of a title (for use as age when age is empty)."""
    m = _DATE_IN_TITLE.search(title)
    return m.group(0) if m else ''


def _is_relevant(article: dict, company_name: str, domain: str) -> bool:
    """Only surface articles that actually mention this company."""
    url   = article.get('url', '')
    title = article.get('title', '')
    # Skip category/tag/pagination URLs
    if _JUNK_URL_RE.search(url):
        return False
    text = ' '.join([title, article.get('snippet', ''), url]).lower()
    if domain and domain.lower() in text:
        return True
    brand = domain.split('.')[0].lower() if domain else ''
    if brand and len(brand) > 3 and brand in text:
        return True
    name_l = company_name.lower()
    if len(name_l) > 6 and name_l in text:
        return True
    if len(name_l) <= 6 and domain and domain.lower() in url.lower():
        return True
    return False


def _age_to_seconds(age: str) -> int:
    """Convert age string to seconds-since-now for sorting (lower = more recent)."""
    if not age:
        return 999_999_999
    age = age.strip()
    # Relative: "X units ago"
    m = re.match(r'(\d+)\s+(second|minute|hour|day|week|month|year)', age.lower())
    if m:
        n, unit = int(m.group(1)), m.group(2)
        return n * {'second': 1, 'minute': 60, 'hour': 3600, 'day': 86400,
                    'week': 604800, 'month': 2592000, 'year': 31536000}[unit]
    # Absolute: "Month DD, YYYY" or "Mon DD, YYYY"
    m = re.match(r'([a-z]+)\s+(\d{1,2}),?\s+(\d{4})', age.lower())
    if m:
        month = _MONTH_MAP.get(m.group(1))
        if month:
            try:
                d = _dt.date(int(m.group(3)), month, int(m.group(2)))
                return max(0, (_dt.date.today() - d).days) * 86400
            except ValueError:
                pass
    # Absolute: "MM/DD/YYYY"
    m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', age)
    if m:
        try:
            d = _dt.date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
            return max(0, (_dt.date.today() - d).days) * 86400
        except ValueError:
            pass
    # Absolute: "YYYY-MM-DD"
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', age)
    if m:
        try:
            d = _dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            return max(0, (_dt.date.today() - d).days) * 86400
        except ValueError:
            pass
    return 999_999_999

router = APIRouter()


def _fmt_raised(amount):
    if not amount:
        return None
    if amount >= 1_000_000_000:
        return f"${amount / 1_000_000_000:.1f}B"
    if amount >= 1_000_000:
        return f"${amount / 1_000_000:.1f}M"
    return f"${amount:,}"


class PortfolioCompany(BaseModel):
    id: int
    name: str
    one_liner: Optional[str] = None
    description: Optional[str] = None
    sector: Optional[str] = None
    stage: Optional[str] = None
    location: Optional[str] = None
    hq_city: Optional[str] = None
    country: Optional[str] = None
    website: Optional[str] = None
    founded: Optional[int] = None
    employee_count: Optional[int] = None
    total_raised_usd: Optional[int] = None
    raised: Optional[str] = None
    investors: List[str] = []
    tags: List[str] = []
    intro_count: int = 0
    intro_partners: List[str] = []
    last_intro_date: Optional[str] = None
    latest_investment_date: Optional[str] = None
    case_study: Optional[str] = None
    competitive_advantage: Optional[str] = None
    score: Optional[float] = None
    fund: Optional[str] = None


class PortfolioStats(BaseModel):
    total_companies: int
    total_raised_usd: int
    avg_founded_year: Optional[float]
    sector_distribution: list
    stage_distribution: list
    top_by_intros: List[PortfolioCompany]
    recent_introductions: List[PortfolioCompany]
    cvc_deployed_capital: Optional[int] = None
    cvc_committed_capital: Optional[int] = None
    cvc_nav: Optional[int] = None
    cvc_tvpi: Optional[float] = None
    total_deployed_usd: Optional[int] = None  # sum across Fund I + Family Office term_sheets
    fund_i_deployed_usd: Optional[int] = None
    family_office_deployed_usd: Optional[int] = None


@router.get("/", response_model=List[PortfolioCompany])
def list_portfolio(
    q: Optional[str] = Query(None),
    sector: Optional[str] = Query(None),
    stage: Optional[str] = Query(None),
    user=Depends(require_auth),
):
    conditions = ["is_portfolio = TRUE"]
    params: list = []

    if q:
        conditions.append("(name ILIKE %s OR one_liner ILIKE %s)")
        params.extend([f"%{q}%", f"%{q}%"])
    if sector:
        conditions.append("sector ILIKE %s")
        params.append(f"%{sector}%")
    if stage:
        conditions.append("stage = %s")
        params.append(stage)

    where = "WHERE " + " AND ".join(conditions)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT c.id, c.name, c.one_liner, c.description, c.sector, c.stage,
                       c.hq_city, c.country, c.website, c.founded, c.employee_count,
                       c.total_raised_usd, c.investors, c.tags,
                       (SELECT COUNT(*) FROM cvc.partner_intros pi WHERE pi.company_id = c.id) AS intro_count,
                       (SELECT COALESCE(ARRAY_AGG(DISTINCT pi.partner_name ORDER BY pi.partner_name), ARRAY[]::text[]) FROM cvc.partner_intros pi WHERE pi.company_id = c.id) AS intro_partners,
                       (SELECT MAX(pi.intro_date) FROM cvc.partner_intros pi WHERE pi.company_id = c.id) AS last_intro_date,
                       c.latest_investment_date,
                       c.case_study, c.competitive_advantage, c.score_composite, c.fund
                FROM cvc.companies c
                {where}
                ORDER BY intro_count DESC, score_composite DESC NULLS LAST, c.name
                """,
                params,
            )
            rows = cur.fetchall()

    result = []
    for r in rows:
        city, country = r["hq_city"], r["country"]
        location = f"{city}, {country}" if city and country else city or country or None
        result.append(PortfolioCompany(
            id=r["id"],
            name=r["name"],
            one_liner=r["one_liner"],
            description=r["description"],
            sector=r["sector"],
            stage=r["stage"],
            location=location,
            hq_city=city,
            country=country,
            website=r["website"],
            founded=r["founded"],
            employee_count=r["employee_count"],
            total_raised_usd=r["total_raised_usd"],
            raised=_fmt_raised(r["total_raised_usd"]),
            investors=list(r["investors"]) if r["investors"] else [],
            tags=list(r["tags"]) if r["tags"] else [],
            intro_count=r["intro_count"] or 0,
            intro_partners=list(r["intro_partners"]) if r["intro_partners"] else [],
            last_intro_date=str(r["last_intro_date"]) if r["last_intro_date"] else None,
            latest_investment_date=str(r["latest_investment_date"]) if r["latest_investment_date"] else None,
            case_study=r["case_study"],
            competitive_advantage=r["competitive_advantage"],
            score=r["score_composite"],
            fund=r["fund"],
        ))
    return result


@router.get("/stats", response_model=PortfolioStats)
def portfolio_stats(user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Aggregates
            cur.execute("""
                SELECT
                    COUNT(*)                          AS total_companies,
                    COALESCE(SUM(total_raised_usd),0) AS total_raised_usd,
                    AVG(NULLIF(founded, 0))            AS avg_founded_year
                FROM cvc.companies
                WHERE is_portfolio = TRUE
            """)
            agg = cur.fetchone()

            # Sector distribution
            cur.execute("""
                SELECT COALESCE(sector, 'Unclassified') AS sector, COUNT(*) AS count
                FROM cvc.companies
                WHERE is_portfolio = TRUE
                GROUP BY sector
                ORDER BY count DESC
            """)
            sector_dist = [{"sector": r["sector"], "count": r["count"]} for r in cur.fetchall()]

            # Stage distribution
            cur.execute("""
                SELECT COALESCE(stage, 'undisclosed') AS stage, COUNT(*) AS count
                FROM cvc.companies
                WHERE is_portfolio = TRUE
                GROUP BY stage
                ORDER BY count DESC
            """)
            stage_dist = [{"stage": r["stage"], "count": r["count"]} for r in cur.fetchall()]

            # Top companies by intro count
            cur.execute("""
                SELECT c.id, c.name, c.sector, c.stage, c.hq_city, c.country, c.website,
                       c.total_raised_usd, c.one_liner,
                       (SELECT COUNT(*) FROM cvc.partner_intros pi WHERE pi.company_id = c.id) AS intro_count,
                       (SELECT COALESCE(ARRAY_AGG(DISTINCT pi.partner_name ORDER BY pi.partner_name), ARRAY[]::text[]) FROM cvc.partner_intros pi WHERE pi.company_id = c.id) AS intro_partners,
                       (SELECT MAX(pi.intro_date) FROM cvc.partner_intros pi WHERE pi.company_id = c.id) AS last_intro_date,
                       c.latest_investment_date, c.score_composite
                FROM cvc.companies c
                WHERE c.is_portfolio = TRUE
                ORDER BY intro_count DESC, score_composite DESC NULLS LAST
                LIMIT 10
            """)
            top_rows = cur.fetchall()

            # Recent introductions (portfolio companies with intros, sorted by last_intro_date)
            cur.execute("""
                SELECT c.id, c.name, c.sector, c.stage, c.hq_city, c.country, c.website,
                       c.total_raised_usd, c.one_liner,
                       (SELECT COUNT(*) FROM cvc.partner_intros pi WHERE pi.company_id = c.id) AS intro_count,
                       (SELECT COALESCE(ARRAY_AGG(DISTINCT pi.partner_name ORDER BY pi.partner_name), ARRAY[]::text[]) FROM cvc.partner_intros pi WHERE pi.company_id = c.id) AS intro_partners,
                       (SELECT MAX(pi.intro_date) FROM cvc.partner_intros pi WHERE pi.company_id = c.id) AS last_intro_date,
                       c.latest_investment_date, c.score_composite
                FROM cvc.companies c
                WHERE c.is_portfolio = TRUE
                  AND (SELECT COUNT(*) FROM cvc.partner_intros pi WHERE pi.company_id = c.id) > 0
                ORDER BY last_intro_date DESC NULLS LAST
                LIMIT 8
            """)
            recent_rows = cur.fetchall()

    def _row_to_company(r):
        city, country = r["hq_city"], r["country"]
        return PortfolioCompany(
            id=r["id"],
            name=r["name"],
            sector=r["sector"],
            stage=r["stage"],
            location=f"{city}, {country}" if city and country else city or country or None,
            hq_city=city,
            country=country,
            website=r["website"],
            total_raised_usd=r["total_raised_usd"],
            raised=_fmt_raised(r["total_raised_usd"]),
            one_liner=r["one_liner"],
            intro_count=r["intro_count"] or 0,
            intro_partners=list(r["intro_partners"]) if r["intro_partners"] else [],
            last_intro_date=str(r["last_intro_date"]) if r["last_intro_date"] else None,
            latest_investment_date=str(r["latest_investment_date"]) if r["latest_investment_date"] else None,
            score=r["score_composite"],
        )

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT deployed_capital, committed_capital, nav, tvpi
                FROM cvc.fund_metrics ORDER BY id DESC LIMIT 1
            """)
            fm = cur.fetchone()

            # Total deployed across all portfolio vehicles (Fund I initial + follow-ons + Family Office)
            cur.execute("""
                SELECT
                    COALESCE(SUM(CASE WHEN t.fund = 'Fund I'        THEN t.check_size_usd END), 0)
                        + COALESCE((SELECT SUM(f.amount_usd) FROM cvc.term_sheet_followons f WHERE f.amount_usd IS NOT NULL), 0)
                        AS fund_i,
                    COALESCE(SUM(CASE WHEN t.fund = 'Family Office' THEN t.check_size_usd END), 0) AS family_office,
                    COALESCE(SUM(t.check_size_usd), 0)
                        + COALESCE((SELECT SUM(f.amount_usd) FROM cvc.term_sheet_followons f WHERE f.amount_usd IS NOT NULL), 0)
                        AS total
                FROM cvc.term_sheets t
                JOIN cvc.companies c ON c.id = t.company_id
                WHERE c.is_portfolio = TRUE AND t.check_size_usd IS NOT NULL
            """)
            td = cur.fetchone()

    return PortfolioStats(
        total_companies=agg["total_companies"],
        total_raised_usd=agg["total_raised_usd"],
        avg_founded_year=float(agg["avg_founded_year"]) if agg["avg_founded_year"] else None,
        sector_distribution=sector_dist,
        stage_distribution=stage_dist,
        top_by_intros=[_row_to_company(r) for r in top_rows],
        recent_introductions=[_row_to_company(r) for r in recent_rows],
        cvc_deployed_capital=int(fm["deployed_capital"]) if fm else None,
        cvc_committed_capital=int(fm["committed_capital"]) if fm else None,
        cvc_nav=int(fm["nav"]) if fm else None,
        cvc_tvpi=float(fm["tvpi"]) if fm else None,
        total_deployed_usd=int(td["total"]) if td else None,
        fund_i_deployed_usd=int(td["fund_i"]) if td else None,
        family_office_deployed_usd=int(td["family_office"]) if td else None,
    )


# ── Portco News & Announcements ───────────────────────────────────────────────

class AnnouncementCreate(BaseModel):
    company_id: int
    title: str
    body: Optional[str] = None
    announcement_type: str = "general"
    is_public: bool = False
    source_url: Optional[str] = None
    announced_date: Optional[str] = None  # YYYY-MM-DD


class AnnouncementUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    announcement_type: Optional[str] = None
    is_public: Optional[bool] = None
    source_url: Optional[str] = None
    announced_date: Optional[str] = None


@router.get("/news")
def get_portfolio_news(user=Depends(require_auth)):
    """
    Combined portco news feed:
    - Manual announcements from cvc.portco_announcements (newest first)
    - Scraped news from companies.news_articles JSONB (portfolio companies only)
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Manual announcements
            cur.execute("""
                SELECT pa.id, pa.company_id, c.name AS company_name,
                       pa.title, pa.body, pa.announcement_type, pa.is_public,
                       pa.source_url, pa.announced_date, pa.added_by, pa.created_at
                FROM cvc.portco_announcements pa
                JOIN cvc.companies c ON c.id = pa.company_id
                ORDER BY COALESCE(pa.announced_date, pa.created_at::date) DESC, pa.created_at DESC
                LIMIT 50
            """)
            announcements = []
            for r in cur.fetchall():
                announcements.append({
                    "id":                r["id"],
                    "company_id":        r["company_id"],
                    "company_name":      r["company_name"],
                    "title":             r["title"],
                    "body":              r["body"],
                    "announcement_type": r["announcement_type"],
                    "is_public":         r["is_public"],
                    "source_url":        r["source_url"],
                    "announced_date":    str(r["announced_date"]) if r["announced_date"] else None,
                    "added_by":          r["added_by"],
                    "created_at":        r["created_at"].isoformat(),
                    "source":            "manual",
                })

            # Scraped news — unpack news_articles JSONB from portfolio companies
            cur.execute("""
                SELECT id, name, website, news_articles
                FROM cvc.companies
                WHERE is_portfolio = TRUE
                  AND news_articles IS NOT NULL
                  AND jsonb_array_length(news_articles) > 0
            """)
            scraped = []
            for r in cur.fetchall():
                articles = r["news_articles"] if isinstance(r["news_articles"], list) else []
                domain = ""
                if r["website"]:
                    domain = _urlparse(r["website"] if r["website"].startswith("http") else f"https://{r['website']}").netloc.replace("www.", "")
                for art in articles[:6]:
                    raw_title = art.get("title", "")
                    url       = art.get("url", "")
                    # Filter junk before relevance check
                    if _is_junk(raw_title, url):
                        continue
                    if not _is_relevant(art, r["name"], domain):
                        continue
                    if not _is_signal_article(raw_title, url):
                        continue
                    # Use age from article; if empty, extract from raw title
                    age = art.get("age", "") or _extract_date_from_title(raw_title)
                    clean = _clean_title(raw_title)
                    # Skip if cleaning left us with nothing useful
                    if len(clean) < 15:
                        continue
                    scraped.append({
                        "company_id":   r["id"],
                        "company_name": r["name"],
                        "title":        clean,
                        "snippet":      art.get("snippet", ""),
                        "source_url":   url,
                        "age":          age,
                        "source":       "scraped",
                    })

    # Sort scraped news most-recent first using parsed age strings
    scraped.sort(key=lambda x: _age_to_seconds(x["age"]))

    return {
        "announcements": announcements,
        "scraped_news":  scraped[:150],
    }


@router.post("/announcements")
def create_announcement(body: AnnouncementCreate, user=Depends(require_auth)):
    username = user.get("username", "unknown") if isinstance(user, dict) else str(user)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.portco_announcements
                    (company_id, title, body, announcement_type, is_public, source_url, announced_date, added_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                body.company_id, body.title, body.body, body.announcement_type,
                body.is_public, body.source_url,
                body.announced_date or None,
                username,
            ))
            new_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": new_id, "status": "created"}


@router.patch("/announcements/{ann_id}")
def update_announcement(ann_id: int, body: AnnouncementUpdate, user=Depends(require_auth)):
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE cvc.portco_announcements SET {set_clause}, updated_at = NOW() WHERE id = %s RETURNING id",
                list(fields.values()) + [ann_id],
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Announcement not found")
        conn.commit()
    return {"status": "updated"}


@router.delete("/announcements/{ann_id}")
def delete_announcement(ann_id: int, user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.portco_announcements WHERE id = %s RETURNING id", (ann_id,)
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Announcement not found")
        conn.commit()
    return {"status": "deleted"}


@router.get("/recent-stages")
def get_recent_stages(user=Depends(require_auth)):
    """
    Portfolio companies with a stage change or large round (>= $10M) in the last 14 days.
    Returns [{company_id, company_name, new_stage, event_at}].
    Used by the portfolio grid to apply the gold stage-change highlight.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Stage changes recorded in activity log
            cur.execute("""
                SELECT DISTINCT ON (cal.company_id)
                    cal.company_id,
                    c.name AS company_name,
                    cal.new_value AS new_stage,
                    cal.changed_at AS event_at
                FROM cvc.company_activity_log cal
                JOIN cvc.companies c ON c.id = cal.company_id
                WHERE cal.field_name = 'stage'
                  AND cal.changed_at > NOW() - INTERVAL '14 days'
                  AND c.is_portfolio = TRUE
                ORDER BY cal.company_id, cal.changed_at DESC
            """)
            from_log = {r["company_id"]: {
                "company_id": r["company_id"],
                "company_name": r["company_name"],
                "new_stage": r["new_stage"],
                "event_at": r["event_at"].isoformat(),
            } for r in cur.fetchall()}

            # Large rounds (>= $10M) created in last 14 days — proxy for a stage transition
            cur.execute("""
                SELECT DISTINCT ON (c.id)
                    c.id AS company_id,
                    c.name AS company_name,
                    c.stage AS new_stage,
                    fr.created_at AS event_at
                FROM cvc.funding_rounds fr
                JOIN cvc.companies c ON c.id = fr.company_id
                WHERE fr.amount_usd >= 10000000
                  AND fr.created_at > NOW() - INTERVAL '14 days'
                  AND c.is_portfolio = TRUE
                ORDER BY c.id, fr.created_at DESC
            """)
            from_rounds = {r["company_id"]: {
                "company_id": r["company_id"],
                "company_name": r["company_name"],
                "new_stage": r["new_stage"],
                "event_at": r["event_at"].isoformat(),
            } for r in cur.fetchall()}

            # Activity log takes precedence over round-proxy
            merged = {**from_rounds, **from_log}
            return list(merged.values())


@router.get("/deployments")
def portfolio_deployments(user=Depends(require_auth)):
    """
    Annual deployment reports built from term_sheets (core data, no plugin required).
    Groups investments by close_date year, returning totals and per-investment detail.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    t.id, c.id AS company_id, c.name, c.sector,
                    t.investment_type, t.round_type,
                    t.check_size_usd, t.pre_money_valuation_usd, t.round_size_usd,
                    t.fmv_usd, t.moic,
                    t.is_lead_investor, t.lead_investor, t.co_investors,
                    t.close_date, t.fund
                FROM cvc.term_sheets t
                JOIN cvc.companies c ON c.id = t.company_id
                WHERE c.is_portfolio = TRUE
                ORDER BY t.close_date ASC NULLS LAST, c.name
            """)
            rows = cur.fetchall()

    # Group by year
    from collections import defaultdict
    by_year: dict = defaultdict(list)
    no_date = []
    for r in rows:
        inv = {
            "id":                      r["id"],
            "company_id":              r["company_id"],
            "name":                    r["name"],
            "sector":                  r["sector"],
            "investment_type":         r["investment_type"],
            "round_type":              r["round_type"],
            "check_size_usd":          r["check_size_usd"],
            "pre_money_valuation_usd": r["pre_money_valuation_usd"],
            "round_size_usd":          r["round_size_usd"],
            "fmv_usd":                 r["fmv_usd"],
            "moic":                    float(r["moic"]) if r["moic"] is not None else None,
            "is_lead_investor":        r["is_lead_investor"],
            "lead_investor":           r["lead_investor"],
            "co_investors":            list(r["co_investors"]) if r["co_investors"] else [],
            "close_date":              str(r["close_date"]) if r["close_date"] else None,
            "fund":                    r["fund"],
            "is_written_off":          False,
            "followons":               [],
        }
        if r["close_date"]:
            by_year[r["close_date"].year].append(inv)
        else:
            no_date.append(inv)

    def _build_report(year, investments, cumulative_deployed, cumulative_count):
        year_deployed = sum(i["check_size_usd"] or 0 for i in investments)
        year_fmv = sum(i["fmv_usd"] or 0 for i in investments)
        moics = [i["moic"] for i in investments if i["moic"] is not None]
        year_moic = round(sum(moics) / len(moics), 2) if moics else None
        sector_breakdown: dict = {}
        for i in investments:
            s = i["sector"] or "Unclassified"
            sector_breakdown[s] = sector_breakdown.get(s, 0) + 1
        return {
            "year":               year,
            "investments":        investments,
            "year_deployed":      year_deployed,
            "year_fmv":           year_fmv,
            "year_moic":          year_moic,
            "year_company_count": len(investments),
            "cumulative_deployed": cumulative_deployed + year_deployed,
            "cumulative_count":   cumulative_count + len(investments),
            "sector_breakdown":   sector_breakdown,
        }

    reports = []
    cum_deployed = 0
    cum_count = 0
    for year in sorted(by_year.keys(), reverse=True):
        report = _build_report(year, by_year[year], cum_deployed, cum_count)
        cum_deployed = report["cumulative_deployed"]
        cum_count = report["cumulative_count"]
        reports.append(report)

    if no_date:
        reports.append(_build_report("No date", no_date, cum_deployed, cum_count))

    # Summary totals
    all_investments = [i for y in by_year.values() for i in y] + no_date
    total_deployed = sum(i["check_size_usd"] or 0 for i in all_investments)
    total_fmv = sum(i["fmv_usd"] or 0 for i in all_investments)

    return {
        "reports": reports,
        "total_deployed": total_deployed,
        "total_fmv": total_fmv,
        "total_companies": len(all_investments),
    }


@router.get("/milestone-round")
def get_milestone_round(user=Depends(require_auth)):
    """
    The single most recent funding round >= $10M across all portfolio companies.
    Used by the Portfolio page milestone banner.
    Returns null if none exists.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT fr.id, c.id AS company_id, c.name AS company_name,
                       fr.round_type, fr.amount_usd, fr.valuation_usd,
                       fr.announced_date, fr.created_at
                FROM cvc.funding_rounds fr
                JOIN cvc.companies c ON c.id = fr.company_id
                WHERE fr.amount_usd >= 10000000
                  AND c.is_portfolio = TRUE
                ORDER BY fr.created_at DESC
                LIMIT 1
            """)
            r = cur.fetchone()
            if not r:
                return None
            return {
                "id":           r["id"],
                "company_id":   r["company_id"],
                "company_name": r["company_name"],
                "round_type":   r["round_type"],
                "amount_usd":   r["amount_usd"],
                "valuation_usd": r["valuation_usd"],
                "announced_date": str(r["announced_date"]) if r["announced_date"] else None,
                "created_at":   r["created_at"].isoformat(),
            }
