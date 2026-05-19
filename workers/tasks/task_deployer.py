"""
workers/tasks/task_deployer.py -- Poll for complete tasks, deploy, smoke test.

Runs on: Dell server / BigBossHog (100.83.104.117)
Start:   nohup python3 workers/tasks/task_deployer.py >> ~/logs/task_deployer.log 2>&1 &
"""
import os
import subprocess
import sys
import time
import traceback

import requests
from core.db.connection import get_connection

DEPLOY_SCRIPT   = os.path.expanduser("~/scripts/update_api.sh")
SMOKE_TEST      = os.path.expanduser("~/repos/cvc-intelligence/tests/smoke_test.py")
REPO_ROOT       = os.path.expanduser("~/repos/cvc-intelligence")
MIGRATIONS_DIR  = os.path.expanduser("~/repos/cvc-intelligence/core/db/migrations")
LOCK_FILE       = "/tmp/deploy.lock"
POLL_INTERVAL   = 60  # seconds


# ── Deploy lock ───────────────────────────────────────────────────────────────

def acquire_lock() -> bool:
    if os.path.exists(LOCK_FILE):
        print("[deployer] Deploy lock exists, skipping this cycle.")
        return False
    with open(LOCK_FILE, "w") as f:
        f.write(str(os.getpid()))
    return True


def release_lock():
    try:
        os.remove(LOCK_FILE)
    except FileNotFoundError:
        pass


# ── Task claiming ─────────────────────────────────────────────────────────────

def claim_complete_task():
    """Claim one complete task atomically. Returns row dict or None."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM cvc.build_tasks
                WHERE status = 'complete'
                ORDER BY completed_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            """)
            row = cur.fetchone()
            if row:
                cur.execute("""
                    UPDATE cvc.build_tasks
                    SET status_changed_at = NOW()
                    WHERE task_id = %s
                """, (row["task_id"],))
    return dict(row) if row else None


# ── Deploy + smoke test ───────────────────────────────────────────────────────

def run_deploy() -> tuple:
    """Run update_api.sh. Returns (success_bool, output_str)."""
    result = subprocess.run(
        [DEPLOY_SCRIPT],
        capture_output=True, text=True, timeout=300
    )
    success = result.returncode == 0
    output = (result.stdout + result.stderr).strip()
    return success, output


def run_migrations() -> tuple:
    """Run all SQL migrations in order. Uses IF NOT EXISTS so safe to re-run. Returns (success, output)."""
    import glob as glob_module
    sql_files = sorted(glob_module.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))
    if not sql_files:
        return True, "No migrations found"
    lines = []
    env = {**os.environ, "PGPASSWORD": os.environ["CVC_DB_PASSWORD"]}
    for sql_file in sql_files:
        basename = os.path.basename(sql_file)
        result = subprocess.run(
            ["psql", "-h", "localhost", "-U", "producer", "-d", "cvc_db", "-f", sql_file],
            capture_output=True, text=True, timeout=60, env=env
        )
        if result.returncode != 0:
            lines.append(f"FAILED {basename}: {result.stderr.strip()}")
            return False, "\n".join(lines)
        lines.append(f"OK {basename}")
    return True, "\n".join(lines)


def run_smoke_test() -> tuple:
    """Run smoke_test.py. Returns (passed_bool, output_str)."""
    result = subprocess.run(
        ["python3", SMOKE_TEST, "--user", "nate", "--password", os.environ["CVC_SMOKE_PASSWORD"]],
        capture_output=True, text=True, timeout=120
    )
    passed = result.returncode == 0
    output = (result.stdout + result.stderr).strip()
    return passed, output


# ── DB updates ────────────────────────────────────────────────────────────────

def update_task_deployed(task_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.build_tasks
                SET status = 'deployed',
                    deployed_at = NOW(),
                    status_changed_at = NOW()
                WHERE task_id = %s
            """, (task_id,))


def update_task_failed(task_id: int, notes: str):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.build_tasks
                SET status = 'failed',
                    notes = %s,
                    status_changed_at = NOW()
                WHERE task_id = %s
            """, (notes[:2000], task_id))


def create_retry_task(task: dict, error: str) -> int:
    """Create a follow-up pending task with error context. Returns new task_id."""
    retry_count = task.get("retry_count", 0) + 1
    parent_id = task.get("parent_task_id") or task["task_id"]
    error_snippet = error[:800] if len(error) > 800 else error
    new_spec = f"{task['spec']}\n\nPREVIOUS ATTEMPT FAILED (attempt {retry_count}/2):\n{error_snippet}"
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.build_tasks
                    (spec, risk_level, priority, status, retry_count, parent_task_id, created_by, requires_approval)
                VALUES (%s, %s, %s, 'pending', %s, %s, 'auto-retry', %s)
                RETURNING task_id
            """, (
                new_spec,
                task.get("risk_level", "medium"),
                task.get("priority", 5),
                retry_count,
                parent_id,
                task.get("requires_approval", False),
            ))
            new_id = cur.fetchone()["task_id"]
    print(f"[deployer] Created retry task #{new_id} (retry {retry_count}/2, parent #{parent_id})")
    return new_id


def notify_escalation(task: dict, error: str):
    """Telegram Nate when a task has exhausted all retries."""
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "8439605362:AAEs0kErefS7YL9JcAx4H_TpTSOSGiBgLrM")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "8310039682")
    parent_id = task.get("parent_task_id") or task["task_id"]
    snippet = error[-400:] if len(error) > 400 else error
    text = (
        f"🚨 Task #{task['task_id']} (original #{parent_id}) has failed 3 times. "
        f"Manual intervention needed.\n\nSpec: {task['spec'][:200]}\n\nLast error:\n{snippet}"
    )
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    try:
        resp = requests.post(url, json={"chat_id": chat_id, "text": text}, timeout=10)
        resp.raise_for_status()
        print(f"[deployer] Escalation sent to Nate for task #{task['task_id']}")
    except Exception as e:
        print(f"[deployer] Escalation Telegram failed: {e}")


# ── Telegram ──────────────────────────────────────────────────────────────────

def notify_nate(task_id: int, success: bool, commit_hash: str, output: str):
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not bot_token or not chat_id:
        print("Warning: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, skipping Telegram.")
        return

    short_hash = commit_hash[:8] if commit_hash else "unknown"
    if success:
        text = f"Task #{task_id} deployed. Commit {short_hash}. Smoke tests passed."
    else:
        snippet = output[-400:] if len(output) > 400 else output
        text = f"Task #{task_id} FAILED deploy.\nCommit: {short_hash}\n\n{snippet}"

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    try:
        resp = requests.post(url, json={"chat_id": chat_id, "text": text}, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"Telegram notify failed: {e}")


# ── Auto-revert ───────────────────────────────────────────────────────────────

def auto_revert(task_id: int, commit_hash: str) -> bool:
    """Revert the task's commit locally, push to GitHub, then redeploy. Returns True on success."""
    if not commit_hash:
        print(f"[deployer] No commit hash for task #{task_id}, cannot auto-revert.")
        return False
    try:
        # Revert locally — repo lives on the Dell server
        revert_cmd = f"cd {REPO_ROOT} && git revert --no-edit {commit_hash} && git push origin main"
        result = subprocess.run(
            ["bash", "-c", revert_cmd],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode != 0:
            print(f"[deployer] git revert failed:\n{result.stderr}")
            return False
        print(f"[deployer] Reverted commit {commit_hash[:8]}, redeploying...")
        deploy_ok, deploy_out = run_deploy()
        if deploy_ok:
            print(f"[deployer] Redeployed clean state after revert.")
        else:
            print(f"[deployer] Redeploy after revert failed:\n{deploy_out}")
        return deploy_ok
    except Exception as e:
        print(f"[deployer] auto_revert exception: {e}")
        return False


# ── Retry logic ───────────────────────────────────────────────────────────────

def _handle_retry(task: dict, error: str):
    """After a failure: retry if under limit, escalate to Nate if at limit."""
    if task.get("retry_count", 0) < 2:
        create_retry_task(task, error)
    else:
        notify_escalation(task, error)


# ── Poll loop ─────────────────────────────────────────────────────────────────

def process_task(task: dict):
    task_id = task["task_id"]
    commit_hash = task.get("commit_hash", "")
    print(f"\n[deployer] Deploying task #{task_id}: {task['spec'][:60]}")

    if not acquire_lock():
        print(f"[deployer] Could not acquire lock, will retry next cycle.")
        return

    try:
        deploy_ok, deploy_out = run_deploy()
        if not deploy_ok:
            error_msg = f"Deploy failed:\n{deploy_out}"
            update_task_failed(task_id, error_msg)
            notify_nate(task_id, False, commit_hash, deploy_out)
            _handle_retry(task, error_msg)
            print(f"[deployer] Deploy FAILED for task #{task_id}")
            return

        mig_ok, mig_out = run_migrations()
        print(f"[deployer] Migrations: {mig_out}")
        if not mig_ok:
            error_msg = f"Migration failed:\n{mig_out}"
            update_task_failed(task_id, error_msg)
            notify_nate(task_id, False, commit_hash, mig_out)
            _handle_retry(task, error_msg)
            print(f"[deployer] Migration FAILED for task #{task_id}")
            return

        smoke_ok, smoke_out = run_smoke_test()
        if smoke_ok:
            update_task_deployed(task_id)
            notify_nate(task_id, True, commit_hash, smoke_out)
            print(f"[deployer] Task #{task_id} deployed successfully.")
        else:
            print(f"[deployer] Smoke test FAILED for task #{task_id} — reverting...")
            revert_ok = auto_revert(task_id, commit_hash)
            error_msg = f"Smoke test failed:\n{smoke_out}"
            if revert_ok:
                error_msg += "\n\n[Auto-reverted and redeployed clean state]"
            update_task_failed(task_id, error_msg)
            notify_nate(task_id, False, commit_hash, smoke_out)
            _handle_retry(task, error_msg)
            print(f"[deployer] Smoke test FAILED for task #{task_id}")

    finally:
        release_lock()


def poll_loop():
    print("[deployer] BigBossHog task deployer started. Polling every 60s.")
    while True:
        try:
            task = claim_complete_task()
            if task:
                process_task(task)
            else:
                print("[deployer] No complete tasks. Sleeping.")
        except Exception:
            print(f"[deployer] Poll loop error:\n{traceback.format_exc()}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    poll_loop()
