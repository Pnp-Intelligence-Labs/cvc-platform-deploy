import { Building, Mail, User, Plus, X, ChevronRight, ChevronDown, Upload, Trash2, FileText, StickyNote, Search, Eye, ExternalLink, Check, Pencil, AlertTriangle, Star, Sparkles, Download, RefreshCw, TrendingUp, Zap, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import QQQIntelPanel from '../components/QQQIntelPanel';
import { CVCNavbar } from '../components/CVCNavbar';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { AUTH_HEADER as AUTH } from '../api/client';
import { cls } from '../components/tokens';


// ── Types ──────────────────────────────────────────────────────────────────────

interface Partner {
  id: number;
  name: string;
  industry?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  challenge_areas: string[];
  sectors_of_interest: string[];
  environments: string[];
  notes?: string | null;
  membership_level?: string | null;
  partner_brief?: string | null;
  is_legacy?: boolean;
}

interface LastContact {
  note_type: string;
  created_by: string;
  created_at: string;
  summary: string;
}

interface PartnerDetail extends Partner {
  matches: MatchItem[];
  partner_notes: NoteItem[];
  last_contact?: LastContact | null;
}

interface MatchItem {
  id: number;
  company_id: number;
  name: string;
  sector?: string;
  stage?: string;
  match_score: number;
  match_reason: string;
  status: string;
}

interface NoteItem {
  id: number;
  body: string;
  created_at: string | null;
  created_by: string;
}

interface DocIntel {
  action_items?: string[];
  startup_mentions?: string[];
  key_themes?: string[];
  next_steps?: string[];
}

interface DocItem {
  id: number;
  filename: string;
  title: string;
  file_type: string;
  source_label: string | null;
  uploaded_at: string | null;
  document_date: string | null;
  text_length: number;
  has_file: boolean;
  parsed: boolean;
  summary: string | null;
  extracted_intel: DocIntel | null;
}

interface CompanyResult {
  id: number;
  name: string;
  sector?: string;
}

interface SearchResult {
  doc_id: number;
  partner_id: number;
  partner_name: string;
  filename: string;
  source_label: string | null;
  excerpt: string;
}

interface ContactItem {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
}

interface PartnerContract {
  id: number;
  contract_status?: string | null;
  services_subscribed: string[];
  expiry_date?: string | null;
  days_until_expiry?: number | null;
  expiring_soon: boolean;
  status_color: 'green' | 'yellow' | 'red';
  contact_name?: string | null;
  contact_email?: string | null;
  contract_value?: number | null;
  value?: number | null;        // LLM-extracted annual value from contract PDF
  filename?: string | null;
  raw_summary?: string | null;
  term_start?: string | null;
  term_end?: string | null;
  title?: string | null;
}

interface ServiceUsageRow {
  id: number;
  service_name: string;
  quantity_included: number | null;
  quantity_used: number;
  notes: string | null;
  updated_at: string | null;
}

const CURRENT_YEAR = new Date().getFullYear();

const MATCH_STATUSES = ['suggested', 'shared', 'intro_made', 'engaged', 'passed'];

const STATUS_COLORS: Record<string, string> = {
  suggested: 'bg-blue-100 text-blue-700',
  shared: 'bg-yellow-100 text-yellow-700',
  intro_made: 'bg-purple-100 text-purple-700',
  engaged: 'bg-green-100 text-green-700',
  passed: 'bg-gray-100 text-gray-500',
};

interface SignalVariant {
  name: string;
  mention_count: number;
  first_seen: string | null;
  last_seen: string | null;
  confidence: number;
}

interface PartnerSignals {
  total_mentions: number;
  variants: SignalVariant[];
  recent_count: number;
  prior_count: number;
  latest_signal: string | null;
  recent_content: {
    id: number;
    title: string;
    url: string | null;
    content_type: string;
    published_date: string | null;
    sentiment: string | null;
  }[];
}

type Tab = 'overview' | 'documents' | 'requests' | 'news';

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? '#10b981' : score >= 50 ? '#F0E545' : '#ef4444';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-[#f1f5f9] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-semibold text-[#33322c] w-5 text-right">{score}</span>
    </div>
  );
}

function FileTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = { pdf: 'bg-red-100 text-red-600', docx: 'bg-blue-100 text-blue-600', txt: 'bg-gray-100 text-gray-600' };
  return <span className={`px-1.5 py-0.5 rounded text-xs font-semibold uppercase ${colors[type] ?? 'bg-gray-100 text-gray-500'}`}>{type}</span>;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── PSM Hub ───────────────────────────────────────────────────────────────────

interface PsmLeaderboardRow {
  psm_name: string;
  points_this_month: number;
  freshness_score: number;
  intro_count: number;
}
interface TractionRow {
  company_id: number;
  company_name: string;
  score: number;
  stage: string | null;
  velocity_active: boolean;
  stagnating: boolean;
  delta_direction: 'up' | 'down' | 'flat';
  delta_score: number;
}

const STAGE_BADGE_LIGHT: Record<string, string> = {
  'Commercial Agreement': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Commercial':           'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Pilot':                'bg-amber-100  text-amber-700  border-amber-200',
  'PoC':                  'bg-violet-100 text-violet-700 border-violet-200',
  'NDA':                  'bg-blue-100   text-blue-700   border-blue-200',
};

interface PsmRosterEntry {
  id: number;
  username: string;
  full_name: string;
  role: string;
  assigned_partner_ids: number[];
}

function PSMHub({ partners, onSelect, onSelectWithTab }: {
  partners: { id: number; name: string; industry?: string | null; is_legacy?: boolean }[];
  onSelect: (id: number) => void;
  onSelectWithTab?: (id: number, tab: Tab) => void;
}) {
  const [psms, setPsms] = useState<PsmLeaderboardRow[]>([]);
  const [traction, setTraction] = useState<TractionRow[]>([]);
  const [tractionMonth, setTractionMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<PsmRosterEntry[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null); // null = PSM Home

  useEffect(() => {
    Promise.all([
      fetch('/home/traction/psm-leaderboard', { headers: AUTH }).then(r => r.json()),
      fetch('/home/traction?window=2mo', { headers: AUTH }).then(r => r.json()),
      fetch('/partners/psm-roster', { headers: AUTH }).then(r => r.json()),
    ]).then(([lb, tr, roster]) => {
      setPsms(lb.psms ?? []);
      setTractionMonth(lb.month ?? '');
      setTraction((tr.companies ?? []).slice(0, 8));
      setRoster(roster.psms ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const activePsm = roster.find(r => r.username === activeTab) ?? null;
  const visiblePartners = activePsm
    ? partners.filter(p => activePsm.assigned_partner_ids.includes(p.id))
    : partners;

  return (
    <div className="bg-linen p-6">
      {/* PSM Tabs */}
      {roster.length > 0 && (
        <div className="flex items-center gap-1 mb-6 flex-wrap">
            <button
              onClick={() => setActiveTab(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                activeTab === null
                  ? 'bg-[#1E293B] text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-[#545249] hover:border-[#33322c]'
              }`}
            >
              PSM Home
            </button>
            {roster.map(psm => (
              <button
                key={psm.username}
                onClick={() => setActiveTab(activeTab === psm.username ? null : psm.username)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  activeTab === psm.username
                    ? 'bg-cvc-gold text-[#1E293B] shadow-sm'
                    : 'bg-white border border-slate-200 text-[#545249] hover:border-[#33322c]'
                }`}
              >
                <span>{psm.full_name}</span>
                {psm.role === 'Senior PSM' && (
                  <span className="text-[9px] font-bold uppercase tracking-wide opacity-60">SR</span>
                )}
                <span className={`text-[10px] tabular-nums ${activeTab === psm.username ? 'opacity-70' : 'text-[#787569]'}`}>
                  {psm.assigned_partner_ids.length}
                </span>
              </button>
            ))}
          </div>
        )}

      {/* Active PSM banner + account tiles */}
      {activePsm && (
        <>
          <div className="flex items-center gap-3 mb-5 px-4 py-3 bg-white border border-slate-200 rounded-xl shadow-cvc">
            <div className="w-9 h-9 rounded-full bg-[#1E293B] flex items-center justify-center text-cvc-gold font-bold text-sm shrink-0">
              {activePsm.full_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-bold text-[#1E293B]">{activePsm.full_name}'s Partners</p>
              <p className="text-[10px] text-[#787569]">
                {activePsm.role} · {visiblePartners.length} assigned account{visiblePartners.length !== 1 ? 's' : ''}
                {visiblePartners.length === 0 && ' — no partners assigned yet'}
              </p>
            </div>
          </div>
          {visiblePartners.length === 0 ? (
            <p className="text-sm text-[#787569] py-6 text-center">No partners assigned to {activePsm.full_name} yet.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-6">
              {visiblePartners.map(p => (
                <button key={p.id} onClick={() => onSelect(p.id)}
                  className="text-left px-3 py-2.5 bg-white border border-slate-200 rounded-lg hover:border-[#151411] hover:shadow-cvc transition-all group">
                  <p className="text-xs font-semibold text-[#33322c] truncate group-hover:text-[#151411]">{p.name}</p>
                  <p className="text-[10px] text-[#787569] truncate mt-0.5">{p.industry ?? '—'}</p>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {!activePsm && <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* PSM Performance */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-cvc p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-[#787569]" />
            <div>
              <h3 className="text-sm font-semibold text-[#33322c]">PSM Performance</h3>
              <p className="text-[10px] text-[#787569]">{tractionMonth} · based on logged outcomes</p>
            </div>
          </div>
          {loading ? (
            <p className="text-xs text-[#ACACAA] py-4 text-center">Loading…</p>
          ) : psms.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-xs text-[#ACACAA]">No outcomes logged yet.</p>
              <p className="text-[10px] text-[#ACACAA] mt-1">PSMs need to log NDA / Pilot / Commercial updates in the Partner Terminal.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {psms.map((p, i) => (
                <div key={p.psm_name} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-[#ACACAA] w-4 shrink-0 tabular-nums">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-[#33322c] capitalize">{p.psm_name}</span>
                      <span className="text-xs font-bold text-[#151411] tabular-nums">{p.points_this_month} pts</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.round(p.freshness_score * 100)}%`,
                            background: p.freshness_score >= 0.75 ? '#10b981' : p.freshness_score >= 0.4 ? '#f59e0b' : '#ef4444',
                          }}
                        />
                      </div>
                      <span className="text-[9px] text-[#787569] tabular-nums shrink-0">
                        {Math.round(p.freshness_score * 100)}% fresh · {p.intro_count} intros
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[9px] text-[#ACACAA] mt-4 pt-3 border-t border-slate-100 leading-relaxed">
            Points = sum of milestone base values logged this month. Freshness = % of tracked intros updated in the last 14 days.
          </p>
        </div>

        {/* Corporate Traction — top companies */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-cvc p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-[#787569]" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-[#33322c]">Corporate Traction</h3>
              <p className="text-[10px] text-[#787569]">Last 2 months · decay-adjusted score</p>
            </div>
            <div className="relative group/info">
              <Info className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600 cursor-help" />
              <div className="absolute right-0 top-5 z-50 w-72 bg-[#1e293b] text-white text-xs rounded shadow-lg p-3 hidden group-hover/info:block leading-relaxed">
                <p className="font-semibold mb-1.5">How scores are calculated</p>
                <div className="space-y-0.5 text-slate-300 mb-2.5">
                  <div className="flex justify-between"><span>Intro logged</span><span className="text-white font-medium">1 pt</span></div>
                  <div className="flex justify-between"><span>NDA signed</span><span className="text-white font-medium">10 pts</span></div>
                  <div className="flex justify-between"><span>PoC started</span><span className="text-white font-medium">25 pts</span></div>
                  <div className="flex justify-between"><span>Pilot running</span><span className="text-white font-medium">50 pts</span></div>
                  <div className="flex justify-between"><span>Commercial deal</span><span className="text-white font-medium">150 pts</span></div>
                </div>
                <p className="font-semibold mb-1">Time decay</p>
                <p className="text-slate-300 mb-1">Intro and NDA points lose half their value every <span className="text-white">3 weeks</span>. An intro from 2 months ago is worth less than 10% of a fresh one.</p>
                <p className="text-slate-300">PoC, Pilot, and Commercial points decay much slower — half-life of <span className="text-white">3 months</span>.</p>
              </div>
            </div>
          </div>
          {loading ? (
            <p className="text-xs text-[#ACACAA] py-4 text-center">Loading…</p>
          ) : traction.length === 0 ? (
            <p className="text-xs text-[#ACACAA] py-4 text-center">No traction data yet.</p>
          ) : (
            <div className="space-y-1.5">
              {traction.map((c, i) => (
                <div key={c.company_id} className="flex items-center gap-3 px-2.5 py-1.5 rounded hover:bg-linen transition-colors">
                  <span className="text-[10px] font-bold text-[#ACACAA] w-4 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-[#33322c] truncate">{c.company_name}</span>
                      {c.stage && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${STAGE_BADGE_LIGHT[c.stage] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                          {c.stage}
                        </span>
                      )}
                      {c.velocity_active && (
                        <span className="text-[9px] font-bold text-amber-600">⚡ Rising</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {c.delta_direction !== 'flat' && (
                      <span className={`text-[10px] font-bold ${c.delta_direction === 'up' ? 'text-emerald-500' : 'text-red-400'}`}>
                        {c.delta_direction === 'up' ? '↑' : '↓'}
                      </span>
                    )}
                    <span className="text-xs font-bold text-[#151411] tabular-nums">{c.score}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>}


      {/* QQQ Market Intelligence — PSM Home only */}
      {!activePsm && (
        <div className="mt-6">
          <QQQIntelPanel />
        </div>
      )}

      {/* Partner quick-select grid — PSM Home only */}
      {!activePsm && (
        <div className="mt-6">
          {/* Active partners */}
          <h3 className="text-xs font-bold text-[#787569] uppercase tracking-wide mb-3">All Partners</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {partners.filter(p => !p.is_legacy).map(p => (
              <button key={p.id} onClick={() => onSelect(p.id)}
                className="text-left px-3 py-2.5 bg-white border border-slate-200 rounded-lg hover:border-[#151411] hover:shadow-cvc transition-all group">
                <p className="text-xs font-semibold text-[#33322c] truncate group-hover:text-[#151411]">{p.name}</p>
                <p className="text-[10px] text-[#787569] truncate mt-0.5">{p.industry ?? '—'}</p>
              </button>
            ))}
          </div>

          {/* Legacy partners */}
          {partners.some(p => p.is_legacy) && (
            <div className="mt-8">
              <div className="flex items-center gap-3 mb-3">
                <h3 className="text-xs font-bold text-[#787569] uppercase tracking-wide">Legacy Partners</h3>
                <div className="flex-1 border-t border-slate-200" />
                <span className="text-[10px] text-[#c5c0ad]">Former members</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {partners.filter(p => p.is_legacy).map(p => (
                  <button key={p.id} onClick={() => onSelect(p.id)}
                    className="text-left px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg hover:border-slate-400 transition-all group opacity-70 hover:opacity-100">
                    <p className="text-xs font-semibold text-[#545249] truncate">{p.name}</p>
                    <p className="text-[10px] text-[#c5c0ad] truncate mt-0.5">{p.industry ?? '—'}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── Main Component ─────────────────────────────────────────────────────────────

export default function PartnerManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = searchParams.get('id');
    return id ? parseInt(id, 10) : null;
  });
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [contract, setContract] = useState<PartnerContract | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [services, setServices] = useState<ServiceUsageRow[]>([]);
  const [canonicalServices, setCanonicalServices] = useState<string[]>([]);
  const [serviceYear, setServiceYear] = useState(CURRENT_YEAR);
  const [availableServiceYears, setAvailableServiceYears] = useState<number[]>([]);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);
  const [editUsed, setEditUsed] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [addingService, setAddingService] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceQty, setNewServiceQty] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Partner news
  const [partnerNews, setPartnerNews] = useState<any[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsFilter, setNewsFilter] = useState<string>('all');

  // Global doc search
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [docSearchResults, setDocSearchResults] = useState<SearchResult[]>([]);
  const [searchingDocs, setSearchingDocs] = useState(false);
  const [showDocSearch, setShowDocSearch] = useState(false);

  // Membership level picker
  const [showLevelPicker, setShowLevelPicker] = useState(false);

  // New Partner modal
  const [showNewPartner, setShowNewPartner] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', industry: '', contact_name: '', contact_email: '', sectors_of_interest: '', challenge_areas: '', notes: '' });
  const [savingPartner, setSavingPartner] = useState(false);

  // Add Match modal
  const [showAddMatch, setShowAddMatch] = useState(false);
  const [matchQuery, setMatchQuery] = useState('');
  const [matchResults, setMatchResults] = useState<CompanyResult[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyResult | null>(null);
  const [matchScore, setMatchScore] = useState('75');
  const [matchReason, setMatchReason] = useState('');
  const [savingMatch, setSavingMatch] = useState(false);

  // Notes
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Signal intelligence
  const [signals, setSignals] = useState<PartnerSignals | null>(null);

  // Document intel summary
  const [intelSummary, setIntelSummary] = useState<{
    action_items: { text: string; source: string }[];
    people_mentioned: { name: string; title: string | null }[];
    key_themes: string[];
    startup_mentions: string[];
  } | null>(null);

  // Contacts
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [editContact, setEditContact] = useState({ name: '', title: '', email: '', phone: '' });
  const [addingContact, setAddingContact] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(true);
  const [partnerRequests, setPartnerRequests] = useState<{ requests: any[]; by_year: any[] }>({ requests: [], by_year: [] });
  const [issues, setIssues] = useState<any[]>([]);
  const [issuesOpen, setIssuesOpen] = useState(true);
  const [servicesOpen, setServicesOpen] = useState(true);
  const [addingIssue, setAddingIssue] = useState(false);
  const [newIssue, setNewIssue] = useState({ title: '', body: '', severity: 'medium', due_date: '', linked_document_id: null as number | null });
  const [expandedIssueId, setExpandedIssueId] = useState<number | null>(null);
  const [editingIssueId, setEditingIssueId] = useState<number | null>(null);
  const [editIssueForm, setEditIssueForm] = useState({ title: '', body: '', severity: 'medium', due_date: '' });
  const [issueComments, setIssueComments] = useState<Record<number, any[]>>({});
  const [newComment, setNewComment] = useState<Record<number, string>>({});
  const [newContact, setNewContact] = useState({ name: '', title: '', email: '', phone: '' });

  // Engagement summary
  const [engagementSummary, setEngagementSummary] = useState<{
    by_year: { year: number; total: number; shared_count: number; active_count: number; won_count: number; lost_count: number }[];
    trend: string;
    total: number;
    by_outcome?: { outcome: string; label: string; count: number }[];
    active?: number;
    won?: number;
    current_year_total?: number;
  } | null>(null);
  const [engagementView, setEngagementView] = useState<'year'|'stage'>('year');
  const [engagementYear, setEngagementYear] = useState<number>(new Date().getFullYear());

  // Inline field editing
  const [inlineEdit, setInlineEdit] = useState<{ field: string; value: string } | null>(null);

  // Delete partner
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Document upload
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [expandedDocId, setExpandedDocId] = useState<number | null>(null);
  const [editingDocTitle, setEditingDocTitle] = useState<number | null>(null);
  const [docTitleDraft, setDocTitleDraft] = useState('');
  const [docTexts, setDocTexts] = useState<Record<number, string>>({});
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const pendingTabRef  = useRef<Tab | null>(null);

  // Contract upload / re-extract
  const [contractUploading, setContractUploading] = useState(false);
  const [contractReExtracting, setContractReExtracting] = useState(false);
  const contractFileRef = useRef<HTMLInputElement>(null);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadPartners = useCallback(async () => {
    try {
      setLoadingList(true);
      const data = await api.getPartners(1, 100);
      const list: Partner[] = data.partners ?? [];
      setPartners(list);
      if (selectedId === null) {
        const urlId = searchParams.get('id');
        if (urlId) setSelectedId(parseInt(urlId, 10));
        // No auto-select — land on PSM Hub home page
      }
    } catch (err) {
      console.error('Failed to load partners', err);
    } finally {
      setLoadingList(false);
    }
  }, []);  // eslint-disable-line

  const loadDetail = useCallback(async (id: number) => {
    try {
      setLoadingDetail(true);
      setDetailError(null);
      const data = await api.getPartner(id);
      setDetail(data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load partner');
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const loadDocuments = useCallback(async (id: number) => {
    try {
      const data = await api.listDocuments(id);
      setDocuments(data.documents ?? []);
    } catch {
      setDocuments([]);
    }
  }, []);

  const loadIntelSummary = useCallback(async (id: number) => {
    try {
      const r = await fetch(`/partners/${id}/intel-summary`, { headers: AUTH });
      if (r.ok) setIntelSummary(await r.json());
    } catch { setIntelSummary(null); }
  }, []);

  const loadSignals = useCallback(async (id: number) => {
    try {
      const r = await fetch(`/partners/${id}/signals`, { headers: AUTH });
      if (r.ok) setSignals(await r.json());
    } catch { setSignals(null); }
  }, []);

  const loadContacts = useCallback(async (id: number) => {
    try {
      const data = await api.listContacts(id);
      setContacts(data.contacts ?? []);
    } catch { setContacts([]); }
  }, []);

  const loadContract = useCallback(async (id: number) => {
    try {
      const data = await api.getPartnerContract(id);
      setContract(data ?? null);
    } catch {
      setContract(null);
    }
  }, []);

  const loadServices = useCallback(async (id: number, year: number) => {
    try {
      const data = await api.getServiceUsage(id, year);
      setServices(data.services ?? []);
      setCanonicalServices(data.canonical_services ?? []);
      if (data.available_years?.length) {
        setAvailableServiceYears(data.available_years);
        // Sync displayed year to what the API resolved (handles fallback case)
        if (data.resolved_year && data.resolved_year !== year) {
          setServiceYear(data.resolved_year);
        }
      }
    } catch {
      setServices([]);
    }
  }, []);

  const loadIssues = useCallback(async (id: number) => {
    try {
      const data = await api.listIssues(id);
      setIssues(data.issues ?? []);
    } catch {
      setIssues([]);
    }
  }, []);

  const loadEngagementSummary = useCallback(async (id: number) => {
    try {
      const r = await fetch(`/partners/${id}/engagement-summary`, { headers: AUTH });
      if (r.ok) setEngagementSummary(await r.json());
    } catch { setEngagementSummary(null); }
  }, []);

  useEffect(() => { loadPartners(); }, [loadPartners]);

  // Reset to hub when URL loses the ?id= param (navbar click, browser back, etc.)
  useEffect(() => {
    const urlId = searchParams.get('id');
    if (!urlId && selectedId !== null) {
      setSelectedId(null);
      setDetail(null);
    }
  }, [searchParams]);

  useEffect(() => {
    if (selectedId !== null) {
      loadDetail(selectedId);
      loadDocuments(selectedId);
      loadContract(selectedId);
      loadContacts(selectedId);
      loadIntelSummary(selectedId);
      loadSignals(selectedId);
      loadServices(selectedId, serviceYear);
      loadIssues(selectedId);
      loadEngagementSummary(selectedId);
      fetch(`/partners/${selectedId}/requests`, { headers: { ...AUTH } })
        .then(r => r.ok ? r.json() : { requests: [], by_year: [] })
        .then(setPartnerRequests)
        .catch(() => setPartnerRequests({ requests: [], by_year: [] }));
      setActiveTab(pendingTabRef.current ?? 'overview');
      pendingTabRef.current = null;
      setExpandedDocId(null);
      setSummaryExpanded(false);
      setEditingServiceId(null);
      setAddingService(false);
      setAddingContact(false);
      setEditingContactId(null);
      // Load partner news
      setPartnerNews([]);
      setNewsLoading(true);
      fetch(`/news/partner/${selectedId}?limit=50`, { headers: { ...AUTH } })
        .then(r => r.ok ? r.json() : { articles: [] })
        .then(d => setPartnerNews(d.articles ?? []))
        .catch(() => setPartnerNews([]))
        .finally(() => setNewsLoading(false));
    }
  }, [selectedId, loadDetail, loadDocuments, loadContract, loadContacts, loadIntelSummary, loadSignals, loadServices, loadIssues, loadEngagementSummary, serviceYear]);


  // Company typeahead for Add Match
  useEffect(() => {
    if (matchQuery.length < 2) { setMatchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const data = await api.searchCompanies({ q: matchQuery, limit: 8 });
        setMatchResults(data.companies ?? []);
      } catch { setMatchResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [matchQuery]);

  // Doc search debounce
  useEffect(() => {
    if (docSearchQuery.length < 2) { setDocSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        setSearchingDocs(true);
        const data = await api.searchPartnerDocs(docSearchQuery);
        setDocSearchResults(data.results ?? []);
      } catch { setDocSearchResults([]); }
      finally { setSearchingDocs(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [docSearchQuery]);

  // ── Actions ───────────────────────────────────────────────────────────────────

  function selectPartner(id: number) {
    setShowLevelPicker(false);
    setSearchParams({ id: String(id) }, { replace: true });
    if (id === selectedId) {
      loadDetail(id);
      loadDocuments(id);
    } else {
      setSelectedId(id);
    }
  }

  async function handleStatusChange(matchId: number, status: string) {
    if (!detail) return;
    try {
      await api.updateMatchStatus(detail.id, matchId, status);
      setDetail(prev => prev ? { ...prev, matches: prev.matches.map(m => m.id === matchId ? { ...m, status } : m) } : prev);
    } catch { /* silent */ }
  }

  async function handleCreatePartner() {
    if (!newForm.name.trim()) return;
    try {
      setSavingPartner(true);
      const result = await api.createPartner({
        name: newForm.name,
        industry: newForm.industry || undefined,
        contact_name: newForm.contact_name || undefined,
        contact_email: newForm.contact_email || undefined,
        sectors_of_interest: newForm.sectors_of_interest ? newForm.sectors_of_interest.split(',').map(s => s.trim()).filter(Boolean) : [],
        challenge_areas: newForm.challenge_areas ? newForm.challenge_areas.split(',').map(s => s.trim()).filter(Boolean) : [],
        notes: newForm.notes || undefined,
      });
      setShowNewPartner(false);
      setNewForm({ name: '', industry: '', contact_name: '', contact_email: '', sectors_of_interest: '', challenge_areas: '', notes: '' });
      await loadPartners();
      setSelectedId(result.id);
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed to create partner'); }
    finally { setSavingPartner(false); }
  }

  async function handleAddMatch() {
    if (!detail || !selectedCompany || !matchReason.trim()) return;
    try {
      setSavingMatch(true);
      await api.addMatch(detail.id, { company_id: selectedCompany.id, match_score: parseInt(matchScore, 10), match_reason: matchReason });
      setShowAddMatch(false);
      setSelectedCompany(null); setMatchQuery(''); setMatchScore('75'); setMatchReason('');
      loadDetail(detail.id);
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed to add match'); }
    finally { setSavingMatch(false); }
  }

  async function handleAddNote() {
    if (!detail || !noteBody.trim()) return;
    try {
      setSavingNote(true);
      await api.addNote(detail.id, noteBody);
      setNoteBody('');
      loadDetail(detail.id);
    } catch { /* silent */ }
    finally { setSavingNote(false); }
  }

  async function handleUpload(file: File) {
    if (!detail) return;
    try {
      setUploading(true);
      await api.uploadDocument(detail.id, file, uploadLabel);
      setUploadLabel('');
      loadDocuments(detail.id);
    } catch (err) { alert(err instanceof Error ? err.message : 'Upload failed'); }
    finally { setUploading(false); }
  }

  async function handleContractUpload(file: File) {
    if (!detail) return;
    try {
      setContractUploading(true);
      await api.uploadContract(detail.id, file);
      await loadContract(detail.id);
      await loadServices(detail.id, serviceYear);
    } catch (err) { alert(err instanceof Error ? err.message : 'Contract upload failed'); }
    finally { setContractUploading(false); }
  }

  async function handleReExtract() {
    if (!detail) return;
    try {
      setContractReExtracting(true);
      await fetch(`/partners/${detail.id}/contract/re-extract`, {
        method: 'POST', headers: { ...AUTH },
      });
      // Poll for term_start to appear — extraction runs in background
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        await loadContract(detail.id);
        await loadServices(detail.id, serviceYear);
        if (attempts >= 15) { clearInterval(poll); setContractReExtracting(false); }
      }, 4000);
      setTimeout(() => { clearInterval(poll); setContractReExtracting(false); }, 70000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Re-extraction failed');
      setContractReExtracting(false);
    }
  }

  async function saveInlineField(field: string, rawValue: string) {
    if (!detail) return;
    let value: any = rawValue.trim() || null;
    if (field === 'sectors_of_interest' || field === 'challenge_areas') {
      value = rawValue ? rawValue.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
    }
    try {
      await api.updatePartner(detail.id, { [field]: value });
      setInlineEdit(null);
      await loadDetail(detail.id);
      if (field === 'name') loadPartners();
    } catch { setInlineEdit(null); }
  }

  async function handleDeletePartner() {
    if (!detail) return;
    try {
      await api.deletePartner(detail.id);
      setDetail(null);
      setSelectedId(null);
      setConfirmDelete(false);
      await loadPartners();
    } catch (err) { alert(err instanceof Error ? err.message : 'Delete failed'); }
  }

  async function handleSaveServiceEdit(serviceId: number) {
    if (!detail) return;
    const used = parseInt(editUsed, 10);
    if (isNaN(used) || used < 0) return;
    try {
      await api.updateServiceUsage(detail.id, serviceId, { quantity_used: used, notes: editNotes || undefined });
      setEditingServiceId(null);
      loadServices(detail.id, serviceYear);
    } catch { /* silent */ }
  }

  async function handleAddService() {
    if (!detail || !newServiceName.trim()) return;
    const qty = newServiceQty ? parseInt(newServiceQty, 10) : undefined;
    try {
      await api.upsertService(detail.id, {
        service_name: newServiceName,
        quantity_included: (!isNaN(qty as number) && qty !== undefined) ? qty : null,
        quantity_used: 0,
        year: serviceYear,
      });
      setAddingService(false);
      setNewServiceName('');
      setNewServiceQty('');
      loadServices(detail.id, serviceYear);
    } catch { /* silent */ }
  }

  async function handleDeleteDoc(docId: number) {
    if (!detail) return;
    if (!confirm('Delete this document?')) return;
    try {
      await api.deleteDocument(detail.id, docId);
      setDocuments(prev => prev.filter(d => d.id !== docId));
      if (expandedDocId === docId) setExpandedDocId(null);
    } catch { /* silent */ }
  }

  async function handleExpandDoc(docId: number) {
    if (expandedDocId === docId) { setExpandedDocId(null); return; }
    setExpandedDocId(docId);
    if (!docTexts[docId] && detail) {
      try {
        const data = await api.getDocumentText(detail.id, docId);
        setDocTexts(prev => ({ ...prev, [docId]: data.raw_text ?? '' }));
      } catch { setDocTexts(prev => ({ ...prev, [docId]: '[Failed to load text]' })); }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className={cls.page}>
      <CVCNavbar />

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        {/* Report header */}
        <div className="border-b-2 border-[#33322c] pb-5 mb-6">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">
            SLAM · Partner Intelligence
          </div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className={cls.pageTitle}>Partners</h1>
              <p className="text-sm text-[#545249] mt-1">Corporate partners, matched startups, and ingested documents</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDocSearch(!showDocSearch)}
                className="flex items-center gap-2 px-3 py-2 border border-slate-200 bg-white text-sm text-[#545249] rounded hover:border-[#33322c] hover:text-[#33322c] transition-colors"
              >
                <Search className="w-4 h-4" />
                Search documents
              </button>
              <button
                onClick={() => setShowNewPartner(true)}
                className="flex items-center gap-2 px-4 py-2 bg-[#33322c] text-white text-sm font-semibold rounded hover:bg-[#151411] transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Partner
              </button>
            </div>
          </div>
        </div>

        {/* Global doc search panel */}
        {showDocSearch && (
          <div className="bg-white border border-slate-200 rounded p-4 mb-6 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <Search className="w-4 h-4 text-[#787569] flex-shrink-0" />
              <input
                autoFocus
                type="text"
                placeholder="Search across all partner documents..."
                value={docSearchQuery}
                onChange={e => setDocSearchQuery(e.target.value)}
                className="flex-1 text-sm focus:outline-none"
              />
              {searchingDocs && <div className="w-4 h-4 border-2 border-[#33322c] border-r-transparent rounded-full animate-spin" />}
              <button onClick={() => { setShowDocSearch(false); setDocSearchQuery(''); setDocSearchResults([]); }} className="text-[#787569] hover:text-[#33322c]"><X className="w-4 h-4" /></button>
            </div>
            {docSearchResults.length > 0 && (
              <div className="divide-y divide-[#f1f5f9]">
                {docSearchResults.map(r => (
                  <button
                    key={r.doc_id}
                    onClick={() => { selectPartner(r.partner_id); setActiveTab('documents'); setShowDocSearch(false); setDocSearchQuery(''); }}
                    className="w-full text-left py-3 px-2 hover:bg-slate-50 rounded transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-[#33322c]">{r.partner_name}</span>
                      <span className="text-xs text-[#c5c0ad]">·</span>
                      <span className="text-xs text-[#545249]">{r.filename}</span>
                      {r.source_label && <span className="text-xs bg-[#f1f5f9]/30 px-1.5 py-0.5 rounded border border-slate-200">{r.source_label}</span>}
                    </div>
                    <p className="text-xs text-[#545249] line-clamp-2" dangerouslySetInnerHTML={{ __html: r.excerpt }} />
                  </button>
                ))}
              </div>
            )}
            {docSearchQuery.length >= 2 && !searchingDocs && docSearchResults.length === 0 && (
              <p className="text-sm text-[#787569] text-center py-2">No results found.</p>
            )}
          </div>
        )}

        <div>
          {/* Full-width detail panel */}
          <div className="bg-white rounded border border-slate-200">
            {loadingDetail ? (
              <div className="flex justify-center items-center flex-1 py-16">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-solid border-[#33322c] border-r-transparent" />
              </div>
            ) : detailError ? (
              <div className="flex flex-col items-center justify-center flex-1 py-16 text-red-400">
                <p className="text-sm">{detailError}</p>
              </div>
            ) : selectedId === null ? (
              <PSMHub
                partners={partners}
                onSelect={selectPartner}
                onSelectWithTab={(id, tab) => {
                  pendingTabRef.current = tab;
                  selectPartner(id);
                }}
              />
            ) : !detail ? (
              <div className="flex justify-center items-center flex-1 py-16">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-solid border-[#33322c] border-r-transparent" />
              </div>
            ) : (
              <>
                {/* Partner header */}
                <div className="px-6 pt-4 pb-4 border-b border-slate-200">
                  <button onClick={() => { setSelectedId(null); setDetail(null); setSearchParams({}); }}
                    className="flex items-center gap-1 text-[10px] text-[#787569] hover:text-[#33322c] mb-3 transition-colors group">
                    <ChevronRight className="w-3 h-3 rotate-180 group-hover:-translate-x-0.5 transition-transform" />
                    Partner Hub
                  </button>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      {/* Name */}
                      {inlineEdit?.field === 'name' ? (
                        <input autoFocus value={inlineEdit.value}
                          onChange={e => setInlineEdit({ field: 'name', value: e.target.value })}
                          onBlur={() => saveInlineField('name', inlineEdit.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveInlineField('name', inlineEdit.value); if (e.key === 'Escape') setInlineEdit(null); }}
                          className="text-2xl font-bold text-[#33322c] w-full border-b-2 border-[#33322c] focus:outline-none bg-transparent"
                        />
                      ) : (
                        <h2 onClick={() => setInlineEdit({ field: 'name', value: detail.name })}
                          className="text-2xl font-bold text-[#33322c] cursor-text hover:opacity-80 transition-opacity tracking-tight"
                        >{detail.name}</h2>
                      )}
                      {/* Industry */}
                      {inlineEdit?.field === 'industry' ? (
                        <input autoFocus value={inlineEdit.value} placeholder="Add industry..."
                          onChange={e => setInlineEdit({ field: 'industry', value: e.target.value })}
                          onBlur={() => saveInlineField('industry', inlineEdit.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveInlineField('industry', inlineEdit.value); if (e.key === 'Escape') setInlineEdit(null); }}
                          className="text-sm text-[#545249] w-full border-b border-[#33322c] focus:outline-none bg-transparent"
                        />
                      ) : (
                        <p onClick={() => setInlineEdit({ field: 'industry', value: detail.industry ?? '' })}
                          className={`text-sm cursor-text ${detail.industry ? 'text-[#545249]' : 'text-[#c5c0ad] italic'} hover:opacity-80 transition-opacity`}
                        >{detail.industry || 'Add industry...'}</p>
                      )}
                      {/* Membership level + contract value */}
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {/* Membership level — custom dropdown (replaces native select to avoid overflow-hidden clipping) */}
                        <div className="relative">
                          <span
                            onClick={() => setShowLevelPicker(v => !v)}
                            title="Click to set membership level"
                            className={`cursor-pointer text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border transition-opacity hover:opacity-80 ${
                              detail.membership_level === 'Founding Anchor' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                              detail.membership_level === 'Anchor'          ? 'bg-[#33322c]/10 text-[#33322c] border-[#33322c]/20' :
                              detail.membership_level === 'Ecosystem+'      ? 'bg-teal-50 text-teal-700 border-teal-200' :
                              detail.membership_level === 'Ecosystem'       ? 'bg-[#f1f5f9]/30 text-[#545249] border-slate-200' :
                              'bg-slate-50 text-[#c5c0ad] border-slate-200 italic'
                            }`}
                          >
                            {detail.membership_level || 'Set level…'}
                          </span>
                          {showLevelPicker && (
                            <>
                              {/* backdrop to close on outside click */}
                              <div className="fixed inset-0 z-40" onClick={() => setShowLevelPicker(false)} />
                              <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded shadow-lg py-1 min-w-[140px]">
                                {[['', '— no level —'], ['Ecosystem', 'Ecosystem'], ['Ecosystem+', 'Ecosystem+'], ['Anchor', 'Anchor'], ['Founding Anchor', 'Founding Anchor']].map(([val, label]) => (
                                  <button
                                    key={val}
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 transition-colors ${detail.membership_level === val || (!detail.membership_level && val === '') ? 'font-semibold text-[#33322c]' : 'text-slate-600'}`}
                                    onClick={async () => {
                                      setShowLevelPicker(false);
                                      await api.updatePartner(detail.id, { membership_level: val || null });
                                      await loadDetail(detail.id);
                                    }}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                        {/* Contract value — inline editable */}
                        {inlineEdit?.field === 'contract_value' ? (
                          <input
                            autoFocus
                            type="number"
                            placeholder="Annual value (USD)"
                            value={inlineEdit.value}
                            onChange={e => setInlineEdit({ field: 'contract_value', value: e.target.value })}
                            onBlur={async () => {
                              const num = parseFloat(inlineEdit.value);
                              await api.patchContract(detail.id, { value: isNaN(num) ? null : num });
                              setInlineEdit(null);
                              await loadContract(detail.id);
                            }}
                            onKeyDown={async e => {
                              if (e.key === 'Enter') {
                                const num = parseFloat(inlineEdit.value);
                                await api.patchContract(detail.id, { value: isNaN(num) ? null : num });
                                setInlineEdit(null);
                                await loadContract(detail.id);
                              }
                              if (e.key === 'Escape') setInlineEdit(null);
                            }}
                            className="text-xs border border-[#33322c] rounded px-2 py-0.5 w-36 focus:outline-none bg-white"
                          />
                        ) : (
                          (() => {
                            const v = contract?.value ?? contract?.contract_value;
                            const display = v != null
                              ? (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M / yr` : v >= 1_000 ? `$${(v / 1_000).toFixed(0)}K / yr` : `$${v} / yr`)
                              : null;
                            return (
                              <span
                                onClick={() => setInlineEdit({ field: 'contract_value', value: v != null ? String(v) : '' })}
                                title="Click to set contract value"
                                className={`cursor-pointer text-xs px-2 py-0.5 rounded border transition-opacity hover:opacity-80 ${
                                  display ? 'text-[#545249] border-transparent' : 'text-[#c5c0ad] italic border-slate-200 bg-slate-50'
                                }`}
                              >
                                {display ?? 'Set value…'}
                              </span>
                            );
                          })()
                        )}
                        {/* Contract end date — inline editable */}
                        {inlineEdit?.field === 'contract_end' ? (
                          <input
                            autoFocus
                            type="date"
                            value={inlineEdit.value}
                            onChange={e => setInlineEdit({ field: 'contract_end', value: e.target.value })}
                            onBlur={async () => {
                              await api.patchContract(detail.id, { term_end: inlineEdit.value || null });
                              setInlineEdit(null);
                              await loadContract(detail.id);
                            }}
                            onKeyDown={async e => {
                              if (e.key === 'Enter') {
                                await api.patchContract(detail.id, { term_end: inlineEdit.value || null });
                                setInlineEdit(null);
                                await loadContract(detail.id);
                              }
                              if (e.key === 'Escape') setInlineEdit(null);
                            }}
                            className="text-xs border border-[#33322c] rounded px-2 py-0.5 focus:outline-none bg-white"
                          />
                        ) : (
                          <span
                            onClick={() => setInlineEdit({ field: 'contract_end', value: contract?.term_end ?? '' })}
                            title="Click to set contract end date"
                            className={`cursor-pointer text-xs px-2 py-0.5 rounded border transition-opacity hover:opacity-80 ${
                              contract?.term_end ? 'text-[#787569] border-transparent' : 'text-[#c5c0ad] italic border-slate-200 bg-slate-50'
                            }`}
                          >
                            {contract?.term_end
                              ? `expires ${new Date(contract.term_end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
                              : 'Set end date…'}
                          </span>
                        )}
                      </div>
                      {/* Notes */}
                      {inlineEdit?.field === 'notes' ? (
                        <textarea autoFocus value={inlineEdit.value} placeholder="Add notes..." rows={2}
                          onChange={e => setInlineEdit({ field: 'notes', value: e.target.value })}
                          onBlur={() => saveInlineField('notes', inlineEdit.value)}
                          onKeyDown={e => { if (e.key === 'Escape') setInlineEdit(null); }}
                          className="text-xs text-[#545249] w-full border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-[#33322c] resize-none mt-1"
                        />
                      ) : (
                        <p onClick={() => setInlineEdit({ field: 'notes', value: detail.notes ?? '' })}
                          className={`text-xs cursor-text mt-1 leading-relaxed ${detail.notes ? 'text-[#545249]' : 'text-[#c5c0ad] italic'} hover:opacity-80 transition-opacity`}
                        >{detail.notes || 'Add notes...'}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Link
                        to={`/partners/${detail.id}/terminal`}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#33322c] text-white text-xs font-semibold rounded hover:bg-[#151411] transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Service Terminal
                      </Link>
                      {contract?.filename && (
                        <button
                          onClick={async () => {
                            const r = await fetch(`/partners/${selectedId}/contract/file`, { headers: AUTH });
                            if (!r.ok) return;
                            const blob = await r.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = contract.filename!; a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-[#33322c] text-xs font-semibold rounded hover:border-[#33322c] transition-colors"
                          title="Download contract"
                        >
                          <Download className="w-3.5 h-3.5" /> Contract
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          const newVal = !detail.is_legacy;
                          try {
                            await api.updatePartner(detail.id, { is_legacy: newVal });
                            await loadDetail(detail.id);
                            setPartners(prev => prev.map(p => p.id === detail.id ? { ...p, is_legacy: newVal } : p));
                          } catch (e) {
                            console.error('Failed to update legacy flag:', e);
                          }
                        }}
                        className={`px-2.5 py-1.5 rounded text-xs font-medium border transition-colors ${
                          detail.is_legacy
                            ? 'border-amber-400 text-white bg-amber-500 hover:bg-amber-600'
                            : 'border-slate-200 text-[#787569] hover:text-[#33322c] hover:border-slate-300'
                        }`}
                        title={detail.is_legacy ? 'Click to restore as active partner' : 'Move to Legacy Partners'}
                      >
                        Legacy
                      </button>
                      <button
                        onClick={() => setConfirmDelete(true)}
                        className="p-1.5 rounded text-[#787569] hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Delete partner"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-3">
                    {contacts.length > 0 ? (
                      contacts
                        .slice()
                        .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
                        .slice(0, 4)
                        .map(c => (
                          <span key={c.id} className="flex items-center gap-1.5 text-sm text-[#545249]">
                            <User className="w-3.5 h-3.5 shrink-0 text-[#787569]" />
                            <span className="font-medium text-[#33322c]">{c.name}</span>
                            {c.title && <span className="text-[#787569]">· {c.title}</span>}
                            {c.email && (
                              <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-xs text-[#545249] hover:underline ml-1">
                                <Mail className="w-3 h-3" />{c.email}
                              </a>
                            )}
                            {c.is_primary && <span className="text-[10px] px-1 py-0.5 bg-[#F0E545]/20 text-[#b8a800] rounded font-medium">Primary</span>}
                          </span>
                        ))
                    ) : (
                      <span className="flex items-center gap-1.5 text-sm text-[#c5c0ad]">
                        <User className="w-3.5 h-3.5" />No contacts
                      </span>
                    )}
                    {contacts.length > 4 && (
                      <span className="text-xs text-[#787569]">+{contacts.length - 4} more</span>
                    )}
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-0 border-b border-slate-200 px-6 overflow-x-auto">
                  {([['overview', 'Overview'], ['documents', `Documents (${documents.length})`], ['requests', `Requests (${partnerRequests.requests.length})`], ['news', partnerNews.length > 0 ? `News (${partnerNews.length})` : 'News']] as [Tab, string][]).map(([tab, label]) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === tab ? 'border-[#33322c] text-[#33322c]' : 'border-transparent text-[#545249] hover:text-[#33322c] hover:border-slate-200'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="p-6">

                  {/* ── Overview Tab ─────────────────────────────────────── */}
                  {activeTab === 'overview' && (
                    <div className="space-y-5">

                      {/* Sectors + Challenges — inline editable */}
                      <div className="grid grid-cols-2 gap-4 border border-slate-200 rounded p-4 bg-white">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Sectors of Interest</p>
                          {inlineEdit?.field === 'sectors_of_interest' ? (
                            <input autoFocus value={inlineEdit.value} placeholder="Robotics, Supply Chain..."
                              onChange={e => setInlineEdit({ field: 'sectors_of_interest', value: e.target.value })}
                              onBlur={() => saveInlineField('sectors_of_interest', inlineEdit.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveInlineField('sectors_of_interest', inlineEdit.value); if (e.key === 'Escape') setInlineEdit(null); }}
                              className="w-full text-xs border-b border-[#33322c] focus:outline-none bg-transparent"
                            />
                          ) : (
                            <div onClick={() => setInlineEdit({ field: 'sectors_of_interest', value: (detail.sectors_of_interest ?? []).join(', ') })}
                              className="flex flex-wrap gap-1.5 cursor-text min-h-[28px] -m-1 p-1 rounded hover:bg-slate-200/50 transition-colors">
                              {(detail.sectors_of_interest ?? []).length > 0
                                ? detail.sectors_of_interest.map((s, i) => <span key={i} className="px-2 py-0.5 bg-[#33322c] text-white text-xs rounded">{s}</span>)
                                : <span className="text-xs text-[#c5c0ad] italic">Click to add sectors...</span>}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Challenge Areas</p>
                          {inlineEdit?.field === 'challenge_areas' ? (
                            <input autoFocus value={inlineEdit.value} placeholder="Warehouse automation..."
                              onChange={e => setInlineEdit({ field: 'challenge_areas', value: e.target.value })}
                              onBlur={() => saveInlineField('challenge_areas', inlineEdit.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveInlineField('challenge_areas', inlineEdit.value); if (e.key === 'Escape') setInlineEdit(null); }}
                              className="w-full text-xs border-b border-[#33322c] focus:outline-none bg-transparent"
                            />
                          ) : (
                            <div onClick={() => setInlineEdit({ field: 'challenge_areas', value: (detail.challenge_areas ?? []).join(', ') })}
                              className="flex flex-wrap gap-1.5 cursor-text min-h-[28px] -m-1 p-1 rounded hover:bg-[#f1f5f9]/50 transition-colors">
                              {(detail.challenge_areas ?? []).length > 0
                                ? detail.challenge_areas.map((s, i) => <span key={i} className="px-2 py-0.5 bg-[#F0E545]/20 text-[#33322c] text-xs rounded border border-[#F0E545]/50">{s}</span>)
                                : <span className="text-xs text-[#c5c0ad] italic">Click to add challenges...</span>}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Contacts ─────────────────────────────────────── */}
                      <div className="border border-slate-200 rounded overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">Contacts</span>
                          <button
                            onClick={() => { setAddingContact(true); setNewContact({ name: '', title: '', email: '', phone: '' }); }}
                            className="flex items-center gap-1 text-[10px] font-semibold text-[#33322c] hover:text-black transition-colors"
                          >
                            <Plus className="w-3 h-3" /> Add
                          </button>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {contacts.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)).map(c => (
                            <div key={c.id} className="px-4 py-2.5 bg-white">
                              {editingContactId === c.id ? (
                                <div className="space-y-1.5">
                                  <div className="grid grid-cols-2 gap-2">
                                    <input
                                      value={editContact.name}
                                      onChange={e => setEditContact(p => ({ ...p, name: e.target.value }))}
                                      placeholder="Name"
                                      className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400 w-full"
                                    />
                                    <input
                                      value={editContact.title}
                                      onChange={e => setEditContact(p => ({ ...p, title: e.target.value }))}
                                      placeholder="Title"
                                      className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400 w-full"
                                    />
                                    <input
                                      value={editContact.email}
                                      onChange={e => setEditContact(p => ({ ...p, email: e.target.value }))}
                                      placeholder="Email"
                                      className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400 w-full"
                                    />
                                    <input
                                      value={editContact.phone}
                                      onChange={e => setEditContact(p => ({ ...p, phone: e.target.value }))}
                                      placeholder="Phone"
                                      className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400 w-full"
                                    />
                                  </div>
                                  <div className="flex items-center gap-3 pt-0.5">
                                    <label className="flex items-center gap-1.5 text-xs text-[#545249] cursor-pointer">
                                      <input type="checkbox" checked={c.is_primary}
                                        onChange={async () => { await api.updateContact(detail.id, c.id, { is_primary: !c.is_primary }); loadContacts(detail.id); }}
                                        className="w-3 h-3"
                                      /> Primary
                                    </label>
                                    <button
                                      onClick={async () => { await api.updateContact(detail.id, c.id, { name: editContact.name, title: editContact.title, email: editContact.email, phone: editContact.phone }); setEditingContactId(null); loadContacts(detail.id); }}
                                      className="text-xs font-semibold text-[#33322c] hover:text-black"
                                    >Save</button>
                                    <button onClick={() => setEditingContactId(null)} className="text-xs text-[#787569] hover:text-[#33322c]">Cancel</button>
                                    <button
                                      onClick={async () => { if (!confirm('Delete this contact?')) return; await api.deleteContact(detail.id, c.id); loadContacts(detail.id); }}
                                      className="ml-auto text-xs text-red-400 hover:text-red-600"
                                    >Delete</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-start justify-between gap-2 group">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold text-[#33322c]">{c.name}</span>
                                      {c.is_primary && <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded font-medium">Primary</span>}
                                    </div>
                                    {c.title && <p className="text-[11px] text-[#787569] mt-0.5">{c.title}</p>}
                                    {c.email && <a href={`mailto:${c.email}`} className="text-[11px] text-blue-600 hover:underline">{c.email}</a>}
                                    {c.phone && <p className="text-[11px] text-[#787569]">{c.phone}</p>}
                                  </div>
                                  <button
                                    onClick={() => { setEditingContactId(c.id); setEditContact({ name: c.name, title: c.title ?? '', email: c.email ?? '', phone: c.phone ?? '' }); }}
                                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#787569] hover:text-[#33322c] hover:bg-slate-100 transition-all flex-shrink-0"
                                    title="Edit contact"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                          {contacts.length === 0 && !addingContact && (
                            <div className="px-4 py-3 text-xs text-[#c5c0ad] italic">No contacts added yet</div>
                          )}
                          {addingContact && (
                            <div className="px-4 py-3 bg-slate-50 space-y-1.5">
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  autoFocus
                                  value={newContact.name}
                                  onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))}
                                  placeholder="Name *"
                                  className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400 w-full"
                                />
                                <input
                                  value={newContact.title}
                                  onChange={e => setNewContact(p => ({ ...p, title: e.target.value }))}
                                  placeholder="Title"
                                  className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400 w-full"
                                />
                                <input
                                  value={newContact.email}
                                  onChange={e => setNewContact(p => ({ ...p, email: e.target.value }))}
                                  placeholder="Email"
                                  className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400 w-full"
                                />
                                <input
                                  value={newContact.phone}
                                  onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))}
                                  placeholder="Phone"
                                  className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400 w-full"
                                />
                              </div>
                              <div className="flex items-center gap-3 pt-0.5">
                                <button
                                  onClick={async () => {
                                    if (!newContact.name.trim()) return;
                                    await api.addContact(detail.id, { name: newContact.name.trim(), title: newContact.title, email: newContact.email, phone: newContact.phone, is_primary: contacts.length === 0 });
                                    setAddingContact(false);
                                    setNewContact({ name: '', title: '', email: '', phone: '' });
                                    loadContacts(detail.id);
                                  }}
                                  className="text-xs font-semibold text-[#33322c] hover:text-black"
                                >Save</button>
                                <button onClick={() => setAddingContact(false)} className="text-xs text-[#787569] hover:text-[#33322c]">Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Document Intelligence Summary */}
                      {intelSummary && (intelSummary.action_items.length > 0 || intelSummary.people_mentioned.length > 0 || intelSummary.key_themes.length > 0) && (
                        <div className="border border-slate-200 rounded overflow-hidden">
                          <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-slate-200">
                            <Sparkles className="w-3.5 h-3.5 text-[#f59e0b]" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">Document Intelligence</span>
                          </div>
                          <div className="px-4 py-3 space-y-4">
                            {/* Action Items */}
                            {intelSummary.action_items.length > 0 && (
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Action Items</p>
                                <ul className="space-y-1.5">
                                  {intelSummary.action_items.map((item, i) => (
                                    <li key={i} className="flex items-start gap-2 group">
                                      <span className="text-[#10b981] mt-0.5 flex-shrink-0 text-xs">›</span>
                                      <div className="min-w-0 flex-1">
                                        <span className="text-xs text-[#33322c]">{item.text}</span>
                                        <span className="text-[10px] text-[#787569] ml-1.5">{item.source}</span>
                                      </div>
                                      <button onClick={async () => { await fetch(`/partners/${detail!.id}/intel-summary/dismiss`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'action_item', value: item.text }) }); loadIntelSummary(detail!.id); }} className="opacity-0 group-hover:opacity-100 p-0.5 text-[#787569] hover:text-red-400 transition-all flex-shrink-0" title="Dismiss"><X className="w-3 h-3" /></button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {/* People Mentioned */}
                            {intelSummary.people_mentioned.length > 0 && (
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">People Mentioned</p>
                                <div className="space-y-1">
                                  {intelSummary.people_mentioned.map((p, i) => {
                                    const alreadyContact = contacts.some(c => c.name.toLowerCase() === p.name.toLowerCase());
                                    return (
                                      <div key={i} className="flex items-center justify-between gap-2 group">
                                        <div className="min-w-0 flex-1">
                                          <span className="text-xs font-medium text-[#33322c]">{p.name}</span>
                                          {p.title && <span className="text-xs text-[#787569] ml-1.5">{p.title}</span>}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                          {!alreadyContact && detail && (
                                            <button onClick={async () => { await api.addContact(detail.id, { name: p.name, title: p.title || '', email: '', phone: '', is_primary: false }); loadContacts(detail.id); }} className="text-[10px] text-[#33322c] hover:text-[#33322c] transition-colors flex items-center gap-0.5"><Plus className="w-3 h-3" /> Add</button>
                                          )}
                                          {alreadyContact && <span className="text-[10px] text-[#10b981]">✓</span>}
                                          <button onClick={async () => { await fetch(`/partners/${detail!.id}/intel-summary/dismiss`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'person', value: p.name }) }); loadIntelSummary(detail!.id); }} className="opacity-0 group-hover:opacity-100 p-0.5 text-[#787569] hover:text-red-400 transition-all" title="Dismiss"><X className="w-3 h-3" /></button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {/* Key Themes */}
                            {intelSummary.key_themes.length > 0 && (
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Key Themes</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {intelSummary.key_themes.map((t, i) => (
                                    <span key={i} className="flex items-center gap-1 pl-2 pr-1 py-0.5 bg-slate-50 text-[#545249] text-xs rounded capitalize group">
                                      {t}
                                      <button onClick={async () => { await fetch(`/partners/${detail!.id}/intel-summary/dismiss`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'theme', value: t }) }); loadIntelSummary(detail!.id); }} className="opacity-0 group-hover:opacity-100 text-[#787569] hover:text-red-400 transition-all" title="Dismiss"><X className="w-3 h-3" /></button>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Signal Intelligence */}
                      {signals && signals.total_mentions > 0 && (
                        <div className="border border-slate-200 rounded overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">Signal Intelligence</span>
                              <span className="text-[10px] px-1.5 py-0.5 bg-[#f1f5f9] rounded text-[#545249]">{signals.total_mentions} mentions</span>
                              {signals.recent_count > signals.prior_count && signals.prior_count > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded font-medium">
                                  ↑ {Math.round(((signals.recent_count - signals.prior_count) / signals.prior_count) * 100)}% vs prior 30d
                                </span>
                              )}
                              {signals.recent_count < signals.prior_count && signals.prior_count > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-600 rounded font-medium">
                                  ↓ {Math.round(((signals.prior_count - signals.recent_count) / signals.prior_count) * 100)}% vs prior 30d
                                </span>
                              )}
                            </div>
                            {signals.latest_signal && (
                              <span className="text-[10px] text-[#787569]">Last seen {signals.latest_signal}</span>
                            )}
                          </div>
                          <div className="p-4 space-y-4">

                            {/* Entity variants */}
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Tracked As</p>
                              <div className="flex flex-wrap gap-1.5">
                                {signals.variants.map((v, i) => (
                                  <span key={i} className="flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200 rounded text-xs text-[#33322c]">
                                    <span>{v.name}</span>
                                    <span className="text-[#787569]">{v.mention_count}×</span>
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Recent content */}
                            {signals.recent_content.length > 0 && (
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">Recent Mentions</p>
                                  <p className="text-[10px] text-[#787569]">× = not about this partner</p>
                                </div>
                                <div className="space-y-1">
                                  {signals.recent_content.map((item, i) => (
                                    <div key={i} className="group flex items-start gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
                                      <span className={`mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${
                                        item.sentiment === 'positive' ? 'bg-emerald-400' :
                                        item.sentiment === 'negative' ? 'bg-red-400' : 'bg-slate-300'
                                      }`} />
                                      <div className="flex-1 min-w-0">
                                        {item.url ? (
                                          <a href={item.url} target="_blank" rel="noopener noreferrer"
                                            className="text-xs text-[#33322c] hover:text-cvc-gold hover:underline line-clamp-1">
                                            {item.title}
                                          </a>
                                        ) : (
                                          <span className="text-xs text-[#33322c] line-clamp-1">{item.title}</span>
                                        )}
                                      </div>
                                      <span className="flex-shrink-0 text-[10px] text-[#787569]">{item.published_date ?? ''}</span>
                                      <button
                                        title="Not about this partner — dismiss"
                                        onClick={async () => {
                                          await fetch(`/partners/${detail!.id}/signals/dismiss`, {
                                            method: 'POST',
                                            headers: { ...AUTH, 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ content_item_id: item.id }),
                                          });
                                          setSignals(prev => prev ? {
                                            ...prev,
                                            recent_content: prev.recent_content.filter(c => c.id !== item.id),
                                          } : prev);
                                        }}
                                        className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 text-[#787569] hover:text-red-500 transition-all"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Engagement Summary */}
                      {engagementSummary && engagementSummary.by_year.length > 0 && (
                        <div className="border border-slate-200 rounded overflow-hidden">
                          {/* Header */}
                          <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
                            <div className="flex items-center gap-2">
                              <TrendingUp className="w-3.5 h-3.5 text-[#6366F1]" />
                              <span className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">Startup Engagement</span>
                              <span className="text-[10px] text-[#c5c0ad]">{engagementSummary.total} total</span>
                            </div>
                            <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                              engagementSummary.trend === 'Increasing' ? 'bg-emerald-50 text-emerald-700' :
                              engagementSummary.trend === 'Declining'  ? 'bg-red-50 text-red-600' :
                              'bg-slate-50 text-[#787569]'
                            }`}>
                              {engagementSummary.trend === 'Increasing' ? '↑' : engagementSummary.trend === 'Declining' ? '↓' : '→'} {engagementSummary.trend}
                            </span>
                          </div>
                          {/* Year tabs */}
                          <div className="flex border-b border-slate-100 overflow-x-auto">
                            {engagementSummary.by_year.map(row => (
                              <button
                                key={row.year}
                                onClick={() => setEngagementYear(row.year)}
                                className={`px-4 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                                  (engagementYear === row.year || (!engagementSummary.by_year.some(r => r.year === engagementYear) && row === engagementSummary.by_year[engagementSummary.by_year.length - 1]))
                                    ? 'border-[#6366F1] text-[#6366F1]'
                                    : 'border-transparent text-[#787569] hover:text-[#33322c]'
                                }`}
                              >
                                {row.year} <span className="ml-1 opacity-50">{row.total}</span>
                              </button>
                            ))}
                          </div>
                          {/* Per-year breakdown */}
                          {(() => {
                            const yr = engagementSummary.by_year.find(r => r.year === engagementYear) ?? engagementSummary.by_year[engagementSummary.by_year.length - 1];
                            if (!yr) return null;
                            const segments = [
                              { label: 'Shared',    count: yr.shared_count, color: '#CBD5E1' },
                              { label: 'Active',    count: yr.active_count, color: '#6366F1' },
                              { label: 'Won',       count: yr.won_count,    color: '#10B981' },
                              { label: 'Concluded', count: yr.lost_count,   color: '#F59E0B' },
                            ];
                            const hasOutcomes = segments.some(s => s.count > 0);
                            return (
                              <>
                                <div className="grid grid-cols-5 divide-x divide-slate-100">
                                  <div className="px-3 py-3 text-center">
                                    <div className="text-lg font-bold text-[#33322c]">{yr.total}</div>
                                    <div className="text-[9px] uppercase tracking-widest text-[#787569] mt-0.5">Total</div>
                                  </div>
                                  {segments.map(s => (
                                    <div key={s.label} className="px-3 py-3 text-center">
                                      <div className="text-lg font-bold" style={{ color: s.count > 0 ? s.color : '#c5c0ad' }}>{s.count}</div>
                                      <div className="text-[9px] uppercase tracking-widest text-[#787569] mt-0.5">{s.label}</div>
                                    </div>
                                  ))}
                                </div>
                                {hasOutcomes && yr.total > 0 && (
                                  <div className="px-4 pb-4 pt-1">
                                    <div className="h-2 rounded-full overflow-hidden flex bg-slate-100">
                                      {segments.filter(s => s.count > 0).map(s => (
                                        <div key={s.label} style={{ width: `${(s.count / yr.total) * 100}%`, backgroundColor: s.color }} />
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {!hasOutcomes && (
                                  <div className="px-4 py-3 text-center text-[10px] text-[#c5c0ad] italic border-t border-slate-100">
                                    All companies are Shared by default — update outcomes in the Startup Tracking tab
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}

                      {/* Issues */}
                      <div className="border border-slate-200 rounded overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 cursor-pointer select-none" onClick={() => setIssuesOpen(!issuesOpen)}>
                          <div className="flex items-center gap-2">
                            {issuesOpen ? <ChevronDown className="w-3.5 h-3.5 text-[#787569]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#787569]" />}
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">Issues</span>
                            {issues.length > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-[#f1f5f9] rounded text-[#545249]">{issues.length}</span>}
                            {issues.filter(i => i.severity === 'high' && !i.resolved).length > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded font-medium">{issues.filter(i => i.severity === 'high' && !i.resolved).length} high</span>
                            )}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setAddingIssue(true); setNewIssue({ title: '', body: '', severity: 'medium', due_date: '', linked_document_id: null }); }}
                            className="flex items-center gap-1 text-xs text-[#33322c] hover:text-[#33322c] transition-colors"
                          >
                            <Plus className="w-3 h-3" /> Add issue
                          </button>
                        </div>

                        {issuesOpen && (
                          <div>
                            {issues.length === 0 && !addingIssue ? (
                              <div className="px-4 py-4 text-center text-xs text-[#787569]">No issues yet.</div>
                            ) : (
                              <div>
                                {issues.map((issue: any) => {
                                  const isExpanded = expandedIssueId === issue.id;
                                  const isEditing = editingIssueId === issue.id;
                                  const comments = issueComments[issue.id] ?? [];
                                  return (
                                  <div key={issue.id} className="border-b border-slate-200 last:border-b-0">
                                    {/* Issue header row */}
                                    <div
                                      className="flex items-start gap-3 px-4 py-3 hover:bg-[#fafafa] cursor-pointer"
                                      onClick={async () => {
                                        const next = isExpanded ? null : issue.id;
                                        setExpandedIssueId(next);
                                        setEditingIssueId(null);
                                        if (next && !issueComments[next]) {
                                          try {
                                            const d = await api.listIssueComments(detail!.id, next);
                                            setIssueComments(prev => ({ ...prev, [next]: d.comments ?? [] }));
                                          } catch { /* silent */ }
                                        }
                                      }}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                            issue.severity === 'high' ? 'bg-red-100 text-red-600' :
                                            issue.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                            'bg-gray-100 text-gray-600'
                                          }`}>{issue.severity}</span>
                                          <span className={`text-sm font-medium ${issue.resolved ? 'line-through text-[#787569]' : 'text-[#33322c]'}`}>{issue.title}</span>
                                          {issue.due_date && (
                                            <span className={`text-[10px] ml-1 ${new Date(issue.due_date) < new Date() && !issue.resolved ? 'text-red-500 font-medium' : 'text-[#787569]'}`}>
                                              · due {new Date(issue.due_date).toLocaleDateString()}
                                            </span>
                                          )}
                                        </div>
                                        {issue.body && !isExpanded && <div className="text-xs text-[#545249] mt-0.5 truncate">{issue.body}</div>}
                                      </div>
                                      <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                                        <button
                                          onClick={async () => { if (!detail) return; await api.updateIssue(detail.id, issue.id, { resolved: !issue.resolved }); loadIssues(detail.id); }}
                                          className={`p-1 rounded ${issue.resolved ? 'bg-green-100 text-green-600' : 'hover:bg-green-50 text-[#787569] hover:text-green-500'}`}
                                          title={issue.resolved ? 'Reopen' : 'Mark resolved'}
                                        ><Check className="w-3.5 h-3.5" /></button>
                                        <button
                                          onClick={() => {
                                            setEditingIssueId(isEditing ? null : issue.id);
                                            setExpandedIssueId(issue.id);
                                            setEditIssueForm({ title: issue.title, body: issue.body ?? '', severity: issue.severity, due_date: issue.due_date ? issue.due_date.split('T')[0] : '' });
                                          }}
                                          className={`p-1 rounded ${isEditing ? 'bg-[#33322c] text-white' : 'hover:bg-[#f1f5f9] text-[#787569] hover:text-[#33322c]'}`}
                                          title="Edit"
                                        ><Pencil className="w-3.5 h-3.5" /></button>
                                        <button
                                          onClick={async () => { if (!detail) return; await api.deleteIssue(detail.id, issue.id); loadIssues(detail.id); setExpandedIssueId(null); }}
                                          className="p-1 rounded hover:bg-red-50 text-[#787569] hover:text-red-500"
                                          title="Delete"
                                        ><Trash2 className="w-3.5 h-3.5" /></button>
                                        <ChevronDown className={`w-3.5 h-3.5 text-[#787569] transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                                      </div>
                                    </div>

                                    {/* Expanded panel */}
                                    {isExpanded && (
                                      <div className="px-4 pb-4 bg-[#fafcff] border-t border-[#f0f0f0]">

                                        {/* Edit form */}
                                        {isEditing ? (
                                          <div className="pt-3 space-y-2">
                                            <input
                                              value={editIssueForm.title}
                                              onChange={e => setEditIssueForm(f => ({ ...f, title: e.target.value }))}
                                              className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#33322c]"
                                              placeholder="Title"
                                            />
                                            <textarea
                                              value={editIssueForm.body}
                                              onChange={e => setEditIssueForm(f => ({ ...f, body: e.target.value }))}
                                              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#33322c] resize-none"
                                              rows={2}
                                              placeholder="Description"
                                            />
                                            <div className="flex items-center gap-2">
                                              <select
                                                value={editIssueForm.severity}
                                                onChange={e => setEditIssueForm(f => ({ ...f, severity: e.target.value }))}
                                                className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none"
                                              >
                                                <option value="low">Low</option>
                                                <option value="medium">Medium</option>
                                                <option value="high">High</option>
                                              </select>
                                              <input
                                                type="date"
                                                value={editIssueForm.due_date}
                                                onChange={e => setEditIssueForm(f => ({ ...f, due_date: e.target.value }))}
                                                className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none"
                                              />
                                              <button
                                                onClick={async () => {
                                                  if (!detail) return;
                                                  await api.updateIssue(detail.id, issue.id, editIssueForm);
                                                  setEditingIssueId(null);
                                                  loadIssues(detail.id);
                                                }}
                                                disabled={!editIssueForm.title.trim()}
                                                className="flex items-center gap-1 text-xs px-2 py-1 bg-[#33322c] text-white rounded disabled:opacity-50"
                                              ><Check className="w-3 h-3" /> Save</button>
                                              <button onClick={() => setEditingIssueId(null)} className="text-xs text-[#787569] hover:text-[#33322c]">Cancel</button>
                                            </div>
                                          </div>
                                        ) : (
                                          issue.body && <p className="pt-3 text-xs text-[#545249] leading-relaxed">{issue.body}</p>
                                        )}

                                        {/* Comments */}
                                        <div className="mt-3">
                                          <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">
                                            Progress Updates {comments.length > 0 && `(${comments.length})`}
                                          </div>
                                          {comments.length > 0 && (
                                            <div className="space-y-2 mb-3">
                                              {comments.map((c: any) => (
                                                <div key={c.id} className="bg-white border border-slate-200 rounded px-3 py-2">
                                                  <p className="text-xs text-[#33322c] leading-relaxed">{c.body}</p>
                                                  <p className="text-[10px] text-[#787569] mt-1">
                                                    {new Date(c.created_at).toLocaleDateString()} {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {c.created_by}
                                                  </p>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          <div className="flex gap-2">
                                            <input
                                              value={newComment[issue.id] ?? ''}
                                              onChange={e => setNewComment(prev => ({ ...prev, [issue.id]: e.target.value }))}
                                              onKeyDown={async e => {
                                                if (e.key === 'Enter' && (newComment[issue.id] ?? '').trim() && detail) {
                                                  await api.addIssueComment(detail.id, issue.id, newComment[issue.id]);
                                                  const d = await api.listIssueComments(detail.id, issue.id);
                                                  setIssueComments(prev => ({ ...prev, [issue.id]: d.comments ?? [] }));
                                                  setNewComment(prev => ({ ...prev, [issue.id]: '' }));
                                                }
                                              }}
                                              placeholder="Add progress update... (Enter to save)"
                                              className="flex-1 text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#33322c] bg-white"
                                            />
                                            <button
                                              onClick={async () => {
                                                if (!(newComment[issue.id] ?? '').trim() || !detail) return;
                                                await api.addIssueComment(detail.id, issue.id, newComment[issue.id]);
                                                const d = await api.listIssueComments(detail.id, issue.id);
                                                setIssueComments(prev => ({ ...prev, [issue.id]: d.comments ?? [] }));
                                                setNewComment(prev => ({ ...prev, [issue.id]: '' }));
                                              }}
                                              disabled={!(newComment[issue.id] ?? '').trim()}
                                              className="text-xs px-2 py-1 bg-[#33322c] text-white rounded disabled:opacity-40"
                                            >Add</button>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  );
                                })}
                                {addingIssue && detail && (
                                  <div className="px-4 py-3 border-b border-slate-200 bg-[#fafafa]">
                                    <input
                                      value={newIssue.title}
                                      onChange={e => setNewIssue({ ...newIssue, title: e.target.value })}
                                      placeholder="Issue title"
                                      className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-[#33322c]"
                                      autoFocus
                                    />
                                    <textarea
                                      value={newIssue.body}
                                      onChange={e => setNewIssue({ ...newIssue, body: e.target.value })}
                                      placeholder="Description (optional)"
                                      className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-[#33322c]"
                                      rows={2}
                                    />
                                    <div className="flex items-center gap-2 mb-2">
                                      <select
                                        value={newIssue.severity}
                                        onChange={e => setNewIssue({ ...newIssue, severity: e.target.value })}
                                        className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none"
                                      >
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                      </select>
                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-[#787569]">Deadline</span>
                                        <input
                                          type="date"
                                          value={newIssue.due_date}
                                          onChange={e => setNewIssue({ ...newIssue, due_date: e.target.value })}
                                          className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none"
                                        />
                                      </div>
                                      <select
                                        value={newIssue.linked_document_id ?? ''}
                                        onChange={e => setNewIssue({ ...newIssue, linked_document_id: e.target.value ? parseInt(e.target.value) : null })}
                                        className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none flex-1"
                                      >
                                        <option value="">Link document (optional)...</option>
                                        {documents.map((d: any) => <option key={d.id} value={d.id}>{d.filename}</option>)}
                                      </select>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={async () => { await api.createIssue(detail.id, newIssue); setAddingIssue(false); loadIssues(detail.id); }}
                                        disabled={!newIssue.title.trim()}
                                        className="flex items-center gap-1 text-xs px-2 py-1 bg-[#33322c] text-white rounded disabled:opacity-50"
                                      ><Check className="w-3 h-3" /> Add</button>
                                      <button onClick={() => setAddingIssue(false)} className="text-xs text-[#787569] hover:text-[#33322c]">Cancel</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {detail.notes && (
                        <div className="p-3 bg-blue-50 border border-blue-100 rounded text-sm text-[#33322c]">{detail.notes}</div>
                      )}

                      {/* Last contact summary */}
                      {detail.last_contact ? (
                        <div className="flex items-start gap-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-0.5">
                              Last Contact · {new Date(detail.last_contact.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {detail.last_contact.created_by} · <span className="capitalize">{detail.last_contact.note_type}</span>
                            </p>
                            <p className="text-sm text-[#545249] truncate">{detail.last_contact.summary}{detail.last_contact.summary.length >= 120 ? '…' : ''}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                          <p className="text-xs text-[#787569]">No contact logged yet</p>
                        </div>
                      )}

                      {/* Matched companies */}
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-3">
                          Matched Companies <span className="font-normal">({detail.matches.length})</span>
                        </p>
                        {detail.matches.length === 0 ? (
                          <p className="text-sm text-[#787569]">No matches yet.</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-slate-200">
                                <th className="text-left py-2 pr-3 text-[10px] font-bold uppercase tracking-widest text-[#787569]">Company</th>
                                <th className="text-left py-2 pr-3 text-[10px] font-bold uppercase tracking-widest text-[#787569]">Sector</th>
                                <th className="text-left py-2 pr-3 text-[10px] font-bold uppercase tracking-widest text-[#787569] w-28">Score</th>
                                <th className="text-left py-2 pr-3 text-[10px] font-bold uppercase tracking-widest text-[#787569]">Reason</th>
                                <th className="text-left py-2 text-[10px] font-bold uppercase tracking-widest text-[#787569]">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#f1f5f9]">
                              {detail.matches.map(m => (
                                <tr key={m.id} className="hover:bg-slate-50">
                                  <td className="py-2.5 pr-3 font-medium text-[#33322c]">{m.name}</td>
                                  <td className="py-2.5 pr-3 text-[#545249] text-xs">{m.sector ?? '—'}</td>
                                  <td className="py-2.5 pr-3 w-28"><ScoreBar score={m.match_score} /></td>
                                  <td className="py-2.5 pr-3 text-[#545249] text-xs max-w-[180px] truncate" title={m.match_reason}>{m.match_reason}</td>
                                  <td className="py-2.5">
                                    <select
                                      value={m.status}
                                      onChange={e => handleStatusChange(m.id, e.target.value)}
                                      className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#33322c]"
                                    >
                                      {MATCH_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                                    </select>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Documents Tab ─────────────────────────────────────── */}
                  {activeTab === 'documents' && (
                    <div>
                      {/* Contract — pinned at top */}
                      {contract && (
                        <div className="mb-5">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Contract</p>

                          {/* Expiry alert */}
                          {contract.expiring_soon && contract.days_until_expiry != null && (
                            <div className={`flex items-center gap-2 px-4 py-2.5 rounded text-sm font-medium mb-3 ${
                              contract.status_color === 'red'
                                ? 'bg-red-50 border border-red-200 text-red-700'
                                : 'bg-yellow-50 border border-yellow-200 text-yellow-700'
                            }`}>
                              <span>{contract.status_color === 'red' ? '⚠️' : '⏰'}</span>
                              <span>
                                Contract expires in <strong>{contract.days_until_expiry} days</strong>
                                {contract.expiry_date ? ` (${formatDate(contract.expiry_date)})` : ''}.
                                {contract.status_color === 'red' ? ' Renewal overdue — take action.' : ' Schedule renewal conversation.'}
                              </span>
                            </div>
                          )}

                          {/* Contract card */}
                          <div className="border border-slate-200 rounded overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
                              <div className="flex items-center gap-3">
                                <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide border ${
                                  contract.contract_status?.toLowerCase() === 'active'
                                    ? 'bg-[#10b981]/10 text-[#10b981] border-[#10b981]/30'
                                    : 'bg-[#f1f5f9] text-[#545249] border-slate-200'
                                }`}>
                                  {contract.contract_status ?? 'Unknown'}
                                </span>
                                {(() => { const v = contract.value ?? contract.contract_value; return v != null ? (
                                  <span className="text-xs text-[#545249]">
                                    {v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${(v/1_000).toFixed(0)}K` : `$${v}`}
                                  </span>
                                ) : null; })()}
                              </div>
                              <div className="flex items-center gap-3">
                                {contract.expiry_date ? (
                                  <span className={`text-xs font-medium ${
                                    contract.status_color === 'red' ? 'text-red-500'
                                    : contract.status_color === 'yellow' ? 'text-yellow-600'
                                    : 'text-[#10b981]'
                                  }`}>
                                    {contract.days_until_expiry != null ? `${contract.days_until_expiry}d remaining` : formatDate(contract.expiry_date)}
                                  </span>
                                ) : (
                                  <span className="text-xs text-[#787569]">No expiry on file</span>
                                )}
                                {contract.raw_summary && (
                                  <button
                                    className="text-[10px] text-[#787569] hover:text-[#33322c] transition-colors"
                                    onClick={() => setSummaryExpanded(v => !v)}
                                  >
                                    {summaryExpanded ? 'Hide summary ▲' : 'View summary ▼'}
                                  </button>
                                )}
                              </div>
                            </div>
                            {summaryExpanded && contract.raw_summary && (
                              <div className="px-4 py-3 border-b border-slate-200">
                                <pre className="text-xs text-[#33322c] whitespace-pre-wrap font-sans max-h-40 overflow-y-auto">
                                  {contract.raw_summary}
                                </pre>
                              </div>
                            )}
                            {contract.filename && (
                              <div className="px-4 py-3 flex items-center gap-3">
                                <FileText className="w-4 h-4 text-[#787569] flex-shrink-0" />
                                <span className="flex-1 text-sm text-[#33322c] truncate">{contract.filename}</span>
                                <button
                                  onClick={async () => {
                                    const r = await fetch(`/partners/${selectedId}/contract/file`, { headers: AUTH });
                                    if (!r.ok) return;
                                    const blob = await r.blob();
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url; a.download = contract.filename!; a.click();
                                    URL.revokeObjectURL(url);
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#33322c] text-white rounded hover:bg-[#151411] transition-colors flex-shrink-0"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  View Contract
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Upload area */}
                      <div
                        className="border-2 border-dashed border-slate-200 rounded p-6 mb-5 text-center hover:border-[#33322c] transition-colors cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                      >
                        <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { handleUpload(f); e.target.value = ''; } }} />
                        {uploading ? (
                          <div className="flex items-center justify-center gap-2 text-[#10b981]">
                            <div className="w-5 h-5 border-2 border-[#10b981] border-t-transparent rounded-full animate-spin" />
                            <span className="text-sm">Uploading &amp; extracting text...</span>
                          </div>
                        ) : (
                          <>
                            <Upload className="w-8 h-8 text-[#c5c0ad] mx-auto mb-2" />
                            <p className="text-sm text-[#545249]">Drop a file here or click to upload</p>
                            <p className="text-xs text-[#787569] mt-1">PDF, DOCX, TXT · max 150MB</p>
                          </>
                        )}
                      </div>

                      {/* Optional label for next upload */}
                      <div className="flex items-center gap-2 mb-5">
                        <input
                          type="text"
                          placeholder='Label for next upload (e.g. "Q1 2026 Overview")'
                          value={uploadLabel}
                          onChange={e => setUploadLabel(e.target.value)}
                          className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#33322c]"
                        />
                      </div>

                      {/* Document list */}
                      {documents.length === 0 ? (
                        <p className="text-sm text-[#787569] text-center py-4">No documents uploaded yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {documents.map(doc => {
                            const intel = doc.extracted_intel;
                            const hasIntel = !!(doc.summary || intel);
                            const isExpanded = expandedDocId === doc.id;
                            return (
                            <div key={doc.id} className="border border-slate-200 rounded overflow-hidden">
                              <div className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                                <FileText className="w-4 h-4 text-[#787569] flex-shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 group/title">
                                    {editingDocTitle === doc.id ? (
                                      <input
                                        autoFocus
                                        value={docTitleDraft}
                                        onChange={e => setDocTitleDraft(e.target.value)}
                                        onBlur={async () => {
                                          const trimmed = docTitleDraft.trim();
                                          if (trimmed && trimmed !== doc.title) {
                                            await fetch(`/partners/${detail.id}/documents/${doc.id}`, {
                                              method: 'PATCH',
                                              headers: { ...AUTH, 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ title: trimmed }),
                                            });
                                            await loadDocuments(detail.id);
                                          }
                                          setEditingDocTitle(null);
                                        }}
                                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingDocTitle(null); }}
                                        className="text-sm font-medium text-[#33322c] border-b border-[#33322c] outline-none bg-transparent flex-1 min-w-0"
                                      />
                                    ) : (
                                      <>
                                        <span className="text-sm font-medium text-[#33322c] truncate">{doc.title || doc.filename}</span>
                                        <button
                                          onClick={() => { setEditingDocTitle(doc.id); setDocTitleDraft(doc.title || doc.filename); }}
                                          className="opacity-0 group-hover/title:opacity-100 p-0.5 rounded hover:bg-[#f1f5f9] text-[#787569] hover:text-[#33322c] transition-all flex-shrink-0"
                                          title="Rename document"
                                        ><Pencil className="w-3 h-3" /></button>
                                      </>
                                    )}
                                    <FileTypeBadge type={doc.file_type} />
                                  </div>
                                  <div className="flex items-center gap-3 mt-0.5 text-xs text-[#787569]">
                                    {doc.source_label && <span className="font-medium text-[#545249]">{doc.source_label}</span>}
                                    <span>{doc.document_date ? new Date(doc.document_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : formatDate(doc.uploaded_at)}</span>
                                    {doc.text_length > 0 && <span>{(doc.text_length / 1000).toFixed(1)}k chars</span>}
                                  </div>
                                  {/* Inline summary */}
                                  {doc.summary && (
                                    <p className="text-xs text-[#33322c] mt-1.5 leading-relaxed">{doc.summary}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {/* Analyze button — shown when doc has text but no intel yet */}
                                  {doc.parsed && !hasIntel && (
                                    <button
                                      onClick={async () => {
                                        await fetch(`/partners/${detail.id}/documents/${doc.id}/analyze`, { method: 'POST', headers: AUTH });
                                        setTimeout(() => loadDocuments(detail.id), 8000);
                                      }}
                                      className="p-1.5 rounded hover:bg-[#f1f5f9] text-[#787569] hover:text-[#f59e0b] transition-colors"
                                      title="Extract intel from this document"
                                    >
                                      <Sparkles className="w-4 h-4" />
                                    </button>
                                  )}
                                  {hasIntel && (
                                    <button
                                      onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                                      className={`p-1.5 rounded hover:bg-[#f1f5f9] transition-colors ${isExpanded ? 'text-[#10b981]' : 'text-[#787569]'}`}
                                      title="View intel"
                                    >
                                      <Eye className="w-4 h-4" />
                                    </button>
                                  )}
                                  {doc.has_file && (
                                    <a
                                      href={`/partners/${detail.id}/documents/${doc.id}/download`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="p-1.5 rounded hover:bg-[#f1f5f9] text-[#787569] hover:text-[#33322c] transition-colors"
                                      title="Download original file"
                                    >
                                      <ExternalLink className="w-4 h-4" />
                                    </a>
                                  )}
                                  <button onClick={() => handleDeleteDoc(doc.id)} className="p-1.5 rounded hover:bg-red-50 text-[#787569] hover:text-red-500 transition-colors" title="Delete">
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                              {/* Intel panel */}
                              {isExpanded && hasIntel && (
                                <div className="border-t border-slate-200 px-4 py-3 bg-white space-y-3">
                                  <div className="flex items-center gap-1.5 pb-1 border-b border-slate-200">
                                    <FileText className="w-3 h-3 text-[#787569]" />
                                    <span className="text-[10px] text-[#787569]">Intelligence from:</span>
                                    <span className="text-[10px] font-semibold text-[#33322c] truncate">{doc.title || doc.filename}</span>
                                  </div>
                                  {intel?.action_items && intel.action_items.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Action Items</p>
                                      <ul className="space-y-0.5">
                                        {intel.action_items.map((item, i) => (
                                          <li key={i} className="flex items-start gap-1.5 text-xs text-[#33322c]">
                                            <span className="text-[#10b981] mt-0.5 flex-shrink-0">›</span>{item}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {intel?.next_steps && intel.next_steps.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Next Steps</p>
                                      <ul className="space-y-0.5">
                                        {intel.next_steps.map((item, i) => (
                                          <li key={i} className="flex items-start gap-1.5 text-xs text-[#33322c]">
                                            <span className="text-[#6366f1] mt-0.5 flex-shrink-0">›</span>{item}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {intel?.startup_mentions && intel.startup_mentions.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Startups Mentioned</p>
                                      <div className="flex flex-wrap gap-1">
                                        {intel.startup_mentions.map((s, i) => (
                                          <span key={i} className="px-2 py-0.5 bg-[#33322c]/10 text-[#33322c] text-xs rounded">{s}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {intel?.key_themes && intel.key_themes.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Key Themes</p>
                                      <div className="flex flex-wrap gap-1">
                                        {intel.key_themes.map((t, i) => (
                                          <span key={i} className="px-2 py-0.5 bg-slate-50 text-[#545249] text-xs rounded">{t}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Requests Tab ─────────────────────────────────────── */}
                  {activeTab === 'requests' && (
                    <div>
                      {partnerRequests.requests.length === 0 ? (
                        <p className="text-sm text-[#787569] text-center py-8">No long-list request history for this partner.</p>
                      ) : (
                        <div className="space-y-6">
                          {/* Year-by-year timeline */}
                          {partnerRequests.by_year.map(yr => {
                            const yearRows = partnerRequests.requests.filter(r => r.year === yr.year);
                            const dfCount = yearRows.filter(r => r.led_to_dealflow).length;
                            return (
                              <div key={yr.year}>
                                {/* Year header */}
                                <div className="flex items-center gap-3 mb-2">
                                  <span className="text-sm font-bold text-[#33322c]">{yr.year}</span>
                                  <span className="text-xs text-[#787569]">{yr.request_count} request{yr.request_count !== 1 ? 's' : ''}</span>
                                  {dfCount > 0 && (
                                    <span className="text-xs px-1.5 py-0.5 bg-[#10b981]/10 text-[#10b981] rounded font-medium">{dfCount} → DF</span>
                                  )}
                                  {/* Topic pills for year */}
                                  <div className="flex flex-wrap gap-1 ml-1">
                                    {(yr.topics as string[]).slice(0, 6).map((t: string) => (
                                      <span key={t} className="text-[10px] px-1.5 py-0.5 bg-slate-50 text-[#545249] rounded">{t}</span>
                                    ))}
                                    {yr.topics.length > 6 && <span className="text-[10px] text-[#787569]">+{yr.topics.length - 6} more</span>}
                                  </div>
                                </div>
                                {/* Request rows for this year */}
                                <div className="border border-slate-200 rounded-lg divide-y divide-[#f1f5f9]">
                                  {yearRows.map(req => (
                                    <div key={req.id} className="px-4 py-2.5 hover:bg-[#fafafa]">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-xs font-semibold text-[#33322c]">{req.tech_focus}</span>
                                            {req.led_to_dealflow && (
                                              <span className="text-[10px] px-1.5 py-0.5 bg-[#10b981]/10 text-[#10b981] rounded font-medium">→ DF</span>
                                            )}
                                            {req.is_complete && !req.led_to_dealflow && (
                                              <span className="text-[10px] text-[#c5c0ad]">✓</span>
                                            )}
                                          </div>
                                          {req.notes && (
                                            <p className="text-xs text-[#545249] line-clamp-2">{req.notes}</p>
                                          )}
                                          <div className="flex items-center gap-3 mt-1">
                                            {req.ventures_person && <span className="text-[10px] text-[#787569]">Ventures: {req.ventures_person}</span>}
                                            {req.playbook_url && (
                                              <a href={req.playbook_url} target="_blank" rel="noreferrer" className="text-[10px] text-[#33322c] hover:underline">Playbook →</a>
                                            )}
                                          </div>
                                        </div>
                                        <span className="text-[10px] text-[#787569] whitespace-nowrap flex-shrink-0">{req.requested_date ?? '—'}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── News Tab ─────────────────────────────────────────── */}
                  {activeTab === 'news' && (
                    <div>
                      {/* Activity type filter pills */}
                      <div className="flex gap-1.5 flex-wrap mb-4">
                        {(['all', 'venture', 'ma', 'lawsuit', 'budget', 'partnership'] as const).map(f => (
                          <button
                            key={f}
                            onClick={() => setNewsFilter(f)}
                            className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all ${
                              newsFilter === f
                                ? 'bg-[#33322c] text-[#F59E0B] border-[#33322c]'
                                : 'bg-white text-[#545249] border-slate-200 hover:border-[#33322c]'
                            }`}
                          >
                            {f === 'all' ? 'All' : f === 'ma' ? 'M&A' : f.charAt(0).toUpperCase() + f.slice(1)}
                          </button>
                        ))}
                      </div>

                      {newsLoading ? (
                        <div className="flex justify-center py-12">
                          <div className="w-5 h-5 border-2 border-[#33322c] border-r-transparent rounded-full animate-spin" />
                        </div>
                      ) : (() => {
                        const filtered = partnerNews.filter(a =>
                          newsFilter === 'all' || (a.activity_type || 'general') === newsFilter
                        );
                        return filtered.length === 0 ? (
                          <div className="text-center py-10 text-[#787569]">
                            <p className="text-sm font-medium">
                              {partnerNews.length === 0 ? 'No news collected yet' : 'No articles match this filter'}
                            </p>
                            {partnerNews.length === 0 && (
                              <p className="text-xs mt-1">This partner will be picked up on the next 6-hour news fetch.</p>
                            )}
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-100 -mx-6 px-0">
                            {filtered.map((a: any) => {
                              const type = a.activity_type || 'general';
                              const typeColors: Record<string, string> = {
                                venture: 'bg-emerald-50 text-emerald-700',
                                ma: 'bg-orange-50 text-orange-700',
                                lawsuit: 'bg-red-50 text-red-700',
                                budget: 'bg-blue-50 text-blue-700',
                                partnership: 'bg-purple-50 text-purple-700',
                                general: 'bg-amber-50 text-amber-700',
                              };
                              const daysAgo = Math.floor((Date.now() - new Date(a.published_at).getTime()) / 86400000);
                              const dateLabel = daysAgo === 0 ? 'today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`;
                              return (
                                <a
                                  key={a.id}
                                  href={a.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-start gap-3 px-6 py-3 hover:bg-[#FAF9F6] transition-colors group"
                                >
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-medium text-[#1E293B] leading-snug group-hover:text-[#6366F1] transition-colors line-clamp-2">
                                      {a.title}
                                    </p>
                                    <div className="flex items-center gap-2 mt-1">
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${typeColors[type] ?? typeColors.general}`}>
                                        {type === 'ma' ? 'M&A' : type}
                                      </span>
                                      <span className="text-[10px] text-[#787569]">{dateLabel}</span>
                                    </div>
                                  </div>
                                </a>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                </div>
              </>
            )}
          </div>
        </div>
      </main>

      {/* ── New Partner Modal ──────────────────────────────────────────────────── */}
      {showNewPartner && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white">
              <h2 className={cls.sectionTitle}>New Partner</h2>
              <button onClick={() => setShowNewPartner(false)} className="text-[#545249] hover:text-[#33322c]"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {[
                { label: 'Name *', key: 'name', placeholder: 'Organization name' },
                { label: 'Industry', key: 'industry', placeholder: 'e.g. Automotive, Logistics' },
                { label: 'Contact Name', key: 'contact_name', placeholder: 'Primary contact' },
                { label: 'Contact Email', key: 'contact_email', placeholder: 'email@company.com' },
                { label: 'Sectors of Interest', key: 'sectors_of_interest', placeholder: 'Comma-separated: Robotics, Manufacturing' },
                { label: 'Challenge Areas', key: 'challenge_areas', placeholder: 'Comma-separated: Warehouse automation, Last-mile' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-sm font-medium text-[#33322c] mb-1">{f.label}</label>
                  <input type="text" placeholder={f.placeholder} value={newForm[f.key as keyof typeof newForm]} onChange={e => setNewForm(prev => ({ ...prev, [f.key]: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#33322c]" />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-[#33322c] mb-1">Notes</label>
                <textarea placeholder="Additional context..." value={newForm.notes} onChange={e => setNewForm(prev => ({ ...prev, notes: e.target.value }))} rows={3} className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#33322c] resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-200">
              <button onClick={() => setShowNewPartner(false)} className="px-4 py-2 text-sm text-[#545249] hover:text-[#33322c]">Cancel</button>
              <button onClick={handleCreatePartner} disabled={savingPartner || !newForm.name.trim()} className="px-4 py-2 bg-[#33322c] text-white text-sm rounded hover:bg-[#33322c]/90 disabled:opacity-50 disabled:cursor-not-allowed">
                {savingPartner ? 'Saving...' : 'Create Partner'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ── Confirm Delete Modal ──────────────────────────────────────────────── */}
      {confirmDelete && detail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#33322c]">Delete {detail.name}?</h3>
                <p className="text-sm text-[#545249] mt-0.5">This will remove the partner, all matches, documents, and notes. Cannot be undone.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelete(false)} className="px-4 py-2 text-sm text-[#545249] hover:text-[#33322c]">Cancel</button>
              <button onClick={handleDeletePartner} className="px-4 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600">Delete Partner</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
