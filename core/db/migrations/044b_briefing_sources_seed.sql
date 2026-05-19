-- Migration 044b: unique constraint + seed all tracked briefing sources
-- (name, source_type) uniqueness lets The Robot Report exist as both
-- YouTube channel and RSS feed without conflict.

ALTER TABLE cvc.briefing_sources
    ADD CONSTRAINT briefing_sources_name_type_uq UNIQUE (name, source_type);

-- ── YouTube channels (fetch_podcasts.py) ──────────────────────────────────

INSERT INTO cvc.briefing_sources (name, url, source_type, category, notes) VALUES

-- Vertical / thesis-relevant
('The Robot Report',          'https://www.youtube.com/@therobotreport7420',       'youtube', 'robotics',               'Vertical — robotics industry news'),
('Supply Chain Now',          'https://www.youtube.com/@SupplyChainNow',           'youtube', 'supply chain',           'Scott Luton — weekly interview show'),
('FreightWaves',              'https://www.youtube.com/@FreightWaves',             'youtube', 'supply chain',           'Freight & logistics market coverage'),
('ILTB Podcast',              'https://www.youtube.com/@ILTB_Podcast',             'youtube', 'supply chain',           'International logistics & trade'),
('Eric Kimberling',           'https://www.youtube.com/@erickimberling',           'youtube', 'ERP / enterprise',       'Transformation Ground Control / Third Stage Consulting'),

-- VC / macro
('All-In Podcast',            'https://www.youtube.com/@allin',                    'youtube', 'VC / macro',             'Chamath, Sacks, Friedberg, Palihapitiya'),
('BG2 Pod',                   'https://www.youtube.com/@Bg2Pod',                   'youtube', 'VC / macro',             'Bill Gurley & Brad Gerstner'),
('20VC',                      'https://www.youtube.com/@20VC',                     'youtube', 'VC',                     'Harry Stebbings — founder & investor interviews'),
('This Week in Startups',     'https://www.youtube.com/@startups',                 'youtube', 'VC',                     'Jason Calacanis'),
('TBPN Live',                 'https://www.youtube.com/@TBPNLive',                 'youtube', 'VC',                     'The Bootstrapped Founder / indie VC'),
('a16z',                      'https://www.youtube.com/@a16z',                     'youtube', 'VC',                     'Andreessen Horowitz — AI, fintech, bio'),
('Capital Allocators',        'https://www.youtube.com/@capitalallocatorspodcast', 'youtube', 'VC',                     'LP/GP interviews — Ted Seides'),
('Acquired FM',               'https://www.youtube.com/@AcquiredFM',               'youtube', 'VC',                     'Deep-dive company histories — Ben & David'),
('Founders Podcast',          'https://www.youtube.com/@founderspodcast1',         'youtube', 'VC',                     'David Senra — founder biography excerpts'),

-- Tech
('Lex Fridman',               'https://www.youtube.com/@lexfridman',               'youtube', 'tech / AI',              'Long-form AI, robotics, science interviews'),
('Dwarkesh Patel',            'https://www.youtube.com/@DwarkeshPatel',            'youtube', 'tech / AI',              'Deep technical interviews — AI & science'),
('Big Technology',            'https://www.youtube.com/@Alex.kantrowitz',          'youtube', 'tech',                   'Alex Kantrowitz — big tech coverage'),

-- Markets
('Risk Reversal Media',       'https://www.youtube.com/@RiskReversalMedia',        'youtube', 'markets',                'Dan Nathan — options & macro'),
('The Compound',              'https://www.youtube.com/@TheCompoundNews',          'youtube', 'markets',                'Josh Brown & Michael Batnick'),

-- Already in 044 seed — skip duplicates
('Transformation Ground Control','https://www.youtube.com/@TransformationGroundControl','youtube','ERP / enterprise',   'Eric Kimberling'),
('Third Stage Consulting',    'https://www.youtube.com/@ThirdStageConsulting',     'youtube', 'ERP / enterprise',       'Eric Kimberling'),
('Physical Intelligence',     'https://www.youtube.com/@physicalintelligence3d',   'youtube', 'robotics / physical AI', 'Research-focused'),

-- ── RSS feeds (trends/agents/rss_collector/feeds.json) ───────────────────

('TechCrunch Robotics',       'https://techcrunch.com/tag/robotics/feed/',         'rss',     'robotics',               'TC robotics tag'),
('The Robot Report',          'https://www.therobotreport.com/feed/',              'rss',     'robotics',               'RSS feed — robotics industry'),
('Robotics Business Review',  'https://www.roboticsbusinessreview.com/feed/',      'rss',     'robotics',               NULL),
('Robotics & Automation News','https://roboticsandautomationnews.com/feed/',       'rss',     'robotics / industrial',   NULL),
('IEEE Spectrum Robotics',    'https://spectrum.ieee.org/feeds/topic/robotics.rss','rss',     'robotics / physical AI',  'IEEE peer-reviewed coverage'),
('CSET Georgetown',           'https://cset.georgetown.edu/feed/',                 'rss',     'physical AI / robotics',  'AI & national security research'),
('VentureBeat AI',            'https://venturebeat.com/category/ai/feed/',         'rss',     'physical AI',            'Enterprise AI news'),
('Supply Chain Dive',         'https://www.supplychaindive.com/feeds/news/',       'rss',     'supply chain',           'Industry news'),
('Logistics Management',      'https://www.logisticsmgmt.com/rss',                'rss',     'supply chain',           NULL),
('Modern Materials Handling', 'https://www.mmh.com/rss/news',                     'rss',     'supply chain / robotics', NULL),
('FreightWaves',              'https://www.freightwaves.com/news/feed',            'rss',     'supply chain',           'News feed — separate from YouTube channel'),
('Crunchbase News',           'https://news.crunchbase.com/feed/',                'rss',     'VC / funding',           'Startup funding & M&A'),
('Farmonaut AgTech',          'https://farmonaut.com/feed/',                      'rss',     'robotics / agtech',      'Ag-tech & autonomous farming'),

-- From weekly_signals.py
('Supply Chain Brain',        'https://www.supplychainbrain.com/rss',             'rss',     'supply chain',           NULL),
('Automation World',          'https://www.automationworld.com/rss.xml',          'rss',     'industrial automation',   NULL),
('Ars Technica',              'https://feeds.arstechnica.com/arstechnica/index',  'rss',     'tech / physical AI',     NULL),
('VentureBeat',               'https://venturebeat.com/feed',                     'rss',     'tech / VC',              'General feed'),

-- ── Scraped / newsletter sites (scraped_sources.json) ────────────────────

('Standard Bots Blog',        'https://standardbots.com/blog',                    'newsletter','robotics / industrial', 'No-code robotics, factory floor deployment'),
('WIPO Technology Trends',    'https://www.wipo.int/tech_trends/en/',             'newsletter','robotics / physical AI','Global patent trends — who owns robotics/AI IP'),
('NIST Robotics',             'https://www.nist.gov/robotics',                    'newsletter','robotics / industrial', 'US government robotics standards and measurement science'),
('Gartner Supply Chain',      'https://www.gartner.com/en/supply-chain',          'newsletter','supply chain',          'Analyst coverage — CSCOs, trends')

ON CONFLICT (name, source_type) DO NOTHING;
