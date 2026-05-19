-- Migration 046: quickadd enrichment
--
-- Supports the Quick Add by URL feature: paste a company website →
-- system scrapes the page, runs LLM enrichment, and saves to DB immediately.
--
-- No new tables needed — uses existing cvc.companies columns:
--   enrichment_source = 'quickadd'   (was 'llm_infer' for batch)
--   enrichment_status = 'enriching'  (new transient state, visible in Pending tab)
--
-- enrichment_status lifecycle:
--   pending    → queued for nightly batch (enrich_worker.py)
--   enriching  → quickadd in progress (background task running)
--   enriched   → complete
--   failed     → LLM returned nothing useful or scrape failed
--   manual_review / needs_research → flagged by analyst
--
-- enrichment_source values:
--   llm_infer  → nightly batch (enrich_worker.py)
--   quickadd   → on-demand URL submission via UI
--   manual     → hand-entered by analyst
--   import     → bulk import script

-- Index to speed up dedup check on website field (quickadd does a lookup by URL).
CREATE INDEX IF NOT EXISTS idx_companies_website
    ON cvc.companies (website)
    WHERE website IS NOT NULL;

-- Treat 'enriching' the same as 'pending' in stats queries — include in pending count.
-- (No schema change needed — this is documented here for the stats endpoint.)
