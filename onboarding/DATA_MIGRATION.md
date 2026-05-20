# Data Migration Guide

How to get your existing deal flow and partner data into the platform.
Covers Airtable, Notion, Excel/Google Sheets, and generic CSVs.

---

## Overview

The platform accepts CSV files for bulk import of:
- **Companies** (your deal flow / startup database)
- **Partners** (your corporate partner CRM)

You don't need to match column names exactly — the importer is flexible.
Existing records (matched by name) are always skipped, so you can
re-run an import safely without creating duplicates.

---

## Exporting from Airtable

### Companies / Deal Flow

1. Open your Airtable base
2. Switch to the **Grid view** that has your company records
3. Click **···** (more options) → **Download CSV**
4. The file downloads with your column names

**Common Airtable → Platform column mapping:**

| Your Airtable column | Platform column |
|---|---|
| Company Name, Name | `name` |
| Website, URL | `website` |
| Sector, Industry, Category | `sector` |
| Stage, Round, Status | `stage` |
| City, HQ City, Location | `hq_city` |
| Country | `hq_country` |
| Founded, Year Founded | `founded` |
| Employees, Headcount, Team Size | `employee_count` |
| Total Raised, Funding, Capital Raised | `total_raised_usd` |
| One Liner, Description, Summary | `one_liner` |

The importer is **case-insensitive** and strips extra spaces.
If your column is named "Company Name" it will match — no renaming needed.

### Partners / Corporate Partners

Same process — export the Partners table as CSV.

**Common Airtable → Platform column mapping:**

| Your Airtable column | Platform column |
|---|---|
| Organization, Company | `name` |
| Industry, Vertical | `industry` |
| Contact, Primary Contact | `contact_name` |
| Email, Contact Email | `contact_email` |
| Pain Points, Challenges | `challenge_areas` |
| Sectors, Focus Areas | `sectors_of_interest` |
| Notes, Comments | `notes` |

For `challenge_areas` and `sectors_of_interest`: if your Airtable uses
a multi-select field, the CSV export will look like `"Robotics, AI, Logistics"` —
that's exactly the format the importer expects.

---

## Exporting from Notion

Notion's CSV export is less clean — here's the reliable way:

1. Open the database page (must be a **Table** view, not a Board or Gallery)
2. Click **···** (top right of the table) → **Export** → **CSV**
3. Choose **Current view** (not "Everything")

Notion exports property names as column headers. Rename them to match
the platform columns before importing, or the importer will just skip
columns it doesn't recognize (your data is safe, just not imported).

**Tip:** Create a filtered Notion view that shows only the columns you want
to import before exporting. Cleaner output = less cleanup.

---

## Exporting from Excel or Google Sheets

**Excel:**
File → Save As → **CSV (Comma delimited)** (`.csv`)
Open the file in a text editor first to confirm it looks right.

**Google Sheets:**
File → Download → **Comma-separated values (.csv)**

**Common issues:**
- **BOM characters**: Some Excel exports add a hidden byte-order mark at the start.
  The importer handles this automatically.
- **Encoding**: Save as UTF-8 if you have non-ASCII characters (accented names, etc.)
- **Number formatting**: `$12,000,000` and `12000000` both work for `total_raised_usd` —
  the importer strips `$`, `,`, and decimals.
- **Empty rows**: Ignored automatically.

---

## Cleaning Up Your Data Before Import

You don't need to clean much — the importer is forgiving. A few things that help:

**For `stage`:** The platform doesn't enforce a fixed set of stage names.
Whatever you put in will be stored as-is. If you want consistent filtering later,
use consistent names (e.g. all "Series A" not a mix of "Series A", "Ser. A", "A Round").

**For `total_raised_usd`:** Numeric values only. `12000000` or `$12,000,000` both work.
Don't use text like "Unknown" or "—" — those rows will fail on this field (but still import with the field blank if you remove it).

**For `founded`:** Four-digit year only. `2021` works. `Jan 2021` does not.

**For partner arrays (`challenge_areas`, `sectors_of_interest`):**
Put multiple values in one cell separated by commas:
`"Warehouse automation, Last-mile delivery, Fleet optimization"`

---

## Staging Your Import

Before importing everything, test with a small batch:

1. Copy 5–10 rows into a new spreadsheet
2. Save as CSV
3. Import it via the UI (Ventures → Companies → Import CSV)
4. Check the result — confirm names, sectors, and stages look right
5. If anything looks off, fix your export and try again
6. Then import the full file

The importer returns `inserted`, `skipped`, and `failed` counts plus
a list of any rows that failed. Fix failed rows and re-import — existing
records will be skipped automatically.

---

## After Import

Once your companies are in:

1. **Set pipeline stages** — if your export had stage data, it's already set.
   If not, use Ventures → Companies to update stages in bulk.

2. **Trigger enrichment** — if you have the Enrichment plugin installed,
   imported companies are tagged `enrichment_status = 'pending'` automatically.
   The overnight enrichment worker will fill in missing fields (description,
   website details, sector signals) for each company.

3. **Match companies to partners** — go to Partners → each partner → Matches
   to surface relevant startups from your imported company list.

---

## What Can't Be Imported via CSV

A few things require manual entry or API calls:

| Data | How to add it |
|---|---|
| Funding rounds (individual rounds, not just total) | Company profile → Funding tab |
| Partner notes and meeting logs | Partner profile → Add Note |
| Company-partner match relationships | Partner profile → Matches → Add Match |
| User accounts | Admin → Users → Add User |
| Partner contacts (individual people at the org) | Partner profile → Contacts |

These are relationship data — they don't map cleanly to a flat CSV.
Most teams add them as they go rather than migrating them up front.
