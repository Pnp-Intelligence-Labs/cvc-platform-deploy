"""
settings.py — All configuration for the DD pipeline.
No hardcoded values in agent scripts — everything lives here.
"""

from pathlib import Path
import sys

# ── Paths ─────────────────────────────────────────────────────────────────────

REPO_DIR        = Path(__file__).parent.parent
WORKDIR         = REPO_DIR / "workdir"
SCHEMAS_DIR     = REPO_DIR / "schemas"

# Google Drive credentials live in the existing producer directory
GDRIVE_CREDS    = Path.home() / "producer" / "gdrive_credentials.json"
GDRIVE_TOKEN    = Path.home() / "producer" / "gdrive_token.json"

# Google Drive output folder name for DD reports
GDRIVE_DD_FOLDER = "DD Reports"

# ── LLM — OpenRouter (primary) ────────────────────────────────────────────────
# All specialist agents use OpenRouter — better quality, no local GPU bottleneck
# qwen/qwen3-235b-a22b-2507: best value — $0.07/M input+output, 128K context
# Model test results (Onyx, 2026-03-05): Qwen=best depth/cost, Deepseek=fastest,
#   Kimi=good quality but requires max_tokens>=16384 and is 25x more expensive
LLM_MODEL      = "qwen/qwen3-235b-a22b-2507"
LLM_TIMEOUT    = 600
LLM_MAX_TOKENS = 16384

# Financial model passes use Gemini 2.0 Flash — 1M token context handles large
# spreadsheets that overflow Qwen's 128K window. $0.10/M input, $0.40/M output.
# Used only for passes that feed full financial model text (actuals, metrics, reconcile).
LLM_MODEL_LONG_CONTEXT = "google/gemini-2.0-flash-001"

# Overview agent uses Kimi K2.5 — stronger synthesis and long-context IC memo writing
OVERVIEW_LLM_MODEL = "moonshotai/kimi-k2"

# ── Ollama (local fallback only) ──────────────────────────────────────────────
OLLAMA_URL     = "http://localhost:11434/api/generate"
OLLAMA_MODEL   = "qwen3.5:27b"
OLLAMA_CTX     = 32768
OLLAMA_TIMEOUT = 300

# ── Telegram ──────────────────────────────────────────────────────────────────

# Set via environment or override here for local runs
import os
TELEGRAM_TOKEN  = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT   = os.environ.get("TELEGRAM_CHAT_ID", "")

# ── Document conversion ───────────────────────────────────────────────────────

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".xlsx", ".doc", ".txt", ".md", ".csv"}
MAX_CHARS_PER_DOC    = 80000   # Truncate extremely large docs
