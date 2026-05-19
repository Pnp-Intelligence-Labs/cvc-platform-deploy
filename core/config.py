"""
config.py — Shared configuration for platform and plugins.
API keys and settings used across pipelines.
"""

import os
from pathlib import Path

# ── Brave Search ──────────────────────────────────────────────────────────────
BRAVE_API_KEY        = os.environ.get("BRAVE_API_KEY") or os.environ.get("BRAVE_SEARCH_KEY")
BRAVE_API_KEY_BACKUP = os.environ.get("BRAVE_SEARCH_KEY_BACKUP")
BRAVE_URL            = "https://api.search.brave.com/res/v1/web/search"

# ── OpenRouter ────────────────────────────────────────────────────────────────
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
OPENROUTER_URL     = "https://openrouter.ai/api/v1/chat/completions"

# ── Proxycurl (LinkedIn enrichment) ──────────────────────────────────────────
PROXYCURL_API_KEY = os.environ.get("PROXYCURL_API_KEY")
PROXYCURL_URL     = "https://api.enrichlayer.com"

# Available models via OpenRouter
MODEL_QWEN3_235B   = "qwen/qwen3-235b-a22b-2507"       # $0.07/M  — default, best value
MODEL_KIMI_K2_5    = "moonshotai/kimi-k2.5"             # $0.45/M  — strong coding + reasoning
MODEL_DEEPSEEK_V3  = "deepseek/deepseek-v3.2"           # $0.25/M  — strong general reasoning

# ── OpenAI ────────────────────────────────────────────────────────────────────
OPENAI_API_KEY     = os.environ.get("OPENAI_API_KEY")
OPENAI_EMBED_URL   = "https://api.openai.com/v1/embeddings"
OPENAI_EMBED_MODEL = "text-embedding-3-small"

# ── Ollama (local) ────────────────────────────────────────────────────────────
OLLAMA_URL    = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL  = os.environ.get("OLLAMA_MODEL", "qwen3:32b")

# ── Monitoring ────────────────────────────────────────────────────────────────
MONITOR_DB    = Path.home() / ".platform" / "metrics.db"
MONITOR_DB.parent.mkdir(parents=True, exist_ok=True)
