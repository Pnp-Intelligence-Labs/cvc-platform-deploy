"""
workers/trends/report_builder.py — Report Workspace LLM Engine
==============================================================
Called by api/routes/trend_reports.py as background tasks.

Three entry points:
  build_brief(report_id)     — generate the report_brief (outline context)
  build_section(report_id, section_id) — assemble sources, call LLM, voice pass, save
  assemble_report(report_id) — stitch all section content into final HTML

Section types and their generation roles:
  prose          — General Practitioner (default)
  deep_dive      — General Practitioner, extended depth
  sidebar        — Architect: 2-3 sentence callout box
  spotlight      — Architect: 150-200 word featured company/deal profile
  tech_stack     — Specialist: vendor landscape, integration patterns
  investment_take — Analyst: market sizing, valuation, portfolio fit
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import sys

logger = logging.getLogger(__name__)

# ── PYTHONPATH shim ───────────────────────────────────────────────────────────
_REPO = "/home/nathan11/repos/cvc-intelligence"
if _REPO not in sys.path:
    sys.path.insert(0, _REPO)

from core.db.connection import get_connection  # noqa: E402

# LLM — report workspace uses a dedicated OpenRouter key (OPENROUTER_REPORT_KEY)
# so report spend is tracked separately from platform spend.
# Falls back to OPENROUTER_API_KEY if the dedicated key is not set.
_OPENROUTER_KEY   = os.environ.get("OPENROUTER_REPORT_KEY") or os.environ.get("OPENROUTER_API_KEY", "")
_GENERATION_MODEL = "moonshotai/kimi-k2.6"
_VOICE_MODEL      = "moonshotai/kimi-k2.6"

# Load voice profile once
_VOICE_MD_PATH = "/home/nathan11/repos/cvc-intelligence/core/VOICE.md"
try:
    with open(_VOICE_MD_PATH) as f:
        _VOICE_PROFILE = f.read()
except FileNotFoundError:
    _VOICE_PROFILE = ""
    logger.warning(f"VOICE.md not found at {_VOICE_MD_PATH} — voice pass will be skipped")

# Base SLAM voice prefix injected into every generation prompt
_VOICE_PREFIX = (
    "You are writing on behalf of Plug and Play SLAM — the Supply Chain, Logistics and Advanced "
    "Manufacturing venture platform at Plug and Play. Write in a confident, direct, practitioner voice. "
    "Lead every paragraph with the claim. Use active voice. Name specific companies, deals, and data points. "
    "Avoid: em dashes as sentence connectors, \"delve,\" \"it's worth noting,\" \"in the realm of,\" "
    "\"leveraging,\" \"stakeholders,\" \"paradigm shift,\" \"cutting-edge,\" \"landscape\" as a noun, "
    "and any phrase that sounds like it came from a language model. "
    "Paragraphs are 3–5 sentences. Vary sentence length. "
    "End sections with an investment or strategic implication."
)

_NO_CJK = "Output in English only — do not use any Chinese characters or non-Latin scripts."

# ── Audience modifiers ────────────────────────────────────────────────────────
# Injected into generation system prompt + voice pass for every section.
# Section-level audience overrides report-level audience (null = use report).

_AUDIENCE_MODIFIERS: dict[str, str] = {
    'executive': (
        "AUDIENCE — C-suite executives and board-level decision-makers. "
        "Lead with the strategic implication and the ask. Minimize technical detail. "
        "Frame every paragraph around business impact, ROI, and competitive risk. "
        "No more than one paragraph of context before the recommendation."
    ),
    'practitioner': (
        "AUDIENCE — Operators, engineers, and program managers who will implement what you describe. "
        "Name specific tools, protocols, vendors, and integration patterns. "
        "Assume fluency with the domain — do not define basic terms. "
        "Lead with the operational implication."
    ),
    'investor': (
        "AUDIENCE — Venture capital investors and corporate venture teams evaluating deals. "
        "Lead every section with the investment thesis. "
        "Frame all content around market size, timing signals, valuation dynamics, "
        "key risks, and portfolio fit. Name comparable transactions where possible."
    ),
    'analyst': (
        "AUDIENCE — Research analysts building models and tracking competitive dynamics. "
        "Be precise with numbers — cite sources, include date ranges, specify units. "
        "Structure arguments logically. Prioritize accuracy and completeness over brevity."
    ),
    'general': (
        "AUDIENCE — General professional readership with business literacy but no deep domain expertise. "
        "Explain acronyms and domain concepts briefly. Lead with the main point. "
        "Use concrete examples to ground abstract claims."
    ),
}

# ── Tone modifiers ────────────────────────────────────────────────────────────

_TONE_MODIFIERS: dict[str, str] = {
    'analytical': (
        "TONE — Analytical and evidence-driven. "
        "Every claim must follow from data or a named source. "
        "Avoid hedging phrases ('could', 'may') unless genuinely uncertain. "
        "Write like a practitioner who has already done the analysis, not one still hedging it."
    ),
    'authoritative': (
        "TONE — Authoritative and declarative. "
        "State conclusions first. Do not hedge. "
        "Write with the confidence of a sector expert who has a track record and a strong view. "
        "One voice, one position per paragraph."
    ),
    'narrative': (
        "TONE — Narrative and story-driven. "
        "Open each section with a concrete scenario, company example, or deployment story "
        "that illustrates the broader trend. Pull the reader through a progression. "
        "Abstract claims should follow concrete examples, not precede them."
    ),
    'concise': (
        "TONE — Concise and high-density. "
        "Remove every word that does not add information. "
        "Prefer shorter paragraphs (2–3 sentences). "
        "Cut context-setting, transitional filler, and qualifications that are not essential. "
        "Assume the reader has already read the brief."
    ),
    'conversational': (
        "TONE — Direct and conversational — like a briefing from a trusted colleague. "
        "Use contractions where natural. "
        "Write as if explaining to a smart peer who respects your expertise, not writing for a committee. "
        "Short, punchy sentences are fine."
    ),
}

# ── Role prompts per section type ─────────────────────────────────────────────
# Each type gets a distinct system prompt and length guidance.
# Falls back to 'prose' for any unrecognized type.

_CITE_INSTRUCTION = (
    "Cite sources throughout using the exact format (Source: Label) — "
    "use the exact label text from the [SOURCE: Label] header above each source block. "
    "Every claim backed by source data must have an inline citation. "
    "Do not invent label names."
)

_ROLE_PROMPTS: dict[str, dict] = {
    "prose": {
        "role": "General Practitioner",
        "system": (
            _VOICE_PREFIX + "\n\n"
            "Write in prose paragraphs only. No bullet lists unless the source data is inherently tabular. "
            "Do not fabricate numbers or company names not present in the sources. " + _NO_CJK
        ),
        "length": (
            "3–5 paragraphs. Lead with the main claim. End with an investment or strategic implication. "
            + _CITE_INSTRUCTION
        ),
        "voice_pass": True,
    },
    "deep_dive": {
        "role": "Deep Analyst",
        "system": (
            _VOICE_PREFIX + "\n\n"
            "This is a deep-dive section — go further than an overview. "
            "Explain mechanisms, tradeoffs, and technical detail. Do not fabricate numbers. " + _NO_CJK
        ),
        "length": (
            "5–7 paragraphs. Lead with the core thesis of this section. "
            "Explain the mechanism or process in detail in the middle paragraphs. "
            "End with the investment or deployment implication. "
            + _CITE_INSTRUCTION
        ),
        "voice_pass": True,
    },
    "sidebar": {
        "role": "Architect",
        "system": (
            "You are writing a sidebar callout for a SLAM research report. "
            "A sidebar is a short highlighted pull-quote box — NOT a full section. "
            "Write in the SLAM voice: direct, practitioner, specific. "
            "Name a company or cite a data point. " + _NO_CJK
        ),
        "length": (
            "Write 2–3 sentences only. Under 80 words total. "
            "One claim, one supporting fact or company name, one implication. "
            "No headers, no lists, no preamble. "
            "If you draw from a source, add (Source: Label) at the end of the relevant sentence."
        ),
        "voice_pass": False,  # Too short — generation prompt already constrains it
    },
    "spotlight": {
        "role": "Architect",
        "system": (
            "You are writing a Spotlight box for a SLAM research report. "
            "A Spotlight features one company, one technology, or one deal that exemplifies the section theme. "
            "Write in the SLAM voice: direct, specific, evidence-based. " + _NO_CJK
        ),
        "length": (
            "150–200 words only. Structure: "
            "(1) company or technology name and one-line positioning, "
            "(2) what makes it notable — cite a specific deal, deployment, or metric from the sources, "
            "(3) why it matters to the SLAM thesis. "
            "No headers, no lists. "
            + _CITE_INSTRUCTION
        ),
        "voice_pass": False,
    },
    "tech_stack": {
        "role": "Specialist",
        "system": (
            "You are a technical specialist writing a technology stack section for a SLAM research report. "
            "Name specific vendors, platforms, APIs, protocols, and integration patterns. "
            "Explain what each technology does and why practitioners choose it over alternatives. "
            "Avoid investment framing — no 'opportunity', 'thesis', or 'valuation'. "
            "Write for a technical operator or engineer making a build-vs-buy decision. " + _NO_CJK
        ),
        "length": (
            "3–4 paragraphs. Start with the dominant platform or protocol in the space. "
            "Work through the stack layers. "
            "End with the integration or interoperability challenge that remains most unresolved. "
            + _CITE_INSTRUCTION
        ),
        "voice_pass": True,
    },
    "investment_take": {
        "role": "Analyst",
        "system": (
            "You are an investment analyst writing the investment perspective for a SLAM research report. "
            "Frame every paragraph around evidence: market size with a source, entry timing signals "
            "(rounds, exits, M&A), valuation dynamics or comparable transactions, "
            "and specific portfolio fit for a corporate venture platform. "
            "Do not use generic phrases like 'significant opportunity' — "
            "name the specific opportunity, the specific risk, and the specific action. " + _NO_CJK
        ),
        "length": (
            "3–4 paragraphs. Lead with the investment thesis in one sentence. "
            "Develop with market evidence — size, timing, comparables. "
            "End with the specific action or risk for SLAM. "
            + _CITE_INSTRUCTION
        ),
        "voice_pass": True,
    },
}


def _clean_llm_output(text: str) -> str:
    """Strip Qwen3 thinking blocks and any stray CJK characters."""
    text = re.sub(r'<think>[\s\S]*?</think>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]+', '', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()


def _llm(system: str, user_msg: str, model: str = _GENERATION_MODEL) -> str:
    """
    Call Claude (Anthropic SDK) if ANTHROPIC_API_KEY is set.
    Falls back to OpenRouter if not set or if Anthropic call fails.
    The `model` param applies only to OpenRouter — Claude always uses claude-sonnet-4-6.
    """
    _ant_key = os.environ.get("ANTHROPIC_API_KEY", "")

    if _ant_key:
        try:
            import anthropic as _ant
            client = _ant.Anthropic(api_key=_ant_key)
            msg = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=4096,
                temperature=0.3,
                system=system,
                messages=[{"role": "user", "content": user_msg}],
            )
            return msg.content[0].text.strip()
        except Exception as e:
            logger.warning(f"Anthropic SDK failed — falling back to OpenRouter: {e}")

    # OpenRouter fallback
    import requests
    resp = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {_OPENROUTER_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user_msg},
            ],
            "temperature": 0.3,
        },
        timeout=120,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"]
    return _clean_llm_output(raw)


def _process_citations(
    sections: list[dict],
    sources: list[dict],
    citation_style: str,
) -> tuple[list[dict], str]:
    """
    Post-process (Source: Label) markers into numbered citations.

    Scans all section content for (Source: ...) patterns (case-insensitive,
    also catches [Source: ...] and Source: "..." variants).
    Assigns sequential citation numbers by first-appearance order.

    Bibliography is ALWAYS complete — every source attached to the report appears,
    whether cited inline or not. Uncited sources are listed in an "Additional Sources"
    subsection after the cited entries.

    Supported citation_style values:
      superscript — inline <sup>[N]</sup> linked to bibliography; heading "Notes & Sources"
      chicago     — same inline; heading "Bibliography"; label bold + full URL on second line
      ieee        — inline [N] plain link (no superscript); heading "References"
      mla         — inline (Label) italic link; heading "Works Cited"; alphabetical

    In ALL styles, inline markers hyperlink to #ref-N and bibliography entries link to their URL.

    Returns (processed_sections, bibliography_html).
    """
    # Build label → URL map from ALL loaded sources
    source_url_map: dict[str, str] = {}
    all_source_labels: list[str] = []   # ordered list of all source labels for complete bib
    for s in sources:
        lbl = (s.get('label') or s.get('filename') or '').strip()
        # Fallback label for sources with no label/filename
        if not lbl:
            lbl = s.get('article_url') or f"Source #{s.get('id', '?')}"
        lbl = lbl.strip()
        if lbl:
            all_source_labels.append(lbl)
            url = s.get('article_url') or ''
            if url:
                source_url_map[lbl] = url

    # Fuzzy URL lookup: exact → case-insensitive → substring
    def _fuzzy_url(cited_label: str) -> str:
        if cited_label in source_url_map:
            return source_url_map[cited_label]
        cited_lower = cited_label.lower()
        for lbl, url in source_url_map.items():
            if lbl.lower() == cited_lower:
                return url
        for lbl, url in source_url_map.items():
            if cited_lower in lbl.lower() or lbl.lower() in cited_lower:
                return url
        return ''

    # First pass: collect unique cited labels in document order
    # Broad pattern: (Source: ...) or [Source: ...], case-insensitive
    _CITE_PAT = re.compile(r'[\(\[]\s*[Ss]ource\s*:\s*([^\)\]]+)[\)\]]')

    citation_index: dict[str, int] = {}
    for sec in sections:
        content = sec.get('content') or ''
        for m in _CITE_PAT.findall(content):
            m = m.strip()
            if m and m not in citation_index:
                citation_index[m] = len(citation_index) + 1

    # Second pass: replace markers in each section's content
    def _replace(match: re.Match) -> str:
        label = match.group(1).strip()
        n = citation_index.get(label, '?')
        if citation_style == 'ieee':
            return f'<a href="#ref-{n}" class="citation-bracket">[{n}]</a>'
        elif citation_style == 'mla':
            truncated = label[:40] + ('…' if len(label) > 40 else '')
            return f'(<a href="#ref-{n}" class="citation-mla">{truncated}</a>)'
        else:
            return f'<sup class="citation"><a href="#ref-{n}" class="cit-link">[{n}]</a></sup>'

    processed: list[dict] = []
    for sec in sections:
        content = sec.get('content') or ''
        new_content = _CITE_PAT.sub(_replace, content)
        processed.append({**sec, 'content': new_content})

    # ── Build bibliography ─────────────────────────────────────────────────────
    # CITED sources — in citation order (or alphabetical for MLA)
    def _bib_entry_html(label: str, n: int | None, style: str) -> str:
        url = _fuzzy_url(label)
        anchor_id = f'id="ref-{n}"' if n is not None else ''
        if style == 'chicago':
            inner = f'<strong>{label}</strong>'
            if url:
                inner += f'<br><span class="bib-url"><a href="{url}" target="_blank" rel="noopener noreferrer">{url}</a></span>'
        elif style == 'ieee':
            if url:
                inner = f'[{n}] <a href="{url}" target="_blank" rel="noopener noreferrer">{label}</a>'
            else:
                inner = f'[{n}] {label}'
        else:
            if url:
                inner = f'<a href="{url}" target="_blank" rel="noopener noreferrer">{label}</a>'
            else:
                inner = label
        return f'<li {anchor_id}>{inner}</li>'

    # Cited entries
    if citation_style == 'mla':
        cited_sorted = sorted(citation_index.items(), key=lambda x: x[0].lower())
    else:
        cited_sorted = sorted(citation_index.items(), key=lambda x: x[1])

    cited_items_html = '\n      '.join(
        _bib_entry_html(lbl, n, citation_style) for lbl, n in cited_sorted
    )

    # Uncited sources — sources attached to the report not cited inline
    cited_labels = set(citation_index.keys())
    uncited: list[str] = [lbl for lbl in all_source_labels if lbl not in cited_labels]
    # Deduplicate preserving order
    seen: set[str] = set()
    unique_uncited: list[str] = []
    for lbl in uncited:
        if lbl not in seen:
            seen.add(lbl)
            unique_uncited.append(lbl)

    uncited_block = ''
    if unique_uncited:
        uncited_items = '\n      '.join(
            _bib_entry_html(lbl, None, citation_style) for lbl in unique_uncited
        )
        uncited_block = f"""
      <div class="bib-additional-label">Additional Sources</div>
      <ul class="ref-list ref-uncited">
      {uncited_items}
      </ul>"""

    # Heading and list tag per style
    if citation_style == 'mla':
        heading, list_open, list_close = 'Works Cited', '<ul class="ref-list">', '</ul>'
    elif citation_style == 'ieee':
        heading, list_open, list_close = 'References', '<ol class="ref-list ref-list-ieee">', '</ol>'
    elif citation_style == 'chicago':
        heading, list_open, list_close = 'Bibliography', '<ol class="ref-list">', '</ol>'
    else:
        heading, list_open, list_close = 'Notes &amp; Sources', '<ol class="ref-list">', '</ol>'

    # Only render the cited section if there are any inline citations
    cited_section = ''
    if citation_index:
        cited_section = f'{list_open}\n      {cited_items_html}\n      {list_close}'

    # If nothing at all — return empty
    if not citation_index and not unique_uncited:
        return processed, ''

    bib_html = f"""
    <section class="bibliography">
      <h2 class="bib-heading">{heading}</h2>
      {cited_section}
      {uncited_block}
    </section>"""

    return processed, bib_html


def _conf_badge(conf: float) -> tuple[str, str]:
    if conf == 0:
        return '#94a3b8', 'AI only'
    elif conf >= 0.7:
        return '#10b981', 'well-cited'
    elif conf >= 0.35:
        return '#f59e0b', 'cited'
    else:
        return '#ef4444', 'lightly cited'


def _rows_to_table(rows: list) -> str:
    """Convert a list of dicts to a readable text table for LLM context."""
    if not rows:
        return "(empty result)"
    cols = list(rows[0].keys())
    lines = [" | ".join(str(c) for c in cols)]
    lines.append("-" * (len(lines[0])))
    for row in rows[:100]:
        lines.append(" | ".join(str(row.get(c, "")) for c in cols))
    if len(rows) > 100:
        lines.append(f"... ({len(rows) - 100} more rows)")
    return "\n".join(lines)


def _chart_html(source: dict) -> str:
    """
    Generate a Chart.js canvas + inline script block for a db_query source.
    Only called when chart_type, x_key, y_key, and query_result are all present.
    """
    src_id = source['id']
    chart_type = source.get('chart_type', 'bar')
    x_key = source.get('x_key', '')
    y_key = source.get('y_key', '')
    label = source.get('label', 'Data')

    try:
        raw_rows = json.loads(source['query_result'])
        if not raw_rows or not isinstance(raw_rows, list):
            return ''
        rows_json = json.dumps(raw_rows[:30], default=str)
    except Exception:
        return ''

    js_type = 'pie' if chart_type == 'pie' else ('line' if chart_type in ('line', 'area') else 'bar')
    show_legend = 'true' if js_type == 'pie' else 'false'
    scales_cfg = '' if js_type == 'pie' else ', scales: { y: { beginAtZero: true, ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 10 }, maxRotation: 45 } } }'
    border_width = 2 if js_type == 'line' else 0
    escaped_label = label.replace('"', '\\"')
    canvas_id = f"chart_{src_id}"

    script = (
        f'(function(){{'
        f'var raw={rows_json};'
        f'var labels=raw.map(function(r){{var v=r["{x_key}"];return v!=null?String(v).slice(0,24):""}});'
        f'var vals=raw.map(function(r){{var v=Number(r["{y_key}"]);return isNaN(v)?0:v}});'
        f'var colors=["#6366F1","#10b981","#f59e0b","#EC4899","#06B6D4","#8b5cf6","#3b82f6","#ef4444","#14b8a6","#f97316"];'
        f'var el=document.getElementById("{canvas_id}");'
        f'if(!el||typeof Chart==="undefined")return;'
        f'new Chart(el,{{'
        f'type:"{js_type}",'
        f'data:{{labels:labels,datasets:[{{label:"{escaped_label}",data:vals,'
        f'backgroundColor:colors,borderColor:"#6366F1",borderWidth:{border_width},fill:false}}]}},'
        f'options:{{responsive:true,plugins:{{legend:{{display:{show_legend}}}}}{scales_cfg}}}'
        f'}});'
        f'}})();'
    )

    return (
        f'<div class="chart-block">'
        f'<div class="chart-label">{label}</div>'
        f'<canvas id="{canvas_id}" style="max-height:250px;width:100%;display:block;"></canvas>'
        f'<script>{script}</script>'
        f'</div>'
    )


# ── build_brief ───────────────────────────────────────────────────────────────

def build_brief(report_id: int) -> None:
    """Generate a one-paragraph report brief from title + theme + section outline."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM cvc.trend_reports WHERE id = %s", (report_id,))
            report = dict(cur.fetchone())
            cur.execute(
                "SELECT title, instructions FROM cvc.report_sections WHERE report_id = %s ORDER BY position, id",
                (report_id,)
            )
            sections = [dict(r) for r in cur.fetchall()]

    outline = "\n".join(
        f"- {s['title']}" + (f": {s['instructions']}" if s['instructions'] else "")
        for s in sections
    )

    system = _VOICE_PREFIX
    user_msg = f"""You are preparing a brief for a SLAM sector report.

Report title: {report['title']}
Sector: {report.get('sector') or 'Not specified'}
Theme / angle: {report.get('theme') or 'Not specified'}
Date range: {report.get('date_from') or '—'} to {report.get('date_to') or '—'}

Section outline:
{outline or '(no sections defined yet)'}

Write a 2–3 sentence report brief. This brief will be injected into the context of every section \
generation as the spine of the report — it must capture the core argument, the audience, and the \
specific angle we are taking. Be concrete. No fluff. {_NO_CJK}"""

    brief = _llm(system, user_msg)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.trend_reports SET report_brief = %s, updated_at = NOW() WHERE id = %s",
                (brief, report_id)
            )
        conn.commit()

    logger.info(f"Brief generated for report {report_id}")


# ── build_section ─────────────────────────────────────────────────────────────

def build_section(report_id: int, section_id: int) -> None:
    """
    1. Load report brief + section type + all source content for this section
    2. Pick role prompt based on section_type
    3. Call generation LLM
    4. Run voice editorial pass (skipped for sidebar/spotlight — too short)
    5. Score confidence
    6. Save to DB
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM cvc.trend_reports WHERE id = %s", (report_id,))
            report = dict(cur.fetchone())
            cur.execute("SELECT * FROM cvc.report_sections WHERE id = %s", (section_id,))
            section = dict(cur.fetchone())
            cur.execute("""
                SELECT * FROM cvc.report_sources
                WHERE report_id = %s AND (section_id = %s OR section_id IS NULL)
                ORDER BY created_at
            """, (report_id, section_id))
            sources = [dict(r) for r in cur.fetchall()]

    brief = report.get('report_brief') or ""
    instructions = section.get('instructions') or ""
    section_type = section.get('section_type') or 'prose'
    role_config = _ROLE_PROMPTS.get(section_type, _ROLE_PROMPTS['prose'])

    # Audience + tone: section-level overrides report-level
    audience = section.get('audience') or report.get('audience') or 'practitioner'
    tone = section.get('tone') or report.get('tone') or 'analytical'
    audience_mod = _AUDIENCE_MODIFIERS.get(audience, _AUDIENCE_MODIFIERS['practitioner'])
    tone_mod = _TONE_MODIFIERS.get(tone, _TONE_MODIFIERS['analytical'])

    # Assemble source context blocks
    source_blocks = []
    for s in sources:
        label = s.get('label') or s.get('filename') or s.get('source_type', 'Source')
        st = s.get('source_type', '')
        if st == 'db_query' and s.get('query_result'):
            try:
                rows = json.loads(s['query_result'])
                text = _rows_to_table(rows)
            except Exception:
                text = str(s['query_result'])[:2000]
        else:
            text = (s.get('content_text') or "")[:30000]

        if text.strip():
            source_blocks.append(f"[SOURCE: {label}]\n{text}")

    source_context = "\n\n---\n\n".join(source_blocks)
    has_sources = bool(source_blocks)

    # ── Generation prompt ──────────────────────────────────────────────────────
    system = role_config['system'] + f"\n\n{audience_mod}\n\n{tone_mod}"
    length_guidance = role_config['length']

    user_msg = f"""You are writing one section of a SLAM trend report.

REPORT BRIEF (spine — stay consistent with this throughout):
{brief or '(brief not yet generated)'}

SECTOR: {report.get('sector') or 'Not specified'}
SECTION TITLE: {section['title']}
SECTION TYPE: {section_type.replace('_', ' ').title()} [{role_config['role']}]
ANALYST INSTRUCTIONS FOR THIS SECTION:
{instructions or '(no specific instructions)'}

SOURCES:
{source_context if has_sources else '(no sources attached — write from general knowledge, and note this explicitly)'}

Write the section now. {length_guidance}
Output prose only — no markdown headers, no preamble, no "In this section..."."""

    raw_content = _llm(system, user_msg)

    # ── Voice editorial pass ───────────────────────────────────────────────────
    # Skipped for sidebar and spotlight — they are short and tightly constrained by the generation prompt.
    if _VOICE_PROFILE and role_config.get('voice_pass', True):
        voice_system = (
            f"You are an editorial assistant for Plug and Play SLAM. {_NO_CJK} "
            f"Apply the following voice and style guide strictly:\n\n{_VOICE_PROFILE}\n\n"
            f"Additional framing for this pass — maintain these throughout:\n{audience_mod}\n{tone_mod}\n\n"
            "Your job is to rewrite the draft below so it conforms to the voice guide and the audience/tone framing above. "
            "CRITICAL: Preserve every (Source: Label) citation marker EXACTLY as written — "
            "do not remove, rephrase, or move them. They are structural metadata, not prose. "
            "Fix any banned phrases, passive voice, em dashes as connectors, or AI-style filler. "
            "Do not add new facts. Output the revised prose only."
        )
        voice_user = f"DRAFT:\n\n{raw_content}"
        try:
            final_content = _llm(voice_system, voice_user, model=_VOICE_MODEL)
        except Exception as e:
            logger.warning(f"Voice pass failed for section {section_id}: {e} — using raw output")
            final_content = raw_content
    else:
        final_content = raw_content

    # ── Confidence score ───────────────────────────────────────────────────────
    citation_count = len(re.findall(r'\(Source:', final_content))
    para_count = max(1, len([p for p in final_content.split('\n') if p.strip()]))
    if not has_sources:
        confidence = 0.0
    else:
        confidence = min(1.0, citation_count / para_count)

    # ── Version history ────────────────────────────────────────────────────────
    existing_content = section.get('content')
    history = section.get('version_history') or []
    if existing_content:
        import datetime
        history.append({
            'content': existing_content,
            'generated_at': section.get('generated_at').isoformat() if section.get('generated_at') else None,
            'confidence_score': section.get('confidence_score'),
        })

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.report_sections
                SET content = %s,
                    confidence_score = %s,
                    status = 'done',
                    generated_at = NOW(),
                    version_history = %s,
                    error_msg = NULL
                WHERE id = %s
            """, (final_content, confidence, json.dumps(history), section_id))
        conn.commit()

    logger.info(
        f"Section {section_id} ({section_type}/{role_config['role']}) generated — "
        f"confidence={confidence:.2f}, citations={citation_count}"
    )


# ── rewrite_sections ──────────────────────────────────────────────────────────

def rewrite_sections(report_id: int) -> None:
    """
    Apply audience + tone voice pass to all done sections without full regeneration.
    Does NOT update version history (it's an editorial pass, not a regeneration).
    Reassembles the report HTML when done.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM cvc.trend_reports WHERE id = %s", (report_id,))
            report = dict(cur.fetchone())
            cur.execute("""
                SELECT * FROM cvc.report_sections
                WHERE report_id = %s AND status = 'done' AND content IS NOT NULL
                ORDER BY position, id
            """, (report_id,))
            sections = [dict(r) for r in cur.fetchall()]

    if not _VOICE_PROFILE:
        logger.warning(f"VOICE.md not found — rewrite_sections skipped for report {report_id}")
        return

    audience_base = report.get('audience') or 'practitioner'
    tone_base = report.get('tone') or 'analytical'

    for section in sections:
        section_id = section['id']
        audience = section.get('audience') or audience_base
        tone = section.get('tone') or tone_base
        audience_mod = _AUDIENCE_MODIFIERS.get(audience, _AUDIENCE_MODIFIERS['practitioner'])
        tone_mod = _TONE_MODIFIERS.get(tone, _TONE_MODIFIERS['analytical'])

        voice_system = (
            f"You are an editorial assistant for Plug and Play SLAM. {_NO_CJK} "
            f"Apply the following voice and style guide strictly:\n\n{_VOICE_PROFILE}\n\n"
            f"Additional framing for this pass — maintain these throughout:\n{audience_mod}\n{tone_mod}\n\n"
            "Your job is to rewrite the draft below so it conforms to the voice guide and the audience/tone framing above. "
            "CRITICAL: Preserve every (Source: Label) citation marker EXACTLY as written — "
            "do not remove, rephrase, or move them. They are structural metadata, not prose. "
            "Fix any banned phrases, passive voice, em dashes as connectors, or AI-style filler. "
            "Do not add new facts. Output the revised prose only."
        )

        try:
            rewritten = _llm(voice_system, f"DRAFT:\n\n{section['content']}", model=_VOICE_MODEL)
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE cvc.report_sections SET content = %s WHERE id = %s",
                        (rewritten, section_id)
                    )
                conn.commit()
            logger.info(f"Rewrite pass done: section {section_id} ({audience}/{tone})")
        except Exception as e:
            logger.warning(f"Rewrite pass failed for section {section_id}: {e} — keeping original")

    # Reassemble with new content
    assemble_report(report_id)
    logger.info(f"Report {report_id} rewritten — {len(sections)} sections, audience={audience_base}, tone={tone_base}")


# ── assemble_report ────────────────────────────────────────────────────────────

def assemble_report(report_id: int) -> None:
    """
    Stitch all completed sections into a publishable HTML document.
    Uses type-specific HTML wrappers per section_type.
    Injects Chart.js charts for db_query sources with chart metadata.
    Processes (Source: Label) markers into numbered citations per output_format.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM cvc.trend_reports WHERE id = %s", (report_id,))
            report = dict(cur.fetchone())
            cur.execute("""
                SELECT * FROM cvc.report_sections
                WHERE report_id = %s ORDER BY position, id
            """, (report_id,))
            sections = [dict(r) for r in cur.fetchall()]
            # Load chart-eligible sources (section-specific only)
            cur.execute("""
                SELECT id, section_id, label, chart_type, x_key, y_key, query_result
                FROM cvc.report_sources
                WHERE report_id = %s
                  AND source_type = 'db_query'
                  AND chart_type IS NOT NULL
                  AND x_key IS NOT NULL
                  AND y_key IS NOT NULL
                  AND query_result IS NOT NULL
                  AND section_id IS NOT NULL
                ORDER BY created_at
            """, (report_id,))
            all_chart_sources = [dict(r) for r in cur.fetchall()]
            # Load all sources for citation URL resolution
            cur.execute("""
                SELECT id, label, filename, source_type, article_url
                FROM cvc.report_sources
                WHERE report_id = %s
                ORDER BY created_at
            """, (report_id,))
            all_sources = [dict(r) for r in cur.fetchall()]

    # Group chart sources by section_id
    section_charts: dict[int, list] = {}
    for cs in all_chart_sources:
        sid = cs.get('section_id')
        if sid:
            section_charts.setdefault(int(sid), []).append(cs)

    has_charts = bool(all_chart_sources)
    output_format = report.get('output_format') or 'report'
    citation_style = report.get('citation_style') or 'superscript'

    sector = report.get('sector') or ''
    title = report['title']
    brief = report.get('report_brief') or ''
    date_range = ""
    if report.get('date_from') and report.get('date_to'):
        date_range = f"{report['date_from']} — {report['date_to']}"

    # Process citations across all sections
    completed_sections = [s for s in sections if s.get('content')]
    processed_sections, bibliography_html = _process_citations(
        completed_sections, all_sources, citation_style
    )
    # Rebuild lookup: section_id → processed content
    processed_map = {s['id']: s for s in processed_sections}

    section_html = ""
    for s in sections:
        if not s.get('content'):
            continue

        conf = s.get('confidence_score') or 0.0
        conf_color, conf_label_text = _conf_badge(conf)
        section_type = s.get('section_type') or 'prose'

        # Use processed content (citations resolved) if available
        display_content = processed_map.get(s['id'], s).get('content') or s['content']
        paras = display_content.split('\n\n')
        para_html = "".join(f"<p>{p.strip()}</p>" for p in paras if p.strip())

        # Chart injection for this section
        charts_html = ""
        for cs in section_charts.get(s['id'], []):
            charts_html += _chart_html(cs)

        t = section_type
        sec_title = s['title']
        conf_badge_html = f'<span class="conf-badge" style="color:{conf_color};">{conf_label_text}</span>'

        if t == 'sidebar':
            section_html += f"""
        <aside class="report-sidebar">
          <div class="sidebar-label">Sidebar</div>
          {para_html}
        </aside>"""

        elif t == 'spotlight':
            section_html += f"""
        <section class="report-spotlight">
          <div class="spotlight-label">Spotlight — {sec_title}</div>
          {para_html}
        </section>"""

        elif t == 'tech_stack':
            section_html += f"""
        <section class="report-section report-tech">
          <div class="section-header">
            <h2>{sec_title}</h2>
            <span class="type-badge type-tech">Tech Stack</span>
            {conf_badge_html}
          </div>
          {charts_html}
          <div class="section-body">{para_html}</div>
        </section>"""

        elif t == 'investment_take':
            section_html += f"""
        <section class="report-section report-investment">
          <div class="section-header">
            <h2>{sec_title}</h2>
            <span class="type-badge type-investment">Investment Take</span>
            {conf_badge_html}
          </div>
          {charts_html}
          <div class="section-body">{para_html}</div>
        </section>"""

        elif t == 'deep_dive':
            section_html += f"""
        <section class="report-section report-deepdive">
          <div class="section-header">
            <h2>{sec_title}</h2>
            <span class="type-badge type-deepdive">Deep Dive</span>
            {conf_badge_html}
          </div>
          {charts_html}
          <div class="section-body">{para_html}</div>
        </section>"""

        else:  # prose (default)
            section_html += f"""
        <section class="report-section">
          <div class="section-header">
            <h2>{sec_title}</h2>
            {conf_badge_html}
          </div>
          {charts_html}
          <div class="section-body">{para_html}</div>
        </section>"""

    chartjs_tag = (
        '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>'
        if has_charts else ''
    )

    format_meta = 'Blog Post' if output_format == 'blog' else 'Report'

    # ── Logo embed (base64 for self-contained HTML) ───────────────────────────
    _logo_path = os.path.join(_REPO, 'api', 'static', 'pnp-slam-logo.png')
    _logo_data_uri = ''
    try:
        with open(_logo_path, 'rb') as _lf:
            _logo_data_uri = 'data:image/png;base64,' + base64.b64encode(_lf.read()).decode('ascii')
    except Exception:
        pass
    logo_img_header = (
        f'<img src="{_logo_data_uri}" alt="Plug and Play" '
        f'style="height:30px;filter:brightness(0) invert(1);opacity:0.92;display:block;margin-bottom:20px;">'
        if _logo_data_uri else ''
    )
    logo_img_footer = (
        f'<img src="{_logo_data_uri}" alt="Plug and Play" '
        f'style="height:18px;filter:brightness(0) invert(1);opacity:0.4;">'
        if _logo_data_uri else ''
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  {chartjs_tag}
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: 'Trebuchet MS', 'Gill Sans MT', sans-serif; background: #F5F5F7; color: #313C51; line-height: 1.7; }}
    /* ── Header ── */
    .report-header {{ background: #253B49; color: #fff; padding: 40px 56px 36px; }}
    .header-eyebrow {{ font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
                       color: #009EC2; margin-bottom: 14px; font-weight: 600; }}
    .report-header h1 {{ font-size: 1.95rem; font-weight: 700; color: #fff; line-height: 1.2; margin-bottom: 10px; }}
    .header-meta {{ font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
                    color: rgba(255,255,255,0.5); margin-top: 10px; }}
    /* ── Body ── */
    .report-body {{ max-width: 900px; margin: 0 auto; padding: 44px 40px 72px; }}
    /* ── Brief ── */
    .brief {{ background: #fff; border-left: 3px solid #009EC2; border-radius: 0 12px 12px 0;
              padding: 18px 24px; font-size: 0.95rem; color: #313C51; margin-bottom: 36px;
              font-style: italic; box-shadow: 0 0 14px rgba(0,0,0,0.08); }}
    /* ── Section cards ── */
    .report-section {{ background: #fff; border-radius: 12px; padding: 28px 32px; margin-bottom: 24px;
                       box-shadow: 0 0 14px rgba(0,0,0,0.14); clear: both; }}
    .section-header {{ display: flex; align-items: baseline; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }}
    h2 {{ font-size: 1.2rem; font-weight: 700; color: #253B49; }}
    .conf-badge {{ font-size: 10px; letter-spacing: 0.08em; }}
    .type-badge {{ font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase;
                   padding: 2px 8px; border-radius: 3px; font-weight: bold; }}
    .type-tech       {{ background: #f3e8ff; color: #7c3aed; }}
    .type-investment {{ background: #fffbeb; color: #b45309; }}
    .type-deepdive   {{ background: #e0f2fe; color: #0369a1; }}
    p {{ margin-bottom: 1em; font-size: 0.975rem; color: #313C51; }}
    /* ── Sidebar ── */
    .report-sidebar {{ float: right; width: 220px; margin: 0 0 20px 28px; clear: right;
                       background: #F5F5F7; border-left: 3px solid #009EC2;
                       padding: 16px; font-size: 0.875rem; color: #313C51;
                       border-radius: 0 12px 12px 0; box-shadow: 0 0 14px rgba(0,0,0,0.08); }}
    .sidebar-label {{ font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
                      color: #009EC2; margin-bottom: 8px; font-weight: bold; }}
    /* ── Spotlight ── */
    .report-spotlight {{ background: #fff; border: 1px solid #d1fae5; border-radius: 12px;
                         padding: 24px 28px; margin-bottom: 24px; clear: both;
                         box-shadow: 0 0 14px rgba(0,0,0,0.14); }}
    .spotlight-label {{ font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
                        color: #059669; margin-bottom: 10px; font-weight: bold; }}
    /* ── Typed section accents ── */
    .report-tech       {{ border-left: 3px solid #009EC2; }}
    .report-investment {{ border-left: 3px solid #b45309; }}
    .report-deepdive   {{ border-left: 3px solid #0369a1; }}
    /* ── Charts ── */
    .chart-block {{ margin: 20px 0 24px; }}
    .chart-label {{ font-size: 10px; color: #9ca3af; text-transform: uppercase;
                    letter-spacing: 0.08em; margin-bottom: 8px; }}
    /* ── Citations ── */
    sup.citation {{ font-size: 0.72em; color: #009EC2; vertical-align: super; line-height: 0; }}
    .cit-link {{ color: #009EC2; text-decoration: none; }}
    .cit-link:hover {{ text-decoration: underline; }}
    .citation-bracket {{ color: #009EC2; text-decoration: none; font-weight: 600; }}
    .citation-bracket:hover {{ text-decoration: underline; }}
    .citation-mla {{ color: #009EC2; text-decoration: none; font-style: italic; }}
    .citation-mla:hover {{ text-decoration: underline; }}
    /* ── Bibliography ── */
    .bibliography {{ background: #fff; border-radius: 12px; padding: 28px 32px; margin-top: 8px;
                     box-shadow: 0 0 14px rgba(0,0,0,0.14); clear: both; }}
    .bib-heading {{ font-size: 0.85rem; font-weight: 700; color: #253B49; margin-bottom: 16px;
                    letter-spacing: 0.08em; text-transform: uppercase; }}
    .ref-list {{ padding-left: 1.5em; }}
    .ref-list li {{ font-size: 0.875rem; color: #313C51; margin-bottom: 8px; line-height: 1.5; }}
    .ref-list a {{ color: #009EC2; text-decoration: none; word-break: break-all; }}
    .ref-list a:hover {{ text-decoration: underline; }}
    .bib-additional-label {{ font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase;
                             color: #9ca3af; margin: 20px 0 8px;
                             padding-top: 16px; border-top: 1px solid #e5e7eb; }}
    .ref-uncited li {{ color: #9ca3af; }}
    .ref-uncited a {{ color: #b0bec5; }}
    .ref-list-ieee {{ list-style: none; padding-left: 0; }}
    .bib-url {{ font-size: 0.8em; color: #9ca3af; word-break: break-all; }}
    /* ── Footer ── */
    .report-footer {{ background: #253B49; padding: 18px 40px;
                      display: flex; align-items: center; justify-content: center; gap: 12px; }}
    .footer-text {{ font-size: 11px; letter-spacing: 0.08em; color: rgba(255,255,255,0.4); }}
    @media print {{
      body {{ background: white; }}
      .report-header {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
      .report-body {{ padding: 32px; max-width: 100%; }}
      .report-sidebar {{ float: none; width: 100%; margin: 0 0 16px; }}
      .report-footer {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    }}
  </style>
</head>
<body>
  <div class="report-header">
    <div class="header-eyebrow">SLAM &middot; Supply Chain, Logistics &amp; Advanced Manufacturing</div>
    {logo_img_header}
    <h1>{title}</h1>
    <div class="header-meta">Plug and Play SLAM{' &middot; ' + sector if sector else ''}{' &middot; ' + date_range if date_range else ''} &middot; {format_meta}</div>
  </div>
  <div class="report-body">
    {f'<div class="brief">{brief}</div>' if brief else ''}
    {section_html}
    {bibliography_html}
  </div>
  <div class="report-footer">
    {logo_img_footer}
    <span class="footer-text">Plug and Play SLAM &middot; Confidential</span>
  </div>
</body>
</html>"""

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.trend_reports
                SET published_html = %s, status = 'ready', updated_at = NOW()
                WHERE id = %s
            """, (html, report_id))
        conn.commit()

    logger.info(f"Report {report_id} assembled — {len(sections)} sections, charts={has_charts}")
