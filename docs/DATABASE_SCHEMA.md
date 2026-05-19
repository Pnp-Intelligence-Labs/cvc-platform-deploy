# CVC Intelligence — Database Schema

**Database:** `cvc_db` on Dell R620 (100.83.104.117)  
**Schema:** `cvc`  
**Last updated:** 2026-04-22

---

## Table Summary

| Table | Rows | Purpose |
|---|---|---|
| `companies` | 1,722 | Core company records — the heart of the platform |
| `content_items` | 3,079 | Ingested articles, podcasts, news for intelligence feed |
| `build_tasks` | 202 | Agent task queue (BigBossHog → BigClaw) |
| `partner_service_usage` | 148 | Per-partner service consumption tracking |
| `company_robotics` | 348 | Robotics-specific data (form factor, payload, uptime) |
| `fund_metrics` | 51 | Fund-level financials (IRR, TVPI, DPI, NAV) |
| `partners` | 36 | CVC partner companies |
| `partner_contracts` | 34 | Partner contract details and status |
| `agent_memory` | 46 | Agent memory logs (BigBossHog, BigClaw, SharpClaw) |
| `funding_rounds` | — | Formal funding round records per company |
| `partner_advisory_logs` | — | Meeting notes and advisory interactions |
| `partner_contacts` | 19 | Individual contacts within partner orgs |
| `partner_matches` | — | AI-suggested company↔partner matches |
| `partner_notes` | — | Freeform notes on partners |
| `partner_documents` | 3 | Uploaded documents per partner |
| `partner_issues` | 2 | Open issues/action items per partner |
| `shortlists` | 3 | Named company shortlists |
| `shortlist_companies` | 2 | Companies within each shortlist |
| `company_lifecycle` | 2 | Pipeline stage per company (discovered → invested) |
| `research_queue` | — | SharpClaw research job queue |
| `weekly_metrics` | — | Weekly platform health snapshot |
| `weekly_signals` | — | Weekly intelligence signal summaries |
| `entities` | — | Named entity bridge: content mentions → companies/partners |
| `platform_settings` | — | Runtime config key/value store (LLM models, thresholds, toggles) |
| `briefing_sources` | — | RSS/podcast sources for the briefing pipeline |
| `home_team_messages` | — | Admin messages shown on the homepage |
| `company_activity_log` | — | Audit trail of every field edit per company |
| `cron_jobs` | — | Worker job toggles (active flag per job name) |

---

## Core Tables

### `cvc.companies` — 1,722 rows
The primary table. Every startup, portfolio company, and sourcing target lives here.

| Column | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `name` | varchar | Company name |
| `one_liner` | text | Short description |
| `description` | text | Full description |
| `website` | varchar | |
| `founded` | integer | Year founded |
| `hq_city` | varchar | |
| `country` | varchar | |
| `employee_count` | integer | |
| `total_raised_usd` | bigint | Lifetime funding in USD |
| `stage` | varchar | Pre-seed / Seed / Series A / etc. |
| `sector` | varchar | Title Case: `Robotics`, `Supply Chain`, `Manufacturing`, `Industrial Automation`, `Physical AI` |
| `subsector` | varchar | |
| `verticals` | text[] | Array of verticals |
| `tags` | text[] | Freeform tags |
| `investors` | text[] | Known investors |
| `is_hardware` | boolean | |
| `is_software` | boolean | |
| `is_portfolio` | boolean | 67 portfolio companies flagged true |
| `business_model` | varchar | |
| **4D Classification** | | |
| `env_4d` | varchar | Environment classification |
| `func_4d` | varchar | Function classification |
| `stack_4d` | varchar | Stack classification |
| `biz_model_4d` | varchar | Business model classification |
| **Scoring** | | |
| `score_composite` | numeric | Overall score (0–100) |
| `score_commercial` | numeric | Commercial traction |
| `score_technical` | numeric | Technical depth |
| `score_market_timing` | numeric | Market timing |
| `score_partner_fit` | numeric | CVC partner alignment |
| `score_capital_eff` | numeric | Capital efficiency |
| `score_irs` | float | Industrial Readiness Score |
| `score_sri` | float | Sovereignty Readiness Index |
| `score_tdf` | float | Technology Depth Factor |
| `industrial_readiness_score` | numeric | |
| `sovereignty_score` | numeric | |
| `scored_at` | timestamp | Last scoring run |
| **Enrichment** | | |
| `enrichment_status` | varchar | `pending` / `enriched` / `failed` / `manual_review` |
| `enrichment_confidence` | float | LLM prediction confidence (0–1) |
| `predicted_subsector` | varchar | LLM-predicted subsector awaiting approval |
| **Partner Intros** | | |
| `intro_count` | integer | Number of partner intros |
| `intro_partners` | jsonb | Array of partner names who have introduced this company |
| `last_intro_date` | date | |
| **Industrial** | | |
| `protocol_support` | jsonb | Supported industrial protocols |
| `deployment_signal_level` | text | |
| `verified_certs` | jsonb | Certifications |
| `integration_notes` | text | |
| **Intelligence** | | |
| `intel_sources` | jsonb | Sources used in enrichment |
| `patent_count` | integer | |
| `patent_ipc_codes` | text[] | |
| `commercial_signals` | jsonb | |
| `scoring_data` | jsonb | Raw scoring inputs |
| `linkedin_url` | text | |
| **Portfolio** | | |
| `case_study` | text | |
| `competitive_advantage` | text | |
| `background` | text | |
| `latest_investment_date` | date | |
| `funding_rounds` | jsonb | Inferred funding rounds (also in `funding_rounds` table) |

---

### `cvc.partners` — 36 rows
CVC corporate venture partners — the industrial companies CVC brokers relationships for.

| Column | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `name` | text | Partner company name |
| `industry` | text | |
| `contact_name` | text | Primary contact |
| `contact_email` | text | |
| `challenge_areas` | text[] | What problems they're trying to solve |
| `sectors_of_interest` | text[] | Sectors they want deal flow in |
| `environments` | text[] | Operating environments (factory floor, cloud, etc.) |
| `current_protocols` | text[] | Industrial protocols in use |
| `cloud_platform` | text | AWS / Azure / GCP |
| `hardware_vendors` | text[] | Key hardware vendors |
| `factory_regions` | text[] | Where their facilities are |
| `scaling_speed` | text | `fast` / `medium` / `slow` |
| `salesforce_url` | text | CRM link |
| `playbook_url` | text | Partner playbook |
| `monday_item_id` | text | Monday.com integration |
| `notes` | text | Freeform notes |
| `created_at` / `updated_at` | timestamp | |

---

### `cvc.build_tasks` — 202 rows
The agent task queue. BigBossHog writes tasks here; BigClaw picks them up, builds, and deploys.

| Column | Type | Notes |
|---|---|---|
| `task_id` | integer | Primary key |
| `spec` | text | Full task description — what to build |
| `priority` | text | `low` / `medium` / `high` |
| `risk_level` | text | `low` / `medium` / `high` |
| `requires_approval` | boolean | If true, Nate must approve before BigClaw runs |
| `status` | text | `pending` → `approved` → `building` → `complete` → `deployed` |
| `task_type` | varchar | `general` / `dd` / `enrichment` |
| `created_by` | text | Usually `nate` or `bigbosshog` |
| `assigned_to` | text | Usually `bigclaw` |
| `commit_hash` | text | Git commit after completion |
| `nate_approved_at` | timestamp | When Nate approved |
| `started_at` / `completed_at` / `deployed_at` | timestamp | Lifecycle timestamps |
| `retry_count` | integer | Auto-retry counter |
| `parent_task_id` | integer | For subtask relationships |
| `notes` | text | Agent notes on execution |

**Status flow:** `pending` → (approval if required) → `approved` → `building` → `complete` → `deployed`  
**DD/enrichment tasks** (`task_type = 'dd'` or `'enrichment'`) are managed on the Enrichment page, not the Tasks page.

---

### `cvc.company_lifecycle` — 2 rows
Tracks where a company is in the CVC pipeline. One row per company.

| Column | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `company_id` | integer | FK → companies.id (unique) |
| `status` | text | `discovered` / `watching` / `researching` / `dd_active` / `invested` / `passed` |
| `status_changed_at` | timestamp | |
| `changed_by` | text | Who moved it |
| `reason` | text | Why it was moved |

---

### `cvc.company_robotics` — 348 rows
Extended robotics data for hardware companies.

| Column | Type | Notes |
|---|---|---|
| `company_id` | integer | FK → companies.id |
| `form_factor` | text | AMR / fixed arm / humanoid / drone / etc. |
| `application` | text | Palletizing / inspection / welding / etc. |
| `deployment_stage` | varchar | R&D / pilot / production |
| `payload_kg` | float | Max payload |
| `task_success_rate` | float | Reported success rate (0–1) |
| `uptime_pct` | float | Reported uptime (0–1) |

---

### `cvc.funding_rounds` — formal records
Individual funding rounds, separate from the `funding_rounds` jsonb column on companies.

| Column | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `company_id` | integer | FK → companies.id |
| `round_type` | varchar | Seed / Series A / Series B / etc. |
| `amount_usd` | bigint | |
| `announced_date` | date | |
| `investors` | text[] | Participating investors |
| `source` | varchar | Where this data came from |

---

### `cvc.content_items` — 3,079 rows
Articles, podcasts, and news ingested by SharpClaw for the intelligence feed.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `content_type` | varchar | `podcast` / `news` / `article` |
| `title` | varchar | |
| `url` | varchar | |
| `published_at` | timestamp | |
| `raw_text` | text | Full extracted text |
| `summary` | text | LLM-generated summary |
| `key_entities` | jsonb | Companies, people, technologies mentioned |
| `tags` | jsonb | Topic tags |
| `sentiment` | varchar | `positive` / `neutral` / `negative` |
| `enrichment_status` | varchar | `raw` / `enriched` |
| `podcast_synthesis` | jsonb | Structured podcast takeaways |
| `article_synthesis` | jsonb | Structured article takeaways |
| `briefing_flag` | varchar | Flagged for weekly briefing |

---

### `cvc.fund_metrics` — 51 rows
Fund-level financial performance snapshots.

| Column | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `committed_capital` | numeric | Total LP commitments |
| `deployed_capital` | numeric | Capital put to work |
| `nav` | numeric | Net Asset Value |
| `net_irr` | numeric | Net IRR |
| `tvpi` | numeric | Total Value to Paid-In |
| `dpi` | numeric | Distributions to Paid-In |

---

### `cvc.partner_contracts` — 34 rows

| Column | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `partner_id` | integer | FK → partners.id |
| `contract_status` | text | Active / expired / pending |
| `services_subscribed` | jsonb | List of subscribed services |
| `expiry_date` | date | |
| `contract_value` | numeric | |
| `contact_name` / `contact_email` | text | Contract contact |
| `file_link` | text | Link to contract document |
| `raw_summary` | text | LLM-parsed contract summary |
| `notes` | text | |

---

### `cvc.partner_matches` — AI-suggested introductions

| Column | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `partner_id` | integer | FK → partners.id |
| `company_id` | integer | FK → companies.id |
| `match_score` | integer | 0–100 compatibility score |
| `match_reason` | text | Why this match was suggested |
| `status` | text | `suggested` / `accepted` / `rejected` |

---

### `cvc.agent_memory` — 46 rows
Daily memory logs written by each agent.

| Column | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `agent` | text | `bigbosshog` / `bigclaw` / `sharpclaw` |
| `date` | date | Memory date |
| `entry_type` | text | `session` / `briefing` / `context` |
| `written_by` | text | Who wrote the entry |
| `content` | text | Full memory content |

---

### `cvc.research_queue`
SharpClaw's job queue for web research and enrichment runs.

| Column | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `company_name` | text | |
| `company_id` | integer | FK → companies.id (if matched) |
| `website` | text | |
| `priority` | text | `low` / `medium` / `high` |
| `status` | text | `pending` / `running` / `complete` / `failed` |
| `requested_by` | text | Which process requested this |

---

---

### `cvc.entities` — Intelligence entity bridge
Named entities extracted from content_items. Resolves to companies (startups) and partners (corporate).

| Column | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `name` | text | Original name as seen in content |
| `name_normalized` | text | Lowercased, stripped of corporate suffixes — UNIQUE constraint |
| `company_id` | integer | FK → companies.id (nullable) — matched startup |
| `partner_id` | integer | FK → partners.id (nullable) — matched corporate partner |
| `mention_count` | integer | Total times seen across all content |
| `first_seen` | timestamp | |
| `last_seen` | timestamp | |
| `resolved` | boolean | Whether company_id has been assigned |
| `match_confidence` | numeric(4,3) | difflib similarity score (company resolution) |
| `name_embedding` | vector(1024) | mxbai-embed-large embedding (Ollama) |
| `partner_confidence` | numeric(4,3) | Cosine similarity score (partner resolution) |

**Resolution pipeline:**
- Phase 1 (`entity_resolver.py`): scans `content_items.key_entities`, upserts to this table
- Phase 2 (`entity_resolver.py`): difflib SequenceMatcher at 0.85 threshold → `company_id`
- Phase 3 (`strategic_matcher_worker.py`): pgvector cosine similarity at 0.82 threshold → `partner_id`

---

### `cvc.partners` — new columns (migration 079)

| Column | Type | Notes |
|---|---|---|
| `name_embedding` | vector(1024) | mxbai-embed-large embedding — used by strategic matcher |

---

### `cvc.platform_settings` — Runtime config
Key/value store for LLM model names, thresholds, and feature toggles. SSoT — workers read from here, never hardcode.

| Column | Type | Notes |
|---|---|---|
| `key` | text | Setting name — UNIQUE |
| `value` | text | Setting value |
| `updated_at` | timestamp | |

Loaded via `core/config_loader.py` (`ConfigLoader` singleton). Safe defaults baked into loader if row is missing.

---

## Key Relationships

```
companies ──────────────────── company_robotics     (1:1)
companies ──────────────────── company_lifecycle    (1:1)
companies ──────────────────── funding_rounds       (1:many)
companies ──────────────────── shortlist_companies  (many:many via shortlists)

partners  ──────────────────── partner_contacts     (1:many)
partners  ──────────────────── partner_contracts    (1:many)
partners  ──────────────────── partner_documents    (1:many)
partners  ──────────────────── partner_notes        (1:many)
partners  ──────────────────── partner_issues       (1:many)
partners  ──────────────────── partner_service_usage (1:many)
partners  ──────────────────── partner_advisory_logs (1:many)

partners  ──── partner_matches ──── companies       (many:many)

entities  ──────────────────────── companies        (many:1, nullable)
entities  ──────────────────────── partners         (many:1, nullable)
content_items ── (key_entities jsonb) ── entities   (via entity_resolver.py ingest)
```

---

## Notes for Developers

- All tables live in the `cvc` schema — always prefix queries with `cvc.`
- `companies.investors` and `companies.tags` are `text[]` arrays — use `ANY()` or `@>` for filtering, never `::jsonb`
- `companies.sector` values are Title Case (`Robotics`, not `robotics`)
- `build_tasks` primary key is `task_id`, not `id`
- `company_lifecycle` has a unique constraint on `company_id` — use `ON CONFLICT (company_id) DO UPDATE`
- The API runs on port 8001 on the Dell server; the old app on port 8000 is a separate legacy instance
