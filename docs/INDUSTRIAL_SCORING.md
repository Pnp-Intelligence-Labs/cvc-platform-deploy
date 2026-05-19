# Industrial Alpha Scoring Methodology

**Owner:** Sharp Claw (research enrichment)
**Populated by:** `workers/enrichment/enrich_industrial.py` — Phase 3 enrichment
**Applies to:** Companies where `sector IN ('Robotics', 'Manufacturing', 'Energy', 'Logistics', 'Defense', 'Semiconductors')`
**DB columns:** `cvc.companies` — migration `029_industrial_alpha.sql`

---

## Scores

### Industrial Readiness Score (1–10)

Composite score measuring how ready a company is for a partner pilot or production deployment — not how interesting it is as an investment.

| Range | Meaning |
|---|---|
| 8–10 | Proven field deployments, standard industrial protocols, verified safety certs, commercial-grade hardware |
| 5–7 | Pilot-stage traction, partial protocol support, some certs pending or in progress |
| 1–4 | Lab-only or simulation stage, custom/proprietary API only, no certifications found |

**Inputs:** docs page content, careers page, company description, PDF datasheets (deep scan mode)

**What raises the score:**
- Named customer deployments or case studies
- Standard protocol support (OPC-UA, ROS2, MQTT, EtherNet/IP, Modbus)
- Verified safety certifications (ISO 10218-1/2:2025, UL 1741, IEC 61508, ISO 26262)
- Field/deployment/commissioning roles in hiring
- Ruggedized or IP-rated product variants

**What lowers the score:**
- R&D or simulation-only job postings
- No certifications found after deep scan
- Proprietary API with no standard industrial bridge
- "Coming soon" or beta language on core product pages

---

### Sovereignty Score (1–10)

Geopolitical resilience score. Measures TAA/NDAA compliance, supply chain sourcing, and friend-shoring posture. Used to flag companies suitable for defense/government partner pilots.

| Range | Meaning | Dashboard Color |
|---|---|---|
| 8–10 | Explicit TAA/NDAA compliance stated, US or allied-nation manufacturing, no risky single-source dependencies | Green |
| 4–7 | Allied-sourced or mixed sourcing, no explicit compliance statement | Amber |
| 1–3 | China-manufactured core components, no compliance data, risky single-source dependency | Red |
| null | Insufficient data found | Gray |

**Inputs:** product footers, legal pages, technical specs, news (foundry/tape-out mentions), PDF datasheets

**What raises the score:**
- "TAA-compliant" or "NDAA-compliant" stated explicitly in docs
- "Made in USA" or allied-nation manufacturing for core hardware
- Named US/EU foundry partners
- Defense/government contracts as referenced customers

**What lowers the score:**
- Core silicon or hardware manufactured in China
- Single-source dependency on a non-ally supplier
- No sourcing information available at all (scores null, not 1)

---

### Friction Score (0–10) — Calculated, not stored

Measures how hard it is to integrate this company's product into existing factory or defense infrastructure. Derived in the API at query time from `protocol_support`.

**Formula:** `max(0, 10 − count_of_standard_protocols_supported)`

Standard protocols recognized: `OPC-UA`, `ROS2`, `MQTT`, `EtherNet/IP`, `Modbus`, `Profinet`, `Modbus TCP`, `DDS`, `EtherCAT`

| Friction | Meaning |
|---|---|
| 0–3 | Low friction — supports 7+ standard protocols, integrates easily with most factory setups |
| 4–6 | Medium friction — partial interop, likely needs middleware or gateway |
| 7–10 | High friction — proprietary API, minimal standard protocol support |

*This score is not stored in the DB. It is computed in `api/routes/industrial.py:calc_friction()` at request time.*

---

### Deployment Signal Level

Categorical signal derived from hiring patterns and product language. Not a numeric score.

| Level | Signal |
|---|---|
| `Lab-Stage` | R&D/simulation roles only, no field references, prototype-phase language |
| `Pilot` | 1–5 customer pilots visible, some field roles, cautious commercial language |
| `Scaling` | Active field hiring (commissioning, FSO, deployment engineers), named multi-site deployments |
| `Operational` | Full commercial rollout, ops/support infrastructure hiring, recurring revenue signals |

**Primary indicator:** ratio of `Field/Deployment` roles to `R&D/Software` roles in job postings.

---

## Verified Certs

Only certifications explicitly named in a document are recorded. Sharp Claw does not infer certs from product descriptions.

**Recognized certs:**
- `ISO 10218-1/2:2025` — Industrial robot safety
- `ISO 26262` — Automotive functional safety
- `UL 1741` — Grid-connected energy systems
- `IEC 61508` — Functional safety of E/E/PE systems
- `MIL-STD-810` — Environmental durability (defense)
- `IP65/67/69K` — Ingress protection ratings
- Any TAA/NDAA compliance certification

---

## High Alpha Signal

A boolean flag set by the LLM during enrichment. Triggers a Telegram alert to Nate when `true`.

**Conditions that set high_alpha = true:**
- 5+ field/deployment roles posted recently (hiring surge)
- New geographic market expansion visible in job postings
- Surprise certification achievement (e.g. first ISO cert for a pre-Series B)
- New partnership or customer announcement involving a Tier-1 industrial player

---

## Data Sources (by priority)

1. Company `/docs` or `/developers` page — protocol support, integration specs
2. Company `/careers` page — deployment signal, hiring ratio
3. Brave Search fallback — when Scrapling returns no useful content
4. PDF datasheets and cert documents — deep scan mode (`--deep-scan-pdfs`)
5. ProxyCurl LinkedIn — not used in batch; DD-only

---

## Running Phase 3 Enrichment

```bash
# Single company
PYTHONPATH=core venv/bin/python3 workers/enrichment/enrich_industrial.py --company "Vecna Robotics"

# Batch (top N by total funding, skips already-enriched)
PYTHONPATH=core venv/bin/python3 workers/enrichment/enrich_industrial.py --limit 50

# Deep scan — also fetches cert PDFs and datasheets
PYTHONPATH=core venv/bin/python3 workers/enrichment/enrich_industrial.py --limit 50 --deep-scan-pdfs
```

Skips companies where `industrial_readiness_score IS NOT NULL`.
Model: `qwen/qwen3-235b-a22b-2507` via OpenRouter.
Sends Telegram summary on completion. High alpha anomalies are alerted individually.

---

## Dashboard

`/app/industrial` — Industrial Intelligence Matrix (React + Recharts)

- **X-axis:** Friction Score (lower = easier to integrate)
- **Y-axis:** Industrial Readiness Score
- **Bubble size:** Total funding from `cvc.funding_rounds`
- **Bubble color:** Sovereignty tier (green/amber/red/gray)
- **Click a bubble:** Opens Sovereignty & Hardening card with protocols, certs, integration notes
- **Sidebar:** Filter by sector
