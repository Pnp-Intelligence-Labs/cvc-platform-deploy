#!/usr/bin/env python3
"""
scripts/import_test_data.py — Load an exported CVC dataset into a local deployment.

Reads companies.json / partners.json / funding_rounds.json / portfolio.json from
a directory and inserts them into the corresponding cvc.* tables.

Default (clean) mode:
  TRUNCATEs cvc.companies, cvc.partners, cvc.funding_rounds then re-imports
  everything, preserving source IDs so funding_rounds FKs stay valid.
  Sequences are bumped past the max imported id afterward.

--append mode (add on top, deduplicate):
  Name-based upsert for companies and partners — updates existing rows matched
  by name, inserts new ones (DB assigns a fresh id). Funding rounds are
  deduplicated against what is already in the DB before inserting.
  portfolio.json embedded rounds are merged into the round pool.
  company_lifecycle rows are created for all portfolio companies (idempotent).

Usage:
    python3 scripts/import_test_data.py data/test_data
    python3 scripts/import_test_data.py data/test_data --append
"""
import json
import os
import sys
from pathlib import Path

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    sys.exit("psycopg2 not installed. Run: pip install psycopg2-binary")

REPO = Path(__file__).resolve().parent.parent

env_file = REPO / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            v = v.strip()
            if v:  # skip blank values so script defaults (platform_local) stay effective
                os.environ.setdefault(k.strip(), v)

DB = dict(
    host=os.environ.get("DB_HOST", "localhost"),
    port=int(os.environ.get("DB_PORT", "5432")),
    dbname=os.environ.get("DB_NAME", "platform_db"),
    user=os.environ.get("DB_USER", "platform"),
    password=os.environ.get("DB_PASSWORD", "platform_local"),
)

# ── Stage normalization ────────────────────────────────────────────────────────
# The export mixes snake_case, title case, and abbreviations. Map everything to
# a canonical readable form before inserting so filters and UI labels are clean.

_STAGE_MAP = {
    "pre_seed":              "Pre-Seed",
    "pre-seed":              "Pre-Seed",
    "pre seed":              "Pre-Seed",
    "seed":                  "Seed",
    "series_a":              "Series A",
    "series a":              "Series A",
    "series_b":              "Series B",
    "series b":              "Series B",
    "series_c":              "Series C",
    "series c":              "Series C",
    "series_d":              "Series D+",
    "series d":              "Series D+",
    "series d+":             "Series D+",
    "series_e":              "Series E",
    "series e":              "Series E",
    "series_f":              "Series F",
    "series_g":              "Series G+",
    "series_h":              "Series G+",
    "series_i":              "Series G+",
    "series unknown":        "Undisclosed",
    "growth":                "Growth",
    "public":                "Public",
    "post ipo equity":       "Public",
    "post ipo debt":         "Public",
    "post ipo secondary":    "Public",
    "private equity":        "Private Equity",
    "angel":                 "Angel",
    "convertible note":      "Convertible Note",
    "equity crowdfunding":   "Equity Crowdfunding",
    "debt financing":        "Debt Financing",
    "corporate round":       "Corporate Round",
    "grant":                 "Grant",
    "non equity assistance": "Non-Equity Assistance",
    "undisclosed":           "Undisclosed",
    "n/a":                   "Undisclosed",
    "none":                  "Undisclosed",
    "out of business":       "Out of Business",
}


def normalize_stage(s):
    if not s:
        return "Undisclosed"
    return _STAGE_MAP.get(str(s).lower().strip(), s)


# ── DB helpers ─────────────────────────────────────────────────────────────────

def table_columns(cur, table):
    """Return {column_name: data_type} for a cvc.* table."""
    cur.execute(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_schema='cvc' AND table_name=%s",
        [table],
    )
    return {r[0]: r[1] for r in cur.fetchall()}


def to_json(val, key, json_keys):
    if val is not None and key in json_keys:
        return psycopg2.extras.Json(val)
    return val


def bump_seq(cur, table):
    cur.execute(
        f"SELECT setval(pg_get_serial_sequence('cvc.{table}','id'), "
        f"GREATEST((SELECT MAX(id) FROM cvc.{table}), 1))"
    )


# ── Clean mode ─────────────────────────────────────────────────────────────────

def import_clean(cur, rows, table, normalize_stages=False):
    """TRUNCATE then bulk-insert, preserving source IDs. Returns identity source→db map."""
    if not rows:
        print(f"  {table}: empty, skipped")
        return {}

    if normalize_stages:
        for r in rows:
            if "stage" in r:
                r["stage"] = normalize_stage(r["stage"])

    cols = table_columns(cur, table)
    cur.execute(f"TRUNCATE cvc.{table} RESTART IDENTITY CASCADE")

    src_keys = [k for k in rows[0] if k in cols]
    dropped = sorted(set(rows[0]) - cols.keys())
    json_keys = {k for k in src_keys if cols[k] == "jsonb"}

    col_list = ", ".join(src_keys)
    ph = ", ".join(["%s"] * len(src_keys))
    sql = f"INSERT INTO cvc.{table} ({col_list}) VALUES ({ph})"

    values = [[to_json(r.get(k), k, json_keys) for k in src_keys] for r in rows]
    psycopg2.extras.execute_batch(cur, sql, values, page_size=500)
    bump_seq(cur, table)

    note = f"  (dropped non-columns: {', '.join(dropped)})" if dropped else ""
    print(f"  {table}: {len(rows)} rows inserted{note}")
    return {r["id"]: r["id"] for r in rows if "id" in r}


# ── Append / upsert mode ───────────────────────────────────────────────────────

def upsert_named(cur, rows, table, normalize_stages=False):
    """
    Name-based upsert: update existing rows (matched by name), insert new ones.
    New inserts omit the source id so the DB sequence assigns a fresh id.
    Returns {source_id → db_id} map (used to remap funding_rounds FKs).
    """
    if not rows:
        print(f"  {table}: empty, skipped")
        return {}

    if normalize_stages:
        for r in rows:
            if "stage" in r:
                r["stage"] = normalize_stage(r["stage"])

    cols = table_columns(cur, table)

    cur.execute(f"SELECT id, name FROM cvc.{table}")
    existing = {name.lower(): db_id for db_id, name in cur.fetchall()}

    all_keys  = [k for k in rows[0] if k in cols]
    data_keys = [k for k in all_keys if k != "id"]   # exclude id for both update and insert
    json_keys = {k for k in all_keys if cols[k] == "jsonb"}
    dropped   = sorted(set(rows[0]) - cols.keys())

    to_update, to_insert = [], []
    source_id_map = {}

    for r in rows:
        name_lower = (r.get("name") or "").lower()
        if name_lower in existing:
            db_id = existing[name_lower]
            source_id_map[r["id"]] = db_id
            to_update.append((r, db_id))
        else:
            to_insert.append(r)

    # Batch UPDATE existing rows
    if to_update:
        set_clause = ", ".join(f"{k}=%s" for k in data_keys)
        sql = f"UPDATE cvc.{table} SET {set_clause} WHERE id=%s"
        vals_list = []
        for r, db_id in to_update:
            row = [to_json(r.get(k), k, json_keys) for k in data_keys]
            row.append(db_id)
            vals_list.append(row)
        psycopg2.extras.execute_batch(cur, sql, vals_list, page_size=200)

    # INSERT new rows one-by-one to capture RETURNING id for the FK map
    n_inserted = 0
    if to_insert:
        col_list = ", ".join(data_keys)
        ph = ", ".join(["%s"] * len(data_keys))
        sql = f"INSERT INTO cvc.{table} ({col_list}) VALUES ({ph}) RETURNING id"
        for r in to_insert:
            row = [to_json(r.get(k), k, json_keys) for k in data_keys]
            cur.execute(sql, row)
            source_id_map[r["id"]] = cur.fetchone()[0]
            n_inserted += 1

    bump_seq(cur, table)
    note = f"  (dropped non-columns: {', '.join(dropped)})" if dropped else ""
    print(f"  {table}: {len(to_update)} updated, {n_inserted} inserted{note}")
    return source_id_map


# ── Funding rounds ─────────────────────────────────────────────────────────────

def import_rounds(cur, rounds, source_id_map, append):
    """
    Import funding rounds with full deduplication.

    - Remaps company_id from source → DB id using source_id_map.
    - Deduplicates the source pool by (company_id, round_type, announced_date).
    - In append mode, also skips rounds already present in the DB.
    - Always omits the source `id` to avoid PK conflicts; DB assigns fresh ids.
    """
    if not rounds:
        print("  funding_rounds: no source rounds")
        return

    cols = table_columns(cur, "funding_rounds")

    if not append:
        cur.execute("TRUNCATE cvc.funding_rounds RESTART IDENTITY CASCADE")

    # Remap company_id
    remapped = []
    for r in rounds:
        r2 = dict(r)
        r2["company_id"] = source_id_map.get(r2.get("company_id"), r2.get("company_id"))
        remapped.append(r2)

    # Dedup within source pool
    seen = set()
    deduped = []
    for r in remapped:
        key = (r.get("company_id"), r.get("round_type"), r.get("announced_date"))
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    # In append mode skip rounds already in DB
    if append:
        cur.execute(
            "SELECT company_id, round_type, announced_date::text FROM cvc.funding_rounds"
        )
        db_existing = {(row[0], row[1], row[2]) for row in cur.fetchall()}

        before = len(deduped)
        net_new = []
        for r in deduped:
            announced = str(r.get("announced_date"))[:10] if r.get("announced_date") else None
            if (r.get("company_id"), r.get("round_type"), announced) not in db_existing:
                net_new.append(r)
        skipped_cnt = before - len(net_new)
        if skipped_cnt:
            print(f"  funding_rounds: {skipped_cnt} already in DB, skipping")
        deduped = net_new

    if not deduped:
        print("  funding_rounds: nothing new to insert")
        return

    # Union of all keys across all rows (embedded portfolio rounds have fewer fields)
    insert_keys = sorted({k for r in deduped for k in r if k in cols and k != "id"})
    json_keys = {k for k in insert_keys if cols[k] == "jsonb"}

    col_list = ", ".join(insert_keys)
    ph = ", ".join(["%s"] * len(insert_keys))
    sql = f"INSERT INTO cvc.funding_rounds ({col_list}) VALUES ({ph})"

    values = [[to_json(r.get(k), k, json_keys) for k in insert_keys] for r in deduped]
    psycopg2.extras.execute_batch(cur, sql, values, page_size=500)
    bump_seq(cur, "funding_rounds")
    print(f"  funding_rounds: {len(deduped)} rows inserted")


# ── Portfolio lifecycle ────────────────────────────────────────────────────────

def import_portfolio_lifecycle(cur, portfolio, source_id_map):
    """
    Create company_lifecycle rows (stage='portfolio', status='active') for every
    portfolio company. Idempotent via the UNIQUE (company_id, stage, status) constraint.
    """
    inserted = skipped = 0
    for p in portfolio:
        db_id = source_id_map.get(p.get("id"), p.get("id"))
        cur.execute(
            """
            INSERT INTO cvc.company_lifecycle (company_id, stage, status, entered_at)
            VALUES (%s, 'portfolio', 'invested', NOW())
            ON CONFLICT (company_id, stage, status) DO NOTHING
            """,
            [db_id],
        )
        if cur.rowcount:
            inserted += 1
        else:
            skipped += 1
    print(f"  company_lifecycle: {inserted} portfolio entries added, {skipped} already existed")


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    cli_args = [a for a in sys.argv[1:] if not a.startswith("--")]
    append = "--append" in sys.argv
    if not cli_args:
        sys.exit("Usage: import_test_data.py <data_dir> [--append]")
    data_dir = Path(cli_args[0])
    if not data_dir.is_dir():
        sys.exit(f"Not a directory: {data_dir}")

    conn = psycopg2.connect(**DB)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            print(f"Importing from {data_dir}  mode={'append' if append else 'clean'}\n")

            def load(fname):
                p = data_dir / fname
                return json.loads(p.read_text()) if p.exists() else []

            companies = load("companies.json")
            partners  = load("partners.json")
            rounds    = load("funding_rounds.json")
            portfolio = load("portfolio.json")

            # Merge portfolio.json into main data:
            #   • mark those companies as is_portfolio=True in the companies list
            #   • pull their embedded funding_rounds into the shared rounds pool
            if portfolio:
                id_to_company = {c["id"]: c for c in companies}
                for p in portfolio:
                    if p["id"] in id_to_company:
                        id_to_company[p["id"]]["is_portfolio"] = True
                    for r in (p.get("funding_rounds") or []):
                        r2 = dict(r)
                        r2["company_id"] = p["id"]
                        rounds.append(r2)

            # 1. Companies
            if append:
                source_id_map = upsert_named(cur, companies, "companies", normalize_stages=True)
            else:
                source_id_map = import_clean(cur, companies, "companies", normalize_stages=True)

            # 2. Partners
            if append:
                upsert_named(cur, partners, "partners")
            else:
                import_clean(cur, partners, "partners")

            # 3. Funding rounds (deduped + FK-remapped)
            import_rounds(cur, rounds, source_id_map, append)

            # 4. Lifecycle entries for portfolio companies
            if portfolio:
                import_portfolio_lifecycle(cur, portfolio, source_id_map)

        conn.commit()
        print("\nDone — committed.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
