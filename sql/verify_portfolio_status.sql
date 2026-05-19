-- Verify current portfolio status in DB
-- Expected: 67 rows

SELECT 
    company_name,
    is_portfolio,
    created_at,
    updated_at
FROM cvc.companies 
WHERE is_portfolio = true
ORDER BY company_name;

-- Check for potential duplicates causing count mismatch
SELECT 
    LOWER(TRIM(company_name)) as normalized_name,
    COUNT(*) as occurrence_count
FROM cvc.companies 
WHERE is_portfolio = true
GROUP BY LOWER(TRIM(company_name))
HAVING COUNT(*) > 1;