import { useParams, Link } from 'react-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Save, ChevronDown, ChevronRight, Shield, Zap, AlertTriangle, Plus, X, Pencil, MessageSquare, Check, Send } from 'lucide-react';
import { api } from '../api/client';
import { AUTH_HEADER as AUTH } from '../api/client';
import { FeedbackModal } from '../components/FeedbackModal';
import { QuickNotePanel } from '../components/QuickNotePanel';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PartnerDetail {
  id: number;
  name: string;
  industry?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  sectors_of_interest: string[];
  challenge_areas: string[];
  notes?: string | null;
  partner_brief?: string | null;
  current_protocols: string[];
  cloud_platform?: string | null;
  hardware_vendors: string[];
  factory_regions: string[];
  scaling_speed?: string | null;
  tech_stack?: Record<string, string[]> | null;
  matches: MatchItem[];
  partner_notes: NoteItem[];
  membership_level?: string | null;
}

interface MatchItem {
  id: number;
  company_id: number;
  name: string;
  sector?: string;
  stage?: string;
  country?: string;
  sovereignty_score?: number | null;
  sovereignty_tier: string;
  verified_certs: string[];
  deployment_signal?: string | null;
  protocol_support: string[];
  investors: string[];
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

interface CompatCompany {
  id: number;
  name: string;
  sector?: string;
  stage?: string;
  country?: string;
  compatibility_score: number;
  compatibility_label: string;
  compatibility_badge: string;
  protocol_overlap: string[];
  all_protocols: string[];
  mrl_band_hit: boolean;
  industrial_readiness_score?: number | null;
  sovereignty_score?: number | null;
  sovereignty_tier: string;
  deployment_signal?: string | null;
  verified_certs: string[];
  total_funding: number;
}

interface AdvisoryLog {
  id: number;
  log_type: string;
  body: string;
  company_name?: string | null;
  meeting_date?: string | null;
  outcome?: string | null;
  next_steps?: string | null;
  source_url?: string | null;
  created_at?: string | null;
  created_by: string;
}

interface PartnerIssue {
  id: number;
  partner_id: number;
  title: string;
  body?: string | null;
  severity: 'high' | 'medium' | 'low';
  resolved: boolean;
  due_date?: string | null;
}

interface IssueComment {
  id: number;
  issue_id: number;
  body: string;
  created_by: string;
  created_at: string;
}

interface StackLayer {
  id: string;
  label: string;
  sublabel: string;
  color: string;
  slots: string[];
  dnaField?: 'cloud_platform' | 'current_protocols' | 'hardware_vendors';
}

type Tab = 'profile' | 'tracking' | 'discovery' | 'pilots' | 'risk' | 'stack' | 'problems' | 'notes';

interface ServiceNote {
  id: number;
  partner_id: number;
  note_type: string;
  body: string;
  created_by: string;
  created_at: string;
}

interface IntroItem {
  id: number;
  startup_name: string;
  company_id: number | null;
  company_name: string | null;
  intro_date: string | null;
  delivered_date: string | null;
  intro_type: string | null;
  receiver: string | null;
  monday_doc_url: string | null;
  met_with: string | null;
  status_1: string | null;
  status_log: { text: string; ts: string; outcome?: string }[] | null;
  outcome: string | null;
  source: string | null;
  collection_item_id: number | null;
}

interface ProblemCard {
  id: number;
  partner_id: number;
  title: string;
  description?: string | null;
  kpi?: string | null;
  confidence_score: number;
  status: 'identified' | 'defined' | 'active' | 'solved';
  source?: string | null;
  created_at?: string | null;
}

interface ServiceUsageRow {
  id: number;
  service_name: string;
  quantity_included: number | null;
  quantity_used: number;
  notes: string | null;
  year: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const KNOWN_PROTOCOLS = [
  'OPC-UA', 'MQTT', 'Siemens S7', 'Rockwell ControlLogix',
  'ROS2', 'VDA 5050', 'Public API', 'SDK',
  'Modbus', 'Modbus TCP', 'Profinet', 'EtherNet/IP', 'EtherCAT', 'CANopen',
];

const CLOUD_OPTIONS = ['Azure', 'AWS', 'GCP', 'On-Prem', 'Hybrid'];

const MATCH_STATUSES = ['suggested', 'shared', 'intro_made', 'engaged', 'passed'];

const LOG_TYPES = ['meeting', 'recommendation', 'outcome', 'action_item'];

const PRIORITY_SERVICES = [
  { name: 'Private Dealflow Sessions', label: 'Dealflow',      color: '#F0E545', serviceType: 'dealflow'       },
  { name: 'Ad-hoc Intro',              label: 'Ad Hoc Intro',  color: '#10b981', serviceType: 'intro'          },
  { name: 'Trend Report',              label: 'Trend Report',  color: '#6366F1', serviceType: 'trend_report'   },
  { name: 'Innovation Day',            label: 'Innovation Day',color: '#EC4899', serviceType: 'innovation_day' },
];

// ── Service order modal config ─────────────────────────────────────────────────

interface ServiceField {
  key: string;
  label: string;
  type: 'text' | 'date' | 'select' | 'textarea' | 'number';
  placeholder?: string;
  options?: string[];
  required?: boolean;
}

interface ServiceOrderConfig {
  serviceType: string;
  title: string;
  instructions: string;
  fields: ServiceField[];
}

const CVC_SECTORS = ['Robotics', 'Supply Chain', 'Manufacturing', 'Industrial Automation', 'Physical AI'] as const;

const SECTOR_FIELDS: ServiceField[] = [
  { key: 'sector',    label: 'Sector',            type: 'select', options: [...CVC_SECTORS] },
  { key: 'subsector', label: 'Subsector / Topic', type: 'text',   placeholder: 'e.g. AMR Navigation, Cold Chain Visibility' },
];

const SERVICE_ORDER_CONFIGS: Record<string, ServiceOrderConfig> = {
  dealflow: {
    serviceType: 'dealflow',
    title: 'Private Dealflow Session',
    instructions: 'Confirm the session topic, date, and which contacts will attend. We\'ll curate a startup list tailored to their focus areas.',
    fields: [
      ...SECTOR_FIELDS,
      { key: 'contact_name',  label: 'Partner Contact(s)',       type: 'text',     placeholder: 'Name(s) attending', required: true },
      { key: 'session_date',  label: 'Proposed Date',            type: 'date' },
      { key: 'format',        label: 'Format',                   type: 'select',   options: ['Virtual', 'In-person', 'Hybrid'] },
      { key: 'specific_ask',  label: 'Specific Ask',             type: 'textarea', placeholder: 'What are they looking for?' },
    ],
  },
  intro: {
    serviceType: 'intro',
    title: 'Ad Hoc Intro Request',
    instructions: 'Select the startup and confirm the partner contact. Your context note becomes the intro brief we send to both sides.',
    fields: [
      { key: 'startup_name',  label: 'Startup Name',             type: 'text',     placeholder: 'Company being introduced', required: true },
      ...SECTOR_FIELDS,
      { key: 'contact_name',  label: 'Partner Contact',          type: 'text',     placeholder: 'Who at the partner receives it', required: true },
      { key: 'context',       label: 'Why this match?',          type: 'textarea', placeholder: 'Relevance, fit, timing…', required: true },
      { key: 'urgency',       label: 'Urgency',                  type: 'select',   options: ['Normal', 'Urgent'] },
    ],
  },
  trend_report: {
    serviceType: 'trend_report',
    title: 'Trend Report Request',
    instructions: 'Describe the sector and key questions. We\'ll research and deliver a structured brief with sourced findings.',
    fields: [
      ...SECTOR_FIELDS,
      { key: 'questions',     label: 'Key Questions',            type: 'textarea', placeholder: 'What do they need answered?', required: true },
      { key: 'deadline',      label: 'Deadline',                 type: 'date' },
      { key: 'format',        label: 'Delivery Format',          type: 'select',   options: ['PDF Report', 'Slide Deck', 'Written Brief'] },
    ],
  },
  innovation_day: {
    serviceType: 'innovation_day',
    title: 'Innovation Day Request',
    instructions: 'We\'ll coordinate the agenda and curate startup presenters. Provide proposed timing and theme so we can start planning.',
    fields: [
      ...SECTOR_FIELDS,
      { key: 'proposed_date', label: 'Proposed Date',            type: 'date',     required: true },
      { key: 'format',        label: 'Format',                   type: 'select',   options: ['In-person', 'Virtual', 'Hybrid'] },
      { key: 'headcount',     label: 'Expected Attendees',       type: 'number',   placeholder: '~20' },
      { key: 'agenda_notes',  label: 'Agenda Notes',             type: 'textarea', placeholder: 'Any sessions, speakers, or requests?' },
    ],
  },
  other: {
    serviceType: 'other',
    title: 'Other Service Request',
    instructions: 'Describe what the partner is asking for and we\'ll route it to the right person.',
    fields: [
      { key: 'service_name',  label: 'Service',                  type: 'text',     placeholder: 'What service?', required: true },
      ...SECTOR_FIELDS,
      { key: 'description',   label: 'Description',              type: 'textarea', placeholder: 'What is the partner asking for?', required: true },
      { key: 'priority',      label: 'Priority',                 type: 'select',   options: ['High', 'Medium', 'Low'] },
    ],
  },
};

const STACK_LAYERS: StackLayer[] = [
  {
    id: 'enterprise',
    label: 'Enterprise',
    sublabel: 'ERP / CRM / Finance',
    color: '#818cf8',
    slots: ['SAP', 'Oracle', 'Microsoft Dynamics', 'Salesforce', 'ServiceNow'],
  },
  {
    id: 'mes',
    label: 'Manufacturing Ops',
    sublabel: 'MES / SCADA',
    color: '#a78bfa',
    slots: ['Siemens MES', 'Rockwell FactoryTalk', 'Ignition SCADA', 'Wonderware'],
  },
  {
    id: 'cloud',
    label: 'Cloud / IT',
    sublabel: 'Infrastructure / Data',
    color: '#38bdf8',
    slots: ['Azure', 'AWS', 'GCP', 'On-Prem', 'Snowflake'],
    dnaField: 'cloud_platform',
  },
  {
    id: 'connectivity',
    label: 'Connectivity',
    sublabel: 'Protocols / Middleware',
    color: '#34d399',
    slots: ['OPC-UA', 'MQTT', 'Modbus', 'PROFINET', 'EtherNet/IP'],
    dnaField: 'current_protocols',
  },
  {
    id: 'control',
    label: 'Control Systems',
    sublabel: 'PLC / DCS',
    color: '#F0E545',
    slots: ['Siemens S7', 'Rockwell ControlLogix', 'Beckhoff', 'ABB DCS'],
  },
  {
    id: 'robotics',
    label: 'Robotics & Automation',
    sublabel: 'Industrial Robots / AMRs',
    color: '#fb923c',
    slots: ['FANUC', 'ABB', 'KUKA', 'Universal Robots', 'Boston Dynamics'],
    dnaField: 'hardware_vendors',
  },
  {
    id: 'shopfloor',
    label: 'Shop Floor',
    sublabel: 'Sensors / Vision',
    color: '#f87171',
    slots: ['Cognex', 'Keyence', 'Sick', 'Honeywell Sensing', 'Zebra'],
  },
];

const TIER_STYLES: Record<string, string> = {
  'Tier 1':   'bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/30',
  'Tier 2':   'bg-[#F0E545]/20 text-[#F0E545] border border-[#F0E545]/30',
  'Watchlist':'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  'Low Fit':  'bg-slate-700 text-slate-400 border border-slate-600',
};

const SOV_STYLES: Record<string, string> = {
  green:   'text-[#10b981]',
  yellow:  'text-[#F0E545]',
  red:     'text-red-400',
  unknown: 'text-slate-500',
};

const SOV_BAR: Record<string, string> = {
  green:   'bg-[#10b981]',
  yellow:  'bg-[#F0E545]',
  red:     'bg-red-400',
  unknown: 'bg-slate-600',
};

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return n > 0 ? `$${n}` : '—';
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Tag Input ──────────────────────────────────────────────────────────────────

function TagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('');
  function add() {
    const v = input.trim();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput('');
  }
  return (
    <div className="flex flex-wrap gap-1 p-2 bg-[#151411] border border-slate-700 rounded min-h-[38px]">
      {tags.map(t => (
        <span key={t} className="flex items-center gap-1 px-2 py-0.5 bg-slate-700 text-slate-200 text-xs rounded">
          {t}
          <button onClick={() => onChange(tags.filter(x => x !== t))} className="text-slate-400 hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        placeholder={placeholder}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
        onBlur={add}
        className="flex-1 min-w-[80px] bg-transparent text-slate-200 text-xs focus:outline-none placeholder-slate-600"
      />
    </div>
  );
}

// ── Protocol Bridge ────────────────────────────────────────────────────────────

function ProtocolBridge({ partnerProtos, companyProtos, overlap }: { partnerProtos: string[]; companyProtos: string[]; overlap: string[] }) {
  const overlapSet = new Set(overlap.map(s => s.toLowerCase()));
  const hit = (proto: string) => [...overlapSet].some(o => o.includes(proto.toLowerCase()) || proto.toLowerCase().includes(o));

  if (!partnerProtos.length && !companyProtos.length) return null;

  return (
    <div className="mt-3 pt-3 border-t border-slate-700">
      <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Protocol Bridge</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] text-slate-600 mb-1">Partner Stack</p>
          <div className="flex flex-col gap-1">
            {partnerProtos.slice(0, 4).map(p => (
              <span key={p} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${hit(p) ? 'bg-[#10b981]/20 text-[#10b981]' : 'bg-slate-800 text-slate-500'}`}>
                {hit(p) ? '✓ ' : ''}{p}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] text-slate-600 mb-1">Startup Stack</p>
          <div className="flex flex-col gap-1">
            {companyProtos.slice(0, 4).map(p => (
              <span key={p} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${hit(p) ? 'bg-[#10b981]/20 text-[#10b981]' : 'bg-slate-800 text-slate-500'}`}>
                {hit(p) ? '✓ ' : ''}{p}
              </span>
            ))}
            {companyProtos.length > 4 && <span className="text-[10px] text-slate-600">+{companyProtos.length - 4} more</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Problem Board ──────────────────────────────────────────────────────────────

const COLUMNS: { id: ProblemCard['status']; label: string; color: string; desc: string }[] = [
  { id: 'identified', label: 'Identified',  color: '#64748b', desc: 'Mentioned but not yet validated' },
  { id: 'defined',    label: 'Defined',     color: '#38bdf8', desc: 'Validated, KPI may exist'        },
  { id: 'active',     label: 'Active',      color: '#F0E545', desc: 'Actively working a solution'      },
  { id: 'solved',     label: 'Solved',      color: '#10b981', desc: 'Problem addressed'                },
];

function confidenceLabel(score: number): { label: string; color: string } {
  if (score >= 70) return { label: 'Clear KPI',   color: '#10b981' };
  if (score >= 40) return { label: 'Developing',  color: '#F0E545' };
  return                  { label: 'Vague',        color: '#f87171' };
}

interface ProblemBoardProps {
  partnerId: number;
  problems: ProblemCard[];
  onUpdate: (updated: ProblemCard) => void;
  onCreate: (card: ProblemCard) => void;
  onDelete: (id: number) => void;
}

function ProblemBoard({ partnerId, problems, onUpdate, onCreate, onDelete }: ProblemBoardProps) {
  const [editingId, setEditingId]         = useState<number | null>(null);
  const [editForm, setEditForm]           = useState<Partial<ProblemCard>>({});
  const [addingCol, setAddingCol]         = useState<ProblemCard['status'] | null>(null);
  const [addForm, setAddForm]             = useState({ title: '', description: '', kpi: '', confidence_score: 50, source: '' });
  const [savingId, setSavingId]           = useState<number | null>(null);
  const [dragId, setDragId]               = useState<number | null>(null);
  const [dragOverCol, setDragOverCol]     = useState<ProblemCard['status'] | null>(null);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  function handleDragStart(e: React.DragEvent, id: number) {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleDragOver(e: React.DragEvent, col: ProblemCard['status']) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(col);
  }
  function handleDrop(e: React.DragEvent, col: ProblemCard['status']) {
    e.preventDefault();
    setDragOverCol(null);
    if (dragId == null) return;
    const card = problems.find(p => p.id === dragId);
    if (!card || card.status === col) { setDragId(null); return; }
    const optimistic = { ...card, status: col };
    onUpdate(optimistic);
    api.updateProblem(partnerId, dragId, { status: col }).catch(() => onUpdate(card));
    setDragId(null);
  }

  // ── Edit ───────────────────────────────────────────────────────────────────
  function startEdit(card: ProblemCard) {
    setEditingId(card.id);
    setEditForm({ title: card.title, description: card.description ?? '', kpi: card.kpi ?? '', confidence_score: card.confidence_score, source: card.source ?? '' });
  }
  async function saveEdit(card: ProblemCard) {
    if (!editForm.title?.trim()) return;
    setSavingId(card.id);
    const patch = {
      title:            editForm.title!.trim(),
      description:      editForm.description || undefined,
      kpi:              editForm.kpi || undefined,
      confidence_score: editForm.confidence_score ?? card.confidence_score,
      source:           editForm.source || undefined,
    };
    onUpdate({ ...card, ...patch });
    setEditingId(null);
    try { await api.updateProblem(partnerId, card.id, patch); }
    catch { onUpdate(card); }
    finally { setSavingId(null); }
  }

  // ── Add ────────────────────────────────────────────────────────────────────
  async function submitAdd(col: ProblemCard['status']) {
    if (!addForm.title.trim()) { setAddingCol(null); return; }
    const data = {
      title:            addForm.title.trim(),
      description:      addForm.description || undefined,
      kpi:              addForm.kpi || undefined,
      confidence_score: addForm.confidence_score,
      source:           addForm.source || undefined,
      status:           col,
    };
    try {
      const created = await api.createProblem(partnerId, data);
      onCreate(created);
    } catch { /* silent */ }
    setAddingCol(null);
    setAddForm({ title: '', description: '', kpi: '', confidence_score: 50, source: '' });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete(id: number) {
    onDelete(id);
    await api.deleteProblem(partnerId, id).catch(() => {});
  }

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4 pb-4 border-b border-slate-800">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Partner Terminal</div>
        <h2 className="text-lg font-bold tracking-tight text-white mb-1">Problem Board</h2>
        <p className="text-slate-500 text-xs">
          Drag cards between columns. High confidence = solid card (clear KPI). Low confidence = semi-transparent (vague ask).
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3 flex-1 min-h-0">
        {COLUMNS.map(col => {
          const cards = problems.filter(p => p.status === col.id);
          const isOver = dragOverCol === col.id;
          return (
            <div
              key={col.id}
              className={`flex flex-col rounded-xl border transition-colors ${isOver ? 'border-dashed' : 'border-slate-700/60'}`}
              style={{ background: isOver ? col.color + '08' : '#151411', borderColor: isOver ? col.color + '60' : undefined }}
              onDragOver={e => handleDragOver(e, col.id)}
              onDrop={e => handleDrop(e, col.id)}
              onDragLeave={() => setDragOverCol(null)}
            >
              {/* Column header */}
              <div className="px-3 pt-3 pb-2 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col.color }} />
                  <span className="text-xs font-semibold" style={{ color: col.color }}>{col.label}</span>
                  <span className="text-[10px] text-slate-600 bg-slate-800 px-1.5 rounded-full">{cards.length}</span>
                </div>
                <button
                  onClick={() => { setAddingCol(col.id); setAddForm({ title: '', description: '', kpi: '', confidence_score: 50, source: '' }); }}
                  className="text-slate-600 hover:text-slate-300 transition-colors"
                  title="Add problem"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                {cards.map(card => {
                  const { label: confLabel, color: confColor } = confidenceLabel(card.confidence_score);
                  const isVague   = card.confidence_score < 40;
                  const isDragging = dragId === card.id;
                  const isEditing  = editingId === card.id;

                  return (
                    <div
                      key={card.id}
                      draggable={!isEditing}
                      onDragStart={e => handleDragStart(e, card.id)}
                      onDragEnd={() => setDragId(null)}
                      className={`rounded-lg border p-3 cursor-grab active:cursor-grabbing transition-all select-none ${isDragging ? 'opacity-30 scale-95' : ''}`}
                      style={{
                        background:   isVague ? 'rgba(30,41,59,0.35)' : '#33322c',
                        borderColor:  isVague ? 'rgba(100,116,139,0.25)' : 'rgba(100,116,139,0.5)',
                        opacity:      isVague && !isDragging ? 0.55 : isDragging ? 0.3 : 1,
                      }}
                    >
                      {isEditing ? (
                        /* ── Edit mode ── */
                        <div className="space-y-2" onClick={e => e.stopPropagation()}>
                          <input
                            autoFocus
                            value={editForm.title ?? ''}
                            onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                            className="w-full bg-slate-900 border border-slate-600 text-white text-xs rounded px-2 py-1 focus:outline-none focus:border-[#F0E545]"
                            placeholder="Problem title…"
                          />
                          <textarea
                            value={editForm.description ?? ''}
                            onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                            rows={2}
                            className="w-full bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1 focus:outline-none focus:border-[#F0E545] resize-none"
                            placeholder="Description…"
                          />
                          <input
                            value={editForm.kpi ?? ''}
                            onChange={e => setEditForm(f => ({ ...f, kpi: e.target.value }))}
                            className="w-full bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1 focus:outline-none focus:border-[#F0E545]"
                            placeholder="KPI — e.g. reduce picking errors by 15%"
                          />
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 w-16">Confidence</span>
                            <input
                              type="range" min="0" max="100" step="5"
                              value={editForm.confidence_score ?? 50}
                              onChange={e => setEditForm(f => ({ ...f, confidence_score: parseInt(e.target.value) }))}
                              className="flex-1 accent-[#F0E545]"
                            />
                            <span className="text-[10px] font-bold w-6 text-right" style={{ color: confidenceLabel(editForm.confidence_score ?? 50).color }}>
                              {editForm.confidence_score ?? 50}
                            </span>
                          </div>
                          <input
                            value={editForm.source ?? ''}
                            onChange={e => setEditForm(f => ({ ...f, source: e.target.value }))}
                            className="w-full bg-slate-900 border border-slate-600 text-slate-400 text-xs rounded px-2 py-1 focus:outline-none focus:border-slate-500"
                            placeholder="Source — e.g. call 2026-04-15"
                          />
                          <div className="flex gap-2 pt-1">
                            <button onClick={() => saveEdit(card)} disabled={savingId === card.id}
                              className="flex-1 py-1 bg-[#F0E545] text-[#151411] text-xs font-bold rounded hover:bg-[#F0E545]/90 disabled:opacity-50">
                              {savingId === card.id ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={() => setEditingId(null)}
                              className="px-3 py-1 bg-slate-700 text-slate-300 text-xs rounded hover:bg-slate-600">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* ── View mode ── */
                        <div>
                          <div className="flex items-start justify-between gap-1 mb-1.5">
                            <p className={`text-xs font-medium leading-snug flex-1 ${isVague ? 'text-slate-400' : 'text-white'}`}>{card.title}</p>
                            <div className="flex gap-1 flex-shrink-0">
                              <button onClick={() => startEdit(card)} className="text-slate-600 hover:text-slate-300 transition-colors p-0.5">
                                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474L4.798 14.762a1.75 1.75 0 01-.91.48L1.5 15.75a.75.75 0 01-.863-.886l.508-2.388a1.75 1.75 0 01.48-.91L11.013 1.427z"/></svg>
                              </button>
                              <button onClick={() => handleDelete(card.id)} className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {card.description && (
                            <p className="text-[11px] text-slate-500 mb-2 leading-relaxed">{card.description}</p>
                          )}

                          {card.kpi && (
                            <div className="mb-2 px-2 py-1 bg-[#10b981]/10 border border-[#10b981]/25 rounded text-[10px] text-[#10b981]">
                              <span className="font-semibold">KPI:</span> {card.kpi}
                            </div>
                          )}

                          <div className="flex items-center justify-between mt-2">
                            {/* Confidence bar */}
                            <div className="flex items-center gap-1.5 flex-1">
                              <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden max-w-[60px]">
                                <div className="h-full rounded-full transition-all" style={{ width: `${card.confidence_score}%`, background: confColor }} />
                              </div>
                              <span className="text-[10px] font-semibold" style={{ color: confColor }}>{confLabel}</span>
                            </div>
                            {card.source && (
                              <span className="text-[9px] text-slate-600 truncate ml-2 max-w-[80px]">{card.source}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Inline add form */}
                {addingCol === col.id && (
                  <div className="rounded-lg border border-slate-600 p-3 bg-slate-800 space-y-2">
                    <input
                      autoFocus
                      value={addForm.title}
                      onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') submitAdd(col.id); if (e.key === 'Escape') setAddingCol(null); }}
                      className="w-full bg-slate-900 border border-slate-600 text-white text-xs rounded px-2 py-1.5 focus:outline-none focus:border-[#F0E545]"
                      placeholder="Problem title…"
                    />
                    <input
                      value={addForm.kpi}
                      onChange={e => setAddForm(f => ({ ...f, kpi: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-600 text-slate-400 text-xs rounded px-2 py-1 focus:outline-none focus:border-[#F0E545]"
                      placeholder="KPI (optional)"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">Confidence</span>
                      <input type="range" min="0" max="100" step="5"
                        value={addForm.confidence_score}
                        onChange={e => setAddForm(f => ({ ...f, confidence_score: parseInt(e.target.value) }))}
                        className="flex-1 accent-[#F0E545]"
                      />
                      <span className="text-[10px] font-bold w-6 text-right" style={{ color: confidenceLabel(addForm.confidence_score).color }}>
                        {addForm.confidence_score}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => submitAdd(col.id)}
                        className="flex-1 py-1 bg-[#F0E545] text-[#151411] text-xs font-bold rounded hover:bg-[#F0E545]/90">
                        Add
                      </button>
                      <button onClick={() => setAddingCol(null)}
                        className="px-3 py-1 bg-slate-700 text-slate-300 text-xs rounded hover:bg-slate-600">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {cards.length === 0 && addingCol !== col.id && (
                  <div className="text-center py-6 text-slate-700 text-[11px] border border-dashed border-slate-800 rounded-lg">
                    Drop here or<br />click + to add
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Stack View ─────────────────────────────────────────────────────────────────

const LAYER_INFO: Record<string, { description: string; prompt: string }> = {
  enterprise: {
    description: 'Top-level business systems that manage finance, customers, and company-wide operations.',
    prompt: '"Which ERP or CRM system is your company running today — SAP, Oracle, Salesforce, something else?"',
  },
  mes: {
    description: 'Systems that schedule, track, and direct production on the plant floor, sitting between ERP and controls.',
    prompt: '"Do you have a Manufacturing Execution System or SCADA platform managing your production lines? What vendor?"',
  },
  cloud: {
    description: 'Where data is stored, processed, and served — whether a public cloud, private data center, or hybrid.',
    prompt: '"Is your team primarily on Azure, AWS, GCP, or running on-prem? Any plans to migrate?"',
  },
  connectivity: {
    description: 'The communication protocols and middleware that connect machines, sensors, and software across the plant.',
    prompt: '"What protocols are your machines speaking today — OPC-UA, MQTT, Modbus? Any middleware layer in between?"',
  },
  control: {
    description: 'Programmable Logic Controllers and Distributed Control Systems that execute automation logic on the floor.',
    prompt: '"Which PLC or DCS brands are you running — Siemens, Rockwell, Beckhoff? How old is the install base?"',
  },
  robotics: {
    description: 'Industrial robots, cobots, and AMRs that handle physical work — welding, assembly, material movement.',
    prompt: '"What robot brands are deployed — FANUC, KUKA, Universal Robots? Are any of the lines cobot-enabled?"',
  },
  shopfloor: {
    description: 'Sensors, machine vision cameras, and data capture hardware at the edge of the production process.',
    prompt: '"What vision or sensing hardware is on the floor — Cognex cameras, Keyence sensors? Any existing data collection infrastructure?"',
  },
};

interface StackViewProps {
  partnerId: number;
  dna: { current_protocols: string[]; cloud_platform: string; hardware_vendors: string[]; factory_regions: string[]; scaling_speed: string };
  techStack: Record<string, string[]>;
  onDnaChange: (field: string, value: any) => void;
  onTechStackChange: (layerId: string, items: string[]) => void;
}

function StackView({ partnerId, dna, techStack, onDnaChange, onTechStackChange }: StackViewProps) {
  const [tooltip, setTooltip]         = useState<string | null>(null);
  const [addingLayer, setAddingLayer] = useState<string | null>(null);
  const [addInput, setAddInput]       = useState('');
  const [saving, setSaving]           = useState<string | null>(null);

  function fuzzyMatch(a: string, b: string) {
    return a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
  }

  function getKnownValues(layer: StackLayer): string[] {
    if (layer.dnaField === 'cloud_platform') return dna.cloud_platform ? [dna.cloud_platform] : [];
    if (layer.dnaField === 'current_protocols') return dna.current_protocols;
    if (layer.dnaField === 'hardware_vendors') return dna.hardware_vendors;
    return techStack[layer.id] ?? [];
  }

  function isSlotKnown(slot: string, knownValues: string[]) {
    return knownValues.some(v => fuzzyMatch(slot, v));
  }

  function getExtraSlots(layer: StackLayer, knownValues: string[]) {
    return knownValues.filter(v => !layer.slots.some(s => fuzzyMatch(s, v)));
  }

  async function patchTechStack(layerId: string, items: string[]) {
    // Optimistic update first so UI reflects immediately
    onTechStackChange(layerId, items);
    setSaving(layerId);
    const next = { ...techStack, [layerId]: items };
    try {
      await api.updatePartnerDNA(partnerId, { tech_stack: next });
    } catch {
      // Revert on failure
      onTechStackChange(layerId, techStack[layerId] ?? []);
    } finally { setSaving(null); }
  }

  function toggleSlot(layer: StackLayer, slot: string) {
    const knownValues = getKnownValues(layer);
    const known = isSlotKnown(slot, knownValues);

    if (layer.dnaField === 'cloud_platform') {
      onDnaChange('cloud_platform', known ? '' : slot);
      return;
    }
    if (layer.dnaField === 'current_protocols') {
      const next = known ? dna.current_protocols.filter(v => !fuzzyMatch(v, slot)) : [...dna.current_protocols, slot];
      onDnaChange('current_protocols', next);
      return;
    }
    if (layer.dnaField === 'hardware_vendors') {
      const next = known ? dna.hardware_vendors.filter(v => !fuzzyMatch(v, slot)) : [...dna.hardware_vendors, slot];
      onDnaChange('hardware_vendors', next);
      return;
    }
    // Non-DNA layer — direct save
    const current = techStack[layer.id] ?? [];
    const next = known ? current.filter(v => !fuzzyMatch(v, slot)) : [...current, slot];
    patchTechStack(layer.id, next);
  }

  function removeCustom(layer: StackLayer, value: string) {
    if (layer.dnaField === 'hardware_vendors') {
      onDnaChange('hardware_vendors', dna.hardware_vendors.filter(v => v !== value));
      return;
    }
    if (layer.dnaField === 'current_protocols') {
      onDnaChange('current_protocols', dna.current_protocols.filter(v => v !== value));
      return;
    }
    const current = techStack[layer.id] ?? [];
    patchTechStack(layer.id, current.filter(v => v !== value));
  }

  function commitAdd(layer: StackLayer) {
    const v = addInput.trim();
    if (!v) { setAddingLayer(null); setAddInput(''); return; }
    const knownValues = getKnownValues(layer);
    if (knownValues.some(x => fuzzyMatch(x, v))) { setAddingLayer(null); setAddInput(''); return; }

    if (layer.dnaField === 'cloud_platform') {
      onDnaChange('cloud_platform', v);
    } else if (layer.dnaField === 'current_protocols') {
      onDnaChange('current_protocols', [...dna.current_protocols, v]);
    } else if (layer.dnaField === 'hardware_vendors') {
      onDnaChange('hardware_vendors', [...dna.hardware_vendors, v]);
    } else {
      const current = techStack[layer.id] ?? [];
      patchTechStack(layer.id, [...current, v]);
    }
    setAddingLayer(null);
    setAddInput('');
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-5 pb-4 border-b border-slate-800">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Partner Terminal</div>
        <h2 className="text-lg font-bold tracking-tight text-white mb-1">Infrastructure Stack View</h2>
        <p className="text-slate-500 text-xs">
          Click any slot to toggle known/unknown. DNA layers (Cloud, Connectivity, Robotics) save via the DNA panel below. Others save instantly.
        </p>
      </div>

      <div className="relative">
        <div className="absolute left-[7px] top-5 bottom-5 w-px bg-slate-800 pointer-events-none" />

        <div className="space-y-2">
          {STACK_LAYERS.map(layer => {
            const knownValues   = getKnownValues(layer);
            const extraSlots    = getExtraSlots(layer, knownValues);
            const info          = LAYER_INFO[layer.id];
            const isDNALayer    = !!layer.dnaField;
            const isSaving      = saving === layer.id;

            return (
              <div key={layer.id} className="flex items-start gap-4">
                {/* Dot */}
                <div className="flex-shrink-0 mt-3.5 z-10">
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-[#151411]"
                    style={{ background: layer.color, boxShadow: `0 0 8px ${layer.color}60` }} />
                </div>

                {/* Card */}
                <div className="flex-1 bg-slate-800 border border-slate-700/60 rounded-lg p-3 mb-1">

                  {/* Layer header */}
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="text-xs font-semibold" style={{ color: layer.color }}>{layer.label}</span>
                    <span className="text-[10px] text-slate-500">{layer.sublabel}</span>
                    {isDNALayer && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded ml-1">DNA</span>
                    )}
                    {isSaving && <span className="text-[10px] text-slate-500 ml-auto animate-pulse">saving…</span>}

                    {/* Info tooltip trigger */}
                    <div className="relative ml-auto">
                      <button
                        onMouseEnter={() => setTooltip(layer.id)}
                        onMouseLeave={() => setTooltip(null)}
                        className="w-4 h-4 rounded-full border border-slate-600 text-slate-500 hover:text-slate-300 hover:border-slate-400 flex items-center justify-center text-[9px] font-bold transition-colors"
                      >i</button>
                      {tooltip === layer.id && (
                        <div className="absolute right-0 top-6 z-50 w-72 bg-[#151411] border border-slate-700 rounded-lg p-3 shadow-2xl">
                          <p className="text-xs text-slate-300 mb-2">{info.description}</p>
                          <div className="border-t border-slate-700 pt-2">
                            <p className="text-[10px] text-[#F0E545] font-semibold mb-1 uppercase tracking-wide">PSM Prompt</p>
                            <p className="text-[11px] text-slate-400 italic leading-relaxed">{info.prompt}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Slots */}
                  <div className="flex flex-wrap gap-1.5">
                    {layer.slots.map(slot => {
                      const known = isSlotKnown(slot, knownValues);
                      return known ? (
                        <button
                          key={slot}
                          onClick={() => toggleSlot(layer, slot)}
                          title="Click to mark unknown"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-all hover:opacity-70 active:scale-95"
                          style={{ background: layer.color + '18', color: layer.color, borderColor: layer.color + '50' }}
                        >
                          <span className="text-[9px]">✓</span> {slot}
                        </button>
                      ) : (
                        <button
                          key={slot}
                          onClick={() => toggleSlot(layer, slot)}
                          title="Click to mark as known"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-dashed border-amber-500/35 text-amber-500/55 bg-amber-500/[0.04] transition-all hover:border-amber-500/60 hover:text-amber-400/80 active:scale-95"
                        >
                          <span className="w-3.5 h-3.5 rounded-full border border-dashed border-amber-500/50 flex items-center justify-center text-[9px] text-amber-500/70 flex-shrink-0">?</span>
                          {slot}
                          <span className="text-[9px] px-1 py-0.5 bg-amber-500/20 text-amber-400/80 rounded font-semibold tracking-wide">ASK</span>
                        </button>
                      );
                    })}

                    {/* Custom (extra) slots */}
                    {extraSlots.map(extra => (
                      <button
                        key={extra}
                        onClick={() => removeCustom(layer, extra)}
                        title="Click to remove"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-all hover:opacity-70 group active:scale-95"
                        style={{ background: layer.color + '18', color: layer.color, borderColor: layer.color + '50' }}
                      >
                        <span className="text-[9px]">✓</span> {extra}
                        <X className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}

                    {/* Add custom */}
                    {addingLayer === layer.id ? (
                      <input
                        autoFocus
                        value={addInput}
                        onChange={e => setAddInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitAdd(layer);
                          if (e.key === 'Escape') { setAddingLayer(null); setAddInput(''); }
                        }}
                        onBlur={() => commitAdd(layer)}
                        placeholder="Vendor name…"
                        className="px-2 py-1 bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded focus:outline-none focus:border-[#F0E545] w-32"
                      />
                    ) : (
                      <button
                        onClick={() => setAddingLayer(layer.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-slate-600 border border-transparent hover:border-slate-700 hover:text-slate-400 transition-colors"
                      >
                        <Plus className="w-3 h-3" /> add
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-6 text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500/40 inline-block" />
          Known — click to remove
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-amber-500/10 border border-dashed border-amber-500/40 inline-block" />
          Unknown — click to confirm
        </div>
        <div className="ml-auto text-slate-600 text-[10px]">
          DNA layers (marked DNA) save via the DNA panel below
        </div>
      </div>
    </div>
  );
}

// ── Dealflows Tab ─────────────────────────────────────────────────────────────

const DF_STATUS_STYLES: Record<string, string> = {
  open:        'bg-slate-700 text-slate-300',
  in_review:   'bg-blue-900/50 text-blue-300',
  shortlisted: 'bg-amber-900/40 text-amber-300',
  meetings:    'bg-violet-900/40 text-violet-300',
  complete:    'bg-emerald-900/40 text-emerald-300',
};
const DF_STATUS_LABELS: Record<string, string> = {
  open: 'Open', in_review: 'In Review', shortlisted: 'Shortlisted', meetings: 'Meetings', complete: 'Complete',
};
const COL_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', sent: 'Sent to Partner', shortlisted: 'Shortlisted', complete: 'Complete',
};

function DealflowsTab({ partnerId, dealflows, intros, onReload, onReloadIntros, expandedDf, setExpandedDf, expandedCol, setExpandedCol, dfForm, setDfForm, colForm, setColForm, itemQuery, setItemQuery, itemSuggestions, setItemSuggestions, itemForm, setItemForm, savingDf, setSavingDf }: {
  partnerId: number;
  dealflows: any[];
  intros: any[];
  onReload: () => void;
  onReloadIntros: () => void;
  expandedDf: number | null;
  setExpandedDf: (v: number | null) => void;
  expandedCol: number | null;
  setExpandedCol: (v: number | null) => void;
  dfForm: any; setDfForm: (v: any) => void;
  colForm: any; setColForm: (v: any) => void;
  itemQuery: any; setItemQuery: (v: any) => void;
  itemSuggestions: any; setItemSuggestions: (v: any) => void;
  itemForm: any; setItemForm: (v: any) => void;
  savingDf: boolean; setSavingDf: (v: boolean) => void;
}) {
  const inputCls = "bg-slate-900 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-[#F0E545] w-full";
  const selectCls = "bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1 focus:outline-none focus:border-[#F0E545]";

  // Summary stats
  const totalReviewed   = dealflows.flatMap(d => d.collections).reduce((s: number, c: any) => s + (c.item_count ?? 0), 0);
  const totalShortlist  = dealflows.flatMap(d => d.collections).reduce((s: number, c: any) => s + (c.shortlist_count ?? 0), 0);
  const totalIntroduced = dealflows.flatMap(d => d.collections).reduce((s: number, c: any) => s + (c.introduced_count ?? 0), 0);

  async function createDealflow() {
    if (!dfForm.tech_focus.trim()) return;
    setSavingDf(true);
    try {
      await fetch(`/partners/${partnerId}/dealflows`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tech_focus: dfForm.tech_focus, notes: dfForm.notes, status: dfForm.status }),
      });
      setDfForm({ open: false, tech_focus: '', notes: '', status: 'open' });
      onReload();
    } finally { setSavingDf(false); }
  }

  async function updateDfStatus(dfId: number, status: string) {
    await fetch(`/partners/${partnerId}/dealflows/${dfId}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    onReload();
  }

  async function deleteDf(dfId: number) {
    if (!confirm('Delete this dealflow and all its collections?')) return;
    await fetch(`/partners/${partnerId}/dealflows/${dfId}`, { method: 'DELETE', headers: AUTH });
    setExpandedDf(null);
    onReload();
  }

  async function createCollection(dfId: number) {
    if (!colForm.title.trim()) return;
    setSavingDf(true);
    try {
      await fetch(`/partners/${partnerId}/dealflows/${dfId}/collections`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: colForm.title, notes: colForm.notes }),
      });
      setColForm({ dfId: null, title: '', notes: '' });
      onReload();
    } finally { setSavingDf(false); }
  }

  async function updateColStatus(colId: number, status: string) {
    await fetch(`/partners/${partnerId}/collections/${colId}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    onReload();
  }

  async function deleteCol(colId: number) {
    if (!confirm('Delete this collection and all its companies?')) return;
    await fetch(`/partners/${partnerId}/collections/${colId}`, { method: 'DELETE', headers: AUTH });
    setExpandedCol(null);
    onReload();
  }

  async function searchCompanies(colId: number, q: string) {
    setItemQuery((prev: any) => ({ ...prev, [colId]: q }));
    if (q.length < 2) { setItemSuggestions((prev: any) => ({ ...prev, [colId]: [] })); return; }
    const res = await fetch(`/companies/?q=${encodeURIComponent(q)}&per_page=8`, { headers: AUTH });
    const data = await res.json();
    setItemSuggestions((prev: any) => ({ ...prev, [colId]: data.companies ?? [] }));
  }

  async function addItem(colId: number) {
    const f = itemForm[colId];
    if (!f?.name?.trim()) return;
    setSavingDf(true);
    try {
      await fetch(`/partners/${partnerId}/collections/${colId}/items`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startup_name: f.name.trim(), company_id: f.company_id ?? null, notes: f.notes ?? '' }),
      });
      setItemForm((prev: any) => ({ ...prev, [colId]: { name: '', company_id: null, notes: '' } }));
      setItemQuery((prev: any) => ({ ...prev, [colId]: '' }));
      setItemSuggestions((prev: any) => ({ ...prev, [colId]: [] }));
      onReload();
    } finally { setSavingDf(false); }
  }

  async function toggleShortlist(colId: number, itemId: number, current: boolean) {
    await fetch(`/partners/${partnerId}/collections/${colId}/items/${itemId}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ on_shortlist: !current }),
    });
    onReload();
  }

  async function logIntro(colId: number, item: any) {
    // Create a partner_intro with outcome=introduced, linked back to this collection item
    const res = await fetch(`/partners/${partnerId}/intros`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startup_name: item.startup_name,
        company_id: item.company_id ?? null,
        intro_date: new Date().toISOString().slice(0, 10),
        outcome: 'introduced',
        source: 'dealflow',
        collection_item_id: item.id,
      }),
    });
    if (!res.ok) return;
    const intro = await res.json();
    // Link intro back to collection item
    await fetch(`/partners/${partnerId}/collections/${colId}/items/${item.id}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ intro_id: intro.id }),
    });
    onReload();
    onReloadIntros();
  }

  async function deleteItem(colId: number, itemId: number) {
    await fetch(`/partners/${partnerId}/collections/${colId}/items/${itemId}`, { method: 'DELETE', headers: AUTH });
    onReload();
  }

  return (
    <div>
      {/* Summary bar */}
      <div className="flex items-center gap-6 mb-4 px-4 py-3 bg-slate-800/60 border border-slate-700/50 rounded">
        <div className="text-center">
          <div className="text-lg font-bold text-white">{dealflows.length}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Dealflows</div>
        </div>
        <div className="w-px h-8 bg-slate-700" />
        <div className="text-center">
          <div className="text-lg font-bold text-slate-300">{totalReviewed}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Reviewed</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-amber-400">{totalShortlist}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Shortlisted</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-cyan-400">{totalIntroduced}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Introduced</div>
        </div>
        <div className="ml-auto">
          <button
            onClick={() => setDfForm((f: any) => ({ ...f, open: !f.open }))}
            className="flex items-center gap-1 text-xs px-3 py-1.5 bg-[#F0E545]/10 text-[#F0E545] rounded hover:bg-[#F0E545]/20 transition-colors font-semibold"
          >
            <Plus className="w-3 h-3" /> New Dealflow
          </button>
        </div>
      </div>

      {/* New dealflow form */}
      {dfForm.open && (
        <div className="mb-4 bg-slate-800 border border-slate-600 rounded p-3 space-y-2">
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">New Dealflow</p>
          <input
            autoFocus
            value={dfForm.tech_focus}
            onChange={e => setDfForm((f: any) => ({ ...f, tech_focus: e.target.value }))}
            placeholder="Tech focus / challenge area *"
            className={inputCls}
          />
          <input
            value={dfForm.notes}
            onChange={e => setDfForm((f: any) => ({ ...f, notes: e.target.value }))}
            placeholder="Notes (optional)"
            className={inputCls}
          />
          <div className="flex items-center gap-2 pt-1">
            <button onClick={createDealflow} disabled={!dfForm.tech_focus.trim() || savingDf}
              className="text-xs px-3 py-1.5 bg-[#F0E545] text-slate-900 font-semibold rounded disabled:opacity-50 hover:bg-yellow-300">
              {savingDf ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => setDfForm((f: any) => ({ ...f, open: false }))} className="text-xs text-slate-400 hover:text-slate-200">Cancel</button>
          </div>
        </div>
      )}

      {/* Dealflow list */}
      {dealflows.length === 0 && !dfForm.open && (
        <p className="text-slate-500 text-sm py-8 text-center">No dealflows yet — create one from a partner request.</p>
      )}

      <div className="space-y-3">
        {dealflows.map(df => {
          const isOpen = expandedDf === df.id;
          const totalItems = df.collections.reduce((s: number, c: any) => s + (c.item_count ?? 0), 0);
          const totalSl    = df.collections.reduce((s: number, c: any) => s + (c.shortlist_count ?? 0), 0);
          const totalIntr  = df.collections.reduce((s: number, c: any) => s + (c.introduced_count ?? 0), 0);
          return (
            <div key={df.id} className="border border-slate-700 rounded overflow-hidden">
              {/* Dealflow header */}
              <div
                className="flex items-center gap-3 px-4 py-3 bg-slate-800 cursor-pointer hover:bg-slate-750 select-none"
                onClick={() => setExpandedDf(isOpen ? null : df.id)}
              >
                <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform flex-shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono text-slate-500">{df.display_id}</span>
                    <span className="text-sm font-semibold text-white truncate">{df.tech_focus || '—'}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${DF_STATUS_STYLES[df.status] ?? 'bg-slate-700 text-slate-400'}`}>
                      {DF_STATUS_LABELS[df.status] ?? df.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-500">
                    <span>{df.collections.length} collection{df.collections.length !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>{totalItems} reviewed</span>
                    {totalSl > 0 && <><span>·</span><span className="text-amber-400">{totalSl} shortlisted</span></>}
                    {totalIntr > 0 && <><span>·</span><span className="text-cyan-400">{totalIntr} introduced</span></>}
                    {df.created_by && <><span>·</span><span>by {df.created_by}</span></>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  <select value={df.status} onChange={e => updateDfStatus(df.id, e.target.value)} className={`${selectCls} w-auto`}>
                    {Object.entries(DF_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <button onClick={() => deleteDf(df.id)} className="p-1 text-slate-600 hover:text-red-400 transition-colors" title="Delete dealflow">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Expanded: collections */}
              {isOpen && (
                <div className="bg-slate-900/50 divide-y divide-slate-800">
                  {df.collections.map((col: any) => {
                    const colOpen = expandedCol === col.id;
                    return (
                      <div key={col.id}>
                        {/* Collection header */}
                        <div
                          className="flex items-center gap-3 px-6 py-2.5 cursor-pointer hover:bg-slate-800/40 select-none"
                          onClick={() => setExpandedCol(colOpen ? null : col.id)}
                        >
                          <ChevronRight className={`w-3.5 h-3.5 text-slate-600 transition-transform flex-shrink-0 ${colOpen ? 'rotate-90' : ''}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-slate-600">{col.display_id}</span>
                              <span className="text-xs font-medium text-slate-300">{col.title || '(untitled)'}</span>
                              <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{COL_STATUS_LABELS[col.status] ?? col.status}</span>
                            </div>
                            <div className="text-[11px] text-slate-600 mt-0.5">
                              {col.item_count ?? 0} companies
                              {col.shortlist_count > 0 && ` · ${col.shortlist_count} shortlisted`}
                              {col.introduced_count > 0 && ` · ${col.introduced_count} introduced`}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                            <select value={col.status} onChange={e => updateColStatus(col.id, e.target.value)} className={`${selectCls} w-auto text-[10px]`}>
                              {Object.entries(COL_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                            <button onClick={() => deleteCol(col.id)} className="p-1 text-slate-700 hover:text-red-400 transition-colors">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Expanded: company items */}
                        {colOpen && (
                          <div className="px-8 pb-3">
                            {/* Items table */}
                            {(col.item_count ?? 0) > 0 && (
                              <CollectionItemsList
                                partnerId={partnerId}
                                colId={col.id}
                                onToggleShortlist={toggleShortlist}
                                onLogIntro={logIntro}
                                onDelete={deleteItem}
                                onReload={onReload}
                              />
                            )}

                            {/* Add company form */}
                            <div className="mt-2 pt-2 border-t border-slate-800">
                              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Add Company</p>
                              <div className="relative flex gap-2">
                                <div className="flex-1 relative">
                                  <input
                                    value={itemQuery[col.id] ?? ''}
                                    onChange={e => searchCompanies(col.id, e.target.value)}
                                    placeholder="Search DB or type name…"
                                    className={inputCls}
                                  />
                                  {(itemSuggestions[col.id] ?? []).length > 0 && (
                                    <div className="absolute left-0 right-0 top-full z-20 bg-slate-800 border border-slate-600 rounded shadow-lg max-h-36 overflow-y-auto">
                                      {itemSuggestions[col.id].map((s: any) => (
                                        <button key={s.id} onMouseDown={() => {
                                          setItemForm((prev: any) => ({ ...prev, [col.id]: { name: s.name, company_id: s.id, notes: '' } }));
                                          setItemQuery((prev: any) => ({ ...prev, [col.id]: s.name }));
                                          setItemSuggestions((prev: any) => ({ ...prev, [col.id]: [] }));
                                        }} className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-slate-700">
                                          {s.name} {s.sector && <span className="text-slate-500">· {s.sector}</span>}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <button
                                  onClick={() => {
                                    const q = itemQuery[col.id] ?? '';
                                    if (!q.trim()) return;
                                    const current = itemForm[col.id];
                                    setItemForm((prev: any) => ({ ...prev, [col.id]: { name: q, company_id: current?.company_id ?? null, notes: '' } }));
                                    addItem(col.id);
                                  }}
                                  disabled={!(itemQuery[col.id] ?? '').trim() || savingDf}
                                  className="text-xs px-3 py-1 bg-[#F0E545]/10 text-[#F0E545] rounded hover:bg-[#F0E545]/20 disabled:opacity-40 whitespace-nowrap font-medium"
                                >Add</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add collection button */}
                  <div className="px-6 py-2.5">
                    {colForm.dfId === df.id ? (
                      <div className="flex gap-2 items-center">
                        <input
                          autoFocus
                          value={colForm.title}
                          onChange={e => setColForm((f: any) => ({ ...f, title: e.target.value }))}
                          placeholder="Collection title…"
                          className={`${inputCls} flex-1`}
                          onKeyDown={e => { if (e.key === 'Enter') createCollection(df.id); if (e.key === 'Escape') setColForm((f: any) => ({ ...f, dfId: null })); }}
                        />
                        <button onClick={() => createCollection(df.id)} disabled={!colForm.title.trim() || savingDf}
                          className="text-xs px-2.5 py-1 bg-[#F0E545] text-slate-900 font-semibold rounded disabled:opacity-50">Save</button>
                        <button onClick={() => setColForm((f: any) => ({ ...f, dfId: null }))} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setColForm({ dfId: df.id, title: '', notes: '' })}
                        className="text-[11px] text-slate-500 hover:text-[#F0E545] flex items-center gap-1 transition-colors">
                        <Plus className="w-3 h-3" /> Add collection
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CollectionItemsList({ partnerId, colId, onToggleShortlist, onLogIntro, onDelete, onReload }: {
  partnerId: number;
  colId: number;
  onToggleShortlist: (colId: number, itemId: number, current: boolean) => void;
  onLogIntro: (colId: number, item: any) => void;
  onDelete: (colId: number, itemId: number) => void;
  onReload: () => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/partners/${partnerId}/collections/${colId}/items`, { headers: AUTH })
      .then(r => r.json())
      .then(d => setItems(d.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [partnerId, colId]);

  if (loading) return <p className="text-[11px] text-slate-600 py-2">Loading…</p>;
  if (items.length === 0) return null;

  return (
    <div className="mt-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="text-left py-1.5 text-[10px] text-slate-600 uppercase tracking-wide font-medium">Company</th>
            <th className="text-center py-1.5 text-[10px] text-slate-600 uppercase tracking-wide font-medium w-24">Shortlist</th>
            <th className="text-left py-1.5 text-[10px] text-slate-600 uppercase tracking-wide font-medium w-28">Outcome</th>
            <th className="w-16" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {items.map(item => (
            <tr key={item.id} className="hover:bg-slate-800/30">
              <td className="py-2 pr-3">
                {item.company_id ? (
                  <Link to={`/company/${item.company_id}`} className="text-[#F0E545] hover:underline font-medium">{item.startup_name}</Link>
                ) : (
                  <span className="text-slate-300">{item.startup_name}</span>
                )}
                {item.company_sector && <span className="text-slate-600 ml-1.5">{item.company_sector}</span>}
              </td>
              <td className="py-2 text-center">
                <button
                  onClick={() => { onToggleShortlist(colId, item.id, item.on_shortlist); setItems(prev => prev.map(i => i.id === item.id ? { ...i, on_shortlist: !i.on_shortlist } : i)); }}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${item.on_shortlist ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'border-slate-700 text-slate-600 hover:border-slate-500 hover:text-slate-400'}`}
                >
                  {item.on_shortlist ? '★ Shortlisted' : 'Shortlist'}
                </button>
              </td>
              <td className="py-2">
                {item.intro_id ? (
                  <span className="text-[10px] text-cyan-400 flex items-center gap-1">
                    <Check className="w-3 h-3" /> {item.intro_outcome ?? 'Introduced'}
                  </span>
                ) : item.on_shortlist ? (
                  <button
                    onClick={() => { onLogIntro(colId, item); setItems(prev => prev.map(i => i.id === item.id ? { ...i, intro_id: -1 } : i)); }}
                    className="text-[10px] px-2 py-0.5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/20 transition-colors"
                  >Log Intro</button>
                ) : (
                  <span className="text-slate-700">—</span>
                )}
              </td>
              <td className="py-2 text-right">
                <button onClick={() => { onDelete(colId, item.id); setItems(prev => prev.filter(i => i.id !== item.id)); }}
                  className="text-slate-700 hover:text-red-400 transition-colors p-0.5">
                  <Trash2 className="w-3 h-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Intros Tab ────────────────────────────────────────────────────────────────


const OUTCOMES = ['Introduced', 'NDA', 'PoC/PoT', 'Pilot', 'Commercial Agreement', 'Hold', 'Close'] as const;
type Outcome = typeof OUTCOMES[number];

const OUTCOME_STYLES: Record<string, string> = {
  'Introduced':           'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'NDA':                  'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'PoC':                  'bg-violet-500/20 text-violet-300 border-violet-500/30',
  'PoC/PoT':              'bg-violet-500/20 text-violet-300 border-violet-500/30',
  'Pilot':                'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'Commercial Agreement': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'Hold':                 'bg-slate-600/40 text-slate-400 border-slate-600/40',
  'Close':                'bg-red-500/20 text-red-400 border-red-500/30',
};

function OutcomeBadge({ value }: { value: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${OUTCOME_STYLES[value] ?? 'bg-slate-700 text-slate-400 border-slate-600'}`}>
      {value}
    </span>
  );
}

function OutcomeCell({ intro, pendingOutcome, onPendingOutcomeChange, onSubmit }: {
  intro: IntroItem;
  pendingOutcome: string;
  onPendingOutcomeChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const selectCls = "bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-1.5 py-1 outline-none focus:border-[#F0E545]/60 flex-1 min-w-0";
  return (
    <td className="px-3 py-2 w-40">
      <div className="flex items-center gap-1">
        <select
          value={pendingOutcome}
          onChange={e => onPendingOutcomeChange(e.target.value)}
          className={selectCls}
        >
          <option value="">— outcome —</option>
          {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <button
          onClick={onSubmit}
          title="Submit status"
          className="shrink-0 w-6 h-6 flex items-center justify-center bg-[#F0E545] text-slate-900 text-xs font-bold rounded hover:bg-yellow-300 transition-colors"
        >✓</button>
      </div>
    </td>
  );
}

function StatusLogCell({ intro, partnerId, onUpdate, draft, onDraftChange, onSubmit, collapsed, onToggleCollapsed }: {
  intro: IntroItem;
  partnerId: number;
  onUpdate: (updated: IntroItem) => void;
  draft: string;
  onDraftChange: (v: string) => void;
  onSubmit: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [saving, setSaving]         = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText]     = useState('');
  const [editOutcome, setEditOutcome] = useState('');
  const log = intro.status_log ?? [];

  async function patch(body: object) {
    setSaving(true);
    try {
      const res = await fetch(`/partners/${partnerId}/intros/${intro.id}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      onUpdate(await res.json());
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  async function saveEdit(i: number) {
    const text = editText.trim();
    if (!text) return;
    const updated_log = log.map((e, j) => j === i ? { ...e, text, ...(editOutcome ? { outcome: editOutcome } : {}) } : e);
    const latestOutcome = updated_log.find(e => e.outcome)?.outcome;
    await patch({ status_log: updated_log, ...(latestOutcome ? { outcome: latestOutcome } : {}) });
    setEditingIdx(null);
  }

  function fmt(ts: string) {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  const selectCls = "bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-1.5 py-1 outline-none focus:border-[#F0E545]/60";
  const visibleLog = collapsed ? log.slice(0, 1) : log;

  return (
    <td className="px-2 py-1.5 min-w-[220px]">
      <div className="flex items-center gap-1 mb-1">
        <input
          className="bg-slate-800 border border-slate-700 focus:border-[#F0E545]/60 text-slate-200 text-xs rounded px-2 py-1 outline-none flex-1 placeholder-slate-600"
          value={draft ?? ''}
          placeholder="Add status…"
          onChange={e => onDraftChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
        />
        <button
          onClick={onSubmit}
          disabled={saving || !(draft ?? '').trim()}
          title="Add new status"
          className="shrink-0 w-6 h-6 flex items-center justify-center bg-slate-700 hover:bg-[#F0E545] hover:text-slate-900 text-slate-300 text-sm font-bold rounded transition-colors disabled:opacity-30"
        >+</button>
      </div>
      {visibleLog.map((entry, i) => (
        <div key={i} className="mb-1">
          {editingIdx === i ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <select value={editOutcome} onChange={e => setEditOutcome(e.target.value)} className={`${selectCls} w-24 shrink-0`}>
                  <option value="">Outcome</option>
                  {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <input
                  autoFocus
                  className="bg-slate-900 border border-[#F0E545]/50 text-slate-200 text-xs rounded px-2 py-0.5 outline-none flex-1"
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(i); if (e.key === 'Escape') setEditingIdx(null); }}
                />
                <button onClick={() => saveEdit(i)} className="text-[#F0E545] text-xs font-bold hover:text-yellow-300">✓</button>
                <button onClick={() => setEditingIdx(null)} className="text-slate-500 text-xs hover:text-slate-300">✕</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-1">
              <div className="flex-1 min-w-0">
                {entry.outcome && <OutcomeBadge value={entry.outcome} />}
                <span
                  className="text-[10px] text-slate-300 leading-snug cursor-pointer hover:text-white ml-1"
                  onClick={() => { setEditingIdx(i); setEditText(entry.text); setEditOutcome(entry.outcome ?? ''); }}
                  title="Click to edit"
                >
                  {entry.text}
                  <span className="text-slate-600 ml-1">— {fmt(entry.ts)}</span>
                </span>
              </div>
              <button
                onClick={() => {
                  const newLog = log.filter((_, j) => j !== i);
                  const latestOutcome = newLog.find(e => e.outcome)?.outcome ?? null;
                  patch({ status_log: newLog, outcome: latestOutcome });
                }}
                className="text-slate-600 hover:text-red-400 text-[10px] leading-none shrink-0"
                title="Remove"
              >×</button>
            </div>
          )}
        </div>
      ))}
      {log.length > 1 && (
        <button onClick={onToggleCollapsed} className="text-[10px] text-slate-500 hover:text-[#F0E545] mt-0.5 transition-colors">
          {collapsed ? `▸ ${log.length - 1} more` : '▾ collapse'}
        </button>
      )}
    </td>
  );
}

// key: `${introId}-${field}` → current typed value
type CellKey = string;

function IntrosTab({ intros, partnerId, onUpdate, onDelete, onAdd }: {
  intros: IntroItem[];
  partnerId: number;
  onUpdate: (updated: IntroItem) => void;
  onDelete: (id: number) => void;
  onAdd: (created: IntroItem) => void;
}) {
  const [editingId, setEditingId]   = useState<number | null>(null);

  // Year filter
  const availableYears = Array.from(new Set(
    intros.filter(i => i.intro_date).map(i => new Date(i.intro_date!).getFullYear())
  )).sort((a, b) => b - a);
  const [yearFilter, setYearFilter] = useState<number | null>(null);

  // Source filter
  const [sourceFilter, setSourceFilter] = useState<'all' | 'adhoc' | 'dealflow'>('all');

  // Inline add form
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [addForm, setAddForm] = useState({ startup_name: '', intro_date: new Date().toISOString().slice(0, 10), outcome: 'shared', source: 'manual' });
  const [addSaving, setAddSaving] = useState(false);
  const [addCompanyQuery, setAddCompanyQuery] = useState('');
  const [addCompanySuggestions, setAddCompanySuggestions] = useState<{id: number; name: string}[]>([]);
  const [addCompanyId, setAddCompanyId] = useState<number | null>(null);
  const addSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onAddCompanySearch(q: string) {
    setAddCompanyQuery(q);
    setAddCompanyId(null);
    if (addSearchTimer.current) clearTimeout(addSearchTimer.current);
    if (q.length < 2) { setAddCompanySuggestions([]); return; }
    addSearchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/companies?q=${encodeURIComponent(q)}&limit=6`, { headers: AUTH });
        const data = await res.json();
        setAddCompanySuggestions(Array.isArray(data) ? data.map((c: any) => ({ id: c.id, name: c.name })) : []);
      } catch { setAddCompanySuggestions([]); }
    }, 250);
  }

  async function submitAdd() {
    if (!addForm.startup_name.trim()) return;
    setAddSaving(true);
    try {
      const res = await fetch(`/partners/${partnerId}/intros`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...addForm, company_id: addCompanyId }),
      });
      if (!res.ok) throw new Error();
      onAdd(await res.json());
      setAddFormOpen(false);
      setAddForm({ startup_name: '', intro_date: new Date().toISOString().slice(0, 10), outcome: 'shared', source: 'manual' });
      setAddCompanyQuery('');
      setAddCompanyId(null);
    } catch { /* silent */ }
    finally { setAddSaving(false); }
  }
  const [form, setForm]             = useState<Partial<IntroItem>>({});
  const [saving, setSaving]         = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [companyQuery, setCompanyQuery] = useState('');
  const [companySuggestions, setCompanySuggestions] = useState<{id: number; name: string}[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending outcome per row — selected in Outcome column, submitted with next status entry
  const [rowOutcomes, setRowOutcomes] = useState<Record<number, string>>({});
  function setRowOutcome(introId: number, v: string) { setRowOutcomes(prev => ({ ...prev, [introId]: v })); }
  function clearRowOutcome(introId: number) { setRowOutcomes(prev => ({ ...prev, [introId]: '' })); }

  // Draft status text per row
  const [rowDrafts, setRowDrafts] = useState<Record<number, string>>({});

  // Collapsed history per row (start collapsed when there's more than 1 entry)
  const [collapsedRows, setCollapsedRows] = useState<Set<number>>(new Set());
  function toggleCollapsed(introId: number) {
    setCollapsedRows(prev => { const n = new Set(prev); n.has(introId) ? n.delete(introId) : n.add(introId); return n; });
  }

  async function appendStatus(intro: IntroItem) {
    const text = ((rowDrafts[intro.id] as string | undefined) ?? '').trim();
    if (!text) return;
    const pendingOutcome = rowOutcomes[intro.id] ?? '';
    const log = intro.status_log ?? [];
    const currentUser = api.getCurrentUser();
    const entry: { text: string; ts: string; outcome?: string; logged_by?: string } = {
      text,
      ts: new Date().toISOString(),
      ...(currentUser?.username ? { logged_by: currentUser.username } : {}),
    };
    if (pendingOutcome) entry.outcome = pendingOutcome;
    const body: Record<string, unknown> = { status_log: [entry, ...log] };
    if (pendingOutcome) body.outcome = pendingOutcome;
    try {
      const res = await fetch(`/partners/${partnerId}/intros/${intro.id}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      onUpdate(await res.json());
      setRowDrafts(prev => ({ ...prev, [intro.id]: '' }));
      clearRowOutcome(intro.id);
    } catch { /* silent */ }
  }

  // Inline cell editing for met_with / status_1 / status_2
  const [cellValues, setCellValues] = useState<Record<CellKey, string>>({});
  const [savingCell, setSavingCell] = useState<CellKey | null>(null);

  function cellKey(introId: number, field: string): CellKey { return `${introId}-${field}`; }

  function getCellValue(intro: IntroItem, field: 'met_with' | 'status_1' | 'status_2'): string {
    const k = cellKey(intro.id, field);
    return k in cellValues ? cellValues[k] : (intro[field] ?? '');
  }

  function isCellDirty(intro: IntroItem, field: 'met_with' | 'status_1' | 'status_2'): boolean {
    const k = cellKey(intro.id, field);
    return k in cellValues && cellValues[k] !== (intro[field] ?? '');
  }

  async function saveCell(intro: IntroItem, field: 'met_with' | 'status_1' | 'status_2') {
    const k = cellKey(intro.id, field);
    const value = cellValues[k] ?? intro[field] ?? '';
    setSavingCell(k);
    try {
      const res = await fetch(`/partners/${partnerId}/intros/${intro.id}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      onUpdate(updated);
      setCellValues(prev => { const next = { ...prev }; delete next[k]; return next; });
    } catch { /* silent */ }
    finally { setSavingCell(null); }
  }

  function startEdit(intro: IntroItem) {
    setEditingId(intro.id);
    setForm({
      startup_name:   intro.startup_name,
      company_id:     intro.company_id,
      intro_date:     intro.intro_date ? intro.intro_date.slice(0, 10) : '',
      met_with:       intro.met_with ?? '',
      delivered_date: intro.delivered_date ? intro.delivered_date.slice(0, 10) : '',
      status_1:       intro.status_1 ?? '',
      outcome:        intro.outcome ?? '',
    });
    setCompanyQuery(intro.company_name ?? intro.startup_name ?? '');
    setCompanySuggestions([]);
  }

  function cancelEdit() { setEditingId(null); setForm({}); setCompanyQuery(''); setCompanySuggestions([]); setConfirmDelete(null); }

  async function deleteIntro(introId: number) {
    try {
      await fetch(`/partners/${partnerId}/intros/${introId}`, {
        method: 'DELETE',
        headers: AUTH,
      });
      onDelete(introId);
      cancelEdit();
    } catch { /* silent */ }
  }

  async function save(introId: number) {
    setSaving(true);
    try {
      const res = await fetch(`/partners/${partnerId}/intros/${introId}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      onUpdate(updated);
      cancelEdit();
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  function onCompanySearch(q: string) {
    setCompanyQuery(q);
    setForm(f => ({ ...f, company_id: null }));
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) { setCompanySuggestions([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/companies?q=${encodeURIComponent(q)}&limit=6`, { headers: AUTH });
        const data = await res.json();
        setCompanySuggestions(Array.isArray(data) ? data.map((c: any) => ({ id: c.id, name: c.name })) : []);
      } catch { setCompanySuggestions([]); }
    }, 250);
  }

  function pickCompany(id: number, name: string) {
    setForm(f => ({ ...f, company_id: id }));
    setCompanyQuery(name);
    setCompanySuggestions([]);
  }

  const inputCls = "bg-slate-900 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-[#F0E545] w-full";

  const filteredIntros = intros
    .filter(i => !yearFilter || (i.intro_date && new Date(i.intro_date).getFullYear() === yearFilter))
    .filter(i => {
      if (sourceFilter === 'dealflow') return i.source === 'dealflow' || !!i.collection_item_id;
      if (sourceFilter === 'adhoc') return i.source !== 'dealflow' && !i.collection_item_id;
      return true;
    });

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {availableYears.length > 0 && (
            <select
              value={yearFilter ?? ''}
              onChange={e => setYearFilter(e.target.value ? parseInt(e.target.value) : null)}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1 focus:outline-none focus:border-[#F0E545]"
            >
              <option value="">All years</option>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          {/* Source filter */}
          <div className="flex rounded overflow-hidden border border-slate-700 text-[10px] font-medium">
            {(['all', 'adhoc', 'dealflow'] as const).map(s => (
              <button key={s} onClick={() => setSourceFilter(s)}
                className={`px-2.5 py-1 transition-colors ${sourceFilter === s ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-500 hover:text-slate-300'}`}>
                {s === 'all' ? 'All' : s === 'adhoc' ? 'Ad-hoc' : 'Dealflow'}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-500">{filteredIntros.length} intro{filteredIntros.length !== 1 ? 's' : ''}</span>
        </div>
        <button
          onClick={() => setAddFormOpen(v => !v)}
          className="flex items-center gap-1 text-xs px-2.5 py-1 bg-[#F0E545]/10 text-[#F0E545] rounded hover:bg-[#F0E545]/20 transition-colors"
        >
          <Plus className="w-3 h-3" /> Add startup
        </button>
      </div>

      {/* Stage legend */}
      <div className="mb-3 px-3 py-2.5 bg-slate-800/60 border border-slate-700/50 rounded text-[11px] text-slate-400 leading-relaxed">
        Every startup logged here has been <span className="text-slate-300 font-medium">Shared</span> — the partner has seen their profile.
        <span className="text-slate-300 font-medium"> Introduced</span> means a meeting actually happened.
        From there, outcomes track progression: <span className="text-slate-400">Evaluation → PoC/PoT → Pilot → Commercial Agreement</span>.
      </div>

      {/* Inline add form */}
      {addFormOpen && (
        <div className="mb-4 bg-slate-800 border border-slate-600 rounded p-3 space-y-2">
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-2">Log New Introduction</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="relative col-span-2">
              <input
                placeholder="Startup name *"
                value={addCompanyQuery || addForm.startup_name}
                onChange={e => {
                  const v = e.target.value;
                  setAddForm(f => ({ ...f, startup_name: v }));
                  onAddCompanySearch(v);
                }}
                className={inputCls}
                autoFocus
              />
              {addCompanySuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 bg-slate-800 border border-slate-600 rounded shadow-lg max-h-40 overflow-y-auto">
                  {addCompanySuggestions.map(c => (
                    <button key={c.id} onMouseDown={() => {
                      setAddForm(f => ({ ...f, startup_name: c.name }));
                      setAddCompanyQuery(c.name);
                      setAddCompanyId(c.id);
                      setAddCompanySuggestions([]);
                    }} className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700">
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              type="date"
              value={addForm.intro_date}
              onChange={e => setAddForm(f => ({ ...f, intro_date: e.target.value }))}
              className={inputCls}
            />
            <select
              value={addForm.source}
              onChange={e => setAddForm(f => ({ ...f, source: e.target.value }))}
              className={inputCls}
            >
              <option value="manual">Ad-hoc intro</option>
              <option value="dealflow">From a Dealflow</option>
            </select>
            <select
              value={addForm.outcome}
              onChange={e => setAddForm(f => ({ ...f, outcome: e.target.value }))}
              className={inputCls}
            >
              <option value="shared">Shared</option>
              <option value="introduced">Introduced — met with partner</option>
              <option value="evaluation">Startup Evaluation</option>
              <option value="monitoring">Monitoring</option>
              <option value="planning">PoC/PoT Planning</option>
              <option value="in_progress">PoC/PoT In Progress</option>
              <option value="on_hold">PoC/PoT On Hold</option>
              <option value="completed">PoC/PoT Completed</option>
              <option value="cancelled">PoC/PoT Terminated</option>
              <option value="commercial">Commercial Agreement</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={submitAdd} disabled={!addForm.startup_name.trim() || addSaving}
              className="flex items-center gap-1 text-xs px-3 py-1.5 bg-[#F0E545] text-slate-900 font-semibold rounded disabled:opacity-50 hover:bg-[#e8dc30] transition-colors">
              {addSaving ? 'Saving…' : 'Log intro'}
            </button>
            <button onClick={() => { setAddFormOpen(false); setAddCompanyQuery(''); setAddCompanyId(null); setAddCompanySuggestions([]); }}
              className="text-xs text-slate-400 hover:text-slate-200">Cancel</button>
          </div>
        </div>
      )}

      {filteredIntros.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          {yearFilter ? `No introductions in ${yearFilter}.` : 'No introductions logged for this partner yet.'}
        </p>
      ) : (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700/50">
            <th className="text-left px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wide font-medium w-44">Startup</th>
            <th className="text-left px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wide font-medium w-28">Intro Date</th>
            <th className="text-left px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wide font-medium w-36">Met With</th>
            <th className="text-left px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wide font-medium w-28">Delivered</th>
            <th className="text-left px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wide font-medium">Status</th>
            <th className="text-left px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wide font-medium w-36">Outcome</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/30">
          {filteredIntros.map(intro => {
            const isEditing = editingId === intro.id;
            // Stagnation: NDA or PoC/PoT with no status_log update in >21 days
            const stagnantStages = ['NDA', 'PoC', 'PoC/PoT'];
            const isStagnating = (() => {
              if (!stagnantStages.includes(intro.outcome ?? '')) return false;
              const log = intro.status_log ?? [];
              const lastTs = log.length > 0 ? log[0].ts : null;
              const refDate = lastTs ? new Date(lastTs) : (intro.intro_date ? new Date(intro.intro_date) : null);
              if (!refDate) return false;
              return (Date.now() - refDate.getTime()) / 86400000 > 21;
            })();
            const isDealflow = intro.source === 'dealflow' || !!intro.collection_item_id;
            return (
              <tr key={intro.id} className={
                isEditing ? 'bg-slate-800/60' :
                isStagnating ? 'hover:bg-slate-700/20 border-l-2 border-amber-500/60' :
                isDealflow ? 'hover:bg-slate-700/20 border-l-2 border-[#F0E545]/40' :
                'hover:bg-slate-700/20'
              }>
                {isEditing ? (
                  <>
                    <td className="px-3 py-2 relative">
                      <input
                        className={inputCls}
                        value={companyQuery}
                        onChange={e => onCompanySearch(e.target.value)}
                        placeholder="Search DB or type name…"
                      />
                      {companySuggestions.length > 0 && (
                        <div className="absolute top-full left-3 mt-0.5 w-64 bg-[#1e293b] border border-slate-600 rounded shadow-xl z-50">
                          {companySuggestions.map(s => (
                            <button key={s.id} onMouseDown={() => pickCompany(s.id, s.name)}
                              className="w-full text-left px-3 py-2 text-xs text-white hover:bg-slate-700">
                              {s.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {form.company_id && <span className="text-[10px] text-[#F0E545] mt-0.5 block">Linked to DB</span>}
                    </td>
                    <td className="px-3 py-2"><input type="date" className={inputCls} value={form.intro_date ?? ''} onChange={e => setForm(f => ({...f, intro_date: e.target.value}))} /></td>
                    <td className="px-3 py-2"><input className={inputCls} value={form.met_with ?? ''} onChange={e => setForm(f => ({...f, met_with: e.target.value}))} placeholder="Contact or BU" /></td>
                    <td className="px-3 py-2"><input type="date" className={inputCls} value={form.delivered_date ?? ''} onChange={e => setForm(f => ({...f, delivered_date: e.target.value}))} /></td>
                    <StatusLogCell intro={intro} partnerId={partnerId} onUpdate={onUpdate} />
                    <td className="px-3 py-2">
                      <select value={form.outcome ?? ''} onChange={e => setForm(f => ({...f, outcome: e.target.value}))}
                        className="bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded px-1.5 py-1 outline-none focus:border-[#F0E545]/60 w-full">
                        <option value="">—</option>
                        {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-1">
                          <button onClick={() => save(intro.id)} disabled={saving}
                            className="px-2 py-1 bg-[#F0E545] text-slate-900 text-xs font-bold rounded hover:bg-yellow-300 disabled:opacity-50">
                            {saving ? '…' : 'Save'}
                          </button>
                          <button onClick={cancelEdit} className="px-2 py-1 bg-slate-700 text-slate-300 text-xs rounded hover:bg-slate-600">✕</button>
                        </div>
                        {confirmDelete === intro.id ? (
                          <div className="flex gap-1 items-center">
                            <span className="text-[10px] text-red-400">Sure?</span>
                            <button onClick={() => deleteIntro(intro.id)} className="px-2 py-0.5 bg-red-600 text-white text-xs rounded hover:bg-red-500">Yes</button>
                            <button onClick={() => setConfirmDelete(null)} className="px-2 py-0.5 bg-slate-700 text-slate-300 text-xs rounded hover:bg-slate-600">No</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(intro.id)} className="px-2 py-0.5 text-red-500 hover:text-red-400 text-xs text-left">Delete</button>
                        )}
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5 text-xs font-medium">
                      {intro.company_id ? (
                        <Link to={`/company/${intro.company_id}`} className="text-[#F0E545] hover:underline">
                          {intro.company_name ?? intro.startup_name}
                        </Link>
                      ) : (
                        <span className="text-slate-300">{intro.startup_name}</span>
                      )}
                      {isStagnating && (
                        <span className="block text-[9px] text-amber-400 mt-0.5" title="No update in 21+ days">
                          ⚠ stale
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{intro.intro_date ? intro.intro_date.slice(0, 10) : '—'}</td>
                    {/* met_with inline */}
                    {(['met_with'] as const).map(field => {
                      const k = cellKey(intro.id, field);
                      const dirty = isCellDirty(intro, field);
                      const saving = savingCell === k;
                      return (
                        <td key={field} className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <input
                              className="bg-slate-800 border border-slate-700 focus:border-[#F0E545]/60 text-slate-200 text-xs rounded px-2 py-1 outline-none w-full min-w-0 placeholder-slate-600"
                              value={getCellValue(intro, field)}
                              placeholder="—"
                              onChange={e => setCellValues(prev => ({ ...prev, [k]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter' && dirty) saveCell(intro, field); }}
                            />
                            {dirty && (
                              <button onClick={() => saveCell(intro, field)} disabled={saving}
                                className="shrink-0 w-6 h-6 flex items-center justify-center bg-[#F0E545] text-slate-900 rounded hover:bg-yellow-300 disabled:opacity-50" title="Save">
                                {saving ? '…' : '✓'}
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{intro.delivered_date ? intro.delivered_date.slice(0, 10) : '—'}</td>
                    <StatusLogCell intro={intro} partnerId={partnerId} onUpdate={onUpdate}
                      draft={rowDrafts[intro.id] ?? ''}
                      onDraftChange={v => setRowDrafts(prev => ({ ...prev, [intro.id]: v }))}
                      onSubmit={() => appendStatus(intro)}
                      collapsed={collapsedRows.has(intro.id)}
                      onToggleCollapsed={() => toggleCollapsed(intro.id)} />
                    <OutcomeCell intro={intro}
                      pendingOutcome={rowOutcomes[intro.id] ?? ''}
                      onPendingOutcomeChange={v => setRowOutcome(intro.id, v)}
                      onSubmit={() => appendStatus(intro)} />
                    <td className="px-4 py-2.5">
                      <button onClick={() => startEdit(intro)}
                        className="flex items-center gap-1 px-2 py-1 bg-slate-700 hover:bg-[#F0E545]/20 border border-slate-600 hover:border-[#F0E545]/50 text-slate-300 hover:text-[#F0E545] text-xs rounded transition-colors">
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
      )}
    </div>
  );
}

// ── Partner Profile ────────────────────────────────────────────────────────────

interface SectorProfile {
  id: number;
  partner_id: number;
  sector: string;
  subsector: string;
  interest_level: number | null;
  engagement_type: string[];
  orientation: string | null;
  top_priorities: string[];
  environment_reqs: string[];
  investment_appetite: string | null;
  annual_target: number | null;
  solving_notes: string | null;
  blocker_notes: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

const SP_SECTORS       = ['Robotics', 'Supply Chain', 'Manufacturing', 'Industrial Automation', 'Physical AI'];
const SP_ENV_SECTORS   = new Set(['Robotics', 'Manufacturing', 'Industrial Automation']);
const SP_INTEREST_LABELS: Record<number, string> = { 1: 'Low', 2: 'Moderate', 3: 'Interested', 4: 'High', 5: 'Core Priority' };

const SP_ENGAGEMENT = [
  { value: 'invest',                label: 'Invest' },
  { value: 'pilot',                 label: 'Pilot a Solution' },
  { value: 'strategic_partnership', label: 'Strategic Partnership' },
  { value: 'vendor',                label: 'Vendor Evaluation' },
  { value: 'just_tracking',         label: 'Just Tracking' },
];
const SP_ORIENTATIONS = [
  { value: 'founder_team',       label: 'Founder / Team' },
  { value: 'product_technology', label: 'Product / Technology' },
  { value: 'market_opportunity', label: 'Market Opportunity' },
  { value: 'cost_efficiency',    label: 'Cost / Efficiency' },
];
const SP_PRIORITIES = [
  'Technical Maturity', 'Team Pedigree', 'IP / Patents', 'Revenue Traction',
  'Market Size', 'Cost Reduction', 'Integration Ease', 'Pilot Readiness', 'Strategic Fit',
];
const SP_ENVIRONMENTS = [
  'Indoor', 'Outdoor', 'Warehouse', 'Factory Floor',
  'Cold Storage', 'Clean Room', 'Hazardous / Explosive', 'Healthcare',
];
const SP_APPETITE = [
  { value: 'none',       label: 'No Investment' },
  { value: 'occasional', label: 'Occasional Co-invest' },
  { value: 'active',     label: 'Active Co-investor' },
];

function PartnerProfileTab({ partnerId, partnerBrief, onBriefSaved }: {
  partnerId: number;
  partnerBrief: string | null;
  onBriefSaved: (brief: string) => void;
}) {
  const [profiles,       setProfiles]     = useState<SectorProfile[]>([]);
  const [loading,        setLoading]      = useState(true);
  const [brief,          setBrief]        = useState(partnerBrief ?? '');
  const [savingBrief,    setSavingBrief]  = useState(false);
  const [briefSavedAt,   setBriefSavedAt] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState(SP_SECTORS[0]);

  const [sectorForms, setSectorForms] = useState<Record<string, {
    interest_level: number | null;
    engagement_type: string[];
    orientation: string | null;
    top_priorities: string[];
    environment_reqs: string[];
    investment_appetite: string | null;
    annual_target: string;
    solving_notes: string;
    blocker_notes: string;
    saving: boolean;
    savedAt: string | null;
  }>>({});

  useEffect(() => { setBrief(partnerBrief ?? ''); }, [partnerBrief]);

  useEffect(() => {
    setLoading(true);
    fetch(`/partners/${partnerId}/sector-profile`, { headers: AUTH })
      .then(r => r.ok ? r.json() : { profiles: [] })
      .then(d => {
        const rows: SectorProfile[] = d.profiles ?? [];
        setProfiles(rows);
        const forms: typeof sectorForms = {};
        SP_SECTORS.forEach(sec => {
          const p = rows.find(r => r.sector === sec && r.subsector === '');
          forms[sec] = {
            interest_level:      p?.interest_level ?? null,
            engagement_type:     p?.engagement_type ?? [],
            orientation:         p?.orientation ?? null,
            top_priorities:      p?.top_priorities ?? [],
            environment_reqs:    p?.environment_reqs ?? [],
            investment_appetite: p?.investment_appetite ?? null,
            annual_target:       p?.annual_target != null ? String(p.annual_target) : '',
            solving_notes:       p?.solving_notes ?? '',
            blocker_notes:       p?.blocker_notes ?? '',
            saving:              false,
            savedAt:             p?.updated_at ?? null,
          };
        });
        setSectorForms(forms);
      })
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
  }, [partnerId]);

  function setField(sector: string, field: string, value: unknown) {
    setSectorForms(prev => ({ ...prev, [sector]: { ...prev[sector], [field]: value } }));
  }

  async function saveBrief() {
    setSavingBrief(true);
    try {
      await fetch(`/partners/${partnerId}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_brief: brief }),
      });
      onBriefSaved(brief);
      setBriefSavedAt(new Date().toISOString());
    } finally { setSavingBrief(false); }
  }

  async function saveSector(sector: string) {
    const f = sectorForms[sector];
    if (!f) return;
    setField(sector, 'saving', true);
    try {
      const res = await fetch(`/partners/${partnerId}/sector-profile`, {
        method: 'PUT',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sector,
          subsector:           '',
          interest_level:      f.interest_level,
          engagement_type:     f.engagement_type,
          orientation:         f.orientation,
          top_priorities:      f.top_priorities,
          environment_reqs:    f.environment_reqs,
          investment_appetite: f.investment_appetite,
          annual_target:       f.annual_target ? parseInt(f.annual_target, 10) : null,
          solving_notes:       f.solving_notes || null,
          blocker_notes:       f.blocker_notes || null,
        }),
      });
      if (res.ok) {
        const saved: SectorProfile = await res.json();
        setProfiles(prev => {
          const idx = prev.findIndex(p => p.sector === sector && p.subsector === '');
          return idx >= 0 ? prev.map((p, i) => i === idx ? saved : p) : [...prev, saved];
        });
        setField(sector, 'savedAt', saved.updated_at ?? new Date().toISOString());
      }
    } finally { setField(sector, 'saving', false); }
  }

  if (loading) return <p className="text-slate-500 text-sm py-8 text-center">Loading partner profile…</p>;

  const hasSector = (sec: string) => profiles.some(p => p.sector === sec && p.subsector === '');
  const s = selectedSector;
  const f = sectorForms[s] ?? { interest_level: null, engagement_type: [], orientation: null, top_priorities: [], environment_reqs: [], investment_appetite: null, annual_target: '', solving_notes: '', blocker_notes: '', saving: false, savedAt: null };
  const pillBase  = 'px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer select-none';
  const pillOn    = 'bg-[#F0E545] text-[#151411] border-[#F0E545]';
  const pillOff   = 'bg-slate-800 text-slate-400 border-slate-600 hover:border-slate-400';
  const toggleArr = (arr: string[], val: string) => arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
  const togglePriority = (p: string) => {
    const cur = f.top_priorities;
    setField(s, 'top_priorities', cur.includes(p) ? cur.filter(x => x !== p) : cur.length < 3 ? [...cur, p] : cur);
  };

  return (
    <div className="space-y-5 max-w-3xl">

      {/* Partner Brief */}
      <div className="border border-slate-700 rounded-xl p-5 bg-slate-800/40">
        <div className="mb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Partner Brief</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Who is this partner, what do they want from CVC, and what's unique about working with them?
          </p>
        </div>
        <textarea
          value={brief}
          onChange={e => setBrief(e.target.value)}
          rows={5}
          placeholder="Capture relationship context, mandate, key people, political dynamics..."
          className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#F0E545]/50 resize-none leading-relaxed placeholder:text-slate-600"
        />
        <div className="flex items-center justify-between mt-3">
          {briefSavedAt
            ? <p className="text-[11px] text-slate-500">Saved {fmtDate(briefSavedAt)}</p>
            : <span />}
          <button
            onClick={saveBrief}
            disabled={savingBrief}
            className="px-4 py-1.5 bg-[#F0E545] text-[#151411] text-xs font-bold rounded hover:bg-yellow-300 disabled:opacity-50 transition-colors"
          >
            {savingBrief ? 'Saving…' : 'Save Brief'}
          </button>
        </div>
      </div>

      {/* Sector Notes */}
      <div>
        {/* Sector dropdown */}
        <div className="flex items-center gap-3 mb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 shrink-0">Sector Notes</p>
          <select
            value={selectedSector}
            onChange={e => setSelectedSector(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-[#F0E545]/60"
          >
            {SP_SECTORS.map(sec => (
              <option key={sec} value={sec}>{sec}{hasSector(sec) ? ' ✓' : ''}</option>
            ))}
          </select>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasSector(s) ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span className="text-[11px] text-slate-500">{hasSector(s) ? 'Saved' : 'Not yet saved'}</span>
        </div>

        {/* Single sector form */}
        <div className="border border-slate-700 rounded-xl p-5 bg-slate-800/40 space-y-4">

          {/* Interest level */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Interest Level</p>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map(lvl => (
                <button
                  key={lvl}
                  onClick={() => setField(s, 'interest_level', f.interest_level === lvl ? null : lvl)}
                  title={SP_INTEREST_LABELS[lvl]}
                  className={`w-6 h-6 rounded text-[10px] font-bold border transition-all ${
                    f.interest_level != null && lvl <= f.interest_level
                      ? 'bg-[#F0E545] border-[#F0E545] text-[#151411]'
                      : 'bg-slate-800 border-slate-600 text-slate-500 hover:border-slate-400'
                  }`}
                >
                  {lvl}
                </button>
              ))}
              {f.interest_level && (
                <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F0E545]/10 text-[#F0E545] border border-[#F0E545]/20">
                  {SP_INTEREST_LABELS[f.interest_level]}
                </span>
              )}
            </div>
          </div>

          <div className="border-t border-slate-700/60 pt-4 space-y-3">

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Engagement Type</p>
              <div className="flex flex-wrap gap-1.5">
                {SP_ENGAGEMENT.map(({ value, label }) => (
                  <button key={value} onClick={() => setField(s, 'engagement_type', toggleArr(f.engagement_type, value))}
                    className={`${pillBase} ${f.engagement_type.includes(value) ? pillOn : pillOff}`}>{label}</button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Orientation</p>
              <div className="flex flex-wrap gap-1.5">
                {SP_ORIENTATIONS.map(({ value, label }) => (
                  <button key={value} onClick={() => setField(s, 'orientation', f.orientation === value ? null : value)}
                    className={`${pillBase} ${f.orientation === value ? pillOn : pillOff}`}>{label}</button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                Top Priorities <span className="normal-case font-normal text-slate-600">(pick up to 3 in order)</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SP_PRIORITIES.map(p => {
                  const rank = f.top_priorities.indexOf(p);
                  const selected = rank >= 0;
                  const atMax = !selected && f.top_priorities.length >= 3;
                  return (
                    <button key={p} onClick={() => !atMax && togglePriority(p)}
                      className={`flex items-center gap-1 ${pillBase} ${selected ? pillOn : atMax ? 'opacity-40 cursor-not-allowed ' + pillOff : pillOff}`}>
                      {selected && (
                        <span className="w-3.5 h-3.5 rounded-full bg-[#151411] text-[#F0E545] text-[9px] font-extrabold flex items-center justify-center shrink-0">{rank + 1}</span>
                      )}
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>

            {SP_ENV_SECTORS.has(s) && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Environment Requirements</p>
                <div className="flex flex-wrap gap-1.5">
                  {SP_ENVIRONMENTS.map(env => (
                    <button key={env} onClick={() => setField(s, 'environment_reqs', toggleArr(f.environment_reqs, env))}
                      className={`${pillBase} ${f.environment_reqs.includes(env) ? pillOn : pillOff}`}>{env}</button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Investment Appetite</p>
              <div className="flex flex-wrap gap-1.5">
                {SP_APPETITE.map(({ value, label }) => (
                  <button key={value} onClick={() => setField(s, 'investment_appetite', f.investment_appetite === value ? null : value)}
                    className={`${pillBase} ${f.investment_appetite === value ? pillOn : pillOff}`}>{label}</button>
                ))}
              </div>
            </div>

          </div>

          {/* Notes + save */}
          <div className="border-t border-slate-700/60 pt-4 space-y-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                What are they looking for in {s}?
              </p>
              <textarea
                value={f.solving_notes}
                onChange={e => setField(s, 'solving_notes', e.target.value)}
                rows={3}
                placeholder={`What kind of startups do they want to see? What problem are they trying to solve?`}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#F0E545]/40 resize-none leading-relaxed placeholder:text-slate-600"
              />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                Unique considerations &amp; blockers
              </p>
              <textarea
                value={f.blocker_notes}
                onChange={e => setField(s, 'blocker_notes', e.target.value)}
                rows={2}
                placeholder="Constraints, red flags, specific requirements, past experiences..."
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#F0E545]/40 resize-none leading-relaxed placeholder:text-slate-600"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-slate-500 whitespace-nowrap">Target intros/year</label>
                <input
                  type="number"
                  min="0"
                  value={f.annual_target}
                  onChange={e => setField(s, 'annual_target', e.target.value)}
                  placeholder="—"
                  className="w-14 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-center text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#F0E545]/40"
                />
              </div>
              <div className="flex items-center gap-3">
                {f.savedAt && <p className="text-[10px] text-slate-500">Saved {fmtDate(f.savedAt)}</p>}
                <button
                  onClick={() => saveSector(s)}
                  disabled={f.saving}
                  className="px-3 py-1.5 bg-[#F0E545] text-[#151411] text-xs font-bold rounded hover:bg-yellow-300 disabled:opacity-50 transition-colors"
                >
                  {f.saving ? 'Saving…' : `Save ${s}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Note Accordion ─────────────────────────────────────────────────────────────

function NoteAccordion({ note, preview, typeColor, onDelete }: {
  note: ServiceNote;
  preview: string;
  typeColor: string;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700/50 transition-colors"
      >
        <span className={`text-[10px] font-bold uppercase tracking-widest shrink-0 ${typeColor}`}>
          {note.note_type}
        </span>
        <span className="text-xs text-slate-400 shrink-0">
          {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <span className="text-xs text-slate-500 shrink-0">{note.created_by}</span>
        <span className="text-xs text-slate-500 truncate flex-1 ml-1">{!open ? preview : ''}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-slate-700/60">
          <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed pt-3">{note.body}</p>
          <div className="flex justify-end mt-3">
            <button
              onClick={onDelete}
              className="text-xs text-slate-600 hover:text-red-400 transition-colors"
            >Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function PartnerTerminal() {
  const { id } = useParams<{ id: string }>();
  const partnerId = parseInt(id ?? '0', 10);

  const [partner, setPartner]       = useState<PartnerDetail | null>(null);
  const [compat, setCompat]         = useState<CompatCompany[]>([]);
  const [compatDNA, setCompatDNA]   = useState<any>(null);
  const [logs, setLogs]             = useState<AdvisoryLog[]>([]);
  const [activeTab, setActiveTab]   = useState<Tab>('profile');
  const [loading, setLoading]       = useState(true);
  const [loadingCompat, setLoadingCompat] = useState(false);

  // DNA form state
  const [dna, setDna] = useState({
    current_protocols: [] as string[],
    cloud_platform: '',
    hardware_vendors: [] as string[],
    factory_regions: [] as string[],
    scaling_speed: '' as string,
  });
  const [techStack, setTechStack]       = useState<Record<string, string[]>>({});
  const [problems, setProblems]         = useState<ProblemCard[]>([]);
  const [issues, setIssues]             = useState<PartnerIssue[]>([]);
  const [issueComments, setIssueComments] = useState<Record<number, IssueComment[]>>({});
  const [issueInput, setIssueInput]     = useState<Record<number, string>>({});
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);
  const [submittingComment, setSubmittingComment] = useState<number | null>(null);
  const [savingDNA, setSavingDNA] = useState(false);
  const [dnaDirty, setDnaDirty]   = useState(false);

  // Discovery filters
  const [filterSector, setFilterSector]   = useState('');
  const [filterMinScore, setFilterMinScore] = useState(0);

  // Active pilots — expanded row + advisory log form
  const [expandedMatchId, setExpandedMatchId] = useState<number | null>(null);
  const [logForm, setLogForm] = useState({ log_type: 'meeting', body: '', meeting_date: '', outcome: '', next_steps: '', company_id: 0 });
  const [savingLog, setSavingLog] = useState(false);

  const [showFeedback, setShowFeedback] = useState(false);

  // Add Match modal
  const [showAddMatch, setShowAddMatch]       = useState(false);
  const [matchQuery, setMatchQuery]           = useState('');
  const [matchResults, setMatchResults]       = useState<{ id: number; name: string; sector?: string }[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<{ id: number; name: string; sector?: string } | null>(null);
  const [matchScore, setMatchScore]           = useState('75');
  const [matchReason, setMatchReason]         = useState('');
  const [savingMatch, setSavingMatch]         = useState(false);

  // Match status updates
  const [matchStatuses, setMatchStatuses] = useState<Record<number, string>>({});

  // Intros
  const [intros, setIntros] = useState<IntroItem[]>([]);

  // Dealflows
  const [dealflows, setDealflows] = useState<any[]>([]);
  const [expandedDf, setExpandedDf] = useState<number | null>(null);
  const [expandedCol, setExpandedCol] = useState<number | null>(null);
  const [dfForm, setDfForm] = useState({ open: false, tech_focus: '', notes: '', status: 'open' });
  const [colForm, setColForm] = useState<{ dfId: number | null; title: string; notes: string }>({ dfId: null, title: '', notes: '' });
  const [itemQuery, setItemQuery] = useState<Record<number, string>>({});
  const [itemSuggestions, setItemSuggestions] = useState<Record<number, { id: number; name: string; sector?: string }[]>>({});
  const [itemForm, setItemForm] = useState<Record<number, { name: string; company_id: number | null; notes: string }>>({});
  const [savingDf, setSavingDf] = useState(false);

  // Contract info for services panel
  const [terminalContract, setTerminalContract] = useState<{ value?: number | null; term_end?: string | null; contract_status?: string | null; term_start?: string | null } | null>(null);

  // Services
  const [services, setServices]               = useState<ServiceUsageRow[]>([]);
  const [canonicalServices, setCanonicalServices] = useState<string[]>([]);
  const [contractedServices, setContractedServices] = useState<string[]>([]);
  const [servicesYear, setServicesYear]       = useState<number>(new Date().getFullYear());
  const [servicesYears, setServicesYears]     = useState<number[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);
  const [editUsed, setEditUsed]               = useState('');
  const [editIncluded, setEditIncluded]       = useState('');
  const [editNotes, setEditNotes]             = useState('');
  const [addingService, setAddingService]     = useState(false);
  const [newServiceName, setNewServiceName]   = useState('');
  const [newServiceQty, setNewServiceQty]     = useState('');
  const [loggingService, setLoggingService]   = useState<string | null>(null);
  const [showManage, setShowManage]           = useState(false);
  const [showOtherPicker, setShowOtherPicker] = useState(false);
  // Service notes
  const [serviceNotes, setServiceNotes]   = useState<ServiceNote[]>([]);
  const [noteBody, setNoteBody]           = useState('');
  const [noteType, setNoteType]           = useState<string>('general');
  const [savingNote, setSavingNote]       = useState(false);

  // Service order modal
  const [serviceOrderConfig, setServiceOrderConfig] = useState<ServiceOrderConfig | null>(null);
  const [serviceOrderFields, setServiceOrderFields] = useState<Record<string, string>>({});
  const [submittingOrder, setSubmittingOrder]       = useState(false);
  const [orderSuccess, setOrderSuccess]             = useState(false);
  const serviceFormRef = useRef<HTMLDivElement>(null);

  // ── Load data ────────────────────────────────────────────────────────────────

  const loadPartner = useCallback(async () => {
    const data = await api.getPartner(partnerId);
    setPartner(data);
    const d = {
      current_protocols: data.current_protocols ?? [],
      cloud_platform:    data.cloud_platform    ?? '',
      hardware_vendors:  data.hardware_vendors  ?? [],
      factory_regions:   data.factory_regions   ?? [],
      scaling_speed:     data.scaling_speed      ?? '',
    };
    setDna(d);
    setTechStack(data.tech_stack ?? {});
    const statuses: Record<number, string> = {};
    (data.matches ?? []).forEach((m: MatchItem) => { statuses[m.id] = m.status; });
    setMatchStatuses(statuses);
    fetch(`/partners/${partnerId}/contract`, { headers: AUTH })
      .then(r => r.ok ? r.json() : null)
      .then(d => setTerminalContract(d))
      .catch(() => {});
  }, [partnerId]);

  const loadCompat = useCallback(async () => {
    setLoadingCompat(true);
    try {
      const data = await api.getCompatibility(partnerId, { limit: 100 });
      setCompat(data.companies ?? []);
      setCompatDNA(data.partner_dna ?? null);
    } catch { setCompat([]); }
    finally { setLoadingCompat(false); }
  }, [partnerId]);

  const loadLogs = useCallback(async () => {
    try {
      const data = await api.listAdvisoryLogs(partnerId);
      setLogs(data.logs ?? []);
    } catch { setLogs([]); }
  }, [partnerId]);

  const loadProblems = useCallback(async () => {
    try {
      const data = await api.listProblems(partnerId);
      setProblems(data.problems ?? []);
    } catch { setProblems([]); }
  }, [partnerId]);

  const loadIssues = useCallback(async () => {
    try {
      const data = await api.listIssues(partnerId);
      const open = (data.issues ?? []).filter((i: PartnerIssue) => !i.resolved);
      setIssues(open);
    } catch { setIssues([]); }
  }, [partnerId]);

  const loadIntros = useCallback(async () => {
    try {
      const res = await fetch(`/partners/${partnerId}/intros`, { headers: AUTH });
      const data = await res.json();
      setIntros(Array.isArray(data) ? data : []);
    } catch { setIntros([]); }
  }, [partnerId]);

  const loadDealflows = useCallback(async () => {
    try {
      const res = await fetch(`/partners/${partnerId}/dealflows`, { headers: AUTH });
      const data = await res.json();
      setDealflows(data.dealflows ?? []);
    } catch { setDealflows([]); }
  }, [partnerId]);

  const loadServiceNotes = useCallback(async () => {
    try {
      const data = await api.getServiceNotes(partnerId);
      setServiceNotes(Array.isArray(data) ? data : []);
    } catch { setServiceNotes([]); }
  }, [partnerId]);

  const loadServices = useCallback(async (year?: number) => {
    setLoadingServices(true);
    try {
      const yr = year ?? servicesYear;
      const res = await fetch(`/partners/${partnerId}/services${year ? `?year=${year}` : ''}`, { headers: AUTH });
      const data = await res.json();
      setServices(data.services ?? []);
      setCanonicalServices(data.canonical_services ?? []);
      setContractedServices(data.contracted_services ?? []);
      setServicesYears(data.available_years ?? []);
      setServicesYear(data.resolved_year ?? yr);
    } catch { setServices([]); }
    finally { setLoadingServices(false); }
  }, [partnerId, servicesYear]);

  async function handleSaveServiceEdit(serviceId: number) {
    const used = parseInt(editUsed, 10);
    if (isNaN(used) || used < 0) return;
    const incl = editIncluded === '' ? null : parseInt(editIncluded, 10);
    try {
      await api.updateServiceUsage(partnerId, serviceId, {
        quantity_used: used,
        quantity_included: incl,
        notes: editNotes || undefined,
      });
      setEditingServiceId(null);
      loadServices(servicesYear);
    } catch { /* silent */ }
  }

  async function handleAddService() {
    if (!newServiceName.trim() || newServiceName === '__custom__') return;
    const qty = newServiceQty ? parseInt(newServiceQty, 10) : undefined;
    try {
      await api.upsertService(partnerId, {
        service_name: newServiceName,
        quantity_included: qty !== undefined && !isNaN(qty) ? qty : null,
        quantity_used: 0,
        year: servicesYear,
      });
      setAddingService(false);
      setNewServiceName('');
      setNewServiceQty('');
      loadServices(servicesYear);
    } catch { /* silent */ }
  }

  async function logServiceUsage(serviceName: string) {
    setLoggingService(serviceName);
    try {
      const existing = services.find(s => s.service_name === serviceName);
      if (existing) {
        await api.updateServiceUsage(partnerId, existing.id, { quantity_used: existing.quantity_used + 1 });
      } else {
        await api.upsertService(partnerId, { service_name: serviceName, quantity_used: 1, quantity_included: null, year: servicesYear });
      }
      await loadServices(servicesYear);
    } catch { /* silent */ }
    finally { setLoggingService(null); }
  }

  function openServiceOrder(serviceType: string, prefillServiceName?: string) {
    const cfg = SERVICE_ORDER_CONFIGS[serviceType] ?? SERVICE_ORDER_CONFIGS.other;
    const initial: Record<string, string> = {};
    if (prefillServiceName && serviceType === 'other') initial.service_name = prefillServiceName;
    cfg.fields.forEach(f => { if (!(f.key in initial)) initial[f.key] = f.options ? f.options[0] : ''; });
    setServiceOrderConfig(cfg);
    setServiceOrderFields(initial);
    setOrderSuccess(false);
    setTimeout(() => serviceFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function submitServiceOrder() {
    if (!serviceOrderConfig || !partner) return;
    setSubmittingOrder(true);
    try {
      // 1. Log service usage
      const svcName = serviceOrderConfig.serviceType === 'other'
        ? (serviceOrderFields.service_name || 'Other')
        : (PRIORITY_SERVICES.find(p => p.serviceType === serviceOrderConfig.serviceType)?.name ?? serviceOrderConfig.title);
      await logServiceUsage(svcName);

      // 2. Build title
      const partnerName = partner.name;
      const titleParts: string[] = [];
      if (serviceOrderConfig.serviceType === 'intro' && serviceOrderFields.startup_name)
        titleParts.push(serviceOrderFields.startup_name);
      if (serviceOrderFields.sector) titleParts.push(serviceOrderFields.sector);
      if (serviceOrderFields.subsector) titleParts.push(serviceOrderFields.subsector);
      const suffix = titleParts.length ? ` — ${titleParts.join(' · ')}` : '';
      const title = `[${serviceOrderConfig.title}] ${partnerName}${suffix}`;

      // 3. Fetch partner sector profile for selected sector
      const sector = serviceOrderFields.sector;
      let profileBlock = '';
      if (sector) {
        try {
          const profRes = await fetch(`/partners/${partnerId}/sector-profile`, { headers: AUTH });
          if (profRes.ok) {
            const profData = await profRes.json();
            const prof: SectorProfile | undefined = (profData.profiles ?? []).find(
              (p: SectorProfile) => p.sector === sector && p.subsector === ''
            );
            if (prof) {
              const lines: string[] = [];
              if (prof.interest_level)          lines.push(`Interest Level: ${SP_INTEREST_LABELS[prof.interest_level]} (${prof.interest_level}/5)`);
              if (prof.engagement_type?.length)  lines.push(`Engagement: ${prof.engagement_type.map(e => SP_ENGAGEMENT.find(x => x.value === e)?.label ?? e).join(', ')}`);
              if (prof.orientation)              lines.push(`Orientation: ${SP_ORIENTATIONS.find(x => x.value === prof.orientation)?.label ?? prof.orientation}`);
              if (prof.top_priorities?.length)   lines.push(`Top Priorities: ${prof.top_priorities.map((p, i) => `#${i + 1} ${p}`).join(' · ')}`);
              if (prof.environment_reqs?.length) lines.push(`Environment: ${prof.environment_reqs.join(', ')}`);
              if (prof.investment_appetite)      lines.push(`Investment Appetite: ${SP_APPETITE.find(x => x.value === prof.investment_appetite)?.label ?? prof.investment_appetite}`);
              if (prof.annual_target)            lines.push(`Target Intros/Year: ${prof.annual_target}`);
              if (prof.solving_notes)            lines.push(`\nWhat they're looking for:\n${prof.solving_notes}`);
              if (prof.blocker_notes)            lines.push(`\nBlockers & Considerations:\n${prof.blocker_notes}`);
              if (lines.length) profileBlock = `\n\n=== PARTNER PROFILE — ${sector.toUpperCase()} ===\n${lines.join('\n')}`;
            }
          }
        } catch { /* non-blocking */ }
      }

      // 4. Build enriched notes
      const formLines = serviceOrderConfig.fields
        .map(f => {
          const v = serviceOrderFields[f.key];
          return v && String(v).trim() ? `${f.label}: ${v}` : null;
        })
        .filter(Boolean)
        .join('\n');
      const notes = `=== SERVICE REQUEST ===\n${formLines}${profileBlock}`;

      // 5. Create venture assignment
      let assignmentId: number | null = null;
      try {
        const aRes = await fetch('/ventures/assignments', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, notes, partner_id: partnerId, priority: 'medium', source: 'partner_request' }),
        });
        if (aRes.ok) { const a = await aRes.json(); assignmentId = a.id; }
      } catch { /* non-blocking */ }

      // 6. Create request
      await fetch('/requests', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          service_type: serviceOrderConfig.serviceType,
          partner_id: partnerId,
          partner_name: partnerName,
          priority: serviceOrderFields.priority?.toLowerCase() || 'medium',
          service_fields: serviceOrderFields,
          venture_assignment_id: assignmentId,
        }),
      });

      setOrderSuccess(true);
      setTimeout(() => { setServiceOrderConfig(null); setOrderSuccess(false); }, 1500);
    } catch { /* silent */ }
    finally { setSubmittingOrder(false); }
  }


  const loadIssueComments = useCallback(async (issueId: number) => {
    try {
      const data = await api.listIssueComments(partnerId, issueId);
      setIssueComments(prev => ({ ...prev, [issueId]: data.comments ?? [] }));
    } catch { /* silent */ }
  }, [partnerId]);

  // Company typeahead for Add Match
  useEffect(() => {
    if (matchQuery.length < 2) { setMatchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const data = await api.searchCompanies({ q: matchQuery, limit: 8 });
        setMatchResults(data.companies ?? []);
      } catch { setMatchResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [matchQuery]);

  async function handleAddMatch() {
    if (!partner || !selectedCompany || !matchReason.trim()) return;
    setSavingMatch(true);
    try {
      await api.addMatch(partner.id, { company_id: selectedCompany.id, match_score: parseInt(matchScore, 10), match_reason: matchReason });
      setShowAddMatch(false);
      setSelectedCompany(null);
      setMatchQuery('');
      setMatchReason('');
      setMatchScore('75');
      await loadPartner();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed to add match'); }
    finally { setSavingMatch(false); }
  }

  async function submitIssueComment(issue: PartnerIssue) {
    const body = (issueInput[issue.id] ?? '').trim();
    if (!body) return;
    setSubmittingComment(issue.id);
    try {
      await api.addIssueComment(issue.partner_id, issue.id, body);
      setIssueInput(prev => ({ ...prev, [issue.id]: '' }));
      await loadIssueComments(issue.id);
    } catch { /* silent */ }
    finally { setSubmittingComment(null); }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadPartner(), loadCompat(), loadLogs(), loadProblems(), loadIssues(), loadIntros(), loadServices(), loadDealflows(), loadServiceNotes()]).finally(() => setLoading(false));
  }, [loadPartner, loadCompat, loadLogs, loadProblems, loadIssues, loadIntros, loadDealflows, loadServiceNotes]);

  // ── DNA actions ──────────────────────────────────────────────────────────────

  function updateDna(field: string, value: any) {
    setDna(prev => ({ ...prev, [field]: value }));
    setDnaDirty(true);
  }

  function toggleProtocol(proto: string) {
    const current = dna.current_protocols;
    const next = current.includes(proto) ? current.filter(p => p !== proto) : [...current, proto];
    updateDna('current_protocols', next);
  }

  async function saveDNA() {
    setSavingDNA(true);
    try {
      await api.updatePartnerDNA(partnerId, {
        current_protocols: dna.current_protocols,
        cloud_platform:    dna.cloud_platform || undefined,
        hardware_vendors:  dna.hardware_vendors,
        factory_regions:   dna.factory_regions,
        scaling_speed:     (dna.scaling_speed || undefined) as any,
      });
      setDnaDirty(false);
      await loadCompat();
    } catch (err) { alert('Failed to save'); }
    finally { setSavingDNA(false); }
  }

  // ── Advisory log actions ─────────────────────────────────────────────────────

  async function submitLog() {
    if (!logForm.body.trim()) return;
    setSavingLog(true);
    try {
      await api.createAdvisoryLog(partnerId, {
        log_type:     logForm.log_type,
        body:         logForm.body,
        company_id:   logForm.company_id || undefined,
        meeting_date: logForm.meeting_date || undefined,
        outcome:      logForm.outcome || undefined,
        next_steps:   logForm.next_steps || undefined,
      });
      setLogForm({ log_type: 'meeting', body: '', meeting_date: '', outcome: '', next_steps: '', company_id: 0 });
      await loadLogs();
    } catch { }
    finally { setSavingLog(false); }
  }

  async function handleStatusChange(matchId: number, status: string) {
    if (!partner) return;
    setMatchStatuses(prev => ({ ...prev, [matchId]: status }));
    await api.updateMatchStatus(partner.id, matchId, status);
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const uniqueSectors = [...new Set(compat.map(c => c.sector).filter(Boolean))].sort() as string[];

  const filteredCompat = compat.filter(c => {
    if (filterSector && c.sector !== filterSector) return false;
    if (c.compatibility_score < filterMinScore) return false;
    return true;
  });

  const watchlistCompanies = partner?.matches ?? [];
  const byCountry = watchlistCompanies.reduce<Record<string, MatchItem[]>>((acc, m) => {
    const key = m.country ?? 'Unknown';
    (acc[key] = acc[key] || []).push(m);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="min-h-screen bg-[#151411] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#F0E545] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!partner) {
    return (
      <div className="min-h-screen bg-[#151411] flex items-center justify-center text-slate-400">
        Partner not found.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#151411] text-slate-200 flex flex-col">

      {/* ── Report Header ───────────────────────────────────────────────────── */}
      <div className="border-b-2 border-slate-700 px-6 pt-5 pb-0 flex-shrink-0">
        {/* Breadcrumb */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Link to={`/partners?id=${partnerId}`} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-xs transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Partners
            </Link>
            <span className="text-slate-700">·</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Advisory Terminal</span>
          </div>
          <button
            onClick={() => setShowFeedback(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded text-xs font-medium transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Feedback
          </button>
        </div>
        {/* Title + KPI strip */}
        <div className="flex items-end justify-between pb-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">
              SLAM · Partner Intelligence
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">{partner.name}</h1>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {partner.industry && <span className="text-sm text-slate-400">{partner.industry}</span>}
              {services.length > 0 && (
                <>
                  {partner.industry && <span className="text-slate-700 text-xs">·</span>}
                  {PRIORITY_SERVICES.map(ps => {
                    const row = services.find(s => s.service_name === ps.name);
                    if (!row) return null;
                    const used = row.quantity_used;
                    const incl = row.quantity_included;
                    return (
                      <span key={ps.name} className="text-[11px] font-medium" style={{ color: ps.color }}>
                        {ps.label} <span className="font-bold">{used}</span>
                        {incl != null && <span className="opacity-50">/{incl}</span>}
                      </span>
                    );
                  })}
                </>
              )}
            </div>
          </div>
          <div className="flex items-stretch divide-x divide-slate-700 border border-slate-700/60 rounded mb-0.5">
            <div className="px-5 py-3 text-center">
              <div className="text-lg font-bold text-white">{compat.length}</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-0.5">Ranked</div>
            </div>
            <div className="px-5 py-3 text-center">
              <div className="text-lg font-bold text-[#F0E545]">{partner.matches.length}</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-0.5">Active Pilots</div>
            </div>
            <div className="px-5 py-3 text-center">
              <div className="text-lg font-bold text-red-400">{issues.length}</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-0.5">Open Issues</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Main Content ─────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto flex flex-col">

          {/* Tab bar */}
          <div className="flex border-b border-slate-800 px-6 flex-shrink-0 -mb-px">
            {([
              ['profile',   'Service Profile'],
              ['tracking',  `Startup Tracking (${intros.length})`],
              ['discovery', 'Market Discovery'],
              ['pilots',    `Active Pilots (${partner.matches.length})`],
              ['risk',      'Risk Assessment'],
              ['stack',     'Stack View'],
              ['problems',  `Problem Board${problems.length ? ` (${problems.length})` : ''}`],
              ['notes',     `Notes${serviceNotes.length ? ` (${serviceNotes.length})` : ''}`],
            ] as [Tab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-[#F0E545] text-[#F0E545]'
                    : 'border-transparent text-slate-500 hover:text-slate-200 hover:border-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 p-6">

            {/* ── Partner Profile ───────────────────────────────────────────── */}
            {activeTab === 'profile' && (
              <div className="space-y-5">
              <div className="flex gap-6">

                {/* Left: profile notes */}
                <div className="flex-1 min-w-0">
                  <PartnerProfileTab
                    partnerId={partner.id}
                    partnerBrief={partner.partner_brief ?? null}
                    onBriefSaved={brief => setPartner(prev => prev ? { ...prev, partner_brief: brief } : prev)}
                  />
                </div>

                {/* Right: services panel */}
                <div className="w-72 shrink-0 space-y-3">

                  {/* Contract summary */}
                  {(partner.membership_level || terminalContract) && (
                    <div className="bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2.5 space-y-1.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Contract</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {partner.membership_level && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                            partner.membership_level === 'Founding Anchor' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                            partner.membership_level === 'Anchor'          ? 'bg-slate-200/10 text-slate-300 border-slate-500/30' :
                            partner.membership_level === 'Ecosystem+'      ? 'bg-teal-500/20 text-teal-300 border-teal-500/30' :
                            'bg-slate-700/40 text-slate-400 border-slate-600'
                          }`}>{partner.membership_level}</span>
                        )}
                        {terminalContract && (() => {
                          const v = terminalContract.value;
                          return v != null ? (
                            <span className="text-xs text-slate-300 font-medium">
                              {v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M/yr` : v >= 1_000 ? `$${(v/1_000).toFixed(0)}K/yr` : `$${v}/yr`}
                            </span>
                          ) : null;
                        })()}
                        {terminalContract?.term_start && (
                          <span className="text-[10px] text-slate-500">
                            Partner since {new Date(terminalContract.term_start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                          </span>
                        )}
                        {terminalContract?.term_end && (() => {
                          const end = new Date(terminalContract.term_end! + 'T12:00:00');
                          const days = Math.round((end.getTime() - Date.now()) / 86400000);
                          const color = days < 90 ? 'text-red-400' : days < 180 ? 'text-amber-400' : 'text-emerald-400';
                          return (
                            <span className={`text-xs ${color}`}>
                              expires {end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                              {days > 0 && days < 365 && <span className="ml-1 text-[10px] opacity-70">({days}d)</span>}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Header row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Services</span>
                      {servicesYears.length > 1 && (
                        <select
                          value={servicesYear}
                          onChange={e => loadServices(parseInt(e.target.value))}
                          className="bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded px-1.5 py-1 focus:outline-none focus:border-[#F0E545]"
                        >
                          {servicesYears.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                      )}
                    </div>
                    <button
                      onClick={() => setShowManage(v => !v)}
                      className={`text-[10px] px-2.5 py-1 rounded border transition-colors ${showManage ? 'border-[#F0E545]/40 text-[#F0E545]' : 'border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500'}`}
                    >
                      {showManage ? 'Hide' : 'Manage'}
                    </button>
                  </div>

                  {/* Service buttons — always visible */}
                  <div className="space-y-1.5">
                    {(contractedServices.length > 0 ? contractedServices : PRIORITY_SERVICES.map(p => p.name)).map(serviceName => {
                      const meta = PRIORITY_SERVICES.find(p => p.name === serviceName);
                      const row = services.find(s => s.service_name === serviceName);
                      const used = row?.quantity_used ?? 0;
                      const incl = row?.quantity_included ?? null;
                      const isOver = incl != null && used >= incl;
                      const color = meta?.color ?? '#94a3b8';
                      const serviceType = meta?.serviceType ?? 'other';
                      const isActive = serviceOrderConfig?.title === (meta?.label ?? serviceName) || serviceOrderConfig?.title === serviceName;
                      return (
                        <button
                          key={serviceName}
                          onClick={() => openServiceOrder(serviceType, serviceName)}
                          className="w-full flex items-center justify-between px-4 py-3 bg-slate-800 border rounded-lg transition-all hover:bg-slate-700/70 active:scale-[0.98] text-sm group"
                          style={{ borderColor: isActive ? '#F0E545' : color + '30', boxShadow: isActive ? '0 0 0 1px #F0E54520' : undefined }}
                        >
                          <span className="font-semibold" style={{ color }}>{meta?.label ?? serviceName}</span>
                          <div className="flex items-center gap-2">
                            <span className="tabular-nums font-bold text-white" style={{ color: isOver ? '#ef4444' : undefined }}>
                              {used}{incl != null ? <span className="opacity-40">/{incl}</span> : ''}
                            </span>
                            <span className="text-slate-600 group-hover:text-slate-400 text-xs">{isActive ? '✎' : '+'}</span>
                          </div>
                        </button>
                      );
                    })}

                    {/* Other */}
                    <div className="relative">
                      <button
                        onClick={() => setShowOtherPicker(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800 border border-slate-700/60 rounded-lg transition-all hover:bg-slate-700/70 hover:border-slate-500 active:scale-[0.98] text-sm text-slate-400"
                      >
                        <span>Other</span>
                        <span className="text-slate-600">↓</span>
                      </button>
                      {showOtherPicker && (
                        <div className="absolute top-full left-0 mt-1 z-50 w-full bg-[#1e293b] border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
                          {services
                            .filter(s => !(contractedServices.length > 0 ? contractedServices : PRIORITY_SERVICES.map(p => p.name)).includes(s.service_name))
                            .map(svc => (
                              <button
                                key={svc.id}
                                onClick={() => { openServiceOrder('other', svc.service_name); setShowOtherPicker(false); }}
                                className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 flex items-center justify-between"
                              >
                                <span>{svc.service_name}</span>
                                <span className="text-slate-500 tabular-nums">{svc.quantity_used}{svc.quantity_included != null ? `/${svc.quantity_included}` : ''}</span>
                              </button>
                            ))}
                          {canonicalServices
                            .filter(s => !services.some(sv => sv.service_name === s) && !(contractedServices.length > 0 ? contractedServices : PRIORITY_SERVICES.map(p => p.name)).includes(s))
                            .map(s => (
                              <button
                                key={s}
                                onClick={() => { openServiceOrder('other', s); setShowOtherPicker(false); }}
                                className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:bg-slate-700 hover:text-slate-300"
                              >
                                {s}
                              </button>
                            ))}
                          <div className="border-t border-slate-700/60" />
                          <button
                            onClick={() => { setShowOtherPicker(false); setShowManage(true); setAddingService(true); setNewServiceName(''); setNewServiceQty(''); }}
                            className="w-full text-left px-3 py-2 text-xs text-[#F0E545]/60 hover:bg-slate-700 hover:text-[#F0E545] flex items-center gap-1.5"
                          >
                            <Plus className="w-3 h-3" /> Add new service
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Manage table */}
                  {showManage && (
                    <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-700">
                            <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Service</th>
                            <th className="text-center px-2 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 w-12">Incl</th>
                            <th className="text-center px-2 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 w-12">Used</th>
                            <th className="w-8" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/40">
                          {services.map(svc => {
                            const isEditing = editingServiceId === svc.id;
                            return (
                              <tr key={svc.id} className="hover:bg-slate-700/30">
                                <td className="px-3 py-2 text-slate-300 text-[11px] truncate max-w-[120px]">{svc.service_name}</td>
                                <td className="px-2 py-2 text-center">
                                  {isEditing ? (
                                    <input type="number" min="0" value={editIncluded} onChange={e => setEditIncluded(e.target.value)} placeholder="∞"
                                      className="w-10 text-center text-[10px] bg-slate-900 border border-[#F0E545]/60 text-slate-200 rounded px-1 py-0.5 focus:outline-none" />
                                  ) : (
                                    <span className="text-slate-400 text-[10px]">{svc.quantity_included == null ? '∞' : svc.quantity_included}</span>
                                  )}
                                </td>
                                <td className="px-2 py-2 text-center">
                                  {isEditing ? (
                                    <input type="number" min="0" value={editUsed} onChange={e => setEditUsed(e.target.value)} autoFocus
                                      className="w-10 text-center text-[10px] bg-slate-900 border border-[#F0E545]/60 text-slate-200 rounded px-1 py-0.5 focus:outline-none" />
                                  ) : (
                                    <span className="text-slate-200 text-[10px] font-semibold">{svc.quantity_used}</span>
                                  )}
                                </td>
                                <td className="px-1 py-2">
                                  {isEditing ? (
                                    <button onClick={() => handleSaveServiceEdit(svc.id)} className="p-1 rounded hover:bg-[#10b981]/20 text-[#10b981]">
                                      <Check className="w-3 h-3" />
                                    </button>
                                  ) : (
                                    <button onClick={() => { setEditingServiceId(svc.id); setEditUsed(String(svc.quantity_used)); setEditIncluded(svc.quantity_included != null ? String(svc.quantity_included) : ''); setEditNotes(svc.notes ?? ''); }}
                                      className="p-1 rounded text-slate-600 hover:text-slate-300 hover:bg-slate-700">
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {addingService && (
                            <tr className="bg-slate-700/30">
                              <td className="px-3 py-2" colSpan={4}>
                                <select value={newServiceName} onChange={e => setNewServiceName(e.target.value)} autoFocus
                                  className="w-full text-[10px] bg-slate-900 border border-[#F0E545]/60 text-slate-200 rounded px-2 py-1 focus:outline-none mb-1.5">
                                  <option value="">Select service…</option>
                                  {canonicalServices.filter(s => !services.some(sv => sv.service_name === s)).map(s => (
                                    <option key={s} value={s}>{s}</option>
                                  ))}
                                  <option value="__custom__">Custom…</option>
                                </select>
                                <div className="flex items-center gap-2">
                                  <input type="number" min="1" value={newServiceQty} onChange={e => setNewServiceQty(e.target.value)} placeholder="Qty"
                                    className="w-14 text-center text-[10px] bg-slate-900 border border-slate-600 text-slate-200 rounded px-1 py-1 focus:outline-none focus:border-[#F0E545]" />
                                  <button onClick={handleAddService} disabled={!newServiceName.trim() || newServiceName === '__custom__'}
                                    className="p-1 rounded hover:bg-[#10b981]/20 text-[#10b981] disabled:opacity-30">
                                    <Check className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => setAddingService(false)} className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-700">
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      {!addingService && (
                        <button onClick={() => { setAddingService(true); setNewServiceName(''); setNewServiceQty(''); }}
                          className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] text-slate-600 hover:text-slate-400 hover:bg-slate-700/40 transition-colors border-t border-slate-700/40">
                          <Plus className="w-3 h-3" /> Add service
                        </button>
                      )}
                    </div>
                  )}

                </div>
              </div>

              {/* ── Service order form — full width ─────────────────────────── */}
              {serviceOrderConfig && (
                <div ref={serviceFormRef} className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                  {/* Header */}
                  <div className="flex items-start justify-between px-6 py-4 border-b border-slate-700/60">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Service Request</p>
                      <h3 className="text-base font-bold text-white">{serviceOrderConfig.title}</h3>
                      <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">{serviceOrderConfig.instructions}</p>
                    </div>
                    <button onClick={() => { setServiceOrderConfig(null); setOrderSuccess(false); }} className="text-slate-600 hover:text-slate-300 mt-0.5 shrink-0 ml-6">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Fields — 2-col grid */}
                  <div className="px-6 py-5 grid grid-cols-2 gap-x-6 gap-y-4">
                    {serviceOrderConfig.fields.map(field => (
                      <div key={field.key} className={field.type === 'textarea' ? 'col-span-2' : ''}>
                        <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">
                          {field.label}{field.required && <span className="text-[#F0E545] ml-0.5">*</span>}
                        </label>
                        {field.type === 'textarea' ? (
                          <textarea
                            rows={4}
                            value={serviceOrderFields[field.key] ?? ''}
                            onChange={e => setServiceOrderFields(p => ({ ...p, [field.key]: e.target.value }))}
                            placeholder={field.placeholder}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#F0E545] resize-none placeholder-slate-600"
                          />
                        ) : field.type === 'select' ? (
                          <select
                            value={serviceOrderFields[field.key] ?? field.options![0]}
                            onChange={e => setServiceOrderFields(p => ({ ...p, [field.key]: e.target.value }))}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#F0E545]"
                          >
                            {field.options!.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input
                            type={field.type}
                            value={serviceOrderFields[field.key] ?? ''}
                            onChange={e => setServiceOrderFields(p => ({ ...p, [field.key]: e.target.value }))}
                            placeholder={field.placeholder}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#F0E545] placeholder-slate-600"
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700/60">
                    <button
                      onClick={() => { setServiceOrderConfig(null); setOrderSuccess(false); }}
                      className="text-xs text-slate-500 hover:text-slate-300"
                    >
                      Cancel
                    </button>
                    {orderSuccess ? (
                      <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" /> Sent to Ventures
                      </span>
                    ) : (
                      <button
                        onClick={submitServiceOrder}
                        disabled={submittingOrder}
                        className="flex items-center gap-1.5 px-4 py-2 bg-[#F0E545] text-[#0f172a] text-xs font-bold rounded-lg hover:bg-[#F0E545]/90 disabled:opacity-50 transition-colors"
                      >
                        <Send className="w-3 h-3" />
                        {submittingOrder ? 'Submitting…' : 'Submit Request'}
                      </button>
                    )}
                  </div>
                </div>
              )}
              </div>
            )}

            {/* ── [Services tab merged into Partner Profile right panel] ── */}
            {false && (<div>
                {/* ── Action Buttons ─────────────────────────────────────────── */}
                <div className="flex flex-wrap gap-2 mb-6">
                  {PRIORITY_SERVICES.map(ps => {
                    const row = services.find(s => s.service_name === ps.name);
                    const used = row?.quantity_used ?? 0;
                    const incl = row?.quantity_included ?? null;
                    const isOver = incl != null && used >= incl;
                    return (
                      <button
                        key={ps.name}
                        onClick={() => openServiceOrder(ps.serviceType)}
                        className="group relative flex items-center gap-2 px-3 py-1.5 bg-slate-800 border rounded-lg transition-all hover:bg-slate-700/70 active:scale-[0.97] text-xs"
                        style={{ borderColor: ps.color + '40' }}
                      >
                        <span className="font-semibold" style={{ color: ps.color }}>{ps.label}</span>
                        <span className="tabular-nums font-bold text-white" style={{ color: isOver ? '#ef4444' : undefined }}>
                          {used}{incl != null ? <span style={{ color: ps.color + '70' }}>/{incl}</span> : ''}
                        </span>
                        <span className="text-slate-500 text-[10px]">+</span>
                      </button>
                    );
                  })}

                  {/* Other button */}
                  <div className="relative">
                    <button
                      onClick={() => setShowOtherPicker(v => !v)}
                      className="group flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-slate-700/60 rounded-lg transition-all hover:bg-slate-700/70 hover:border-slate-500 active:scale-[0.97] text-xs text-slate-400"
                    >
                      <span>Other</span>
                      <span className="text-slate-600">↓</span>
                    </button>
                    {showOtherPicker && (
                      <div className="absolute top-full left-0 mt-1 z-50 w-56 bg-[#1e293b] border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
                        {services
                          .filter(s => !PRIORITY_SERVICES.some(p => p.name === s.service_name))
                          .map(svc => (
                            <button
                              key={svc.id}
                              onClick={() => { openServiceOrder('other', svc.service_name); setShowOtherPicker(false); }}
                              className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 flex items-center justify-between"
                            >
                              <span>{svc.service_name}</span>
                              <span className="text-slate-500 tabular-nums">{svc.quantity_used}{svc.quantity_included != null ? `/${svc.quantity_included}` : ''}</span>
                            </button>
                          ))}
                        {canonicalServices
                          .filter(s => !services.some(sv => sv.service_name === s) && !PRIORITY_SERVICES.some(p => p.name === s))
                          .map(s => (
                            <button
                              key={s}
                              onClick={() => { openServiceOrder('other', s); setShowOtherPicker(false); }}
                              className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:bg-slate-700 hover:text-slate-300"
                            >
                              {s}
                            </button>
                          ))}
                        <div className="border-t border-slate-700/60" />
                        <button
                          onClick={() => { setShowOtherPicker(false); setShowManage(true); setAddingService(true); setNewServiceName(''); setNewServiceQty(''); }}
                          className="w-full text-left px-3 py-2 text-xs text-[#F0E545]/60 hover:bg-slate-700 hover:text-[#F0E545] flex items-center gap-1.5"
                        >
                          <Plus className="w-3 h-3" /> Add new service
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Manage table (collapsed by default) ────────────────────── */}
                {showManage && (
                  <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Service</th>
                          <th className="text-center px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500 w-24">Included</th>
                          <th className="text-center px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500 w-20">Used</th>
                          <th className="text-left px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Notes</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/40">
                        {services.map(svc => {
                          const isEditing = editingServiceId === svc.id;
                          return (
                            <tr key={svc.id} className="hover:bg-slate-700/30">
                              <td className="px-4 py-2.5 text-slate-200 font-medium text-sm">{svc.service_name}</td>
                              <td className="px-3 py-2.5 text-center">
                                {isEditing ? (
                                  <input type="number" min="0" value={editIncluded} onChange={e => setEditIncluded(e.target.value)} placeholder="∞"
                                    className="w-14 text-center text-xs bg-slate-900 border border-[#F0E545]/60 text-slate-200 rounded px-1 py-0.5 focus:outline-none" />
                                ) : (
                                  <span className="text-slate-400 text-xs">{svc.quantity_included == null ? '∞' : svc.quantity_included}</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                {isEditing ? (
                                  <input type="number" min="0" value={editUsed} onChange={e => setEditUsed(e.target.value)} autoFocus
                                    className="w-14 text-center text-xs bg-slate-900 border border-[#F0E545]/60 text-slate-200 rounded px-1 py-0.5 focus:outline-none" />
                                ) : (
                                  <span className="text-slate-200 text-xs font-semibold">{svc.quantity_used}</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5">
                                {isEditing ? (
                                  <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notes…"
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveServiceEdit(svc.id); if (e.key === 'Escape') setEditingServiceId(null); }}
                                    className="w-full text-xs bg-slate-900 border border-slate-600 text-slate-200 rounded px-2 py-0.5 focus:outline-none focus:border-[#F0E545]" />
                                ) : (
                                  <span className="text-xs text-slate-500">{svc.notes ?? ''}</span>
                                )}
                              </td>
                              <td className="px-2 py-2.5">
                                {isEditing ? (
                                  <button onClick={() => handleSaveServiceEdit(svc.id)} className="p-1 rounded hover:bg-[#10b981]/20 text-[#10b981]">
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button onClick={() => { setEditingServiceId(svc.id); setEditUsed(String(svc.quantity_used)); setEditIncluded(svc.quantity_included != null ? String(svc.quantity_included) : ''); setEditNotes(svc.notes ?? ''); }}
                                    className="p-1 rounded text-slate-600 hover:text-slate-300 hover:bg-slate-700">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {addingService && (
                          <tr className="bg-slate-700/30">
                            <td className="px-4 py-2">
                              <select value={newServiceName} onChange={e => setNewServiceName(e.target.value)} autoFocus
                                className="w-full text-xs bg-slate-900 border border-[#F0E545]/60 text-slate-200 rounded px-2 py-1 focus:outline-none">
                                <option value="">Select service…</option>
                                {canonicalServices.filter(s => !services.some(sv => sv.service_name === s)).map(s => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                                <option value="__custom__">Custom…</option>
                              </select>
                              {newServiceName === '__custom__' && (
                                <input type="text" placeholder="Service name" onChange={e => setNewServiceName(e.target.value)}
                                  className="w-full mt-1 text-xs bg-slate-900 border border-slate-600 text-slate-200 rounded px-2 py-1 focus:outline-none focus:border-[#F0E545]" />
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" min="1" value={newServiceQty} onChange={e => setNewServiceQty(e.target.value)} placeholder="Qty"
                                className="w-14 text-center text-xs bg-slate-900 border border-slate-600 text-slate-200 rounded px-1 py-1 focus:outline-none focus:border-[#F0E545]" />
                            </td>
                            <td colSpan={2} />
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-1">
                                <button onClick={handleAddService} disabled={!newServiceName || newServiceName === '__custom__'}
                                  className="p-1 rounded hover:bg-[#10b981]/20 text-[#10b981] disabled:opacity-30">
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setAddingService(false)} className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-700">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {!addingService && (
                      <button onClick={() => { setAddingService(true); setNewServiceName(''); setNewServiceQty(''); }}
                        className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs text-slate-600 hover:text-slate-400 hover:bg-slate-700/40 transition-colors border-t border-slate-700/40">
                        <Plus className="w-3 h-3" /> Add service row
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Market Discovery ─────────────────────────────────────────── */}
            {activeTab === 'discovery' && (
              <div>
                {/* Filters */}
                <div className="flex items-center gap-4 mb-5">
                  <select
                    value={filterSector}
                    onChange={e => setFilterSector(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-[#F0E545]"
                  >
                    <option value="">All Sectors</option>
                    {uniqueSectors.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">Min score:</span>
                    <input
                      type="range" min="0" max="80" step="10"
                      value={filterMinScore}
                      onChange={e => setFilterMinScore(parseInt(e.target.value))}
                      className="w-24 accent-[#F0E545]"
                    />
                    <span className="text-xs text-[#F0E545] font-bold w-4">{filterMinScore}</span>
                  </div>
                  <span className="ml-auto text-xs text-slate-500">{filteredCompat.length} companies</span>
                </div>

                {loadingCompat ? (
                  <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#F0E545] border-t-transparent rounded-full animate-spin" /></div>
                ) : filteredCompat.length === 0 ? (
                  <div className="text-center py-16 text-slate-500">
                    <p>No companies matched. Update the Partner DNA and recalculate.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredCompat.map(c => (
                      <div key={c.id} className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:border-slate-500 transition-colors">
                        {/* Badge */}
                        <div className="flex items-start justify-between mb-3">
                          <span className={`px-2.5 py-1 rounded text-xs font-bold ${TIER_STYLES[c.compatibility_label] ?? 'bg-slate-700 text-slate-400'}`}>
                            {Math.round(c.compatibility_score)}% · {c.compatibility_label}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {c.mrl_band_hit && (
                              <span className="px-1.5 py-0.5 bg-[#10b981]/10 text-[#10b981] text-[10px] rounded border border-[#10b981]/20" title="Readiness band match">
                                MRL ✓
                              </span>
                            )}
                            <span className={`text-xs font-semibold ${SOV_STYLES[c.sovereignty_tier]}`} title="Sovereignty tier">
                              <Shield className="w-3.5 h-3.5 inline" />
                            </span>
                          </div>
                        </div>

                        {/* Name + meta */}
                        <h3 className="text-white font-semibold text-sm mb-0.5 truncate">{c.name}</h3>
                        <p className="text-slate-400 text-xs mb-3">{c.sector ?? '—'} · {c.stage ?? '—'}{c.country ? ` · ${c.country}` : ''}</p>

                        {/* Score bars */}
                        <div className="space-y-1.5 mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 w-14">Compat</span>
                            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-[#F0E545]" style={{ width: `${c.compatibility_score}%` }} />
                            </div>
                            <span className="text-[10px] text-[#F0E545] w-5 text-right">{Math.round(c.compatibility_score)}</span>
                          </div>
                          {c.industrial_readiness_score != null && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-500 w-14">Readiness</span>
                              <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-[#10b981]" style={{ width: `${c.industrial_readiness_score * 10}%` }} />
                              </div>
                              <span className="text-[10px] text-[#10b981] w-5 text-right">{c.industrial_readiness_score}</span>
                            </div>
                          )}
                          {c.sovereignty_score != null && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-500 w-14">Sovereignty</span>
                              <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${SOV_BAR[c.sovereignty_tier]}`} style={{ width: `${c.sovereignty_score * 10}%` }} />
                              </div>
                              <span className={`text-[10px] w-5 text-right ${SOV_STYLES[c.sovereignty_tier]}`}>{c.sovereignty_score}</span>
                            </div>
                          )}
                        </div>

                        {/* Deployment + funding */}
                        <div className="flex items-center justify-between text-xs mb-2">
                          {c.deployment_signal && (
                            <span className={`flex items-center gap-1 ${c.deployment_signal === 'confirmed' ? 'text-[#10b981]' : c.deployment_signal === 'high' ? 'text-[#F0E545]' : 'text-slate-400'}`}>
                              <Zap className="w-3 h-3" /> {c.deployment_signal}
                            </span>
                          )}
                          <span className="text-slate-500">{fmt(c.total_funding)}</span>
                        </div>

                        {/* Certs */}
                        {c.verified_certs.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {c.verified_certs.slice(0, 3).map(cert => (
                              <span key={cert} className="px-1.5 py-0.5 bg-slate-800 text-slate-400 text-[10px] rounded">{cert}</span>
                            ))}
                          </div>
                        )}

                        {/* Protocol Bridge */}
                        {(dna.current_protocols.length > 0 || c.all_protocols.length > 0) && (
                          <ProtocolBridge
                            partnerProtos={dna.current_protocols}
                            companyProtos={c.all_protocols}
                            overlap={c.protocol_overlap}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Active Pilots ─────────────────────────────────────────────── */}
            {activeTab === 'pilots' && (
              <div>
                <div className="flex justify-end mb-4">
                  <button
                    onClick={() => setShowAddMatch(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F0E545] text-[#0f172a] text-xs font-bold rounded-lg hover:bg-[#F0E545]/90 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Match
                  </button>
                </div>
                {partner.matches.length === 0 ? (
                  <p className="text-slate-500 text-sm py-8 text-center">No active pilots yet.</p>
                ) : (
                  <div className="space-y-2 mb-8">
                    {partner.matches.map(m => {
                      const isExpanded = expandedMatchId === m.id;
                      const companyLogs = logs.filter(l => l.company_name === m.name);
                      return (
                        <div key={m.id} className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
                          {/* Row */}
                          <div
                            className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-slate-700/30"
                            onClick={() => { setExpandedMatchId(isExpanded ? null : m.id); setLogForm(f => ({ ...f, company_id: m.company_id })); }}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-white font-medium text-sm">{m.name}</span>
                                {m.sector && <span className="text-slate-400 text-xs">{m.sector}</span>}
                                {m.deployment_signal && (
                                  <span className={`flex items-center gap-0.5 text-[10px] ${m.deployment_signal === 'confirmed' ? 'text-[#10b981]' : 'text-[#F0E545]'}`}>
                                    <Zap className="w-2.5 h-2.5" />{m.deployment_signal}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-0.5">
                                {m.verified_certs.slice(0, 2).map(c => (
                                  <span key={c} className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{c}</span>
                                ))}
                                {m.country && <span className="text-[10px] text-slate-500">{m.country}</span>}
                                <span className={`text-[10px] font-semibold ${SOV_STYLES[m.sovereignty_tier]}`}>
                                  <Shield className="w-2.5 h-2.5 inline mr-0.5" />
                                  {m.sovereignty_score ?? '—'}
                                </span>
                              </div>
                            </div>
                            <select
                              value={matchStatuses[m.id] ?? m.status}
                              onChange={e => { e.stopPropagation(); handleStatusChange(m.id, e.target.value); }}
                              onClick={e => e.stopPropagation()}
                              className="bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-[#F0E545]"
                            >
                              {MATCH_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                            </select>
                            <span className="text-xs font-bold text-[#F0E545]">{m.match_score}</span>
                            <ChevronRight className={`w-4 h-4 text-slate-500 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          </div>

                          {/* Expanded: protocol bridge + logs */}
                          {isExpanded && (
                            <div className="border-t border-slate-700 px-4 py-4 bg-[#151411]/50">
                              <div className="grid grid-cols-2 gap-6 mb-4">
                                {/* Protocol bridge full */}
                                <div>
                                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Protocol Bridge</p>
                                  <div className="grid grid-cols-2 gap-3">
                                    <div>
                                      <p className="text-[10px] text-slate-600 mb-1">Partner Stack</p>
                                      {dna.current_protocols.length > 0 ? dna.current_protocols.map(p => {
                                        const matched = m.protocol_support.some(mp => mp.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(mp.toLowerCase()));
                                        return <div key={p} className={`text-[10px] px-1.5 py-0.5 rounded font-mono mb-1 ${matched ? 'bg-[#10b981]/20 text-[#10b981]' : 'bg-slate-800 text-slate-500'}`}>{matched ? '✓ ' : '  '}{p}</div>;
                                      }) : <p className="text-[10px] text-slate-600">Not set</p>}
                                    </div>
                                    <div>
                                      <p className="text-[10px] text-slate-600 mb-1">Startup Stack</p>
                                      {m.protocol_support.length > 0 ? m.protocol_support.map(p => {
                                        const matched = dna.current_protocols.some(pp => pp.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(pp.toLowerCase()));
                                        return <div key={p} className={`text-[10px] px-1.5 py-0.5 rounded font-mono mb-1 ${matched ? 'bg-[#10b981]/20 text-[#10b981]' : 'bg-slate-800 text-slate-500'}`}>{matched ? '✓ ' : '  '}{p}</div>;
                                      }) : <p className="text-[10px] text-slate-600">No data</p>}
                                    </div>
                                  </div>
                                </div>
                                {/* Match reason */}
                                <div>
                                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Match Rationale</p>
                                  <p className="text-xs text-slate-300">{m.match_reason}</p>
                                  {m.investors.length > 0 && (
                                    <div className="mt-3">
                                      <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Investors</p>
                                      <div className="flex flex-wrap gap-1">
                                        {m.investors.slice(0, 4).map(inv => (
                                          <span key={inv} className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{inv}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Advisory logs for this company */}
                              {companyLogs.length > 0 && (
                                <div className="mb-3">
                                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Advisory Log</p>
                                  <div className="space-y-2">
                                    {companyLogs.map(l => (
                                      <div key={l.id} className="bg-slate-800/60 rounded p-2.5">
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className="text-[10px] px-1.5 py-0.5 bg-[#F0E545]/10 text-[#F0E545] rounded capitalize">{l.log_type.replace('_', ' ')}</span>
                                          <span className="text-[10px] text-slate-500">{fmtDate(l.created_at)}</span>
                                        </div>
                                        <p className="text-xs text-slate-300">{l.body}</p>
                                        {l.outcome && <p className="text-xs text-slate-500 mt-1"><span className="text-slate-400">Outcome:</span> {l.outcome}</p>}
                                        {l.next_steps && <p className="text-xs text-slate-500 mt-1"><span className="text-[#F0E545]">→</span> {l.next_steps}</p>}
                                      </div>
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

                {/* Advisory Ledger */}
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
                  <p className="text-xs font-semibold text-[#F0E545] uppercase tracking-wider mb-4">Advisory Ledger — Add Entry</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1">Type</label>
                      <select value={logForm.log_type} onChange={e => setLogForm(f => ({ ...f, log_type: e.target.value }))} className="w-full bg-[#151411] border border-slate-700 text-slate-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-[#F0E545]">
                        {LOG_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1">Meeting Date</label>
                      <input type="date" value={logForm.meeting_date} onChange={e => setLogForm(f => ({ ...f, meeting_date: e.target.value }))} className="w-full bg-[#151411] border border-slate-700 text-slate-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-[#F0E545]" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1">Notes / Recommendation</label>
                    <textarea value={logForm.body} onChange={e => setLogForm(f => ({ ...f, body: e.target.value }))} rows={3} className="w-full bg-[#151411] border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-[#F0E545] resize-none" placeholder="Document the recommendation, outcome, or action item…" />
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1">Outcome</label>
                      <input type="text" value={logForm.outcome} onChange={e => setLogForm(f => ({ ...f, outcome: e.target.value }))} className="w-full bg-[#151411] border border-slate-700 text-slate-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-[#F0E545]" placeholder="e.g. Agreed to pilot Q3" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1">Next Steps</label>
                      <input type="text" value={logForm.next_steps} onChange={e => setLogForm(f => ({ ...f, next_steps: e.target.value }))} className="w-full bg-[#151411] border border-slate-700 text-slate-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-[#F0E545]" placeholder="e.g. Send NDA by Friday" />
                    </div>
                  </div>
                  <div className="flex justify-end mt-4">
                    <button onClick={submitLog} disabled={savingLog || !logForm.body.trim()} className="flex items-center gap-2 px-4 py-2 bg-[#F0E545] text-[#151411] text-sm font-bold rounded hover:bg-[#F0E545]/90 disabled:opacity-40">
                      <Plus className="w-4 h-4" />
                      {savingLog ? 'Saving…' : 'Log Entry'}
                    </button>
                  </div>
                </div>

                {/* All logs */}
                {logs.filter(l => !l.company_name).length > 0 && (
                  <div className="mt-4">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3">Partner-Level Log</p>
                    <div className="space-y-2">
                      {logs.filter(l => !l.company_name).map(l => (
                        <div key={l.id} className="bg-slate-800 border border-slate-700 rounded p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] px-1.5 py-0.5 bg-[#F0E545]/10 text-[#F0E545] rounded capitalize">{l.log_type.replace('_', ' ')}</span>
                            <span className="text-[10px] text-slate-500">{fmtDate(l.created_at)}</span>
                          </div>
                          <p className="text-xs text-slate-300">{l.body}</p>
                          {l.next_steps && <p className="text-xs text-slate-500 mt-1"><span className="text-[#F0E545]">→</span> {l.next_steps}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Intros ────────────────────────────────────────────────────── */}
            {activeTab === 'tracking' && (
              <IntrosTab
                intros={intros}
                partnerId={partnerId}
                onUpdate={updated => setIntros(prev => prev.map(i => i.id === updated.id ? updated : i))}
                onDelete={id => setIntros(prev => prev.filter(i => i.id !== id))}
                onAdd={created => setIntros(prev => [created, ...prev])}
              />
            )}

            {/* ── Problem Board ─────────────────────────────────────────────── */}
            {activeTab === 'problems' && (
              <ProblemBoard
                partnerId={partnerId}
                problems={problems}
                onUpdate={updated => setProblems(prev => prev.map(p => p.id === updated.id ? updated : p))}
                onCreate={card => setProblems(prev => [...prev, card])}
                onDelete={id => setProblems(prev => prev.filter(p => p.id !== id))}
              />
            )}

            {/* ── Stack View ────────────────────────────────────────────────── */}
            {activeTab === 'stack' && (
              <div>
                <StackView
                  partnerId={partnerId}
                  dna={dna}
                  techStack={techStack}
                  onDnaChange={(field, value) => { setDna(prev => ({ ...prev, [field]: value })); setDnaDirty(true); }}
                  onTechStackChange={(layerId, items) => setTechStack(prev => ({ ...prev, [layerId]: items }))}
                />

                {/* ── Partner DNA ──────────────────────────────────────────── */}
                <div className="mt-8 pt-6 border-t border-slate-800">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-semibold text-[#F0E545] uppercase tracking-wider">Partner DNA</p>
                    <div className="flex items-center gap-2">
                      {dnaDirty && (
                        <button
                          onClick={saveDNA}
                          disabled={savingDNA}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F0E545] text-[#151411] text-xs font-bold rounded hover:bg-[#F0E545]/90 disabled:opacity-50"
                        >
                          <Save className="w-3 h-3" />
                          {savingDNA ? 'Saving…' : 'Save'}
                        </button>
                      )}
                      {!dnaDirty && (
                        <button onClick={saveDNA} disabled={savingDNA} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-slate-400 text-xs rounded hover:bg-slate-700 transition-colors">
                          <Save className="w-3 h-3" /> Recalculate
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    {/* Left col */}
                    <div className="space-y-4">
                      {/* Legacy Protocols */}
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Legacy Protocols</p>
                        <div className="flex flex-col gap-1">
                          {KNOWN_PROTOCOLS.map(proto => (
                            <button
                              key={proto}
                              onClick={() => toggleProtocol(proto)}
                              className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono transition-colors ${
                                dna.current_protocols.includes(proto)
                                  ? 'bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/30'
                                  : 'bg-slate-800/50 text-slate-500 border border-transparent hover:border-slate-700'
                              }`}
                            >
                              {dna.current_protocols.includes(proto) ? '✓ ' : '  '}{proto}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Right col */}
                    <div className="space-y-4">
                      {/* Cloud Platform */}
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Cloud Platform</p>
                        <div className="flex flex-wrap gap-1">
                          {CLOUD_OPTIONS.map(opt => (
                            <button
                              key={opt}
                              onClick={() => updateDna('cloud_platform', dna.cloud_platform === opt ? '' : opt)}
                              className={`px-2 py-1 rounded text-xs transition-colors ${
                                dna.cloud_platform === opt
                                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                  : 'bg-slate-800 text-slate-500 border border-transparent hover:border-slate-700'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Hardware Vendors */}
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Hardware Vendors</p>
                        <TagInput
                          tags={dna.hardware_vendors}
                          onChange={v => updateDna('hardware_vendors', v)}
                          placeholder="Fanuc, Siemens…"
                        />
                      </div>

                      {/* Factory Regions */}
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Factory Regions</p>
                        <TagInput
                          tags={dna.factory_regions}
                          onChange={v => updateDna('factory_regions', v)}
                          placeholder="US-Midwest, Germany…"
                        />
                      </div>

                      {/* Adoption Speed */}
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Adoption Speed</p>
                        <div className="grid grid-cols-3 gap-1">
                          {(['fast', 'medium', 'slow'] as const).map(s => (
                            <button
                              key={s}
                              onClick={() => updateDna('scaling_speed', s)}
                              className={`py-1.5 rounded text-xs capitalize font-medium transition-colors ${
                                dna.scaling_speed === s
                                  ? 'bg-[#F0E545]/20 text-[#F0E545] border border-[#F0E545]/30'
                                  : 'bg-slate-800 text-slate-500 border border-transparent hover:border-slate-700'
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-slate-600 mt-1.5">
                          {dna.scaling_speed === 'fast' && 'Ideal MRL: 7–10 (deploy-ready)'}
                          {dna.scaling_speed === 'medium' && 'Ideal MRL: 5–8 (proven pilots)'}
                          {dna.scaling_speed === 'slow' && 'Ideal MRL: 3–6 (co-develop)'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Open Issues ──────────────────────────────────────────── */}
                {issues.length > 0 && (
                  <div className="mt-6 pt-5 border-t border-slate-800">
                    <p className="text-xs font-semibold text-red-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3" />
                      Open Issues ({issues.length})
                    </p>
                    <div className="space-y-2">
                      {issues.map(issue => {
                        const isOpen = expandedIssue === issue.id;
                        const comments = issueComments[issue.id] ?? [];
                        const sevColor = issue.severity === 'high' ? 'text-red-400 border-red-500/30 bg-red-500/10'
                          : issue.severity === 'medium' ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                          : 'text-slate-400 border-slate-600 bg-slate-800';
                        return (
                          <div key={issue.id} className="bg-slate-800/60 rounded-lg border border-slate-700/50 overflow-hidden">
                            <button
                              className="w-full text-left px-3 py-2 flex items-start gap-2"
                              onClick={() => {
                                if (!isOpen) loadIssueComments(issue.id);
                                setExpandedIssue(isOpen ? null : issue.id);
                              }}
                            >
                              <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wide flex-shrink-0 mt-0.5 ${sevColor}`}>
                                {issue.severity}
                              </span>
                              <span className="text-xs text-slate-200 leading-snug flex-1">{issue.title}</span>
                              <ChevronRight className={`w-3 h-3 text-slate-500 flex-shrink-0 mt-0.5 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                            </button>
                            {isOpen && (
                              <div className="px-3 pb-3 border-t border-slate-700/50">
                                {issue.body && <p className="text-[11px] text-slate-400 mt-2 mb-2 leading-relaxed">{issue.body}</p>}
                                {comments.length > 0 && (
                                  <div className="space-y-1.5 mb-2">
                                    {comments.map(c => (
                                      <div key={c.id} className="bg-slate-900/60 rounded px-2 py-1.5">
                                        <p className="text-[11px] text-slate-300 leading-relaxed">{c.body}</p>
                                        <p className="text-[9px] text-slate-600 mt-0.5">
                                          {c.created_by} · {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-1.5 mt-2">
                                  <input
                                    value={issueInput[issue.id] ?? ''}
                                    onChange={e => setIssueInput(prev => ({ ...prev, [issue.id]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') submitIssueComment(issue); }}
                                    placeholder="Reply to admin…"
                                    className="flex-1 bg-slate-900 border border-slate-700 text-slate-200 text-[11px] rounded px-2 py-1 focus:outline-none focus:border-[#F0E545] placeholder-slate-600"
                                  />
                                  <button
                                    onClick={() => submitIssueComment(issue)}
                                    disabled={!(issueInput[issue.id] ?? '').trim() || submittingComment === issue.id}
                                    className="px-2 py-1 bg-[#F0E545] text-[#151411] text-[11px] font-bold rounded disabled:opacity-40 hover:bg-[#F0E545]/90"
                                  >
                                    {submittingComment === issue.id ? '…' : 'Send'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Risk Assessment ───────────────────────────────────────────── */}
            {activeTab === 'risk' && (
              <div>
                {watchlistCompanies.length === 0 ? (
                  <p className="text-slate-500 text-sm py-8 text-center">No companies in watchlist. Add matches to track sovereignty risk.</p>
                ) : (
                  <>
                    {/* Summary chips */}
                    <div className="flex gap-4 mb-6">
                      {(['green', 'yellow', 'red', 'unknown'] as const).map(tier => {
                        const count = watchlistCompanies.filter(m => m.sovereignty_tier === tier).length;
                        if (!count) return null;
                        const labels = { green: 'Low Risk', yellow: 'Moderate', red: 'High Risk', unknown: 'Unscored' };
                        return (
                          <div key={tier} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${tier === 'green' ? 'bg-[#10b981]/10 border-[#10b981]/30' : tier === 'yellow' ? 'bg-[#F0E545]/10 border-[#F0E545]/30' : tier === 'red' ? 'bg-red-500/10 border-red-500/30' : 'bg-slate-800 border-slate-700'}`}>
                            <span className={`text-lg font-bold ${SOV_STYLES[tier]}`}>{count}</span>
                            <span className={`text-xs ${SOV_STYLES[tier]}`}>{labels[tier]}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* By country */}
                    {Object.entries(byCountry).sort(([, a], [, b]) => {
                      const riskOrder = (ms: MatchItem[]) => ms.filter(m => m.sovereignty_tier === 'red').length * 10 + ms.filter(m => m.sovereignty_tier === 'yellow').length;
                      return riskOrder(b) - riskOrder(a);
                    }).map(([country, companies]) => (
                      <div key={country} className="bg-slate-800 border border-slate-700 rounded-lg mb-4 overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                          <span className="text-white font-semibold text-sm">{country}</span>
                          <div className="flex items-center gap-2">
                            {(['red', 'yellow', 'green'] as const).map(tier => {
                              const n = companies.filter(c => c.sovereignty_tier === tier).length;
                              return n > 0 ? <span key={tier} className={`text-xs font-bold ${SOV_STYLES[tier]}`}>{n} {tier}</span> : null;
                            })}
                          </div>
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-700/50">
                              <th className="text-left px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wide font-medium">Company</th>
                              <th className="text-left px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wide font-medium">Sector</th>
                              <th className="text-left px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wide font-medium">Sovereignty</th>
                              <th className="text-left px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wide font-medium">Investors</th>
                              <th className="text-left px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wide font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-700/30">
                            {companies.map(m => (
                              <tr key={m.id} className="hover:bg-slate-700/20">
                                <td className="px-4 py-2.5 text-white text-xs font-medium">{m.name}</td>
                                <td className="px-4 py-2.5 text-slate-400 text-xs">{m.sector ?? '—'}</td>
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center gap-2">
                                    <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full ${SOV_BAR[m.sovereignty_tier]}`} style={{ width: `${(m.sovereignty_score ?? 0) * 10}%` }} />
                                    </div>
                                    <span className={`text-xs font-bold ${SOV_STYLES[m.sovereignty_tier]}`}>
                                      {m.sovereignty_score ?? '—'}
                                    </span>
                                    {m.sovereignty_tier === 'red' && <AlertTriangle className="w-3 h-3 text-red-400" />}
                                  </div>
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex flex-wrap gap-1">
                                    {m.investors.slice(0, 2).map(inv => (
                                      <span key={inv} className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{inv}</span>
                                    ))}
                                    {m.investors.length > 2 && <span className="text-[10px] text-slate-500">+{m.investors.length - 2}</span>}
                                  </div>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="text-[10px] text-slate-400">{matchStatuses[m.id]?.replace('_', ' ') ?? m.status}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* ── Notes ────────────────────────────────────────────────────────── */}
            {activeTab === 'notes' && (
              <div className="max-w-2xl">
                {/* Compose */}
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-6">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">New Note</span>
                    <div className="flex gap-1 ml-auto">
                      {(['call', 'meeting', 'email', 'internal', 'general'] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => setNoteType(t)}
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold capitalize transition-colors ${
                            noteType === t
                              ? 'bg-[#F0E545] text-[#151411]'
                              : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                        >{t}</button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    value={noteBody}
                    onChange={e => setNoteBody(e.target.value)}
                    placeholder="Log a call, meeting, or internal note..."
                    rows={4}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-[#F0E545]/50 resize-none"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={async () => {
                        if (!noteBody.trim()) return;
                        setSavingNote(true);
                        try {
                          await api.addServiceNote(partnerId, noteBody.trim(), noteType);
                          setNoteBody('');
                          setNoteType('general');
                          await loadServiceNotes();
                        } finally { setSavingNote(false); }
                      }}
                      disabled={savingNote || !noteBody.trim()}
                      className="px-4 py-1.5 bg-[#F0E545] text-[#151411] text-sm font-semibold rounded hover:bg-[#F0E545]/90 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {savingNote ? 'Saving...' : 'Save Note'}
                    </button>
                  </div>
                </div>

                {/* Note log — collapsed accordion */}
                {serviceNotes.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-8">No notes yet. Log a call or meeting above.</p>
                ) : (
                  <div className="space-y-1">
                    {serviceNotes.map(n => {
                      const typeColors: Record<string, string> = {
                        call:     'text-emerald-400',
                        meeting:  'text-blue-400',
                        email:    'text-violet-400',
                        internal: 'text-amber-400',
                        general:  'text-slate-400',
                      };
                      const preview = n.body.replace(/\n/g, ' ').slice(0, 80) + (n.body.length > 80 ? '…' : '');
                      return (
                        <NoteAccordion
                          key={n.id}
                          note={n}
                          preview={preview}
                          typeColor={typeColors[n.note_type] ?? typeColors.general}
                          onDelete={async () => {
                            await api.deleteServiceNote(partnerId, n.id);
                            await loadServiceNotes();
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}

          </div>
        </main>
      </div>
      {showFeedback && (
        <FeedbackModal currentPath={`/partners/${partnerId}`} onClose={() => setShowFeedback(false)} />
      )}
      <QuickNotePanel darkPage defaultContext="psm" />

      {/* ── Add Match Modal ──────────────────────────────────────────────────── */}
      {showAddMatch && partner && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1e293b] border border-slate-700 rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-sm font-bold text-white">Add Match — {partner.name}</h2>
              <button onClick={() => { setShowAddMatch(false); setSelectedCompany(null); setMatchQuery(''); setMatchReason(''); setMatchScore('75'); }} className="text-slate-500 hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Company *</label>
                {selectedCompany ? (
                  <div className="flex items-center justify-between px-3 py-2 border border-[#F0E545]/40 rounded-lg bg-[#F0E545]/5 text-sm">
                    <span className="font-medium text-white">{selectedCompany.name}</span>
                    <button onClick={() => { setSelectedCompany(null); setMatchQuery(''); }} className="text-slate-500 hover:text-red-400"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text" placeholder="Search companies..." value={matchQuery}
                      onChange={e => setMatchQuery(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg focus:outline-none focus:border-[#F0E545] placeholder-slate-600"
                    />
                    {matchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-[#1e293b] border border-slate-700 rounded-lg shadow-2xl z-10 max-h-48 overflow-y-auto">
                        {matchResults.map(c => (
                          <button key={c.id} onClick={() => { setSelectedCompany(c); setMatchQuery(c.name); setMatchResults([]); }}
                            className="w-full text-left px-3 py-2 hover:bg-slate-700 text-sm">
                            <span className="font-medium text-white">{c.name}</span>
                            {c.sector && <span className="ml-2 text-xs text-slate-500">{c.sector}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                  Match Score: <span className="text-[#F0E545]">{matchScore}</span>
                </label>
                <input type="range" min="0" max="100" value={matchScore} onChange={e => setMatchScore(e.target.value)} className="w-full accent-[#F0E545]" />
                <div className="flex justify-between text-[10px] text-slate-600 mt-1"><span>0</span><span>50</span><span>100</span></div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Match Reason *</label>
                <textarea
                  placeholder="Why is this a good fit?" value={matchReason}
                  onChange={e => setMatchReason(e.target.value)} rows={3}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg focus:outline-none focus:border-[#F0E545] resize-none placeholder-slate-600"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-700">
              <button onClick={() => { setShowAddMatch(false); setSelectedCompany(null); setMatchQuery(''); setMatchReason(''); setMatchScore('75'); }}
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-300">Cancel</button>
              <button onClick={handleAddMatch} disabled={savingMatch || !selectedCompany || !matchReason.trim()}
                className="px-4 py-2 bg-[#F0E545] text-[#0f172a] text-sm font-bold rounded-lg hover:bg-[#F0E545]/90 disabled:opacity-50 disabled:cursor-not-allowed">
                {savingMatch ? 'Adding…' : 'Add Match'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
