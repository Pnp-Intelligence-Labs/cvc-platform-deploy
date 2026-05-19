"""
llm/openrouter.py — OpenRouter LLM skill.

Shared LLM call used by all DD specialist agents and pipelines.
Uses OpenRouter's OpenAI-compatible API.

Default model: qwen/qwen3-235b-a22b-2507
- 235B total params, 22B active (MoE)
- Significantly better than qwen3:32b for document analysis and reasoning
- ~$0.07/million input tokens — a full DD run costs ~$0.02

Reasoning model support (kimi-k2.5, deepseek-r1, etc.):
- These models emit reasoning tokens before the actual content response
- Reasoning tokens count against max_tokens on some providers
- Use max_tokens >= 8192 for reasoning models to avoid truncation
- If content is None (reasoning truncated), falls back to reasoning field
  so the pipeline degrades gracefully rather than crashing

Usage:
    from llm.openrouter import call

    response = call("Extract the ARR from this document: ...")
    response = call(prompt, model="moonshotai/kimi-k2.5", temperature=0.1)
"""

import requests
from cvc_config import OPENROUTER_API_KEY, OPENROUTER_URL


def _log_usage(activity: str, model: str, prompt_tokens: int, completion_tokens: int, cost: float) -> None:
    """Write LLM call metrics to cvc.llm_usage_log. Fire-and-forget — never raises."""
    try:
        import psycopg2
        import psycopg2.extras
        import os
        conn = psycopg2.connect(
            host=os.getenv("CVC_DB_HOST", "100.83.104.117"),
            port=int(os.getenv("CVC_DB_PORT", "5432")),
            dbname=os.getenv("CVC_DB_NAME", "cvc_db"),
            user=os.getenv("CVC_DB_USER", "producer"),
            password=os.environ["CVC_DB_PASSWORD"],
        )
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO cvc.llm_usage_log
                   (activity, model, prompt_tokens, completion_tokens, cost)
                   VALUES (%s, %s, %s, %s, %s)""",
                (activity, model.split("/")[-1], prompt_tokens, completion_tokens, cost),
            )
        conn.commit()
        conn.close()
    except Exception:
        pass

# Default model for all DD agents — best quality at near-zero cost
DEFAULT_MODEL = "qwen/qwen3-235b-a22b-2507"

# Reasoning models that emit thinking tokens before content.
# These need a higher max_tokens budget to leave room for the actual response.
REASONING_MODELS = {
    "moonshotai/kimi-k2.5",
    "deepseek/deepseek-r1",
    "deepseek/deepseek-r1-0528",
    "openai/o1",
    "openai/o3-mini",
}

# Minimum max_tokens for reasoning models (thinking eats into the budget)
REASONING_MIN_TOKENS = 16384


def call(
    prompt: str,
    model: str = DEFAULT_MODEL,
    temperature: float = 0.1,
    max_tokens: int = 4096,
    timeout: int = 300,
    api_key: str = None,
    activity: str = "unknown",
) -> str:
    """
    Call an LLM via OpenRouter. Returns response text.

    Args:
        prompt:      The full prompt to send (system + user combined, or just user)
        model:       OpenRouter model ID. Defaults to qwen3-235b-a22b-2507.
        temperature: 0.1 for extraction/analysis, 0.3-0.5 for narrative writing
        max_tokens:  Max response tokens. Auto-bumped to 8192 for reasoning models.
        timeout:     Request timeout in seconds

    Returns:
        Response text as a string. Raises on HTTP error.
    """
    # Reasoning models need a larger token budget
    if model in REASONING_MODELS:
        max_tokens = max(max_tokens, REASONING_MIN_TOKENS)

    key = api_key or OPENROUTER_API_KEY

    resp = requests.post(
        OPENROUTER_URL,
        headers={
            "Authorization":  f"Bearer {key}",
            "Content-Type":   "application/json",
            "HTTP-Referer":   "https://github.com/natelouie11-tech",
            "X-Title":        "CVC DD Pipeline",
        },
        json={
            "model": model,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "temperature": temperature,
            "max_tokens":  max_tokens,
        },
        timeout=timeout,
    )
    resp.raise_for_status()

    data    = resp.json()
    message = data["choices"][0]["message"]

    # Reasoning models: content may be None if thinking consumed the token budget.
    # Fall back to reasoning field so pipeline doesn't crash.
    content = message.get("content")
    if not content:
        content = message.get("reasoning") or ""

    # Log token usage if available (useful for cost tracking)
    usage = data.get("usage", {})
    if usage:
        prompt_tokens     = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)
        cost              = usage.get("cost", 0)
        reasoning_tokens  = usage.get("completion_tokens_details", {}).get("reasoning_tokens", 0)
        parts = [f"tokens: {prompt_tokens}p + {completion_tokens}c"]
        if reasoning_tokens:
            parts.append(f"{reasoning_tokens} reasoning")
        if cost:
            parts.append(f"${cost:.5f}")
        print(f"    [{model.split('/')[-1]}] {' | '.join(parts)}")
        _log_usage(activity, model, prompt_tokens, completion_tokens, cost)

    return content.strip()
