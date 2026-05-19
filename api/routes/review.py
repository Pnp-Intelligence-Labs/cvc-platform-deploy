"""
review.py — Source verification endpoints for the CVC Chrome extension.

GET  /review/match?url=...      Check if a URL matches any pending intel_suggestion
POST /review/decision           Record approve/reject/edit + trigger screenshot
GET  /review/evidence/{id}      View stored screenshot PNG
GET  /review/evidence           List recent verification records
"""

import asyncio
import json
import logging
import os
import threading
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from psycopg2.extras import RealDictCursor

from core.db.connection import get_connection
from api.auth import require_auth
from api.routes.auth import _decode_token

router = APIRouter()
logger = logging.getLogger(__name__)

# ── SSE broadcast ─────────────────────────────────────────────────────────────

_subscribers: set[asyncio.Queue] = set()


def _broadcast(payload: dict) -> None:
    """Push a decision event to all connected SSE clients (thread-safe)."""
    for q in list(_subscribers):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


@router.get("/stream")
async def decision_stream(token: str = Query(...)):
    """SSE stream — emits an event whenever a review decision is recorded.
    Token passed as query param because EventSource cannot send headers."""
    try:
        _decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    async def generate():
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        _subscribers.add(q)
        try:
            yield "data: {\"type\":\"connected\"}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            _subscribers.discard(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _normalize_url(raw: str) -> str:
    """Strip scheme, force https-agnostic comparison, remove trailing slash and fragment."""
    try:
        p = urlparse(raw.strip())
        # Normalise: lowercase host, drop fragment, strip trailing slash from path
        path = p.path.rstrip("/") or "/"
        # Rebuild without scheme so http:// and https:// match each other
        return urlunparse(("", p.netloc.lower().lstrip("www."), path, p.params, p.query, ""))
    except Exception:
        return raw.strip()


# ── Match ─────────────────────────────────────────────────────────────────────

@router.get("/match")
async def match_url(url: str, user=Depends(require_auth)):
    """
    Check if the given URL matches any pending intel_suggestion.
    Returns suggestion context for the extension toolbar, or 404 if no match.
    """
    norm = _normalize_url(url)

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # First try exact match (fast path)
            cur.execute("""
                SELECT
                    s.id            AS suggestion_id,
                    s.suggestion_type,
                    s.suggested_data,
                    s.confidence,
                    s.reasoning,
                    c.id            AS company_id,
                    c.name          AS company_name
                FROM cvc.intel_suggestions s
                JOIN cvc.companies c ON c.id = s.company_id
                WHERE s.status = 'pending'
                  AND (
                      s.suggested_data->>'url'        = %s
                   OR s.suggested_data->>'source_url' = %s
                  )
                ORDER BY s.created_at DESC
                LIMIT 1
            """, (url, url))
            row = cur.fetchone()

            # Fallback: normalized comparison (handles http/https, trailing slash, www. prefix)
            if not row:
                cur.execute("""
                    SELECT
                        s.id            AS suggestion_id,
                        s.suggestion_type,
                        s.suggested_data,
                        s.confidence,
                        s.reasoning,
                        c.id            AS company_id,
                        c.name          AS company_name
                    FROM cvc.intel_suggestions s
                    JOIN cvc.companies c ON c.id = s.company_id
                    WHERE s.status = 'pending'
                      AND (
                          s.suggested_data->>'url'        IS NOT NULL
                       OR s.suggested_data->>'source_url' IS NOT NULL
                      )
                    ORDER BY s.created_at DESC
                    LIMIT 200
                """)
                candidates = cur.fetchall()
                for candidate in candidates:
                    d = candidate["suggested_data"] or {}
                    stored = d.get("url") or d.get("source_url") or ""
                    if _normalize_url(stored) == norm:
                        row = candidate
                        logger.info(f"URL matched via normalization: {url!r} → {stored!r}")
                        break

    if not row:
        logger.info(f"No pending review match for: {url!r} (normalized: {norm!r})")
        raise HTTPException(status_code=404, detail="No pending review for this URL")

    d = row["suggested_data"] or {}
    # Build a human-readable title for the toolbar regardless of suggestion type
    if row["suggestion_type"] == "new_funding_round":
        amount = f"${d['amount_usd']:,}" if d.get("amount_usd") else "undisclosed"
        title   = f"{d.get('round_type', 'Round')} — {amount}"
        snippet = f"Investors: {', '.join(d.get('investors') or []) or 'unknown'}"
    else:
        title   = d.get("title", "")
        snippet = d.get("snippet", "")

    return {
        "suggestion_id":   row["suggestion_id"],
        "suggestion_type": row["suggestion_type"],
        "company_id":      row["company_id"],
        "company_name":    row["company_name"],
        "title":           title,
        "snippet":         snippet,
        "confidence":      row["confidence"],
        "reasoning":       row["reasoning"],
    }


# ── Decision ──────────────────────────────────────────────────────────────────

class DecisionRequest(BaseModel):
    suggestion_id: int
    decision:      str  # 'approved' | 'rejected' | 'edited'
    url:           str
    edit_notes:    Optional[str] = None


@router.post("/decision")
async def record_decision(req: DecisionRequest, user=Depends(require_auth)):
    """
    Record a verification decision. Approved decisions trigger an async
    Playwright screenshot stored in verification_evidence.
    """
    if req.decision not in ("approved", "rejected", "edited"):
        raise HTTPException(status_code=400, detail="decision must be approved, rejected, or edited")

    username = user.get("username", "nate") if isinstance(user, dict) else str(user)

    # Fetch the suggestion to get company_id and type
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT company_id, suggestion_type, suggested_data FROM cvc.intel_suggestions WHERE id = %s",
                (req.suggestion_id,)
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    company_id = row["company_id"]

    # Update intel_suggestion status
    new_status = "accepted" if req.decision == "approved" else (
                 "rejected" if req.decision == "rejected" else "pending")

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if req.decision == "approved":
                suggested_data  = row["suggested_data"] or {}
                suggestion_type = row["suggestion_type"]

                if suggestion_type == "new_funding_round":
                    cur.execute("""
                        INSERT INTO cvc.funding_rounds
                            (company_id, round_type, amount_usd, announced_date,
                             investors, source, approximate, valuation_usd)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        company_id,
                        suggested_data.get("round_type"),
                        suggested_data.get("amount_usd"),
                        suggested_data.get("announced_date"),
                        suggested_data.get("investors") or [],
                        suggested_data.get("source_url"),
                        bool(suggested_data.get("approximate")),
                        suggested_data.get("valuation_usd"),
                    ))
                else:
                    # case_study or other — append to companies.case_studies
                    cur.execute("""
                        UPDATE cvc.companies
                        SET case_studies = COALESCE(case_studies, '[]'::jsonb) || %s::jsonb
                        WHERE id = %s
                    """, (json.dumps([suggested_data]), company_id))

            cur.execute(
                "UPDATE cvc.intel_suggestions SET status = %s WHERE id = %s",
                (new_status, req.suggestion_id)
            )

            # Activity log entry
            suggestion_type = row["suggestion_type"]
            suggested_data  = row["suggested_data"] or {}
            if req.decision == "approved":
                if suggestion_type == "new_funding_round":
                    amount = f"${suggested_data['amount_usd']:,}" if suggested_data.get("amount_usd") else "undisclosed"
                    round_type = suggested_data.get("round_type", "Round")
                    log_field = "funding_round"
                    log_new   = f"{round_type} {amount} (eintel approved by {username})"
                else:
                    log_field = "case_studies"
                    log_new   = f"Approved: {suggested_data.get('title', 'intel suggestion')} (eintel by {username})"
            else:
                log_field = f"intel_suggestion_{suggestion_type}"
                log_new   = f"{req.decision} by {username}"

            cur.execute("""
                INSERT INTO cvc.company_activity_log
                    (company_id, changed_by, field_name, old_value, new_value, change_source)
                VALUES (%s, %s, %s, NULL, %s, 'eintel')
            """, (company_id, username, log_field, log_new))

            # Create evidence record (screenshot filled in async)
            cur.execute("""
                INSERT INTO cvc.verification_evidence
                    (suggestion_id, company_id, url, decision, reviewed_by, edit_notes)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (req.suggestion_id, company_id, req.url,
                  req.decision, username, req.edit_notes))
            evidence_id = cur.fetchone()["id"]
            conn.commit()

    # Broadcast to all SSE subscribers so the UI removes the row instantly
    _broadcast({"suggestion_id": req.suggestion_id, "decision": req.decision})

    # Fire-and-forget screenshot for approved/rejected (collateral either way)
    threading.Thread(
        target=_take_screenshot,
        args=(evidence_id, req.url),
        daemon=True
    ).start()

    return {
        "ok":          True,
        "evidence_id": evidence_id,
        "decision":    req.decision,
        "message":     "Decision recorded. Screenshot queued." if req.decision != "edited" else "Edit noted.",
    }


def _take_screenshot(evidence_id: int, url: str):
    """Blocking Playwright screenshot — runs in a background thread."""
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 900})

            # Block unnecessary resources to speed up screenshot
            page.route("**/*.{woff,woff2,ttf,otf}", lambda r: r.abort())

            try:
                page.goto(url, wait_until="domcontentloaded", timeout=20000)
                page.wait_for_timeout(1500)  # let lazy content settle
                png_bytes = page.screenshot(full_page=False, type="png")
            except Exception as e:
                logger.warning(f"Screenshot navigation failed for {url}: {e}")
                browser.close()
                _mark_screenshot_error(evidence_id, str(e))
                return

            browser.close()

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE cvc.verification_evidence
                    SET screenshot = %s, screenshot_taken_at = NOW()
                    WHERE id = %s
                """, (png_bytes, evidence_id))
                conn.commit()

        logger.info(f"Screenshot stored for evidence #{evidence_id} ({len(png_bytes)//1024}KB)")

    except ImportError:
        _mark_screenshot_error(evidence_id, "Playwright not installed")
    except Exception as e:
        logger.error(f"Screenshot failed for evidence #{evidence_id}: {e}")
        _mark_screenshot_error(evidence_id, str(e))


def _mark_screenshot_error(evidence_id: int, error: str):
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE cvc.verification_evidence SET screenshot_error = %s WHERE id = %s",
                    (error, evidence_id)
                )
                conn.commit()
    except Exception:
        pass


# ── Evidence viewer ───────────────────────────────────────────────────────────

@router.get("/evidence")
async def list_evidence(limit: int = 50, user=Depends(require_auth)):
    """List recent verification decisions."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    e.id, e.suggestion_id, e.company_id, e.url, e.decision,
                    e.reviewed_by, e.reviewed_at, e.edit_notes,
                    e.screenshot_taken_at, e.screenshot_error,
                    e.screenshot IS NOT NULL AS has_screenshot,
                    c.name AS company_name
                FROM cvc.verification_evidence e
                LEFT JOIN cvc.companies c ON c.id = e.company_id
                ORDER BY e.reviewed_at DESC
                LIMIT %s
            """, (limit,))
            return cur.fetchall()


@router.get("/evidence/{evidence_id}/screenshot")
async def get_screenshot(evidence_id: int, user=Depends(require_auth)):
    """Return the PNG screenshot for a verification evidence record."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT screenshot FROM cvc.verification_evidence WHERE id = %s",
                (evidence_id,)
            )
            row = cur.fetchone()

    if not row or not row["screenshot"]:
        raise HTTPException(status_code=404, detail="Screenshot not found")

    return Response(content=bytes(row["screenshot"]), media_type="image/png")
