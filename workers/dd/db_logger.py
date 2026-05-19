import json
import os
import psycopg2
from psycopg2.extras import RealDictCursor, Json
from datetime import datetime

# Database configuration
DD_DB_HOST = os.getenv("CVC_DB_HOST", "localhost")
DD_DB_PORT = os.getenv("CVC_DB_PORT", "5432")
DD_DB_NAME = os.getenv("CVC_DB_NAME", "cvc_db")
DD_DB_USER = os.getenv("CVC_DB_USER", "producer")
DD_DB_PASS = os.environ["CVC_DB_PASSWORD"]

def get_connection():
    """Get PostgreSQL connection for DD worker."""
    return psycopg2.connect(
        host=DD_DB_HOST,
        port=DD_DB_PORT,
        dbname=DD_DB_NAME,
        user=DD_DB_USER,
        password=DD_DB_PASS
    )

def ensure_table_exists():
    """
    Ensure dd_evaluations table exists in cvc schema.
    Run this manually on Dell to create the table.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS cvc.dd_evaluations (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER REFERENCES cvc.companies(id) ON DELETE CASCADE,
                    evaluation_type VARCHAR(50) DEFAULT 'automated',
                    status VARCHAR(20) DEFAULT 'pending',
                    score_overall NUMERIC(5,2),
                    score_market NUMERIC(5,2),
                    score_product NUMERIC(5,2),
                    score_team NUMERIC(5,2),
                    score_financial NUMERIC(5,2),
                    score_strategic_fit NUMERIC(5,2),
                    evaluator_notes TEXT,
                    raw_data JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE INDEX IF NOT EXISTS idx_dd_evaluations_company_id 
                ON cvc.dd_evaluations(company_id);
                
                CREATE INDEX IF NOT EXISTS idx_dd_evaluations_status 
                ON cvc.dd_evaluations(status);
                
                CREATE INDEX IF NOT EXISTS idx_dd_evaluations_created_at 
                ON cvc.dd_evaluations(created_at DESC);
            """)
            conn.commit()
            print("✓ Table cvc.dd_evaluations ensured successfully")
    except Exception as e:
        conn.rollback()
        print(f"✗ Error ensuring table: {e}")
        raise
    finally:
        conn.close()

def log_evaluation(company_id, scores, notes=None, evaluation_type='automated', raw_data=None):
    """
    Log a due diligence evaluation to the database.
    
    Args:
        company_id: ID of the company being evaluated
        scores: Dict with keys: overall, market, product, team, financial, strategic_fit
        notes: Optional text notes
        evaluation_type: Type of evaluation (automated, manual, etc.)
        raw_data: Optional dict of raw evaluation data (stored as JSONB)
    
    Returns:
        int: ID of the created evaluation record
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.dd_evaluations 
                (company_id, evaluation_type, status, score_overall, score_market, 
                 score_product, score_team, score_financial, score_strategic_fit,
                 evaluator_notes, raw_data)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                company_id,
                evaluation_type,
                'completed',
                scores.get('overall'),
                scores.get('market'),
                scores.get('product'),
                scores.get('team'),
                scores.get('financial'),
                scores.get('strategic_fit'),
                notes,
                Json(raw_data) if raw_data else None
            ))
            result = cur.fetchone()
            conn.commit()
            return result[0]
    except Exception as e:
        conn.rollback()
        print(f"Error logging evaluation: {e}")
        raise
    finally:
        conn.close()

def load_overview_json(company_name: str, workdir):
    """
    Load overview.json for a completed DD run.
    Returns parsed dict or None if not found.
    """
    from pathlib import Path
    safe = company_name.replace(" ", "_").replace("/", "_")
    path = Path(workdir) / safe / "overview.json"
    if not path.exists():
        path = Path(workdir) / company_name / "overview.json"
    if not path.exists():
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


if __name__ == "__main__":
    # Manual execution for setup
    print("Ensuring dd_evaluations table exists...")
    ensure_table_exists()
