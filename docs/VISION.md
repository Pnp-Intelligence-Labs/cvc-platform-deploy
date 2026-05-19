# Producer — Platform Vision

**Bloomberg for Startups.**
Pre-seed to Series B. Every signal. Every company. Every sector.

> This document is the north star for all autonomous development.
> BigBossHog reads this to know what to build next.
> Nate updates this when the strategy evolves.

*March 2026 | INTERNAL | Living Document*

---

## 1. The Product

Producer is a startup and technology intelligence platform built by Claw Venture Capital. It tracks the companies, the capital, the technology, and the people reshaping supply chain, industrials, robotics, physical AI, semiconductors, and aerospace and defense from pre-seed through Series B.

The user who opens Producer should immediately understand three things: CVC knows this market deeply, CVC tracks what others miss, and the data behind CVC's recommendations is real, sourced, and current.

**What it is not:** It is not a CRM. It is not a deal tracker with a search bar bolted on. It is not a static database that gets updated quarterly. It is a living intelligence system that gets smarter every day as new signals flow in, new companies are profiled, and new relationships are mapped.

**The Bloomberg comparison:** Bloomberg did not win because it had more data than Reuters. It won because every data point connected to every other data point, and the user could move from a stock price to the earnings transcript to the analyst consensus to the news feed to the competitor comparison in one flow. Producer does the same thing for the startup and technology landscape.

---

## 2. Who Uses It

### 2.1 Nate (Daily Operations)

The command center. Every signal, every company, every pipeline, every system metric in one place. When a startup raises a Series A in warehouse robotics, Nate should know within 24 hours: who they are, how they score against CVC's framework, which advisory members would care, and whether they fit the Fund II thesis.

### 2.2 Corporate Advisory Members (25+ Fortune 500)

SVP and C-level operators at the world's largest supply chain, manufacturing, and technology companies. They pay for CVC's accelerator programs to find startups that solve their problems. They need to see what is happening in their sectors, which companies are gaining traction, and where the technology is heading. They need to trust that CVC's intelligence is deeper than what they could find on Crunchbase or PitchBook.

### 2.3 Fund II LPs

Institutional investors evaluating or committed to CVC's $50M Fund II. They need to see that CVC's investment decisions are backed by proprietary data, that the portfolio is tracked rigorously, and that the intelligence infrastructure is a real competitive advantage, not a pitch deck claim.

---

## 3. What the User Sees

Every page should feel like opening the Bloomberg terminal for the first time: dense with signal, easy to navigate, and immediately useful. No empty states. No placeholder text. If a page exists, it has real data.

### 3.1 Startup Profiles

This is the core of the product. Every company in the database should have a profile page that a partner or LP could open and immediately understand the business.

**What a profile includes today** (from CSV + enrichment): Company name, one-liner, description, website, HQ city, country, sector, subsector, stage, employee count, founded year, total raised, investors, verticals, tags, hardware/software flag, composite score and sub-scores, enrichment status.

**What a profile should include (target state):**

- **Overview:** One-paragraph summary of what the company does, written by the enrichment pipeline, not copied from their website. Clear, opinionated, CVC's perspective on why this company matters or does not.
- **4D Classification:** Environment, Function, Stack, Business Model. Displayed visually. Shows where this company sits in the landscape relative to competitors.
- **Scoring:** All five dimensions (Commercial Velocity, Technical Maturity, Capital Efficiency, Market Timing, Partner Fit) with the composite score. Each dimension has a brief rationale, not just a number.
- **Funding timeline:** Every known round with date, amount, lead investor, and co-investors. Visualized as a timeline, not just a table.
- **Recent signals:** Latest news, content items, podcast mentions, patent filings, and job postings linked to this company. Sorted by recency. Shows that CVC is actively tracking them.
- **Competitive context:** Other companies in the same 4D cell or subsector, with comparative scores. The user should immediately see where this company ranks.
- **Partner relevance:** Which advisory members operate in the same sector and might be interested. This is the startup-to-corporate matching layer.
- **CVC assessment (future):** When DD has been run, the profile links to the investment scorecard. Non-public information, meeting notes, and internal analysis. Visible only to Nate, not partners or LPs.

**The principle:** A startup profile on Producer should contain more actionable information than what a VC analyst could compile in a full day of research. That is the bar.

### 3.2 Sector Intelligence Pages

One page per sector (supply chain, robotics, industrial automation, physical AI, semiconductors, aerospace and defense). Each sector page is a live market map.

**What a sector page shows:**

- **Market overview:** What is happening in this sector right now. Written narrative, updated weekly from the content engine and trend pipeline. Not a static paragraph — a living summary.
- **Heat indicators:** Funding velocity (total capital deployed in the last 90 days), deal count, new company entries, patent activity. These are the vital signs of the sector.
- **Company landscape:** All companies in this sector from the database, sortable by score, stage, funding, and recency. Filterable by 4D dimensions.
- **Funding activity:** Recent rounds in this sector with amounts, investors, and what it signals about market direction.
- **Key signals:** The most important content items, podcast insights, patent filings, and earnings mentions from the last 30 days. Curated by the content engine, not a raw dump.
- **Trends:** What is accelerating, what is cooling, what is emerging. Derived from the trend pipeline and signal detection. Links to the quarterly trend report when available.

**The principle:** An advisory member should be able to open their sector page and in 60 seconds understand what changed this week, which companies are gaining momentum, and what they should be paying attention to.

### 3.3 News and Content Feed

A curated, always-fresh feed of intelligence across all sectors. Not an RSS reader. Every item is enriched with sector tags, company links, and a CVC-generated summary that explains why it matters.

- Filterable by sector, signal type (funding, patent, earnings, editorial, podcast), and recency
- Each item links to the relevant company profiles and sector pages
- Podcast insights are highlighted as premium content (expert perspectives not available elsewhere)
- The Monday Morning Briefing is the flagship weekly synthesis, prominently featured

---

## 4. Startup Data Model

Every startup in the database goes through a data lifecycle. The goal is to move every company from raw CSV entry to fully enriched, scored, and connected profile.

### 4.1 Data Lifecycle

- **Ingested:** Raw CSV import. Name, website, one-liner, basic metadata. This is the starting point for most companies.
- **Enriched:** LLM-processed. Sector, subsector, stage, employee count, description rewritten, 4D classification applied, verticals and tags assigned. The company now has structured, searchable data.
- **Scored:** Five-dimension scoring applied. Commercial Velocity, Technical Maturity, Capital Efficiency, Market Timing, Partner Fit. Composite score calculated. The company can now be ranked and compared.
- **Connected:** Linked to funding rounds, content items, patent filings, job postings, and competitor relationships. The company exists in context, not isolation.
- **Assessed (optional):** Full DD has been run. Investment scorecard, red flag analysis, and internal notes attached. This stage is reached only for companies in active evaluation.

### 4.2 Enrichment Quality

The enrichment pipeline is what turns a CSV row into an intelligence asset. Quality standards for enrichment:

- **Description:** Must be CVC's own assessment, not the company's marketing copy. What do they actually do, what is their technology, and what stage are they at.
- **4D Classification:** Must be validated against the taxonomy, not guessed. If the classification is uncertain, flag it for review rather than assigning a wrong tag.
- **Searchability:** Tags, verticals, and sector assignments must support the queries that partners and Nate actually run: *"show me all warehouse robotics companies at Series A or later with a composite score above 60."*
- **Market context:** The enrichment should capture enough context that a user reading the profile understands the company's position without needing to visit their website.

### 4.3 Market Opportunity Metrics (future enrichment)

Beyond company-level scoring, each startup should eventually be enriched with market-level context:

- **TAM/SAM indicators:** What is the addressable market for this company's product category. Derived from industry reports, earnings transcripts, and CVC's own analysis.
- **Competitive density:** How many companies in the database occupy the same 4D cell. High density signals a crowded market. Low density signals either an emerging space or a niche.
- **Corporate demand signals:** How many advisory members operate in this company's sector. Are any of them actively evaluating solutions in this category. This is proprietary data.
- **Funding trajectory:** Is capital flowing into this category (heating) or slowing down (cooling). Derived from the funding rounds table aggregated by 4D cell over time.

---

## 5. The Content Engine

Producer's credibility depends on being current. If the latest news on a sector page is three weeks old, the platform looks dead. The content engine is what keeps Producer alive.

### 5.1 What We Collect

| Source Type | What It Gives Us | Frequency | Status |
|---|---|---|---|
| RSS Feeds | Industry news, editorials, product launches | Daily | ✅ LIVE |
| Podcast Transcripts | Expert insights, market predictions, technology deep-dives | Weekly | ✅ LIVE |
| Company News | Press releases, partnership announcements, product updates | Daily | ✅ LIVE |
| Research Papers | Academic and industry research relevant to tracked sectors | Weekly | ✅ LIVE |
| Funding Rounds | Who raised, how much, from whom. Essential for financial profiles. | Weekly | ❌ EMPTY |
| Patent Filings | Technical investment signals, competitive IP positioning | Monthly | ⚠️ THIN |
| Job Postings | Growth proxy, strategic direction (what roles are they hiring) | Weekly | ⚠️ THIN |
| Earnings Transcripts | Public company demand signals for technology adoption | Quarterly | ⚠️ THIN |
| Partner Meeting Notes | What challenges corporates face, what solutions they want. Proprietary. | Ongoing | 🔲 NOT STARTED |
| Founder Meeting Notes | DD interview data, validated technical claims. Proprietary. | Ongoing | 🔲 NOT STARTED |

**The non-public information advantage:** Anyone can scrape RSS feeds and funding announcements. What makes Producer different is the proprietary data layer: meeting notes from 25+ Fortune 500 partners describing their technology needs, founder interviews with validated technical claims, and pilot outcome data. This is the information that Crunchbase, PitchBook, and CB Insights do not have and cannot get.

### 5.2 Content Quality

Every content item that enters Producer is enriched before it reaches a user:

- **Sector tagging:** Which of CVC's sectors does this item relate to. Multi-tag supported.
- **Company linking:** Which companies in the database are mentioned or relevant. Auto-linked.
- **Signal classification:** What type of signal is this (funding, partnership, product launch, regulatory, market shift). Helps with filtering.
- **CVC summary:** A 2-3 sentence summary written by the enrichment pipeline that explains why this item matters in CVC's context. Not a generic abstract.

---

## 6. Build Priorities

**This section is what BigBossHog reads when deciding what tasks to create.** Items are ordered by impact. BigBossHog works top-down, creating tasks for the highest-priority unfinished item first.

### Priority 1: Make the Existing Pages Real

The platform has 10 live pages but several have empty or placeholder data. Filling these gaps is the highest-impact work because it turns demo pages into usable intelligence.

- **Startup profiles:** Enrich remaining ~20% of companies. Every company should have sector, subsector, 4D classification, description, and composite score. No blank profiles.
- **Partners table:** Load the 25+ corporate advisory members with company name, sector focus, primary contact name/title, and relationship status. The Partner Portal cannot function without this.
- **Funding rounds:** Decide on data source (Crunchbase API, CSV import, or public announcement scraping) and build the initial loader. Startup profiles without funding data are incomplete.
- **Signal collectors:** The trend_report tables for hiring, patents, and earnings are empty or near-empty. Build or fix the weekly collectors so sector pages have live data.
- **LP portal real data:** Replace hardcoded Fund I stats with actual numbers derived from the database. Show real portfolio sector distribution.
- **Score all companies:** Run score_refresh until every enriched company has a composite score. Unscored companies cannot be ranked or compared.

### Priority 2: Make Profiles and Sectors Best-in-Class

Once the data gaps are filled, improve the quality and depth of what the platform shows.

- **Profile page redesign:** Startup profiles should feel like opening a Bloomberg equity page. Overview, scoring with rationale, funding timeline visualization, recent signals, competitive context, and partner relevance all on one page.
- **Sector page narrative:** Each sector page needs a weekly-updated written overview of what is happening, not just tables and numbers. The content engine generates this from recent signals and trend data.
- **Company comparison tool:** Side-by-side comparison of 2-4 companies across all scoring dimensions, funding, and 4D positioning. Essential for deal evaluation and partner presentations.
- **Search and filtering:** Advanced filtering by sector, stage, score range, 4D dimensions, enrichment status, funding range, and geography. The user should be able to find exactly the companies they care about in seconds.
- **Startup-to-corporate matching:** When a company is scored, auto-identify which advisory members would be interested based on sector overlap and stated priorities.

### Priority 3: Build the Intelligence Layer

Move from displaying data to generating insight. This is where Producer becomes something no other platform offers.

- **Relationship graph:** Track company-to-company (competitors, partners), company-to-investor (funding networks), and company-to-corporate (advisory member interest, pilot status). Expose via API and visualize.
- **Signal detection:** Automated pattern recognition. Subsector heating (3+ companies in the same 4D cell raising rounds within 90 days). Demand signals (advisory member hiring patterns in a technology category). Technology convergence (patent clustering across companies). Surface as alerts and feed into sector pages.
- **Market opportunity enrichment:** TAM/SAM indicators, competitive density, corporate demand signals, and funding trajectory for each startup and each 4D cell. This is the market context layer.
- **Trend report automation:** Connect the 13-agent trend pipeline to the platform. Generate quarterly reports from live data with audience-specific versions for partners, LPs, and public distribution.

### Priority 4: Proprietary Data Capture

The moat. Data that nobody else can get.

- **Structured meeting templates:** Build question templates for partner meetings and founder interviews. Capture responses as structured data that flows directly into the database.
- **Pilot Success Score:** Track which startups piloted with which corporates, outcomes, and timelines. Derive a score. This metric exists nowhere else.
- **ROI Indicators:** Calculate estimated return metrics from structured meeting data and deployment outcomes. Proprietary to CVC.

---

## 7. Separate Tools (Not Integrated Yet)

These tools are valuable and continue to iterate independently. They will connect to Producer when the core platform is solid.

- **DD Pipeline:** Five specialist agents (financials, comp, product, qualitative, news) with weighted scoring and 23-point red flag scanner. Works as a standalone pipeline. Eventually the DD output will attach to startup profiles as an internal assessment layer visible only to Nate.
- **Monday Morning Briefing:** Weekly synthesis delivered via Telegram. Currently standalone. Eventually the briefing content feeds into the sector page narratives and the news feed.
- **Quarterly Trend Reports:** 13-agent pipeline with audience versioning. Currently a spec. Eventually generates directly from Producer's data and publishes through the platform.

---

## 8. Quality Standards

Every page that a partner or LP could see must meet these standards:

- **No empty states:** If a page exists in the navigation, it must have real data. An empty partners page is worse than no partners page.
- **Data freshness:** Sector pages and the news feed must show content from the current week. A stale platform looks abandoned.
- **Source attribution:** Every data point traces to a source. If the system does not know something, it says so. No hallucinated data.
- **CVC voice:** Summaries and assessments are written in CVC's analytical voice, not copied from company marketing materials. Direct, technical, opinionated.
- **Professional presentation:** Navy `#253B49`, yellow `#F0E545`, Trebuchet MS. Clean layouts. Loads fast. Works on phone.
- **Depth over breadth:** A profile with 8 well-sourced data points is better than one with 20 fields where half are empty or guessed.

---

## 9. How BigBossHog Uses This Document

This vision document is the reference for autonomous task generation. When the weekly audit runs, BigBossHog should:

1. Read Section 6 (Build Priorities). Find the highest-priority unfinished item.
2. Check the database for current state: how many companies are enriched, which tables are empty, when signals were last collected.
3. Compare current state against the target described in this document.
4. Generate build tasks for the gaps, following the priority order.
5. Low-risk tasks (running existing workers, data imports) auto-approve. Medium-risk tasks (new endpoints, new pages, new workers) go to Nate.
6. After each deployment, update SYSTEM_STATE.md with the new status.

**The cycle:** Nate updates this document when strategy changes. BigBossHog reads it every audit cycle and generates tasks. Big Claw builds. BigBossHog deploys. Whip Claw documents. The platform moves toward the vision continuously, whether Nate is at the keyboard or not.

---

*This is a living document. As priorities shift, new sectors are added, or new data sources become available, Nate or Claude Code updates this file. The agents read the latest version. The vision evolves, the system evolves with it.*
