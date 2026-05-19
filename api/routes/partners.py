from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query, Depends
from typing import List, Optional
from core.db.connection import get_connection
from psycopg2.extras import RealDictCursor, Json
from api.routes.auth import require_jwt, UserInfo
import io
import json
import threading
import re
from datetime import datetime, date


# Roles that can see all visibility levels (no filtering applied)
_FULL_ACCESS_ROLES = {"GP", "Principal", "Director"}


def _visibility_clause(user: UserInfo, alias: str = "") -> tuple[str, list]:
    """Return (WHERE fragment, params) to filter rows by visibility for a given user.

    GP / Principal / Director — no filter (see everything).
    Ventures — team rows only.
    PSM — team rows + psm_only rows where assigned_psm matches their username.

    Pass alias="c" for queries where the table is aliased (e.g. c.visibility).
    """
    col = f"{alias}." if alias else ""
    if user.role in _FULL_ACCESS_ROLES:
        return "", []
    if user.role == "Ventures":
        return f"AND {col}visibility = 'team'", []
    # PSM (and any unknown future role) — most restrictive
    return f"AND ({col}visibility = 'team' OR ({col}visibility = 'psm_only' AND {col}assigned_psm = %s))", [user.username]


def _log_access(user: UserInfo, partner_id: int, action: str) -> None:
    """Fire-and-forget access log write."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO cvc.partner_terminal_access_log (username, role, partner_id, action) VALUES (%s, %s, %s, %s)",
                    (user.username, user.role, partner_id, action),
                )
                conn.commit()
    except Exception:
        pass

router = APIRouter()


def _parse_date_from_filename(filename: str, fallback_year: int | None = None) -> date | None:
    """Try to extract a date from a document filename.
    Handles patterns like 'Sept 16', 'Feb 17', 'March 4 2025', 'Oct 28', '2025-09-16'.
    Uses fallback_year (e.g. current year) when no year is found in the filename.
    """
    year = fallback_year or datetime.now().year
    name = filename.replace('_', ' ').replace('-', ' ')

    # Try ISO date first: 2025 09 16
    m = re.search(r'(20\d{2})\s+(\d{1,2})\s+(\d{1,2})', name)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass

    # Month name (full or abbreviated) + day [+ optional year]
    patterns = [
        r'(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|'
        r'Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|'
        r'Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:\s+(20\d{2}))?',
    ]
    for pat in patterns:
        m = re.search(pat, name, re.IGNORECASE)
        if m:
            month_str, day_str = m.group(1), m.group(2)
            yr = int(m.group(3)) if m.group(3) else year
            for fmt in ('%b %d %Y', '%B %d %Y'):
                try:
                    abbrev = month_str[:3].capitalize()
                    return datetime.strptime(f'{abbrev} {day_str} {yr}', '%b %d %Y').date()
                except ValueError:
                    pass
    return None


def _extract_pdf_text(content: bytes) -> str | None:
    """Extract text from PDF bytes using pdfplumber. Returns None on failure."""
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            pages = [p.extract_text() or "" for p in pdf.pages]
        text = "\n\n".join(p for p in pages if p.strip())
        return text or None
    except Exception:
        return None


_INTEL_PROMPT = """You are analyzing a partner document for a venture capital firm (Plug and Play / CVC).
Extract key information and return ONLY valid JSON — no commentary, no markdown fences.

Document: {filename}

{body}

Return this exact JSON structure:
{{
  "summary": "2-3 sentence summary of what was discussed or presented",
  "action_items": ["specific follow-up or task — be concrete, start with a verb"],
  "people_mentioned": [{{"name": "Full Name", "title": "Title or Role if known, else null"}}],
  "startup_mentions": ["names of any startups or portfolio companies mentioned"],
  "key_themes": ["3-5 main topics or themes"],
  "next_steps": ["scheduled next actions, meetings, or commitments"]
}}"""


def _save_intel(doc_id: int, raw_json: str) -> None:
    clean = raw_json.strip()
    if clean.startswith("```"):
        parts = clean.split("```")
        clean = parts[1].lstrip("json").strip() if len(parts) > 1 else clean
    intel = json.loads(clean)
    summary = intel.pop("summary", "")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.partner_documents SET summary=%s, extracted_intel=%s, parsed=TRUE WHERE id=%s",
                (summary, json.dumps(intel), doc_id),
            )
            conn.commit()


def _analyze_document_bg(doc_id: int, raw_text: str, filename: str, title: str | None = None) -> None:
    """Extract structured intel from document text via LLM. Runs in background thread."""
    try:
        from llm.openrouter import call as llm_call
        excerpt = raw_text[:12000] if len(raw_text) > 12000 else raw_text
        display_name = title or filename
        prompt = _INTEL_PROMPT.format(filename=display_name, body=f"Text:\n{excerpt}")
        result = llm_call(prompt, model="qwen/qwen3-8b", temperature=0.1, max_tokens=1024, activity="Partner Doc Intel")
        _save_intel(doc_id, result)
    except Exception as e:
        print(f"[partner doc intel] doc {doc_id} failed: {e}")


def _analyze_document_vision_bg(doc_id: int, pdf_bytes: bytes, filename: str, title: str | None = None) -> None:
    """Analyze image-based PDF using a vision LLM. Runs in background thread."""
    try:
        import fitz
        import base64
        import requests as _req
        from cvc_config import OPENROUTER_API_KEY, OPENROUTER_URL

        # Render up to 6 pages as PNG images
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        images_b64 = []
        for i in range(min(6, len(doc))):
            pix = doc[i].get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
            images_b64.append(base64.b64encode(pix.tobytes("png")).decode())
        doc.close()

        display_name = title or filename
        content_parts: list = [
            {"type": "text", "text": _INTEL_PROMPT.format(
                filename=display_name,
                body="(document is provided as page images below)",
            )}
        ]
        for b64 in images_b64:
            content_parts.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})

        resp = _req.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/natelouie11-tech",
                "X-Title": "CVC Partner Doc Intel",
            },
            json={
                "model": "google/gemini-2.0-flash-001",
                "messages": [{"role": "user", "content": content_parts}],
                "temperature": 0.1,
                "max_tokens": 1024,
            },
            timeout=120,
        )
        resp.raise_for_status()
        result_text = resp.json()["choices"][0]["message"]["content"]
        _save_intel(doc_id, result_text)
        print(f"[partner doc vision] doc {doc_id} analyzed via vision LLM")
    except Exception as e:
        print(f"[partner doc vision] doc {doc_id} failed: {e}")

@router.get("/")
def list_partners(
    q: Optional[str] = Query(None),
    industry: Optional[str] = Query(None),
    sector: Optional[str] = Query(None),
    user: UserInfo = Depends(require_jwt),
):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            query = """
                SELECT id, name, industry, contact_name, contact_email,
                       COALESCE(challenge_areas, '{}') AS challenge_areas,
                       COALESCE(sectors_of_interest, '{}') AS sectors_of_interest,
                       COALESCE(environments, '{}') AS environments,
                       notes, current_protocols, cloud_platform, hardware_vendors,
                       factory_regions, scaling_speed,
                       COALESCE(tech_stack, '{}'::jsonb) AS tech_stack,
                       salesforce_url, playbook_url, monday_item_id,
                       membership_level, is_legacy,
                       created_at, updated_at
                FROM cvc.partners
                WHERE 1=1
            """
            params = []
            # PSM: only show partners assigned to them
            if user.role in ("PSM", "Senior PSM"):
                if user.assigned_partner_ids:
                    query += f" AND id = ANY(%s)"
                    params.append(user.assigned_partner_ids)
                else:
                    # No assignments yet — return empty list
                    return {"partners": [], "total": 0}
            if q:
                query += " AND (name ILIKE %s OR contact_name ILIKE %s)"
                params.extend([f"%{q}%", f"%{q}%"])
            if industry:
                query += " AND industry = %s"
                params.append(industry)
            if sector:
                query += " AND %s = ANY(sectors_of_interest)"
                params.append(sector)
            query += " ORDER BY name"
            cur.execute(query, params)
            rows = cur.fetchall()
            return {"partners": rows, "total": len(rows)}

@router.post("/")
def create_partner(partner: dict):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.partners (
                    name, industry, contact_name, contact_email,
                    challenge_areas, sectors_of_interest, environments, notes,
                    current_protocols, cloud_platform, hardware_vendors,
                    factory_regions, scaling_speed,
                    salesforce_url, playbook_url, monday_item_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                partner.get("name"), partner.get("industry"), 
                partner.get("contact_name"), partner.get("contact_email"),
                partner.get("challenge_areas", []), partner.get("sectors_of_interest", []),
                partner.get("environments", []), partner.get("notes"),
                partner.get("current_protocols", []), partner.get("cloud_platform"),
                partner.get("hardware_vendors", []), partner.get("factory_regions", []),
                partner.get("scaling_speed"),
                partner.get("salesforce_url"), partner.get("playbook_url"),
                partner.get("monday_item_id")
            ))
            new_partner = cur.fetchone()
            conn.commit()
            return new_partner

@router.get("/psm-roster")
def get_psm_roster(user: UserInfo = Depends(require_jwt)):
    """Return all PSM/Senior PSM users with their assigned partner IDs. Available to any auth'd user."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, username, full_name, role, assigned_partner_ids
                FROM cvc.users
                WHERE role IN ('PSM', 'Senior PSM') AND is_active = TRUE
                ORDER BY
                    CASE role WHEN 'Senior PSM' THEN 0 ELSE 1 END,
                    full_name
            """)
            return {"psms": [dict(r) for r in cur.fetchall()]}


@router.get("/issues/all")
def get_all_issues(severity: Optional[str] = Query(None), resolved: bool = Query(False)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            query = """
                SELECT i.*, p.name as partner_name
                FROM cvc.partner_issues i
                JOIN cvc.partners p ON i.partner_id = p.id
                WHERE i.resolved = %s
            """
            params: list = [resolved]
            if severity:
                query += " AND i.severity = %s"
                params.append(severity)
            query += " ORDER BY CASE i.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, i.due_date NULLS LAST, i.created_at DESC"
            cur.execute(query, params)
            rows = cur.fetchall()
            return {"issues": rows}

@router.get("/documents/search")
def search_documents(q: str = Query(...)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT d.*, p.name as partner_name
                FROM cvc.partner_documents d
                JOIN cvc.partners p ON d.partner_id = p.id
                WHERE d.raw_text ILIKE %s
                ORDER BY d.uploaded_at DESC
            """, (f"%{q}%",))
            return cur.fetchall()

@router.get("/{id}")
def get_partner(id: int, user: UserInfo = Depends(require_jwt)):
    # PSM can only view their assigned partners
    if user.role in ("PSM", "Senior PSM") and id not in (user.assigned_partner_ids or []):
        raise HTTPException(status_code=403, detail="Not authorized for this partner")
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, name, industry, contact_name, contact_email,
                       challenge_areas, sectors_of_interest, environments, notes,
                       current_protocols, cloud_platform, hardware_vendors,
                       factory_regions, scaling_speed,
                       COALESCE(tech_stack, '{}'::jsonb) AS tech_stack,
                       salesforce_url, playbook_url, monday_item_id,
                       membership_level, is_legacy,
                       created_at, updated_at
                FROM cvc.partners WHERE id = %s
            """, (id,))
            partner = cur.fetchone()
            if not partner:
                raise HTTPException(status_code=404, detail="Partner not found")
            
            # Get matches
            cur.execute("""
                SELECT m.*, c.name as company_name, c.one_liner
                FROM cvc.partner_matches m
                JOIN cvc.companies c ON m.company_id = c.id
                WHERE m.partner_id = %s
                ORDER BY m.match_score DESC
            """, (id,))
            partner["matches"] = cur.fetchall()
            
            # Last contact summary — one-liner shown on main profile (all roles)
            cur.execute("""
                SELECT note_type, created_by, created_at,
                       LEFT(body, 120) AS summary
                FROM cvc.partner_notes
                WHERE partner_id = %s AND is_service_note = true
                ORDER BY created_at DESC
                LIMIT 1
            """, (id,))
            last_note = cur.fetchone()
            partner["last_contact"] = dict(last_note) if last_note else None
            partner["partner_notes"] = []  # legacy field — notes now served via /service-notes

            for col in ('challenge_areas', 'sectors_of_interest', 'environments'):
                if partner.get(col) is None:
                    partner[col] = []

            return partner

@router.patch("/{id}")
def update_partner(id: int, partner: dict):
    allowed_fields = [
        "name", "industry", "contact_name", "contact_email",
        "challenge_areas", "sectors_of_interest", "environments", "notes",
        "current_protocols", "cloud_platform", "hardware_vendors",
        "factory_regions", "scaling_speed", "tech_stack",
        "salesforce_url", "playbook_url", "monday_item_id",
        "membership_level", "partner_brief", "is_legacy",
    ]
    
    JSONB_FIELDS = {'tech_stack'}
    updates = []
    values = []
    for field in allowed_fields:
        if field in partner:
            updates.append(f"{field} = %s")
            val = partner[field]
            if field in JSONB_FIELDS and isinstance(val, dict):
                val = Json(val)
            values.append(val)
    
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    values.append(id)
    
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                UPDATE cvc.partners 
                SET {", ".join(updates)}, updated_at = NOW()
                WHERE id = %s
                RETURNING *
            """, values)
            conn.commit()
            result = cur.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Partner not found")
            return result

@router.delete("/{id}")
def delete_partner(id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.partners WHERE id = %s", (id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Partner not found")
            conn.commit()
            return {"deleted": True}

# ── Problem Board ──────────────────────────────────────────────────────────────

@router.get("/{id}/problems")
def list_problems(id: int, user: UserInfo = Depends(require_jwt)):
    vis_clause, vis_params = _visibility_clause(user)
    _log_access(user, id, "view_problems")
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT * FROM cvc.partner_problems
                WHERE partner_id = %s {vis_clause}
                ORDER BY created_at ASC
            """, [id] + vis_params)
            return {"problems": cur.fetchall()}

@router.post("/{id}/problems")
def create_problem(id: int, body: dict, user: UserInfo = Depends(require_jwt)):
    vis, psm = ("psm_only", user.username) if user.role == "PSM" else ("team", None)
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.partner_problems
                    (partner_id, title, description, kpi, confidence_score, status, source, visibility, assigned_psm)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                id,
                body.get("title", "").strip(),
                body.get("description") or None,
                body.get("kpi") or None,
                body.get("confidence_score", 50),
                body.get("status", "identified"),
                body.get("source") or None,
                vis, psm,
            ))
            conn.commit()
            return cur.fetchone()

@router.patch("/{id}/problems/{pid}")
def update_problem(id: int, pid: int, body: dict):
    allowed = ["title", "description", "kpi", "confidence_score", "status", "source"]
    updates, values = [], []
    for field in allowed:
        if field in body:
            updates.append(f"{field} = %s")
            values.append(body[field])
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    values.extend([pid, id])
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                UPDATE cvc.partner_problems
                SET {", ".join(updates)}, updated_at = NOW()
                WHERE id = %s AND partner_id = %s
                RETURNING *
            """, values)
            conn.commit()
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Problem not found")
            return row

@router.delete("/{id}/problems/{pid}")
def delete_problem(id: int, pid: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.partner_problems WHERE id = %s AND partner_id = %s", (pid, id))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Problem not found")
            conn.commit()
            return {"deleted": True}

@router.get("/{id}/contacts")
def get_contacts(id: int):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM cvc.partner_contacts
                WHERE partner_id = %s
                ORDER BY is_primary DESC, name
            """, (id,))
            return {"contacts": cur.fetchall()}

@router.post("/{id}/contacts")
def create_contact(id: int, contact: dict):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.partner_contacts (partner_id, name, title, email, phone, is_primary)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (id, contact.get("name"), contact.get("title"), 
                  contact.get("email"), contact.get("phone"), contact.get("is_primary", False)))
            conn.commit()
            return cur.fetchone()

@router.patch("/{id}/contacts/{contact_id}")
def update_contact(id: int, contact_id: int, contact: dict):
    allowed = ["name", "title", "email", "phone", "is_primary"]
    updates = [(f, contact[f]) for f in allowed if f in contact]
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{f} = %s" for f, _ in updates)
    values = [v for _, v in updates] + [contact_id, id]
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # If marking as primary, demote all others first
            if contact.get("is_primary"):
                cur.execute("""
                    UPDATE cvc.partner_contacts SET is_primary = false
                    WHERE partner_id = %s AND id != %s
                """, (id, contact_id))
            cur.execute(f"""
                UPDATE cvc.partner_contacts
                SET {set_clause}
                WHERE id = %s AND partner_id = %s
                RETURNING *
            """, values)
            conn.commit()
            result = cur.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Contact not found")
            return result

@router.delete("/{id}/contacts/{contact_id}")
def delete_contact(id: int, contact_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.partner_contacts WHERE id = %s AND partner_id = %s", 
                       (contact_id, id))
            conn.commit()
            return {"deleted": True}

@router.get("/{id}/documents")
def get_documents(id: int, user: UserInfo = Depends(require_jwt)):
    vis_clause, vis_params = _visibility_clause(user)
    _log_access(user, id, "view_documents")
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT id, filename, COALESCE(title, filename) AS title, file_type, source_label,
                       parsed, uploaded_at, document_date, summary, extracted_intel,
                       length(coalesce(raw_text, '')) AS text_length,
                       file_data IS NOT NULL AS has_file,
                       visibility, assigned_psm
                FROM cvc.partner_documents
                WHERE partner_id = %s {vis_clause}
                ORDER BY COALESCE(document_date, uploaded_at::date) DESC, uploaded_at DESC
            """, [id] + vis_params)
            return {"documents": cur.fetchall()}

@router.post("/{id}/documents")
def upload_document(id: int, file: UploadFile = File(...), source_label: str = Form(""), user: UserInfo = Depends(require_jwt)):
    content = file.file.read()

    # Extract text from PDFs immediately on upload
    raw_text = None
    parsed = False
    fname = file.filename or ""
    if file.content_type == "application/pdf" or fname.lower().endswith(".pdf"):
        raw_text = _extract_pdf_text(content)
        parsed = raw_text is not None

    doc_date = _parse_date_from_filename(fname)

    # Derive a clean display title from the filename (strip extension, underscores → spaces)
    import re as _re
    title = _re.sub(r'\.[a-zA-Z0-9]{2,5}$', '', fname)  # strip extension
    title = _re.sub(r'[_]+', ' ', title).strip()         # underscores → spaces

    vis, psm = ("psm_only", user.username) if user.role == "PSM" else ("team", None)

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.partner_documents
                    (partner_id, filename, title, file_type, file_data, source_label, parsed, raw_text, document_date, visibility, assigned_psm)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, filename, COALESCE(title, filename) AS title, file_type,
                          source_label, parsed, uploaded_at, document_date
            """, (id, fname, title, file.content_type, content, source_label, parsed, raw_text, doc_date, vis, psm))
            conn.commit()
            result = cur.fetchone()

    # Kick off background LLM intel extraction
    if result:
        doc_title = result.get("title") or fname
        is_pdf = fname.lower().endswith(".pdf") or (file.content_type == "application/pdf")
        if raw_text:
            threading.Thread(target=_analyze_document_bg, args=(result["id"], raw_text, fname, doc_title), daemon=True).start()
        elif is_pdf:
            # Image-based PDF — fall back to vision LLM
            threading.Thread(target=_analyze_document_vision_bg, args=(result["id"], content, fname, doc_title), daemon=True).start()

    return result


@router.patch("/{id}/documents/{doc_id}")
def update_document(id: int, doc_id: int, body: dict):
    """Update editable document fields: title and/or document_date."""
    allowed = {"title", "document_date"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update. Allowed fields: title, document_date")
    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [doc_id, id]
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"UPDATE cvc.partner_documents SET {set_clause} WHERE id = %s AND partner_id = %s RETURNING id, title, document_date",
                values,
            )
            row = cur.fetchone()
            conn.commit()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    return dict(row)

@router.post("/{id}/documents/{doc_id}/analyze")
def analyze_document(id: int, doc_id: int):
    """Re-run LLM intel extraction on an already-uploaded document."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, raw_text, filename, title, file_data FROM cvc.partner_documents WHERE id=%s AND partner_id=%s",
                (doc_id, id),
            )
            doc = cur.fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc_title = doc.get("title") or doc["filename"]
    if doc["raw_text"]:
        threading.Thread(target=_analyze_document_bg, args=(doc["id"], doc["raw_text"], doc["filename"], doc_title), daemon=True).start()
    elif doc["file_data"]:
        threading.Thread(target=_analyze_document_vision_bg, args=(doc["id"], bytes(doc["file_data"]), doc["filename"], doc_title), daemon=True).start()
    else:
        raise HTTPException(status_code=400, detail="No content available for this document")
    return {"status": "analyzing", "doc_id": doc_id}

@router.get("/{id}/intel-summary")
def get_intel_summary(id: int):
    """Aggregate document intel across all docs for a partner — action items, people, themes."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT extracted_intel, document_date, COALESCE(title, filename) AS title
                FROM cvc.partner_documents
                WHERE partner_id = %s AND extracted_intel IS NOT NULL
                ORDER BY COALESCE(document_date, uploaded_at::date) DESC
            """, (id,))
            rows = cur.fetchall()

    action_items = []
    people_seen: dict[str, dict] = {}   # name → {name, title}
    theme_counts: dict[str, int] = {}
    startup_mentions: list[str] = []

    for row in rows:
        intel = row["extracted_intel"]
        if not isinstance(intel, dict):
            try:
                intel = json.loads(intel)
            except Exception:
                continue

        doc_label = row["title"] if row.get("title") else (
            row["document_date"].strftime("%b %-d, %Y") if row["document_date"] else "Unknown document"
        )

        # Action items — keep most recent 3 docs worth, max 8 total
        if len(action_items) < 8:
            for item in (intel.get("action_items") or []):
                if item and len(action_items) < 8:
                    action_items.append({"text": item, "source": doc_label})

        # People mentioned — dedupe by lowercase name
        for person in (intel.get("people_mentioned") or []):
            if isinstance(person, dict) and person.get("name"):
                key = person["name"].strip().lower()
                if key not in people_seen:
                    people_seen[key] = {"name": person["name"].strip(), "title": person.get("title")}

        # Themes — count frequency
        for theme in (intel.get("key_themes") or []):
            if theme:
                t = theme.strip().lower()
                theme_counts[t] = theme_counts.get(t, 0) + 1

        # Startups — dedupe
        for s in (intel.get("startup_mentions") or []):
            if s and s not in startup_mentions:
                startup_mentions.append(s)

    # Top themes by frequency, max 6
    top_themes = [t for t, _ in sorted(theme_counts.items(), key=lambda x: -x[1])[:6]]

    # Load dismissed items for this partner
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT dismissed_intel FROM cvc.partners WHERE id=%s", (id,))
            row = cur.fetchone()
    dismissed = row["dismissed_intel"] or {} if row else {}
    dismissed_people  = {n.lower() for n in (dismissed.get("people") or [])}
    dismissed_actions = set(dismissed.get("action_items") or [])
    dismissed_themes  = {t.lower() for t in (dismissed.get("themes") or [])}

    return {
        "action_items":    [a for a in action_items   if a["text"] not in dismissed_actions],
        "people_mentioned":[p for p in people_seen.values() if p["name"].lower() not in dismissed_people],
        "key_themes":      [t for t in top_themes     if t not in dismissed_themes],
        "startup_mentions": startup_mentions[:10],
    }

@router.post("/{id}/intel-summary/dismiss")
def dismiss_intel_item(id: int, payload: dict):
    """Dismiss a person, action item, or theme from the intel summary."""
    kind  = payload.get("type")   # "person" | "action_item" | "theme"
    value = payload.get("value")
    if not kind or not value:
        raise HTTPException(status_code=400, detail="type and value required")

    key_map = {"person": "people", "action_item": "action_items", "theme": "themes"}
    key = key_map.get(kind)
    if not key:
        raise HTTPException(status_code=400, detail="type must be person, action_item, or theme")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.partners
                SET dismissed_intel = jsonb_set(
                    COALESCE(dismissed_intel, '{}'::jsonb),
                    %s,
                    COALESCE(dismissed_intel->%s, '[]'::jsonb) || to_jsonb(%s::text)
                )
                WHERE id = %s
            """, ([key], key, value, id))
            conn.commit()
    return {"dismissed": True}

@router.get("/{id}/documents/{doc_id}/text")
def get_document_text(id: int, doc_id: int):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT raw_text FROM cvc.partner_documents 
                WHERE id = %s AND partner_id = %s
            """, (doc_id, id))
            result = cur.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Document not found")
            return {"text": result["raw_text"]}

@router.get("/{id}/documents/{doc_id}/download")
def download_document(id: int, doc_id: int):
    from fastapi.responses import Response
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT filename, file_type, file_data FROM cvc.partner_documents 
                WHERE id = %s AND partner_id = %s
            """, (doc_id, id))
            result = cur.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Document not found")
            return Response(
                content=result["file_data"],
                media_type=result["file_type"],
                headers={"Content-Disposition": f"attachment; filename={result['filename']}"}
            )

@router.delete("/{id}/documents/{doc_id}")
def delete_document(id: int, doc_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.partner_documents WHERE id = %s AND partner_id = %s", 
                       (doc_id, id))
            conn.commit()
            return {"deleted": True}

_CONTRACT_SERVICES = [
    "Private Dealflow Sessions", "Trend Report", "Custom Trend Report",
    "Immersion Meeting", "Landscape Snapshot", "Startup Collections",
    "Startup Topic Presentations", "Innovation Day", "Expo", "Challenge",
    "Event Support", "Ad-hoc Intro", "Community Events", "Internal Events",
    "Internal Meeting", "Deep Dive Session", "Strategic Knowledge Sharing",
    "Playbook", "Corporate Membership", "Ecosystem Access",
]

_CONTRACT_PROMPT = """Extract structured data from this corporate innovation partnership contract.
Return ONLY valid JSON — no explanation, no markdown fences.

{{
  "title": "short descriptive title for this contract (e.g. 'Cummins 2026 Innovation Partnership')",
  "term_start": "contract start date in YYYY-MM-DD, or null",
  "term_end": "contract end date in YYYY-MM-DD, or null",
  "value": contract total annual value as a number in USD with no symbols, or null,
  "services": [
    {{"name": "canonical service name", "quantity_included": integer or null if unlimited}}
  ]
}}

Canonical service names — use these exact strings when the service matches:
{services}

Rules:
- "quantity_included" = the contracted number (e.g. "up to 6 Dealflow Sessions" → 6). Null if unlimited/unspecified.
- Only include services explicitly contracted, not general descriptions.
- Do NOT include services_subscribed as a list — only put them under "services".

Contract text:
{{text}}"""


def _extract_contract_services_bg(contract_id: int, partner_id: int, raw_text: str, year: int) -> None:
    """Run LLM on contract text, upsert service_usage rows, update contract title/terms."""
    try:
        from llm.openrouter import call as llm_call
        excerpt = raw_text[:14000] if len(raw_text) > 14000 else raw_text
        services_list = "\n".join(f"- {s}" for s in _CONTRACT_SERVICES)
        prompt = _CONTRACT_PROMPT.replace("{services}", services_list).replace("{text}", excerpt)
        result = llm_call(prompt, model="qwen/qwen3-8b", temperature=0.1, max_tokens=800, activity="Contract Intel")
        if not result:
            return
        clean = result.strip()
        if clean.startswith("```"):
            parts = clean.split("```")
            clean = parts[1].lstrip("json").strip() if len(parts) > 1 else clean
        data = json.loads(clean)
        with get_connection() as conn:
            with conn.cursor() as cur:
                # Update contract metadata
                cur.execute("""
                    UPDATE cvc.partner_contracts
                    SET title=%s, term_start=%s, term_end=%s, value=%s
                    WHERE id=%s
                """, (
                    data.get("title"),
                    data.get("term_start"),
                    data.get("term_end"),
                    data.get("value"),
                    contract_id,
                ))
                # Upsert service usage rows
                for svc in (data.get("services") or []):
                    name = (svc.get("name") or "").strip()
                    qty = svc.get("quantity_included")
                    if isinstance(qty, str):
                        try:
                            qty = int(qty)
                        except (ValueError, TypeError):
                            qty = None
                    if name:
                        cur.execute("""
                            INSERT INTO cvc.partner_service_usage
                                (partner_id, year, service_name, quantity_included, quantity_used, updated_at)
                            VALUES (%s, %s, %s, %s, 0, NOW())
                            ON CONFLICT (partner_id, year, service_name)
                            DO UPDATE SET quantity_included = EXCLUDED.quantity_included, updated_at = NOW()
                        """, (partner_id, year, name, qty))
                conn.commit()
    except Exception as e:
        print(f"[contract intel] contract {contract_id} extraction failed: {e}")


@router.get("/{id}/contract")
def get_contract(id: int):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, title, term_start, term_end, value, summary,
                       filename, file_type, contract_status, contract_value,
                       expiry_date, services_subscribed, created_at
                FROM cvc.partner_contracts
                WHERE partner_id = %s
                ORDER BY COALESCE(created_at, NOW()) DESC
                LIMIT 1
            """, (id,))
            return cur.fetchone()


@router.patch("/{id}/contract/fields")
def patch_contract_fields(id: int, data: dict):
    """Manually update contract value and/or term_end on the latest contract row.
    Creates a minimal contract row if none exists."""
    allowed = {"value", "term_end"}
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields")

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id FROM cvc.partner_contracts
                WHERE partner_id = %s
                ORDER BY COALESCE(created_at, NOW()) DESC
                LIMIT 1
            """, (id,))
            row = cur.fetchone()
            if row:
                set_clause = ", ".join(f"{k} = %s" for k in updates)
                cur.execute(
                    f"UPDATE cvc.partner_contracts SET {set_clause} WHERE id = %s RETURNING id",
                    list(updates.values()) + [row["id"]]
                )
            else:
                cols = ", ".join(["partner_id"] + list(updates.keys()))
                placeholders = ", ".join(["%s"] * (1 + len(updates)))
                cur.execute(
                    f"INSERT INTO cvc.partner_contracts ({cols}) VALUES ({placeholders}) RETURNING id",
                    [id] + list(updates.values())
                )
            conn.commit()
            return {"ok": True}


@router.post("/{id}/contract")
def upload_contract(id: int, file: UploadFile = File(...)):
    content = file.file.read()
    fname = file.filename or "contract"
    ftype = file.content_type or "application/octet-stream"

    raw_text = None
    if ftype == "application/pdf" or fname.lower().endswith(".pdf"):
        raw_text = _extract_pdf_text(content)

    # Determine contract year from current year
    from datetime import date as _date
    usage_year = _date.today().year

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.partner_contracts
                    (partner_id, filename, file_type, file_data, summary, contract_status, created_at)
                VALUES (%s, %s, %s, %s, %s, 'Active', NOW())
                RETURNING id
            """, (id, fname, ftype, content, (raw_text or "")[:3000]))
            conn.commit()
            contract_id = cur.fetchone()["id"]

    if raw_text and contract_id:
        threading.Thread(
            target=_extract_contract_services_bg,
            args=(contract_id, id, raw_text, usage_year),
            daemon=True,
        ).start()

    return {"id": contract_id, "filename": fname, "status": "uploaded"}


@router.post("/{id}/contract/re-extract")
def re_extract_contract(id: int):
    """Re-run LLM extraction on the partner's existing contract PDF.

    Refreshes title, term_start, term_end, value, and service_usage rows.
    No-op if no contract file is on file.
    """
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, file_data, summary FROM cvc.partner_contracts
                WHERE partner_id = %s
                ORDER BY COALESCE(created_at, NOW()) DESC
                LIMIT 1
            """, (id,))
            row = cur.fetchone()

    if not row or not row["file_data"]:
        raise HTTPException(status_code=404, detail="No contract file on file for this partner")

    raw_text = _extract_pdf_text(bytes(row["file_data"]))
    if not raw_text:
        raise HTTPException(status_code=422, detail="Could not extract text from contract PDF")

    from datetime import date as _date
    usage_year = _date.today().year

    threading.Thread(
        target=_extract_contract_services_bg,
        args=(row["id"], id, raw_text, usage_year),
        daemon=True,
    ).start()

    return {"status": "extracting", "contract_id": row["id"]}


@router.delete("/{id}/contract/{contract_id}")
def delete_contract(id: int, contract_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.partner_contracts WHERE id = %s AND partner_id = %s",
                (contract_id, id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Contract not found")
            conn.commit()
    return {"deleted": True}


@router.get("/{id}/contract/file")
def download_contract(id: int):
    from fastapi.responses import Response
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT filename, file_type, file_data FROM cvc.partner_contracts
                WHERE partner_id = %s
                ORDER BY COALESCE(created_at, NOW()) DESC
                LIMIT 1
            """, (id,))
            result = cur.fetchone()
            if not result or not result["file_data"]:
                raise HTTPException(status_code=404, detail="Contract file not found")
            return Response(
                content=bytes(result["file_data"]),
                media_type=result["file_type"] or "application/octet-stream",
                headers={"Content-Disposition": f'attachment; filename="{result["filename"]}"'},
            )

@router.get("/{id}/services")
def get_services(id: int, year: int = None):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Available years for this partner
            cur.execute("""
                SELECT DISTINCT year FROM cvc.partner_service_usage
                WHERE partner_id = %s ORDER BY year DESC
            """, (id,))
            available_years = [r["year"] for r in cur.fetchall()]
            # Default to current year; fall back to most recent year with data
            from datetime import date
            current_year = year or date.today().year
            if available_years and current_year not in available_years:
                current_year = available_years[0]
            cur.execute("""
                SELECT * FROM cvc.partner_service_usage
                WHERE partner_id = %s AND year = %s
                ORDER BY
                    CASE service_name
                        WHEN 'Private Dealflow Sessions' THEN 1
                        WHEN 'Innovation Day'            THEN 2
                        WHEN 'Ad-hoc Intro'              THEN 3
                        ELSE 4
                    END,
                    service_name
            """, (id, current_year))
            services = cur.fetchall()
            cur.execute("SELECT DISTINCT service_name FROM cvc.partner_service_usage WHERE service_name IS NOT NULL ORDER BY service_name")
            canonical = [r["service_name"] for r in cur.fetchall()]
            cur.execute("""
                SELECT services_subscribed FROM cvc.partner_contracts
                WHERE partner_id = %s
                ORDER BY COALESCE(created_at, NOW()) DESC
                LIMIT 1
            """, (id,))
            contract_row = cur.fetchone()
            contracted = contract_row["services_subscribed"] if contract_row and contract_row["services_subscribed"] else []
            return {"services": services, "canonical_services": canonical, "available_years": available_years, "resolved_year": current_year, "contracted_services": contracted}

@router.post("/{id}/services")
def create_service(id: int, service: dict):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.partner_service_usage 
                (partner_id, service_name, service_key, quantity_included, quantity_used, notes, year)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (id, service.get("service_name"), service.get("service_key"),
                  service.get("quantity_included"), service.get("quantity_used", 0),
                  service.get("notes"), service.get("year", 2026)))
            conn.commit()
            return cur.fetchone()

@router.patch("/{id}/services/{svc_id}")
def update_service(id: int, svc_id: int, service: dict):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                UPDATE cvc.partner_service_usage 
                SET service_name = %s, service_key = %s, quantity_included = %s, 
                    quantity_used = %s, notes = %s, year = %s, updated_at = NOW()
                WHERE id = %s AND partner_id = %s
                RETURNING *
            """, (service.get("service_name"), service.get("service_key"),
                  service.get("quantity_included"), service.get("quantity_used"),
                  service.get("notes"), service.get("year"), svc_id, id))
            conn.commit()
            result = cur.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Service not found")
            return result

@router.delete("/{id}/services/{svc_id}")
def delete_service(id: int, svc_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.partner_service_usage WHERE id = %s AND partner_id = %s", 
                       (svc_id, id))
            conn.commit()
            return {"deleted": True}

@router.get("/{id}/issues")
def get_issues(id: int):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM cvc.partner_issues
                WHERE partner_id = %s
                ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC
            """, (id,))
            return {"issues": cur.fetchall()}

@router.post("/{id}/issues")
def create_issue(id: int, issue: dict):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.partner_issues 
                (partner_id, title, body, severity, due_date, linked_document_id, resolved)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (id, issue.get("title"), issue.get("body"), issue.get("severity"),
                  issue.get("due_date"), issue.get("linked_document_id"), False))
            conn.commit()
            return cur.fetchone()

@router.patch("/{id}/issues/{issue_id}")
def update_issue(id: int, issue_id: int, issue: dict):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                UPDATE cvc.partner_issues 
                SET title = %s, body = %s, severity = %s, due_date = %s, 
                    linked_document_id = %s, resolved = %s, updated_at = NOW()
                WHERE id = %s AND partner_id = %s
                RETURNING *
            """, (issue.get("title"), issue.get("body"), issue.get("severity"),
                  issue.get("due_date"), issue.get("linked_document_id"),
                  issue.get("resolved", False), issue_id, id))
            conn.commit()
            result = cur.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Issue not found")
            return result

@router.delete("/{id}/issues/{issue_id}")
def delete_issue(id: int, issue_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.partner_issues WHERE id = %s AND partner_id = %s", 
                       (issue_id, id))
            conn.commit()
            return {"deleted": True}

@router.get("/{id}/issues/{issue_id}/comments")
def get_issue_comments(id: int, issue_id: int, user: UserInfo = Depends(require_jwt)):
    vis_clause, vis_params = _visibility_clause(user, alias="c")
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT c.* FROM cvc.partner_issue_comments c
                JOIN cvc.partner_issues i ON c.issue_id = i.id
                WHERE c.issue_id = %s AND i.partner_id = %s {vis_clause}
                ORDER BY c.created_at ASC
            """, [issue_id, id] + vis_params)
            return {"comments": cur.fetchall()}

@router.post("/{id}/issues/{issue_id}/comments")
def create_issue_comment(id: int, issue_id: int, comment: dict, user: UserInfo = Depends(require_jwt)):
    body = (comment.get("body") or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Comment body is required")
    created_by = comment.get("created_by") or user.username
    vis, psm = ("psm_only", user.username) if user.role == "PSM" else ("team", None)
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.partner_issue_comments (issue_id, body, created_by, visibility, assigned_psm)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING *
            """, (issue_id, body, created_by, vis, psm))
            conn.commit()
            return cur.fetchone()

@router.get("/{id}/advisory-logs")
def get_advisory_logs(id: int, user: UserInfo = Depends(require_jwt)):
    vis_clause, vis_params = _visibility_clause(user)
    _log_access(user, id, "view_advisory_logs")
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT l.*, c.name as company_name
                FROM cvc.partner_advisory_logs l
                LEFT JOIN cvc.companies c ON l.company_id = c.id
                WHERE l.partner_id = %s {vis_clause}
                ORDER BY l.created_at DESC
            """, [id] + vis_params)
            return cur.fetchall()

@router.post("/{id}/advisory-logs")
def create_advisory_log(id: int, log: dict, user: UserInfo = Depends(require_jwt)):
    vis, psm = ("psm_only", user.username) if user.role == "PSM" else ("team", None)
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.partner_advisory_logs
                (partner_id, log_type, body, company_id, meeting_date, outcome, next_steps, source_url, visibility, assigned_psm)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (id, log.get("log_type"), log.get("body"), log.get("company_id"),
                  log.get("meeting_date"), log.get("outcome"), log.get("next_steps"),
                  log.get("source_url"), vis, psm))
            conn.commit()
            return cur.fetchone()

@router.get("/{id}/compatibility")
def get_compatibility(
    id: int,
    limit: int = Query(100, ge=1, le=500),
    sector: Optional[str] = Query(None),
    min_score: int = Query(0, ge=0, le=100),
):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM cvc.partners WHERE id = %s", (id,))
            partner = cur.fetchone()
            if not partner:
                raise HTTPException(status_code=404, detail="Partner not found")

            partner_sectors   = [s.lower() for s in (partner.get("sectors_of_interest") or [])]
            partner_protocols = [p.lower() for p in (partner.get("current_protocols") or [])]

            conditions = ["enrichment_status = 'enriched'"]
            params: list = []
            if sector:
                conditions.append("sector = %s")
                params.append(sector)

            cur.execute(f"""
                SELECT id, name, sector, stage, country,
                       industrial_readiness_score, sovereignty_score,
                       deployment_signal_level,
                       COALESCE(protocol_support, '{{}}') AS protocol_support,
                       COALESCE(verified_certs,   '{{}}') AS verified_certs,
                       COALESCE(total_raised_usd, 0)      AS total_raised_usd,
                       score_composite
                FROM cvc.companies
                WHERE {" AND ".join(conditions)}
            """, params)
            rows = cur.fetchall()

    def _sov_tier(score):
        if score is None:
            return "unknown"
        if score >= 7:
            return "green"
        if score >= 4:
            return "yellow"
        return "red"

    def _label(score):
        if score >= 75: return "Tier 1"
        if score >= 50: return "Tier 2"
        if score >= 30: return "Watchlist"
        return "Low Fit"

    results = []
    for r in rows:
        overlap = [p for p in r["protocol_support"] if p.lower() in partner_protocols]

        sector_match = (r["sector"] or "").lower() in partner_sectors if partner_sectors else False
        proto_score  = 25 * (len(overlap) / max(len(partner_protocols), 1)) if partner_protocols else 0
        irs          = float(r["industrial_readiness_score"]) if r["industrial_readiness_score"] is not None else None
        mrl_score    = 20 * (irs / 10) if irs is not None else 0
        sov          = float(r["sovereignty_score"]) if r["sovereignty_score"] is not None else None
        sov_score    = 10 if (sov or 0) >= 7 else (5 if (sov or 0) >= 4 else 0)
        comp         = float(r["score_composite"]) if r["score_composite"] is not None else None
        comp_score   = 10 * ((comp or 0) / 100)

        raw = (35 if sector_match else 0) + proto_score + mrl_score + sov_score + comp_score
        compat = round(min(raw, 100))

        if compat < min_score:
            continue

        results.append({
            "id":                       r["id"],
            "name":                     r["name"],
            "sector":                   r["sector"],
            "stage":                    r["stage"],
            "country":                  r["country"],
            "compatibility_score":      compat,
            "compatibility_label":      _label(compat),
            "compatibility_badge":      _label(compat),
            "protocol_overlap":         overlap,
            "all_protocols":            list(r["protocol_support"] or []),
            "mrl_band_hit":             (irs or 0) >= 6,
            "industrial_readiness_score": irs,
            "sovereignty_score":        sov,
            "sovereignty_tier":         _sov_tier(sov),
            "deployment_signal":        r["deployment_signal_level"],
            "verified_certs":           list(r["verified_certs"] or []),
            "total_funding":            r["total_raised_usd"] or 0,
        })

    results.sort(key=lambda x: x["compatibility_score"], reverse=True)

    return {
        "companies":   results[:limit],
        "total":       len(results),
        "partner_dna": {
            "sectors_of_interest": partner.get("sectors_of_interest") or [],
            "current_protocols":   partner.get("current_protocols") or [],
            "environments":        partner.get("environments") or [],
            "challenge_areas":     partner.get("challenge_areas") or [],
        },
    }

@router.get("/{id}/matches")
def get_matches(id: int):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT m.*, c.name as company_name, c.one_liner, c.sector, c.stage
                FROM cvc.partner_matches m
                JOIN cvc.companies c ON m.company_id = c.id
                WHERE m.partner_id = %s
                ORDER BY m.match_score DESC
            """, (id,))
            return {"matches": cur.fetchall()}

@router.post("/{id}/matches")
def create_match(id: int, match: dict):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.partner_matches (partner_id, company_id, match_score, match_reason, status)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING *
            """, (id, match.get("company_id"), match.get("match_score"),
                  match.get("match_reason"), match.get("status", "pending")))
            conn.commit()
            return cur.fetchone()

@router.put("/{id}/matches/{match_id}")
def update_match(id: int, match_id: int, match: dict):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                UPDATE cvc.partner_matches
                SET match_score = %s, match_reason = %s, status = %s
                WHERE id = %s AND partner_id = %s
                RETURNING *
            """, (match.get("match_score"), match.get("match_reason"),
                  match.get("status"), match_id, id))
            conn.commit()
            result = cur.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Match not found")
            return result


@router.get("/{id}/intros")
def get_partner_intros(id: int):
    """All startup introductions made to this partner, newest first."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT pi.id, pi.startup_name, pi.company_id, c.name AS company_name,
                       pi.intro_date, pi.delivered_date, pi.intro_type,
                       pi.receiver, pi.monday_doc_url,
                       pi.met_with, pi.status_1, pi.status_log, pi.outcome
                FROM cvc.partner_intros pi
                LEFT JOIN cvc.companies c ON c.id = pi.company_id
                WHERE pi.partner_id = %s
                ORDER BY pi.intro_date DESC NULLS LAST
            """, (id,))
            return cur.fetchall()


@router.patch("/{partner_id}/intros/{intro_id}")
def update_partner_intro(partner_id: int, intro_id: int, payload: dict, user: UserInfo = Depends(require_jwt)):
    """Patch editable fields on a partner intro row."""
    allowed = {'startup_name', 'company_id', 'intro_date', 'delivered_date', 'intro_type', 'receiver', 'monday_doc_url', 'met_with', 'status_1', 'status_log', 'outcome'}
    jsonb_fields = {'status_log'}
    updates = {k: v for k, v in payload.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    # Wrap JSONB fields so psycopg2 serializes them correctly
    values = [Json(v) if k in jsonb_fields else v for k, v in updates.items()]
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            set_clause = ", ".join(f"{k} = %s" for k in updates)
            cur.execute(
                f"UPDATE cvc.partner_intros SET {set_clause} WHERE id = %s AND partner_id = %s RETURNING id",
                values + [intro_id, partner_id]
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Intro not found")
            conn.commit()
            # Return the full updated row
            cur.execute("""
                SELECT pi.id, pi.startup_name, pi.company_id, c.name AS company_name,
                       pi.intro_date, pi.delivered_date, pi.intro_type,
                       pi.receiver, pi.monday_doc_url,
                       pi.met_with, pi.status_1, pi.status_log, pi.outcome
                FROM cvc.partner_intros pi
                LEFT JOIN cvc.companies c ON c.id = pi.company_id
                WHERE pi.id = %s
            """, (intro_id,))
            return dict(cur.fetchone())


@router.delete("/{partner_id}/intros/{intro_id}")
def delete_partner_intro(partner_id: int, intro_id: int, user: UserInfo = Depends(require_jwt)):
    """Hard delete a partner intro row."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.partner_intros WHERE id = %s AND partner_id = %s RETURNING id",
                (intro_id, partner_id)
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Intro not found")
            conn.commit()
    return {"deleted": True}


@router.post("/{partner_id}/intros")
def create_partner_intro(partner_id: int, payload: dict, user: UserInfo = Depends(require_jwt)):
    """Create a new partner intro row."""
    startup_name = (payload.get('startup_name') or '').strip()
    if not startup_name:
        raise HTTPException(status_code=400, detail="startup_name is required")

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT name FROM cvc.partners WHERE id = %s", (partner_id,))
            partner = cur.fetchone()
            if not partner:
                raise HTTPException(status_code=404, detail="Partner not found")

            intro_date = payload.get('intro_date') or date.today().isoformat()
            outcome    = payload.get('outcome') or 'shared'

            status_log = [{
                "text":       "Introduction logged.",
                "ts":         intro_date if isinstance(intro_date, str) else intro_date.isoformat(),
                "outcome":    "shared",
                "logged_by":  user.username,
            }]

            source = payload.get('source', 'manual')
            collection_item_id = payload.get('collection_item_id')
            cur.execute("""
                INSERT INTO cvc.partner_intros
                  (startup_name, company_id, partner_id, partner_name,
                   intro_date, outcome, status_log, source, collection_item_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                ON CONFLICT (startup_name, partner_name, intro_date) DO NOTHING
                RETURNING id
            """, (
                startup_name,
                payload.get('company_id'),
                partner_id,
                partner['name'],
                intro_date,
                outcome,
                Json(status_log),
                source,
                collection_item_id,
            ))
            result = cur.fetchone()
            if not result:
                raise HTTPException(status_code=409, detail="Intro already exists for this startup/partner/date")

            intro_id = result['id']
            conn.commit()

            cur.execute("""
                SELECT pi.id, pi.startup_name, pi.company_id, c.name AS company_name,
                       pi.intro_date, pi.delivered_date, pi.intro_type,
                       pi.receiver, pi.monday_doc_url,
                       pi.met_with, pi.status_1, pi.status_log, pi.outcome
                FROM cvc.partner_intros pi
                LEFT JOIN cvc.companies c ON c.id = pi.company_id
                WHERE pi.id = %s
            """, (intro_id,))
            return dict(cur.fetchone())


@router.get("/{id}/engagement-summary")
def get_engagement_summary(id: int):
    """Year-by-year intro engagement summary for a partner."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    EXTRACT(YEAR FROM intro_date)::int AS year,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE outcome IN ('shared', 'intro_made', 'introduced')) AS shared_count,
                    COUNT(*) FILTER (WHERE outcome IN ('evaluation', 'monitoring', 'planning', 'in_progress', 'on_hold')) AS active_count,
                    COUNT(*) FILTER (WHERE outcome IN ('completed', 'commercial')) AS won_count,
                    COUNT(*) FILTER (WHERE outcome IN ('cancelled', 'closed')) AS lost_count
                FROM cvc.partner_intros
                WHERE partner_id = %s AND intro_date IS NOT NULL
                GROUP BY year
                ORDER BY year
            """, (id,))
            rows = [dict(r) for r in cur.fetchall()]

            trend = 'Flat'
            if len(rows) >= 2:
                last = rows[-1]['total']
                prev = rows[-2]['total']
                if last > prev * 1.15:
                    trend = 'Increasing'
                elif last < prev * 0.85:
                    trend = 'Declining'

            cur.execute("SELECT COUNT(*) AS total FROM cvc.partner_intros WHERE partner_id = %s", (id,))
            total_row = cur.fetchone()

            cur.execute("""
                SELECT outcome, COUNT(*)::int AS count
                FROM cvc.partner_intros
                WHERE partner_id = %s AND outcome IS NOT NULL
                GROUP BY outcome
            """, (id,))
            outcome_rows = {r['outcome']: r['count'] for r in cur.fetchall()}

            OUTCOME_ORDER = [
                ('shared',       'Shared'),
                ('introduced',   'Introduced'),
                ('intro_made',   'Intro Made'),
                ('evaluation',   'Evaluation'),
                ('monitoring',  'Monitoring'),
                ('planning',    'PoC Planning'),
                ('in_progress', 'PoC Active'),
                ('on_hold',     'PoC On Hold'),
                ('completed',   'PoC Completed'),
                ('commercial',  'Commercial'),
                ('cancelled',   'Cancelled'),
                ('closed',      'Closed'),
                ('NDA',                 'NDA'),
                ('PoC',                 'PoC'),
                ('PoC/PoT',             'PoC/PoT'),
                ('Pilot',               'Pilot'),
                ('Commercial Agreement','Commercial Agreement'),
                ('Hold',                'Hold'),
                ('Close',               'Close'),
            ]
            by_outcome = [
                {'outcome': key, 'label': label, 'count': outcome_rows.get(key, 0)}
                for key, label in OUTCOME_ORDER
                if outcome_rows.get(key, 0) > 0
            ]

            active_keys = {'evaluation','monitoring','planning','in_progress','on_hold','NDA','PoC','PoC/PoT','Pilot'}
            won_keys    = {'completed','commercial','Commercial Agreement'}
            active = sum(outcome_rows.get(k, 0) for k in active_keys)
            won    = sum(outcome_rows.get(k, 0) for k in won_keys)

            current_year = __import__('datetime').date.today().year
            current_year_total = next((r['total'] for r in rows if r['year'] == current_year), 0)

            return {
                "by_year":           rows,
                "trend":             trend,
                "total":             total_row['total'] if total_row else 0,
                "by_outcome":        by_outcome,
                "active":            active,
                "won":               won,
                "current_year_total": current_year_total,
            }


@router.get("/{id}/requests")
def get_partner_requests(id: int):
    """Long-list request history for a partner — what they asked for and when."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, requested_date, year, tech_focus, notes,
                       requester, ventures_person, office,
                       is_complete, led_to_dealflow, dealflow_date,
                       had_startup_intros, playbook_url
                FROM cvc.partner_requests
                WHERE partner_id = %s
                ORDER BY requested_date DESC NULLS LAST
            """, (id,))
            rows = cur.fetchall()

            # Also return per-year interest summary
            cur.execute("""
                SELECT year,
                       array_agg(DISTINCT tech_focus ORDER BY tech_focus) AS topics,
                       COUNT(*) AS request_count,
                       COUNT(*) FILTER (WHERE led_to_dealflow = TRUE) AS df_count
                FROM cvc.partner_requests
                WHERE partner_id = %s AND year IS NOT NULL
                GROUP BY year
                ORDER BY year DESC
            """, (id,))
            by_year = cur.fetchall()

            return {"requests": rows, "by_year": by_year}


@router.get("/{id}/signals")
def get_partner_signals(id: int):
    """
    Return entity signal intelligence for a partner.
    Pulls from cvc.entities rows linked to this partner via strategic_matcher_worker.
    """
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            # Entity variants and cumulative mention counts
            cur.execute("""
                SELECT name, mention_count, first_seen, last_seen,
                       round(partner_confidence::numeric, 2) AS confidence
                FROM cvc.entities
                WHERE partner_id = %s
                ORDER BY mention_count DESC
            """, (id,))
            variants = cur.fetchall()

            if not variants:
                return {
                    "total_mentions": 0,
                    "variants": [],
                    "recent_count": 0,
                    "prior_count": 0,
                    "latest_signal": None,
                    "recent_content": [],
                }

            total_mentions = sum(v["mention_count"] for v in variants)
            latest_signal  = max((v["last_seen"] for v in variants if v["last_seen"]), default=None)

            # Mention counts: last 30 days vs prior 30 days (excluding dismissed)
            cur.execute("""
                SELECT
                    COUNT(DISTINCT ci.id) FILTER (
                        WHERE COALESCE(ci.published_at, ci.created_at) >= NOW() - INTERVAL '30 days'
                    ) AS recent_count,
                    COUNT(DISTINCT ci.id) FILTER (
                        WHERE COALESCE(ci.published_at, ci.created_at) >= NOW() - INTERVAL '60 days'
                          AND COALESCE(ci.published_at, ci.created_at) <  NOW() - INTERVAL '30 days'
                    ) AS prior_count
                FROM cvc.content_items ci
                CROSS JOIN LATERAL jsonb_array_elements_text(
                    CASE WHEN ci.key_entities ? 'companies'
                         THEN ci.key_entities->'companies'
                         ELSE '[]'::jsonb
                    END
                ) AS cn(company_name)
                JOIN cvc.entities e
                  ON lower(trim(cn.company_name)) = e.name_normalized
                WHERE e.partner_id = %s
                  AND ci.id NOT IN (
                      SELECT content_item_id::uuid FROM cvc.signal_dismissals
                      WHERE partner_id = %s
                  )
            """, (id, id))
            counts = cur.fetchone()

            # Recent content mentioning this partner (last 60 days, deduped by title, no dismissed)
            cur.execute("""
                SELECT DISTINCT ON (ci.title)
                    ci.id::text,
                    ci.title,
                    ci.url,
                    ci.content_type,
                    COALESCE(ci.published_at, ci.created_at)::date AS published_date,
                    ci.sentiment
                FROM cvc.content_items ci
                CROSS JOIN LATERAL jsonb_array_elements_text(
                    CASE WHEN ci.key_entities ? 'companies'
                         THEN ci.key_entities->'companies'
                         ELSE '[]'::jsonb
                    END
                ) AS cn(company_name)
                JOIN cvc.entities e
                  ON lower(trim(cn.company_name)) = e.name_normalized
                WHERE e.partner_id = %s
                  AND COALESCE(ci.published_at, ci.created_at) >= NOW() - INTERVAL '60 days'
                  AND ci.id NOT IN (
                      SELECT content_item_id::uuid FROM cvc.signal_dismissals
                      WHERE partner_id = %s
                  )
                ORDER BY ci.title, COALESCE(ci.published_at, ci.created_at) DESC
                LIMIT 8
            """, (id, id))
            recent_content = cur.fetchall()

            return {
                "total_mentions": total_mentions,
                "variants":       [dict(v) for v in variants],
                "recent_count":   counts["recent_count"] if counts else 0,
                "prior_count":    counts["prior_count"]  if counts else 0,
                "latest_signal":  str(latest_signal) if latest_signal else None,
                "recent_content": [dict(r) for r in recent_content],
            }


@router.post("/{id}/signals/dismiss")
def dismiss_signal(id: int, body: dict, user: UserInfo = Depends(require_jwt)):
    """Mark a content item as irrelevant for this partner. Excluded from future signal loads."""
    content_item_id = body.get("content_item_id")
    if not content_item_id:
        raise HTTPException(status_code=400, detail="content_item_id required")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.signal_dismissals (partner_id, content_item_id, dismissed_by)
                VALUES (%s, %s::uuid, %s)
                ON CONFLICT (partner_id, content_item_id) DO NOTHING
            """, (id, content_item_id, user.username))
        conn.commit()
    return {"ok": True}


# ── Partner Sector Profiles ────────────────────────────────────────────────────

@router.get("/sector-profile/incomplete")
def get_incomplete_sector_profiles(user: UserInfo = Depends(require_jwt)):
    """Return partners that have no sector profile rows — sorted by most recent intro activity.
    Used by PSM Hub to surface the queue of partners needing intake."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.id, p.name, p.industry,
                       MAX(pi.intro_date) AS last_intro_date
                FROM cvc.partners p
                LEFT JOIN cvc.partner_intros pi ON pi.partner_id = p.id
                WHERE p.id NOT IN (
                    SELECT DISTINCT partner_id FROM cvc.partner_sector_profile
                )
                GROUP BY p.id, p.name, p.industry
                ORDER BY last_intro_date DESC NULLS LAST, p.name
                LIMIT 20
            """)
            rows = cur.fetchall()
    return {"partners": [dict(r) for r in rows]}


@router.get("/{id}/sector-profile")
def get_partner_sector_profiles(id: int, user: UserInfo = Depends(require_jwt)):
    """Return all sector profiles saved for this partner."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, partner_id, sector, subsector,
                       interest_level, engagement_type, orientation, top_priorities,
                       environment_reqs, investment_appetite, annual_target,
                       solving_notes, blocker_notes,
                       completed_by, completed_at, updated_by, updated_at
                FROM cvc.partner_sector_profile
                WHERE partner_id = %s
                ORDER BY sector, subsector
            """, (id,))
            rows = cur.fetchall()
    return {"profiles": [dict(r) for r in rows]}


@router.put("/{id}/sector-profile")
def upsert_partner_sector_profile(id: int, body: dict, user: UserInfo = Depends(require_jwt)):
    """Create or update the sector profile for a partner+sector+subsector combo.
    Body: sector, subsector (optional), engagement_type[], orientation, top_priorities[],
          environment_reqs[], investment_appetite, annual_target, solving_notes, blocker_notes
    """
    sector = (body.get("sector") or "").strip()
    if not sector:
        raise HTTPException(status_code=400, detail="sector is required")

    subsector           = (body.get("subsector") or "").strip()
    interest_level      = body.get("interest_level")
    engagement_type     = body.get("engagement_type") or []
    orientation         = body.get("orientation") or None
    top_priorities      = body.get("top_priorities") or []
    environment_reqs    = body.get("environment_reqs") or []
    investment_appetite = body.get("investment_appetite") or None
    annual_target       = body.get("annual_target")
    solving_notes       = (body.get("solving_notes") or "").strip() or None
    blocker_notes       = (body.get("blocker_notes") or "").strip() or None

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.partner_sector_profile
                    (partner_id, sector, subsector, interest_level,
                     engagement_type, orientation, top_priorities,
                     environment_reqs, investment_appetite,
                     annual_target, solving_notes, blocker_notes,
                     completed_by, completed_at, updated_by, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s, NOW())
                ON CONFLICT (partner_id, sector, subsector) DO UPDATE SET
                    interest_level      = EXCLUDED.interest_level,
                    engagement_type     = EXCLUDED.engagement_type,
                    orientation         = EXCLUDED.orientation,
                    top_priorities      = EXCLUDED.top_priorities,
                    environment_reqs    = EXCLUDED.environment_reqs,
                    investment_appetite = EXCLUDED.investment_appetite,
                    annual_target       = EXCLUDED.annual_target,
                    solving_notes       = EXCLUDED.solving_notes,
                    blocker_notes       = EXCLUDED.blocker_notes,
                    updated_by          = EXCLUDED.updated_by,
                    updated_at          = NOW()
                RETURNING *
            """, (
                id, sector, subsector,
                interest_level,
                engagement_type, orientation,
                top_priorities, environment_reqs,
                investment_appetite, annual_target,
                solving_notes, blocker_notes,
                user.username, user.username,
            ))
            row = cur.fetchone()
        conn.commit()
    return dict(row)


@router.delete("/{id}/sector-profile/{profile_id}")
def delete_partner_sector_profile(id: int, profile_id: int, user: UserInfo = Depends(require_jwt)):
    """Delete a sector profile row."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.partner_sector_profile WHERE id = %s AND partner_id = %s RETURNING id",
                (profile_id, id),
            )
            deleted = cur.fetchone()
        conn.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"ok": True}


# ── Dealflows ──────────────────────────────────────────────────────────────────

def _generate_display_id(cur, table: str, prefix: str) -> str:
    """Generate next sequential display ID for dealflows/collections."""
    year = __import__('datetime').date.today().year
    cur.execute(f"SELECT COUNT(*) FROM cvc.{table} WHERE display_id LIKE %s", (f"{prefix}-{year}-%",))
    n = cur.fetchone()[0] + 1
    return f"{prefix}-{year}-{n:03d}"


@router.get("/{id}/dealflows")
def list_dealflows(id: int, user: UserInfo = Depends(require_jwt)):
    """All dealflows for a partner, with nested collections and item counts."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT d.*,
                       pr.tech_focus AS request_tech_focus,
                       pr.requested_date AS request_date
                FROM cvc.partner_dealflows d
                LEFT JOIN cvc.partner_requests pr ON pr.id = d.request_id
                WHERE d.partner_id = %s
                ORDER BY d.created_at DESC
            """, (id,))
            dealflows = [dict(r) for r in cur.fetchall()]

            for df in dealflows:
                cur.execute("""
                    SELECT c.*,
                           COUNT(i.id)                                          AS item_count,
                           COUNT(i.id) FILTER (WHERE i.on_shortlist)            AS shortlist_count,
                           COUNT(i.id) FILTER (WHERE i.intro_id IS NOT NULL)    AS introduced_count
                    FROM cvc.partner_collections c
                    LEFT JOIN cvc.partner_collection_items i ON i.collection_id = c.id
                    WHERE c.dealflow_id = %s
                    GROUP BY c.id
                    ORDER BY c.created_at
                """, (df['id'],))
                df['collections'] = [dict(r) for r in cur.fetchall()]

            return {"dealflows": dealflows}


@router.post("/{id}/dealflows")
def create_dealflow(id: int, body: dict, user: UserInfo = Depends(require_jwt)):
    """Create a new dealflow for a partner. Bumps partner_service_usage counter."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            display_id = _generate_display_id(cur, 'partner_dealflows', 'DF')
            cur.execute("""
                INSERT INTO cvc.partner_dealflows
                    (partner_id, request_id, display_id, tech_focus, status, notes, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                id,
                body.get('request_id'),
                display_id,
                body.get('tech_focus', ''),
                body.get('status', 'open'),
                body.get('notes', ''),
                user.username,
            ))
            df = dict(cur.fetchone())

            # Bump service_usage counter (no enforcement — count only)
            year = __import__('datetime').date.today().year
            service_name = 'Private Dealflow Sessions'
            cur.execute("""
                SELECT id, quantity_used FROM cvc.partner_service_usage
                WHERE partner_id = %s AND year = %s AND service_name = %s
            """, (id, year, service_name))
            row = cur.fetchone()
            if row:
                cur.execute("""
                    UPDATE cvc.partner_service_usage SET quantity_used = %s, updated_at = NOW()
                    WHERE id = %s
                """, (row['quantity_used'] + 1, row['id']))
            else:
                cur.execute("""
                    INSERT INTO cvc.partner_service_usage (partner_id, year, service_name, quantity_used)
                    VALUES (%s, %s, %s, 1)
                """, (id, year, service_name))

            conn.commit()
            df['collections'] = []
            return df


@router.patch("/{id}/dealflows/{df_id}")
def update_dealflow(id: int, df_id: int, body: dict, user: UserInfo = Depends(require_jwt)):
    """Edit any field on a dealflow — supports backfilling."""
    allowed = ['request_id', 'tech_focus', 'status', 'notes', 'display_id', 'created_by']
    updates = [(f, body[f]) for f in allowed if f in body]
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{f} = %s" for f, _ in updates)
    values = [v for _, v in updates] + [df_id, id]
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                UPDATE cvc.partner_dealflows
                SET {set_clause}, updated_at = NOW()
                WHERE id = %s AND partner_id = %s
                RETURNING *
            """, values)
            conn.commit()
            result = cur.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Dealflow not found")
            return dict(result)


@router.delete("/{id}/dealflows/{df_id}")
def delete_dealflow(id: int, df_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.partner_dealflows WHERE id = %s AND partner_id = %s", (df_id, id))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Dealflow not found")
            conn.commit()
    return {"ok": True}


# ── Collections ────────────────────────────────────────────────────────────────

@router.post("/{id}/dealflows/{df_id}/collections")
def create_collection(id: int, df_id: int, body: dict, user: UserInfo = Depends(require_jwt)):
    """Add a collection to an existing dealflow."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Verify dealflow belongs to this partner
            cur.execute("SELECT display_id FROM cvc.partner_dealflows WHERE id = %s AND partner_id = %s", (df_id, id))
            df = cur.fetchone()
            if not df:
                raise HTTPException(status_code=404, detail="Dealflow not found")

            # Count existing collections on this dealflow for suffix letter
            cur.execute("SELECT COUNT(*) FROM cvc.partner_collections WHERE dealflow_id = %s", (df_id,))
            n = cur.fetchone()[0]
            suffix = chr(65 + n)  # A, B, C...
            display_id = f"{df['display_id']}-{suffix}"

            cur.execute("""
                INSERT INTO cvc.partner_collections
                    (partner_id, dealflow_id, display_id, title, status, notes, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                id, df_id, display_id,
                body.get('title', ''),
                body.get('status', 'draft'),
                body.get('notes', ''),
                user.username,
            ))
            conn.commit()
            col = dict(cur.fetchone())
            col['items'] = []
            col['item_count'] = 0
            col['shortlist_count'] = 0
            col['introduced_count'] = 0
            return col


@router.post("/{id}/collections/standalone")
def create_standalone_collection(id: int, body: dict, user: UserInfo = Depends(require_jwt)):
    """Create a standalone collection (no dealflow parent)."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            display_id = _generate_display_id(cur, 'partner_collections', 'COL')
            cur.execute("""
                INSERT INTO cvc.partner_collections
                    (partner_id, dealflow_id, display_id, title, status, notes, created_by)
                VALUES (%s, NULL, %s, %s, %s, %s, %s)
                RETURNING *
            """, (id, display_id, body.get('title', ''), body.get('status', 'draft'),
                  body.get('notes', ''), user.username))
            conn.commit()
            col = dict(cur.fetchone())
            col['items'] = []
            return col


@router.patch("/{id}/collections/{col_id}")
def update_collection(id: int, col_id: int, body: dict, user: UserInfo = Depends(require_jwt)):
    allowed = ['title', 'status', 'notes', 'display_id']
    updates = [(f, body[f]) for f in allowed if f in body]
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{f} = %s" for f, _ in updates)
    values = [v for _, v in updates] + [col_id, id]
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                UPDATE cvc.partner_collections
                SET {set_clause}, updated_at = NOW()
                WHERE id = %s AND partner_id = %s
                RETURNING *
            """, values)
            conn.commit()
            result = cur.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Collection not found")
            return dict(result)


@router.delete("/{id}/collections/{col_id}")
def delete_collection(id: int, col_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.partner_collections WHERE id = %s AND partner_id = %s", (col_id, id))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Collection not found")
            conn.commit()
    return {"ok": True}


# ── Collection Items ───────────────────────────────────────────────────────────

@router.get("/{id}/collections/{col_id}/items")
def list_collection_items(id: int, col_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT i.*,
                       c.name    AS company_name_db,
                       c.sector  AS company_sector,
                       c.stage   AS company_stage,
                       pi.outcome AS intro_outcome,
                       pi.intro_date AS intro_date_logged
                FROM cvc.partner_collection_items i
                LEFT JOIN cvc.companies c ON c.id = i.company_id
                LEFT JOIN cvc.partner_intros pi ON pi.id = i.intro_id
                WHERE i.collection_id = %s
                ORDER BY i.on_shortlist DESC, i.created_at
            """, (col_id,))
            return {"items": [dict(r) for r in cur.fetchall()]}


@router.post("/{id}/collections/{col_id}/items")
def add_collection_item(id: int, col_id: int, body: dict, user: UserInfo = Depends(require_jwt)):
    if not body.get('startup_name', '').strip():
        raise HTTPException(status_code=400, detail="startup_name required")
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.partner_collection_items
                    (collection_id, company_id, startup_name, on_shortlist, notes, added_by)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                col_id,
                body.get('company_id'),
                body['startup_name'].strip(),
                body.get('on_shortlist', False),
                body.get('notes', ''),
                user.username,
            ))
            conn.commit()
            return dict(cur.fetchone())


@router.patch("/{id}/collections/{col_id}/items/{item_id}")
def update_collection_item(id: int, col_id: int, item_id: int, body: dict, user: UserInfo = Depends(require_jwt)):
    """Edit a collection item — supports shortlist toggle, intro linkage, and backfill."""
    allowed = ['startup_name', 'company_id', 'on_shortlist', 'intro_id', 'notes']
    updates = [(f, body[f]) for f in allowed if f in body]
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{f} = %s" for f, _ in updates)
    values = [v for _, v in updates] + [item_id, col_id]
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                UPDATE cvc.partner_collection_items
                SET {set_clause}
                WHERE id = %s AND collection_id = %s
                RETURNING *
            """, values)
            conn.commit()
            result = cur.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Item not found")
            return dict(result)


@router.delete("/{id}/collections/{col_id}/items/{item_id}")
def delete_collection_item(id: int, col_id: int, item_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.partner_collection_items WHERE id = %s AND collection_id = %s", (item_id, col_id))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Item not found")
            conn.commit()
    return {"ok": True}


# ── Service Notes (PSM-private, role-gated) ───────────────────────────────────

_SERVICE_NOTE_ROLES = {"GP", "Principal", "Director", "PSM", "Senior PSM"}

def _check_service_note_access(user: UserInfo, partner_id: int):
    """GP/Director/Principal see all. PSM/Senior PSM only their assigned partners."""
    if user.role in _FULL_ACCESS_ROLES:
        return
    if user.role in ("PSM", "Senior PSM"):
        if partner_id not in (user.assigned_partner_ids or []):
            raise HTTPException(status_code=403, detail="Not authorized for this partner")
        return
    raise HTTPException(status_code=403, detail="Service notes require PSM or above role")


@router.get("/{id}/service-notes")
def get_service_notes(id: int, user: UserInfo = Depends(require_jwt)):
    _check_service_note_access(user, id)
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, partner_id, note_type, body, created_by, created_at
                FROM cvc.partner_notes
                WHERE partner_id = %s AND is_service_note = true
                ORDER BY created_at DESC
            """, (id,))
            return [dict(r) for r in cur.fetchall()]


@router.post("/{id}/service-notes")
def add_service_note(id: int, body: dict, user: UserInfo = Depends(require_jwt)):
    _check_service_note_access(user, id)
    note_body = (body.get("body") or "").strip()
    note_type = body.get("note_type") or "general"
    if not note_body:
        raise HTTPException(status_code=400, detail="Note body is required")
    if note_type not in ("call", "meeting", "email", "internal", "general"):
        note_type = "general"
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.partner_notes
                    (partner_id, body, note_type, is_service_note, created_by)
                VALUES (%s, %s, %s, true, %s)
                RETURNING id, partner_id, note_type, body, created_by, created_at
            """, (id, note_body, note_type, user.username))
            conn.commit()
            return dict(cur.fetchone())


@router.delete("/{id}/service-notes/{note_id}")
def delete_service_note(id: int, note_id: int, user: UserInfo = Depends(require_jwt)):
    _check_service_note_access(user, id)
    with get_connection() as conn:
        with conn.cursor() as cur:
            # GP/Director/Principal can delete any note; PSM can only delete their own
            if user.role in _FULL_ACCESS_ROLES:
                cur.execute(
                    "DELETE FROM cvc.partner_notes WHERE id = %s AND partner_id = %s",
                    (note_id, id)
                )
            else:
                cur.execute(
                    "DELETE FROM cvc.partner_notes WHERE id = %s AND partner_id = %s AND created_by = %s",
                    (note_id, id, user.username)
                )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Note not found or not yours to delete")
            conn.commit()
    return {"ok": True}
