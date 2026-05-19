# CVC Proprietary Intelligence Framework (v2026.2)

**Status:** Active — applies to all companies selected for full intelligence profiling
**Scope:** Industrial technology companies (Robotics, Manufacturing, Logistics, Defense, Semiconductors, Energy)
**Tiers:** 4D Enrichment (taxonomy) + Industrial Alpha (execution signals)

---

## 1. Integrity & Verification Standards

### Zero-Hallucination Policy

- **Missing data** — if a protocol, certification, or sourcing claim cannot be found in public technical documentation or verified signals, the field MUST be `null` or `"Insufficient Data"`. Never interpolate.
- **No competitor inference** — do not assume a company supports a protocol because its competitors do.
- **Null is a valid finding** — a null sovereignty score or empty cert list signals low technical transparency. Report it honestly; it is actionable information for Nate and the Partners.

### Reference & Endnote Requirement

Every scored field in a company profile or report must be backed by a citation.

- **Format:** Bracketed endnotes `[1]`, `[2]` linked to a Sources section at the bottom of every profile or report output.
- **Source weighting:**
  - **Primary (high weight):** Technical docs, product manuals, job boards, SEC filings, patent databases
  - **Secondary (lower weight):** News articles, press releases, analyst summaries

If a score is derived from a secondary source only, note it explicitly.

---

## 2. Tier 1 — 4D Enrichment (Taxonomy)

**Managed by:** Phase 1 enrichment (`enrich_worker.py`)
**Model:** `qwen/qwen3-235b-a22b-2507` via OpenRouter
**Full spec:** `docs/4D_TAXONOMY.md`

| Dimension | Classes | Strategic Use |
|---|---|---|
| **Environment** | Structured_Indoor, Unstructured_Outdoor, Aerial, Subsea_Underground, Virtual_Simulated, Environment_Agnostic | Filters for ruggedization requirements |
| **Function** | Manipulation, Mobility, Perception, Cognition, Human_Collaboration, Infrastructure | Identifies technical moat and capability set |
| **Stack Layer** | Component, Subsystem, Solution, Platform, Intelligence, Ops | Determines value chain position |
| **Biz Model** | Hardware_OEM, SaaS, RaaS, Integration_Consulting, Data_Analytics, Marketplace, Research_Lab | Predicts margin profile and scaling capital intensity |

---

## 3. Tier 2 — Industrial Alpha (Execution Signals)

**Managed by:** Phase 3 enrichment (`enrich_industrial.py`)
**Agent:** Sharp Claw (Scrapling + Brave Search + `qwen/qwen3-235b-a22b-2507`)
**Full spec:** `docs/INDUSTRIAL_SCORING.md`

### A. Integration Friction Score (X-Axis) — Weighted 0–10

Starts at 10. Deducts points for **verified** signals found in `/docs` or `/support` pages only.

| Signal | Deduction | Notes |
|---|---|---|
| OPC-UA or MQTT | −3.0 | Modern OT-IT standard — highest interop value |
| Native PLC drivers | −2.0 | Direct Siemens S7 or Rockwell ControlLogix hooks |
| ROS2 or VDA 5050 | −1.5 | Robotics interop standard |
| Public API / SDK | −1.5 | Self-serve integration capability |
| Modbus / legacy protocols | −1.0 | Brownfield compatibility |

**Floor: 0.** Maximum deduction is capped — a company cannot score below 0.
A score of 10 means no standard integration signals were found (not necessarily that they don't exist).

### B. Industrial Readiness Score (Y-Axis) — 1–10

| Range | Label | Criteria |
|---|---|---|
| 1–3 | Lab / R&D | No field-certified hardware, simulation or prototype stage, no safety certs |
| 4–6 | Pilot Ready | Basic certifications in progress or achieved, actively hiring Field Technicians |
| 7–8 | Production Ready | ISO 10218 or ISO 3691 certs verified, Commissioning staff on payroll, named customer deployments |
| 9–10 | Scale | Standardized product line, verified high MTBF data, multi-site operational deployments |

### C. Sovereignty Score (Bubble Color) — 1–10

Analyzes HQ location, foundry/manufacturing partners, Bill of Lading data, and TAA/NDAA compliance statements.

| Range | Color | Criteria |
|---|---|---|
| 8–10 | Green | Allied-sourced, TAA-compliant, US or Five Eyes manufacturing stated |
| 4–7 | Yellow | Domestic assembly but risky sub-component sourcing, no explicit compliance statement |
| 1–3 | Red | Critical path dependency on non-allied nations, China-manufactured core components |
| null | Gray | Insufficient sourcing data found |

---

## 4. The CVC Matrix — Composite Score

$$\text{Composite Score} = (\text{Readiness} \times 0.4) + (\text{Sovereignty} \times 0.3) + ((10 - \text{Friction}) \times 0.3)$$

The friction term is inverted so that lower friction = higher contribution to the composite.

| Composite Range | Label | Action |
|---|---|---|
| 7.5–10 | **Integration King** | Pilot Now — surface to Partners immediately |
| 5.0–7.4 | **Watchlist** | Monitor — revisit at next funding event or cert milestone |
| < 5.0 | **Pilot Purgatory** | Avoid — too much friction, sovereignty risk, or deployment immaturity |

---

## 5. Dashboard Requirements

**Component:** `IndustrialMatrix.tsx` — `/app/industrial`

- **Scatter plot:** Friction (X) vs. Readiness (Y), bubble sized by funding, colored by sovereignty tier
- **Geopolitical heatmap:** Secondary view — country-level concentration of sovereignty scores across the portfolio
- **Hover tooltips:** Every score display must show the specific source URL or document snippet that backs it (`[Endnote]` format)
- **Null handling:** All components must render `"Data Unavailable"` for null fields — never default null to zero, as zero implies a finding was made

---

## 6. Activation

This framework applies **only to companies explicitly selected by Nate or the Partners** for full intelligence profiling — not auto-applied to all 1,667 companies in the DB.

Trigger via:
```bash
# Single company — full framework
PYTHONPATH=core venv/bin/python3 workers/enrichment/enrich_industrial.py --company "Company Name" --deep-scan-pdfs

# Batch — top N by funding, industrial sectors only
PYTHONPATH=core venv/bin/python3 workers/enrichment/enrich_industrial.py --limit 20 --deep-scan-pdfs
```

---

## 7. Implementation Status

| Component | Status |
|---|---|
| 4D taxonomy (24 values, 4 axes) | Live — 1,534 / 1,667 companies classified |
| Phase 3 enrichment worker | Live — 54 companies scored |
| Basic friction score (protocol count) | Live — `api/routes/industrial.py` |
| **Weighted friction score (v2026.2)** | Pending — task #52 |
| **Composite score calculation** | Pending — task #52 |
| **Endnote / source citation system** | Pending — task #52 |
| Industrial Matrix scatter plot | Live — `/app/industrial` |
| **Null → "Data Unavailable" rendering** | Pending — task #52 |
| **Hover source tooltips** | Pending — task #52 |
| **Geopolitical heatmap** | Pending — task #52 |
| Bill of Lading data integration | Future — not yet scoped |
