import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Menu, LogOut, MessageSquare, Search, Camera, ClipboardList, FileText, ChevronDown, KeyRound, Eye, EyeOff, X, HelpCircle } from 'lucide-react';
import HelpPanel from './HelpPanel';
import { api } from '../api/client';
import { FeedbackModal } from './FeedbackModal';
import { useConfig } from '../hooks/useConfig';
import { usePlugins } from '../hooks/usePlugins';
import { NotificationBell } from './NotificationBell';
import { QuickNotePanel } from './QuickNotePanel';

function getJwtHeader(): { Authorization: string } {
  const token = localStorage.getItem('platform_jwt');
  return token ? { Authorization: 'Bearer ' + token } : { Authorization: '' };
}

interface SearchResult { id: number; name: string; sector?: string; stage?: string; }

function GlobalSearch() {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen]       = useState(false);
  const [active, setActive]   = useState(-1);
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef              = useRef<HTMLInputElement>(null);
  const navigate              = useNavigate();

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/companies?q=${encodeURIComponent(query)}&limit=8`, { headers: getJwtHeader() });
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
        setActive(-1);
      } catch { setResults([]); }
    }, 250);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  function pick(id: number) {
    setQuery(''); setResults([]); setOpen(false);
    navigate(`/company/${id}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0) pick(results[active].id);
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  }

  return (
    <div className="relative hidden sm:block">
      <div className="flex items-center gap-1.5 bg-white/10 border border-white/15 rounded px-2.5 py-1.5 w-52 focus-within:border-cvc-gold/60 transition-colors">
        <Search className="w-3.5 h-3.5 text-white/40 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search companies…"
          className="bg-transparent text-white text-sm placeholder-white/30 outline-none w-full"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 w-72 bg-[#1e293b] border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden">
          {results.map((r, i) => (
            <button
              key={r.id}
              onMouseDown={() => pick(r.id)}
              className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 transition-colors ${i === active ? 'bg-cvc-gold/15' : 'hover:bg-white/5'}`}
            >
              <span className="text-white text-sm font-medium truncate">{r.name}</span>
              <span className="text-slate-500 text-xs shrink-0">{r.sector ?? ''}</span>
            </button>
          ))}
        </div>
      )}
      {open && query.length >= 2 && results.length === 0 && (
        <div className="absolute top-full mt-1 left-0 w-72 bg-[#1e293b] border border-slate-700 rounded-lg shadow-xl z-50 px-4 py-3 text-slate-400 text-sm">
          No companies found
        </div>
      )}
    </div>
  );
}

// ── User avatar menu ──────────────────────────────────────────────────────────

function getInitials(fullName: string | null, username: string): string {
  if (fullName && fullName.trim()) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  return username.slice(0, 2).toUpperCase();
}

interface AssignmentItem {
  id: number;
  title: string;
  status: string;
  priority: string;
  service_type: string;
}

const ASSIGN_STATUS_DOT: Record<string, string> = {
  open:      'bg-slate-500',
  active:    'bg-[#F0E545]',
  completed: 'bg-emerald-500',
};

function avatarUrl(username: string): string {
  const ext = localStorage.getItem(`platform_avatar_ext_${username}`) ?? '.jpeg';
  const v   = localStorage.getItem(`platform_avatar_v_${username}`) ?? '1';
  return `/static/avatars/${username}${ext}?v=${v}`;
}

function UserMenu({ onLogout }: { onLogout: () => void }) {
  const user        = api.getCurrentUser();
  const username    = user?.username ?? '';
  const fullName    = user?.full_name ?? null;
  const role        = user?.role ?? '';
  const initials    = getInitials(fullName, username);

  const [open,         setOpen]        = useState(false);
  const [photoOk,      setPhotoOk]     = useState(false);   // true when server avatar exists
  const [photoSrc,     setPhotoSrc]    = useState('');
  const [assignments,  setAssignments] = useState<AssignmentItem[]>([]);
  const [loadingA,     setLoadingA]    = useState(false);
  const dropRef   = useRef<HTMLDivElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);

  // Change password modal
  const [showChangePw,  setShowChangePw]  = useState(false);
  const [cpCurrent,     setCpCurrent]     = useState('');
  const [cpNew,         setCpNew]         = useState('');
  const [cpConfirm,     setCpConfirm]     = useState('');
  const [cpError,       setCpError]       = useState('');
  const [cpSuccess,     setCpSuccess]     = useState(false);
  const [cpSaving,      setCpSaving]      = useState(false);
  const [cpShowNew,     setCpShowNew]     = useState(false);

  const openChangePw = () => {
    setShowChangePw(true); setOpen(false);
    setCpCurrent(''); setCpNew(''); setCpConfirm(''); setCpError(''); setCpSuccess(false);
  };

  const submitChangePw = async () => {
    if (cpNew.length < 8) { setCpError('New password must be at least 8 characters'); return; }
    if (cpNew !== cpConfirm) { setCpError('Passwords do not match'); return; }
    setCpSaving(true); setCpError('');
    try {
      // Verify current password via login
      const loginRes = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: cpCurrent }),
      });
      if (!loginRes.ok) { setCpError('Current password is incorrect'); setCpSaving(false); return; }
      const loginData = await loginRes.json();
      const userId = JSON.parse(atob(loginData.access_token.split('.')[1])).sub;
      const res = await fetch(`/auth/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${loginData.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: cpNew }),
      });
      if (!res.ok) { const d = await res.json(); setCpError(d.detail || 'Failed'); setCpSaving(false); return; }
      setCpSuccess(true);
    } catch { setCpError('Request failed'); }
    setCpSaving(false);
  };

  // Probe for server-side avatar on mount
  useEffect(() => {
    if (!username) return;
    const url = avatarUrl(username);
    setPhotoSrc(url);
    const img = new Image();
    img.onload  = () => setPhotoOk(true);
    img.onerror = () => setPhotoOk(false);
    img.src = url;
  }, [username]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Fetch assignments when dropdown opens
  useEffect(() => {
    if (!open || !username) return;
    setLoadingA(true);
    const token = localStorage.getItem('platform_jwt');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`/requests?assignee=${encodeURIComponent(username)}`, { headers })
      .then(r => r.ok ? r.json() : { requests: [] })
      .then(d => setAssignments((d.requests ?? []).slice(0, 8)))
      .catch(() => setAssignments([]))
      .finally(() => setLoadingA(false));
  }, [open, username]);

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const token = localStorage.getItem('platform_jwt');
    const form  = new FormData();
    form.append('file', file);
    const res = await fetch('/auth/avatar', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (res.ok) {
      const data = await res.json();
      const ext  = '.' + (data.url?.split('.').pop() ?? file.name.split('.').pop()?.toLowerCase() ?? 'jpeg');
      const v    = String(Date.now());
      localStorage.setItem(`platform_avatar_ext_${username}`, ext);
      localStorage.setItem(`platform_avatar_v_${username}`, v);
      setPhotoSrc(`/static/avatars/${username}${ext}?v=${v}`);
      setPhotoOk(true);
    }
    e.target.value = '';
  }

  const Avatar = ({ size }: { size: 'sm' | 'md' }) => {
    const dim = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
    return photoOk
      ? <img src={photoSrc} alt={initials} className={`${dim} rounded-full object-cover ring-2 ring-white/10 shrink-0`} />
      : <div className={`${dim} rounded-full bg-cvc-gold flex items-center justify-center ring-2 ring-white/10 shrink-0`}>
          <span className="text-[#151411] font-extrabold tracking-tight">{initials}</span>
        </div>;
  };

  return (
    <>
    <div className="relative" ref={dropRef}>
      {/* Avatar button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-full transition-all hover:ring-2 hover:ring-cvc-gold/50 focus:outline-none"
        title={fullName ?? username}
      >
        <Avatar size="sm" />
        <ChevronDown className={`w-3 h-3 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-[#1e293b] border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">

          {/* User header */}
          <div className="px-4 py-3 border-b border-slate-700/60 flex items-center gap-3">
            <Avatar size="md" />
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate">{fullName ?? username}</p>
              <p className="text-slate-400 text-[11px]">{role} · {username}</p>
            </div>
          </div>

          {/* Assignments */}
          <div className="border-b border-slate-700/60">
            <div className="px-4 pt-2.5 pb-1 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">My Assignments</span>
              <Link
                to="/requests"
                onClick={() => setOpen(false)}
                className="text-[10px] text-slate-500 hover:text-cvc-gold transition-colors"
              >
                View all →
              </Link>
            </div>
            <div className="max-h-52 overflow-y-auto pb-1.5">
              {loadingA ? (
                <p className="px-4 py-3 text-xs text-slate-600 italic">Loading…</p>
              ) : assignments.length === 0 ? (
                <p className="px-4 py-3 text-xs text-slate-600 italic">No assignments</p>
              ) : (
                assignments.map(a => (
                  <Link
                    key={a.id}
                    to={`/requests?open=${a.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 px-4 py-2 hover:bg-white/5 transition-colors group"
                  >
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${ASSIGN_STATUS_DOT[a.status] ?? 'bg-slate-500'}`} />
                    <span className="text-sm text-slate-300 group-hover:text-white leading-snug line-clamp-2 transition-colors">
                      {a.title}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Bottom actions */}
          <div className="py-1.5">
            <div className="flex items-center gap-3 px-4 py-2 text-sm text-slate-600 cursor-not-allowed select-none">
              <FileText className="w-4 h-4 text-slate-700 shrink-0" />
              <span>Onboarding Docs <span className="text-[10px] ml-1">coming soon</span></span>
            </div>
          </div>

          <div className="border-t border-slate-700/60 py-1.5">
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              <Camera className="w-4 h-4 text-slate-500 shrink-0" />
              {photoOk ? 'Change Photo' : 'Add Photo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
            <button
              onClick={openChangePw}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              <KeyRound className="w-4 h-4 text-slate-500 shrink-0" />
              Change Password
            </button>
          </div>

          <div className="border-t border-slate-700/60 py-1.5">
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:text-red-400 hover:bg-white/5 transition-colors"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>

    {/* Change Password Modal */}
    {showChangePw && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm mx-4 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-500" /> Change Password
            </h2>
            <button onClick={() => setShowChangePw(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          {cpSuccess ? (
            <div className="text-center py-4">
              <div className="text-emerald-600 font-semibold mb-2">Password updated successfully.</div>
              <p className="text-xs text-slate-400 mb-4">You'll need to use your new password next time you log in.</p>
              <button onClick={() => setShowChangePw(false)}
                className="px-4 py-2 bg-slate-800 text-white text-sm rounded hover:bg-slate-700">
                Done
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-1">Current Password</label>
                <input
                  type="password"
                  autoFocus
                  value={cpCurrent}
                  onChange={e => { setCpCurrent(e.target.value); setCpError(''); }}
                  className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400"
                  placeholder="Your current password"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-1">New Password (min 8 chars)</label>
                <div className="relative">
                  <input
                    type={cpShowNew ? 'text' : 'password'}
                    value={cpNew}
                    onChange={e => { setCpNew(e.target.value); setCpError(''); }}
                    className="w-full px-3 py-2 pr-9 border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400"
                    placeholder="New password"
                  />
                  <button type="button" onClick={() => setCpShowNew(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {cpShowNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={cpConfirm}
                  onChange={e => { setCpConfirm(e.target.value); setCpError(''); }}
                  className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400"
                  placeholder="Repeat new password"
                />
              </div>
              {cpError && <p className="text-xs text-red-500">{cpError}</p>}
              <div className="flex gap-2 justify-end pt-1">
                <button onClick={() => setShowChangePw(false)}
                  className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={submitChangePw} disabled={cpSaving || !cpCurrent || !cpNew || !cpConfirm}
                  className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded hover:bg-slate-700 disabled:opacity-50 transition-colors">
                  {cpSaving ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
}

const CVCNavbar: React.FC = () => {
  const [menuOpen, setMenuOpen]         = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showHelp, setShowHelp]         = useState(false);
  const location = useLocation();
  const navigate  = useNavigate();

  const config = useConfig();
  const plugins = usePlugins();
  const currentUser = api.getCurrentUser();
  const role = currentUser?.role ?? 'GP';
  const isPSM      = role === 'PSM';
  const isVentures = role === 'Ventures';
  const showAdmin  = !isPSM && !isVentures;   // GP / Principal / Director only

  const coreNavLinks = [
    { path: '/',           label: 'Home',       roles: null },  // null = all roles
    { path: '/ventures',   label: 'Ventures',   roles: null },
    { path: '/partners',   label: 'Partners',   roles: null },
    { path: '/sales',      label: 'Sales',      roles: null },
    { path: '/requests',   label: 'Requests',   roles: null },
  ];

  // Inject plugin nav entries for plugins that have a nav declaration and allow this role
  const pluginNavLinks = plugins
    .filter(p => p.nav && (!p.nav.roles || p.nav.roles.includes(role)))
    .map(p => ({ path: p.nav!.path, label: p.nav!.label, roles: p.nav!.roles ?? null }));

  const allNavLinks = [...coreNavLinks, ...pluginNavLinks];
  const navLinks = allNavLinks.filter(l => l.roles === null || (l.roles as string[]).includes(role));

  const isActive = (path: string) =>
    path === '/'
      ? location.pathname === '/'
      : location.pathname === path || location.pathname.startsWith(path + '/');

  const handleLogout = () => {
    api.logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
    <nav className="bg-[#151411] border-b border-white/10 sticky top-0 z-50">
      <div className="max-w-[1800px] mx-auto px-4 md:px-8">
        <div className="flex items-center justify-between h-14">

          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 bg-cvc-gold rounded flex items-center justify-center">
              <span className="text-[#151411] font-bold text-sm">{config.logo_char}</span>
            </div>
            <span className="text-white font-bold text-base tracking-tight">{config.team_name}</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-stretch gap-0 mx-6 flex-1 overflow-x-auto h-14">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`flex items-center px-4 text-sm font-semibold tracking-tight transition-all whitespace-nowrap border-b-[3px] ${
                  isActive(link.path)
                    ? 'border-cvc-gold text-white bg-white/5'
                    : 'border-transparent text-white/60 hover:text-white hover:bg-white/5 hover:border-white/20'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 shrink-0">
            <GlobalSearch />
            <NotificationBell />
            <button
              onClick={() => setShowFeedback(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded text-sm font-medium transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              Feedback
            </button>
            {showAdmin && (
              <>
                <Link
                  to="/admin"
                  className={`hidden sm:flex items-center px-3 py-1.5 rounded text-sm font-semibold transition-colors ${
                    isActive('/admin')
                      ? 'bg-cvc-gold text-[#151411]'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  Admin
                </Link>
              </>
            )}
            <button
              onClick={() => setShowHelp(true)}
              title="Help"
              className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            <UserMenu onLogout={handleLogout} />
            <button
              className="lg:hidden p-2 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="lg:hidden py-2 border-t border-white/10 flex flex-col gap-0.5">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setMenuOpen(false)}
                className={`px-4 py-2 rounded text-sm font-semibold tracking-tight transition-colors ${
                  isActive(link.path)
                    ? 'text-cvc-gold bg-white/5'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
    {showFeedback && (
      <FeedbackModal currentPath={location.pathname} onClose={() => setShowFeedback(false)} />
    )}
    <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} currentRole={currentUser?.role} />
    <QuickNotePanel />
    </>
  );
};

export { CVCNavbar };
export default CVCNavbar;
