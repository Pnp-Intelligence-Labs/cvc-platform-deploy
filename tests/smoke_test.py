"""
smoke_test.py — Quick API verification after every deployment.

Usage:
    python tests/smoke_test.py
    python tests/smoke_test.py --host 100.95.2.44 --port 8001
    CVC_SMOKE_PASSWORD=... python tests/smoke_test.py --user nate

BigBossHog: run this after every git pull + server restart.
Report the full output back to Nate. Do not try to fix failures yourself.
"""

import sys
import argparse
import os
import requests

HEADERS = {}   # set by main() after JWT login
BASE    = ""   # set by main()
RESULTS = []   # accumulates pass/fail booleans


# ── Helpers ───────────────────────────────────────────────────────────────────

def check(label, url, expect_keys=None, expect_min_items=None, allow_empty=False):
    try:
        r = requests.get(url, timeout=10, headers=HEADERS)
        if r.status_code != 200:
            print(f"  FAIL  {label} — HTTP {r.status_code}")
            print(f"        {r.text[:200]}")
            RESULTS.append(False)
            return False

        data = r.json()

        if expect_keys:
            missing = [k for k in expect_keys if k not in data]
            if missing:
                print(f"  FAIL  {label} — missing keys: {missing}")
                print(f"        Got: {list(data.keys()) if isinstance(data, dict) else type(data)}")
                RESULTS.append(False)
                return False

        if expect_min_items is not None and not allow_empty:
            if isinstance(data, list):
                count = len(data)
            else:
                counts = [len(v) for v in data.values() if isinstance(v, list)]
                count = max(counts) if counts else 0
            if count < expect_min_items:
                print(f"  FAIL  {label} — expected ≥{expect_min_items} items, got {count}")
                RESULTS.append(False)
                return False

        print(f"  OK    {label}")
        RESULTS.append(True)
        return True

    except requests.exceptions.ConnectionError:
        print(f"  FAIL  {label} — connection refused (server not running?)")
        RESULTS.append(False)
        return False
    except Exception as e:
        print(f"  FAIL  {label} — {e}")
        RESULTS.append(False)
        return False


def post_check(label, url, payload, expect_keys=None, expect_status=201):
    """POST a payload and verify the response shape."""
    try:
        r = requests.post(url, json=payload, timeout=10, headers=HEADERS)
        if r.status_code != expect_status:
            print(f"  FAIL  {label} — HTTP {r.status_code} (expected {expect_status})")
            print(f"        {r.text[:300]}")
            RESULTS.append(False)
            return None

        data = r.json()
        if expect_keys:
            missing = [k for k in expect_keys if k not in data]
            if missing:
                print(f"  FAIL  {label} — missing keys: {missing}")
                RESULTS.append(False)
                return None

        print(f"  OK    {label}")
        RESULTS.append(True)
        return data

    except Exception as e:
        print(f"  FAIL  {label} — {e}")
        RESULTS.append(False)
        return None


def section(title):
    print(f"\n  ── {title}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    global HEADERS, BASE

    parser = argparse.ArgumentParser()
    parser.add_argument("--host",     default="localhost")
    parser.add_argument("--port",     default="8001")
    parser.add_argument("--user",     default="nate")
    parser.add_argument("--password", default=os.environ.get("CVC_SMOKE_PASSWORD", ""))
    args = parser.parse_args()

    if not args.password:
        print("  FAIL  JWT login — set --password or CVC_SMOKE_PASSWORD")
        sys.exit(1)

    BASE = f"http://{args.host}:{args.port}"
    print(f"\nSmoke test — {BASE}\n")

    # ── Auth ──────────────────────────────────────────────────────────────────
    try:
        r = requests.post(
            f"{BASE}/auth/login",
            json={"username": args.user, "password": args.password},
            timeout=10,
        )
        if r.status_code != 200:
            print(f"  FAIL  JWT login — HTTP {r.status_code}: {r.text[:200]}")
            sys.exit(1)
        token = r.json()["access_token"]
        HEADERS = {"Authorization": f"Bearer {token}"}
        print(f"  OK    JWT login ({args.user})")
    except Exception as e:
        print(f"  FAIL  JWT login — {e}")
        sys.exit(1)

    # ── Route count guard ──────────────────────────────────────────────────────
    # Floor at 230 — catches wholesale main.py breakage.
    # Current baseline: ~233 routes.
    MIN_ROUTES = 230
    try:
        r = requests.get(f"{BASE}/openapi.json", timeout=10, headers=HEADERS)
        if r.status_code == 200:
            route_count = len(r.json().get("paths", {}))
            if route_count < MIN_ROUTES:
                print(f"  FAIL  Route count — {route_count} routes (floor: {MIN_ROUTES})")
                print(f"        api/main.py is likely missing include_router() calls")
                RESULTS.append(False)
            else:
                print(f"  OK    Route count ({route_count} routes)")
                RESULTS.append(True)
        else:
            print(f"  FAIL  Route count — /openapi.json HTTP {r.status_code}")
            RESULTS.append(False)
    except Exception as e:
        print(f"  FAIL  Route count — {e}")
        RESULTS.append(False)

    # ── Health ────────────────────────────────────────────────────────────────
    check("GET /health", f"{BASE}/health", expect_keys=["status"])

    # ── Companies ─────────────────────────────────────────────────────────────
    section("Companies")
    check("GET /companies (no filter)",        f"{BASE}/companies",                       expect_min_items=1)
    check("GET /companies?sector=Robotics",    f"{BASE}/companies?sector=Robotics",       expect_min_items=1)
    check("GET /companies?q=robot",            f"{BASE}/companies?q=robot",               expect_min_items=1)

    company_id = None
    r = requests.get(f"{BASE}/companies/?limit=1", timeout=10, headers=HEADERS)
    if r.status_code == 200 and r.json():
        company_id = r.json()[0]["id"]
        check(f"GET /companies/{company_id}", f"{BASE}/companies/{company_id}",
              expect_keys=["id", "name", "sector"])
    else:
        print("  SKIP  GET /companies/{id} — couldn't get a company ID")

    # ── Portfolio ─────────────────────────────────────────────────────────────
    section("Portfolio")
    check("GET /portfolio/",       f"{BASE}/portfolio/",      expect_min_items=1)
    check("GET /portfolio/stats",  f"{BASE}/portfolio/stats", expect_keys=["total_companies"])

    # ── Trends ───────────────────────────────────────────────────────────────
    section("Trends")
    check("GET /trends/sectors",   f"{BASE}/trends/sectors",  expect_keys=["sectors"], expect_min_items=1)
    check("GET /trends/quarters",  f"{BASE}/trends/quarters", expect_keys=["quarters"], expect_min_items=1)
    check("GET /trends/dashboard?sector=robotics&quarter=Q4-2025",
          f"{BASE}/trends/dashboard?sector=robotics&quarter=Q4-2025",
          expect_keys=["sector", "quarter", "total_signals"])
    check("GET /trends/funding?sector=robotics&quarter=Q4-2025",
          f"{BASE}/trends/funding?sector=robotics&quarter=Q4-2025",
          expect_keys=["sector", "quarter", "funding_events"])

    # ── Partners ──────────────────────────────────────────────────────────────
    section("Partners")
    check("GET /partners/ (shape)",        f"{BASE}/partners/",           expect_keys=["partners", "total"])
    check("GET /partners/ (has data)",     f"{BASE}/partners/",           expect_min_items=1)
    check("GET /partners/issues/all",      f"{BASE}/partners/issues/all", expect_keys=["issues"])

    # ── Deal Flow ─────────────────────────────────────────────────────────────
    section("Deal Flow")
    check("GET /dealflow/", f"{BASE}/dealflow/", allow_empty=True)

    # ── Home ──────────────────────────────────────────────────────────────────
    section("Home")
    check("GET /home/messages", f"{BASE}/home/messages", allow_empty=True)

    # ── Requests ──────────────────────────────────────────────────────────────
    section("Requests")
    check("GET /requests",          f"{BASE}/requests",          expect_keys=["requests"], allow_empty=True)
    check("GET /requests (detail)", f"{BASE}/requests/1",        expect_keys=["id", "title", "status"])

    # ── Sales ─────────────────────────────────────────────────────────────────
    section("Sales")
    check("GET /sales/targets",          f"{BASE}/sales/targets",          expect_min_items=1)
    check("GET /sales/pipeline-summary", f"{BASE}/sales/pipeline-summary", allow_empty=True)
    check("GET /sales/leaderboard",      f"{BASE}/sales/leaderboard",      allow_empty=True)
    check("GET /sales/targets/90/notes", f"{BASE}/sales/targets/90/notes", allow_empty=True)

    # ── Meeting Notes ─────────────────────────────────────────────────────────
    section("Meeting Notes")
    # Write test: create a meeting note against company 1358
    note_result = post_check(
        "POST /notes (ventures meeting note)",
        f"{BASE}/notes",
        payload={
            "context_type":    "ventures",
            "company_id":      1358,
            "company_name":    "Smoke Test Co",
            "met_at":          "2026-05-05",
            "rating_founder":  4,
            "note_founder":    "Smoke test — auto-generated",
            "personal_note":   "Smoke test private note",
        },
        expect_keys=["id", "company_id"],
        expect_status=200,
    )
    # Read back
    check("GET /notes?company_id=1358", f"{BASE}/notes?company_id=1358", allow_empty=True)

    # ── Ventures ──────────────────────────────────────────────────────────────
    section("Ventures")
    check("GET /ventures/assignments",  f"{BASE}/ventures/assignments", allow_empty=True)
    check("GET /ventures/sector-eval/subsectors?sector=Manufacturing",
          f"{BASE}/ventures/sector-eval/subsectors?sector=Manufacturing",
          allow_empty=True)
    check("GET /ventures/sector-eval/team-completion",
          f"{BASE}/ventures/sector-eval/team-completion",
          allow_empty=True)

    # ── Enrichment ────────────────────────────────────────────────────────────
    section("Enrichment")
    if company_id:
        check(f"GET /admin/status/{company_id}",
              f"{BASE}/admin/status/{company_id}",
              expect_keys=["founder", "fourD", "funding", "cases"])

    # ── Brambles ─────────────────────────────────────────────────────────────
    section("Brambles")
    check("GET /brambles/companies",   f"{BASE}/brambles/companies",   allow_empty=True)
    check("GET /brambles/companies/3", f"{BASE}/brambles/companies/3", expect_keys=["id", "company_name"])

    # ── Intelligence ──────────────────────────────────────────────────────────
    section("Intelligence")
    check("GET /intelligence/",          f"{BASE}/intelligence/",          allow_empty=True)
    check("GET /intelligence/sources",   f"{BASE}/intelligence/sources",   allow_empty=True)
    check("GET /intelligence/llm-usage", f"{BASE}/intelligence/llm-usage", allow_empty=True)

    # ── Summary ───────────────────────────────────────────────────────────────
    passed = sum(RESULTS)
    total  = len(RESULTS)
    print(f"\n{passed}/{total} checks passed\n")

    if passed < total:
        print("FAILED — report full output to Nate. Do not attempt to fix.")
        sys.exit(1)
    else:
        print("ALL PASSED — server is healthy.")


if __name__ == "__main__":
    main()
