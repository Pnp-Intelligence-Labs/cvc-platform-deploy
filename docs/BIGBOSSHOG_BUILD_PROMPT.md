# BigBossHog — Platform Build Prompt
**Updated: 2026-03-17**

---

## IMPORTANT: Division of Labor

BigBossHog does NOT write code files. Claude Code handles all file writing and pushes to GitHub.

**BigBossHog's role:**
- `git pull` to get the latest code
- Start, stop, restart the server
- Run curl tests and report results
- Report errors exactly as they appear

**Claude Code's role:**
- Write all Python and HTML files
- Fix bugs and push to GitHub
- Review DB schemas before writing queries

If BigBossHog tries to write a Python or HTML file directly via shell, stop and instead report what needs to be built. Claude Code will write it and push.

---

## Current State (as of 2026-03-17)

Phases 1 and 2 are built. See `docs/PROGRESS.md` for full status.

The server runs on Refinery (`ssh refinery`), port 8001.

To get current:
```bash
ssh refinery
cd ~/repos/cvc-intelligence
git pull
pkill -f "uvicorn api.main" 2>/dev/null; sleep 1
uvicorn api.main:app --host 0.0.0.0 --port 8001 &
sleep 2
curl http://localhost:8001/health
```

---

## Your Job Right Now: Confirm Phase 2 Works

Pull, restart, run the smoke test, and report the full output:

```bash
ssh refinery
cd ~/repos/cvc-intelligence
git pull
pkill -f "uvicorn api.main" 2>/dev/null; sleep 1
uvicorn api.main:app --host 0.0.0.0 --port 8001 &
sleep 3
python tests/smoke_test.py
```

Report the complete output of `smoke_test.py` back to Nate.

Do NOT try to fix errors yourself. Report them and Claude Code will fix.

---

## If the Gateway Goes Down

See `/root/.openclaw/workspace/TROUBLESHOOTING.md` — report the issue to Nate so Claude Code can restart the gateway via SSH.

---

## Reference

- Full product plan: `docs/PRODUCT_VISION.md`
- Current build status: `docs/PROGRESS.md`
- **DB schema (column names, types, gotchas): `docs/SCHEMA.md` — read this before writing any SQL**
- GitHub: https://github.com/natelouie11-tech/NEW-CVC-REPO
