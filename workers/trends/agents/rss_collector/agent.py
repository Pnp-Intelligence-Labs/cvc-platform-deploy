"""RSS Collector — scrapes RSS feeds + Scrapling-based web sources, tags by sector."""

import sys
from pathlib import Path

import feedparser
import json
from datetime import datetime

from agents.base import BaseAgent
from web.scrapling import fetch as scrapling_fetch


# Sector keyword map for auto-tagging
SECTOR_KEYWORDS = {
    "robotics": [
        "robot", "robotics", "humanoid", "cobot", "AMR", "AGV",
        "dexterous", "manipulation", "actuator", "ROS", "lidar",
        "autonomous mobile", "pick and place", "palletizing"
    ],
    "supply_chain": [
        "supply chain", "logistics", "warehouse", "fulfillment",
        "last mile", "freight", "3PL", "WMS", "TMS", "inventory",
        "distribution center", "cold chain"
    ],
    "industrial_auto": [
        "industrial automation", "manufacturing", "PLC", "SCADA",
        "digital twin", "predictive maintenance", "quality inspection",
        "machine vision", "process automation", "factory"
    ],
    "physical_ai": [
        "physical AI", "embodied AI", "foundation model",
        "world model", "sim-to-real", "reinforcement learning",
        "VLA", "vision language action", "robot learning",
        "imitation learning", "teleoperation"
    ],
}


class RSSCollector(BaseAgent):
    name = "rss_collector"
    description = "Scrapes RSS feeds + web sources via Scrapling, tags by sector"

    def run(self) -> dict:
        base = Path("agents/rss_collector")

        # RSS feeds
        feeds_path = Path(self.manifest.get("rss_feeds_file", str(base / "feeds.json")))
        with open(feeds_path) as f:
            feeds = json.load(f)

        # Scraped sources (no RSS)
        scraped_path = base / "scraped_sources.json"
        scraped_sources = json.loads(scraped_path.read_text()) if scraped_path.exists() else []

        rss_new = rss_failed = 0
        scrape_new = scrape_failed = 0
        errors = []

        # --- RSS feeds ---
        for feed_config in feeds:
            try:
                count = self._process_feed(feed_config)
                rss_new += count
            except Exception as e:
                self.log.warning(f"Feed failed: {feed_config['name']}: {e}")
                errors.append({"source": feed_config["name"], "type": "rss", "error": str(e)})
                rss_failed += 1

        # --- Scraped sources ---
        for source in scraped_sources:
            try:
                count = self._process_scraped(source)
                scrape_new += count
            except Exception as e:
                self.log.warning(f"Scrape failed: {source['name']}: {e}")
                errors.append({"source": source["name"], "type": "scrape", "error": str(e)})
                scrape_failed += 1

        return {
            "rss_new_signals": rss_new,
            "rss_feeds_ok": len(feeds) - rss_failed,
            "rss_feeds_failed": rss_failed,
            "scrape_new_signals": scrape_new,
            "scrape_sources_ok": len(scraped_sources) - scrape_failed,
            "scrape_sources_failed": scrape_failed,
            "total_new_signals": rss_new + scrape_new,
            "errors": errors,
        }

    # ── RSS processing ────────────────────────────────────────────────────────

    def _process_feed(self, feed_config: dict) -> int:
        url = feed_config["url"]
        feed_name = feed_config["name"]
        feed_sectors = feed_config.get("sectors", [])

        self.log.info(f"RSS: {feed_name}")
        parsed = feedparser.parse(url)

        if parsed.bozo and not parsed.entries:
            raise ValueError(f"Feed parse error: {parsed.bozo_exception}")

        new_count = 0
        for entry in parsed.entries:
            title = entry.get("title", "").strip()
            link = entry.get("link", "").strip()
            summary = entry.get("summary", "").strip()
            published = entry.get("published_parsed")

            if not title or not link:
                continue

            pub_date = None
            if published:
                pub_date = datetime(*published[:6])

            text = f"{title} {summary}".lower()
            detected_sectors = self._detect_sectors(text, feed_sectors)
            if not detected_sectors:
                continue

            sql = """
                INSERT INTO trend_report.raw_signals
                    (source_type, source_name, source_url, title, content,
                     published_at, sector_tags, signal_type, quarter)
                VALUES ('rss', %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (source_url) DO NOTHING
            """
            quarter = f"Q{((pub_date.month - 1) // 3) + 1}-{pub_date.year}"
            rows = self.upsert_db(sql, (
                feed_name, link, title, summary[:5000],
                pub_date, detected_sectors,
                self._classify_signal(text), quarter
            ))
            new_count += rows

        self.log.info(f"  {feed_name}: {new_count} new")
        return new_count

    # ── Scrapling processing ──────────────────────────────────────────────────

    def _process_scraped(self, source: dict) -> int:
        url = source["url"]
        source_name = source["name"]
        source_sectors = source.get("sectors", [])

        self.log.info(f"Scraping: {source_name}")
        result = scrapling_fetch(url, pipeline="trend_report", agent="rss_collector")

        if result.get("status") != "ok" or not result.get("text"):
            raise ValueError(f"Scrape returned no content ({result.get('status')})")

        page_text = result["text"]

        # Use LLM to extract individual articles/items from the page
        prompt = f"""Extract news articles or blog posts from this web page content.
Source: {source_name} ({url})

For each article or post found, return:
- title: headline or title
- url: link to the article (construct full URL if relative)
- summary: 1-2 sentence description of the content
- published: date string if visible, null otherwise

Return a JSON array of up to 20 items. Only include items relevant to:
robotics, automation, supply chain, industrial technology, AI, or manufacturing policy.
If no relevant items found, return [].

Page content:
{page_text[:6000]}"""

        try:
            articles = self.llm_json(prompt, temperature=0.1, max_tokens=2000)
        except Exception as e:
            self.log.warning(f"  LLM extraction failed for {source_name}: {e}")
            return 0

        if not isinstance(articles, list):
            return 0

        new_count = 0
        for article in articles:
            title = (article.get("title") or "").strip()
            link = (article.get("url") or "").strip()
            summary = (article.get("summary") or "").strip()

            if not title or not link:
                continue

            # Parse date if present
            pub_date = None
            if article.get("published"):
                try:
                    pub_date = datetime.fromisoformat(article["published"].replace("Z", ""))
                except Exception:
                    pass

            text = f"{title} {summary}".lower()
            detected_sectors = self._detect_sectors(text, source_sectors)
            if not detected_sectors:
                continue

            sql = """
                INSERT INTO trend_report.raw_signals
                    (source_type, source_name, source_url, title, content,
                     published_at, sector_tags, signal_type, quarter)
                VALUES ('scraped', %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (source_url) DO NOTHING
            """
            quarter = f"Q{((pub_date.month - 1) // 3) + 1}-{pub_date.year}"
            rows = self.upsert_db(sql, (
                source_name, link, title, summary[:5000],
                pub_date, detected_sectors,
                self._classify_signal(text), quarter
            ))
            new_count += rows

        self.log.info(f"  {source_name}: {new_count} new")
        return new_count

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _detect_sectors(self, text: str, base_sectors: list) -> list:
        detected = base_sectors.copy()
        for sector, keywords in SECTOR_KEYWORDS.items():
            if sector not in detected and any(kw.lower() in text for kw in keywords):
                detected.append(sector)
        return detected

    def _classify_signal(self, text: str) -> str:
        checks = [
            ("funding",    ["raised", "funding", "series", "seed round", "investment", "valuation", "ipo"]),
            ("deployment", ["deployed", "deployment", "rolled out", "launched", "production", "commercial"]),
            ("partnership",["partnership", "collaboration", "joint venture", "signed", "contract"]),
            ("product",    ["released", "announced", "new product", "unveiled", "prototype"]),
            ("policy",     ["regulation", "policy", "tariff", "export control", "legislation", "standard"]),
        ]
        for signal_type, keywords in checks:
            if any(kw in text for kw in keywords):
                return signal_type
        return "general"
