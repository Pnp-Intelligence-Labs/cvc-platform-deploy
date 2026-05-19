"""
workers/tasks/task_worker_agent.py — Agentic worker for medium/high risk tasks.

Uses Kimi K2.5 with tool_use (function calling) so Big Claw can read existing files,
write code, verify syntax, and iterate — rather than guessing blind in one shot.

Runs on:  Dell server / Big Claw (100.83.104.117)
Start:    nohup python3 workers/tasks/task_worker_agent.py >> ~/logs/task_agent.log 2>&1 &
Handles:  medium + high risk tasks only
          (task_worker.py handles low risk)
"""
import glob as glob_module
import json
import os
import re
import shlex
import select
import subprocess
import sys
import traceback

# Force unbuffered output so nohup logs are written in real time
sys.stdout = os.fdopen(sys.stdout.fileno(), "w", buffering=1)
sys.stderr = os.fdopen(sys.stderr.fileno(), "w", buffering=1)

# ── .env loading ──────────────────────────────────────────────────────────────

for _env_path in [
    os.path.expanduser("~/repos/cvc-intelligence/.env"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env"),
]:
    if os.path.exists(_env_path):
        with open(_env_path) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith("#") and "=" in _line:
                    _k, _v = _line.split("=", 1)
                    os.environ.setdefault(_k.strip(), _v.strip())
        break

import requests
from core.db.connection import get_connection



def _log_llm_usage(activity, model, usage):
    """Fire-and-forget: write one LLM call to cvc.llm_usage_log."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO cvc.llm_usage_log "
                    "(activity, model, prompt_tokens, completion_tokens, cost) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (activity, model.split("/")[-1],
                     usage.get("prompt_tokens", 0),
                     usage.get("completion_tokens", 0),
                     usage.get("cost", 0)),
                )
    except Exception:
        pass

REPO_ROOT  = os.path.expanduser("~/repos/cvc-intelligence")
MAX_TURNS  = 30
LLM_MODEL  = "qwen/qwen3-235b-a22b-2507"  # strong tool_use support
# Fallback poll interval (seconds) — only fires if a NOTIFY is somehow missed
FALLBACK_POLL = 300

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_URL     = "https://openrouter.ai/api/v1/chat/completions"

# ── Repo context ───────────────────────────────────────────────────────────────

REPO_STRUCTURE = """
cvc-intelligence/
  api/
    main.py           -- FastAPI app (port 8001). All router prefixes set here via
                         include_router(prefix=...). NEVER set prefix in APIRouter().
                         NEVER rewrite from scratch — read first, append only new lines.
    auth.py           -- HTTP Basic auth (require_auth dependency)
    routes/           -- FastAPI routers: companies, trends, sourcing, shortlists,
                         enrichment, tasks, dealflow, intelligence, partners, lp,
                         industrial, portfolio
    static/app/       -- Built React app (Vite). Served at /app. Do not edit directly.
  designs/figma-dashboard/src/app/
    pages/            -- React page components (TSX)
    components/       -- Shared React components (CVCNavbar, etc.)
    api/client.ts     -- All API calls go through this object (export const api = {...})
  core/db/
    connection.py     -- get_connection() context manager
    migrations/       -- SQL migrations (NNN_name.sql). Next: 043_...

LIVE API ENDPOINTS (exact paths — do not invent new ones):
  GET  /companies/?                    -- search: params q, sector, stage, limit, offset
  GET  /companies/sectors              -- distinct sector values
  GET  /companies/{id}                 -- single company detail
  GET  /trends/sectors
  GET  /trends/quarters
  GET  /trends/dashboard               -- params: sector, quarter
  GET  /trends/funding                 -- params: sector, quarter
  GET  /sourcing/?                     -- sourcing targets with filters
  GET  /shortlists/
  POST /shortlists/
  GET  /shortlists/{id}/companies
  POST /shortlists/{id}/companies
  GET  /tasks/                         -- param: status
  POST /tasks/
  GET  /tasks/{task_id}
  POST /tasks/{task_id}/approve
  GET  /dealflow/
  GET  /dealflow/stats
  POST /dealflow/intake                -- find-or-create company + set pipeline status
  POST /dealflow/upload/{company_id}   -- write dataroom files to staging dir
  POST /dealflow/{company_id}/status
  GET  /intelligence
  GET  /intelligence/{sector}
  GET  /partners/                      -- list all partners
  POST /partners/                      -- create partner
  GET  /partners/issues/all            -- all issues across all partners (param: severity)
  GET  /partners/documents/search      -- full-text search (param: q)
  GET  /partners/{id}                  -- partner detail (includes matches, notes)
  PATCH /partners/{id}
  DELETE /partners/{id}
  GET  /partners/{id}/contacts
  POST /partners/{id}/contacts
  PATCH /partners/{id}/contacts/{contact_id}
  DELETE /partners/{id}/contacts/{contact_id}
  GET  /partners/{id}/documents
  POST /partners/{id}/documents        -- multipart upload (file, source_label)
  GET  /partners/{id}/documents/{doc_id}/text
  GET  /partners/{id}/documents/{doc_id}/download
  DELETE /partners/{id}/documents/{doc_id}
  GET  /partners/{id}/contract
  GET  /partners/{id}/contract/file
  GET  /partners/{id}/services         -- param: year (default 2026)
  POST /partners/{id}/services
  PATCH /partners/{id}/services/{svc_id}
  DELETE /partners/{id}/services/{svc_id}
  GET  /partners/{id}/issues
  POST /partners/{id}/issues
  PATCH /partners/{id}/issues/{issue_id}
  DELETE /partners/{id}/issues/{issue_id}
  GET  /partners/{id}/issues/{issue_id}/comments
  POST /partners/{id}/issues/{issue_id}/comments
  GET  /partners/{id}/advisory-logs
  POST /partners/{id}/advisory-logs
  GET  /partners/{id}/compatibility
  GET  /partners/{id}/matches
  POST /partners/{id}/matches
  PUT  /partners/{id}/matches/{match_id}
  GET  /lp/overview
  GET  /lp/sectors
  GET  /lp/signals
  GET  /industrial/
  GET  /portfolio/
  GET  /health
  GET  /app, /app/{path}              -- React SPA (catch-all)

DB SCHEMA (PostgreSQL, schema=cvc) — USE EXACT COLUMN NAMES:
  cvc.companies         -- id, name, one_liner, description, website,
                           hq_city, country (NOT hq_state),
                           sector, subsector, stage, employee_count,
                           founded (NOT founded_year),
                           total_raised_usd (NOT revenue_usd),
                           investors (TEXT[]), verticals (TEXT[]), tags (TEXT[]),
                           is_hardware (BOOL), is_software (BOOL), is_portfolio (BOOL),
                           score_composite, score_commercial, score_technical,
                           score_market_timing, score_partner_fit, score_capital_eff,
                           score_irs, score_sri, score_tdf,
                           env_4d, func_4d, stack_4d, biz_model_4d,
                           intro_count, intro_partners (JSONB), last_intro_date,
                           enrichment_status, scored_at, created_at, updated_at

  cvc.funding_rounds    -- id, company_id (FK), round_type, amount_usd,
                           announced_date, lead_investor

  cvc.content_items     -- id, company_id (FK), title, url, source,
                           published_at, signal_type, summary

  cvc.company_lifecycle -- company_id (FK, UNIQUE), status, status_changed_at,
                           changed_by, reason, created_at
                           status values: discovered, due_diligence, invested, passed

  cvc.build_tasks       -- task_id, spec, priority, risk_level, requires_approval,
                           status, created_by, assigned_to, commit_hash,
                           nate_approved_at, created_at, started_at, completed_at,
                           deployed_at, status_changed_at, notes, retry_count

  cvc.partners          -- id, name, industry, contact_name, contact_email,
                           challenge_areas (TEXT[]), sectors_of_interest (TEXT[]),
                           environments (TEXT[]), notes,
                           current_protocols (TEXT[]), cloud_platform,
                           hardware_vendors (TEXT[]), factory_regions (TEXT[]),
                           scaling_speed (fast|medium|slow),
                           created_at, updated_at
                           IMPORTANT: NO firm_type, NO focus_sectors, NO stage_focus

  cvc.partner_matches   -- id, partner_id (FK), company_id (FK), match_score,
                           match_reason, status, created_at

  cvc.partner_contacts  -- id, partner_id (FK), name, title, email, phone,
                           is_primary (BOOL), created_at

  cvc.partner_documents -- id, partner_id (FK), filename, file_type, raw_text,
                           file_data (BYTEA), source_label, parsed (BOOL),
                           uploaded_at

  cvc.partner_contracts -- id, partner_id (FK), title, term_start, term_end,
                           value, summary, filename, file_type, file_data (BYTEA),
                           created_at

  cvc.partner_service_usage -- id, partner_id (FK), service_name, service_key,
                               quantity_included, quantity_used, notes, year,
                               updated_at

  cvc.partner_notes     -- id, partner_id (FK), body, created_at, created_by

  cvc.partner_issues    -- id, partner_id (FK), title, body, severity (high|medium|low),
                           due_date, linked_document_id (FK partner_documents),
                           resolved (BOOL), created_at, updated_at

  cvc.partner_issue_comments -- id, issue_id (FK partner_issues CASCADE DELETE),
                                body, created_by, created_at

  cvc.partner_advisory_logs -- id, partner_id (FK), log_type, body, company_id (FK),
                               meeting_date, outcome, next_steps, source_url, created_at

  cvc.shortlists        -- id, name, description, created_by, created_at
  cvc.shortlist_companies -- id, shortlist_id (FK), company_id (FK), added_at

  trend_report schema (schema=trend_report):
    raw_signals, funding_events, hiring_signals, patent_signals,
    earnings_signals, report_drafts
    quarter format: YYYY-QN (e.g. 2025-Q4)
    sector_tags values: robotics, supply_chain, industrial_auto, physical_ai

REACT APP CONVENTIONS:
  - Source: designs/figma-dashboard/src/app/
  - All API calls go through: import { api } from '../api/client'
  - Router: react-router v7. Nav: CVCNavbar component.
  - Styling: Tailwind. Navy=#253B49, Yellow=#F0E545, bg=#F5F5F7. Icons: lucide-react.
  - After editing TSX: run `cd designs/figma-dashboard && npm run build`
    Built assets go to api/static/app/ — commit them too.

PYTHON CONVENTIONS:
  - DB: from core.db.connection import get_connection
        with get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
              # rows are dicts — row["column_name"], never row[0]
  - No ORM, no SQLAlchemy
  - FastAPI: APIRouter() with no prefix — prefix set in main.py include_router()
  - Sector values (Title Case): Supply Chain, Robotics, Manufacturing,
    Industrial Automation, Physical AI — NEVER snake_case

PROTECTED FILES — edit only, NEVER replace wholesale:
  api/main.py, api/auth.py, core/db/connection.py, workers/tasks/task_worker_agent.py
  These files have a diff size guard: if your write removes >2x the lines it adds,
  the commit will be BLOCKED and the task will fail. Read first, make targeted edits.

CRITICAL RULES:
  1. NEVER rewrite api/main.py from scratch — read it first, append only new lines
  2. NEVER use column names not in DB SCHEMA above
  3. NEVER use firm_type, focus_sectors, or stage_focus — they don't exist in cvc.partners
  4. Route prefix ALWAYS set in main.py include_router(prefix=...), never in APIRouter()
  5. All new SQL DDL in core/db/migrations/NNN_name.sql — never inline
  6. After writing each Python file, verify it compiles with py_compile
  7. investors, tags, verticals are TEXT[] — never use ::jsonb or json.dumps() on them
  8. Sector values are Title Case in cvc.companies — never snake_case
"""

# ── Tool definitions ───────────────────────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read an existing file from the CVC Intelligence repo. Always call this before modifying a file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path relative to repo root, e.g. api/main.py"
                    }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write content to a file in the repo. Creates parent directories if needed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path relative to repo root"
                    },
                    "content": {
                        "type": "string",
                        "description": "Complete file content to write"
                    }
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files matching a glob pattern in the repo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern relative to repo root, e.g. api/routes/*.py"
                    }
                },
                "required": ["pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "bash_exec",
            "description": "Run a safe shell command in the repo directory. Use for: python3 -m py_compile <file>, python3 -c 'import X', grep, ls, cat. Do NOT use for: rm, git push, git commit, pip install, curl.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to run"
                    }
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "done",
            "description": "Signal that all files are written and verified. Call this when the task is complete.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "Brief summary of what was built and which files were created/modified"
                    }
                },
                "required": ["summary"]
            }
        }
    }
]

# ── Tool execution ─────────────────────────────────────────────────────────────

_ALLOWED_COMMANDS = {"git", "ls", "node", "npm", "pwd", "python", "python3", "pytest", "rg", "ruff"}
_BLOCKED_GIT = {"push", "commit", "reset", "clean", "checkout", "rebase", "merge"}
_BLOCKED_NPM = {"add", "install", "publish", "remove", "uninstall"}


def tool_read_file(path: str) -> str:
    full = os.path.join(REPO_ROOT, path.lstrip("/"))
    if not os.path.exists(full):
        return f"ERROR: File not found: {path}"
    try:
        with open(full) as f:
            content = f.read()
        if len(content) > 6000:
            return content[:6000] + f"\n... [truncated — {len(content)} total chars]"
        return content
    except Exception as e:
        return f"ERROR reading {path}: {e}"


def tool_write_file(path: str, content: str, written_files: dict) -> str:
    if path == "api/main.py":
        content = _merge_main_py(content)
        print(f"[agent] write_file: api/main.py (merged)")
    full = os.path.join(REPO_ROOT, path.lstrip("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(content)
    written_files[path] = content
    print(f"[agent] write_file: {path} ({len(content)} chars)")
    return f"OK: wrote {path}"


def tool_list_files(pattern: str) -> str:
    full_pattern = os.path.join(REPO_ROOT, pattern.lstrip("/"))
    matches = glob_module.glob(full_pattern, recursive=True)
    paths = [os.path.relpath(m, REPO_ROOT) for m in sorted(matches)]
    return "\n".join(paths) if paths else "(no matches)"


def tool_bash_exec(command: str) -> str:
    try:
        args = shlex.split(command)
    except ValueError as e:
        return f"ERROR: Invalid command: {e}"
    if not args:
        return "ERROR: Empty command"
    executable = os.path.basename(args[0])
    if executable not in _ALLOWED_COMMANDS:
        return f"ERROR: Command '{executable}' is not allowed. Use safe read/verify commands only."
    if executable == "git" and len(args) > 1 and args[1] in _BLOCKED_GIT:
        return f"ERROR: git {args[1]} is not allowed from this tool."
    if executable == "npm" and len(args) > 1 and args[1] in _BLOCKED_NPM:
        return f"ERROR: npm {args[1]} is not allowed from this tool."
    try:
        result = subprocess.run(
            args, capture_output=True, text=True,
            cwd=REPO_ROOT, timeout=30
        )
        output = (result.stdout + result.stderr).strip()
        if not output:
            output = f"(exit code {result.returncode})"
        return output[:3000]
    except subprocess.TimeoutExpired:
        return "ERROR: Command timed out after 30s"
    except Exception as e:
        return f"ERROR: {e}"


def _merge_main_py(agent_content: str) -> str:
    """
    Surgical merge: extract new router lines from agent's main.py
    and insert them into the real main.py before the health check.

    Captures complete UI route blocks (decorator + async def + body lines)
    so empty function bodies don't crash the API on import.
    """
    main_path = os.path.join(REPO_ROOT, "api/main.py")
    if not os.path.exists(main_path):
        return agent_content  # no existing file, use agent's version

    with open(main_path) as f:
        current = f.read()

    current_set = set(current.splitlines())
    new_imports  = []
    new_routers  = []
    new_ui_blocks = []  # each entry is a complete block string

    agent_lines = agent_content.splitlines()
    i = 0
    while i < len(agent_lines):
        line = agent_lines[i]
        s    = line.strip()

        if not s:
            i += 1
            continue

        # New router import
        if re.match(r"from api\.routes\.\w+ import", s) and line not in current_set:
            new_imports.append(line)
            i += 1
            continue

        # New include_router call
        if s.startswith("app.include_router(") and line not in current_set:
            new_routers.append(line)
            i += 1
            continue

        # UI route block — match any @app.get("/...-ui") or "/...-ui/{param}"
        if re.match(r'@app\.get\("/', s) and "-ui" in s and line not in current_set:
            block   = [line]
            i      += 1
            in_func = False
            while i < len(agent_lines):
                bl = agent_lines[i]
                bs = bl.strip()
                if bs.startswith("async def "):
                    block.append(bl)
                    in_func = True
                    i += 1
                elif in_func and (bl.startswith("    ") or bl.startswith("\t")):
                    # function body lines (return FileResponse(...), etc.)
                    block.append(bl)
                    i += 1
                else:
                    break  # blank line or next non-body line ends the block
            new_ui_blocks.append("\n".join(block))
            continue

        i += 1

    if not new_imports and not new_routers and not new_ui_blocks:
        print("[agent] main.py: no new routes found, keeping current version")
        return current

    cur_lines  = current.splitlines()
    health_idx = next(
        (j for j, l in enumerate(cur_lines) if '@app.get("/health")' in l),
        len(cur_lines)
    )

    insert = []
    insert.extend(new_imports)
    insert.extend(new_routers)
    if new_ui_blocks:
        insert.append("")
        for block in new_ui_blocks:
            insert.extend(block.splitlines())
            insert.append("")

    merged = "\n".join(cur_lines[:health_idx] + insert + cur_lines[health_idx:])
    if not merged.endswith("\n"):
        merged += "\n"

    print(f"[agent] main.py merged: +{len(new_imports)} imports, "
          f"+{len(new_routers)} routers, +{len(new_ui_blocks)} UI route blocks")
    return merged


def dispatch_tool(name: str, args: dict, written_files: dict):
    try:
        if name == "read_file":
            if "path" not in args:
                return "ERROR: read_file requires 'path' argument"
            return tool_read_file(args["path"])
        elif name == "write_file":
            if "path" not in args:
                return "ERROR: write_file requires 'path' argument — provide {\"path\": \"...\", \"content\": \"...\"}"
            if "content" not in args:
                return "ERROR: write_file requires 'content' argument"
            return tool_write_file(args["path"], args["content"], written_files)
        elif name == "list_files":
            if "pattern" not in args:
                return "ERROR: list_files requires 'pattern' argument"
            return tool_list_files(args["pattern"])
        elif name == "bash_exec":
            if "command" not in args:
                return "ERROR: bash_exec requires 'command' argument"
            return tool_bash_exec(args["command"])
        elif name == "done":
            return f"DONE: {args.get('summary', '')}"
        return f"ERROR: Unknown tool: {name}"
    except Exception as e:
        return f"ERROR in {name}: {e}"


# ── LLM call with tools ────────────────────────────────────────────────────────

def call_with_tools(messages: list) -> dict:
    """Call OpenRouter with tool_use. Returns the choice dict."""
    resp = requests.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/natelouie11-tech",
            "X-Title": "CVC Task Agent",
        },
        json={
            "model": LLM_MODEL,
            "messages": messages,
            "tools": TOOLS,
            "tool_choice": "auto",
            "temperature": 0.1,
            "max_tokens": 8192,
        },
        timeout=300,
    )
    resp.raise_for_status()
    data   = resp.json()
    choice = data["choices"][0]

    usage = data.get("usage", {})
    if usage:
        print(f"    [{LLM_MODEL.split('/')[-1]}] tokens: {usage.get('prompt_tokens',0)}p + "
              f"{usage.get('completion_tokens',0)}c | ${usage.get('cost',0):.4f}")
        _log_llm_usage("Big Claw", LLM_MODEL, usage)

    finish     = choice.get("finish_reason", "?")
    tool_calls = choice["message"].get("tool_calls") or []
    content    = (choice["message"].get("content") or "")[:100]
    print(f"    [api] finish={finish} tool_calls={len(tool_calls)} content={repr(content)}")

    return choice


# ── Agent loop ─────────────────────────────────────────────────────────────────

def run_agent(task_id: int, spec: str) -> dict:
    """
    Run the agentic build loop. Returns dict of {path: content} for written files.
    """
    system = (
        "You are Big Claw, an agentic code generator for the CVC Intelligence Platform.\n"
        "You have tools to read files, write files, list files, and run shell commands.\n\n"
        "WORKFLOW:\n"
        "1. Call read_file on any existing files you plan to modify FIRST\n"
        "2. Write all needed files using write_file\n"
        "3. After each Python file, call bash_exec('python3 -m py_compile <path>') to verify syntax\n"
        "4. Fix any errors before continuing\n"
        "5. Call done() when everything is written and verified\n\n"
        f"{REPO_STRUCTURE}"
    )

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"TASK #{task_id}: {spec}"}
    ]

    written_files = {}

    for turn in range(MAX_TURNS):
        print(f"[agent] Turn {turn + 1}/{MAX_TURNS}")
        choice = call_with_tools(messages)
        message = choice["message"]
        finish  = choice.get("finish_reason", "stop")

        # Add assistant message to history
        messages.append(message)

        tool_calls = message.get("tool_calls") or []

        if not tool_calls:
            # Model responded without calling tools — done
            content = message.get("content", "")
            print(f"[agent] No tool calls. Model says: {content[:200]}")
            break

        # Execute each tool call
        tool_results = []
        done_called  = False

        for tc in tool_calls:
            fn_name = tc["function"]["name"]
            try:
                fn_args = json.loads(tc["function"]["arguments"])
            except json.JSONDecodeError:
                fn_args = {}

            result = dispatch_tool(fn_name, fn_args, written_files)
            tool_results.append({
                "role":         "tool",
                "tool_call_id": tc["id"],
                "content":      str(result),
            })

            if fn_name == "done":
                done_called = True
                print(f"[agent] done() called: {fn_args.get('summary','')}")

        messages.extend(tool_results)

        if done_called:
            break

    else:
        print(f"[agent] Reached MAX_TURNS ({MAX_TURNS}) — using files written so far")

    return written_files


# ── Diff size guard ───────────────────────────────────────────────────────────

def _diff_size_guard(paths: list) -> list:
    """
    Check that no written file shrinks drastically vs HEAD.
    Returns list of (path, lines_added, lines_removed) for violations.
    A violation = file loses more than 2x what it gains AND removes >30 lines.
    Empty return = all clear.
    """
    result = subprocess.run(
        ["git", "diff", "HEAD", "--numstat"] + paths,
        cwd=REPO_ROOT, capture_output=True, text=True
    )
    violations = []
    for line in result.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        added_s, removed_s, filepath = parts
        try:
            added, removed = int(added_s), int(removed_s)
        except ValueError:
            continue  # binary file
        if removed > 30 and removed > added * 2:
            violations.append((filepath, added, removed))
    return violations


# ── Git helpers ────────────────────────────────────────────────────────────────

def _rebase_in_progress() -> bool:
    rebase_dir = os.path.join(REPO_ROOT, ".git", "rebase-merge")
    rebase_apply = os.path.join(REPO_ROOT, ".git", "rebase-apply")
    return os.path.isdir(rebase_dir) or os.path.isdir(rebase_apply)


def _abort_rebase_if_needed():
    if _rebase_in_progress():
        print("[git] Rebase in progress — aborting to recover clean state.")
        subprocess.run(["git", "rebase", "--abort"], cwd=REPO_ROOT)


# ── Preflight ──────────────────────────────────────────────────────────────────

def preflight_check() -> bool:
    _abort_rebase_if_needed()
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=REPO_ROOT, capture_output=True, text=True
    )
    dirty = [l for l in result.stdout.splitlines() if not l.startswith("??")]
    if dirty:
        print(f"[preflight] Dirty tree:\n" + "\n".join(dirty))
        return False
    return True


# ── Task claiming ──────────────────────────────────────────────────────────────

def claim_task():
    """Claim one approved medium/high risk task atomically."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM cvc.build_tasks
                WHERE status = 'approved'
                  AND risk_level IN ('medium', 'high')
                ORDER BY
                    CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                    created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            """)
            row = cur.fetchone()
            if row:
                cur.execute("""
                    UPDATE cvc.build_tasks
                    SET status = 'building',
                        started_at = NOW(),
                        status_changed_at = NOW(),
                        assigned_to = 'bigclaw-agent'
                    WHERE task_id = %s
                """, (row["task_id"],))
    return dict(row) if row else None


# ── Git ────────────────────────────────────────────────────────────────────────

def pull_latest():
    print("[git] Pulling latest from origin/main...")
    subprocess.run(["git", "pull", "origin", "main"], cwd=REPO_ROOT, check=True)


def commit_and_push(task_id: int, spec: str, paths: list) -> str:
    msg = f"Task #{task_id} [agent]: {spec[:60]}"
    subprocess.run(["git", "add"] + paths, cwd=REPO_ROOT, check=True)
    subprocess.run(["git", "commit", "-m", msg], cwd=REPO_ROOT, check=True)
    # Try push; if rejected (remote moved ahead), rebase and retry once
    push_result = subprocess.run(
        ["git", "push", "origin", "main"],
        cwd=REPO_ROOT, capture_output=True, text=True
    )
    if push_result.returncode != 0:
        print(f"[git] Push rejected, rebasing and retrying...\n{push_result.stderr}")
        subprocess.run(["git", "pull", "--rebase", "origin", "main"], cwd=REPO_ROOT, check=True)
        subprocess.run(["git", "push", "origin", "main"], cwd=REPO_ROOT, check=True)
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


def rollback(task_id: int):
    print(f"[agent] Rolling back task #{task_id}...")
    _abort_rebase_if_needed()
    subprocess.run(["git", "reset", "--hard", "HEAD"], cwd=REPO_ROOT)
    subprocess.run(["git", "clean", "-fd"], cwd=REPO_ROOT)
    print(f"[agent] Rollback done.")


# ── DB updates ─────────────────────────────────────────────────────────────────

def update_task_complete(task_id: int, commit_hash: str):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.build_tasks
                SET status = 'complete', commit_hash = %s,
                    completed_at = NOW(), status_changed_at = NOW()
                WHERE task_id = %s
            """, (commit_hash, task_id))


def update_task_failed(task_id: int, error: str):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.build_tasks
                SET status = 'failed', notes = %s, status_changed_at = NOW()
                WHERE task_id = %s
            """, (error[:2000], task_id))


# ── Process task ───────────────────────────────────────────────────────────────

def process_task(task: dict):
    task_id = task["task_id"]
    spec    = task["spec"]
    print(f"\n[agent] Task #{task_id} ({task['risk_level']}): {spec[:80]}")

    try:
        pull_latest()

        if not preflight_check():
            update_task_failed(task_id, "Preflight failed: working tree dirty after pull")
            return

        written_files = run_agent(task_id, spec)

        if not written_files:
            update_task_failed(task_id, "Agent completed but wrote no files")
            return

        print(f"[agent] Wrote {len(written_files)} file(s): {list(written_files.keys())}")
        paths = list(written_files.keys())

        # ── Diff size guard ──────────────────────────────────────────────────
        violations = _diff_size_guard(paths)
        if violations:
            msgs = [f"{p}: +{a}/-{r} lines (removes {r} lines, {r//max(a,1)}x more than adds)"
                    for p, a, r in violations]
            error = (
                "DIFF SIZE GUARD BLOCKED COMMIT — file(s) shrink too drastically:\n"
                + "\n".join(msgs)
                + "\nThis looks like a wholesale file replacement, not an edit. "
                  "Read the existing file and make targeted changes only."
            )
            print(f"[agent] {error}")
            rollback(task_id)
            update_task_failed(task_id, error)
            return
        # ────────────────────────────────────────────────────────────────────

        commit_hash = commit_and_push(task_id, spec, paths)
        update_task_complete(task_id, commit_hash)
        print(f"[agent] Task #{task_id} complete. Commit: {commit_hash[:8]}")

    except Exception:
        error = traceback.format_exc()
        print(f"[agent] Task #{task_id} FAILED:\n{error}")
        rollback(task_id)
        update_task_failed(task_id, error)


# ── Event-driven loop (PostgreSQL LISTEN) ─────────────────────────────────────

def _make_listen_conn():
    """Open a raw psycopg2 connection in autocommit mode for LISTEN."""
    import psycopg2
    import psycopg2.extras
    host     = os.environ.get("CVC_DB_HOST", "100.83.104.117")
    port     = os.environ.get("CVC_DB_PORT", "5432")
    dbname   = os.environ.get("CVC_DB_NAME", "cvc_db")
    user     = os.environ.get("CVC_DB_USER", "producer")
    password = os.environ["CVC_DB_PASSWORD"]
    conn = psycopg2.connect(
        host=host, port=port, dbname=dbname, user=user, password=password,
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    conn.autocommit = True
    return conn


def poll_loop():
    print("[agent] Big Claw agent worker started — event-driven (LISTEN task_approved).")
    listen_conn = None
    while True:
        try:
            # (Re)establish LISTEN connection if needed
            if listen_conn is None:
                listen_conn = _make_listen_conn()
                listen_conn.cursor().execute("LISTEN task_approved;")
                print("[agent] Listening for task_approved notifications. Idle.")

            # Drain any approved tasks immediately on startup or after reconnect
            if preflight_check():
                while True:
                    task = claim_task()
                    if not task:
                        break
                    process_task(task)

            # Wait for a NOTIFY (or fallback timeout to catch any missed events)
            ready = select.select([listen_conn], [], [], FALLBACK_POLL)[0]
            if ready:
                listen_conn.poll()
                while listen_conn.notifies:
                    listen_conn.notifies.pop(0)
                print("[agent] task_approved notification received.")

            # Process all approved tasks now
            if preflight_check():
                while True:
                    task = claim_task()
                    if not task:
                        break
                    process_task(task)

        except Exception:
            print(f"[agent] Error:\n{traceback.format_exc()}")
            try:
                listen_conn.close()
            except Exception:
                pass
            listen_conn = None
            import time; time.sleep(10)


if __name__ == "__main__":
    poll_loop()
