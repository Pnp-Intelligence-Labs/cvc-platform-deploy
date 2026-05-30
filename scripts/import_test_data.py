#!/usr/bin/env python3
"""
scripts/import_test_data.py — Load an exported CVC dataset into a local deployment.

Reads companies.json / partners.json / funding_rounds.json from a directory and
inserts them into cvc.companies / cvc.partners / cvc.funding_rounds.

Generic by design: introspects each table's real columns and only inserts keys
that exist as columns, so it survives schema drift between deployments. Source
row IDs are preserved (FKs in funding_rounds stay valid) and the SERIAL
sequences are bumped past the max imported ID afterward.

By default it TRUNCATEs the three tables first (clean import). Pass --append to
keep existing rows.

Usage:
    python3 scripts/import_test_data.py /path/to/data_dir
    python3 scripts/import_test_data.py /path/to/data_dir --append
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
            os.environ.setdefault(k.strip(), v.strip())

DB = dict(
    host=os.environ.get("DB_HOST", "localhost"),
    port=int(os.environ.get("DB_PORT", "5432")),
    dbname=os.environ.get("DB_NAME", "platform_db"),
    user=os.environ.get("DB_USER", "platform"),
    password=os.environ.get("DB_PASSWORD", "platform_local"),
)

# (json file, table) — load companies before funding_rounds (FK dependency)
SOURCES = [
    ("companies.json", "companies"),
    ("partners.json", "partners"),
    ("funding_rounds.json", "funding_rounds"),
]


def table_columns(cur, table: str) -> dict[str, str]:
    """Return {column_name: data_type} for a cvc table."""
    cur.execute(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_schema='cvc' AND table_name=%s",
        [table],
    )
    return {r[0]: r[1] for r in cur.fetchall()}


def import_table(cur, rows: list[dict], table: str, append: bool) -> int:
    if not rows:
        print(f"  {table}: source empty, skipped")
        return 0

    cols = table_columns(cur, table)
    if not append:
        cur.execute(f"TRUNCATE cvc.{table} RESTART IDENTITY CASCADE")

    # Columns present in BOTH the source rows and the table, stable order
    src_keys = [k for k in rows[0].keys() if k in cols]
    skipped = sorted(set(rows[0].keys()) - cols.keys())

    col_list = ", ".join(src_keys)
    placeholders = ", ".join(["%s"] * len(src_keys))
    sql = f"INSERT INTO cvc.{table} ({col_list}) VALUES ({placeholders})"

    # jsonb columns need dict/list values wrapped so psycopg2 serialises them as JSON
    json_keys = {k for k in src_keys if cols[k] == "jsonb"}

    def adapt(key, val):
        if val is not None and key in json_keys:
            return psycopg2.extras.Json(val)
        return val

    values = [[adapt(k, r.get(k)) for k in src_keys] for r in rows]
    psycopg2.extras.execute_batch(cur, sql, values, page_size=500)

    # Bump the id sequence past the max imported id so future inserts don't collide
    if "id" in src_keys:
        cur.execute(
            f"SELECT setval(pg_get_serial_sequence('cvc.{table}','id'), "
            f"GREATEST((SELECT MAX(id) FROM cvc.{table}), 1))"
        )

    note = f" (skipped non-columns: {', '.join(skipped)})" if skipped else ""
    print(f"  {table}: imported {len(rows)} rows{note}")
    return len(rows)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    append = "--append" in sys.argv
    if not args:
        sys.exit("Usage: import_test_data.py <data_dir> [--append]")
    data_dir = Path(args[0])
    if not data_dir.is_dir():
        sys.exit(f"Not a directory: {data_dir}")

    conn = psycopg2.connect(**DB)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            print(f"Importing from {data_dir} ({'append' if append else 'clean'} mode)")
            for fname, table in SOURCES:
                path = data_dir / fname
                if not path.exists():
                    print(f"  {table}: {fname} not found, skipped")
                    continue
                rows = json.loads(path.read_text())
                import_table(cur, rows, table, append)
        conn.commit()
        print("Committed.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
