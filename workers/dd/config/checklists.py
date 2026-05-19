"""
checklists.py — Per-agent document routing rules.

Each agent has a checklist of document types it wants.
The router sends a doc to an agent if the doc's type is in that agent's list.

Document types (set by tagger.py):
    pitch_deck, financial_model, financial_statement, cap_table,
    legal_terms, legal_formation, customer_contract, investor_qa,
    team_bio, patent_ip, unknown

    legal_terms     — investment-relevant: equity plans, advisor/founder agreements,
                      indemnification, safe/convertible notes, restricted stock
    legal_formation — company formation/compliance: bylaws, corp art, state filings,
                      BOIR, EIN — filed for reference, not routed to agents
    unknown         — unclassified docs; shared with all agents (each extracts what's relevant)
"""

# Which document types each specialist agent wants
AGENT_CHECKLISTS = {
    "financials": [
        "financial_model",
        "financial_statement",
        "cap_table",
        "customer_contract",   # Revenue evidence
        "legal_terms",         # Cap structure, equity plans, SAFE/convertible notes
    ],
    "comp": [
        "customer_contract",   # Who they sell to = market signal
        "patent_ip",           # Tech differentiation
    ],
    "qualitative": [
        "team_bio",
        "legal_terms",         # Founders agreements, indemnification, advisor deals
        "customer_contract",   # Relationship quality, customer concentration
    ],
    "product": [
        "patent_ip",           # IP documentation
        "customer_contract",   # Product scope, use cases
    ],
    "news": [
        # News agent does not use documents —
        # it works from company name + sector (web search only)
    ],
}

# Document types that go to ALL agents (always shared)
# pitch_deck, investor_qa: universal context every agent needs
# unknown: unclassified docs (e.g. pitch decks that didn't match filename signals) —
#   each specialist extracts what's relevant to their own lens
ALWAYS_SHARE = ["pitch_deck", "investor_qa", "unknown"]
