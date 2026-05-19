/**
 * Sector Evaluation Framework
 *
 * Each Ventures associate rates 10 evaluation criteria (1–5) for every sector × stage
 * they cover. A 25-point budget forces genuine prioritization:
 *   – max 2 fields rated Critical (5)
 *   – at least 2 fields rated Minimal or Low (≤2)
 *   – all fields must be rated before saving
 *
 * Saved weights are compared across the team to surface investment-style differences.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import CVCNavbar from '../components/CVCNavbar';
import { cls } from '../components/tokens';
import {
  ChevronLeft, Plus, Trash2, CheckCircle2, BarChart3,
  AlertTriangle, Save, RefreshCw, X, Users, HelpCircle, Pencil,
} from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTORS = ['Robotics', 'Supply Chain', 'Manufacturing', 'Industrial Automation', 'Physical AI'];
const STAGES  = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C'];
const SECTIONS = ['Team', 'Market', 'Technology', 'Business'];

// Budget scales with field count: round(defaultCount × 2.5) + customCount × 2
// For 19 default fields → 48 pts budget
const CUSTOM_FIELD_BONUS =  2;   // each custom field adds 2 to budget
const BUDGET_TOLERANCE   =  4;   // ±4 from budget is acceptable
const MAX_CRITICAL        =  3;   // max 3 fields rated Critical (5) out of 19
const MIN_LOW             =  4;   // at least 4 fields rated Minimal or Low (≤2)

const VENTURES_TEAM = ['nate', 'jerry', 'harvey', 'harshal'];

const IMP_LABELS: Record<number, string> = {
  1: 'Minimal', 2: 'Low', 3: 'Medium', 4: 'High', 5: 'Critical',
};

const IMP_COLORS: Record<number, { pill: string; dot: string; bar: string }> = {
  1: { pill: 'bg-slate-100 text-slate-500 border-slate-300',   dot: 'bg-slate-300',  bar: '#94a3b8' },
  2: { pill: 'bg-sky-50   text-sky-600   border-sky-300',      dot: 'bg-sky-400',    bar: '#38bdf8' },
  3: { pill: 'bg-amber-50 text-amber-700 border-amber-300',    dot: 'bg-amber-400',  bar: '#fbbf24' },
  4: { pill: 'bg-orange-50 text-orange-700 border-orange-300', dot: 'bg-orange-400', bar: '#f97316' },
  5: { pill: 'bg-red-50   text-red-700   border-red-300',      dot: 'bg-red-500',    bar: '#ef4444' },
};

// Stage defaults — each sums to 48 across 19 default fields (round(19 × 2.5)).
// Max 3 Critical (5), min 4 Low/Minimal (≤2). Applied only to unrated fields on click.
const STAGE_DEFAULTS: Record<string, Record<string, number>> = {
  // Pre-seed: bet on the team + market thesis. Traction/revenue not yet meaningful.
  'Pre-seed': {
    'Founding Team Quality':               5,
    'Founder-Market Fit':                  5,
    'Market Size & Timing':                4,
    'Technical Defensibility':             3,
    'SLAM Thesis Fit':                      3,
    'Capital Efficiency':                  3,
    'Team Completeness':                   3,
    'Customer Pull Evidence':              2,
    'Market Structure':                    2,
    'Macro & Regulatory Tailwinds':        2,
    'Product Maturity':                    2,
    'Data & Network Effects':              2,
    'Business Model Clarity':              2,
    'Talent Density & Velocity':           2,
    'Competitive Position':                2,
    'Integration Complexity':              1,
    'Revenue Quality':                     1,
    'Exit Pathways & Acquirer Universe':   1,
    'Industrial Resilience & Sovereignty': 1,
  },
  // Seed: team still central, but market evidence + tech defensibility become decisive.
  'Seed': {
    'Founding Team Quality':               5,
    'Market Size & Timing':                4,
    'Technical Defensibility':             4,
    'Customer Pull Evidence':              3,
    'Capital Efficiency':                  3,
    'Team Completeness':                   3,
    'SLAM Thesis Fit':                      3,
    'Founder-Market Fit':                  3,
    'Business Model Clarity':              3,
    'Product Maturity':                    2,
    'Competitive Position':                2,
    'Market Structure':                    2,
    'Data & Network Effects':              2,
    'Macro & Regulatory Tailwinds':        2,
    'Talent Density & Velocity':           2,
    'Integration Complexity':              2,
    'Revenue Quality':                     1,
    'Exit Pathways & Acquirer Universe':   1,
    'Industrial Resilience & Sovereignty': 1,
  },
  // Series A: traction and business model must be proven; team quality becomes table stakes.
  'Series A': {
    'Customer Pull Evidence':              5,
    'Business Model Clarity':              4,
    'Technical Defensibility':             4,
    'Market Size & Timing':                4,
    'Competitive Position':                3,
    'Revenue Quality':                     3,
    'Capital Efficiency':                  3,
    'SLAM Thesis Fit':                      3,
    'Founding Team Quality':               2,
    'Market Structure':                    2,
    'Product Maturity':                    2,
    'Data & Network Effects':              2,
    'Team Completeness':                   2,
    'Macro & Regulatory Tailwinds':        2,
    'Founder-Market Fit':                  2,
    'Talent Density & Velocity':           2,
    'Integration Complexity':              1,
    'Exit Pathways & Acquirer Universe':   1,
    'Industrial Resilience & Sovereignty': 1,
  },
  // Series B: competitive moat, revenue quality, and exit horizon dominate.
  'Series B': {
    'Competitive Position':                5,
    'Customer Pull Evidence':              5,
    'Business Model Clarity':              4,
    'Revenue Quality':                     4,
    'Technical Defensibility':             3,
    'Data & Network Effects':              3,
    'Exit Pathways & Acquirer Universe':   3,
    'Market Size & Timing':                2,
    'SLAM Thesis Fit':                      2,
    'Capital Efficiency':                  2,
    'Product Maturity':                    2,
    'Market Structure':                    2,
    'Founding Team Quality':               2,
    'Macro & Regulatory Tailwinds':        2,
    'Integration Complexity':              2,
    'Talent Density & Velocity':           2,
    'Team Completeness':                   1,
    'Founder-Market Fit':                  1,
    'Industrial Resilience & Sovereignty': 1,
  },
  // Series C: business perfection, exit clarity, and durable competitive position.
  'Series C': {
    'Competitive Position':                5,
    'Business Model Clarity':              5,
    'Revenue Quality':                     4,
    'Customer Pull Evidence':              4,
    'Exit Pathways & Acquirer Universe':   4,
    'Data & Network Effects':              3,
    'Technical Defensibility':             3,
    'Market Size & Timing':                3,
    'SLAM Thesis Fit':                      2,
    'Capital Efficiency':                  2,
    'Market Structure':                    2,
    'Product Maturity':                    2,
    'Industrial Resilience & Sovereignty': 2,
    'Macro & Regulatory Tailwinds':        2,
    'Founding Team Quality':               1,
    'Talent Density & Velocity':           1,
    'Integration Complexity':              1,
    'Team Completeness':                   1,
    'Founder-Market Fit':                  1,
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface EvalField {
  id: number;
  section: string;
  field_name: string;
  description: string | null;
  is_default: boolean;
  created_by: string | null;
}

interface SubsectorInfo {
  id: number;
  subsector: string;
  created_by: string | null;
}

interface CompletionEntry {
  sector: string;
  subsector: string;
  stage: string;
  last_saved: string;
}

interface TeamRow {
  evaluator: string;
  field_id: number;
  field_name: string;
  section: string;
  importance: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders() {
  const t = localStorage.getItem('cvc_jwt');   // app stores JWT under 'cvc_jwt'
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

function computeBudget(fields: EvalField[]) {
  const defaultCount = fields.filter(f => f.is_default).length;
  const customCount  = fields.filter(f => !f.is_default).length;
  return Math.round(defaultCount * 2.5) + customCount * CUSTOM_FIELD_BONUS;
}

type BudgetStatus = 'empty' | 'low' | 'over' | 'ok';
function budgetStatus(spent: number, budget: number): BudgetStatus {
  if (spent === 0) return 'empty';
  if (spent < budget - BUDGET_TOLERANCE) return 'low';
  if (spent > budget + BUDGET_TOLERANCE) return 'over';
  return 'ok';
}

const BUDGET_BAR_COLOR: Record<BudgetStatus, string> = {
  empty: 'bg-slate-200',
  low:   'bg-amber-400',
  ok:    'bg-emerald-500',
  over:  'bg-red-500',
};

// ── Pip selector ──────────────────────────────────────────────────────────────

function PipSelector({ value, onChange, onReset }: {
  value: number;
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {/* Reset button — only shown when rated */}
      {value > 0 ? (
        <button
          onClick={onReset}
          title="Clear rating"
          className="text-slate-300 hover:text-slate-500 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      ) : (
        <span className="w-3 h-3" />
      )}
      {[1, 2, 3, 4, 5].map(n => {
        const active = value >= n;
        return (
          <button
            key={n}
            onClick={() => onChange(n)}
            title={IMP_LABELS[n]}
            className={`w-4 h-4 rounded-full border-2 transition-all hover:scale-125 ${
              active
                ? `${IMP_COLORS[n].dot} border-transparent`
                : 'bg-white border-slate-200 hover:border-slate-400'
            }`}
          />
        );
      })}
      {value > 0 && (
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${IMP_COLORS[value].pill}`}>
          {IMP_LABELS[value]}
        </span>
      )}
      {value === 0 && (
        <span className="text-[10px] text-slate-400 italic">unrated</span>
      )}
    </div>
  );
}

// ── Field row ─────────────────────────────────────────────────────────────────

function FieldRow({ field, importance, onChange, onDelete, me }: {
  field: EvalField;
  importance: number;
  onChange: (v: number) => void;
  onDelete?: () => void;
  me: string;
}) {
  const [showDesc, setShowDesc] = useState(false);
  const canDelete = !field.is_default && field.created_by === me;

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-lg transition-colors ${
      importance > 0 ? 'bg-white' : 'bg-slate-50/60'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-medium ${importance > 0 ? 'text-slate-800' : 'text-slate-500'}`}>
            {field.field_name}
          </span>
          {!field.is_default && (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-violet-50 text-violet-600 border border-violet-200 uppercase tracking-wide">
              Custom
            </span>
          )}
          {field.description && (
            <button
              onClick={() => setShowDesc(s => !s)}
              className="text-slate-300 hover:text-slate-500 transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {showDesc && field.description && (
          <p className="mt-1 text-[11px] text-slate-500 leading-relaxed max-w-xl">
            {field.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <PipSelector
          value={importance}
          onChange={onChange}
          onReset={() => onChange(0)}
        />
        {canDelete && (
          <button
            onClick={onDelete}
            title="Delete custom field"
            className="text-slate-300 hover:text-red-400 transition-colors ml-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Add custom field inline form ──────────────────────────────────────────────

function AddFieldForm({ section, onAdd, onCancel }: {
  section: string;
  onAdd: (name: string, desc: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  return (
    <div className="mt-2 p-3 rounded-lg border border-dashed border-violet-300 bg-violet-50/40 space-y-2">
      <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wide">
        Add field to {section}
      </p>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Field name (e.g. Hardware BOM Risk)"
        className={`${cls.inputFull} text-sm`}
        autoFocus
      />
      <input
        value={desc}
        onChange={e => setDesc(e.target.value)}
        placeholder="Description (optional but recommended)"
        className={`${cls.inputFull} text-sm`}
      />
      <div className="flex gap-2">
        <button
          disabled={!name.trim()}
          onClick={() => name.trim() && onAdd(name.trim(), desc.trim())}
          className="px-3 py-1.5 text-xs font-semibold bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add Field (+2 pts)
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Completion grid ───────────────────────────────────────────────────────────

const SECTOR_ABBR: Record<string, string> = {
  'Robotics': 'R', 'Supply Chain': 'SC', 'Manufacturing': 'M',
  'Industrial Automation': 'IA', 'Physical AI': 'PA',
};
const STAGE_ABBR: Record<string, string> = {
  'Pre-seed': 'PS', 'Seed': 'S', 'Series A': 'A', 'Series B': 'B', 'Series C': 'C',
};

function CompletionGrid({ completion, selected, subsector, onSelect }: {
  completion: CompletionEntry[];
  selected: { sector: string; stage: string };
  subsector: string;
  onSelect: (sector: string, stage: string) => void;
}) {
  const done = new Set(
    completion.filter(c => c.subsector === subsector).map(c => `${c.sector}|${c.stage}`)
  );

  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-2">
        Progress — {done.size}/25 combos saved{subsector ? ` · ${subsector}` : ''}
      </p>
      {/* Header row */}
      <div className="grid grid-cols-6 gap-0.5 mb-0.5">
        <div />
        {STAGES.map(s => (
          <div key={s} className="text-[8px] font-bold text-center text-slate-400 uppercase">
            {STAGE_ABBR[s]}
          </div>
        ))}
      </div>
      {SECTORS.map(sector => (
        <div key={sector} className="grid grid-cols-6 gap-0.5 mb-0.5">
          <div className="text-[8px] font-bold text-slate-500 flex items-center pr-1 leading-tight">
            {SECTOR_ABBR[sector]}
          </div>
          {STAGES.map(stage => {
            const key = `${sector}|${stage}`;
            const isSaved = done.has(key);
            const isSelected = selected.sector === sector && selected.stage === stage;
            return (
              <button
                key={stage}
                onClick={() => onSelect(sector, stage)}
                title={`${sector} / ${stage}`}
                className={`w-full aspect-square rounded-sm transition-all text-[7px] font-bold flex items-center justify-center ${
                  isSelected
                    ? 'bg-[#1E293B] text-white shadow-sm scale-110'
                    : isSaved
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                }`}
              >
                {isSaved && !isSelected ? '✓' : ''}
              </button>
            );
          })}
        </div>
      ))}
      <div className="flex gap-3 mt-2">
        <span className="flex items-center gap-1 text-[9px] text-slate-400">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-100 inline-block" />Saved
        </span>
        <span className="flex items-center gap-1 text-[9px] text-slate-400">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#1E293B] inline-block" />Viewing
        </span>
        <span className="flex items-center gap-1 text-[9px] text-slate-400">
          <span className="w-2.5 h-2.5 rounded-sm bg-slate-100 inline-block" />Empty
        </span>
      </div>
    </div>
  );
}

// ── Team comparison view ──────────────────────────────────────────────────────

function TeamView({ sector, stage, subsector }: { sector: string; stage: string; subsector: string }) {
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/ventures/sector-eval/team?sector=${encodeURIComponent(sector)}&stage=${encodeURIComponent(stage)}&subsector=${encodeURIComponent(subsector)}`,
      { headers: authHeaders() })
      .then(r => r.json())
      .then(data => { setRows(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [sector, stage, subsector]);

  if (loading) return <p className="text-sm text-slate-400 py-4">Loading team data…</p>;

  // Build: fieldName → evaluator → importance
  const fieldMap = new Map<string, { section: string; scores: Record<string, number> }>();
  for (const r of rows) {
    if (!fieldMap.has(r.field_name)) {
      fieldMap.set(r.field_name, { section: r.section, scores: {} });
    }
    fieldMap.get(r.field_name)!.scores[r.evaluator] = r.importance;
  }

  if (fieldMap.size === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No team evaluations saved for {sector} / {stage} yet.</p>
      </div>
    );
  }

  // Evaluators who have submitted at least one weight
  const evaluators = [...new Set(rows.map(r => r.evaluator))].sort();

  // Alignment: std dev of scores across evaluators for a field
  function alignment(scores: Record<string, number>): 'aligned' | 'close' | 'diverged' {
    const vals = Object.values(scores);
    if (vals.length < 2) return 'aligned';
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    if (std <= 0.5) return 'aligned';
    if (std <= 1.2) return 'close';
    return 'diverged';
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400 py-2 pr-3 w-40">
              Field
            </th>
            <th className="text-[10px] font-bold uppercase tracking-wide text-slate-400 py-2 pr-3 w-20">
              Section
            </th>
            {evaluators.map(e => (
              <th key={e} className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-400 py-2 px-2 capitalize">
                {e}
              </th>
            ))}
            <th className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-400 py-2 px-2">
              Alignment
            </th>
          </tr>
        </thead>
        <tbody>
          {SECTIONS.map(section => {
            const sectionFields = [...fieldMap.entries()].filter(([, v]) => v.section === section);
            if (!sectionFields.length) return null;
            return (
              <React.Fragment key={section}>
                <tr>
                  <td colSpan={3 + evaluators.length}
                    className="pt-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    {section}
                  </td>
                </tr>
                {sectionFields.map(([fname, { scores }]) => {
                  const align = alignment(scores);
                  return (
                    <tr key={fname} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="py-2 pr-3 text-xs font-medium text-slate-700">{fname}</td>
                      <td className="py-2 pr-3 text-[10px] text-slate-400">{section}</td>
                      {evaluators.map(e => {
                        const v = scores[e];
                        return (
                          <td key={e} className="py-2 px-2 text-center">
                            {v ? (
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${IMP_COLORS[v].pill}`}>
                                {v}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-2 px-2 text-center">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                          align === 'aligned'  ? 'bg-emerald-50 text-emerald-700'  :
                          align === 'close'    ? 'bg-amber-50   text-amber-700'    :
                                                 'bg-red-50     text-red-700'
                        }`}>
                          {align}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SectorEvaluation() {
  const me   = localStorage.getItem('cvc_user') ?? '';
  const role = localStorage.getItem('cvc_role') ?? '';
  const canViewTeam = role === 'GP';

  const [searchParams] = useSearchParams();

  const [fields,     setFields]     = useState<EvalField[]>([]);
  const [weights,    setWeights]    = useState<Record<number, number>>({});  // fieldId → importance (0 = unrated)
  const [completion, setCompletion] = useState<CompletionEntry[]>([]);
  const [sector,     setSector]     = useState(() => {
    const p = searchParams.get('sector');
    return (p && SECTORS.includes(p)) ? p : SECTORS[0];
  });
  const [stage,      setStage]      = useState(STAGES[0]);
  const [activeView, setActiveView] = useState<'mine' | 'team'>('mine');
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [showHelp,   setShowHelp]   = useState(false);
  const [addingTo,          setAddingTo]          = useState<string | null>(null);  // section name
  const [subsector,         setSubsector]         = useState('');
  const [allSubsectors,     setAllSubsectors]     = useState<Record<string, SubsectorInfo[]>>({});
  const [addingSubsectorTo, setAddingSubsectorTo] = useState<string | null>(null);
  const [newSubsectorName,  setNewSubsectorName]  = useState('');
  const [editingSubsector,  setEditingSubsector]  = useState<{ id: number; name: string } | null>(null);

  // ── Load fields + completion + all subsectors on mount ──────────────────
  useEffect(() => {
    fetch('/ventures/sector-eval/fields', { headers: authHeaders() })
      .then(r => r.json())
      .then(data => setFields(Array.isArray(data) ? data : []));
    fetch('/ventures/sector-eval/completion', { headers: authHeaders() })
      .then(r => r.json())
      .then(data => setCompletion(Array.isArray(data) ? data : []));

    // Load subsectors for all sectors at once; apply URL param after
    const urlSector    = searchParams.get('sector');
    const urlSubsector = searchParams.get('subsector');
    Promise.all(
      SECTORS.map(s =>
        fetch(`/ventures/sector-eval/subsectors?sector=${encodeURIComponent(s)}`, { headers: authHeaders() })
          .then(r => r.json())
          .then(data => [s, Array.isArray(data) ? data : []] as [string, SubsectorInfo[]])
      )
    ).then(pairs => {
      const map: Record<string, SubsectorInfo[]> = {};
      for (const [s, list] of pairs) map[s] = list;
      setAllSubsectors(map);
      if (urlSubsector && urlSector && map[urlSector]?.some(ss => ss.subsector === urlSubsector)) {
        setSubsector(urlSubsector);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset subsector when sector changes ─────────────────────────────────
  useEffect(() => {
    setSubsector('');
    setAddingSubsectorTo(null);
    setNewSubsectorName('');
    setEditingSubsector(null);
  }, [sector]);

  // ── Load weights when sector/stage/subsector changes ─────────────────────
  useEffect(() => {
    fetch(`/ventures/sector-eval/weights?sector=${encodeURIComponent(sector)}&stage=${encodeURIComponent(stage)}&subsector=${encodeURIComponent(subsector)}`,
      { headers: authHeaders() })
      .then(r => r.json())
      .then((data: { field_id: number; importance: number }[]) => {
        const map: Record<number, number> = {};
        for (const w of (Array.isArray(data) ? data : [])) {
          map[w.field_id] = w.importance;
        }
        setWeights(map);
        setSaved(null);
        setError(null);
      });
  }, [sector, stage, subsector]);

  // ── Budget calculations ──────────────────────────────────────────────────
  const budget       = computeBudget(fields);
  const spent        = fields.reduce((sum, f) => sum + (weights[f.id] ?? 0), 0);
  const unrated      = fields.filter(f => !(weights[f.id] ?? 0)).length;
  const criticalCnt  = fields.filter(f => (weights[f.id] ?? 0) === 5).length;
  const lowCnt       = fields.filter(f => (weights[f.id] ?? 0) > 0 && (weights[f.id] ?? 0) <= 2).length;
  const status       = budgetStatus(spent, budget);

  const canSave = (
    unrated === 0 &&
    status === 'ok' &&
    criticalCnt <= MAX_CRITICAL &&
    lowCnt >= MIN_LOW
  );

  // ── Constraint warnings ──────────────────────────────────────────────────
  const warnings: string[] = [];
  if (unrated > 0)              warnings.push(`${unrated} field${unrated > 1 ? 's' : ''} unrated`);
  if (status === 'low')         warnings.push(`${budget - spent} pts under budget — adjust or add a custom field`);
  if (status === 'over')        warnings.push(`${spent - budget} pts over budget — lower some ratings`);
  if (criticalCnt > MAX_CRITICAL) warnings.push(`${criticalCnt} Critical fields — max ${MAX_CRITICAL} allowed`);
  if (lowCnt < MIN_LOW)         warnings.push(`${lowCnt} Low/Minimal fields — min ${MIN_LOW} required`);

  // ── Actions ──────────────────────────────────────────────────────────────
  function setWeight(fieldId: number, v: number) {
    setWeights(prev => ({ ...prev, [fieldId]: v }));
    setSaved(null);
  }

  function applyStageDefaults() {
    const defaults = STAGE_DEFAULTS[stage] ?? {};
    const next = { ...weights };
    for (const f of fields) {
      if (f.is_default && (next[f.id] ?? 0) === 0) {
        const def = defaults[f.field_name];
        if (def) next[f.id] = def;
      }
    }
    setWeights(next);
  }

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        sector, stage, subsector,
        weights: fields.map(f => ({ field_id: f.id, importance: weights[f.id] ?? 1 })),
      };
      const res = await fetch('/ventures/sector-eval/weights', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail ?? 'Save failed');
      }
      setSaved(new Date().toLocaleTimeString());
      setCompletion(prev => {
        const existing = prev.filter(c => !(c.sector === sector && c.subsector === subsector && c.stage === stage));
        return [...existing, { sector, subsector, stage, last_saved: new Date().toISOString() }];
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [canSave, sector, subsector, stage, fields, weights]);

  async function addCustomField(section: string, name: string, desc: string) {
    try {
      const res = await fetch('/ventures/sector-eval/fields', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ section, field_name: name, description: desc || null }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail ?? 'Add field failed');
      }
      const newField: EvalField = await res.json();
      setFields(prev => [...prev, newField]);
      setAddingTo(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Add field failed');
    }
  }

  async function deleteCustomField(fieldId: number) {
    try {
      const res = await fetch(`/ventures/sector-eval/fields/${fieldId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok && res.status !== 204) throw new Error('Delete failed');
      setFields(prev => prev.filter(f => f.id !== fieldId));
      setWeights(prev => { const next = { ...prev }; delete next[fieldId]; return next; });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function addSubsector(forSector: string) {
    const name = newSubsectorName.trim();
    if (!name) return;
    try {
      const res = await fetch('/ventures/sector-eval/subsectors', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ sector: forSector, subsector: name }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail ?? 'Add subsector failed');
      }
      const row: SubsectorInfo = await res.json();
      setAllSubsectors(prev => ({
        ...prev,
        [forSector]: [...(prev[forSector] ?? []), row].sort((a, b) => a.subsector.localeCompare(b.subsector)),
      }));
      setSector(forSector);
      setSubsector(name);
      setAddingSubsectorTo(null);
      setNewSubsectorName('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Add subsector failed');
    }
  }

  async function saveEditSubsector() {
    if (!editingSubsector) return;
    const name = editingSubsector.name.trim();
    if (!name) return;
    try {
      const res = await fetch(`/ventures/sector-eval/subsectors/${editingSubsector.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ sector, subsector: name }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail ?? 'Rename failed');
      }
      setAllSubsectors(prev => ({
        ...prev,
        [sector]: (prev[sector] ?? []).map(ss =>
          ss.id === editingSubsector.id ? { ...ss, subsector: name } : ss
        ).sort((a, b) => a.subsector.localeCompare(b.subsector)),
      }));
      if (subsector === (allSubsectors[sector]?.find(ss => ss.id === editingSubsector.id)?.subsector ?? '')) {
        setSubsector(name);
      }
      setEditingSubsector(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Rename failed');
    }
  }

  async function deleteSubsector(ssId: number, ssName: string) {
    try {
      const res = await fetch(`/ventures/sector-eval/subsectors/${ssId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok && res.status !== 204) {
        const e = await res.json();
        throw new Error(e.detail ?? 'Delete failed');
      }
      setAllSubsectors(prev => ({
        ...prev,
        [sector]: (prev[sector] ?? []).filter(ss => ss.id !== ssId),
      }));
      if (subsector === ssName) setSubsector('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete subsector failed');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const fieldsBySection = SECTIONS.reduce<Record<string, EvalField[]>>((acc, s) => {
    acc[s] = fields.filter(f => f.section === s);
    return acc;
  }, {});

  const lastSaved = completion.find(c => c.sector === sector && c.subsector === subsector && c.stage === stage);

  return (
    <div className={cls.page}>
      <CVCNavbar />
      <div className="grid grid-cols-[260px_1fr] min-h-[calc(100vh-56px)]">

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside className="border-r border-slate-200 bg-white sticky top-0 h-screen overflow-y-auto p-4 space-y-5">

          <Link to="/ventures"
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 transition-colors font-medium">
            <ChevronLeft className="w-3.5 h-3.5" />Ventures
          </Link>

          <div>
            <h2 className="text-sm font-extrabold text-[#1E293B] tracking-tight leading-tight">
              Sector Evaluation
            </h2>
            <p className="text-[10px] text-slate-400 mt-0.5">Framework — {me}</p>
          </div>

          {/* Sector + Subsector tree */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Sector / Subsector</p>
            <div className="space-y-0.5">
              {SECTORS.map(s => {
                const subs = allSubsectors[s] ?? [];
                const isActiveSector = sector === s;
                return (
                  <div key={s}>
                    {/* Sector row */}
                    <button
                      onClick={() => { setSector(s); setSubsector(''); setActiveView('mine'); }}
                      className={`w-full text-left text-xs px-2.5 py-1.5 rounded font-bold transition-colors ${
                        isActiveSector && subsector === ''
                          ? 'bg-[#1E293B] text-cvc-gold'
                          : isActiveSector
                          ? 'bg-slate-100 text-slate-800'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {s}
                    </button>

                    {/* Subsectors — always visible when sector has subs; show if active */}
                    {(isActiveSector || subs.length > 0) && (
                      <div className="ml-3 mt-0.5 mb-1 border-l border-slate-200 pl-2 space-y-0.5">
                        {subs.map(ss => (
                          <div key={ss.id} className="group flex items-center gap-0.5">
                            {editingSubsector?.id === ss.id ? (
                              <div className="flex-1 flex items-center gap-1">
                                <input
                                  value={editingSubsector.name}
                                  onChange={e => setEditingSubsector(prev => prev ? { ...prev, name: e.target.value } : null)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') saveEditSubsector();
                                    if (e.key === 'Escape') setEditingSubsector(null);
                                  }}
                                  className={`${cls.inputFull} text-xs py-0.5`}
                                  autoFocus
                                />
                                <button onClick={saveEditSubsector} className="text-[10px] text-emerald-600 hover:text-emerald-800 font-bold px-0.5">✓</button>
                                <button onClick={() => setEditingSubsector(null)} className="text-[10px] text-slate-400 hover:text-slate-600 px-0.5">✕</button>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={() => { setSector(s); setSubsector(ss.subsector); setActiveView('mine'); }}
                                  className={`flex-1 text-left text-[11px] px-2 py-1 rounded transition-colors ${
                                    isActiveSector && subsector === ss.subsector
                                      ? 'bg-indigo-600 text-white font-semibold'
                                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                                  }`}
                                >
                                  {ss.subsector}
                                </button>
                                {ss.created_by === me && (
                                  <div className="opacity-0 group-hover:opacity-100 flex items-center transition-opacity shrink-0">
                                    <button
                                      onClick={() => setEditingSubsector({ id: ss.id, name: ss.subsector })}
                                      title="Rename"
                                      className="p-0.5 text-slate-300 hover:text-slate-600 transition-colors"
                                    >
                                      <Pencil className="w-2.5 h-2.5" />
                                    </button>
                                    <button
                                      onClick={() => deleteSubsector(ss.id, ss.subsector)}
                                      title="Delete"
                                      className="p-0.5 text-slate-300 hover:text-red-400 transition-colors"
                                    >
                                      <Trash2 className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ))}

                        {/* Add subsector form */}
                        {addingSubsectorTo === s ? (
                          <div className="pt-0.5 space-y-1">
                            <input
                              value={newSubsectorName}
                              onChange={e => setNewSubsectorName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') addSubsector(s);
                                if (e.key === 'Escape') { setAddingSubsectorTo(null); setNewSubsectorName(''); }
                              }}
                              placeholder="e.g. Mobile Robotics"
                              className={`${cls.inputFull} text-xs`}
                              autoFocus
                            />
                            <div className="flex gap-1">
                              <button
                                onClick={() => addSubsector(s)}
                                disabled={!newSubsectorName.trim()}
                                className="flex-1 text-xs font-semibold bg-indigo-600 text-white rounded py-0.5 hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                              >
                                Add
                              </button>
                              <button
                                onClick={() => { setAddingSubsectorTo(null); setNewSubsectorName(''); }}
                                className="text-xs text-slate-400 hover:text-slate-600 px-1.5"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setSector(s); setAddingSubsectorTo(s); }}
                            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-600 transition-colors py-0.5 px-1"
                          >
                            <Plus className="w-3 h-3" />Add subsector
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stage */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Stage</p>
            <div className="flex flex-col gap-1">
              {STAGES.map(s => (
                <button key={s}
                  onClick={() => { setStage(s); setActiveView('mine'); }}
                  className={`text-left text-xs px-2.5 py-1.5 rounded font-medium transition-colors ${
                    stage === s
                      ? 'bg-[#1E293B] text-cvc-gold'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Completion grid */}
          <CompletionGrid
            completion={completion}
            selected={{ sector, stage }}
            subsector={subsector}
            onSelect={(s, st) => { setSector(s); setStage(st); setActiveView('mine'); }}
          />

          {/* Team View (GP/Principal/Director) */}
          {canViewTeam && (
            <button
              onClick={() => setActiveView(v => v === 'team' ? 'mine' : 'team')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-semibold transition-colors ${
                activeView === 'team'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Team Comparison
            </button>
          )}
        </aside>

        {/* ── Main ─────────────────────────────────────────────────────── */}
        <main className="p-6 space-y-5 max-w-3xl">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className={cls.pageTitle}>{sector}</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {stage}{subsector && <span className="ml-2 text-[11px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">{subsector}</span>}
                {lastSaved && (
                  <span className="ml-2 text-[10px] text-emerald-600 font-medium">
                    ✓ Saved {new Date(lastSaved.last_saved).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setShowHelp(s => !s)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded transition-colors"
              >
                <HelpCircle className="w-3.5 h-3.5" />How this works
              </button>
              <button
                onClick={applyStageDefaults}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:border-slate-400 rounded transition-colors bg-white"
              >
                <RefreshCw className="w-3.5 h-3.5" />Stage Defaults
              </button>
            </div>
          </div>

          {/* How this works */}
          {showHelp && (
            <div className={`${cls.subcard} text-sm text-slate-600 leading-relaxed space-y-2`}>
              <p className="font-semibold text-slate-800">Methodology</p>
              <p>
                Rate each criterion from <strong>1 (Minimal)</strong> to <strong>5 (Critical)</strong>.
                You have <strong>{budget} points</strong> to distribute — an average of {(budget / fields.length).toFixed(1)} per field.
                This is intentionally tight: you cannot rate everything Critical.
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-500">
                <li>Max <strong>{MAX_CRITICAL} fields</strong> can be rated Critical (5)</li>
                <li>At least <strong>{MIN_LOW} fields</strong> must be Minimal or Low (1–2)</li>
                <li>All fields must be rated before saving</li>
                <li>Custom fields add {CUSTOM_FIELD_BONUS} pts to budget each</li>
              </ul>
              <p className="text-slate-500">
                <strong>Stage Defaults</strong> fills any unrated fields with stage-appropriate starting points.
                Adjust from there based on your actual view of the sector.
              </p>
              <p className="text-slate-500">
                Your weights are compared across the team in <strong>Team Comparison</strong> to surface
                where investment priorities align or diverge.
              </p>
            </div>
          )}

          {/* Team comparison view */}
          {activeView === 'team' && (
            <div className={cls.card}>
              <div className="p-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-500" />
                  <span className={cls.sectionTitle}>Team Comparison — {sector}{subsector ? ` · ${subsector}` : ''} / {stage}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Side-by-side importance weights across all associates who have saved this combination.
                </p>
              </div>
              <div className="p-4">
                <TeamView sector={sector} stage={stage} subsector={subsector} />
              </div>
            </div>
          )}

          {/* Budget tracker */}
          {activeView === 'mine' && (
            <>
              <div className={`${cls.subcard} space-y-2`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Point Budget
                    </span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                      status === 'ok'    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      status === 'empty' ? 'bg-slate-50   text-slate-500   border-slate-200'  :
                                           'bg-amber-50   text-amber-700   border-amber-200'
                    }`}>
                      {spent} / {budget} pts
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className={`font-semibold ${criticalCnt > MAX_CRITICAL ? 'text-red-600' : 'text-slate-500'}`}>
                      {criticalCnt}/{MAX_CRITICAL} Critical
                    </span>
                    <span className={`font-semibold ${lowCnt < MIN_LOW ? 'text-red-600' : 'text-slate-500'}`}>
                      {lowCnt}/{MIN_LOW}+ Low
                    </span>
                    <span className={`font-semibold ${unrated > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {fields.length - unrated}/{fields.length} rated
                    </span>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${BUDGET_BAR_COLOR[status]}`}
                    style={{ width: `${Math.min(100, (spent / (budget + BUDGET_TOLERANCE)) * 100)}%` }}
                  />
                </div>
                {/* Constraint violations */}
                {warnings.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {warnings.map(w => (
                      <span key={w}
                        className="flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                        <AlertTriangle className="w-3 h-3" />{w}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Field sections */}
              {SECTIONS.map(section => {
                const sectionFields = fieldsBySection[section] ?? [];
                if (!sectionFields.length && addingTo !== section) return null;
                return (
                  <div key={section} className={cls.card}>
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                      <span className={cls.sectionTitle}>{section}</span>
                      <span className="text-[10px] text-slate-400">
                        {sectionFields.reduce((s, f) => s + (weights[f.id] ?? 0), 0)} pts
                      </span>
                    </div>
                    <div className="divide-y divide-slate-50 p-1">
                      {sectionFields.map(field => (
                        <FieldRow
                          key={field.id}
                          field={field}
                          importance={weights[field.id] ?? 0}
                          onChange={v => setWeight(field.id, v)}
                          onDelete={() => deleteCustomField(field.id)}
                          me={me}
                        />
                      ))}
                    </div>

                    {/* Add custom field */}
                    <div className="px-4 pb-3 pt-1">
                      {addingTo === section ? (
                        <AddFieldForm
                          section={section}
                          onAdd={(name, desc) => addCustomField(section, name, desc)}
                          onCancel={() => setAddingTo(null)}
                        />
                      ) : (
                        <button
                          onClick={() => setAddingTo(section)}
                          className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-violet-600 hover:text-violet-700 hover:bg-violet-50 border border-dashed border-violet-300 rounded-lg py-2 mt-1 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add custom {section.toLowerCase()} field (+2 pts)
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0" />{error}
                </div>
              )}

              {/* Save */}
              <div className="flex items-center gap-3 pb-6">
                <button
                  onClick={handleSave}
                  disabled={!canSave || saving}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded font-semibold text-sm transition-colors shadow-sm ${
                    canSave && !saving
                      ? 'bg-[#1E293B] text-cvc-gold hover:bg-slate-800'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {saving ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {saving ? 'Saving…' : `Save ${sector} / ${stage}`}
                </button>

                {saved && (
                  <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium">
                    <CheckCircle2 className="w-4 h-4" />Saved at {saved}
                  </span>
                )}

                {!canSave && !saving && warnings.length === 0 && unrated > 0 && (
                  <span className="text-xs text-slate-400">
                    Rate all {fields.length} fields to enable save
                  </span>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
