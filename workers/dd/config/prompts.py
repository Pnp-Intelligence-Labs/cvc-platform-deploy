"""
prompts.py — All LLM prompt templates for the DD pipeline.
No prompts hardcoded in agent scripts — everything lives here.
"""

# ── Ingestion ─────────────────────────────────────────────────────────────────

DOC_TYPE_CLASSIFY = """You are classifying a document from a startup's data room.

Filename: {filename}
First 1000 characters of content:
{content_preview}

Classify this document as exactly one of:
- pitch_deck
- financial_model
- financial_statement
- cap_table
- legal_terms
- customer_contract
- investor_qa
- team_bio
- patent_ip
- unknown

Reply with only the classification label, nothing else."""


# ── News Agent ────────────────────────────────────────────────────────────────

NEWS_ANALYZE = """You are a venture capital analyst researching a startup for due diligence.
Your job: extract factual findings from web search results about {company}.

Below are web search results and page content gathered from multiple searches.
Extract all meaningful findings and return them as a JSON array of finding objects.

SEARCH RESULTS:
{search_text}

Return a JSON object with this exact structure:
{{
    "findings": [
        {{
            "id":          "news_001",
            "topic":       "funding",
            "claimed":     null,
            "our_finding": "Raised $120M Series B in January 2026 led by Andreessen Horowitz.",
            "delta":       null,
            "sources": [
                {{"title": "Dyna Robotics Raises $120M", "url": "https://techcrunch.com/...", "date": "2026-01"}}
            ],
            "verdict":     "no_claim",
            "confidence":  "high",
            "flag":        false,
            "flag_reason": null
        }}
    ],
    "summary": "3-5 sentence narrative of the news landscape for {company}. What is the market saying about them?"
}}

Topic labels to use:
- "funding"              — investment rounds, valuations
- "press_coverage"       — media articles, profiles
- "partnership"          — commercial partnerships, integrations
- "customer_win"         — named customer announcements
- "team_change"          — executive joins, departures, promotions
- "red_flag"             — lawsuits, controversies, pivots, negative press
- "incorporation_record" — public legal entity, state of incorporation, founding date; flag any discrepancy vs pitch deck claims
- "milestone_history"    — public milestones announced at or around prior funding rounds; cross-check against pitch deck narrative

Verdict rules:
- Use "no_claim"    for all news findings (nothing to reconcile against dataroom)
- Use "confirmed"   only if you can cross-reference two independent sources
- Use "not_found"   if a search returned nothing useful

Flag rules:
- flag=true + flag_reason required for: executive departures, lawsuits, pivots, fundraise not mentioned by founder,
  incorporation date or jurisdiction contradicts pitch deck, evidence of milestone not achieved that was publicly committed to
- flag=false for positive press, routine partnerships

Confidence:
- high   = named publication (TechCrunch, Reuters, Forbes, etc.)
- medium = company blog, PR Newswire, press release
- low    = inferred, social media, single indirect mention

ID format: news_001, news_002, ... (sequential)

Rules:
- Only include findings that appear in the search results. Do not invent.
- If nothing meaningful was found, return findings: [].
- Return valid JSON only. No markdown fences, no explanation."""


# ── Financials Agent — Pass 0: Detect business model ─────────────────────────

FINANCIALS_DETECT_MODEL = """You are a VC analyst identifying the business model of a startup from its pitch deck.

PITCH DECK CONTENT:
{text}

Classify the company into exactly one primary business model and return JSON:
{{
    "model_type":  "saas | usage_based | marketplace | ecommerce | hardware | moonshot_hardtech | enterprise_saas | other",
    "sub_type":    "e.g. 'vertical SaaS', 'B2B marketplace', 'hardware + recurring software', 'deep tech / robotics' — null if not applicable",
    "confidence":  "high | medium | low",
    "reasoning":   "1-2 sentences explaining why this classification was chosen",
    "benchmark_growth_target": "the appropriate growth benchmark — e.g. '>200% YoY or >10% MoM for SaaS', '>20% MoM for Marketplace'"
}}

Model type definitions:
- saas:              recurring software subscription, per-seat or per-user pricing
- enterprise_saas:   SaaS sold to enterprises with long sales cycles, ACV > $50K
- usage_based:       pricing tied to consumption/usage (API calls, data volume, transactions)
- marketplace:       connects buyers and sellers, earns take rate on GMV — value comes from liquidity and network effects, NOT from proprietary technology
- ecommerce:         direct product sales to end consumers online
- hardware:          physical product sales, may include software/services component — proven technology, primary risk is sales/distribution
- moonshot_hardtech: deep tech, robotics, biotech, aerospace — primary risk is technical (does the technology work?), value creation depends on R&D breakthroughs, not network effects
- other:             does not fit above categories

Tiebreaker rules:
- If the company builds robots, autonomous systems, novel sensors, or proprietary hardware with unproven technology → moonshot_hardtech, NOT hardware or marketplace
- If the company connects buyers/sellers but the core innovation is a physical or AI system → moonshot_hardtech, NOT marketplace
- Use marketplace ONLY if the primary business model is a take-rate on transactions between third parties

Return valid JSON only. No markdown fences, no explanation."""


# ── Financials Agent — Pass 2b: Extract model-specific metrics ────────────────

FINANCIALS_EXTRACT_MODEL_METRICS = """You are a VC analyst extracting business-model-specific financial metrics.

TODAY'S DATE: {today}
BUSINESS MODEL: {model_type}

FINANCIAL DOCUMENTS:
{text}

Based on the business model type above, extract the metrics most relevant to that model.
For each metric, include a "quote" field with the exact text from the document, or null if not found.

Return JSON with the fields that apply to this business model:

FOR saas / enterprise_saas:
{{
    "mrr":                  {{"value": null, "period": null, "quote": null}},
    "arr":                  {{"value": null, "period": null, "quote": null}},
    "gross_account_churn":  {{"value": "monthly % of accounts lost", "period": null, "quote": null}},
    "net_dollar_churn":     {{"value": "net revenue churn % — negative = expansion", "period": null, "quote": null}},
    "nrr":                  {{"value": "net revenue retention %", "period": null, "quote": null}},
    "ltv_cac_ratio":        {{"value": "LTV / paid CAC", "period": null, "quote": null}},
    "quick_ratio":          {{"value": "new MRR + expansion MRR / churned MRR + contraction MRR", "period": null, "quote": null}},
    "magic_number":         {{"value": "net new ARR / prior quarter S&M spend", "period": null, "quote": null}},
    "revenue_cmgr":         {{"value": "compound monthly growth rate %", "period": null, "quote": null}},
    "yoy_growth":           {{"value": "year-over-year revenue growth %", "period": null, "quote": null}}
}}

FOR usage_based:
{{
    "monthly_revenue":      {{"value": null, "period": null, "quote": null}},
    "revenue_cmgr":         {{"value": null, "period": null, "quote": null}},
    "dollar_net_expansion": {{"value": "dollar-based net expansion rate %", "period": null, "quote": null}},
    "ltv_cac_ratio":        {{"value": null, "period": null, "quote": null}},
    "yoy_growth":           {{"value": null, "period": null, "quote": null}}
}}

FOR marketplace:
{{
    "gmv":                      {{"value": "gross merchandise value", "period": null, "quote": null}},
    "net_revenue":              {{"value": null, "period": null, "quote": null}},
    "take_rate":                {{"value": "net revenue as % of GMV", "period": null, "quote": null}},
    "revenue_cmgr":             {{"value": null, "period": null, "quote": null}},
    "contribution_margin":      {{"value": "per order or per transaction", "period": null, "quote": null}},
    "buyer_retention":          {{"value": "% of buyers who return", "period": null, "quote": null}},
    "seller_retention":         {{"value": "% of sellers who stay active", "period": null, "quote": null}},
    "transaction_frequency":    {{"value": "avg transactions per buyer per period", "period": null, "quote": null}},
    "avg_transaction_value":    {{"value": null, "period": null, "quote": null}},
    "ltv_cac_ratio":            {{"value": null, "period": null, "quote": null}},
    "seller_ltv_sac_ratio":     {{"value": "seller LTV / paid seller acquisition cost", "period": null, "quote": null}}
}}

FOR hardware / moonshot_hardtech:
{{
    "units_sold":               {{"value": null, "period": null, "quote": null}},
    "avg_unit_price":           {{"value": null, "period": null, "quote": null}},
    "revenue":                  {{"value": null, "period": null, "quote": null}},
    "revenue_cmgr":             {{"value": null, "period": null, "quote": null}},
    "avg_transaction_value":    {{"value": null, "period": null, "quote": null}},
    "ltv_cac_ratio":            {{"value": null, "period": null, "quote": null}},
    "nwc_pct_revenue_change":   {{"value": "net working capital as % of change in sales", "period": null, "quote": null}},
    "technical_milestones":     ["list of technical milestones accomplished — moonshot only"],
    "sme_headcount":            {{"value": "total subject matter expert FTEs", "quote": null}}
}}

FOR ecommerce:
{{
    "total_visits":             {{"value": null, "period": null, "quote": null}},
    "unique_visitors":          {{"value": null, "period": null, "quote": null}},
    "conversion_rate":          {{"value": null, "period": null, "quote": null}},
    "revenue":                  {{"value": null, "period": null, "quote": null}},
    "revenue_cmgr":             {{"value": null, "period": null, "quote": null}},
    "customer_retention":       {{"value": null, "period": null, "quote": null}},
    "order_frequency":          {{"value": null, "period": null, "quote": null}},
    "avg_order_value":          {{"value": null, "period": null, "quote": null}},
    "ltv_cac_ratio":            {{"value": null, "period": null, "quote": null}},
    "nwc_pct_revenue_change":   {{"value": null, "period": null, "quote": null}}
}}

FOR other / unknown model type:
{{
    "revenue":       {{"value": null, "period": null, "quote": null}},
    "revenue_cmgr":  {{"value": null, "period": null, "quote": null}},
    "gross_margin":  {{"value": null, "period": null, "quote": null}},
    "burn_rate":     {{"value": null, "period": null, "quote": null}},
    "customer_count":{{"value": null, "period": null, "quote": null}},
    "yoy_growth":    {{"value": null, "period": null, "quote": null}}
}}

Only return the fields for the model type specified above.
If a metric cannot be found in the documents, set its value to null and quote to null — do not guess.
Return valid JSON only. No markdown fences, no explanation."""


# ── Financials Agent — Pass 1: Extract claims from pitch deck ─────────────────

FINANCIALS_EXTRACT_CLAIMS = """You are a VC analyst extracting financial claims made by a startup founder in their pitch deck.
Extract every financial metric or claim stated in the document.

PITCH DECK CONTENT:
{text}

Return a JSON object with every financial claim found:
{{
    "arr_mrr":        "e.g. '$10M ARR as of Q4 2025' — null if not stated",
    "growth_rate":    "e.g. '15% MoM revenue growth' — null if not stated",
    "burn_rate":      "e.g. '$400K/month' — null if not stated",
    "runway":         "e.g. '18 months' — null if not stated",
    "gross_margin":   "e.g. '72%' — null if not stated",
    "customer_count": "e.g. '6 enterprise customers' — null if not stated",
    "nrr":            "net revenue retention if stated — null if not stated",
    "ltv_cac":        "LTV/CAC ratio if stated — null if not stated",
    "raise_amount":   "how much they are raising — null if not stated",
    "valuation":      "pre-money valuation ask — null if not stated",
    "use_of_funds":   "how they plan to use capital — null if not stated",
    "other_claims":   ["any other specific financial figures or claims mentioned"],
    "source_notes":   "which slides or sections these came from"
}}

Rules:
- Quote the founder's exact language where possible
- If a metric is not mentioned anywhere, use null — do not guess
- Return valid JSON only. No markdown fences, no explanation."""


# ── Financials Agent — Pass 2: Extract actuals from financial model/statements ─

FINANCIALS_EXTRACT_ACTUALS = """You are a VC analyst extracting financial metrics from a startup's financial model and statements.

TODAY'S DATE: {today}

IMPORTANT: Distinguish carefully between actuals and projections.
- Actuals = historical figures with real dates in the past (revenue earned, cash spent, customers signed)
- Projections = forward-looking model outputs, forecasts, or targets

For early-stage companies (pre-seed, seed), there may be NO actuals — only a forward projections model.
If a document contains only projections, extract the projected figures but:
  1. Set "data_type" to "projection" (not "actual")
  2. Use TODAY'S DATE above to identify which model month/column corresponds to the present
  3. Do NOT present projections as if they represent current reality

GROUNDING RULE: For every number you report, you MUST include a "quote" field with the exact text from the document
that contains that number (copy the raw row or cell value). If you cannot find the exact text, set the value to null.
Do not report a number you cannot quote directly from the document.

FINANCIAL DOCUMENTS:
{text}

Extract the most recent actual figures, or projected figures if no actuals exist. Return JSON:
{{
    "data_type": "actual | projection | mixed | unknown — REQUIRED: are these real historical figures or model projections?",
    "actuals_available": true or false,
    "actuals_through": "latest date for which real historical data exists — null if none",
    "arr_mrr": {{
        "value":  "e.g. '$10.42M ARR' or '$504K MRR (Month 34 projection)'",
        "period": "e.g. 'December 2025 actual' or 'Month 34 of projection model (approx. Year 3)'",
        "source": "e.g. 'Revenue tab, row 14' or 'P&L sheet'",
        "quote":  "exact text copied from the document — e.g. '34  $504,000.00  $6,048,000.00  42'"
    }},
    "monthly_burn": {{
        "value":  "average monthly net burn",
        "period": "e.g. 'Q4 2025 average' or 'last 3 months'",
        "quote":  "exact text from document or null"
    }},
    "cash_balance": {{
        "value": "total cash on hand",
        "date":  "as of date",
        "quote": "exact text from document or null"
    }},
    "runway_months": {{
        "value":  "number of months",
        "method": "'calculated: cash/burn' or 'stated in model'"
    }},
    "gross_margin": {{
        "value":  "as a percentage",
        "period": "time period",
        "quote":  "exact text from document or null"
    }},
    "revenue_growth": {{
        "value":  "MoM or YoY %",
        "period": "time period",
        "type":   "MoM or YoY",
        "quote":  "exact text from document or null"
    }},
    "burn_multiple": {{
        "value":  "net burn / net new ARR — calculate if possible, else null",
        "notes":  "how calculated"
    }},
    "revenue_by_customer": [
        {{"customer": "name or anonymized", "amount": "ACV or annual revenue", "pct_of_total": "% of total revenue"}}
    ],
    "top_customer_concentration": "% of revenue from single largest customer",
    "hardware_software_split": "e.g. '30% hardware, 70% software' — null if not applicable",
    "opex_breakdown": {{
        "rd":    "R&D spend",
        "sm":    "Sales & Marketing spend",
        "ga":    "G&A spend",
        "other": "other significant line items"
    }},
    "headcount": {{
        "total":       "total employees",
        "by_function": "e.g. 'Engineering: 12, Sales: 4, Ops: 3' — null if not available"
    }},
    "deferred_revenue":   "balance if visible — null if not",
    "accounts_receivable": "balance and aging if visible — null if not",
    "path_to_profitability": "break-even revenue or timeline if modeled — null if not",
    "notes": "anything unusual, inconsistent, or worth flagging"
}}

Rules:
- If historical actuals exist, use them. Note the exact period (e.g. "Q4 2025 actual")
- If only a projections model exists, extract projected figures but label them clearly as projections with the model month/year
- NEVER present a projected figure as if it were a current actual — this is the most important rule
- If a metric cannot be found or calculated from the documents, use null
- Note the source (tab, sheet, row) where possible
- Return valid JSON only. No markdown fences, no explanation."""


# ── Financials Agent — Pass 3: Extract customer contracts ─────────────────────

FINANCIALS_EXTRACT_CONTRACTS = """You are a VC analyst reviewing customer contracts for a startup.
Extract every contract found in the documents.

CONTRACT DOCUMENTS:
{text}

Return a JSON array of all contracts found:
[
    {{
        "customer_name":   "company name",
        "contract_value":  "ACV (annual) or TCV (total)",
        "value_type":      "ACV or TCV",
        "contract_type":   "SaaS / service / hardware / pilot / LOI / other",
        "term_months":     "contract length in months — null if not stated",
        "start_date":      "YYYY-MM or null",
        "end_date":        "YYYY-MM or null",
        "auto_renew":      true or false or null,
        "status":          "signed / pilot / LOI / verbal",
        "notes":           "unusual terms, discounts, contingencies"
    }}
]

Return empty array [] if no contracts are found.
Return valid JSON only. No markdown fences, no explanation."""


# ── Financials Agent — Pass 4: Extract cap table ──────────────────────────────

FINANCIALS_EXTRACT_CAP_TABLE = """You are a VC analyst reviewing a startup's cap table.
Extract the ownership structure and key terms.

CAP TABLE:
{text}

Return JSON:
{{
    "total_shares_outstanding": "number or null",
    "fully_diluted_shares":     "including all options and warrants — null if not stated",
    "ownership": [
        {{
            "holder":       "name or role (e.g. 'CEO', 'Series A investors')",
            "type":         "founder / employee / investor / option_pool / warrant",
            "shares":       "number or null",
            "pct_basic":    "% of basic shares",
            "pct_diluted":  "% fully diluted",
            "round":        "which round this came from — null if not applicable"
        }}
    ],
    "option_pool": {{
        "total_pct":     "total option pool as % of fully diluted",
        "available_pct": "unissued/available options as % — null if not stated"
    }},
    "liquidation_preferences": "describe any liquidation preferences or participating preferred — null if none",
    "anti_dilution":           "describe anti-dilution provisions if present — null if none",
    "last_round": {{
        "round":     "e.g. 'Series A'",
        "amount":    "capital raised",
        "pre_money": "pre-money valuation",
        "post_money":"post-money valuation",
        "date":      "YYYY-MM"
    }},
    "total_raised_to_date": "cumulative capital raised across all rounds — null if not calculable",
    "notes": "anything unusual"
}}

Return valid JSON only. No markdown fences, no explanation."""


# ── Financials Agent — Pass 3b: Extract investor Q&A financial content ────────

FINANCIALS_EXTRACT_INVESTOR_QA = """You are a VC analyst extracting financially relevant information from a startup's investor Q&A document.

INVESTOR Q&A:
{text}

Extract only information relevant to financial due diligence. Return JSON:
{{
    "revenue_clarifications":  "any clarification on revenue figures, recognition, or timing — null if none",
    "customer_clarifications": "clarifications on customer count, churn, concentration — null if none",
    "burn_clarifications":     "clarifications on burn rate, runway, or cash position — null if none",
    "fundraise_details":       "raise amount, timing, use of funds, existing commitments — null if none",
    "unit_economics":          "any LTV, CAC, payback period, margin clarifications — null if none",
    "contract_pipeline":       "named customers, LOIs, pilots in progress — null if none",
    "financial_flags":         ["anything that contradicts or materially changes what the financial model shows"],
    "source_notes":            "which questions/answers these came from"
}}

If a field has no relevant information, set it to null — do not guess.
Return valid JSON only. No markdown fences, no explanation."""


# ── Financials Agent — Pass 5: Reconcile claims vs actuals → findings ─────────

FINANCIALS_RECONCILE = """You are a senior VC analyst at Claw Venture Capital (CVC) completing financial due diligence.
CVC focuses on pre-seed to Series A supply chain and industrial companies.
You have extracted claims from the founder's pitch deck and actuals from their financial documents.
Your job: reconcile them and produce structured findings for the IC.

COMPANY: {company}
BUSINESS MODEL: {business_model}
GROWTH BENCHMARK: {growth_benchmark}
PRE-REVENUE MODE: {pre_revenue}

FOUNDER CLAIMS (from pitch deck):
{claims}

ACTUAL FINANCIALS (from financial model/statements):
{actuals}

MODEL-SPECIFIC METRICS:
{model_metrics}

CUSTOMER CONTRACTS:
{contracts}

CAP TABLE:
{cap_table}

INVESTOR Q&A (financial clarifications):
{investor_qa}

Produce a JSON array of findings. Each finding must follow this exact schema:
{{
    "id":          "financials_001",
    "topic":       "arr",
    "claimed":     "what the founder stated — null if no claim was made",
    "our_finding": "what the documents actually show",
    "delta":       "the gap between claim and finding — null if they match or no claim",
    "sources":     [{{"title": "exact filename — e.g. 'Financial Model - Retina Robotics.xlsx', tab 'Revenue', row 12", "url": null, "date": "YYYY-MM"}}],
    "verdict":     "confirmed | contradicts_claim | unverified_claim | no_claim | not_found | projections_only",
    "confidence":  "high | medium | low",
    "flag":        true or false,
    "flag_reason": "why flagged — null if flag is false",
    "score":       0,
    "score_reason": "one sentence explaining what drove this score"
}}

IF PRE-REVENUE MODE IS "true" (moonshot_hardtech with no historical actuals):
Topics to cover — shift focus from revenue metrics to milestone and pipeline signals:
- technical_milestones  — what has been built/demonstrated vs claimed; TRL level
- contract_pipeline     — LOIs, pilots, named customers, total pipeline value
- burn_rate             — monthly burn vs stage and milestone progress
- runway                — calculated months remaining
- team_capability       — does the team have the technical depth to execute?
- cap_table             — ownership summary and any concerning terms
- valuation             — round ask vs comparable pre-revenue hardtech deals
- hardware_cost_path    — BOM, unit economics trajectory, path to target gross margin

IF PRE-REVENUE MODE IS "false" (revenue-stage company):
Topics to cover (create a finding for each):
- arr                   — annual recurring revenue vs claimed
- revenue_growth        — actual growth rate vs benchmark ({growth_benchmark})
- burn_rate             — actual monthly burn vs traction (is burn proportionate to progress?)
- runway                — calculated months of runway vs healthy threshold
- gross_margin          — actual margin vs model-type benchmark
- burn_multiple         — net burn / net new ARR
- revenue_concentration — top customer as % of revenue (see stage-aware rules below)
- customer_contracts    — summary of signed contracts and total contracted ARR
- cap_table             — ownership summary and any concerning terms
- valuation             — round ask vs implied metrics (ARR multiple, burn multiple)
- path_to_profitability — break-even timeline if modeled

SCORING RUBRIC:

arr / revenue_growth:
  +2 = confirmed, meets or exceeds GROWTH BENCHMARK
  +1 = confirmed, within 50% of benchmark
   0 = unverified or projections only
  -1 = below benchmark or contradicts claim materially
  -2 = contradicts claim by >50%, or near-zero traction vs aggressive claims

burn_rate:
  +1 = burn is proportionate to traction and stage (capital efficient)
   0 = burn is moderate or unclear
  -1 = high burn relative to traction (burn multiple 1.5-3x)
  -2 = very high burn with negligible traction (burn multiple >3x or not calculable)

runway:
  +2 = >18 months
  +1 = 12-18 months
  -1 = 9-12 months
  -2 = <9 months

gross_margin / hardware_cost_path (pre-revenue: score based on BOM trajectory and target margin credibility):
  +2 = meets model-type benchmark (SaaS/Usage ≥60%, Marketplace ≥50%, Hardware/Moonshot ≥30%, Ecomm ≥40%)
  +1 = within 15 points below benchmark, or credible path to ≥30% at scale for pre-revenue hardtech
   0 = unknown or projections only
  -1 = significantly below benchmark
  -2 = misleading (e.g., artificial 100% due to zero COGS, or negative margin with no path to positive)

burn_multiple:
  +2 = <1.0x
  +1 = 1.0-1.5x
   0 = 1.5-2.0x
  -1 = 2.0-3.0x
  -2 = >3.0x or not calculable due to negligible ARR

revenue_concentration (STAGE-AWARE — do not penalize early-stage companies for concentration):
  For companies with ≤3 customers: concentration is expected, do not flag unless 1 customer = 100%
  For companies with 4-10 customers:
    +1 = no single customer >40% of revenue
     0 = top customer 40-60%
    -1 = top customer >60% (flag)
  For companies with >10 customers:
    +1 = no single customer >20% of revenue
     0 = concentration unknown or borderline
    -1 = top customer >20% (flag)

customer_contracts / contract_pipeline:
  +2 = firm, material contracts with clear revenue recognition
  +1 = signed but contingent or early-stage; or strong LOI pipeline for pre-revenue
   0 = LOIs or MOUs only (non-binding)
  -1 = minimal or contradicts claimed partnerships
  -2 = contradicts claim materially (e.g., claimed $10M but only $130K contracted)

technical_milestones (pre-revenue hardtech only):
  +2 = demonstrated working prototype or pilot; TRL 5+
  +1 = proof of concept validated; clear path to TRL 5
   0 = early R&D, unclear milestone status
  -1 = milestones behind schedule or not demonstrated
  -2 = no verifiable technical progress; primary risk still unresolved

cap_table:
  +1 = clean, founder-friendly, no concerning terms
   0 = standard terms, minor notes
  -1 = onerous liquidation preferences, anti-dilution, or heavy control provisions

valuation:
  +1 = reasonable vs sector comps given stage
   0 = unclear or insufficient data
  -1 = aggressive vs comps (>2x sector median multiple)
  -2 = unsupported by any metric or contradicts financials

path_to_profitability / hardware_cost_path:
  +1 = credible model with clear break-even milestones or BOM reduction path
   0 = general narrative, no detailed model
  -1 = no path shown or path is dependent on unproven assumptions

If a topic is not_found or projections_only, use score=0.

Flag rules:
- flag=true if: score <= -1 on any metric, burn multiple > 1.5x,
  liquidation preferences are onerous, runway < 12 months
- flag=true if growth rate is below the GROWTH BENCHMARK for this business model type
- flag=true if actuals_available=false for a revenue-stage company — note "All financials are forward projections; no historical actuals provided"
- flag=true for revenue concentration only per the stage-aware rules above
- Always include a flag_reason explaining what IC should ask about

Verdict rules:
- confirmed:          claim matches actuals within 10%
- contradicts_claim:  actuals materially differ from claim (>10% or directionally wrong)
- unverified_claim:   founder made a claim but it cannot be found in the documents
- no_claim:           we found a metric the founder did not mention
- not_found:          neither claimed nor found in documents
- projections_only:   financial model contains only forward projections with no historical actuals

Also return:
- "summary": 3-5 sentence narrative of the financial picture
- "financial_score": {{"total": <sum of all finding scores>, "max_possible": 17, "section_scores": {{"growth": <arr+revenue_growth scores>, "efficiency": <burn_rate+burn_multiple scores>, "durability": <runway score>, "unit_economics": <gross_margin+revenue_concentration scores>, "deal_structure": <customer_contracts+cap_table+valuation scores>, "path_to_profit": <path_to_profitability score>}}}}

Return JSON object:
{{
    "findings": [...],
    "summary": "narrative",
    "financial_score": {{...}}
}}

Return valid JSON only. No markdown fences, no explanation."""


# ── Product Agent — Pass 1b: Tech assessment scoring ─────────────────────────

PRODUCT_TECH_ASSESSMENT = """You are a VC technical due diligence analyst scoring a startup's engineering practices.
You are reading answers the founder provided to a technical questionnaire (investor Q&A).
Apply the scoring rubric below and produce structured findings with numeric scores.

COMPANY: {company}

INVESTOR Q&A / TECHNICAL QUESTIONNAIRE:
{text}

For each category below, find the relevant answer in the documents and apply the point value.
If the question was not answered, use score=0 and verdict="not_found".

SCORING RUBRIC:

CODE HISTORY
- All software coded in-house (except open source/APIs): +3
- Non-core parts outsourced: +1
- Core parts outsourced: -1
- Everything outsourced: -10
- Initial developer is no longer main developer: -5
- Built a similar product before: +2
- No single points of failure in codebase: +2 | Single point known only by developer WITH equity: -1 | WITHOUT equity: -2

AGILITY
- Continuous deployment / release cadence unknown: +5 | Monthly releases: 0 | 5x/year: -3 | 1x/year: -5
- Build vs buy decision: evaluates engineering hours to build AND maintain vs buy: +2 | evaluates build hours only: -1 | builds everything first: -5 | buys first: 0
- Payment system: 3rd party (Stripe, Braintree, etc.): 0 | custom in-house: -10
- Clients paying outside payment system: -2
- Invoicing: 3rd party: 0 | custom in-house: -5

MONITORING
- Application performance monitored: +1
- Application security monitored: +1
- Infrastructure performance monitored: +1
- Website monitoring: +1
- Exception monitoring: +1
- Internally developed monitoring (vs 3rd party): -2
- Max system capacity measured: +2

COMPLIANCE & SECURITY
- 3rd party data: licensed: 0 | crawled non-critical: -1 | crawled critical: -2
- Library/open-source license monitoring: +1 | server/desktop only: 0 | not monitored: -2
- Version control backed up to 3rd party: +2
- Database disaster recovery: 0% data loss possible: +5 | 50% loss possible: -5 | 100% loss: -10
- Disaster recovery plan exists: +1

PRODUCT DEVELOPMENT & PROCESSES
- Version control: cloud hosted (GitHub): +2 | local only: +1 | none: -20
- Unit tests: critical routines only: +5 | 100% coverage: -1 | none: -5
- Code reviews: critical routines only: +5 | all code: -1 | none: -5
- One-click deploy to staging/production: +2 | no: -5
- Feature flags system: +2 | no: -3
- Can show features to limited users without hardcoding: +2 | no: -3
- Hosting: mix of IaaS (not locked in): +1 | single IaaS: 0 | PaaS only: -1
- No heavy cron jobs: 0 | has heavy cron jobs: -2
- Queueing system between jobs: +3 | no queueing: -3
- 3rd party providers with less funding than company: none: 0 | some: -1 | all: -5

TECH ORGANIZATION
- Roadmap owned by CPO: +5 | CEO: +2 | CTO: -5
- CTO speaks with customers weekly (calls): +5 | weekly (tickets): +2 | never: -5
- Tech team speaks with customers weekly: +2 | CTO only: -2 | never: -5
- Power users available for feedback: +2
- Roadmap visible to everyone including customers: +2 | everyone internally: 0 | tech team only: -3 | only leadership: -4 | in founder's head: -5

TECH FOUNDER LEADERSHIP
- Founder can convincingly pitch: +5 | cannot: -5
- Last customer conversation: this week: +3 | this month: +1 | >1 month: -1 | never: -10
- Product roadmap written 6 months ahead: +2 | 1 month: +1 | >12 months: +1 | no written plan: -5
- Engineering values written down: +2

HIRING
- All developers worked for founder before: +3 | most: +2 | some: +1 | none: -1
- All developers have equity: +3 | most: +2 | some: +1
- All new hires from referrals: +3 | most: +2 | some: +1 | none: -1
- Interview includes team interview: +1 | coding during interview: +1
- Reference calls include backdoor references: +5 | provided references only: 0 | never: -10

PEOPLE MANAGEMENT
- Team attrition last year: none: 0 | some: -5 | all: -10
- Reason for leaving: lack of motivation: -5 | salary: -1
- 1:1 frequency: daily: +3 | weekly: +2 | monthly: -2 | never: -10

Produce a JSON object:
{{
    "findings": [
        {{
            "id":          "product_tech_001",
            "topic":       "code_history | agility | monitoring | compliance | processes | tech_org | leadership | hiring | people_mgmt",
            "claimed":     "the founder's answer from the Q&A — null if not answered",
            "our_finding": "what the answer implies about engineering quality",
            "delta":       null,
            "sources":     [{{"title": "exact filename + location", "url": null, "date": null}}],
            "verdict":     "confirmed | unverified_claim | not_found",
            "confidence":  "high | medium | low",
            "flag":        true or false,
            "flag_reason": "why flagged — null if flag is false",
            "score":       0
        }}
    ],
    "section_scores": {{
        "code_history":  {{"score": 0, "max_possible": 12}},
        "agility":       {{"score": 0, "max_possible": 10}},
        "monitoring":    {{"score": 0, "max_possible": 8}},
        "compliance":    {{"score": 0, "max_possible": 11}},
        "processes":     {{"score": 0, "max_possible": 22}},
        "tech_org":      {{"score": 0, "max_possible": 19}},
        "leadership":    {{"score": 0, "max_possible": 18}},
        "hiring":        {{"score": 0, "max_possible": 18}},
        "people_mgmt":   {{"score": 0, "max_possible": 8}}
    }},
    "total_score":     0,
    "max_possible":    126,
    "summary": "2-3 sentences on the overall engineering quality and key risks surfaced"
}}

Flag rules:
- flag=true if score for any individual question is <= -5
- flag=true if section score is negative
- flag=true if version control is absent (-20), or disaster recovery is 100% loss (-10)
- flag=true if 1:1s are never held, or reference calls are never done

If the investor Q&A does not address a category at all, skip it — do not invent answers.
Return valid JSON only. No markdown fences, no explanation."""


# ── Product Agent — Pass 1: Extract product/tech claims from pitch + Q&A ───────

PRODUCT_EXTRACT_CLAIMS = """You are a VC analyst extracting product and technology claims from a startup's pitch deck and investor Q&A.
Your focus: what technology does the company have, how mature is it, and what do they claim makes it defensible?

DOCUMENTS (pitch deck + investor Q&A):
{text}

Return a JSON object with every product and technology claim found:
{{
    "product_description": "what the product does — one clear sentence",
    "product_category":    "e.g. 'robotics software', 'SaaS platform', 'hardware + software system'",
    "maturity_stage":      "claimed stage — e.g. 'live with 6 enterprise customers', 'beta', 'prototype', 'R&D'",
    "core_technology":     ["each distinct piece of core technology claimed — e.g. 'proprietary computer vision model', 'novel actuator design'"],
    "differentiation":     ["claimed technical advantages over alternatives — quote exact language where possible"],
    "ip_claims":           ["any patents filed, granted, or trade secrets mentioned"],
    "build_components":    "what is built in-house vs. what uses open-source/COTS — null if not addressed",
    "data_moat":           "any proprietary dataset or data flywheel claim — null if not mentioned",
    "integrations":        ["key third-party systems, APIs, or platforms the product integrates with"],
    "hardware_involved":   true or false,
    "regulatory_claims":   ["any certifications, compliance claims, or regulatory approvals mentioned"],
    "technical_risks_acknowledged": ["any technical risks or challenges the founder acknowledges"],
    "roadmap_claims":      ["major features or milestones claimed on the product roadmap"],
    "customer_evidence":   ["any product validation claims — pilots, case studies, performance metrics"],
    "source_notes":        "which slides or sections these came from"
}}

Rules:
- Quote the founder's exact language for differentiation and IP claims
- If a field is not mentioned anywhere, use null or [] — do not guess
- Return valid JSON only. No markdown fences, no explanation."""


# ── Product Agent — Pass 2: Extract IP summary from patent documents ───────────

PRODUCT_EXTRACT_IP = """You are a VC analyst reviewing patent filings and IP documentation for a startup.
Extract the key IP assets and assess their scope and strength.

PATENT / IP DOCUMENTS:
{text}

Return a JSON object summarizing the IP position:
{{
    "patents": [
        {{
            "title":        "patent title or description",
            "number":       "patent number if granted — null if application only",
            "status":       "granted | pending | provisional | abandoned",
            "filed_date":   "YYYY-MM or null",
            "granted_date": "YYYY-MM or null",
            "jurisdiction": "e.g. 'US', 'US + PCT', 'EU'",
            "claims_summary": "what the patent covers in plain English",
            "strength":     "broad | narrow | unclear — your assessment of claim breadth"
        }}
    ],
    "trade_secrets":   ["any trade secrets described or implied"],
    "total_filed":     "total number of patents filed",
    "total_granted":   "total number of patents granted",
    "key_ip_summary":  "2-3 sentence plain-English summary of the overall IP position",
    "notes":           "anything unusual — gaps, weak claims, competitor overlap"
}}

Return valid JSON only. No markdown fences, no explanation."""


# ── Product Agent — Pass 3: Reconcile claims vs research → findings ─────────────

PRODUCT_RECONCILE = """You are a senior VC analyst at Claw Venture Capital (CVC) completing product and technology due diligence.
You have extracted product/IP claims from the founder's documents and gathered independent research.
Your job: assess the claims and produce structured findings for the IC.

COMPANY: {company}

FOUNDER PRODUCT/TECH CLAIMS (from pitch deck + investor Q&A):
{claims}

IP SUMMARY (from patent documents — may be empty if no patents provided):
{ip_summary}

INDEPENDENT RESEARCH (from web):
{web_research}

Produce a JSON array of findings. Each finding must follow this exact schema:
{{
    "id":          "product_001",
    "topic":       "product_maturity",
    "claimed":     "what the founder stated — null if no claim was made",
    "our_finding": "what the documents and research actually show",
    "delta":       "the gap between claim and finding — null if they match or no claim",
    "sources":     [{{"title": "exact filename + location — e.g. 'RRB25-01p draft patent app.pdf, page 4' or 'Pitch_VC - Retina Robotics.pptx, slide 7'", "url": "url or null", "date": "YYYY-MM or null"}}],
    "verdict":     "confirmed | contradicts_claim | unverified_claim | no_claim | not_found",
    "confidence":  "high | medium | low",
    "flag":        true or false,
    "flag_reason": "why flagged — null if flag is false",
    "score":       null
}}

Topics to cover (create a finding for each):
- product_maturity        — is the claimed development stage consistent with evidence (customers, demos, metrics)?
- technical_differentiation — are the core tech claims credible and meaningfully differentiated vs. alternatives?
- ip_moat                 — strength and breadth of patent portfolio; is the moat real or thin?
- build_vs_buy            — is the technology genuinely proprietary or primarily assembled from open-source/COTS?
- technical_risk          — what major technical hurdles remain; is the risk acknowledged or hidden?
- scalability             — does the architecture/design support the scale implied by the business model?
- product_market_fit      — is there concrete evidence the product works for customers (not just claims)?
- tech_stack              — what technology stack and infrastructure is implied by job postings, engineering blog, or product descriptions; does it suggest a defensible architecture or commodity components?
- feature_comparison      — how does the product's stated feature set compare to direct competitors based on public information (websites, demos, reviews); is the differentiation real or marketing?
- technical_milestones    — for hardware/deep-tech: what are the key remaining technical milestones; are they acknowledged in the pitch or glossed over?

Flag rules:
- flag=true if: product stage is overstated vs evidence, no IP protection in a patent-heavy space,
  core technology is replicable commodity (open-source or easily replicated), major unacknowledged
  technical risk, hardware involved with no manufacturing partner named, customer evidence is only
  from pilots with no revenue, regulatory approval required but not mentioned,
  tech stack appears entirely commodity with no custom IP layer, feature set appears undifferentiated
  vs publicly available competitor information
- Always include a flag_reason explaining what IC should probe

Verdict rules:
- confirmed:          claim is supported by documents/research
- contradicts_claim:  research materially contradicts the founder's claim
- unverified_claim:   founder made a claim but nothing verifies or refutes it
- no_claim:           we found something relevant the founder did not address
- not_found:          no relevant data found in either documents or research

Also return a "summary" key with a 3-5 sentence narrative of the product and technology picture.

Return JSON object:
{{
    "findings": [...],
    "summary": "narrative"
}}

Return valid JSON only. No markdown fences, no explanation."""


# ── Qualitative Agent — Pass 1b: Org assessment (preliminary diligence checklist) ──

QUALITATIVE_ORG_ASSESSMENT = """You are a VC analyst completing preliminary organizational due diligence on a startup.
You are reading the founder's pitch deck, team bios, and investor Q&A responses.
Your job: extract structured answers to the preliminary diligence checklist and produce findings.

COMPANY: {company}

DOCUMENTS (pitch deck + team bios + investor Q&A):
{text}

Extract answers to the following checklist and produce findings. For each item, note what was found
and flag if the answer is concerning, missing, or suggests risk.

CHECKLIST SECTIONS:

GENERAL
- Incorporation date and jurisdiction
- Entity type (C-Corp, LLC, other) — flag if not C-Corp (complicates VC investment)
- Equity ownership breakdown: founders %, employees %, option pool %, investors %
- Full-time employee count (excluding founders)
- Part-time employee count
- Headcount by function (engineering, sales, ops, etc.)

CUSTOMER TRACTION
- How long has the product been in-market?
- Active pilot count (not yet paying)
- Paying customer count + ACV for each if stated
- Revenue model and pricing structure
- What is required to increase ACV?
- Growth blockers — what is preventing faster growth?

FUNDRAISING HISTORY
- Total capital raised to date (all rounds combined)
- Per-round detail: round name, amount, pre-money valuation or cap, date
- Key milestones achieved with each round of capital
- Named existing investors
- Are existing investors participating in the current round?
- Current round size being raised
- Forward milestone event chart with capital needs (if provided)

For each checklist item produce a finding:
{{
    "id":          "qualitative_org_001",
    "topic":       "entity_type | equity_structure | headcount | customer_traction | fundraising_history | growth_blockers | milestones",
    "claimed":     "the answer found in the documents — null if not addressed",
    "our_finding": "assessment of what this means for the investment",
    "delta":       null,
    "sources":     [{{"title": "exact filename + location", "url": null, "date": null}}],
    "verdict":     "confirmed | unverified_claim | not_found",
    "confidence":  "high | medium | low",
    "flag":        true or false,
    "flag_reason": "why flagged — null if flag is false",
    "score":       null
}}

Flag rules:
- flag=true if entity is not a C-Corp (VC standard)
- flag=true if option pool is not established or < 10% fully diluted
- flag=true if founders hold < 60% combined going into this round
- flag=true if no paying customers after 12+ months in market
- flag=true if growth blocker is fundamental (product-market fit, not operational)
- flag=true if prior capital was raised but milestones are not documented
- flag=true if existing investors are NOT participating in the current round (negative signal)
- flag=true if any checklist section has no answer at all (gap in investor materials)

Return JSON object:
{{
    "findings": [...],
    "checklist_coverage": {{
        "general":            "complete | partial | missing",
        "customer_traction":  "complete | partial | missing",
        "fundraising_history":"complete | partial | missing"
    }},
    "summary": "2-3 sentences on org health, traction stage, and fundraising history"
}}

If a section has no information at all, produce one finding for the entire section with verdict="not_found" and flag=true.
Return valid JSON only. No markdown fences, no explanation."""


# ── Qualitative Agent — Pass 1: Extract team claims from pitch + bios + Q&A ────

QUALITATIVE_EXTRACT_CLAIMS = """You are a VC analyst extracting team and founder information from a startup's pitch deck, team bios, and investor Q&A.
Your focus: who are these people, what have they done, and what do they claim qualifies them to win this market?

DOCUMENTS (pitch deck + team bios + investor Q&A):
{text}

Return a JSON object capturing everything stated about the team:
{{
    "founders": [
        {{
            "name":            "full name",
            "title":           "role at company — e.g. 'CEO & Co-Founder'",
            "background":      "claimed prior experience — companies, roles, duration",
            "prior_exits":     ["any prior startup exits, acquisitions, or IPOs claimed"],
            "domain_expertise": "specific expertise relevant to this company's market",
            "education":       "degrees, institutions — null if not stated",
            "notable_roles":   ["any notable prior roles — e.g. 'VP Engineering at Palantir', 'Army Ranger'"],
            "linkedin":        "LinkedIn URL if provided — null if not"
        }}
    ],
    "key_hires": [
        {{
            "name":       "name if given",
            "title":      "role",
            "background": "relevant prior experience"
        }}
    ],
    "team_size":       "total headcount claimed",
    "team_composition": "e.g. '70% engineering, 20% ops, 10% sales' — null if not stated",
    "missing_roles":   ["any key roles the founder acknowledges as open or needed"],
    "advisors": [
        {{
            "name":        "advisor name",
            "affiliation": "their current role/company",
            "relevance":   "why they are relevant to this company"
        }}
    ],
    "investors":       ["named existing investors or angels if mentioned"],
    "prior_capital_raised": "total capital raised before this round — null if not stated",
    "founder_motivation": "why this team / why now — their own words",
    "source_notes":    "which slides or sections these came from"
}}

Rules:
- Quote the founder's exact language for claims about background and motivation
- If a field is not mentioned anywhere, use null or [] — do not guess
- Return valid JSON only. No markdown fences, no explanation."""


# ── Qualitative Agent — Pass 2: Reconcile claims vs web research → findings ────

QUALITATIVE_RECONCILE = """You are a senior VC analyst at Claw Venture Capital (CVC) completing team and founder due diligence.
You have extracted the founder's self-reported background and gathered independent web research.
Your job: verify the claims and produce structured findings for the IC.

COMPANY: {company}

FOUNDER/TEAM CLAIMS (from pitch deck + bios + investor Q&A):
{claims}

INDEPENDENT RESEARCH (from web — LinkedIn, news, prior companies):
{web_research}

Produce a JSON array of findings. Each finding must follow this exact schema:
{{
    "id":          "qualitative_001",
    "topic":       "founder_background",
    "claimed":     "what the founder stated — null if no claim was made",
    "our_finding": "what independent research shows",
    "delta":       "the gap between claim and finding — null if they match or no claim",
    "sources":     [{{"title": "exact filename + location — e.g. 'RRB25-01p draft patent app.pdf, page 4' or 'Pitch_VC - Retina Robotics.pptx, slide 7'", "url": "url or null", "date": "YYYY-MM or null"}}],
    "verdict":     "confirmed | contradicts_claim | unverified_claim | no_claim | not_found | access_blocked",
    "confidence":  "high | medium | low",
    "flag":        true or false,
    "flag_reason": "why flagged — null if flag is false",
    "score":       null
}}

Topics to cover (create a finding for each):
- founder_background    — does web research confirm the claimed roles, companies, and tenures?
- founder_track_record  — prior startup outcomes (exits, acquisitions, failures, notable wins); search results for prior companies should be used here to verify or find outcomes the founder did not mention
- domain_expertise      — is the team's expertise genuinely relevant to this specific market and problem?
- team_completeness     — are there critical gaps (technical co-founder, sales lead, domain expert)?
- advisor_network       — are the named advisors credible and genuinely engaged, or logo-drops?
- execution_risk        — any red flags: short tenures, public failures, conflicting commitments, background gaps
- capital_deployment    — have they previously raised and deployed institutional capital responsibly?
- thought_leadership    — does any team member have published research, conference presentations, patents, or recognized authority in the field; does external credibility match the domain claim?
- team_turnover         — is there evidence of co-founder departures, early employee attrition, or LinkedIn departure patterns suggesting culture or execution risk?
- stage_fit             — is the team's collective background appropriate for the current stage; are there skill gaps that become critical at the next stage (e.g., scaling operators, enterprise sales, manufacturing expertise)?

Flag rules:
- flag=true if: claimed role or company cannot be verified (verdict=unverified_claim, not access_blocked), tenure at key company was <12 months,
  prior startup failed with controversy, no technical co-founder for a deep-tech company,
  advisor appears to have no real relationship with the company, founder has active legal issues,
  key claimed credential appears embellished or unverifiable, evidence of co-founder departure
  not disclosed in the pitch, team lacks any published credibility for a deep technical claim,
  no scaling operator on the team as company approaches growth stage
- Always include a flag_reason explaining what IC should probe or verify directly

Verdict rules:
- confirmed:          web research confirms the claim
- contradicts_claim:  research materially contradicts the founder's stated background
- unverified_claim:   founder made a claim; we accessed the source (LinkedIn, etc.) but could not verify the specific claim
- access_blocked:     we attempted to verify but the source (LinkedIn, company website, etc.) blocked access — note which source was blocked
- no_claim:           we found something relevant the founder did not address
- not_found:          no relevant data found in either documents or research

Also return a "summary" key with a 3-5 sentence narrative of the team's strengths, gaps, and overall quality signal.

Return JSON object:
{{
    "findings": [...],
    "summary": "narrative"
}}

Return valid JSON only. No markdown fences, no explanation."""


# ── Comp Agent — Pass 1: Extract market claims from pitch deck + investor Q&A ──

COMP_EXTRACT_CLAIMS = """You are a VC analyst extracting market and competitive claims made by a startup founder.
Extract every claim about market size, competitive positioning, and differentiation.

DOCUMENTS (pitch deck + investor Q&A):
{text}

Return a JSON object with every market/competitive claim found:
{{
    "sector":            "the specific industry/vertical this company operates in — e.g. 'warehouse robotics', 'construction AI'",
    "tam":               "total addressable market claim — e.g. '$50B global warehouse automation market' — null if not stated",
    "tam_source":        "who they cite for TAM — e.g. 'Gartner 2024', 'internal estimate' — null if not stated",
    "sam":               "serviceable addressable market — null if not stated",
    "som":               "serviceable obtainable market — null if not stated",
    "market_growth":     "claimed market growth rate — e.g. '18% CAGR through 2028' — null if not stated",
    "named_competitors": ["list of competitors the founder explicitly names"],
    "competitive_positioning": "how the founder describes their position vs competition — their own words",
    "differentiation":   ["each distinct moat or differentiator claimed — e.g. 'proprietary sensor fusion', '10x faster deployment'"],
    "target_customer":   "who they sell to — industry, size, role — null if not stated",
    "go_to_market":      "how they acquire customers — null if not stated",
    "valuation_comps":   "any comparables or multiples the founder references to justify valuation — null if not stated",
    "why_now_claims":    "why does the founder believe now is the right time for this company — macro, tech, or regulatory catalyst — null if not stated",
    "incumbent_solution":"what do target customers currently use before this product — the status quo being displaced — null if not stated",
    "buyer_profile":     "who makes the purchase decision — role, company size, budget owner — null if not stated",
    "other_claims":      ["any other competitive or market claims"],
    "source_notes":      "which slides or sections these came from"
}}

Rules:
- Quote the founder's exact language where possible
- If a metric is not mentioned anywhere, use null — do not guess
- Return valid JSON only. No markdown fences, no explanation."""


# ── Comp Agent — Pass 2: Reconcile claims vs market research → findings ────────

COMP_RECONCILE = """You are a senior VC analyst at Claw Venture Capital (CVC) completing competitive and market due diligence.
You have extracted the founder's market claims and gathered independent web research.
Your job: reconcile them and produce structured findings for the IC.

COMPANY: {company}

FOUNDER CLAIMS (from pitch deck + investor Q&A):
{claims}

INDEPENDENT MARKET RESEARCH (from web):
{web_research}

CVC PROPRIETARY COMPARABLE COMPANIES (from CVC deal database — 1,534 tracked companies):
{db_comps}

Produce a JSON array of findings. Each finding must follow this exact schema:
{{
    "id":          "comp_001",
    "topic":       "tam_sam_som",
    "claimed":     "what the founder stated — null if no claim was made",
    "our_finding": "what independent research shows",
    "delta":       "the gap between claim and finding — null if they match or no claim",
    "sources":     [{{"title": "exact filename + location — e.g. 'RRB25-01p draft patent app.pdf, page 4' or 'Pitch_VC - Retina Robotics.pptx, slide 7'", "url": "url or null", "date": "YYYY-MM or null"}}],
    "verdict":     "confirmed | contradicts_claim | unverified_claim | no_claim | not_found",
    "confidence":  "high | medium | low",
    "flag":        true or false,
    "flag_reason": "why flagged — null if flag is false",
    "score":       null
}}

Topics to cover (create a finding for each):
- tam_sam_som           — claimed market size vs independent research; note if founder's TAM is plausible or inflated
- competitive_landscape — who are the real players in this space; flag major competitors the founder did not mention
- market_timing         — is the market actually growing; tailwinds, headwinds, adoption curve
- differentiation       — are the moat/differentiator claims credible; how do competitors compare on those dimensions
- valuation_benchmarks  — what are comparable companies raising at; reference CVC's proprietary comps above; what ARR multiple does this ask imply vs sector norms
- go_to_market          — is the GTM strategy realistic given the competitive landscape
- why_now               — what specific macro/tech/regulatory catalysts make this the right moment; is there a forcing function or is timing speculative?
- barriers_to_entry     — how defensible is the market position; how hard is it for a well-funded competitor to replicate this in 2-3 years?
- customer_profile      — who are the real buyers; what is the decision-maker role, budget authority, and typical buying process; does the founder's GTM match actual procurement dynamics?
- displacement_analysis — what do customers currently use; what are the switching costs and incumbent advantages; is the status quo actually painful enough to displace?
- market_structure      — is this market emerging, fragmented, or mature/consolidated; what does that imply for growth ceiling, margin pressure, and competitive dynamics?
- adjacency_markets     — what adjacent verticals or use cases could this expand into; are there natural land-and-expand opportunities or pivot risks if core market is smaller than claimed?

Flag rules:
- flag=true if: TAM claim is >2x what independent sources suggest, a major competitor is absent from the pitch,
  market is contracting or facing strong headwinds, valuation ask implies >3x sector median ARR multiple,
  differentiation claims are generic or easily replicated, no credible path to the stated SOM,
  no identifiable forcing function or "why now" catalyst, switching costs from incumbent appear low,
  market is mature/consolidated and barriers for this entrant are not clearly articulated
- Always include a flag_reason explaining what IC should probe

Verdict rules:
- confirmed:          claim is supported by independent sources within reasonable range
- contradicts_claim:  independent research materially contradicts the founder's claim
- unverified_claim:   founder made a claim but web research found nothing to verify or refute it
- no_claim:           we found something relevant the founder did not address
- not_found:          no relevant data found in either the pitch or web research

Also return a "summary" key with a 3-5 sentence narrative of the market and competitive picture.

Return JSON object:
{{
    "findings": [...],
    "summary": "narrative"
}}

Return valid JSON only. No markdown fences, no explanation."""


# ── Overview Bot — Pass 1: Cross-agent signal detection ───────────────────────

OVERVIEW_CROSS_SIGNALS = """You are a senior VC analyst at Claw Venture Capital (CVC).
You have completed specialist due diligence across five dimensions for {company}.
Your job: identify patterns that span multiple agents — compounding risks, reinforcing signals, and contradictions.

SPECIALIST AGENT SUMMARIES AND FLAGS:

FINANCIALS:
{financials_summary}
Flags: {financials_flags}

MARKET & COMPETITIVE (COMP):
{comp_summary}
Flags: {comp_flags}

TEAM & FOUNDERS (QUALITATIVE):
{qualitative_summary}
Flags: {qualitative_flags}

PRODUCT & TECHNOLOGY:
{product_summary}
Flags: {product_flags}

NEWS & PRESS:
{news_summary}
Flags: {news_flags}

Identify cross-agent signals. A signal is only meaningful if it involves findings from at least 2 different agents.

Return a JSON array of signal objects:
[
    {{
        "signal_type":      "compounding_risk | reinforcing | contradiction",
        "severity":         "red | yellow | green",
        "agents_involved":  ["financials", "comp"],
        "finding_ids":      ["financials_003", "comp_002"],
        "headline":         "10-15 word summary — e.g. 'High burn + crowded market narrows path to breakeven'",
        "narrative":        "2-3 sentences explaining why these signals together matter more than either alone"
    }}
]

Signal type definitions:
- compounding_risk:  two or more flags from different agents pointing to the same underlying risk
- reinforcing:       two or more positive signals from different agents supporting the bull case
- contradiction:     a claim confirmed by one agent but contradicted by another

Severity:
- red:    material risk to the investment thesis — IC must address before proceeding
- yellow: worth probing but not thesis-breaking on its own
- green:  strong positive signal that supports the investment case

Only return signals that are genuinely cross-agent. Do not restate single-agent flags.
Return valid JSON array only. No markdown fences, no explanation."""


# ── Overview Bot — Pass 2: IC memo synthesis ──────────────────────────────────

OVERVIEW_SYNTHESIZE = """You are a senior VC analyst at Claw Venture Capital (CVC) writing an IC memo.
You have completed full due diligence on {company}. Synthesize everything into a structured IC memo.

SPECIALIST SUMMARIES:
Financials: {financials_summary}
Market/Comp: {comp_summary}
Team: {qualitative_summary}
Product: {product_summary}
News: {news_summary}

SCORECARD:
{scorecard}

CROSS-AGENT SIGNALS:
{cross_signals}

CONSOLIDATED FLAGS (all agents):
{all_flags}

Produce the IC memo as a JSON object with this exact structure:
{{
    "one_liner":    "one sentence — what the company does, for whom, and the core value prop",
    "stage":        "e.g. 'Series A', 'Seed', 'Pre-Seed'",
    "raise_amount": "how much they are raising — from financials if available",
    "valuation_ask":"pre-money valuation ask — from financials if available",
    "sector":       "specific vertical — e.g. 'warehouse robotics software'",

    "key_metrics": {{
        "arr":            "most recent ARR or MRR figure",
        "revenue_growth": "MoM or YoY growth rate",
        "burn_rate":      "monthly net burn",
        "runway":         "months of runway",
        "gross_margin":   "gross margin %",
        "burn_multiple":  "net burn / net new ARR"
    }},

    "investment_thesis": "2-3 sentences — the bull case. Why would CVC want to own this company?",

    "section_summaries": {{
        "financials": "2-3 sentences on financial health, growth, and key metrics",
        "market":     "2-3 sentences on market size, timing, and competitive position",
        "team":       "2-3 sentences on founder quality, track record, and team gaps",
        "product":    "2-3 sentences on tech differentiation, IP, and product maturity",
        "news":       "1-2 sentences on press coverage and external signals"
    }},

    "ic_questions": [
        {{
            "question":      "specific, direct question for the IC meeting",
            "context":       "one sentence on why this question matters",
            "source_agents": ["which agents surfaced this"],
            "finding_ids":   ["specific finding IDs that triggered this question"],
            "priority":      "high | medium | low"
        }}
    ],

    "outlier_risks": {{
        "top_failure_reasons": [
            "1-sentence reason 1 — the most likely way this investment fails",
            "1-sentence reason 2",
            "1-sentence reason 3"
        ],
        "market_obsolescence_threats": [
            "1-sentence threat 1 — what technology, regulatory shift, or market force could make this company irrelevant",
            "1-sentence threat 2"
        ]
    }},

    "recommendation": "strong_interest | proceed | conditional | pass",
    "recommendation_rationale": "3-5 sentences explaining the recommendation. Reference specific findings. Be direct.",

    "summary": "4-6 sentence narrative for the top of the memo — company overview, where they are, what we found, and where we land"
}}

IC question rules:
- High priority: derived from red flags or red cross-agent signals
- Medium priority: derived from yellow flags or unverified claims
- Low priority: derived from no_claim findings worth exploring
- Each question must reference at least one finding_id
- Questions should be specific enough to ask in a 30-minute IC meeting

Recommendation rules:
- strong_interest: clean across all dimensions, no red flags, thesis is compelling
- proceed:         1-2 yellow flags, thesis intact, continue diligence
- conditional:     red flag(s) present but addressable — proceed only if specific conditions are met
- pass:            fundamental issues with thesis, team, or financials that cannot be resolved

Return valid JSON only. No markdown fences, no explanation."""
