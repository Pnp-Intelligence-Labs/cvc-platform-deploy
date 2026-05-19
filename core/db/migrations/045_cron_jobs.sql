-- Migration 045: cron_jobs
-- Documents all scheduled jobs across the CVC ecosystem.
-- UI-editable — does NOT write to actual crontab (that's manual / BBH-managed).

CREATE TABLE IF NOT EXISTS cvc.cron_jobs (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    schedule    TEXT NOT NULL,          -- cron expression, e.g. "0 2 * * *"
    description TEXT,
    command     TEXT,                   -- script / command reference
    machine     TEXT NOT NULL DEFAULT 'dell',  -- 'dell', 'refinery', 'lenovo'
    category    TEXT,                   -- 'enrichment', 'briefing', 'scraping', 'scoring', 'system', 'agent'
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    log_path    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with current schedule (from crontab -l on Dell + Refinery)
INSERT INTO cvc.cron_jobs (name, schedule, description, command, machine, category, log_path) VALUES

-- Dell server jobs
('RSS / Content Collection',       '30 1 * * *',   'Daily RSS feeds + trend signals collection',          'workers/trends/run_collectors.py Q2-2026',       'dell',     'scraping',    'logs/cvc_collectors.log'),
('Company Enrichment — Phase 1',   '0 2 * * *',    'Basic company data enrichment (200 companies/run)',   'workers/enrichment/enrich_worker.py --limit 200', 'dell',     'enrichment',  'logs/cvc_enrichment.log'),
('Company Enrichment — Phase 2',   '30 2 * * *',   'Patents, funding, commercial signals enrichment',     'workers/enrichment/enrich_phase2.py --limit 100', 'dell',     'enrichment',  'logs/cvc_enrichment.log'),
('Scoring Refresh',                '0 3 * * *',    'Rubric-based scoring for enriched companies',         'workers/scoring/score_refresh.py --limit 100',    'dell',     'scoring',     'logs/cvc_scoring.log'),
('DB Backup',                      '0 4 * * *',    'PostgreSQL backup + rsync to Refinery',               'scripts/backup_db.sh',                            'dell',     'system',      'logs/cvc_backup.log'),
('Weekly Signals Scraper',         '0 6 * * 0',    'Sunday — RSS news signals by sector',                 'workers/scrapers/weekly_signals.py',              'dell',     'scraping',    'logs/cvc_signals.log'),
('Weekly Briefing Generation',     '0 5 * * 0',    'Sunday — LLM-synthesized weekly intel briefing',      'workers/briefing/weekly_briefing.py',             'dell',     'briefing',    'logs/cvc_weekly_briefing.log'),
('BigBossHog Daily Log',           '0 23 * * *',   'BBH idle log + memory write',                         'scripts/bbh_daily_log.sh',                        'dell',     'agent',       NULL),
('Big Claw Daily Log',             '5 23 * * *',   'Big Claw idle log',                                   'scripts/bigclaw_daily_log.sh',                    'dell',     'agent',       NULL),
('API Watchdog',                   '*/5 * * * *',  'Restart API if uvicorn process is dead',              'scripts/start_api.sh (watchdog)',                 'dell',     'system',      'logs/cvc-api.log'),

-- Refinery jobs
('Briefing Content Enrichment',    '30 4 * * *',   'Daily podcast/news enrichment on RTX 3090 (Qwen3)',   'scripts/run_briefing_enrichment.sh',              'refinery', 'briefing',    NULL),
('Agent Context Briefing',         '0 12 * * *',   'Write daily context briefings to all agents + DB',    'scripts/daily_briefing.sh',                       'refinery', 'agent',       'scripts/briefing.log'),
('Collective Memory Sync',         '5 12 * * *',   'Generate COLLECTIVE_MEMORY.md, push to all agents',   'scripts/sync_collective.sh',                      'refinery', 'agent',       'scripts/briefing.log'),
('Agent Context Refresh',          '10 12 * * *',  'Append context refresh to today''s memory',           'scripts/refresh_context.sh',                      'refinery', 'agent',       'scripts/briefing.log'),
('Desktop Sync',                   '0 * * * *',    'Hourly sync of workspace files to Windows desktop',   'scripts/sync_desktop.sh',                         'refinery', 'system',      NULL),
('Agent Config Sync',              '0 3 * * 1',    'Monday — sync identity files to cvc-agent-configs',   'scripts/sync_agent_configs.sh',                   'refinery', 'agent',       NULL),
('Trend Report Generation',        '30 5 * * *',   'Daily trend report pipeline',                         '05-trend-report/generate_report.py',              'refinery', 'scraping',    'output/generate_report.log')

ON CONFLICT DO NOTHING;
