import pandas as pd
import psycopg2
import os
import json
from typing import Set, Dict
from datetime import datetime

class PortfolioDiffChecker:
    def __init__(self, excel_path: str = 'Database_1775673942.xlsx'):
        self.excel_path = excel_path
        self.excel_companies: Set[str] = set()
        self.db_companies: Set[str] = set()
        
    def load_excel_portfolio(self) -> Set[str]:
        """Load 79 companies flagged Portfolio from Monday export"""
        df = pd.read_excel(self.excel_path)
        # Normalize company names for comparison
        portfolio_df = df[df['Portfolio'] == True]
        self.excel_companies = set(
            portfolio_df['Company Name']
            .str.strip()
            .str.lower()
            .dropna()
        )
        return self.excel_companies
    
    def load_db_portfolio(self) -> Set[str]:
        """Load 67 companies where is_portfolio=true from cvc.companies"""
        conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            database=os.getenv('DB_NAME', 'cvc'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', '')
        )
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT LOWER(TRIM(company_name)) 
                    FROM cvc.companies 
                    WHERE is_portfolio = true
                """)
                self.db_companies = {row[0] for row in cur.fetchall()}
        finally:
            conn.close()
        return self.db_companies
    
    def find_discrepancies(self) -> Dict:
        """Identify the 12 missing companies and any incorrect flags"""
        missing_from_db = self.excel_companies - self.db_companies
        incorrectly_flagged = self.db_companies - self.excel_companies
        
        return {
            'summary': {
                'monday_portfolio_count': len(self.excel_companies),
                'db_portfolio_count': len(self.db_companies),
                'discrepancy': len(self.excel_companies) - len(self.db_companies),
                'missing_from_db': len(missing_from_db),
                'incorrectly_flagged_in_db': len(incorrectly_flagged)
            },
            'to_add_to_db': sorted(list(missing_from_db)),
            'to_remove_from_db': sorted(list(incorrectly_flagged)),
            'synced_correctly': sorted(list(self.excel_companies & self.db_companies))
        }
    
    def generate_sync_sql(self, discrepancies: Dict) -> str:
        """Generate SQL statements to fix discrepancies"""
        sql_lines = ["-- Portfolio Sync SQL Generated: " + datetime.now().isoformat(), ""]
        
        if discrepancies['to_add_to_db']:
            sql_lines.append("-- Companies missing from DB (need is_portfolio=true):")
            for company in discrepancies['to_add_to_db']:
                sql_lines.append(f"""
UPDATE cvc.companies 
SET is_portfolio = true, updated_at = NOW() 
WHERE LOWER(TRIM(company_name)) = '{company}' 
AND (is_portfolio = false OR is_portfolio IS NULL);
""")
        
        if discrepancies['to_remove_from_db']:
            sql_lines.append("\n-- Companies incorrectly flagged (need is_portfolio=false):")
            for company in discrepancies['to_remove_from_db']:
                sql_lines.append(f"""
UPDATE cvc.companies 
SET is_portfolio = false, updated_at = NOW() 
WHERE LOWER(TRIM(company_name)) = '{company}';
""")
        
        return "\n".join(sql_lines)
    
    def run_audit(self):
        """Execute full audit and output results"""
        print("Loading Monday portfolio list (79 companies)...")
        self.load_excel_portfolio()
        
        print("Loading DB portfolio list (67 companies)...")
        self.load_db_portfolio()
        
        print("Analyzing discrepancies...")
        results = self.find_discrepancies()
        
        # Save JSON report
        with open('portfolio_diff_report.json', 'w') as f:
            json.dump(results, f, indent=2)
        
        # Save SQL fix script
        sql_fix = self.generate_sync_sql(results)
        with open('portfolio_sync_fix.sql', 'w') as f:
            f.write(sql_fix)
        
        print(f"\nResults:")
        print(f"- Monday has {results['summary']['monday_portfolio_count']} portfolio companies")
        print(f"- DB has {results['summary']['db_portfolio_count']} portfolio companies")
        print(f"- Missing from DB: {results['summary']['missing_from_db']} companies")
        print(f"- Incorrectly flagged: {results['summary']['incorrectly_flagged_in_db']} companies")
        
        if results['to_add_to_db']:
            print(f"\nCompanies to ADD (first 5): {results['to_add_to_db'][:5]}")
        if results['to_remove_from_db']:
            print(f"\nCompanies to UNFLAG (first 5): {results['to_remove_from_db'][:5]}")

if __name__ == '__main__':
    checker = PortfolioDiffChecker()
    checker.run_audit()