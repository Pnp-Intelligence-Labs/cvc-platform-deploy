-- Performance indexes: missing indexes identified in audit

-- partners: name lookup/search
CREATE INDEX IF NOT EXISTS idx_partners_name_lower
    ON cvc.partners(LOWER(name));

-- partner_intros: aggregate by partner (partner-centric queries)
CREATE INDEX IF NOT EXISTS idx_partner_intros_partner_id_date
    ON cvc.partner_intros(partner_id, intro_date DESC);

-- partner_documents: list by partner ordered by recency
CREATE INDEX IF NOT EXISTS idx_partner_documents_partner_created
    ON cvc.partner_documents(partner_id, uploaded_at DESC);

-- partner_documents: filter by parsed status
CREATE INDEX IF NOT EXISTS idx_partner_documents_parsed
    ON cvc.partner_documents(parsed) WHERE parsed = FALSE;

-- company_intel: filter by intel_type
CREATE INDEX IF NOT EXISTS idx_company_intel_type
    ON cvc.company_intel(intel_type);

-- sales_notes: list by target ordered by recency
CREATE INDEX IF NOT EXISTS idx_sales_notes_target_created
    ON cvc.sales_notes(target_id, created_at DESC);

-- companies: composite for enrichment pipeline queries
CREATE INDEX IF NOT EXISTS idx_companies_enrichment_created
    ON cvc.companies(enrichment_status, created_at DESC);

-- briefing_upvotes: composite for GROUP BY aggregation on week+insight
CREATE INDEX IF NOT EXISTS idx_briefing_upvotes_week_insight
    ON cvc.briefing_upvotes(week_start, insight_text);

-- users: GIN index on assigned_partner_ids (INT array membership checks)
CREATE INDEX IF NOT EXISTS idx_users_assigned_partner_ids
    ON cvc.users USING GIN(assigned_partner_ids);

-- companies: full-text search on name + one_liner + description
CREATE INDEX IF NOT EXISTS idx_companies_fts
    ON cvc.companies USING GIN(
        to_tsvector('english',
            COALESCE(name, '') || ' ' ||
            COALESCE(one_liner, '') || ' ' ||
            COALESCE(description, '')
        )
    );
