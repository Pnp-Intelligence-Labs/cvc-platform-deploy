"""
LP Portal plugin — routes.py
Prefix: /lp
Tag:    lp-portal

Endpoints:
  GET /lp/overview       — fund metrics + portfolio summary
  GET /lp/annual-reports — portfolio companies grouped by investment year
  GET /lp/nav-history    — monthly NAV snapshots for the TVPI chart

All fund names are driven by config/team.json (default_fund) — no hardcoding.
"""

import json
import os
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, status
from core.db.connection import get_connection
from api.routes.auth import require_jwt, UserInfo

router = APIRouter()

_CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "config", "team.json"
)

_LP_ALLOWED_ROLES = {"GP", "Principal", "Director"}


def _get_config() -> dict:
    try:
        with open(_CONFIG_PATH) as f:
            return json.load(f)
    except Exception:
        return {"default_fund": "Fund I", "fund_names": ["Fund I"]}


def _require_lp_access(user: UserInfo = Depends(require_jwt)) -> UserInfo:
    """Dependency — rejects non-GP roles with 403. LP data is GP/Director only."""
    if user.role not in _LP_ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="LP fund data is not available for your role.",
        )
    return user


@router.get("/overview")
def get_lp_overview(user: UserInfo = Depends(_require_lp_access)):
    cfg = _get_config()
    default_fund = cfg.get("default_fund", "Fund I")

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Portfolio company count for default fund
            cur.execute("""
                SELECT COUNT(*) as count
                FROM term_sheets
                WHERE fund = %s
            """, (default_fund,))
            portfolio_companies = cur.fetchone()["count"]

            # Portfolio company counts by sector
            cur.execute("""
                SELECT c.sector, COUNT(*) as count
                FROM term_sheets ts
                JOIN companies c ON c.id = ts.company_id
                WHERE ts.fund = %s AND c.sector IS NOT NULL
                GROUP BY c.sector
            """, (default_fund,))
            company_counts = {row["sector"]: row["count"] for row in cur.fetchall()}

            # Fund metrics (latest row)
            cur.execute("""
                SELECT committed_capital, deployed_capital, nav, net_irr, tvpi, dpi,
                       fund_size_usd, management_fees_usd,
                       initial_investments_usd, followon_investments_usd, remaining_reserves_usd
                FROM fund_metrics
                ORDER BY id DESC LIMIT 1
            """)
            fm = cur.fetchone()

    if fm:
        committed_musd    = float(fm["committed_capital"]) / 1_000_000
        deployed_musd     = float(fm["deployed_capital"])  / 1_000_000
        nav_musd          = float(fm["nav"])               / 1_000_000
        net_irr_pct       = float(fm["net_irr"]) if fm["net_irr"] is not None else None
        net_tvpi          = float(fm["tvpi"])
        dpi               = float(fm["dpi"])
        fund_size_usd     = int(fm["fund_size_usd"])       if fm["fund_size_usd"]       else None
        mgmt_fees_usd     = int(fm["management_fees_usd"]) if fm["management_fees_usd"] else None
        investable_usd    = int(fm["committed_capital"])
        deployed_usd      = int(fm["deployed_capital"])
        deployment_pct    = round(deployed_usd / investable_usd * 100, 2) if investable_usd else 0.0
        initial_inv_usd   = int(fm["initial_investments_usd"])   if fm["initial_investments_usd"]   else None
        followon_inv_usd  = int(fm["followon_investments_usd"])  if fm["followon_investments_usd"]  else None
        remaining_res_usd = int(fm["remaining_reserves_usd"])    if fm["remaining_reserves_usd"]    else None
    else:
        committed_musd = deployed_musd = nav_musd = net_irr_pct = net_tvpi = dpi = deployment_pct = 0.0
        fund_size_usd = mgmt_fees_usd = investable_usd = deployed_usd = None
        initial_inv_usd = followon_inv_usd = remaining_res_usd = None

    return {
        "fund": {
            "name": default_fund,
            "size_musd": round(committed_musd, 2),
            "deployed_musd": round(deployed_musd, 2),
            "nav_musd": round(nav_musd, 2),
            "net_irr_pct": net_irr_pct,
            "net_tvpi": net_tvpi,
            "fund_size_usd": fund_size_usd,
            "management_fees_usd": mgmt_fees_usd,
            "investable_capital_usd": investable_usd,
            "deployed_capital_usd": deployed_usd,
            "deployment_pct": deployment_pct,
            "dpi": dpi,
            "portfolio_companies": portfolio_companies,
            "initial_investments_usd": initial_inv_usd,
            "followon_investments_usd": followon_inv_usd,
            "remaining_reserves_usd": remaining_res_usd,
        },
        "sectors": [
            {
                "name": sector,
                "company_count": count,
            }
            for sector, count in sorted(company_counts.items(), key=lambda x: x[1], reverse=True)
        ],
    }


@router.get("/annual-reports")
def get_annual_reports(user: UserInfo = Depends(_require_lp_access)):
    """Portfolio investments grouped by vintage year, newest first."""
    cfg = _get_config()
    default_fund = cfg.get("default_fund", "Fund I")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    c.id, c.name, c.sector, c.stage, c.hq_city, c.country,
                    ts.check_size_usd, ts.fmv_usd, ts.moic,
                    ts.close_date, ts.round_type, ts.investment_type,
                    ts.is_lead_investor, ts.co_investors, ts.lead_investor,
                    ts.pre_money_valuation_usd, ts.round_size_usd,
                    ts.is_written_off, ts.category_2
                FROM term_sheets ts
                JOIN companies c ON c.id = ts.company_id
                WHERE ts.fund = %s
                  AND ts.close_date IS NOT NULL
                ORDER BY ts.close_date ASC
            """, (default_fund,))
            rows = cur.fetchall()

            # Follow-on investments
            try:
                cur.execute("""
                    SELECT company_id, investment_date, amount_usd, followon_type, notes
                    FROM term_sheet_followons
                    WHERE fund = %s
                    ORDER BY investment_date ASC
                """, (default_fund,))
                followon_rows = cur.fetchall()
            except Exception:
                conn.rollback()
                followon_rows = []

    followons_by_company: dict = defaultdict(list)
    for fo in followon_rows:
        followons_by_company[fo["company_id"]].append({
            "date": str(fo["investment_date"]),
            "amount_usd": int(fo["amount_usd"]),
            "followon_type": fo["followon_type"],
            "notes": fo["notes"],
        })

    by_year: dict = defaultdict(list)
    for r in rows:
        year = r["close_date"].year
        city, country = r["hq_city"], r["country"]
        location = f"{city}, {country}" if city and country else city or country or None
        company_id = r["id"]
        is_written_off = bool(r["is_written_off"]) if r["is_written_off"] is not None else False
        by_year[year].append({
            "id":                      company_id,
            "name":                    r["name"],
            "sector":                  r["sector"],
            "stage":                   r["stage"],
            "location":                location,
            "check_size_usd":          int(r["check_size_usd"]) if r["check_size_usd"] else None,
            "fmv_usd":                 0.0 if is_written_off else (round(float(r["fmv_usd"]), 2) if r["fmv_usd"] else None),
            "moic":                    0.0 if is_written_off else (round(float(r["moic"]), 2) if r["moic"] else None),
            "close_date":              str(r["close_date"].date()) if hasattr(r["close_date"], "date") else str(r["close_date"]),
            "round_type":              r["round_type"],
            "investment_type":         r["investment_type"],
            "is_lead_investor":        bool(r["is_lead_investor"]) if r["is_lead_investor"] is not None else False,
            "co_investors":            list(r["co_investors"]) if r["co_investors"] else [],
            "lead_investor":           r["lead_investor"],
            "pre_money_valuation_usd": int(r["pre_money_valuation_usd"]) if r["pre_money_valuation_usd"] else None,
            "round_size_usd":          int(r["round_size_usd"]) if r["round_size_usd"] else None,
            "is_written_off":          is_written_off,
            "category_2":              r["category_2"],
            "followons":               followons_by_company.get(company_id, []),
        })

    cumulative_deployed = 0
    cumulative_count = 0
    reports = []

    for year in sorted(by_year.keys()):
        investments   = sorted(by_year[year], key=lambda i: i["close_date"])
        year_deployed = sum((i["check_size_usd"] or 0) for i in investments)
        year_fmv      = sum((i["fmv_usd"] or 0) for i in investments if i["fmv_usd"] is not None)
        year_moic     = round(year_fmv / year_deployed, 2) if year_deployed > 0 and year_fmv > 0 else None
        cumulative_deployed += year_deployed
        cumulative_count    += len(investments)

        sectors: dict = {}
        for inv in investments:
            s = inv["sector"] or "Unclassified"
            sectors[s] = sectors.get(s, 0) + 1

        reports.append({
            "year":                year,
            "investments":         investments,
            "year_deployed":       year_deployed,
            "year_fmv":            round(year_fmv, 2),
            "year_moic":           year_moic,
            "year_company_count":  len(investments),
            "cumulative_deployed": cumulative_deployed,
            "cumulative_count":    cumulative_count,
            "sector_breakdown":    sectors,
        })

    return {"reports": list(reversed(reports)), "fund": default_fund}


@router.get("/nav-history")
def get_nav_history(user: UserInfo = Depends(_require_lp_access)):
    """Monthly NAV snapshots for the TVPI chart."""
    cfg = _get_config()
    default_fund = cfg.get("default_fund", "Fund I")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT period_date, unrealized_fmv, invested_capital, tvpi
                FROM fund_nav_history
                WHERE fund = %s
                ORDER BY period_date ASC
            """, (default_fund,))
            rows = cur.fetchall()

    return {
        "fund": default_fund,
        "history": [
            {
                "date":     str(r["period_date"]),
                "fmv":      float(r["unrealized_fmv"]),
                "invested": float(r["invested_capital"]),
                "tvpi":     float(r["tvpi"]) if r["tvpi"] else None,
            }
            for r in rows
        ],
    }
