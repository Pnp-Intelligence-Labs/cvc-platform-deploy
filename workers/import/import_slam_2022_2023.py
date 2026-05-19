"""
workers/import/import_slam_2022_2023.py

Imports SLAM Tech 2022-2023 partner engagement data into cvc.partner_intros.

Source: SLAM Tech Data - Monday 2022 - 2023.csv
Structure: partner sections with date ranges, each containing Startup Intro rows.

Date handling:
  - Exact date present (YYYY-MM-DD)  → stored as intro_date
  - Only year present (2022/2023/...) → stored as YYYY-01-01 (approximate, year known)
  - Year = 1899 (Excel blank artifact) → stored as NULL (date unknown)

Run:
  python3 workers/import/import_slam_2022_2023.py --dry-run
  python3 workers/import/import_slam_2022_2023.py
"""
import sys, re, csv, argparse
from pathlib import Path
from difflib import SequenceMatcher

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "core"))
from db.connection import get_connection

CSV_PATH = "/mnt/c/Users/nathan/Downloads/SLAM Tech Data - Monday 2022 - 2023.csv"
SOURCE   = "slam_2022_2023"

# ── Partner mapping: CSV section name → (partner_id, canonical DB name) ──────
PARTNER_MAP = {
    "Brambles":           (27, "Brambles Holdings (UK) Limited"),
    "ArcBest":            (65, "ArcBest"),
    "JB Hunt":            (None, "JB Hunt"),          # not in partners DB
    "Georgia Pacific":    (76, "Georgia Pacific"),
    "BNSF":               (None, "BNSF"),              # not in partners DB
    "Crowley":            (28, "Crowley Maritime Corporation"),
    "General Mils":       (31, "General Mills Inc."),  # CSV typo
    "Colgate":            (66, "Colgate-Palmolive"),
    "Walmart":            (45, "Walmart"),
    "Volvo Group":        (44, "Volvo Group North America, LLC"),
    "TJX":                (68, "TJX"),
    "Holman":             (33, "Holman Strategic Investments, LLC"),
    "Yamato":             (70, "Yamato"),
    "Japan Post":         (43, "Japan Post Co., Ltd."),
    "Mitsubishi Electric":(6,  "Mitsubishi Electric"),
    "Maersk":             (69, "Maersk"),
    "CJ Corporation":     (None, "CJ Corporation"),    # not in partners DB
    "Intel":              (23, "Intel"),
}

# Abbreviations/shorthands used in "<>" rows to identify the partner side
PARTNER_ALIASES = {
    "Brambles":    ["brambles", "brambls"],
    "ArcBest":     ["arcbest", "arc best"],
    "JB Hunt":     ["jb hunt", "jbh", "jb hunt"],
    "Georgia Pacific": ["georgia pacific", "gp", "g.p."],
    "BNSF":        ["bnsf"],
    "Crowley":     ["crowley"],
    "General Mils": ["general mills", "general mils", "gen mills"],
    "Colgate":     ["colgate"],
    "Walmart":     ["walmart", "wmt"],
    "Volvo Group": ["volvo", "volvo group"],
    "TJX":         ["tjx"],
    "Holman":      ["holman"],
    "Yamato":      ["yamato"],
    "Japan Post":  ["japan post", "jp"],
    "Mitsubishi Electric": ["mitsubishi", "mitsubishi electric"],
    "Maersk":      ["maersk"],
    "CJ Corporation": ["cj corporation", "cj corp", "cj"],
    "Intel":       ["intel"],
}


_JUNK_STARTUP_RE = re.compile(
    r'^startup intro(\s*&.*)?$'              # blank/placeholder name
    r'|in-person'                            # event description
    r'|\d+\s*\+\s*startups'                 # "20 + Startups Intro'd..."
    r'|intro\'d to'                          # "Startups Intro'd to..."
    r'|camm introduction'                    # non-startup description
    r'|connecting to'                        # "Connecting to Throughput"
    r'|gacw intro'                           # internal note
    r'|\(apac\)',                            # region tag
    re.I
)

def _extract_startup(raw_name: str, partner_key: str) -> str | None:
    """
    Extract the startup name from various intro row formats.
    Returns None if the row is junk (event description, blank placeholder, etc.).
    """
    name = raw_name.strip()

    # Early junk filter
    if _JUNK_STARTUP_RE.search(name) or len(name) > 60:
        return None

    # "Intro to X" / "Introduction to X"
    if re.match(r'^intro(?:duction)?\s+to\s+', name, re.I):
        return re.sub(r'^intro(?:duction)?\s+to\s+', '', name, flags=re.I).strip()

    # "Intros to X"
    if re.match(r'^intros?\s+to\s+', name, re.I):
        return re.sub(r'^intros?\s+to\s+', '', name, flags=re.I).strip()

    # "Introduced [(...)] to X"
    if re.match(r'^introduced(?:\s+\([^)]+\))?\s+to\s+', name, re.I):
        return re.sub(r'^introduced(?:\s+\([^)]+\))?\s+to\s+', '', name, flags=re.I).strip()

    # Strip "Summit N-N: " or "Summit: " prefix, then fall through
    name = re.sub(r'^Summit\s*[\d\-]*\s*:?\s*', '', name, flags=re.I).strip()

    # "X Intro" suffix — strip trailing " Intro"
    name = re.sub(r'\s+Intro\s*$', '', name, flags=re.I).strip()

    if '<>' in name:
        parts = [p.strip() for p in name.split('<>', 1)]
        left  = re.sub(r'\s*\(archive\)\s*$', '', parts[0], flags=re.I).strip()
        right = re.sub(r'\s*\(archive\)\s*$', '', parts[1], flags=re.I).strip() if len(parts) > 1 else ''
        aliases = PARTNER_ALIASES.get(partner_key, [partner_key.lower()])
        left_l, right_l = left.lower(), right.lower()
        left_is_partner  = any(a in left_l  or left_l  in a for a in aliases)
        right_is_partner = any(a in right_l or right_l in a for a in aliases)
        if left_is_partner and not right_is_partner:
            return right
        if right_is_partner and not left_is_partner:
            return left
        return right if partner_key.lower() in left_l else left

    return name if name else None


def _parse_date(date_str: str, year_str: str):
    """
    Returns (intro_date_str_or_None, date_is_approximate: bool).
    - Exact date → "YYYY-MM-DD", False
    - Year only  → "YYYY-01-01", True
    - Unknown    → None, True
    """
    if date_str and re.match(r'\d{4}-\d{2}-\d{2}', date_str):
        return date_str, False
    try:
        yr = int(year_str)
        if 2000 <= yr <= 2030:
            return f"{yr}-01-01", True
    except (ValueError, TypeError):
        pass
    return None, True


def _fuzzy_match(name: str, companies: list[dict], threshold=0.72) -> int | None:
    """Fuzzy match startup name → company_id. Returns None if no good match."""
    name_l = name.lower().strip()
    best_id, best_score = None, 0.0
    for c in companies:
        score = SequenceMatcher(None, name_l, c["name_l"]).ratio()
        if score > best_score:
            best_score, best_id = score, c["id"]
        # Also try without common suffixes
        for suffix in [' ai', '.ai', ' inc', '.', ' labs', ' technologies', ' tech']:
            stripped = c["name_l"].removesuffix(suffix)
            s2 = SequenceMatcher(None, name_l, stripped).ratio()
            if s2 > best_score:
                best_score, best_id = s2, c["id"]
    return best_id if best_score >= threshold else None


def parse_csv(path: str) -> list[dict]:
    """Parse the SLAM CSV and return a list of intro dicts."""
    with open(path, encoding="utf-8-sig") as f:
        lines = f.readlines()

    current_partner_key = None
    rows = []
    seen_null_date = set()   # dedup (startup_lower, partner_key) for NULL-date rows

    for line in lines:
        cols = [c.strip() for c in line.rstrip("\n").split(",")]
        raw      = cols[0]
        type_col = cols[1] if len(cols) > 1 else ""
        status   = cols[2] if len(cols) > 2 else ""
        date_col = cols[3] if len(cols) > 3 else ""
        year_col = cols[4] if len(cols) > 4 else ""

        # Detect partner section header (has date range in first column, rest blank)
        if re.search(r"\d{1,2}/\d{1,2}/\d{4}", raw) and type_col == "":
            m = re.match(r"^(.+?)\s+\d{1,2}/\d{1,2}/\d{4}", raw)
            if m:
                candidate = m.group(1).strip()
                # Strip "(Archive)" suffix from section names
                candidate = re.sub(r"\s*\(archive\)\s*$", "", candidate, flags=re.I).strip()
                current_partner_key = candidate if candidate in PARTNER_MAP else None
            continue

        if not current_partner_key or type_col != "Startup Intro":
            continue

        startup_name = _extract_startup(raw, current_partner_key)
        if not startup_name or len(startup_name) < 2:
            continue

        intro_date, approximate = _parse_date(date_col, year_col)
        partner_id, partner_canonical = PARTNER_MAP[current_partner_key]

        # Dedup NULL-date rows: same startup + partner with no date → keep first occurrence
        if intro_date is None:
            dedup_key = (startup_name.lower(), current_partner_key)
            if dedup_key in seen_null_date:
                continue
            seen_null_date.add(dedup_key)

        rows.append({
            "startup_name":   startup_name,
            "partner_key":    current_partner_key,
            "partner_name":   partner_canonical,
            "partner_id":     partner_id,
            "intro_date":     intro_date,
            "approximate":    approximate,
            "status":         status,
            "source":         SOURCE,
        })

    return rows


def run(dry_run=False):
    rows = parse_csv(CSV_PATH)
    print(f"Parsed {len(rows)} startup intro rows from CSV")

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Load all companies for fuzzy matching
            cur.execute("SELECT id, name FROM cvc.companies")
            companies = [{"id": r["id"], "name": r["name"], "name_l": r["name"].lower()} for r in cur.fetchall()]

        inserted = skipped = unmatched_company = unmatched_partner = 0
        no_date = 0
        approx_date = 0
        company_nulls = []
        partner_nulls = []

        for r in rows:
            company_id = _fuzzy_match(r["startup_name"], companies)
            if company_id is None:
                unmatched_company += 1
                company_nulls.append(r["startup_name"])

            if r["partner_id"] is None:
                unmatched_partner += 1
                if r["partner_key"] not in [x["partner_key"] for x in partner_nulls]:
                    partner_nulls.append({"partner_key": r["partner_key"], "partner_name": r["partner_name"]})

            if r["intro_date"] is None:
                no_date += 1
            elif r["approximate"]:
                approx_date += 1

            if dry_run:
                date_label = r["intro_date"] if r["intro_date"] else "DATE UNKNOWN"
                approx_flag = " [approx]" if r["approximate"] and r["intro_date"] else ""
                match_flag = f" → company_id={company_id}" if company_id else " → NO MATCH"
                print(f"  {r['partner_name']:<40} {r['startup_name']:<30} {date_label}{approx_flag}{match_flag}")
                inserted += 1
                continue

            # Insert — ON CONFLICT on (startup_name, partner_name, intro_date) DO NOTHING
            # For NULL intro_date rows, no conflict detection possible — rely on source uniqueness
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO cvc.partner_intros
                        (company_id, partner_id, startup_name, partner_name,
                         intro_date, intro_type, status_1, source)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (startup_name, partner_name, intro_date) DO NOTHING
                    RETURNING id
                """, (
                    company_id,
                    r["partner_id"],
                    r["startup_name"],
                    r["partner_name"],
                    r["intro_date"],
                    "Startup Intro",
                    r["status"],
                    SOURCE,
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
    print(f"  Inserted:          {inserted}")
    print(f"  Skipped (dup):     {skipped}")
    print(f"  Unmatched company: {unmatched_company} (stored with company_id=NULL)")
    print(f"  No partner in DB:  {unmatched_partner} (stored with partner_id=NULL)")
    print(f"  Exact dates:       {len(rows) - no_date - approx_date}")
    print(f"  Approx (yr only):  {approx_date}  [stored as YYYY-01-01]")
    print(f"  Date unknown:      {no_date}       [stored as NULL]")

    if partner_nulls:
        print()
        print("Partners not in DB (partner_id=NULL):")
        for p in partner_nulls:
            print(f"  {p['partner_key']}")

    if company_nulls and dry_run:
        print()
        print(f"Startups with no company match ({len(company_nulls)}):")
        for name in sorted(set(company_nulls))[:30]:
            print(f"  {name}")
        if len(company_nulls) > 30:
            print(f"  ... and {len(company_nulls)-30} more")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
