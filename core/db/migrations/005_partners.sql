-- Create partners table
CREATE TABLE IF NOT EXISTS cvc.partners (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    industry TEXT,
    contact_name TEXT,
    contact_email TEXT,
    challenge_areas TEXT[],
    sectors_of_interest TEXT[],
    environments TEXT[],
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create partner_matches table
CREATE TABLE IF NOT EXISTS cvc.partner_matches (
    id SERIAL PRIMARY KEY,
    partner_id INT REFERENCES cvc.partners(id) ON DELETE CASCADE,
    company_id INT REFERENCES cvc.companies(id) ON DELETE CASCADE,
    match_score INT CHECK(match_score BETWEEN 0 AND 100),
    match_reason TEXT,
    status TEXT DEFAULT 'suggested' CHECK(status IN ('suggested', 'shared', 'intro_made', 'engaged', 'passed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(partner_id, company_id)
);
