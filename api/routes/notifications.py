"""
api/routes/notifications.py — Notification bell feed.

GET /notifications  — Aggregated feed from 3 sources:
  1. cvc.notifications table   (explicit writes from workers + assignment events)
  2. cvc.build_tasks           (recent completions/deploys)
  3. cvc.agent_memory          (platform_update / event entries)

Returns newest-first, max 60 items across last 30 days.
Assignment/tag notifications are written directly by route handlers via write_notif().
"""

from fastapi import APIRouter, Depends
from core.db.connection import get_connection
from api.routes.auth import require_jwt, UserInfo

router = APIRouter()


def write_notif(target_user: str, title: str, body: str | None = None,
                link: str | None = None, source: str = "platform",
                notif_type: str = "assignment") -> None:
    """Write a user-targeted notification. Silent on failure."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO cvc.notifications
                        (type, title, body, source, link, target_user)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (notif_type, title, body, source, link, target_user))
            conn.commit()
    except Exception:
        pass


@router.get("")
async def get_notifications(user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, type, title, body, source, link, reference_id, created_at
                FROM (

                    -- 1. Explicit notifications (global ones + ones addressed to this user)
                    SELECT
                        'notif:' || id::text            AS id,
                        type,
                        title,
                        body,
                        source,
                        link,
                        reference_id,
                        created_at
                    FROM cvc.notifications
                    WHERE created_at > NOW() - INTERVAL '30 days'
                      AND (target_user IS NULL OR target_user = %s)

                    UNION ALL

                    -- 2. Build task completions (enrichment, DD, BigClaw code deploys)
                    SELECT
                        'task:' || task_id::text        AS id,
                        CASE
                            WHEN task_type = 'enrichment' THEN 'enrichment'
                            WHEN task_type = 'dd'         THEN 'dd_complete'
                            ELSE 'task_complete'
                        END                             AS type,
                        CASE
                            WHEN task_type = 'enrichment' THEN
                                'Enrichment complete — ' || SPLIT_PART(spec, '(company_id=', 1)
                            WHEN task_type = 'dd' THEN
                                'DD pipeline complete — ' || SPLIT_PART(spec, '(company_id=', 1)
                            ELSE
                                LEFT(spec, 80)
                        END                             AS title,
                        LEFT(spec, 200)                 AS body,
                        COALESCE(assigned_to, 'bigclaw') AS source,
                        CASE
                            WHEN task_type IN ('enrichment', 'dd') THEN '/enrichment'
                            ELSE '/admin'
                        END                             AS link,
                        NULL::integer                   AS reference_id,
                        COALESCE(status_changed_at, created_at) AS created_at
                    FROM cvc.build_tasks
                    WHERE status IN ('complete', 'completed', 'deployed')
                      AND task_type NOT IN ('feedback')
                      AND COALESCE(status_changed_at, created_at) > NOW() - INTERVAL '7 days'

                    UNION ALL

                    -- 3. Agent memory — platform_update and event entries only
                    SELECT
                        'mem:' || id::text              AS id,
                        'agent_update'                  AS type,
                        INITCAP(REPLACE(agent, 'bigclaw', 'BigClaw')) || ' — ' ||
                            REPLACE(entry_type, '_', ' ')   AS title,
                        LEFT(REGEXP_REPLACE(content, '^[\n\r\s\-#]+', ''), 200) AS body,
                        agent                           AS source,
                        NULL::text                      AS link,
                        NULL::integer                   AS reference_id,
                        created_at
                    FROM cvc.agent_memory
                    WHERE entry_type IN ('platform_update', 'event')
                      AND created_at > NOW() - INTERVAL '7 days'

                ) combined
                ORDER BY created_at DESC NULLS LAST
                LIMIT 60
            """, (user.username,))
            rows = cur.fetchall()

    return [
        {
            "id":           r["id"],
            "type":         r["type"],
            "title":        (r["title"] or "").strip(),
            "body":         (r["body"] or "").strip() or None,
            "source":       r["source"],
            "link":         r["link"],
            "reference_id": r["reference_id"],
            "created_at":   r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]
