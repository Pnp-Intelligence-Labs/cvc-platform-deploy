#!/usr/bin/env python3
"""
PNP Engagement Analytics Import
Source:  /mnt/c/Users/nathan/Downloads/Analytics - engagement.xlsx
Targets: cvc.partner_intros  (primary — Startup Tracking)
         cvc.companies       (stubs for unmatched startups)
         cvc.partners        (7 missing corporations)
         cvc.users           (Harry's assigned_partner_ids)

Run dry first:  python3 import_pnp_engagement.py
Run live:       python3 import_pnp_engagement.py --live
"""

import sys
import os
import json
import openpyxl
import psycopg2
import psycopg2.extras
from datetime import datetime, date
from difflib import SequenceMatcher

# ── Config ──────────────────────────────────────────────────────────────────
DRY_RUN    = '--live' not in sys.argv
FILE_PATH  = '/mnt/c/Users/nathan/Downloads/Analytics - engagement.xlsx'
HARRY_ID   = 4

DB = {
    'host':     '100.83.104.117',
    'dbname':   'cvc_db',
    'user':     'producer',
    'password': 'producer_2026',
}

# ── Outcome mapping ──────────────────────────────────────────────────────────
OUTCOME_MAP = {
    'Shared':                            'shared',
    'Introduction':                      'intro_made',
    'Startup Evaluation':                'evaluation',
    'Monitor Startup':                   'monitoring',
    'POC / Pilot Planning':              'planning',
    'POC / Pilot In Progress':           'in_progress',
    'POC / Pilot On Hold':               'on_hold',
    'POC / Pilot Completed':             'completed',
    'POC / Pilot Terminated':            'cancelled',
    'Production / Commercial Agreement': 'commercial',
    'Closed / No further interest':      'closed',
}

STATUS_TEXT = {
    'Introduction':                      'Introduction made',
    'Startup Evaluation':                'Startup evaluation underway',
    'Monitor Startup':                   'Monitoring startup',
    'POC / Pilot Planning':              'POC / Pilot planning started',
    'POC / Pilot In Progress':           'POC / Pilot in progress',
    'POC / Pilot On Hold':               'POC / Pilot placed on hold',
    'POC / Pilot Completed':             'POC / Pilot completed',
    'POC / Pilot Terminated':            'POC / Pilot terminated',
    'Production / Commercial Agreement': 'Production / Commercial Agreement reached',
    'Closed / No further interest':      'Closed — no further interest',
}

# ── Sector mapping (PNP → CVC taxonomy) ─────────────────────────────────────
SECTOR_MAP = {
    'Supply Chain':           'Supply Chain',
    'Mobility & Physical AI': 'Physical AI',
    'Advanced Manufacturing': 'Manufacturing',
    'Semiconductors':         'Robotics',
    'Energy':                 'Industrial Automation',
}

# ── Stage mapping (Current Funding Stage → CVC) ──────────────────────────────
def map_stage(val):
    if not val:
        return None
    v = str(val).lower()
    if 'bootstrapped' in v:              return 'Bootstrapped'
    if 'pre-seed' in v or 'pre seed' in v: return 'Pre-seed'
    if v == 'seed':                      return 'Seed'
    if 'series a' in v:                  return 'Series A'
    if 'series b' in v:                  return 'Series B'
    if 'series c' in v:                  return 'Series C'
    if any(x in v for x in ('series d', 'series e', 'series f', 'series g', 'series h')): return 'Series D+'
    return None

# ── Manual corp name aliases (file name → substring to match in DB) ──────────
CORP_ALIASES = {
    'CHEP / Brambles': 'Brambles',
}

# ── 7 missing partners ───────────────────────────────────────────────────────
MISSING_PARTNERS = [
    {'name': 'Logifruit',                    'industry': 'Logistics'},
    {'name': 'Grundfos',                     'industry': 'Industrial / Water Technology'},
    {'name': 'Shamrock Foods',               'industry': 'Food & Beverage'},
    {'name': 'Georgia-Pacific',              'industry': 'Manufacturing'},
    {'name': 'J.B. Hunt Transport Services', 'industry': 'Transportation & Logistics'},
    {'name': 'BNSF Logistics',               'industry': 'Logistics'},
    {"name": "Sam's Club",                   'industry': 'Retail'},
]

# ── Helpers ──────────────────────────────────────────────────────────────────
def similarity(a, b):
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()

def fuzzy_match(name, candidates, threshold=0.85):
    best_score, best = 0, None
    for c in candidates:
        s = similarity(name, c['name'])
        if s > best_score:
            best_score, best = s, c
    return (best, best_score) if best_score >= threshold else (None, best_score)

def corp_match(corp_name, partners):
    """Match file corporation name to a partner row — alias, exact, contains, then fuzzy."""
    # Manual aliases first
    alias = CORP_ALIASES.get(corp_name)
    if alias:
        al = alias.lower()
        for p in partners:
            if al in p['name'].lower():
                return p
    cn = corp_name.lower().strip()
    for p in partners:
        if p['name'].lower().strip() == cn:
            return p
    for p in partners:
        pn = p['name'].lower().strip()
        if cn in pn or pn in cn:
            return p
    match, _ = fuzzy_match(corp_name, partners, threshold=0.75)
    return match


def main():
    mode = 'DRY RUN' if DRY_RUN else '*** LIVE ***'
    print(f"\n{'='*60}")
    print(f"  PNP Engagement Import — {mode}")
    print(f"{'='*60}\n")

    # ── Load Excel ───────────────────────────────────────────────
    wb   = openpyxl.load_workbook(FILE_PATH, data_only=True)
    ws   = wb['Sheet2']
    rows = list(ws.iter_rows(values_only=True))
    data = rows[1:]   # skip header
    print(f"Loaded {len(data)} rows from file\n")

    # ── Connect ──────────────────────────────────────────────────
    conn = psycopg2.connect(**DB)
    conn.autocommit = False
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # ── Load existing partners ────────────────────────────────────
    cur.execute("SELECT id, name FROM cvc.partners ORDER BY id")
    partners     = [dict(r) for r in cur.fetchall()]
    partner_map  = {}   # file corp name → {id, name}

    # ── STEP 1: Add missing partners ─────────────────────────────
    print("STEP 1 — Missing partners")
    new_partner_ids = []

    for mp in MISSING_PARTNERS:
        existing = corp_match(mp['name'], partners)
        if existing:
            print(f"  SKIP   {mp['name']!r:40s} → already '{existing['name']}' (id={existing['id']})")
            partner_map[mp['name']] = existing
        else:
            print(f"  ADD    {mp['name']!r}")
            if not DRY_RUN:
                cur.execute(
                    "INSERT INTO cvc.partners (name, industry) VALUES (%s, %s) RETURNING id, name",
                    (mp['name'], mp['industry'])
                )
                row = dict(cur.fetchone())
                partners.append(row)
                partner_map[mp['name']] = row
                new_partner_ids.append(row['id'])
            else:
                partner_map[mp['name']] = {'id': None, 'name': mp['name']}

    # Assign new partners to Harry
    if new_partner_ids and not DRY_RUN:
        cur.execute(
            """
            UPDATE cvc.users
            SET assigned_partner_ids = assigned_partner_ids || %s::int[]
            WHERE id = %s
            """,
            (new_partner_ids, HARRY_ID)
        )
        print(f"\n  → Assigned {len(new_partner_ids)} new partners to Harry")

    # Build corp → partner lookup for all file corporations
    for row in data:
        corp = row[2]
        if corp and corp not in partner_map:
            match = corp_match(corp, partners)
            if match:
                partner_map[corp] = match

    resolved   = sum(1 for c in set(r[2] for r in data if r[2]) if c in partner_map)
    unresolved = [c for c in set(r[2] for r in data if r[2]) if c not in partner_map]
    print(f"\n  Corp resolution: {resolved} matched")
    if unresolved:
        print(f"  UNRESOLVED: {unresolved}")

    # ── STEP 2: Fuzzy match startups → companies ──────────────────
    print("\nSTEP 2 — Company matching")
    cur.execute("SELECT id, name FROM cvc.companies ORDER BY id")
    companies   = [dict(r) for r in cur.fetchall()]
    company_map = {}   # startup name → company_id

    # Also index existing company names for stub dedup check
    existing_company_names = {c['name'].lower().strip() for c in companies}

    startup_names = list(set(r[0] for r in data if r[0]))
    print(f"  {len(startup_names)} unique startups in file")

    unmatched = []
    for name in startup_names:
        match, score = fuzzy_match(name, companies)
        if match:
            company_map[name] = match['id']
        else:
            unmatched.append(name)

    print(f"  Matched: {len(company_map)} | Stubs needed: {len(unmatched)}")

    # ── STEP 3: Create company stubs ─────────────────────────────
    print(f"\nSTEP 3 — Company stubs ({len(unmatched)})")

    # Build per-startup metadata from first occurrence in file
    startup_meta = {}
    for row in data:
        name = row[0]
        if name and name not in startup_meta:
            startup_meta[name] = {
                'hq_city':        row[6] if row[6] and row[6] != 'N/A' else None,
                'stage':          map_stage(row[9]),
                'sector':         SECTOR_MAP.get(row[10]),
                'pnp_portfolio':  row[4] == 'Yes',
                'pnp_accelerated': row[5] == 'Yes',
            }

    stubs_created = 0
    for name in unmatched:
        if name.lower().strip() in existing_company_names:
            # Name exists but fell below fuzzy threshold — link by exact lowercase
            match = next((c for c in companies if c['name'].lower().strip() == name.lower().strip()), None)
            if match:
                company_map[name] = match['id']
                continue

        meta = startup_meta.get(name, {})
        tags = []
        if meta.get('pnp_portfolio'):   tags.append('pnp_portfolio')
        if meta.get('pnp_accelerated'): tags.append('pnp_accelerated')

        if not DRY_RUN:
            cur.execute(
                """
                INSERT INTO cvc.companies
                  (name, hq_city, stage, sector, tags, enrichment_status, enrichment_source)
                VALUES (%s, %s, %s, %s, %s, 'pending', 'pnp_import')
                RETURNING id
                """,
                (name, meta.get('hq_city'), meta.get('stage'), meta.get('sector'),
                 tags if tags else None)
            )
            result = cur.fetchone()
            if result:
                company_map[name] = result['id']
                stubs_created += 1
        else:
            stubs_created += 1

    print(f"  → {stubs_created} stubs {'would be ' if DRY_RUN else ''}created")

    # ── STEP 4: Import partner_intros ────────────────────────────
    print("\nSTEP 4 — Importing to partner_intros (Startup Tracking)")
    inserted = skipped = errors = 0

    for row in data:
        startup_name  = row[0]
        shared_date   = row[1]
        corp_name     = row[2]
        pilot_status  = row[3]
        pnp_portfolio = row[4] == 'Yes'
        pnp_accel     = row[5] == 'Yes'
        intro_stage   = row[8]   # Intro Funding Stage

        if not startup_name or not corp_name or not shared_date:
            errors += 1
            continue

        partner = partner_map.get(corp_name)
        if not partner:
            errors += 1
            continue

        company_id = company_map.get(startup_name)
        outcome    = OUTCOME_MAP.get(pilot_status, 'shared')
        intro_date = shared_date.date() if isinstance(shared_date, datetime) else shared_date

        # ── Build status_log ──────────────────────────────────────
        status_log = []

        # Entry 1 — always: intro context with funding stage + PNP flags
        context_parts = []
        if intro_stage and intro_stage not in ('No funding', 'Series Unknown', 'Undisclosed', 'Non Equity Assistance'):
            context_parts.append(f"Introduced at {intro_stage} stage")
        if pnp_portfolio:
            context_parts.append("PNP Portfolio company")
        if pnp_accel:
            context_parts.append("PNP Accelerated company")

        entry1_text = ". ".join(context_parts) + "." if context_parts else "Introduction logged."
        status_log.append({
            "text":    entry1_text,
            "ts":      intro_date.isoformat(),
            "outcome": "shared",
        })

        # Entry 2 — when engagement progressed or concluded beyond Shared
        if pilot_status and pilot_status != 'Shared' and pilot_status in STATUS_TEXT:
            status_log.append({
                "text":    STATUS_TEXT[pilot_status],
                "ts":      intro_date.isoformat(),
                "outcome": outcome,
            })

        if not DRY_RUN:
            try:
                cur.execute(
                    """
                    INSERT INTO cvc.partner_intros
                      (startup_name, company_id, partner_id, partner_name,
                       intro_date, outcome, status_log, source)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, 'pnp_analytics')
                    ON CONFLICT (startup_name, partner_name, intro_date) DO NOTHING
                    """,
                    (
                        startup_name,
                        company_id,
                        partner['id'],
                        partner['name'],
                        intro_date,
                        outcome,
                        json.dumps(status_log),
                    )
                )
                if cur.rowcount:
                    inserted += 1
                else:
                    skipped += 1
            except Exception as e:
                print(f"  ERROR  {startup_name} / {corp_name}: {e}")
                errors += 1
        else:
            inserted += 1   # would-be inserts in dry run

    print(f"  Inserted: {inserted} | Skipped (dedup): {skipped} | Errors: {errors}")

    # ── Summary ──────────────────────────────────────────────────
    new_count = sum(1 for mp in MISSING_PARTNERS if not corp_match(mp['name'], [p for p in partners if p['id']]))
    print(f"\n{'='*60}")
    print(f"  SUMMARY — {mode}")
    print(f"  New partners added:   {len(new_partner_ids) if not DRY_RUN else sum(1 for mp in MISSING_PARTNERS if not corp_match(mp['name'], [p for p in partners]))}")
    print(f"  Company stubs:        {stubs_created}")
    print(f"  Intros inserted:      {inserted}")
    print(f"  Intros skipped:       {skipped}")
    print(f"  Errors:               {errors}")
    print(f"{'='*60}\n")

    if DRY_RUN:
        print("DRY RUN complete — no changes written. Run with --live to execute.\n")
        conn.rollback()
    else:
        conn.commit()
        print("All changes committed successfully.\n")

    cur.close()
    conn.close()


if __name__ == '__main__':
    main()
