"""
workers/import/import_slam_2024.py

Imports SLAM Tech 2024 partner engagement data into cvc.partner_intros.

Source: SLAM Tech Data - Monday 2024.csv
Structure: flat CSV, header on line 8.
  Columns: Name, Partner, Deliverable Types, Deliverable Status,
           Request Date, Due Date, Delivered Date, Office, ...

Filters to rows where Deliverable Types == 'Startup Intro'.

Date priority: Delivered Date → Request Date → NULL

Partner = "N/A" rows: the actual partner is the right side of "Startup <> Partner"
in the Name field. Stored with partner_name extracted from the row.

Run:
  python3 workers/import/import_slam_2024.py --dry-run
  python3 workers/import/import_slam_2024.py
"""
import sys, re, csv, argparse
from pathlib import Path
from difflib import SequenceMatcher

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "core"))
from db.connection import get_connection

CSV_PATH = "/mnt/c/Users/nathan/Downloads/SLAM Tech Data - Monday 2024.csv"
HEADER_LINE = 7   # 0-indexed: line 8 in the file
SOURCE = "slam_2024"

# ── Partner mapping: CSV Partner column value → (partner_id, canonical name) ─
# None = not in partners DB yet (still logged with partner_id=NULL)
PARTNER_MAP = {
    "General Mills":       (31, "General Mills Inc."),
    "Standard Industries": (38, "Standard Industries Inc."),
    "Brambles":            (27, "Brambles Holdings (UK) Limited"),
    "Intel":               (23, "Intel"),
    "Raytheon":            (19, "Raytheon Technologies"),
    "Walmart":             (45, "Walmart"),
    "Honeywell":           (8,  "Honeywell"),
    "Georgia Pacific":     (76, "Georgia Pacific"),
    "Amazon":              (35, "Amazon"),
    "Colgate-Palmolive":   (66, "Colgate-Palmolive"),
    "NXP":                 (73, "NXP Semiconductors"),
    "DTNA":                (39, "Daimler Truck North America LLC"),
    "Cummins":             (29, "Cummins Inc."),
    "Arcbest":             (65, "ArcBest"),
    "Crowley":             (28, "Crowley Maritime Corporation"),
    "Volvo Group":         (44, "Volvo Group North America, LLC"),
    "Costco":              (37, "Costco Wholesale Corporation"),
    "Japan Post":          (43, "Japan Post Co., Ltd."),
    "Mitsubishi Electric": (6,  "Mitsubishi Electric"),
    "Dot Foods":           (71, "Dot Foods"),
    "USPS":                (67, "USPS"),
    "Yamato":              (70, "Yamato"),
    "TJX":                 (68, "TJX"),
    "ACA":                 (41, "Arizona Commerce Authority"),
    "Holman":              (33, "Holman Strategic Investments, LLC"),
    "Port of Sav":         (None, "Port of Savannah"),
    "Hills Pet":           (None, "Hills Pet Nutrition"),
    # "Lead" = internal pipeline tag, no partner — row is skipped
}

# For N/A-partner rows: right-side names → (partner_id, canonical name)
# These are companies CVC introduced startups to outside formal partnerships
NA_PARTNER_LOOKUP = {
    "raytheon":              (19, "Raytheon Technologies"),
    "usps":                  (67, "USPS"),
    "city of cedar park":    (86, "City of Cedar Park"),
    "ibm":                   (None, "IBM"),
    "amd":                   (None, "AMD"),
    "bae":                   (None, "BAE Systems"),
    "bae systems":           (None, "BAE Systems"),
    "phillips 66":           (None, "Phillips 66"),
    "sigma":                 (None, "Sigma"),
    "chemtrade":             (None, "ChemTrade"),
    "doosan bobcat":         (None, "Doosan Bobcat"),
    "doosan":                (None, "Doosan Bobcat"),
    "ana":                   (None, "ANA"),
    "gmi":                   (None, "GMI"),
    "fincantieri":           (None, "Fincantieri"),
    "sherwin williams":      (None, "Sherwin Williams"),
    "hinalea imaging":       (None, "Hinalea Imaging"),
    "tetrapak":              (None, "Tetra Pak"),
    "tetra pak":             (None, "Tetra Pak"),
    "igt":                   (None, "IGT"),
    "galaxy ventures":       (None, "Galaxy Ventures"),
    "loreal":                (None, "L'Oreal"),
    "l'oreal":               (None, "L'Oreal"),
    "pepsico":               (None, "PepsiCo"),
    "wesco":                 (None, "Wesco"),
    "banf smart tire":       (None, "BANF Smart Tire"),
    "banf":                  (None, "BANF"),
    "zf":                    (None, "ZF"),
    "chris sterbenc":        (None, "Chris Sterbenc"),
    "chris sterbenc scale-up accelerator": (None, "Chris Sterbenc"),
    "cathay":                (None, "Cathay"),
    "nea vc":                (None, "NEA"),
    "nea":                   (None, "NEA"),
    "ldv":                   (None, "LDV Capital"),
    "sacos ventures":        (None, "Sacos Ventures"),
    "rocket ship vc":        (None, "Rocket Ship VC"),
    "25madison":             (None, "25Madison"),
    "rockyard":              (None, "Rockyard"),
    "cervin":                (None, "Cervin"),
    "build with studio":     (None, "Build With Studio"),
    "molly sinsheimer":      (None, "Build With Studio"),
    "valerie grahame":       (None, "Valérie Grahame-Lehn"),
    "happy robot":           (None, "Happy Robot"),
    "autolane":              (None, "Autolane"),
    "contoro":               (None, "Contoro Robotics"),
    "colipi":                (None, "Colipi"),
}

# Partners that indicate the RIGHT side of <> is the startup (partner is on left)
LEFT_IS_PARTNER = {
    "gpa", "sherwin williams", "chris sterbenc", "zf", "cathay",
    "chris sultemier",
}

_JUNK_RE = re.compile(
    r'^startup intro(\s*&.*)?$'
    r'|in-person'
    r'|\d+\s*\+\s*startups'
    r'|intro\'d to'
    r'|colipi introduction at summit'   # event note, no startup name
    r'|connecting to'
    r'|\(apac\)'
    r'|leadership meeting'              # "Apptronik Leadership Meeting" etc.
    r'|engineering request'             # "Prompt Engineering Request"
    r'|^generall?\s+mills?',             # "Generall Mills" typo of partner name
    re.I
)


def _clean_name(name: str) -> str:
    """Strip Monday.com artifacts and event prefixes from startup names."""
    name = name.strip()
    # "(copy)" suffix from Monday.com duplicated items
    name = re.sub(r'\s*\(copy\)\s*$', '', name, flags=re.I).strip()
    # "Cedar Park SD N: " prefix
    name = re.sub(r'^Cedar Park SD\s*\d*\s*:\s*', '', name, flags=re.I).strip()
    # "Summit N-N: "
    name = re.sub(r'^Summit\s*[\d\-]*\s*:?\s*', '', name, flags=re.I).strip()
    # "- Startup Attendee at ..." suffix
    name = re.sub(r'\s*-\s*Startup Attendee.*$', '', name, flags=re.I).strip()
    return name


def _extract_parts(name: str):
    """
    For N/A partner rows: return (startup_name, partner_name_raw).
    Handles "Startup <> Partner", "Partner <> Startup" with known left-is-partner names.
    """
    name = _clean_name(name)
    if '<>' not in name:
        return name, None
    parts = [p.strip() for p in name.split('<>', 1)]
    left, right = parts[0], parts[1] if len(parts) > 1 else ''
    # Strip extra spaces around <>
    left = left.strip(); right = right.strip()
    if left.lower() in LEFT_IS_PARTNER:
        return right, left
    # Default: left=startup, right=partner
    return left, right


def _resolve_na_partner(partner_raw: str | None):
    """Look up a partner name from an N/A row in the extended partner dict."""
    if not partner_raw:
        return None, "Unknown"
    key = partner_raw.lower().strip()
    # Exact match first
    if key in NA_PARTNER_LOOKUP:
        return NA_PARTNER_LOOKUP[key]
    # Partial match
    for k, v in NA_PARTNER_LOOKUP.items():
        if k in key or key in k:
            return v
    return None, partner_raw.strip()


def _extract_startup_from_named_row(name: str, partner_key: str) -> str | None:
    """For rows where Partner column is a known partner (not N/A)."""
    name = _clean_name(name)
    if _JUNK_RE.search(name) or len(name) > 70:
        return None

    # "Intro to X" / "Introduction to X" / "Intros to X"
    m = re.match(r'^intro(?:duction|s)?\s+to\s+', name, re.I)
    if m:
        return name[m.end():].strip()

    # "Introduced [(X)] to Y"
    m = re.match(r'^introduced(?:\s+\([^)]+\))?\s+to\s+', name, re.I)
    if m:
        return name[m.end():].strip()

    # "X Intro" suffix
    name = re.sub(r'\s+Intro\s*$', '', name, flags=re.I).strip()

    if '<>' in name:
        parts = [p.strip() for p in name.split('<>', 1)]
        left, right = parts[0], parts[1] if len(parts) > 1 else ''
        # Identify which side is the partner
        partner_aliases = {
            "General Mills":   ["general mills", "gm"],
            "Standard Industries": ["standard industries", "si"],
            "Brambles":        ["brambles"],
            "Intel":           ["intel"],
            "Raytheon":        ["raytheon"],
            "Walmart":         ["walmart"],
            "Honeywell":       ["honeywell"],
            "Georgia Pacific": ["georgia pacific", "gp"],
            "Amazon":          ["amazon"],
            "Colgate-Palmolive": ["colgate"],
            "NXP":             ["nxp"],
            "DTNA":            ["dtna", "daimler"],
            "Cummins":         ["cummins"],
            "Arcbest":         ["arcbest", "arc best"],
            "Crowley":         ["crowley"],
            "Volvo Group":     ["volvo"],
            "Costco":          ["costco"],
            "Japan Post":      ["japan post", "jp"],
            "Mitsubishi Electric": ["mitsubishi"],
            "Dot Foods":       ["dot foods"],
            "USPS":            ["usps"],
            "Yamato":          ["yamato"],
            "TJX":             ["tjx"],
            "ACA":             ["aca"],
            "Holman":          ["holman"],
            "Port of Sav":     ["gpa", "port of sav"],
        }
        aliases = partner_aliases.get(partner_key, [partner_key.lower()])
        left_l, right_l = left.lower(), right.lower()
        left_is_partner  = any(a in left_l  or left_l  in a for a in aliases)
        right_is_partner = any(a in right_l or right_l in a for a in aliases)
        if left_is_partner and not right_is_partner:
            return right
        if right_is_partner and not left_is_partner:
            return left
        return left  # default

    return name if name else None


def _best_date(row: dict) -> str | None:
    """Delivered Date → Request Date → None."""
    for col in ("Delivered Date", "Request Date"):
        val = row.get(col, "").strip()
        if val and re.match(r'\d{4}-\d{2}-\d{2}', val):
            return val
    return None


def _fuzzy_match(name: str, companies: list[dict], threshold=0.72) -> int | None:
    name_l = name.lower().strip()
    best_id, best_score = None, 0.0
    for c in companies:
        score = SequenceMatcher(None, name_l, c["name_l"]).ratio()
        if score > best_score:
            best_score, best_id = score, c["id"]
        for suffix in [" ai", ".ai", " inc", ".", " labs", " technologies", " tech", " robotics"]:
            s2 = SequenceMatcher(None, name_l, c["name_l"].removesuffix(suffix)).ratio()
            if s2 > best_score:
                best_score, best_id = s2, c["id"]
    return best_id if best_score >= threshold else None


def parse_csv(path: str) -> list[dict]:
    with open(path, encoding="utf-8-sig") as f:
        lines = f.readlines()

    reader = csv.DictReader(lines[HEADER_LINE:])
    raw_rows = list(reader)

    rows = []
    seen_null_date = set()

    for r in raw_rows:
        if r.get("Deliverable Types", "").strip() != "Startup Intro":
            continue

        partner_csv = r.get("Partner", "").strip()
        name_raw    = r.get("Name", "").strip()

        # Skip "Lead" rows — internal pipeline tag, no real partner
        if partner_csv == "Lead":
            continue

        intro_date = _best_date(r)
        status     = r.get("Deliverable Status", "").strip()

        if partner_csv == "N/A":
            # Partner is embedded in Name as "Startup <> Partner"
            startup_name, partner_raw = _extract_parts(name_raw)
            startup_name = _clean_name(startup_name) if startup_name else None
            if not startup_name or len(startup_name) < 2 or _JUNK_RE.search(startup_name):
                continue
            if len(startup_name) > 70:
                continue
            partner_id, partner_canonical = _resolve_na_partner(partner_raw)
        else:
            if partner_csv not in PARTNER_MAP:
                continue
            startup_name = _extract_startup_from_named_row(name_raw, partner_csv)
            if not startup_name or len(startup_name) < 2:
                continue
            partner_id, partner_canonical = PARTNER_MAP[partner_csv]

        # Dedup NULL-date rows
        if intro_date is None:
            key = (startup_name.lower(), partner_canonical.lower())
            if key in seen_null_date:
                continue
            seen_null_date.add(key)

        rows.append({
            "startup_name":    startup_name,
            "partner_id":      partner_id,
            "partner_name":    partner_canonical,
            "intro_date":      intro_date,
            "status":          status,
            "source":          SOURCE,
        })

    return rows


def run(dry_run=False):
    rows = parse_csv(CSV_PATH)
    print(f"Parsed {len(rows)} startup intro rows from CSV")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM cvc.companies")
            companies = [{"id": r["id"], "name": r["name"], "name_l": r["name"].lower()} for r in cur.fetchall()]

        inserted = skipped = unmatched_company = unmatched_partner = 0
        no_date = exact_date = 0

        for r in rows:
            company_id = _fuzzy_match(r["startup_name"], companies)
            if company_id is None:
                unmatched_company += 1
            if r["partner_id"] is None:
                unmatched_partner += 1
            if r["intro_date"] is None:
                no_date += 1
            else:
                exact_date += 1

            if dry_run:
                date_label  = r["intro_date"] if r["intro_date"] else "DATE UNKNOWN"
                match_flag  = f" → company_id={company_id}" if company_id else " → NO MATCH"
                pid_flag    = "" if r["partner_id"] else " [no partner_id]"
                print(f"  {r['partner_name']:<40} {r['startup_name']:<35} {date_label}{pid_flag}{match_flag}")
                inserted += 1
                continue

            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO cvc.partner_intros
                        (company_id, partner_id, startup_name, partner_name,
                         intro_date, intro_type, status_1, source)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (startup_name, partner_name, intro_date) DO NOTHING
                    RETURNING id
                """, (
                    company_id, r["partner_id"], r["startup_name"], r["partner_name"],
                    r["intro_date"], "Startup Intro", r["status"], SOURCE,
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
    print(f"  Exact dates:       {exact_date}")
    print(f"  Date unknown:      {no_date}  [stored as NULL]")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
