import { useState } from 'react';
import { X, ChevronDown, ChevronRight, Search } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  currentRole?: string;
}

interface Section {
  title: string;
  roles?: string[];   // if set, only show for these roles
  items: { q: string; a: string }[];
}

const SECTIONS: Section[] = [
  {
    title: 'Your Role & Access',
    items: [
      {
        q: 'What can each role do?',
        a: 'GP: everything, including user management and system config.\n\nPrincipal / Director: all data access, no system config.\n\nVentures: companies, deal flow, DD workflow, and fund data.\n\nPSM: their assigned partners only — no fund data, no company database.',
      },
      {
        q: 'How do I change my password?',
        a: 'Click your name in the top-right corner → Change Password. Enter your current password, then set a new one. Your admin can also reset it for you from Admin → Users.',
      },
      {
        q: 'I can\'t see a section — why?',
        a: 'Sections are role-gated. If you\'re a PSM, you only see your assigned partners. If you\'re Ventures, you won\'t see the Admin panel. Ask your admin if your role needs to be updated.',
      },
    ],
  },
  {
    title: 'Ventures — Company Database',
    items: [
      {
        q: 'How do I find a company?',
        a: 'Use the search bar at the top of the Ventures page. Filter by sector, stage, or status using the dropdowns. The search matches company name, one-liner, and description.',
      },
      {
        q: 'How do I add a single company?',
        a: 'Ventures → Companies tab → Add Company (top right). Enter the website URL — the platform will pre-fill what it can find. Fill in any missing fields and save.',
      },
      {
        q: 'How do I import companies in bulk?',
        a: 'Ventures → Companies tab → Import CSV. Export a spreadsheet from Airtable, Notion, or Excel and upload it. Required column: name. Optional: website, sector, stage, hq_city, hq_country, founded, employee_count, total_raised_usd, one_liner.\n\nColumn names are case-insensitive. Existing companies (matched by name) are always skipped.',
      },
      {
        q: 'What are the pipeline stages?',
        a: 'Sourced → Screening → Meeting → DD → IC → Portfolio → Passed.\n\nUpdate a company\'s stage by clicking it on the company profile page.',
      },
      {
        q: 'How do I edit a company\'s details?',
        a: 'Open the company profile (click any company in the list). Click any field to edit it inline. Changes are saved automatically and logged in the activity feed.',
      },
    ],
  },
  {
    title: 'Partners — Corporate CRM',
    items: [
      {
        q: 'How do I add a partner?',
        a: 'Partners page → New Partner (top right). Fill in the name, industry, and contact details. Add challenge areas and sectors of interest — these drive the company matching logic.',
      },
      {
        q: 'How do I import partners in bulk?',
        a: 'Partners page → Import CSV. Required column: name. Optional: industry, contact_name, contact_email, challenge_areas, sectors_of_interest, notes.\n\nFor challenge_areas and sectors_of_interest: put comma-separated values in a single cell — they\'ll be stored as arrays.',
      },
      {
        q: 'How do I log a meeting or activity?',
        a: 'Open the partner profile → Add Note. Notes are timestamped, attributed to your username, and permanent. There\'s no delete on notes.',
      },
      {
        q: 'How do company matches work?',
        a: 'Go to Partners → select a partner → Matches tab. You can manually add a company match or let the platform surface suggestions based on challenge areas and sectors of interest. Update match status as the relationship progresses (suggested → shared → intro made → engaged → passed).',
      },
      {
        q: 'What is the Partner Terminal?',
        a: 'The Partner Terminal (/partners/:id/terminal) is a deep-dive view per partner — advisory logs, uploaded documents, AI-assisted briefings, and intel summaries. Available to GP/Principal/Director.',
      },
    ],
  },
  {
    title: 'Pipeline, Sales & Requests',
    items: [
      {
        q: 'What is the Sales section?',
        a: 'Sales tracks outbound partner development — organizations you\'re actively working to bring on as corporate partners. Each row has a stage, owner, estimated deal value, and close date.',
      },
      {
        q: 'What is the Requests section?',
        a: 'Requests captures inbound partnership requests — companies or organizations that have reached out to your team. Each request can be assigned for follow-up and moved through a triage workflow.',
      },
    ],
  },
  {
    title: 'Data Import',
    items: [
      {
        q: 'How do I export from Airtable?',
        a: 'Open your Airtable base → Grid view → ··· (more options) → Download CSV. The importer matches column names case-insensitively, so most exports work without renaming.',
      },
      {
        q: 'How do I export from Notion?',
        a: 'Open the database page (must be Table view) → ··· → Export → CSV → Current view. Rename columns to match the platform\'s expected names before importing.',
      },
      {
        q: 'How do I export from Excel or Google Sheets?',
        a: 'Excel: File → Save As → CSV (Comma delimited).\n\nGoogle Sheets: File → Download → Comma-separated values (.csv).\n\nSave as UTF-8 if you have accented characters.',
      },
      {
        q: 'What happens if I import the same file twice?',
        a: 'Nothing bad — it\'s idempotent. Companies and partners are matched by name (case-insensitive). Existing records are skipped. Only new rows are inserted. You\'ll see a breakdown of Added / Skipped / Failed after each import.',
      },
      {
        q: 'What can\'t be imported via CSV?',
        a: 'Individual funding rounds, partner notes, meeting logs, company-partner match relationships, and user accounts all require manual entry or are handled through the admin panel. Most teams add these as they go.',
      },
    ],
  },
  {
    title: 'Admin & Settings',
    items: [
      {
        q: 'How do I add a team member?',
        a: 'Admin → Users → Add User. Set their role, username, and a temporary password. Send them the URL and credentials — they\'ll set their own password on first login.',
      },
      {
        q: 'How do I assign a PSM to their partners?',
        a: 'Admin → Partner Assignments. Select the PSM user and assign them to their partner accounts. PSM users only see partners they\'ve been assigned — do this before they log in.',
      },
      {
        q: 'What is the Plugin Health dashboard?',
        a: 'Admin → System tab. Shows each installed plugin as healthy (all required DB tables present) or degraded (missing tables). If a plugin shows degraded, run: bash scripts/migrate.sh',
      },
      {
        q: 'How do I install or remove a plugin?',
        a: 'Install: copy the plugin folder from plugins/_staging/packages/<slug> to plugins/installed/<slug>, then run bash scripts/migrate.sh and restart the API.\n\nRemove: delete plugins/installed/<slug> and restart the API. Plugin data stays in the database.',
      },
    ],
  },
  {
    title: 'Tips',
    items: [
      {
        q: 'Search works everywhere',
        a: 'The global search in the navbar searches companies by name. The search on each page searches that section\'s data. Always search before adding — it prevents duplicates.',
      },
      {
        q: 'Notes are permanent',
        a: 'Partner notes and meeting notes cannot be deleted. Write carefully.',
      },
      {
        q: 'Your data is private',
        a: 'The platform runs on your own server. No analytics, no tracking, nothing leaves your infrastructure.',
      },
      {
        q: 'Demo data is easy to remove',
        a: 'If you loaded demo data to explore the platform, delete it anytime:\nDELETE FROM cvc.companies WHERE enrichment_source = \'demo_seed\';\n\nRun this in psql or ask your admin.',
      },
    ],
  },
];

export default function HelpPanel({ open, onClose, currentRole }: Props) {
  const [expanded, setExpanded] = useState<string | null>('Ventures — Company Database');
  const [query, setQuery] = useState('');

  if (!open) return null;

  const q = query.toLowerCase().trim();
  const filtered = SECTIONS
    .filter(s => !s.roles || !currentRole || s.roles.includes(currentRole))
    .map(s => ({
      ...s,
      items: q
        ? s.items.filter(i => i.q.toLowerCase().includes(q) || i.a.toLowerCase().includes(q))
        : s.items,
    }))
    .filter(s => s.items.length > 0);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 z-50 w-[420px] bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-base font-bold text-[#33322c]">Help & Guide</h2>
            <p className="text-xs text-[#787569]">Everything you need to know</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-[#787569] hover:text-[#33322c] hover:bg-slate-100 rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
            <Search className="w-3.5 h-3.5 text-[#787569] shrink-0" />
            <input
              type="text"
              placeholder="Search help…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="flex-1 text-sm bg-transparent focus:outline-none text-[#33322c] placeholder:text-[#787569]"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-[#787569] hover:text-[#33322c]">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-sm text-[#787569]">No results for "{query}"</div>
          )}
          {filtered.map(section => (
            <div key={section.title} className="border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === section.title ? null : section.title)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
              >
                <span className="text-sm font-semibold text-[#33322c]">{section.title}</span>
                {expanded === section.title
                  ? <ChevronDown className="w-4 h-4 text-[#787569] shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-[#787569] shrink-0" />
                }
              </button>
              {expanded === section.title && (
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {section.items.map(item => (
                    <div key={item.q} className="px-4 py-3">
                      <p className="text-xs font-semibold text-[#33322c] mb-1">{item.q}</p>
                      <p className="text-xs text-[#545249] whitespace-pre-line leading-relaxed">{item.a}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 shrink-0">
          <p className="text-xs text-[#787569]">
            Full guide: <code className="bg-slate-100 px-1 rounded">onboarding/USER_GUIDE.md</code>
          </p>
        </div>
      </div>
    </>
  );
}
