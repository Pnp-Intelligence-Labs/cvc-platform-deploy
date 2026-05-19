from fastapi import APIRouter, Depends, HTTPException, status
from core.db.connection import get_connection
from api.routes.auth import require_jwt, UserInfo
from datetime import datetime, timedelta

router = APIRouter()

_LP_ALLOWED_ROLES = {"GP", "Principal", "Director", "Ventures"}


def _require_lp_access(user: UserInfo = Depends(require_jwt)) -> UserInfo:
    """Dependency — rejects PSM role with 403. LP data is not visible to PSMs."""
    if user.role not in _LP_ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="LP fund data is not available for your role.",
        )
    return user

def get_latest_quarter():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(quarter) FROM trend_report.raw_signals")
            result = cur.fetchone()
            return result["max"] if result and result["max"] else "2025-Q1"


def get_current_quarter():
    now = datetime.now()
    quarter = (now.month - 1) // 3 + 1
    return f"{now.year}-Q{quarter}"


def get_previous_quarter(quarter: str):
    year, q = quarter.split('-Q')
    year = int(year)
    q = int(q)
    if q == 1:
        return f"{year-1}-Q4"
    else:
        return f"{year}-Q{q-1}"


@router.get("/overview")
def get_lp_overview(user: UserInfo = Depends(_require_lp_access)):
    current_quarter = get_current_quarter()
    latest_quarter = get_latest_quarter()

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Sector heat scores from raw_signals last 90 days
            ninety_days_ago = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
            cur.execute("""
                SELECT sector_tags, COUNT(*) as signal_count
                FROM trend_report.raw_signals
                WHERE published_at >= %s
                AND sector_tags IS NOT NULL
                GROUP BY sector_tags
            """, (ninety_days_ago,))
            sector_signals = cur.fetchall()

            sector_heat = {}
            for row in sector_signals:
                for sector in row["sector_tags"]:
                    sector_heat[sector] = sector_heat.get(sector, 0) + row["signal_count"]

            # Portfolio company counts by sector
            cur.execute("""
                SELECT sector, COUNT(*) as count
                FROM cvc.companies
                WHERE sector IS NOT NULL AND is_portfolio = true
                GROUP BY sector
            """)
            company_counts = {row["sector"]: row["count"] for row in cur.fetchall()}

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) as count
                FROM cvc.term_sheets
                WHERE fund = 'Fund I'
            """)
            portfolio_companies = cur.fetchone()["count"]

    # Fund metrics from cvc.fund_metrics (latest row)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT committed_capital, deployed_capital, nav, net_irr, tvpi, dpi,
                       fund_size_usd, management_fees_usd,
                       initial_investments_usd, followon_investments_usd, remaining_reserves_usd
                FROM cvc.fund_metrics
                ORDER BY id DESC LIMIT 1
            """)
            fm = cur.fetchone()

    if fm:
        committed_musd     = float(fm["committed_capital"]) / 1_000_000
        deployed_musd      = float(fm["deployed_capital"])  / 1_000_000
        nav_musd           = float(fm["nav"])               / 1_000_000
        net_irr_pct        = float(fm["net_irr"]) if fm["net_irr"] is not None else None
        net_tvpi           = float(fm["tvpi"])
        dpi                = float(fm["dpi"])
        fund_size_usd      = int(fm["fund_size_usd"])      if fm["fund_size_usd"]      else None
        mgmt_fees_usd      = int(fm["management_fees_usd"]) if fm["management_fees_usd"] else None
        investable_usd     = int(fm["committed_capital"])
        deployed_usd       = int(fm["deployed_capital"])
        deployment_pct     = round(deployed_usd / investable_usd * 100, 2) if investable_usd else 0.0
        initial_inv_usd    = int(fm["initial_investments_usd"]) if fm["initial_investments_usd"] else None
        followon_inv_usd   = int(fm["followon_investments_usd"]) if fm["followon_investments_usd"] else None
        remaining_res_usd  = int(fm["remaining_reserves_usd"]) if fm["remaining_reserves_usd"] else None
    else:
        committed_musd = deployed_musd = nav_musd = 0.0
        net_irr_pct = net_tvpi = dpi = deployment_pct = 0.0
        fund_size_usd = mgmt_fees_usd = investable_usd = deployed_usd = None
        initial_inv_usd = followon_inv_usd = remaining_res_usd = None

    return {
        "fund": {
            "name": "Fund I",
            "vintage_year": 2021,
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
        "fund_ii": {
            "targeting_musd": 0,
            "focus_sectors": ["robotics", "supply_chain", "industrial_auto", "physical_ai"]
        },
        "sectors": [
            {
                "name": sector,
                "company_count": company_counts.get(sector, 0),
                "heat_score": sector_heat.get(sector, 0),
                "funding_this_quarter": 0,  # Will be filled in /lp/sectors
                "signal_count": sector_heat.get(sector, 0)
            }
            for sector in sorted(company_counts.keys(), key=lambda s: company_counts[s], reverse=True)
        ],
        "latest_quarter": latest_quarter
    }


@router.get("/sectors")
def get_lp_sectors(user: UserInfo = Depends(_require_lp_access)):
    current_quarter = get_current_quarter()
    previous_quarter = get_previous_quarter(current_quarter)

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Funding totals by sector and quarter
            cur.execute("""
                SELECT sector_tags, quarter, SUM(amount_usd) as total_funding
                FROM trend_report.funding_events
                WHERE quarter IN (%s, %s)
                AND sector_tags IS NOT NULL
                GROUP BY sector_tags, quarter
            """, (current_quarter, previous_quarter))
            funding_data = cur.fetchall()

            # Signal counts last 30 days
            thirty_days_ago = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
            cur.execute("""
                SELECT sector_tags, COUNT(*) as signal_count
                FROM trend_report.raw_signals
                WHERE published_at >= %s
                AND sector_tags IS NOT NULL
                GROUP BY sector_tags
            """, (thirty_days_ago,))
            signal_counts = cur.fetchall()

    # Process funding data
    funding_by_sector_quarter = {}
    for row in funding_data:
        for sector in row["sector_tags"]:
            if sector not in funding_by_sector_quarter:
                funding_by_sector_quarter[sector] = {"current": 0, "previous": 0}
            if row["quarter"] == current_quarter:
                funding_by_sector_quarter[sector]["current"] = row["total_funding"]
            elif row["quarter"] == previous_quarter:
                funding_by_sector_quarter[sector]["previous"] = row["total_funding"]

    # Process signal counts
    signals_by_sector = {}
    for row in signal_counts:
        for sector in row["sector_tags"]:
            signals_by_sector[sector] = row["signal_count"]

    sectors = []
    for sector in ["robotics", "supply_chain", "industrial_auto", "physical_ai"]:
        current_funding = funding_by_sector_quarter.get(sector, {}).get("current", 0)
        previous_funding = funding_by_sector_quarter.get(sector, {}).get("previous", 0)
        
        if previous_funding > 0:
            qoq_change = ((current_funding - previous_funding) / previous_funding) * 100
        elif current_funding > 0:
            qoq_change = 100.0  # New growth
        else:
            qoq_change = 0.0

        sectors.append({
            "name": sector,
            "company_count": 0,  # Filled in frontend or from other endpoint
            "funding_this_quarter": current_funding,
            "funding_qoq_change_pct": round(qoq_change, 1),
            "signal_count": signals_by_sector.get(sector, 0)
        })

    return {"sectors": sectors}


@router.get("/annual-reports")
def get_annual_reports(user: UserInfo = Depends(_require_lp_access)):
    """Fund I investments grouped by vintage year, newest first."""
    from collections import defaultdict

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
                FROM cvc.term_sheets ts
                JOIN cvc.companies c ON c.id = ts.company_id
                WHERE ts.fund = 'Fund I'
                  AND ts.close_date IS NOT NULL
                ORDER BY ts.close_date ASC
            """)
            rows = cur.fetchall()

            # Fetch follow-on investments keyed by company_id
            cur.execute("""
                SELECT company_id, investment_date, amount_usd, followon_type, notes
                FROM cvc.term_sheet_followons
                WHERE fund = 'Fund I'
                ORDER BY investment_date ASC
            """)
            followon_rows = cur.fetchall()

    followons_by_company: dict = defaultdict(list)
    for fo in followon_rows:
        followons_by_company[fo["company_id"]].append({
            "date": str(fo["investment_date"]),
            "amount_usd": int(fo["amount_usd"]),
            "followon_type": fo["followon_type"],
            "notes": fo["notes"],
        })

    by_year = defaultdict(list)
    for r in rows:
        year = r["close_date"].year
        city, country = r["hq_city"], r["country"]
        location = f"{city}, {country}" if city and country else city or country or None
        company_id = r["id"]
        is_written_off = bool(r["is_written_off"]) if r["is_written_off"] is not None else False
        by_year[year].append({
            "id":                     company_id,
            "name":                   r["name"],
            "sector":                 r["sector"],
            "stage":                  r["stage"],
            "location":               location,
            "check_size_usd":         int(r["check_size_usd"]) if r["check_size_usd"] else None,
            "fmv_usd":                0.0 if is_written_off else (round(float(r["fmv_usd"]), 2) if r["fmv_usd"] else None),
            "moic":                   0.0 if is_written_off else (round(float(r["moic"]), 2) if r["moic"] else None),
            "close_date":             str(r["close_date"].date()) if hasattr(r["close_date"], "date") else str(r["close_date"]),
            "round_type":             r["round_type"],
            "investment_type":        r["investment_type"],
            "is_lead_investor":       bool(r["is_lead_investor"]) if r["is_lead_investor"] is not None else False,
            "co_investors":           list(r["co_investors"]) if r["co_investors"] else [],
            "lead_investor":          r["lead_investor"],
            "pre_money_valuation_usd": int(r["pre_money_valuation_usd"]) if r["pre_money_valuation_usd"] else None,
            "round_size_usd":         int(r["round_size_usd"]) if r["round_size_usd"] else None,
            "is_written_off":         is_written_off,
            "category_2":             r["category_2"],
            "followons":              followons_by_company.get(company_id, []),
        })

    cumulative_deployed = 0
    cumulative_count    = 0
    reports = []

    for year in sorted(by_year.keys()):
        investments    = sorted(by_year[year], key=lambda i: i["close_date"])
        year_deployed  = sum((i["check_size_usd"] or 0) for i in investments)
        year_fmv       = sum((i["fmv_usd"] or 0) for i in investments if i["fmv_usd"] is not None)
        year_moic      = round(year_fmv / year_deployed, 2) if year_deployed > 0 and year_fmv > 0 else None
        cumulative_deployed += year_deployed
        cumulative_count    += len(investments)

        # Sector breakdown for this year
        sectors: dict = {}
        for inv in investments:
            s = inv["sector"] or "Unclassified"
            sectors[s] = sectors.get(s, 0) + 1

        reports.append({
            "year":               year,
            "investments":        investments,
            "year_deployed":      year_deployed,
            "year_fmv":           round(year_fmv, 2),
            "year_moic":          year_moic,
            "year_company_count": len(investments),
            "cumulative_deployed": cumulative_deployed,
            "cumulative_count":   cumulative_count,
            "sector_breakdown":   sectors,
        })

    return {"reports": list(reversed(reports))}


@router.get("/nav-history")
def get_nav_history(user: UserInfo = Depends(_require_lp_access)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT period_date, unrealized_fmv, invested_capital, tvpi
                FROM cvc.fund_nav_history
                WHERE fund = 'Fund I'
                ORDER BY period_date ASC
            """)
            rows = cur.fetchall()
    return {"history": [
        {
            "date": str(r["period_date"]),
            "fmv": float(r["unrealized_fmv"]),
            "invested": float(r["invested_capital"]),
            "tvpi": float(r["tvpi"]) if r["tvpi"] else None,
        }
        for r in rows
    ]}