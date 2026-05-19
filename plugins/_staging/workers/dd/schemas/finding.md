# Finding Schema — DD Pipeline Data Contract

Every specialist agent writes a single JSON file to `workdir/[company]/agents/[agent].json`.
The Overview bot reads all five and synthesizes them.

---

## Agent Output Envelope

```json
{
    "company":  "Dyna Robotics",
    "date":     "2026-03-04",
    "agent":    "news",
    "status":   "complete",
    "findings": [ ...Finding ],
    "flags":    [ ...Finding ],
    "summary":  "Narrative paragraph for this agent's domain.",
    "meta": {
        "docs_read":       0,
        "sources_searched": 5,
        "total_seconds":   45
    }
}
```

### `status` values
| Value | Meaning |
|-------|---------|
| `complete` | Agent ran fully, findings are reliable |
| `partial` | Agent ran but some data was missing or searches failed |
| `failed` | Agent could not run (missing docs, API error, etc.) |

---

## Finding Object

```json
{
    "id":          "news_001",
    "topic":       "funding",
    "claimed":     null,
    "our_finding": "Raised $120M Series B in January 2026 led by Andreessen Horowitz.",
    "delta":       null,
    "sources": [
        {
            "title": "Dyna Robotics Raises $120M Series B",
            "url":   "https://techcrunch.com/...",
            "date":  "2026-01"
        }
    ],
    "verdict":     "no_claim",
    "confidence":  "high",
    "flag":        false,
    "flag_reason": null
}
```

### Field reference

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | `[agent]_[NNN]` — e.g. `financials_003` |
| `topic` | string | Human-readable label for this finding |
| `claimed` | string \| null | What the founder claimed (from pitch deck / Q&A). Null for discovery findings. |
| `our_finding` | string | What CVC found independently |
| `delta` | string \| null | The gap between claim and finding. Null if no claim or no gap. |
| `sources` | array | List of `{title, url, date}` objects |
| `verdict` | string | See verdicts table below |
| `confidence` | string | `high` / `medium` / `low` |
| `flag` | boolean | `true` = needs IC attention |
| `flag_reason` | string \| null | Why it's flagged. Required if `flag: true`. |

### `verdict` values
| Value | When to use |
|-------|-------------|
| `confirmed` | We found the same as what was claimed |
| `contradicts_claim` | Our finding materially differs from the claim |
| `unverified_claim` | Founder made a claim we couldn't verify |
| `no_claim` | Discovery finding — not in the dataroom, found via research |
| `not_found` | We searched but found nothing on this topic |

---

## Per-Agent Topics

Each agent uses a consistent set of `topic` labels for grouping in the Overview.

### News
`funding` · `press_coverage` · `partnership` · `customer_win` · `team_change` · `red_flag`

### Financials
`arr` · `revenue_growth` · `burn_rate` · `runway` · `gross_margin` · `customer_contracts` · `cap_table` · `valuation`

### Comp
`direct_competitor` · `market_size` · `market_share` · `competitive_moat` · `recent_competitor_funding`

### Qualitative
`founder_background` · `team_depth` · `relevant_experience` · `prior_exits` · `advisory_board` · `red_flag`

### Product
`core_technology` · `defensibility` · `ip_patents` · `product_stage` · `tech_risk`

---

## Overview Bot consumption

The Overview bot:
1. Loads all 5 agent output files
2. Collects `flags` across all agents for the "IC Attention" section
3. Groups findings by verdict to build the reconciliation table
4. Uses each agent's `summary` as a starting point for the executive narrative

---

## Example: claim vs finding (Financials)

```json
{
    "id":          "financials_001",
    "topic":       "arr",
    "claimed":     "$10M ARR (pitch deck, slide 8)",
    "our_finding": "$10.42M ARR per signed contracts in financial model (tab: Revenue)",
    "delta":       "+$420K above stated figure — slight understatement",
    "sources": [
        {"title": "Financial Model Q4 2025", "url": null, "date": "2025-12"}
    ],
    "verdict":     "confirmed",
    "confidence":  "high",
    "flag":        false,
    "flag_reason": null
}
```

## Example: discovery finding (News)

```json
{
    "id":          "news_002",
    "topic":       "red_flag",
    "claimed":     null,
    "our_finding": "Co-founder David Chen departed in October 2025. No public explanation given.",
    "delta":       null,
    "sources": [
        {"title": "LinkedIn profile — David Chen", "url": "https://linkedin.com/...", "date": "2025-10"}
    ],
    "verdict":     "no_claim",
    "confidence":  "medium",
    "flag":        true,
    "flag_reason": "Undisclosed co-founder departure. Ask team for context before IC."
}
```
