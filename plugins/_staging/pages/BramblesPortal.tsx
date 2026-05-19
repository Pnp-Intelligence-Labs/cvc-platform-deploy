/**
 * BramblesPortal.tsx — Dedicated Brambles DD Platform page.
 *
 * Access: GP / Principal / Director (any) OR PSMs assigned to partner_id=27 (Brambles).
 * All other users see a locked screen with the product description only.
 *
 * Route: /brambles
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router';
import { Lock, RefreshCw, CheckCircle2, Clock, AlertTriangle, Play, ExternalLink, FileText, ChevronDown, ChevronUp, Search, GitBranch, FileCheck } from 'lucide-react';
import { cls } from '../components/tokens';
import { CVCNavbar } from '../components/CVCNavbar';
import { AUTH_HEADER as AUTH, api } from '../api/client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BramblesCompany {
  id: number;
  company_name: string;
  website: string | null;
  analyst_tier: string | null;   // Brambles' tier
  tier: string | null;           // CVC tier (post-analysis)
  tier_label: string | null;
  composite_score: number | null;
  status: string;                // pending | running | complete | error
  review_status: string | null;  // pending | complete
  strategic_rationale: string | null;
  pdf_memo_path: string | null;
  created_at: string;
  updated_at: string;
  cvc_company_id: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BRAMBLES_PARTNER_ID = 27;
const FULL_ACCESS_ROLES   = ['GP', 'Principal', 'Director'];

function hasAccess(user: ReturnType<typeof api.getCurrentUser>): boolean {
  if (!user) return false;
  if (FULL_ACCESS_ROLES.includes(user.role ?? '')) return true;
  return (user.assigned_partner_ids ?? []).includes(BRAMBLES_PARTNER_ID);
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  pending:        { label: 'Pending',        color: '#92400e', bg: '#fef3c7', icon: <Clock        className="w-3 h-3" /> },
  running:        { label: 'Running',        color: '#1e40af', bg: '#dbeafe', icon: <RefreshCw    className="w-3 h-3 animate-spin" /> },
  pending_review: { label: 'Pending Review', color: '#0369a1', bg: '#e0f2fe', icon: <FileText     className="w-3 h-3" /> },
  complete:       { label: 'Complete',       color: '#065f46', bg: '#d1fae5', icon: <CheckCircle2 className="w-3 h-3" /> },
  error:          { label: 'Error',          color: '#991b1b', bg: '#fee2e2', icon: <AlertTriangle className="w-3 h-3" /> },
};

function displayStatus(c: BramblesCompany): string {
  if (c.status === 'complete') {
    return c.review_status === 'finalized' ? 'complete' : 'pending_review';
  }
  return c.status;
}

const TIER_COLORS: Record<string, string> = {
  'Tier 1': '#065f46',
  'Tier 2': '#1e40af',
  'Tier 3': '#92400e',
  'Tier 4': '#6b7280',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Locked Screen ─────────────────────────────────────────────────────────────

function LockedScreen() {
  return (
    <div className={cls.page}>
      <CVCNavbar />
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-6">
          <Lock className="w-8 h-8 text-slate-400" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-3">Brambles DD Platform</h1>
        <p className="text-slate-500 text-sm leading-relaxed max-w-md mx-auto mb-6">
          Automated due diligence on Brambles Capital portfolio companies. SLAM runs independent
          third-party IC memos with agree/disagree verdicts on tier classifications — no dataroom required.
        </p>
        <p className="text-xs text-slate-400 border border-slate-200 rounded-lg px-4 py-3 inline-block">
          Access to this product is managed by your PSM lead. Contact Harry if you need access.
        </p>
      </div>
    </div>
  );
}

// ── Main Portal ───────────────────────────────────────────────────────────────

export default function BramblesPortal() {
  const navigate  = useNavigate();
  const user      = api.getCurrentUser();

  const [companies, setCompanies] = useState<BramblesCompany[]>([]);
  const [loading, setLoading]     = useState(true);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [filter, setFilter]       = useState<'all' | 'pending' | 'pending_review' | 'complete'>('all');
  const [showMethodology, setShowMethodology] = useState(false);

  const canManage = FULL_ACCESS_ROLES.includes(user?.role ?? '');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/brambles/companies', { headers: AUTH });
      if (r.ok) setCompanies(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runAnalysis(id: number) {
    setRunningId(id);
    try {
      await fetch(`/brambles/companies/${id}/run`, { method: 'POST', headers: AUTH });
      setTimeout(load, 2000);
    } finally { setRunningId(null); }
  }

  if (!hasAccess(user)) return <LockedScreen />;

  const filtered = companies.filter(c => {
    const ds = displayStatus(c);
    if (filter === 'all') return true;
    return ds === filter;
  });

  const counts = {
    total:         companies.length,
    complete:      companies.filter(c => displayStatus(c) === 'complete').length,
    pending:       companies.filter(c => displayStatus(c) === 'pending').length,
    pendingReview: companies.filter(c => displayStatus(c) === 'pending_review').length,
  };

  return (
    <div className={cls.page}>
      <CVCNavbar />
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Partner Product</span>
              <span className="text-[10px] text-slate-300">·</span>
              <span className="text-[10px] font-semibold text-teal-600">Brambles Capital</span>
            </div>
            <h1 className={cls.pageTitle}>Brambles DD Platform</h1>
            <p className="text-sm text-slate-500 mt-1">
              Independent third-party IC memos for Brambles Strategic Fund portfolio companies.
              SLAM provides agree / disagree / partial verdicts on each tier classification.
            </p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {/* Methodology panel */}
        <div className={`${cls.card} mb-6 overflow-hidden`}>
          <button
            onClick={() => setShowMethodology(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <GitBranch className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-semibold text-slate-600">How It Works — Methodology</span>
            </div>
            {showMethodology
              ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {showMethodology && (
            <div className="border-t border-slate-100 px-4 py-4 grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Step 1 */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                  <span className="text-xs font-bold text-slate-700">Web Enrichment</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed mb-2">
                  SLAM runs four evidence-gathering rounds per company using Brave Search — no dataroom required.
                  Each round builds a cited source index that LLM synthesis references inline.
                </p>
                <div className="space-y-1">
                  {[
                    ['D1–D5', 'Deployment', 'Customer names, pilots, contracts'],
                    ['F1–F4', 'Funding',     'Rounds, investors, amounts'],
                    ['R1–R4', 'Reputation',  'Awards, partnerships, press'],
                    ['G1–G4', 'Founding Team','Backgrounds, exits, credentials'],
                  ].map(([code, label, desc]) => (
                    <div key={code} className="flex items-start gap-1.5">
                      <span className="text-[10px] font-mono font-bold text-teal-600 mt-0.5 w-10 shrink-0">{code}</span>
                      <span className="text-[10px] text-slate-500"><span className="font-semibold text-slate-600">{label}</span> — {desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 2 */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                  <span className="text-xs font-bold text-slate-700">IC Memo Generation</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed mb-2">
                  Evidence is synthesized into a structured IC memo. SLAM renders an independent verdict on
                  each of Brambles' tier assignments — <span className="font-semibold text-slate-600">Agree</span>, <span className="font-semibold text-slate-600">Disagree</span>, or <span className="font-semibold text-slate-600">Partial</span>.
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Memo sections: Background · Deployment Evidence · Customer Evidence · Founding Team · Summary.
                  Every claim is source-cited back to the original search result.
                </p>
              </div>

              {/* Step 3 */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
                  <span className="text-xs font-bold text-slate-700">Analyst Review</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed mb-2">
                  Analyst opens each company's memo and votes Agree / Neutral / Disagree on every claim with
                  optional written notes. Confirmed verdicts are locked with colored annotations.
                </p>
                <div className="space-y-1">
                  {[
                    ['Finish Review', 'Locks all verdicts and triggers the final memo agent'],
                    ['Memo Agent',    'Generates a full prose SLAM IC memo with recommendation (Pursue / Monitor / Pass)'],
                    ['Learning Loop', 'Disagree rates per section feed back into future enrichment prompts'],
                  ].map(([label, desc]) => (
                    <div key={label} className="flex items-start gap-1.5">
                      <FileCheck className="w-3 h-3 text-teal-500 mt-0.5 shrink-0" />
                      <span className="text-[10px] text-slate-500"><span className="font-semibold text-slate-600">{label}</span> — {desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Companies', value: counts.total,         color: 'text-slate-700' },
            { label: 'Complete',        value: counts.complete,      color: 'text-emerald-600' },
            { label: 'Pending Review',  value: counts.pendingReview, color: 'text-sky-600' },
            { label: 'Pending',         value: counts.pending,       color: 'text-amber-600' },
          ].map(k => (
            <div key={k.label} className={`${cls.card} px-4 py-3`}>
              <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400 mt-0.5">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-4 border-b border-slate-200">
          {([
            ['all',           'All',            null],
            ['pending',       'Pending',        counts.pending],
            ['pending_review','Pending Review', counts.pendingReview],
            ['complete',      'Complete',       counts.complete],
          ] as const).map(([k, label, count]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors -mb-px ${
                filter === k
                  ? 'border-slate-800 text-slate-800'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {label}
              {count !== null && (
                <span className="ml-1.5 text-[10px] text-slate-400">({count})</span>
              )}
            </button>
          ))}
        </div>

        {/* Company table */}
        {loading ? (
          <p className="text-sm text-slate-400 py-8 text-center">Loading…</p>
        ) : (
          <div className={cls.card}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 px-4 py-3">Company</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 px-4 py-3">Brambles Tier</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 px-4 py-3">SLAM Assessment</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 px-4 py-3">Status</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 px-4 py-3">Updated</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const ds = displayStatus(c);
                  const sc = STATUS_CONFIG[ds] ?? STATUS_CONFIG.pending;
                  const tierColor = TIER_COLORS[c.tier ?? ''] ?? '#6b7280';
                  return (
                    <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3">
                        {c.cvc_company_id ? (
                          <Link to={`/companies/${c.cvc_company_id}`}
                            className="font-semibold text-slate-800 hover:text-sky-600 transition-colors">
                            {c.company_name}
                          </Link>
                        ) : (
                          <div className="font-semibold text-slate-800">{c.company_name}</div>
                        )}
                        {c.website && (
                          <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                            target="_blank" rel="noreferrer"
                            className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-0.5 mt-0.5">
                            {c.website.replace(/^https?:\/\/(www\.)?/, '')}
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {c.analyst_tier ? (
                          <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                            {c.analyst_tier}
                          </span>
                        ) : <span className="text-xs text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {c.tier ? (
                          <span className="text-xs font-bold px-2 py-0.5 rounded"
                            style={{ color: tierColor, backgroundColor: tierColor + '15' }}>
                            {c.tier}
                          </span>
                        ) : c.composite_score != null ? (
                          <span className="text-xs text-slate-500">{c.composite_score.toFixed(1)} pts</span>
                        ) : <span className="text-xs text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full w-fit"
                          style={{ color: sc.color, backgroundColor: sc.bg }}>
                          {sc.icon} {sc.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[10px] text-slate-400">{fmtDate(c.updated_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          {(ds === 'pending_review' || ds === 'complete') && (
                            <button
                              onClick={() => navigate(`/brambles/review/${c.id}`)}
                              className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-800 font-semibold transition-colors"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              {ds === 'complete' ? 'View Memo' : 'Review'}
                            </button>
                          )}
                          {(c.status === 'pending' || c.status === 'error') && canManage && (
                            <button
                              onClick={() => runAnalysis(c.id)}
                              disabled={runningId === c.id}
                              className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 rounded px-2 py-0.5 hover:bg-slate-50 transition-colors disabled:opacity-40"
                            >
                              <Play className="w-3 h-3" />
                              {runningId === c.id ? 'Starting…' : 'Run DD'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                      No companies match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
