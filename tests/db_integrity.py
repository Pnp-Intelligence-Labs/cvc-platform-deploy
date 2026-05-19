"""
db_integrity.py — Data health checks for cvc_db.

Runs SQL queries that should return zero rows. Any rows returned = a problem.
Also runs minimum-count checks to catch silent data loss.

Usage:
    python tests/db_integrity.py
    python tests/db_integrity.py --verbose   # print bad rows

Run weekly, after bulk imports, or any time data looks off.
Does NOT modify data — read-only queries only.
"""

import sys
import argparse
import os
import psycopg2
import psycopg2.extras

RESULTS = []

# ── DB connection ──────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(
        host=os.environ.get("CVC_DB_HOST", "localhost"),
        dbname="cvc_db",
        user="producer",
        password=os.environ.get("CVC_DB_PASSWORD", "producer_2026"),
    )


# ── Helpers ────────────────────────────────────────────────────────────────────

VERBOSE = False


def bad_rows(label, sql, description, params=None):
    """Runs sql — expects zero rows. Any rows = data problem."""
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()
        if rows:
            print(f"  WARN  {label} — {len(rows)} bad row(s): {description}")
            if VERBOSE:
                for r in rows[:5]:
                    print(f"        {dict(r)}")
            RESULTS.append(False)
            return False
        else:
            print(f"  OK    {label}")
            RESULTS.append(True)
            return True
    except Exception as e:
        print(f"  FAIL  {label} — query error: {e}")
        RESULTS.append(False)
        return False


def min_count(label, sql, minimum, description=""):
    """Runs a COUNT query — fails if count < minimum."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                count = cur.fetchone()[0]
        if count < minimum:
            print(f"  WARN  {label} — count={count}, expected ≥{minimum}. {description}")
            RESULTS.append(False)
            return False
        else:
            print(f"  OK    {label} (count={count})")
            RESULTS.append(True)
            return True
    except Exception as e:
        print(f"  FAIL  {label} — query error: {e}")
        RESULTS.append(False)
        return False


def section(title):
    print(f"\n  ── {title}")


# ── Checks ────────────────────────────────────────────────────────────────────

def check_companies():
    section("Companies")

    min_count(
        "Companies — total count",
        "SELECT COUNT(*) FROM cvc.companies",
        1500,
        "Expected 1,500+ companies",
    )

    min_count(
        "Companies — portfolio flagged",
        "SELECT COUNT(*) FROM cvc.companies WHERE is_portfolio = TRUE",
        60,
        "Expected 60+ portfolio companies",
    )

    bad_rows(
        "Companies — enrichment stuck in 'running'",
        """
        SELECT id, name, enrichment_status, updated_at
        FROM cvc.companies
        WHERE enrichment_status = 'running'
          AND updated_at < NOW() - INTERVAL '4 hours'
        """,
        "enrichment_status='running' for >4h — worker likely crashed",
    )

    bad_rows(
        "Companies — scored but no composite score",
        """
        SELECT id, name, enrichment_status
        FROM cvc.companies
        WHERE enrichment_status = 'complete'
          AND score_composite IS NULL
          AND phase2_enriched_at IS NOT NULL
        LIMIT 20
        """,
        "phase2 complete but score_composite still NULL — scoring worker may have missed these",
    )

    bad_rows(
        "Companies — invalid sector value",
        """
        SELECT id, name, sector
        FROM cvc.companies
        WHERE sector IS NOT NULL
          AND sector NOT IN (
            'Robotics','Supply Chain','Manufacturing',
            'Industrial Automation','Physical AI',
            'Defense','Energy','Healthcare','Other'
          )
        LIMIT 20
        """,
        "sector value not in allowed set — check for typos or snake_case",
    )

    bad_rows(
        "Companies — portfolio without term sheet",
        """
        SELECT c.id, c.name
        FROM cvc.companies c
        LEFT JOIN cvc.term_sheets t ON t.company_id = c.id
        WHERE c.is_portfolio = TRUE
          AND t.id IS NULL
        """,
        "is_portfolio=TRUE but no term_sheet row — missing investment record",
    )


def check_lifecycle():
    section("Company Lifecycle")

    bad_rows(
        "Lifecycle — invalid status values",
        """
        SELECT id, company_id, status
        FROM cvc.company_lifecycle
        WHERE status NOT IN ('due_diligence', 'approved', 'invested')
        """,
        "status value not in (due_diligence, approved, invested)",
    )

    bad_rows(
        "Lifecycle — invested without term sheet",
        """
        SELECT cl.id, cl.company_id, c.name
        FROM cvc.company_lifecycle cl
        JOIN cvc.companies c ON c.id = cl.company_id
        LEFT JOIN cvc.term_sheets t ON t.company_id = cl.company_id
        WHERE cl.status = 'invested'
          AND t.id IS NULL
        """,
        "lifecycle=invested but no term_sheet — investment record missing",
    )

    bad_rows(
        "Lifecycle — orphaned (company deleted)",
        """
        SELECT cl.id, cl.company_id
        FROM cvc.company_lifecycle cl
        LEFT JOIN cvc.companies c ON c.id = cl.company_id
        WHERE c.id IS NULL
        """,
        "company_lifecycle rows pointing to deleted companies",
    )


def check_term_sheets():
    section("Term Sheets")

    bad_rows(
        "Term sheets — missing fund",
        """
        SELECT id, company_id, investment_type
        FROM cvc.term_sheets
        WHERE fund IS NULL OR fund = ''
        """,
        "fund column is null/empty — required for portfolio reporting",
    )

    bad_rows(
        "Term sheets — missing investment_type",
        """
        SELECT id, company_id, fund
        FROM cvc.term_sheets
        WHERE investment_type IS NULL OR investment_type = ''
        """,
        "investment_type is null/empty",
    )

    bad_rows(
        "Term sheets — orphaned (company deleted)",
        """
        SELECT t.id, t.company_id
        FROM cvc.term_sheets t
        LEFT JOIN cvc.companies c ON c.id = t.company_id
        WHERE c.id IS NULL
        """,
        "term_sheet rows pointing to deleted companies",
    )


def check_users():
    section("Users")

    VALID_ROLES = (
        'GP', 'Principal', 'Director', 'Senior Director',
        'Ventures', 'PSM', 'Senior PSM', 'Sales Associate',
    )
    placeholders = ','.join(['%s'] * len(VALID_ROLES))

    bad_rows(
        "Users — invalid role",
        f"""
        SELECT id, username, role
        FROM cvc.users
        WHERE role NOT IN ({placeholders})
        """,
        "role value not in allowed set",
        params=VALID_ROLES,
    )

    bad_rows(
        "Users — duplicate username",
        """
        SELECT username, COUNT(*) AS n
        FROM cvc.users
        GROUP BY username
        HAVING COUNT(*) > 1
        """,
        "duplicate usernames in cvc.users",
    )


def check_requests():
    section("Requests")

    bad_rows(
        "Requests — orphaned assignees",
        """
        SELECT ra.request_id, ra.username
        FROM cvc.request_assignees ra
        LEFT JOIN cvc.requests r ON r.id = ra.request_id
        WHERE r.id IS NULL
        """,
        "request_assignees pointing to deleted requests",
    )

    bad_rows(
        "Requests — orphaned updates",
        """
        SELECT ru.id, ru.request_id
        FROM cvc.request_updates ru
        LEFT JOIN cvc.requests r ON r.id = ru.request_id
        WHERE r.id IS NULL
        """,
        "request_updates pointing to deleted requests",
    )

    bad_rows(
        "Requests — invalid status",
        """
        SELECT id, title, status
        FROM cvc.requests
        WHERE status NOT IN ('open', 'active', 'completed', 'cancelled')
        """,
        "status value not in allowed set",
    )


def check_sales():
    section("Sales")

    bad_rows(
        "Sales — closed_won without contract_value",
        """
        SELECT id, company_name, stage
        FROM cvc.sales_targets
        WHERE stage = 'closed_won'
          AND (contract_value IS NULL OR contract_value = 0)
        """,
        "closed_won deal with no contract_value — portal reporting will be wrong",
    )

    bad_rows(
        "Sales — closed_won without signed_date",
        """
        SELECT id, company_name
        FROM cvc.sales_targets
        WHERE stage = 'closed_won'
          AND signed_date IS NULL
        """,
        "closed_won deal with no signed_date",
    )

    bad_rows(
        "Sales — orphaned contacts",
        """
        SELECT sc.id, sc.target_id, sc.full_name
        FROM cvc.sales_contacts sc
        LEFT JOIN cvc.sales_targets st ON st.id = sc.target_id
        WHERE st.id IS NULL
        """,
        "sales_contacts pointing to deleted targets",
    )

    bad_rows(
        "Sales — orphaned notes",
        """
        SELECT sn.id, sn.target_id
        FROM cvc.sales_notes sn
        LEFT JOIN cvc.sales_targets st ON st.id = sn.target_id
        WHERE st.id IS NULL
        """,
        "sales_notes pointing to deleted targets",
    )

    bad_rows(
        "Sales — meeting notes with no tech fields and no ratings",
        """
        SELECT id, target_id, author, created_at
        FROM cvc.sales_notes
        WHERE note_type = 'meeting'
          AND created_at >= '2026-05-05 06:00:00+00'
          AND tech_interest IS NULL
          AND tech_challenge IS NULL
          AND rating_buying_intent IS NULL
          AND rating_dm_access IS NULL
          AND rating_budget_fit IS NULL
          AND rating_strategic_fit IS NULL
          AND rating_timeline IS NULL
        """,
        "meeting note (post-migration) with zero structured data — panel submitted with nothing filled in",
    )


def check_meeting_notes():
    section("Meeting Notes")

    bad_rows(
        "Meeting notes — no company and no name",
        """
        SELECT id, submitted_by, submitted_at
        FROM cvc.meeting_notes
        WHERE company_id IS NULL
          AND (company_name IS NULL OR company_name = '')
        """,
        "meeting note with no linked company and no company name",
    )

    bad_rows(
        "Meeting notes — invalid context_type",
        """
        SELECT id, context_type
        FROM cvc.meeting_notes
        WHERE context_type NOT IN ('ventures', 'psm', 'sales')
        """,
        "context_type not in (ventures, psm, sales)",
    )

    bad_rows(
        "Meeting notes — orphaned company_id",
        """
        SELECT mn.id, mn.company_id
        FROM cvc.meeting_notes mn
        LEFT JOIN cvc.companies c ON c.id = mn.company_id
        WHERE mn.company_id IS NOT NULL
          AND c.id IS NULL
        """,
        "meeting_notes.company_id pointing to deleted company",
    )


def check_partner_intros():
    section("Partner Intros")

    bad_rows(
        "Partner intros — orphaned company_id",
        """
        SELECT pi.id, pi.company_id, pi.startup_name
        FROM cvc.partner_intros pi
        LEFT JOIN cvc.companies c ON c.id = pi.company_id
        WHERE pi.company_id IS NOT NULL
          AND c.id IS NULL
        """,
        "partner_intros.company_id pointing to deleted company",
    )

    bad_rows(
        "Partner intros — orphaned partner_id",
        """
        SELECT pi.id, pi.partner_id, pi.partner_name
        FROM cvc.partner_intros pi
        LEFT JOIN cvc.partners p ON p.id = pi.partner_id
        WHERE pi.partner_id IS NOT NULL
          AND p.id IS NULL
        """,
        "partner_intros.partner_id pointing to deleted partner",
    )


def check_dd():
    section("DD Evaluations")

    bad_rows(
        "DD evaluations — orphaned company_id",
        """
        SELECT de.id, de.company_id
        FROM cvc.dd_evaluations de
        LEFT JOIN cvc.companies c ON c.id = de.company_id
        WHERE c.id IS NULL
        """,
        "dd_evaluations pointing to deleted companies",
    )

    bad_rows(
        "DD evaluations — invalid status",
        """
        SELECT id, company_id, status
        FROM cvc.dd_evaluations
        WHERE status NOT IN ('pending', 'running', 'complete', 'error', 'failed')
        """,
        "dd_evaluations.status not in allowed set",
    )


def check_brambles():
    section("Brambles Pipeline")

    bad_rows(
        "Brambles — review complete but no memo",
        """
        SELECT id, company_name, review_status
        FROM cvc.brambles_pipeline
        WHERE review_status = 'complete'
          AND review_memo_json IS NULL
        """,
        "review_status=complete but review_memo_json is null — memo generation may have failed",
    )

    bad_rows(
        "Brambles — invalid status",
        """
        SELECT id, company_name, status
        FROM cvc.brambles_pipeline
        WHERE status NOT IN ('pending', 'running', 'complete', 'error')
        """,
        "status not in (pending, running, complete, error)",
    )

    bad_rows(
        "Brambles — stuck in 'running'",
        """
        SELECT id, company_name, updated_at
        FROM cvc.brambles_pipeline
        WHERE status = 'running'
          AND updated_at < NOW() - INTERVAL '4 hours'
        """,
        "enrichment stuck running for >4h — worker likely crashed",
    )


def check_funding_rounds():
    section("Funding Rounds")

    bad_rows(
        "Funding rounds — orphaned company_id",
        """
        SELECT fr.id, fr.company_id
        FROM cvc.funding_rounds fr
        LEFT JOIN cvc.companies c ON c.id = fr.company_id
        WHERE c.id IS NULL
        """,
        "funding_rounds pointing to deleted companies",
    )

    bad_rows(
        "Funding rounds — negative amount",
        """
        SELECT id, company_id, round_type, amount_usd
        FROM cvc.funding_rounds
        WHERE amount_usd IS NOT NULL AND amount_usd < 0
        """,
        "funding round with negative amount_usd",
    )


def check_activity_log():
    section("Activity Log")

    bad_rows(
        "Activity log — orphaned company_id",
        """
        SELECT cal.id, cal.company_id
        FROM cvc.company_activity_log cal
        LEFT JOIN cvc.companies c ON c.id = cal.company_id
        WHERE c.id IS NULL
        LIMIT 20
        """,
        "company_activity_log rows pointing to deleted companies",
    )


def check_defense():
    section("Defense Table")

    bad_rows(
        "Defense — orphaned company_id",
        """
        SELECT cd.company_id
        FROM cvc.company_defense cd
        LEFT JOIN cvc.companies c ON c.id = cd.company_id
        WHERE c.id IS NULL
        """,
        "company_defense rows pointing to deleted companies",
    )

    bad_rows(
        "Defense — invalid TRL",
        """
        SELECT company_id, trl
        FROM cvc.company_defense
        WHERE trl IS NOT NULL AND trl NOT BETWEEN 1 AND 9
        """,
        "trl value outside 1-9 range",
    )


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    global VERBOSE

    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true", help="Print sample bad rows")
    args = parser.parse_args()
    VERBOSE = args.verbose

    print("\nDB integrity check — cvc_db\n")

    check_companies()
    check_lifecycle()
    check_term_sheets()
    check_users()
    check_requests()
    check_sales()
    check_meeting_notes()
    check_partner_intros()
    check_dd()
    check_brambles()
    check_funding_rounds()
    check_activity_log()
    check_defense()

    passed  = sum(1 for r in RESULTS if r)
    warned  = sum(1 for r in RESULTS if not r)
    total   = len(RESULTS)

    print(f"\n{passed}/{total} checks clean — {warned} issue(s) found\n")

    if warned:
        print("Issues found — review output above. Run with --verbose to see sample bad rows.")
        sys.exit(1)
    else:
        print("ALL CLEAN — database looks healthy.")


if __name__ == "__main__":
    main()
