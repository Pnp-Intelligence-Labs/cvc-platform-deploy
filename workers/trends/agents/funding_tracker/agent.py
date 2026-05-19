"""Funding Tracker — discovers funding rounds via raw signals + LLM extraction.

No Brave search required. Two sources:
  1. raw_signals already collected for this quarter (RSS + scrape)
  2. Direct Scrapling of known company websites from cvc.companies
"""

import re
import sys
from pathlib import Path

import json
from datetime import datetime

from agents.base import BaseAgent

FUNDING_KEYWORDS = re.compile(
    r"\b(raised|funding|series [abcde]|seed round|pre-seed|grant|acqui|"
    r"million|billion|investment|investor|venture|backed|valued)\b",
    re.IGNORECASE,
)

_HTML_TAG = re.compile(r"<[^>]+>")


def _strip_html(text: str) -> str:
    return re.sub(r"\s+", " ", _HTML_TAG.sub(" ", text or "")).strip()


class FundingTracker(BaseAgent):
    name = "funding_tracker"
    description = "Tracks funding rounds and M&A via raw signals + Scrapling (no Brave)"

    BATCH_SIZE = 15  # signals per LLM call

    def run(self) -> dict:
        total_events = 0
        all_errors = []

        # Source 1: mine existing raw_signals for this quarter
        try:
            signal_events = self._extract_from_existing_signals()
            total_events += signal_events
            self.log.info(f"Signals pass: {signal_events} events")
        except Exception as e:
            self.log.warning(f"Signal extraction failed: {e}")
            all_errors.append(str(e))

        # Source 2: scrape known company websites directly
        try:
            scrape_events = self._check_known_companies()
            total_events += scrape_events
            self.log.info(f"Company scrape pass: {scrape_events} events")
        except Exception as e:
            self.log.warning(f"Company scrape failed: {e}")
            all_errors.append(str(e))

        return {"new_events": total_events, "errors": all_errors}

    def _extract_from_existing_signals(self) -> int:
        """Mine raw_signals already collected this quarter — zero search calls."""
        signals = self.query_db("""
            SELECT id, source_name, source_url, title, content
            FROM trend_report.raw_signals
            WHERE quarter = %s
            ORDER BY id
        """, (self.quarter,))

        if not signals:
            self.log.info("No raw_signals found for quarter")
            return 0

        self.log.info(f"Processing {len(signals)} signals for funding events")
        total = 0

        # Process in batches
        for i in range(0, len(signals), self.BATCH_SIZE):
            batch = signals[i:i + self.BATCH_SIZE]
            snippets = []
            for s in batch:
                text = _strip_html(s["content"])[:400]
                snippets.append(
                    f"Title: {s['title']}\n"
                    f"Snippet: {text}\n"
                    f"URL: {s['source_url'] or ''}"
                )

                # For funding-keyword matches, Scrapling-fetch full article
                if s["source_url"] and FUNDING_KEYWORDS.search(s["title"] or ""):
                    try:
                        from web.scrapling import fetch as scrapling_fetch
                        page = scrapling_fetch(s["source_url"])
                        if page.get("status") == "ok" and page.get("text"):
                            full_text = page["text"][:1500]
                            snippets[-1] = (
                                f"Title: {s['title']}\n"
                                f"Snippet: {full_text}\n"
                                f"URL: {s['source_url']}"
                            )
                    except Exception:
                        pass  # fall back to short snippet

            total += self._llm_extract_and_save(snippets, self.sectors[0] if self.sectors else "robotics")

        return total

    def _check_known_companies(self) -> int:
        """Scrape company websites directly instead of searching for them."""
        try:
            companies = self.query_db("""
                SELECT name, website, sector FROM cvc.companies
                WHERE stage IN ('seed', 'series_a', 'series_b', 'pre_seed')
                AND sector = ANY(%s)
                AND website IS NOT NULL AND website != ''
                ORDER BY RANDOM() LIMIT 30
            """, (self.sectors,))
        except Exception as e:
            self.log.warning(f"Could not fetch known companies: {e}")
            return 0

        total = 0
        from web.scrapling import fetch as scrapling_fetch

        for company in companies:
            try:
                page = scrapling_fetch(company["website"])
                if page.get("status") != "ok" or not page.get("text"):
                    continue
                text = page["text"][:2000]
                if not FUNDING_KEYWORDS.search(text):
                    continue  # skip if no funding language on homepage
                snippets = [
                    f"Title: {company['name']} website\n"
                    f"Snippet: {text}\n"
                    f"URL: {company['website']}"
                ]
                total += self._llm_extract_and_save(snippets, company.get("sector", "robotics"))
            except Exception:
                continue

        return total

    def _llm_extract_and_save(self, snippets: list, default_sector: str) -> int:
        """Run LLM extraction on a list of snippets and save results."""
        if not snippets:
            return 0

        combined = "\n---\n".join(snippets)
        prompt = f"""Extract funding events from these articles/snippets.
For each funding event found, return:
- company_name: the company that raised
- round_type: seed, series_a, series_b, series_c, grant, acquisition, or other
- amount_usd: integer in USD (null if undisclosed)
- investors: list of investor names
- event_date: YYYY-MM-DD if available, null otherwise
- source_url: the URL where this was found
- sector_tags: list from [robotics, supply_chain, industrial_auto, physical_ai]

Return a JSON array. Only include events from {self.date_start} to {self.date_end}.
If no funding events found, return [].

Articles:
{combined}"""

        system = """You are a funding data extraction agent for a venture capital firm.
Extract structured funding event data from news snippets.
Be precise about amounts. Convert "million" to full numbers (e.g. $50M = 50000000).
Only include events you are confident about. Do not hallucinate events."""

        try:
            events = self.llm_json(prompt, system=system)
        except (json.JSONDecodeError, Exception) as e:
            self.log.warning(f"LLM extraction failed: {e}")
            return 0

        if not isinstance(events, list):
            return 0

        count = 0
        for event in events:
            try:
                company_id = self._match_company(event.get("company_name", ""))
                sql = """
                    INSERT INTO trend_report.funding_events
                        (company_name, company_id, round_type, amount_usd,
                         investors, event_date, source_url, sector_tags, quarter)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (company_name, round_type, quarter) DO NOTHING
                """
                rows = self.upsert_db(sql, (
                    event.get("company_name"),
                    company_id,
                    event.get("round_type"),
                    event.get("amount_usd"),
                    event.get("investors", []),
                    event.get("event_date"),
                    event.get("source_url"),
                    event.get("sector_tags", [default_sector]),
                    self.quarter,
                ))
                count += rows
            except Exception as e:
                self.log.warning(f"Failed to insert event: {e}")

        return count

    def _match_company(self, name: str):
        """Try to find company in cvc.companies by name."""
        if not name:
            return None
        rows = self.query_db(
            "SELECT id FROM cvc.companies WHERE LOWER(name) = LOWER(%s) LIMIT 1",
            (name,)
        )
        return rows[0]["id"] if rows else None
