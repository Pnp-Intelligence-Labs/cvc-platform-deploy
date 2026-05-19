"""Jobs Tracker — snapshots hiring velocity for tracked companies."""

import sys
from pathlib import Path

from agents.base import BaseAgent
from datetime import date


class JobsTracker(BaseAgent):
    name = "jobs_tracker"
    description = "Bi-weekly hiring snapshots per company"

    def run(self) -> dict:
        # Get companies to track (top scored + recently funded)
        companies = self.query_db("""
            SELECT id, name, website FROM cvc.companies
            WHERE sector = ANY(%s)
            AND (score_composite IS NOT NULL OR latest_round_date > %s::date)
            ORDER BY score_composite DESC NULLS LAST
            LIMIT 200
        """, (self.sectors, self.date_start))

        total = 0
        errors = []
        today = date.today().isoformat()

        for company in companies:
            try:
                count = self._snapshot_company(company, today)
                total += count
            except Exception as e:
                errors.append({"company": company["name"], "error": str(e)})

        return {"companies_checked": len(companies), "new_snapshots": total, "errors": errors}

    def _snapshot_company(self, company: dict, snapshot_date: str) -> int:
        name = company["name"]

        # Search for job listings
        results = self.search_web(f'"{name}" careers OR jobs OR hiring site:linkedin.com OR site:greenhouse.io', count=5)
        if not results:
            results = self.search_web(f'"{name}" open positions hiring', count=5)

        if not results:
            return 0

        # Use LLM to estimate role count and categories from search results
        snippets = "\n".join([
            f"- {r.get('title', '')}: {r.get('description', '')}"
            for r in results[:5]
        ])

        prompt = f"""Based on these search results about {name}'s hiring:

{snippets}

Estimate:
1. role_count: approximate number of open roles (integer, 0 if no evidence of hiring)
2. role_categories: list of categories from [engineering, sales, operations, research, manufacturing, other]

Return JSON: {{"role_count": 0, "role_categories": []}}
If you cannot determine hiring activity, return {{"role_count": 0, "role_categories": []}}"""

        try:
            data = self.llm_json(prompt, temperature=0.1, max_tokens=500)
        except Exception:
            return 0

        role_count = data.get("role_count", 0)
        if role_count == 0:
            return 0

        sql = """
            INSERT INTO trend_report.hiring_signals
                (company_name, company_id, role_count, role_categories,
                 snapshot_date, quarter)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (company_name, snapshot_date) DO UPDATE
            SET role_count = EXCLUDED.role_count,
                role_categories = EXCLUDED.role_categories
        """
        return self.upsert_db(sql, (
            name, company.get("id"), role_count,
            data.get("role_categories", []),
            snapshot_date, self.quarter
        ))
