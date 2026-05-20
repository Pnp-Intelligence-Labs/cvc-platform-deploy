#!/usr/bin/env python3
"""
scripts/seed_demo.py — Populate a fresh deployment with demo data.

Inserts:
  - 30 sample companies across pipeline stages and sectors
  - Funding rounds for most companies
  - company_lifecycle rows (deal pipeline)
  - 4 sample partners
  - Partner matches linking companies to partners

Safe to run multiple times — skips companies/partners that already exist by name.
Reads sectors from config/team.json; falls back to generic sectors.

Usage:
    python3 scripts/seed_demo.py
    DB_HOST=x DB_PASSWORD=y python3 scripts/seed_demo.py
"""

import json
import os
import random
import sys
from datetime import date, timedelta
from pathlib import Path

# ── DB connection ─────────────────────────────────────────────────────────────

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    sys.exit("psycopg2 not installed. Run: pip install psycopg2-binary")

REPO = Path(__file__).resolve().parent.parent

# Load .env
env_file = REPO / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "platform_db")
DB_USER = os.environ.get("DB_USER", "platform")
DB_PASS = os.environ.get("DB_PASSWORD", "platform_local")


def connect():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASS,
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


# ── Team config ───────────────────────────────────────────────────────────────

team_cfg = {}
team_json = REPO / "config" / "team.json"
if team_json.exists():
    team_cfg = json.loads(team_json.read_text())

SECTORS = [s for s in team_cfg.get("sectors", []) if s != "Other"] or [
    "SaaS", "Fintech", "Deep Tech", "Climate Tech", "Robotics",
]
FUND = team_cfg.get("default_fund", "Fund I")

# ── Demo data ─────────────────────────────────────────────────────────────────

def _sector():
    return random.choice(SECTORS)

def _days_ago(n):
    return (date.today() - timedelta(days=n)).isoformat()

COMPANIES = [
    # (name, one_liner, sector, stage, hq_city, hq_country, founded,
    #  employees, total_raised_usd, is_hardware, is_software, score, enrichment_status)
    ("Axon Dynamics",      "Autonomous mobile robot platform for warehouse logistics",
     _sector(), "series_a",   "Austin",     "US", 2020, 85,  18_000_000, True,  False, 74, "enriched"),
    ("Corvid Analytics",   "AI-powered predictive maintenance for industrial equipment",
     _sector(), "seed",       "Chicago",    "US", 2021, 22,   4_500_000, False, True,  61, "enriched"),
    ("Ferrous Systems",    "Computer vision QA for precision manufacturing lines",
     _sector(), "series_a",   "Detroit",    "US", 2019, 140, 24_000_000, False, True,  82, "enriched"),
    ("Halcyon Robotics",   "Collaborative robots for small-batch production",
     _sector(), "seed",       "Pittsburgh", "US", 2022, 18,   3_200_000, True,  False, 55, "enriched"),
    ("Meridian Supply",    "Real-time supply chain visibility and risk scoring",
     _sector(), "series_b",   "Chicago",    "US", 2018, 210, 52_000_000, False, True,  88, "enriched"),
    ("Parabola Materials", "AI-designed advanced alloys for aerospace and defense",
     _sector(), "series_a",   "San Jose",   "US", 2020, 62,  16_500_000, True,  False, 71, "enriched"),
    ("Quorum Energy",      "Grid-edge energy optimization for industrial facilities",
     _sector(), "seed",       "Houston",    "US", 2021, 30,   6_000_000, False, True,  58, "enriched"),
    ("Stellarton AI",      "Foundation model for industrial process control",
     _sector(), "series_a",   "Toronto",    "CA", 2021, 55,  20_000_000, False, True,  79, "enriched"),
    ("Terravox",           "Environmental sensor networks for industrial compliance",
     _sector(), "seed",       "Denver",     "US", 2022, 14,   2_800_000, True,  True,  49, "enriched"),
    ("Vega Automation",    "No-code robotic process automation for factory floors",
     _sector(), "series_a",   "Boston",     "US", 2019, 95,  22_000_000, False, True,  77, "enriched"),

    ("Arclight Photonics", "LiDAR-on-chip for autonomous industrial inspection",
     _sector(), "seed",       "San Diego",  "US", 2022, 12,   2_100_000, True,  False, 43, "enriched"),
    ("Bluewater Freight",  "AI freight broker platform for spot and contract markets",
     _sector(), "series_b",   "Atlanta",    "US", 2017, 280, 68_000_000, False, True,  84, "enriched"),
    ("Cassian Controls",   "Adaptive process control for chemical manufacturing",
     _sector(), "screening",  "Houston",    "US", 2020, 28,   5_500_000, False, True,  52, "pending"),
    ("Dynamo Fleet",       "EV fleet management and charging optimization",
     _sector(), "series_a",   "Phoenix",    "US", 2020, 70,  14_000_000, True,  True,  66, "enriched"),
    ("Ember Logistics",    "Last-mile delivery optimization for B2B shipments",
     _sector(), "seed",       "Columbus",   "US", 2022, 20,   3_500_000, False, True,  47, "pending"),
    ("Fortis Biotech",     "Rapid pathogen detection for food safety",
     _sector(), "series_a",   "Cambridge",  "US", 2019, 48,  11_000_000, True,  False, 68, "enriched"),
    ("Greenpath Carbon",   "Industrial carbon capture as a service",
     _sector(), "seed",       "Calgary",    "CA", 2021, 25,   7_000_000, False, True,  60, "enriched"),
    ("Harbinger Tech",     "Predictive quality for semiconductor fabs",
     _sector(), "series_a",   "Austin",     "US", 2020, 90,  19_000_000, False, True,  75, "enriched"),
    ("Ironclad Sensing",   "Wireless vibration sensors for rotating machinery",
     _sector(), "seed",       "Minneapolis","US", 2021, 16,   2_500_000, True,  False, 44, "pending"),
    ("Juniper Networks+",  "Software-defined logistics for cold chain",
     _sector(), "series_b",   "Seattle",    "US", 2016, 320, 74_000_000, False, True,  86, "enriched"),

    ("Kestrel UAV",        "Autonomous inspection drones for oil & gas infrastructure",
     _sector(), "seed",       "Houston",    "US", 2022, 19,   4_000_000, True,  False, 50, "pending"),
    ("Lumina Vision",      "AI vision platform for retail inventory management",
     _sector(), "series_a",   "New York",   "US", 2020, 58,  13_000_000, True,  True,  69, "enriched"),
    ("Mantis Robotics",    "Hyper-flexible assembly robots for electronics mfg",
     _sector(), "seed",       "San Jose",   "US", 2022, 15,   3_000_000, True,  False, 46, "pending"),
    ("Northgate AI",       "AI-powered customs classification and compliance",
     _sector(), "series_a",   "Chicago",    "US", 2019, 75,  17_000_000, False, True,  72, "enriched"),
    ("Optic Edge",         "Real-time thermal imaging for predictive maintenance",
     _sector(), "seed",       "Dallas",     "US", 2021, 22,   4_200_000, True,  False, 53, "enriched"),
    ("Proxima Compute",    "Edge AI inference hardware for manufacturing edge",
     _sector(), "series_a",   "Austin",     "US", 2020, 65,  15_500_000, True,  True,  73, "enriched"),
    ("Quantum Harvest",    "Precision agriculture sensors and yield optimization",
     _sector(), "seed",       "Des Moines", "US", 2021, 18,   3_800_000, True,  True,  57, "pending"),
    ("Rimfire Analytics",  "Workforce productivity analytics for industrial operations",
     _sector(), "seed",       "Nashville",  "US", 2022, 12,   2_200_000, False, True,  41, "pending"),
    ("Sable Cyber",        "OT/IT security for critical infrastructure",
     _sector(), "series_a",   "Washington", "US", 2019, 110, 23_000_000, False, True,  80, "enriched"),
    ("Tungsten Labs",      "Digital twin platform for process manufacturing",
     _sector(), "series_b",   "Boston",     "US", 2017, 195, 48_000_000, False, True,  85, "enriched"),
]

PARTNERS = [
    ("Meridian Industrial Group",
     "Heavy manufacturing conglomerate seeking automation and efficiency plays",
     "Manufacturing",
     ["factory-floor automation", "supply chain visibility", "quality control"]),
    ("Titan Logistics Partners",
     "Regional 3PL and freight brokerage network modernizing operations",
     "Logistics",
     ["freight optimization", "last-mile delivery", "fleet management"]),
    ("Cascade Ventures Corporate",
     "Corporate VC arm of a Midwest industrial conglomerate",
     "Industrials",
     ["robotics", "predictive maintenance", "process control"]),
    ("Solaris Energy Holdings",
     "Energy infrastructure operator looking for efficiency and decarbonization tech",
     "Energy",
     ["grid optimization", "carbon capture", "industrial IoT"]),
]

LIFECYCLE_STAGES = {
    "sourced":    "sourced",
    "seed":       "screening",
    "series_a":   "diligence",
    "series_b":   "portfolio",
    "screening":  "screening",
    "pre_seed":   "sourced",
}

ROUND_TYPES = {
    "seed":     "Seed",
    "series_a": "Series A",
    "series_b": "Series B",
    "series_c": "Series C",
    "screening":"Seed",
}


# ── Seed ──────────────────────────────────────────────────────────────────────

def seed():
    conn = connect()
    cur  = conn.cursor()

    print("Connected to", DB_NAME, "on", DB_HOST)
    print()

    # ── Companies ─────────────────────────────────────────────────────────────

    # Load existing names for dedup
    cur.execute("SELECT LOWER(name) FROM cvc.companies")
    existing_names = {r["lower"] for r in cur.fetchall()}

    company_ids = {}   # name → id (all, including pre-existing)

    inserted_co = 0
    for (name, one_liner, sector, stage, city, country, founded,
         employees, raised, is_hw, is_sw, score, enrich_status) in COMPANIES:

        if name.lower() in existing_names:
            cur.execute("SELECT id FROM cvc.companies WHERE LOWER(name) = %s", (name.lower(),))
            row = cur.fetchone()
            if row:
                company_ids[name] = row["id"]
            continue

        cur.execute(
            """
            INSERT INTO cvc.companies
              (name, one_liner, sector, stage, hq_city, hq_country, founded,
               employee_count, total_raised_usd, is_hardware, is_software,
               score_composite, enrichment_status, enrichment_source, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'demo_seed',NOW(),NOW())
            RETURNING id
            """,
            (name, one_liner, sector, stage, city, country, founded,
             employees, raised, is_hw, is_sw, score, enrich_status),
        )
        cid = cur.fetchone()["id"]
        company_ids[name] = cid
        existing_names.add(name.lower())
        inserted_co += 1

    conn.commit()
    print(f"Companies: {inserted_co} inserted, {len(COMPANIES) - inserted_co} skipped (already exist)")

    # ── Funding rounds ────────────────────────────────────────────────────────

    inserted_fr = 0
    for (name, _, _, stage, *_rest) in COMPANIES:
        cid = company_ids.get(name)
        if not cid:
            continue
        cur.execute("SELECT id FROM cvc.funding_rounds WHERE company_id = %s LIMIT 1", (cid,))
        if cur.fetchone():
            continue

        round_type = ROUND_TYPES.get(stage, "Seed")
        raised     = next((r[8] for r in COMPANIES if r[0] == name), 0)
        announced  = _days_ago(random.randint(90, 730))
        investors  = random.sample(
            ["Sequoia", "a16z", "Kleiner Perkins", "GV", "Bessemer",
             "Founders Fund", "Tiger Global", "Accel", "NEA", "Greylock"],
            k=random.randint(1, 3)
        )
        cur.execute(
            """
            INSERT INTO cvc.funding_rounds
              (company_id, round_type, amount_usd, announced_date, investors, source)
            VALUES (%s, %s, %s, %s, %s, 'demo_seed')
            """,
            (cid, round_type, raised, announced, investors),
        )
        inserted_fr += 1

    conn.commit()
    print(f"Funding rounds: {inserted_fr} inserted")

    # ── Deal pipeline (company_lifecycle) ─────────────────────────────────────

    inserted_lc = 0
    for (name, _, _, stage, *_rest) in COMPANIES:
        cid = company_ids.get(name)
        if not cid:
            continue
        pipeline_stage = LIFECYCLE_STAGES.get(stage, "sourced")
        cur.execute(
            "SELECT id FROM cvc.company_lifecycle WHERE company_id = %s LIMIT 1", (cid,)
        )
        if cur.fetchone():
            continue
        priority = random.choice(["high", "medium", "medium", "low"])
        entered  = _days_ago(random.randint(14, 365))
        try:
            cur.execute(
                """
                INSERT INTO cvc.company_lifecycle
                  (company_id, stage, status, priority, source, entered_at)
                VALUES (%s, %s, 'active', %s, 'demo_seed', %s)
                """,
                (cid, pipeline_stage, priority, entered),
            )
            inserted_lc += 1
        except Exception:
            conn.rollback()
            continue

    conn.commit()
    print(f"Pipeline entries: {inserted_lc} inserted")

    # ── Partners ──────────────────────────────────────────────────────────────

    cur.execute("SELECT LOWER(name) FROM cvc.partners")
    existing_partners = {r["lower"] for r in cur.fetchall()}

    partner_ids = []
    inserted_p  = 0
    for (pname, notes, industry, challenges) in PARTNERS:
        if pname.lower() in existing_partners:
            cur.execute("SELECT id FROM cvc.partners WHERE LOWER(name) = %s", (pname.lower(),))
            row = cur.fetchone()
            if row:
                partner_ids.append(row["id"])
            continue
        cur.execute(
            """
            INSERT INTO cvc.partners (name, industry, notes, challenge_areas, created_at, updated_at)
            VALUES (%s, %s, %s, %s, NOW(), NOW())
            RETURNING id
            """,
            (pname, industry, notes, challenges),
        )
        pid = cur.fetchone()["id"]
        partner_ids.append(pid)
        existing_partners.add(pname.lower())
        inserted_p += 1

    conn.commit()
    print(f"Partners: {inserted_p} inserted, {len(PARTNERS) - inserted_p} skipped")

    # ── Partner matches ───────────────────────────────────────────────────────

    inserted_pm = 0
    all_cids = list(company_ids.values())
    for pid in partner_ids:
        # Each partner gets 4-7 suggested matches
        sample = random.sample(all_cids, min(random.randint(4, 7), len(all_cids)))
        for cid in sample:
            cur.execute(
                "SELECT id FROM cvc.partner_matches WHERE partner_id=%s AND company_id=%s",
                (pid, cid)
            )
            if cur.fetchone():
                continue
            score = random.randint(52, 94)
            reasons = [
                "Strong sector alignment and deployment-ready product",
                "Technology addresses partner's stated challenge area",
                "Proven pilots with similar enterprise customers",
                "Complementary to partner's existing tech stack",
                "Management team with relevant domain experience",
            ]
            try:
                cur.execute(
                    """
                    INSERT INTO cvc.partner_matches
                      (partner_id, company_id, match_score, match_reason, status)
                    VALUES (%s, %s, %s, %s, 'suggested')
                    """,
                    (pid, cid, score, random.choice(reasons)),
                )
                inserted_pm += 1
            except Exception:
                conn.rollback()
                continue

    conn.commit()
    print(f"Partner matches: {inserted_pm} inserted")

    cur.close()
    conn.close()

    print()
    print("Demo seed complete.")
    print(f"  {len(COMPANIES)} companies · {len(PARTNERS)} partners · pipeline wired")
    print()
    print("Login at http://localhost:5173 (dev) or http://localhost:8002/app (prod)")
    print("Default credentials: admin / changeme")


if __name__ == "__main__":
    try:
        seed()
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)
