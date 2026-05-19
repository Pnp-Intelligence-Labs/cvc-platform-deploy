"""Base agent class for 05-trend-report pipeline."""

import json
import logging
import sys
from datetime import datetime
from pathlib import Path

# Add skills to path

from db.connection import get_connection
from llm.openrouter import call as llm_call
from web.brave import search as brave_search

logger = logging.getLogger("trend_report")


class BaseAgent:
    """Base class for all trend report agents."""

    name: str = "base"
    description: str = ""

    def __init__(self, manifest: dict):
        self.manifest = manifest
        self.quarter = manifest["quarter"]
        self.sectors = manifest.get("sectors", [
            "robotics", "supply_chain", "industrial_auto", "physical_ai"
        ])
        self.date_start = manifest.get("date_start")
        self.date_end = manifest.get("date_end")
        self.log = logging.getLogger(f"trend_report.{self.name}")
        self.log.info(f"Initialized {self.name} for {self.quarter}")

    def run(self):
        """Override in subclass. Main entry point."""
        raise NotImplementedError

    def safe_run(self) -> dict:
        """Run with error handling. Returns status dict."""
        try:
            result = self.run()
            self.log.info(f"{self.name} completed successfully")
            return {"agent": self.name, "status": "success", "result": result}
        except Exception as e:
            self.log.error(f"{self.name} failed: {e}", exc_info=True)
            return {"agent": self.name, "status": "error", "error": str(e)}

    def query_db(self, sql: str, params: tuple = None) -> list:
        """Execute a read query, return list of dicts."""
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return [dict(row) for row in cur.fetchall()]

    def execute_db(self, sql: str, params: tuple = None) -> int:
        """Execute a write query, return affected row count."""
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                conn.commit()
                return cur.rowcount

    def upsert_db(self, sql: str, params: tuple = None) -> int:
        """Execute an upsert (INSERT ON CONFLICT), return affected rows."""
        return self.execute_db(sql, params)

    def llm(self, prompt: str, system: str = None, model: str = None,
            temperature: float = 0.3, max_tokens: int = 4000) -> str:
        """Call LLM via OpenRouter. Returns text response."""
        full_prompt = prompt
        if system:
            full_prompt = f"{system}\n\n{prompt}"
        return llm_call(
            prompt=full_prompt,
            model=model or "qwen/qwen3-235b-a22b-2507",
            temperature=temperature,
            max_tokens=max_tokens,
            activity="Trend Report",
        )

    def llm_json(self, prompt: str, system: str = None, **kwargs) -> dict:
        """Call LLM and parse JSON response."""
        json_system = (system or f"You are a {self.name} agent for Claw Venture Capital.")
        json_system += "\nRespond with valid JSON only. No markdown, no explanation."
        raw = self.llm(prompt, system=json_system, **kwargs)
        # Strip markdown fences if present
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        return json.loads(raw.strip())

    def search_web(self, query: str, count: int = 10) -> list:
        """Search via Brave API. Returns list of results."""
        try:
            return brave_search(query, count=count)
        except Exception as e:
            self.log.warning(f"Web search failed for '{query}': {e}")
            return []

    def write_draft(self, section: str, content: dict, audience: str = "all"):
        """Write a report draft section to the DB (upsert)."""
        sql = """
            INSERT INTO trend_report.report_drafts
                (quarter, audience, section, content_json, agent_id)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (quarter, audience, section) DO UPDATE
                SET content_json = EXCLUDED.content_json,
                    agent_id = EXCLUDED.agent_id,
                    generated_at = NOW()
        """
        self.execute_db(sql, (
            self.quarter, audience, section,
            json.dumps(content, default=str), self.name
        ))
        self.log.info(f"Wrote draft: {section} ({audience})")
