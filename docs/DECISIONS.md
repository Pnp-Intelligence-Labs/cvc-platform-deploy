# Deployment Decisions Log

Tracks key decisions made during the CVC build that a new team needs to understand before deploying.

---

## 2026-04-28 — Initial Setup

### Platform Model
- **Self-hosted, not SaaS.** Each team runs their own instance on their own server.
- **Single tenant per deployment.** No shared DB between teams.
- **Reference implementation:** CVC on Dell R620 (basement server), Tailscale network.

### Role Model
Defined during CVC Phase 1 planning. Every deployment should start with these roles:

| Role | Access |
|------|--------|
| GP | Full access |
| Principal / Director | Full access except build config |
| Ventures | Companies, DD, deal flow, LP fund data |
| PSM | Assigned partners only. No LP fund data. |

### Data Isolation Rule
PSM partner terminal data (notes, documents, service requests) must be **row-level secured at the DB level** — not just filtered in the UI. This is non-negotiable. Each PSM's partner data is private to them + GP/Principal/Director.

### Auth
- Start with JWT (username/password → token). Do not use Basic Auth.
- Tokens carry the user's role.
- Login screen is the entry point.

### What Each New Team Needs to Customize
1. Team name, logo
2. Users and role assignments
3. Partner assignments (PSM → partner mapping)
4. Fund details (fund name, size, vintage)
5. Sector focus (which sectors to track)
6. Corporate partners list
7. Investment thesis (used by enrichment workers)
8. API keys (OpenRouter, Brave Search, Proxycurl)

Everything else is standard platform behavior.
