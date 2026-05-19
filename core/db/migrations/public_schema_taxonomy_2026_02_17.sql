-- CVC Producer Database — Public Schema Taxonomy DDL
-- Exported: 2026-03-11
-- Original creation: 2026-02-17 (ad-hoc Claude Code session — no prior commit existed)
-- Database: producer (host: 100.121.44.108, port: 5432)
-- WARNING: This file is the only committed record of this schema.
-- If the Droplet is reset without a pg_dump, this DDL is the recovery path.

-- ============================================================
-- Table: public.adoption_drivers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.adoption_drivers (
    driver_id SERIAL,
    subsector_id INTEGER,
    driver_name VARCHAR(255),
    description TEXT,
    relevance_score INTEGER,
    driver_type VARCHAR(50),
    impact VARCHAR(20),
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.companies_master
-- ============================================================
CREATE TABLE IF NOT EXISTS public.companies_master (
    company_id SERIAL,
    name VARCHAR(500) NOT NULL,
    one_liner TEXT,
    description TEXT,
    website VARCHAR(1000),
    founded INTEGER,
    hq_city VARCHAR(100),
    country VARCHAR(100),
    employee_count INTEGER,
    total_funding_usd BIGINT,
    funding_stage VARCHAR(50),
    last_round_date DATE,
    investors TEXT,
    competitors TEXT,
    case_study TEXT,
    verticals TEXT,
    tags TEXT,
    data_source VARCHAR(255),
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    search_text TEXT,
    llm_enrichment JSONB,
    llm_enrichment_date TIMESTAMP,
    llm_model VARCHAR(100),
    primary_domain VARCHAR(50),
    primary_function VARCHAR(50),
    primary_stack_layer VARCHAR(50),
    business_model VARCHAR(50),
    is_hardware BOOLEAN,
    is_software BOOLEAN
);

-- ============================================================
-- Table: public.company_subsectors
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_subsectors (
    company_id INTEGER NOT NULL,
    subsector_id INTEGER NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    confidence_score NUMERIC,
    tagged_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tagged_by VARCHAR(100),
    notes TEXT
);

-- ============================================================
-- Table: public.company_tech_pillars
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_tech_pillars (
    company_id INTEGER NOT NULL,
    pillar_id INTEGER NOT NULL,
    relevance_score INTEGER,
    tagged_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.company_themes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_themes (
    company_id INTEGER NOT NULL,
    theme_id INTEGER NOT NULL,
    relevance_score INTEGER,
    tagged_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.content_items
-- ============================================================
CREATE TABLE IF NOT EXISTS public.content_items (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    source_id UUID,
    content_type VARCHAR(50) NOT NULL,
    title VARCHAR(500),
    url VARCHAR(1000),
    published_at TIMESTAMPTZ,
    raw_text TEXT,
    summary TEXT,
    key_entities JSONB DEFAULT '{}'::jsonb,
    tags JSONB DEFAULT '[]'::jsonb,
    sentiment VARCHAR(20),
    embedding TEXT,
    enrichment_status VARCHAR(20) DEFAULT 'raw'::character varying,
    content_hash VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    podcast_synthesis JSONB,
    article_synthesis JSONB,
    briefing_flag VARCHAR(20) DEFAULT NULL::character varying
);

-- ============================================================
-- Table: public.content_sources
-- ============================================================
CREATE TABLE IF NOT EXISTS public.content_sources (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    source_type VARCHAR(50) NOT NULL,
    url VARCHAR(1000),
    tier VARCHAR(20) NOT NULL,
    scrape_config JSONB DEFAULT '{}'::jsonb,
    schedule VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    last_scraped_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Table: public.content_verticals
-- ============================================================
CREATE TABLE IF NOT EXISTS public.content_verticals (
    content_id UUID NOT NULL,
    vertical_id UUID NOT NULL,
    relevance_score DOUBLE PRECISION DEFAULT 1.0
);

-- ============================================================
-- Table: public.dd_evaluations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dd_evaluations (
    evaluation_id SERIAL,
    company_name VARCHAR(255) NOT NULL,
    requestor VARCHAR(100),
    status VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    context_data JSONB,
    results_data JSONB
);

-- ============================================================
-- Table: public.dd_research_tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dd_research_tasks (
    task_id SERIAL,
    evaluation_id INTEGER,
    task_type VARCHAR(100),
    status VARCHAR(50),
    results JSONB,
    sources TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.dd_results
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dd_results (
    result_id SERIAL,
    evaluation_id INTEGER,
    company_name VARCHAR(255) NOT NULL,
    dd_score INTEGER,
    grade VARCHAR(5),
    recommendation VARCHAR(50),
    classification_4d JSONB,
    market_data JSONB,
    team_analysis JSONB,
    competitive_analysis JSONB,
    financial_analysis JSONB,
    risk_assessment JSONB,
    follow_up_actions JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.generated_reports
-- ============================================================
CREATE TABLE IF NOT EXISTS public.generated_reports (
    report_id SERIAL,
    subsector_id INTEGER,
    report_type VARCHAR(100),
    report_title VARCHAR(255),
    generation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    company_count INTEGER,
    news_item_count INTEGER,
    file_path VARCHAR(500),
    generated_by VARCHAR(100),
    report_version INTEGER DEFAULT 1
);

-- ============================================================
-- Table: public.geographic_clusters
-- ============================================================
CREATE TABLE IF NOT EXISTS public.geographic_clusters (
    cluster_id SERIAL,
    cluster_name VARCHAR(100),
    region VARCHAR(100),
    country VARCHAR(100),
    cities TEXT[],
    description TEXT,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.investment_trends
-- ============================================================
CREATE TABLE IF NOT EXISTS public.investment_trends (
    trend_id SERIAL,
    subsector_id INTEGER,
    time_period VARCHAR(50),
    funding_stage VARCHAR(50),
    deal_count INTEGER,
    total_funding_millions NUMERIC,
    average_deal_size_millions NUMERIC,
    top_investors TEXT[],
    notes TEXT,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.market_themes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.market_themes (
    theme_id SERIAL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    emergence_year INTEGER,
    relevance_score INTEGER,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.meetings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.meetings (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    related_startup_id UUID,
    related_vertical_id UUID,
    meeting_date DATE,
    participants JSONB DEFAULT '[]'::jsonb,
    source_type VARCHAR(50),
    raw_text TEXT,
    key_takeaways TEXT,
    action_items JSONB DEFAULT '[]'::jsonb,
    entities_mentioned JSONB DEFAULT '{}'::jsonb,
    metric_responses JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Table: public.metric_definitions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.metric_definitions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    scoring_rubric JSONB DEFAULT '{}'::jsonb,
    weight DOUBLE PRECISION DEFAULT 1.0,
    question_framework JSONB DEFAULT '[]'::jsonb,
    applies_to VARCHAR(50) DEFAULT 'startups'::character varying,
    phase VARCHAR(20) DEFAULT 'planned'::character varying,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Table: public.parent_sectors
-- ============================================================
CREATE TABLE IF NOT EXISTS public.parent_sectors (
    parent_sector_id SERIAL,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    sort_order INTEGER,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.partner_interviews
-- ============================================================
CREATE TABLE IF NOT EXISTS public.partner_interviews (
    interview_id SERIAL,
    partner_name VARCHAR(255) NOT NULL,
    interviewer VARCHAR(100),
    interview_date DATE DEFAULT CURRENT_DATE,
    automation_goals TEXT,
    pain_points TEXT,
    existing_automation TEXT,
    preferred_form_factor VARCHAR(100),
    deployment_environment VARCHAR(100),
    integration_requirements TEXT,
    success_metrics TEXT,
    pilot_budget_min INTEGER,
    pilot_budget_max INTEGER,
    timeline_to_pilot_months INTEGER,
    timeline_to_production_months INTEGER,
    decision_makers JSONB,
    must_be_us_based BOOLEAN,
    preferred_company_stage VARCHAR(50),
    deal_breakers TEXT,
    interview_transcript TEXT,
    matched_startups JSONB,
    followup_actions TEXT,
    status VARCHAR(50) DEFAULT 'New'::character varying,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.report_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS public.report_templates (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    template_type VARCHAR(50),
    sections JSONB DEFAULT '[]'::jsonb,
    methodology_notes TEXT,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Table: public.reports
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reports (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    template_id UUID,
    title VARCHAR(500) NOT NULL,
    report_type VARCHAR(50),
    vertical_id UUID,
    client_name VARCHAR(255),
    content JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) DEFAULT 'draft'::character varying,
    sources_used JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Table: public.sector_function_taxonomy
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sector_function_taxonomy (
    id SERIAL,
    sector_id INTEGER NOT NULL,
    function_pillar VARCHAR(50) NOT NULL,
    hardware_tags TEXT[],
    software_tags TEXT[],
    description TEXT,
    created_date TIMESTAMP DEFAULT now()
);

-- ============================================================
-- Table: public.sector_narratives
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sector_narratives (
    narrative_id SERIAL,
    parent_sector_id INTEGER,
    section VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    author VARCHAR(100),
    version INTEGER DEFAULT 1,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.source_verticals
-- ============================================================
CREATE TABLE IF NOT EXISTS public.source_verticals (
    source_id UUID NOT NULL,
    vertical_id UUID NOT NULL
);

-- ============================================================
-- Table: public.startup_interviews
-- ============================================================
CREATE TABLE IF NOT EXISTS public.startup_interviews (
    interview_id SERIAL,
    company_name VARCHAR(255) NOT NULL,
    interviewer VARCHAR(100),
    interview_date DATE DEFAULT CURRENT_DATE,
    product_status VARCHAR(50),
    robots_deployed_production INTEGER,
    pilot_success_rate NUMERIC,
    product_specs JSONB,
    roadmap_gaps TEXT,
    current_revenue_usd BIGINT,
    arr_usd BIGINT,
    paying_customers JSONB,
    typical_deal_size_usd INTEGER,
    sales_cycle_months INTEGER,
    churn_rate NUMERIC,
    target_industries TEXT,
    sales_team_size INTEGER,
    scaling_bottleneck TEXT,
    can_white_label BOOLEAN,
    can_co_develop BOOLEAN,
    avg_deployment_days INTEGER,
    support_model VARCHAR(100),
    burn_rate_monthly_usd INTEGER,
    runway_months INTEGER,
    next_round_planned BOOLEAN,
    next_round_target_usd BIGINT,
    unit_cost_usd INTEGER,
    loses_to TEXT,
    wins_against TEXT,
    interview_transcript TEXT,
    followup_actions TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.startups
-- ============================================================
CREATE TABLE IF NOT EXISTS public.startups (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL,
    website VARCHAR(500),
    vertical_id UUID,
    funding_stage VARCHAR(50),
    founded_year INTEGER,
    hq_location VARCHAR(255),
    description TEXT,
    technology_focus JSONB DEFAULT '[]'::jsonb,
    key_metrics JSONB DEFAULT '{}'::jsonb,
    assessment_scores JSONB DEFAULT '{}'::jsonb,
    proprietary_metrics JSONB DEFAULT '{}'::jsonb,
    data_quality VARCHAR(20) DEFAULT 'needs_review'::character varying,
    last_enriched TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Table: public.subsector_geographic_strength
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subsector_geographic_strength (
    subsector_id INTEGER NOT NULL,
    cluster_id INTEGER NOT NULL,
    company_count INTEGER,
    total_funding_millions NUMERIC,
    strength_score INTEGER
);

-- ============================================================
-- Table: public.subsector_metrics
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subsector_metrics (
    metric_id SERIAL,
    subsector_id INTEGER,
    period VARCHAR(20),
    company_count INTEGER,
    total_funding_millions NUMERIC,
    news_item_count INTEGER,
    avg_funding_per_company NUMERIC,
    top_themes TEXT[],
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.subsector_metrics_history
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subsector_metrics_history (
    metric_id SERIAL,
    subsector_id INTEGER,
    metric_date DATE,
    metric_type VARCHAR(100),
    metric_value NUMERIC,
    metric_unit VARCHAR(50),
    data_source VARCHAR(255),
    confidence VARCHAR(20),
    notes TEXT,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metric_year INTEGER,
    is_projection BOOLEAN DEFAULT false,
    source_name VARCHAR(200),
    source_type VARCHAR(50),
    confidence_level VARCHAR(20)
);

-- ============================================================
-- Table: public.subsector_narratives
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subsector_narratives (
    narrative_id SERIAL,
    subsector_id INTEGER,
    section VARCHAR(100),
    content TEXT,
    version INTEGER DEFAULT 1,
    author VARCHAR(100),
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.subsector_projections
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subsector_projections (
    projection_id SERIAL,
    subsector_id INTEGER,
    projection_year INTEGER,
    metric_type VARCHAR(100),
    projected_value NUMERIC,
    projection_source VARCHAR(255),
    confidence_level VARCHAR(20),
    scenario VARCHAR(100),
    assumptions TEXT,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.subsector_tech_dependencies
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subsector_tech_dependencies (
    dependency_id SERIAL,
    subsector_id INTEGER,
    tech_pillar_id INTEGER,
    dependency_type VARCHAR(50),
    importance_score INTEGER,
    maturity_level VARCHAR(50),
    notes TEXT,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.subsector_use_cases
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subsector_use_cases (
    use_case_id SERIAL,
    subsector_id INTEGER,
    use_case_name VARCHAR(255),
    problem_statement TEXT,
    solution_description TEXT,
    roi_description TEXT,
    typical_payback_months INTEGER,
    example_companies TEXT[],
    adoption_stage VARCHAR(50),
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.subsectors
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subsectors (
    subsector_id SERIAL,
    name VARCHAR(200) NOT NULL,
    parent_id INTEGER,
    category VARCHAR(100),
    description TEXT,
    market_size_2026_billions NUMERIC,
    growth_rate_cagr NUMERIC,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    parent_sector_id INTEGER
);

-- ============================================================
-- Table: public.task_queue
-- ============================================================
CREATE TABLE IF NOT EXISTS public.task_queue (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    task_type VARCHAR(100) NOT NULL,
    target_machine VARCHAR(50) NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) DEFAULT 'pending'::character varying,
    priority INTEGER DEFAULT 5,
    result JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- ============================================================
-- Table: public.tech_evolution_events
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tech_evolution_events (
    event_id SERIAL,
    subsector_id INTEGER,
    event_date DATE,
    event_type VARCHAR(50),
    title VARCHAR(255),
    description TEXT,
    significance_score INTEGER,
    companies_involved TEXT[],
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.tech_pillars
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tech_pillars (
    pillar_id SERIAL,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100),
    description TEXT,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: public.verticals
-- ============================================================
CREATE TABLE IF NOT EXISTS public.verticals (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    keywords JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(20) DEFAULT 'active'::character varying,
    config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Table: public.weekly_signals
-- ============================================================
CREATE TABLE IF NOT EXISTS public.weekly_signals (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    total_items INTEGER DEFAULT 0,
    podcast_count INTEGER DEFAULT 0,
    news_count INTEGER DEFAULT 0,
    article_count INTEGER DEFAULT 0,
    sentiment_positive INTEGER DEFAULT 0,
    sentiment_neutral INTEGER DEFAULT 0,
    sentiment_negative INTEGER DEFAULT 0,
    top_tags JSONB DEFAULT '[]'::jsonb,
    top_companies JSONB DEFAULT '[]'::jsonb,
    top_technologies JSONB DEFAULT '[]'::jsonb,
    briefing_text TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

