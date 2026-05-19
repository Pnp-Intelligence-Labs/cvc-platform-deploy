"""
workers/tasks/task_monitor.py -- Read-only monitoring, stuck task alerts, local audit trail.

Runs on: Lenovo (Whip Claw)
Start:   python3 workers/tasks/task_monitor.py &

Connects to Postgres at 100.95.2.44:5432 read-only.
Logs to ~/whipclaw/task_monitor.db (SQLite).
Alerts Nate via Whip Claw's Telegram bot.
"""
import json
import os
import sqlite3
import time
import traceback
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
import requests

# ── Config ────────────────────────────────────────────────────────────────────

DB_HOST = "100.95.2.44"
DB_PORT = 5432
DB_NAME = "cvc_db"
DB_USER = "producer"
DB_PASS = os.environ["CVC_DB_PASSWORD"]

WHIP_BOT_TOKEN = os.environ.get("WHIP_BOT_TOKEN", "8438825813:AAE1LjR_HcNP4bT28SqaXUfhjjiamwe4BT8")
NATE_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "8310039682")

SQLITE_PATH = os.path.expanduser("~/whipclaw/task_monitor.db")
POLL_INTERVAL = 60  # seconds

# Stuck thresholds (seconds)
STUCK_BUILDING_SECS = 30 * 60   # 30 min
STUCK_COMPLETE_SECS = 30 * 60   # 30 min
STUCK_PENDING_AUTO_SECS = 60 * 60  # 60 min


# ── SQLite setup ──────────────────────────────────────────────────────────────

def init_sqlite():
    os.makedirs(os.path.dirname(SQLITE_PATH), exist_ok=True)
    conn = sqlite3.connect(SQLITE_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS monitor_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp  TEXT NOT NULL,
            event_type TEXT NOT NULL,
            task_id    INTEGER,
            detail     TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS alert_dedup (
            task_id    INTEGER PRIMARY KEY,
            last_alert TEXT NOT NULL
        )
    """)
    conn.commit()
    return conn


def log_event(sqlite_conn, event_type: str, task_id: int = None, detail: str = ""):
    sqlite_conn.execute(
        "INSERT INTO monitor_log (timestamp, event_type, task_id, detail) VALUES (?, ?, ?, ?)",
        (datetime.now(timezone.utc).isoformat(), event_type, task_id, detail)
    )
    sqlite_conn.commit()


def snapshot_queue(sqlite_conn, tasks: list):
    log_event(sqlite_conn, "snapshot", detail=json.dumps(tasks, default=str))


# ── Postgres read ─────────────────────────────────────────────────────────────

def fetch_active_tasks() -> list:
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASS,
        cursor_factory=psycopg2.extras.RealDictCursor
    )
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM cvc.build_tasks
                WHERE status NOT IN ('deployed', 'failed')
                ORDER BY created_at DESC
            """)
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── Stuck detection ───────────────────────────────────────────────────────────

def detect_stuck_tasks(tasks: list) -> list:
    now = datetime.now(timezone.utc)
    stuck = []

    for t in tasks:
        status_changed = t["status_changed_at"]
        # Make timezone-aware if naive
        if status_changed.tzinfo is None:
            status_changed = status_changed.replace(tzinfo=timezone.utc)
        elapsed = (now - status_changed).total_seconds()

        if t["status"] == "building" and elapsed > STUCK_BUILDING_SECS:
            stuck.append({
                "task_id": t["task_id"],
                "spec": t["spec"],
                "status": "building",
                "elapsed_min": int(elapsed // 60),
                "reason": f"building for {int(elapsed // 60)} min (threshold: 30 min)"
            })
        elif t["status"] == "complete" and elapsed > STUCK_COMPLETE_SECS:
            stuck.append({
                "task_id": t["task_id"],
                "spec": t["spec"],
                "status": "complete",
                "elapsed_min": int(elapsed // 60),
                "reason": f"complete but not deployed for {int(elapsed // 60)} min (threshold: 30 min)"
            })
        elif (t["status"] == "pending"
              and not t["requires_approval"]
              and elapsed > STUCK_PENDING_AUTO_SECS):
            stuck.append({
                "task_id": t["task_id"],
                "spec": t["spec"],
                "status": "pending",
                "elapsed_min": int(elapsed // 60),
                "reason": f"auto-approve pending for {int(elapsed // 60)} min (threshold: 60 min)"
            })

    return stuck


# ── Telegram alerts ───────────────────────────────────────────────────────────

def should_alert(sqlite_conn, task_id: int) -> bool:
    """Deduplicate: no re-alert within 30 min."""
    row = sqlite_conn.execute(
        "SELECT last_alert FROM alert_dedup WHERE task_id = ?", (task_id,)
    ).fetchone()
    if not row:
        return True
    last = datetime.fromisoformat(row[0])
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - last).total_seconds()
    return elapsed > 30 * 60


def record_alert(sqlite_conn, task_id: int):
    sqlite_conn.execute(
        "INSERT OR REPLACE INTO alert_dedup (task_id, last_alert) VALUES (?, ?)",
        (task_id, datetime.now(timezone.utc).isoformat())
    )
    sqlite_conn.commit()


def alert_nate(sqlite_conn, stuck_tasks: list):
    for s in stuck_tasks:
        task_id = s["task_id"]
        if not should_alert(sqlite_conn, task_id):
            continue

        text = (
            f"[Whip] STUCK TASK #{task_id}\n"
            f"Status: {s['status']}\n"
            f"{s['reason']}\n"
            f"Spec: {s['spec'][:100]}"
        )

        url = f"https://api.telegram.org/bot{WHIP_BOT_TOKEN}/sendMessage"
        try:
            resp = requests.post(url, json={"chat_id": NATE_CHAT_ID, "text": text}, timeout=10)
            resp.raise_for_status()
            record_alert(sqlite_conn, task_id)
            log_event(sqlite_conn, "stuck_alert", task_id=task_id, detail=s["reason"])
            print(f"[monitor] Alerted Nate: task #{task_id} stuck ({s['status']})")
        except Exception as e:
            print(f"[monitor] Telegram alert failed: {e}")


# ── Poll loop ─────────────────────────────────────────────────────────────────

def poll_loop():
    print("[monitor] Whip Claw task monitor started. Polling every 60s.")
    sqlite_conn = init_sqlite()

    while True:
        try:
            tasks = fetch_active_tasks()
            snapshot_queue(sqlite_conn, tasks)
            print(f"[monitor] {len(tasks)} active task(s).")

            stuck = detect_stuck_tasks(tasks)
            if stuck:
                print(f"[monitor] {len(stuck)} stuck task(s) detected.")
                alert_nate(sqlite_conn, stuck)
        except Exception:
            err = traceback.format_exc()
            print(f"[monitor] Error:\n{err}")
            log_event(sqlite_conn, "error", detail=err[:1000])

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    poll_loop()
