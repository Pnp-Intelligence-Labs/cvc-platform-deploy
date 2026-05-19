"""
workers/import/import_slam_2025_intros.py

Imports SLAM Tech 2025 Intros master list into cvc.partner_intros.

Source: SLAM Tech Data - 2025 Intros.csv
Structure: header on line 1 (0-indexed).
  Columns: Duplicate Check, #, Corporation, Startup, Website, Month, Year,
           Tech Focus, Notes/details, ...

Date: Month column = "M/DD/YY" or "MM/DD/YY"; Year = 2025 or 1899 (blank).
      1899 → NULL date.

NOTE: Monday 2025 file was intentionally excluded — 82% of its rows are
duplicates of this file with workflow dates instead of actual meeting dates.

Run:
  python3 workers/import/import_slam_2025_intros.py --dry-run
  python3 workers/import/import_slam_2025_intros.py
"""
import sys, re, csv, argparse
from pathlib import Path
from difflib import SequenceMatcher

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "core"))
from db.connection import get_connection

CSV_PATH = "/mnt/c/Users/nathan/Downloads/SLAM Tech Data - 2025 Intros.csv"
HEADER_LINE = 1   # 0-indexed: line 1 in the file
SOURCE = "slam_2025"

# ── Partner mapping: CSV Corporation column → (partner_id, canonical name) ───
# None partner_id = not a formal CVC partner, still stored with partner_id=NULL
PARTNER_MAP = {
    # Formal CVC partners
    "Amazon":               (35,  "Amazon"),
    "ArcBest":              (65,  "ArcBest"),
    "Brambles":             (27,  "Brambles Holdings (UK) Limited"),
    "Cedar Park":           (86,  "City of Cedar Park"),
    "Colgate Palmolive":    (66,  "Colgate-Palmolive"),
    "Costco":               (37,  "Costco Wholesale Corporation"),
    "Crowley":              (28,  "Crowley Maritime Corporation"),
    "Cummins":              (29,  "Cummins Inc."),
    "Daimler Trucks":       (39,  "Daimler Truck North America LLC"),
    "Dell":                 (3,   "Dell Technologies"),
    "Dot Foods":            (71,  "Dot Foods"),
    "DSV":                  (77,  "DSV"),
    "General Mills":        (31,  "General Mills Inc."),
    "Georgia Pacific":      (76,  "Georgia Pacific"),
    "GS1":                  (42,  "GS1 US Inc"),
    "Holman":               (33,  "Holman Strategic Investments, LLC"),
    "Honeywell Aerospace":  (8,   "Honeywell"),
    "Intel":                (23,  "Intel"),
    "Intel Capital":        (23,  "Intel"),
    "Japan Post":           (43,  "Japan Post Co., Ltd."),
    "Maersk":               (69,  "Maersk"),
    "Mitsubishi Electric":  (6,   "Mitsubishi Electric"),
    "Mistubishi Electric":  (6,   "Mitsubishi Electric"),   # typo in source
    "Northrop Grumman":     (5,   "Northrop Grumman"),
    "NXP":                  (73,  "NXP Semiconductors"),
    "Rockwell Automation":  (14,  "Rockwell Automation"),
    "Standard Industries":  (38,  "Standard Industries Inc."),
    "TJX":                  (68,  "TJX"),
    "USPS":                 (67,  "USPS"),
    "Volvo":                (44,  "Volvo Group North America, LLC"),
    "Walmart":              (45,  "Walmart"),
    "Yamato":               (70,  "Yamato"),
    "ACA":                  (41,  "Arizona Commerce Authority"),
    # Non-formal partners — stored with partner_id=NULL
    "AB In Bev":            (None, "AB InBev"),
    "AMD":                  (None, "AMD"),
    "ANA（All Nippon Airways）holdings": (None, "ANA"),
    "Applied Materials":    (None, "Applied Materials"),
    "APS":                  (None, "APS"),
    "ASM":                  (None, "ASM"),
    "ASU":                  (None, "ASU"),
    "Axel Springer Deutschland GmbH": (None, "Axel Springer"),
    "Boost VC":             (None, "Boost VC"),
    "Blue forge alliance":  (None, "Blue Forge Alliance"),
    "Cardinal Health":      (None, "Cardinal Health"),
    "Cathay Pacific":       (None, "Cathay Pacific"),
    "CBRE":                 (None, "CBRE"),
    "Cervin Ventures":      (None, "Cervin Ventures"),
    "Chick-Fil-A":          (None, "Chick-fil-A"),
    "Cirrus Logic":         (None, "Cirrus Logic"),
    "Conversion Capital":   (None, "Conversion Capital"),
    "Danone":               (None, "Danone"),
    "Deutsche Telekom":     (None, "Deutsche Telekom"),
    "DIC Corporation":      (None, "DIC Corporation"),
    "DIU":                  (None, "DIU"),
    "Disney":               (None, "Disney"),
    "8VC":                  (None, "8VC"),
    "EcoHealth Ventures":   (None, "EcoHealth Ventures"),
    "Eli Lilly":            (None, "Eli Lilly"),
    "EMD":                  (None, "EMD"),
    "EPCOR":                (None, "EPCOR"),
    "Farm Credit Financial Partners, Inc.": (None, "Farm Credit Financial Partners"),
    "Flex":                 (None, "Flex"),
    "Glasswing Ventures":   (None, "Glasswing Ventures"),
    "Golden State Foods":   (None, "Golden State Foods"),
    "HEB":                  (None, "HEB"),
    "Hills Pet food":       (None, "Hills Pet Nutrition"),
    "HPA":                  (None, "HPA"),
    "IGT":                  (None, "IGT"),
    "imec":                 (None, "imec"),
    "Inditex":              (None, "Inditex"),
    "Ingersoll Rand":       (None, "Ingersoll Rand"),
    "ITRI - Dave":          (None, "ITRI"),
    "Ivoclar":              (None, "Ivoclar"),
    "Kyocera":              (None, "Kyocera"),
    "L3 Harris":            (None, "L3Harris"),
    "Little Caesars":       (None, "Little Caesars"),
    "Lockheed Martin":      (None, "Lockheed Martin"),
    "Loreal":               (None, "L'Oreal"),
    "Martin Brower":        (None, "Martin Brower"),
    "MDNA":                 (None, "MDNA"),
    "Microchip":            (None, "Microchip Technology"),
    "NASA":                 (None, "NASA"),
    "9Yards":               (None, "9Yards Capital"),
    "Norfolk Southern":     (None, "Norfolk Southern"),
    "NSF Futures Engine":   (None, "NSF Futures Engine"),
    "OnSemi":               (None, "onsemi"),
    "Overmatch Ventures":   (None, "Overmatch Ventures"),
    "Pattison Agriculture": (None, "Pattison Agriculture"),
    "Pelliconi":            (None, "Pelliconi"),
    "PepsiCo":              (None, "PepsiCo"),
    "Pfizer":               (None, "Pfizer"),
    "Phillips 66":          (None, "Phillips 66"),
    "Photon Ventures":      (None, "Photon Ventures"),
    "PortsToronto":         (None, "PortsToronto"),
    "Prime Movers Lab":     (None, "Prime Movers Lab"),
    "QTS":                  (None, "QTS"),
    "Republic Services":    (None, "Republic Services"),
    "Resonance America":    (None, "Resonance America"),
    "Rockwell Automation":  (14,  "Rockwell Automation"),
    "S3 Ventures":          (None, "S3 Ventures"),
    "Samsung Electronics":  (None, "Samsung Electronics"),
    "Santec":               (None, "Santec"),
    "Scout Ventures":       (None, "Scout Ventures"),
    "SEMI":                 (None, "SEMI"),
    "Shamrock Foods":       (None, "Shamrock Foods"),
    "Silicon Labs":         (None, "Silicon Labs"),
    "Silverton Partners":   (None, "Silverton Partners"),
    "Skywater Technologies": (None, "Skywater Technologies"),
    "SMU":                  (None, "SMU"),
    "Spring Street Group VC": (None, "Spring Street Group VC"),
    "SRP":                  (None, "SRP"),
    "Squadra Ventures":     (None, "Squadra Ventures"),
    "STMicroelectronics":   (None, "STMicroelectronics"),
    "Synopsys":             (None, "Synopsys"),
    "Tokyo Gas":            (None, "Tokyo Gas"),
    "Toll Group":           (None, "Toll Group"),
    "Toyota Boshoku":       (None, "Toyota Boshoku"),
    "TQL":                  (None, "TQL"),
    "True North Supply Chain Advisory LLC": (None, "True North Supply Chain Advisory"),
    "Tyson Foods":          (None, "Tyson Foods"),
    "UAMS":                 (None, "UAMS"),
    "UPS":                  (None, "UPS"),
    "Veolia":               (None, "Veolia"),
    "VSP":                  (None, "VSP"),
    "Walton Family Foundation": (None, "Walton Family Foundation"),
    "Wesco":                (None, "Wesco"),
    "Westec Plastics":      (None, "Westec Plastics"),
    "Zimmer Biomet":        (None, "Zimmer Biomet"),
    "Zeglass":              (None, "Zeglass"),
    "Zaka":                 (None, "Zaka"),
    "2048":                 (None, "2048"),
    "9Yards":               (None, "9Yards Capital"),
    "Akmor":                (None, "Akmor"),
    "Backswing Ventures":   (None, "Backswing Ventures"),
    "Basetwo AI":           (None, "Basetwo AI"),
}

_JUNK_RE = re.compile(
    r'^\s*$'
    r'|^n/?a$'
    r'|^tbd$'
    r'|^unknown$',
    re.I
)


def _parse_date(month_str: str, year_str: str) -> str | None:
    """Parse 'M/DD/YY' month + '2025' year into ISO date string, or None."""
    year_str = year_str.strip()
    month_str = month_str.strip()
    if not month_str or not year_str or year_str == '1899':
        return None
    # Month col can be "9/22/25" or "11/18/25" or "2/24/25 2025"
    m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{2})', month_str)
    if m:
        mo, day, yr2 = m.groups()
        return f"20{yr2}-{int(mo):02d}-{int(day):02d}"
    return None


def _fuzzy_match(name: str, companies: list[dict], threshold=0.72) -> int | None:
    name_l = name.lower().strip()
    best_id, best_score = None, 0.0
    for c in companies:
        score = SequenceMatcher(None, name_l, c["name_l"]).ratio()
        if score > best_score:
            best_score, best_id = score, c["id"]
        for suffix in [" ai", ".ai", " inc", ".", " labs", " technologies",
                       " tech", " robotics", " systems"]:
            s2 = SequenceMatcher(None, name_l, c["name_l"].removesuffix(suffix)).ratio()
            if s2 > best_score:
                best_score, best_id = s2, c["id"]
    return best_id if best_score >= threshold else None


def parse_csv(path: str) -> list[dict]:
    with open(path, encoding="utf-8-sig") as f:
        lines = f.readlines()

    reader = csv.DictReader(lines[HEADER_LINE:])
    rows = []
    seen_null_date = set()

    for r in reader:
        corp    = r.get('Corporation', '').strip()
        startup = r.get('Startup', '').strip()
        month   = r.get('Month', '').strip()
        year    = r.get('Year', '').strip()

        if not corp or not startup:
            continue
        if _JUNK_RE.search(startup) or len(startup) < 2 or len(startup) > 80:
            continue
        if corp not in PARTNER_MAP:
            # Unknown corp — store with partner_id=NULL using raw name
            partner_id, partner_name = None, corp
        else:
            partner_id, partner_name = PARTNER_MAP[corp]

        intro_date = _parse_date(month, year)

        # Dedup NULL-date rows (same startup+partner already seen without a date)
        if intro_date is None:
            key = (startup.lower(), partner_name.lower())
            if key in seen_null_date:
                continue
            seen_null_date.add(key)

        rows.append({
            "startup_name": startup,
            "partner_id":   partner_id,
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
            cur.execute("SELECT id, name FROM cvc.companies")
            companies = [
                {"id": r["id"], "name": r["name"], "name_l": r["name"].lower()}
                for r in cur.fetchall()
            ]

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
                date_label = r["intro_date"] or "DATE UNKNOWN"
                match_flag = f" → company_id={company_id}" if company_id else " → NO MATCH"
                pid_flag   = "" if r["partner_id"] else " [no partner_id]"
                print(f"  {r['partner_name']:<40} {r['startup_name']:<35} {date_label}{pid_flag}{match_flag}")
                inserted += 1
                continue

            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO cvc.partner_intros
                        (company_id, partner_id, startup_name, partner_name,
                         intro_date, intro_type, source)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (startup_name, partner_name, intro_date) DO NOTHING
                    RETURNING id
                """, (
                    company_id, r["partner_id"], r["startup_name"], r["partner_name"],
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
    print(f"  Inserted:          {inserted}")
    print(f"  Skipped (dup):     {skipped}")
    print(f"  Unmatched company: {unmatched_company} (stored with company_id=NULL)")
    print(f"  No partner in DB:  {unmatched_partner} (stored with partner_id=NULL)")
    print(f"  Exact dates:       {exact_date}")
    print(f"  Date unknown:      {no_date}  (stored as NULL)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
