import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import {
  Zap, ClipboardList, Plus, X, ChevronDown, UserPlus, CheckCircle2, Trophy,
  ThumbsUp, ThumbsDown, RefreshCw, ExternalLink, Pencil, Loader, GitMerge, Info,
  ChevronLeft, ChevronRight, BarChart2,
} from 'lucide-react';
import { cls } from '../components/tokens';
import { AUTH_HEADER as AUTH } from '../api/client';
import { api } from '../api/client';
import { PortcoNewsPanel } from '../components/PortcoNewsPanel';
import { DealPipelinePanel } from '../components/DealPipelinePanel';

// ── Helpers ──────────────────────────────────────────────────────────────────

function ageLabel(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 14)  return `${days}d ago`;
  if (days < 60)  return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface TractionItem {
  company_id: number;
  company_name: string;
  score: number;
  stage: string | null;
  intro_count: number;
  velocity_active: boolean;
  stagnating: boolean;
  delta_score: number;
  delta_direction: 'up' | 'down' | 'flat';
}

interface Assignment {
  id: number;
  title: string;
  notes: string | null;
  source: string;
  partner_id: number | null;
  partner_name: string | null;
  company_id: number | null;
  company_name: string | null;
  assigned_users: string[];
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
  created_by: string;
  created_at: string;
  updated_at: string;
  request_id: number | null;
  task_total: number;
  task_done:  number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  open:        'bg-slate-100 text-slate-500 border-slate-200',
  in_progress: 'bg-blue-100 text-blue-700 border-blue-200',
  completed:   'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const STATUS_LABEL: Record<string, string> = {
  open:        'Open',
  in_progress: 'In Progress',
  completed:   'Done',
};

const PRIORITY_DOT: Record<string, string> = {
  high:   'bg-red-400',
  medium: 'bg-amber-400',
  low:    'bg-slate-300',
};

// Ventures team — only these users appear in the Assignments assign dropdown.
// Harry and Frederik are excluded here; they can be added to individual Requests if needed.
const TEAM_MEMBERS = ['nate', 'jerry', 'harvey', 'harshal', 'praj'];

// ── Assignments Panel ────────────────────────────────────────────────────────

function AssignmentsPanel() {
  const currentUser = api.getCurrentUser();
  const me = currentUser?.username ?? '';
  const canAssignOthers = ['GP', 'Principal', 'Director'].includes(currentUser?.role ?? '');

  const [items, setItems]         = useState<Assignment[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [filter, setFilter]       = useState<'all' | 'mine' | 'unassigned' | 'completed'>('all');
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [slide, setSlide]         = useState<0 | 1>(0); // 0=list, 1=leaderboard

  // New assignment form
  const [form, setForm] = useState({ title: '', priority: 'medium', assigned_users: [] as string[], notes: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/ventures/assignments', { headers: AUTH })
      .then(r => r.json())
      .then(d => setItems(d.assignments ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = items.filter(a => {
    if (filter === 'completed')  return a.status === 'completed';
    if (filter === 'mine')       return a.assigned_users.includes(me) && a.status !== 'completed';
    if (filter === 'unassigned') return a.assigned_users.length === 0 && a.status !== 'completed';
    return a.status !== 'completed';
  });

  const openCount = items.filter(a => a.status === 'open' || a.status === 'in_progress').length;

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    await fetch('/ventures/assignments', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:          form.title.trim(),
        priority:       form.priority,
        assigned_users: form.assigned_users,
        notes:          form.notes || null,
      }),
    });
    setSaving(false);
    setShowAdd(false);
    setForm({ title: '', priority: 'medium', assigned_users: [], notes: '' });
    load();
  };

  const patch = async (id: number, updates: object) => {
    await fetch(`/ventures/assignments/${id}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    load();
  };

  const pickup = (id: number, currentUsers: string[]) => {
    const next = [...new Set([...currentUsers, me])];
    patch(id, { assigned_users: next, status: 'in_progress' });
  };
  const markDone = (id: number) => patch(id, { status: 'completed' });
  const toggleUser = (id: number, username: string, currentUsers: string[]) => {
    setAssigningId(null);
    const next = currentUsers.includes(username)
      ? currentUsers.filter(u => u !== username)
      : [...currentUsers, username];
    patch(id, {
      assigned_users: next,
      status: next.length > 0 ? 'in_progress' : 'open',
    });
  };

  return (
    <div className={cls.card + ' flex flex-col'}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
        <button
          onClick={() => setCollapsed(v => !v)}
          className="flex items-center gap-2 group"
        >
          <ClipboardList className="w-4 h-4 text-slate-500" />
          <span className={cls.sectionTitle}>Assignments</span>
          {openCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
              {openCount}
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        </button>
        {!collapsed && (
          <div className="flex items-center gap-2">
            {/* Slide toggle */}
            <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setSlide(0)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-semibold transition-all ${slide === 0 ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <ClipboardList className="w-3 h-3" /> List
              </button>
              <button
                onClick={() => setSlide(1)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-semibold transition-all ${slide === 1 ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <BarChart2 className="w-3 h-3" /> Leaderboard
              </button>
            </div>
            {slide === 0 && (
              <button
                onClick={() => setShowAdd(v => !v)}
                className="flex items-center gap-1 text-[10px] font-semibold text-slate-700 border border-slate-200 rounded px-2 py-1 hover:border-slate-400 transition-colors"
              >
                {showAdd ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                {showAdd ? 'Cancel' : 'New'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Collapsible body */}
      {!collapsed && (<>

      {/* New assignment form */}
      {showAdd && (
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 space-y-3">
          <input
            autoFocus
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="Assignment title…"
            className="w-full text-sm border border-slate-200 rounded px-3 py-2 outline-none focus:border-slate-400"
          />
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Priority</label>
            <select
              value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Assign to</label>
            <div className="flex flex-wrap gap-1.5">
              {TEAM_MEMBERS.map(u => {
                const selected = form.assigned_users.includes(u);
                return (
                  <button key={u} type="button"
                    onClick={() => setForm(f => ({
                      ...f,
                      assigned_users: selected
                        ? f.assigned_users.filter(x => x !== u)
                        : [...f.assigned_users, u],
                    }))}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                      selected
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700'
                    }`}>
                    {u.charAt(0).toUpperCase() + u.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>
          <textarea
            rows={2}
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Notes (optional)"
            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-none"
          />
          <button
            onClick={handleCreate}
            disabled={saving || !form.title.trim()}
            className="w-full py-1.5 text-xs font-semibold bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Create Assignment'}
          </button>
        </div>
      )}

      {slide === 1 && (() => {
        // Leaderboard: count completions per team member
        const board = TEAM_MEMBERS.map(user => {
          const completed = items.filter(a => a.status === 'completed' && a.assigned_users.includes(user));
          const active    = items.filter(a => a.status !== 'completed' && a.assigned_users.includes(user));
          const last = completed.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
          return { user, completed: completed.length, active: active.length, lastDate: last?.updated_at ?? null };
        }).sort((a, b) => b.completed - a.completed || b.active - a.active);
        const maxCompleted = board[0]?.completed ?? 1;
        return (
          <div className="px-5 py-4 flex-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 w-6">#</th>
                  <th className="text-left py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Associate</th>
                  <th className="text-center py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Active</th>
                  <th className="text-center py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Completed</th>
                  <th className="text-left py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 pl-3">Progress</th>
                  <th className="text-right py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Last Done</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {board.map((row, i) => (
                  <tr key={row.user} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 text-[11px] font-bold text-slate-300 w-6">{i + 1}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-slate-200 text-[10px] font-bold flex items-center justify-center text-slate-600 uppercase shrink-0">
                          {row.user[0]}
                        </span>
                        <span className="text-sm font-semibold text-slate-700 capitalize">{row.user}</span>
                        {i === 0 && row.completed > 0 && <Trophy className="w-3 h-3 text-amber-400" />}
                      </div>
                    </td>
                    <td className="py-3 text-center">
                      <span className={`text-xs font-bold tabular-nums ${row.active > 0 ? 'text-blue-600' : 'text-slate-300'}`}>
                        {row.active}
                      </span>
                    </td>
                    <td className="py-3 text-center">
                      <span className={`text-xs font-bold tabular-nums ${row.completed > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                        {row.completed}
                      </span>
                    </td>
                    <td className="py-3 pl-3">
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden" style={{ minWidth: 60 }}>
                        <div
                          className="h-full rounded-full bg-emerald-400 transition-all"
                          style={{ width: maxCompleted > 0 ? `${Math.round((row.completed / maxCompleted) * 100)}%` : '0%' }}
                        />
                      </div>
                    </td>
                    <td className="py-3 text-right text-[11px] text-slate-400">
                      {row.lastDate
                        ? new Date(row.lastDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : <span className="text-slate-200">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Filter tabs + list — only on list slide */}
      {slide === 0 && <><div className="flex border-b border-slate-100 px-5">
        {([
          { key: 'all',        label: 'Open'       },
          { key: 'mine',       label: 'Mine'       },
          { key: 'unassigned', label: 'Unassigned' },
          { key: 'completed',  label: 'Completed'  },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`py-2 px-1 mr-4 text-[11px] font-semibold border-b-2 transition-colors ${
              filter === key
                ? key === 'completed' ? 'border-emerald-500 text-emerald-700' : 'border-slate-800 text-slate-800'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {label}
            {key === 'completed' && items.filter(a => a.status === 'completed').length > 0 && (
              <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                {items.filter(a => a.status === 'completed').length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="overflow-y-auto max-h-72 divide-y divide-slate-50">
        {loading ? (
          <div className="py-10 text-center text-slate-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-slate-400 text-sm">
            {filter === 'completed'  ? 'No completed assignments yet' :
             filter === 'mine'       ? 'Nothing assigned to you' :
             filter === 'unassigned' ? 'No unassigned tasks' :
             'No open assignments'}
          </div>
        ) : filter === 'completed' ? (
          /* ── Completed history view ── */
          <div className="divide-y divide-slate-50">
            {filtered.map(a => (
              <div key={a.id} className="px-5 py-3 hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 leading-snug">{a.title}</p>
                    {(a.partner_name || a.company_name) && (
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {a.partner_name && <span>Partner: {a.partner_name}</span>}
                        {a.company_name && <Link to={`/company/${a.company_id}`} className="hover:underline">{a.partner_name ? ' · ' : ''}{a.company_name}</Link>}
                      </p>
                    )}
                  </div>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-700 border-emerald-200 shrink-0">
                    Done
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">Completed by</p>
                    <div className="flex flex-wrap gap-1">
                      {(a.assigned_users.length > 0 ? a.assigned_users : [a.created_by]).map(u => (
                        <span key={u} className="flex items-center gap-0.5">
                          <span className="w-4 h-4 rounded-full bg-slate-200 text-[7px] font-bold flex items-center justify-center text-slate-600 uppercase">{u[0]}</span>
                          <span className="text-xs font-semibold text-slate-700 capitalize">{u}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">Assigned</p>
                    <p className="text-xs text-slate-600">{new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">Completed</p>
                    <p className="text-xs text-slate-600">{new Date(a.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                  </div>
                </div>
                {a.notes && <p className="mt-1.5 text-[11px] text-slate-400 italic">"{a.notes}"</p>}
              </div>
            ))}
          </div>
        ) : (
          filtered.map(a => (
            <div key={a.id} className="px-5 py-3.5 hover:bg-slate-50 transition-colors group">
              <div className="flex items-start gap-2">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${PRIORITY_DOT[a.priority]}`} />
                <div className="flex-1 min-w-0">

                  {/* Title + status — title routes to Requests if there's a linked request */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.request_id ? (
                      <Link to="/requests"
                        className="text-sm font-medium text-slate-800 hover:text-blue-700 hover:underline leading-snug transition-colors">
                        {a.title}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-slate-800 leading-snug">{a.title}</span>
                    )}
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${STATUS_STYLE[a.status]}`}>
                      {STATUS_LABEL[a.status]}
                    </span>
                    <span className="text-[10px] text-slate-400" title={new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}>
                      {ageLabel(a.created_at)}
                    </span>
                    {a.request_id && (
                      <Link to="/requests"
                        className="flex items-center gap-0.5 text-[10px] text-blue-500 hover:text-blue-700 transition-colors">
                        <ExternalLink className="w-2.5 h-2.5" />Requests
                      </Link>
                    )}
                    {/evaluation by sector/i.test(a.title) && (
                      <Link to="/ventures/evaluation"
                        className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800 transition-colors">
                        Open Form →
                      </Link>
                    )}
                  </div>

                  {/* Context: partner or company */}
                  {(a.partner_name || a.company_name) && (
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {a.partner_name && <span>Partner: {a.partner_name}</span>}
                      {a.company_name && (
                        <Link to={`/company/${a.company_id}`} className="hover:underline">
                          {a.partner_name ? ' · ' : ''}{a.company_name}
                        </Link>
                      )}
                    </p>
                  )}

                  {/* Assignee pills */}
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {a.assigned_users.length > 0 ? (
                      a.assigned_users.map(u => (
                        <span key={u} className="flex items-center gap-1 text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                          <span className="w-3.5 h-3.5 rounded-full bg-slate-400 text-[8px] font-bold flex items-center justify-center text-white uppercase">
                            {u[0]}
                          </span>
                          {u}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-slate-400 italic">Unassigned</span>
                    )}
                  </div>

                  {/* Task progress */}
                  {a.task_total > 0 && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden" style={{ maxWidth: 80 }}>
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            a.task_done === a.task_total ? 'bg-emerald-500' : 'bg-blue-400'
                          }`}
                          style={{ width: `${Math.round((a.task_done / a.task_total) * 100)}%` }}
                        />
                      </div>
                      <span className={`text-[10px] font-semibold tabular-nums ${
                        a.task_done === a.task_total ? 'text-emerald-600' : 'text-slate-500'
                      }`}>
                        {a.task_done}/{a.task_total} tasks
                      </span>
                    </div>
                  )}

                  {/* Actions row */}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {/* Pick up — add self if not already assigned */}
                    {!a.assigned_users.includes(me) && a.status !== 'completed' && (
                      <button
                        onClick={() => pickup(a.id, a.assigned_users)}
                        className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        Pick up
                      </button>
                    )}

                    {/* Assign dropdown — Principal+ can toggle any team member */}
                    {canAssignOthers && a.status !== 'completed' && (
                      <div className="relative">
                        <button
                          onClick={() => setAssigningId(assigningId === a.id ? null : a.id)}
                          className="flex items-center gap-0.5 text-[10px] font-semibold text-slate-400 hover:text-slate-700 transition-colors"
                        >
                          <UserPlus className="w-3 h-3" />
                          Assign
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                        {assigningId === a.id && (
                          <div className="absolute left-0 top-full mt-1 w-40 bg-white border border-slate-200 rounded shadow-lg z-30 overflow-hidden">
                            {TEAM_MEMBERS.map(u => {
                              const assigned = a.assigned_users.includes(u);
                              return (
                                <button
                                  key={u}
                                  onClick={() => toggleUser(a.id, u, a.assigned_users)}
                                  className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                                    assigned ? 'bg-slate-50 text-slate-800 font-semibold' : 'hover:bg-slate-50 text-slate-600'
                                  }`}
                                >
                                  <span>{u.charAt(0).toUpperCase() + u.slice(1)}</span>
                                  {assigned && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Mark done */}
                    {a.status !== 'completed' && (
                      <button
                        onClick={() => markDone(a.id)}
                        className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 hover:text-emerald-800 transition-all"
                      >
                        <CheckCircle2 className="w-3 h-3" /> Done
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      </>}

      </>)}
    </div>
  );
}

// ── Corporate Traction Chart ─────────────────────────────────────────────────

function TractionChart() {
  const [win, setWin] = useState<'14d' | '2mo' | '6mo'>('2mo');
  const [items, setItems] = useState<TractionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/home/traction?window=${win}`, { headers: AUTH })
      .then(r => r.json())
      .then(d => setItems(d.companies ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [win]);

  const top = items.slice(0, 5);

  return (
    <div className={cls.card + ' flex flex-col h-full'}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
        <button
          onClick={() => setCollapsed(v => !v)}
          className="flex items-center gap-2 group"
        >
          <Zap className="w-4 h-4 text-amber-500" />
          <span className={cls.sectionTitle}>Corporate Traction</span>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        </button>
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
        {!collapsed && (
          <div className="flex gap-0.5">
            {(['14d', '2mo', '6mo'] as const).map(w => (
              <button key={w} onClick={() => setWin(w)}
                className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-all ${
                  win === w ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-700'
                }`}>
                {w}
              </button>
            ))}
          </div>
        )}
      </div>

      {!collapsed && (loading ? (
        <div className="px-5 py-8 text-center text-slate-400 text-sm">Loading…</div>
      ) : top.length === 0 ? (
        <div className="px-5 py-8 text-center text-slate-400 text-sm">
          No traction data yet — PSMs need to log outcomes.
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {top.map((item, i) => (
            <Link key={item.company_id} to={`/company/${item.company_id}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-[#ede8d7] transition-colors group">
              <span className="text-[10px] font-bold text-slate-300 w-4 shrink-0 tabular-nums">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm text-slate-700 group-hover:text-slate-900 truncate">{item.company_name}</span>
                  {item.stage && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                      {item.stage}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {item.velocity_active && <span className="text-[9px] text-amber-600 font-semibold">⚡ Rising</span>}
                  {item.stagnating      && <span className="text-[9px] text-slate-400">⚠ Stale</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {item.delta_direction !== 'flat' && (
                  <span className={`text-[10px] font-bold ${item.delta_direction === 'up' ? 'text-emerald-500' : 'text-red-400'}`}>
                    {item.delta_direction === 'up' ? '+' : '−'}
                  </span>
                )}
                <span className="text-xs font-bold text-slate-800 tabular-nums">{item.score}</span>
              </div>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── 2026 Investment Leaderboard ───────────────────────────────────────────────

interface LeaderboardEntry { username: string; investments: number; }

const MEDAL = ['🥇', '🥈', '🥉'];
const AVATAR_COLORS: Record<string, string> = {
  harvey:   'bg-blue-100 text-blue-700',
  jerry:    'bg-violet-100 text-violet-700',
  praj:     'bg-emerald-100 text-emerald-700',
  sterling: 'bg-slate-100 text-slate-500',
};

function InvestmentLeaderboard({ selectedUser, onSelect }: {
  selectedUser: string | null;
  onSelect: (u: string | null) => void;
}) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    fetch('/dealflow/leaderboard', { headers: AUTH })
      .then(r => r.json())
      .then(d => setEntries(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  if (!entries.length) return null;

  const sorted = [...entries].sort((a, b) => b.investments - a.investments || a.username.localeCompare(b.username));

  return (
    <div className="flex items-center gap-4 mb-4 pb-3 border-b border-slate-100">
      <div className="flex items-center gap-1 shrink-0">
        <Trophy className="w-3 h-3 text-amber-400" />
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">2026</span>
      </div>
      {sorted.map((e, i) => {
        const medal = i === 0 && e.investments > 0 ? MEDAL[0] : i === 1 && e.investments > 0 ? MEDAL[1] : i === 2 && e.investments > 0 ? MEDAL[2] : null;
        const avatarCls = AVATAR_COLORS[e.username] ?? 'bg-slate-100 text-slate-500';
        const active = selectedUser === e.username;
        return (
          <button
            key={e.username}
            onClick={() => onSelect(active ? null : e.username)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full transition-all ${
              active ? 'bg-slate-800 shadow-sm' : 'hover:bg-slate-100'
            }`}
          >
            <span className={`w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center uppercase ${active ? 'bg-white text-slate-800' : avatarCls}`}>
              {e.username[0]}
            </span>
            <span className={`text-xs capitalize ${active ? 'text-white font-semibold' : 'text-slate-600'}`}>{e.username}</span>
            <span className={`text-xs font-bold tabular-nums ${active ? 'text-amber-400' : 'text-slate-800'}`}>{e.investments}</span>
            {medal && <span className="text-xs leading-none">{medal}</span>}
          </button>
        );
      })}
      {selectedUser && (
        <button onClick={() => onSelect(null)} className="text-[10px] text-slate-400 hover:text-slate-600 underline ml-1">
          Clear filter
        </button>
      )}
    </div>
  );
}

// ── Human Review Panel ───────────────────────────────────────────────────────

interface IntelSuggestion {
  id: number;
  company_id: number;
  company_name: string;
  sector?: string;
  suggestion_type: string;
  suggested_data: {
    round_type?: string;
    amount_usd?: number;
    announced_date?: string;
    investors?: string[];
    valuation_usd?: number;
    approximate?: boolean;
    source_url?: string;
    title?: string;
    url?: string;
    snippet?: string;
    age?: string;
  };
  confidence: number;
  status: string;
}

function HumanReviewPanel() {
  const [suggestions, setSuggestions] = useState<IntelSuggestion[]>([]);
  const [loading, setLoading]         = useState(true);
  const [actioning, setActioning]     = useState<number | null>(null);
  const [editingSourceId, setEditingSourceId] = useState<number | null>(null);
  const [sourceOverrides, setSourceOverrides] = useState<Record<number, string>>({});

  const load = () => {
    setLoading(true);
    fetch('/admin/suggestions?suggestion_type=new_funding_round,case_study&status=pending', { headers: AUTH })
      .then(r => r.ok ? r.json() : [])
      .then(d => setSuggestions(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();

    // SSE — removes row instantly when the extension fires a decision
    const token = localStorage.getItem('cvc_jwt') ?? '';
    const es = new EventSource(`/review/stream?token=${encodeURIComponent(token)}`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.suggestion_id) {
          setSuggestions(prev => prev.filter(s => s.id !== msg.suggestion_id));
        }
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => { /* browser auto-reconnects */ };

    // Polling fallback — catches any SSE misses (tab not active, connection drop)
    const poll = setInterval(load, 30_000);

    return () => { es.close(); clearInterval(poll); };
  }, []);

  const approve = async (id: number, sourceOverride?: string) => {
    setActioning(id);
    const body: Record<string, string> = {};
    if (sourceOverride) body.source_url = sourceOverride;
    await fetch(`/admin/suggestions/${id}/approve`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSuggestions(prev => prev.filter(s => s.id !== id));
    setActioning(null);
  };

  const reject = async (id: number) => {
    setActioning(id);
    await fetch(`/admin/suggestions/${id}/reject`, { method: 'POST', headers: AUTH });
    setSuggestions(prev => prev.filter(s => s.id !== id));
    setActioning(null);
  };

  const fmt = (n?: number | null) => {
    if (!n) return '—';
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  };

  const confColor = (c: number) =>
    c >= 0.9 ? '#10b981' : c >= 0.7 ? '#f59e0b' : '#ef4444';

  const fundingRows   = suggestions.filter(s => s.suggestion_type === 'new_funding_round');
  const caseStudyRows = suggestions.filter(s => s.suggestion_type === 'case_study');

  const ActionButtons = ({ s }: { s: IntelSuggestion }) => {
    const isActioning = actioning === s.id;
    const override = sourceOverrides[s.id];
    return (
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => approve(s.id, override || undefined)}
          disabled={isActioning}
          title={override ? `Approve with source: ${override}` : 'Approve'}
          className="p-1.5 rounded text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40"
        >
          {isActioning ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => reject(s.id)}
          disabled={isActioning}
          title="Reject"
          className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  return (
    <div className={cls.card}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <GitMerge className="w-4 h-4 text-violet-500" />
          <span className={cls.sectionTitle}>Human Review</span>
          {!loading && suggestions.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
              {suggestions.length}
            </span>
          )}
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Scrollable body */}
      <div className="overflow-y-auto max-h-[520px]">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800 border-r-transparent" />
          </div>
        ) : suggestions.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <GitMerge className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No pending suggestions</p>
          </div>
        ) : (
          <div className="p-5 space-y-8">
            <p className="text-xs text-slate-500">
              {suggestions.length} pending — approve to write to DB, reject to dismiss
            </p>

            {/* Funding Rounds */}
            {fundingRows.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-800 mb-3">
                  Funding Round Suggestions
                  <span className="ml-1.5 text-xs font-normal text-slate-400">{fundingRows.length}</span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        {['Company', 'Round', 'Amount', 'Date', 'Investors', 'Conf.', 'Source', ''].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {fundingRows.map(s => {
                        const d = s.suggested_data;
                        return (
                          <tr key={s.id} className="hover:bg-slate-50">
                            <td className="px-3 py-3">
                              <Link to={`/company/${s.company_id}`} className="font-medium text-slate-800 hover:underline leading-tight block">
                                {s.company_name}
                              </Link>
                              {s.sector && <div className="text-[10px] text-slate-400 mt-0.5">{s.sector}</div>}
                            </td>
                            <td className="px-3 py-3">
                              <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-violet-50 text-violet-700">
                                {d.round_type ?? '—'}
                              </span>
                              {d.approximate && <span className="ml-1 text-[10px] text-slate-400">~</span>}
                            </td>
                            <td className="px-3 py-3 font-medium text-slate-800">{fmt(d.amount_usd)}</td>
                            <td className="px-3 py-3 text-xs text-slate-500">{d.announced_date ?? '—'}</td>
                            <td className="px-3 py-3 text-xs text-slate-500 max-w-[160px]">
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
                                    className="w-full text-[10px] border border-indigo-400 rounded px-1.5 py-1 outline-none bg-white"
                                  />
                                  <button onClick={() => setEditingSourceId(null)}
                                    className="text-[9px] text-slate-400 hover:text-slate-700 text-left">
                                    {sourceOverrides[s.id] ? '✓ saved — approve to confirm' : 'cancel'}
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 group">
                                  {(() => {
                                    const url = sourceOverrides[s.id] || d.source_url;
                                    if (!url) return <span className="text-[10px] text-slate-400">—</span>;
                                    let hostname = 'source';
                                    try { hostname = new URL(url).hostname.replace('www.', ''); } catch {}
                                    return (
                                      <a href={url} target="_blank" rel="noopener noreferrer"
                                        className={`flex items-center gap-1 text-[10px] hover:underline ${sourceOverrides[s.id] ? 'text-emerald-600 font-semibold' : 'text-indigo-500'}`}>
                                        {hostname}
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    );
                                  })()}
                                  <button onClick={() => setEditingSourceId(s.id)} title="Edit source URL"
                                    className="p-0.5 rounded text-slate-300 hover:text-indigo-500 transition-colors">
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
              </div>
            )}

            {/* Case Studies */}
            {caseStudyRows.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-800 mb-3">
                  Case Study Suggestions
                  <span className="ml-1.5 text-xs font-normal text-slate-400">{caseStudyRows.length} — sourced by Brave Search</span>
                </h3>
                <div className="space-y-2">
                  {caseStudyRows.map(s => {
                    const d = s.suggested_data;
                    return (
                      <div key={s.id} className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Link to={`/company/${s.company_id}`}
                                className="text-xs font-semibold text-indigo-600 hover:underline">
                                {s.company_name}
                              </Link>
                              {s.sector && <span className="text-[10px] text-slate-400">{s.sector}</span>}
                              <span className="text-[10px] font-bold ml-auto" style={{ color: confColor(s.confidence) }}>
                                {Math.round(s.confidence * 100)}%
                              </span>
                            </div>
                            <p className="text-xs font-medium text-slate-800 leading-snug mb-1">{d.title || '—'}</p>
                            {d.snippet && <p className="text-[11px] text-slate-500 leading-snug mb-1.5 line-clamp-2">{d.snippet}</p>}
                            <div className="flex items-center gap-3">
                              {d.url && (
                                <a href={d.url} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-[10px] text-indigo-500 hover:underline">
                                  {(() => { try { return new URL(d.url).hostname.replace('www.', ''); } catch { return 'source'; } })()}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                              {d.age && <span className="text-[10px] text-slate-400">{d.age}</span>}
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
        )}
      </div>
    </div>
  );
}

// ── Main Export ──────────────────────────────────────────────────────────────

export default function VenturesOverview() {
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">

      {/* Page header */}
      <div className="border-b-2 border-[#151411] pb-5 mb-6">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">SLAM · Ventures</p>
        <h1 className={cls.pageTitle}>Overview</h1>
      </div>

      {/* Top row: Assignments (left) + Traction (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6 items-stretch">
        <AssignmentsPanel />
        <TractionChart />
      </div>

      {/* Investment Pipeline */}
      <div className={cls.cardPadded}>
        <h2 className={cls.sectionTitle + ' mb-4'}>Investment Pipeline</h2>
        <InvestmentLeaderboard selectedUser={selectedUser} onSelect={setSelectedUser} />
        <DealPipelinePanel filterUser={selectedUser} />
      </div>

      {/* Portco News */}
      <PortcoNewsPanel />

      {/* Human Review */}
      <HumanReviewPanel />
    </div>
  );
}
