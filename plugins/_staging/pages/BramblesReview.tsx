/**
 * BramblesReview — Analyst review page for a single Brambles pipeline company.
 * Route: /brambles/review/:id
 *
 * Left sidebar: startup classification + section-level importance weights (saved to DB).
 * Section weights auto-feed as the default importance on each claim — analyst can override.
 * Right: claim cards with source links, verdict buttons, per-claim importance + notes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  CheckCircle2, XCircle, MinusCircle, ChevronLeft,
  ExternalLink, AlertTriangle, Save, Loader2, FileText, ArrowRight,
  Download, RotateCcw, Sparkles,
} from 'lucide-react';
import { AUTH_HEADER as AUTH } from '../api/client';


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Source { title: string; url: string; snippet?: string; }

interface KeyFact {
  text:    string;
  sources: Source[];
}

interface Enrichment {
  web_search_ran:                  boolean;
  enrichment_confidence:           string;
  has_live_deployment:             boolean;
  deployment_evidence:             string;
  deployment_sources:              Source[];
  customer_names:                  string[];
  customer_sources:                Source[];
  has_signed_contracts:            boolean;
  founder_names:                   string[];
  founder_background:              string;
  founder_sources:                 Source[];
  founder_supply_chain_experience: boolean;
  founder_prior_exits:             boolean;
  key_facts:                       KeyFact[];
}

interface Memo {
  tier:                number;
  tier_label:          string;
  composite_score:     number | null;
  strategic_rationale: string;
  one_liner:           string;
  stage:               string;
  hq:                  string;
  founded_year:        number;
  employees:           number;
  raised_usd_m:        number;
  bottleneck_fit:      string;
  theme_alignment:     string[];
  enrichment:          Enrichment;
  flags:               string[];
  rubric_breakdown:    Record<string, { score: number; max: number; notes: string[] }>;
  fund_fit_detail:     Record<string, { ownership_pct: number | null; passes_constraint: boolean | null }>;
  note:                string;
}

interface Company {
  id:                   number;
  company_name:         string;
  website?:             string;
  sector?:              string;
  funding_stage?:       string;
  raised_usd_m?:        number;
  tier?:                number;
  tier_label?:          string;
  composite_score?:     number;
  strategic_rationale?: string;
  analyst_tier?:        string;
  review_status?:       string;
  review_memo_json?:    Record<string, any>;
  review_memo_url?:     string | null;
  ic_memo_json?:        Memo;
}

type Verdict    = 'agree' | 'disagree' | 'neutral';
type Importance = 1 | 2 | 3 | 4 | 5;
type StageGroup = 'early' | 'growth' | 'late';

const IMPORTANCE_LABELS: Record<Importance, string> = {
  1: 'Not Important',
  2: 'Minor',
  3: 'Moderate',
  4: 'Important',
  5: 'Critical',
};

const IMPORTANCE_COLORS: Record<Importance, { pill: string; dot: string }> = {
  1: { pill: 'bg-slate-100 text-slate-500 border-slate-200',   dot: 'bg-slate-300' },
  2: { pill: 'bg-slate-100 text-slate-600 border-slate-200',   dot: 'bg-slate-400' },
  3: { pill: 'bg-amber-50  text-amber-700 border-amber-200',   dot: 'bg-amber-400' },
  4: { pill: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  5: { pill: 'bg-red-50    text-red-700   border-red-200',     dot: 'bg-red-600'   },
};

interface FeedbackItem  { verdict: Verdict; note: string; importance?: Importance; confirmed?: boolean }
interface FeedbackState { [key: string]: FeedbackItem }

// ---------------------------------------------------------------------------
// Startup type / stage detection + default weight tables
// ---------------------------------------------------------------------------

const STARTUP_TYPES = [
  'Robotics / Automation',
  'AI / Machine Learning',
  'Supply Chain Software',
  'IoT / Hardware',
  'Computer Vision',
  'Digital Twin',
  'Deep Tech / Other',
] as const;

// Review sections — key matches section prefix in fkey(), label shown in sidebar
const REVIEW_SECTIONS: { key: string; label: string; claimSections: string[] }[] = [
  { key: 'assessment', label: 'Overall Assessment',  claimSections: ['assessment'] },
  { key: 'deployment', label: 'Deployment Evidence', claimSections: ['deployment'] },
  { key: 'customers',  label: 'Named Customers',     claimSections: ['customers'] },
  { key: 'founders',   label: 'Founder Research',    claimSections: ['founder_bg', 'founder_sc', 'founder_exits'] },
  { key: 'key_facts',  label: 'Key Facts',           claimSections: ['key_facts'] },
  { key: 'flags',      label: 'Scoring Flags',       claimSections: ['flags'] },
  { key: 'fund_fit',   label: 'Fund Fit',            claimSections: [] },  // informational only
];

// Base importance weights by stage group
const BASE_WEIGHTS: Record<StageGroup, Record<string, Importance>> = {
  early: {
    assessment: 3, deployment: 2, customers: 2, founders: 5, key_facts: 3, flags: 4, fund_fit: 3,
  },
  growth: {
    assessment: 4, deployment: 5, customers: 5, founders: 3, key_facts: 4, flags: 4, fund_fit: 4,
  },
  late: {
    assessment: 4, deployment: 5, customers: 5, founders: 2, key_facts: 4, flags: 3, fund_fit: 5,
  },
};

// Per-type deltas applied on top of base weights
const TYPE_MODIFIERS: Record<string, Partial<Record<string, number>>> = {
  'Robotics / Automation':  { deployment: 1, fund_fit: 1 },
  'AI / Machine Learning':  { founders: 1, deployment: -1 },
  'Supply Chain Software':  { customers: 1, deployment: 1 },
  'IoT / Hardware':         { deployment: 1, fund_fit: 1 },
  'Computer Vision':        { deployment: 1 },
  'Digital Twin':           { customers: 1 },
  'Deep Tech / Other':      {},
};

function getDefaultWeights(type: string, stageGroup: StageGroup): Record<string, Importance> {
  const base = { ...BASE_WEIGHTS[stageGroup] };
  const mods = TYPE_MODIFIERS[type] ?? {};
  const result: Record<string, Importance> = {};
  for (const [section, val] of Object.entries(base)) {
    const delta = mods[section] ?? 0;
    result[section] = Math.min(5, Math.max(1, val + delta)) as Importance;
  }
  return result;
}

function detectStartupType(memo: Memo | undefined, sector: string | undefined): string {
  const all = [
    (memo?.theme_alignment ?? []).join(' '),
    memo?.bottleneck_fit ?? '',
    memo?.one_liner ?? '',
    sector ?? '',
  ].join(' ').toLowerCase();

  if (/robot|cobots?|arm\b|manipulat|automation/.test(all))                    return 'Robotics / Automation';
  if (/computer vision|cv\b|image recognit|visual inspect/.test(all))          return 'Computer Vision';
  if (/digital twin|simulation|virtual model/.test(all))                       return 'Digital Twin';
  if (/iot|sensor|hardware|device|embedded/.test(all))                         return 'IoT / Hardware';
  if (/\bai\b|machine learning|\bml\b|llm|generative|nlp|deep learning/.test(all)) return 'AI / Machine Learning';
  if (/supply chain|logistics|warehou|inventory|fulfillment|freight/.test(all)) return 'Supply Chain Software';
  return 'Deep Tech / Other';
}

function detectStageGroup(stage: string | undefined): StageGroup {
  const s = (stage ?? '').toLowerCase();
  if (/seed|pre.?seed|angel|pre.?series/.test(s)) return 'early';
  if (/series [c-z]|late.stage|growth.equity/.test(s)) return 'late';
  return 'growth';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIER_COLORS: Record<number, { bg: string; color: string }> = {
  1: { bg: '#E8F5E9', color: '#1B6F3A' },
  2: { bg: '#FFF3E0', color: '#E65100' },
  3: { bg: '#E3F2FD', color: '#1A4C7C' },
  4: { bg: '#FFEBEE', color: '#C62828' },
};

function fkey(section: string, idx: number) { return `${section}::${idx}`; }

// ---------------------------------------------------------------------------
// Source chips
// ---------------------------------------------------------------------------

function SourceChips({ sources }: { sources: Source[] }) {
  if (!sources?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {sources.map((s, i) => (
        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
          title={s.snippet || s.url}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium
                     bg-[#e8f0f5] text-[#1A4C7C] border border-[#1B3A4B]/20
                     hover:bg-[#d0e4f0] hover:text-[#1B3A4B] transition-colors max-w-[260px]">
          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">{s.title || s.url}</span>
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verdict + importance row
// ---------------------------------------------------------------------------

function VerdictRow({ k, sectionWeight, feedback, setFeedback }: {
  k: string;
  sectionWeight?: Importance;
  feedback: FeedbackState;
  setFeedback: React.Dispatch<React.SetStateAction<FeedbackState>>;
}) {
  const state     = feedback[k];
  const v         = state?.verdict;
  // Per-claim importance takes precedence; fall back to section weight as default
  const imp       = state?.importance ?? (v ? sectionWeight : undefined);
  const hasOverride = !!state?.importance;
  const confirmed = state?.confirmed ?? false;

  function pick(verdict: Verdict) {
    setFeedback(p => ({
      ...p,
      [k]: {
        verdict,
        note:      p[k]?.note ?? '',
        // Auto-fill from section weight when first picking a verdict (if no override yet)
        importance: p[k]?.importance ?? sectionWeight,
        confirmed:  false,
      },
    }));
  }
  function pickImportance(importance: Importance) {
    setFeedback(p => ({ ...p, [k]: { ...p[k], importance, confirmed: false } }));
  }
  function confirm() {
    setFeedback(p => ({ ...p, [k]: { ...p[k], confirmed: true } }));
  }
  function edit() {
    setFeedback(p => ({ ...p, [k]: { ...p[k], confirmed: false } }));
  }

  const notePlaceholder = v === 'disagree'
    ? 'Why do you disagree? Your reasoning will be included in the final memo.'
    : v === 'agree'
    ? 'Any supporting context or caveats to add?'
    : 'What would you need to verify this?';

  const VCFG = {
    agree:    { icon: CheckCircle2, active: 'bg-green-600 text-white border-green-600',   idle: 'text-green-700 border-green-300 hover:bg-green-50' },
    neutral:  { icon: MinusCircle,  active: 'bg-slate-500 text-white border-slate-500',   idle: 'text-slate-600 border-slate-300 hover:bg-slate-50' },
    disagree: { icon: XCircle,      active: 'bg-red-600 text-white border-red-600',       idle: 'text-red-700 border-red-300 hover:bg-red-50' },
  };

  return (
    <div className="mt-3 pt-2 border-t border-slate-100 space-y-2">

      {/* Verdict buttons */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {(['agree', 'neutral', 'disagree'] as Verdict[]).map(opt => {
          const cfg  = VCFG[opt];
          const Icon = cfg.icon;
          return (
            <button key={opt} onClick={() => pick(opt)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold border capitalize transition-colors
                          ${v === opt ? cfg.active : `bg-white ${cfg.idle}`}`}>
              <Icon className="w-3 h-3" />{opt}
            </button>
          );
        })}
        {confirmed && (
          <span className="ml-auto flex items-center gap-1 text-[10px] font-bold text-green-700">
            <CheckCircle2 className="w-3 h-3" />Confirmed
            <button onClick={edit}
              className="ml-2 text-[10px] text-slate-400 hover:text-slate-600 underline font-normal">
              Edit
            </button>
          </span>
        )}
      </div>

      {/* Importance scale — shown after verdict is picked, before confirm */}
      {v && !confirmed && (
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Importance</p>
            {sectionWeight && !hasOverride && (
              <span className="text-[9px] text-[#1B3A4B]/60 italic">
                ← from section default
              </span>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {([1, 2, 3, 4, 5] as Importance[]).map(n => {
              const isSelected = imp === n;
              const isDefault  = !hasOverride && sectionWeight === n;
              const col = IMPORTANCE_COLORS[n];
              return (
                <button key={n} onClick={() => pickImportance(n)}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                    isSelected
                      ? `${col.pill} border-current`
                      : isDefault
                      ? 'bg-white border-dashed border-slate-300 text-slate-400 hover:border-slate-400'
                      : 'bg-white border-slate-200 text-slate-300 hover:border-slate-400 hover:text-slate-600'
                  }`}>
                  {IMPORTANCE_LABELS[n]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Note + Confirm */}
      {v && !confirmed && (
        <div className="space-y-1.5 mt-2">
          <textarea
            value={state?.note ?? ''}
            onChange={e => setFeedback(p => ({ ...p, [k]: { ...p[k], note: e.target.value } }))}
            placeholder={notePlaceholder}
            rows={2}
            className="w-full text-xs px-2.5 py-2 border border-slate-200 rounded bg-white
                       focus:outline-none focus:border-[#1B3A4B] text-slate-700 resize-none leading-relaxed"
          />
          <button onClick={confirm}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold
                       bg-[#1B3A4B] text-white hover:bg-[#2a5068] transition-colors">
            <CheckCircle2 className="w-3 h-3" />Confirm
          </button>
        </div>
      )}

      {/* Locked confirmed state */}
      {confirmed && (
        <div className="space-y-1">
          {imp && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${IMPORTANCE_COLORS[imp].pill}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${IMPORTANCE_COLORS[imp].dot}`} />
              {IMPORTANCE_LABELS[imp]}
            </span>
          )}
          {state?.note && (
            <p className="text-[11px] text-slate-600 italic border-l-2 border-slate-300 pl-2.5 leading-relaxed">
              "{state.note}"
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Claim card
// ---------------------------------------------------------------------------

function ClaimCard({ section, idx, label, text, badge, sources, sectionWeight, feedback, setFeedback }: {
  section: string; idx: number; label?: string; text: string;
  badge?: React.ReactNode; sources?: Source[];
  sectionWeight?: Importance;
  feedback: FeedbackState;
  setFeedback: React.Dispatch<React.SetStateAction<FeedbackState>>;
}) {
  const k         = fkey(section, idx);
  const state     = feedback[k];
  const v         = state?.verdict;
  const confirmed = state?.confirmed;
  const borderColor = !v         ? '#e2e8f0'
    : !confirmed                 ? (v === 'agree' ? '#86efac' : v === 'disagree' ? '#fca5a5' : '#cbd5e1')
    : v === 'agree'              ? '#1B6F3A'
    : v === 'disagree'           ? '#C62828'
    :                              '#64748b';
  return (
    <div className="p-3 rounded-lg bg-white border transition-all mb-2" style={{ borderColor }}>
      {label && <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{label}</div>}
      <div className="flex items-start gap-2">
        <p className="text-sm text-slate-700 leading-relaxed flex-1">{text}</p>
        {badge}
      </div>
      <SourceChips sources={sources ?? []} />
      <VerdictRow k={k} sectionWeight={sectionWeight} feedback={feedback} setFeedback={setFeedback} />
    </div>
  );
}

function SectionHead({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-1.5 border-b-2 border-[#1B3A4B]/20">
      <h2 className="text-sm font-bold text-[#1B3A4B] uppercase tracking-wide">{title}</h2>
      {count != null && (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#e8f0f5] text-[#1B3A4B]">{count}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section Weights Sidebar
// ---------------------------------------------------------------------------

function SectionWeightsSidebar({
  startupType, setStartupType,
  stageGroup,  setStageGroup,
  weights, onWeightChange, onApplyDefaults,
  onSave, saving, saved,
}: {
  startupType: string;
  setStartupType: (t: string) => void;
  stageGroup: StageGroup;
  setStageGroup: (g: StageGroup) => void;
  weights: Record<string, Importance>;
  onWeightChange: (section: string, imp: Importance) => void;
  onApplyDefaults: () => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}) {
  return (
    <div className="sticky top-[60px] bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">

      {/* Header */}
      <div className="bg-[#1B3A4B] px-4 py-3">
        <div className="text-[10px] font-bold text-[#8FA4B2] uppercase tracking-widest mb-0.5">Review Framework</div>
        <div className="text-xs text-white font-semibold">Section Importance</div>
      </div>

      <div className="p-4 space-y-4">

        {/* Startup classification */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Startup Type</div>
          <select
            value={startupType}
            onChange={e => setStartupType(e.target.value)}
            className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded bg-[#ede8d7]
                       font-medium text-slate-700 focus:outline-none focus:border-[#1B3A4B]">
            {STARTUP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Stage</div>
          <select
            value={stageGroup}
            onChange={e => setStageGroup(e.target.value as StageGroup)}
            className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded bg-[#ede8d7]
                       font-medium text-slate-700 focus:outline-none focus:border-[#1B3A4B]">
            <option value="early">Early Stage (Pre-Seed / Seed)</option>
            <option value="growth">Growth (Series A / B)</option>
            <option value="late">Late Stage (Series C+)</option>
          </select>
        </div>

        {/* Apply defaults button */}
        <button onClick={onApplyDefaults}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold
                     bg-[#1B3A4B]/8 text-[#1B3A4B] border border-[#1B3A4B]/20
                     hover:bg-[#1B3A4B] hover:text-white transition-colors">
          <Sparkles className="w-3 h-3" />Apply Defaults
        </button>

        <div className="border-t border-slate-100" />

        {/* Section importance pickers */}
        <div className="space-y-3">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Per Section</div>

          {REVIEW_SECTIONS.map(({ key, label }) => {
            const imp = weights[key];
            const col = imp ? IMPORTANCE_COLORS[imp] : null;
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-slate-600">{label}</span>
                  {imp && col && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${col.pill}`}>
                      {IMPORTANCE_LABELS[imp]}
                    </span>
                  )}
                </div>
                {/* 5-pip importance selector */}
                <div className="flex gap-1">
                  {([1, 2, 3, 4, 5] as Importance[]).map(n => {
                    const active = imp === n;
                    const pipCol = IMPORTANCE_COLORS[n];
                    return (
                      <button key={n} onClick={() => onWeightChange(key, n)}
                        title={IMPORTANCE_LABELS[n]}
                        className={`flex-1 h-5 rounded-sm border transition-all text-[9px] font-bold ${
                          active
                            ? `${pipCol.dot} border-transparent text-white`
                            : 'bg-white border-slate-200 text-slate-300 hover:border-slate-400 hover:text-slate-500'
                        }`}>
                        {n}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Save weights */}
        <button onClick={onSave} disabled={saving}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold
                     bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" />
           : saved  ? <CheckCircle2 className="w-3 h-3" />
           : <Save className="w-3 h-3" />}
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save Weights'}
        </button>

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BramblesReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [company,        setCompany]        = useState<Company | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [feedback,       setFeedback]       = useState<FeedbackState>({});
  const feedbackRef = useRef<FeedbackState>({});
  const [saving,         setSaving]         = useState(false);
  const [saved,          setSaved]          = useState(false);
  const [finishing,      setFinishing]      = useState(false);
  const [finalized,      setFinalized]      = useState(false);
  const [memoReady,      setMemoReady]      = useState(false);
  const [memoFailed,     setMemoFailed]     = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Section weights state
  const [sectionWeights,  setSectionWeights]  = useState<Record<string, Importance>>({});
  const [startupType,     setStartupType]     = useState<string>('Deep Tech / Other');
  const [stageGroup,      setStageGroup]      = useState<StageGroup>('growth');
  const [weightsSaving,   setWeightsSaving]   = useState(false);
  const [weightsSaved,    setWeightsSaved]    = useState(false);
  const initialLoadDone = useRef(false);

  // Keep ref in sync so handleSave always reads latest feedback
  const setFeedbackSync = (updater: React.SetStateAction<FeedbackState>) => {
    setFeedback(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      feedbackRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/brambles/companies/${id}`, { headers: AUTH }).then(r => r.json()),
      fetch(`/brambles/companies/${id}/feedback`, { headers: AUTH }).then(r => r.json()),
    ]).then(async ([comp, fb]) => {
      setCompany(comp);
      if (comp.review_status === 'finalized' || comp.review_status === 'generation_failed') setFinalized(true);
      if (comp.review_status === 'generation_failed') setMemoFailed(true);
      if (comp.review_memo_json || comp.review_memo_url) setMemoReady(true);

      // Restore feedback
      const state: FeedbackState = {};
      for (const row of (fb as any[])) {
        const note = row.note ?? '';
        state[fkey(row.section, row.item_index)] = {
          verdict:    row.verdict,
          note,
          importance: row.importance ?? undefined,
          confirmed:  note.trim().length > 0 || !!row.importance,
        };
      }
      feedbackRef.current = state;
      setFeedback(state);

      // Auto-detect type/stage, then fetch saved weights for that combo
      const memo = comp.ic_memo_json as Memo | undefined;
      const detectedType  = detectStartupType(memo, comp.sector);
      const detectedStage = detectStageGroup(comp.funding_stage ?? memo?.stage);
      setStartupType(detectedType);
      setStageGroup(detectedStage);

      const params = new URLSearchParams({ startup_type: detectedType, stage_group: detectedStage });
      const wts: any[] = await fetch(`/brambles/companies/${id}/weights?${params}`, { headers: AUTH }).then(r => r.json());
      if (wts.length > 0) {
        const restored: Record<string, Importance> = {};
        for (const w of wts) restored[w.section] = w.importance as Importance;
        setSectionWeights(restored);
      } else {
        setSectionWeights(getDefaultWeights(detectedType, detectedStage));
      }
      initialLoadDone.current = true;
    }).finally(() => setLoading(false));
  }, [id]);

  // Re-fetch saved weights when type or stage changes (skip on initial load)
  useEffect(() => {
    if (!id || !initialLoadDone.current) return;
    const params = new URLSearchParams({ startup_type: startupType, stage_group: stageGroup });
    fetch(`/brambles/companies/${id}/weights?${params}`, { headers: AUTH })
      .then(r => r.json())
      .then((wts: any[]) => {
        if (wts.length > 0) {
          const restored: Record<string, Importance> = {};
          for (const w of wts) restored[w.section] = w.importance as Importance;
          setSectionWeights(restored);
        } else {
          setSectionWeights(getDefaultWeights(startupType, stageGroup as StageGroup));
        }
      });
  }, [id, startupType, stageGroup]);

  // Poll for memo after finish-review
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const comp = await fetch(`/brambles/companies/${id}`, { headers: AUTH }).then(r => r.json());
      if (comp.review_memo_json) {
        setMemoReady(true);
        setMemoFailed(false);
        setCompany(comp);
        clearInterval(pollRef.current!);
        pollRef.current = null;
      } else if (comp.review_status === 'generation_failed') {
        setMemoFailed(true);
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
    }, 4000);
  }, [id]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Apply a section weight to all unconfirmed claims in that section
  const applySection = useCallback((sectionKey: string, importance: Importance) => {
    const sec = REVIEW_SECTIONS.find(s => s.key === sectionKey);
    if (!sec) return;
    const prefixes = sec.claimSections;
    setFeedbackSync(prev => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        const prefix = k.split('::')[0];
        if (prefixes.includes(prefix) && !next[k].confirmed) {
          next[k] = { ...next[k], importance };
        }
      }
      return next;
    });
  }, []);

  // Handle section weight change: update state + propagate to claims
  const handleWeightChange = useCallback((section: string, imp: Importance) => {
    setSectionWeights(prev => ({ ...prev, [section]: imp }));
    applySection(section, imp);
  }, [applySection]);

  // Apply all defaults based on current type + stage
  const handleApplyDefaults = useCallback(() => {
    const defaults = getDefaultWeights(startupType, stageGroup);
    setSectionWeights(defaults);
    for (const [section, imp] of Object.entries(defaults)) {
      applySection(section, imp as Importance);
    }
  }, [startupType, stageGroup, applySection]);

  const handleSaveWeights = useCallback(async () => {
    if (!id) return;
    setWeightsSaving(true);
    await fetch(`/brambles/companies/${id}/weights`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startup_type: startupType, stage_group: stageGroup, weights: sectionWeights }),
    });
    setWeightsSaving(false);
    setWeightsSaved(true);
    setTimeout(() => setWeightsSaved(false), 3000);
  }, [id, startupType, stageGroup, sectionWeights]);

  const handleSave = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    const memo = company?.ic_memo_json;
    const enr  = memo?.enrichment ?? {} as Enrichment;

    const TEXT: Record<string, (i: number) => string> = {
      assessment:     () => memo?.strategic_rationale ?? '',
      deployment:     () => enr.deployment_evidence   ?? '',
      customers:      i  => enr.customer_names?.[i]   ?? '',
      founder_bg:     () => enr.founder_background    ?? '',
      founder_sc:     () => `Supply chain experience: ${enr.founder_supply_chain_experience ? 'yes' : 'not confirmed'}`,
      founder_exits:  () => `Prior exits: ${enr.founder_prior_exits ? 'yes' : 'not confirmed'}`,
      key_facts:      i  => (enr.key_facts?.[i] as any)?.text ?? (enr.key_facts?.[i] as any) ?? '',
      flags:          i  => memo?.flags?.[i] ?? '',
    };

    const items = Object.entries(feedbackRef.current).map(([k, val]) => {
      const [section, idx] = k.split('::');
      const i = parseInt(idx);
      const item_text = TEXT[section]?.(i) ?? k;
      return { section, item_index: i, item_text, ...val };
    });

    await fetch(`/brambles/companies/${id}/feedback`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }, [id, company]);

  const handleFinish = useCallback(async () => {
    if (!id) return;
    setFinishing(true);
    await handleSave();
    const res = await fetch(`/brambles/companies/${id}/finish-review`, {
      method: 'POST', headers: AUTH,
    });
    if (res.ok) {
      setFinalized(true);
      startPolling();
    }
    setFinishing(false);
  }, [id, handleSave, startPolling]);

  // Tier delta
  const bramblesTierNum = company
    ? parseInt((company.analyst_tier ?? '').replace('Tier ', '')) || null
    : null;
  const cvcTierNum = company?.tier ?? null;
  const tierDelta = (bramblesTierNum && cvcTierNum) ? cvcTierNum - bramblesTierNum : null;

  if (loading) return (
    <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-[#1B3A4B]" />
    </div>
  );
  if (!company) return (
    <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center text-slate-500">Company not found.</div>
  );

  const memo = company.ic_memo_json;
  const enr  = memo?.enrichment ?? {} as Enrichment;
  const tc   = TIER_COLORS[company.tier ?? 4];
  const reviewedCount  = Object.keys(feedback).length;
  const confirmedCount = Object.values(feedback).filter(f => f.confirmed).length;

  // Helper to get section weight for a given claim section prefix
  const sw = (sectionKey: string): Importance | undefined => sectionWeights[sectionKey] as Importance | undefined;
  // Map claim section prefixes → sidebar section key
  const claimSectionToKey: Record<string, string> = {};
  for (const s of REVIEW_SECTIONS) {
    for (const cs of s.claimSections) claimSectionToKey[cs] = s.key;
  }
  function claimSW(claimSection: string): Importance | undefined {
    const key = claimSectionToKey[claimSection];
    return key ? sectionWeights[key] as Importance | undefined : undefined;
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] font-sans">

      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-[#1B3A4B] text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/brambles')}
            className="flex items-center gap-1.5 text-sm text-[#C8972B] hover:text-white transition-colors">
            <ChevronLeft className="w-4 h-4" />Back
          </button>
          <div>
            <div className="font-bold text-base leading-tight">{company.company_name}</div>
            <div className="text-[11px] text-[#8FA4B2]">Brambles Fund — Analyst Review</div>
          </div>

          {tc && (
            <span className="px-2.5 py-1 rounded text-xs font-bold" style={{ background: tc.bg, color: tc.color }}>
              SLAM: Tier {company.tier} — {company.tier_label}
            </span>
          )}

          {bramblesTierNum && cvcTierNum && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[#8FA4B2]">Brambles: Tier {bramblesTierNum}</span>
              <ArrowRight className="w-3 h-3 text-[#8FA4B2]" />
              <span className="font-bold" style={{
                color: tierDelta === 0 ? '#6ee7b7'
                     : tierDelta  < 0 ? '#fbbf24'
                     :                  '#f87171',
              }}>
                {tierDelta === 0 ? 'Aligned'
                 : tierDelta < 0 ? '↑ SLAM rates higher'
                 :                 '↓ SLAM rates lower'}
              </span>
            </div>
          )}

          {company.composite_score != null && (
            <span className="text-sm text-[#8FA4B2]">
              Score: <strong className="text-white">{company.composite_score}/100</strong>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8FA4B2] mr-1">
            {confirmedCount} confirmed · {reviewedCount} voted
          </span>

          {memoReady && (<>
            <button
              onClick={() => company?.review_memo_url && window.open(company.review_memo_url, '_blank')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold
                         bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
              <FileText className="w-3.5 h-3.5" />View
            </button>
            <button
              onClick={async () => {
                const res = await fetch(`/brambles/companies/${id}/memo-pdf`, { headers: AUTH });
                if (!res.ok) return;
                const url = URL.createObjectURL(await res.blob());
                const a = document.createElement('a'); a.href = url;
                a.download = `${company?.company_name ?? 'memo'}_SLAM_Review_Memo.pdf`;
                document.body.appendChild(a); a.click();
                document.body.removeChild(a); URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold
                         bg-white/10 text-white hover:bg-white/20 border border-white/20 transition-colors">
              <Download className="w-3.5 h-3.5" />PDF
            </button>
            <button
              onClick={async () => {
                const res = await fetch(`/brambles/companies/${id}/memo-docx`, { headers: AUTH });
                if (!res.ok) return;
                const url = URL.createObjectURL(await res.blob());
                const a = document.createElement('a'); a.href = url;
                a.download = `${company?.company_name ?? 'memo'}_SLAM_Review_Memo.docx`;
                document.body.appendChild(a); a.click();
                document.body.removeChild(a); URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold
                         bg-white/10 text-white hover:bg-white/20 border border-white/20 transition-colors">
              <Download className="w-3.5 h-3.5" />DOCX
            </button>
          </>)}

          {!finalized && (
            <button onClick={handleSave} disabled={saving || reviewedCount === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#1B3A4B] text-white
                         border border-white/20 hover:bg-[#2a5068] disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
               : saved  ? <CheckCircle2 className="w-3.5 h-3.5" />
               : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
            </button>
          )}

          {finalized ? (<>
            {!memoReady && !memoFailed && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold
                               bg-slate-600 text-white/70 cursor-default">
                <Loader2 className="w-3 h-3 animate-spin" />Generating…
              </span>
            )}
            {memoFailed && (
              <button
                onClick={async () => {
                  setMemoFailed(false);
                  await fetch(`/brambles/companies/${id}/finish-review`, { method: 'POST', headers: AUTH });
                  startPolling();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold
                           bg-red-700 text-white hover:bg-red-600 transition-colors">
                <RotateCcw className="w-3 h-3" />Retry Memo
              </button>
            )}
            <button
              onClick={async () => {
                await fetch(`/brambles/companies/${id}/reopen-review`, { method: 'POST', headers: AUTH });
                setFinalized(false);
                setMemoReady(false);
                setCompany(c => c ? { ...c, review_memo_url: null, review_memo_json: undefined } : c);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold
                         text-white/60 hover:text-white border border-white/20 hover:border-white/40 transition-colors">
              <RotateCcw className="w-3 h-3" />Reopen
            </button>
          </>) : (
            <button onClick={handleFinish} disabled={finishing || reviewedCount === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#C8972B] text-white
                         hover:bg-[#b07e20] disabled:opacity-50 transition-colors">
              {finishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              {finishing ? 'Finalising…' : 'Finish Review'}
            </button>
          )}
        </div>
      </div>

      {/* Two-column body: sidebar + review content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-[280px_1fr] gap-8 items-start">

          {/* ── Left sidebar ── */}
          <SectionWeightsSidebar
            startupType={startupType}   setStartupType={t => { setStartupType(t); }}
            stageGroup={stageGroup}     setStageGroup={g => { setStageGroup(g); }}
            weights={sectionWeights}
            onWeightChange={handleWeightChange}
            onApplyDefaults={handleApplyDefaults}
            onSave={handleSaveWeights}
            saving={weightsSaving}
            saved={weightsSaved}
          />

          {/* ── Right: review sections ── */}
          <div className="space-y-10">

            {/* Overview */}
            <div>
              <SectionHead title="Overall Assessment" />
              {memo?.strategic_rationale && (
                <ClaimCard section="assessment" idx={0}
                  label="Strategic Rationale"
                  text={memo.strategic_rationale}
                  sectionWeight={claimSW('assessment')}
                  feedback={feedback} setFeedback={setFeedbackSync} />
              )}
              {memo?.one_liner && (
                <div className="p-3 rounded-lg bg-[#e8f0f5] border border-[#1B3A4B]/20 text-sm text-[#1B3A4B] italic mb-3">
                  "{memo.one_liner}"
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['Stage',     company.funding_stage ?? memo?.stage ?? '—'],
                  ['Raised',    company.raised_usd_m != null ? `$${company.raised_usd_m}M` : (memo?.raised_usd_m != null ? `$${memo.raised_usd_m}M` : '—')],
                  ['HQ',        memo?.hq ?? '—'],
                  ['Founded',   memo?.founded_year ? String(memo.founded_year) : '—'],
                  ['Employees', memo?.employees     ? String(memo.employees)   : '—'],
                  ['Process',   memo?.bottleneck_fit?.replace(/_/g, ' ') ?? '—'],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="p-2 rounded bg-white border border-slate-100 text-xs">
                    <div className="font-semibold text-[10px] text-slate-400 uppercase mb-0.5">{k}</div>
                    <div className="text-slate-700">{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Deployment */}
            <div>
              <SectionHead title="Deployment Evidence" />
              {enr.deployment_evidence ? (
                <ClaimCard section="deployment" idx={0}
                  text={enr.deployment_evidence}
                  sources={enr.deployment_sources}
                  sectionWeight={claimSW('deployment')}
                  badge={
                    <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap
                      ${enr.has_live_deployment ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-slate-100 text-slate-500'}`}>
                      {enr.has_live_deployment ? '✓ Live' : 'Unconfirmed'}
                    </span>
                  }
                  feedback={feedback} setFeedback={setFeedbackSync} />
              ) : (
                <p className="text-xs text-slate-400 italic">No deployment evidence found in web research.</p>
              )}
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold mt-1
                ${enr.has_signed_contracts ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                {enr.has_signed_contracts ? <CheckCircle2 className="w-3 h-3" /> : <MinusCircle className="w-3 h-3" />}
                {enr.has_signed_contracts ? 'Signed contracts confirmed' : 'No signed contracts confirmed'}
              </div>
            </div>

            {/* Customers */}
            {(enr.customer_names?.length ?? 0) > 0 && (
              <div>
                <SectionHead title="Named Customers" count={enr.customer_names.length} />
                {enr.customer_names.map((name, i) => (
                  <ClaimCard key={i} section="customers" idx={i}
                    text={name}
                    sources={i === 0 ? enr.customer_sources : undefined}
                    sectionWeight={claimSW('customers')}
                    feedback={feedback} setFeedback={setFeedbackSync} />
                ))}
                {enr.customer_sources?.length > 0 && enr.customer_names.length > 1 && (
                  <div className="mt-1 mb-2">
                    <div className="text-[10px] text-slate-400 italic mb-1">Sources supporting customer claims:</div>
                    <SourceChips sources={enr.customer_sources} />
                  </div>
                )}
              </div>
            )}

            {/* Founders */}
            <div>
              <SectionHead title="Founder Research" />
              {enr.founder_names?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {enr.founder_names.map(n => (
                    <span key={n} className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#e8f0f5] text-[#1B3A4B] border border-[#1B3A4B]/20">{n}</span>
                  ))}
                </div>
              )}
              {enr.founder_background && (
                <ClaimCard section="founder_bg" idx={0}
                  label="Background"
                  text={enr.founder_background}
                  sources={enr.founder_sources}
                  sectionWeight={claimSW('founder_bg')}
                  feedback={feedback} setFeedback={setFeedbackSync} />
              )}
              <ClaimCard section="founder_sc" idx={0}
                label="Supply Chain Experience"
                text={enr.founder_supply_chain_experience
                  ? 'Founders have confirmed supply chain / logistics experience'
                  : 'No supply chain experience confirmed in web research'}
                sources={enr.founder_supply_chain_experience ? enr.founder_sources : undefined}
                sectionWeight={claimSW('founder_sc')}
                badge={
                  <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap
                    ${enr.founder_supply_chain_experience ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-slate-100 text-slate-500'}`}>
                    {enr.founder_supply_chain_experience ? '✓ Yes' : 'No'}
                  </span>
                }
                feedback={feedback} setFeedback={setFeedbackSync} />
              <ClaimCard section="founder_exits" idx={0}
                label="Prior Exits"
                text={enr.founder_prior_exits
                  ? 'At least one founder has a prior exit'
                  : 'No prior exits found in web research'}
                sources={enr.founder_prior_exits ? enr.founder_sources : undefined}
                sectionWeight={claimSW('founder_exits')}
                badge={
                  <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap
                    ${enr.founder_prior_exits ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-500'}`}>
                    {enr.founder_prior_exits ? '✓ Yes' : 'No'}
                  </span>
                }
                feedback={feedback} setFeedback={setFeedbackSync} />
            </div>

            {/* Key Facts */}
            {(enr.key_facts?.length ?? 0) > 0 && (
              <div>
                <SectionHead title="Key Facts from Web Research" count={enr.key_facts.length} />
                {enr.key_facts.map((fact, i) => {
                  const text    = typeof fact === 'string' ? fact : (fact as KeyFact).text;
                  const sources = typeof fact === 'string' ? [] : (fact as KeyFact).sources;
                  return (
                    <ClaimCard key={i} section="key_facts" idx={i}
                      text={text}
                      sources={sources}
                      sectionWeight={claimSW('key_facts')}
                      feedback={feedback} setFeedback={setFeedbackSync} />
                  );
                })}
              </div>
            )}

            {/* Flags */}
            {(memo?.flags?.length ?? 0) > 0 && (
              <div>
                <SectionHead title="Scoring Engine Flags" count={memo!.flags.length} />
                {memo!.flags.map((flag, i) => (
                  <ClaimCard key={i} section="flags" idx={i}
                    text={flag}
                    sectionWeight={claimSW('flags')}
                    badge={<AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />}
                    feedback={feedback} setFeedback={setFeedbackSync} />
                ))}
              </div>
            )}

            {/* Fund Fit + Rubric */}
            {memo?.fund_fit_detail && (
              <div>
                <SectionHead title="Fund Fit" />
                {sw('fund_fit') && (
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border mb-3 ${IMPORTANCE_COLORS[sw('fund_fit')!].pill}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${IMPORTANCE_COLORS[sw('fund_fit')!].dot}`} />
                    Section rated: {IMPORTANCE_LABELS[sw('fund_fit')!]}
                  </div>
                )}
                {(() => {
                  const checks = [['$1M', 'check_1M'], ['$2.5M', 'check_2.5M'], ['$5M', 'check_5M']] as [string, string][];
                  const valuationUnknown = checks.every(([, key]) => memo.fund_fit_detail[key]?.ownership_pct == null);
                  if (valuationUnknown) {
                    return (
                      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 mb-4 text-xs text-slate-500">
                        <span className="font-semibold text-slate-400">Minority ownership check:</span>
                        Valuation unknown — enter pre-money valuation to calculate
                      </div>
                    );
                  }
                  return (
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {checks.map(([label, key]) => {
                        const d = memo.fund_fit_detail[key] ?? {};
                        const pct = d.ownership_pct;
                        const passes = d.passes_constraint;
                        return (
                          <div key={key} className={`p-3 rounded-lg border text-center
                            ${passes === true ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                            <div className="text-[10px] font-semibold text-slate-500 mb-1">{label} check</div>
                            <div className="text-lg font-bold" style={{ color: passes === true ? '#1B6F3A' : '#C62828' }}>
                              {pct != null ? `${pct.toFixed(1)}%` : '—'}
                            </div>
                            <div className="text-[10px] mt-0.5" style={{ color: passes === true ? '#1B6F3A' : '#C62828' }}>
                              {passes === true ? '✓ < 33%' : '✗ Fails'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {memo.rubric_breakdown && Object.entries(memo.rubric_breakdown).map(([dim, data]) => {
                  const sc  = data.score ?? 0;
                  const mx  = data.max   ?? 0;
                  const pct = mx ? Math.round((sc / mx) * 100) : 0;
                  const col = pct >= 70 ? '#1B6F3A' : pct >= 40 ? '#E65100' : '#C62828';
                  return (
                    <div key={dim} className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-600 font-medium">
                          {dim.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                        <span className="text-xs font-bold" style={{ color: col }}>{sc}/{mx}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: col }} />
                      </div>
                      {data.notes?.length > 0 && (
                        <p className="text-[10px] text-slate-400 mt-0.5">{data.notes.join(' · ')}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pb-12" />
          </div>{/* end right column */}
        </div>
      </div>
    </div>
  );
}
