"""
router.py — Routes tagged documents to the appropriate specialist agents.
Uses checklists from config/checklists.py.
Each agent only receives the documents it needs — strict silos.
"""

from config.checklists import AGENT_CHECKLISTS, ALWAYS_SHARE


def route(documents: list[dict]) -> dict[str, list[dict]]:
    """
    Given a list of tagged documents, return a dict mapping
    agent name → list of document dicts that agent should receive.

    Each document dict passed to agents contains:
        filename, rel_path, local_path, text_path, doc_type, chars, conversion
    Text is NOT passed in the manifest (agents read from text_path directly).
    """
    routing: dict[str, list[dict]] = {agent: [] for agent in AGENT_CHECKLISTS}

    # Slim doc record — no text blob in manifest
    def slim(doc: dict) -> dict:
        return {
            "filename":   doc.get("filename", ""),
            "rel_path":   doc.get("rel_path", ""),
            "local_path": doc.get("local_path", ""),
            "text_path":  doc.get("text_path"),
            "doc_type":   doc.get("doc_type", "unknown"),
            "chars":      doc.get("chars", 0),
            "conversion": doc.get("conversion", ""),
        }

    for doc in documents:
        doc_type = doc.get("doc_type", "unknown")

        # Skip docs that failed conversion (no usable text)
        if not doc.get("text_path"):
            continue

        for agent, checklist in AGENT_CHECKLISTS.items():
            if doc_type in checklist or doc_type in ALWAYS_SHARE:
                routing[agent].append(slim(doc))

    return routing


def routing_summary(routing: dict[str, list[dict]]) -> str:
    """Human-readable routing summary for Telegram."""
    lines = ["*Routing:*"]
    for agent, docs in routing.items():
        if docs:
            lines.append(f"  • {agent}: {len(docs)} doc{'s' if len(docs) != 1 else ''}")
        else:
            lines.append(f"  • {agent}: web search only")
    return "\n".join(lines)
