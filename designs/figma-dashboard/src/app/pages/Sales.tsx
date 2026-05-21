import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import {
  Target, Plus, X, ChevronRight, Check, AlertCircle, ExternalLink,
  Phone, Mail, User, Building2, FileText, MessageSquare, Handshake,
  Send, TrendingUp, CheckCircle2, XCircle, Clock, Edit3, Save,
  Trash2, Search,
} from 'lucide-react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { cls } from '../components/tokens';
import { CVCNavbar } from '../components/CVCNavbar';
import { AUTH_HEADER as AUTH } from '../api/client';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useConfig } from '../hooks/useConfig';

const DND_ITEM = 'KANBAN_CARD';
interface DragItem { id: number; stage: string; }

// ── Types ─────────────────────────────────────────────────────────────────────

type StageName = 'target' | 'nurturing' | 'proposal' | 'closed_won' | 'closed_lost';

interface LeaderboardEntry {
  username: string;
  contracted_2026: number;
  stage_counts: Record<StageName, number>;
  weekly_delta: Record<StageName, number>;
  stale_count: number;
}

interface SalesTarget {
  id: number;
  company_name: string;
  website: string | null;
  sector: string | null;
  assigned_to: string | null;
  stage: string;
  rationale: string | null;
  est_deal_type: string | null;
  est_deal_value: number | null;
  target_close_date: string | null;
  signed_date: string | null;
  contract_value: number | null;
  contract_term_months: number | null;
  proposed_deliverables: string[] | null;
  stage_gate_data: Record<string, unknown>;
  partner_id: number | null;
  linked_target_id: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  stage_changed_at: string;
  contacts?: Contact[];
  notes?: Note[];
}

interface Contact {
  id: number;
  target_id: number;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  is_decision_maker: boolean;
  created_at: string;
}

interface Note {
  id: number;
  target_id: number;
  note_type: string;
  body: string;
  author: string | null;
  created_at: string;
  // Meeting note fields (note_type === 'meeting')
  meeting_date?:         string | null;
  tech_interest?:        string | null;
  tech_challenge?:       string | null;
  rating_buying_intent?: number | null;
  rating_dm_access?:     number | null;
  rating_budget_fit?:    number | null;
  rating_strategic_fit?: number | null;
  rating_timeline?:      number | null;
  personal_note?:        string | null;
  transcript_text?:      string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGES = ['target', 'nurturing', 'proposal', 'closed_won', 'closed_lost'] as const;
type Stage = typeof STAGES[number];

const STAGE_LABELS: Record<string, string> = {
  target:      'Target',
  nurturing:   'Nurturing',
  proposal:    'Proposal',
  closed_won:  'Won',
  closed_lost: 'Lost',
};

const STAGE_COLORS: Record<string, string> = {
  target:      'bg-slate-100 text-slate-600',
  nurturing:   'bg-blue-50 text-blue-700',
  proposal:    'bg-amber-50 text-amber-700',
  closed_won:  'bg-emerald-50 text-emerald-700',
  closed_lost: 'bg-red-50 text-red-600',
};

const NOTE_COLORS: Record<string, string> = {
  call:    'bg-blue-50 text-blue-700',
  email:   'bg-indigo-50 text-indigo-700',
  meeting: 'bg-emerald-50 text-emerald-700',
  general: 'bg-slate-100 text-slate-600',
};

const DEAL_TYPES = ['LP', 'Corporate Partner', 'Strategic', 'Pilot'];
const NOTE_TYPES = ['general', 'call', 'email', 'meeting'];
const LINE_ITEMS = [
  { key: 'collection',         label: 'Collection',        price: 10_000, anchorOnly: false },
  { key: 'dealflow_session',   label: 'Dealflow Session',  price: 20_000, anchorOnly: false },
  { key: 'trend_report',       label: 'Trend Report',      price: 20_000, anchorOnly: false },
  { key: 'immersion_meeting',  label: 'Immersion Meeting', price: 30_000, anchorOnly: true  },
  { key: 'innovation_day',     label: 'Innovation Day',    price: 80_000, anchorOnly: true  },
  { key: 'custom_research',    label: 'Custom Research',   price: 80_000, anchorOnly: true  },
];
const ANCHOR_LEVELS = new Set(['Anchor', 'Founding Anchor']);
const ADVANCE_STAGES = ['target', 'nurturing', 'proposal'];

// ── Person colors ─────────────────────────────────────────────────────────────

const PERSON_COLORS: Record<string, string> = {
  josh:      '#6366F1',
  frederik:  '#F59E0B',
  dave:      '#10b981',
  kevin:     '#8b5cf6',
};

function personColor(username: string): string {
  return PERSON_COLORS[username.toLowerCase()] ?? '#94a3b8';
}

function personInitial(username: string): string {
  return username.charAt(0).toUpperCase();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtRelative(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

function daysInStage(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function fmtContracted(val: number): string {
  if (val === 0) return '$0';
  const m = val / 1_000_000;
  if (m >= 1) return `$${m.toFixed(3)}m`;
  const k = val / 1_000;
  return `$${k.toFixed(0)}k`;
}

function isStale(target: SalesTarget): boolean {
  const closed = ['closed_won', 'closed_lost'];
  if (closed.includes(target.stage)) return false;
  return daysInStage(target.stage_changed_at) > 21;
}

// ── Person Strip ──────────────────────────────────────────────────────────────

const STAGE_DISPLAY_ORDER: StageName[] = ['target', 'nurturing', 'proposal', 'closed_won', 'closed_lost'];
const STAGE_ABBREV: Record<StageName, string> = {
  target:      'T',
  nurturing:   'N',
  proposal:    'P',
  closed_won:  'W',
  closed_lost: 'L',
};

function PersonMiniCard({ entry }: { entry: LeaderboardEntry }) {
  const color = personColor(entry.username);
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-cvc flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
            style={{ backgroundColor: color }}
          >
            {personInitial(entry.username)}
          </div>
          <div>
            <p className="text-sm font-bold text-[#1E293B] capitalize leading-none">{entry.username}</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide font-mono">Sales</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-extrabold text-[#F59E0B] leading-none">{fmtContracted(entry.contracted_2026)}</p>
          <p className="text-[9px] text-slate-400 uppercase tracking-wide font-mono">contracted</p>
        </div>
      </div>

      {/* Stage count pills */}
      <div className="flex items-center gap-1">
        {STAGE_DISPLAY_ORDER.map(stage => {
          const count = entry.stage_counts[stage] ?? 0;
          return (
            <span
              key={stage}
              className={`flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STAGE_COLORS[stage]}`}
              title={STAGE_LABELS[stage]}
            >
              <span className="font-mono">{STAGE_ABBREV[stage]}</span>
              <span>{count}</span>
            </span>
          );
        })}
        {entry.stale_count > 0 && (
          <span className="ml-1 w-2 h-2 rounded-full bg-amber-400 shrink-0" title={`${entry.stale_count} stale`} />
        )}
      </div>
    </div>
  );
}

// ── Kanban Card ───────────────────────────────────────────────────────────────

function KanbanCard({ t, selected, onClick, coOwner }: { t: SalesTarget; selected: boolean; onClick: () => void; coOwner?: string }) {
  const color = personColor(t.assigned_to ?? '');
  const days  = daysInStage(t.stage_changed_at);
  const stale = isStale(t);

  const [{ isDragging }, drag] = useDrag({
    type: DND_ITEM,
    item: { id: t.id, stage: t.stage } satisfies DragItem,
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  return (
    <button
      ref={drag as unknown as React.Ref<HTMLButtonElement>}
      onClick={onClick}
      className={`w-full text-left bg-white border rounded-lg p-3 mb-2 transition-all duration-200 ${
        isDragging
          ? 'opacity-25 scale-[0.97] cursor-grabbing shadow-none'
          : 'cursor-grab active:cursor-grabbing hover:shadow-cvc-hover'
      } ${
        selected
          ? 'border-[#1E293B] shadow-cvc-hover ring-1 ring-[#1E293B]/10'
          : 'border-slate-200 hover:border-slate-300'
      } ${stale ? 'border-l-2 border-l-amber-400' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-[13px] font-bold text-[#1E293B] leading-snug">{t.company_name}</p>
        <span className="text-[10px] text-slate-400 shrink-0">{days}d</span>
      </div>

      <div className="flex items-center gap-2">
        {t.assigned_to && (
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white shrink-0"
            style={{ backgroundColor: color }}
          >
            {t.assigned_to.charAt(0).toUpperCase() + t.assigned_to.slice(1)}
          </span>
        )}
        {coOwner && (
          <span
            className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0"
            style={{ borderColor: personColor(coOwner), color: personColor(coOwner) }}
            title={`Co-owned with ${coOwner}`}
          >
            +{coOwner.charAt(0).toUpperCase() + coOwner.slice(1)}
          </span>
        )}
        {t.contract_value && t.contract_value > 0 && (
          <span className="text-[10px] text-slate-400 font-mono">{fmtContracted(t.contract_value)}</span>
        )}
        {stale && (
          <span className="ml-auto">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" title="Stale — no movement in 21+ days" />
          </span>
        )}
      </div>
    </button>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  title, stage, targets, selected, onSelect, headerColor, coOwnerMap, onDrop,
}: {
  title: string;
  stage: string;
  targets: SalesTarget[];
  selected: SalesTarget | null;
  onSelect: (t: SalesTarget) => void;
  headerColor?: string;
  coOwnerMap: Map<number, string>;
  onDrop: (id: number, fromStage: string) => void;
}) {
  const [{ isOver, canDrop }, drop] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>({
    accept: DND_ITEM,
    drop: (item) => onDrop(item.id, item.stage),
    canDrop: (item) => item.stage !== stage,
    collect: (monitor) => ({ isOver: monitor.isOver(), canDrop: monitor.canDrop() }),
  });

  const active = isOver && canDrop;

  return (
    <div
      ref={drop as unknown as React.Ref<HTMLDivElement>}
      className={`flex flex-col rounded-xl border overflow-hidden transition-all duration-200 ${
        active
          ? 'border-blue-400 shadow-[0_0_0_3px_rgba(96,165,250,0.25)] bg-blue-50/30'
          : 'bg-[#F8FAFC] border-slate-200'
      }`}
    >
      {/* Column header */}
      <div className={`px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 transition-colors duration-200 ${headerColor ?? ''} ${active ? 'bg-blue-50/60' : ''}`}>
        <span className="text-xs font-bold text-[#334155] uppercase tracking-wide">{title}</span>
        <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full transition-colors duration-200 ${active ? 'bg-blue-200 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>
          {targets.length}
        </span>
      </div>

      {/* Scrollable cards */}
      <div className="flex-1 overflow-y-auto p-2" style={{ maxHeight: 'calc(100vh - 310px)' }}>
        {targets.length === 0 && (
          <div className={`flex items-center justify-center py-6 transition-all duration-200 ${active ? 'py-10' : ''}`}>
            <p className={`text-[11px] text-center transition-colors duration-200 ${active ? 'text-blue-400 font-medium' : 'text-slate-400'}`}>
              {active ? '↓ Drop here' : 'No targets'}
            </p>
          </div>
        )}
        {targets.map(t => (
          <KanbanCard
            key={t.id}
            t={t}
            selected={selected?.id === t.id}
            onClick={() => onSelect(t)}
            coOwner={coOwnerMap.get(t.id)}
          />
        ))}
        {active && targets.length > 0 && (
          <div className="mt-1 h-14 border-2 border-dashed border-blue-300 rounded-lg flex items-center justify-center bg-blue-50/40 transition-all duration-200">
            <span className="text-[11px] text-blue-400 font-medium">↓ Drop here</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Closed Column (won + lost sub-sections) ───────────────────────────────────

function ClosedSubSection({
  stage, accentClass, borderClass, bgClass, label, icon, targets, selected, onSelect, coOwnerMap, onDrop,
}: {
  stage: string;
  accentClass: string;
  borderClass: string;
  bgClass: string;
  label: string;
  icon: React.ReactNode;
  targets: SalesTarget[];
  selected: SalesTarget | null;
  onSelect: (t: SalesTarget) => void;
  coOwnerMap: Map<number, string>;
  onDrop: (id: number, fromStage: string) => void;
}) {
  const [{ isOver, canDrop }, drop] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>({
    accept: DND_ITEM,
    drop: (item) => onDrop(item.id, item.stage),
    canDrop: (item) => item.stage !== stage,
    collect: (monitor) => ({ isOver: monitor.isOver(), canDrop: monitor.canDrop() }),
  });

  const active = isOver && canDrop;

  return (
    <div
      ref={drop as unknown as React.Ref<HTMLDivElement>}
      className={`rounded-lg border transition-all duration-200 p-1.5 ${active ? `${borderClass} ${bgClass} border-dashed` : 'border-transparent'}`}
    >
      <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
        {icon}
        <span className={`text-[10px] font-bold uppercase tracking-wide ${accentClass}`}>{label}</span>
        <span className={`ml-auto text-[10px] transition-colors duration-200 ${active ? accentClass : 'text-slate-400'}`}>{targets.length}</span>
      </div>
      {targets.length === 0 && (
        <div className={`flex items-center justify-center py-2 transition-all duration-200 ${active ? 'py-5' : ''}`}>
          <p className={`text-[11px] text-center transition-colors duration-200 ${active ? `${accentClass} font-medium` : 'text-slate-400'}`}>
            {active ? '↓ Drop here' : `No ${label.toLowerCase()} deals`}
          </p>
        </div>
      )}
      {targets.map(t => (
        <KanbanCard key={t.id} t={t} selected={selected?.id === t.id} onClick={() => onSelect(t)} coOwner={coOwnerMap.get(t.id)} />
      ))}
      {active && targets.length > 0 && (
        <div className={`mt-1 h-12 border-2 border-dashed ${borderClass} rounded-lg flex items-center justify-center ${bgClass} transition-all duration-200`}>
          <span className={`text-[11px] ${accentClass} font-medium`}>↓ Drop here</span>
        </div>
      )}
    </div>
  );
}

function ClosedColumn({
  won, lost, selected, onSelect, coOwnerMap, onDropWon, onDropLost,
}: {
  won: SalesTarget[];
  lost: SalesTarget[];
  selected: SalesTarget | null;
  onSelect: (t: SalesTarget) => void;
  coOwnerMap: Map<number, string>;
  onDropWon: (id: number, fromStage: string) => void;
  onDropLost: (id: number, fromStage: string) => void;
}) {
  return (
    <div className="flex flex-col bg-[#F8FAFC] rounded-xl border border-slate-200 overflow-hidden">
      {/* Column header */}
      <div className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2">
        <span className="text-xs font-bold text-[#334155] uppercase tracking-wide">Closed</span>
        <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">
          {won.length + lost.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-3" style={{ maxHeight: 'calc(100vh - 310px)' }}>
        <ClosedSubSection
          stage="closed_won"
          accentClass="text-emerald-600"
          borderClass="border-emerald-400"
          bgClass="bg-emerald-50/40"
          label="Won"
          icon={<CheckCircle2 className="w-3 h-3 text-emerald-500" />}
          targets={won}
          selected={selected}
          onSelect={onSelect}
          coOwnerMap={coOwnerMap}
          onDrop={onDropWon}
        />
        <ClosedSubSection
          stage="closed_lost"
          accentClass="text-red-500"
          borderClass="border-red-400"
          bgClass="bg-red-50/40"
          label="Lost"
          icon={<XCircle className="w-3 h-3 text-red-400" />}
          targets={lost}
          selected={selected}
          onSelect={onSelect}
          coOwnerMap={coOwnerMap}
          onDrop={onDropLost}
        />
      </div>
    </div>
  );
}

// ── Stage Stepper ─────────────────────────────────────────────────────────────

function StageStepper({ stage }: { stage: string }) {
  const steps = ['target', 'nurturing', 'proposal', 'closed_won'];
  const activeIdx = steps.indexOf(stage);
  const isLost = stage === 'closed_lost';

  if (isLost) {
    return (
      <div className="flex items-center gap-2 py-2">
        <XCircle className="w-4 h-4 text-red-500" />
        <span className="text-sm font-semibold text-red-600">Closed — Lost</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => {
        const done    = i < activeIdx;
        const current = i === activeIdx;
        return (
          <div key={s} className="flex items-center gap-1">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              current
                ? 'bg-[#1E293B] text-cvc-gold shadow-sm'
                : done
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-slate-100 text-slate-400'
            }`}>
              {done && <Check className="w-3 h-3" />}
              {STAGE_LABELS[s]}
            </div>
            {i < steps.length - 1 && (
              <ChevronRight className={`w-3 h-3 ${i < activeIdx ? 'text-emerald-400' : 'text-slate-300'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Add Target Modal ──────────────────────────────────────────────────────────

function AddTargetModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: SalesTarget) => void }) {
  const PLATFORM_USERS = useTeamMembers();
  const config = useConfig();
  const SECTORS = config.sectors;
  const [form, setForm]   = useState({ company_name: '', website: '', sector: '', assigned_to: '', rationale: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr]      = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company_name.trim()) { setErr('Company name is required'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/sales/targets', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed'); }
      const created = await res.json();
      onCreated(created);
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create target');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[420px] bg-white shadow-2xl flex flex-col h-full overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className={cls.sectionTitle}>Add Target</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-linen"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 p-6 flex-1">
          <div>
            <label className={`${cls.meta} mb-1 block`}>Company Name *</label>
            <input className={cls.inputFull} value={form.company_name}
              onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Acme Corp" />
          </div>
          <div>
            <label className={`${cls.meta} mb-1 block`}>Website</label>
            <input className={cls.inputFull} value={form.website}
              onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." />
          </div>
          <div>
            <label className={`${cls.meta} mb-1 block`}>Sector</label>
            <select className={`${cls.select} w-full`} value={form.sector}
              onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}>
              <option value="">— Select —</option>
              {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={`${cls.meta} mb-1 block`}>Assigned To</label>
            <select className={`${cls.select} w-full`} value={form.assigned_to}
              onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
              <option value="">— Select —</option>
              {PLATFORM_USERS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className={`${cls.meta} mb-1 block`}>Rationale</label>
            <textarea className={`${cls.inputFull} min-h-[80px] resize-y`} value={form.rationale}
              onChange={e => setForm(f => ({ ...f, rationale: e.target.value }))}
              placeholder="Why are we pursuing this?" />
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{err}</p>}
          <div className="flex gap-2 mt-auto">
            <button type="button" onClick={onClose} className={cls.btnSecondary}>Cancel</button>
            <button type="submit" disabled={saving} className={`${cls.btnPrimary} flex-1`}>
              {saving ? 'Creating…' : 'Create Target'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Contacts Tab ──────────────────────────────────────────────────────────────

function ContactsTab({ targetId }: { targetId: number }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [form, setForm]         = useState({ full_name: '', title: '', email: '', phone: '', is_decision_maker: false });
  const [adding, setAdding]     = useState(false);
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/sales/targets/${targetId}/contacts`, { headers: AUTH });
    if (res.ok) setContacts(await res.json());
  }, [targetId]);

  useEffect(() => { load(); }, [load]);

  async function addContact(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/sales/targets/${targetId}/contacts`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const created = await res.json();
        setContacts(c => [...c, created]);
        setForm({ full_name: '', title: '', email: '', phone: '', is_decision_maker: false });
        setAdding(false);
      }
    } finally { setSaving(false); }
  }

  async function removeContact(id: number) {
    await fetch(`/sales/targets/${targetId}/contacts/${id}`, { method: 'DELETE', headers: AUTH });
    setContacts(c => c.filter(x => x.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className={cls.sectionTitle}>Contacts</span>
        <button onClick={() => setAdding(a => !a)} className={cls.btnSecondary}>
          <Plus className="w-3.5 h-3.5 inline mr-1" />Add
        </button>
      </div>

      {adding && (
        <form onSubmit={addContact} className={`${cls.dataArea} space-y-3`}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`${cls.meta} mb-1 block`}>Full Name *</label>
              <input className={cls.inputFull} value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
            </div>
            <div>
              <label className={`${cls.meta} mb-1 block`}>Title</label>
              <input className={cls.inputFull} value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className={`${cls.meta} mb-1 block`}>Email</label>
              <input className={cls.inputFull} type="email" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className={`${cls.meta} mb-1 block`}>Phone</label>
              <input className={cls.inputFull} value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[#1E293B] cursor-pointer">
            <input type="checkbox" checked={form.is_decision_maker}
              onChange={e => setForm(f => ({ ...f, is_decision_maker: e.target.checked }))} />
            Decision maker
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAdding(false)} className={cls.btnSecondary}>Cancel</button>
            <button type="submit" disabled={saving} className={cls.btnPrimary}>
              {saving ? 'Saving…' : 'Add Contact'}
            </button>
          </div>
        </form>
      )}

      {contacts.length === 0 && !adding && (
        <p className={cls.muted}>No contacts yet.</p>
      )}

      <div className="space-y-2">
        {contacts.map(c => (
          <div key={c.id} className={`${cls.subcard} flex items-start justify-between gap-3`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[#1E293B]">{c.full_name}</span>
                {c.is_decision_maker && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cvc-gold/20 text-[#92400e] uppercase tracking-wide">DM</span>
                )}
              </div>
              {c.title && <p className={cls.faint}>{c.title}</p>}
              <div className="flex gap-4 mt-1">
                {c.email && (
                  <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <Mail className="w-3 h-3" />{c.email}
                  </a>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-xs text-slate-600 hover:underline">
                    <Phone className="w-3 h-3" />{c.phone}
                  </a>
                )}
              </div>
            </div>
            <button onClick={() => removeContact(c.id)} className="text-slate-400 hover:text-red-500 transition-colors p-1">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Notes Tab ─────────────────────────────────────────────────────────────────

function NotesTab({ targetId }: { targetId: number }) {
  const [notes, setNotes]   = useState<Note[]>([]);
  const [type, setType]     = useState('general');
  const [body, setBody]     = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/sales/targets/${targetId}/notes`, { headers: AUTH });
    if (res.ok) setNotes(await res.json());
  }, [targetId]);

  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/sales/targets/${targetId}/notes`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_type: type, body }),
      });
      if (res.ok) { const n = await res.json(); setNotes(ns => [n, ...ns]); setBody(''); }
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className={`${cls.dataArea} space-y-3`}>
        <div className="flex gap-2">
          {NOTE_TYPES.map(t => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition-all ${
                type === t ? 'bg-[#1E293B] text-white border-[#1E293B]' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400'
              }`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <textarea
          className={`${cls.inputFull} min-h-[80px] resize-y`}
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Add a note…"
        />
        <button type="submit" disabled={saving || !body.trim()} className={cls.btnPrimary}>
          {saving ? 'Saving…' : 'Add Note'}
        </button>
      </form>

      {notes.length === 0 && <p className={cls.muted}>No notes yet.</p>}

      <div className="space-y-2">
        {notes.map(n => {
          const currentUser = (() => {
            try { const t = localStorage.getItem('platform_jwt'); if (!t) return ''; return JSON.parse(atob(t.split('.')[1])).sub ?? ''; }
            catch { return ''; }
          })();
          const isMeeting = n.note_type === 'meeting';
          const DIMS = [
            { key: 'rating_buying_intent',  label: 'Buying Intent'  },
            { key: 'rating_dm_access',      label: 'DM Access'      },
            { key: 'rating_budget_fit',     label: 'Budget Fit'     },
            { key: 'rating_strategic_fit',  label: 'Strategic Fit'  },
            { key: 'rating_timeline',       label: 'Timeline'       },
          ] as const;
          const hasRatings = isMeeting && DIMS.some(d => (n as any)[d.key] != null);

          return (
            <div key={n.id} className={`${cls.subcard} space-y-2`}>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${NOTE_COLORS[n.note_type] || 'bg-slate-100 text-slate-500'}`}>
                  {n.note_type}
                </span>
                {n.author && <span className={cls.faint}>{n.author}</span>}
                {isMeeting && n.meeting_date && <span className={cls.faint}>· {n.meeting_date}</span>}
                <span className={`${cls.faint} ml-auto`}>{fmtDate(n.created_at)}</span>
              </div>

              {/* Tech interest / challenge — highlighted */}
              {isMeeting && (n.tech_interest || n.tech_challenge) && (
                <div className="grid grid-cols-1 gap-1.5">
                  {n.tech_interest && (
                    <div className="bg-blue-50 border border-blue-100 rounded px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-0.5">Tech Interest</p>
                      <p className="text-sm text-blue-900 leading-snug">{n.tech_interest}</p>
                    </div>
                  )}
                  {n.tech_challenge && (
                    <div className="bg-amber-50 border border-amber-100 rounded px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-0.5">Tech Challenge</p>
                      <p className="text-sm text-amber-900 leading-snug">{n.tech_challenge}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Ratings */}
              {hasRatings && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-1">
                  {DIMS.map(d => {
                    const rating: number | null = (n as any)[d.key];
                    if (rating == null) return null;
                    return (
                      <div key={d.key} className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-400 font-medium">{d.label}</span>
                        <span className="text-xs text-amber-400">{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Personal note — author only */}
              {isMeeting && n.personal_note && n.author === currentUser && (
                <div className="flex items-start gap-1.5 px-2 py-2 bg-amber-50 border border-amber-100 rounded text-xs text-amber-900">
                  <span className="mt-0.5 shrink-0">🔒</span>
                  <span>{n.personal_note}</span>
                </div>
              )}

              {/* Transcript */}
              {isMeeting && n.transcript_text && (
                <details>
                  <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 transition-colors">View transcript</summary>
                  <pre className="mt-1.5 text-xs text-slate-600 bg-[#F8FAFC] border border-slate-100 rounded p-2 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">{n.transcript_text}</pre>
                </details>
              )}

              {/* Plain body for non-meeting notes */}
              {!isMeeting && (
                <p className="text-sm text-[#1E293B] leading-relaxed whitespace-pre-wrap">{n.body}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Proposal Tab ──────────────────────────────────────────────────────────────

const PARTNER_LEVELS = ['Ecosystem', 'Ecosystem Plus', 'Anchor', 'Founding Anchor'];

function fmtK(v: number): string {
  if (v === 0) return '$0';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  return `$${(v / 1_000).toFixed(0)}K`;
}

function ProposalTab({ target, onUpdate }: { target: SalesTarget; onUpdate: (t: SalesTarget) => void }) {
  const gate   = (target as any).stage_gate_data ?? {};
  const saved0 = gate.line_item_counts ?? {};

  const [partnerLevel, setPartnerLevel] = useState<string>(gate.partner_level ?? '');
  const isAnchor = ANCHOR_LEVELS.has(partnerLevel);

  function handlePartnerLevel(l: string) {
    const next = partnerLevel === l ? '' : l;
    setPartnerLevel(next);
    // If downgrading away from Anchor, zero out anchor-only counts
    if (!ANCHOR_LEVELS.has(next)) {
      setCounts(c => {
        const updated = { ...c };
        LINE_ITEMS.filter(li => li.anchorOnly).forEach(li => { updated[li.key] = 0; });
        return updated;
      });
    }
  }
  const [counts, setCounts]             = useState<Record<string, number>>(
    Object.fromEntries(LINE_ITEMS.map(li => [li.key, Number(saved0[li.key] ?? 0)]))
  );
  const [otherText, setOtherText]       = useState<string>(gate.other_text ?? '');
  const [contractValue, setContractValue] = useState(target.contract_value?.toString() ?? '');
  const [termMonths, setTermMonths]       = useState(target.contract_term_months?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  // Base: flat program + ad-hoc startup intros included in every proposal
  const BASE_VALUE = 80_000;

  // Auto-calculated proposed value: base + counts × fixed prices
  const addonsValue   = LINE_ITEMS.reduce((sum, li) => sum + (counts[li.key] || 0) * li.price, 0);
  const proposedValue = BASE_VALUE + addonsValue;
  const contractNum   = parseFloat(contractValue) || 0;
  const discount      = proposedValue - contractNum;

  function setCount(key: string, delta: number) {
    setCounts(c => ({ ...c, [key]: Math.max(0, (c[key] || 0) + delta) }));
  }

  async function save() {
    setSaving(true); setSavedOk(false);
    const deliverables = [
      ...LINE_ITEMS.filter(li => counts[li.key] > 0).map(li => `${li.label} (${counts[li.key]})`),
      ...(otherText.trim() ? [`Other: ${otherText.trim()}`] : []),
    ];
    try {
      const res = await fetch(`/sales/targets/${target.id}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposed_deliverables: deliverables,
          contract_value: contractValue ? parseFloat(contractValue) : null,
          contract_term_months: termMonths ? parseInt(termMonths) : null,
          stage_gate_data: {
            partner_level:    partnerLevel || null,
            line_item_counts: counts,
            base_value:       BASE_VALUE,
            proposed_value:   proposedValue,
            other_text:       otherText.trim() || null,
          },
        }),
      });
      if (res.ok) { onUpdate(await res.json()); setSavedOk(true); setTimeout(() => setSavedOk(false), 2000); }
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      {/* Partner Level */}
      <div>
        <p className={`${cls.meta} mb-2`}>Partner Level</p>
        <div className="flex gap-2 flex-wrap">
          {PARTNER_LEVELS.map(l => (
            <button key={l} onClick={() => handlePartnerLevel(l)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                partnerLevel === l
                  ? 'bg-[#1E293B] text-[#F59E0B] border-[#1E293B]'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-[#1E293B]'
              }`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Service Counts */}
      <div>
        <p className={`${cls.meta} mb-2`}>Services</p>
        <div className="space-y-1.5">
          {/* Base row — always included */}
          <div className="flex items-center gap-3 py-1.5 border-b border-slate-100">
            <span className="text-sm w-36 shrink-0 text-[#1E293B] font-medium">Program & Intros</span>
            <span className="text-[10px] text-slate-400 font-mono w-12 shrink-0">flat</span>
            <span className="text-[10px] text-emerald-600 font-semibold px-2 py-0.5 bg-emerald-50 rounded-full shrink-0">included</span>
            <span className="ml-auto text-xs font-mono font-semibold text-[#1E293B] tabular-nums">$80K</span>
          </div>
          {LINE_ITEMS.map(li => {
            const locked   = li.anchorOnly && !isAnchor;
            const count    = locked ? 0 : (counts[li.key] || 0);
            const subtotal = count * li.price;
            return (
              <div key={li.key} className={`flex items-center gap-3 py-1.5 border-b border-slate-100 last:border-0 ${locked ? 'opacity-40' : ''}`}>
                <span className={`text-sm w-36 shrink-0 ${count > 0 ? 'text-[#1E293B] font-medium' : 'text-slate-400'}`}>
                  {li.label}
                </span>
                <span className="text-[10px] text-slate-400 font-mono w-12 shrink-0">
                  {fmtK(li.price)}/ea
                </span>
                {locked ? (
                  <span className="text-[10px] text-slate-400 font-semibold px-2 py-0.5 bg-slate-100 rounded-full shrink-0">Anchor only</span>
                ) : (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setCount(li.key, -1)}
                      disabled={count === 0}
                      className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center text-slate-500 hover:border-slate-400 hover:bg-linen disabled:opacity-30 disabled:cursor-not-allowed text-sm leading-none"
                    >−</button>
                    <span className={`w-6 text-center text-sm font-bold tabular-nums ${count > 0 ? 'text-[#1E293B]' : 'text-slate-300'}`}>
                      {count}
                    </span>
                    <button
                      onClick={() => setCount(li.key, 1)}
                      className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center text-slate-500 hover:border-slate-400 hover:bg-linen text-sm leading-none"
                    >+</button>
                  </div>
                )}
                <span className={`ml-auto text-xs font-mono tabular-nums ${subtotal > 0 ? 'text-[#1E293B] font-semibold' : 'text-slate-300'}`}>
                  {subtotal > 0 ? fmtK(subtotal) : '—'}
                </span>
              </div>
            );
          })}
        </div>

        {/* Other notes */}
        <div className="mt-3">
          <label className={`${cls.meta} mb-1 block`}>Other / Notes</label>
          <input type="text" placeholder="e.g. Custom workshop, co-marketing…"
            value={otherText}
            onChange={e => setOtherText(e.target.value)}
            className={cls.inputFull} />
        </div>
      </div>

      {/* Proposed Value summary */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC] border-b border-slate-100">
          <span className={cls.meta}>Proposed Value</span>
          <span className="text-lg font-extrabold tabular-nums text-[#1E293B]">
            ${proposedValue.toLocaleString()}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-0 divide-x divide-slate-100">
          <div className="px-4 py-3">
            <label className={`${cls.meta} mb-1 block`}>Contract Value ($)</label>
            <input className={cls.inputFull} type="number" min="0" step="1000" placeholder="0"
              value={contractValue} onChange={e => setContractValue(e.target.value)} />
          </div>
          <div className="px-4 py-3">
            <label className={`${cls.meta} mb-1 block`}>Term (months)</label>
            <input className={cls.inputFull} type="number" min="1" max="120" placeholder="12"
              value={termMonths} onChange={e => setTermMonths(e.target.value)} />
          </div>
        </div>
        {contractNum > 0 && proposedValue > 0 && (
          <div className={`flex items-center justify-between px-4 py-2.5 border-t border-slate-100 ${discount > 0 ? 'bg-amber-50' : 'bg-emerald-50'}`}>
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${discount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {discount > 0 ? 'Discount' : 'Premium'}
            </span>
            <span className={`text-sm font-bold tabular-nums ${discount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {discount > 0 ? `−$${discount.toLocaleString()}` : `+$${Math.abs(discount).toLocaleString()}`}
            </span>
          </div>
        )}
      </div>

      <button onClick={save} disabled={saving} className={cls.btnPrimary}>
        {savedOk ? <><Check className="w-3.5 h-3.5 inline mr-1" />Saved</> : saving ? 'Saving…' : <><Save className="w-3.5 h-3.5 inline mr-1" />Save Proposal</>}
      </button>
    </div>
  );
}

// ── Skirmish Tab ──────────────────────────────────────────────────────────────

const TRIAL_SERVICES = [
  {
    key:         'dealflow',
    label:       'Trial Dealflow',
    description: 'A live session with curated startups matching their focus area.',
    color:       '#F59E0B',
    fields: [
      { key: 'contact_name',    label: 'Partner contact attending *',           type: 'text',     placeholder: 'Jane Smith' },
      { key: 'contact_email',   label: 'Contact email',                         type: 'email',    placeholder: 'jane@company.com' },
      { key: 'sectors',         label: 'Sector / technology focus *',           type: 'text',     placeholder: 'e.g. Robotics, Supply Chain AI' },
      { key: 'stage_preference',label: 'Startup stage preference',              type: 'select',   options: ['Any', 'Pre-seed', 'Seed', 'Series A', 'Series B+'] },
      { key: 'format',          label: 'Format',                                type: 'select',   options: ['Virtual', 'In-Person'] },
      { key: 'criteria',        label: 'Specific criteria or must-haves',       type: 'textarea', placeholder: 'e.g. must have pilots with manufacturers' },
      { key: 'session_date',    label: 'Ideal timing',                          type: 'text',     placeholder: 'e.g. Late May, first week of June' },
    ],
  },
  {
    key:         'collection',
    label:       'Trial Collection',
    description: 'A curated shortlist of vetted startups sent directly to the partner.',
    color:       '#06B6D4',
    fields: [
      { key: 'contact_name',    label: 'Partner contact requesting this *',     type: 'text',     placeholder: 'Jane Smith' },
      { key: 'contact_email',   label: 'Contact email',                         type: 'email',    placeholder: 'jane@company.com' },
      { key: 'problem',         label: 'Problem they are trying to solve *',    type: 'textarea', placeholder: 'e.g. We need faster last-mile logistics visibility' },
      { key: 'sectors',         label: 'Technology / sector focus',             type: 'text',     placeholder: 'e.g. Supply Chain, Physical AI' },
      { key: 'stage_preference',label: 'Startup stage preference',              type: 'select',   options: ['Any', 'Pre-seed', 'Seed', 'Series A', 'Series B+'] },
      { key: 'count_preference',label: 'How many companies?',                   type: 'select',   options: ['3', '5', '10'] },
      { key: 'criteria',        label: 'Must-haves or exclusions',              type: 'textarea', placeholder: 'e.g. No hardware-only companies' },
    ],
  },
  {
    key:         'trend_report',
    label:       'Trial Trend Report',
    description: 'A sector intelligence report tailored to their strategic questions.',
    color:       '#6366F1',
    fields: [
      { key: 'contact_name',    label: 'Partner contact *',                     type: 'text',     placeholder: 'Jane Smith' },
      { key: 'contact_email',   label: 'Contact email',                         type: 'email',    placeholder: 'jane@company.com' },
      { key: 'topic',           label: 'Sector or topic *',                     type: 'text',     placeholder: 'e.g. Physical AI in Manufacturing' },
      { key: 'questions',       label: 'Key questions to answer *',             type: 'textarea', placeholder: 'e.g. Where is the VC money going? Who are the breakout companies?' },
      { key: 'urgency',         label: 'Urgency',                               type: 'select',   options: ['This Week', 'This Month', 'Next Quarter'] },
      { key: 'deadline',        label: 'Needed by (date)',                      type: 'text',     placeholder: 'e.g. May 20' },
    ],
  },
] as const;

type TrialServiceKey = typeof TRIAL_SERVICES[number]['key'];

function SkirmishTab({ target }: { target: SalesTarget }) {
  const [selected, setSelected] = useState<TrialServiceKey | null>(null);
  const [fields, setFields]     = useState<Record<string, string>>({});
  const [saving, setSaving]     = useState(false);
  const [success, setSuccess]   = useState('');
  const [err, setErr]           = useState('');

  const service = TRIAL_SERVICES.find(s => s.key === selected) ?? null;

  function pick(key: TrialServiceKey) {
    setSelected(key);
    setFields({});
    setSuccess('');
    setErr('');
  }

  function back() {
    setSelected(null);
    setFields({});
    setErr('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!service) return;
    // Check required fields (marked with *)
    const required = service.fields.filter(f => f.label.endsWith('*')).map(f => f.key);
    const missing  = required.filter(k => !fields[k]?.trim());
    if (missing.length) { setErr('Please fill in all required fields.'); return; }

    setSaving(true); setErr('');
    const title = `${service.label} — ${target.company_name}`;
    const serviceFields = {
      ...fields,
      description: `[Sales target: ${target.company_name}]`,
      sales_target_id: String(target.id),
    };
    try {
      const res = await fetch(`/sales/targets/${target.id}/skirmish`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          service_type: service.key,
          priority:     'high',
          description:  Object.entries(fields)
            .filter(([, v]) => v.trim())
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n'),
          service_fields: serviceFields,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed'); }
      const s = await res.json();
      setSuccess(`Request #${s.id} sent to Ventures — "${s.title}"`);
      setSelected(null);
      setFields({});
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setSaving(false); }
  }

  // ── Service selector ──────────────────────────────────────────────────────
  if (!selected) {
    return (
      <div className="space-y-3">
        <p className={cls.muted}>Select a trial service to send to the Ventures team.</p>
        {TRIAL_SERVICES.map(svc => (
          <button
            key={svc.key}
            onClick={() => pick(svc.key)}
            className="w-full text-left border border-slate-200 rounded-xl p-4 hover:border-slate-400 hover:shadow-cvc transition-all bg-white group"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-2 h-8 rounded-full shrink-0"
                style={{ backgroundColor: svc.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#1E293B] group-hover:text-[#1E293B]">{svc.label}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">{svc.description}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 shrink-0" />
            </div>
          </button>
        ))}
        <p className={cls.faint}>
          View all requests in the <Link to="/requests" className="underline hover:text-[#1E293B]">Requests</Link> page.
        </p>
      </div>
    );
  }

  // ── Guided form ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button onClick={back} className="text-xs text-slate-400 hover:text-[#1E293B] transition-colors flex items-center gap-1">
          ← back
        </button>
        <div className="flex items-center gap-2 ml-2">
          <div className="w-2 h-5 rounded-full shrink-0" style={{ backgroundColor: service!.color }} />
          <p className="text-sm font-bold text-[#1E293B]">{service!.label}</p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3">
        {service!.fields.map(f => (
          <div key={f.key}>
            <label className={`${cls.meta} mb-1 block`}>{f.label}</label>
            {f.type === 'textarea' ? (
              <textarea
                className={`${cls.inputFull} min-h-[72px] resize-y`}
                placeholder={'placeholder' in f ? f.placeholder : ''}
                value={fields[f.key] ?? ''}
                onChange={e => setFields(fv => ({ ...fv, [f.key]: e.target.value }))}
              />
            ) : f.type === 'select' ? (
              <select
                className={`${cls.select} w-full`}
                value={fields[f.key] ?? ''}
                onChange={e => setFields(fv => ({ ...fv, [f.key]: e.target.value }))}
              >
                <option value="">— Select —</option>
                {'options' in f && f.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={f.type}
                className={cls.inputFull}
                placeholder={'placeholder' in f ? f.placeholder : ''}
                value={fields[f.key] ?? ''}
                onChange={e => setFields(fv => ({ ...fv, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}

        {err && <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{err}</p>}
        {success && <p className="text-xs text-emerald-700 bg-emerald-50 rounded px-3 py-2">{success}</p>}

        <button type="submit" disabled={saving} className={cls.btnPrimary}>
          <Send className="w-3.5 h-3.5 inline mr-1.5" />
          {saving ? 'Sending…' : 'Send to Ventures'}
        </button>
      </form>
    </div>
  );
}

// ── Advance Stage Panel ───────────────────────────────────────────────────────

function AdvancePanel({
  target, onAdvanced, onClose,
}: { target: SalesTarget; onAdvanced: (t: SalesTarget) => void; onClose: () => void }) {
  const idx       = ADVANCE_STAGES.indexOf(target.stage);
  const nextStage = idx >= 0 ? ADVANCE_STAGES[idx + 1] : null;
  const [gate, setGate] = useState<Record<string, string | boolean>>({});
  const [err, setErr]   = useState('');
  const [saving, setSaving] = useState(false);

  if (!nextStage) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      const res = await fetch(`/sales/targets/${target.id}/advance`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ gate_data: gate }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed'); }
      onAdvanced(await res.json());
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setSaving(false); }
  }

  return (
    <div className={`${cls.dataArea} space-y-3`}>
      <div className="flex items-center justify-between">
        <p className={cls.sectionTitle}>
          Advance to <span className="text-cvc-gold">{STAGE_LABELS[nextStage]}</span>
        </p>
        <button onClick={onClose} className="p-1 rounded hover:bg-white"><X className="w-4 h-4" /></button>
      </div>

      <form onSubmit={submit} className="space-y-3">
        {nextStage === 'nurturing' && (
          <>
            <div>
              <label className={`${cls.meta} mb-1 block`}>Corporate Interests *</label>
              <textarea className={`${cls.inputFull} min-h-[72px] resize-y`}
                value={(gate.corporate_interests as string) || ''}
                onChange={e => setGate(g => ({ ...g, corporate_interests: e.target.value }))}
                placeholder="What is this company interested in from our team?" />
            </div>
            <div>
              <label className={`${cls.meta} mb-1 block`}>Outreach Date *</label>
              <input className={cls.inputFull} type="date"
                value={(gate.outreach_date as string) || ''}
                onChange={e => setGate(g => ({ ...g, outreach_date: e.target.value }))} />
            </div>
            <p className={cls.faint}>Requires at least 1 contact in the Contacts tab.</p>
          </>
        )}

        {nextStage === 'proposal' && (
          <>
            <div>
              <label className={`${cls.meta} mb-1 block`}>Technology Interests *</label>
              <textarea className={`${cls.inputFull} min-h-[72px] resize-y`}
                value={(gate.tech_interests as string) || ''}
                onChange={e => setGate(g => ({ ...g, tech_interests: e.target.value }))}
                placeholder="Which sectors / technologies do they care about?" />
            </div>
            <label className="flex items-center gap-2 text-sm text-[#1E293B] cursor-pointer">
              <input type="checkbox"
                checked={!!(gate.decision_maker_confirmed)}
                onChange={e => setGate(g => ({ ...g, decision_maker_confirmed: e.target.checked }))}
                className="accent-[#1E293B]"
              />
              Decision maker confirmed
            </label>
            <p className={cls.faint}>Requires at least 1 note in the Notes tab.</p>
          </>
        )}

        {nextStage === 'closed_won' && (
          <p className={cls.muted}>
            Set contract_value, signed_date, and proposed_deliverables in the Proposal tab first, then advance.
          </p>
        )}

        {err && <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{err}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={cls.btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} className={cls.btnPrimary}>
            {saving ? 'Advancing…' : `Advance to ${STAGE_LABELS[nextStage]}`}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Mark Lost Modal ───────────────────────────────────────────────────────────

function LostModal({
  target, onClose, onLost,
}: { target: SalesTarget; onClose: () => void; onLost: (t: SalesTarget) => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/sales/targets/${target.id}/lose`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) { onLost(await res.json()); onClose(); }
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className={`${cls.cardPadded} w-[380px] space-y-4`}>
        <div className="flex items-center justify-between">
          <p className={cls.sectionTitle}>Mark as Lost</p>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className={`${cls.meta} mb-1 block`}>Reason *</label>
            <textarea className={`${cls.inputFull} min-h-[80px] resize-y`} value={reason}
              onChange={e => setReason(e.target.value)} placeholder="Why did we lose this?" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={cls.btnSecondary}>Cancel</button>
            <button type="submit" disabled={saving || !reason.trim()}
              className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors flex-1">
              {saving ? 'Saving…' : 'Mark Lost'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Detail Panel (slide-in) ───────────────────────────────────────────────────

const TABS = ['contacts', 'notes', 'proposal', 'skirmish'] as const;
type Tab = typeof TABS[number];

function DetailPanel({ target, onUpdate, onClose, onDelete }: {
  target: SalesTarget;
  onUpdate: (t: SalesTarget) => void;
  onClose: () => void;
  onDelete: (id: number) => void;
}) {
  const PLATFORM_USERS = useTeamMembers();
  const config = useConfig();
  const SECTORS = config.sectors;
  const [tab, setTab]           = useState<Tab>('contacts');
  const [showAdvance, setShowAdvance] = useState(false);
  const [showLost, setShowLost]       = useState(false);
  const [editing, setEditing]         = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editForm, setEditForm]       = useState({
    assigned_to: target.assigned_to ?? '',
    rationale:   target.rationale ?? '',
    est_deal_type: target.est_deal_type ?? '',
  });
  const [saving, setSaving] = useState(false);

  async function handleDelete() {
    const res = await fetch(`/sales/targets/${target.id}`, { method: 'DELETE', headers: AUTH });
    if (res.ok) { onDelete(target.id); onClose(); }
  }

  const canAdvance = ADVANCE_STAGES.includes(target.stage);
  const isActive   = !['closed_won', 'closed_lost'].includes(target.stage);

  // Reset tab and edit state when target changes
  useEffect(() => {
    setTab('contacts');
    setEditing(false);
    setShowAdvance(false);
    setShowLost(false);
    setEditForm({
      assigned_to: target.assigned_to ?? '',
      rationale:   target.rationale ?? '',
      est_deal_type: target.est_deal_type ?? '',
    });
  }, [target.id]);

  async function saveEdit() {
    setSaving(true);
    try {
      const res = await fetch(`/sales/targets/${target.id}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to:   editForm.assigned_to || null,
          rationale:     editForm.rationale || null,
          est_deal_type: editForm.est_deal_type || null,
        }),
      });
      if (res.ok) { onUpdate(await res.json()); setEditing(false); }
    } finally { setSaving(false); }
  }

  const color = personColor(target.assigned_to ?? '');

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div className="fixed right-0 top-0 h-full w-[480px] bg-white shadow-2xl z-50 overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                {target.assigned_to && (
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                    style={{ backgroundColor: color }}
                  >
                    {personInitial(target.assigned_to)}
                  </div>
                )}
                <h2 className={`${cls.pageTitle} text-xl leading-tight`}>{target.company_name}</h2>
              </div>
              {target.website && (
                <a href={target.website} target="_blank" rel="noreferrer"
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-0.5">
                  <ExternalLink className="w-3 h-3" />{target.website.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${STAGE_COLORS[target.stage]}`}>
                {STAGE_LABELS[target.stage]}
              </span>
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-red-600 font-medium">Delete?</span>
                  <button onClick={handleDelete} className="text-xs px-2 py-0.5 bg-red-500 text-white rounded font-semibold hover:bg-red-600">Yes</button>
                  <button onClick={() => setConfirmDelete(false)} className="text-xs px-2 py-0.5 border border-slate-300 rounded font-semibold hover:bg-linen">No</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="p-1 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-linen text-slate-500 hover:text-[#1E293B] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <StageStepper stage={target.stage} />

          {/* Meta */}
          <div className="flex flex-wrap gap-3 text-xs text-slate-500">
            {target.sector && <span><Building2 className="w-3 h-3 inline mr-1" />{target.sector}</span>}
            {target.assigned_to && <span><User className="w-3 h-3 inline mr-1" />{target.assigned_to}</span>}
            {target.est_deal_type && <span><Handshake className="w-3 h-3 inline mr-1" />{target.est_deal_type}</span>}
            {target.contract_value && <span><TrendingUp className="w-3 h-3 inline mr-1" />${target.contract_value.toLocaleString()}</span>}
            <span><Clock className="w-3 h-3 inline mr-1" />{fmtRelative(target.stage_changed_at)}</span>
          </div>

          {/* Edit form */}
          {editing ? (
            <div className={`${cls.dataArea} space-y-3`}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`${cls.meta} mb-1 block`}>Assigned To</label>
                  <select className={`${cls.select} w-full`} value={editForm.assigned_to}
                    onChange={e => setEditForm(f => ({ ...f, assigned_to: e.target.value }))}>
                    <option value="">— None —</option>
                    {PLATFORM_USERS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`${cls.meta} mb-1 block`}>Deal Type</label>
                  <select className={`${cls.select} w-full`} value={editForm.est_deal_type}
                    onChange={e => setEditForm(f => ({ ...f, est_deal_type: e.target.value }))}>
                    <option value="">— None —</option>
                    {DEAL_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={`${cls.meta} mb-1 block`}>Rationale</label>
                <textarea className={`${cls.inputFull} min-h-[60px] resize-y`} value={editForm.rationale}
                  onChange={e => setEditForm(f => ({ ...f, rationale: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)} className={cls.btnSecondary}>Cancel</button>
                <button onClick={saveEdit} disabled={saving} className={cls.btnPrimary}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setEditing(true)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-[#1E293B] transition-colors">
              <Edit3 className="w-3 h-3" />Edit details
            </button>
          )}

          {/* Advance / Lose buttons */}
          {isActive && !editing && (
            <div className="flex gap-2">
              {canAdvance && !showAdvance && (
                <button onClick={() => setShowAdvance(true)} className={cls.btnPrimary}>
                  <ChevronRight className="w-3.5 h-3.5 inline mr-1" />
                  Advance Stage
                </button>
              )}
              <button onClick={() => setShowLost(true)}
                className="border border-red-200 text-red-600 rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-50 transition-colors">
                Mark Lost
              </button>
            </div>
          )}

          {showAdvance && (
            <AdvancePanel target={target} onAdvanced={t => { onUpdate(t); setShowAdvance(false); }} onClose={() => setShowAdvance(false)} />
          )}
        </div>

        {/* Rationale */}
        {target.rationale && !editing && (
          <div className="px-5 py-3 border-b border-slate-100 bg-linen">
            <p className={`${cls.meta} mb-1`}>Rationale</p>
            <p className="text-sm text-[#1E293B] leading-relaxed">{target.rationale}</p>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex border-b border-slate-200 px-5">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-all -mb-px capitalize ${
                tab === t
                  ? 'border-[#1E293B] text-[#1E293B]'
                  : 'border-transparent text-slate-500 hover:text-[#1E293B]'
              }`}>
              {t === 'skirmish' ? 'Requests' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5 flex-1">
          {tab === 'contacts'  && <ContactsTab targetId={target.id} />}
          {tab === 'notes'     && <NotesTab targetId={target.id} />}
          {tab === 'proposal'  && <ProposalTab target={target} onUpdate={onUpdate} />}
          {tab === 'skirmish'  && <SkirmishTab target={target} />}
        </div>

        {showLost && (
          <LostModal target={target} onClose={() => setShowLost(false)} onLost={t => { onUpdate(t); setShowLost(false); }} />
        )}
      </div>
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SalesPage() {
  const [targets, setTargets]         = useState<SalesTarget[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState<SalesTarget | null>(null);
  const [personFilter, setPersonFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdd, setShowAdd]         = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);

  // Fetch all targets on mount (no stage filter — client-side filtering)
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/sales/targets', { headers: AUTH });
      if (res.ok) setTargets(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load leaderboard once on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/sales/leaderboard', { headers: AUTH });
        if (res.ok) setLeaderboard(await res.json());
      } finally {
        setLeaderboardLoading(false);
      }
    })();
  }, []);

  function handleUpdate(updated: SalesTarget) {
    setTargets(ts => ts.map(t => t.id === updated.id ? updated : t));
    if (selected?.id === updated.id) setSelected(updated);
  }

  function handleCreated(t: SalesTarget) {
    setTargets(ts => [t, ...ts]);
  }

  async function moveCard(id: number, fromStage: string, toStage: string) {
    if (fromStage === toStage) return;
    const now = new Date().toISOString();
    setTargets(ts => ts.map(t => t.id === id ? { ...t, stage: toStage, stage_changed_at: now } : t));
    if (selected?.id === id) setSelected(s => s ? { ...s, stage: toStage, stage_changed_at: now } : null);
    const res = await fetch(`/sales/targets/${id}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: toStage }),
    });
    if (res.ok) {
      const updated = await res.json();
      setTargets(ts => ts.map(t => t.id === id ? updated : t));
      if (selected?.id === id) setSelected(updated);
    } else {
      load();
    }
  }

  // Co-owner map: target id → co-owner username (from linked_target_id)
  const coOwnerMap = new Map<number, string>();
  targets.forEach(t => {
    if (t.linked_target_id) {
      const linked = targets.find(x => x.id === t.linked_target_id);
      if (linked?.assigned_to) coOwnerMap.set(t.id, linked.assigned_to);
    }
  });

  // Client-side filtering
  const filtered = targets.filter(t => {
    if (personFilter !== 'all' && t.assigned_to !== personFilter) return false;
    if (searchQuery && !t.company_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  // Split into columns
  const byStage = (stage: string) => filtered.filter(t => t.stage === stage);

  // Unique persons from leaderboard for filter pills
  const persons = leaderboard.map(e => e.username);

  return (
    <div className={cls.page}>
      <CVCNavbar />

      <div className="max-w-[1800px] mx-auto px-6 py-8">
        {/* Page header */}
        <div className="border-b-2 border-[#1E293B] pb-5 mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Vertical OS · Sales</p>
            <h1 className={cls.pageTitle}>Sales</h1>
            <p className="text-sm text-slate-500 mt-1">Pipeline · Targets · Proposals</p>
          </div>
          <button onClick={() => setShowAdd(true)} className={cls.btnPrimary}>
            <Plus className="w-4 h-4 inline mr-1" />Add Target
          </button>
        </div>


        {/* Person strip */}
        {!leaderboardLoading && leaderboard.length > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-5">
            {leaderboard.map(entry => (
              <PersonMiniCard key={entry.username} entry={entry} />
            ))}
          </div>
        )}
        {leaderboardLoading && (
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-cvc animate-pulse h-[76px]" />
            ))}
          </div>
        )}

        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {/* Person pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setPersonFilter('all')}
              className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition-all ${
                personFilter === 'all'
                  ? 'bg-[#1E293B] text-[#F59E0B] border-[#1E293B]'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400'
              }`}
            >
              All
            </button>
            {persons.map(p => (
              <button
                key={p}
                onClick={() => setPersonFilter(personFilter === p ? 'all' : p)}
                className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition-all capitalize ${
                  personFilter === p
                    ? 'text-white border-transparent'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400'
                }`}
                style={personFilter === p ? { backgroundColor: personColor(p), borderColor: personColor(p) } : {}}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="ml-auto relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              className="bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-sm text-[#1E293B] focus:outline-none focus:ring-1 focus:ring-[#1E293B] w-52"
              placeholder="Search companies…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* ── Pipeline view ── */}
        {(
          loading ? (
            <div className="flex justify-center items-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#1E293B] border-r-transparent" />
            </div>
          ) : (
            <DndProvider backend={HTML5Backend}>
              <div className="grid grid-cols-4 gap-4">
                <KanbanColumn title="Targets" stage="target" targets={byStage('target')} selected={selected} onSelect={setSelected} coOwnerMap={coOwnerMap} onDrop={(id, from) => moveCard(id, from, 'target')} />
                <KanbanColumn title="Nurturing" stage="nurturing" targets={byStage('nurturing')} selected={selected} onSelect={setSelected} coOwnerMap={coOwnerMap} onDrop={(id, from) => moveCard(id, from, 'nurturing')} />
                <KanbanColumn title="Proposal" stage="proposal" targets={byStage('proposal')} selected={selected} onSelect={setSelected} coOwnerMap={coOwnerMap} onDrop={(id, from) => moveCard(id, from, 'proposal')} />
                <ClosedColumn won={byStage('closed_won')} lost={byStage('closed_lost')} selected={selected} onSelect={setSelected} coOwnerMap={coOwnerMap} onDropWon={(id, from) => moveCard(id, from, 'closed_won')} onDropLost={(id, from) => moveCard(id, from, 'closed_lost')} />
              </div>
            </DndProvider>
          )
        )}

      </div>

      {/* Detail panel — slide-in overlay */}
      {selected && (
        <DetailPanel
          target={selected}
          onUpdate={handleUpdate}
          onClose={() => setSelected(null)}
          onDelete={id => { setTargets(ts => ts.filter(t => t.id !== id)); setSelected(null); }}
        />
      )}

      {showAdd && (
        <AddTargetModal onClose={() => setShowAdd(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}
