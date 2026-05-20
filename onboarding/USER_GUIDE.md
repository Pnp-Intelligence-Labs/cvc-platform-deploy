# Vertical OS — User Guide

A plain-English guide to using the platform day-to-day.
No technical background required.

---

## What This Platform Is

A private, internal operations hub for your venture team.
Everything lives on your own server — no data goes to third parties.

**Core sections:**
- **Ventures** — your company database and deal pipeline
- **Partners** — corporate partner CRM
- **Sales** — outbound pipeline tracking
- **Requests** — inbound partnership requests
- **Homepage** — your dashboard

Optional sections (if installed by your admin):
- Enrichment, LP Portal, News Feed, Intelligence Feed, Reports, Industrial Matrix

---

## Your Role

Your role controls what you can see and do.

| Role | What you can access |
|---|---|
| **GP** | Everything — full admin, all data, all settings |
| **Principal / Director** | Everything except system configuration |
| **Ventures** | Companies, deal flow, DD, fund metrics |
| **PSM** | Your assigned partners only — no fund data |

Your role is set by your admin when your account is created.
You can see your role in the top-right corner of the navbar.

---

## Logging In

Go to the URL your admin gave you (usually `http://your-server:8002/app`
or a custom domain).

Enter your username and password. If this is your first login,
your admin will have given you a temporary password — change it immediately:

1. Click your name in the top-right corner
2. Select **Change Password**
3. Enter your current password and choose a new one

---

## Homepage

The homepage shows a summary of recent activity across the team.
What you see depends on your role:

- **GP / Principal / Director**: team-wide activity, KPIs, pipeline summary, leaderboard
- **Ventures**: deal flow stats, recent company updates, your assigned companies
- **PSM**: your assigned partners, recent partner activity, match updates

---

## Ventures — Company Database

The **Ventures** section is where all companies live.

### Finding a Company

Use the search bar at the top to search by name.
Use the filters (sector, stage, status) to narrow the list.

### Adding a Company

**One at a time:**
1. Click **Add Company** (top-right of the Companies tab)
2. Enter the company URL — the platform will pre-fill what it can
3. Fill in any missing fields and save

**Bulk import (GP / Principal / Director only):**
1. Click **Import CSV** on the Companies tab
2. Upload a spreadsheet exported from any tool (Excel, Airtable, Notion, etc.)
3. The platform matches columns automatically

A sample file is included at `onboarding/sample_companies.csv` — use it as a template.

Supported CSV columns:

| Column | Example |
|---|---|
| `name` *(required)* | Acme Robotics |
| `website` | https://acmerobotics.com |
| `sector` | Robotics |
| `stage` | Series A |
| `hq_city` | Boston |
| `hq_country` | US |
| `founded` | 2021 |
| `employee_count` | 45 |
| `total_raised_usd` | 12000000 |
| `one_liner` | Autonomous warehouse robots |

Column names are case-insensitive. Companies already in the system
(matched by name) are skipped — no duplicates created.

### Company Profile

Click any company to open its profile. From here you can:

- Edit company details (click any field inline)
- View funding history
- Read enrichment data (sector analysis, tech signals)
- See which partners have been matched or introduced
- Log activity and meeting notes
- Track DD status (if Enrichment plugin is installed)

### Pipeline Stages

Companies move through stages as they progress:

| Stage | Meaning |
|---|---|
| **Sourced** | On radar, not yet evaluated |
| **Screening** | Initial review in progress |
| **Meeting** | Active conversations |
| **DD** | Due diligence underway |
| **IC** | Investment committee review |
| **Portfolio** | Invested |
| **Passed** | Reviewed and passed |

Update the stage by clicking it on the company profile.

---

## Partners

The **Partners** section is your corporate partner CRM.

### Finding a Partner

The partner list shows all corporate partners.
Click any partner to open their profile.

### Adding a Partner

**One at a time:**
1. Click **New Partner** (top-right)
2. Fill in the organization name, industry, and contact details
3. Add challenge areas and sectors of interest — these drive company matching

**Bulk import (GP / Principal / Director only):**
1. Click **Import CSV** (top-right)
2. Upload a CSV with your partner list

A sample file is included at `onboarding/sample_partners.csv` — use it as a template.

Supported CSV columns:

| Column | Example |
|---|---|
| `name` *(required)* | Acme Corp |
| `industry` | Automotive |
| `contact_name` | Jane Smith |
| `contact_email` | jane@acmecorp.com |
| `challenge_areas` | Warehouse automation, Last-mile |
| `sectors_of_interest` | Robotics, Logistics |
| `notes` | Met at CES 2025 |

For `challenge_areas` and `sectors_of_interest`: put multiple values
in the same cell, separated by commas.

### Partner Profile

Each partner has a full profile with:

- **Overview** — contact details, industry, challenge areas
- **Matched companies** — startups surfaced as relevant to this partner
- **Notes** — meeting notes and activity log
- **Documents** — uploaded pitch decks, contracts, briefs
- **Contacts** — individual contacts at the organization

### Logging Partner Activity

From the partner profile, click **Add Note** to log:
- A meeting summary
- An email thread summary
- A status update
- Any other free-form note

Notes are timestamped and attributed to your username.

---

## Sales Pipeline

The **Sales** section tracks outbound partner development.

Each row is a target organization you are actively working to engage.
Use stages to track where each relationship stands.

---

## Requests

The **Requests** section is for inbound partnership requests —
companies or organizations that have reached out to the team.

Each request can be assigned to a team member for follow-up
and moved through a simple triage workflow.

---

## Your Account

### Changing Your Password

1. Click your name in the top-right corner of the navbar
2. Select **Change Password**
3. Enter your current password, then your new password twice

### What Your Admin Can Do

Admins (GP / Principal / Director) can:
- Reset your password on your behalf (via Admin → Team → your user card)
- Update your role
- Assign you to partners (for PSM users)
- Deactivate your account

---

## Getting Help

If something is broken or missing:
- Check with your admin first — they may need to install a plugin or run a migration
- Ask your admin to check **Admin → System** for plugin health status
- If the page shows a blank screen, the API may be down — ask your admin to check the server

---

## Tips

- **Search works everywhere.** Use it before adding — avoid duplicates.
- **CSV import is idempotent.** You can re-upload the same file; existing records are skipped.
- **Notes are permanent.** There is no delete on notes — write carefully.
- **Your data is private.** Nothing leaves your server. No analytics, no tracking.
