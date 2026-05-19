"""
agent_usage_sync.py — Sync OpenClaw agent LLM usage into cvc.llm_usage_log.

Reads the JSONL session files for each gateway agent, extracts per-turn usage
(input tokens, output tokens, cache tokens, cost), and inserts rows into
cvc.llm_usage_log. Uses a watermark file to avoid double-inserting.

Run via cron every 30 minutes on Dell:
  */30 * * * * cd /home/nathan11/repos/cvc-intelligence && \
    PYTHONPATH=/home/nathan11/repos/cvc-intelligence/core \
    venv/bin/python3 workers/monitoring/agent_usage_sync.py >> ~/logs/agent_usage_sync.log 2>&1
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg2

# ── Config ────────────────────────────────────────────────────────────────────

DB_HOST = os.getenv("CVC_DB_HOST", "localhost")
DB_PORT = os.getenv("CVC_DB_PORT", "5432")
DB_NAME = os.getenv("CVC_DB_NAME", "cvc_db")
DB_USER = os.getenv("CVC_DB_USER", "producer")
DB_PASS = os.environ["CVC_DB_PASSWORD"]

HOME = Path("/home/nathan11")

AGENTS = [
    {
        "name": "Sharp Claw",
        "sessions_dir": HOME / ".openclaw-sharpclaw/agents/main/sessions",
    },
    {
        "name": "BigBossHog",
        "sessions_dir": HOME / ".openclaw/agents/main/sessions",
    },
    {
        "name": "Big Claw",
        "sessions_dir": HOME / ".openclaw-bigclaw/agents/main/sessions",
    },
]

WATERMARK_DIR = HOME / ".cvc_agent_usage_watermarks"
WATERMARK_DIR.mkdir(exist_ok=True)


# ── DB ────────────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS
    )


def insert_usage(conn, agent_name: str, model: str, called_at: datetime,
                 prompt_tokens: int, completion_tokens: int, cost: float):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cvc.llm_usage_log (activity, model, prompt_tokens, completion_tokens, cost, called_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (agent_name, model.split("/")[-1], prompt_tokens, completion_tokens,
             round(cost, 6), called_at),
        )
    conn.commit()


# ── Watermark ─────────────────────────────────────────────────────────────────

def get_watermark(agent_name: str, session_file: str) -> int:
    """Return last processed line index (0-based). -1 = nothing processed."""
    key = f"{agent_name}_{Path(session_file).stem}"
    wf = WATERMARK_DIR / f"{key}.txt"
    if wf.exists():
        try:
            return int(wf.read_text().strip())
        except Exception:
            pass
    return -1


def set_watermark(agent_name: str, session_file: str, line_idx: int):
    key = f"{agent_name}_{Path(session_file).stem}"
    wf = WATERMARK_DIR / f"{key}.txt"
    wf.write_text(str(line_idx))


# ── Parser ────────────────────────────────────────────────────────────────────

def get_model_from_session(sessions_dir: Path) -> str:
    """Best-effort: read the models.json next to the session to get the model id."""
    models_file = sessions_dir.parent / "agent" / "models.json"
    if models_file.exists():
        try:
            d = json.loads(models_file.read_text())
            for provider_data in d.get("providers", {}).values():
                models = provider_data.get("models", [])
                if models:
                    return models[0].get("id", "unknown")
        except Exception:
            pass
    return "unknown"


def process_agent(agent: dict, conn) -> int:
    sessions_dir = agent["sessions_dir"]
    agent_name = agent["name"]

    if not sessions_dir.exists():
        return 0

    # Find the active session file (non-lock jsonl files)
    session_files = sorted(
        [f for f in sessions_dir.glob("*.jsonl") if not f.name.endswith(".lock")],
        key=lambda f: f.stat().st_mtime,
    )
    if not session_files:
        return 0

    # Default model from config
    default_model = get_model_from_session(sessions_dir)

    total_inserted = 0

    for session_file in session_files:
        watermark = get_watermark(agent_name, str(session_file))
        lines = session_file.read_text(errors="replace").splitlines()

        new_watermark = watermark
        for idx, line in enumerate(lines):
            if idx <= watermark:
                continue
            new_watermark = idx

            try:
                d = json.loads(line)
            except Exception:
                continue

            msg = d.get("message", {})
            usage = msg.get("usage")
            if not usage:
                continue

            total_tokens = usage.get("totalTokens", 0)
            if total_tokens == 0:
                continue

            prompt_tokens = usage.get("input", 0) + usage.get("cacheRead", 0)
            completion_tokens = usage.get("output", 0)
            cost_info = usage.get("cost", {})
            if isinstance(cost_info, dict):
                cost = cost_info.get("total", 0.0)
            else:
                cost = float(cost_info or 0)

            # Timestamp — prefer message timestamp, fall back to now
            ts_str = d.get("timestamp", "")
            try:
                called_at = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            except Exception:
                called_at = datetime.now(timezone.utc)

            # Model — try to get from usage metadata, fall back to default
            model = usage.get("model", default_model) or default_model

            try:
                insert_usage(conn, agent_name, model, called_at,
                             prompt_tokens, completion_tokens, cost)
                total_inserted += 1
            except Exception as e:
                print(f"  [WARN] insert failed for {agent_name}: {e}")
                conn.rollback()

        if new_watermark > watermark:
            set_watermark(agent_name, str(session_file), new_watermark)

    return total_inserted


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] agent_usage_sync starting")
    try:
        conn = get_conn()
    except Exception as e:
        print(f"DB connection failed: {e}")
        sys.exit(1)

    total = 0
    for agent in AGENTS:
        try:
            n = process_agent(agent, conn)
            if n:
                print(f"  {agent['name']}: inserted {n} usage records")
            total += n
        except Exception as e:
            print(f"  {agent['name']}: ERROR — {e}")

    conn.close()
    print(f"Done. Total inserted: {total}")


if __name__ == "__main__":
    main()
