-- Migration 100: Refactor news system for QQQ company tracking
-- Removes old category-based system, replaces with general company watch list
-- Pre-populates with Nasdaq-100 (QQQ) companies for demo

-- ── 1. Remove the old category CHECK constraint ─────────────────────────────
ALTER TABLE cvc.news_watch_companies DROP CONSTRAINT IF EXISTS news_watch_companies_category_check;

-- Make category nullable (we keep the column for backwards compat but it's optional)
ALTER TABLE cvc.news_watch_companies ALTER COLUMN category DROP NOT NULL;
ALTER TABLE cvc.news_watch_companies ALTER COLUMN category SET DEFAULT 'QQQ';

-- Add ticker symbol column for stock reference
ALTER TABLE cvc.news_watch_companies ADD COLUMN IF NOT EXISTS ticker TEXT;

-- ── 2. Clear all existing watch data ─────────────────────────────────────────
DELETE FROM cvc.category_news;
DELETE FROM cvc.news_watch_companies;

-- ── 3. Add activity_type to category_news for signal classification ──────────
ALTER TABLE cvc.category_news ADD COLUMN IF NOT EXISTS activity_type TEXT;

-- ── 4. Insert all Nasdaq-100 / QQQ companies ────────────────────────────────
INSERT INTO cvc.news_watch_companies (company_name, category, ticker) VALUES
  -- Technology — Mega Cap
  ('Apple', 'QQQ', 'AAPL'),
  ('Microsoft', 'QQQ', 'MSFT'),
  ('NVIDIA', 'QQQ', 'NVDA'),
  ('Amazon', 'QQQ', 'AMZN'),
  ('Alphabet', 'QQQ', 'GOOGL'),
  ('Meta Platforms', 'QQQ', 'META'),
  ('Tesla', 'QQQ', 'TSLA'),
  ('Broadcom', 'QQQ', 'AVGO'),
  -- Technology — Large Cap
  ('Adobe', 'QQQ', 'ADBE'),
  ('Salesforce', 'QQQ', 'CRM'),
  ('Advanced Micro Devices', 'QQQ', 'AMD'),
  ('Intel', 'QQQ', 'INTC'),
  ('Qualcomm', 'QQQ', 'QCOM'),
  ('Texas Instruments', 'QQQ', 'TXN'),
  ('Applied Materials', 'QQQ', 'AMAT'),
  ('Intuit', 'QQQ', 'INTU'),
  ('Lam Research', 'QQQ', 'LRCX'),
  ('Micron Technology', 'QQQ', 'MU'),
  ('Analog Devices', 'QQQ', 'ADI'),
  ('Synopsys', 'QQQ', 'SNPS'),
  ('Cadence Design Systems', 'QQQ', 'CDNS'),
  ('Marvell Technology', 'QQQ', 'MRVL'),
  ('KLA Corporation', 'QQQ', 'KLAC'),
  ('Microchip Technology', 'QQQ', 'MCHP'),
  ('ON Semiconductor', 'QQQ', 'ON'),
  ('ASML Holding', 'QQQ', 'ASML'),
  -- Internet / Software
  ('Netflix', 'QQQ', 'NFLX'),
  ('PayPal', 'QQQ', 'PYPL'),
  ('Booking Holdings', 'QQQ', 'BKNG'),
  ('Palo Alto Networks', 'QQQ', 'PANW'),
  ('CrowdStrike', 'QQQ', 'CRWD'),
  ('Fortinet', 'QQQ', 'FTNT'),
  ('Datadog', 'QQQ', 'DDOG'),
  ('Zscaler', 'QQQ', 'ZS'),
  ('MongoDB', 'QQQ', 'MDB'),
  ('Workday', 'QQQ', 'WDAY'),
  ('Atlassian', 'QQQ', 'TEAM'),
  ('Splunk', 'QQQ', 'SPLK'),
  ('Trade Desk', 'QQQ', 'TTD'),
  ('Cloudflare', 'QQQ', 'NET'),
  ('Zoom Video Communications', 'QQQ', 'ZM'),
  ('DocuSign', 'QQQ', 'DOCU'),
  ('Snowflake', 'QQQ', 'SNOW'),
  -- Communications
  ('T-Mobile US', 'QQQ', 'TMUS'),
  ('Comcast', 'QQQ', 'CMCSA'),
  ('Charter Communications', 'QQQ', 'CHTR'),
  -- Consumer / Retail
  ('Costco Wholesale', 'QQQ', 'COST'),
  ('PepsiCo', 'QQQ', 'PEP'),
  ('Starbucks', 'QQQ', 'SBUX'),
  ('Mondelez International', 'QQQ', 'MDLZ'),
  ('Keurig Dr Pepper', 'QQQ', 'KDP'),
  ('Lululemon Athletica', 'QQQ', 'LULU'),
  ('Dollar Tree', 'QQQ', 'DLTR'),
  ('Ross Stores', 'QQQ', 'ROST'),
  ('O''Reilly Automotive', 'QQQ', 'ORLY'),
  ('Baker Hughes', 'QQQ', 'BKR'),
  ('Marriott International', 'QQQ', 'MAR'),
  ('Cintas', 'QQQ', 'CTAS'),
  ('Fastenal', 'QQQ', 'FAST'),
  ('Paychex', 'QQQ', 'PAYX'),
  -- Healthcare / Biotech
  ('Amgen', 'QQQ', 'AMGN'),
  ('Gilead Sciences', 'QQQ', 'GILD'),
  ('Regeneron Pharmaceuticals', 'QQQ', 'REGN'),
  ('Vertex Pharmaceuticals', 'QQQ', 'VRTX'),
  ('Moderna', 'QQQ', 'MRNA'),
  ('Illumina', 'QQQ', 'ILMN'),
  ('Dexcom', 'QQQ', 'DXCM'),
  ('Biogen', 'QQQ', 'BIIB'),
  ('AstraZeneca', 'QQQ', 'AZN'),
  -- Industrials / EV
  ('Honeywell International', 'QQQ', 'HON'),
  ('Automatic Data Processing', 'QQQ', 'ADP'),
  ('CSX Corporation', 'QQQ', 'CSX'),
  ('Old Dominion Freight Line', 'QQQ', 'ODFL'),
  ('Copart', 'QQQ', 'CPRT'),
  ('Verisk Analytics', 'QQQ', 'VRSK'),
  ('IDEXX Laboratories', 'QQQ', 'IDXX'),
  ('Paccar', 'QQQ', 'PCAR'),
  ('Sirius XM Holdings', 'QQQ', 'SIRI'),
  ('Warner Bros Discovery', 'QQQ', 'WBD'),
  ('Lucid Group', 'QQQ', 'LCID'),
  ('Rivian Automotive', 'QQQ', 'RIVN'),
  -- Energy / Utilities
  ('AEP', 'QQQ', 'AEP'),
  ('Exelon', 'QQQ', 'EXC'),
  ('Xcel Energy', 'QQQ', 'XEL'),
  ('Constellation Energy', 'QQQ', 'CEG'),
  -- Financial Tech
  ('Coinbase Global', 'QQQ', 'COIN'),
  ('MercadoLibre', 'QQQ', 'MELI'),
  ('DoorDash', 'QQQ', 'DASH'),
  ('Airbnb', 'QQQ', 'ABNB'),
  ('Uber Technologies', 'QQQ', 'UBER'),
  ('Pinduoduo', 'QQQ', 'PDD'),
  ('JD.com', 'QQQ', 'JD'),
  ('Baidu', 'QQQ', 'BIDU'),
  ('NIO', 'QQQ', 'NIO'),
  ('Arm Holdings', 'QQQ', 'ARM'),
  ('Super Micro Computer', 'QQQ', 'SMCI'),
  ('Palantir Technologies', 'QQQ', 'PLTR'),
  ('AppLovin', 'QQQ', 'APP')
ON CONFLICT DO NOTHING;

-- ── 5. Drop old category constraint on category_news too ─────────────────────
ALTER TABLE cvc.category_news ALTER COLUMN category DROP NOT NULL;
ALTER TABLE cvc.category_news ALTER COLUMN category SET DEFAULT 'QQQ';

-- ── 6. Add index on activity_type ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_category_news_activity_type ON cvc.category_news (activity_type);
CREATE INDEX IF NOT EXISTS idx_news_watch_ticker ON cvc.news_watch_companies (ticker);
