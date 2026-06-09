"""
core.db.migrate
---------------
Python-based migration runner. Uses psycopg2 directly — no psql CLI required.

All migrations live in core/db/migrations/*.sql, run in lexicographic order.
Safe to re-run: every migration uses IF NOT EXISTS / IF EXISTS, so errors in
individual statements are caught and logged but do not abort the run.

Usage:
    python -m core.db.migrate
"""

import os
import pathlib

import psycopg2

MIGRATIONS_DIR = pathlib.Path(__file__).parent / "migrations"


def _conn_params() -> dict:
    return {
        "host": os.environ.get("DB_HOST", "localhost"),
        "port": int(os.environ.get("DB_PORT", 5432)),
        "dbname": os.environ.get("DB_NAME", "platform_db"),
        "user": os.environ.get("DB_USER", "platform"),
        "password": os.environ.get("DB_PASSWORD", ""),
    }


def run_migrations() -> None:
    params = _conn_params()
    print(
        f"Running migrations against "
        f"{params['dbname']}@{params['host']}:{params['port']} ..."
    )

    sql_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not sql_files:
        print("No migration files found in", MIGRATIONS_DIR)
        return

    conn = psycopg2.connect(**params)
    try:
        for sql_path in sql_files:
            print(f"  -> {sql_path.name}")
            sql = sql_path.read_text(encoding="utf-8")

            # Split on semicolons so each statement is executed individually.
            # This mirrors ON_ERROR_STOP=0 behaviour: a failure in one
            # statement is logged but execution continues.
            statements = [s.strip() for s in sql.split(";") if s.strip()]
            for stmt in statements:
                cur = conn.cursor()
                try:
                    cur.execute(stmt)
                    conn.commit()
                except Exception as exc:  # noqa: BLE001
                    conn.rollback()
                    print(f"     [warn] {exc}")
                finally:
                    cur.close()
    finally:
        conn.close()

    print("Done.")


if __name__ == "__main__":
    run_migrations()
