import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  User, ClipboardList, Building2, Handshake,
  HardDrive, ChevronDown, Loader2,
} from 'lucide-react';
import { AUTH_HEADER as AUTH } from '../api/client';
import { api } from '../api/client';
import { TerminalPanel } from './TerminalPage';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeskUser {
  id: number;
  username: string;
  full_name: string | null;
  role: string;
}

interface DeskRequest {
  id: number;
  title: string;
  status: string;
  priority: string;
  service_type: string;
  partner_name: string | null;
  created_at: string | null;
}

interface DeskCompany {
  assignment_id: number;
  assignment_title: string;
  priority: string;
  assignment_status: string;
  created_at: string | null;
  company_id: number | null;
  name: string | null;
  stage: string | null;
  sector: string | null;
  score: number | null;
}

interface DeskData {
  user: DeskUser;
  requests: DeskRequest[];
  companies: DeskCompany[];
  kpis: { open_requests: number; assigned_companies: number };
}

interface PartnerHealth {
  id: number;
  name: string;
  contract_status: string | null;
  total_intros: number;
  intros_this_month: number;
  last_intro_date: string | null;
  open_requests: number;
  activity_status: 'active' | 'warm' | 'cold';
}

interface RecentIntro {
  id: number;
  intro_date: string | null;
  intro_type: string | null;
  partner_id: number;
  partner_name: string;
  company_id: number | null;
  company_name: string | null;
}

interface PSMSnapshot {
  partners: PartnerHealth[];
  recent_intros: RecentIntro[];
}

interface TeamMember {
  id: number;
  username: string;
  full_name: string | null;
  role: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  dealflow: 'Dealflow', intro: 'Intro', trend_report: 'Trend Report',
  innovation_day: 'Innovation Day', collection: 'Collection',
  assignment: 'Assignment', other: 'Other',
};

const PRIORITY_BADGE: Record<string, string> = {
  high:   'bg-red-100 text-red-700 border border-red-200',
  medium: 'bg-amber-100 text-amber-700 border border-amber-200',
  low:    'bg-slate-100 text-slate-500 border border-slate-200',
};

const ACTIVITY_COLOR: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  warm:   'bg-amber-100 text-amber-700',
  cold:   'bg-slate-100 text-slate-500',
};

const CONTRACT_BADGE: Record<string, string> = {
  active:   'bg-emerald-100 text-emerald-700',
  pending:  'bg-amber-100 text-amber-700',
  expired:  'bg-red-100 text-red-600',
  none:     'bg-slate-100 text-slate-500',
};

const ELEVATED = new Set(['GP', 'Director', 'Principal']);
const PSM_ROLES = new Set(['PSM', 'Senior PSM']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RequestCard({ req }: { req: DeskRequest }) {
  return (
    <Link
      to="/requests"
      className="block bg-white border border-slate-200 rounded p-4 hover:border-slate-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-[#33322c] leading-snug flex-1">{req.title}</p>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${PRIORITY_BADGE[req.priority] ?? PRIORITY_BADGE.low}`}>
          {req.priority}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {req.partner_name && (
          <span className="text-[11px] text-[#787569]">{req.partner_name}</span>
        )}
        <span className="text-[10px] px-1.5 py-0.5 bg-[#ede8d7] text-[#787569] rounded">
          {SERVICE_LABELS[req.service_type] ?? req.service_type}
        </span>
      </div>
    </Link>
  );
}

function CompanyCard({ co }: { co: DeskCompany }) {
  const inner = (
    <div className="bg-white border border-slate-200 rounded p-4 hover:border-slate-300 hover:shadow-sm transition-all h-full">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-semibold text-[#33322c] leading-snug flex-1">
          {co.name ?? co.assignment_title}
        </p>
        {co.score != null && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#F0E545]/40 text-[#8a7200] shrink-0">
            {co.score}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {co.stage && (
          <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-full">{co.stage}</span>
        )}
        {co.sector && (
          <span className="text-[11px] text-[#787569]">{co.sector}</span>
        )}
      </div>
      <p className="text-[10px] text-[#787569] mt-1.5">{co.assignment_title}</p>
    </div>
  );

  if (co.company_id) {
    return <Link to={`/company/${co.company_id}`}>{inner}</Link>;
  }
  return <div>{inner}</div>;
}

function PartnerHealthCard({ p }: { p: PartnerHealth }) {
  return (
    <div className="bg-white border border-slate-200 rounded p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-[#33322c]">{p.name}</p>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${ACTIVITY_COLOR[p.activity_status]}`}>
          {p.activity_status}
        </span>
      </div>
      {p.contract_status && (
        <div className="mb-2">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${CONTRACT_BADGE[p.contract_status] ?? CONTRACT_BADGE.none}`}>
            {p.contract_status}
          </span>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-center mt-2">
        <div>
          <p className="text-base font-bold text-[#33322c]">{p.total_intros}</p>
          <p className="text-[10px] text-[#787569]">Total intros</p>
        </div>
        <div>
          <p className="text-base font-bold text-[#33322c]">{p.intros_this_month}</p>
          <p className="text-[10px] text-[#787569]">This month</p>
        </div>
        <div>
          <p className="text-base font-bold text-[#33322c]">{p.open_requests}</p>
          <p className="text-[10px] text-[#787569]">Open reqs</p>
        </div>
      </div>
      {p.last_intro_date && (
        <p className="text-[10px] text-[#787569] mt-2">Last intro: {fmtDate(p.last_intro_date)}</p>
      )}
    </div>
  );
}

function DriveSection() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-[#f8fafc] transition-colors text-left"
      >
        <div className="w-8 h-8 rounded bg-[#ede8d7] flex items-center justify-center shrink-0">
          <HardDrive className="w-4 h-4 text-[#8a7200]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#33322c]">My Terminal</p>
          <p className="text-xs text-[#787569]">Google Drive browser, document ingestion &amp; Q&amp;A</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-[#787569] transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-slate-100 p-5">
          <TerminalPanel />
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function MyDesk() {
  const currentUser = api.getCurrentUser();
  const role = currentUser?.role ?? '';
  const isPSM = PSM_ROLES.has(role);
  const isElevated = ELEVATED.has(role);

  const [searchParams, setSearchParams] = useSearchParams();
  const asUser = searchParams.get('as_user');

  const [deskData, setDeskData]       = useState<DeskData | null>(null);
  const [psmData, setPsmData]         = useState<PSMSnapshot | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  // Fetch team members for elevated roles
  useEffect(() => {
    if (!isElevated) return;
    fetch('/home/team-members', { headers: AUTH })
      .then(r => r.ok ? r.json() : { members: [] })
      .then(d => setTeamMembers(d.members ?? []))
      .catch(() => {});
  }, [isElevated]);

  // Fetch desk data
  useEffect(() => {
    setLoading(true);
    setError(null);
    const qs = asUser ? `?as_user=${asUser}` : '';
    fetch(`/home/my-desk${qs}`, { headers: AUTH })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: DeskData) => {
        setDeskData(d);
        // If the target user is a PSM, also fetch PSM snapshot
        if (PSM_ROLES.has(d.user.role)) {
          return fetch(`/home/psm-snapshot?username=${encodeURIComponent(d.user.username)}`, { headers: AUTH })
            .then(r => r.ok ? r.json() : { partners: [], recent_intros: [] })
            .then(s => setPsmData(s))
            .catch(() => {});
        }
      })
      .catch(() => setError('Could not load desk data.'))
      .finally(() => setLoading(false));
  }, [asUser]);

  // Determine which view to render
  const targetRole = deskData?.user.role ?? role;
  const showPSMView = PSM_ROLES.has(targetRole);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-[#787569]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (error || !deskData) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-600 rounded px-5 py-4 text-sm">
        {error ?? 'No data available.'}
      </div>
    );
  }

  const { user: deskUser, requests, companies, kpis } = deskData;
  const displayName = deskUser.full_name || deskUser.username;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold text-[#33322c]">
            {greeting()}, {displayName}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs px-2 py-0.5 bg-[#ede8d7] text-[#787569] rounded-full font-medium">
              {deskUser.role}
            </span>
            <span className="text-xs text-[#787569]">{deskUser.username}</span>
          </div>
        </div>

        {/* Team member selector — elevated roles only */}
        {isElevated && teamMembers.length > 0 && (
          <div className="relative">
            <div className="flex items-center gap-1.5 border border-slate-200 rounded px-3 py-2 bg-white text-sm text-[#33322c]">
              <User className="w-3.5 h-3.5 text-[#787569]" />
              <select
                value={asUser ?? ''}
                onChange={e => {
                  if (e.target.value) {
                    setSearchParams({ as_user: e.target.value });
                  } else {
                    setSearchParams({});
                  }
                }}
                className="bg-transparent outline-none text-sm text-[#33322c] pr-5 cursor-pointer"
              >
                <option value="">My Desk</option>
                {teamMembers.map(m => (
                  <option key={m.id} value={String(m.id)}>
                    {m.full_name || m.username} ({m.role})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#787569] shrink-0 pointer-events-none" />
            </div>
          </div>
        )}
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded p-4 text-center">
          <ClipboardList className="w-5 h-5 text-[#8a7200] mx-auto mb-1" />
          <p className="text-2xl font-bold text-[#33322c]">{kpis.open_requests}</p>
          <p className="text-xs text-[#787569]">Open Requests</p>
        </div>
        <div className="bg-white border border-slate-200 rounded p-4 text-center">
          <Building2 className="w-5 h-5 text-[#8a7200] mx-auto mb-1" />
          <p className="text-2xl font-bold text-[#33322c]">{kpis.assigned_companies}</p>
          <p className="text-xs text-[#787569]">Assigned Companies</p>
        </div>
        {showPSMView && psmData && (
          <>
            <div className="bg-white border border-slate-200 rounded p-4 text-center">
              <Handshake className="w-5 h-5 text-[#8a7200] mx-auto mb-1" />
              <p className="text-2xl font-bold text-[#33322c]">{psmData.partners.length}</p>
              <p className="text-xs text-[#787569]">Partners</p>
            </div>
            <div className="bg-white border border-slate-200 rounded p-4 text-center">
              <Handshake className="w-5 h-5 text-[#8a7200] mx-auto mb-1" />
              <p className="text-2xl font-bold text-[#33322c]">
                {psmData.partners.reduce((s, p) => s + p.intros_this_month, 0)}
              </p>
              <p className="text-xs text-[#787569]">Intros This Month</p>
            </div>
          </>
        )}
      </div>

      {/* ── PSM View: Partner Health Grid ── */}
      {showPSMView && psmData && psmData.partners.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#33322c] mb-3">Partner Health</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {psmData.partners.map(p => (
              <PartnerHealthCard key={p.id} p={p} />
            ))}
          </div>
        </div>
      )}

      {/* ── Open Requests ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#33322c]">Open Requests</h3>
          <Link to="/requests" className="text-xs text-[#787569] hover:text-[#33322c] transition-colors">
            View all →
          </Link>
        </div>
        {requests.length === 0 ? (
          <p className="text-sm text-[#787569] italic bg-white border border-slate-200 rounded px-5 py-4">
            No open requests assigned.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {requests.map(r => <RequestCard key={r.id} req={r} />)}
          </div>
        )}
      </div>

      {/* ── Assigned Companies ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#33322c]">Assigned Companies</h3>
        </div>
        {companies.length === 0 ? (
          <p className="text-sm text-[#787569] italic bg-white border border-slate-200 rounded px-5 py-4">
            No companies assigned.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {companies.map(c => <CompanyCard key={c.assignment_id} co={c} />)}
          </div>
        )}
      </div>

      {/* ── PSM View: Recent Intro Activity ── */}
      {showPSMView && psmData && psmData.recent_intros.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#33322c] mb-3">Recent Intro Activity</h3>
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="divide-y divide-slate-100">
              {psmData.recent_intros.map(intro => (
                <div key={intro.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    {intro.company_id ? (
                      <Link
                        to={`/company/${intro.company_id}`}
                        className="text-sm font-medium text-[#33322c] hover:text-[#151411] truncate block"
                      >
                        {intro.company_name ?? '—'}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-[#33322c] truncate">{intro.company_name ?? '—'}</p>
                    )}
                    <p className="text-[11px] text-[#787569]">{intro.partner_name}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {intro.intro_type && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-[#ede8d7] text-[#787569] rounded">
                        {intro.intro_type}
                      </span>
                    )}
                    <p className="text-[10px] text-[#787569] mt-0.5">{fmtDate(intro.intro_date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Drive Card ── */}
      <DriveSection />

    </div>
  );
}
