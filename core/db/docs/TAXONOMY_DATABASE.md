# CVC Producer Database — Taxonomy & Enrichment Layer

**Last documented:** 2026-03-11
**Database:** producer (host: 100.121.44.108, port: 5432)
**Created:** 2026-02-17 (session — code NOT committed to any repo)

> **CRITICAL NOTE:** All tables in the `public` schema taxonomy system were created in a Claude Code
> session on 2026-02-17. No creation scripts exist in any repo. This document is the only record of
> the schema, data population status, and intent. If the Droplet is reset, all of this is lost.

---

## Overview

The taxonomy layer sits in the `public` schema and enriches the `cvc.companies` table with structured
classification across three dimensions: **subsectors** (market verticals), **tech pillars**
(technology categories), and **market themes** (macro investment narratives).

It also contains the beginnings of a **subsector intelligence system** with historical metrics,
tech evolution events, sector narratives, and a function/hardware/software taxonomy.

---

## Schema: `public` — Taxonomy Tables

### Core Reference Tables

#### `public.subsectors`
32 rows. Hierarchical market vertical taxonomy.

| Column | Type | Notes |
|--------|------|-------|
| subsector_id | integer | PK |
| name | varchar | e.g. "Warehouse Automation", "Humanoid Robotics" |
| parent_id | integer | FK to subsectors (self-referential hierarchy) |
| parent_sector_id | integer | FK to parent_sectors |
| category | varchar | Always "vertical" currently |
| description | text | 1-2 sentence definition |
| market_size_2026_billions | decimal | Populated for ~5 subsectors only |
| growth_rate_cagr | decimal | NULL for all rows (not populated) |
| created_date | timestamp | 2026-02-17 |

**Subsector Hierarchy (32 total):**
```
Advanced Manufacturing
  ├── Aerospace & Defense Manufacturing
  ├── Automotive Manufacturing
  ├── Electronics Manufacturing
  ├── Medical Device Manufacturing
  └── Smart Factory

Agriculture
  ├── Autonomous Agricultural Equipment
  ├── Controlled Environment Agriculture
  ├── Livestock & Dairy Automation
  └── Precision Farming

Construction & Infrastructure
  ├── Building Information Modeling (BIM)
  ├── Construction Site Safety
  ├── Modular & Prefab Building
  └── Robotic Construction

Energy & Utilities
  ├── Carbon Capture & Storage (CCUS)
  ├── Microgrid & Distributed Energy
  ├── Renewable Energy Integration
  └── Smart Grid

Logistics & Supply Chain
  ├── Cold Chain Monitoring
  ├── Last-Mile Delivery
  ├── Supply Chain Visibility
  └── Warehouse Automation

Robotics (standalone — parent_sector_id=1)
  ├── Agricultural Robotics
  ├── Construction Robotics
  ├── Humanoid Robotics
  ├── Industrial Robotics
  ├── Logistics Robotics
  └── Service Robotics
```

**Companies per subsector (top):**
| Subsector | Companies Tagged |
|-----------|-----------------|
| Renewable Energy Integration | 185 |
| Industrial Robotics | 174 |
| Smart Factory | 152 |
| Warehouse Automation | 136 |
| Last-Mile Delivery | 107 |
| Modular & Prefab Building | 91 |
| Logistics Robotics | 56 |
| Precision Farming | 25 |
| Agricultural Robotics | 23 |
| Smart Grid | 21 |
| Humanoid Robotics | 3 |
| Construction Robotics | 3 |

---

#### `public.tech_pillars`
15 rows. Technology category taxonomy.

| Column | Type | Notes |
|--------|------|-------|
| pillar_id | integer | PK |
| name | varchar | e.g. "Industrial IoT (IIoT)" |
| category | varchar | automation / connectivity / intelligence / security |
| description | text | 1-2 sentence definition |
| created_date | timestamp | 2026-02-17 |

**Tech Pillars by Category:**
```
automation:
  - Autonomous Mobile Robots (AMRs)
  - Collaborative Robots (Cobots)
  - Robotic Manipulation
  - Additive Manufacturing (3D Printing)

connectivity:
  - Industrial IoT (IIoT)
  - Edge Computing
  - 5G/6G Private Networks
  - Data Integration Platforms

intelligence:
  - Digital Twins
  - Predictive Maintenance
  - Computer Vision & Quality Control
  - Generative AI for Design

security:
  - OT/IT Convergence Security
  - Zero Trust Architecture
  - AI-Powered Threat Detection
```

**Companies per tech pillar (top):**
| Tech Pillar | Companies Tagged |
|-------------|-----------------|
| Industrial IoT (IIoT) | 359 |
| Computer Vision & Quality Control | 244 |
| Autonomous Mobile Robots (AMRs) | 231 |
| Digital Twins | 115 |
| Predictive Maintenance | 52 |
| Edge Computing | 39 |
| Additive Manufacturing | 36 |
| Robotic Manipulation | 22 |
| Collaborative Robots (Cobots) | 8 |

---

#### `public.market_themes`
10 rows. Macro investment narrative taxonomy.

| Column | Type | Notes |
|--------|------|-------|
| theme_id | integer | PK |
| name | varchar | e.g. "Agentic Industry" |
| description | text | |
| emergence_year | integer | When this theme emerged |
| relevance_score | integer | 1-10 |
| created_date | timestamp | |

**Themes (sorted by relevance):**
| Theme | Emergence | Score |
|-------|-----------|-------|
| Agentic Industry | 2025 | 10 |
| Green Industrials | 2023 | 10 |
| Circular Supply Chains | 2024 | 9 |
| AI-on-AI Cybersecurity Warfare | 2025 | 9 |
| Industrialized Construction | 2024 | 9 |
| Software-Defined Manufacturing | 2024 | 8 |
| Industry 5.0 (Human-Centric) | 2025 | 8 |
| Functional Capacity Crisis | 2025 | 8 |
| Hyper-Local Fulfillment | 2024 | 8 |
| Self-Healing Infrastructure | 2025 | 7 |

---

### Company Junction Tables

#### `public.company_subsectors`
1,015 rows. Companies tagged to subsectors.

| Column | Type | Notes |
|--------|------|-------|
| company_id | integer | FK to cvc.companies |
| subsector_id | integer | FK to public.subsectors |
| is_primary | boolean | Primary vs. secondary classification |
| confidence_score | numeric | 0-1 confidence |
| tagged_date | timestamp | 2026-02-17 |
| tagged_by | varchar | Who/what tagged this |
| notes | text | |

**751 distinct companies tagged** (some have multiple subsectors).

---

#### `public.company_tech_pillars`
1,106 rows. Companies tagged to tech pillars.

| Column | Type | Notes |
|--------|------|-------|
| company_id | integer | FK to cvc.companies |
| pillar_id | integer | FK to public.tech_pillars |
| relevance_score | integer | |
| tagged_date | timestamp | 2026-02-17 |

**745 distinct companies tagged.**

---

#### `public.company_themes`
1,292 rows. Companies tagged to market themes.

| Column | Type | Notes |
|--------|------|-------|
| company_id | integer | FK to cvc.companies |
| theme_id | integer | FK to public.market_themes |
| relevance_score | integer | |
| tagged_date | timestamp | |

---

### Intelligence Tables

#### `public.tech_evolution_events`
745 rows. Milestone/event history per subsector scraped from web.

| Column | Type | Notes |
|--------|------|-------|
| event_id | integer | PK |
| subsector_id | integer | FK to subsectors |
| event_date | date | |
| event_type | varchar | milestone / partnership / funding / regulation |
| title | varchar | Article/event title |
| description | text | Extracted content |
| significance_score | integer | All currently = 7 (default) |
| companies_involved | array | Company names (mostly empty) |
| created_date | timestamp | |

Covers: Last-Mile Delivery (subsector 12) and Modular & Prefab Building (subsector 19) primarily.

---

#### `public.subsector_metrics_history`
143 rows. Market size data scraped from research firms.

| Column | Type | Notes |
|--------|------|-------|
| subsector_id | integer | FK |
| metric_date | date | When scraped |
| metric_type | varchar | market_size (only type so far) |
| metric_value | numeric | Dollar value |
| metric_unit | varchar | billions_usd |
| source_name | varchar | e.g. "Grand View Research" |
| source_type | varchar | market_report |
| confidence_level | varchar | high / medium / low |
| is_projection | boolean | |

**Subsectors with market size data:**
| Subsector | Market Size (2026) | Source |
|-----------|-------------------|--------|
| Warehouse Automation | $107.36B | Precedence Research |
| Smart Factory / Smart Manufacturing | $322.82B | Fortune Business Insights |
| Modular & Prefab Building | $111.07B | Grand View Research |
| Renewable Energy Integration | $1,602B | Grand View Research |
| Smart Grid | $10.50B | GM Insights |
| Precision Farming | $43.64B | Precedence Research |

Note: Many rows are duplicates (same subsector scraped multiple times same day).

---

#### `public.sector_function_taxonomy`
3 rows. Maps robotics sector to functional pillars + hardware/software tags.

| Column | Type | Notes |
|--------|------|-------|
| id | integer | PK |
| sector_id | integer | FK to parent_sectors |
| function_pillar | varchar | Perception / Cognition / Manipulation |
| hardware_tags | text[] | e.g. LiDAR, Stereo_Camera, Radar |
| software_tags | text[] | e.g. Computer_Vision, SLAM |
| description | text | |
| created_date | timestamp | 2026-02-18 |

**Only robotics (sector_id=1) covered. Started Feb 18, stopped after 3 rows.**

| Function | Hardware Tags | Software Tags |
|----------|--------------|---------------|
| Perception | LiDAR, Stereo_Camera, Radar, Ultrasonic, Thermal, Tactile, IMU | Computer_Vision, Sensor_Fusion, SLAM, Object_Detection, Localization |
| Cognition | Edge_Compute, GPU_Accelerator, Custom_ASIC, Cloud_Offload | Path_Planning, Obstacle_Avoidance, Fleet_Orchestration, Task_Scheduling, ML_Inference, Foundation_Models |
| Manipulation | Articulated_Arm, Gripper, Mobile_Base, Legs, Wheels, Tracks, Propellers, Actuators | Inverse_Kinematics, Grasping_Algorithms, Motion_Planning, Teleoperation, Force_Control |

---

#### `public.sector_narratives`
2 rows. Written narrative content about the robotics sector.

Both rows are for `parent_sector_id=1` (Robotics):
- **overview** — 500+ word history and current state of robotics market
- **definition** — structured definition with key characteristics, form factors, applications

---

### Schema: `cvc.companies` — 4D Classification

Populated via `00-cvc-skills/db/enrich.py` (`run_classify_4d()` and `backfill_4d_from_csv()`).

| Column | Values | Coverage |
|--------|--------|----------|
| env_4d | Structured_Indoor, Unstructured_Outdoor, Environment_Agnostic, Virtual_Simulated, Aerial, Subsea_Underground | 1,534 companies |
| func_4d | Infrastructure, Cognition, Perception, Mobility, Manipulation, Human_Collaboration | 1,534 companies |
| stack_4d | Solution, Platform, Component, Intelligence, Subsystem, Ops | 1,534 companies |
| biz_model_4d | Hardware_OEM, SaaS, RaaS, Integration_Consulting, Data_Analytics, Marketplace, Research_Lab | sparse |

**4D Distribution:**
```
env_4d:   Structured_Indoor(554) > Environment_Agnostic(346) > Unstructured_Outdoor(315) > Virtual_Simulated(192) > Aerial(104) > Subsea_Underground(23)
func_4d:  Infrastructure(535) > Cognition(400) > Perception(308) > Mobility(138) > Manipulation(81) > Human_Collaboration(72)
stack_4d: Solution(717) > Platform(654) > Component(94) > Intelligence(47) > Subsystem(20) > Ops(2)
```

---

## Empty Tables (Designed, Not Yet Populated)

These tables exist with full schemas but 0 rows. They represent planned future work:

| Table | Purpose |
|-------|---------|
| `public.subsector_narratives` | Written narrative per subsector (like sector_narratives but granular) |
| `public.subsector_projections` | Forward-looking projections per subsector |
| `public.subsector_metrics` | Current metrics (vs. history table) |
| `public.subsector_use_cases` | Specific use cases per subsector |
| `public.subsector_tech_dependencies` | Tech stack dependencies per subsector |
| `public.subsector_geographic_strength` | Geographic concentration by subsector |
| `public.investment_trends` | Investment trend tracking |
| `public.geographic_clusters` | Regional cluster analysis |
| `public.weekly_signals` | Weekly signal aggregation |
| `public.metric_definitions` | Metric definition reference |
| `public.adoption_drivers` | What's driving adoption per subsector |

### DD-Connected Tables (Empty — High Priority)
| Table | Purpose |
|-------|---------|
| `public.dd_evaluations` | DD evaluation records linked to companies |
| `public.dd_research_tasks` | Research task queue for DD |
| `public.dd_results` | DD results stored here (vs. workdir JSON) |
| `public.startups` | Startup tracking (separate from cvc.companies) |
| `public.reports` | Report generation tracking |
| `public.generated_reports` | Generated report outputs |
| `public.report_templates` | Report template definitions |
| `public.meetings` | Meeting/interaction tracking |
| `public.partner_interviews` | Partner interview records |
| `public.startup_interviews` | Startup interview records |

---

## What's Missing / Next Steps

### Critical Gaps

1. **No creation scripts exist anywhere** — The schema was created in an ad-hoc session on 2026-02-17.
   Recovery plan: export schema DDL from the live DB and commit to 00-cvc-skills/db/.

2. **sector_function_taxonomy incomplete** — Only robotics sector covered (3 rows).
   Needs: supply_chain, industrial_auto, physical_ai sectors added.

3. **market_size / growth_rate unpopulated for most subsectors** — Only 6 subsectors have market size.
   The `subsector_metrics_history` table has the data but it's not linked back to `subsectors.market_size_2026_billions`.

4. **Duplicate metrics rows** — `subsector_metrics_history` has duplicates (same subsector scraped multiple times). Needs dedup.

5. **Humanoid Robotics only 3 companies tagged** — Major coverage gap given CVC thesis.

6. **dd_evaluations / dd_results tables empty** — The connection between DD pipeline and the taxonomy
   layer has been designed but never implemented.

### Recommended Next Steps

1. Export live schema DDL → commit to `00-cvc-skills/db/migrations/`
2. Complete `sector_function_taxonomy` for all 4 sectors
3. Build segment scoring agent in `cvc-pipe-trends` that queries companies by subsector + tech pillar
   and computes commercial velocity / market timing scores quarterly
4. Wire `02-dd-pipeline` to write DD results to `public.dd_evaluations` after each run
5. Populate `public.subsector_narratives` using the sector_analyst agent output

---

## Querying Examples

### Companies in a subsector with scores
```sql
SELECT c.name, c.sector, c.score_composite, c.score_commercial, c.score_technical,
       s.name as subsector
FROM cvc.companies c
JOIN public.company_subsectors cs ON c.id = cs.company_id
JOIN public.subsectors s ON cs.subsector_id = s.subsector_id
WHERE s.name = 'Warehouse Automation'
  AND cs.is_primary = true
ORDER BY c.score_composite DESC NULLS LAST;
```

### Commercial velocity by subsector
```sql
SELECT s.name as subsector,
       COUNT(DISTINCT fe.id) as funding_events,
       SUM(fe.amount_usd) as total_capital,
       AVG(c.score_commercial) as avg_commercial_score
FROM public.subsectors s
JOIN public.company_subsectors cs ON s.subsector_id = cs.subsector_id
JOIN cvc.companies c ON cs.company_id = c.id
LEFT JOIN trend_report.funding_events fe ON fe.company_id = c.id
  AND fe.event_date >= NOW() - INTERVAL '1 year'
GROUP BY s.subsector_id, s.name
ORDER BY total_capital DESC NULLS LAST;
```

### Companies by tech pillar + 4D function
```sql
SELECT c.name, c.func_4d, c.env_4d, c.stack_4d, tp.name as tech_pillar
FROM cvc.companies c
JOIN public.company_tech_pillars ct ON c.id = ct.company_id
JOIN public.tech_pillars tp ON ct.pillar_id = tp.pillar_id
WHERE tp.name = 'Computer Vision & Quality Control'
  AND c.func_4d = 'Perception'
ORDER BY c.score_composite DESC NULLS LAST;
```
