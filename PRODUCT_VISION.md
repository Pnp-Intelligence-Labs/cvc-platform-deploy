# Plug and Play Vertical OS — Product Vision

## What It Is

A self-hosted internal operations platform for venture capital teams. Replaces spreadsheets, scattered CRMs, and disconnected tools with a single authenticated web application owned entirely by the team.

**Internal ops, not client-facing.** The platform is built for the ventures team — sourcing, deal tracking, partner relationships, service requests, and accountability. Client-facing reporting (LP portal, etc.) ships as optional plugins.

---

## Core Principle

Teams should own their data and their workflow. Every deployment is a private instance on the team's own infrastructure. No shared database, no SaaS vendor dependency.

---

## Who It's For

Any venture team — corporate venture, independent VC, family office — that wants:
- A unified workspace replacing disconnected tools
- Data they control, not locked in a third-party system
- Accountability and attribution across the team
- A platform that grows with optional plugins as the team scales

---

## Core Features (Every Deployment)

| Feature | What It Does |
|---|---|
| **Homepage** | Configurable team + personal widgets. Google Calendar integration. Team leaderboards. |
| **Ventures** | Startup database (CSV import), deal flow, company profiles by vertical, portfolio tab |
| **Partners** | Partner CRM — team manages their own partner data, relationship history |
| **Sales Pipeline** | Deal stage tracking, leaderboard, contact management |
| **Requests** | PSM submits service requests → routes to ventures team for assignment + execution |
| **Quick Notes** | Lightweight meeting notes with context tagging |
| **Legacy Export** | CSV export to feed data to external/legacy systems |

---

## Plugin Layer (Optional, Installed Separately)

Plugins extend the platform without touching core code. Each team chooses what to install.

| Plugin | What It Adds |
|---|---|
| LP Portal | Fund metrics, LP-facing reporting |
| Advisory Terminal | Partner compatibility engine, protocol matching |
| Industrial Matrix | Sector readiness scoring |
| Intelligence Feed | Weekly briefing pipeline, trend reports |
| DD Pipeline | Due diligence workflow + dataroom processing |
| Portfolio News | Company news tracking (Brave Search) |
| Meeting Intelligence | Calendar activity tracking + pre-meeting briefings |

---

## Data Architecture

- **Self-hosted:** Each team runs their own PostgreSQL instance
- **Single tenant:** No shared data between teams
- **Plugin migrations:** Each plugin adds its own tables when installed
- **Legacy sync:** One-way CSV/API export to feed existing systems

---

## Platform Name

**Plug and Play Vertical OS** — teams install it, configure it for their vertical, and run.
