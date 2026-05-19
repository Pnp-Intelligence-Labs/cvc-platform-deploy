# 4D Company Taxonomy

**Owner:** Deep Enrichment pipeline  
**Populated by:** `workers/enrichment/enrich_deep.py`  
**Model:** `qwen/qwen3-235b-a22b-2507` via OpenRouter  
**DB columns:** `cvc.companies.env_4d`, `func_4d`, `stack_4d`, `biz_model_4d`  
**Cron:** Daily @ 2:30 AM UTC — gated by `cvc.cron_jobs` job name `"Company Deep Enrichment"`  
**Coverage:** 1,533 / 1,722 companies classified (189 unclassified as of 2026-04-14)

---

## Purpose

The 4D taxonomy places every company on four independent axes. Together they answer: **what kind of company is this, and where does it fit?**

This is distinct from `sector` (a market vertical). A company's 4D classification describes its *technical role* and *commercial model*, not its industry. Two companies in the same sector can have completely different 4D profiles.

Used by:
- **Sourcing filters** — filter/stack companies by any combination of dimensions
- **Market Mapper** (quarterly trend agent) — identifies clustering and white space across the portfolio
- **Scoring Engine** — 4D context feeds composite score calculation
- **Sector Analyst** — `env_4d` used as a signal in quarterly reports

---

## Enrichment Process

`enrich_deep.py` runs these steps for each company:

### Step 1 — Website Scrape
`requests.get()` with a browser User-Agent. Strips all script/style tags and HTML to extract up to 4,000 characters of readable content. Falls back gracefully if the site is unreachable.

### Step 2 — Brave Search ×3
Three targeted searches with 1.2s rate-limit gaps between calls:
1. `"{name}" news announcement 2025 2026` — recent news and announcements
2. `"{name}" funding raised investment round investors` — funding and investor context
3. `"{name}" product technology robotics automation` — product and technology details

Returns up to 3,000 characters of combined bullet-formatted snippets. Uses `BRAVE_SEARCH_KEY` (primary) and `BRAVE_SEARCH_KEY_BACKUP` (fallback).

### Step 3 — LLM Classification
All research context (website text + search snippets) is passed to `qwen3-235b-a22b-2507` in a single call (`temp=0.1`, `max_tokens=1000`). The model outputs:
- All four 4D fields (always required — no null option)
- Optional profile fields: `description`, `stage`, `employee_count`, `total_raised_usd`, `investors`, `tags`, `hq_city`, `country`, `founded`

### Step 4 — Write to DB (preserve-first)
- Profile fields already populated in the DB are **never overwritten** — only gaps are filled
- 4D fields are **always written**, even if previously set — re-enrichment improves accuracy as the model gets better context
- Sets `enrichment_source = 'deep_enrich'`

---

## The Four Dimensions

### Dimension 1 — Environment (`env_4d`)

*Where does the technology operate?*

| Value | Meaning |
|---|---|
| `Structured_Indoor` | Warehouses, factories, hospitals, controlled facilities — predictable environment |
| `Unstructured_Outdoor` | Construction, agriculture, field service, last-mile delivery — unpredictable terrain |
| `Aerial` | Drones, UAVs, airborne systems |
| `Subsea_Underground` | Subsea inspection, mining, tunneling, underground infrastructure |
| `Virtual_Simulated` | Simulation, digital twin, software-only — no physical operating environment |
| `Environment_Agnostic` | Horizontal platform plays — works across multiple physical environments |

---

### Dimension 2 — Function (`func_4d`)

*What does the technology do?*

| Value | Meaning |
|---|---|
| `Manipulation` | Physical grasping, assembly, pick-and-place, handling — the robot touches things |
| `Mobility` | Locomotion, navigation, transport, AMRs — the robot moves |
| `Perception` | Sensing, computer vision, detection, mapping — the robot sees/understands |
| `Cognition` | Decision-making, planning, AI inference, reasoning — the robot thinks |
| `Human_Collaboration` | Cobots, human-robot interaction, assistive technology — the robot works with people |
| `Infrastructure` | Connectivity, power, edge compute, developer tooling — the robot ecosystem |

---

### Dimension 3 — Stack Layer (`stack_4d`)

*Where does the company sit in the value chain?*

| Value | Meaning |
|---|---|
| `Component` | Chip, sensor, actuator, motor — a part that goes into something else |
| `Subsystem` | Module (e.g. a vision subsystem, a gripper) — integrates into a larger product |
| `Solution` | End-to-end product for a specific use case — vertical-focused |
| `Platform` | Horizontal layer others build on — OS, middleware, dev platform |
| `Intelligence` | Pure software or AI layer — no hardware, sits on top of existing systems |
| `Ops` | Fleet management, monitoring, maintenance tooling — operates deployed systems |

---

### Dimension 4 — Business Model (`biz_model_4d`)

*How does the company make money?*

| Value | Meaning |
|---|---|
| `Hardware_OEM` | Sells the physical product (robot, sensor, device) |
| `SaaS` | Software subscription — recurring revenue, no hardware |
| `RaaS` | Robotics-as-a-Service — outcome- or usage-based, often hardware + software bundled |
| `Integration_Consulting` | Services-led — deploys and integrates third-party systems |
| `Data_Analytics` | Sells data products or analytics derived from operations |
| `Marketplace` | Platform connecting buyers and sellers of robotics services or hardware |
| `Research_Lab` | Pre-commercial — primarily grant or government contract funded |

---

## Running Deep Enrichment

```bash
# All unclassified companies (nightly gate applies)
cd /home/nathan11/repos/cvc-intelligence
PYTHONPATH=core CVC_DB_HOST=localhost python3 workers/enrichment/enrich_deep.py

# Single company by name
PYTHONPATH=core CVC_DB_HOST=localhost python3 workers/enrichment/enrich_deep.py --company "Xplorobot"

# Single company by ID, bypass cron gate
PYTHONPATH=core CVC_DB_HOST=localhost python3 workers/enrichment/enrich_deep.py --id 1728 --no-gate

# Batch of 50
PYTHONPATH=core CVC_DB_HOST=localhost python3 workers/enrichment/enrich_deep.py --limit 50
```

Required env vars (loaded via `source .env`):
- `BRAVE_SEARCH_KEY` — primary Brave Search API key
- `BRAVE_SEARCH_KEY_BACKUP` — fallback key
- `OPENROUTER_API_KEY` — for LLM calls

---

## Coverage Check

```sql
SELECT
  COUNT(*) FILTER (WHERE env_4d IS NOT NULL) AS classified,
  COUNT(*) FILTER (WHERE env_4d IS NULL)     AS unclassified,
  COUNT(*)                                   AS total
FROM cvc.companies;
```

---

## Example Combinations

| Company Type | env_4d | func_4d | stack_4d | biz_model_4d |
|---|---|---|---|---|
| Warehouse AMR vendor | `Structured_Indoor` | `Mobility` | `Solution` | `RaaS` |
| Computer vision chip | `Environment_Agnostic` | `Perception` | `Component` | `Hardware_OEM` |
| Robot OS / middleware | `Environment_Agnostic` | `Infrastructure` | `Platform` | `SaaS` |
| Outdoor inspection drone | `Unstructured_Outdoor` | `Perception` | `Solution` | `SaaS` |
| Cobot arm manufacturer | `Structured_Indoor` | `Manipulation` | `Solution` | `Hardware_OEM` |
| Fleet ops software | `Environment_Agnostic` | `Cognition` | `Ops` | `SaaS` |
| Agricultural autonomy | `Unstructured_Outdoor` | `Mobility` | `Solution` | `Hardware_OEM` |
| Methane detection system | `Unstructured_Outdoor` | `Perception` | `Solution` | `Hardware_OEM` |
