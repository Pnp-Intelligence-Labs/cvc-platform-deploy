"""Patent Monitor — queries Google Patents for new filings in target IPC codes.

Uses the Google Patents XHR query endpoint (no API key required).
Replaced discontinued USPTO PatentsView API (api.patentsview.org, gone 2026).
PatentsView v4 (search.patentsview.org) requires a key — new key grants suspended as of 2026-03.
"""

import sys
from pathlib import Path

import requests
from agents.base import BaseAgent


class PatentMonitor(BaseAgent):
    name = "patent_monitor"
    description = "Monitors Google Patents for new filings in target IPC codes"

    GOOGLE_PATENTS_URL = "https://patents.google.com/xhr/query"

    IPC_SECTOR_MAP = {
        "B25J": ["robotics"],
        "G05B": ["industrial_auto"],
        "B65G": ["supply_chain"],
        "G06Q": ["supply_chain", "industrial_auto"],
        "G06N": ["physical_ai", "robotics"],
    }

    def run(self) -> dict:
        ipc_codes = self.manifest.get("ipc_codes", list(self.IPC_SECTOR_MAP.keys()))
        total = 0
        errors = []

        for ipc in ipc_codes:
            try:
                count = self._search_patents_google(ipc)
                total += count
            except Exception as e:
                self.log.warning(f"Patent search failed for {ipc}: {e}")
                errors.append({"ipc": ipc, "error": str(e)})

        return {"new_patents": total, "ipc_codes_searched": len(ipc_codes), "errors": errors}

    def _search_patents_google(self, ipc_code: str) -> int:
        """Search for patents via Google Patents XHR endpoint."""
        date_start = self.date_start.replace("-", "")
        date_end = self.date_end.replace("-", "")
        url = f"{self.GOOGLE_PATENTS_URL}?url=q%3DIPC%3A{ipc_code}%26before%3Dpriority%3A{date_end}%26after%3Dpriority%3A{date_start}"

        try:
            response = requests.get(
                url,
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
        except requests.RequestException as e:
            self.log.warning(f"Google Patents request failed for {ipc_code}: {e}")
            return 0

        results = data.get("results", {})
        total_found = results.get("total_num_results", 0)
        patents = results.get("cluster", [{}])[0].get("result", [])

        if not patents:
            self.log.info(f"IPC {ipc_code}: 0 patents found")
            return 0

        sectors = self.IPC_SECTOR_MAP.get(ipc_code, [])
        count = 0

        for item in patents:
            pat = item.get("patent", {})
            patent_id = item.get("id", "")
            # id format: "patent/US1234567B2/en" — extract number
            patent_number = patent_id.split("/")[1] if "/" in patent_id else patent_id
            assignee = pat.get("assignee", "Unknown") or "Unknown"

            sql = """
                INSERT INTO trend_report.patent_signals
                    (company_name, assignee, patent_number, title, abstract,
                     ipc_codes, filing_date, publication_date, sector_tags, quarter)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (patent_number) DO NOTHING
            """
            try:
                rows = self.upsert_db(sql, (
                    assignee, assignee,
                    patent_number,
                    pat.get("title", ""),
                    pat.get("abstract", None),
                    [ipc_code],
                    pat.get("priority_date"),
                    pat.get("publication_date") or pat.get("priority_date"),
                    sectors,
                    self.quarter,
                ))
                count += rows
            except Exception as e:
                self.log.warning(f"Patent insert failed ({patent_number}): {e}")

        self.log.info(f"IPC {ipc_code}: {total_found} found, {count} new")
        return count
