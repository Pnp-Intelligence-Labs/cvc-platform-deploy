#!/usr/bin/env python3
"""
CVC Intelligence MCP Server
Wraps the Dell API (http://100.83.104.117:8001) as MCP tools.
Runs as a stdio subprocess spawned by Claude Code.
"""

import json
import os
import subprocess
import httpx
from mcp.server.fastmcp import FastMCP

DELL_USER = os.environ.get("DELL_USER", "")
DELL_HOST = os.environ.get("DELL_HOST", "")
DELL_LOGS = os.environ.get("DELL_LOGS", "")

# Map of friendly log names → actual filenames on Dell
LOG_FILES = {
    "api":        "cvc-api.log",
    "enrichment": "cvc_enrichment.log",
    "tasks":      "task_worker.log",
    "task_agent": "task_agent.log",
    "deploy":     "deploy.log",
    "scoring":    "cvc_scoring.log",
    "briefing":   "cvc_weekly_briefing.log",
    "signals":    "cvc_signals.log",
    "collectors": "cvc_collectors.log",
    "dd":         "dd_carrier1.log",
    "bigbosshog": "bigbosshog.log",
    "funding":    "cvc_enrichment.log",
}

API_BASE = os.environ.get("DELL_API_BASE", "")
AUTH = (
    os.environ.get("DELL_API_USER", ""),
    os.environ.get("DELL_API_PASSWORD", ""),
)

if not API_BASE or not all(AUTH):
    raise RuntimeError(
        "MCP server requires DELL_API_BASE, DELL_API_USER, DELL_API_PASSWORD "
        "(and DELL_USER, DELL_HOST, DELL_LOGS for log tools) in the environment."
    )

mcp = FastMCP("CVC Intelligence")


def _get(path: str, params: dict | None = None) -> dict | list:
    with httpx.Client(timeout=15) as client:
        r = client.get(f"{API_BASE}{path}", auth=AUTH, params=params)
        r.raise_for_status()
        return r.json()


def _post(path: str, body: dict) -> dict:
    with httpx.Client(timeout=15) as client:
        r = client.post(f"{API_BASE}{path}", auth=AUTH, json=body)
        r.raise_for_status()
        return r.json()


# ── Companies ───────────────────────────────────────────────────────────────

@mcp.tool()
def search_companies(query: str, limit: int = 10) -> str:
    """
    Search companies by name. Returns id, name, sector, stage, score_composite,
    enrichment_status, is_portfolio.
    """
    results = _get("/companies/", params={"q": query, "limit": limit})
    if not results:
        return "No companies found."
    rows = []
    for c in results:
        rows.append(
            f"[{c['id']}] {c['name']} | {c.get('sector','—')} | {c.get('stage','—')} "
            f"| score={c.get('score_composite','—')} | enrich={c.get('enrichment_status','—')} "
            f"| portfolio={c.get('is_portfolio', False)}"
        )
    return "\n".join(rows)


@mcp.tool()
def get_company(company_id: int) -> str:
    """
    Get full profile for a company by ID. Returns all key fields including
    sector, stage, scores, enrichment status, founders, funding, tags.
    """
    c = _get(f"/companies/{company_id}")
    # Format the most useful fields
    lines = [
        f"Name: {c.get('name')}",
        f"ID: {c.get('id')}",
        f"Sector: {c.get('sector')} | Stage: {c.get('stage')}",
        f"One-liner: {c.get('one_liner','')}",
        f"Website: {c.get('website','')}",
        f"Portfolio: {c.get('is_portfolio')} | Active: {c.get('is_active')}",
        f"Enrichment status: {c.get('enrichment_status')} | Source: {c.get('enrichment_source','')}",
        f"Scores — composite={c.get('score_composite')} IRS={c.get('score_irs')} SRI={c.get('score_sri')} TDF={c.get('score_tdf')} commercial={c.get('score_commercial')}",
        f"4D — env={c.get('env_4d')} func={c.get('func_4d')} stack={c.get('stack_4d')} biz={c.get('biz_model_4d')}",
        f"Founders: {c.get('founders','')}",
        f"Investors: {', '.join(c.get('investors') or [])}",
        f"Tags: {', '.join(c.get('tags') or [])}",
        f"Funding enriched: {c.get('funding_enriched_at')} | Founder enriched: {c.get('founder_enriched_at')}",
        f"Cases enriched: {c.get('cases_enriched_at')} | 4D enriched: {c.get('fourd_enriched_at')}",
    ]
    return "\n".join(lines)


@mcp.tool()
def get_enrichment_status(company_id: int) -> str:
    """
    Get per-step enrichment status for a company (founder, 4D, funding, cases).
    Shows whether each step has been run and whether data was found.
    """
    data = _get(f"/admin/status/{company_id}")
    lines = [f"Enrichment status for company {company_id}:"]
    for step, info in data.items():
        if isinstance(info, dict):
            done = info.get("done", False)
            last_run = info.get("last_run") or "never"
            lines.append(f"  {step}: done={done} | last_run={last_run}")
        else:
            lines.append(f"  {step}: {info}")
    return "\n".join(lines)


# ── Task Queue ───────────────────────────────────────────────────────────────

@mcp.tool()
def get_task_queue(status: str = "pending", limit: int = 20) -> str:
    """
    Get BigBossHog task queue. status: pending | running | completed | failed | all.
    Returns task id, type, company name, status, created_at.
    """
    params: dict = {"limit": limit}
    if status != "all":
        params["status"] = status
    tasks = _get("/tasks/", params=params)
    if not tasks:
        return f"No tasks with status={status}."
    rows = []
    for t in tasks:
        rows.append(
            f"[{t['id']}] {t.get('task_type','?')} | {t.get('company_name') or t.get('company_id','?')} "
            f"| {t.get('status')} | {t.get('created_at','')[:16]}"
        )
    return "\n".join(rows)


# ── Brambles ─────────────────────────────────────────────────────────────────

@mcp.tool()
def get_brambles_overview() -> str:
    """
    Get Brambles Strategic Fund pipeline overview: all companies with their
    enrichment status, review status, and tier.
    """
    companies = _get("/brambles/companies")
    if not companies:
        return "No Brambles companies found."

    counts: dict[str, int] = {}
    rows = []
    for c in companies:
        enrich = c.get("status", "?")
        review = c.get("review_status", "pending")
        tier = c.get("tier") or c.get("analyst_tier", "?")
        key = f"{enrich}/{review}"
        counts[key] = counts.get(key, 0) + 1
        rows.append(
            f"[{c['id']}] {c['company_name']} | tier={tier} | enrich={enrich} | review={review}"
        )

    summary = "  ".join(f"{k}:{v}" for k, v in sorted(counts.items()))
    return f"Summary: {summary}\n\n" + "\n".join(rows)


# ── Portfolio ─────────────────────────────────────────────────────────────────

@mcp.tool()
def get_portfolio_stats() -> str:
    """
    Get portfolio summary stats: total companies, by sector, by stage, avg score.
    """
    stats = _get("/portfolio/stats")
    return json.dumps(stats, indent=2)


# ── Deal Pipeline ─────────────────────────────────────────────────────────────

@mcp.tool()
def get_dealflow(limit: int = 20) -> str:
    """
    Get recent deal pipeline entries. Returns company name, stage, status,
    added_by, created_at.
    """
    deals = _get("/dealflow/", params={"limit": limit})
    if not deals:
        return "No deals found."
    rows = []
    for d in deals:
        rows.append(
            f"[{d.get('id')}] {d.get('company_name') or d.get('company_id','?')} "
            f"| stage={d.get('pipeline_status','?')} | by={d.get('changed_by','?')} "
            f"| {d.get('created_at','')[:10]}"
        )
    return "\n".join(rows)


# ── Logs ─────────────────────────────────────────────────────────────────────

def _ssh_tail(filename: str, lines: int) -> str:
    cmd = ["ssh", f"{DELL_USER}@{DELL_HOST}", f"tail -n {lines} {DELL_LOGS}/{filename} 2>&1"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    return result.stdout or result.stderr or "(empty)"


@mcp.tool()
def read_log(log: str = "api", lines: int = 50) -> str:
    """
    Read the last N lines of a Dell server log.
    log options: api, enrichment, tasks, task_agent, deploy, scoring,
                 briefing, signals, collectors, dd, bigbosshog, funding
    Default: api (the FastAPI server log — best for HTTP errors and tracebacks).
    """
    filename = LOG_FILES.get(log)
    if not filename:
        available = ", ".join(LOG_FILES.keys())
        return f"Unknown log '{log}'. Available: {available}"
    return _ssh_tail(filename, lines)


@mcp.tool()
def search_log(log: str, pattern: str, lines: int = 200) -> str:
    """
    Grep a Dell server log for a pattern. Returns matching lines.
    log options: api, enrichment, tasks, task_agent, deploy, scoring,
                 briefing, signals, collectors, dd, bigbosshog, funding
    pattern: any grep-compatible regex, e.g. 'ERROR', 'company_id=42', 'Traceback'
    """
    filename = LOG_FILES.get(log)
    if not filename:
        available = ", ".join(LOG_FILES.keys())
        return f"Unknown log '{log}'. Available: {available}"
    cmd = [
        "ssh", f"{DELL_USER}@{DELL_HOST}",
        f"grep -i {repr(pattern)} {DELL_LOGS}/{filename} | tail -n {lines} 2>&1"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    output = result.stdout or result.stderr or "(no matches)"
    return output


@mcp.tool()
def api_health() -> str:
    """
    Check Dell API health and list registered routes.
    Returns health status + HTTP method/path for every route.
    """
    try:
        health = _get("/health")
        routes = _get("/openapi.json")
        paths = routes.get("paths", {})
        route_lines = []
        for path, methods in sorted(paths.items()):
            for method in methods:
                if method.upper() in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                    route_lines.append(f"  {method.upper():6} {path}")
        return f"Health: {json.dumps(health)}\n\nRoutes ({len(route_lines)}):\n" + "\n".join(route_lines)
    except Exception as e:
        return f"API unreachable: {e}"


if __name__ == "__main__":
    mcp.run()
