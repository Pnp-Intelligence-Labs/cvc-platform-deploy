import { useState, useEffect, useCallback } from 'react';
import { CVCNavbar } from '../components/CVCNavbar';
import { CheckCircle, Clock, Zap, Package, Rocket, XCircle, RefreshCw } from 'lucide-react';
import { cls } from '../components/tokens';
import { AUTH_HEADER as AUTH } from '../api/client';


interface Task {
  task_id: number;
  spec: string;
  priority: string;
  risk_level: string;
  requires_approval: boolean;
  status: string;
  created_by: string;
  assigned_to: string;
  commit_hash?: string;
  nate_approved_at?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  deployed_at?: string;
  status_changed_at: string;
  notes?: string;
}

interface Stats {
  pending: number;
  approved: number;
  building: number;
  complete: number;
  deployed: number;
  failed: number;
  on_hold: number;
  closed: number;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string; icon: any; cardAccent: string }> = {
  pending:    { label: 'Pending',    bg: '#f1f5f9', text: '#64748b', dot: '#94a3b8', icon: Clock,       cardAccent: '#94a3b8' },
  approved:   { label: 'Approved',   bg: '#fefce8', text: '#a16207', dot: '#F59E0B', icon: CheckCircle,  cardAccent: '#F59E0B' },
  building:   { label: 'Building',   bg: '#eff6ff', text: '#1d4ed8', dot: '#3b82f6', icon: Zap,          cardAccent: '#3b82f6' },
  complete:   { label: 'Complete',   bg: '#f0fdf4', text: '#15803d', dot: '#86efac', icon: Package,      cardAccent: '#86efac' },
  deployed:   { label: 'Deployed',   bg: '#253B49', text: '#ffffff', dot: '#F59E0B', icon: Rocket,       cardAccent: '#4a7c59' },
  failed:     { label: 'Failed',     bg: '#fef2f2', text: '#b91c1c', dot: '#ef4444', icon: XCircle,      cardAccent: '#ef4444' },
  superseded: { label: 'Superseded', bg: '#f8f8f8', text: '#9ca3af', dot: '#d1d5db', icon: XCircle,      cardAccent: '#d1d5db' },
  on_hold:    { label: 'On Hold',    bg: '#fff7ed', text: '#c2410c', dot: '#fb923c', icon: Clock,        cardAccent: '#fb923c' },
  closed:     { label: 'Closed',     bg: '#f1f5f9', text: '#94a3b8', dot: '#cbd5e1', icon: XCircle,      cardAccent: '#cbd5e1' },
};

const PRI_COLORS: Record<string, string> = {
  high: '#b91c1c', medium: '#a16207', low: '#64748b',
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const pulsing = status === 'building';
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide"
      style={{ background: cfg.bg, color: cfg.text }}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${pulsing ? 'animate-pulse' : ''}`}
        style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function StatCard({ status, count }: { status: string; count: number }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <div className="bg-white rounded-lg border border-[#e5e7eb] p-5 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: cfg.cardAccent }} />
      <div className="text-4xl font-bold text-[#253B49] leading-none mb-2">{count}</div>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">{cfg.label}</div>
        <Icon className="w-5 h-5 opacity-20 text-[#253B49]" />
      </div>
    </div>
  );
}

function TaskDetailModal({ task, onClose }: { task: Task; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}>
        {/* Fixed header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-[#e5e7eb] flex-shrink-0">
          <div>
            <div className="text-xs font-bold text-[#94a3b8] uppercase tracking-wide mb-1">Task #{task.task_id}</div>
            <div className="flex items-center gap-2">
              <StatusPill status={task.status} />
              <span className="text-xs font-bold uppercase" style={{ color: PRI_COLORS[task.priority] }}>
                {task.priority}
              </span>
              <span className="text-xs px-2 py-0.5 rounded border border-[#e5e7eb] text-[#64748b]">
                Risk: {task.risk_level}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-[#94a3b8] hover:text-[#374151] text-xl leading-none">&times;</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <div className="bg-[#f8fafc] rounded-lg p-4 border border-[#e5e7eb]">
            <div className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-2">Specification</div>
            <p className="text-sm text-[#253B49] leading-relaxed whitespace-pre-wrap">{task.spec}</p>
          </div>

          {task.notes && (
            <div className="bg-[#fefce8] rounded-lg p-4 border border-[#fde68a]">
              <div className="text-xs font-semibold text-[#a16207] uppercase tracking-wide mb-1">Notes</div>
              <p className="text-sm text-[#374151]">{task.notes}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Created by', task.created_by],
              ['Assigned to', task.assigned_to],
              ['Created', new Date(task.created_at).toLocaleString()],
              task.started_at   ? ['Started',   new Date(task.started_at).toLocaleString()]   : null,
              task.completed_at ? ['Completed', new Date(task.completed_at).toLocaleString()] : null,
              task.deployed_at  ? ['Deployed',  new Date(task.deployed_at).toLocaleString()]  : null,
              task.commit_hash  ? ['Commit', task.commit_hash.substring(0, 8)]                : null,
            ].filter(Boolean).map(([label, value]) => (
              <div key={label as string} className="flex flex-col">
                <span className="text-xs text-[#94a3b8] font-medium mb-0.5">{label}</span>
                <span className="text-[#374151] font-medium">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Activity Tab ──────────────────────────────────────────────────────────────

interface BatchJobRow {
  id: number; job_type: string; target_type: string; sector: string | null;
  status: string; created_by: string; started_at: string | null;
  completed_at: string | null; progress_current: number; progress_total: number;
  error_message: string | null; created_at: string;
}
interface LLMRow {
  activity: string; model: string; prompt_tokens: number; completion_tokens: number;
  total_cost: number; calls: number; last_called: string;
}
interface ChangeRow {
  id: number; company_name: string; company_id: number; changed_by: string;
  field_name: string; old_value: string | null; new_value: string | null;
  change_source: string; changed_at: string;
}

function ActivityTab() {
  const [data, setData] = useState<{ batch_jobs: BatchJobRow[]; llm_usage: LLMRow[]; company_changes: ChangeRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<'batch' | 'llm' | 'changes'>('batch');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/admin/activity', { headers: AUTH });
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function dur(start: string | null, end: string | null) {
    if (!start || !end) return '—';
    const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  function fmtDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const statusColor = (s: string) =>
    s === 'completed' ? 'text-green-700 bg-green-50' :
    s === 'failed'    ? 'text-red-700 bg-red-50' :
    s === 'running'   ? 'text-blue-700 bg-blue-50' : 'text-gray-600 bg-gray-50';

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-[#253B49]">Activity Log</h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-[#6b7280] hover:text-[#253B49]">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Section pills */}
      <div className="flex gap-1 mb-5 border-b border-[#e5e7eb]">
        {([
          ['batch',   'Batch Jobs'],
          ['llm',     'LLM Usage (7d)'],
          ['changes', 'Company Changes'],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setSection(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              section === key ? 'border-[#253B49] text-[#253B49]' : 'border-transparent text-[#6b7280] hover:text-[#1f2937]'
            }`}>
            {label}
            {key === 'batch'   && data && <span className="ml-1.5 text-[10px] text-[#9ca3af]">({data.batch_jobs.length})</span>}
            {key === 'llm'     && data && <span className="ml-1.5 text-[10px] text-[#9ca3af]">({data.llm_usage.length})</span>}
            {key === 'changes' && data && <span className="ml-1.5 text-[10px] text-[#9ca3af]">({data.company_changes.length})</span>}
          </button>
        ))}
      </div>

      {loading && <div className="text-center py-16 text-[#9ca3af]">Loading...</div>}

      {/* Batch Jobs */}
      {!loading && section === 'batch' && data && (
        <div className="border border-[#e5e7eb] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#fafbfc] border-b border-[#e5e7eb]">
                {['#', 'Type', 'Target', 'Status', 'Progress', 'By', 'Started', 'Duration', 'Error'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.batch_jobs.length === 0 && (
                <tr><td colSpan={9} className="text-center py-10 text-[#94a3b8]">No batch jobs yet</td></tr>
              )}
              {data.batch_jobs.map(j => (
                <tr key={j.id} className="border-b border-[#f5f5f5] hover:bg-[#fafcff]">
                  <td className="px-4 py-3 text-xs font-bold text-[#94a3b8]">#{j.id}</td>
                  <td className="px-4 py-3 text-xs font-semibold text-[#253B49] capitalize">{j.job_type}</td>
                  <td className="px-4 py-3 text-xs text-[#6b7280] capitalize">
                    {j.target_type}{j.sector ? ` · ${j.sector}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${statusColor(j.status)}`}>
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#6b7280] tabular-nums">
                    {j.progress_total > 0
                      ? `${j.progress_current}/${j.progress_total} (${Math.round(100 * j.progress_current / j.progress_total)}%)`
                      : j.status === 'completed' ? '✓' : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#6b7280]">{j.created_by}</td>
                  <td className="px-4 py-3 text-xs text-[#9ca3af] whitespace-nowrap">{fmtDate(j.started_at)}</td>
                  <td className="px-4 py-3 text-xs text-[#9ca3af] tabular-nums">{dur(j.started_at, j.completed_at)}</td>
                  <td className="px-4 py-3 text-xs text-red-500 max-w-xs truncate" title={j.error_message ?? ''}>
                    {j.error_message ? j.error_message.slice(0, 60) + (j.error_message.length > 60 ? '…' : '') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* LLM Usage */}
      {!loading && section === 'llm' && data && (
        <div className="border border-[#e5e7eb] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#fafbfc] border-b border-[#e5e7eb]">
                {['Activity', 'Model', 'Calls', 'Prompt Tok', 'Completion Tok', 'Cost', 'Last Call'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.llm_usage.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-[#94a3b8]">No LLM calls in the last 7 days</td></tr>
              )}
              {data.llm_usage.map((r, i) => (
                <tr key={i} className="border-b border-[#f5f5f5] hover:bg-[#fafcff]">
                  <td className="px-4 py-3 text-xs font-semibold text-[#253B49]">{r.activity}</td>
                  <td className="px-4 py-3 text-xs text-[#6b7280] font-mono">{r.model.split('/').pop()}</td>
                  <td className="px-4 py-3 text-xs text-[#374151] tabular-nums font-semibold">{r.calls.toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-[#6b7280] tabular-nums">{r.prompt_tokens.toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-[#6b7280] tabular-nums">{r.completion_tokens.toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs font-semibold text-[#253B49] tabular-nums">
                    ${Number(r.total_cost).toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#9ca3af] whitespace-nowrap">{fmtDate(r.last_called)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.llm_usage.length > 0 && (
            <div className="px-4 py-3 border-t border-[#f0f0f0] bg-[#fafbfc] flex items-center gap-6 text-xs text-[#6b7280]">
              <span>Total calls: <strong className="text-[#253B49]">{data.llm_usage.reduce((s, r) => s + r.calls, 0).toLocaleString()}</strong></span>
              <span>Total cost: <strong className="text-[#253B49]">${data.llm_usage.reduce((s, r) => s + Number(r.total_cost), 0).toFixed(4)}</strong></span>
            </div>
          )}
        </div>
      )}

      {/* Company Changes */}
      {!loading && section === 'changes' && data && (
        <div className="border border-[#e5e7eb] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#fafbfc] border-b border-[#e5e7eb]">
                {['Company', 'Field', 'Old', 'New', 'By', 'Source', 'When'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.company_changes.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-[#94a3b8]">No company changes logged yet</td></tr>
              )}
              {data.company_changes.map(r => (
                <tr key={r.id} className="border-b border-[#f5f5f5] hover:bg-[#fafcff]">
                  <td className="px-4 py-3 text-xs font-semibold text-[#253B49]">{r.company_name}</td>
                  <td className="px-4 py-3 text-xs font-mono text-[#6b7280]">{r.field_name}</td>
                  <td className="px-4 py-3 text-xs text-[#9ca3af] max-w-[120px] truncate" title={r.old_value ?? ''}>
                    {r.old_value ?? <span className="italic">null</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#374151] max-w-[150px] truncate" title={r.new_value ?? ''}>
                    {r.new_value ?? <span className="italic text-[#9ca3af]">null</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#6b7280]">{r.changed_by}</td>
                  <td className="px-4 py-3 text-xs text-[#9ca3af]">{r.change_source}</td>
                  <td className="px-4 py-3 text-xs text-[#9ca3af] whitespace-nowrap">{fmtDate(r.changed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Build Queue ───────────────────────────────────────────────────────────────

export default function BuildQueue() {
  const [queueTab, setQueueTab] = useState<'tasks' | 'activity'>('tasks');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, approved: 0, building: 0, complete: 0, deployed: 0, failed: 0, on_hold: 0, closed: 0 });
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    try {
      const [statsRes, tasksRes] = await Promise.all([
        fetch('/tasks/stats', { headers: AUTH }),
        fetch('/tasks/?limit=200', { headers: AUTH }),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (tasksRes.ok) setTasks(await tasksRes.json());
    } catch (e) {
      console.error('Failed to load tasks', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const approve = async (taskId: number) => {
    if (!confirm(`Approve task #${taskId}?`)) return;
    setApproving(taskId);
    try {
      const res = await fetch(`/tasks/${taskId}/approve`, { method: 'POST', headers: AUTH });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e: any) {
      alert('Approve failed: ' + e.message);
    } finally {
      setApproving(null);
    }
  };

  const updateStatus = async (taskId: number, newStatus: string) => {
    try {
      const res = await fetch(`/tasks/${taskId}/status`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e: any) {
      alert('Update failed: ' + e.message);
    }
  };

  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);

  function fmtDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <>
    {/* Sub-tab bar */}
    <div className="flex gap-1 border-b border-[#e5e7eb] px-6 pt-4 bg-white">
      <button onClick={() => setQueueTab('tasks')}
        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
          queueTab === 'tasks' ? 'border-[#253B49] text-[#253B49]' : 'border-transparent text-[#6b7280] hover:text-[#1f2937]'
        }`}>
        Tasks
      </button>
      <button onClick={() => setQueueTab('activity')}
        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
          queueTab === 'activity' ? 'border-[#253B49] text-[#253B49]' : 'border-transparent text-[#6b7280] hover:text-[#1f2937]'
        }`}>
        Activity
      </button>
    </div>

    {queueTab === 'activity' && <ActivityTab />}

    {queueTab === 'tasks' && (
    <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className={cls.pageTitle}>Build Queue</h1>
            <p className="text-sm text-[#6b7280] mt-1">Automated intelligence generation pipeline</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#94a3b8]">
            <span className="w-2 h-2 rounded-full bg-[#4a7c59] animate-pulse inline-block" />
            Live — refreshes every 30s
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-8 gap-3 mb-6">
          {(['pending','approved','building','complete','deployed','failed','on_hold','closed'] as const).map(s => (
            <StatCard key={s} status={s} count={stats[s]} />
          ))}
        </div>

        {/* Table panel */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0]">
            <div>
              <div className="font-bold text-[#253B49]">Active Tasks</div>
              <div className="text-xs text-[#94a3b8] mt-0.5">
                {loading ? 'Loading...' : `${filtered.length} of ${tasks.length} tasks`}
              </div>
            </div>
            <select
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="border border-[#e5e7eb] rounded-md px-3 py-1.5 text-xs text-[#374151] bg-white cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending Approval</option>
              <option value="approved">Approved</option>
              <option value="building">Building</option>
              <option value="complete">Complete</option>
              <option value="deployed">Deployed</option>
              <option value="failed">Failed</option>
              <option value="on_hold">On Hold</option>
              <option value="closed">Closed</option>
              <option value="superseded">Superseded</option>
            </select>
          </div>

          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ background: '#fafbfc' }}>
                {['ID', 'Specification', 'Status', 'Priority', 'Risk', 'Assigned', 'Created', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#94a3b8] whitespace-nowrap border-b border-[#f0f0f0]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-[#94a3b8]">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-[#94a3b8]">No tasks found</td></tr>
              ) : filtered.map(task => (
                <tr key={task.task_id}
                  className="border-b border-[#f5f5f5] hover:bg-[#fafcff] transition-colors cursor-pointer"
                  onClick={() => setSelectedTask(task)}>
                  <td className="px-4 py-3 font-bold text-xs text-[#94a3b8]">#{task.task_id}</td>
                  <td className="px-4 py-3 max-w-xs">
                    <div className="text-[#253B49] text-xs truncate" title={task.spec}>
                      {task.spec.length > 90 ? task.spec.slice(0, 90) + '…' : task.spec}
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusPill status={task.status} /></td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-bold uppercase" style={{ color: PRI_COLORS[task.priority] ?? '#64748b' }}>
                      {task.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold ${task.risk_level === 'high' ? 'text-red-600' : task.risk_level === 'medium' ? 'text-amber-600' : 'text-[#64748b]'}`}>
                      {task.risk_level}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-7 h-7 rounded-full bg-[#e5e7eb] flex items-center justify-center text-[10px] font-bold text-[#64748b]"
                      title={task.assigned_to}>
                      {(task.assigned_to || '??').slice(0, 2).toUpperCase()}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#94a3b8] whitespace-nowrap">{fmtDate(task.created_at)}</td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {task.status === 'pending' && (
                        <button onClick={() => approve(task.task_id)} disabled={approving === task.task_id}
                          className="px-2.5 py-1 rounded text-xs font-semibold transition-colors disabled:opacity-50"
                          style={{ background: 'var(--color-cvc-gold)', color: '#253B49' }}>
                          {approving === task.task_id ? '…' : 'Approve'}
                        </button>
                      )}
                      {(task.status === 'closed' || task.status === 'on_hold' || task.status === 'failed') && (
                        <button onClick={() => updateStatus(task.task_id, 'pending')}
                          className="px-2.5 py-1 rounded text-xs font-semibold bg-[#eff6ff] text-[#1d4ed8] hover:bg-[#dbeafe] transition-colors">
                          Reopen
                        </button>
                      )}
                      {!['closed', 'deployed'].includes(task.status) && (
                        <button onClick={() => updateStatus(task.task_id, 'on_hold')}
                          className="px-2.5 py-1 rounded text-xs font-semibold bg-[#fff7ed] text-[#c2410c] hover:bg-[#fed7aa] transition-colors">
                          Hold
                        </button>
                      )}
                      {!['closed', 'deployed'].includes(task.status) && (
                        <button onClick={() => updateStatus(task.task_id, 'closed')}
                          className="px-2.5 py-1 rounded text-xs font-semibold bg-[#f1f5f9] text-[#94a3b8] hover:bg-[#e2e8f0] transition-colors">
                          Close
                        </button>
                      )}
                      <button onClick={() => setSelectedTask(task)}
                        className="px-2.5 py-1 rounded text-xs font-semibold bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0] transition-colors">
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {selectedTask && (
        <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />
      )}
    </>
  );
}

export function BuildQueuePage() {
  return (
    <div className={cls.page}>
      <CVCNavbar />
      <BuildQueue />
    </div>
  );
}
