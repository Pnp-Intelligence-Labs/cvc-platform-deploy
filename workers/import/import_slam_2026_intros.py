"""
workers/import/import_slam_2026_intros.py

Imports SLAM Tech 2026 Intros into cvc.partner_intros.

Source: SLAM Tech Data - 2026 Intros (1).csv
Structure: header on line 1 (0-indexed).
  Columns: Duplicate Check, #, Corporation, Startup, Website, Month, Year,
           Tech Focus, Notes/details

Matching strategy (in order):
  1. Website match against cvc.companies.website (most reliable)
  2. Fuzzy name match (threshold 0.72)
  3. If no match and company has a URL → create a stub in cvc.companies

Run:
  python3 workers/import/import_slam_2026_intros.py --dry-run
  python3 workers/import/import_slam_2026_intros.py
"""
import sys, csv, re, argparse
from pathlib import Path
from difflib import SequenceMatcher
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "core"))
from db.connection import get_connection

CSV_PATH = "/mnt/c/Users/nathan/Downloads/SLAM Tech Data - 2026 Intros (1).csv"
HEADER_LINE = 1
SOURCE = "slam_2026"

MONTH_MAP = {
    "january": "01", "jan": "01",
    "february": "02", "feb": "02",
    "march": "03", "mar": "03",
    "april": "04", "apr": "04",
    "may": "05",
    "june": "06", "jun": "06",
    "july": "07", "jul": "07",
    "august": "08", "aug": "08",
    "september": "09", "sep": "09", "sept": "09",
    "october": "10", "oct": "10",
    "november": "11", "nov": "11",
    "december": "12", "dec": "12",
}

CORP_CANONICAL = {
    "DoD Innovation Unit (DIU)":  "DIU",
    "Overmatch (Morgan)":         "Overmatch Ventures",
    "Tokyo Electron (TEL)":       "Tokyo Electron",
    "Cedar Park Government":      "City of Cedar Park",
    "Osceola County Government":  "Osceola County Government",
}

# Hard-wired company_id overrides — fuzzy matching fails on these due to
# short names or common-suffix inflation (e.g. "KoiReader" vs "SoilReader")
STARTUP_OVERRIDE: dict[str, int] = {
    "KoiReader": 295,   # KoiReader Technologies, Inc.
}

# Startups confirmed NOT in the CVC DB — skip fuzzy matching so shared
# suffixes ("robotics", "semiconductors") don't produce false positives
KNOWN_MISSING: set[str] = {
    "ANFT",             # would fuzzy-match Ant Robotics (wrong)
    "Neurath",          # would fuzzy-match NEURA Robotics (wrong)
    "Oso Semiconductors",  # would fuzzy-match Lux Semiconductors (wrong)
    "Bstar Robotics",   # would fuzzy-match Smart Robotics (wrong)
    "Flink Robotics",   # would fuzzy-match Innok Robotics (wrong)
    "Retina Robotics",  # would fuzzy-match Vecna Robotics (wrong)
}


def _normalize_url(url: str) -> str:
    """Strip scheme, www, trailing slashes and query strings for comparison."""
    if not url:
        return ""
    try:
        p = urlparse(url if "://" in url else f"https://{url}")
        host = p.netloc.lower().lstrip("www.")
        path = p.path.rstrip("/")
        return host + path if path else host
    except Exception:
        return url.lower().strip()


def _parse_date(month_str: str, year_str: str) -> str | None:
    mo = MONTH_MAP.get(month_str.strip().lower())
    yr = year_str.strip()
    if mo and yr and len(yr) == 4:
        return f"{yr}-{mo}-01"
    return None


_FUZZY_SUFFIXES = [
    " ai", ".ai", " inc", " inc.", ", inc.", " llc", ".", " labs", " technologies",
    " tech", " robotics", " systems", " tactical solutions", " validation",
    " semiconductors", " industries", " reader", " technologies, inc.",
]

def _fuzzy_match(name: str, companies: list[dict], threshold=0.82) -> int | None:
    name_l = name.lower().strip()
    best_id, best_score = None, 0.0
    for c in companies:
        score = SequenceMatcher(None, name_l, c["name_l"]).ratio()
        if score > best_score:
            best_score, best_id = score, c["id"]
        # Strip common suffixes from the DB name and re-score
        for suffix in _FUZZY_SUFFIXES:
            stripped = c["name_l"].removesuffix(suffix)
            if stripped != c["name_l"]:
                s2 = SequenceMatcher(None, name_l, stripped).ratio()
                if s2 > best_score:
                    best_score, best_id = s2, c["id"]
        # Also strip common suffixes from the CSV name and compare to bare DB name
        for suffix in _FUZZY_SUFFIXES:
            stripped_csv = name_l.removesuffix(suffix)
            if stripped_csv != name_l:
                s3 = SequenceMatcher(None, stripped_csv, c["name_l"]).ratio()
                if s3 > best_score:
                    best_score, best_id = s3, c["id"]
    return best_id if best_score >= threshold else None


def parse_csv(path: str) -> list[dict]:
    with open(path, encoding="utf-8-sig") as f:
        lines = f.readlines()

    reader = csv.DictReader(lines[HEADER_LINE:])
    rows = []
    for r in reader:
        corp    = r.get('Corporation', '').strip()
        startup = r.get('Startup', '').strip()
        month   = r.get('Month', '').strip()
        year    = r.get('Year', '').strip()
        website = r.get('Website', '').strip()

        if not corp or not startup or len(startup) < 2:
            continue

        # Clean up URL query strings (arovia has tracking params)
        if website and '?' in website:
            website = website.split('?')[0].rstrip('/')

        partner_name = CORP_CANONICAL.get(corp, corp)
        intro_date   = _parse_date(month, year)

        rows.append({
            "startup_name": startup,
            "startup_url":  website,
            "partner_name": partner_name,
            "intro_date":   intro_date,
            "source":       SOURCE,
        })

    return rows


def run(dry_run=False):
    rows = parse_csv(CSV_PATH)
    print(f"Parsed {len(rows)} rows from CSV")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, website FROM cvc.companies")
            companies = []
            url_index: dict[str, int] = {}
            for r in cur.fetchall():
                entry = {
                    "id": r["id"],
                    "name": r["name"],
                    "name_l": r["name"].lower(),
                }
                companies.append(entry)
                if r["website"]:
                    norm = _normalize_url(r["website"])
                    if norm:
                        url_index[norm] = r["id"]

    # Build per-startup company_id map (match once, apply to all intros)
    startup_ids: dict[str, int | None] = {}
    stub_created: dict[str, int] = {}

    unique_startups = {}
    for r in rows:
        unique_startups[r["startup_name"]] = r["startup_url"]

    for startup_name, startup_url in unique_startups.items():
        company_id = None

        # 0. Hard-wired override / known-missing skip
        if startup_name in STARTUP_OVERRIDE:
            company_id = STARTUP_OVERRIDE[startup_name]
        elif startup_name in KNOWN_MISSING:
            startup_ids[startup_name] = None
            continue

        # 1. Website match
        if company_id is None and startup_url:
            norm = _normalize_url(startup_url)
            company_id = url_index.get(norm)

        # 2. Fuzzy name match
        if company_id is None:
            company_id = _fuzzy_match(startup_name, companies)

        # 3. Create stub if we have a URL
        if company_id is None and startup_url and not dry_run:
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO cvc.companies (name, website, enrichment_status, enrichment_source)
                        VALUES (%s, %s, 'pending', 'slam_2026_import')
                        ON CONFLICT DO NOTHING
                        RETURNING id
                    """, (startup_name, startup_url))
                    new_row = cur.fetchone()
                    if new_row:
                        company_id = new_row["id"]
                        stub_created[startup_name] = company_id
                        # Add to url_index so duplicates in this run reuse the same id
                        url_index[_normalize_url(startup_url)] = company_id
                        companies.append({"id": company_id, "name": startup_name, "name_l": startup_name.lower()})
                    conn.commit()

        startup_ids[startup_name] = company_id

    inserted = skipped = unmatched = 0

    with get_connection() as conn:
        for r in rows:
            company_id = startup_ids.get(r["startup_name"])
            if company_id is None:
                unmatched += 1

            if dry_run:
                match_src = ""
                if company_id and r["startup_url"] and _normalize_url(r["startup_url"]) in url_index:
                    match_src = f"[url→{company_id}]"
                elif company_id:
                    match_src = f"[fuzzy→{company_id}]"
                else:
                    match_src = "[NO MATCH]"
                date_label = r["intro_date"] or "DATE UNKNOWN"
                print(f"  {r['partner_name']:<40} {r['startup_name']:<30} {date_label} {match_src}")
                inserted += 1
                continue

            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO cvc.partner_intros
                        (company_id, partner_id, startup_name, partner_name,
                         intro_date, intro_type, source)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (startup_name, partner_name, intro_date) DO UPDATE
                        SET company_id = EXCLUDED.company_id
                    RETURNING id
                """, (
                    company_id, None, r["startup_name"], r["partner_name"],
                    r["intro_date"], "Startup Intro", SOURCE,
                ))
                row = cur.fetchone()
                if row:
                    inserted += 1
                else:
                    skipped += 1

        if not dry_run:
            conn.commit()

    print()
    print(f"{'DRY RUN — ' if dry_run else ''}Results:")
    print(f"  Inserted/updated:  {inserted}")
    print(f"  Skipped (dup):     {skipped}")
    print(f"  Unmatched (no URL):{unmatched}")
    if stub_created:
        print(f"  Stubs created:     {len(stub_created)}")
        for name, cid in stub_created.items():
            print(f"    {name} → company_id={cid}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
