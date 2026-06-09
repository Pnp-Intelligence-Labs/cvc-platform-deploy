"""
core/notifications.py — Shared helper for writing to cvc.notifications.

Used by enrichment workers, DD workers, and agents to emit events
that show up in the dashboard notification bell.
"""

import logging

logger = logging.getLogger(__name__)


def write_notification(
    type: str,
    title: str,
    body: str | None = None,
    source: str | None = None,
    link: str | None = None,
    reference_id: int | None = None,
    target_user: str | None = None,
) -> None:
    """
    Insert a row into cvc.notifications.
    Silently swallows errors so worker failures never block enrichment.
    target_user=None broadcasts to all users; pass a username to restrict visibility.
    """
    try:
        from db.connection import get_connection  # noqa: E402
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO cvc.notifications (type, title, body, source, link, reference_id, target_user)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (type, title, body, source, link, reference_id, target_user))
            conn.commit()
    except Exception as e:
        logger.warning(f"write_notification failed (non-fatal): {e}")


def write_cron_error(job_name: str, error_msg: str, source: str | None = None) -> None:
    """
    Convenience wrapper — call this in the top-level except block of any cron worker.
    Writes a 'cron_error' notification visible in the platform bell and Admin page.
    """
    write_notification(
        type="cron_error",
        title=f"Cron failure: {job_name}",
        body=str(error_msg)[:400],
        source=source or "cron",
        link="/admin",
        target_user="nate",
    )
