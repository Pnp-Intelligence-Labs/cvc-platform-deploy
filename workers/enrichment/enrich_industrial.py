"""
enrich_industrial.py -- Phase 3 Industrial Alpha Enrichment
Owned by Sharp Claw. Runs after Phase 1/2 enrichment completes.

Targets companies in industrial sectors and extracts proprietary operational
alpha using the INDUSTRIAL_ALPHA.md skill: interoperability, deployment
reality, sovereignty, and regulatory moat.

Writes to cvc.companies:
  industrial_readiness_score  INT  1-10
  sovereignty_score           INT  1-10
  protocol_support            JSONB
  deployment_signal_level     TEXT
  verified_certs              JSONB
  integration_notes           TEXT

Usage:
  python3 enrich_industrial.py                         # process 20 companies
  python3 enrich_industrial.py --limit 50              # process up to 50
  python3 enrich_industrial.py --company "Vecna Robotics"
  python3 enrich_industrial.py --limit 50 --deep-scan-pdfs  # fetch datasheets/cert docs
"""

import os
import sys
import json
import time
import requests
import psycopg2
import psycopg2.extras

from llm.openrouter import call as _llm_call

# ── Config ────────────────────────────────────────────────────────────────────

OPENROUTER_URL   = "https://openrouter.ai/api/v1/chat/completions"
MODEL            = "qwen/qwen3-235b-a22b-2507"
OPENROUTER_KEY   = os.environ.get("OPENROUTER_API_KEY", "")
TELEGRAM_TOKEN   = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

TARGET_SECTORS = ("Robotics", "Manufacturing", "Supply Chain", "Industrial Automation", "Physical AI")

DB_CONFIG = dict(
    dbname="cvc_db",
    user="producer",
    password=os.environ["CVC_DB_PASSWORD"],
    host=os.environ.get("CVC_DB_HOST", "localhost"),
    port=5432,
)

# ── Telegram ──────────────────────────────────────────────────────────────────

def telegram(text: str):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print(f"[telegram] {text}")
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": text},
            timeout=10,
        )
    except Exception as e:
        print(f"[telegram] send failed: {e}")


# ── Scrapling ─────────────────────────────────────────────────────────────────

def scrape(url: str) -> str:
    """Fetch page text via Scrapling. Returns empty string on failure."""
    try:
        from web.scrapling import fetch
        result = fetch(url)
        return result.get("text", "") or ""
    except Exception as e:
        print(f"    Scrapling error for {url}: {e}")
        return ""


def build_page_urls(company_url: str) -> dict:
    """Build candidate docs/careers URLs from a base company URL."""
    base = company_url.rstrip("/")
    return {
        "docs":    [f"{base}/docs", f"{base}/developers", f"{base}/technical", f"{base}/support"],
        "careers": [f"{base}/careers", f"{base}/jobs", f"{base}/about/careers"],
    }


def clean_text(text: str) -> str:
    """Strip JavaScript artifacts and minified content. Keep human-readable lines only."""
    import re
    lines = text.splitlines()
    clean = []
    for line in lines:
        line = line.strip()
        if not line or len(line) > 500:  # skip blank and minified long lines
            continue
        if re.search(r'(function\s*\(|\.prototype\.|=>|&&|\|\||\.push\(|window\.|NREUM|gtag\()', line):
            continue
        clean.append(line)
    return " ".join(clean)[:5000]


def scrape_best(urls: list) -> str:
    """Try each URL, return first non-trivial result."""
    for url in urls:
        text = scrape(url)
        text = clean_text(text)
        if len(text) > 200:
            return text
        time.sleep(1)
    return ""


# ── LLM ───────────────────────────────────────────────────────────────────────

DEEP_SCAN_SUFFIX = """

## DEEP SCAN MODE — HARDENING & CERT FOCUS
You have been given additional PDF and certification document content below.
Your primary objective is to identify:
1. **Verified certifications** — only count a cert if explicitly named in a document (e.g. "ISO 10218-2:2025 certified", "UL 1741 listed"). Do NOT infer certs from product descriptions.
2. **Hardening evidence** — any mention of ruggedized, MIL-SPEC, IP-rated, temperature-rated, or industrial-grade variants vs. commercial versions.
3. **Sovereignty signals** — country of manufacture, foundry partner, TAA/NDAA compliance statements, "Made in USA" claims.
4. **Integration depth** — specific PLC model compatibility (Siemens S7-1500, Allen-Bradley 5069), SDK/API maturity, certified gateway products.

For sovereignty_score: 9-10 = explicit TAA/NDAA compliance + US/allied manufacturing stated; 7-8 = ally-sourced with no stated compliance; 4-6 = mixed sourcing; 1-3 = China-manufactured core components or no sourcing data.

PDF/Document content:
{pdf_text}
"""

EXTRACTION_PROMPT = """You are the CVC Industrial Strategist. Analyze the content below and extract proprietary operational intelligence for a VC/partner audience.

Company: {name}
Sector: {sector}
Website: {url}

Docs page content:
{docs_text}

Careers page content:
{careers_text}

Company description:
{description}

Extract the following and respond with ONLY a valid JSON object:

{{
  "industrial_readiness_score": <int 1-10, overall pilot readiness>,
  "sovereignty_score": <int 1-10, 10=fully TAA-compliant/friend-shored, 1=risky single-source>,
  "protocol_support": <list of strings, e.g. ["OPC-UA", "ROS2", "MQTT"] or []>,
  "deployment_signal_level": <one of: "Lab-Stage", "Pilot", "Scaling", "Operational">,
  "verified_certs": <list of strings, e.g. ["ISO 10218-1/2:2025", "UL 1741"] or []>,
  "integration_notes": "<2-3 sentences: key integration findings, partner pilot advice, gaps>",
  "high_alpha_signal": <true/false — is there an anomaly worth alerting Nate about?>,
  "alpha_reason": "<one sentence describing the anomaly, or empty string>",
  "sources": [
    {{"id": 1, "url": "<source URL>", "type": "primary", "excerpt": "<direct quote or finding that supports a scored field>"}},
    {{"id": 2, "url": "<source URL>", "type": "secondary", "excerpt": "<direct quote or finding>"}}
  ]
}}

Scoring guides:
- industrial_readiness_score: 8-10 = proven field deployments + certs + standard protocols; 1-3 = lab-only, no certs, custom API
- sovereignty_score: 8-10 = US/allied manufactured, TAA-compliant, no risky dependencies; 1-3 = China-sourced core components
- deployment_signal_level: look at hiring — Commissioning/Field/FSO roles = Scaling/Operational; Simulation/R&D only = Lab-Stage
- high_alpha_signal: true if company hired 5+ field/deployment roles recently, new geography expansion, or surprise cert achievement

If data is unavailable for a field, use null for scores, [] for lists, and note "Insufficient data" in integration_notes.
Do NOT fabricate certifications or protocol support. Only report what is explicitly found."""


def call_llm(prompt: str) -> str:
    try:
        return _llm_call(prompt, model=MODEL, temperature=0.1, max_tokens=1500,
                         activity="Industrial Analysis") or ""
    except Exception as e:
        print(f"    LLM error: {e}")
        return None


def parse_json(text: str) -> dict:
    if not text:
        return {}
    import re

    # Extract the outermost {...} block
    depth, start = 0, -1
    candidate = None
    for i, c in enumerate(text):
        if c == "{":
            if depth == 0:
                start = i
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                candidate = text[start:i + 1]
                break

    if not candidate:
        candidate = text.strip()

    # Try strict parse first
    try:
        return json.loads(candidate)
    except Exception:
        pass

    # Fix unquoted keys: {key: value} -> {"key": value}
    try:
        fixed = re.sub(r'(?<!["\w])(\w+)\s*:', r'"\1":', candidate)
        # Fix unquoted string values (not numbers, booleans, null, arrays, objects)
        fixed = re.sub(r':\s*([A-Za-z][A-Za-z0-9\-_ ]*?)([,\}])', r': "\1"\2', fixed)
        return json.loads(fixed)
    except Exception:
        return {}


# ── DB helpers ────────────────────────────────────────────────────────────────

def fetch_companies(cur, batch_size: int, company_name: str = None) -> list:
    if company_name:
        cur.execute("""
            SELECT id, name, website, sector, description
            FROM cvc.companies
            WHERE name ILIKE %s
            LIMIT 1
        """, (f"%{company_name}%",))
    else:
        cur.execute("""
            SELECT id, name, website, sector, description
            FROM cvc.companies
            WHERE sector = ANY(%s)
              AND enrichment_status IN ('enriched', 'fully_enriched')
              AND industrial_readiness_score IS NULL
              AND website IS NOT NULL
            ORDER BY COALESCE(total_raised_usd, 0) DESC
            LIMIT %s
        """, (list(TARGET_SECTORS), batch_size))
    return cur.fetchall()


def write_results(cur, conn, company_id: int, result: dict):
    cur.execute("""
        UPDATE cvc.companies
        SET industrial_readiness_score = %s,
            sovereignty_score          = %s,
            protocol_support           = %s,
            deployment_signal_level    = %s,
            verified_certs             = %s,
            integration_notes          = %s,
            intel_sources              = %s
        WHERE id = %s
    """, (
        result.get("industrial_readiness_score"),
        result.get("sovereignty_score"),
        json.dumps(result.get("protocol_support") or []),
        result.get("deployment_signal_level"),
        json.dumps(result.get("verified_certs") or []),
        result.get("integration_notes", ""),
        json.dumps(result.get("sources") or []),
        company_id,
    ))
    conn.commit()


# ── Core enrichment loop ──────────────────────────────────────────────────────


# ── PDF extraction ─────────────────────────────────────────────────────────────

def extract_pdf_text(url: str) -> str:
    """Download a PDF and extract text. Returns empty string on failure."""
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; CVCResearch/1.0)"},
            timeout=20,
            stream=True,
        )
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "")
        if "pdf" not in content_type.lower() and not url.lower().endswith(".pdf"):
            return ""
        from io import BytesIO
        from pdfminer.high_level import extract_text as pdf_extract
        pdf_bytes = BytesIO(resp.content)
        text = pdf_extract(pdf_bytes)
        return text[:5000] if text else ""
    except Exception as e:
        print(f"    PDF extract error ({url}): {e}")
        return ""


def find_pdf_links(page_text: str, base_url: str) -> list:
    """Extract PDF URLs from scraped page text."""
    import re
    from urllib.parse import urljoin
    raw = re.findall(r'https?://[^\s"\'<>]+\.pdf', page_text, re.IGNORECASE)
    rel = re.findall(r'(?:href|src)=["\']([^"\']*\.pdf)["\']', page_text, re.IGNORECASE)
    resolved = [urljoin(base_url, r) for r in rel]
    return list(dict.fromkeys(raw + resolved))[:5]


def search_cert_pdfs(name: str) -> str:
    """Search Brave for company certification and datasheet PDFs."""
    queries = [
        f'"{name}" safety certification ISO UL filetype:pdf',
        f'"{name}" technical datasheet specification filetype:pdf',
        f'"{name}" TAA compliance NDAA certification',
    ]
    results = []
    for q in queries:
        text = brave_search(q)
        if text:
            results.append(text)
        time.sleep(1.5)
    return " ".join(results)[:4000]


def deep_scan_company(name: str, website: str, page_texts: dict) -> str:
    """
    Deep scan mode: find and extract PDF datasheets and cert docs.
    Returns concatenated PDF text for LLM context.
    """
    all_pdf_text = []

    for label, text in page_texts.items():
        if not text:
            continue
        pdf_links = find_pdf_links(text, website)
        if pdf_links:
            print(f"    Found {len(pdf_links)} PDF(s) on {label} page")
        for pdf_url in pdf_links:
            print(f"    Fetching: {pdf_url[:80]}")
            pdf_text = extract_pdf_text(pdf_url)
            if pdf_text:
                all_pdf_text.append(f"[PDF: {pdf_url}]\n{pdf_text}")
            time.sleep(1)

    print(f"    Brave search: cert/datasheet PDFs")
    cert_text = search_cert_pdfs(name)
    if cert_text:
        all_pdf_text.append(f"[Cert/datasheet search results]\n{cert_text}")

    return "\n\n".join(all_pdf_text)[:8000]


def brave_search(query: str) -> str:
    """Run a Brave search and return concatenated snippets. Tries backup key on 429."""
    primary = os.environ.get("BRAVE_SEARCH_KEY", "")
    backup  = os.environ.get("BRAVE_SEARCH_KEY_BACKUP", "")

    def _call(key: str) -> str:
        resp = requests.get(
            "https://api.search.brave.com/res/v1/web/search",
            headers={"Accept": "application/json", "X-Subscription-Token": key},
            params={"q": query, "count": 5},
            timeout=15,
        )
        resp.raise_for_status()
        results = resp.json().get("web", {}).get("results", [])
        return " ".join(r.get("description", "") for r in results)[:3000]

    for key in filter(None, [primary, backup]):
        try:
            return _call(key)
        except Exception as e:
            if "429" in str(e) and key == primary and backup:
                continue  # try backup
            print(f"    Brave search error: {e}")
            return ""
    return ""


def enrich_company(company: dict, deep_scan: bool = False) -> dict | None:
    name    = company["name"]
    website = (company["website"] or "").rstrip("/")
    sector  = company["sector"] or ""
    desc    = (company["description"] or "")[:800]

    if not website:
        print(f"    No website — skipping")
        return None

    page_urls = build_page_urls(website)
    print(f"    Crawling docs...")
    docs_text    = scrape_best(page_urls["docs"])
    print(f"    Crawling careers...")
    careers_text = scrape_best(page_urls["careers"])

    # Also scrape main website as baseline if subpages fail
    if not docs_text:
        homepage = scrape(website)
        docs_text = clean_text(homepage)
        if docs_text:
            print(f"    Docs fallback: using homepage ({len(docs_text)} chars)")

    # Fall back to Brave Search if scraping is still thin
    if not docs_text or len(docs_text) < 200:
        print(f"    Brave search: docs/tech context")
        docs_text = brave_search(f"{name} industrial integration protocols OPC-UA ROS2 technical specifications")
        time.sleep(2)
    if not careers_text or len(careers_text) < 200:
        print(f"    Brave search: hiring signals")
        careers_text = brave_search(f"{name} hiring field service technician deployment engineer commissioning jobs")
        time.sleep(1)

    prompt = EXTRACTION_PROMPT.format(
        name=name,
        sector=sector,
        url=website,
        docs_text=(docs_text[:4000] if docs_text else "No data"),
        careers_text=(careers_text[:3000] if careers_text else "No data"),
        description=desc,
    )

    # Deep scan: fetch PDFs and add hardening/cert context to prompt
    if deep_scan:
        print(f"    Deep scan: searching for datasheets and cert docs...")
        pdf_text = deep_scan_company(name, website, {"docs": docs_text, "careers": careers_text})
        if pdf_text:
            print(f"    Deep scan: {len(pdf_text)} chars of PDF/cert content")
            prompt += DEEP_SCAN_SUFFIX.format(pdf_text=pdf_text[:6000])
        else:
            print(f"    Deep scan: no PDF content found")

    raw = call_llm(prompt)
    if not raw:
        print(f"    LLM returned empty response")
        return None
    result = parse_json(raw)

    if not result:
        print(f"    LLM parse failed. Raw ({len(raw)} chars): {raw[:300]}")
        return None

    return result


def run(batch_size: int = 20, company_name: str = None, deep_scan: bool = False):
    if not OPENROUTER_KEY:
        print("ERROR: OPENROUTER_API_KEY not set")
        sys.exit(1)

    conn = psycopg2.connect(**DB_CONFIG)
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    companies = fetch_companies(cur, batch_size, company_name)
    if not companies:
        print("No companies found matching criteria.")
        conn.close()
        return

    mode = "DEEP SCAN (hardening + cert PDFs)" if deep_scan else "standard"
    print(f"\nProcessing {len(companies)} companies — mode: {mode}\n")

    enriched = failed = skipped = 0
    high_alpha_alerts = []

    for i, company in enumerate(companies):
        name = company["name"]
        print(f"[{i+1}/{len(companies)}] {name} ({company['sector']})")

        result = enrich_company(company, deep_scan=deep_scan)

        if not result:
            failed += 1
            print(f"    FAILED\n")
            continue

        write_results(cur, conn, company["id"], result)
        enriched += 1

        score      = result.get("industrial_readiness_score", "?")
        sov        = result.get("sovereignty_score", "?")
        signal     = result.get("deployment_signal_level", "?")
        certs      = result.get("verified_certs") or []
        protocols  = result.get("protocol_support") or []

        print(f"    Readiness: {score}/10 | Sovereignty: {sov}/10 | Signal: {signal}")
        print(f"    Certs: {certs or 'none'} | Protocols: {protocols or 'none'}")

        if result.get("high_alpha_signal") and result.get("alpha_reason"):
            reason = result["alpha_reason"]
            high_alpha_alerts.append(f"* {name}: {reason}")
            print(f"    HIGH ALPHA: {reason}")

        print()
        time.sleep(3)

    conn.close()

    print("=" * 50)
    print(f"DONE: {enriched} enriched | {failed} failed | {skipped} skipped")
    print("=" * 50)

    # Send Telegram summary
    summary_lines = [
        f"Industrial Alpha enrichment complete.",
        f"{enriched} companies enriched | {failed} failed",
    ]
    if high_alpha_alerts:
        summary_lines.append(f"\nHigh Alpha Signals ({len(high_alpha_alerts)}):")
        summary_lines.extend(high_alpha_alerts[:5])  # cap at 5 in one message
    telegram("\n".join(summary_lines))


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="CVC Industrial Alpha Enrichment — Phase 3")
    parser.add_argument("--limit",          type=int,   default=20,   help="Max companies to process (default: 20)")
    parser.add_argument("--company",        type=str,   default=None, help="Single company name (ILIKE match)")
    parser.add_argument("--deep-scan-pdfs", action="store_true",      help="Fetch datasheets and cert PDFs for hardening/sovereignty analysis")
    args = parser.parse_args()

    print("=" * 50)
    print("CVC Industrial Alpha Enrichment")
    if args.deep_scan_pdfs:
        print("MODE: Deep Scan — Hardening + Cert Discovery")
    print("=" * 50)

    run(batch_size=args.limit, company_name=args.company, deep_scan=args.deep_scan_pdfs)
