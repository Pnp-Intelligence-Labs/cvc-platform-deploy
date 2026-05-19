"""
api/routes/meeting_notes.py — Quick meeting note capture for ventures/PSM/sales.

Prefix /notes set in main.py.

Endpoints:
    POST  /notes                    — create note (creates company stub if company_id absent)
    GET   /notes?company_id=N       — notes for a company (personal_note stripped for other users)
    GET   /notes/mine               — current user's own notes (personal_note included)
    POST  /notes/{id}/transcript    — upload transcript file (multipart)
"""

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import date as DateType
import os
from psycopg2.extras import RealDictCursor

from core.db.connection import get_connection
from api.routes.auth import require_jwt, UserInfo

router = APIRouter()

_TRANSCRIPT_DIR = os.path.join(
    os.path.dirname(__file__), '..', 'static', 'transcripts'
)


class MeetingNoteIn(BaseModel):
    context_type:       str             = 'ventures'
    company_id:         Optional[int]   = None
    company_name:       str             = ''
    company_url:        Optional[str]   = None
    met_at:             DateType
    rating_founder:     Optional[int]   = None
    note_founder:       Optional[str]   = None
    rating_market:      Optional[int]   = None
    note_market:        Optional[str]   = None
    rating_tech:        Optional[int]   = None
    note_tech:          Optional[str]   = None
    rating_business:    Optional[int]   = None
    note_business:      Optional[str]   = None
    rating_deployment:  Optional[int]   = None
    note_deployment:    Optional[str]   = None
    personal_note:      Optional[str]   = None
    transcript_text:    Optional[str]   = None


def _serialize(row: dict) -> dict:
    out = dict(row)
    if out.get('submitted_at'):
        out['submitted_at'] = out['submitted_at'].isoformat()
    if out.get('met_at'):
        out['met_at'] = out['met_at'].isoformat()
    return out


@router.post('')
def create_note(body: MeetingNoteIn, user: UserInfo = Depends(require_jwt)):
    if body.context_type not in ('ventures', 'psm', 'sales'):
        raise HTTPException(400, 'Invalid context_type')

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            company_id = body.company_id

            # Create minimal stub if no existing company linked
            if company_id is None and body.company_name.strip():
                cur.execute("""
                    INSERT INTO cvc.companies (name, website, enrichment_status, enrichment_source, created_at, updated_at)
                    VALUES (%s, %s, 'pending', 'meeting_note', NOW(), NOW())
                    RETURNING id
                """, (body.company_name.strip(), body.company_url or None))
                company_id = cur.fetchone()['id']

            cur.execute("""
                INSERT INTO cvc.meeting_notes (
                    submitted_by, context_type, company_id, company_name, company_url, met_at,
                    rating_founder, note_founder,
                    rating_market,  note_market,
                    rating_tech,    note_tech,
                    rating_business, note_business,
                    rating_deployment, note_deployment,
                    personal_note, transcript_text
                ) VALUES (
                    %s,%s,%s,%s,%s,%s,
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
                )
                RETURNING id
            """, (
                user.username, body.context_type, company_id,
                body.company_name.strip(), body.company_url, body.met_at,
                body.rating_founder,    body.note_founder,
                body.rating_market,     body.note_market,
                body.rating_tech,       body.note_tech,
                body.rating_business,   body.note_business,
                body.rating_deployment, body.note_deployment,
                body.personal_note, body.transcript_text,
            ))
            note_id = cur.fetchone()['id']
            conn.commit()

    return {'id': note_id, 'company_id': company_id}


@router.get('/mine')
def get_my_notes(user: UserInfo = Depends(require_jwt)):
    """Current user's own notes — includes personal_note."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, submitted_by, submitted_at, context_type,
                       company_id, company_name, company_url, met_at,
                       rating_founder, note_founder, rating_market, note_market,
                       rating_tech, note_tech, rating_business, note_business,
                       rating_deployment, note_deployment,
                       personal_note, transcript_text
                FROM cvc.meeting_notes
                WHERE submitted_by = %s
                ORDER BY met_at DESC, submitted_at DESC
                LIMIT 50
            """, (user.username,))
            return {'notes': [_serialize(dict(r)) for r in cur.fetchall()]}


@router.get('')
def get_notes(
    company_id: Optional[int] = None,
    user: UserInfo = Depends(require_jwt),
):
    """Notes for a company. personal_note is stripped unless current user submitted it."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if company_id:
                cur.execute("""
                    SELECT id, submitted_by, submitted_at, context_type,
                           company_id, company_name, company_url, met_at,
                           rating_founder, note_founder, rating_market, note_market,
                           rating_tech, note_tech, rating_business, note_business,
                           rating_deployment, note_deployment,
                           CASE WHEN submitted_by = %s THEN personal_note ELSE NULL END AS personal_note,
                           transcript_text
                    FROM cvc.meeting_notes
                    WHERE company_id = %s
                    ORDER BY met_at DESC, submitted_at DESC
                """, (user.username, company_id))
            else:
                # No filter: return current user's own notes
                cur.execute("""
                    SELECT id, submitted_by, submitted_at, context_type,
                           company_id, company_name, company_url, met_at,
                           rating_founder, note_founder, rating_market, note_market,
                           rating_tech, note_tech, rating_business, note_business,
                           rating_deployment, note_deployment,
                           personal_note, transcript_text
                    FROM cvc.meeting_notes
                    WHERE submitted_by = %s
                    ORDER BY met_at DESC, submitted_at DESC
                    LIMIT 50
                """, (user.username,))
            return {'notes': [_serialize(dict(r)) for r in cur.fetchall()]}


@router.post('/{note_id}/transcript')
async def upload_transcript(
    note_id: int,
    file: UploadFile = File(...),
    user: UserInfo = Depends(require_jwt),
):
    """Upload a transcript file (PDF or TXT). Saves to static/transcripts/{note_id}/."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT submitted_by FROM cvc.meeting_notes WHERE id = %s", (note_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, 'Note not found')
            if row['submitted_by'] != user.username:
                raise HTTPException(403, 'Not your note')

    os.makedirs(os.path.join(_TRANSCRIPT_DIR, str(note_id)), exist_ok=True)
    filename = file.filename or 'transcript.bin'
    save_path = os.path.join(_TRANSCRIPT_DIR, str(note_id), filename)
    contents = await file.read()
    with open(save_path, 'wb') as f:
        f.write(contents)

    rel_path = f'transcripts/{note_id}/{filename}'
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.meeting_notes SET transcript_path = %s WHERE id = %s",
                (rel_path, note_id)
            )
            conn.commit()

    return {'path': rel_path}
