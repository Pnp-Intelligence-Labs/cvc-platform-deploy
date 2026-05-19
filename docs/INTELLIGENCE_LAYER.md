# Intelligence Layer — Entity Resolution & Partner Signal Tracking

**Last updated:** 2026-04-22  
**Migrations:** 078 (cvc.entities), 079 (embeddings + partner resolution)

---

## What This Is

The intelligence layer bridges raw content mentions to CVC's known world — the 1,700+ companies in the pipeline and the 36 corporate advisory partners. Every article and podcast produces named entity mentions; this layer figures out *who* they're talking about.

Two resolution paths run in sequence:

```
content_items.key_entities
        │
        ▼
  entity_resolver.py (Phase 1)
  ── upsert name → cvc.entities
        │
        ▼
  entity_resolver.py (Phase 2)
  ── difflib fuzzy match → companies.id
  ── "Sarcos Robotics" → Sarcos Corp (0.91)
        │
        ▼
  strategic_matcher_worker.py
  ── mxbai-embed-large embeddings (Ollama)
  ── pgvector cosine similarity → partners.id
  ── "Honeywell Aerospace" → Honeywell (0.94)
        │
        ▼
  weekly_delta.py compute_partner_momentum()
  ── partner mention trends → weekly briefing
```

---

## Components

### `entity_resolver.py`

**Phase 1 — Ingest**  
Scans every enriched `content_items` row for `key_entities.companies` (jsonb array). Normalizes each name (lowercase, strip corporate suffixes like "Inc", "LLC", "Corp") and upserts to `cvc.entities` with a mention count and last_seen timestamp.

**Phase 2 — Company Resolution**  
Runs difflib `SequenceMatcher` on normalized entity names against all `cvc.companies.name` values. Threshold: 0.85. On match, writes `company_id` + `match_confidence`.

Run manually:
```bash
CVC_DB_HOST=100.83.104.117 CVC_DB_PASSWORD=<db-password> \
PYTHONPATH=core python3 workers/briefing/entity_resolver.py
```

Flags: `--ingest-only`, `--resolve-only`, `--stats`

---

### `strategic_matcher_worker.py`

Resolves entity names to CVC's **corporate advisory partners** — the Walmarts, Honeywells, and Prologises that don't live in `cvc.companies`.

**Three phases:**
1. **Embed partners** — generate mxbai-embed-large (1024-dim) embeddings for all 36 partners, store in `cvc.partners.name_embedding`
2. **Embed entities** — generate embeddings for all unembedded entities, store in `cvc.entities.name_embedding`
3. **Match** — pgvector `CROSS JOIN` with `1 - (e.name_embedding <=> p.name_embedding)` cosine similarity; threshold 0.82; write `partner_id` + `partner_confidence`

**Model:** `mxbai-embed-large` via Ollama on Refinery (`localhost:11434`).  
**Why not nomic-embed-text:** Ollama 0.17.6 has a known bug where nomic-embed-text returns identical vectors for all inputs.

Run manually:
```bash
CVC_DB_HOST=100.83.104.117 CVC_DB_PASSWORD=<db-password> \
OLLAMA_URL=http://localhost:11434 \
PYTHONPATH=core python3 workers/briefing/strategic_matcher_worker.py
```

Flags: `--embed-only`, `--match-only`, `--stats`

---

### `weekly_delta.py` — Partner Momentum

`compute_partner_momentum()` queries the chain:
`content_items` → `key_entities.companies` → `cvc.entities` → `cvc.partners`

Returns partners with ≥2 current-week mentions AND either:
- New this week (no prior-week mentions), or
- ≥50% week-over-week growth

Output feeds into the weekly briefing's **PARTNER SIGNALS** section.

---

## DB Tables

### `cvc.entities`

| Column | Type | Notes |
|---|---|---|
| `name` | text | Original form from content |
| `name_normalized` | text | Normalized — UNIQUE key |
| `company_id` | integer | FK → companies (nullable) |
| `partner_id` | integer | FK → partners (nullable) |
| `mention_count` | integer | Cumulative across all content |
| `first_seen` / `last_seen` | timestamp | |
| `resolved` | boolean | company_id assigned |
| `match_confidence` | numeric(4,3) | Company resolution score |
| `name_embedding` | vector(1024) | mxbai-embed-large |
| `partner_confidence` | numeric(4,3) | Partner cosine similarity |

### `cvc.partners` — added columns

| Column | Notes |
|---|---|
| `name_embedding` | vector(1024) — mxbai-embed-large; used by strategic matcher |

---

## Thresholds

| Threshold | Value | Used In |
|---|---|---|
| Company resolution (difflib) | 0.85 | `entity_resolver.py` Phase 2 |
| Partner resolution (cosine) | 0.82 | `strategic_matcher_worker.py` Phase 3 |
| Partner momentum min mentions | 2 | `weekly_delta.py` |
| Partner momentum WoW growth | 50% | `weekly_delta.py` |

---

## Indexes

```sql
-- Fast partner-to-entity similarity lookup (HNSW)
idx_partners_name_embedding  ON cvc.partners USING hnsw (name_embedding vector_cosine_ops)

-- Lookup all entities linked to a given partner
idx_entities_partner_id      ON cvc.entities(partner_id) WHERE partner_id IS NOT NULL

-- Lookup all entities linked to a given company
idx_entities_company_id      ON cvc.entities(company_id) WHERE company_id IS NOT NULL
```

---

## Running Order (manual full refresh)

```bash
# 1. Ingest new entities from content
python3 workers/briefing/entity_resolver.py --ingest-only

# 2. Resolve entities to startups
python3 workers/briefing/entity_resolver.py --resolve-only

# 3. Embed everything + match to partners
python3 workers/briefing/strategic_matcher_worker.py

# 4. Check results
python3 workers/briefing/strategic_matcher_worker.py --stats
python3 workers/briefing/entity_resolver.py --stats
```

All three workers require `CVC_DB_HOST=100.83.104.117 CVC_DB_PASSWORD=<db-password> PYTHONPATH=core` when run from Refinery.
