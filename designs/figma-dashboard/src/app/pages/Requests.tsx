import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Inbox as InboxIcon, Plus, X, ChevronDown, ChevronUp, UserPlus, CheckCircle2,
  Clock, Zap, AlertTriangle, Send, ExternalLink, FileText, Globe, LayoutDashboard, Trash2, Upload,
  GripVertical, Circle, Lightbulb, ChevronRight, Edit2, Check,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
  AreaChart, Area, ComposedChart, Line,
} from 'recharts';
import { cls } from '../components/tokens';
import { CVCNavbar } from '../components/CVCNavbar';
import { AUTH_HEADER as AUTH, api } from '../api/client';
import { useTeamMembers } from '../hooks/useTeamMembers';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Skirmish {
  id: number;
  title: string;
  service_type: string;
  partner_id: number | null;
  partner_name: string | null;
  status: string;
  priority: string;
  service_fields: Record<string, string>;
  venture_assignment_id: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  assignees: string[];
  outputs: SkirmishOutput[];
  last_update: string | null;
  update_count: number;
}

interface SkirmishOutput {
  label:       string;
  type:        'pdf' | 'page' | 'url' | 'collection';
  url:         string;
  description?: string;
}

interface SkirmishDetail extends Skirmish {
  updates: { id: number; author: string; body: string; created_at: string }[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  dealflow:       'Dealflow Session',
  intro:          'Ad Hoc Intro',
  trend_report:   'Trend Report',
  innovation_day: 'Innovation Day',
  collection:     'Collection',
  assignment:     'Assignment',
  other:          'Other',
};

const SERVICE_COLORS: Record<string, string> = {
  dealflow:       '#F0E545',
  intro:          '#10b981',
  trend_report:   '#6366F1',
  innovation_day: '#EC4899',
  collection:     '#06B6D4',
  assignment:     '#F59E0B',
  other:          '#94a3b8',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  open:      { label: 'Open',      color: '#64748b', bg: 'bg-slate-100' },
  active:    { label: 'Active',    color: '#d97706', bg: 'bg-amber-50' },
  completed: { label: 'Completed', color: '#059669', bg: 'bg-emerald-50' },
  cancelled: { label: 'Cancelled', color: '#dc2626', bg: 'bg-red-50' },
};

const PRIORITY_COLORS: Record<string, string> = {
  high:   'text-red-600',
  medium: 'text-amber-600',
  low:    'text-slate-400',
};


function fmtTs(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 3600000;
  if (diffH < 1) return `${Math.round(diffMs / 60000)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  if (diffH < 168) return `${Math.round(diffH / 24)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtFields(fields: Record<string, string>, serviceType: string): { label: string; value: string }[] {
  const FIELD_LABELS: Record<string, string> = {
    contact_name:  'Partner Contact',
    session_date:  'Date',
    format:        'Format',
    sectors:       'Sectors',
    specific_ask:  'Ask',
    startup_name:  'Startup',
    context:       'Context',
    urgency:       'Urgency',
    sector:        'Sector',
    questions:     'Key Questions',
    deadline:      'Deadline',
    proposed_date: 'Proposed Date',
    theme:         'Theme',
    headcount:     'Expected Attendees',
    agenda_notes:  'Agenda Notes',
    description:      'Description',
    priority:         'Priority',
    service_name:     'Service',
    contact_email:    'Contact Email',
    stage_preference: 'Startup Stage',
    count_preference: 'Company Count',
    problem:          'Problem / Use Case',
    topic:            'Topic',
    criteria:         'Criteria',
  };
  return Object.entries(fields)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => ({ label: FIELD_LABELS[k] ?? k, value: String(v) }));
}

// ── Request Tasks ─────────────────────────────────────────────────────────────

interface RequestTask {
  id:          number;
  request_id:  number;
  title:       string;
  assigned_to: string | null;
  done:        boolean;
  position:    number;
  created_by:  string | null;
  created_at:  string;
}

function TasksSection({ requestId, ventureAssignmentId }: { requestId: number; ventureAssignmentId?: number | null }) {
  const TEAM_MEMBERS = useTeamMembers();
  const [tasks, setTasks]       = useState<RequestTask[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [adding, setAdding]     = useState(false);
  const [saving, setSaving]     = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // Drag state — stored in refs to avoid re-render churn during drag
  const dragIdx   = useRef<number | null>(null);
  const dragOver  = useRef<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/requests/${requestId}/tasks`, { headers: AUTH });
    if (res.ok) setTasks(await res.json());
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/requests/${requestId}/tasks`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), assigned_to: newAssignee || null }),
      });
      if (res.ok) {
        const t = await res.json();
        setTasks(ts => [...ts, t]);
        setNewTitle(''); setNewAssignee(''); setAdding(false);
      }
    } finally { setSaving(false); }
  }

  async function toggleDone(task: RequestTask) {
    const res = await fetch(`/requests/${requestId}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !task.done }),
    });
    if (res.ok) {
      const updated = tasks.map(t => t.id === task.id ? { ...t, done: !t.done } : t);
      setTasks(updated);
      // If all tasks are now done and there's a linked assignment, mark it completed
      if (!task.done && ventureAssignmentId && updated.every(t => t.done)) {
        fetch(`/ventures/assignments/${ventureAssignmentId}`, {
          method: 'PATCH',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        });
      }
    }
  }

  async function assignTask(task: RequestTask, username: string) {
    const res = await fetch(`/requests/${requestId}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_to: username || null }),
    });
    if (res.ok) setTasks(ts => ts.map(t => t.id === task.id ? { ...t, assigned_to: username || null } : t));
  }

  async function saveTitle(task: RequestTask) {
    if (!editTitle.trim() || editTitle === task.title) { setEditingId(null); return; }
    const res = await fetch(`/requests/${requestId}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editTitle.trim() }),
    });
    if (res.ok) {
      setTasks(ts => ts.map(t => t.id === task.id ? { ...t, title: editTitle.trim() } : t));
      setEditingId(null);
    }
  }

  async function deleteTask(id: number) {
    await fetch(`/requests/${requestId}/tasks/${id}`, { method: 'DELETE', headers: AUTH });
    setTasks(ts => ts.filter(t => t.id !== id));
  }

  async function commitReorder(reordered: RequestTask[]) {
    await fetch(`/requests/${requestId}/tasks/reorder`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: reordered.map(t => t.id) }),
    });
  }

  // ── Drag handlers ──────────────────────────────────────────────────────────
  function onDragStart(idx: number) { dragIdx.current = idx; }

  function onDragEnter(idx: number) {
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const reordered = [...tasks];
    const [moved] = reordered.splice(dragIdx.current, 1);
    reordered.splice(idx, 0, moved);
    dragIdx.current = idx;
    dragOver.current = idx;
    setTasks(reordered);
  }

  function onDragEnd() {
    commitReorder(tasks);
    dragIdx.current = null;
    dragOver.current = null;
  }

  const doneCount = tasks.filter(t => t.done).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] text-slate-500 uppercase tracking-widest">
          Tasks {tasks.length > 0 && `· ${doneCount}/${tasks.length} done`}
        </p>
        <button
          onClick={() => setAdding(a => !a)}
          className="text-[10px] text-slate-400 hover:text-[#1E293B] flex items-center gap-1 transition-colors"
        >
          <Plus className="w-3 h-3" />Add
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <form onSubmit={addTask} className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2 space-y-2">
          <input
            autoFocus
            type="text"
            placeholder="Task description…"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            className="w-full bg-white border border-slate-200 text-slate-700 text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-slate-400 placeholder-slate-400"
          />
          <div className="flex gap-1.5">
            <select
              value={newAssignee}
              onChange={e => setNewAssignee(e.target.value)}
              className={cls.select + ' flex-1 text-xs py-1.5'}
            >
              <option value="">Assign to…</option>
              {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded transition-colors"
            >Cancel</button>
            <button
              type="submit"
              disabled={saving || !newTitle.trim()}
              className="px-3 py-1.5 text-xs font-semibold bg-[#1E293B] hover:bg-slate-700 text-white rounded disabled:opacity-40 transition-colors"
            >Add</button>
          </div>
        </form>
      )}

      {/* Task list */}
      {tasks.length === 0 && !adding && (
        <p className="text-xs text-slate-600 italic">No tasks yet — add one to assign responsibilities.</p>
      )}

      <div className="space-y-1">
        {tasks.map((task, idx) => (
          <div
            key={task.id}
            draggable
            onDragStart={() => onDragStart(idx)}
            onDragEnter={() => onDragEnter(idx)}
            onDragEnd={onDragEnd}
            onDragOver={e => e.preventDefault()}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-colors group ${
              task.done
                ? 'bg-slate-50 border-slate-100 opacity-60'
                : 'bg-white border-slate-200 hover:border-slate-400 shadow-sm'
            }`}
          >
            {/* Drag handle */}
            <GripVertical className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 cursor-grab flex-shrink-0" />

            {/* Done toggle */}
            <button
              onClick={() => toggleDone(task)}
              className="flex-shrink-0 transition-colors"
              title={task.done ? 'Mark undone' : 'Mark done'}
            >
              {task.done
                ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                : <Circle className="w-4 h-4 text-slate-300 hover:text-slate-500" />
              }
            </button>

            {/* Title */}
            {editingId === task.id ? (
              <input
                autoFocus
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onBlur={() => saveTitle(task)}
                onKeyDown={e => { if (e.key === 'Enter') saveTitle(task); if (e.key === 'Escape') setEditingId(null); }}
                className="flex-1 bg-white border border-slate-200 text-slate-700 text-xs rounded px-2 py-0.5 focus:outline-none focus:border-slate-400"
              />
            ) : (
              <span
                onDoubleClick={() => { setEditingId(task.id); setEditTitle(task.title); }}
                className={`flex-1 text-xs cursor-pointer ${task.done ? 'line-through text-slate-400' : 'text-slate-700'}`}
                title="Double-click to edit"
              >
                {task.title}
              </span>
            )}

            {/* Assignee selector */}
            <select
              value={task.assigned_to ?? ''}
              onChange={e => assignTask(task, e.target.value)}
              className="text-[10px] bg-transparent border-0 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer max-w-[72px] truncate"
            >
              <option value="">unassigned</option>
              {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>

            {/* Delete */}
            <button
              onClick={() => deleteTask(task.id)}
              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 flex-shrink-0 transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function SkirmishDetail({ skirmish, onClose, onUpdated }: {
  skirmish: Skirmish;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const TEAM_MEMBERS = useTeamMembers();
  const [detail, setDetail]         = useState<SkirmishDetail | null>(null);
  const [updateText, setUpdateText] = useState('');
  const [posting, setPosting]       = useState(false);
  const [newAssignee, setNewAssignee] = useState('');
  const [addingAssignee, setAddingAssignee] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const currentUser = api.getCurrentUser();

  const load = useCallback(async () => {
    const res = await fetch(`/requests/${skirmish.id}`, { headers: AUTH });
    if (res.ok) {
      const data = await res.json();
      // Detail endpoint returns assignee objects {username,assigned_by,assigned_at} — normalize to strings
      if (Array.isArray(data.assignees)) {
        data.assignees = data.assignees.map((a: string | { username: string }) =>
          typeof a === 'string' ? a : a.username
        );
      }
      setDetail(data);
      setRefreshKey(k => k + 1);
    }
  }, [skirmish.id]);

  useEffect(() => { load(); }, [load]);

  async function postUpdate() {
    if (!updateText.trim()) return;
    setPosting(true);
    try {
      await fetch(`/requests/${skirmish.id}/updates`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: updateText.trim() }),
      });
      setUpdateText('');
      await load();
      onUpdated();
    } finally { setPosting(false); }
  }

  async function addAssignee() {
    if (!newAssignee.trim()) return;
    setAddingAssignee(true);
    try {
      await fetch(`/requests/${skirmish.id}/assignees`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newAssignee.trim() }),
      });
      setNewAssignee('');
      await load();
      onUpdated();
    } finally { setAddingAssignee(false); }
  }

  async function removeAssignee(username: string) {
    await fetch(`/requests/${skirmish.id}/assignees/${username}`, {
      method: 'DELETE', headers: AUTH,
    });
    await load();
    onUpdated();
  }

  async function changeStatus(status: string) {
    setStatusChanging(true);
    try {
      await fetch(`/requests/${skirmish.id}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      // Sync linked assignment to completed when request is completed
      if (status === 'completed' && skirmish.venture_assignment_id) {
        await fetch(`/ventures/assignments/${skirmish.venture_assignment_id}`, {
          method: 'PATCH',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        });
      }
      await load();
      onUpdated();
    } finally { setStatusChanging(false); }
  }

  const sc = STATUS_CONFIG[detail?.status ?? skirmish.status] ?? STATUS_CONFIG.open;
  const svcColor = SERVICE_COLORS[skirmish.service_type] ?? '#94a3b8';
  const fields = fmtFields(skirmish.service_fields, skirmish.service_type);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-[480px] bg-white border-l border-slate-200 flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-200 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: svcColor }}>
                {SERVICE_LABELS[skirmish.service_type] ?? skirmish.service_type}
              </span>
              {skirmish.partner_name && (
                <span className="text-[10px] text-slate-400">· {skirmish.partner_name}</span>
              )}
            </div>
            <h2 className="text-base font-bold text-[#1E293B] leading-snug">{skirmish.title}</h2>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sc.bg}`} style={{ color: sc.color }}>
                {sc.label}
              </span>
              <span className={`text-[10px] font-semibold uppercase ${PRIORITY_COLORS[skirmish.priority]}`}>
                {skirmish.priority}
              </span>
              <span className="text-[10px] text-slate-400">by {skirmish.created_by} · {fmtTs(skirmish.created_at)}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-linen text-slate-400 hover:text-[#1E293B] transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Status controls */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Status</p>
            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(STATUS_CONFIG).filter(([k]) => k !== 'cancelled').map(([s, cfg]) => (
                <button
                  key={s}
                  onClick={() => changeStatus(s)}
                  disabled={statusChanging || detail?.status === s}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                    detail?.status === s
                      ? `${cfg.bg} border-transparent font-semibold`
                      : 'border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-600'
                  }`}
                  style={detail?.status === s ? { color: cfg.color } : {}}
                >
                  {cfg.label}
                </button>
              ))}
              {detail?.status !== 'cancelled' && (
                <button
                  onClick={() => changeStatus('cancelled')}
                  disabled={statusChanging}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 text-slate-400 hover:border-red-300 hover:text-red-500 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Evaluation by Sector — team completion + form link */}
          {skirmish.service_type === 'assignment' && /evaluation by sector/i.test(skirmish.title) && (
            <EvalCompletionPanel
              requestId={skirmish.id}
              onOutputPosted={onUpdated}
              sector={skirmish.service_fields.sector}
              subsector={skirmish.service_fields.subsector}
              assignees={detail?.assignees ?? []}
              refreshKey={refreshKey}
            />
          )}

          {/* Service request fields */}
          {fields.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Request Details</p>
              <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                {fields.map(f => (
                  <div key={f.label} className="flex gap-3">
                    <span className="text-[10px] text-slate-400 w-28 flex-shrink-0 pt-0.5">{f.label}</span>
                    <span className="text-xs text-slate-700 flex-1">{f.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tasks */}
          <TasksSection requestId={skirmish.id} ventureAssignmentId={skirmish.venture_assignment_id} />

          {/* Assignees */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Team</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(detail?.assignees ?? []).map(a => (
                <span key={a} className="flex items-center gap-1 text-xs bg-slate-100 border border-slate-200 text-slate-600 rounded-full px-2.5 py-0.5">
                  {a}
                  <button onClick={() => removeAssignee(a)} className="text-slate-400 hover:text-red-500 ml-0.5">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              {(detail?.assignees ?? []).length === 0 && (
                <span className="text-xs text-slate-600">No one assigned yet</span>
              )}
            </div>
            <div className="flex gap-1.5">
              <select
                value={newAssignee}
                onChange={e => setNewAssignee(e.target.value)}
                className={cls.select + ' flex-1 text-xs py-1.5'}
              >
                <option value="">Add team member…</option>
                {TEAM_MEMBERS.filter(m => !(detail?.assignees ?? []).includes(m)).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <button
                onClick={addAssignee}
                disabled={!newAssignee || addingAssignee}
                className="px-3 py-1.5 bg-[#1E293B] hover:bg-slate-700 text-white text-xs rounded border border-slate-300 disabled:opacity-40 transition-colors"
              >
                <UserPlus className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Updates feed */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">
              Updates {detail?.updates.length ? `(${detail.updates.length})` : ''}
            </p>

            {/* Post update */}
            <div className="mb-3 flex gap-1.5">
              <textarea
                value={updateText}
                onChange={e => setUpdateText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postUpdate(); }}
                placeholder="Share an update, new info, or next step…"
                rows={2}
                className="flex-1 bg-white border border-slate-200 text-slate-700 text-xs rounded px-3 py-2 focus:outline-none focus:border-slate-400 resize-none placeholder-slate-400"
              />
              <button
                onClick={postUpdate}
                disabled={!updateText.trim() || posting}
                className="px-2.5 py-1.5 bg-[#1E293B] hover:bg-slate-700 text-white rounded border border-slate-300 disabled:opacity-40 transition-colors self-start"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Update list */}
            <div className="space-y-2">
              {(detail?.updates ?? []).map(u => (
                <div key={u.id} className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold text-[#1E293B]">{u.author}</span>
                    <span className="text-[10px] text-slate-400">{fmtTs(u.created_at)}</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{u.body}</p>
                </div>
              ))}
              {(!detail?.updates || detail.updates.length === 0) && (
                <p className="text-xs text-slate-400 italic">No updates yet — be the first to post.</p>
              )}
            </div>
          </div>

          {/* Venture assignment link */}
          {skirmish.venture_assignment_id && (
            <div>
              <Link
                to="/ventures"
                className="text-[10px] text-slate-400 hover:text-[#1E293B] flex items-center gap-1 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                View assignment #{skirmish.venture_assignment_id} on Ventures
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Output Card ───────────────────────────────────────────────────────────────

const OUTPUT_TYPE_ICON: Record<string, React.ReactNode> = {
  pdf:        <FileText        className="w-3.5 h-3.5 text-orange-400" />,
  page:       <LayoutDashboard className="w-3.5 h-3.5 text-sky-400" />,
  url:        <Globe           className="w-3.5 h-3.5 text-slate-400" />,
  collection: <Globe           className="w-3.5 h-3.5 text-cyan-400" />,
};

function OutputCard({ skirmish, onUpdated }: { skirmish: Skirmish; onUpdated: () => void }) {
  const [adding, setAdding]     = useState(false);
  const [label, setLabel]       = useState('');
  const [url, setUrl]           = useState('');
  const [type, setType]         = useState<'pdf' | 'page' | 'url' | 'collection'>('page');
  const [desc, setDesc]         = useState('');
  const [saving, setSaving]     = useState(false);
  const [uploading, setUploading] = useState(false);
  const [useUpload, setUseUpload] = useState(false);

  const outputs = skirmish.outputs ?? [];

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/requests/documents/upload', { method: 'POST', headers: AUTH, body: fd });
      if (!res.ok) throw new Error(await res.text());
      const doc = await res.json();
      setUrl(doc.url);
      setType('pdf');
      if (!label.trim()) setLabel(file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !url.trim()) return;
    setSaving(true);
    try {
      await fetch(`/requests/${skirmish.id}/outputs`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), type, url: url.trim(), description: desc.trim() || undefined }),
      });
      setLabel(''); setUrl(''); setDesc(''); setAdding(false); setUseUpload(false);
      onUpdated();
    } finally { setSaving(false); }
  }

  async function remove(idx: number) {
    await fetch(`/requests/${skirmish.id}/outputs/${idx}`, { method: 'DELETE', headers: AUTH });
    onUpdated();
  }

  return (
    <div
      className="bg-white rounded border border-slate-200 p-3 flex flex-col gap-2 shadow-cvc min-h-[80px]"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Output</span>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-slate-700 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        )}
      </div>

      {outputs.length === 0 && !adding && (
        <p className="text-[10px] text-slate-300 italic">No deliverables yet</p>
      )}

      {outputs.map((o, idx) => (
        <div key={idx} className="flex items-start gap-2 group">
          <div className="mt-0.5 flex-shrink-0">{OUTPUT_TYPE_ICON[o.type] ?? OUTPUT_TYPE_ICON.url}</div>
          <div className="flex-1 min-w-0">
            {o.type === 'page' ? (
              <Link to={o.url} className="text-xs font-semibold text-sky-600 hover:underline leading-tight block truncate">
                {o.label}
              </Link>
            ) : o.type === 'pdf' ? (
              <a href={o.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-orange-600 hover:underline leading-tight block truncate">
                {o.label}
              </a>
            ) : (
              <a href={o.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-slate-600 hover:underline leading-tight block truncate flex items-center gap-1">
                {o.label} <ExternalLink className="w-2.5 h-2.5 inline flex-shrink-0" />
              </a>
            )}
            {o.description && (
              <p className="text-[10px] text-slate-400 leading-snug mt-0.5 line-clamp-2">{o.description}</p>
            )}
          </div>
          <button
            onClick={() => remove(idx)}
            className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all flex-shrink-0"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}

      {adding && (
        <form onSubmit={submit} className="flex flex-col gap-1.5 border-t border-slate-100 pt-2 mt-1">
          <input
            autoFocus
            placeholder="Label (e.g. Brambles DD Platform)"
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400 bg-white"
          />

          {/* URL or file upload — toggle when type is pdf */}
          {type === 'pdf' && useUpload ? (
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-500 border border-dashed border-slate-300 rounded px-2 py-1.5 hover:border-slate-400">
              <Upload className="w-3.5 h-3.5" />
              {uploading ? 'Uploading…' : url ? url.split('/').pop() : 'Choose PDF or DOCX'}
              <input type="file" accept=".pdf,.docx" className="hidden" onChange={handleFileUpload} disabled={uploading} />
            </label>
          ) : (
            <input
              placeholder="URL or path"
              value={url}
              onChange={e => setUrl(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400 bg-white"
            />
          )}
          {type === 'pdf' && (
            <button
              type="button"
              onClick={() => { setUseUpload(!useUpload); setUrl(''); }}
              className="text-[10px] text-sky-500 hover:underline self-start"
            >
              {useUpload ? 'enter URL instead' : 'upload file instead'}
            </button>
          )}

          <input
            placeholder="Description (optional)"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400 bg-white"
          />
          <div className="flex items-center gap-1.5">
            <select
              value={type}
              onChange={e => { setType(e.target.value as 'pdf' | 'page' | 'url' | 'collection'); setUseUpload(false); setUrl(''); }}
              className="text-xs border border-slate-200 rounded px-1.5 py-1 focus:outline-none bg-white flex-1"
            >
              <option value="page">Platform page</option>
              <option value="collection">Collection</option>
              <option value="pdf">PDF file</option>
              <option value="url">External URL</option>
            </select>
            <button type="submit" disabled={saving || !label.trim() || !url.trim()}
              className="px-2 py-1 bg-slate-800 text-white text-[10px] rounded disabled:opacity-40 hover:bg-slate-700 transition-colors">
              Save
            </button>
            <button type="button" onClick={() => { setAdding(false); setLabel(''); setUrl(''); setDesc(''); setUseUpload(false); }}
              className="px-2 py-1 text-[10px] text-slate-400 hover:text-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}


// ── Sector Evaluation Completion (for Evaluation by Sector assignment) ────────

interface EvalCompletion {
  evaluator: string;
  completed: number;
  total: number;
  pct: number;
}

/** Compact per-user % pills shown on the list card */
function EvalCompletionMini({ sector, subsector }: { sector?: string; subsector?: string }) {
  const [data, setData] = useState<EvalCompletion[]>([]);

  useEffect(() => {
    const params = sector && subsector !== undefined
      ? `?sector=${encodeURIComponent(sector)}&subsector=${encodeURIComponent(subsector)}`
      : '';
    fetch(`/ventures/sector-eval/team-completion${params}`, { headers: AUTH })
      .then(r => r.ok ? r.json() : [])
      .then(d => setData(Array.isArray(d) ? d : []));
  }, [sector, subsector]);

  if (!data.length) return null;

  return (
    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
      {data.map(c => (
        <span key={c.evaluator}
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
            c.pct === 100
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : c.pct > 0
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-slate-100 text-slate-400 border-slate-200'
          }`}
          title={`${c.completed}/${c.total} sector × stage combos`}
        >
          {c.evaluator} {c.pct}%
        </span>
      ))}
    </div>
  );
}

/** Full completion panel shown in the detail drawer */
function EvalCompletionPanel({ requestId, onOutputPosted, sector, subsector, assignees, refreshKey }: {
  requestId: number;
  onOutputPosted: () => void;
  sector?: string;
  subsector?: string;
  assignees: string[];
  refreshKey: number;
}) {
  const me = api.getCurrentUser();
  const [data, setData]       = useState<EvalCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  const isSubsector = !!(sector && subsector);
  const formUrl = isSubsector
    ? `/ventures/evaluation?sector=${encodeURIComponent(sector!)}&subsector=${encodeURIComponent(subsector!)}`
    : '/ventures/evaluation';

  useEffect(() => {
    const params = isSubsector
      ? `?sector=${encodeURIComponent(sector!)}&subsector=${encodeURIComponent(subsector!)}`
      : '';
    fetch(`/ventures/sector-eval/team-completion${params}`, { headers: AUTH })
      .then(r => r.ok ? r.json() : [])
      .then(d => { setData(Array.isArray(d) ? d : []); setLoading(false); });
  }, [sector, subsector, isSubsector, refreshKey]);  // re-fetches whenever refreshKey changes

  // Filter to current assignees only — removing someone from the request removes them here too
  const visible    = assignees.length > 0 ? data.filter(c => assignees.includes(c.evaluator)) : data;
  const myEntry    = data.find(c => c.evaluator === me?.username);
  const myComplete = (myEntry?.pct ?? 0) === 100;

  async function postCompletion() {
    if (!myEntry) return;
    setPosting(true);
    const label = isSubsector
      ? `${me} — ${subsector} (${sector}) Evaluation (${myEntry.completed}/${myEntry.total} stages)`
      : `${me} — Sector Evaluation (${myEntry.completed}/${myEntry.total})`;
    const description = isSubsector
      ? `All ${myEntry.total} stages completed for ${sector} › ${subsector}`
      : `All ${myEntry.total} sector × stage combinations completed`;
    try {
      await fetch(`/requests/${requestId}/outputs`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, type: 'page', url: formUrl, description }),
      });
      onOutputPosted();
    } finally { setPosting(false); }
  }

  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Team Completion</p>
      {loading ? (
        <p className="text-xs text-slate-600 italic">Loading…</p>
      ) : (
        <div className="space-y-2.5">
          {visible.map(c => (
            <div key={c.evaluator}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-700 capitalize">{c.evaluator}</span>
                <span className={`text-[10px] font-bold tabular-nums ${
                  c.pct === 100 ? 'text-emerald-600' : c.pct > 0 ? 'text-amber-600' : 'text-slate-400'
                }`}>
                  {c.completed}/{c.total} · {c.pct}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    c.pct === 100 ? 'bg-emerald-500' : c.pct > 0 ? 'bg-amber-400' : 'bg-slate-200'
                  }`}
                  style={{ width: `${c.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <Link
          to={formUrl}
          className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />Open Evaluation Form{isSubsector && ` → ${subsector}`}
        </Link>
        {myComplete && (
          <button
            onClick={postCompletion}
            disabled={posting}
            className="flex items-center gap-1 text-[11px] font-semibold text-[#F0E545] hover:text-[#F0E545]/80 disabled:opacity-50 transition-colors"
          >
            <Send className="w-3 h-3" />{posting ? 'Posting…' : 'Post My Completion'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Scrum Types ───────────────────────────────────────────────────────────────

interface ScrumItem {
  id:              number;
  title:           string;
  category:        string;
  overview:        string | null;
  owner:           string | null;
  target_customer: string | null;
  revenue_model:   string | null;
  key_features:    string | null;
  platform_link:   string | null;
  status:          string;
  created_by:      string | null;
  created_at:      string;
  updated_at:      string;
  update_count:    number;
  last_update:     string | null;
}

interface ScrumItemDetail extends ScrumItem {
  updates: { id: number; author: string; body: string; created_at: string }[];
}

interface Proposal {
  id:                  number;
  title:               string;
  what_to_build:       string | null;
  what_it_does:        string | null;
  why_we_want_it:      string | null;
  where_it_lives:      string | null;
  what_it_connects_to: string | null;
  submitted_by:        string;
  status:              string;  // pending | converted | dismissed
  scrum_item_id:       number | null;
  scrum_title:         string | null;
  created_at:          string;
}

const SCRUM_CATEGORIES: Record<string, { label: string; color: string }> = {
  product:      { label: 'Product',      color: '#6366F1' },
  poc:          { label: 'PoC',          color: '#06B6D4' },
  mvp:          { label: 'MVP',          color: '#10b981' },
  feature:      { label: 'Feature',      color: '#F59E0B' },
  intelligence: { label: 'Intelligence', color: '#F59E0B' },
};

const SCRUM_STATUSES: Record<string, { label: string; color: string; bg: string }> = {
  exploring: { label: 'Exploring', color: '#64748b', bg: 'bg-slate-100' },
  building:  { label: 'Building',  color: '#d97706', bg: 'bg-amber-50'  },
  live:      { label: 'Live',      color: '#059669', bg: 'bg-emerald-50' },
  paused:    { label: 'Paused',    color: '#7c3aed', bg: 'bg-violet-50'  },
  shelved:   { label: 'Shelved',   color: '#94a3b8', bg: 'bg-slate-50'   },
};

// ── Scrum Section Field ───────────────────────────────────────────────────────
// Defined outside ScrumDetailPanel so React doesn't remount it on every render.

function ScrumSection({ label, field, value, multiline = false, editing, setEditing }: {
  label: string;
  field: keyof ScrumItem;
  value: string | null;
  multiline?: boolean;
  editing: Partial<ScrumItem> | null;
  setEditing: React.Dispatch<React.SetStateAction<Partial<ScrumItem> | null>>;
}) {
  const isEditing = editing !== null;
  const editVal   = editing?.[field] as string ?? value ?? '';
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-1.5">
        <p className={cls.eyebrow}>{label}</p>
        {isEditing && <span className="text-[10px] text-slate-400">editing</span>}
      </div>
      {isEditing ? (
        multiline ? (
          <textarea
            value={editVal}
            onChange={e => setEditing(prev => ({ ...prev, [field]: e.target.value }))}
            className={cls.inputFull + ' text-sm resize-none min-h-[80px]'}
          />
        ) : (
          <input
            value={editVal}
            onChange={e => setEditing(prev => ({ ...prev, [field]: e.target.value }))}
            className={cls.inputFull + ' text-sm'}
          />
        )
      ) : value ? (
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{value}</p>
      ) : (
        <p className="text-sm text-slate-400 italic">Not set</p>
      )}
    </div>
  );
}

// ── Scrum Detail Panel ────────────────────────────────────────────────────────

function ScrumDetailPanel({ item, onClose, onUpdated }: { item: ScrumItem; onClose: () => void; onUpdated: () => void }) {
  const [detail, setDetail]   = useState<ScrumItemDetail | null>(null);
  const [newNote, setNewNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<Partial<ScrumItem> | null>(null);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    fetch(`/requests/scrum/${item.id}`, { headers: AUTH })
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setDetail(d));
  }, [item.id]);

  const postNote = async () => {
    if (!newNote.trim()) return;
    setPosting(true);
    try {
      const r = await fetch(`/requests/scrum/${item.id}/updates`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newNote.trim() }),
      });
      if (r.ok) {
        setNewNote('');
        const updated = await fetch(`/requests/scrum/${item.id}`, { headers: AUTH });
        if (updated.ok) { setDetail(await updated.json()); onUpdated(); }
      }
    } finally { setPosting(false); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const r = await fetch(`/requests/scrum/${item.id}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      if (r.ok) {
        setEditing(null);
        const updated = await fetch(`/requests/scrum/${item.id}`, { headers: AUTH });
        if (updated.ok) { setDetail(await updated.json()); onUpdated(); }
      }
    } finally { setSaving(false); }
  };

  const d = detail ?? item as any;
  const cat    = SCRUM_CATEGORIES[d.category] ?? { label: d.category, color: '#94a3b8' };
  const status = SCRUM_STATUSES[d.status]     ?? SCRUM_STATUSES.exploring;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40" onClick={onClose} />
      {/* Panel */}
      <div className="w-[560px] bg-white h-full overflow-y-auto flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 bg-[#0f172a] text-white flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {editing ? (
                <input
                  value={editing.title ?? d.title}
                  onChange={e => setEditing(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-lg font-bold text-white placeholder-white/40 focus:outline-none"
                />
              ) : (
                <h2 className="text-lg font-bold leading-snug">{d.title}</h2>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                  style={{ background: cat.color + '33', color: cat.color }}>
                  {cat.label}
                </span>
                {editing ? (
                  <select
                    value={editing.status ?? d.status}
                    onChange={e => setEditing(prev => ({ ...prev, status: e.target.value }))}
                    className="text-[11px] bg-white/10 border border-white/20 rounded px-1.5 py-0.5 text-white focus:outline-none"
                  >
                    {Object.entries(SCRUM_STATUSES).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${status.bg}`}
                    style={{ color: status.color }}>
                    {status.label}
                  </span>
                )}
                {d.owner && <span className="text-[10px] text-white/60">Owner: {d.owner}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {editing ? (
                <>
                  <button onClick={saveEdit} disabled={saving}
                    className="flex items-center gap-1 text-[11px] font-semibold text-emerald-300 hover:text-emerald-100 disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(null)}
                    className="text-[11px] text-white/50 hover:text-white/80">Cancel</button>
                </>
              ) : (
                <button onClick={() => setEditing({})}
                  className="flex items-center gap-1 text-[11px] font-semibold text-white/60 hover:text-white/90">
                  <Edit2 className="w-3 h-3" />Edit
                </button>
              )}
              <button onClick={onClose} className="text-white/60 hover:text-white ml-1">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 px-6 py-6">
          <ScrumSection label="Overview" field="overview" value={d.overview} multiline editing={editing} setEditing={setEditing} />
          <ScrumSection label="Target Customer" field="target_customer" value={d.target_customer} multiline editing={editing} setEditing={setEditing} />
          <ScrumSection label="Revenue Model" field="revenue_model" value={d.revenue_model} multiline editing={editing} setEditing={setEditing} />
          <ScrumSection label="Key Features" field="key_features" value={d.key_features} multiline editing={editing} setEditing={setEditing} />
          {(d.platform_link || editing) && (
            <div className="mb-5">
              <p className={cls.eyebrow}>Platform Link</p>
              {editing ? (
                <input
                  value={editing.platform_link ?? d.platform_link ?? ''}
                  onChange={e => setEditing(prev => ({ ...prev, platform_link: e.target.value }))}
                  className={cls.inputFull + ' text-sm mt-1.5'}
                  placeholder="/brambles or https://..."
                />
              ) : d.platform_link ? (
                d.platform_link.startsWith('http') ? (
                <a href={d.platform_link} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline flex items-center gap-1 mt-1">
                  <ExternalLink className="w-3 h-3" />{d.platform_link}
                </a>
                ) : (
                <Link to={d.platform_link} className="text-sm text-indigo-600 hover:underline flex items-center gap-1 mt-1">
                  <ExternalLink className="w-3 h-3" />{d.platform_link}
                </Link>
                )
              ) : null}
            </div>
          )}

          {/* Updates log */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <p className={cls.sectionTitle + ' mb-4'}>Updates</p>
            {detail?.updates && detail.updates.length > 0 ? (
              <div className="space-y-3 mb-4">
                {detail.updates.map(u => (
                  <div key={u.id} className={cls.subcard + ' p-3'}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-semibold text-slate-700">{u.author}</span>
                      <span className="text-[10px] text-slate-400">{fmtTs(u.created_at)}</span>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">{u.body}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic mb-4">No updates yet.</p>
            )}

            {/* Post update */}
            <div className="flex gap-2">
              <textarea
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Add a note or update…"
                className={cls.inputFull + ' text-sm resize-none min-h-[60px]'}
              />
            </div>
            <div className="flex justify-end mt-2">
              <button
                onClick={postNote}
                disabled={posting || !newNote.trim()}
                className="flex items-center gap-1 text-[11px] font-semibold text-[#1E293B] bg-cvc-gold hover:bg-amber-400 disabled:opacity-40 rounded px-3 py-1.5 transition-colors"
              >
                <Send className="w-3 h-3" />{posting ? 'Posting…' : 'Post Update'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── WEF Data Charts ───────────────────────────────────────────────────────────

const C_AMBER  = '#F59E0B';
const C_DARK   = '#1E293B';
const C_MUTED  = '#94a3b8';
const C_GRID   = '#f1f5f9';

const TT_STYLE = {
  contentStyle: { background: C_DARK, border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, padding: '8px 14px' },
  itemStyle: { color: C_AMBER },
  labelStyle: { color: C_MUTED, fontWeight: 600, marginBottom: 2 },
  cursor: { fill: '#f8fafc' },
};

// Hardcoded from DB queries — verified against live cvc_db 2026-05-15
const WEF_INTEREST = [
  { year: '2021', intros: 12 },
  { year: '2022', intros: 19 },
  { year: '2023', intros: 18 },
  { year: '2024', intros: 26 },
  { year: '2025', intros: 118 },
];

const WEF_SECTORS = [
  { sector: 'Robotics',       count: 66  },
  { sector: 'Supply Chain',   count: 25  },
  { sector: 'Physical AI',    count: 13  },
  { sector: 'Ind. Automation',count: 10  },
  { sector: 'Manufacturing',  count: 4   },
];

const WEF_FUNDING = [
  { year: '2020', usd: 50   },
  { year: '2021', usd: 130  },
  { year: '2022', usd: 500  },
  { year: '2024', usd: 433  },
  { year: '2025', usd: 144  },
  { year: '2026', usd: 1500 },
];

const WEF_FORMATION = [
  { year: '2018', count: 18 },
  { year: '2019', count: 6  },
  { year: '2020', count: 12 },
  { year: '2021', count: 9  },
  { year: '2022', count: 8  },
  { year: '2023', count: 4  },
  { year: '2024', count: 7  },
];

const SECTOR_COLORS: Record<string, string> = {
  'Robotics':        '#6366F1',
  'Supply Chain':    '#06B6D4',
  'Physical AI':     '#EC4899',
  'Ind. Automation': '#F59E0B',
  'Manufacturing':   '#10b981',
};

// Render a recharts chart card to a PNG and open it in a new tab.
// The platform runs on HTTP (not HTTPS) so navigator.clipboard.write is blocked
// by the browser's secure-context requirement. Opening in a new tab lets the
// user right-click → Copy Image → paste anywhere (email, Slack, Outlook, etc.)
async function openChartAsImage(
  cardEl: HTMLElement,
  title: string,
  subtitle: string,
  setLoading: (v: boolean) => void,
  setErr: (v: string) => void,
) {
  const svg = cardEl.querySelector('svg');
  if (!svg) { setErr('No chart found'); return; }
  setLoading(true);
  try {
    const svgW = svg.clientWidth || 560;
    const svgH = svg.clientHeight || 260;
    const PAD = 28;
    const TOP = 74;
    const BOT = 32;
    const canvasW = svgW + PAD * 2;
    const canvasH = svgH + TOP + BOT;
    const SCALE = 2;

    const canvas = document.createElement('canvas');
    canvas.width  = canvasW * SCALE;
    canvas.height = canvasH * SCALE;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(SCALE, SCALE);

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Title
    ctx.fillStyle = C_DARK;
    ctx.font = 'bold 14px system-ui,-apple-system,sans-serif';
    ctx.fillText(title, PAD, 28);

    // Subtitle
    ctx.fillStyle = C_MUTED;
    ctx.font = '11px system-ui,-apple-system,sans-serif';
    ctx.fillText(subtitle, PAD, 46);

    // Divider
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, 58); ctx.lineTo(canvasW - PAD, 58); ctx.stroke();

    // Rasterize the recharts SVG
    const svgClone = svg.cloneNode(true) as SVGElement;
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgClone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    svgClone.setAttribute('width', String(svgW));
    svgClone.setAttribute('height', String(svgH));
    const svgStr = new XMLSerializer().serializeToString(svgClone);

    await new Promise<void>((res, rej) => {
      const img = new Image(svgW, svgH);
      img.onload = () => { ctx.drawImage(img, PAD, TOP, svgW, svgH); res(); };
      img.onerror = () => rej(new Error('SVG render failed'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    });

    // Source attribution
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '10px system-ui,-apple-system,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Source: Vertical OS Platform · ' + new Date().getFullYear(), canvasW - PAD, canvasH - 10);

    // Open as blob URL in new tab — user right-clicks → Copy Image → paste anywhere
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'),
    );
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    // Revoke after 60s
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (!win) setErr('Pop-up blocked — allow pop-ups for this site');
  } catch (e) {
    console.error('Chart render failed:', e);
    setErr('Render failed — try again');
    setTimeout(() => setErr(''), 3500);
  } finally {
    setLoading(false);
  }
}

// Individual chart card inside the modal
function WefChartCard({
  title, subtitle, children,
}: { title: string; subtitle: string; children: React.ReactNode }) {
  const ref     = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  return (
    <div ref={ref} className="bg-white rounded-lg border border-slate-200 p-5 shadow-cvc">
      <div className="flex items-start justify-between mb-1 gap-3">
        <div>
          <p data-chart-title className={cls.sectionTitle}>{title}</p>
          <p data-chart-subtitle className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <button
            disabled={loading}
            onClick={() => ref.current && openChartAsImage(ref.current, title, subtitle, setLoading, setErr)}
            className="text-[11px] font-semibold px-2.5 py-1 rounded border border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600 transition-colors disabled:opacity-40"
          >
            {loading ? 'Rendering…' : 'Open Image'}
          </button>
          {err && <span className="text-[10px] text-red-500 text-right max-w-[160px] leading-tight">{err}</span>}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

// Modal with all 4 charts
function WefDataModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4">
      <div className="w-full max-w-5xl bg-[#F8FAFC] rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white rounded-t-xl">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C_AMBER }}>Intelligence</span>
            <h2 className={cls.sectionTitle + ' mt-0.5'}>WEF Data</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">Agentic AI in Industrial — verified from live DB · 2026-05-15</p>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Data preface */}
        <div className="mx-6 mt-5 mb-1 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-[11px] font-bold text-amber-800 uppercase tracking-widest mb-1">Data Source & Scope</p>
          <p className="text-[12px] text-amber-900 leading-relaxed">
            All data in these charts is sourced exclusively from the <strong>Vertical OS Platform</strong> — a proprietary deal tracking and partner engagement system. Figures reflect companies and engagement activity logged within the platform and do not represent the full market. Funding data is limited to rounds tracked in the platform database.
          </p>
        </div>

        {/* Charts 2-col grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-6">

          {/* Chart 1 — Corporate Interest Over Time */}
          <WefChartCard
            title="Corporate Interest Over Time"
            subtitle="Partner engagements to agentic AI companies · 2021–2025"
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={WEF_INTEREST} barSize={44} margin={{ top: 14, right: 4, left: 0, bottom: 2 }}>
                <CartesianGrid vertical={false} stroke={C_GRID} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: C_MUTED }} axisLine={false} tickLine={false} width={28} />
                <Tooltip {...TT_STYLE} formatter={(v: number) => [`${v} intro events`, 'Corporate Interest']} />
                <Bar dataKey="intros" radius={[4, 4, 0, 0]}>
                  {WEF_INTEREST.map(e => (
                    <Cell key={e.year} fill={e.year === '2025' ? C_AMBER : '#CBD5E1'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-1">
              <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: C_AMBER }} />2025 inflection
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-300" />Prior years
              </span>
            </div>
          </WefChartCard>

          {/* Chart 2 — Agentic Companies by Sector */}
          <WefChartCard
            title="Agentic AI Companies by Sector"
            subtitle="Tracked startups matching agentic AI criteria · all time"
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={WEF_SECTORS} layout="vertical" barSize={22} margin={{ top: 4, right: 32, left: 8, bottom: 2 }}>
                <CartesianGrid horizontal={false} stroke={C_GRID} />
                <XAxis type="number" tick={{ fontSize: 10, fill: C_MUTED }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="sector" tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }} axisLine={false} tickLine={false} width={100} />
                <Tooltip {...TT_STYLE} formatter={(v: number) => [`${v} companies`, 'Count']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {WEF_SECTORS.map(e => (
                    <Cell key={e.sector} fill={SECTOR_COLORS[e.sector] ?? C_MUTED} />
                  ))}
                  <LabelList dataKey="count" position="right" style={{ fontSize: 10, fontWeight: 700, fill: '#475569' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </WefChartCard>

          {/* Chart 3 — Funding Momentum */}
          <WefChartCard
            title="Funding Momentum"
            subtitle="Total tracked funding in agentic AI startups ($M) · 2020–2026"
          >
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={WEF_FUNDING} margin={{ top: 14, right: 4, left: 0, bottom: 2 }}>
                <CartesianGrid vertical={false} stroke={C_GRID} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: C_MUTED }} axisLine={false} tickLine={false} width={36}
                  tickFormatter={(v: number) => v >= 1000 ? `$${v / 1000}B` : `$${v}M`} />
                <Tooltip
                  {...TT_STYLE}
                  formatter={(v: number) => [v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v}M`, 'Funding']}
                />
                <Bar dataKey="usd" barSize={40} radius={[4, 4, 0, 0]}>
                  {WEF_FUNDING.map(e => (
                    <Cell key={e.year} fill={e.year === '2026' ? C_AMBER : '#6366F1'} />
                  ))}
                  <LabelList dataKey="usd" position="top"
                    formatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v}M`}
                    style={{ fontSize: 9, fontWeight: 700, fill: '#475569' }} />
                </Bar>
                <Line type="monotone" dataKey="usd" stroke="#EC4899" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-1">
              <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: C_AMBER }} />2026 peak
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400">Note: 2023 gap = no tracked rounds in DB</span>
            </div>
          </WefChartCard>

          {/* Chart 4 — Company Formation Wave */}
          <WefChartCard
            title="Company Formation Wave"
            subtitle="New agentic AI companies founded per year · 2018–2024"
          >
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={WEF_FORMATION} margin={{ top: 14, right: 4, left: 0, bottom: 2 }}>
                <CartesianGrid vertical={false} stroke={C_GRID} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: C_MUTED }} axisLine={false} tickLine={false} width={24} />
                <Tooltip {...TT_STYLE} formatter={(v: number) => [`${v} companies`, 'Founded']} />
                <Bar dataKey="count" barSize={40} radius={[4, 4, 0, 0]}>
                  {WEF_FORMATION.map(e => (
                    <Cell key={e.year} fill={e.year === '2018' ? '#6366F1' : '#CBD5E1'} />
                  ))}
                  <LabelList dataKey="count" position="top" style={{ fontSize: 10, fontWeight: 700, fill: '#475569' }} />
                </Bar>
                <Line type="monotone" dataKey="count" stroke="#06B6D4" strokeWidth={2} dot={{ fill: '#06B6D4', r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-1">
              <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#6366F1' }} />2018 Wave 1 peak
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-300" />Physical AI era (2021+)
              </span>
            </div>
          </WefChartCard>

        </div>
      </div>
    </div>
  );
}

// Scrum-style summary card that opens the modal
function WefDataCard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        onClick={() => setOpen(true)}
        className={`${cls.card} p-4 cursor-pointer hover:shadow-cvc-hover transition-all border-t-2`}
        style={{ borderTopColor: C_AMBER }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C_AMBER }}>Intelligence</span>
            <h3 className="text-sm font-semibold text-slate-800 mt-0.5 leading-snug">WEF Data</h3>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0 mt-1" />
        </div>
        <p className="text-[12px] text-slate-500 line-clamp-2 mb-3 leading-relaxed">
          Agentic AI in Industrial — corporate interest trends, sector distribution, funding momentum, and company formation wave across focus domains.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">4 charts</span>
          <span className="text-[10px] text-slate-400">2018–2026 · Partner engagement + DB data</span>
          <span className="text-[10px] text-slate-300 ml-auto">Click to view →</span>
        </div>
      </div>
      {open && <WefDataModal onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Data Explorer ─────────────────────────────────────────────────────────────

const EXPLORER_SECTORS = ['All Sectors', 'Robotics', 'Supply Chain', 'Physical AI', 'Industrial Automation', 'Manufacturing'];
const EXPLORER_STAGES  = ['All Stages', 'Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Series D+', 'Growth'];

const TEMPLATES = [
  {
    id: 'sector-overview',
    label: 'Companies by Sector',
    description: 'How many companies do we track per sector, and what are their average scores?',
    params: [{ key: 'stage', label: 'Stage', options: EXPLORER_STAGES }, { key: 'min_score', label: 'Min Score', type: 'number' as const }],
    xKey: 'sector', yKey: 'company_count', color: '#6366F1',
  },
  {
    id: 'funding-trends',
    label: 'Funding Trends',
    description: 'Total tracked funding raised per year — optionally filter by sector.',
    params: [
      { key: 'sector', label: 'Sector', options: EXPLORER_SECTORS },
      { key: 'start_year', label: 'From', type: 'number' as const },
      { key: 'end_year',   label: 'To',   type: 'number' as const },
    ],
    xKey: 'year', yKey: 'total_m', color: '#F59E0B',
    yFormat: (v: number) => v >= 1000 ? `$${(v/1000).toFixed(1)}B` : `$${v}M`,
  },
  {
    id: 'stage-distribution',
    label: 'Stage Distribution',
    description: 'How is the pipeline spread across funding stages?',
    params: [{ key: 'sector', label: 'Sector', options: EXPLORER_SECTORS }],
    xKey: 'stage', yKey: 'company_count', color: '#06B6D4',
  },
  {
    id: 'score-distribution',
    label: 'Score Distribution',
    description: 'How are composite scores distributed across the portfolio?',
    params: [{ key: 'sector', label: 'Sector', options: EXPLORER_SECTORS }],
    xKey: 'label', yKey: 'company_count', color: '#10b981',
  },
  {
    id: 'engagement-over-time',
    label: 'Partner Engagement Over Time',
    description: 'How many startup introductions were made to corporate partners each year? Partners are aggregated — no names shown.',
    params: [{ key: 'sector', label: 'Sector', options: EXPLORER_SECTORS }],
    xKey: 'year', yKey: 'intro_events', color: '#F59E0B',
  },
  {
    id: 'industry-activity',
    label: 'Corporate Industry Activity',
    description: 'Which corporate industries are most actively engaging with startups? Aggregated by industry — no org names.',
    params: [],
    xKey: 'industry', yKey: 'intro_events', color: '#EC4899',
  },
  {
    id: 'sector-demand',
    label: 'Sector Demand Ranking',
    description: 'Which startup sectors attract the most interest from corporate partners?',
    params: [],
    xKey: 'sector', yKey: 'intro_events', color: '#6366F1',
  },
  {
    id: 'intro-outcomes',
    label: 'Intro Outcome Distribution',
    description: 'How do partner introductions resolve? Tracks outcomes from first share through commercial engagement.',
    params: [{ key: 'sector', label: 'Sector', options: EXPLORER_SECTORS }],
    xKey: 'label', yKey: 'count', color: '#06B6D4',
  },
];

type ExplorerRow = Record<string, string | number>;

interface ExplorerMeta {
  source_tables: string[];
  key_fields: Record<string, string>;
  caveats: string[];
  data_quality: {
    total_companies: number;
    human_edited_pct: number;
    enriched_pct: number;
    data_score: number;
  };
}

interface ExplorerResult {
  data: ExplorerRow[];
  meta: ExplorerMeta;
}

function DataScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? '#10b981' : score >= 40 ? '#F59E0B' : '#ef4444';
  const label = score >= 70 ? 'High confidence' : score >= 40 ? 'Moderate confidence' : 'Low confidence';
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-8 h-8 flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-8 h-8 -rotate-90">
          <circle cx="18" cy="18" r="14" fill="none" stroke="#e2e8f0" strokeWidth="4" />
          <circle cx="18" cy="18" r="14" fill="none" stroke={color} strokeWidth="4"
            strokeDasharray={`${score * 0.88} 88`} strokeLinecap="round" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold" style={{ color }}>{score}</span>
      </div>
      <div>
        <p className="text-[11px] font-semibold" style={{ color }}>{label}</p>
        <p className="text-[10px] text-slate-400">Data confidence score</p>
      </div>
    </div>
  );
}

function ProvenanceFooter({ meta }: { meta: ExplorerMeta }) {
  const [showDetail, setShowDetail] = useState(false);
  const q = meta.data_quality;
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <DataScoreBadge score={q.data_score} />
        <div className="flex gap-4 text-[11px] text-slate-500 flex-wrap">
          <span><span className="font-semibold text-slate-700">{q.total_companies.toLocaleString()}</span> companies in scope</span>
          <span><span className="font-semibold text-slate-700">{q.human_edited_pct}%</span> human-edited</span>
          <span><span className="font-semibold text-slate-700">{q.enriched_pct}%</span> fully enriched</span>
          <button onClick={() => setShowDetail(v => !v)}
            className="text-indigo-500 hover:text-indigo-700 font-medium underline underline-offset-2">
            {showDetail ? 'Hide provenance' : 'View provenance'}
          </button>
        </div>
      </div>

      {showDetail && (
        <div className="mt-3 bg-slate-50 rounded-lg p-3 space-y-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Source Tables</p>
            <p className="text-[11px] text-slate-600 font-mono">{meta.source_tables.join(', ')}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Key Fields</p>
            <div className="space-y-1">
              {Object.entries(meta.key_fields).map(([field, desc]) => (
                <div key={field} className="flex gap-2 text-[11px]">
                  <span className="font-mono text-indigo-600 flex-shrink-0">{field}</span>
                  <span className="text-slate-500">{desc}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Caveats</p>
            <ul className="space-y-1">
              {meta.caveats.map((c, i) => (
                <li key={i} className="text-[11px] text-slate-500 flex gap-2">
                  <span className="text-amber-400 flex-shrink-0">⚠</span>{c}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[10px] text-slate-300">
            Data confidence score = (% human-edited × 0.6) + (% enriched × 0.4) · Source: Vertical OS Platform
          </p>
        </div>
      )}
    </div>
  );
}

function ExplorerChart({ data, xKey, yKey, color, yFormat }: {
  data: ExplorerRow[];
  xKey: string;
  yKey: string;
  color: string;
  yFormat?: (v: number) => string;
}) {
  const isHorizontal = data.length > 5;
  if (!data.length) return <p className="text-sm text-slate-400 text-center py-10">No data for these filters</p>;

  return (
    <ResponsiveContainer width="100%" height={260}>
      {isHorizontal ? (
        <BarChart data={data} layout="vertical" barSize={20} margin={{ top: 4, right: 48, left: 8, bottom: 2 }}>
          <CartesianGrid horizontal={false} stroke={C_GRID} />
          <XAxis type="number" tick={{ fontSize: 10, fill: C_MUTED }} axisLine={false} tickLine={false}
            tickFormatter={yFormat} />
          <YAxis type="category" dataKey={xKey} tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }}
            axisLine={false} tickLine={false} width={80} />
          <Tooltip {...TT_STYLE} formatter={(v: number) => [yFormat ? yFormat(v) : v, '']} />
          <Bar dataKey={yKey} fill={color} radius={[0, 4, 4, 0]}>
            <LabelList dataKey={yKey} position="right"
              formatter={yFormat}
              style={{ fontSize: 10, fontWeight: 700, fill: '#475569' }} />
          </Bar>
        </BarChart>
      ) : (
        <BarChart data={data} barSize={48} margin={{ top: 14, right: 4, left: 0, bottom: 2 }}>
          <CartesianGrid vertical={false} stroke={C_GRID} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: C_MUTED }} axisLine={false} tickLine={false} width={40}
            tickFormatter={yFormat} />
          <Tooltip {...TT_STYLE} formatter={(v: number) => [yFormat ? yFormat(v) : v, '']} />
          <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]}>
            <LabelList dataKey={yKey} position="top"
              formatter={yFormat}
              style={{ fontSize: 10, fontWeight: 700, fill: '#475569' }} />
          </Bar>
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

function DataExplorerModal({ onClose }: { onClose: () => void }) {
  const [activeTemplate, setActiveTemplate] = useState(TEMPLATES[0]);
  const [params, setParams]   = useState<Record<string, string>>({});
  const [result, setResult]   = useState<ExplorerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [ran, setRan]         = useState(false);
  const chartCardRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState('');

  const runQuery = async () => {
    setLoading(true);
    setRan(false);
    try {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v && v !== 'All Sectors' && v !== 'All Stages' && v !== '') qs.set(k, v);
      });
      const r = await fetch(`/explorer/${activeTemplate.id}?${qs}`, { headers: AUTH });
      if (r.ok) { setResult(await r.json()); setRan(true); }
    } finally { setLoading(false); }
  };

  const switchTemplate = (t: typeof TEMPLATES[0]) => {
    setActiveTemplate(t);
    setParams({});
    setResult(null);
    setRan(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4">
      <div className="w-full max-w-4xl bg-[#F8FAFC] rounded-xl shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white rounded-t-xl">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">Data Explorer</span>
            <h2 className={cls.sectionTitle + ' mt-0.5'}>Pre-built Reports</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">Select a template, set filters, run — then export the chart as an image.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 grid grid-cols-[220px_1fr] gap-6">

          {/* Template picker */}
          <div>
            <p className={cls.eyebrow + ' mb-2'}>Report Template</p>
            <div className="flex flex-col gap-1">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => switchTemplate(t)}
                  className={`text-left px-3 py-2.5 rounded-lg text-[12px] font-medium transition-colors border ${
                    activeTemplate.id === t.id
                      ? 'bg-[#1E293B] text-white border-[#1E293B]'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex flex-col gap-4 min-w-0">

            {/* Description + params */}
            <div className={`${cls.card} ${cls.cardPadded}`}>
              <p className="text-[12px] text-slate-500 mb-3 leading-relaxed">{activeTemplate.description}</p>
              <div className="flex flex-wrap gap-3 items-end">
                {activeTemplate.params.map(p => (
                  <div key={p.key}>
                    <label className={cls.eyebrow + ' mb-1'}>{p.label}</label>
                    {p.options ? (
                      <select
                        value={params[p.key] ?? ''}
                        onChange={e => setParams(prev => ({ ...prev, [p.key]: e.target.value }))}
                        className={cls.select + ' text-sm min-w-[140px]'}
                      >
                        {p.options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type="number"
                        value={params[p.key] ?? ''}
                        onChange={e => setParams(prev => ({ ...prev, [p.key]: e.target.value }))}
                        className={cls.input + ' text-sm w-24'}
                        placeholder={p.key.includes('year') ? (p.key === 'start_year' ? '2020' : '2026') : '0'}
                      />
                    )}
                  </div>
                ))}
                <button
                  onClick={runQuery}
                  disabled={loading}
                  className="flex items-center gap-1.5 text-[11px] font-semibold bg-[#1E293B] text-cvc-gold px-4 py-2 rounded hover:bg-slate-700 transition-colors disabled:opacity-40"
                >
                  {loading ? 'Running…' : 'Run Report'}
                </button>
              </div>
            </div>

            {/* Chart output */}
            {ran && result && (
              <div ref={chartCardRef} className={`${cls.card} ${cls.cardPadded}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className={cls.sectionTitle}>{activeTemplate.label}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {Object.entries(params)
                        .filter(([, v]) => v && v !== 'All Sectors' && v !== 'All Stages')
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(' · ') || 'All companies'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <button
                      disabled={exporting}
                      onClick={() => chartCardRef.current && openChartAsImage(
                        chartCardRef.current,
                        activeTemplate.label,
                        'Vertical OS Platform',
                        setExporting,
                        setExportErr,
                      )}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded border border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600 transition-colors disabled:opacity-40"
                    >
                      {exporting ? 'Rendering…' : 'Open Image'}
                    </button>
                    {exportErr && <span className="text-[10px] text-red-500">{exportErr}</span>}
                  </div>
                </div>
                <ExplorerChart
                  data={result.data}
                  xKey={activeTemplate.xKey}
                  yKey={activeTemplate.yKey}
                  color={activeTemplate.color}
                  yFormat={activeTemplate.yFormat}
                />
                <ProvenanceFooter meta={result.meta} />
              </div>
            )}

            {!ran && !loading && (
              <div className="flex-1 flex items-center justify-center py-16 text-slate-300">
                <div className="text-center">
                  <LayoutDashboard className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Set your filters and hit Run Report</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DataExplorerCard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        onClick={() => setOpen(true)}
        className={`${cls.card} p-4 cursor-pointer hover:shadow-cvc-hover transition-all border-t-2`}
        style={{ borderTopColor: '#F59E0B' }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#F59E0B' }}>Intelligence</span>
            <h3 className="text-sm font-semibold text-slate-800 mt-0.5 leading-snug">Data Explorer</h3>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0 mt-1" />
        </div>
        <p className="text-[12px] text-slate-500 line-clamp-2 mb-3 leading-relaxed">
          Pre-built report templates with configurable filters. Run a report, view the chart, export as an image to share.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">8 templates</span>
          <span className="text-[10px] text-slate-400">Live DB · Sector · Funding · Stage · Scoring · Partner Engagement</span>
          <span className="text-[10px] text-slate-300 ml-auto">Click to explore →</span>
        </div>
      </div>
      {open && <DataExplorerModal onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Scrum View ────────────────────────────────────────────────────────────────

// ── Feature Proposals ────────────────────────────────────────────────────────

const PROPOSAL_FIELDS: { key: keyof Proposal; label: string; placeholder: string }[] = [
  { key: 'what_to_build',       label: 'What to Build',         placeholder: 'Describe the feature in a sentence or two.' },
  { key: 'what_it_does',        label: 'What It Should Do',     placeholder: 'What behavior or outcome does it create for the user?' },
  { key: 'why_we_want_it',      label: 'Why We Want It',        placeholder: 'What problem does it solve? Why build it now?' },
  { key: 'where_it_lives',      label: 'Where Should It Live',  placeholder: 'Which page or section of the platform?' },
  { key: 'what_it_connects_to', label: 'What Should It Connect To', placeholder: 'Any data, systems, or other features it needs?' },
];

function ProposalDetailModal({ proposal, onClose, onConverted, onDismissed }: {
  proposal: Proposal;
  onClose: () => void;
  onConverted: () => void;
  onDismissed: () => void;
}) {
  const [converting, setConverting] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const convert = async () => {
    setConverting(true);
    try {
      const r = await fetch(`/requests/scrum/proposals/${proposal.id}/convert`, {
        method: 'POST', headers: AUTH,
      });
      if (r.ok) { onConverted(); onClose(); }
    } finally { setConverting(false); }
  };

  const dismiss = async () => {
    setDismissing(true);
    try {
      const r = await fetch(`/requests/scrum/proposals/${proposal.id}`, {
        method: 'DELETE', headers: AUTH,
      });
      if (r.ok) { onDismissed(); onClose(); }
    } finally { setDismissing(false); }
  };

  const isPending = proposal.status === 'pending';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-violet-500 mb-1">Feature Proposal</p>
            <h3 className="text-base font-bold text-slate-800 leading-snug">{proposal.title}</h3>
            <p className="text-[11px] text-slate-400 mt-1">
              Submitted by {proposal.submitted_by} · {new Date(proposal.created_at).toLocaleDateString()}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 mt-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Fields */}
        <div className="p-5 space-y-4">
          {PROPOSAL_FIELDS.map(({ key, label }) => {
            const val = proposal[key] as string | null;
            if (!val) return null;
            return (
              <div key={key}>
                <p className={cls.eyebrow + ' mb-1'}>{label}</p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{val}</p>
              </div>
            );
          })}

          {proposal.status === 'converted' && proposal.scrum_title && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
              <p className="text-[11px] font-semibold text-emerald-700">
                Converted to Scrum Item: "{proposal.scrum_title}"
              </p>
            </div>
          )}
          {proposal.status === 'dismissed' && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
              <p className="text-[11px] text-slate-500">This proposal was dismissed.</p>
            </div>
          )}
        </div>

        {/* Actions */}
        {isPending && (
          <div className="flex items-center justify-between gap-2 px-5 pb-5">
            <button
              onClick={dismiss}
              disabled={dismissing}
              className="text-[11px] text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
            >
              {dismissing ? 'Dismissing…' : 'Dismiss'}
            </button>
            <button
              onClick={convert}
              disabled={converting}
              className="flex items-center gap-1.5 text-[11px] font-semibold bg-[#1E293B] text-cvc-gold px-4 py-2 rounded hover:bg-slate-700 transition-colors disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              {converting ? 'Creating Scrum Item…' : 'Convert to Scrum Item'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ProposalsSection({ onConverted }: { onConverted: () => void }) {
  const [proposals, setProposals]       = useState<Proposal[]>([]);
  const [open, setOpen]                 = useState(false);
  const [showForm, setShowForm]         = useState(false);
  const [selected, setSelected]         = useState<Proposal | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [form, setForm]                 = useState({
    title: '', what_to_build: '', what_it_does: '',
    why_we_want_it: '', where_it_lives: '', what_it_connects_to: '',
  });

  const load = useCallback(async () => {
    const r = await fetch('/requests/scrum/proposals/list', { headers: AUTH });
    if (r.ok) setProposals(await r.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      const r = await fetch('/requests/scrum/proposals', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (r.ok) {
        setShowForm(false);
        setForm({ title: '', what_to_build: '', what_it_does: '', why_we_want_it: '', where_it_lives: '', what_it_connects_to: '' });
        load();
        setOpen(true);
      }
    } finally { setSubmitting(false); }
  };

  const pending   = proposals.filter(p => p.status === 'pending');
  const rest      = proposals.filter(p => p.status !== 'pending');
  const displayed = open ? proposals : pending;

  return (
    <div className={`${cls.card} mb-5`}>
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 cursor-pointer"
        onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-2.5">
          <Lightbulb className="w-4 h-4 text-violet-400" />
          <span className={cls.sectionTitle}>Feature Proposals</span>
          {pending.length > 0 && (
            <span className="text-[10px] font-bold bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full">
              {pending.length} pending
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); setShowForm(true); }}
            className="flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-800 transition-colors"
          >
            <Plus className="w-3 h-3" />Propose a Feature
          </button>
          {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </div>

      {/* Proposal list */}
      {(open || pending.length > 0) && (
        <div>
          {displayed.length === 0 ? (
            <p className="text-[12px] text-slate-400 px-4 py-3">No proposals yet.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {displayed.map(p => (
                <div
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    p.status === 'pending'   ? 'bg-violet-400' :
                    p.status === 'converted' ? 'bg-emerald-400' : 'bg-slate-300'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-slate-700 truncate">{p.title}</p>
                    <p className="text-[11px] text-slate-400">
                      {p.submitted_by} · {new Date(p.created_at).toLocaleDateString()}
                      {p.status === 'converted' && <span className="ml-1.5 text-emerald-500 font-medium">Converted</span>}
                    </p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                </div>
              ))}
              {!open && rest.length > 0 && (
                <button
                  onClick={() => setOpen(true)}
                  className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600 py-2.5 transition-colors"
                >
                  + {rest.length} more (converted / dismissed)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Submit form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-violet-500 mb-1">New Proposal</p>
                <h3 className={cls.sectionTitle}>Propose a Feature</h3>
              </div>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={cls.eyebrow + ' mb-1'}>Title *</label>
                <input
                  value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  className={cls.inputFull + ' text-sm'}
                  placeholder="Short name for this feature"
                  autoFocus
                />
              </div>
              {PROPOSAL_FIELDS.map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className={cls.eyebrow + ' mb-1'}>{label}</label>
                  <textarea
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                    rows={3}
                    className={cls.inputFull + ' text-sm resize-none'}
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button onClick={() => setShowForm(false)}
                className="text-[11px] text-slate-500 hover:text-slate-700 px-3 py-1.5">Cancel</button>
              <button
                onClick={submit}
                disabled={submitting || !form.title.trim()}
                className="text-[11px] font-semibold bg-[#1E293B] text-cvc-gold px-4 py-1.5 rounded hover:bg-slate-700 transition-colors disabled:opacity-40"
              >
                {submitting ? 'Submitting…' : 'Submit Proposal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <ProposalDetailModal
          proposal={selected}
          onClose={() => setSelected(null)}
          onConverted={() => { load(); onConverted(); }}
          onDismissed={load}
        />
      )}
    </div>
  );
}

function ScrumView() {
  const [items, setItems]         = useState<ScrumItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<ScrumItem | null>(null);
  const [showNew, setShowNew]     = useState(false);
  const [newForm, setNewForm]     = useState({ title: '', category: 'product', status: 'exploring' });
  const [creating, setCreating]   = useState(false);
  const [filterCat, setFilterCat] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/requests/scrum', { headers: AUTH });
      if (r.ok) setItems(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createItem = async () => {
    if (!newForm.title.trim()) return;
    setCreating(true);
    try {
      const r = await fetch('/requests/scrum', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm),
      });
      if (r.ok) { setShowNew(false); setNewForm({ title: '', category: 'product', status: 'exploring' }); load(); }
    } finally { setCreating(false); }
  };

  const visible = filterCat ? items.filter(i => i.category === filterCat) : items;

  return (
    <div>
      {/* Feature Proposals */}
      <ProposalsSection onConverted={load} />

      {/* Controls */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setFilterCat('')}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              filterCat === '' ? 'bg-[#1E293B] text-white border-[#1E293B]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}
          >All</button>
          {Object.entries(SCRUM_CATEGORIES).map(([k, v]) => (
            <button key={k}
              onClick={() => setFilterCat(k)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                filterCat === k ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
              style={filterCat === k ? { background: v.color, borderColor: v.color } : {}}
            >{v.label}</button>
          ))}
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 text-[11px] font-semibold bg-[#1E293B] text-cvc-gold px-3 py-1.5 rounded hover:bg-slate-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />New Item
        </button>
      </div>

      {/* New item form */}
      {showNew && (
        <div className={`${cls.card} ${cls.cardPadded} mb-4`}>
          <p className={cls.sectionTitle + ' mb-3'}>New Scrum Item</p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="col-span-2">
              <label className={cls.eyebrow + ' mb-1'}>Title</label>
              <input
                value={newForm.title}
                onChange={e => setNewForm(p => ({ ...p, title: e.target.value }))}
                className={cls.inputFull + ' text-sm'}
                placeholder="e.g. DD Platform for Partners"
                autoFocus
              />
            </div>
            <div>
              <label className={cls.eyebrow + ' mb-1'}>Category</label>
              <select
                value={newForm.category}
                onChange={e => setNewForm(p => ({ ...p, category: e.target.value }))}
                className={cls.select + ' text-sm w-full'}
              >
                {Object.entries(SCRUM_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={cls.eyebrow + ' mb-1'}>Status</label>
              <select
                value={newForm.status}
                onChange={e => setNewForm(p => ({ ...p, status: e.target.value }))}
                className={cls.select + ' text-sm w-full'}
              >
                {Object.entries(SCRUM_STATUSES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNew(false)} className="text-[11px] text-slate-500 hover:text-slate-700 px-3 py-1.5">Cancel</button>
            <button
              onClick={createItem}
              disabled={creating || !newForm.title.trim()}
              className="flex items-center gap-1 text-[11px] font-semibold bg-[#1E293B] text-cvc-gold px-3 py-1.5 rounded disabled:opacity-40 hover:bg-slate-700 transition-colors"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Cards */}
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : visible.length === 0 ? (
        <div className={`${cls.card} ${cls.cardPadded} text-center py-16`}>
          <Lightbulb className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className={cls.sectionTitle}>No items yet</p>
          <p className="text-sm text-slate-500 mt-1">Add product ideas, PoCs, and MVPs here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* Pinned intelligence cards — always first, unaffected by category filter */}
          <WefDataCard />
          <DataExplorerCard />
          {visible.map(item => {
            const cat    = SCRUM_CATEGORIES[item.category] ?? { label: item.category, color: '#94a3b8' };
            const status = SCRUM_STATUSES[item.status]     ?? SCRUM_STATUSES.exploring;
            return (
              <div
                key={item.id}
                onClick={() => setSelected(item)}
                className={`${cls.card} p-4 cursor-pointer hover:shadow-cvc-hover transition-all border-t-2`}
                style={{ borderTopColor: cat.color }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: cat.color }}>{cat.label}</span>
                    <h3 className="text-sm font-semibold text-slate-800 mt-0.5 leading-snug">{item.title}</h3>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0 mt-1" />
                </div>
                {item.overview && (
                  <p className="text-[12px] text-slate-500 line-clamp-2 mb-3 leading-relaxed">{item.overview}</p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${status.bg}`}
                    style={{ color: status.color }}>{status.label}</span>
                  {item.owner && (
                    <span className="text-[10px] text-slate-400">{item.owner}</span>
                  )}
                  {item.update_count > 0 && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-0.5 ml-auto">
                      <Clock className="w-2.5 h-2.5" />{item.update_count}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <ScrumDetailPanel
          item={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => { load(); setSelected(prev => prev ? { ...prev } : null); }}
        />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RequestsPage() {
  const [searchParams] = useSearchParams();
  const [pageTab] = useState<'requests'>('requests');
  const [skirmishes, setSkirmishes] = useState<Skirmish[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filterStatus, setFilterStatus]   = useState<string>('');
  const [filterService, setFilterService] = useState<string>('');
  const [selected, setSelected]     = useState<Skirmish | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus)  params.set('status', filterStatus);
      if (filterService) params.set('service_type', filterService);
      const res = await fetch(`/requests?${params}`, { headers: AUTH });
      if (res.ok) {
        const d = await res.json();
        const list: Skirmish[] = d.requests ?? [];
        setSkirmishes(list);
        // Deep-link: ?open=ID auto-opens the drawer
        const openId = searchParams.get('open');
        if (openId) {
          const target = list.find(s => s.id === parseInt(openId, 10));
          if (target) setSelected(target);
        }
      }
    } finally { setLoading(false); }
  }, [filterStatus, filterService, searchParams]);

  useEffect(() => { load(); }, [load]);

  const open   = skirmishes.filter(s => s.status === 'open').length;
  const active = skirmishes.filter(s => s.status === 'active').length;

  return (
    <div className={cls.page}>
      <CVCNavbar />
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className={cls.pageTitle}>Requests</h1>
            <p className="text-sm text-slate-500 mt-0.5">Active partner service engagements</p>
          </div>
          {pageTab === 'requests' && (
            <div className="flex items-center gap-3">
              {open > 0 && (
                <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-0.5 font-semibold">
                  {open} open
                </span>
              )}
              {active > 0 && (
                <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-0.5 font-semibold">
                  {active} active
                </span>
              )}
            </div>
          )}
        </div>

        {/* Requests tab */}
        {true && <>

        {/* Filters */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className={cls.select + ' text-sm py-1.5'}
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
          <select
            value={filterService}
            onChange={e => setFilterService(e.target.value)}
            className={cls.select + ' text-sm py-1.5'}
          >
            <option value="">All services</option>
            {Object.entries(SERVICE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : skirmishes.length === 0 ? (
          <div className={`${cls.card} ${cls.cardPadded} text-center py-16`}>
            <InboxIcon className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className={cls.sectionTitle}>No requests yet</p>
            <p className="text-sm text-slate-500 mt-1">
              Service requests submitted from Partner Terminal will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {skirmishes.map(s => {
              const sc = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.open;
              const svcColor = SERVICE_COLORS[s.service_type] ?? '#94a3b8';
              return (
                <div key={s.id} className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3 items-start">
                <div
                  onClick={() => setSelected(s)}
                  className={`${cls.card} p-4 cursor-pointer hover:shadow-cvc-hover transition-all border-l-2`}
                  style={{ borderLeftColor: svcColor + '60' }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: svcColor }}>
                          {SERVICE_LABELS[s.service_type] ?? s.service_type}
                        </span>
                        {s.partner_name && (
                          <span className="text-[10px] text-slate-500">· {s.partner_name}</span>
                        )}
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${sc.bg}`} style={{ color: sc.color }}>
                          {sc.label}
                        </span>
                        <span className={`text-[10px] font-semibold uppercase ${PRIORITY_COLORS[s.priority]}`}>
                          {s.priority}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <p className="text-sm font-semibold text-slate-800 leading-snug">{s.title}</p>
                        {s.service_type === 'assignment' && /evaluation by sector/i.test(s.title) && (
                          <Link
                            to={s.service_fields.subsector
                              ? `/ventures/evaluation?sector=${encodeURIComponent(s.service_fields.sector)}&subsector=${encodeURIComponent(s.service_fields.subsector)}`
                              : '/ventures/evaluation'}
                            onClick={e => e.stopPropagation()}
                            className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800 transition-colors flex items-center gap-0.5"
                          >
                            <ExternalLink className="w-2.5 h-2.5" />Open Form
                          </Link>
                        )}
                      </div>
                      {s.service_type === 'assignment' && /evaluation by sector/i.test(s.title) && (
                        <EvalCompletionMini
                          sector={s.service_fields.sector}
                          subsector={s.service_fields.subsector}
                        />
                      )}
                      <div className="flex items-center gap-3 flex-wrap mt-1.5">
                        {s.assignees.length > 0 ? (
                          <div className="flex items-center gap-1">
                            {s.assignees.slice(0, 4).map(a => (
                              <span key={a} className="text-[10px] bg-slate-100 text-slate-600 rounded-full px-1.5 py-0.5 border border-slate-200">
                                {a}
                              </span>
                            ))}
                            {s.assignees.length > 4 && (
                              <span className="text-[10px] text-slate-400">+{s.assignees.length - 4}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">Unassigned</span>
                        )}
                        {s.update_count > 0 && (
                          <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> {s.update_count} update{s.update_count !== 1 ? 's' : ''}
                          </span>
                        )}
                        {s.last_update && (
                          <span className="text-[10px] text-slate-400 truncate max-w-[200px]">
                            "{s.last_update.slice(0, 60)}{s.last_update.length > 60 ? '…' : ''}"
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-400 flex-shrink-0 text-right">
                      <div>{fmtTs(s.updated_at)}</div>
                      <div className="text-slate-500">by {s.created_by}</div>
                    </div>
                  </div>
                </div>
                <OutputCard skirmish={s} onUpdated={load} />
                </div>
              );
            })}
          </div>
        )}
        </>}
      </div>
      {selected && (
        <SkirmishDetail
          skirmish={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => { load(); }}
        />
      )}
    </div>
  );
}
