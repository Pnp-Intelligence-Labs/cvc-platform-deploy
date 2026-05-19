import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { CVCNavbar } from '../components/CVCNavbar';
import { RefreshCw, CheckCircle, Clock, XCircle, ExternalLink, Zap, Factory, Search, X, List, ChevronDown, ChevronRight, Upload, FileText, Trash2, Play, FlaskConical, Inbox, Pencil, Check, Download, AlertTriangle, BookOpen, Shield, Rss, Plus, ToggleLeft, ToggleRight, Globe, Loader, ThumbsUp, ThumbsDown, GitMerge, Lock, Briefcase } from 'lucide-react';
import { cls } from '../components/tokens';
import { AUTH_HEADER as AUTH } from '../api/client';


interface Stats { enriched: number; pending: number; failed: number; total: number; }
interface Company {
  id: number; name: string; sector?: string; stage?: string;
  website?: string; enrichment_status: string; enrichment_confidence?: number; updated_at?: string;
  has_4d?: boolean; has_industrial?: boolean; has_dd?: boolean; has_review?: boolean;
}
interface EnrichmentTask {
  task_id?: number;
  enrichment_type: 'industrial' | 'dd' | '4d' | 'funding' | 'news' | 'founder';
  company_id?: number;
  company_name: string;
  sector?: string;
  status: string;
  created_at?: string;
}
interface DDPipelineStatus {
  status: 'not_started' | 'ingested' | 'running' | 'complete';
  company_name: string;
  stages: {
    ingestion: boolean;
    agents: Record<string, boolean>;
    overview: boolean;
    appendix: boolean;
    outputs: { ic_memo: boolean; appendix: boolean; scorecard: boolean };
  };
}
interface DDOverview {
  recommendation?: string;
  recommendation_rationale?: string;
  investment_thesis?: string;
  section_summaries?: Record<string, string>;
  all_flags?: { severity?: string; agent?: string; flag?: string; text?: string }[];
  scorecard?: Record<string, any>;
  key_metrics?: Record<string, string>;
}

const DD_AGENTS = ['financials', 'comp', 'qualitative', 'product', 'news', 'general'] as const;
const DD_AGENT_LABELS: Record<string, string> = {
  financials: 'Fin', comp: 'Market', qualitative: 'Team', product: 'Product', news: 'News', general: 'General',
};
const DD_AGENT_DESCRIPTIONS: Record<string, string> = {
  financials:  'Reads P&L, cap tables, and projections. Extracts ARR, burn rate, unit economics, and runway.',
  comp:        'Analyzes market size, competitive landscape, comparable rounds, and market timing.',
  qualitative: 'Evaluates founders, team composition, prior exits, advisory relationships, and hiring signals.',
  product:     'Assesses product maturity, technical differentiation, IP, integrations, and roadmap.',
  news:        'Pulls recent press, customer deployments, and technology signals from the web.',
  general:     'Routes this file to all four specialist agents. Use for pitch decks or any document that spans multiple areas.',
};

interface RoutingGroup {
  group: string;
  label: string;
  file_count: number;
  agents: string[];
  default_agents: string[];
}
interface RoutingFile {
  name: string;
  size: number;
  agents: string[];
}
interface RoutingData {
  has_manifest: boolean;
  has_override: boolean;
  groups: RoutingGroup[];
  files: RoutingFile[];
}
interface IntelSuggestion {
  id: number;
  company_id: number;
  company_name: string;
  sector?: string;
  suggestion_type: string;
  suggested_data: {
    // funding round fields
    round_type?: string;
    amount_usd?: number;
    announced_date?: string;
    investors?: string[];
    valuation_usd?: number;
    approximate?: boolean;
    source_url?: string;
    // case study fields
    title?: string;
    url?: string;
    snippet?: string;
    age?: string;
  };
  confidence: number;
  reasoning?: string;
  status: string;
  created_at?: string;
}

interface BriefingSource {
  id: number;
  name: string;
  url?: string;
  source_type: string;
  category?: string;
  active: boolean;
  notes?: string;
  added_by?: string;
  created_at?: string;
}
interface CronJob {
  id: number;
  name: string;
  schedule: string;
  description?: string;
  command?: string;
  machine: string;
  category?: string;
  active: boolean;
  log_path?: string;
  updated_at?: string;
}

const PIPELINE_STAGES = [
  { key: 'files',      label: 'Files'      },
  { key: 'ingestion',  label: 'Ingestion'  },
  { key: 'financials', label: 'Financials' },
  { key: 'comp',       label: 'Market'     },
  { key: 'qualitative',label: 'Team'       },
  { key: 'product',    label: 'Product'    },
  { key: 'news',       label: 'News'       },
  { key: 'overview',   label: 'IC Memo'    },
  { key: 'outputs',    label: 'Outputs'    },
];

const RECO_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  invest:      { label: 'Invest',      color: '#065f46', bg: '#d1fae5' },
  conditional: { label: 'Conditional', color: '#92400e', bg: '#fef3c7' },
  watch:       { label: 'Watch',       color: '#1e40af', bg: '#dbeafe' },
  pass:        { label: 'Pass',        color: '#991b1b', bg: '#fee2e2' },
};

const STATUS_TABS = [
  { key: 'pending',      label: 'Pending',      icon: Clock,       color: '#f59e0b', bg: '#fefce8' },
  { key: 'human_review', label: 'Human Review', icon: GitMerge,    color: '#7c3aed', bg: '#f5f3ff', noCount: true },
  { key: 'failed',       label: 'Failed',       icon: XCircle,     color: '#ef4444', bg: '#fef2f2' },
  { key: 'enriched',     label: 'Enriched',     icon: CheckCircle, color: '#10b981', bg: '#f0fdf4' },
  { key: 'requests',     label: 'Requests',     icon: List,        color: '#6366f1', bg: '#f5f3ff' },
  { key: 'intelligence', label: 'Intel Briefing', icon: Rss,       color: '#0ea5e9', bg: '#f0f9ff', noCount: true },
  { key: 'methodology',  label: 'Methodology',  icon: BookOpen,    color: '#33322c', bg: '#f0f4f7', noCount: true },
  { key: 'brambles',     label: 'Brambles Fund', icon: Briefcase,   color: '#1B3A4B', bg: '#e8f0f5', noCount: true },
] as const;

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  dd:         { label: 'DD',         color: '#a16207', bg: '#fefce8' },
  industrial: { label: 'Industrial', color: '#7c3aed', bg: '#f5f3ff' },
  '4d':       { label: '4D',         color: '#33322c', bg: '#f0f4f7' },
};

const TASK_STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  pending:    { color: '#f59e0b', bg: '#fefce8' },
  building:   { color: '#3b82f6', bg: '#eff6ff' },
  complete:   { color: '#10b981', bg: '#f0fdf4' },
  deployed:   { color: '#10b981', bg: '#f0fdf4' },
  failed:     { color: '#ef4444', bg: '#fef2f2' },
  approved:   { color: '#a16207', bg: '#fefce8' },
  superseded: { color: '#94a3b8', bg: '#f1f5f9' },
};

const ENRICHMENT_OPTIONS = [
  {
    key: 'run_4d',
    label: '4D Enrichment',
    desc: 'Website scrape + Brave search → LLM classifies all four dimensions',
    icon: Zap,
    color: '#33322c',
    bg: '#f0f4f7',
  },
  {
    key: 'run_industrial',
    label: 'Industrial',
    desc: 'Score readiness, sovereignty, protocol support',
    icon: Factory,
    color: '#7c3aed',
    bg: '#f5f3ff',
  },
  {
    key: 'run_dd',
    label: 'DD Pipeline',
    desc: 'Queue full due diligence — runs immediately on submission',
    icon: Search,
    color: '#a16207',
    bg: '#fefce8',
  },
];

// ── Human Review Tab ─────────────────────────────────────────────────────────

function HumanReviewTab({
  suggestions, loading, actioning, onApprove, onReject, onRefresh, navigate,
}: {
  suggestions: IntelSuggestion[];
  loading: boolean;
  actioning: number | null;
  onApprove: (id: number, sourceOverride?: string) => void;
  onReject: (id: number) => void;
  onRefresh: () => void;
  navigate: (path: string) => void;
}) {
  const fmt = (n?: number | null) => {
    if (!n) return '—';
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  };

  const confColor = (c: number) =>
    c >= 0.9 ? '#10b981' : c >= 0.7 ? '#f59e0b' : '#ef4444';

  const [editingSourceId, setEditingSourceId] = useState<number | null>(null);
  const [sourceOverrides, setSourceOverrides] = useState<Record<number, string>>({});

  const fundingRows  = suggestions.filter(s => s.suggestion_type === 'new_funding_round');
  const caseStudyRows = suggestions.filter(s => s.suggestion_type === 'case_study');

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#33322c] border-r-transparent" />
    </div>
  );

  const ActionButtons = ({ s }: { s: IntelSuggestion }) => {
    const isActioning = actioning === s.id;
    const override = sourceOverrides[s.id];
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onApprove(s.id, override || undefined)}
          disabled={isActioning}
          title={override ? `Approve with source: ${override}` : 'Approve'}
          className="p-1.5 rounded text-[#10b981] hover:bg-[#f0fdf4] transition-colors disabled:opacity-40"
        >
          {isActioning ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => onReject(s.id)}
          disabled={isActioning}
          title="Reject"
          className="p-1.5 rounded text-[#ef4444]/60 hover:text-[#ef4444] hover:bg-[#fef2f2] transition-colors disabled:opacity-40"
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  return (
    <div className="p-5 space-y-8">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#545249]">
          {suggestions.length} pending — approve to write to DB, reject to dismiss
        </p>
        <button onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#545249] hover:bg-[#f1f5f9]/30 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {suggestions.length === 0 && (
        <div className="text-center py-16 text-[#787569]">
          <GitMerge className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No pending suggestions</p>
        </div>
      )}

      {/* Funding Rounds */}
      {fundingRows.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#33322c] mb-3">
            Funding Round Suggestions <span className="ml-1.5 text-xs font-normal text-[#787569]">{fundingRows.length}</span>
          </h3>
          <table className="w-full text-sm">
            <thead className="bg-[#ede8d7] border-b border-slate-200">
              <tr>
                {['Company', 'Round', 'Amount', 'Date', 'Investors', 'Conf.', 'Source', ''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f5f5f5]">
              {fundingRows.map(s => {
                const d = s.suggested_data;
                return (
                  <tr key={s.id} className="hover:bg-[#fafcff]">
                    <td className="px-3 py-3">
                      <button onClick={() => navigate(`/companies/${s.company_id}`)}
                        className="font-medium text-[#33322c] hover:underline text-left leading-tight">
                        {s.company_name}
                      </button>
                      {s.sector && <div className="text-[10px] text-[#787569] mt-0.5">{s.sector}</div>}
                    </td>
                    <td className="px-3 py-3">
                      <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-[#f5f3ff] text-[#7c3aed]">
                        {d.round_type ?? '—'}
                      </span>
                      {d.approximate && <span className="ml-1 text-[10px] text-[#787569]">~</span>}
                    </td>
                    <td className="px-3 py-3 font-medium text-[#33322c]">{fmt(d.amount_usd)}</td>
                    <td className="px-3 py-3 text-xs text-[#545249]">{d.announced_date ?? '—'}</td>
                    <td className="px-3 py-3 text-xs text-[#545249] max-w-[160px]">
                      {d.investors && d.investors.length > 0
                        ? d.investors.slice(0, 3).join(', ') + (d.investors.length > 3 ? ` +${d.investors.length - 3}` : '')
                        : '—'}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs font-bold" style={{ color: confColor(s.confidence) }}>
                        {Math.round(s.confidence * 100)}%
                      </span>
                    </td>
                    <td className="px-3 py-3 min-w-[140px]">
                      {editingSourceId === s.id ? (
                        <div className="flex flex-col gap-1">
                          <input
                            autoFocus
                            type="url"
                            value={sourceOverrides[s.id] ?? d.source_url ?? ''}
                            onChange={e => setSourceOverrides(prev => ({ ...prev, [s.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Escape') setEditingSourceId(null); }}
                            placeholder="Paste article URL…"
                            className="w-full text-[10px] border border-[#6366f1] rounded px-1.5 py-1 outline-none bg-white text-[#33322c]"
                          />
                          <button
                            onClick={() => setEditingSourceId(null)}
                            className="text-[9px] text-[#787569] hover:text-[#33322c] text-left"
                          >
                            {sourceOverrides[s.id] ? '✓ saved — approve to confirm' : 'cancel'}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 group">
                          {(() => {
                            const url = sourceOverrides[s.id] || d.source_url;
                            if (!url) return <span className="text-[10px] text-[#787569]">—</span>;
                            let hostname = 'source';
                            try { hostname = new URL(url).hostname.replace('www.', ''); } catch {}
                            return (
                              <a href={url} target="_blank" rel="noopener noreferrer"
                                className={`flex items-center gap-1 text-[10px] hover:underline ${sourceOverrides[s.id] ? 'text-[#10b981] font-semibold' : 'text-[#6366f1]'}`}>
                                {hostname}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            );
                          })()}
                          <button
                            onClick={() => setEditingSourceId(s.id)}
                            title="Edit source URL"
                            className="p-0.5 rounded text-[#b0aaa0] hover:text-[#6366f1] transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3"><ActionButtons s={s} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Case Studies */}
      {caseStudyRows.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#33322c] mb-3">
            Case Study Suggestions <span className="ml-1.5 text-xs font-normal text-[#787569]">{caseStudyRows.length} — sourced by Brave Search</span>
          </h3>
          <div className="space-y-2">
            {caseStudyRows.map(s => {
              const d = s.suggested_data;
              return (
                <div key={s.id} className="border border-slate-200 rounded-lg p-3 hover:bg-[#fafcff]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <button onClick={() => navigate(`/companies/${s.company_id}`)}
                          className="text-xs font-semibold text-[#6366f1] hover:underline">
                          {s.company_name}
                        </button>
                        {s.sector && <span className="text-[10px] text-[#787569]">{s.sector}</span>}
                        <span className="text-[10px] font-bold ml-auto" style={{ color: confColor(s.confidence) }}>
                          {Math.round(s.confidence * 100)}%
                        </span>
                      </div>
                      <p className="text-xs font-medium text-[#33322c] leading-snug mb-1">{d.title || '—'}</p>
                      {d.snippet && <p className="text-[11px] text-[#545249] leading-snug mb-1.5 line-clamp-2">{d.snippet}</p>}
                      <div className="flex items-center gap-3">
                        {d.url && (
                          <a href={d.url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[10px] text-[#6366f1] hover:underline">
                            {(() => { try { return new URL(d.url).hostname.replace('www.', ''); } catch { return 'source'; } })()}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {d.age && <span className="text-[10px] text-[#787569]">{d.age}</span>}
                      </div>
                    </div>
                    <ActionButtons s={s} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Industrial methodology helpers (moved from IndustrialMatrix) ────────────
const IND_SECTORS = ['Robotics', 'Manufacturing', 'Supply Chain', 'Industrial Automation', 'Physical AI'];
const IND_DEFAULT_WEIGHTS = { readiness: 0.4, sovereignty: 0.3, friction: 0.3 };
const IND_WEIGHT_KEY = (s: string) => `cvc_industrial_weights_${s || 'all'}`;
function loadIndWeights(sector: string) {
  try { const s = localStorage.getItem(IND_WEIGHT_KEY(sector)); if (s) return JSON.parse(s) as typeof IND_DEFAULT_WEIGHTS; } catch { /* */ }
  return { ...IND_DEFAULT_WEIGHTS };
}
function saveIndWeights(sector: string, w: typeof IND_DEFAULT_WEIGHTS) {
  localStorage.setItem(IND_WEIGHT_KEY(sector), JSON.stringify(w));
}

function MethodologyContent() {
  const [subTab, setSubTab] = useState<'founder' | '4d' | 'funding' | 'news' | 'industrial' | 'scoring' | 'dd' | 'intel' | 'psm' | 'traction'>('founder');
  const [indSector, setIndSector] = useState('');
  const [weights, setWeights] = useState(() => loadIndWeights(''));
  const [saved, setSaved] = useState(false);
  const totalWeight = +(weights.readiness + weights.sovereignty + weights.friction).toFixed(2);
  const isValid = Math.abs(totalWeight - 1.0) < 0.005;
  const updateWeight = (k: keyof typeof weights, v: number) => { setWeights(w => ({ ...w, [k]: Math.round(v * 100) / 100 })); setSaved(false); };
  const handleSectorChange = (s: string) => { setIndSector(s); setWeights(loadIndWeights(s)); setSaved(false); };

  // Analyst Review state (lives here because MethodologyContent is a separate component)
  const [ddCompanies, setDdCompanies]             = useState<{ id: number; name: string }[]>([]);
  const [reviewCompanyId, setReviewCompanyId]     = useState<number | null>(null);
  const [reviewScorecard, setReviewScorecard]     = useState<File | null>(null);
  const [reviewAppendix, setReviewAppendix]       = useState<File | null>(null);
  const [reviewSubmitting, setReviewSubmitting]   = useState(false);
  const [reviewResult, setReviewResult]           = useState<{ findings_parsed: number; message: string } | null>(null);
  const [reviewError, setReviewError]             = useState('');
  const reviewScorecardRef = useRef<HTMLInputElement>(null);
  const reviewAppendixRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/enrichment/enrichment-list?status=enriched&limit=200', {
      headers: AUTH,
    })
      .then(r => r.ok ? r.json() : [])
      .then((rows: any[]) => setDdCompanies(rows.filter((c: any) => c.has_dd).map((c: any) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  const handleReviewSubmit = async () => {
    if (!reviewCompanyId || !reviewScorecard) return;
    setReviewSubmitting(true);
    setReviewError('');
    setReviewResult(null);
    try {
      const fd = new FormData();
      fd.append('scorecard', reviewScorecard);
      if (reviewAppendix) fd.append('appendix', reviewAppendix);
      const res = await fetch(`/enrichment/dd/${reviewCompanyId}/submit-review`, {
        method: 'POST',
        headers: AUTH,
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Submit failed');
      const data = await res.json();
      setReviewResult(data);
      setReviewScorecard(null);
      setReviewAppendix(null);
    } catch (e: any) {
      setReviewError(e.message);
    } finally {
      setReviewSubmitting(false);
    }
  };

  return (
    <div className="p-6">

      {/* Context banner */}
      <div className="bg-[#f0f9ff] border border-[#bae6fd] rounded-xl p-4 mb-6">
        <p className="text-sm text-[#0369a1] font-medium mb-1">Enrichment Pipeline — How It Works</p>
        <p className="text-xs text-[#0c4a6e] leading-relaxed">
          Each tab below explains one enrichment layer. The order matters — Industrial Analysis is locked until
          steps 1–5 are complete, and Score Refresh is locked until Industrial is done. Scores are only as good
          as the underlying data, and Industrial scores are only as good as the prior research layers.
        </p>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {[
            { label: '① Founder Research', color: 'bg-teal-100 text-teal-800 border-teal-300' },
            { label: '② 4D Classification', color: 'bg-[#ede9fe] text-[#5b21b6] border-[#c4b5fd]' },
            { label: '③ Funding', color: 'bg-[#dbeafe] text-[#1e40af] border-[#93c5fd]' },
            { label: '④ Deployments & Case Studies', color: 'bg-[#d1fae5] text-[#065f46] border-[#6ee7b7]' },
            { label: '⑤ Industrial Analysis', color: 'bg-amber-100 text-amber-800 border-amber-300' },
            { label: '⑥ Score Refresh', color: 'bg-[#fef3c7] text-[#92400e] border-[#fcd34d]' },
          ].map(({ label, color }) => (
            <span key={label} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${color}`}>{label}</span>
          ))}
        </div>
      </div>

      {/* Sub-tab nav */}
      <div className="flex flex-wrap gap-1 bg-[#ede8d7] rounded p-1 mb-6">
        {([
          { key: 'founder',    label: 'Founder Research'      },
          { key: '4d',         label: '4D Classification'     },
          { key: 'funding',    label: 'Funding Rounds'            },
          { key: 'news',       label: 'Case Studies & Deployments' },
          { key: 'industrial', label: 'Industrial Analysis'   },
          { key: 'scoring',    label: 'Score Refresh'         },
          { key: 'dd',         label: 'DD Pipeline'           },
          { key: 'intel',      label: 'Intelligence Engine'   },
          { key: 'psm',        label: 'PSM Scoring'           },
          { key: 'traction',   label: 'Traction Signal'       },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setSubTab(key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              subTab === key ? 'bg-white text-[#33322c] shadow-sm' : 'text-[#545249] hover:text-[#33322c]'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Founder Research ── */}
      {subTab === 'founder' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-5 h-5 text-teal-700" />
              <h2 className={cls.sectionTitle}>What is Founder Research?</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed mb-3">
              Founder Research is Phase 0 of the enrichment pipeline — it runs before classification or scoring to establish
              verified ground truth about the people behind the company. Rather than relying on LLM training data
              (which can conflate roles, overstate titles, or hallucinate exits), this step pulls live web sources to
              confirm what each founder actually did, where, and in what capacity.
            </p>
            <p className="text-slate-600 text-sm leading-relaxed mb-3">
              The output is stored in <code className="bg-[#f1f5f9]/30 px-1 rounded text-xs">cvc.company_intel</code> as
              verified facts, and injected as a context block when the DD pipeline runs — so DD agents cross-reference
              founder claims against what research actually found rather than generating from scratch.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              {[
                { label: 'Biographical Facts', desc: 'Actual titles held, not self-reported. Co-founder vs. founding team member vs. hired executive — a distinction that matters for diligence.', color: 'bg-teal-50 border-teal-200 text-teal-800' },
                { label: 'Prior Exits & Funding', desc: 'Verified acquisition events (buyer, year), prior companies founded, and cumulative funding raised at those companies — sourced from press releases and Crunchbase.', color: 'bg-teal-50 border-teal-200 text-teal-800' },
                { label: 'Role Accuracy', desc: 'Flags where founder-stated history diverges from public record — e.g. "co-founded" a company where public sources list them as SVP or CCO.', color: 'bg-amber-50 border-amber-200 text-amber-800' },
                { label: 'DD Ground Truth', desc: 'Verified facts are injected into the DD pipeline as a context block, replacing LLM inference with cited sources. Every claim in the IC memo can be traced to a URL.', color: 'bg-[#f0f4f7] border-[#cbd5e1] text-[#33322c]' },
              ].map(({ label, desc, color }) => (
                <div key={label} className={`rounded-lg border p-4 ${color}`}>
                  <div className="font-semibold text-sm mb-1">{label}</div>
                  <div className="text-xs opacity-80 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-base font-bold text-[#33322c] mb-4">How It Works — Step by Step</h3>
            <div className="space-y-3">
              {[
                { step: '1', label: 'Founder Name Extraction', desc: 'Company website and DB record are scanned for founder names. If not found, a Brave Search for "[Company] founder CEO co-founder" extracts names from LinkedIn previews and press releases.' },
                { step: '2', label: 'Brave Search — Biographical', desc: '"[Founder Name] founder career history" and "[Founder Name] [Company] co-founder" — confirms actual titles, companies, and tenures. Cross-references LinkedIn previews, speaker bios, and company About pages.' },
                { step: '3', label: 'Brave Search — Exit History', desc: '"[Founder Name] acquisition exit sold" — finds verified acquisition events, acquirer names, and approximate years. Distinguishes between founder equity exits and executive role at acquired company.' },
                { step: '4', label: 'Crunchbase / Funding Lookup', desc: '"[Company] Crunchbase funding investors" — extracts co-founder names, investor list, and funding total from Crunchbase listing or news coverage. Feeds into Funding enrichment step.' },
                { step: '5', label: 'Structured Storage', desc: 'Verified facts written to cvc.company_intel with intel_type="text", label="founder_research". Discrepancies between founder-stated and verified history are flagged explicitly.' },
              ].map(({ step, label, desc }) => (
                <div key={step} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-teal-700 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{step}</div>
                  <div>
                    <div className="text-sm font-semibold text-[#33322c]">{label}</div>
                    <div className="text-xs text-[#545249] mt-0.5 leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs text-amber-800 font-medium mb-1">Why This Matters — The Carrier1 Example</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              Carrier1's IC memo stated Jake Papa "co-founded 10-4 Systems" and "co-founded Emerge." Web research found
              both claims were overstated — 10-4 was founded by Andrew Leto (Papa was an employee), and Papa's role at
              Emerge was founding-team CCO, not a named co-founder. The DD pipeline had no way to catch this because it
              only had a website scrape with source: N/A on every finding. Founder Research makes these discrepancies
              visible before capital is committed.
            </p>
          </div>
        </div>
      )}

      {/* ── Funding Rounds ── */}
      {subTab === 'funding' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 flex items-center justify-center text-[#1e40af] font-bold text-base">$</span>
              <h2 className={cls.sectionTitle}>What is Funding Enrichment?</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed mb-3">
              This enrichment layer uses Brave Search to find publicly available information about a company's
              funding history — press releases, TechCrunch articles, Crunchbase listings, SEC filings, and
              investor announcements. Results are surfaced as <strong>suggestions</strong> in the Human Review
              queue, not written directly to the profile, so an analyst verifies each one before it lands.
            </p>
            <div className="mt-4">
              <div className="rounded-lg border p-4 bg-[#dbeafe] border-[#93c5fd] text-[#1e40af]">
                <div className="font-semibold text-sm mb-1">Funding Rounds</div>
                <div className="text-xs opacity-80 leading-relaxed">Pre-Seed through Series D+, SBIR/STTR grants, prize challenges, government contracts — round type, amount, date, investors</div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-1`}>Enrichment Process</h2>
            <p className="text-xs text-[#787569] mb-4 font-mono">workers/enrichment/enrich_funding_rounds.py — on demand or sector batch</p>
            <div className="space-y-4">
              {[
                { step: '1', label: 'Brave Search ×2', desc: 'Two queries per company: "[Company] funding rounds raised series investment" and "[Company] funding announcement investor". Returns up to 10 results per search, filtered for relevance.' },
                { step: '2', label: 'LLM Extraction', desc: 'qwen3-235b reads the search snippets and extracts structured funding data: round type, amount (USD), announced date, lead investors, and valuation if available. Only extracts what is explicitly stated — no inference.' },
                { step: '3', label: 'Confidence Scoring', desc: 'Each extracted round gets a confidence score (0–1). Rounds below 0.5 are skipped. Rounds 0.5–0.7 are marked approximate. Rounds 0.7+ go directly to the Human Review queue.' },
                { step: '4', label: 'Duplicate Check', desc: 'Before creating a suggestion, the worker checks existing funding_rounds for the same company and round type. If a confirmed round already exists for that type, the source URL is appended to that round\'s notes rather than creating a duplicate — so multiple sources for the same round are preserved.' },
                { step: '5', label: 'Human Review Queue', desc: 'Accepted suggestions write directly to cvc.funding_rounds. Rejected ones are dismissed. The analyst sees company name, round type, amount, date, investors, confidence %, and a source link.' },
              ].map(({ step, label, desc }) => (
                <div key={step} className="flex gap-4">
                  <div className="w-7 h-7 rounded-full bg-[#1e40af] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step}</div>
                  <div>
                    <div className="text-sm font-semibold text-[#33322c] mb-0.5">{label}</div>
                    <div className="text-xs text-[#545249] leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 bg-[#33322c] text-slate-300 rounded-lg p-4 space-y-1.5 text-xs font-mono">
              <div className="text-[#545249]"># Single company by ID</div>
              <div>PYTHONPATH=core python3 workers/enrichment/enrich_funding_rounds.py --company-id=1728 --batch</div>
              <div className="text-[#545249] mt-2"># All companies in a sector</div>
              <div>PYTHONPATH=core python3 workers/enrichment/enrich_funding_rounds.py --sector="Robotics"</div>
              <div className="text-[#545249] mt-2"># Batch mode (approximate-priority)</div>
              <div>PYTHONPATH=core python3 workers/enrichment/enrich_funding_rounds.py --batch</div>
            </div>
            <p className="text-[11px] text-[#787569] mt-2">Requires: <span className="font-mono">BRAVE_SEARCH_KEY</span>, <span className="font-mono">OPENROUTER_API_KEY</span>, <span className="font-mono">PYTHONPATH=core</span></p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-3`}>What Gets Written</h2>
            <div className="space-y-2 mb-5">
              {[
                { col: 'cvc.intel_suggestions', type: 'suggestions', desc: 'Every extracted round lands here first with status=pending. Approved → funding_rounds. Rejected → dismissed.' },
                { col: 'cvc.funding_rounds', type: 'on approval', desc: 'round_type, amount_usd, announced_date, investors (text[]), source URL, approximate flag, valuation_usd' },
              ].map(({ col, type, desc }) => (
                <div key={col} className="flex items-start gap-3 py-2 border-b border-slate-200 last:border-0">
                  <code className="text-xs font-mono text-[#1e40af] bg-[#ede8d7] px-1.5 py-0.5 rounded border border-slate-200 flex-shrink-0 mt-0.5">{col}</code>
                  <span className="text-[10px] text-[#787569] font-mono flex-shrink-0 mt-1">{type}</span>
                  <span className="text-xs text-[#545249]">{desc}</span>
                </div>
              ))}
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-amber-800 mb-1">Deployments — Manual Entry</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                Customer contracts, paid pilots, PoCs, LOIs, and enterprise partnerships are tracked in the
                <strong> Deployments &amp; Case Studies</strong> section on each company profile. These are not auto-scraped —
                an analyst adds them when they hear about a deal (public or from a conversation). Stealth mode
                blurs the customer name for NDA-sensitive entries while still tracking the amount and type.
                Brave Research case studies from the next step also surface here automatically.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Case Studies & Deployments ── */}
      {subTab === 'news' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <Rss className="w-5 h-5 text-[#065f46]" />
              <h2 className={cls.sectionTitle}>What is Case Studies &amp; Deployments Enrichment?</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed mb-3">
              This is the commercial evidence layer. It uses Brave Search to find documented customer deployments,
              pilot programs, case studies, and enterprise partnerships — queued for Human Review before being
              written to the profile. It also searches for revenue and ARR mentions and extracts any explicit
              dollar figures directly onto the profile.
            </p>
            <p className="text-slate-600 text-sm leading-relaxed">
              A case study is evidence of deployment. A PoC or pilot counts. An enterprise partnership announcement
              counts. The question this step answers is: <em className="not-italic font-medium text-slate-700">has anyone
              actually bought and used this product, and is there any revenue to speak of?</em> That signal is
              what Industrial Analysis needs before it can produce an accurate readiness score.
            </p>
            <div className="mt-4 bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg p-3">
              <p className="text-xs font-semibold text-[#065f46] mb-1">Also extracts Revenue / ARR</p>
              <p className="text-xs text-[#065f46]/80 leading-relaxed">
                A dedicated Brave search for <code className="font-mono text-[10px] bg-white px-1 rounded">revenue ARR "annual recurring" "run rate"</code> runs
                alongside the case study search. If an explicit dollar figure is found, a targeted LLM call extracts
                the amount, time period, and source URL — written directly to <code className="font-mono text-[10px] bg-white px-1 rounded">revenue_arr_usd</code>,{' '}
                <code className="font-mono text-[10px] bg-white px-1 rounded">revenue_period</code>, and{' '}
                <code className="font-mono text-[10px] bg-white px-1 rounded">revenue_source</code> on the company profile.
                Vague traction claims ("strong revenue") are not extracted — only explicit figures.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-1`}>Enrichment Process</h2>
            <p className="text-xs text-[#787569] mb-4 font-mono">workers/enrichment/enrich_cases.py — nightly or on demand per company</p>
            <div className="space-y-4">
              {[
                { step: '1', label: 'Brave Search — Case Studies', desc: '"[Company] case study customer deployment success pilot enterprise" — finds documented deployments, customer testimonials, pilot programs, and partnership announcements. Results are queued as pending intel_suggestions for Human Review.' },
                { step: '2', label: 'Brave Search — Revenue / ARR', desc: '"[Company] revenue ARR annual recurring run rate customers growth traction" — finds press articles, interviews, and announcements that mention revenue figures. Only explicit dollar amounts qualify.' },
                { step: '3', label: 'Human Review Queue', desc: 'Each case study result is inserted into intel_suggestions as type "case_study" with status "pending". You review and accept/reject from the Human Review tab. Accepting appends the entry to case_studies[] on the profile.' },
                { step: '4', label: 'LLM Revenue Extraction', desc: 'qwen3-235b processes the revenue search results. Extracts revenue_arr_usd (integer), revenue_period (e.g. "H1 2025"), and revenue_source (URL). Only runs if the revenue search returns results. Never estimates — requires an explicit figure in the text.' },
                { step: '5', label: 'DB Write', desc: 'Revenue fields written directly to cvc.companies. Case studies are not written here — they go through Human Review first. Duplicate URLs are skipped automatically.' },
              ].map(({ step, label, desc }) => (
                <div key={step} className="flex gap-4">
                  <div className="w-7 h-7 rounded-full bg-[#065f46] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step}</div>
                  <div>
                    <div className="text-sm font-semibold text-[#33322c] mb-0.5">{label}</div>
                    <div className="text-xs text-[#545249] leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 bg-[#33322c] text-slate-300 rounded-lg p-4 space-y-1.5 text-xs font-mono">
              <div className="text-[#545249]"># Single company by ID (runs immediately)</div>
              <div>PYTHONPATH=core python3 workers/enrichment/enrich_cases.py --id 1728 --no-gate</div>
              <div className="text-[#545249] mt-2"># Batch of 50</div>
              <div>PYTHONPATH=core python3 workers/enrichment/enrich_cases.py --limit 50</div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-3`}>What Gets Written</h2>
            <div className="space-y-2 mb-4">
              {[
                { col: 'case_studies',    type: 'JSONB []', desc: 'Array of { title, url, snippet, age } — written when you accept a case_study suggestion in Human Review. Not auto-written.' },
                { col: 'revenue_arr_usd', type: 'BIGINT',   desc: 'ARR or annualized run rate in USD as an integer. Written directly — no Human Review. Only populated when an explicit dollar figure is found.' },
                { col: 'revenue_period',  type: 'TEXT',     desc: 'Time context for the revenue figure (e.g. "H1 2025", "as of Jan 2026"). Written alongside revenue_arr_usd.' },
                { col: 'revenue_source',  type: 'TEXT',     desc: 'URL of the article or press release where the revenue figure was cited. Shown as a clickable link on the profile.' },
              ].map(({ col, type, desc }) => (
                <div key={col} className="flex items-start gap-3 py-2 border-b border-slate-200 last:border-0">
                  <code className="text-xs font-mono text-[#065f46] bg-[#ede8d7] px-1.5 py-0.5 rounded border border-slate-200 flex-shrink-0 mt-0.5 max-w-[180px]">{col}</code>
                  <span className="text-[10px] text-[#787569] font-mono flex-shrink-0 mt-1">{type}</span>
                  <span className="text-xs text-[#545249]">{desc}</span>
                </div>
              ))}
            </div>
            <div className="bg-[#f0fdf4] border border-[#6ee7b7] rounded-lg p-4">
              <p className="text-xs font-semibold text-[#065f46] mb-1">Sequence note</p>
              <p className="text-xs text-[#065f46]/80 leading-relaxed">
                Step 4 in the pipeline — run after 4D Classification and Funding are complete.
                Industrial Analysis uses deployment and revenue evidence to score commercial readiness,
                so this step should be complete before Industrial runs.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-3`}>Reading the Output on a Profile</h2>
            <div className="space-y-3">
              {[
                { label: 'Revenue / ARR card', desc: 'If revenue_arr_usd is populated, a green ARR card appears at the top of the Deployments & Case Studies section showing the formatted figure, period, and a link to the source article.' },
                { label: 'Deployments & Case Studies — From Brave Research', desc: 'Brave-sourced case studies appear after you accept them in Human Review. Each card shows the title, snippet, and a collapsible sources list.' },
                { label: 'Human Review tab', desc: 'All case_study suggestions land here as pending. Accept to write to the profile, reject to discard. Source URLs are visible on every card.' },
                { label: 'Re-run via profile', desc: 'Click Run on Step 4 — Case Studies & Deployments from the enrichment panel on any company profile to immediately re-run enrich_cases.py for that company.' },
              ].map(({ label, desc }) => (
                <div key={label} className="flex gap-3 p-3 bg-[#ede8d7] rounded-lg border border-slate-200">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#10b981] flex-shrink-0 mt-1.5" />
                  <div>
                    <p className="text-xs font-semibold text-[#33322c] mb-0.5">{label}</p>
                    <p className="text-xs text-[#545249] leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Industrial Analysis ── */}
      {subTab === 'industrial' && (
        <div className="space-y-6">

          {/* Prerequisite gate banner */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <Lock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800 mb-1">Step 5 — Locked Until Prerequisites Complete</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                Industrial Analysis uses founder profiles, 4D classification, funding history, commercial deployment data, and news context
                as inputs to its scoring model. Running it before those layers are populated produces inaccurate scores.
                On each company profile, this step is gated behind steps 1–5.
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {['① Founder', '② 4D', '③ Funding', '④ Deployments', '⑤ News'].map(s => (
                  <span key={s} className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-100 text-amber-800 border-amber-300">{s}</span>
                ))}
                <span className="text-[10px] font-semibold px-2 py-0.5 text-amber-500">→ then Industrial</span>
              </div>
            </div>
          </div>

          {/* What it is */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <Factory className="w-5 h-5 text-[#33322c]" />
              <h2 className={cls.sectionTitle}>What is Industrial Analysis?</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed mb-3">
              Industrial Analysis extracts proprietary operational intelligence for companies in Robotics, Manufacturing,
              Supply Chain, Industrial Automation, and Physical AI. It answers the questions a systems integrator or
              plant manager would ask — not just "is this a good company" but "can we actually deploy this?"
            </p>
            <p className="text-slate-600 text-sm leading-relaxed">
              It runs after Founder, 4D, Funding, Commercial, and News enrichment are complete for a company. Only
              companies with a known website and a
              missing <span className="font-mono text-xs bg-[#f1f5f9]/30 px-1 rounded">industrial_readiness_score</span> are picked up.
              Results are prioritized by total funding raised (largest companies first).
            </p>
          </div>

          {/* Enrichment process */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-1`}>Enrichment Process</h2>
            <p className="text-xs text-[#787569] mb-4 font-mono">workers/enrichment/enrich_industrial.py — on demand, default batch of 20</p>
            <div className="space-y-4">
              {[
                {
                  step: '1', label: 'Docs & Careers Crawl',
                  desc: 'Attempts to scrape technical documentation pages (/docs, /developers, /technical, /support) and careers pages (/careers, /jobs). Falls back to the homepage if subpages return nothing useful.',
                },
                {
                  step: '2', label: 'Brave Search Fallback',
                  desc: 'If either scrape returns fewer than 200 chars, Brave fills the gap with two targeted searches: integration protocols/OPC-UA/ROS2 context, and hiring signals (field service, commissioning, deployment engineer roles).',
                },
                {
                  step: '3', label: 'Deep Scan — PDFs (optional)',
                  desc: 'With --deep-scan-pdfs: finds PDF links on scraped pages, downloads datasheets and cert docs via pdfminer, and runs three additional Brave searches for ISO/UL certs and NDAA compliance. Up to 8,000 chars of PDF content is added to the LLM context.',
                },
                {
                  step: '4', label: 'LLM Extraction',
                  desc: 'qwen3-235b processes all collected context (docs up to 4,000 chars + careers up to 3,000 chars + optional PDF content) and produces a structured JSON with all scored fields. Temperature 0.1 — conservative, no fabrication.',
                },
                {
                  step: '5', label: 'High Alpha Signal',
                  desc: 'If the model flags an anomaly worth acting on (5+ recent field hires, surprise cert, new geography), a Telegram alert is sent to @BigBossHogBot immediately.',
                },
                {
                  step: '6', label: 'DB Write',
                  desc: 'Writes industrial_readiness_score, sovereignty_score, protocol_support, deployment_signal_level, verified_certs, integration_notes, and intel_sources (citations). 3s pause between companies.',
                },
              ].map(({ step, label, desc }) => (
                <div key={step} className="flex gap-4">
                  <div className="w-7 h-7 rounded-full bg-[#33322c] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step}</div>
                  <div>
                    <div className="text-sm font-semibold text-[#33322c] mb-0.5">{label}</div>
                    <div className="text-xs text-[#545249] leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 bg-[#33322c] text-slate-300 rounded-lg p-4 space-y-1.5 text-xs font-mono">
              <div className="text-[#545249]"># Standard run — 20 companies</div>
              <div>python3 workers/enrichment/enrich_industrial.py</div>
              <div className="text-[#545249] mt-2"># Single company</div>
              <div>python3 workers/enrichment/enrich_industrial.py --company "Vecna Robotics"</div>
              <div className="text-[#545249] mt-2"># Deep scan with PDF cert extraction</div>
              <div>python3 workers/enrichment/enrich_industrial.py --limit 10 --deep-scan-pdfs</div>
            </div>
          </div>

          {/* Outputs */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-3`}>What Gets Written</h2>
            <div className="space-y-2">
              {[
                { col: 'industrial_readiness_score', type: 'INT 1–10',  desc: 'Pilot-to-production progress — 8+ means enterprise-grade, multi-site deployments' },
                { col: 'sovereignty_score',          type: 'INT 1–10',  desc: 'Geopolitical resilience — domicile, ownership, TAA/NDAA, supply chain exposure' },
                { col: 'protocol_support',           type: 'JSONB []',  desc: 'List of verified integration protocols (OPC-UA, MQTT, ROS2, etc.)' },
                { col: 'deployment_signal_level',    type: 'TEXT',      desc: 'Lab-Stage / Pilot / Scaling / Operational — inferred from job postings and docs' },
                { col: 'verified_certs',             type: 'JSONB []',  desc: 'Only certs explicitly named in documents — no inference' },
                { col: 'integration_notes',          type: 'TEXT',      desc: '2–3 sentence partner advisory: key findings, pilot gaps, integration advice' },
                { col: 'intel_sources',              type: 'JSONB []',  desc: 'Source citations — URL + excerpt that supports each scored field' },
              ].map(({ col, type, desc }) => (
                <div key={col} className="flex items-start gap-3 py-2 border-b border-slate-200 last:border-0">
                  <code className="text-xs font-mono text-[#33322c] bg-[#ede8d7] px-1.5 py-0.5 rounded border border-slate-200 flex-shrink-0 mt-0.5">{col}</code>
                  <span className="text-[10px] text-[#787569] font-mono flex-shrink-0 mt-1">{type}</span>
                  <span className="text-xs text-[#545249]">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-1`}>Composite Score Formula</h2>
            <p className="text-[#545249] text-sm mb-4">Combines readiness, sovereignty, and friction into a single 0–10 signal. Weights are configurable per sector and saved in your browser.</p>
            <div className="bg-[#ede8d7] border border-slate-200 rounded-lg p-4 mb-5 font-mono text-sm text-slate-700">
              composite = (Readiness × W₁) + (Sovereignty × W₂) + ((10 − Friction) × W₃)
              <br /><span className="text-[#787569] text-xs">where W₁ + W₂ + W₃ = 1.0</span>
            </div>
            <div className="flex items-center gap-3 mb-5">
              <label className="text-sm font-semibold text-slate-700">Weights for sector:</label>
              <select value={indSector} onChange={e => handleSectorChange(e.target.value)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:outline-none">
                <option value="">All Sectors (default)</option>
                {IND_SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              {([
                { key: 'readiness',   label: 'Readiness (W₁)',   desc: 'Pilot-to-Production progress'         },
                { key: 'sovereignty', label: 'Sovereignty (W₂)', desc: 'Geopolitical resilience'              },
                { key: 'friction',    label: 'Friction (W₃)',    desc: 'Integration difficulty (inverted)'    },
              ] as { key: keyof typeof weights; label: string; desc: string }[]).map(({ key, label, desc }) => (
                <div key={key} className="bg-[#ede8d7] border border-slate-200 rounded-lg p-4">
                  <div className="text-xs font-semibold text-slate-600 mb-0.5">{label}</div>
                  <div className="text-[10px] text-[#787569] mb-3">{desc}</div>
                  <div className="flex items-center gap-2">
                    <input type="number" step="0.05" min="0" max="1" value={weights[key]}
                      onChange={e => updateWeight(key, parseFloat(e.target.value) || 0)}
                      className="w-20 border border-slate-200 rounded px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#33322c]" />
                    <span className="text-sm text-[#545249]">{(weights[key] * 100).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className={`text-sm mb-4 ${isValid ? 'text-emerald-600' : 'text-red-500'}`}>
              Total: {(totalWeight * 100).toFixed(0)}% {isValid ? '✓' : '— must equal 100%'}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => { if (!isValid) return; saveIndWeights(indSector, weights); setSaved(true); setTimeout(() => setSaved(false), 2000); }}
                disabled={!isValid}
                className="px-4 py-2 bg-[#33322c] text-white text-sm font-semibold rounded-lg disabled:opacity-40 hover:bg-[#151411] transition-colors">
                {saved ? '✓ Saved' : 'Save Weights'}
              </button>
              <button onClick={() => { setWeights({ ...IND_DEFAULT_WEIGHTS }); setSaved(false); }}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-[#ede8d7] transition-colors">
                Reset to defaults
              </button>
              <span className="text-xs text-[#787569]">Saved per sector in your browser.</span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-4`}>Score Definitions</h2>
            <div className="space-y-4">
              {[
                { name: 'Readiness Score (0–10)', color: 'text-blue-600', desc: "Measures progress from pilot to production. High scores = enterprise-grade reliability, multi-site deployments, reference customers.", high: '8–10: Active production, Fortune 500 customers, proven ROI', mid: '5–7: Pilot customers, maturing product', low: '0–4: Pre-commercial, R&D stage' },
                { name: 'Friction Score (0–10, lower = better)', color: 'text-orange-600', desc: "How hard is it to integrate this product into industrial systems? Starts at 10.0, reduced by each standard protocol supported.", high: '8–10: Proprietary stack, no standard protocols', mid: '4–7: Some standards, moderate integration effort', low: '0–3: OPC-UA, MQTT, open APIs — drops straight in' },
                { name: 'Sovereignty Score (0–10)', color: 'text-emerald-600', desc: "Geopolitical resilience. Considers domicile, ownership structure, data storage, export controls, and supply chain exposure.", high: '8–10: US/allied domicile, no foreign ownership risk', mid: '4–7: Allied country, some cloud exposure', low: '0–3: Adversarial jurisdiction, opaque ownership' },
                { name: 'Composite Score (0–10)', color: 'text-purple-600', desc: "Weighted average of the three scores. Configurable weights above. Classifies as Integration King, Watchlist, or Pilot Purgatory.", high: '≥ 7.5: Integration King — deploy-ready', mid: '5.0–7.4: Watchlist', low: '< 5.0: Pilot Purgatory' },
              ].map(({ name, color, desc, high, mid, low }) => (
                <div key={name} className="border border-slate-200 rounded-lg p-4">
                  <div className={`font-semibold text-sm mb-2 ${color}`}>{name}</div>
                  <p className="text-sm text-slate-600 mb-3">{desc}</p>
                  <div className="space-y-1 text-xs text-[#545249]">
                    <div><span className="text-emerald-600 font-medium">●</span> {high}</div>
                    <div><span className="text-amber-500 font-medium">●</span> {mid}</div>
                    <div><span className="text-red-500 font-medium">●</span> {low}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-2`}>Protocol Friction Weights</h2>
            <p className="text-[#545249] text-sm mb-4">Friction starts at 10.0. Each supported protocol subtracts from this score. Companies without protocol data show as "Unverified."</p>
            <div className="overflow-hidden rounded border border-slate-200">
              <table className="w-full text-sm">
                <thead><tr className="bg-[#ede8d7] border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 text-slate-600 font-semibold">Protocol</th>
                  <th className="text-left px-4 py-2.5 text-slate-600 font-semibold">Friction Reduction</th>
                  <th className="text-left px-4 py-2.5 text-slate-600 font-semibold">Rationale</th>
                </tr></thead>
                <tbody className="divide-y divide-[#f1f5f9]">
                  {[
                    { proto: 'OPC-UA',               w: -3.0, why: 'Industrial standard, native PLC/SCADA interop'    },
                    { proto: 'MQTT',                  w: -3.0, why: 'IoT backbone, cloud-ready, widely supported'       },
                    { proto: 'Siemens S7',            w: -2.0, why: 'Dominant in European manufacturing'               },
                    { proto: 'Rockwell ControlLogix', w: -2.0, why: 'Dominant in US manufacturing'                     },
                    { proto: 'ROS2',                  w: -1.5, why: 'Robotics standard, strong ecosystem'              },
                    { proto: 'VDA 5050',              w: -1.5, why: 'AGV/AMR interoperability standard'                },
                    { proto: 'Public API / SDK',      w: -1.5, why: 'Open integration surface'                         },
                    { proto: 'Modbus / Modbus TCP',   w: -1.0, why: 'Legacy but ubiquitous'                            },
                    { proto: 'Profinet / EtherNet/IP',w: -1.0, why: 'Common fieldbus, some tooling required'           },
                    { proto: 'EtherCAT / CANopen',    w: -1.0, why: 'Specialized, limited middleware'                  },
                  ].map(({ proto, w, why }) => (
                    <tr key={proto} className="hover:bg-[#ede8d7]">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{proto}</td>
                      <td className="px-4 py-2.5"><span className="text-emerald-600 font-semibold">{w.toFixed(1)}</span></td>
                      <td className="px-4 py-2.5 text-[#545249] text-xs">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Score Refresh ── */}
      {subTab === 'scoring' && (
        <div className="space-y-6">

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-5 h-5 text-amber-600" />
              <h2 className={cls.sectionTitle}>What is Score Refresh?</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed mb-3">
              Score Refresh is Step 6 of the enrichment pipeline — the final layer that produces a quantitative investment signal
              for every company. It uses an LLM (qwen3-235b) to assess each startup across five dimensions and produce a
              composite score from 0–10. Scores are displayed on the company profile and used to rank startups in sourcing views.
            </p>
            <p className="text-slate-600 text-sm leading-relaxed mb-3">
              The worker only scores companies that have <code className="bg-[#f1f5f9]/30 px-1 rounded text-xs">enrichment_status = 'enriched'</code> — raw
              or pending companies are skipped. Scores older than 90 days are automatically re-queued on the nightly run.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-4">
              <p className="text-xs font-semibold text-amber-800 mb-1">Current Limitation</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                Score Refresh uses only basic profile fields (name, one-liner, description, sector, stage, headcount, total raised, founded year,
                country). It does <strong>not</strong> use enriched data from steps 1–5 — founders, 4D classification, case studies, industrial
                scores, or funding history are not fed to the scoring LLM. This is a known gap and is on the roadmap.
              </p>
            </div>
          </div>

          {/* Scoring dimensions */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-1`}>Scoring Dimensions</h2>
            <p className="text-[#545249] text-sm mb-5">Five independent dimensions, each scored 0–10 by the LLM, then combined into a weighted composite.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { name: 'Commercial Velocity', weight: '30%', color: 'bg-emerald-50 border-emerald-200 text-emerald-800', desc: 'Revenue traction, customer adoption, ARR trajectory, and the plausibility of near-term monetization.' },
                { name: 'Technical Maturity',  weight: '25%', color: 'bg-blue-50 border-blue-200 text-blue-800',          desc: 'Depth of technical differentiation, IP defensibility, product stage (R&D vs. production-ready), and engineering credibility.' },
                { name: 'Market Timing',       weight: '20%', color: 'bg-purple-50 border-purple-200 text-purple-800',    desc: 'How well does the company\'s thesis match current market conditions? Favors companies in sectors with near-term tailwinds.' },
                { name: 'Partner Fit',         weight: '15%', color: 'bg-teal-50 border-teal-200 text-teal-800',          desc: 'Alignment with SLAM\'s LP base (industrial operators, supply chain). Favors companies with enterprise deployment potential.' },
                { name: 'Capital Efficiency',  weight: '10%', color: 'bg-orange-50 border-orange-200 text-orange-800',    desc: 'Relative capital raised vs. stage progression. Penalizes heavy pre-revenue raises; rewards lean teams with real traction.' },
              ].map(({ name, weight, color, desc }) => (
                <div key={name} className={`rounded-lg border p-4 ${color}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-sm">{name}</div>
                    <span className="text-xs font-bold opacity-70 bg-white bg-opacity-50 px-2 py-0.5 rounded-full">{weight}</span>
                  </div>
                  <p className="text-xs opacity-80 leading-relaxed">{desc}</p>
                </div>
              ))}
              <div className="rounded-lg border border-slate-200 bg-[#ede8d7] p-4 flex flex-col justify-center items-center">
                <div className="text-xs text-[#545249] mb-1 font-medium">Composite Formula</div>
                <div className="font-mono text-xs text-slate-700 text-center leading-relaxed">
                  (Commercial × 0.30)<br/>
                  + (Technical × 0.25)<br/>
                  + (Timing × 0.20)<br/>
                  + (Partner × 0.15)<br/>
                  + (Capital × 0.10)
                </div>
              </div>
            </div>
          </div>

          {/* What data it uses */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-3`}>Input Data</h2>
            <p className="text-[#545249] text-sm mb-4">The following fields from <code className="bg-[#f1f5f9]/30 px-1 rounded text-xs">cvc.companies</code> are included in the scoring prompt:</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {['name', 'one_liner', 'description', 'sector', 'stage', 'employee_count', 'total_raised_usd', 'founded', 'country'].map(f => (
                <div key={f} className="flex items-center gap-2 bg-[#ede8d7] border border-slate-200 rounded-lg px-3 py-2">
                  <code className="text-xs font-mono text-[#33322c]">{f}</code>
                </div>
              ))}
            </div>
          </div>

          {/* What gets written */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-3`}>What Gets Written</h2>
            <div className="space-y-2">
              {[
                { col: 'score_commercial',    type: 'FLOAT 0–10', desc: 'Commercial Velocity score from LLM assessment' },
                { col: 'score_technical',     type: 'FLOAT 0–10', desc: 'Technical Maturity score' },
                { col: 'score_market_timing', type: 'FLOAT 0–10', desc: 'Market Timing score' },
                { col: 'score_partner_fit',   type: 'FLOAT 0–10', desc: 'Partner Fit score (SLAM LP alignment)' },
                { col: 'score_capital_eff',   type: 'FLOAT 0–10', desc: 'Capital Efficiency score' },
                { col: 'score_composite',     type: 'FLOAT 0–10', desc: 'Weighted composite — the headline number shown on company profiles' },
                { col: 'scored_at',           type: 'TIMESTAMP',  desc: 'When the score was last computed — scores older than 90 days are re-queued automatically' },
              ].map(({ col, type, desc }) => (
                <div key={col} className="flex items-start gap-3 py-2 border-b border-slate-200 last:border-0">
                  <code className="text-xs font-mono text-[#33322c] bg-[#ede8d7] px-1.5 py-0.5 rounded border border-slate-200 flex-shrink-0 mt-0.5">{col}</code>
                  <span className="text-[10px] text-[#787569] font-mono flex-shrink-0 mt-1">{type}</span>
                  <span className="text-xs text-[#545249]">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* When it runs */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-4`}>When It Runs</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-[#ede8d7] rounded-lg p-4">
                <div className="text-xs font-semibold text-slate-600 mb-1">Nightly (automatic)</div>
                <p className="text-xs text-[#545249] leading-relaxed">Runs daily at 3:00 AM UTC via cron on the Dell server. Processes all enriched companies with a null or stale score (&gt;90 days). Worker: <code className="text-[10px]">workers/scoring/score_refresh.py</code></p>
              </div>
              <div className="bg-[#ede8d7] rounded-lg p-4">
                <div className="text-xs font-semibold text-slate-600 mb-1">On-demand (queued)</div>
                <p className="text-xs text-[#545249] leading-relaxed">Trigger from any company profile via "Step 6 — Score Refresh" in the enrichment panel. The profile shows "queued for nightly run" — the score updates on the next 3 AM cycle.</p>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── DD Pipeline ── */}
      {subTab === 'dd' && (
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-start gap-3">
            <span className="text-amber-500 mt-0.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" /></svg>
            </span>
            <p className="text-sm text-amber-800 leading-relaxed">
              <span className="font-semibold">Run enrichment first when possible.</span> The DD pipeline produces stronger results when Founder Research, 4D Classification, and Funding data have already been collected — the agents use that context instead of starting from scratch. For stealth companies where enrichment isn't possible, DD will proceed on dataroom files alone.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-5 h-5 text-[#a16207]" />
              <h2 className={cls.sectionTitle}>What is the DD Pipeline?</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed mb-4">
              The DD pipeline is a fully on-demand due diligence process. Upload a company's dataroom files directly
              from this page — five specialist agents read and analyze the documents, an overview agent synthesizes
              a full IC memo, and the results are available for download within 1–3 hours depending on dataroom size.
              No approval queue, no nightly cron — it fires the moment you click Start.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Appendix',      desc: 'Full agent findings with source document citations',                  color: 'bg-amber-50 border-amber-200 text-amber-800'   },
                { label: 'Scorecard',     desc: 'Quantitative scoring across 8+ dimensions — Excel with feedback columns', color: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
                { label: 'Review Memo',   desc: 'Corrected IC memo after analyst annotates the scorecard',             color: 'bg-violet-50 border-violet-200 text-violet-800' },
                { label: 'Review Memo DOCX', desc: 'Same memo as an editable Word document for manual polish',        color: 'bg-blue-50 border-blue-200 text-blue-800'      },
              ].map(({ label, desc, color }) => (
                <div key={label} className={`rounded-lg border p-3 ${color}`}>
                  <div className="font-semibold text-xs mb-1">{label}</div>
                  <div className="text-[11px] opacity-80 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-4`}>Pipeline Stages</h2>
            <div className="space-y-3">
              {[
                { stage: '1 — Upload',          desc: 'Analyst uploads dataroom files directly from this page. Each file is manually routed to the relevant agent (Fin, Market, Team, Product). Files marked General — like pitch decks — are sent to all four specialist agents. Auto Ingest mode lets the system handle routing automatically when there are too many files to review individually (less precise).' },
                { stage: '2 — Ingest',          desc: 'Files are parsed (PDF, Excel, DOCX) and converted to text. A manifest is built recording which documents each agent will receive.' },
                { stage: '3 — Routing',         desc: 'Manual routing is applied to the manifest before agents run. Auto Ingest routing is handled by the ingestion tagger using filename and content signals.' },
                { stage: '4 — Financials',      desc: 'Reads P&L, cap table, projections, SAFE/convertible notes, and customer contracts. Extracts ARR, burn rate, unit economics, runway.' },
                { stage: '5 — Market',          desc: 'Maps competitive landscape — public comps, private comps, patent IP, market sizing, and differentiation signals.' },
                { stage: '6 — Team',            desc: 'Assesses founding team, board, advisors, key hires, equity agreements, and culture signals.' },
                { stage: '7 — Product',         desc: 'Evaluates tech depth, IP documentation, demo materials, roadmap, and technical moat.' },
                { stage: '8 — News',            desc: 'Pulls press, LinkedIn signals, patent filings, and public traction data via web search. Not document-driven.' },
                { stage: '9 — IC Memo',         desc: 'Overview agent reads all five agent outputs. Two LLM passes: cross-agent signal detection, then full IC memo synthesis with recommendation and IC questions.' },
                { stage: '10 — Format',         desc: 'IC Memo PDF, Appendix PDF (full findings with source citations), and Scorecard XLSX (quantitative scoring with analyst feedback columns) are rendered and saved. All three appear as downloads in the Enriched tab.' },
                { stage: '11 — Analyst Review', desc: 'Analyst downloads the Scorecard, reviews each finding, and fills in the Accuracy, Flag Rating, and Notes columns. The annotated Scorecard is uploaded in Step 2 below.' },
                { stage: '12 — Review Memo',    desc: 'Reviewer agent reads the original IC Memo, Appendix, and all analyst corrections. Produces a revised IC Memo as both PDF (with analyst-reviewed banner) and DOCX (editable Word). Both appear in the Enriched tab. Feedback is stored and used to improve future DD runs.' },
              ].map(({ stage, desc }) => (
                <div key={stage} className="flex gap-4 p-3 bg-[#ede8d7] rounded-lg">
                  <div className="text-xs font-bold text-[#33322c] w-28 shrink-0 pt-0.5">{stage}</div>
                  <div className="text-sm text-slate-600">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-4`}>Recommendation Levels</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Invest',      desc: 'High conviction. Move to Term Sheet.',      color: 'bg-emerald-50 border-emerald-300 text-emerald-800' },
                { label: 'Conditional', desc: 'Strong interest, one or two open items.',   color: 'bg-blue-50 border-blue-300 text-blue-800'          },
                { label: 'Watch',       desc: 'Interesting but too early or too risky.',   color: 'bg-yellow-50 border-yellow-300 text-yellow-800'    },
                { label: 'Pass',        desc: 'Insufficient signal or misaligned.',        color: 'bg-red-50 border-red-300 text-red-800'             },
              ].map(({ label, desc, color }) => (
                <div key={label} className={`rounded-lg border p-4 ${color}`}>
                  <div className="font-bold text-sm mb-1">{label}</div>
                  <div className="text-xs opacity-80">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-3`}>How to Run a DD</h2>
            <ol className="space-y-3 text-sm text-slate-600">
              {[
                'Click "Add to Queue" on this page and select DD Pipeline. Enter the company name and website.',
                'Upload the dataroom files. Route each file to the appropriate agent — or enable Auto Ingest to let the system route automatically.',
                'Click "Upload Dataroom" and wait for confirmation. Then click "Start DD Pipeline" — the pipeline fires immediately.',
                'The pipeline runs in the background (1–3 hours). When complete, Appendix and Scorecard appear in the Enriched tab.',
                'Download the Scorecard, review each finding row, and fill in the Accuracy, Flag Rating, and Notes columns.',
                'Return to Step 2 — Analyst Review below. Upload the annotated Scorecard. A corrected Review Memo (PDF + DOCX) will be generated and saved to the Enriched tab.',
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#33322c] text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {/* ── Step 2: Analyst Review ── */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <svg className="w-5 h-5 text-[#5b21b6]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <h2 className={cls.sectionTitle}>Step 2 — Analyst Review</h2>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-5">
              After the pipeline runs, download the Scorecard from the Enriched tab, review each finding row,
              and fill in the <strong>Accuracy</strong>, <strong>Flag Rating</strong>, and <strong>Notes</strong> columns.
              Upload the annotated Scorecard (and optionally the Appendix) here. The system will parse your corrections,
              generate a revised IC memo, and use the feedback to improve future DD runs over time.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              {[
                { label: 'Accuracy column', desc: 'Rate each finding: correct / partially correct / wrong / not relevant' },
                { label: 'Flag Rating column', desc: 'Rate each flag: flag justified / over-flagged / should have been flagged / n/a' },
                { label: 'Notes column', desc: 'Free text — corrections, missed context, what the agent got wrong' },
                { label: 'Review Memo', desc: 'A corrected IC memo is generated from your annotations and saved alongside the originals' },
              ].map(({ label, desc }) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-3">
                  <div className="text-xs font-semibold text-[#33322c] mb-1">{label}</div>
                  <div className="text-xs text-slate-500 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>

            {/* Upload form */}
            <div className="border border-slate-200 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-[#33322c]">Upload Reviewed Documents</h3>

              {/* Company selector */}
              <div>
                <label className="block text-xs font-semibold text-[#545249] mb-1.5 uppercase tracking-wide">Company</label>
                <select
                  value={reviewCompanyId ?? ''}
                  onChange={e => setReviewCompanyId(e.target.value ? Number(e.target.value) : null)}
                  className={cls.select + ' w-full'}
                >
                  <option value="">Select company with completed DD…</option>
                  {ddCompanies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {ddCompanies.length === 0 && (
                  <p className="text-xs text-slate-400 mt-1">No companies with completed DD yet. Switch to the Enriched tab to check.</p>
                )}
              </div>

              {/* Scorecard drop */}
              <div>
                <label className="block text-xs font-semibold text-[#545249] mb-1.5 uppercase tracking-wide">
                  Annotated Scorecard <span className="text-red-400">*</span>
                  <span className="ml-1 font-normal normal-case text-slate-400">.xlsx</span>
                </label>
                <div
                  onClick={() => reviewScorecardRef.current?.click()}
                  className={`cursor-pointer border-2 border-dashed rounded-lg px-4 py-3 text-center transition-colors ${reviewScorecard ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-[#33322c]/40 hover:bg-[#fafcff]'}`}
                >
                  {reviewScorecard
                    ? <p className="text-sm font-medium text-emerald-700">{reviewScorecard.name}</p>
                    : <p className="text-sm text-[#545249]">Drop annotated Scorecard or <span className="text-[#33322c] font-medium">browse</span></p>
                  }
                </div>
                <input ref={reviewScorecardRef} type="file" accept=".xlsx" className="hidden"
                  onChange={e => setReviewScorecard(e.target.files?.[0] ?? null)} />
              </div>

              {/* Appendix drop (optional) */}
              <div>
                <label className="block text-xs font-semibold text-[#545249] mb-1.5 uppercase tracking-wide">
                  Appendix PDF <span className="font-normal normal-case text-slate-400">optional</span>
                </label>
                <div
                  onClick={() => reviewAppendixRef.current?.click()}
                  className={`cursor-pointer border-2 border-dashed rounded-lg px-4 py-3 text-center transition-colors ${reviewAppendix ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-[#33322c]/40 hover:bg-[#fafcff]'}`}
                >
                  {reviewAppendix
                    ? <p className="text-sm font-medium text-blue-700">{reviewAppendix.name}</p>
                    : <p className="text-sm text-[#545249]">Drop Appendix PDF or <span className="text-[#33322c] font-medium">browse</span></p>
                  }
                </div>
                <input ref={reviewAppendixRef} type="file" accept=".pdf" className="hidden"
                  onChange={e => setReviewAppendix(e.target.files?.[0] ?? null)} />
              </div>

              {reviewError && <p className="text-xs text-red-500">{reviewError}</p>}

              {reviewResult && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
                  <span className="font-semibold">{reviewResult.findings_parsed} findings parsed.</span> {reviewResult.message}
                </div>
              )}

              <button
                onClick={handleReviewSubmit}
                disabled={!reviewCompanyId || !reviewScorecard || reviewSubmitting}
                className={`${cls.btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2`}
              >
                {reviewSubmitting && (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                )}
                {reviewSubmitting ? 'Submitting…' : 'Submit for Review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 4D Classification ── */}
      {subTab === '4d' && (
        <div className="space-y-6">

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-5 h-5 text-[#5b21b6]" />
              <h2 className={cls.sectionTitle}>What is 4D Classification?</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed mb-3">
              Every company is classified across four independent axes: <strong>where it operates</strong>,
              <strong> what it does</strong>, <strong>where it sits in the value chain</strong>, and
              <strong> how it makes money</strong>. This taxonomy is the backbone of partner matching,
              sector filtering, and the Industrial Matrix.
            </p>
            <p className="text-slate-600 text-sm leading-relaxed mb-3">
              The 4D profile is separate from <span className="font-mono text-xs bg-[#f1f5f9]/30 px-1 rounded">sector</span>.
              Two companies in the same sector (e.g. Robotics) can have completely different 4D profiles —
              one might be <em className="not-italic font-medium">Structured Indoor / Manipulation / Solution / RaaS</em> and
              another <em className="not-italic font-medium">Environment Agnostic / Perception / Platform / SaaS</em>.
            </p>
            <div className="bg-[#ede9fe] border border-[#c4b5fd] rounded-lg p-4">
              <p className="text-xs font-semibold text-[#5b21b6] mb-1">Priority: Get this right before scoring</p>
              <p className="text-xs text-[#5b21b6]/80 leading-relaxed">
                The 4D fields are used as inputs to the Industrial Analysis and future scoring models.
                Every company profile shows the 4D section in a collapsible card — you can manually correct
                any field at any time using the Review button, or re-run the LLM classification via
                "Re-run → 4D Classification" in the enrichment strip.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-1`}>How Classification Works</h2>
            <p className="text-xs text-[#787569] mb-4 font-mono">workers/enrichment/enrich_4d.py — step 2, separate from Case Studies & Deployments</p>
            <div className="space-y-4">
              {[
                { step: '1', label: 'Website Scrape', desc: 'Fetches the company homepage (up to 4,000 chars). This is the primary signal — the product description, use cases, and integration language on the website tell the model more than any search result.' },
                { step: '2', label: 'Brave Search ×3', desc: 'Three searches fill context gaps: recent news, funding/investor context, and product/technology details. Combined output ≤3,000 chars.' },
                { step: '3', label: 'LLM Classification', desc: 'qwen3-235b classifies all four dimensions in one call (temp 0.1). Only values from the controlled vocabulary are accepted — if the model returns something invalid, that field is skipped.' },
                { step: '4', label: 'Preserve-first write', desc: '4D fields are always written (re-enrichment improves accuracy). Other profile fields — description, stage, HQ, investors — are only written if the DB value is currently NULL.' },
              ].map(({ step, label, desc }) => (
                <div key={step} className="flex gap-4">
                  <div className="w-7 h-7 rounded-full bg-[#5b21b6] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step}</div>
                  <div>
                    <div className="text-sm font-semibold text-[#33322c] mb-0.5">{label}</div>
                    <div className="text-xs text-[#545249] leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* What Gets Written */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-3`}>What Gets Written</h2>
            <div className="space-y-2 mb-4">
              {[
                { col: 'env_4d, func_4d, stack_4d, biz_model_4d', type: 'TEXT', desc: 'Always overwritten — re-running improves accuracy. Only values from the controlled vocabulary are accepted.' },
                { col: 'news_articles', type: 'JSONB []', desc: 'Array of { title, url, snippet, age } from the news Brave search. Written directly — no Human Review. Displayed in the News section on the profile, sorted newest-first.' },
                { col: 'description, stage, hq_city, country, employee_count, founded, total_raised_usd, investors, tags', type: 'TEXT / INT / []', desc: 'Written only if currently NULL — existing values are preserved.' },
              ].map(({ col, type, desc }) => (
                <div key={col} className="flex items-start gap-3 py-2 border-b border-slate-200 last:border-0">
                  <code className="text-xs font-mono text-[#5b21b6] bg-[#ede8d7] px-1.5 py-0.5 rounded border border-slate-200 flex-shrink-0 mt-0.5 max-w-[220px]">{col}</code>
                  <span className="text-[10px] text-[#787569] font-mono flex-shrink-0 mt-1">{type}</span>
                  <span className="text-xs text-[#545249]">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* The Four Dimensions */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-4`}>The Four Dimensions</h2>
            <div className="space-y-5">
              {[
                {
                  dim: 'Environment', col: 'env_4d', icon: Factory, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200',
                  desc: 'Where does the technology physically operate?',
                  values: [
                    { v: 'Structured_Indoor',    d: 'Warehouses, factories, hospitals — controlled, predictable environment' },
                    { v: 'Unstructured_Outdoor', d: 'Construction, agriculture, field service — unpredictable terrain' },
                    { v: 'Aerial',               d: 'Drones, UAVs, airborne systems' },
                    { v: 'Subsea_Underground',   d: 'Subsea inspection, mining, tunneling' },
                    { v: 'Virtual_Simulated',    d: 'Simulation, digital twin — no physical operating environment' },
                    { v: 'Environment_Agnostic', d: 'Horizontal platform — works across multiple physical environments' },
                  ],
                },
                {
                  dim: 'Function', col: 'func_4d', icon: Zap, color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200',
                  desc: 'What core capability does the product deliver?',
                  values: [
                    { v: 'Manipulation',        d: 'Grasping, assembly, pick-and-place — the robot touches things' },
                    { v: 'Mobility',            d: 'Locomotion, navigation, transport, AMRs' },
                    { v: 'Perception',          d: 'Sensing, computer vision, detection, mapping' },
                    { v: 'Cognition',           d: 'Decision-making, planning, AI inference, reasoning' },
                    { v: 'Human_Collaboration', d: 'Cobots, human-robot interaction, assistive technology' },
                    { v: 'Infrastructure',      d: 'Connectivity, edge compute, developer tooling — the robot ecosystem' },
                  ],
                },
                {
                  dim: 'Stack Layer', col: 'stack_4d', icon: Shield, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200',
                  desc: 'Where does the company sit in the technology value chain?',
                  values: [
                    { v: 'Component',    d: 'Chip, sensor, actuator — a part that goes into something else' },
                    { v: 'Subsystem',    d: 'Vision module, gripper — integrates into a larger product' },
                    { v: 'Solution',     d: 'End-to-end product for a specific use case — vertical-focused' },
                    { v: 'Platform',     d: 'Horizontal layer others build on — OS, middleware, dev platform' },
                    { v: 'Intelligence', d: 'Pure software/AI layer — no hardware, sits on top of existing systems' },
                    { v: 'Ops',          d: 'Fleet management, monitoring, maintenance tooling for deployed systems' },
                  ],
                },
                {
                  dim: 'Business Model', col: 'biz_model_4d', icon: FileText, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200',
                  desc: 'How does the company generate revenue?',
                  values: [
                    { v: 'Hardware_OEM',          d: 'Sells the physical product (robot, sensor, device)' },
                    { v: 'SaaS',                  d: 'Software subscription — recurring revenue, no hardware' },
                    { v: 'RaaS',                  d: 'Robotics-as-a-Service — outcome-based, hardware + software bundled' },
                    { v: 'Integration_Consulting', d: 'Services-led — deploys and integrates third-party systems' },
                    { v: 'Data_Analytics',         d: 'Sells data products or analytics derived from operations' },
                    { v: 'Marketplace',            d: 'Platform connecting buyers and sellers of robotics services' },
                    { v: 'Research_Lab',           d: 'Pre-commercial — grant or government contract funded' },
                  ],
                },
              ].map(({ dim, col, icon: Icon, color, bg, desc, values }) => (
                <div key={dim} className={`rounded-lg border p-5 ${bg}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`w-4 h-4 ${color}`} />
                    <span className={`font-bold text-sm ${color}`}>{dim}</span>
                    <code className="ml-1 text-[10px] font-mono text-[#787569] bg-white/70 px-1.5 py-0.5 rounded border border-white/60">{col}</code>
                  </div>
                  <p className="text-xs text-slate-600 mb-3">{desc}</p>
                  <div className="space-y-1.5">
                    {values.map(({ v, d }) => (
                      <div key={v} className="flex items-start gap-2">
                        <span className="px-1.5 py-0.5 bg-white/80 rounded text-xs font-mono font-semibold text-slate-700 border border-white/60 flex-shrink-0">{v}</span>
                        <span className="text-xs text-[#545249] pt-0.5">{d}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Example combinations */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-4`}>Example Combinations</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    {['Company Type', 'env_4d', 'func_4d', 'stack_4d', 'biz_model_4d'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-[#787569]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Warehouse AMR vendor',     'Structured_Indoor',    'Mobility',       'Solution',   'RaaS'],
                    ['Computer vision chip',     'Environment_Agnostic', 'Perception',     'Component',  'Hardware_OEM'],
                    ['Robot OS / middleware',    'Environment_Agnostic', 'Infrastructure', 'Platform',   'SaaS'],
                    ['Outdoor inspection drone', 'Unstructured_Outdoor', 'Perception',     'Solution',   'SaaS'],
                    ['Cobot arm manufacturer',   'Structured_Indoor',    'Manipulation',   'Solution',   'Hardware_OEM'],
                    ['Fleet ops software',       'Environment_Agnostic', 'Cognition',      'Ops',        'SaaS'],
                  ].map(([type, ...vals]) => (
                    <tr key={type} className="border-b border-slate-200 hover:bg-[#ede8d7]">
                      <td className="px-3 py-2 font-medium text-slate-700">{type}</td>
                      {vals.map((v, i) => (
                        <td key={i} className="px-3 py-2 font-mono text-[#545249]">{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Status flow */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className={`${cls.sectionTitle} mb-3`}>Enrichment Status</h2>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              {[
                { label: 'pending',  desc: 'Queued — nightly worker will process', color: 'bg-amber-100 text-amber-800 border-amber-300'    },
                { label: '→',       desc: '',                                       color: 'text-[#787569] border-transparent bg-transparent' },
                { label: 'enriched', desc: 'Deep enrichment complete',              color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
                { label: '→',       desc: '',                                       color: 'text-[#787569] border-transparent bg-transparent' },
                { label: 'failed',   desc: 'Error — retried next run',              color: 'bg-[#f1f5f9]/30 text-slate-700 border-slate-200'      },
              ].map(({ label, desc, color }) => (
                <div key={label + desc} className="flex flex-col items-center gap-1">
                  <span className={`px-2 py-1 rounded border text-xs font-mono font-semibold ${color}`}>{label}</span>
                  {desc && <span className="text-[10px] text-[#787569] text-center max-w-[90px]">{desc}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Intelligence Engine ── */}
      {subTab === 'intel' && (
        <div className="space-y-4">
          <div className="bg-[#f0f9ff] border border-[#bae6fd] rounded-xl p-4">
            <p className="text-sm text-[#0369a1] font-medium mb-1">Market Intelligence Engine — How It Works</p>
            <p className="text-xs text-[#0c4a6e] leading-relaxed">
              A six-module nightly pipeline that collects, transcribes, scores, enriches, and indexes content —
              then connects mentions in that content to both pipeline startups and F500 advisory partners.
              Each module is additive: it writes new data without touching upstream tables.
            </p>
          </div>

          {[
            {
              number: 1, color: '#64748b', bg: '#64748b18',
              title: 'Platform Config (ConfigLoader)',
              file: 'core/config_loader.py',
              what: 'Singleton that loads cvc.platform_settings from the DB once per process — making four keys available to every worker: investment_thesis, corporate_partners_context, sector_focus, and analyst_context.',
              how: 'Workers call config.get("key") at startup. If the DB is unreachable a hardcoded Safe Default is returned so no worker ever crashes. Update a setting in the DB → takes effect on next worker restart, no code changes needed.',
              impact: 'Previously, thesis strings were scattered as hardcoded literals across 4+ worker files. Now one DB row drives all LLM prompts platform-wide.',
            },
            {
              number: 2, color: '#6366f1', bg: '#6366f118',
              title: 'Content Collection',
              file: 'workers/briefing/fetch_articles.py · fetch_podcasts.py',
              what: 'Daily collectors that pull RSS feeds (news, trade press) and podcast episodes into cvc.content_items. Each item stores raw text, source URL, content type, and published date.',
              how: 'fetch_articles.py polls configured RSS sources and deduplicates by URL. fetch_podcasts.py retrieves podcast feeds; for each new episode it calls the audio pipeline (Module 3) for a local GPU transcript, falling back to YouTube captions if diarization fails.',
              impact: 'Seeds the intelligence pipeline with ~50–150 new content items per day before any LLM work runs.',
            },
            {
              number: 3, color: '#ec4899', bg: '#ec489918',
              title: 'Audio Transcription & Synthesis',
              file: 'workers/briefing/diarize_podcast.py · enrichment_worker.py',
              what: 'WhisperX large-v3 + Pyannote 3.1 runs on the Refinery RTX 3090 to transcribe podcast audio with speaker diarization. The enrichment worker then extracts structured insights with expert attribution.',
              how: 'diarize_podcast.py downloads audio via yt-dlp, transcribes with word-level timestamps, and assigns speaker labels. The labeled transcript is stored as raw_text. The enrichment worker calls kimi-k2.5 to produce podcast_synthesis JSONB: an array of {insight, expert, section, confidence} objects per episode.',
              impact: 'Turns unstructured podcast audio into attributable intelligence — "expert said X with HIGH confidence in the Funding segment" — surfaced in weekly briefings.',
            },
            {
              number: 4, color: '#06b6d4', bg: '#06b6d418',
              title: 'Relevance Scoring & LLM Enrichment',
              file: 'workers/briefing/enrichment_worker.py',
              what: "Two-stage pipeline: scores each content item 1–10 for relevance to SLAM's sector focus, then enriches items above the threshold with a full LLM analysis.",
              how: 'Stage 1 (relevance): qwen3:30b-a3b via local Ollama scores each item against the sector_focus config key. Items below threshold (default 4/10) are skipped. Stage 2 (enrichment): extracts summary, key insights, named entities (companies · people · technologies), topic tags, and sentiment. Falls back to qwen3-235b via OpenRouter if Ollama is down.',
              impact: 'Filters noise before spending LLM budget. Every item above threshold gets structured entities that feed Modules 5 and 6 downstream.',
            },
            {
              number: 5, color: '#10b981', bg: '#10b98118',
              title: 'Entity Resolution',
              file: 'workers/briefing/entity_resolver.py',
              what: 'Scans key_entities.companies from all enriched content items, aggregates mention counts, and fuzzy-matches company name variants against cvc.companies to link content signals to pipeline startups.',
              how: 'Phase 1 (ingest): sweeps content_items, normalizes company strings (strips Inc./LLC/Corp, collapses whitespace), upserts into cvc.entities with mention counts and first/last seen dates. Phase 2 (resolve): fuzzy-matches each entity against every company name (SequenceMatcher ≥ 0.85). Entities with no match are still marked resolved so they are not re-processed.',
              impact: '1,800+ entities tracked across the content corpus. Tells you which pipeline startups are appearing in the intelligence feed — and how often.',
            },
            {
              number: 6, color: '#f59e0b', bg: '#f59e0b18',
              title: 'Partner Signal Matching',
              file: 'workers/briefing/strategic_matcher_worker.py',
              what: "Links entity name variants to SLAM's F500 advisory partners using semantic embeddings and vector similarity — catching variants like 'Honeywell Aerospace' and 'Honeywell USA' as the same partner.",
              how: 'Three phases: (1) embed all partner names using mxbai-embed-large via Ollama → stored as name_embedding on cvc.partners. (2) embed all cvc.entities the same way. (3) CROSS JOIN cosine similarity (pgvector <=> operator) between all entity/partner pairs — matches above 0.82 similarity write partner_id + confidence back to cvc.entities.',
              impact: "Powers the Signal Intelligence widget on each partner's profile — total content mentions, name variants detected, and recent articles. The data existed in the corpus; this module makes it visible.",
            },
          ].map(mod => (
            <div key={mod.number} className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: mod.bg }}>
                  <span className="text-sm font-bold" style={{ color: mod.color }}>{mod.number}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-slate-400 font-bold">Module {mod.number}</span>
                    <code className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded font-mono">{mod.file}</code>
                  </div>
                  <h3 className={cls.sectionTitle}>{mod.title}</h3>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">What it does</p>
                      <p className="text-sm text-slate-600 leading-relaxed">{mod.what}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">How it works</p>
                      <p className="text-sm text-slate-600 leading-relaxed">{mod.how}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Impact</p>
                      <p className="text-sm text-slate-600 leading-relaxed">{mod.impact}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── PSM Scoring ── */}
      {subTab === 'psm' && (
        <div className="space-y-6">
          <div className="bg-[#f0f9ff] border border-[#bae6fd] rounded-xl p-4">
            <p className="text-sm text-[#0369a1] font-medium mb-1">PSM Performance Scoring — How It Works</p>
            <p className="text-xs text-[#0c4a6e] leading-relaxed">
              Each PSM is scored on two dimensions: <strong>Points</strong> (milestone activity this month) and
              <strong> Freshness</strong> (how recently they logged any update). Scores update live as PSMs log
              status updates in the Partner Terminal. Attribution requires PSMs to be logged in — every status
              log entry is stamped with the author's username.
            </p>
          </div>

          {/* Points */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-base font-bold text-[#33322c] mb-1">Points — Milestone Activity</h3>
            <p className="text-sm text-slate-500 mb-4">
              Points are earned each time a PSM logs a status update that records a stage outcome. Points are
              weighted by how far the intro has progressed — logging a commercial agreement is worth far more than
              an NDA confirmation.
            </p>
            <div className="overflow-hidden border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left">Stage</th>
                    <th className="px-4 py-3 text-left">Points</th>
                    <th className="px-4 py-3 text-left">Rationale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    { stage: 'NDA Signed',           pts: 10,  note: 'Early signal of partner interest — meaningful but low commitment' },
                    { stage: 'PoC / Proof of Concept', pts: 25, note: 'Active engagement, startup is building / testing with partner' },
                    { stage: 'Pilot Program',          pts: 50, note: 'Formal program started, resource commitment from both sides' },
                    { stage: 'Commercial Agreement',   pts: 150, note: 'Revenue-generating relationship — highest-value outcome' },
                  ].map(r => (
                    <tr key={r.stage} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-[#33322c]">{r.stage}</td>
                      <td className="px-4 py-3">
                        <span className="font-bold text-[#8a7200] text-base">{r.pts}</span>
                        <span className="text-xs text-slate-400 ml-1">pts</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-3">Points are summed across all intros logged this calendar month. A PSM who logs 2 NDAs and 1 Pilot earns 10 + 10 + 50 = 70 pts.</p>
          </div>

          {/* Freshness */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-base font-bold text-[#33322c] mb-1">Freshness Score</h3>
            <p className="text-sm text-slate-500 mb-4">
              Freshness measures how recently a PSM logged any status update — regardless of which startup or
              outcome. It decays linearly from 100% (logged today) to 0% (30+ days since last log).
              A PSM can have high points but low freshness if they were very active early in the month and then
              went quiet.
            </p>
            <div className="bg-[#ede8d7] rounded-lg p-4 font-mono text-sm">
              <p className="text-[#33322c]">freshness = max(0, 1 − days_since_last_log / 30) × 100</p>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4">
              {[
                { days: '0 days',    score: '100%', color: 'text-emerald-600', label: 'Active today' },
                { days: '15 days',   score: '50%',  color: 'text-amber-600',   label: 'Going stale' },
                { days: '30+ days',  score: '0%',   color: 'text-red-500',     label: 'Inactive' },
              ].map(ex => (
                <div key={ex.days} className="text-center border border-slate-200 rounded-lg p-3">
                  <div className={`text-xl font-bold ${ex.color}`}>{ex.score}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{ex.days} since last log</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{ex.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Attribution */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-base font-bold text-[#33322c] mb-1">Attribution — How Logs Are Stamped</h3>
            <p className="text-sm text-slate-500 mb-3">
              Every status log entry in the Partner Terminal includes a <code className="bg-slate-100 px-1 rounded font-mono text-xs">logged_by</code> field
              set automatically from the PSM's JWT session at the time of submission. PSMs do not enter their name — it's
              derived from their login.
            </p>
            <div className="bg-[#ede8d7] rounded-lg p-4 font-mono text-xs text-[#33322c] space-y-1">
              <p>{'{'}</p>
              <p className="ml-4">text: "Initial NDA call completed, shared term sheet",</p>
              <p className="ml-4">ts: "2026-05-01T14:22:00Z",</p>
              <p className="ml-4">outcome: "nda",</p>
              <p className="ml-4 text-[#8a7200] font-bold">logged_by: "harshal"</p>
              <p>{'}'}</p>
            </div>
            <p className="text-xs text-slate-400 mt-3">
              The leaderboard on the Partners hub aggregates all <code className="bg-slate-100 px-1 rounded font-mono text-xs">logged_by</code> entries
              across all intros for the current month. PSMs must be logged in with their own account for attribution to work correctly.
            </p>
          </div>
        </div>
      )}

      {/* ── Corporate Traction Signal ── */}
      {subTab === 'traction' && (
        <div className="space-y-6">
          <div className="bg-[#f0f9ff] border border-[#bae6fd] rounded-xl p-4">
            <p className="text-sm text-[#0369a1] font-medium mb-1">Corporate Traction Signal — How It Works</p>
            <p className="text-xs text-[#0c4a6e] leading-relaxed">
              The traction signal ranks every startup SLAM has introduced (not just portfolio) by the depth and
              recency of their corporate partner engagement. It combines intro volume with downstream milestone
              progression using exponential time decay — recent activity scores higher than old wins.
              This is the homepage "Corporate Traction" sidebar widget.
            </p>
          </div>

          {/* Score formula */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-base font-bold text-[#33322c] mb-1">Scoring Formula</h3>
            <p className="text-sm text-slate-500 mb-4">
              Each intro contributes a base milestone score multiplied by an exponential decay factor based on
              how long ago that milestone was last active. Scores across all a company's intros are summed.
            </p>
            <div className="bg-[#ede8d7] rounded-lg p-4 font-mono text-sm text-[#33322c] mb-4">
              <p>S_company = Σ (milestone_pts × e<sup>−λt</sup>)</p>
              <p className="text-xs text-slate-500 mt-2 font-sans">where t = days since last activity on that intro, λ = decay rate</p>
            </div>
            <div className="overflow-hidden border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left">Stage</th>
                    <th className="px-4 py-3 text-left">Base Points</th>
                    <th className="px-4 py-3 text-left">Half-Life</th>
                    <th className="px-4 py-3 text-left">Decay Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    { stage: 'NDA',                pts: 10,  hl: '21 days',  type: 'Fast — NDAs go stale quickly without follow-up' },
                    { stage: 'PoC',                pts: 25,  hl: '21 days',  type: 'Fast — active testing phase, expect frequent updates' },
                    { stage: 'Pilot',              pts: 50,  hl: '90 days',  type: 'Slow — pilots run for months, silence is normal' },
                    { stage: 'Commercial',         pts: 150, hl: '90 days',  type: 'Slow — active revenue relationship, durable signal' },
                  ].map(r => (
                    <tr key={r.stage} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-[#33322c]">{r.stage}</td>
                      <td className="px-4 py-3 font-bold text-[#8a7200]">{r.pts}</td>
                      <td className="px-4 py-3 text-slate-600">{r.hl}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{r.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bonuses */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-base font-bold text-[#33322c] mb-4">Score Bonuses</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-amber-200 bg-amber-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">⚡</span>
                  <span className="font-semibold text-amber-800 text-sm">Velocity Bonus — 1.5×</span>
                </div>
                <p className="text-xs text-amber-700 leading-relaxed">
                  Applied when a stage transition (e.g. intro → NDA, NDA → PoC) occurs within <strong>30 days</strong> of
                  the previous one. Rewards fast-moving relationships. The multiplier applies to that intro's full
                  decay score at the time of calculation.
                </p>
              </div>
              <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">📈</span>
                  <span className="font-semibold text-blue-800 text-sm">Momentum Boost — +20%</span>
                </div>
                <p className="text-xs text-blue-700 leading-relaxed">
                  Applied to a company's total score for <strong>7 days</strong> after any PSM logs a status update
                  on one of its intros. Surfaces currently-active deals that may not have a stage change yet —
                  e.g. a PSM noting "had a call, progressing" bumps the company's ranking temporarily.
                </p>
              </div>
            </div>
          </div>

          {/* Signals on the card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-base font-bold text-[#33322c] mb-3">What the Widget Shows</h3>
            <div className="space-y-3">
              {[
                { badge: '⚡ Rising', color: 'bg-amber-100 text-amber-700', desc: 'Velocity bonus is active — a stage transition happened in the last 30 days' },
                { badge: '⚠ Stale',  color: 'bg-slate-100 text-slate-500', desc: 'NDA or PoC with no status log update in more than 21 days — needs PSM follow-up' },
                { badge: '↑ / ↓',    color: 'bg-white text-slate-700 border border-slate-200', desc: 'Delta arrows show score direction vs. the previous calculation window' },
              ].map(s => (
                <div key={s.badge} className="flex items-start gap-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded shrink-0 ${s.color}`}>{s.badge}</span>
                  <p className="text-sm text-slate-500">{s.desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-200">
              <p className="text-xs text-slate-400">
                Window filter (14d / 2mo / 6mo) controls which status log entries are included when computing
                the activity reference date for decay. Shorter windows surface only very recent deals;
                longer windows include slower-moving enterprise relationships.
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
const SOURCE_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  rss:        { label: 'RSS',        color: '#f59e0b', bg: '#fefce8' },
  podcast:    { label: 'Podcast',    color: '#8b5cf6', bg: '#f5f3ff' },
  youtube:    { label: 'YouTube',    color: '#ef4444', bg: '#fef2f2' },
  newsletter: { label: 'Newsletter', color: '#0ea5e9', bg: '#f0f9ff' },
  manual:     { label: 'Manual',     color: '#545249', bg: '#f9fafb' },
};

const MACHINE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  dell:     { label: 'Dell (nlouserv)', color: '#33322c', bg: '#f0f4f7' },
  refinery: { label: 'Refinery',       color: '#7c3aed', bg: '#f5f3ff' },
  lenovo:   { label: 'Lenovo',         color: '#0ea5e9', bg: '#f0f9ff' },
};
const CRON_CATEGORY_CONFIG: Record<string, { color: string; bg: string }> = {
  enrichment: { color: '#f59e0b', bg: '#fefce8' },
  briefing:   { color: '#0ea5e9', bg: '#f0f9ff' },
  scraping:   { color: '#10b981', bg: '#f0fdf4' },
  scoring:    { color: '#8b5cf6', bg: '#f5f3ff' },
  agent:      { color: '#6366f1', bg: '#eef2ff' },
  system:     { color: '#545249', bg: '#f9fafb' },
};

const DAY_NAMES: Record<string, string> = { '0':'Sun','1':'Mon','2':'Tue','3':'Wed','4':'Thu','5':'Fri','6':'Sat' };

function humanCron(expr: string): string {
  if (!expr) return '—';
  if (expr === '*/5 * * * *') return 'Every 5 min';
  const parts = expr.split(' ');
  if (parts.length !== 5) return expr;
  const [min, hour, , , dow] = parts;
  if (min === '0' && hour === '*') return 'Hourly';
  const timeStr = `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')} UTC`;
  if (min.startsWith('*/')) return `Every ${min.slice(2)} min`;
  if (dow !== '*') return `${DAY_NAMES[dow] ?? 'Sun'} @ ${timeStr}`;
  return `Daily @ ${timeStr}`;
}

type FreqType = 'interval' | 'hourly' | 'daily' | 'weekly' | 'custom';

function parseCronToFreq(expr: string): { type: FreqType; intervalMin: number; hour: number; minute: number; dow: number } {
  const defaults = { type: 'custom' as FreqType, intervalMin: 5, hour: 2, minute: 0, dow: 0 };
  if (!expr) return defaults;
  if (expr === '*/5 * * * *') return { ...defaults, type: 'interval', intervalMin: 5 };
  const parts = expr.split(' ');
  if (parts.length !== 5) return defaults;
  const [min, hour, , , dow] = parts;
  if (min.startsWith('*/')) return { ...defaults, type: 'interval', intervalMin: parseInt(min.slice(2)) || 5 };
  if (min === '0' && hour === '*') return { ...defaults, type: 'hourly' };
  const m = parseInt(min) || 0;
  const h = parseInt(hour) || 0;
  if (dow !== '*') return { ...defaults, type: 'weekly', hour: h, minute: m, dow: parseInt(dow) || 0 };
  return { ...defaults, type: 'daily', hour: h, minute: m };
}

function freqToCron(type: FreqType, intervalMin: number, hour: number, minute: number, dow: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (type === 'interval') return `*/${intervalMin} * * * *`;
  if (type === 'hourly')   return `0 * * * *`;
  if (type === 'daily')    return `${minute} ${hour} * * *`;
  if (type === 'weekly')   return `${minute} ${hour} * * ${dow}`;
  return '';
}

function FrequencyPicker({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const parsed = parseCronToFreq(value);
  const [type, setType]           = useState<FreqType>(parsed.type);
  const [intervalMin, setInterval] = useState(parsed.intervalMin);
  const [hour, setHour]           = useState(parsed.hour);
  const [minute, setMinute]       = useState(parsed.minute);
  const [dow, setDow]             = useState(parsed.dow);
  const [custom, setCustom]       = useState(value);

  const emit = (t: FreqType, iv: number, h: number, m: number, d: number) => {
    if (t === 'custom') return;
    onChange(freqToCron(t, iv, h, m, d));
  };

  const setT = (t: FreqType) => { setType(t); if (t !== 'custom') emit(t, intervalMin, hour, minute, dow); };
  const setIv = (v: number) => { setInterval(v); emit(type, v, hour, minute, dow); };
  const setH  = (v: number) => { setHour(v);  emit(type, intervalMin, v, minute, dow); };
  const setM  = (v: number) => { setMinute(v); emit(type, intervalMin, hour, v, dow); };
  const setD  = (v: number) => { setDow(v);   emit(type, intervalMin, hour, minute, v); };

  const sel = "px-2 py-1 text-xs border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-[#33322c]";

  return (
    <div className="space-y-2">
      <select className={sel} value={type} onChange={e => setT(e.target.value as FreqType)}>
        <option value="interval">Every N minutes</option>
        <option value="hourly">Hourly</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="custom">Custom (cron)</option>
      </select>

      {type === 'interval' && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[#545249]">Every</span>
          <select className={sel} value={intervalMin} onChange={e => setIv(parseInt(e.target.value))}>
            {[1,2,5,10,15,20,30,45,60].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-xs text-[#545249]">minutes</span>
        </div>
      )}

      {(type === 'daily' || type === 'weekly') && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {type === 'weekly' && (
            <>
              <span className="text-xs text-[#545249]">On</span>
              <select className={sel} value={dow} onChange={e => setD(parseInt(e.target.value))}>
                {Object.entries(DAY_NAMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </>
          )}
          <span className="text-xs text-[#545249]">at</span>
          <select className={sel} value={hour} onChange={e => setH(parseInt(e.target.value))}>
            {Array.from({length:24},(_,i)=><option key={i} value={i}>{String(i).padStart(2,'0')}</option>)}
          </select>
          <span className="text-xs text-[#545249]">:</span>
          <select className={sel} value={minute} onChange={e => setM(parseInt(e.target.value))}>
            {[0,5,10,15,20,25,30,35,40,45,50,55].map(n=><option key={n} value={n}>{String(n).padStart(2,'0')}</option>)}
          </select>
          <span className="text-xs text-[#545249]">UTC</span>
        </div>
      )}

      {type === 'custom' && (
        <input
          className="w-full px-2 py-1 text-xs border border-slate-200 rounded font-mono focus:outline-none focus:ring-1 focus:ring-[#33322c]"
          placeholder="* * * * *"
          value={custom}
          onChange={e => { setCustom(e.target.value); onChange(e.target.value); }}
        />
      )}

      <div className="text-[10px] text-[#787569] font-mono">
        {type !== 'custom' ? freqToCron(type, intervalMin, hour, minute, dow) : custom}
        {' → '}{humanCron(type !== 'custom' ? freqToCron(type, intervalMin, hour, minute, dow) : custom)}
      </div>
    </div>
  );
}

const YT_STATUS_BADGE: Record<string, string> = {
  raw:            'bg-amber-100 text-amber-700',
  fully_enriched: 'bg-emerald-100 text-emerald-700',
  summarized:     'bg-blue-100 text-blue-700',
  skipped:        'bg-slate-100 text-slate-500',
};

function QuickAddEpisode() {
  const [url, setUrl]           = useState('');
  const [title, setTitle]       = useState('');
  const [items, setItems]       = useState<any[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [submitting, setSubmitting]     = useState(false);
  const [message, setMessage]   = useState<{ text: string; ok: boolean } | null>(null);
  const [open, setOpen]         = useState(false);

  async function loadQueue() {
    try {
      const res = await fetch('/admin/content/youtube', { headers: AUTH });
      const data = await res.json();
      setItems(data.items ?? []);
    } catch { /* silent */ }
    finally { setQueueLoading(false); }
  }

  useEffect(() => { loadQueue(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch('/admin/content/youtube', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), title: title.trim() || undefined }),
      });
      const data = await res.json();
      if (data.status === 'duplicate') {
        setMessage({ text: `Already queued: "${data.item.title}"`, ok: false });
      } else {
        setMessage({ text: data.message ?? 'Queued successfully', ok: true });
        setUrl('');
        setTitle('');
        await loadQueue();
      }
    } catch {
      setMessage({ text: 'Failed to add — check the URL and try again.', ok: false });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#ede8d7] hover:bg-[#f1f5f9]/30 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Rss className="w-4 h-4 text-[#33322c] flex-shrink-0" />
          <span className="text-sm font-semibold text-[#33322c]">Quick Add Episode</span>
          <span className="text-xs text-[#545249] hidden sm:inline">
            Paste a YouTube URL to include it in the next enrichment run
          </span>
          {items.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#0ea5e9]/10 text-[#0ea5e9]">
              {items.length} queued
            </span>
          )}
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-[#545249] flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-[#545249] flex-shrink-0" />}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {/* Form */}
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#545249] mb-1 font-semibold">YouTube URL</label>
                <input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#0ea5e9]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#545249] mb-1">
                  Title <span className="font-normal text-[#94a3b8]">(optional — auto-fetched if blank)</span>
                </label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. How Robotics is Reshaping Supply Chains"
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#0ea5e9]"
                />
              </div>
            </div>
            {message && (
              <p className={`text-xs px-2.5 py-1.5 rounded ${message.ok ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#fef2f2] text-[#b91c1c]'}`}>
                {message.text}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting || !url.trim()}
              className="px-3 py-1.5 bg-[#33322c] text-white text-sm rounded hover:bg-[#151411] disabled:opacity-40 transition-colors"
            >
              {submitting ? 'Fetching…' : 'Add to Queue'}
            </button>
          </form>

          {/* Queued items */}
          {queueLoading ? (
            <p className="text-xs text-[#787569]">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-[#787569]">No manually queued episodes yet.</p>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-[#f8fafc] border-b border-slate-200 text-[10px] font-bold uppercase tracking-wide text-[#94a3b8]">
                Manually Queued Episodes
              </div>
              {items.map(item => (
                <div key={item.id} className="px-3 py-2.5 border-b border-slate-100 last:border-0 flex items-start justify-between gap-4 hover:bg-[#fafafa]">
                  <div className="min-w-0">
                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                      className="text-sm font-medium text-[#111827] hover:underline truncate block max-w-xl">
                      {item.title}
                    </a>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${YT_STATUS_BADGE[item.enrichment_status] ?? 'bg-slate-100 text-slate-500'}`}>
                        {item.enrichment_status}
                      </span>
                      <span className={`text-xs ${item.transcript_chars > 0 ? 'text-[#787569]' : 'text-violet-500 font-medium'}`}>
                        {item.transcript_chars > 0 ? `${(item.transcript_chars / 1000).toFixed(1)}k chars` : 'transcript pending — fetches tonight'}
                      </span>
                      <span className="text-xs text-[#94a3b8]">
                        {item.created_at ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IntelBriefingTab({
  sources, loading, showAdd, setShowAdd, newSource, setNewSource, adding, onAdd, onToggle, onDelete,
  detectUrl, setDetectUrl, detecting, detectNote, onDetect,
  cronJobs, cronOpen, setCronOpen, editingCron, setEditingCron, cronEdits, setCronEdits, onSaveCron, onToggleCron,
}: {
  sources: BriefingSource[];
  loading: boolean;
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
  newSource: { name: string; url: string; source_type: string; category: string; notes: string };
  setNewSource: (v: any) => void;
  adding: boolean;
  onAdd: () => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  detectUrl: string;
  setDetectUrl: (v: string) => void;
  detecting: boolean;
  detectNote: string;
  onDetect: () => void;
  cronJobs: CronJob[];
  cronOpen: boolean;
  setCronOpen: (v: boolean) => void;
  editingCron: number | null;
  setEditingCron: (v: number | null) => void;
  cronEdits: Partial<CronJob>;
  setCronEdits: (v: Partial<CronJob>) => void;
  onSaveCron: (id: number) => void;
  onToggleCron: (id: number, current: boolean) => void;
}) {
  const active   = sources.filter(s => s.active);
  const inactive = sources.filter(s => !s.active);

  return (
    <div className="p-6 space-y-6">

      {/* ── Cron Schedule Panel ─────────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setCronOpen(!cronOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-[#ede8d7] hover:bg-[#f1f5f9]/30 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Clock className="w-4 h-4 text-[#33322c] flex-shrink-0" />
            <span className="text-sm font-semibold text-[#33322c]">Scheduled Jobs</span>
            <span className="text-xs text-[#545249] hidden sm:inline">
              ({cronJobs.filter(j => j.active).length} active · {[...new Set(cronJobs.map(j => j.machine))].length} machines)
            </span>
          </div>
          {cronOpen ? <ChevronDown className="w-4 h-4 text-[#545249] flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-[#545249] flex-shrink-0" />}
        </button>

        {cronOpen && (
          <div>
            {cronJobs.length === 0 ? (
              <div className="text-center py-8 text-[#787569] text-sm">No jobs loaded</div>
            ) : (
              (['dell', 'refinery'] as const).map(machine => {
                const jobs = cronJobs.filter(j => j.machine === machine);
                if (!jobs.length) return null;
                const mCfg = MACHINE_CONFIG[machine] ?? MACHINE_CONFIG['dell'];
                return (
                  <div key={machine}>
                    <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide border-b border-t border-slate-200"
                      style={{ background: mCfg.bg, color: mCfg.color }}>
                      {mCfg.label}
                    </div>

                    {/* Desktop table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-[#ede8d7] border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-[#94a3b8] w-40">Schedule</th>
                            <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-[#94a3b8]">Job</th>
                            <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-[#94a3b8] hidden lg:table-cell">Description</th>
                            <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-[#94a3b8] w-24">Category</th>
                            <th className="px-4 py-2 w-28"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {jobs.map(job => {
                            const catCfg = CRON_CATEGORY_CONFIG[job.category ?? ''] ?? CRON_CATEGORY_CONFIG['system'];
                            const isEditing = editingCron === job.id;
                            return (
                              <tr key={job.id} className={`border-b border-slate-200 hover:bg-[#fafafa] transition-colors ${!job.active ? 'opacity-40' : ''}`}>
                                <td className="px-4 py-3">
                                  {isEditing ? (
                                    <FrequencyPicker
                                      value={cronEdits.schedule ?? job.schedule}
                                      onChange={v => setCronEdits({ ...cronEdits, schedule: v })}
                                    />
                                  ) : (
                                    <div>
                                      <div className="text-xs font-medium text-[#33322c]">{humanCron(job.schedule)}</div>
                                      <div className="text-[10px] text-[#787569] font-mono mt-0.5">{job.schedule}</div>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {isEditing ? (
                                    <input className="w-full px-2 py-1 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#33322c]"
                                      value={cronEdits.name ?? job.name}
                                      onChange={e => setCronEdits({ ...cronEdits, name: e.target.value })} />
                                  ) : (
                                    <span className="font-medium text-[#111827]">{job.name}</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-[#545249] text-xs hidden lg:table-cell">
                                  {isEditing ? (
                                    <input className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#33322c]"
                                      value={cronEdits.description ?? job.description ?? ''}
                                      onChange={e => setCronEdits({ ...cronEdits, description: e.target.value })} />
                                  ) : job.description}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize"
                                    style={{ background: catCfg.bg, color: catCfg.color }}>
                                    {job.category ?? 'system'}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  {isEditing ? (
                                    <div className="flex gap-1 justify-end">
                                      <button onClick={() => onSaveCron(job.id)}
                                        className="px-2 py-1 text-xs bg-[#33322c] text-white rounded hover:bg-[#151411]">Save</button>
                                      <button onClick={() => { setEditingCron(null); setCronEdits({}); }}
                                        className="px-2 py-1 text-xs text-[#545249] hover:text-[#33322c]">Cancel</button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1 justify-end">
                                      <button onClick={() => onToggleCron(job.id, job.active)} title={job.active ? 'Disable' : 'Enable'}>
                                        {job.active ? <ToggleRight className="w-5 h-5 text-[#10b981]" /> : <ToggleLeft className="w-5 h-5 text-[#c5c0ad]" />}
                                      </button>
                                      <button onClick={() => { setEditingCron(job.id); setCronEdits({}); }}
                                        className="p-1 rounded text-[#545249] hover:bg-[#f1f5f9]/30 hover:text-[#33322c] transition-colors">
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden divide-y divide-[#f3f4f6]">
                      {jobs.map(job => {
                        const catCfg = CRON_CATEGORY_CONFIG[job.category ?? ''] ?? CRON_CATEGORY_CONFIG['system'];
                        const isEditing = editingCron === job.id;
                        return (
                          <div key={job.id} className={`px-4 py-3 ${!job.active ? 'opacity-40' : ''}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <span className="font-medium text-[#111827] text-sm">{job.name}</span>
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize"
                                    style={{ background: catCfg.bg, color: catCfg.color }}>
                                    {job.category ?? 'system'}
                                  </span>
                                </div>
                                {isEditing ? (
                                  <div className="space-y-2 mt-2">
                                    <input className="w-full px-2 py-1 text-sm border border-slate-200 rounded"
                                      value={cronEdits.name ?? job.name}
                                      onChange={e => setCronEdits({ ...cronEdits, name: e.target.value })} />
                                    <FrequencyPicker
                                      value={cronEdits.schedule ?? job.schedule}
                                      onChange={v => setCronEdits({ ...cronEdits, schedule: v })}
                                    />
                                    <div className="flex gap-2 pt-1">
                                      <button onClick={() => onSaveCron(job.id)}
                                        className="px-3 py-1.5 text-xs bg-[#33322c] text-white rounded hover:bg-[#151411]">Save</button>
                                      <button onClick={() => { setEditingCron(null); setCronEdits({}); }}
                                        className="px-3 py-1.5 text-xs text-[#545249]">Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="text-xs text-[#545249]">{humanCron(job.schedule)} <span className="font-mono text-[#787569]">({job.schedule})</span></div>
                                    {job.description && <div className="text-xs text-[#787569] mt-0.5">{job.description}</div>}
                                  </>
                                )}
                              </div>
                              {!isEditing && (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <button onClick={() => onToggleCron(job.id, job.active)}>
                                    {job.active ? <ToggleRight className="w-5 h-5 text-[#10b981]" /> : <ToggleLeft className="w-5 h-5 text-[#c5c0ad]" />}
                                  </button>
                                  <button onClick={() => { setEditingCron(job.id); setCronEdits({}); }}
                                    className="p-1 rounded text-[#545249] hover:bg-[#f1f5f9]/30">
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ── Quick Add Episode ───────────────────────────────────────────── */}
      <QuickAddEpisode />

      {/* ── Sources Header ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-[#33322c]">Monitored Sources</h3>
            <p className="text-xs text-[#545249] mt-0.5">
              {active.length} active · {inactive.length} paused
            </p>
          </div>
          <button
            onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#33322c] text-white text-sm rounded-md hover:bg-[#151411] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Source
          </button>
        </div>

        {/* ── Add form ──────────────────────────────────────────────────── */}
        {showAdd && (
          <div className="mb-5 p-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-lg">
            <p className="text-xs font-semibold text-[#0ea5e9] mb-3 uppercase tracking-wide">New Source</p>

            {/* URL detect row */}
            <div className="flex gap-2 mb-4">
              <input
                className="flex-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#0ea5e9]"
                placeholder="Paste any URL — we'll detect the type and find the RSS feed"
                value={detectUrl}
                onChange={e => setDetectUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onDetect()}
              />
              <button
                onClick={onDetect}
                disabled={detecting || !detectUrl.trim()}
                className="px-3 py-1.5 bg-[#0ea5e9] text-white text-sm rounded hover:bg-[#0284c7] disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {detecting ? 'Detecting…' : 'Detect'}
              </button>
            </div>
            {detectNote && (
              <div className={`text-xs mb-3 px-2.5 py-1.5 rounded ${detectNote.includes('No RSS') || detectNote.includes('manual') ? 'bg-[#fef9c3] text-[#854d0e]' : 'bg-[#dcfce7] text-[#166534]'}`}>
                {detectNote}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-[#545249] mb-1">Name *</label>
                <input
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#0ea5e9]"
                  placeholder="International Federation of Robotics"
                  value={newSource.name}
                  onChange={e => setNewSource((p: any) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-[#545249] mb-1">URL</label>
                <input
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#0ea5e9]"
                  placeholder="https://..."
                  value={newSource.url}
                  onChange={e => setNewSource((p: any) => ({ ...p, url: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-[#545249] mb-1">Type</label>
                <select
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#0ea5e9] bg-white"
                  value={newSource.source_type}
                  onChange={e => setNewSource((p: any) => ({ ...p, source_type: e.target.value }))}
                >
                  {Object.entries(SOURCE_TYPE_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#545249] mb-1">Category</label>
                <input
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#0ea5e9]"
                  placeholder="robotics, supply chain…"
                  value={newSource.category}
                  onChange={e => setNewSource((p: any) => ({ ...p, category: e.target.value }))}
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs text-[#545249] mb-1">Notes</label>
              <input
                className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#0ea5e9]"
                placeholder="Who runs it, focus area, why we're watching…"
                value={newSource.notes}
                onChange={e => setNewSource((p: any) => ({ ...p, notes: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={onAdd}
                disabled={adding || !newSource.name.trim()}
                className="px-3 py-1.5 bg-[#33322c] text-white text-sm rounded hover:bg-[#151411] disabled:opacity-40 transition-colors"
              >
                {adding ? 'Saving…' : 'Save to Database'}
              </button>
              <button
                onClick={() => { setShowAdd(false); setDetectUrl(''); }}
                className="px-3 py-1.5 text-sm text-[#545249] hover:text-[#33322c] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Sources table ──────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-[#33322c] border-r-transparent" />
          </div>
        ) : sources.length === 0 ? (
          <div className="text-center py-12 text-[#787569]">
            <Rss className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No sources configured yet</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#ede8d7] border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8]">Source</th>
                    <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8]">Type</th>
                    <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8] hidden lg:table-cell">Category</th>
                    <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8] hidden xl:table-cell">Notes</th>
                    <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8]">Active</th>
                    <th className="px-4 py-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map(s => {
                    const typeCfg = SOURCE_TYPE_CONFIG[s.source_type] ?? SOURCE_TYPE_CONFIG['manual'];
                    return (
                      <tr key={s.id} className={`border-b border-slate-200 hover:bg-[#ede8d7] transition-colors ${!s.active ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-[#111827]">{s.name}</div>
                          {s.url && (
                            <a href={s.url} target="_blank" rel="noreferrer"
                              className="text-xs text-[#0ea5e9] hover:underline flex items-center gap-0.5 mt-0.5">
                              {s.url.replace(/^https?:\/\//, '').substring(0, 45)}
                              <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-1.5 py-0.5 rounded text-xs font-semibold"
                            style={{ background: typeCfg.bg, color: typeCfg.color }}>
                            {typeCfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[#545249] text-xs hidden lg:table-cell">{s.category || '—'}</td>
                        <td className="px-4 py-3 text-[#545249] text-xs max-w-xs truncate hidden xl:table-cell">{s.notes || '—'}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => onToggle(s.id)} title={s.active ? 'Pause' : 'Activate'} className="transition-colors">
                            {s.active ? <ToggleRight className="w-5 h-5 text-[#10b981]" /> : <ToggleLeft className="w-5 h-5 text-[#c5c0ad]" />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => onDelete(s.id)} title="Remove"
                            className="p-1.5 rounded text-[#ef4444]/50 hover:text-[#ef4444] hover:bg-[#fef2f2] transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-[#f3f4f6]">
              {sources.map(s => {
                const typeCfg = SOURCE_TYPE_CONFIG[s.source_type] ?? SOURCE_TYPE_CONFIG['manual'];
                return (
                  <div key={s.id} className={`px-4 py-3 flex items-start gap-3 ${!s.active ? 'opacity-50' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="font-medium text-[#111827] text-sm">{s.name}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                          style={{ background: typeCfg.bg, color: typeCfg.color }}>
                          {typeCfg.label}
                        </span>
                      </div>
                      {s.category && <div className="text-xs text-[#545249]">{s.category}</div>}
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noreferrer"
                          className="text-xs text-[#0ea5e9] hover:underline flex items-center gap-0.5 mt-0.5 truncate">
                          {s.url.replace(/^https?:\/\//, '').substring(0, 40)}
                          <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => onToggle(s.id)}>
                        {s.active ? <ToggleRight className="w-5 h-5 text-[#10b981]" /> : <ToggleLeft className="w-5 h-5 text-[#c5c0ad]" />}
                      </button>
                      <button onClick={() => onDelete(s.id)}
                        className="p-1.5 rounded text-[#ef4444]/50 hover:text-[#ef4444] hover:bg-[#fef2f2] transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Brambles Strategic Fund Tab ──────────────────────────────────────────────

interface BramblesCompany {
  id: number;
  company_name: string;
  website?: string;
  one_liner?: string;
  employees?: number;
  founded_year?: number;
  hq?: string;
  funding_stage?: string;
  raised_usd_m?: number;
  tech_stack_layer?: string;
  relevant_process?: string;
  analyst_rationale?: string;
  analyst_tier?: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  tier?: number;
  tier_label?: string;
  composite_score?: number;
  strategic_rationale?: string;
  ic_memo_json?: any;
  pdf_memo_path?: string;
  pdf_appendix_path?: string;
  excel_path?: string;
  added_by?: string;
  created_at?: string;
}

const BRAMBLES_TIER_CONFIG: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: 'Tier 1 — Investable',         color: '#065f46', bg: '#d1fae5' },
  2: { label: 'Tier 2 — Monitor',            color: '#92400e', bg: '#fef3c7' },
  3: { label: 'Tier 3 — Commercial Partner', color: '#1e40af', bg: '#dbeafe' },
  4: { label: 'Tier 4 — Not Suitable',       color: '#991b1b', bg: '#fee2e2' },
};

const BRAMBLES_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: 'Pending',  color: '#92400e', bg: '#fef3c7' },
  running:  { label: 'Running',  color: '#1d4ed8', bg: '#dbeafe' },
  complete: { label: 'Complete', color: '#065f46', bg: '#d1fae5' },
  failed:   { label: 'Failed',   color: '#991b1b', bg: '#fee2e2' },
};

const BRAMBLES_BLANK_FORM = {
  company_name: '', website: '', one_liner: '', employees: '', founded_year: '',
  hq: '', funding_stage: '', raised_usd_m: '', tech_stack_layer: '',
  relevant_process: '', analyst_rationale: '', analyst_tier: '',
};

const QUERY_LABELS: Record<string, string> = {
  deployment: 'Deployment & Customers',
  funding:    'Funding & Investors',
  founders:   'Founders & Team',
  general:    'General / News',
};

function BramblesInlineScorecard({ company: c, tierConfig: tc }: { company: BramblesCompany; tierConfig: any }) {
  const [activeTab, setActiveTab] = useState<'research' | 'scorecard' | 'sources'>('research');
  const memo = c.ic_memo_json!;
  const enr  = memo.enrichment || {};
  const rubric   = memo.rubric_breakdown   || {};
  const fundFit  = memo.fund_fit_detail    || {};
  const sources: { query_type: string; label?: string; results: { title: string; url: string; snippet: string }[] }[]
    = enr.search_sources || [];

  const TABS = [
    { key: 'research',  label: 'Research'  },
    { key: 'scorecard', label: 'Scorecard' },
    { key: 'sources',   label: `Sources (${sources.reduce((n, s) => n + (s.results?.length || 0), 0)})` },
  ] as const;

  return (
    <div className="max-w-5xl">
      {/* Header strip */}
      <div className="flex items-center gap-3 mb-3">
        {tc && (
          <span className="px-3 py-1 rounded-lg text-sm font-bold" style={{ background: tc.bg, color: tc.color }}>
            {tc.label}
          </span>
        )}
        {c.composite_score != null && (
          <span className="text-sm text-slate-600">Score: <strong className="text-[#1e293b]">{c.composite_score}/100</strong></span>
        )}
        {memo.bottleneck_fit && (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#e8f0f5] text-[#1B3A4B] border border-[#1B3A4B]/20">
            {memo.bottleneck_fit.replace(/_/g, ' ')}
          </span>
        )}
        {(memo.theme_alignment || []).map((t: string) => (
          <span key={t} className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
            {t.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      {c.strategic_rationale && (
        <p className="text-sm text-slate-700 leading-relaxed mb-3 border-l-2 border-[#1B3A4B]/30 pl-3">
          {c.strategic_rationale}
        </p>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 mb-3 border-b border-slate-200">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-t transition-colors ${
              activeTab === tab.key
                ? 'bg-white border border-b-white border-slate-200 text-[#1B3A4B] -mb-px'
                : 'text-slate-500 hover:text-slate-700'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── RESEARCH TAB ── */}
      {activeTab === 'research' && (
        <div className="space-y-4">
          {enr.web_search_ran ? (
            <div className="grid grid-cols-2 gap-4">
              {/* Deployment */}
              <div className="col-span-2 p-3 rounded-lg bg-white border border-slate-200">
                <div className="text-[10px] font-semibold text-[#545249] uppercase mb-1">Deployment Evidence</div>
                {enr.deployment_evidence
                  ? <p className="text-xs text-slate-700 leading-relaxed">{enr.deployment_evidence}</p>
                  : <p className="text-xs text-slate-400 italic">No deployment evidence found</p>}
                <div className="flex items-center gap-2 mt-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${enr.has_live_deployment ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-slate-100 text-slate-500'}`}>
                    {enr.has_live_deployment ? '✓ Live deployment' : 'No deployment confirmed'}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${enr.has_signed_contracts ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-slate-100 text-slate-500'}`}>
                    {enr.has_signed_contracts ? '✓ Signed contracts' : 'No contracts confirmed'}
                  </span>
                </div>
              </div>

              {/* Customers */}
              <div className="p-3 rounded-lg bg-white border border-slate-200">
                <div className="text-[10px] font-semibold text-[#545249] uppercase mb-1">Customers</div>
                {enr.customer_names?.length > 0
                  ? <div className="flex flex-wrap gap-1">{enr.customer_names.map((n: string) => (
                      <span key={n} className="px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-800 border border-green-200">{n}</span>
                    ))}</div>
                  : <p className="text-xs text-slate-400 italic">None identified</p>}
              </div>

              {/* Founders */}
              <div className="p-3 rounded-lg bg-white border border-slate-200">
                <div className="text-[10px] font-semibold text-[#545249] uppercase mb-1">Founders</div>
                {enr.founder_names?.length > 0 && (
                  <div className="text-xs text-slate-700 font-medium mb-1">{enr.founder_names.join(', ')}</div>
                )}
                {enr.founder_background && (
                  <p className="text-xs text-slate-500 leading-relaxed mb-1.5">{enr.founder_background}</p>
                )}
                <div className="flex gap-1.5">
                  {enr.founder_supply_chain_experience && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#e8f0f5] text-[#1B3A4B]">SC experience</span>
                  )}
                  {enr.founder_prior_exits && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800">Prior exit</span>
                  )}
                </div>
              </div>

              {/* Key facts */}
              {enr.key_facts?.length > 0 && (
                <div className="col-span-2 p-3 rounded-lg bg-white border border-slate-200">
                  <div className="text-[10px] font-semibold text-[#545249] uppercase mb-1">Key Facts</div>
                  <div className="space-y-1">
                    {enr.key_facts.map((f: string, i: number) => (
                      <div key={i} className="text-xs text-slate-600 flex gap-1.5"><span className="text-slate-400 shrink-0">•</span>{f}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">Web enrichment did not run — scoring based on company list data only.</p>
          )}

          {/* Flags */}
          {memo.flags?.length > 0 && (
            <div className="space-y-1">
              {memo.flags.map((f: string, i: number) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
                  {f}
                </div>
              ))}
            </div>
          )}
          {memo.note && <p className="text-[10px] text-slate-400 italic">{memo.note}</p>}
        </div>
      )}

      {/* ── SCORECARD TAB ── */}
      {activeTab === 'scorecard' && (
        <div className="space-y-4">
          {/* Fund Fit */}
          <div className="p-3 rounded-lg bg-white border border-slate-200">
            <div className="text-[10px] font-semibold text-[#545249] uppercase mb-2">Fund Fit — $20M Strategic Fund</div>
            <div className="grid grid-cols-3 gap-2">
              {([['$1M check', 'check_1M'], ['$2.5M check', 'check_2.5M'], ['$5M check', 'check_5M']] as [string, string][]).map(([label, key]) => {
                const d = fundFit[key] || {};
                const pct = d.ownership_pct;
                const passes = d.passes_constraint;
                return (
                  <div key={key} className={`p-2 rounded border text-center ${passes === true ? 'bg-green-50 border-green-200' : passes === false ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="text-[10px] font-semibold text-slate-500 mb-0.5">{label}</div>
                    <div className="text-sm font-bold" style={{ color: passes === true ? '#1B6F3A' : passes === false ? '#C62828' : '#555' }}>
                      {pct != null ? `${pct.toFixed(1)}%` : 'Unknown'}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: passes === true ? '#1B6F3A' : passes === false ? '#C62828' : '#888' }}>
                      {passes === true ? '✓ Passes' : passes === false ? '✗ Fails' : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Scoring Rubric */}
          {Object.keys(rubric).length > 0 && (
            <div className="p-3 rounded-lg bg-white border border-slate-200">
              <div className="text-[10px] font-semibold text-[#545249] uppercase mb-2">Scoring Rubric</div>
              <div className="space-y-2">
                {Object.entries(rubric).map(([dim, data]: [string, any]) => {
                  const sc  = data.score ?? 0;
                  const mx  = data.max   ?? 0;
                  const pct = mx ? Math.round((sc / mx) * 100) : 0;
                  const col = pct >= 70 ? '#1B6F3A' : pct >= 40 ? '#E65100' : '#C62828';
                  return (
                    <div key={dim}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs text-slate-700 font-medium">{dim.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                        <span className="text-xs font-bold" style={{ color: col }}>{sc}/{mx}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: col }} />
                      </div>
                      {data.notes?.length > 0 && (
                        <p className="text-[10px] text-slate-500 mt-0.5">{data.notes.join(' · ')}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SOURCES TAB ── */}
      {activeTab === 'sources' && (
        <div className="space-y-3">
          {sources.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No sources captured — re-run analysis to populate.</p>
          ) : sources.map(section => {
            const label = QUERY_LABELS[section.query_type] || section.label || section.query_type;
            const results = section.results || [];
            return (
              <div key={section.query_type} className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ background: '#1B3A4B' }}>
                  {label}
                </div>
                {results.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400 italic">No results returned.</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {results.map((src, i) => (
                      <div key={i} className={`px-3 py-2 ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}`}>
                        <a href={src.url} target="_blank" rel="noopener noreferrer"
                          className="text-xs font-semibold text-[#1A4C7C] hover:underline leading-snug block mb-0.5">
                          {src.title}
                        </a>
                        <div className="text-[10px] text-slate-400 mb-1 truncate">{src.url}</div>
                        {src.snippet && <p className="text-[11px] text-slate-600 leading-relaxed">{src.snippet}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BramblesTab() {
  const navigate = useNavigate();
  const [companies, setCompanies]     = useState<BramblesCompany[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showAdd, setShowAdd]         = useState(false);
  const [form, setForm]               = useState({ ...BRAMBLES_BLANK_FORM });
  const [adding, setAdding]           = useState(false);
  const [addError, setAddError]       = useState('');
  const [running, setRunning]         = useState<Record<number, boolean>>({});
  const [deleting, setDeleting]       = useState<number | null>(null);
  const [expandedId, setExpandedId]   = useState<number | null>(null);
  const [pollTimer, setPollTimer]     = useState<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/brambles/companies', { headers: AUTH });
      if (r.ok) setCompanies(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll while any company is running
  useEffect(() => {
    const hasRunning = companies.some(c => c.status === 'running');
    if (hasRunning && !pollTimer) {
      const t = setInterval(load, 4000);
      setPollTimer(t);
    } else if (!hasRunning && pollTimer) {
      clearInterval(pollTimer);
      setPollTimer(null);
    }
    return () => { if (pollTimer) clearInterval(pollTimer); };
  }, [companies, pollTimer, load]);

  const handleAdd = async () => {
    if (!form.company_name.trim()) return;
    setAdding(true); setAddError('');
    try {
      const body: Record<string, any> = { company_name: form.company_name.trim() };
      if (form.website)          body.website          = form.website.trim();
      if (form.one_liner)        body.one_liner        = form.one_liner.trim();
      if (form.employees)        body.employees        = parseInt(form.employees);
      if (form.founded_year)     body.founded_year     = parseInt(form.founded_year);
      if (form.hq)               body.hq               = form.hq.trim();
      if (form.funding_stage)    body.funding_stage    = form.funding_stage.trim();
      if (form.raised_usd_m)     body.raised_usd_m     = parseFloat(form.raised_usd_m);
      if (form.tech_stack_layer) body.tech_stack_layer = form.tech_stack_layer.trim();
      if (form.relevant_process) body.relevant_process = form.relevant_process.trim();
      if (form.analyst_rationale)body.analyst_rationale= form.analyst_rationale.trim();
      if (form.analyst_tier)     body.analyst_tier     = form.analyst_tier.trim();
      const r = await fetch('/brambles/companies', {
        method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).detail || 'Failed');
      setForm({ ...BRAMBLES_BLANK_FORM });
      setShowAdd(false);
      load();
    } catch (e: any) {
      setAddError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleRun = async (id: number) => {
    setRunning(prev => ({ ...prev, [id]: true }));
    try {
      await fetch(`/brambles/companies/${id}/run`, { method: 'POST', headers: AUTH });
      load();
    } finally {
      setRunning(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      await fetch(`/brambles/companies/${id}`, { method: 'DELETE', headers: AUTH });
      setCompanies(prev => prev.filter(c => c.id !== id));
      if (expandedId === id) setExpandedId(null);
    } finally {
      setDeleting(null);
    }
  };

  const tierCfg = (tier?: number) => tier ? (BRAMBLES_TIER_CONFIG[tier] ?? { label: `Tier ${tier}`, color: '#64748b', bg: '#f1f5f9' }) : null;
  const statusCfg = (status: string) => BRAMBLES_STATUS_CONFIG[status] ?? { label: status, color: '#64748b', bg: '#f1f5f9' };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Briefcase className="w-5 h-5" style={{ color: '#1B3A4B' }} />
              <h2 className={cls.sectionTitle}>Brambles Strategic Fund — DD Pipeline</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed max-w-2xl">
              Web-first due diligence for the Brambles Strategic Fund. Runs a deterministic tiering engine
              against Plant of the Future bottlenecks and 6 Brambles investment themes — no dataroom required.
              Outputs a tier assignment (1–4), composite score, and strategic rationale from company-list data alone.
            </p>
            <div className="flex items-center gap-6 mt-3 text-xs text-slate-500">
              <span><span className="font-semibold text-[#065f46]">Tier 1</span> — Investable (Series A–C, strong theme fit)</span>
              <span><span className="font-semibold text-[#92400e]">Tier 2</span> — Monitor (Seed or partial fit)</span>
              <span><span className="font-semibold text-[#1e40af]">Tier 3</span> — Commercial Partner (too mature)</span>
              <span><span className="font-semibold text-[#991b1b]">Tier 4</span> — Not Suitable</span>
            </div>
          </div>
          <button
            onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors shrink-0"
            style={{ background: '#1B3A4B', color: 'white' }}
          >
            <Plus className="w-4 h-4" />
            Add Company
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <div className="mt-5 pt-5 border-t border-slate-200">
            <h3 className="text-sm font-semibold text-[#33322c] mb-4">Add Company to Pipeline</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Company Name *</label>
                <input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
                  placeholder="e.g. Anyware Robotics" className={cls.inputFull} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Website</label>
                <input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                  placeholder="https://..." className={cls.inputFull} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">HQ</label>
                <input value={form.hq} onChange={e => setForm(f => ({ ...f, hq: e.target.value }))}
                  placeholder="e.g. San Francisco, CA" className={cls.inputFull} />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">One-liner</label>
                <input value={form.one_liner} onChange={e => setForm(f => ({ ...f, one_liner: e.target.value }))}
                  placeholder="Brief company description" className={cls.inputFull} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Funding Stage</label>
                <select value={form.funding_stage} onChange={e => setForm(f => ({ ...f, funding_stage: e.target.value }))} className={cls.select}>
                  <option value="">— select —</option>
                  {['Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Series D+', 'Growth', 'Public'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Raised (USD M)</label>
                <input type="number" value={form.raised_usd_m} onChange={e => setForm(f => ({ ...f, raised_usd_m: e.target.value }))}
                  placeholder="e.g. 25" className={cls.inputFull} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Employees</label>
                <input type="number" value={form.employees} onChange={e => setForm(f => ({ ...f, employees: e.target.value }))}
                  placeholder="e.g. 80" className={cls.inputFull} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Founded Year</label>
                <input type="number" value={form.founded_year} onChange={e => setForm(f => ({ ...f, founded_year: e.target.value }))}
                  placeholder="e.g. 2019" className={cls.inputFull} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Tech Stack Layer</label>
                <input value={form.tech_stack_layer} onChange={e => setForm(f => ({ ...f, tech_stack_layer: e.target.value }))}
                  placeholder="e.g. Hardware + Software" className={cls.inputFull} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Relevant Process (POTF)</label>
                <select value={form.relevant_process} onChange={e => setForm(f => ({ ...f, relevant_process: e.target.value }))} className={cls.select}>
                  <option value="">— select —</option>
                  {['Inbound', 'Grading', 'Repair', 'Storage', 'Outbound', 'Intelligence'].map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Analyst Tier</label>
                <select value={form.analyst_tier} onChange={e => setForm(f => ({ ...f, analyst_tier: e.target.value }))} className={cls.select}>
                  <option value="">— select —</option>
                  {['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Analyst Rationale</label>
                <textarea value={form.analyst_rationale} onChange={e => setForm(f => ({ ...f, analyst_rationale: e.target.value }))}
                  rows={2} placeholder="Why is this company relevant to Brambles?" className={`${cls.inputFull} resize-none`} />
              </div>
            </div>
            {addError && <p className="text-red-600 text-xs mt-2">{addError}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={handleAdd} disabled={adding || !form.company_name.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                style={{ background: '#1B3A4B', color: 'white' }}>
                {adding ? 'Adding…' : 'Add to Pipeline'}
              </button>
              <button onClick={() => { setShowAdd(false); setForm({ ...BRAMBLES_BLANK_FORM }); setAddError(''); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Company table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B3A4B]" />
          </div>
        ) : companies.length === 0 ? (
          <div className="text-center py-12 text-[#787569]">
            <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No companies in the pipeline yet. Add the first one above.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#ede8d7] border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#545249] uppercase">Company</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#545249] uppercase">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#545249] uppercase">Process</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#545249] uppercase">Analyst Tier</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#545249] uppercase">Engine Tier</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#545249] uppercase">Score</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#545249] uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#545249] uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map(c => {
                const sc  = statusCfg(c.status);
                const tc  = tierCfg(c.tier);
                const isExpanded = expandedId === c.id;
                return (
                  <>
                    <tr key={c.id}
                      className={`transition-colors ${c.status === 'complete' ? 'cursor-pointer hover:bg-[#eef3f7]' : 'hover:bg-[#fafaf9]'}`}
                      onClick={c.status === 'complete' ? () => navigate(`/brambles/review/${c.id}`) : undefined}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#1e293b]">{c.company_name}</div>
                        {c.one_liner && <div className="text-xs text-slate-500 mt-0.5 max-w-xs truncate">{c.one_liner}</div>}
                        {c.website && (
                          <a href={c.website} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-[#1B3A4B] flex items-center gap-0.5 mt-0.5 hover:underline">
                            <Globe className="w-2.5 h-2.5" />{c.website.replace(/^https?:\/\//, '')}
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {c.funding_stage || '—'}
                        {c.raised_usd_m != null && <div className="text-slate-400">${c.raised_usd_m}M raised</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{c.relevant_process || '—'}</td>
                      <td className="px-4 py-3">
                        {c.analyst_tier
                          ? <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700">{c.analyst_tier}</span>
                          : <span className="text-slate-400 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {tc
                          ? <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: tc.bg, color: tc.color }}>{tc.label}</span>
                          : <span className="text-slate-400 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {c.composite_score != null
                          ? <span className="font-semibold text-[#1e293b]">{c.composite_score}<span className="text-slate-400 font-normal">/100</span></span>
                          : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: sc.bg, color: sc.color }}>
                          {c.status === 'running'
                            ? <span className="flex items-center gap-1"><Loader className="w-2.5 h-2.5 animate-spin" />{sc.label}</span>
                            : sc.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {(c.status === 'pending' || c.status === 'failed') && (
                            <button onClick={() => handleRun(c.id)} disabled={running[c.id]}
                              title="Run Analysis"
                              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-colors disabled:opacity-50"
                              style={{ background: '#1B3A4B', color: 'white' }}>
                              <Play className="w-3 h-3" />
                              {running[c.id] ? 'Queuing…' : 'Run'}
                            </button>
                          )}
                          {c.excel_path && (
                            <a href={`/brambles/companies/${c.id}/download/scorecard`} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              title="Download Scorecard XLSX"
                              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-green-50 text-green-800 border border-green-200 hover:bg-green-100 transition-colors">
                              <Download className="w-2.5 h-2.5" />XLS
                            </a>
                          )}
                          {c.status === 'complete' && (
                            <button onClick={e => { e.stopPropagation(); navigate(`/brambles/review/${c.id}`); }}
                              title="Open analyst review"
                              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-[#e8f0f5] text-[#1B3A4B] border border-[#1B3A4B]/20 hover:bg-[#d8e8f0] transition-colors">
                              <ExternalLink className="w-2.5 h-2.5" />Review
                            </button>
                          )}
                          <button onClick={e => { e.stopPropagation(); handleDelete(c.id); }} disabled={deleting === c.id}
                            title="Remove from pipeline"
                            className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function EnrichmentQueue() {
  const navigate = useNavigate();
  const [stats, setStats]         = useState<Stats | null>(null);
  const [tab, setTab]             = useState<'pending' | 'human_review' | 'failed' | 'enriched' | 'requests' | 'intelligence' | 'methodology' | 'brambles'>('pending');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading]     = useState(true);
  const [retrying, setRetrying]   = useState<number | null>(null);
  const [pendingEditId, setPendingEditId] = useState<number | null>(null);
  const [pendingEditFields, setPendingEditFields] = useState<{ name: string; website: string; sector: string; stage: string }>({ name: '', website: '', sector: '', stage: '' });
  const [pendingSaving, setPendingSaving] = useState(false);
  const [pendingDeleting, setPendingDeleting] = useState<number | null>(null);
  const [toast, setToast]         = useState<string | null>(null);
  const [requests, setRequests]   = useState<EnrichmentTask[]>([]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null); // company_id
  const [ddFiles, setDdFiles] = useState<Record<number, { name: string; size: number; modified: string }[]>>({});
  const [ddUploading, setDdUploading] = useState<number | null>(null);
  const [ddTriggering, setDdTriggering] = useState<number | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editPriority, setEditPriority] = useState('');
  const [ddStatus, setDdStatus] = useState<Record<number, DDPipelineStatus>>({});
  const [ddOverview, setDdOverview] = useState<Record<number, DDOverview>>({});
  const [ddAgents, setDdAgents] = useState<Record<number, any[]>>({});
  const [ddRouting, setDdRouting] = useState<Record<number, RoutingData>>({});
  const [ddRoutingEdits, setDdRoutingEdits] = useState<Record<number, Record<string, string[]>>>({});
  const [ddRoutingSaving, setDdRoutingSaving] = useState<number | null>(null);
  const [ddPanelTab, setDdPanelTab] = useState<Record<number, 'routing' | 'upload'>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Intel Briefing sources
  const [sources, setSources]             = useState<BriefingSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSource, setNewSource]         = useState({ name: '', url: '', source_type: 'rss', category: '', notes: '' });
  const [addingSource, setAddingSource]   = useState(false);
  const [detectUrl, setDetectUrl]         = useState('');
  const [detecting, setDetecting]         = useState(false);
  const [detectNote, setDetectNote]       = useState('');

  // Cron jobs
  const [cronJobs, setCronJobs]           = useState<CronJob[]>([]);
  const [cronOpen, setCronOpen]           = useState(true);
  const [editingCron, setEditingCron]     = useState<number | null>(null);
  const [cronEdits, setCronEdits]         = useState<Partial<CronJob>>({});

  // Human review — intel suggestions
  const [intelSuggestions, setIntelSuggestions] = useState<IntelSuggestion[]>([]);
  const [intelSuggestionsLoading, setIntelSuggestionsLoading] = useState(false);
  const [actioning, setActioning]               = useState<number | null>(null);

  const loadSuggestions = useCallback(async () => {
    setIntelSuggestionsLoading(true);
    try {
      const r = await fetch('/admin/suggestions?suggestion_type=new_funding_round,case_study&status=pending', { headers: AUTH });
      if (r.ok) setIntelSuggestions(await r.json());
    } finally {
      setIntelSuggestionsLoading(false);
    }
  }, []);

  const approveSuggestion = async (id: number, sourceOverride?: string) => {
    setActioning(id);
    try {
      const r = await fetch(`/admin/suggestions/${id}/approve`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: sourceOverride ? JSON.stringify({ source_url: sourceOverride }) : '{}',
      });
      if (r.ok) setIntelSuggestions(prev => prev.filter(s => s.id !== id));
    } finally {
      setActioning(null);
    }
  };

  const rejectSuggestion = async (id: number) => {
    setActioning(id);
    try {
      const r = await fetch(`/admin/suggestions/${id}/reject`, { method: 'POST', headers: AUTH });
      if (r.ok) setIntelSuggestions(prev => prev.filter(s => s.id !== id));
    } finally {
      setActioning(null);
    }
  };

  const loadDdFiles = useCallback(async (companyId: number) => {
    const r = await fetch(`/admin/dd/${companyId}/files`, { headers: AUTH });
    if (r.ok) {
      const data = await r.json();
      setDdFiles(prev => ({ ...prev, [companyId]: data.files ?? [] }));
    }
  }, []);

  const loadDdStatus = useCallback(async (companyId: number) => {
    const r = await fetch(`/admin/dd/${companyId}/status`, { headers: AUTH });
    if (r.ok) {
      const data: DDPipelineStatus = await r.json();
      setDdStatus(prev => ({ ...prev, [companyId]: data }));
      return data;
    }
  }, []);

  const loadDdOverview = useCallback(async (companyId: number) => {
    const r = await fetch(`/admin/dd/${companyId}/overview`, { headers: AUTH });
    if (r.ok) { const data = await r.json(); setDdOverview(prev => ({ ...prev, [companyId]: data })); }
  }, []);

  const loadDdAgents = useCallback(async (companyId: number) => {
    const r = await fetch(`/admin/dd/${companyId}/agents`, { headers: AUTH });
    if (r.ok) {
      const data = await r.json();
      setDdAgents(prev => ({ ...prev, [companyId]: data.agents ?? [] }));
    }
  }, []);

  const loadDdRouting = useCallback(async (companyId: number) => {
    const r = await fetch(`/admin/dd/${companyId}/routing`, { headers: AUTH });
    if (r.ok) {
      const data: RoutingData = await r.json();
      setDdRouting(prev => ({ ...prev, [companyId]: data }));
      // Seed edits from current state
      const editSeed: Record<string, string[]> = {};
      if (data.has_manifest) {
        data.groups.forEach(g => { editSeed[g.group] = [...g.agents]; });
      } else {
        data.files.forEach(f => { editSeed[f.name] = [...f.agents]; });
      }
      setDdRoutingEdits(prev => ({ ...prev, [companyId]: editSeed }));
    }
  }, []);

  const saveDdRouting = async (companyId: number) => {
    const edits = ddRoutingEdits[companyId];
    if (!edits) return;
    setDdRoutingSaving(companyId);
    try {
      const r = await fetch(`/admin/dd/${companyId}/routing`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ routing: edits }),
      });
      if (r.ok) {
        await loadDdRouting(companyId);
        showToast('Routing saved');
      }
    } finally {
      setDdRoutingSaving(null);
    }
  };

  const resetDdRouting = async (companyId: number) => {
    const r = await fetch(`/admin/dd/${companyId}/routing`, { method: 'DELETE', headers: AUTH });
    if (r.ok) {
      await loadDdRouting(companyId);
      showToast('Routing reset to auto');
    }
  };

  const toggleRoutingAgent = (companyId: number, group: string, agent: string) => {
    setDdRoutingEdits(prev => {
      const current = prev[companyId]?.[group] ?? [];
      const next = current.includes(agent)
        ? current.filter(a => a !== agent)
        : [...current, agent];
      return { ...prev, [companyId]: { ...prev[companyId], [group]: next } };
    });
  };

  const handleDdUpload = async (companyId: number, files: FileList) => {
    if (!files.length) return;
    setDdUploading(companyId);
    try {
      const form = new FormData();
      Array.from(files).forEach(f => form.append('files', f));
      const r = await fetch(`/admin/dd/${companyId}/upload`, {
        method: 'POST',
        headers: AUTH,
        body: form,
      });
      if (r.ok) {
        await loadDdFiles(companyId);
        showToast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`);
      }
    } finally {
      setDdUploading(null);
    }
  };

  const handleDdTrigger = async (companyId: number, companyName: string, mode: 'full' | 'research' | 'ingest') => {
    setDdTriggering(companyId);
    try {
      const r = await fetch(`/admin/dd/${companyId}/trigger?mode=${mode}`, {
        method: 'POST', headers: AUTH,
      });
      if (r.ok) {
        const msgs: Record<string, string> = {
          full:     `Full DD pipeline queued for ${companyName} — requires your approval`,
          research: `Research task queued for ${companyName}`,
          ingest:   `${companyName} files confirmed in ingestion queue`,
        };
        showToast(msgs[mode]);
        loadRequests();
      }
    } finally {
      setDdTriggering(null);
    }
  };

  const handleDeleteRequest = async (req: EnrichmentTask, rowKey: string) => {
    if (!confirm(`Remove "${req.company_name}" from the Requests list?`)) return;
    setDeletingKey(rowKey);
    try {
      const url = req.task_id
        ? `/admin/requests/task/${req.task_id}`
        : `/admin/requests/4d/${req.company_id}`;
      const r = await fetch(url, { method: 'DELETE', headers: AUTH });
      if (r.ok) {
        await loadRequests();
        showToast(`${req.company_name} removed`);
      }
    } finally {
      setDeletingKey(null);
    }
  };

  const saveEditRequest = async (taskId: number) => {
    const r = await fetch(`/admin/requests/task/${taskId}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: editPriority }),
    });
    if (r.ok) {
      setRequests(prev => prev.map(req =>
        req.task_id === taskId ? { ...req, status: req.status } : req
      ));
      showToast('Request updated');
      loadRequests();
    }
    setEditingTaskId(null);
  };

  const toggleExpand = async (companyId: number) => {
    if (expandedRow === companyId) {
      setExpandedRow(null);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    setExpandedRow(companyId);
    loadDdFiles(companyId);
    loadDdRouting(companyId);
    const status = await loadDdStatus(companyId);
    if (status?.status === 'complete') {
      loadDdOverview(companyId);
      loadDdAgents(companyId);
    } else if (status?.status === 'running' || status?.status === 'ingested') {
      // Poll every 12s until complete
      pollRef.current = setInterval(async () => {
        const s = await loadDdStatus(companyId);
        if (s?.status === 'complete') {
          loadDdOverview(companyId);
          loadDdAgents(companyId);
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      }, 12000);
    }
  };

  // Enrichment form
  const [selectedMode, setSelectedMode] = useState<'4d' | 'industrial' | 'dd' | 'funding' | 'news' | 'founder' | null>(null);
  const [addName, setAddName]           = useState('');
  const [addWebsite, setAddWebsite]     = useState('');
  const [addCompanyId, setAddCompanyId] = useState<number | null>(null);
  const [addNewsUrls, setAddNewsUrls]   = useState('');
  const [addFiles, setAddFiles]         = useState<File[]>([]);
  const [addDragging, setAddDragging]   = useState(false);
  const [addFileRouting, setAddFileRouting] = useState<Record<string, string[]>>({});
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError]         = useState('');
  const addFileInputRef = useRef<HTMLInputElement>(null);

  // DD two-step upload flow
  const [ddUploadState, setDdUploadState] = useState<'idle' | 'uploading' | 'ready'>('idle');
  const [ddReadyCompanyId, setDdReadyCompanyId] = useState<number | null>(null);
  const [ddAutoIngest, setDdAutoIngest] = useState(false);


  // Quick Add by URL (autofill into form)
  const [urlInput, setUrlInput]       = useState('');
  const [urlLoading, setUrlLoading]   = useState(false);
  const [urlError, setUrlError]       = useState('');
  const [urlSuccess, setUrlSuccess]   = useState(false);

  // Quick Add card — standalone add by URL without opening the form
  const [qaUrl, setQaUrl]             = useState('');
  const [qaLoading, setQaLoading]     = useState(false);
  const [qaMsg, setQaMsg]             = useState('');
  const [qaIsError, setQaIsError]     = useState(false);

  const handleQuickAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qaUrl.trim()) return;
    setQaLoading(true);
    setQaMsg('');
    setQaIsError(false);
    try {
      const res = await fetch('/admin/quickadd', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: qaUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
      // Navigate to the company profile — the enrichment panel will auto-open
      navigate(`/company/${data.company_id}`);
    } catch (err: any) {
      setQaMsg(err.message || 'Failed to add company');
      setQaIsError(true);
      setQaLoading(false);
    }
  };

  const handleUrlAutofill = async () => {
    if (!urlInput.trim()) return;
    setUrlLoading(true);
    setUrlError('');
    setUrlSuccess(false);
    try {
      const res = await fetch('/admin/quickadd', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Error ${res.status}`);
      }
      const data = await res.json();
      setAddName(data.name || '');
      setAddWebsite(urlInput.trim());
      setAddCompanyId(data.company_id ?? null);
      setUrlSuccess(true);
    } catch (e: any) {
      setUrlError(e.message);
    } finally {
      setUrlLoading(false);
    }
  };

  // Typeahead
  const [suggestions, setSuggestions]   = useState<{ id: number; name: string; sector?: string; website?: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const handleNameChange = (val: string) => {
    setAddName(val);
    setAddCompanyId(null); // clear selection when user edits
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (val.trim().length < 2) { setSuggestions([]); setShowSuggestions(false); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/companies?q=${encodeURIComponent(val.trim())}&limit=8&name_only=true`, { headers: AUTH });
        if (r.ok) {
          const data = await r.json();
          const list = Array.isArray(data) ? data : (data.companies ?? []);
          setSuggestions(list.map((c: any) => ({ id: c.id, name: c.name, sector: c.sector, website: c.website })));
          setShowSuggestions(true);
        }
      } catch { /* silent */ }
    }, 250);
  };

  const selectSuggestion = (s: { id: number; name: string; sector?: string; website?: string }) => {
    setAddName(s.name);
    setAddCompanyId(s.id);
    if (s.website && !addWebsite) setAddWebsite(s.website);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const clearSelection = () => {
    setAddName(''); setAddWebsite(''); setAddCompanyId(null);
    setSuggestions([]); setShowSuggestions(false);
  };

  const resetForm = () => {
    clearSelection();
    setAddNewsUrls('');
    setAddFiles([]);
    setAddFileRouting({});
    setAddError('');
    setDdUploadState('idle');
    setDdReadyCompanyId(null);
    setDdAutoIngest(false);
  };

  const selectMode = (mode: typeof selectedMode) => {
    if (selectedMode === mode) { setSelectedMode(null); resetForm(); }
    else {
      setSelectedMode(mode);
      resetForm();
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault(); setAddDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    const newFiles = dropped.filter(f => !addFiles.find(p => p.name === f.name));
    setAddFiles(prev => [...prev, ...newFiles]);
    setAddFileRouting(prev => {
      const next = { ...prev };
      newFiles.forEach(f => { if (!next[f.name]) next[f.name] = [...DD_AGENTS]; });
      return next;
    });
  };

  const handleAddFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const picked = Array.from(e.target.files);
    const newFiles = picked.filter(f => !addFiles.find(p => p.name === f.name));
    setAddFiles(prev => [...prev, ...newFiles]);
    setAddFileRouting(prev => {
      const next = { ...prev };
      newFiles.forEach(f => { if (!next[f.name]) next[f.name] = [...DD_AGENTS]; });
      return next;
    });
    e.target.value = '';
  };

  const toggleAddFileAgent = (filename: string, agent: string) => {
    setAddFileRouting(prev => {
      const current = prev[filename] ?? [...DD_AGENTS];
      const next = current.includes(agent) ? current.filter(a => a !== agent) : [...current, agent];
      return { ...prev, [filename]: next };
    });
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadStats = useCallback(async () => {
    const r = await fetch('/admin/enrichment-realstats', { headers: AUTH });
    if (r.ok) setStats(await r.json());
  }, []);

  const loadCompanies = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/admin/enrichment-list?status=${status}&limit=100`, { headers: AUTH });
      if (r.ok) setCompanies(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/admin/requests', { headers: AUTH });
      if (r.ok) {
        const data = await r.json();
        const tasks: EnrichmentTask[] = (data.tasks ?? []).map((t: any) => ({
          task_id: t.task_id,
          enrichment_type: t.enrichment_type as 'industrial' | 'dd',
          company_id: t.company_id,
          company_name: t.company_name,
          sector: t.sector,
          status: t.status,
          created_at: t.created_at,
        }));
        const pending4d: EnrichmentTask[] = (data.pending_4d ?? []).map((t: any) => ({
          enrichment_type: '4d' as const,
          company_id: t.company_id,
          company_name: t.company_name,
          sector: t.sector,
          status: 'pending',
          created_at: t.created_at,
        }));
        setRequests(
          [...tasks, ...pending4d].sort((a, b) =>
            (b.created_at ?? '').localeCompare(a.created_at ?? '')
          )
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const r = await fetch('/intelligence/sources', { headers: AUTH });
      if (r.ok) setSources(await r.json());
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  const loadCronJobs = useCallback(async () => {
    const r = await fetch('/intelligence/cron', { headers: AUTH });
    if (r.ok) setCronJobs(await r.json());
  }, []);

  const handleDetect = async () => {
    if (!detectUrl.trim()) return;
    setDetecting(true);
    setDetectNote('');
    try {
      const r = await fetch('/intelligence/sources/detect', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: detectUrl }),
      });
      if (r.ok) {
        const d = await r.json();
        setNewSource(prev => ({
          ...prev,
          url: d.url || detectUrl,
          source_type: d.source_type || 'newsletter',
          name: d.name || prev.name,
        }));
        setDetectNote(d.note || '');
        setShowAddSource(true);
      }
    } finally {
      setDetecting(false);
    }
  };

  const handleSaveCron = async (id: number) => {
    const r = await fetch(`/intelligence/cron/${id}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify(cronEdits),
    });
    if (r.ok) {
      setCronJobs(prev => prev.map(j => j.id === id ? { ...j, ...cronEdits } : j));
      setEditingCron(null);
      setCronEdits({});
    }
  };

  const handleToggleCron = async (id: number, current: boolean) => {
    const r = await fetch(`/intelligence/cron/${id}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !current }),
    });
    if (r.ok) setCronJobs(prev => prev.map(j => j.id === id ? { ...j, active: !current } : j));
  };

  const handleAddSource = async () => {
    if (!newSource.name.trim()) return;
    setAddingSource(true);
    try {
      const r = await fetch('/intelligence/sources', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(newSource),
      });
      if (r.ok) {
        const created = await r.json();
        setSources(prev => [...prev, created]);
        setNewSource({ name: '', url: '', source_type: 'rss', category: '', notes: '' });
        setShowAddSource(false);
      }
    } finally {
      setAddingSource(false);
    }
  };

  const handleToggleSource = async (id: number) => {
    const r = await fetch(`/intelligence/sources/${id}/toggle`, { method: 'PATCH', headers: AUTH });
    if (r.ok) {
      const { active } = await r.json();
      setSources(prev => prev.map(s => s.id === id ? { ...s, active } : s));
    }
  };

  const handleDeleteSource = async (id: number) => {
    if (!confirm('Remove this source?')) return;
    const r = await fetch(`/intelligence/sources/${id}`, { method: 'DELETE', headers: AUTH });
    if (r.ok) setSources(prev => prev.filter(s => s.id !== id));
  };

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => {
    if (tab === 'methodology') return;
    if (tab === 'brambles') return;
    if (tab === 'intelligence') { loadSources(); loadCronJobs(); return; }
    if (tab === 'human_review') { loadSuggestions(); return; }
    if (tab === 'requests') loadRequests();
    else loadCompanies(tab);
  }, [tab, loadCompanies, loadRequests, loadSources, loadCronJobs, loadSuggestions]);

  const handleRetry = async (id: number, name: string) => {
    setRetrying(id);
    try {
      const r = await fetch(`/admin/enrichment-retry/${id}`, { method: 'POST', headers: AUTH });
      if (r.ok) {
        setCompanies(prev => prev.filter(c => c.id !== id));
        loadStats();
        showToast(`${name} queued for retry`);
      }
    } finally {
      setRetrying(null);
    }
  };

  const startPendingEdit = (c: Company) => {
    setPendingEditId(c.id);
    setPendingEditFields({ name: c.name, website: c.website ?? '', sector: c.sector ?? '', stage: c.stage ?? '' });
  };

  const savePendingEdit = async () => {
    if (!pendingEditId) return;
    setPendingSaving(true);
    try {
      const r = await fetch(`/admin/enrichment-pending/${pendingEditId}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingEditFields),
      });
      if (r.ok) {
        setCompanies(prev => prev.map(c => c.id === pendingEditId ? { ...c, ...pendingEditFields } : c));
        setPendingEditId(null);
        showToast('Company updated');
      }
    } finally {
      setPendingSaving(false);
    }
  };

  const deletePending = async (c: Company) => {
    setPendingDeleting(c.id);
    try {
      const r = await fetch(`/admin/enrichment-pending/${c.id}`, { method: 'DELETE', headers: AUTH });
      if (r.ok) {
        setCompanies(prev => prev.filter(p => p.id !== c.id));
        loadStats();
        showToast(`${c.name} removed from queue`);
      }
    } finally {
      setPendingDeleting(null);
    }
  };

  const submitAdd = async () => {
    if (!addName.trim()) { setAddError('Company name is required.'); return; }
    if (!selectedMode) { setAddError('Select an enrichment type.'); return; }
    setAddSubmitting(true);
    setAddError('');
    try {
      // Build notes from news URLs
      const newsLines = addNewsUrls.trim().split('\n').map(l => l.trim()).filter(Boolean);
      const notes = newsLines.length > 0 ? `News URLs:\n${newsLines.join('\n')}` : null;

      const res = await fetch('/admin/add-company', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addName.trim(),
          website: addWebsite.trim() || null,
          company_id: addCompanyId ?? undefined,
          run_4d: selectedMode === '4d',
          run_industrial: selectedMode === 'industrial',
          run_dd: selectedMode === 'dd',
          run_funding: selectedMode === 'funding',
          run_news: selectedMode === 'news',
          run_founder: selectedMode === 'founder',
          notes,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server error ${res.status}`);
      }
      const { company_id: newCompanyId } = await res.json();

      // Upload staged files if any
      if (addFiles.length > 0 && newCompanyId) {
        for (const file of addFiles) {
          const fd = new FormData();
          fd.append('file', file);
          await fetch(`/admin/dd/${newCompanyId}/upload`, { method: 'POST', headers: AUTH, body: fd });
        }
        // Save routing override if DD mode
        if (selectedMode === 'dd') {
          const routingPayload: Record<string, string[]> = {};
          addFiles.forEach(f => { routingPayload[f.name] = addFileRouting[f.name] ?? [...DD_AGENTS]; });
          await fetch(`/admin/dd/${newCompanyId}/routing`, {
            method: 'POST',
            headers: { ...AUTH, 'Content-Type': 'application/json' },
            body: JSON.stringify({ routing: routingPayload }),
          });
        }
      }

      const saved = addName.trim();
      resetForm();
      setSelectedMode(null);
      loadStats();
      if (tab !== 'methodology') loadCompanies(tab);
      showToast(`${saved} queued for ${
        selectedMode === 'dd' ? 'DD pipeline' :
        selectedMode === 'industrial' ? 'industrial enrichment' :
        selectedMode === 'funding' ? 'funding enrichment' :
        selectedMode === 'news' ? 'news & case studies' :
        selectedMode === 'founder' ? 'founder research' :
        '4D enrichment'
      }`);
    } catch (e: any) {
      setAddError(e.message);
    } finally {
      setAddSubmitting(false);
    }
  };

  // DD Step 1 — upload files and save routing, then show Start DD button
  const handleDdFormUpload = async () => {
    if (!addName.trim()) { setAddError('Company name is required.'); return; }
    if (addFiles.length === 0) { setAddError('Upload at least one dataroom file.'); return; }
    setDdUploadState('uploading');
    setAddError('');
    try {
      // Create/find company record (no pipeline trigger)
      const res = await fetch('/admin/add-company', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addName.trim(),
          website: addWebsite.trim() || null,
          company_id: addCompanyId ?? undefined,
          run_dd: false,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server error ${res.status}`);
      }
      const { company_id: newCompanyId } = await res.json();

      // Upload files
      for (const file of addFiles) {
        const fd = new FormData();
        fd.append('file', file);
        const uploadRes = await fetch(`/admin/dd/${newCompanyId}/upload`, { method: 'POST', headers: AUTH, body: fd });
        if (!uploadRes.ok) throw new Error(`Failed to upload ${file.name}`);
      }

      // Save routing override only when analyst has specified routing manually
      if (!ddAutoIngest) {
        const routingPayload: Record<string, string[]> = {};
        addFiles.forEach(f => { routingPayload[f.name] = addFileRouting[f.name] ?? [...DD_AGENTS]; });
        await fetch(`/admin/dd/${newCompanyId}/routing`, {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ routing: routingPayload }),
        });
      }

      setDdReadyCompanyId(newCompanyId);
      setDdUploadState('ready');
    } catch (e: any) {
      setAddError(e.message);
      setDdUploadState('idle');
    }
  };

  // DD Step 2 — fire the pipeline now that files are confirmed on server
  const handleDdStart = async () => {
    if (!ddReadyCompanyId) return;
    setAddSubmitting(true);
    setAddError('');
    try {
      const res = await fetch(`/admin/dd/${ddReadyCompanyId}/trigger?mode=full`, {
        method: 'POST',
        headers: AUTH,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server error ${res.status}`);
      }
      const saved = addName.trim();
      resetForm();
      setSelectedMode(null);
      setDdUploadState('idle');
      setDdReadyCompanyId(null);
      loadStats();
      showToast(`DD pipeline started for ${saved}`);
    } catch (e: any) {
      setAddError(e.message);
    } finally {
      setAddSubmitting(false);
    }
  };

  const pct = stats ? Math.round((stats.enriched / stats.total) * 100) : 0;

  return (
    <div className={cls.page}>
      <CVCNavbar />

      {toast && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-[#10b981] text-white px-4 py-2.5 rounded-lg shadow-lg text-sm">
          <CheckCircle className="w-4 h-4" />{toast}
        </div>
      )}

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="border-b-2 border-[#33322c] pb-5 mb-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">SLAM · Data Pipeline</p>
          <h1 className={cls.pageTitle}>Enrichment Queue</h1>
        </div>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded border border-slate-200 p-5">
              <div className="text-3xl font-bold text-[#33322c]">{stats.total.toLocaleString()}</div>
              <div className="text-xs text-[#545249] font-medium mt-1 uppercase tracking-wide">Total Companies</div>
              <div className="mt-3 h-1.5 bg-[#f3f4f6] rounded-full">
                <div className="h-1.5 bg-[#10b981] rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-xs text-[#787569] mt-1">{pct}% enriched</div>
            </div>
            <div className="bg-white rounded border border-slate-200 p-5">
              <div className="text-3xl font-bold text-[#10b981]">{stats.enriched.toLocaleString()}</div>
              <div className="text-xs text-[#545249] font-medium mt-1 uppercase tracking-wide">Enriched</div>
            </div>
            <div className="bg-white rounded border border-slate-200 p-5">
              <div className="text-3xl font-bold text-[#f59e0b]">{stats.pending}</div>
              <div className="text-xs text-[#545249] font-medium mt-1 uppercase tracking-wide">Pending</div>
              <div className="text-xs text-[#787569] mt-1">Runs nightly 2AM UTC</div>
            </div>
            <div className="bg-white rounded border border-slate-200 p-5">
              <div className="text-3xl font-bold text-[#ef4444]">{stats.failed}</div>
              <div className="text-xs text-[#545249] font-medium mt-1 uppercase tracking-wide">Failed</div>
              {stats.failed > 0 && <div className="text-xs text-[#ef4444] mt-1">Needs retry</div>}
            </div>
          </div>
        )}

        {/* Row 1 — Entry + early enrichment: Quick Add → Founder Research → 4D → Funding → News */}
        <div className="grid grid-cols-3 lg:grid-cols-5 gap-3 mb-3">

          {/* Quick Add URL — standalone card */}
          <div className="rounded-xl border-2 p-3 flex flex-col" style={{ borderColor: '#d1fae5', background: '#f0fdf4' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <div className="p-1.5 rounded-lg bg-white border border-[#d1fae5]">
                <Globe className="w-4 h-4 text-emerald-600" />
              </div>
            </div>
            <div className="font-bold text-[#33322c] text-sm mb-0.5">Quick Add URL</div>
            <div className="text-[10px] font-semibold text-emerald-600 mb-2">Instant Enrichment</div>
            <form onSubmit={handleQuickAddCard} className="flex flex-col gap-1.5 mt-auto">
              <input
                type="url"
                value={qaUrl}
                onChange={e => { setQaUrl(e.target.value); setQaMsg(''); }}
                placeholder="https://company.com"
                className="w-full px-2 py-1.5 text-[11px] border border-slate-200 rounded-lg outline-none focus:border-emerald-400"
                required
              />
              <button
                type="submit"
                disabled={qaLoading || !qaUrl.trim()}
                className="w-full py-1.5 text-[11px] font-semibold rounded-lg text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                style={{ background: '#059669' }}
              >
                {qaLoading ? <Loader className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                {qaLoading ? 'Adding…' : 'Add & Enrich'}
              </button>
              {qaMsg && (
                <p className={`text-[10px] font-medium ${qaIsError ? 'text-red-500' : 'text-emerald-600'}`}>{qaMsg}</p>
              )}
            </form>
          </div>

          {/* Mode cards — row 1: Founder → 4D → Funding → News */}
          {([
            {
              key: 'founder' as const,
              icon: BookOpen,
              label: 'Founder Research',
              subtitle: 'People Intelligence',
              desc: 'Verified founder bios, prior exits, actual titles, and Crunchbase history. Ground truth for DD agents.',
              color: '#0f766e',
              bg: '#f0fdfa',
              border: '#99f6e4',
              activeBg: '#ccfbf1',
            },
            {
              key: '4d' as const,
              icon: Zap,
              label: '4D Enrichment',
              subtitle: 'AI Classification',
              desc: 'Classify Environment, Function, Stack Layer, and Business Model using LLM enrichment.',
              color: '#33322c',
              bg: '#f0f4f7',
              border: '#cbd5e1',
              activeBg: '#e2eaf0',
            },
            {
              key: 'funding' as const,
              icon: Search,
              label: 'Funding Rounds',
              subtitle: 'Round History',
              desc: 'Brave Search extracts funding rounds. Results land in Human Review.',
              color: '#0369a1',
              bg: '#f0f9ff',
              border: '#bae6fd',
              activeBg: '#e0f2fe',
            },
            {
              key: 'news' as const,
              icon: Rss,
              label: 'Case Studies & Deployments',
              subtitle: 'Commercial Evidence',
              desc: 'Brave Search for customer deployments, POCs, case studies, and commercial traction evidence.',
              color: '#b45309',
              bg: '#fffbeb',
              border: '#fde68a',
              activeBg: '#fef3c7',
            },
          ]).map(({ key, icon: Icon, label, subtitle, desc, color, bg, border, activeBg }) => {
            const active = selectedMode === key;
            return (
              <button
                key={key}
                onClick={() => selectMode(key)}
                className="text-left rounded-xl border-2 p-3 transition-all hover:shadow-md"
                style={{ borderColor: active ? color : border, background: active ? activeBg : bg }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="p-1.5 rounded-lg" style={{ background: active ? color : 'white', border: `1px solid ${border}` }}>
                    <Icon className="w-4 h-4" style={{ color: active ? 'white' : color }} />
                  </div>
                  {active && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: color }}>✓</span>}
                </div>
                <div className="font-bold text-[#33322c] text-sm mb-0.5">{label}</div>
                <div className="text-[10px] font-semibold mb-1.5" style={{ color }}>{subtitle}</div>
                <div className="text-[10px] text-[#545249] leading-relaxed">{desc}</div>
              </button>
            );
          })}
        </div>

        {/* Row 2 — Scoring & diligence: Industrial Analysis → DD Pipeline */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {([
            {
              key: 'industrial' as const,
              icon: Factory,
              label: 'Industrial Analysis',
              subtitle: 'Readiness & Sovereignty',
              desc: 'Score integration friction, pilot-to-production readiness, and geopolitical resilience.',
              prereqNote: 'Requires Founder + 4D + Funding + Deployments + News',
              color: '#7c3aed',
              bg: '#f5f3ff',
              border: '#ddd6fe',
              activeBg: '#ede9fe',
            },
            {
              key: 'dd' as const,
              icon: FileText,
              label: 'DD Pipeline',
              subtitle: 'Full Due Diligence',
              desc: 'IC Memo, Appendix PDF, and Scorecard XLSX from a full 9-stage automated pipeline.',
              prereqNote: null,
              color: '#a16207',
              bg: '#fefce8',
              border: '#fcd34d',
              activeBg: '#fef3c7',
            },
          ]).map(({ key, icon: Icon, label, subtitle, desc, prereqNote, color, bg, border, activeBg }) => {
            const active = selectedMode === key;
            return (
              <button
                key={key}
                onClick={() => selectMode(key)}
                className="text-left rounded-xl border-2 p-3 transition-all hover:shadow-md"
                style={{ borderColor: active ? color : border, background: active ? activeBg : bg }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="p-1.5 rounded-lg" style={{ background: active ? color : 'white', border: `1px solid ${border}` }}>
                    <Icon className="w-4 h-4" style={{ color: active ? 'white' : color }} />
                  </div>
                  {active && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: color }}>✓</span>}
                </div>
                <div className="font-bold text-[#33322c] text-sm mb-0.5">{label}</div>
                <div className="text-[10px] font-semibold mb-1.5" style={{ color }}>{subtitle}</div>
                <div className="text-[10px] text-[#545249] leading-relaxed">{desc}</div>
                {prereqNote && (
                  <div className="flex items-center gap-1 mt-2 pt-2 border-t border-[#ddd6fe]">
                    <Lock className="w-2.5 h-2.5 text-[#7c3aed] flex-shrink-0" />
                    <span className="text-[9px] text-[#7c3aed] font-medium">{prereqNote}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Expanded enrichment form */}
        {selectedMode && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-bold text-[#33322c]">
                  {selectedMode === 'dd' ? 'DD Pipeline'
                    : selectedMode === 'industrial' ? 'Industrial Analysis'
                    : selectedMode === 'funding' ? 'Funding Rounds'
                    : selectedMode === 'news' ? 'Case Studies & Deployments'
                    : selectedMode === 'founder' ? 'Founder Research'
                    : '4D Enrichment'} — New Job
                </h2>
                <p className="text-xs text-[#545249] mt-0.5">
                  {selectedMode === 'dd' ? 'Upload the dataroom and submit — the pipeline starts immediately.'
                    : selectedMode === 'industrial' ? 'Scores readiness, friction, and sovereignty. Runs automatically once queued.'
                    : selectedMode === 'funding' ? 'Brave Search extracts funding rounds. Results land in Human Review for analyst verification.'
                    : selectedMode === 'news' ? 'Pull recent press, customer deployments, and technology context via Brave Search.'
                    : selectedMode === 'founder' ? 'Web research pass on founders — LinkedIn history, Crunchbase roles, prior exits, and company funding. Verified facts stored as ground truth for DD agents.'
                    : 'Scrapes company website + 3 Brave searches, then a single LLM call classifies all four dimensions and fills missing profile fields.'}
                </p>
              </div>
              <button onClick={() => { setSelectedMode(null); resetForm(); }} className="p-1.5 rounded text-[#787569] hover:text-[#33322c] hover:bg-[#ede8d7] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Autofill from website */}
            <div className="bg-[#f8fafc] border border-slate-200 rounded-lg p-3 mb-4">
              <label className="block text-xs font-semibold text-[#33322c] mb-1.5 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-[#94a3b8]" />
                Autofill from website
              </label>
              <div className="flex gap-2">
                <input
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleUrlAutofill()}
                  placeholder="https://company.com"
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-[#33322c] outline-none focus:border-[#33322c] bg-white transition-colors"
                />
                <button
                  onClick={handleUrlAutofill}
                  disabled={urlLoading || !urlInput.trim()}
                  className="px-3 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                  style={{ background: '#33322c', color: 'white' }}
                >
                  {urlLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                  {urlLoading ? 'Scraping…' : 'Autofill'}
                </button>
              </div>
              {urlSuccess && <p className="text-xs text-emerald-600 mt-1.5 font-medium">Company seeded — name and website filled in below.</p>}
              {urlError && <p className="text-xs text-red-500 mt-1.5">{urlError}</p>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* Company search */}
              <div>
                <label className="block text-xs font-semibold text-[#33322c] mb-1.5">Company <span className="text-red-500">*</span></label>
                <div className="relative" ref={suggestionsRef}>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#787569] pointer-events-none" />
                  <input
                    value={addName}
                    onChange={e => handleNameChange(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !showSuggestions && submitAdd()}
                    onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                    placeholder="Search existing or type new name"
                    className="w-full border rounded-lg pl-8 pr-8 py-2.5 text-sm text-[#33322c] outline-none transition-colors"
                    style={{ borderColor: addCompanyId ? '#10b981' : '#e2e8f0' }}
                  />
                  {addName && (
                    <button onClick={clearSelection} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#787569] hover:text-[#33322c]">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {addCompanyId && <p className="text-[10px] text-[#10b981] font-semibold mt-1 pl-1">Existing company — ID #{addCompanyId}</p>}
                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                      {suggestions.map(s => (
                        <button key={s.id} onMouseDown={() => selectSuggestion(s)}
                          className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-[#f0f4f7] transition-colors border-b border-[#f5f5f5] last:border-0">
                          <div>
                            <span className="text-sm font-medium text-[#33322c]">{s.name}</span>
                            {s.sector && <span className="ml-2 text-[10px] text-[#94a3b8]">{s.sector}</span>}
                          </div>
                          <span className="text-[10px] text-[#c5c0ad] ml-2">#{s.id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Website */}
              <div>
                <label className="block text-xs font-semibold text-[#33322c] mb-1.5">Website</label>
                <input
                  value={addWebsite}
                  onChange={e => setAddWebsite(e.target.value)}
                  placeholder="https://company.com"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-[#33322c] outline-none focus:border-[#33322c] transition-colors"
                />
              </div>
            </div>

            {/* News URLs */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-[#33322c] mb-1.5">
                News &amp; Reference URLs <span className="text-[#787569] font-normal">(one per line — TechCrunch, press releases, LinkedIn, etc.)</span>
              </label>
              <textarea
                value={addNewsUrls}
                onChange={e => setAddNewsUrls(e.target.value)}
                placeholder={"https://techcrunch.com/...\nhttps://..."}
                rows={3}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-[#33322c] outline-none focus:border-[#33322c] transition-colors resize-none font-mono"
              />
            </div>

            {/* File upload */}
            <div className="mb-5">
              <label className="block text-xs font-semibold text-[#33322c] mb-1.5">
                Upload Files <span className="text-[#787569] font-normal">(PDFs, Excel, DOCX — {selectedMode === 'dd' ? 'dataroom documents for pipeline ingestion' : 'context documents for analysis'})</span>
              </label>
              <div
                onDragOver={e => { e.preventDefault(); setAddDragging(true); }}
                onDragLeave={() => setAddDragging(false)}
                onDrop={handleFileDrop}
                onClick={() => addFileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
                  addDragging ? 'border-[#33322c] bg-[#f0f4f7]' : 'border-slate-200 hover:border-[#33322c]/40 hover:bg-[#fafcff]'
                }`}
              >
                <Upload className="w-5 h-5 text-[#787569] mx-auto mb-1.5" />
                <p className="text-sm text-[#545249]">Drag & drop or <span className="text-[#33322c] font-medium">browse</span></p>
                <p className="text-xs text-[#787569] mt-0.5">PDF, DOCX, XLSX, CSV</p>
              </div>
              <input ref={addFileInputRef} type="file" multiple accept=".pdf,.docx,.xlsx,.csv,.txt" className="hidden" onChange={handleAddFileInput} />
              {addFiles.length > 0 && selectedMode !== 'dd' && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {addFiles.map(f => (
                    <div key={f.name} className="flex items-center gap-1.5 px-2.5 py-1 bg-[#ede8d7] rounded border border-slate-200 text-xs text-[#33322c]">
                      <FileText className="w-3 h-3 text-[#787569]" />
                      {f.name}
                      <button onClick={() => setAddFiles(prev => prev.filter(p => p.name !== f.name))} className="ml-1 text-[#787569] hover:text-red-500">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* Auto Ingest toggle — shown when files are staged in DD mode */}
              {addFiles.length > 0 && selectedMode === 'dd' && (
                <div className="mt-3 flex items-start justify-between gap-4 px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-amber-800">Auto Ingest</p>
                    <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                      When on, the ingestion agent automatically routes each file to the appropriate analyst. Less accurate than manual routing — use only when you have too many files to review individually.
                    </p>
                  </div>
                  <button
                    onClick={() => setDdAutoIngest(v => !v)}
                    className={`relative mt-0.5 flex-shrink-0 w-10 h-5 rounded-full transition-colors ${ddAutoIngest ? 'bg-amber-500' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${ddAutoIngest ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              )}
              {/* DD agent routing table — shown when files are staged and Auto Ingest is OFF */}
              {addFiles.length > 0 && selectedMode === 'dd' && !ddAutoIngest && (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between px-3 py-2 bg-[#f8fafc] border-b border-slate-200">
                    <span className="text-xs font-bold text-[#33322c]">Agent Routing</span>
                    <span className="text-[10px] text-[#787569]">Check which agents should process each file</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-[#f8fafc] border-b border-slate-200">
                      <tr>
                        <th className="text-left px-3 py-2 font-bold text-[#545249] uppercase tracking-wide">File</th>
                        {DD_AGENTS.map(a => (
                          <th key={a} className="text-center px-2 py-2 font-bold text-[#545249] uppercase tracking-wide whitespace-nowrap w-14">
                            <div className="relative group inline-block">
                              <span className="cursor-default border-b border-dashed border-[#a0998a]">{DD_AGENT_LABELS[a]}</span>
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 w-52 bg-[#1e293b] text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-lg pointer-events-none">
                                <p className="font-semibold text-cvc-gold mb-0.5">{DD_AGENT_LABELS[a] === 'General' ? 'General — All Agents' : DD_AGENT_LABELS[a]}</p>
                                <p className="text-slate-300 font-normal normal-case tracking-normal">{DD_AGENT_DESCRIPTIONS[a]}</p>
                              </div>
                            </div>
                          </th>
                        ))}
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {addFiles.map(f => {
                        const agents = addFileRouting[f.name] ?? [...DD_AGENTS];
                        return (
                          <tr key={f.name} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                            <td className="px-3 py-2.5 font-medium text-[#33322c] max-w-[180px]">
                              <span className="truncate block">{f.name}</span>
                              <span className="text-[10px] text-[#787569]">
                                {f.size > 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(f.size / 1024)} KB`}
                              </span>
                            </td>
                            {DD_AGENTS.map(a => (
                              <td key={a} className="text-center px-2 py-2">
                                <input
                                  type="checkbox"
                                  checked={agents.includes(a)}
                                  onChange={() => toggleAddFileAgent(f.name, a)}
                                  className="w-3.5 h-3.5 rounded cursor-pointer accent-[#33322c]"
                                />
                              </td>
                            ))}
                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => {
                                  setAddFiles(prev => prev.filter(p => p.name !== f.name));
                                  setAddFileRouting(prev => { const n = { ...prev }; delete n[f.name]; return n; });
                                }}
                                className="text-[#787569] hover:text-red-500"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {addError && <p className="text-xs text-red-500 mb-3">{addError}</p>}

            {selectedMode === 'dd' ? (
              <div className="flex items-center gap-3">
                {ddUploadState === 'idle' && (
                  <>
                    <button
                      onClick={handleDdFormUpload}
                      disabled={!addName.trim() || addFiles.length === 0}
                      className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: '#33322c', color: 'white' }}
                    >
                      Upload Dataroom
                    </button>
                    {addFiles.length === 0 && (
                      <span className="text-xs text-slate-400">Upload at least one dataroom file to continue</span>
                    )}
                  </>
                )}
                {ddUploadState === 'uploading' && (
                  <button disabled className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold opacity-70 cursor-not-allowed" style={{ background: '#33322c', color: 'white' }}>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Uploading…
                  </button>
                )}
                {ddUploadState === 'ready' && (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleDdStart}
                      disabled={addSubmitting}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                      style={{ background: '#065f46', color: 'white' }}
                    >
                      {addSubmitting ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                          Starting…
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" /></svg>
                          Start DD Pipeline
                        </>
                      )}
                    </button>
                    <span className="text-xs text-emerald-600 font-medium">✓ {addFiles.length} file{addFiles.length !== 1 ? 's' : ''} uploaded</span>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={submitAdd}
                disabled={addSubmitting || !addName.trim()}
                className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#33322c', color: 'white' }}
              >
                {addSubmitting ? 'Queuing…' : `Queue ${selectedMode === 'industrial' ? 'Industrial Analysis' : '4D Enrichment'}`}
              </button>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded border border-slate-200 overflow-hidden">
          <div className="flex border-b border-slate-200">
            {STATUS_TABS.map(t => {
              const Icon = t.icon;
              const noCount = 'noCount' in t && t.noCount;
              const count = noCount ? null
                : t.key === 'requests' ? requests.length
                : (stats ? (stats[t.key as keyof Stats] ?? 0) : 0);
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key as any)}
                  className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium transition-colors border-b-2 ${
                    tab === t.key
                      ? 'border-[#33322c] text-[#33322c]'
                      : 'border-transparent text-[#545249] hover:text-[#33322c]'
                  }`}
                >
                  <Icon className="w-4 h-4" style={{ color: tab === t.key ? t.color : undefined }} />
                  {t.label}
                  {count !== null && (
                    <span className="px-1.5 py-0.5 rounded text-xs font-bold"
                      style={{ background: t.bg, color: t.color }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {tab === 'brambles' ? (
            <BramblesTab />
          ) : tab === 'methodology' ? (
            <MethodologyContent />
          ) : tab === 'human_review' ? (
            <HumanReviewTab
              suggestions={intelSuggestions}
              loading={intelSuggestionsLoading}
              actioning={actioning}
              onApprove={approveSuggestion}
              onReject={rejectSuggestion}
              onRefresh={loadSuggestions}
              navigate={navigate}
            />
          ) : tab === 'intelligence' ? (
            <IntelBriefingTab
              sources={sources}
              loading={sourcesLoading}
              showAdd={showAddSource}
              setShowAdd={setShowAddSource}
              newSource={newSource}
              setNewSource={setNewSource}
              adding={addingSource}
              onAdd={handleAddSource}
              onToggle={handleToggleSource}
              onDelete={handleDeleteSource}
              detectUrl={detectUrl}
              setDetectUrl={setDetectUrl}
              detecting={detecting}
              detectNote={detectNote}
              onDetect={handleDetect}
              cronJobs={cronJobs}
              cronOpen={cronOpen}
              setCronOpen={setCronOpen}
              editingCron={editingCron}
              setEditingCron={setEditingCron}
              cronEdits={cronEdits}
              setCronEdits={setCronEdits}
              onSaveCron={handleSaveCron}
              onToggleCron={handleToggleCron}
            />
          ) : loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#33322c]" />
            </div>
          ) : tab === 'requests' ? (
            requests.length === 0 ? (
              <div className="text-center py-12 text-[#787569]">
                <List className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No enrichment requests found</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[#ede8d7] border-b border-slate-200">
                  <tr>
                    {['Type', 'Company', 'Sector', 'Status / Priority', 'Submitted', ''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req, i) => {
                    const typeCfg = TYPE_CONFIG[req.enrichment_type] ?? TYPE_CONFIG['4d'];
                    const statusCfg = TASK_STATUS_CONFIG[req.status] ?? TASK_STATUS_CONFIG['pending'];
                    const isDD = req.enrichment_type === 'dd';
                    const rowKey = String(req.task_id ?? `4d-${req.company_id}-${i}`);
                    const isExpanded = isDD && req.company_id != null && expandedRow === req.company_id;
                    const stagedFiles = (req.company_id != null && ddFiles[req.company_id]) || [];

                    return (
                      <>
                        <tr
                          key={rowKey}
                          className={`border-b border-[#f5f5f5] hover:bg-[#fafcff] ${isExpanded ? 'bg-[#fafcff]' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded text-[10.5px] font-bold"
                              style={{ background: typeCfg.bg, color: typeCfg.color }}>
                              {typeCfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-[#33322c]">
                            {req.company_id ? (
                              <button
                                onClick={() => navigate(`/companies/${req.company_id}`)}
                                className="hover:underline text-left"
                              >
                                {req.company_name}
                              </button>
                            ) : req.company_name}
                          </td>
                          <td className="px-4 py-3 text-[#545249]">{req.sector ?? '—'}</td>
                          <td className="px-4 py-3">
                            {editingTaskId === req.task_id && req.task_id != null ? (
                              <div className="flex items-center gap-1">
                                <select
                                  value={editPriority}
                                  onChange={e => setEditPriority(e.target.value)}
                                  className="border border-slate-200 rounded px-2 py-1 text-xs text-[#33322c] outline-none"
                                >
                                  <option value="low">low</option>
                                  <option value="medium">medium</option>
                                  <option value="high">high</option>
                                </select>
                                <button
                                  onClick={() => saveEditRequest(req.task_id!)}
                                  className="p-1 rounded bg-[#33322c] text-white hover:bg-[#33322c]/80"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => setEditingTaskId(null)}
                                  className="p-1 rounded text-[#545249] hover:bg-[#f1f5f9]/30"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold capitalize"
                                style={{ background: statusCfg.bg, color: statusCfg.color }}>
                                {req.status}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-[#787569]">
                            {req.created_at ? new Date(req.created_at).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {req.task_id != null && (
                                <button
                                  onClick={() => { setEditingTaskId(req.task_id!); setEditPriority('medium'); }}
                                  className="p-1.5 rounded text-[#545249] hover:bg-[#f1f5f9]/30 transition-colors"
                                  title="Edit priority"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteRequest(req, rowKey)}
                                disabled={deletingKey === rowKey}
                                className="p-1.5 rounded text-[#ef4444]/60 hover:text-[#ef4444] hover:bg-[#fef2f2] transition-colors disabled:opacity-40"
                                title="Remove from list"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              {isDD && req.company_id != null && (
                                <button
                                  onClick={() => toggleExpand(req.company_id!)}
                                  className="p-1.5 rounded text-[#545249] hover:bg-[#f1f5f9] transition-colors"
                                  title="Manage dataroom files"
                                >
                                  {isExpanded
                                    ? <ChevronDown className="w-3.5 h-3.5" />
                                    : <ChevronRight className="w-3.5 h-3.5" />}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {isExpanded && req.company_id != null && (() => {
                          const ps = ddStatus[req.company_id];
                          const ov = ddOverview[req.company_id];
                          const agents = ddAgents[req.company_id] ?? [];
                          const pipelineStatus = ps?.status ?? 'not_started';

                          // Stage completion map
                          const stageComplete: Record<string, boolean> = {
                            files:       stagedFiles.length > 0,
                            ingestion:   ps?.stages?.ingestion ?? false,
                            financials:  ps?.stages?.agents?.financials ?? false,
                            comp:        ps?.stages?.agents?.comp ?? false,
                            qualitative: ps?.stages?.agents?.qualitative ?? false,
                            product:     ps?.stages?.agents?.product ?? false,
                            news:        ps?.stages?.agents?.news ?? false,
                            overview:    ps?.stages?.overview ?? false,
                            outputs:     ps?.stages?.outputs?.ic_memo ?? false,
                          };

                          const recoKey = (ov?.recommendation ?? '').toLowerCase();
                          const recoCfg = RECO_CONFIG[recoKey];

                          return (
                            <tr key={`${rowKey}-panel`} className="border-b border-slate-200 bg-[#f8fafc]">
                              <td colSpan={6} className="px-6 py-6">

                                {/* Stage tracker — always visible */}
                                <div className="flex items-center gap-0 mb-6 overflow-x-auto pb-1">
                                  {PIPELINE_STAGES.map((stage, si) => {
                                    const done = stageComplete[stage.key];
                                    const running = !done && pipelineStatus === 'running' && (
                                      si > 0 && stageComplete[PIPELINE_STAGES[si - 1].key]
                                    );
                                    return (
                                      <div key={stage.key} className="flex items-center">
                                        <div className="flex flex-col items-center gap-1 min-w-[60px]">
                                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold border-2 ${
                                            done    ? 'bg-[#10b981] border-[#10b981]' :
                                            running ? 'bg-white border-[#3b82f6]' :
                                                      'bg-white border-slate-200'
                                          }`}>
                                            {done ? (
                                              <Check className="w-3.5 h-3.5" />
                                            ) : running ? (
                                              <div className="w-3 h-3 rounded-full border-2 border-[#3b82f6] border-t-transparent animate-spin" />
                                            ) : (
                                              <span className="text-[#787569] text-[10px]">{si + 1}</span>
                                            )}
                                          </div>
                                          <span className={`text-[9.5px] font-medium whitespace-nowrap ${done ? 'text-[#10b981]' : running ? 'text-[#3b82f6]' : 'text-[#787569]'}`}>
                                            {stage.label}
                                          </span>
                                        </div>
                                        {si < PIPELINE_STAGES.length - 1 && (
                                          <div className={`h-0.5 w-6 mb-4 mx-0.5 shrink-0 ${stageComplete[PIPELINE_STAGES[si].key] ? 'bg-[#10b981]' : 'bg-[#f1f5f9]'}`} />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* COMPLETE STATE */}
                                {pipelineStatus === 'complete' && ov && (
                                  <div className="space-y-4">
                                    {/* Recommendation + downloads */}
                                    <div className="flex flex-wrap items-start gap-4">
                                      {recoCfg && (
                                        <div className="px-4 py-2 rounded-lg border-2 font-bold text-sm"
                                          style={{ borderColor: recoCfg.color, background: recoCfg.bg, color: recoCfg.color }}>
                                          {recoCfg.label}
                                        </div>
                                      )}
                                      <div className="flex gap-2 flex-wrap">
                                        {[
                                          { label: 'IC Memo', file: `${req.company_name}_IC_Memo.pdf` },
                                          { label: 'Appendix', file: `${req.company_name}_Appendix.pdf` },
                                          { label: 'Scorecard', file: `${req.company_name}_Scorecard.xlsx` },
                                        ].map(dl => (
                                          <a key={dl.file}
                                            href={`/admin/dd/${req.company_id}/download/${encodeURIComponent(dl.file)}`}
                                            download={dl.file}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#33322c] hover:bg-[#f0f4f7] transition-colors"
                                          >
                                            <Download className="w-3.5 h-3.5" />
                                            {dl.label}
                                          </a>
                                        ))}
                                      </div>
                                    </div>

                                    {/* Rationale */}
                                    {ov.recommendation_rationale && (
                                      <p className="text-xs text-[#33322c] bg-white border border-slate-200 rounded-lg px-4 py-3 leading-relaxed">
                                        {ov.recommendation_rationale}
                                      </p>
                                    )}

                                    {/* Agent summary pills */}
                                    {agents.length > 0 && (
                                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {agents.filter(a => a.status !== 'pending').map((a: any) => (
                                          <div key={a.agent} className="bg-white border border-slate-200 rounded-lg p-3">
                                            <div className="flex items-center justify-between mb-1">
                                              <span className="text-xs font-bold capitalize text-[#33322c]">{a.agent}</span>
                                              <span className="text-[10px] text-[#545249]">{a.findings_count ?? 0} findings</span>
                                            </div>
                                            {a.summary && <p className="text-[10.5px] text-[#545249] line-clamp-2 leading-relaxed">{a.summary}</p>}
                                            {(a.flags_count ?? 0) > 0 && (
                                              <div className="flex items-center gap-1 mt-1.5">
                                                <AlertTriangle className="w-3 h-3 text-[#ef4444]" />
                                                <span className="text-[10px] text-[#ef4444] font-semibold">{a.flags_count} flag{a.flags_count > 1 ? 's' : ''}</span>
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* NOT STARTED / INGESTED / RUNNING — upload + routing panel */}
                                {(pipelineStatus !== 'complete') && (() => {
                                  const cid = req.company_id!;
                                  const panelTab = ddPanelTab[cid] ?? 'upload';
                                  const routing = ddRouting[cid];
                                  const edits = ddRoutingEdits[cid] ?? {};

                                  return (
                                    <div>
                                      {/* Sub-tab nav */}
                                      <div className="flex gap-1 bg-[#f1f5f9] rounded-lg p-0.5 mb-4 w-fit">
                                        {([
                                          { key: 'upload', label: 'Upload Files' },
                                          { key: 'routing', label: 'Agent Routing' },
                                        ] as const).map(t => (
                                          <button key={t.key} onClick={() => setDdPanelTab(prev => ({ ...prev, [cid]: t.key }))}
                                            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                                              panelTab === t.key ? 'bg-white text-[#33322c] shadow-sm' : 'text-[#545249] hover:text-[#33322c]'
                                            }`}>
                                            {t.label}
                                          </button>
                                        ))}
                                      </div>

                                      {/* Upload tab */}
                                      {panelTab === 'upload' && (
                                        <div>
                                          {stagedFiles.length > 0 && (
                                            <div className="mb-3 space-y-1">
                                              {stagedFiles.map(f => (
                                                <div key={f.name} className="flex items-center gap-2 py-1.5 px-3 bg-white rounded border border-slate-200 text-sm">
                                                  <FileText className="w-3.5 h-3.5 text-[#545249] shrink-0" />
                                                  <span className="font-medium text-[#33322c] flex-1 truncate">{f.name}</span>
                                                  <span className="text-[10.5px] text-[#787569]">
                                                    {f.size > 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(f.size / 1024)} KB`}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          <div
                                            className="border-2 border-dashed border-slate-200 rounded-lg p-5 text-center cursor-pointer hover:border-[#33322c] hover:bg-white transition-all mb-3"
                                            onClick={() => fileInputRef.current?.click()}
                                            onDragOver={e => e.preventDefault()}
                                            onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) handleDdUpload(cid, e.dataTransfer.files); }}
                                          >
                                            {ddUploading === cid
                                              ? <div className="flex justify-center"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#33322c]" /></div>
                                              : <>
                                                  <Upload className="w-5 h-5 mx-auto mb-1 text-[#787569]" />
                                                  <p className="text-xs text-[#545249]">Drop files here or click to browse</p>
                                                  <p className="text-[10px] text-[#787569] mt-0.5">PDFs, Excel, ZIP — any dataroom format</p>
                                                </>
                                            }
                                          </div>
                                          <input ref={fileInputRef} type="file" multiple className="hidden"
                                            onChange={e => e.target.files && handleDdUpload(cid, e.target.files)} />
                                          <div className="flex flex-wrap gap-2">
                                            <button onClick={() => handleDdTrigger(cid, req.company_name, 'full')}
                                              disabled={ddTriggering === cid || stagedFiles.length === 0}
                                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
                                              style={{ background: '#33322c', color: 'white' }}>
                                              <Play className="w-3.5 h-3.5" />Run Full DD
                                            </button>
                                            <button onClick={() => handleDdTrigger(cid, req.company_name, 'research')}
                                              disabled={ddTriggering === cid}
                                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border-2 text-xs font-semibold transition-all disabled:opacity-40"
                                              style={{ borderColor: '#7c3aed', background: '#f5f3ff', color: '#7c3aed' }}>
                                              <FlaskConical className="w-3.5 h-3.5" />Research Only
                                            </button>
                                            <button onClick={() => handleDdTrigger(cid, req.company_name, 'ingest')}
                                              disabled={ddTriggering === cid || stagedFiles.length === 0}
                                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border-2 text-xs font-semibold transition-all disabled:opacity-40"
                                              style={{ borderColor: '#0891b2', background: '#f0f9ff', color: '#0891b2' }}>
                                              <Inbox className="w-3.5 h-3.5" />Queue for Ingestion
                                            </button>
                                          </div>
                                          {stagedFiles.length === 0 && <p className="text-[10.5px] text-[#787569] mt-2">Upload files to enable pipeline actions</p>}
                                        </div>
                                      )}

                                      {/* Routing tab */}
                                      {panelTab === 'routing' && (
                                        <div>
                                          {!routing ? (
                                            <div className="flex justify-center py-6">
                                              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#33322c]" />
                                            </div>
                                          ) : (
                                            <>
                                              <div className="flex items-center justify-between mb-3">
                                                <div>
                                                  <p className="text-xs font-semibold text-[#33322c]">
                                                    {routing.has_manifest
                                                      ? `${routing.groups.reduce((s, g) => s + g.file_count, 0)} documents across ${routing.groups.length} types`
                                                      : `${routing.files.length} staged file${routing.files.length !== 1 ? 's' : ''}`}
                                                  </p>
                                                  {routing.has_override && (
                                                    <span className="text-[10px] text-amber-600 font-medium">Custom routing active</span>
                                                  )}
                                                </div>
                                                <div className="flex gap-2">
                                                  {routing.has_override && (
                                                    <button onClick={() => resetDdRouting(cid)}
                                                      className="px-2.5 py-1 text-[10.5px] font-medium border border-slate-200 text-[#545249] rounded hover:bg-[#f5f5f5] transition-colors">
                                                      Reset to Auto
                                                    </button>
                                                  )}
                                                  <button onClick={() => saveDdRouting(cid)}
                                                    disabled={ddRoutingSaving === cid}
                                                    className="flex items-center gap-1 px-3 py-1 text-[10.5px] font-semibold rounded transition-colors disabled:opacity-50"
                                                    style={{ background: '#33322c', color: 'white' }}>
                                                    {ddRoutingSaving === cid ? <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />Saving…</> : <>Save Routing</>}
                                                  </button>
                                                </div>
                                              </div>

                                              {/* Routing table */}
                                              <div className="overflow-x-auto rounded-lg border border-slate-200">
                                                <table className="w-full text-xs">
                                                  <thead className="bg-[#f8fafc] border-b border-slate-200">
                                                    <tr>
                                                      <th className="text-left px-3 py-2 font-bold text-[#545249] uppercase tracking-wide">
                                                        {routing.has_manifest ? 'Document Type' : 'File'}
                                                      </th>
                                                      <th className="text-center px-2 py-2 font-bold text-[#545249] uppercase tracking-wide w-8">#</th>
                                                      {DD_AGENTS.map(a => (
                                                        <th key={a} className="text-center px-2 py-2 font-bold text-[#545249] uppercase tracking-wide whitespace-nowrap">
                                                          {DD_AGENT_LABELS[a]}
                                                        </th>
                                                      ))}
                                                    </tr>
                                                  </thead>
                                                  <tbody className="divide-y divide-[#f5f5f5]">
                                                    {(routing.has_manifest ? routing.groups : routing.files.map(f => ({
                                                      group: f.name, label: f.name, file_count: 1,
                                                      agents: f.agents, default_agents: [],
                                                    }))).map(row => {
                                                      const activeAgents = edits[row.group] ?? row.agents;
                                                      const isModified = routing.has_manifest
                                                        ? JSON.stringify(activeAgents.slice().sort()) !== JSON.stringify((row.default_agents ?? row.agents).slice().sort())
                                                        : false;
                                                      return (
                                                        <tr key={row.group} className={`hover:bg-[#fafcff] ${isModified ? 'bg-amber-50/50' : ''}`}>
                                                          <td className="px-3 py-2.5 font-medium text-[#33322c]">
                                                            {row.label}
                                                            {isModified && <span className="ml-1.5 text-[9px] text-amber-600 font-semibold">MODIFIED</span>}
                                                          </td>
                                                          <td className="px-2 py-2.5 text-center text-[#787569]">{row.file_count}</td>
                                                          {DD_AGENTS.map(agent => (
                                                            <td key={agent} className="px-2 py-2.5 text-center">
                                                              <input
                                                                type="checkbox"
                                                                checked={activeAgents.includes(agent)}
                                                                onChange={() => toggleRoutingAgent(cid, row.group, agent)}
                                                                className="w-3.5 h-3.5 accent-[#33322c] cursor-pointer"
                                                              />
                                                            </td>
                                                          ))}
                                                        </tr>
                                                      );
                                                    })}
                                                  </tbody>
                                                </table>
                                              </div>
                                              <p className="text-[10px] text-[#787569] mt-2">
                                                Check which agents should receive each document type. Save to create a routing override — used on the next pipeline run.
                                              </p>
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}

                                {/* RUNNING STATE */}
                                {(pipelineStatus === 'running' || pipelineStatus === 'ingested') && (
                                  <div className="flex items-center gap-2 text-sm text-[#3b82f6]">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#3b82f6]" />
                                    Pipeline running — checking every 12 seconds…
                                  </div>
                                )}

                              </td>
                            </tr>
                          );
                        })()}
                      </>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : companies.length === 0 ? (
            <div className="text-center py-12 text-[#787569]">
              <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No companies in {tab} state</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#ede8d7] border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8]">Company</th>
                  <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8]">Sector</th>
                  <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8]">Stage</th>
                  <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8]">Website</th>
                  <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8]">Updated</th>
                  {tab === 'enriched' && (
                    <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8]">Enrichment</th>
                  )}
                  {(tab === 'failed' || tab === 'pending') && (
                    <th className="px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8]" />
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f5f5f5]">
                {companies.map(c => (
                  pendingEditId === c.id ? (
                    <tr key={c.id} className="bg-[#fefce8]">
                      <td className="px-3 py-2">
                        <input value={pendingEditFields.name} onChange={e => setPendingEditFields(p => ({ ...p, name: e.target.value }))}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-[#33322c] outline-none focus:border-[#33322c]" />
                      </td>
                      <td className="px-3 py-2">
                        <input value={pendingEditFields.sector} onChange={e => setPendingEditFields(p => ({ ...p, sector: e.target.value }))}
                          placeholder="Sector" className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-[#33322c] outline-none focus:border-[#33322c]" />
                      </td>
                      <td className="px-3 py-2">
                        <input value={pendingEditFields.stage} onChange={e => setPendingEditFields(p => ({ ...p, stage: e.target.value }))}
                          placeholder="Stage" className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-[#33322c] outline-none focus:border-[#33322c]" />
                      </td>
                      <td className="px-3 py-2" colSpan={2}>
                        <input value={pendingEditFields.website} onChange={e => setPendingEditFields(p => ({ ...p, website: e.target.value }))}
                          placeholder="https://" className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-[#33322c] outline-none focus:border-[#33322c]" />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <button onClick={savePendingEdit} disabled={pendingSaving}
                            className="flex items-center gap-1 px-2.5 py-1 bg-[#33322c] text-white rounded text-xs disabled:opacity-50">
                            <Check className="w-3 h-3" />{pendingSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => setPendingEditId(null)} className="p-1 rounded text-[#545249] hover:bg-[#f1f5f9]/30">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                  <tr key={c.id} className="hover:bg-[#fafcff]">
                    <td className="px-4 py-3 font-medium text-[#33322c]">{c.name}</td>
                    <td className="px-4 py-3 text-[#545249]">{c.sector ?? '—'}</td>
                    <td className="px-4 py-3 text-[#545249]">{c.stage ?? '—'}</td>
                    <td className="px-4 py-3">
                      {c.website
                        ? <a href={c.website} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[#33322c] hover:underline text-xs">
                            <ExternalLink className="w-3 h-3" />{c.website.replace(/^https?:\/\//, '').split('/')[0]}
                          </a>
                        : <span className="text-[#787569]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#787569]">
                      {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : '—'}
                    </td>
                    {tab === 'enriched' && (
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1.5">
                          {c.has_dd && (() => {
                            const safe = c.name.replace(/ /g, '_').replace(/\//g, '-');
                            return (
                              <>
                                <div className="flex items-center gap-1.5">
                                  <a href={`/enrichment/dd/${c.id}/download/${safe}_Appendix.pdf`} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-[#f59e0b]/10 text-[#92400e] border border-[#f59e0b]/30 hover:bg-[#f59e0b]/20 transition-colors">
                                    <ExternalLink className="w-2.5 h-2.5" />Appendix
                                  </a>
                                  <a href={`/enrichment/dd/${c.id}/download/${safe}_Scorecard.xlsx`} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-[#f0fdf4] text-[#166534] border border-emerald-200 hover:bg-emerald-100 transition-colors">
                                    <ExternalLink className="w-2.5 h-2.5" />Scorecard
                                  </a>
                                </div>
                                {c.has_review && (
                                  <div className="flex items-center gap-1.5">
                                    <a href={`/enrichment/dd/${c.id}/download/${safe}_Review_Memo.pdf`} target="_blank" rel="noopener noreferrer"
                                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-violet-50 text-violet-800 border border-violet-200 hover:bg-violet-100 transition-colors">
                                      <ExternalLink className="w-2.5 h-2.5" />Memo PDF
                                    </a>
                                    <a href={`/enrichment/dd/${c.id}/download/${safe}_Review_Memo.docx`} target="_blank" rel="noopener noreferrer"
                                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 transition-colors">
                                      <ExternalLink className="w-2.5 h-2.5" />Memo DOCX
                                    </a>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          <div className="flex items-center gap-1.5">
                            {c.has_industrial && <span title="Industrial"    className="w-2 h-2 rounded-full inline-block bg-[#7c3aed]" />}
                            {c.has_4d         && <span title="4D Enrichment" className="w-2 h-2 rounded-full inline-block bg-[#33322c]" />}
                          </div>
                        </div>
                      </td>
                    )}
                    {tab === 'failed' && (
                      <td className="px-4 py-3">
                        <button onClick={() => handleRetry(c.id, c.name)} disabled={retrying === c.id}
                          className="flex items-center gap-1 px-3 py-1.5 bg-[#33322c] text-white rounded text-xs hover:bg-[#33322c]/90 disabled:opacity-50 transition-colors">
                          <RefreshCw className={`w-3 h-3 ${retrying === c.id ? 'animate-spin' : ''}`} />
                          Retry
                        </button>
                      </td>
                    )}
                    {tab === 'pending' && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => startPendingEdit(c)} title="Edit"
                            className="p-1.5 rounded text-[#545249] hover:bg-[#f1f5f9]/30 transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deletePending(c)} disabled={pendingDeleting === c.id} title="Remove from queue"
                            className="p-1.5 rounded text-[#ef4444]/60 hover:text-[#ef4444] hover:bg-[#fef2f2] transition-colors disabled:opacity-40">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                  )
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
