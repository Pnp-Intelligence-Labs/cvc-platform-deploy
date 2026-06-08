import { CVCNavbar } from '../components/CVCNavbar';
import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { AUTH_HEADER as AUTH } from '../api/client';
import {
  AlertTriangle, CheckCircle, Clock, ChevronDown, Filter, Check, Pencil, Trash2,
  Settings, Megaphone, Pin, Trash, Search, RefreshCw, Save, MessageSquare, Send, X,
  Activity, Building2, GitBranch, CheckCircle2, Rocket, PencilLine, ShieldCheck,
  Handshake, BadgeDollarSign, Cpu, Zap, Users, ListChecks, BarChart2, ThumbsUp,
  ExternalLink, ClipboardList, UserPlus, UserX, Eye, EyeOff, Package, KeyRound,
} from 'lucide-react';
import { cls } from '../components/tokens';

// ── Interfaces ───────────────────────────────────────────────────────────────

interface Issue {
  id: number;
  partner_id: number;
  partner_name: string;
  title: string;
  body: string | null;
  severity: string;
  due_date: string | null;
  linked_document_name: string | null;
  resolved: boolean;
  created_at: string;
}

interface TeamMessage {
  id: number;
  title: string;
  body: string;
  posted_by: string;
  pinned: boolean;
  created_at: string;
}

interface FeedbackTask {
  task_id: number;
  spec: string;
  priority: string;
  status: string;
  created_by: string;
  created_at: string;
  notes: string | null;
}

interface StaffUser {
  id: number;
  username: string;
  role: string;
  full_name: string | null;
  email: string | null;
  assigned_partner_ids: number[];
  is_active: boolean;
  custom_permissions: string[];
}

interface Assignment {
  id: number;
  title: string;
  notes: string | null;
  assigned_to: string | null;
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
  partner_name: string | null;
  company_id: number | null;
  company_name: string | null;
  created_at: string;
}

// ── Module-scope maps (used by PersonCard + activity renderers) ───────────────

const ACTIVITY_ICON: Record<string, React.ReactNode> = {
  new_company:     <Building2 className="w-3.5 h-3.5" />,
  pipeline_change: <GitBranch className="w-3.5 h-3.5" />,
  dd_completed:    <CheckCircle2 className="w-3.5 h-3.5" />,
  build_deployed:  <Rocket className="w-3.5 h-3.5" />,
  profile_edit:    <PencilLine className="w-3.5 h-3.5" />,
  intel_approved:  <ShieldCheck className="w-3.5 h-3.5" />,
  partner_intro:   <Handshake className="w-3.5 h-3.5" />,
  new_investment:  <BadgeDollarSign className="w-3.5 h-3.5" />,
  briefing_upvote: <ThumbsUp className="w-3.5 h-3.5" />,
};
const ACTIVITY_COLOR: Record<string, string> = {
  new_company:     'bg-blue-500/15 text-blue-600',
  pipeline_change: 'bg-amber-400/15 text-amber-700',
  dd_completed:    'bg-emerald-500/15 text-emerald-600',
  build_deployed:  'bg-purple-500/15 text-purple-600',
  profile_edit:    'bg-orange-500/15 text-orange-600',
  intel_approved:  'bg-indigo-500/15 text-indigo-600',
  partner_intro:   'bg-teal-500/15 text-teal-600',
  new_investment:  'bg-emerald-600/15 text-emerald-700',
  briefing_upvote: 'bg-amber-400/15 text-amber-600',
};

const PRIORITY_DOT: Record<string, string> = {
  high:   'bg-red-400',
  medium: 'bg-amber-400',
  low:    'bg-slate-300',
};

const ROLE_COLORS: Record<string, string> = {
  GP:          'bg-amber-100 text-amber-800',
  Principal:   'bg-violet-100 text-violet-700',
  Director:    'bg-indigo-100 text-indigo-700',
  Ventures:    'bg-blue-100 text-blue-700',
  'Senior PSM':'bg-emerald-100 text-emerald-700',
  PSM:         'bg-teal-100 text-teal-700',
};

// ── Permissions ───────────────────────────────────────────────────────────────

const PLATFORM_PERMISSIONS = [
  { key: 'partner_servicing', label: 'Partner Servicing', desc: 'PSM workflows — partner health, intros, partner requests' },
  { key: 'ventures_pipeline', label: 'Ventures Pipeline', desc: 'Company pipeline, DD evaluations, venture assignments' },
  { key: 'admin_panel',       label: 'Admin Panel',       desc: 'Admin command center and user management' },
  { key: 'data_explorer',     label: 'Data Explorer',     desc: 'Raw data browsing' },
  { key: 'requests_mgmt',     label: 'Requests',          desc: 'Create and manage partner/team requests' },
] as const;

type PermKey = typeof PLATFORM_PERMISSIONS[number]['key'];

const ROLE_DEFAULTS: Record<string, PermKey[]> = {
  'GP':         ['partner_servicing', 'ventures_pipeline', 'admin_panel', 'data_explorer', 'requests_mgmt'],
  'Principal':  ['partner_servicing', 'ventures_pipeline', 'admin_panel', 'data_explorer', 'requests_mgmt'],
  'Director':   ['partner_servicing', 'ventures_pipeline', 'admin_panel', 'data_explorer', 'requests_mgmt'],
  'Ventures':   ['ventures_pipeline', 'requests_mgmt'],
  'Senior PSM': ['partner_servicing', 'requests_mgmt', 'data_explorer'],
  'PSM':        ['partner_servicing', 'requests_mgmt'],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const severityColor = (s: string) =>
  s === 'high'   ? 'bg-red-100 text-red-600 border-red-200' :
  s === 'medium' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                   'bg-slate-100 text-slate-600 border-slate-200';

const severityIcon = (s: string) =>
  s === 'high'   ? <AlertTriangle className="w-3.5 h-3.5" /> :
  s === 'medium' ? <Clock className="w-3.5 h-3.5" /> :
                   <CheckCircle className="w-3.5 h-3.5" />;

function parseFeedback(spec: string): { page: string; path: string; comment: string } {
  const headerMatch = spec.match(/^\[Dashboard Feedback\]\s+(.+?)\s+\(([^)]+)\)\s*\n+([\s\S]*)$/);
  if (headerMatch) return { page: headerMatch[1], path: headerMatch[2], comment: headerMatch[3].trim() };
  return { page: 'Unknown', path: '', comment: spec };
}

function fmtCost(cost: number) {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(5)}`;
  return `$${cost.toFixed(3)}`;
}

function fmtTs(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── CollapsibleSection ────────────────────────────────────────────────────────

function CollapsibleSection({ id, icon, title, sub, badge, open, onToggle, children }: {
  id: string; icon: React.ReactNode; title: string; sub?: string;
  badge?: number; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div id={id} className="border border-slate-200 rounded-xl overflow-hidden bg-white scroll-mt-4">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="p-2 bg-[#ede8d7] rounded-lg text-slate-700 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-800">{title}</span>
            {badge !== undefined && badge > 0 && (
              <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {badge}
              </span>
            )}
          </div>
          {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="border-t border-slate-100 px-5 py-5 max-h-[460px] overflow-y-auto">{children}</div>}
    </div>
  );
}

// ── PersonCard ────────────────────────────────────────────────────────────────

function PersonCard({
  user, userActivity, userAssignments, userRequests, draft, partners, dirty, saving,
  onDraftChange, onSave, onDeactivate, canDeactivate, onResetPassword, canResetPassword,
  customGrants, onGrantPermission, onRevokePermission,
}: {
  user: StaffUser;
  userActivity: any[];
  userAssignments: Assignment[];
  userRequests: any[];
  draft: { role: string; assigned_partner_ids: number[] };
  partners: { id: number; name: string }[];
  dirty: boolean;
  saving: boolean;
  onDraftChange: (field: string, value: any) => void;
  onSave: () => void;
  onDeactivate?: () => void;
  canDeactivate?: boolean;
  onResetPassword?: (newPassword: string) => Promise<void>;
  canResetPassword?: boolean;
  customGrants: string[];
  onGrantPermission: (p: string) => Promise<void>;
  onRevokePermission: (p: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [showResetPw, setShowResetPw]   = useState(false);
  const [resetPw, setResetPw]           = useState('');
  const [resetPwErr, setResetPwErr]     = useState('');
  const [resetPwSaving, setResetPwSaving] = useState(false);

  const submitResetPw = async () => {
    if (resetPw.length < 8) { setResetPwErr('Must be at least 8 characters'); return; }
    setResetPwSaving(true); setResetPwErr('');
    try {
      await onResetPassword!(resetPw);
      setShowResetPw(false); setResetPw('');
    } catch (e: any) {
      setResetPwErr(e.message || 'Failed');
    } finally { setResetPwSaving(false); }
  };

  const openAssignments = userAssignments.filter(a => a.status !== 'completed' && a.status !== 'cancelled');
  const visibleActivity = showAllActivity ? userActivity : userActivity.slice(0, 4);

  const initials = (user.full_name ?? user.username).charAt(0).toUpperCase();
  const displayName = user.full_name ?? user.username;

  return (
    <div className={`border rounded-xl overflow-hidden bg-white transition-all ${expanded ? 'border-slate-300 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
      {/* Compact header — always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors"
      >
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-slate-800 text-white flex items-center justify-center text-sm font-bold shrink-0">
          {initials}
        </div>

        {/* Name + username */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 leading-tight">{displayName}</p>
          <p className="text-[10px] text-slate-400">@{user.username}</p>
        </div>

        {/* Stats chips */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${ROLE_COLORS[draft.role] ?? 'bg-slate-100 text-slate-500'}`}>
            {draft.role}
          </span>
          {userActivity.length > 0 ? (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
              {userActivity.length} actions
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200">
              inactive
            </span>
          )}
          {openAssignments.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
              {openAssignments.length} tasks
            </span>
          )}
          {userRequests.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
              {userRequests.length} requests
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ml-1 ${expanded ? '' : '-rotate-90'}`} />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-100">

          {/* Role editor */}
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-100">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 w-8 shrink-0">Role</span>
            <select
              value={draft.role}
              onChange={e => onDraftChange('role', e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700 focus:outline-none focus:border-slate-400"
            >
              {['GP', 'Principal', 'Director', 'Ventures', 'Senior PSM', 'PSM'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {dirty && (
              <button
                onClick={onSave}
                disabled={saving}
                className="px-2.5 py-1 bg-slate-800 text-white text-xs font-semibold rounded hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {saving ? '…' : 'Save'}
              </button>
            )}
            {canDeactivate && onDeactivate && !confirmDeactivate && (
              <button
                onClick={() => setConfirmDeactivate(true)}
                className="ml-auto flex items-center gap-1 px-2 py-1 text-[10px] text-red-500 border border-red-200 rounded hover:bg-red-50 transition-colors"
              >
                <UserX className="w-3 h-3" /> Deactivate
              </button>
            )}
            {canDeactivate && onDeactivate && confirmDeactivate && (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-[10px] text-red-600 font-semibold">Confirm deactivate?</span>
                <button
                  onClick={() => { onDeactivate(); setConfirmDeactivate(false); }}
                  className="px-2 py-1 text-[10px] bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                >
                  Yes, deactivate
                </button>
                <button
                  onClick={() => setConfirmDeactivate(false)}
                  className="px-2 py-1 text-[10px] text-slate-500 border border-slate-200 rounded hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Reset password (admin only, inline) */}
          {canResetPassword && onResetPassword && (
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              {!showResetPw ? (
                <button
                  onClick={() => { setShowResetPw(true); setResetPw(''); setResetPwErr(''); }}
                  className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-700 font-semibold transition-colors"
                >
                  <KeyRound className="w-3 h-3" /> Reset password for @{user.username}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 shrink-0">New password</span>
                  <input
                    autoFocus
                    type="text"
                    value={resetPw}
                    onChange={e => { setResetPw(e.target.value); setResetPwErr(''); }}
                    placeholder="min 8 characters"
                    className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-slate-400 bg-white"
                  />
                  <button
                    onClick={submitResetPw}
                    disabled={resetPwSaving || resetPw.length < 8}
                    className="px-2.5 py-1 bg-slate-800 text-white text-xs font-semibold rounded hover:bg-slate-700 disabled:opacity-50 transition-colors shrink-0"
                  >
                    {resetPwSaving ? '…' : 'Set'}
                  </button>
                  <button onClick={() => setShowResetPw(false)} className="text-slate-400 hover:text-slate-600 shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                  {resetPwErr && <span className="text-[10px] text-red-500">{resetPwErr}</span>}
                </div>
              )}
            </div>
          )}

          {/* Authorization */}
          <div className="px-4 py-3 border-b border-slate-100 bg-white">
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldCheck className="w-3 h-3 text-slate-400" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Authorization</span>
            </div>
            <div className="space-y-2">
              {/* Role defaults — read-only */}
              <div className="flex flex-wrap gap-1">
                {(ROLE_DEFAULTS[draft.role] ?? []).map(pk => {
                  const perm = PLATFORM_PERMISSIONS.find(x => x.key === pk)!;
                  return (
                    <span key={pk} title={perm.desc}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                      {perm.label}
                    </span>
                  );
                })}
              </div>
              {/* Custom grants — removable */}
              {customGrants.filter(g => !(ROLE_DEFAULTS[draft.role] ?? []).includes(g as PermKey)).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {customGrants
                    .filter(g => !(ROLE_DEFAULTS[draft.role] ?? []).includes(g as PermKey))
                    .map(pk => {
                      const perm = PLATFORM_PERMISSIONS.find(x => x.key === pk);
                      if (!perm) return null;
                      return (
                        <span key={pk} title={`Custom grant: ${perm.desc}`}
                          className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                          {perm.label}
                          {canResetPassword && (
                            <button onClick={() => onRevokePermission(pk)}
                              className="hover:text-red-600 transition-colors ml-0.5" title="Revoke">
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </span>
                      );
                    })}
                </div>
              )}
              {/* Grant additional permissions */}
              {canResetPassword && (() => {
                const available = PLATFORM_PERMISSIONS.filter(p =>
                  !(ROLE_DEFAULTS[draft.role] ?? []).includes(p.key) &&
                  !customGrants.includes(p.key)
                );
                if (available.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1">
                    {available.map(perm => (
                      <button key={perm.key} onClick={() => onGrantPermission(perm.key)}
                        title={`Grant: ${perm.desc}`}
                        className="text-[10px] px-2 py-0.5 rounded-full border border-dashed border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-600 transition-colors">
                        + {perm.label}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Partner Assignment (PSM / Senior PSM only) */}
          {(draft.role === 'PSM' || draft.role === 'Senior PSM') && partners.length > 0 && (
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
                Partner Assignments ({draft.assigned_partner_ids.length} of {partners.length})
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {partners.map(p => {
                  const assigned = draft.assigned_partner_ids.includes(p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-2.5 py-1 px-1 rounded hover:bg-slate-100 cursor-pointer select-none group">
                      <input
                        type="checkbox"
                        checked={assigned}
                        onChange={() => {
                          const next = assigned
                            ? draft.assigned_partner_ids.filter(id => id !== p.id)
                            : [...draft.assigned_partner_ids, p.id];
                          onDraftChange('assigned_partner_ids', next);
                        }}
                        className="rounded border-slate-300 text-slate-800 focus:ring-slate-400"
                      />
                      <span className="text-xs text-slate-700 flex-1 truncate">{p.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Open Assignments */}
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
              Open Assignments {openAssignments.length > 0 && `(${openAssignments.length})`}
            </p>
            {openAssignments.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No open assignments</p>
            ) : (
              <div className="space-y-1.5">
                {openAssignments.map(a => (
                  <div key={a.id} className="flex items-start gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${PRIORITY_DOT[a.priority]}`} />
                    <span className="text-xs text-slate-700 leading-snug flex-1">{a.title}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                      a.status === 'in_progress' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}>
                      {a.status === 'in_progress' ? 'In Progress' : 'Open'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Activity */}
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
              Recent Activity (14d) {userActivity.length > 0 && `· ${userActivity.length} actions`}
            </p>
            {userActivity.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No recorded activity in the last 14 days.</p>
            ) : (
              <>
                <div className="space-y-1">
                  {visibleActivity.map((item: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 py-1">
                      <div className={`p-0.5 rounded shrink-0 mt-0.5 ${ACTIVITY_COLOR[item.type] ?? 'bg-slate-100 text-slate-500'}`}>
                        {ACTIVITY_ICON[item.type] ?? <Cpu className="w-3 h-3" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        {item.company_id ? (
                          <Link to={`/company/${item.company_id}`}
                            className="text-xs text-slate-700 hover:underline leading-snug block truncate">
                            {item.label}
                          </Link>
                        ) : (
                          <p className="text-xs text-slate-700 leading-snug truncate">{item.label}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">{fmtTs(item.ts)}</span>
                    </div>
                  ))}
                </div>
                {userActivity.length > 4 && (
                  <button
                    onClick={() => setShowAllActivity(v => !v)}
                    className="mt-1.5 text-[11px] text-slate-400 hover:text-slate-700 font-semibold transition-colors"
                  >
                    {showAllActivity ? '▲ Collapse' : `▼ ${userActivity.length - 4} more`}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Open Requests (PSM bandwidth) */}
          {(draft.role === 'PSM' || draft.role === 'Senior PSM') && (
            <div className="px-4 py-3 bg-slate-50">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
                Open Requests {userRequests.length > 0 && `(${userRequests.length})`}
              </p>
              {userRequests.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No open requests</p>
              ) : (
                <div className="space-y-1.5">
                  {userRequests.map((r: any) => (
                    <div key={r.id} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: r.status === 'active' ? '#f59e0b' : '#94a3b8' }} />
                      <span className="text-xs text-slate-700 leading-snug flex-1 truncate">{r.title}</span>
                      <span className="text-[9px] text-slate-400 shrink-0">{r.service_type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Feedback Row ─────────────────────────────────────────────────────────────

function FeedbackRow({ item, page, path, comment, isPending, isReceived, onReceive, onComplete, onDismiss }: {
  item: FeedbackTask;
  page: string; path: string; comment: string;
  isPending: boolean; isReceived: boolean;
  onReceive: () => void;
  onComplete: (note: string) => void;
  onDismiss: () => void;
}) {
  const [completing, setCompleting] = useState(false);
  const [note, setNote]             = useState('');

  const dotColor =
    isPending  ? 'bg-amber-400' :
    isReceived ? 'bg-blue-400' :
    item.status === 'complete' ? 'bg-emerald-400' : 'bg-slate-300';

  const statusBadge =
    isPending  ? 'bg-amber-50 text-amber-700' :
    isReceived ? 'bg-blue-50 text-blue-700' :
    item.status === 'complete' ? 'bg-emerald-50 text-emerald-700' :
    'bg-slate-100 text-slate-500';

  return (
    <div className="px-5 py-4 bg-white hover:bg-slate-50 transition-colors">
      <div className="flex items-start gap-4">
        <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="flex items-center gap-1 text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
              <MessageSquare className="w-3 h-3" /> {page}
            </span>
            {path && <span className="text-[10px] font-mono text-slate-400">{path}</span>}
            <span className={`text-[10px] px-2 py-0.5 rounded font-medium border ${
              item.priority === 'high' ? 'bg-red-50 text-red-600 border-red-200' :
              item.priority === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
              'bg-slate-50 text-slate-500 border-slate-200'
            }`}>{item.priority}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${statusBadge}`}>
              {item.status}
            </span>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{comment}</p>
          {item.notes && (
            <p className="text-xs text-slate-500 italic mt-1.5 border-l-2 border-slate-200 pl-2">{item.notes}</p>
          )}
          <p className="text-[10px] text-slate-400 mt-1.5">
            {item.created_by} · {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>

          {/* Complete inline form */}
          {completing && (
            <div className="mt-3 flex flex-col gap-2">
              <textarea
                autoFocus
                rows={2}
                placeholder="Resolution note (optional) — will be sent to the submitter"
                value={note}
                onChange={e => setNote(e.target.value)}
                className="text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-slate-400 resize-none w-full"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { onComplete(note); setCompleting(false); setNote(''); }}
                  className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  Mark Complete
                </button>
                <button
                  onClick={() => { setCompleting(false); setNote(''); }}
                  className="text-xs px-2 py-1.5 text-slate-400 hover:text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {!completing && (isPending || isReceived) && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {isPending && (
              <button onClick={onReceive}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                <CheckCircle className="w-3 h-3" /> Received
              </button>
            )}
            {(isPending || isReceived) && (
              <button onClick={() => setCompleting(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors">
                <Send className="w-3 h-3" /> Complete
              </button>
            )}
            <button onClick={onDismiss}
              className="flex items-center gap-1 text-xs px-2 py-1.5 border border-slate-200 text-slate-500 rounded-lg hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors">
              <X className="w-3 h-3" /> Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function Admin() {
  const currentUser = api.getCurrentUser();
  const isAdmin = ['GP', 'Principal', 'Director'].includes(currentUser?.role ?? '');

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') ?? '';
  const mainTab: 'team' | 'system' = (
    rawTab === 'system' ? rawTab : 'team'
  );
  const setMainTab = (t: 'team' | 'system') =>
    setSearchParams({ tab: t }, { replace: true });

  // ── Collapsible section state (system tab) ─────────────────────────────────
  const [open, setOpen] = useState<Record<string, boolean>>({
    issues:         false,
    feedback:       false,
    'recent-edits': false,
    plugins:        true,   // open by default so new deployers see health immediately
  });
  const toggle = (id: string) => setOpen(prev => ({ ...prev, [id]: !prev[id] }));

  // ── Issues ────────────────────────────────────────────────────────────────
  const [issues, setIssues]         = useState<Issue[]>([]);
  const [filter, setFilter]         = useState<string>('all');
  const [loading, setLoading]       = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId]   = useState<number | null>(null);
  const [editForm, setEditForm]     = useState({ title: '', body: '', severity: 'medium', due_date: '' });
  const [comments, setComments]     = useState<Record<number, any[]>>({});
  const [newComment, setNewComment] = useState<Record<number, string>>({});

  const loadIssues = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAllIssues(filter === 'all' ? undefined : filter);
      setIssues(data.issues ?? []);
    } catch { setIssues([]); }
    setLoading(false);
  }, [filter]);

  useEffect(() => { loadIssues(); }, [loadIssues]);

  const loadComments = async (issue: Issue) => {
    if (comments[issue.id]) return;
    try {
      const d = await api.listIssueComments(issue.partner_id, issue.id);
      setComments(prev => ({ ...prev, [issue.id]: d.comments ?? [] }));
    } catch { /* silent */ }
  };

  const refreshComments = async (issue: Issue) => {
    const d = await api.listIssueComments(issue.partner_id, issue.id);
    setComments(prev => ({ ...prev, [issue.id]: d.comments ?? [] }));
  };

  // ── Messages ──────────────────────────────────────────────────────────────
  const [messages, setMessages]       = useState<TeamMessage[]>([]);
  const [msgTitle, setMsgTitle]       = useState('');
  const [msgBody, setMsgBody]         = useState('');
  const [msgPinned, setMsgPinned]     = useState(false);
  const [msgPosting, setMsgPosting]   = useState(false);
  const [expandedMsg, setExpandedMsg] = useState<number | null>(null);
  const [showMsgCompose, setShowMsgCompose] = useState(false);
  const [teamRoleTab, setTeamRoleTab] = useState<'all' | 'ventures' | 'psm'>('all');

  const loadMessages = useCallback(async () => {
    try {
      const data = await api.getTeamMessages();
      setMessages(data.messages ?? []);
    } catch { setMessages([]); }
  }, []);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  const postMessage = async () => {
    if (!msgTitle.trim() || !msgBody.trim()) return;
    setMsgPosting(true);
    try {
      await api.postTeamMessage(msgTitle.trim(), msgBody.trim(), msgPinned);
      setMsgTitle(''); setMsgBody(''); setMsgPinned(false);
      setShowMsgCompose(false);
      await loadMessages();
    } finally { setMsgPosting(false); }
  };

  const deleteMessage = async (id: number) => {
    await api.deleteTeamMessage(id);
    setMessages(ms => ms.filter(m => m.id !== id));
  };

  // ── Feedback ──────────────────────────────────────────────────────────────
  const [feedbackItems, setFeedbackItems]       = useState<FeedbackTask[]>([]);
  const [feedbackLoading, setFeedbackLoading]   = useState(false);
  const [feedbackFilter, setFeedbackFilter]     = useState<string>('pending');

  const loadFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    try {
      const url = feedbackFilter === 'all' ? '/tasks/feedback' : `/tasks/feedback?status=${feedbackFilter}`;
      const res = await fetch(url, { headers: AUTH });
      const data = await res.json();
      setFeedbackItems(data.feedback ?? []);
    } catch { setFeedbackItems([]); }
    setFeedbackLoading(false);
  }, [feedbackFilter]);

  useEffect(() => { loadFeedback(); }, [loadFeedback]);

  const markReceived = async (taskId: number) => {
    await fetch(`/tasks/${taskId}/status`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'received' }),
    });
    await loadFeedback();
  };

  const completeFeedback = async (taskId: number, note: string) => {
    await fetch(`/tasks/${taskId}/status`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'complete', note: note.trim() || undefined }),
    });
    await loadFeedback();
  };

  const dismissFeedback = async (taskId: number) => {
    await fetch(`/tasks/${taskId}/status`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    });
    await loadFeedback();
  };

  // ── Staff ─────────────────────────────────────────────────────────────────
  const [staffUsers, setStaffUsers]       = useState<StaffUser[]>([]);
  const [staffLoading, setStaffLoading]   = useState(false);
  const [partners, setPartners]           = useState<{ id: number; name: string }[]>([]);
  const [savingUserId, setSavingUserId]   = useState<number | null>(null);
  const [staffDrafts, setStaffDrafts]     = useState<Record<number, { role: string; assigned_partner_ids: number[] }>>({});
  const [customGrants, setCustomGrants] = useState<Record<number, string[]>>({});

  // Add User modal
  const [showAddUser, setShowAddUser]     = useState(false);
  const [addUserForm, setAddUserForm]     = useState({ username: '', password: '', role: 'Ventures', full_name: '', email: '' });
  const [addUserError, setAddUserError]   = useState('');
  const [addUserSaving, setAddUserSaving] = useState(false);
  const [showAddPw, setShowAddPw]         = useState(false);

  const createUser = async () => {
    const { username, password, role, full_name, email } = addUserForm;
    if (!username.trim() || !password.trim()) { setAddUserError('Username and password are required'); return; }
    if (password.length < 8) { setAddUserError('Password must be at least 8 characters'); return; }
    setAddUserSaving(true);
    setAddUserError('');
    try {
      const res = await fetch('/auth/users', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password, role, full_name: full_name.trim(), email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
      // Add to local state
      const newUser: StaffUser = { ...data, assigned_partner_ids: [] };
      setStaffUsers(prev => [...prev, newUser]);
      setStaffDrafts(d => ({ ...d, [data.id]: { role: data.role, assigned_partner_ids: [] } }));
      setAddUserForm({ username: '', password: '', role: 'Ventures', full_name: '', email: '' });
      setShowAddUser(false);
    } catch (err: any) {
      setAddUserError(err.message || 'Failed to create user');
    } finally {
      setAddUserSaving(false);
    }
  };

  const deactivateUser = async (userId: number) => {
    try {
      const res = await fetch(`/auth/users/${userId}`, { method: 'DELETE', headers: AUTH });
      if (res.ok) {
        setStaffUsers(prev => prev.filter(u => u.id !== userId));
        setStaffDrafts(d => { const next = { ...d }; delete next[userId]; return next; });
      }
    } catch { /* silent */ }
  };

  const resetUserPassword = async (userId: number, newPassword: string) => {
    const res = await fetch(`/auth/users/${userId}/reset-password`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.detail || 'Reset failed');
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    setStaffLoading(true);
    Promise.all([
      fetch('/auth/users', { headers: AUTH }).then(r => r.json()),
      fetch('/partners/', { headers: AUTH }).then(r => r.json()),
    ]).then(([userData, partnerData]) => {
      const users: StaffUser[] = userData.users ?? [];
      setStaffUsers(users);
      setStaffDrafts(Object.fromEntries(users.map(u => [u.id, { role: u.role, assigned_partner_ids: u.assigned_partner_ids ?? [] }])));
      setCustomGrants(Object.fromEntries(users.map(u => [u.id, u.custom_permissions ?? []])));
      setPartners((partnerData.partners ?? []).map((p: any) => ({ id: p.id, name: p.name })));
    }).catch(() => {}).finally(() => setStaffLoading(false));
  }, [isAdmin]);

  const saveStaffUser = async (userId: number) => {
    setSavingUserId(userId);
    const draft = staffDrafts[userId];
    try {
      const res = await fetch(`/auth/users/${userId}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (res.ok) {
        const updated: StaffUser = await res.json();
        setStaffUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updated } : u));
      }
    } finally { setSavingUserId(null); }
  };

  const grantPermission = async (userId: number, permission: string) => {
    const res = await fetch(`/auth/users/${userId}/permissions`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission }),
    });
    if (res.ok) {
      const data = await res.json();
      setCustomGrants(prev => ({ ...prev, [userId]: data.custom_grants }));
    }
  };

  const revokePermission = async (userId: number, permission: string) => {
    const res = await fetch(`/auth/users/${userId}/permissions/${permission}`, {
      method: 'DELETE',
      headers: AUTH,
    });
    if (res.ok) {
      const data = await res.json();
      setCustomGrants(prev => ({ ...prev, [userId]: data.custom_grants }));
    }
  };

  // ── Activity ──────────────────────────────────────────────────────────────
  const [activityItems, setActivityItems]     = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    setActivityLoading(true);
    fetch('/home/team-activity', { headers: AUTH })
      .then(r => r.json())
      .then(d => setActivityItems(d.activity ?? []))
      .catch(() => {})
      .finally(() => setActivityLoading(false));
  }, []);

  // ── Assignments ───────────────────────────────────────────────────────────
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [openRequests, setOpenRequests] = useState<any[]>([]);

  useEffect(() => {
    fetch('/ventures/assignments', { headers: AUTH })
      .then(r => r.json())
      .then(d => setAssignments(d.assignments ?? []))
      .catch(() => {});
    fetch('/requests', { headers: AUTH })
      .then(r => r.json())
      .then(d => setOpenRequests((d.requests ?? []).filter((r: any) => r.status === 'open' || r.status === 'active')))
      .catch(() => {});
  }, []);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const [kpis, setKpis] = useState<any | null>(null);

  useEffect(() => {
    fetch('/admin/kpis', { headers: AUTH })
      .then(r => r.json())
      .then(d => setKpis(d))
      .catch(() => {});
  }, []);

  const [recentEdits, setRecentEdits] = useState<any[]>([]);

  useEffect(() => {
    fetch('/admin/activity', { headers: AUTH })
      .then(r => r.json())
      .then(d => setRecentEdits(d.company_changes ?? []))
      .catch(() => {});
  }, []);

  // ── Plugin health + nav ───────────────────────────────────────────────────
  const [pluginHealth, setPluginHealth]     = useState<any[]>([]);
  const [pluginLoading, setPluginLoading]   = useState(false);
  const [pluginNav, setPluginNav]           = useState<Record<string, boolean>>({});
  const [navToggling, setNavToggling]       = useState<string | null>(null);

  const loadPluginHealth = () => {
    setPluginLoading(true);
    Promise.all([
      fetch('/admin/plugins/health', { headers: AUTH }).then(r => r.json()),
      fetch('/config/plugins').then(r => r.json()),
    ])
      .then(([health, config]) => {
        setPluginHealth(health.installed ?? []);
        const navMap: Record<string, boolean> = {};
        for (const p of (config.plugins ?? [])) {
          navMap[p.slug] = p.nav !== null && p.nav !== undefined;
        }
        setPluginNav(navMap);
      })
      .catch(() => setPluginHealth([]))
      .finally(() => setPluginLoading(false));
  };

  const togglePluginNav = async (slug: string, enabled: boolean) => {
    setNavToggling(slug);
    try {
      const res = await fetch(`/admin/plugins/${slug}/nav`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        setPluginNav(prev => ({ ...prev, [slug]: enabled }));
      }
    } finally {
      setNavToggling(null);
    }
  };

  useEffect(() => { loadPluginHealth(); }, []);

  // ── Auto-open urgent sections ─────────────────────────────────────────────
  useEffect(() => {
    if (!loading && issues.some(i => i.severity === 'high'))
      setOpen(prev => ({ ...prev, issues: true }));
  }, [loading, issues]);

  useEffect(() => {
    if (feedbackItems.filter(f => f.status === 'pending').length > 0)
      setOpen(prev => ({ ...prev, feedback: true }));
  }, [feedbackItems]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const activityByUser = activityItems.reduce<Record<string, any[]>>((acc, item) => {
    const key = item.user || '__system__';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const highCount            = issues.filter(i => i.severity === 'high').length;
  const mediumCount          = issues.filter(i => i.severity === 'medium').length;
  const lowCount             = issues.filter(i => i.severity === 'low').length;
  const overdue              = issues.filter(i => i.due_date && new Date(i.due_date) < new Date()).length;
  const pendingFeedbackCount = feedbackItems.filter(f => f.status === 'pending').length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={cls.page}>
      <CVCNavbar />
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Page header */}
        <div className="mb-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Vertical OS · Operations</p>
          <h1 className={cls.pageTitle}>Command Center</h1>
        </div>

        {/* ── KPI Row ──────────────────────────────────────────────────────── */}
        {kpis && (
          <div className="grid grid-cols-4 gap-4 mb-6">

            {/* Sales */}
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-violet-100"><BadgeDollarSign className="w-3.5 h-3.5 text-violet-600" /></div>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Sales</span>
                </div>
                {kpis.sales.win_rate != null && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${kpis.sales.win_rate >= 25 ? 'bg-emerald-100 text-emerald-700' : kpis.sales.win_rate >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                    {kpis.sales.win_rate}% win
                  </span>
                )}
              </div>
              <p className="text-2xl font-extrabold text-slate-800 leading-none">{kpis.sales.active_targets}</p>
              <p className="text-[11px] text-slate-400">active targets</p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {Object.entries(kpis.sales.stages ?? {}).map(([stage, count]) => (
                  <span key={stage} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
                    {stage.replace('_', ' ')}: {count as number}
                  </span>
                ))}
              </div>
              <div className="flex gap-3 text-[10px] text-slate-400 pt-0.5">
                <span className="text-emerald-600 font-semibold">▲ {kpis.sales.advanced_30d} advanced</span>
                <span>{kpis.sales.won}W · {kpis.sales.lost}L</span>
              </div>
            </div>

            {/* Ventures */}
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-100"><Rocket className="w-3.5 h-3.5 text-blue-600" /></div>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Ventures</span>
                </div>
                {kpis.ventures.dd_active > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    {kpis.ventures.dd_active} DD active
                  </span>
                )}
              </div>
              <p className="text-2xl font-extrabold text-slate-800 leading-none">{kpis.ventures.companies_added_30d}</p>
              <p className="text-[11px] text-slate-400">companies added (30d)</p>
              <div className="flex gap-3 text-[10px] text-slate-400 pt-1">
                <span className="font-semibold text-slate-600">{kpis.ventures.assignments_active} open tasks</span>
                <span>{kpis.ventures.assignments_done_30d} done</span>
              </div>
            </div>

            {/* Requests */}
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-amber-100"><ListChecks className="w-3.5 h-3.5 text-amber-600" /></div>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Requests</span>
                </div>
                {kpis.requests.completion_rate != null && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${kpis.requests.completion_rate >= 60 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {kpis.requests.completion_rate}% done
                  </span>
                )}
              </div>
              <p className="text-2xl font-extrabold text-slate-800 leading-none">{kpis.requests.open + kpis.requests.active}</p>
              <p className="text-[11px] text-slate-400">in-flight ({kpis.requests.open} open · {kpis.requests.active} active)</p>
              <div className="flex gap-3 text-[10px] text-slate-400 pt-1">
                <span className="text-emerald-600 font-semibold">{kpis.requests.completed_30d} completed (30d)</span>
                {kpis.requests.stale > 0 && <span className="text-red-500 font-semibold">{kpis.requests.stale} stale</span>}
              </div>
            </div>

            {/* Partners */}
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-teal-100"><Handshake className="w-3.5 h-3.5 text-teal-600" /></div>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Partners</span>
                </div>
                {kpis.partners.high_issues > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                    {kpis.partners.high_issues} high issues
                  </span>
                )}
              </div>
              <p className="text-2xl font-extrabold text-slate-800 leading-none">{kpis.partners.active_30d}</p>
              <p className="text-[11px] text-slate-400">active partners (30d)</p>
              <div className="flex gap-3 text-[10px] text-slate-400 pt-1">
                <span className="font-semibold text-slate-600">{kpis.partners.intros_30d} intros</span>
                {kpis.partners.dealflows_active > 0 && <span>{kpis.partners.dealflows_active} dealflows</span>}
              </div>
              {kpis.partners.top_outcome && (
                <p className="text-[10px] text-slate-400 truncate">Top: <span className="text-slate-600 font-semibold">{kpis.partners.top_outcome}</span></p>
              )}
            </div>

          </div>
        )}

        {/* ── Tab bar ──────────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-6 border-b border-slate-200">
          {([
            { key: 'team',       label: 'Team',       icon: <Users className="w-3.5 h-3.5" /> },
            { key: 'system',     label: 'System',     icon: <Settings className="w-3.5 h-3.5" /> },
          ] as const).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setMainTab(key)}
              className={`flex items-center gap-1.5 px-5 py-3 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                mainTab === key
                  ? 'border-slate-800 text-slate-800'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {icon}
              {label}
              {key === 'system' && pendingFeedbackCount > 0 && (
                <span className="ml-0.5 bg-amber-500 text-white text-[9px] font-bold px-1 py-0.5 rounded-full leading-none">
                  {pendingFeedbackCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* TEAM TAB                                                          */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {mainTab === 'team' && (
          <div className="space-y-6">

            {/* ── Role Permissions Matrix ── */}
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
              <details>
                <summary className="flex items-center gap-2 px-5 py-3 cursor-pointer hover:bg-slate-50 transition-colors list-none">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-xs font-bold text-slate-600">Role Permissions Reference</span>
                  <span className="text-[10px] text-slate-400 ml-1">— what each role can access by default</span>
                </summary>
                <div className="border-t border-slate-100 px-5 py-4 overflow-x-auto">
                  <table className="text-[10px] w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left font-bold text-slate-500 py-1 pr-4 whitespace-nowrap">Role</th>
                        {PLATFORM_PERMISSIONS.map(p => (
                          <th key={p.key} className="text-center font-bold text-slate-500 py-1 px-3 whitespace-nowrap" title={p.desc}>{p.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(['GP','Principal','Director','Ventures','Senior PSM','PSM'] as const).map(role => (
                        <tr key={role} className="border-t border-slate-50">
                          <td className="py-1.5 pr-4">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${ROLE_COLORS[role] ?? 'bg-slate-100 text-slate-500'}`}>{role}</span>
                          </td>
                          {PLATFORM_PERMISSIONS.map(p => (
                            <td key={p.key} className="text-center py-1.5 px-3">
                              {(ROLE_DEFAULTS[role] ?? []).includes(p.key)
                                ? <span className="text-emerald-600 font-bold">✓</span>
                                : <span className="text-slate-200">–</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>

            {/* ── 2-col: Team list + Announcements ── */}
            <div className="grid grid-cols-2 gap-6 items-stretch">

              {/* Left: Team list */}
              {(() => {
                const ROLE_ORDER: Record<string, number> = {
                  'GP': 0, 'Principal': 1, 'Director': 2, 'Ventures': 3, 'Senior PSM': 4, 'PSM': 5,
                };
                const filtered = staffUsers
                  .filter(u => {
                    if (teamRoleTab === 'ventures') return ['GP','Principal','Director','Ventures'].includes(u.role);
                    if (teamRoleTab === 'psm')      return ['Senior PSM','PSM'].includes(u.role);
                    return true;
                  })
                  .slice()
                  .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));

                return (
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white flex flex-col" style={{ maxHeight: 560 }}>
                    <div className="px-5 pt-4 pb-0 border-b border-slate-100 bg-slate-50 shrink-0">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className={cls.sectionTitle}>Team</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">bandwidth · activity · open work</p>
                        </div>
                        {isAdmin && (
                          <button
                            onClick={() => { setShowAddUser(true); setAddUserError(''); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1E293B] text-cvc-gold text-xs font-semibold rounded hover:bg-slate-700 transition-colors"
                          >
                            <UserPlus className="w-3.5 h-3.5" /> Add User
                          </button>
                        )}
                      </div>
                      <div className="flex gap-0 -mb-px">
                        {([
                          { key: 'all',      label: 'All' },
                          { key: 'ventures', label: 'Ventures' },
                          { key: 'psm',      label: 'PSM' },
                        ] as const).map(t => (
                          <button key={t.key} onClick={() => setTeamRoleTab(t.key)}
                            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                              teamRoleTab === t.key
                                ? 'border-slate-800 text-slate-800'
                                : 'border-transparent text-slate-400 hover:text-slate-600'
                            }`}>
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {staffLoading || activityLoading ? (
                      <div className="text-sm text-slate-400 py-12 text-center">Loading…</div>
                    ) : (
                      <div className="divide-y divide-slate-100 overflow-y-auto flex-1">
                        {filtered.map(user => {
                          const draft = staffDrafts[user.id] ?? { role: user.role, assigned_partner_ids: [] };
                          const dirty = draft.role !== user.role ||
                            JSON.stringify(draft.assigned_partner_ids.slice().sort()) !==
                            JSON.stringify((user.assigned_partner_ids ?? []).slice().sort());
                          const userAssignments = assignments.filter(a => a.assigned_to === user.username);
                          return (
                            <PersonCard
                              key={user.id}
                              user={user}
                              userActivity={activityByUser[user.username] ?? []}
                              userAssignments={userAssignments}
                              userRequests={openRequests.filter(r => r.assignees?.includes(user.username))}
                              draft={draft}
                              partners={partners}
                              dirty={dirty}
                              saving={savingUserId === user.id}
                              onDraftChange={(field, value) =>
                                setStaffDrafts(d => ({ ...d, [user.id]: { ...d[user.id], [field]: value } }))
                              }
                              onSave={() => saveStaffUser(user.id)}
                              canDeactivate={currentUser?.role === 'GP' && user.username !== currentUser?.username}
                              onDeactivate={() => deactivateUser(user.id)}
                              canResetPassword={['GP', 'Principal', 'Director'].includes(currentUser?.role ?? '') && user.username !== currentUser?.username}
                              onResetPassword={(pw) => resetUserPassword(user.id, pw)}
                              customGrants={customGrants[user.id] ?? []}
                              onGrantPermission={(p) => grantPermission(user.id, p)}
                              onRevokePermission={(p) => revokePermission(user.id, p)}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Right: Team Announcements */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white flex flex-col" style={{ maxHeight: 560 }}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
                  <div className="flex items-center gap-2">
                    <Megaphone className="w-4 h-4 text-slate-500" />
                    <span className={cls.sectionTitle}>Team Announcements</span>
                    {messages.length > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        {messages.length}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowMsgCompose(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg hover:border-slate-400 transition-colors"
                  >
                    {showMsgCompose ? <X className="w-3 h-3" /> : <Megaphone className="w-3 h-3" />}
                    {showMsgCompose ? 'Cancel' : 'Post'}
                  </button>
                </div>

                {showMsgCompose && (
                  <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 space-y-3 shrink-0">
                    <input
                      autoFocus
                      value={msgTitle}
                      onChange={e => setMsgTitle(e.target.value)}
                      placeholder="Title — e.g. Q2 Focus Areas, Process Reminder..."
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
                    />
                    <textarea
                      value={msgBody}
                      onChange={e => setMsgBody(e.target.value)}
                      placeholder="Write your directions, initiative, or reminder here..."
                      rows={3}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none bg-white"
                    />
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                        <input type="checkbox" checked={msgPinned} onChange={e => setMsgPinned(e.target.checked)} className="rounded border-slate-300" />
                        <Pin className="w-3.5 h-3.5" />
                        Pin to top
                      </label>
                      <button
                        onClick={postMessage}
                        disabled={!msgTitle.trim() || !msgBody.trim() || msgPosting}
                        className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 disabled:opacity-40 transition-colors"
                      >
                        {msgPosting ? 'Posting…' : 'Post Message'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="divide-y divide-slate-50 overflow-y-auto flex-1">
                  {messages.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 text-sm">No announcements posted yet.</div>
                  ) : (
                    messages.map(msg => (
                      <div key={msg.id} className={msg.pinned ? 'bg-amber-50/30' : ''}>
                        <div
                          className="flex items-start gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
                          onClick={() => setExpandedMsg(expandedMsg === msg.id ? null : msg.id)}
                        >
                          {msg.pinned && <Pin className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-800">{msg.title}</p>
                            {expandedMsg !== msg.id && (
                              <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{msg.body}</p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-1">
                              {msg.posted_by} · {new Date(msg.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                            <button onClick={() => deleteMessage(msg.id)}
                              className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${expandedMsg === msg.id ? '' : '-rotate-90'}`} />
                          </div>
                        </div>
                        {expandedMsg === msg.id && (
                          <div className="px-5 pb-5 bg-slate-50/50">
                            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>{/* end 2-col grid */}

            {/* System activity card (pipeline / unattributed events) */}
            {(activityByUser['__system__'] ?? []).length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <div className="flex items-center gap-3 px-4 py-3.5 bg-slate-50 border-b border-slate-100">
                  <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center shrink-0">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">System Events</p>
                    <p className="text-[10px] text-slate-400">pipeline changes, DD completions, deploys</p>
                  </div>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                    {activityByUser['__system__'].length} events
                  </span>
                </div>
                <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
                  {activityByUser['__system__'].map((item: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                      <div className={`p-0.5 rounded shrink-0 mt-0.5 ${ACTIVITY_COLOR[item.type] ?? 'bg-slate-100 text-slate-500'}`}>
                        {ACTIVITY_ICON[item.type] ?? <Cpu className="w-3 h-3" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        {item.company_id ? (
                          <Link to={`/company/${item.company_id}`}
                            className="text-xs text-slate-700 hover:underline leading-snug block truncate">
                            {item.label}
                          </Link>
                        ) : (
                          <p className="text-xs text-slate-700 leading-snug truncate">{item.label}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">{fmtTs(item.ts)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SYSTEM TAB                                                        */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {mainTab === 'system' && (
          <div className="space-y-3">

            {/* Quick-access links */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-2">
              {[
                { label: 'Ventures Pipeline', icon: <GitBranch className="w-4 h-4" />, to: '/ventures', color: 'text-blue-600 bg-blue-50 border-blue-200' },
                { label: 'Partner Hub',       icon: <Handshake className="w-4 h-4" />, to: '/partners', color: 'text-teal-600 bg-teal-50 border-teal-200' },
                { label: 'Brambles Portal',   icon: <ClipboardList className="w-4 h-4" />, to: '/brambles', color: 'text-amber-600 bg-amber-50 border-amber-200' },
              ].map(({ label, icon, to, color }) => (
                <Link key={to} to={to}
                  className={`flex items-center gap-2 px-4 py-3 rounded-xl border font-medium text-sm hover:opacity-80 transition-opacity ${color}`}>
                  {icon}
                  <span className="flex-1 truncate">{label}</span>
                  <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                </Link>
              ))}
            </div>

            {/* ── Plugin Health ── */}
            <CollapsibleSection
              id="plugins"
              icon={<Package className="w-4 h-4" />}
              title="Installed Plugins"
              sub="DB table verification per plugin"
              badge={pluginHealth.filter(p => p.status === 'degraded').length}
              open={open.plugins}
              onToggle={() => toggle('plugins')}
            >
              <div className="space-y-2">
                <div className="flex justify-end mb-1">
                  <button onClick={loadPluginHealth}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
                    <RefreshCw className={`w-3.5 h-3.5 ${pluginLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>
                {pluginLoading ? (
                  <div className="text-center py-8 text-slate-400 text-sm">Checking…</div>
                ) : pluginHealth.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">No plugins installed.</div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                    {pluginHealth.map((p: any) => {
                      const navOn = pluginNav[p.slug] ?? false;
                      const toggling = navToggling === p.slug;
                      return (
                        <div key={p.slug} className="flex items-center gap-3 px-4 py-3 bg-white">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${p.status === 'healthy' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-slate-700">{p.name}</span>
                            <span className="text-[10px] text-slate-400 ml-2 font-mono">{p.slug}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 shrink-0">v{p.version}</span>
                          {/* Nav toggle */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] text-slate-400">Nav</span>
                            <button
                              onClick={() => togglePluginNav(p.slug, !navOn)}
                              disabled={toggling}
                              title={navOn ? 'Disable nav entry' : 'Enable nav entry'}
                              className={`relative w-8 h-4 rounded-full transition-colors ${toggling ? 'opacity-50' : ''} ${navOn ? 'bg-emerald-400' : 'bg-slate-200'}`}
                            >
                              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${navOn ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </button>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                            p.status === 'healthy'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-red-50 text-red-600 border-red-200'
                          }`}>
                            {p.status === 'healthy' ? 'Healthy' : 'Degraded'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {pluginHealth.some(p => p.status === 'degraded') && (
                  <p className="text-xs text-red-500 pt-1">
                    Degraded plugins have missing DB tables. Run <code className="bg-slate-100 px-1 rounded">bash scripts/migrate.sh</code> to fix.
                  </p>
                )}
              </div>
            </CollapsibleSection>

            {/* ── Staff Feedback ── */}
            <CollapsibleSection
              id="feedback"
              icon={<MessageSquare className="w-4 h-4" />}
              title="Staff Feedback"
              sub="submitted via dashboard feedback button"
              badge={pendingFeedbackCount}
              open={open.feedback}
              onToggle={() => toggle('feedback')}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {['pending', 'received', 'complete', 'closed', 'all'].map(f => (
                      <button key={f} onClick={() => setFeedbackFilter(f)}
                        className={`text-xs px-3 py-1.5 rounded-full transition-colors capitalize ${
                          feedbackFilter === f ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}>
                        {f === 'all' ? 'All' : f}
                      </button>
                    ))}
                  </div>
                  <button onClick={loadFeedback} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
                    <RefreshCw className={`w-3.5 h-3.5 ${feedbackLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>
                {feedbackLoading ? (
                  <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
                ) : feedbackItems.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-sm">No feedback items.</div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-50">
                    {feedbackItems.map(item => {
                      const { page, path, comment } = parseFeedback(item.spec);
                      const isPending  = item.status === 'pending';
                      const isReceived = item.status === 'received';
                      return (
                        <FeedbackRow
                          key={item.task_id}
                          item={item}
                          page={page}
                          path={path}
                          comment={comment}
                          isPending={isPending}
                          isReceived={isReceived}
                          onReceive={() => markReceived(item.task_id)}
                          onComplete={(note) => completeFeedback(item.task_id, note)}
                          onDismiss={() => dismissFeedback(item.task_id)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </CollapsibleSection>

            {/* ── Partner Issues ── */}
            <CollapsibleSection
              id="issues"
              icon={<AlertTriangle className="w-4 h-4" />}
              title="Partner Issues"
              sub={`${issues.length} open · ${overdue} overdue`}
              badge={highCount}
              open={open.issues}
              onToggle={() => toggle('issues')}
            >
              <div className="grid grid-cols-4 gap-4 mb-5">
                {[
                  { label: 'High', count: highCount,  cls: 'bg-red-50 border-red-200 text-red-600 text-red-500' },
                  { label: 'Medium', count: mediumCount, cls: 'bg-amber-50 border-amber-200 text-amber-700 text-amber-500' },
                  { label: 'Low', count: lowCount,    cls: 'bg-slate-50 border-slate-200 text-slate-700 text-slate-400' },
                  { label: 'Overdue', count: overdue, cls: 'bg-orange-50 border-orange-200 text-orange-600 text-orange-400' },
                ].map(({ label, count, cls: c }) => {
                  const [bg, border, valColor] = c.split(' ');
                  return (
                    <div key={label} className={`border ${border} ${bg} rounded-lg p-3 text-center`}>
                      <div className={`text-xl font-bold ${valColor}`}>{count}</div>
                      <div className={`text-[10px] font-medium uppercase ${valColor}`}>{label}</div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 mb-4">
                <Filter className="w-4 h-4 text-slate-400" />
                {['all', 'high', 'medium', 'low'].map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                      filter === f ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              {loading ? (
                <div className="text-center py-12 text-slate-400">Loading…</div>
              ) : issues.length === 0 ? (
                <div className="text-center py-12 text-slate-400">No open issues.</div>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-50">
                  {issues.map(issue => {
                    const isExpanded = expandedId === issue.id;
                    const isEditing  = editingId  === issue.id;
                    const issueComments = comments[issue.id] ?? [];
                    const isOverdue = issue.due_date && new Date(issue.due_date) < new Date() && !issue.resolved;
                    return (
                      <div key={issue.id}>
                        <div
                          className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50 transition-colors cursor-pointer"
                          onClick={() => {
                            const next = isExpanded ? null : issue.id;
                            setExpandedId(next);
                            setEditingId(null);
                            if (next) loadComments(issue);
                          }}
                        >
                          <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold uppercase border flex-shrink-0 ${severityColor(issue.severity)}`}>
                            {severityIcon(issue.severity)} {issue.severity}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link to={`/partners/${issue.partner_id}/terminal`} onClick={e => e.stopPropagation()}
                                className="text-xs text-slate-700 font-semibold hover:underline">{issue.partner_name}</Link>
                              <span className="text-slate-300 text-xs">›</span>
                              <span className={`text-sm font-medium ${issue.resolved ? 'line-through text-slate-400' : 'text-slate-800'}`}>{issue.title}</span>
                            </div>
                            {issue.body && !isExpanded && <div className="text-xs text-slate-500 mt-0.5 truncate">{issue.body}</div>}
                            <div className="flex items-center gap-4 mt-1 text-[10px] text-slate-400">
                              <span>Created {new Date(issue.created_at).toLocaleDateString()}</span>
                              {issue.due_date && (
                                <span className={isOverdue ? 'text-red-500 font-medium' : ''}>
                                  Deadline: {new Date(issue.due_date).toLocaleDateString()}{isOverdue && ' · OVERDUE'}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={async () => { await api.updateIssue(issue.partner_id, issue.id, { resolved: !issue.resolved }); loadIssues(); }}
                              className={`p-1 rounded ${issue.resolved ? 'bg-emerald-100 text-emerald-600' : 'hover:bg-emerald-50 text-slate-400 hover:text-emerald-500'}`}
                              title={issue.resolved ? 'Reopen' : 'Mark resolved'}
                            ><Check className="w-3.5 h-3.5" /></button>
                            <button
                              onClick={() => {
                                setEditingId(isEditing ? null : issue.id);
                                setExpandedId(issue.id);
                                if (!isEditing) loadComments(issue);
                                setEditForm({ title: issue.title, body: issue.body ?? '', severity: issue.severity, due_date: issue.due_date ? issue.due_date.split('T')[0] : '' });
                              }}
                              className={`p-1 rounded ${isEditing ? 'bg-slate-800 text-white' : 'hover:bg-slate-100 text-slate-400'}`}
                            ><Pencil className="w-3.5 h-3.5" /></button>
                            <button
                              onClick={async () => { await api.deleteIssue(issue.partner_id, issue.id); setExpandedId(null); loadIssues(); }}
                              className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                            ><Trash2 className="w-3.5 h-3.5" /></button>
                            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="px-5 pb-5 bg-slate-50 border-t border-slate-100">
                            {isEditing ? (
                              <div className="pt-3 space-y-2">
                                <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                                  className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white" placeholder="Title" />
                                <textarea value={editForm.body} onChange={e => setEditForm(f => ({ ...f, body: e.target.value }))}
                                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none resize-none bg-white" rows={2} placeholder="Description" />
                                <div className="flex items-center gap-2">
                                  <select value={editForm.severity} onChange={e => setEditForm(f => ({ ...f, severity: e.target.value }))}
                                    className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none bg-white">
                                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                                  </select>
                                  <input type="date" value={editForm.due_date} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))}
                                    className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none bg-white" />
                                  <button onClick={async () => { await api.updateIssue(issue.partner_id, issue.id, editForm); setEditingId(null); loadIssues(); }}
                                    disabled={!editForm.title.trim()}
                                    className="flex items-center gap-1 text-xs px-2 py-1 bg-slate-800 text-white rounded disabled:opacity-50">
                                    <Check className="w-3 h-3" /> Save
                                  </button>
                                  <button onClick={() => setEditingId(null)} className="text-xs text-slate-400 hover:text-slate-700">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              issue.body && <p className="pt-3 text-xs text-slate-600 leading-relaxed">{issue.body}</p>
                            )}
                            <div className="mt-3">
                              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                                Progress Updates {issueComments.length > 0 && `(${issueComments.length})`}
                              </div>
                              {issueComments.length > 0 && (
                                <div className="space-y-2 mb-3">
                                  {issueComments.map((c: any) => (
                                    <div key={c.id} className="bg-white border border-slate-200 rounded px-3 py-2">
                                      <p className="text-xs text-slate-700 leading-relaxed">{c.body}</p>
                                      <p className="text-[10px] text-slate-400 mt-1">
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
                                    if (e.key === 'Enter' && (newComment[issue.id] ?? '').trim()) {
                                      await api.addIssueComment(issue.partner_id, issue.id, newComment[issue.id]);
                                      await refreshComments(issue);
                                      setNewComment(prev => ({ ...prev, [issue.id]: '' }));
                                    }
                                  }}
                                  placeholder="Add progress update… (Enter to save)"
                                  className="flex-1 text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
                                />
                                <button
                                  onClick={async () => {
                                    if (!(newComment[issue.id] ?? '').trim()) return;
                                    await api.addIssueComment(issue.partner_id, issue.id, newComment[issue.id]);
                                    await refreshComments(issue);
                                    setNewComment(prev => ({ ...prev, [issue.id]: '' }));
                                  }}
                                  disabled={!(newComment[issue.id] ?? '').trim()}
                                  className="text-xs px-2 py-1 bg-slate-800 text-white rounded disabled:opacity-40"
                                >Add</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CollapsibleSection>

            {/* ── Recent Edits ── */}
            <CollapsibleSection
              id="recent-edits"
              icon={<PencilLine className="w-4 h-4" />}
              title="Recent Company Edits"
              sub="last 100 field changes across all analysts"
              open={open['recent-edits']}
              onToggle={() => toggle('recent-edits')}
            >
              {recentEdits.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">No recent edits.</div>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-50">
                  {recentEdits.map((row: any, i: number) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-3 bg-white hover:bg-slate-50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-slate-700">{row.company_name}</span>
                        <span className="text-xs text-slate-400 ml-2">{row.field_name.replace(/_/g, ' ')}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-medium shrink-0">{row.changed_by}</span>
                      <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap" title={new Date(row.changed_at).toLocaleString()}>
                        {(() => {
                          const d = Math.floor((Date.now() - new Date(row.changed_at).getTime()) / 86400000);
                          return d === 0 ? 'today' : d === 1 ? '1d ago' : `${d}d ago`;
                        })()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleSection>

          </div>
        )}

        <div className="h-16" />
      </div>

      {/* Add User Modal */}
      {showAddUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-[#33322c]">Add Team Member</h2>
              <button onClick={() => setShowAddUser(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-1">Username *</label>
                <input
                  autoFocus
                  type="text"
                  value={addUserForm.username}
                  onChange={e => setAddUserForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="e.g. jsmith"
                  className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-1">Password * (min 8 chars)</label>
                <div className="relative">
                  <input
                    type={showAddPw ? 'text' : 'password'}
                    value={addUserForm.password}
                    onChange={e => setAddUserForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Temporary password"
                    className="w-full px-3 py-2 pr-9 border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAddPw(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showAddPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-1">Role *</label>
                <select
                  value={addUserForm.role}
                  onChange={e => setAddUserForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded text-sm bg-white focus:outline-none focus:border-slate-400"
                >
                  {['GP', 'Principal', 'Director', 'Ventures', 'Senior PSM', 'PSM'].map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-1">Full Name</label>
                <input
                  type="text"
                  value={addUserForm.full_name}
                  onChange={e => setAddUserForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="Jane Smith"
                  className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-1">Email</label>
                <input
                  type="email"
                  value={addUserForm.email}
                  onChange={e => setAddUserForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="jsmith@firm.com"
                  className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400"
                />
              </div>

              {addUserError && (
                <p className="text-xs text-red-500">{addUserError}</p>
              )}
            </div>

            <div className="flex gap-2 justify-end mt-5">
              <button
                onClick={() => setShowAddUser(false)}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createUser}
                disabled={addUserSaving}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#1E293B] text-cvc-gold text-sm font-semibold rounded hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                <UserPlus className="w-3.5 h-3.5" />
                {addUserSaving ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
