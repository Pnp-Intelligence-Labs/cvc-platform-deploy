-- Migration 086: Add preferred/excluded domain lists to brave_search_templates
-- Allows per-template domain preference rules to be stored in DB and read by workers
-- rather than hardcoded in Python.

ALTER TABLE cvc.brave_search_templates
    ADD COLUMN IF NOT EXISTS preferred_domains  TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS excluded_domains   TEXT[] DEFAULT '{}';

-- Funding template: exclude paywalled sources, prefer open press release / trade sites
UPDATE cvc.brave_search_templates
SET
    preferred_domains = ARRAY[
        'prnewswire.com', 'businesswire.com', 'globenewswire.com', 'accesswire.com',
        'sec.gov', 'techcrunch.com', 'reuters.com', 'bloomberg.com', 'cnbc.com',
        'forbes.com', 'wsj.com', 'ft.com', 'axios.com',
        'facilitiesdive.com', 'supplychaindive.com', 'manufacturingdive.com',
        'logisticsmgmt.com', 'dcvelocity.com', 'therobotreport.com',
        'geekwire.com', 'siliconangle.com', 'venturebeat.com'
    ],
    excluded_domains = ARRAY[
        'crunchbase.com', 'pitchbook.com'
    ],
    notes = 'Preferred: open press release and trade publication sources with accessible links. '
            'Excluded: crunchbase.com and pitchbook.com are paywalled — links cannot be verified '
            'by the analyst and produce bad intel suggestions. Exclusions are appended to the '
            'Brave query as -site: operators at search time.',
    updated_at = NOW()
WHERE search_type = 'funding';
