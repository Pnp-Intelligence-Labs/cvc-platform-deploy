"""
industrial-matrix plugin routes
================================
Prefix: /industrial  (set by plugin_loader from manifest.json)

Endpoints:
  GET   /industrial/matrix             — scatter matrix data (filtered by team sectors)
  PATCH /industrial/{company_id}/scores — update readiness / sovereignty scores
"""

from __future__ import annotations

import json
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import require_auth
from core.db.connection import get_connection

router = APIRouter(dependencies=[Depends(require_auth)])


# ── Team sector config ─────────────────────────────────────────────────────────
# Read sectors from config/team.json at startup; fall back to industrial defaults.

_TEAM_CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "config", "team.json"
)

_FALLBACK_SECTORS = (
    "Software", "Fintech", "Healthcare", "Other"
)

try:
    with open(_TEAM_CONFIG_PATH) as _f:
        _team_cfg = json.load(_f)
    _sectors = [s for s in _team_cfg.get("sectors", []) if s != "Other"]
    TARGET_SECTORS = tuple(_sectors) if _sectors else _FALLBACK_SECTORS
except Exception:
    TARGET_SECTORS = _FALLBACK_SECTORS


# ── Scoring helpers ────────────────────────────────────────────────────────────

PROTOCOL_WEIGHTS: dict[str, float] = {
    "OPC-UA": -3.0, "MQTT": -3.0,
    "Siemens S7": -2.0, "Rockwell ControlLogix": -2.0,
    "ROS2": -1.5, "VDA 5050": -1.5, "Public API": -1.5, "SDK": -1.5,
    "Modbus": -1.0, "Modbus TCP": -1.0, "Profinet": -1.0,
    "EtherNet/IP": -1.0, "EtherCAT": -1.0, "CANopen": -1.0,
}


def calc_friction(protocol_support) -> float | None:
    if not protocol_support:
        return None
    try:
        protocols = (
            protocol_support
            if isinstance(protocol_support, list)
            else json.loads(protocol_support)
        )
        if not protocols:
            return None
        score = 10.0
        for proto in protocols:
            for known, weight in PROTOCOL_WEIGHTS.items():
                if known in proto:
                    score += weight
                    break
        return round(max(0.0, score), 1)
    except Exception:
        return None


def sovereignty_tier(score) -> str:
    if score is None:
        return "unknown"
    if score >= 8:
        return "green"
    if score >= 4:
        return "yellow"
    return "red"


def calc_composite(readiness: float, sovereignty: float | None, friction: float | None) -> dict:
    has_sov = sovereignty is not None
    has_fri = friction is not None
    if has_sov and has_fri:
        score = readiness * 0.4 + sovereignty * 0.3 + (10 - friction) * 0.3
    elif has_sov:
        score = readiness * 0.6 + sovereignty * 0.4
    elif has_fri:
        score = readiness * 0.6 + (10 - friction) * 0.4
    else:
        score = float(readiness)
    score = round(score, 1)
    if score >= 7.5:
        label = "Integration King"
    elif score >= 5.0:
        label = "Watchlist"
    else:
        label = "Pilot Purgatory"
    return {"score": score, "label": label}


# ── Routes ─────────────────────────────────────────────────────────────────────

class ScoreUpdate(BaseModel):
    readiness_score: Optional[float] = None
    sovereignty_score: Optional[float] = None


@router.get("/matrix")
def get_industrial_matrix(sector: str = None):
    """
    Pilot-to-Production scatter matrix.
    Returns companies in TARGET_SECTORS with readiness, friction, and sovereignty scores.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            extra_filter = ""
            params: list = [list(TARGET_SECTORS)]
            if sector:
                extra_filter = " AND c.sector = %s"
                params.append(sector)

            cur.execute(f"""
                SELECT
                    c.id, c.name, c.sector, c.stage,
                    c.industrial_readiness_score,
                    c.sovereignty_score,
                    c.protocol_support,
                    c.deployment_signal_level,
                    c.integration_notes,
                    c.verified_certs,
                    c.hq_city, c.country,
                    c.intel_sources,
                    COALESCE(SUM(fr.amount_usd), 0) AS total_funding
                FROM cvc.companies c
                LEFT JOIN cvc.funding_rounds fr ON fr.company_id = c.id
                WHERE c.sector = ANY(%s)
                  AND c.industrial_readiness_score IS NOT NULL
                  {extra_filter}
                GROUP BY c.id
                ORDER BY c.industrial_readiness_score DESC, total_funding DESC
            """, params)

            companies = []
            for r in cur.fetchall():
                def _parse_json(val):
                    if not val:
                        return []
                    try:
                        return val if isinstance(val, list) else json.loads(val)
                    except Exception:
                        return []

                readiness   = float(r["industrial_readiness_score"])
                sovereignty = float(r["sovereignty_score"]) if r["sovereignty_score"] is not None else None
                friction    = calc_friction(r["protocol_support"])
                composite   = calc_composite(readiness, sovereignty, friction)

                companies.append({
                    "id":               r["id"],
                    "name":             r["name"],
                    "sector":           r["sector"],
                    "stage":            r["stage"],
                    "readiness_score":  readiness,
                    "sovereignty_score": sovereignty,
                    "sovereignty_tier": sovereignty_tier(sovereignty),
                    "friction_score":   friction,
                    "composite_score":  composite["score"],
                    "composite_label":  composite["label"],
                    "protocols":        _parse_json(r["protocol_support"]),
                    "deployment_signal": r["deployment_signal_level"],
                    "integration_notes": r["integration_notes"],
                    "verified_certs":   _parse_json(r["verified_certs"]),
                    "hq_city":          r["hq_city"],
                    "country":          r["country"],
                    "total_funding":    int(r["total_funding"] or 0),
                    "intel_sources":    _parse_json(r["intel_sources"]),
                })

    return {
        "companies": companies,
        "total":     len(companies),
        "sectors":   list(TARGET_SECTORS),
    }


@router.patch("/{company_id}/scores")
def update_scores(company_id: int, data: ScoreUpdate):
    """Update readiness and/or sovereignty scores (1 decimal precision)."""
    fields, values = [], []
    if data.readiness_score is not None:
        if not 0.0 <= data.readiness_score <= 10.0:
            raise HTTPException(status_code=400, detail="readiness_score must be 0.0–10.0")
        fields.append("industrial_readiness_score = %s")
        values.append(round(data.readiness_score, 1))
    if data.sovereignty_score is not None:
        if not 0.0 <= data.sovereignty_score <= 10.0:
            raise HTTPException(status_code=400, detail="sovereignty_score must be 0.0–10.0")
        fields.append("sovereignty_score = %s")
        values.append(round(data.sovereignty_score, 1))
    if not fields:
        raise HTTPException(status_code=400, detail="No scores to update")
    values.append(company_id)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE cvc.companies SET {', '.join(fields)} WHERE id = %s RETURNING id",
                values,
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Company not found")
            conn.commit()
    return {"updated": True}
