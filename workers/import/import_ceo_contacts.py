"""
Import CEO contact info from the Family Office CEO contact CSV.
Fuzzy-matches company names against cvc.companies (is_portfolio=TRUE),
inserts into cvc.company_contacts with title='CEO', is_primary=TRUE.

Run: python3 workers/import/import_ceo_contacts.py
"""
import csv
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../core'))
from db.connection import get_connection

CSV_PATH = os.path.expanduser(
    "/mnt/c/Users/nathan/Downloads/Supply Chain Portfolio Schedule - CEO Contact Info.csv"
)

# Manual overrides for names that don't fuzzy-match well
NAME_MAP = {
    "ATMO (fka Froglabs)":     "Atmo AI",
    "Autobon":                 "Autobon AI",
    "Bid Ops":                 None,   # not in portfolio
    "Koffie Finance":          None,   # not in portfolio
    "Ottopia":                 None,   # not in portfolio
    "QuikReturn":              None,   # not in portfolio
    "DroidDrive (dba DuckTrain)": "DroidDrive / DuckTrain",
    "Genlots":                 "GenLots",
    "Wilya":                   "Wilya (FKA Gig and Take)",
    "icustoms":                "icustoms",
    "Simpliroute":             "SimpliRoute",
    "Throughput":              "ThroughPut",
    "Usyncro":                 "USYNCRO",
    "WareClouds":              "Wareclouds",
    "Zuum":                    "Zuum Transportation",
    "Rafay":                   "Rafay Systems",
    "Southie":                 "Southie Autonomy",
    "bext360":                 "bext360",
    "Basetwo":                 "Basetwo AI",
    "Delivers.ai":             "Delivers.ai",
}

def main():
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Build name→id lookup for portfolio companies
            cur.execute("SELECT id, name FROM cvc.companies WHERE is_portfolio = TRUE")
            portfolio = {r["name"].lower().strip(): r["id"] for r in cur.fetchall()}

            rows_parsed = []
            with open(CSV_PATH, newline='', encoding='utf-8-sig') as f:
                reader = csv.reader(f)
                for row in reader:
                    if len(row) < 4:
                        continue
                    company_raw = row[1].strip()
                    ceo_name    = row[2].strip()
                    email       = row[3].strip()
                    phone       = row[4].strip() if len(row) > 4 else ''

                    if not company_raw or not ceo_name or company_raw in ('Company', '#N/A'):
                        continue
                    if company_raw.startswith('x -') or company_raw.startswith('date -'):
                        continue

                    rows_parsed.append((company_raw, ceo_name, email or None, phone or None))

            inserted = 0
            skipped_no_match = []
            skipped_no_ceo = []

            for company_raw, ceo_name, email, phone in rows_parsed:
                # Apply manual override first
                if company_raw in NAME_MAP:
                    canonical = NAME_MAP[company_raw]
                    if canonical is None:
                        continue  # explicitly excluded
                else:
                    canonical = company_raw

                company_id = portfolio.get(canonical.lower().strip())
                if not company_id:
                    # Try partial match
                    for db_name, db_id in portfolio.items():
                        if canonical.lower() in db_name or db_name in canonical.lower():
                            company_id = db_id
                            break

                if not company_id:
                    skipped_no_match.append(company_raw)
                    continue

                if not ceo_name:
                    skipped_no_ceo.append(company_raw)
                    continue

                # Skip if contact already exists for this company
                cur.execute(
                    "SELECT id FROM cvc.company_contacts WHERE company_id = %s AND LOWER(name) = LOWER(%s)",
                    (company_id, ceo_name)
                )
                if cur.fetchone():
                    print(f"  SKIP (exists): {company_raw} — {ceo_name}")
                    continue

                cur.execute("""
                    INSERT INTO cvc.company_contacts
                        (company_id, name, title, email, phone, is_primary, added_by)
                    VALUES (%s, %s, 'CEO', %s, %s, TRUE, 'import')
                """, (company_id, ceo_name, email, phone or None))
                print(f"  INSERT: {company_raw} → {ceo_name} ({email})")
                inserted += 1

            conn.commit()

    print(f"\nDone. {inserted} contacts inserted.")
    if skipped_no_match:
        print(f"No DB match ({len(skipped_no_match)}): {', '.join(skipped_no_match)}")
    if skipped_no_ceo:
        print(f"No CEO info ({len(skipped_no_ceo)}): {', '.join(skipped_no_ceo)}")

if __name__ == "__main__":
    main()
