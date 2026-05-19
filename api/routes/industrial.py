from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from api.auth import require_auth
from core.db.connection import get_connection
import json

router = APIRouter(dependencies=[Depends(require_auth)])


class ScoreUpdate(BaseModel):
    readiness_score: Optional[float] = None
    sovereignty_score: Optional[float] = None

# Protocol to weight mapping for friction score
PROTOCOL_WEIGHTS = {
    # High friction reduction
    'OPC-UA': -3.0,
    'MQTT': -3.0,
    # Medium friction reduction
    'Siemens S7': -2.0,
    'Rockwell ControlLogix': -2.0,
    # Lower friction reduction
    'ROS2': -1.5,
    'VDA 5050': -1.5,
    'Public API': -1.5,
    'SDK': -1.5,
    # Legacy protocols
    'Modbus': -1.0,
    'Modbus TCP': -1.0,
    'Profinet': -1.0,
    'EtherNet/IP': -1.0,
    'EtherCAT': -1.0,
    'CANopen': -1.0,
}

TARGET_SECTORS = ("Robotics", "Manufacturing", "Supply Chain", "Industrial Automation", "Physical AI")


def calc_friction(protocol_support) -> float | None:
    """
    Calculate weighted friction score from protocol_support.
    Start at 10.0, apply deductions based on protocol weights.
    Floor at 0.0. Returns None if no protocol data (Unverified).
    """
    if not protocol_support:
        return None  # Unverified — no protocol data

    try:
        protocols = protocol_support if isinstance(protocol_support, list) else json.loads(protocol_support)
        if not protocols:
            return None

        score = 10.0
        for proto in protocols:
            for known_proto, weight in PROTOCOL_WEIGHTS.items():
                if known_proto in proto:
                    score += weight  # weight is negative
                    break

        return round(max(0.0, score), 1)
    except Exception:
        return None


def calc_composite_score(readiness: float, sovereignty: float | None, friction: float | None) -> dict:
    """
    Calculate composite score and label.
    composite = (readiness * 0.4) + (sovereignty * 0.3) + ((10 - friction) * 0.3)
    If sovereignty is None, weight shifts to readiness + friction.
    If friction is None (Unverified), weight shifts to readiness + sovereignty.
    If both are None, use readiness only.
    Returns dict with 'score' and 'label'.
    """
    has_sov = sovereignty is not None
    has_fri = friction is not None

    if has_sov and has_fri:
        score = (readiness * 0.4) + (sovereignty * 0.3) + ((10 - friction) * 0.3)
    elif has_sov:
        score = (readiness * 0.6) + (sovereignty * 0.4)
    elif has_fri:
        score = (readiness * 0.6) + ((10 - friction) * 0.4)
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


def sovereignty_tier(score) -> str:
    if score is None:
        return "unknown"
    if score >= 8:
        return "green"
    if score >= 4:
        return "yellow"
    return "red"


@router.get("/matrix")
def get_industrial_matrix(sector: str = None):
    """
    Returns industrial companies with readiness, friction, funding, and sovereignty
    for the Pilot-to-Production scatter matrix.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            extra_filter = ""
            params = [list(TARGET_SECTORS)]
            if sector:
                extra_filter = " AND c.sector = %s"
                params.append(sector)

            cur.execute(f"""
                SELECT
                    c.id,
                    c.name,
                    c.sector,
                    c.stage,
                    c.industrial_readiness_score,
                    c.sovereignty_score,
                    c.protocol_support,
                    c.deployment_signal_level,
                    c.integration_notes,
                    c.verified_certs,
                    c.hq_city,
                    c.country,
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
                protocols = []
                if r["protocol_support"]:
                    try:
                        protocols = r["protocol_support"] if isinstance(r["protocol_support"], list) else json.loads(r["protocol_support"])
                    except Exception:
                        pass
                certs = []
                if r["verified_certs"]:
                    try:
                        certs = r["verified_certs"] if isinstance(r["verified_certs"], list) else json.loads(r["verified_certs"])
                    except Exception:
                        pass
                sources = []
                if r["intel_sources"]:
                    try:
                        sources = r["intel_sources"] if isinstance(r["intel_sources"], list) else json.loads(r["intel_sources"])
                    except Exception:
                        pass

                readiness = float(r["industrial_readiness_score"])
                sovereignty = float(r["sovereignty_score"]) if r["sovereignty_score"] is not None else None
                friction = calc_friction(r["protocol_support"])
                composite = calc_composite_score(readiness, sovereignty, friction)

                companies.append({
                    "id": r["id"],
                    "name": r["name"],
                    "sector": r["sector"],
                    "stage": r["stage"],
                    "readiness_score": readiness,
                    "sovereignty_score": sovereignty,
                    "sovereignty_tier": sovereignty_tier(sovereignty),
                    "friction_score": friction,
                    "composite_score": composite["score"],
                    "composite_label": composite["label"],
                    "protocols": protocols,
                    "deployment_signal": r["deployment_signal_level"],
                    "integration_notes": r["integration_notes"],
                    "verified_certs": certs,
                    "hq_city": r["hq_city"],
                    "country": r["country"],
                    "total_funding": int(r["total_funding"] or 0),
                    "intel_sources": sources,
                })

            return {
                "companies": companies,
                "total": len(companies),
                "sectors": list(TARGET_SECTORS),
            }


@router.patch("/{company_id}/scores")
def update_scores(company_id: int, data: ScoreUpdate):
    """Update readiness and/or sovereignty scores for a company (1 decimal precision)."""
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
