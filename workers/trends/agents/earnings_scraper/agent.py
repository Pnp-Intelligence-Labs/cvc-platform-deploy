"""Earnings Scraper — extracts robotics/automation mentions from public company transcripts."""

import sys
from pathlib import Path

import json
from agents.base import BaseAgent


EXTRACTION_KEYWORDS = [
    "robot", "robotics", "automation", "autonomous", "AI",
    "artificial intelligence", "machine learning", "computer vision",
    "warehouse", "supply chain", "fulfillment", "logistics",
    "digital twin", "predictive maintenance", "cobot",
    "AMR", "AGV", "humanoid", "dexterous",
]


class EarningsScraper(BaseAgent):
    name = "earnings_scraper"
    description = "Extracts automation/robotics mentions from earnings transcripts"

    def run(self) -> dict:
        tickers = self.manifest.get("target_public_companies", [])
        total = 0
        errors = []

        for ticker in tickers:
            try:
                count = self._process_ticker(ticker)
                total += count
            except Exception as e:
                self.log.warning(f"Ticker {ticker} failed: {e}")
                errors.append({"ticker": ticker, "error": str(e)})

        return {"transcripts_processed": total, "tickers": len(tickers), "errors": errors}

    def _process_ticker(self, ticker: str) -> int:
        # Search for recent earnings transcript
        query = f"{ticker} earnings call transcript Q1 Q2 2026"
        results = self.search_web(query, count=5)

        if not results:
            return 0

        # Get the most relevant transcript content
        snippets = "\n\n".join([
            f"Source: {r.get('title', '')}\nURL: {r.get('url', '')}\n{r.get('description', '')}"
            for r in results[:3]
        ])

        prompt = f"""Analyze these earnings call search results for {ticker}.
Extract any mentions related to: robotics, automation, AI, supply chain technology,
warehouse automation, manufacturing automation, digital transformation.

For each relevant mention, provide:
- keyword: the technology/topic mentioned
- context: one sentence of context
- sentiment: bullish, neutral, or bearish (regarding their automation investment)

Also provide:
- overall_sentiment: bullish, neutral, or bearish
- sector_relevance: primary sector from [robotics, supply_chain, industrial_auto, physical_ai]
- summary: 2-3 sentence summary of their automation/robotics stance

Return JSON:
{{
    "mentions": [{{"keyword": "...", "context": "...", "sentiment": "..."}}],
    "overall_sentiment": "...",
    "sector_relevance": "...",
    "summary": "..."
}}

If no relevant mentions found, return {{"mentions": [], "overall_sentiment": "neutral", "sector_relevance": null, "summary": "No relevant mentions found."}}

Search results:
{snippets}"""

        try:
            data = self.llm_json(prompt, temperature=0.2)
        except Exception:
            return 0

        if not data.get("mentions"):
            return 0

        transcript_date = self.date_end  # approximate

        sql = """
            INSERT INTO trend_report.earnings_signals
                (company_name, ticker, transcript_date, mentions,
                 overall_sentiment, sector_relevance, llm_summary, quarter)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (ticker, transcript_date) DO UPDATE
            SET mentions = EXCLUDED.mentions,
                overall_sentiment = EXCLUDED.overall_sentiment,
                llm_summary = EXCLUDED.llm_summary
        """
        return self.upsert_db(sql, (
            ticker, ticker, transcript_date,
            json.dumps(data.get("mentions", [])),
            data.get("overall_sentiment"),
            data.get("sector_relevance"),
            data.get("summary"),
            self.quarter,
        ))
