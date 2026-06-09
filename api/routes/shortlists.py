"""
api/routes/shortlists.py — Shortlist management endpoints.

Tables:
- cvc.shortlists: id, name, created_at
- cvc.shortlist_companies: shortlist_id, company_id, added_at
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import require_auth
from core.db.connection import get_connection

router = APIRouter()


class ShortlistCreate(BaseModel):
    name: str


class AddCompanyRequest(BaseModel):
    company_id: int


class Shortlist(BaseModel):
    id: int
    name: str
    created_at: datetime
    company_count: int | None = 0


class ShortlistCompany(BaseModel):
    company_id: int
    company_name: str
    sector: str | None = None
    stage: str | None = None
    added_at: datetime


class ShortlistDetail(BaseModel):
    id: int
    name: str
    created_at: datetime
    companies: list[ShortlistCompany]


@router.post("/", response_model=Shortlist)
async def create_shortlist(
    data: ShortlistCreate,
    user=Depends(require_auth)
):
    """Create a new shortlist."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO cvc.shortlists (name) VALUES (%s) RETURNING id, name, created_at",
                (data.name,)
            )
            row = cur.fetchone()
            return Shortlist(
                id=row["id"],
                name=row["name"],
                created_at=row["created_at"],
                company_count=0
            )


@router.get("/", response_model=list[Shortlist])
async def list_shortlists(
    user=Depends(require_auth)
):
    """List all shortlists with company counts."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    s.id,
                    s.name,
                    s.created_at,
                    COUNT(sc.company_id) as company_count
                FROM cvc.shortlists s
                LEFT JOIN cvc.shortlist_companies sc ON s.id = sc.shortlist_id
                GROUP BY s.id, s.name, s.created_at
                ORDER BY s.created_at DESC
            """)
            rows = cur.fetchall()
            return [
                Shortlist(
                    id=r["id"],
                    name=r["name"],
                    created_at=r["created_at"],
                    company_count=r["company_count"]
                ) for r in rows
            ]


@router.get("/{shortlist_id}", response_model=ShortlistDetail)
async def get_shortlist(
    shortlist_id: int,
    user=Depends(require_auth)
):
    """Get a shortlist with all its companies."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Get shortlist info
            cur.execute(
                "SELECT id, name, created_at FROM cvc.shortlists WHERE id = %s",
                (shortlist_id,)
            )
            shortlist = cur.fetchone()
            if not shortlist:
                raise HTTPException(status_code=404, detail="Shortlist not found")

            # Get companies in this shortlist
            cur.execute("""
                SELECT
                    sc.company_id,
                    c.name as company_name,
                    c.sector,
                    c.stage,
                    sc.added_at
                FROM cvc.shortlist_companies sc
                JOIN cvc.companies c ON sc.company_id = c.id
                WHERE sc.shortlist_id = %s
                ORDER BY sc.added_at DESC
            """, (shortlist_id,))
            companies = [
                ShortlistCompany(
                    company_id=r["company_id"],
                    company_name=r["company_name"],
                    sector=r["sector"],
                    stage=r["stage"],
                    added_at=r["added_at"]
                ) for r in cur.fetchall()
            ]

            return ShortlistDetail(
                id=shortlist["id"],
                name=shortlist["name"],
                created_at=shortlist["created_at"],
                companies=companies
            )


@router.post("/{shortlist_id}/companies")
async def add_company_to_shortlist(
    shortlist_id: int,
    data: AddCompanyRequest,
    user=Depends(require_auth)
):
    """Add a company to a shortlist."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Verify shortlist exists
            cur.execute("SELECT id FROM cvc.shortlists WHERE id = %s", (shortlist_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Shortlist not found")

            # Verify company exists
            cur.execute("SELECT id FROM cvc.companies WHERE id = %s", (data.company_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Company not found")

            # Add company (ignore if already exists)
            try:
                cur.execute(
                    """INSERT INTO cvc.shortlist_companies (shortlist_id, company_id)
                       VALUES (%s, %s)""",
                    (shortlist_id, data.company_id)
                )
                return {"status": "added", "shortlist_id": shortlist_id, "company_id": data.company_id}
            except Exception as e:
                # Likely duplicate key violation
                if "unique" in str(e).lower() or "duplicate" in str(e).lower():
                    return {"status": "already_exists", "shortlist_id": shortlist_id, "company_id": data.company_id}
                raise


@router.delete("/{shortlist_id}/companies/{company_id}")
async def remove_company_from_shortlist(
    shortlist_id: int,
    company_id: int,
    user=Depends(require_auth)
):
    """Remove a company from a shortlist."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.shortlist_companies WHERE shortlist_id = %s AND company_id = %s",
                (shortlist_id, company_id)
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Company not found in shortlist")
            return {"status": "removed", "shortlist_id": shortlist_id, "company_id": company_id}
