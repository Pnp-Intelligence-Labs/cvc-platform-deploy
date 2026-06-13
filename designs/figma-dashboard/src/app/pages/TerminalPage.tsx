import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { CVCNavbar } from '../components/CVCNavbar';
import { AUTH_HEADER } from '../api/client';
import {
  FolderOpen, Folder, FileText, RefreshCw, Loader2,
  ChevronRight, ChevronDown, CheckSquare, Square,
  CloudDownload, AlertCircle, CheckCircle2,
  HardDrive, Trash2, Sparkles, Send, X, Plug,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriveFile { id: string; name: string; mimeType: string; size?: string; }
interface DriveFolder { id: string; name: string; children: DriveTree; }
interface DriveTree { folders: DriveFolder[]; files: DriveFile[]; truncated?: boolean; }

interface TermDoc {
  id: number;
  filename: string;
  doc_type: string;
  chars: number;
  conversion: string;
  summary: string;
  key_points: string[];
  ingested_at: string;
  target_tab?: string;
  target_confidence?: string;
  target_reason?: string;
}

interface DocDetail extends TermDoc { text: string; }
interface AskSource { id: number; filename: string; doc_type: string; }

// ── Doc-type labels ─────────────────────────────────────────────────────────────

const DOC_LABEL: Record<string, string> = {
  pitch_deck: 'Pitch Deck', financial_model: 'Financial Model', financial_statement: 'Financials',
  financials: 'Financials', cap_table: 'Cap Table', customer_contract: 'Contract', investor_qa: 'Investor Q&A',
  team_bio: 'Team', legal_terms: 'Legal Terms', legal: 'Legal', patent_ip: 'IP / Patent',
  legal_formation: 'Formation', memo: 'Memo', report: 'Report', meeting_notes: 'Meeting Notes',
  metrics: 'Metrics', other: 'Document', unknown: 'Document',
};
const docLabel = (t: string) => DOC_LABEL[t] ?? t;

// Where the data lives — tab assigned by the ingestion classifier.
const TAB_LABEL: Record<string, string> = {
  home: 'Home / My Desk', ventures: 'Ventures', partners: 'Partners', sales: 'Sales', requests: 'Requests',
};
const tabLabel = (t?: string) => (t ? TAB_LABEL[t] ?? t : null);

function TabBadge({ tab, reason }: { tab?: string; reason?: string }) {
  const label = tabLabel(tab);
  if (!label) return null;
  return (
    <span title={reason || undefined}
      className="text-[9px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1 py-0.5 mt-1 ml-1 inline-block">
      → {label}
    </span>
  );
}

function mimeIcon(mime: string) {
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📑';
  if (mime.includes('document') || mime.includes('word')) return '📝';
  if (mime.includes('image')) return '🖼️';
  return '📎';
}
function fmtSize(bytes?: string) {
  if (!bytes) return '';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function collectFileIds(tree: DriveTree): string[] {
  const ids = tree.files.map(f => f.id);
  for (const folder of tree.folders) ids.push(...collectFileIds(folder.children));
  return ids;
}

// ── Tree components ───────────────────────────────────────────────────────────

function FileRow({ file, selected, onToggle, depth = 0 }: {
  file: DriveFile; selected: boolean; onToggle: (ids: string[], c: boolean) => void; depth?: number;
}) {
  return (
    <div style={{ marginLeft: depth * 16 }}
      className={`flex items-center gap-1.5 py-0.5 px-1 rounded cursor-pointer hover:bg-slate-50 ${selected ? 'bg-blue-50' : ''}`}
      onClick={() => onToggle([file.id], !selected)}>
      <button className="shrink-0 text-slate-400">
        {selected ? <CheckSquare className="w-3.5 h-3.5 text-[#1e293b]" /> : <Square className="w-3.5 h-3.5" />}
      </button>
      <span className="text-xs shrink-0">{mimeIcon(file.mimeType)}</span>
      <span className="text-xs text-[#33322c] truncate flex-1">{file.name}</span>
      {file.size && <span className="text-[10px] text-[#787569] shrink-0">{fmtSize(file.size)}</span>}
    </div>
  );
}

function FolderNode({ folder, selected, onToggle, depth = 0 }: {
  folder: DriveFolder; selected: Set<string>; onToggle: (ids: string[], c: boolean) => void; depth?: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const allIds = collectFileIds(folder.children);
  const checked = allIds.filter(id => selected.has(id));
  const allChecked = allIds.length > 0 && checked.length === allIds.length;

  return (
    <div style={{ marginLeft: depth * 16 }}>
      <div className="flex items-center gap-1.5 py-1 cursor-pointer hover:bg-slate-50 rounded px-1">
        <button onClick={() => onToggle(allIds, !allChecked)} className="shrink-0 text-slate-400 hover:text-slate-600">
          {allChecked ? <CheckSquare className="w-3.5 h-3.5 text-[#1e293b]" /> : <Square className="w-3.5 h-3.5" />}
        </button>
        <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1 flex-1 min-w-0 text-left">
          <span className="text-slate-400 shrink-0">{open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</span>
          {open ? <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
          <span className="text-xs font-medium text-[#33322c] truncate">{folder.name}</span>
          <span className="text-[10px] text-[#787569] shrink-0 ml-1">{allIds.length > 0 ? `${checked.length}/${allIds.length}` : ''}</span>
        </button>
      </div>
      {open && (
        <div>
          {folder.children.folders.map(sub => <FolderNode key={sub.id} folder={sub} selected={selected} onToggle={onToggle} depth={depth + 1} />)}
          {folder.children.files.map(file => <FileRow key={file.id} file={file} selected={selected.has(file.id)} onToggle={onToggle} depth={depth + 1} />)}
          {folder.children.truncated && <p className="text-[10px] text-[#787569] italic ml-6 py-0.5">Folder too deep — not shown</p>}
        </div>
      )}
    </div>
  );
}

// ── Document detail modal ───────────────────────────────────────────────────────

function DocModal({ doc, onClose }: { doc: DocDetail; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#1e293b] truncate">{doc.filename}</p>
            <span className="text-[10px] font-medium text-emerald-700 bg-emerald-100 border border-emerald-200 rounded px-1.5 py-0.5 mt-1 inline-block">{docLabel(doc.doc_type)}</span>
            <TabBadge tab={doc.target_tab} reason={doc.target_reason} />
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Summary</p>
            <p className="text-sm text-[#33322c] leading-relaxed">{doc.summary}</p>
          </div>
          {doc.key_points?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Key Points</p>
              <ul className="list-disc pl-5 space-y-1">
                {doc.key_points.map((p, i) => <li key={i} className="text-sm text-[#33322c]">{p}</li>)}
              </ul>
            </div>
          )}
          {doc.text && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Extracted Text</p>
              <pre className="text-xs text-[#545249] whitespace-pre-wrap bg-[#f8fafc] border border-slate-100 rounded p-3 max-h-64 overflow-y-auto">{doc.text.slice(0, 20000)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

interface TerminalPanelProps {
  /** After OAuth, where to redirect back. "" = home (/app/), "terminal" = /app/terminal. */
  returnTo?: string;
  /** Whether to render the h1/description header row. False when embedded in MyDesk. */
  showHeader?: boolean;
}

export function TerminalPanel({ returnTo = 'terminal', showHeader = true }: TerminalPanelProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [auth, setAuth]           = useState<{ authenticated: boolean; google_email?: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tree, setTree]           = useState<DriveTree | null>(null);
  const [loading, setLoading]     = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [ingesting, setIngesting] = useState(false);
  const [ingestProgress, setIngestProgress] = useState<{ progress: number; total: number } | null>(null);
  const [docs, setDocs]           = useState<TermDoc[]>([]);
  const [detail, setDetail]       = useState<DocDetail | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [question, setQuestion]   = useState('');
  const [asking, setAsking]       = useState(false);
  const [answer, setAnswer]       = useState<{ answer: string; sources: AskSource[] } | null>(null);

  // Capture the OAuth result once, on first render — the mount effect below
  // strips these params from the URL, so reading them live would blank the
  // success/error banner before the user ever sees it.
  const [oauthResult] = useState(() => ({
    connected: searchParams.get('drive_connected') === '1',
    error: searchParams.get('drive_error'),
  }));
  const connected  = oauthResult.connected;
  const oauthError = oauthResult.error;

  const checkStatus = useCallback(async () => {
    setAuthLoading(true);
    try {
      const res = await fetch('/terminal/status', { headers: AUTH_HEADER });
      if (res.ok) {
        const s = await res.json();
        setAuth({ authenticated: !!s.connected, google_email: s.google_email });
      } else {
        setAuth({ authenticated: false });
      }
    } catch {
      setAuth({ authenticated: false });
    }
    setAuthLoading(false);
  }, []);

  const fetchTree = useCallback(async () => {
    setLoading(true); setBrowseError(null); setTree(null);
    try {
      const res = await fetch('/terminal/browse', { headers: AUTH_HEADER });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setBrowseError(b.detail ?? `Error ${res.status}`); }
      else setTree(await res.json());
    } catch (e) { setBrowseError(`Network error: ${e}`); }
    setLoading(false);
  }, []);

  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch('/terminal/documents', { headers: AUTH_HEADER });
      if (res.ok) setDocs((await res.json()).documents ?? []);
    } catch {}
  }, []);

  useEffect(() => {
    checkStatus();
    fetchDocs();
    if (connected || oauthError) {
      // Only clear the drive OAuth params, preserve everything else (e.g. as_user)
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('drive_connected');
        next.delete('drive_error');
        return next;
      }, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (auth?.authenticated) fetchTree(); }, [auth?.authenticated, fetchTree]);

  async function connectDrive() {
    setConnecting(true);
    setConnectError(null);
    try {
      const encodedReturn = encodeURIComponent(returnTo);
      const res = await fetch(`/terminal/auth-url?return_to=${encodedReturn}`, { headers: AUTH_HEADER });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setConnectError(data.detail ?? 'Could not start Google sign-in. Check Drive credentials are configured.');
        setConnecting(false);
      }
    } catch (e) {
      setConnectError(`Network error: ${e}`);
      setConnecting(false);
    }
  }

  async function disconnect() {
    await fetch('/terminal/disconnect', { method: 'POST', headers: AUTH_HEADER }).catch(() => {});
    setAuth({ authenticated: false });
    setTree(null);
  }

  function toggle(ids: string[], checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) ids.forEach(id => next.add(id)); else ids.forEach(id => next.delete(id));
      return next;
    });
  }

  async function runIngest() {
    if (selected.size === 0) return;
    setIngesting(true); setBrowseError(null); setIngestProgress(null);
    try {
      const res = await fetch('/terminal/ingest', {
        method: 'POST', headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: [...selected] }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setBrowseError(b.detail ?? `Error ${res.status}`);
        setIngesting(false);
        return;
      }
      const { job_id, total } = await res.json();
      setIngestProgress({ progress: 0, total });
      while (true) {
        await new Promise(r => setTimeout(r, 2000));
        const sr = await fetch(`/terminal/ingest/${job_id}`, { headers: AUTH_HEADER });
        if (!sr.ok) break;
        const job = await sr.json();
        setIngestProgress({ progress: job.progress, total: job.total });
        if (job.status === 'done' || job.status === 'failed') break;
      }
      setSelected(new Set());
      fetchDocs();
    } catch (e) { setBrowseError(`Network error: ${e}`); }
    setIngesting(false);
    setIngestProgress(null);
  }

  async function openDoc(id: number) {
    try {
      const res = await fetch(`/terminal/documents/${id}`, { headers: AUTH_HEADER });
      if (res.ok) setDetail(await res.json());
    } catch {}
  }

  async function removeDoc(id: number) {
    await fetch(`/terminal/documents/${id}`, { method: 'DELETE', headers: AUTH_HEADER }).catch(() => {});
    setDocs(prev => prev.filter(d => d.id !== id));
  }

  async function ask() {
    if (!question.trim()) return;
    setAsking(true); setAnswer(null);
    try {
      const res = await fetch('/terminal/ask', {
        method: 'POST', headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      });
      if (res.ok) setAnswer(await res.json());
    } catch {}
    setAsking(false);
  }

  const allIds = tree ? collectFileIds(tree) : [];

  return (
    <div className="space-y-4">

      {/* Header row — optional */}
      {showHeader && (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-[#787569] shrink-0" />
            <div>
              <h1 className="text-lg font-bold text-[#1e293b]">My Terminal</h1>
              <p className="text-xs text-[#787569]">Your personal workspace, powered by your own Google Drive. Connect, ingest, and ask.</p>
            </div>
          </div>
          {auth?.authenticated && (
            <div className="flex items-center gap-2 flex-wrap">
              {auth.google_email && <span className="text-[11px] text-[#787569]">{auth.google_email}</span>}
              <button onClick={disconnect} className="text-[10px] text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1">Disconnect</button>
            </div>
          )}
        </div>
      )}

      {/* Disconnect button when header hidden (embedded mode) */}
      {!showHeader && auth?.authenticated && (
        <div className="flex items-center justify-end gap-2">
          {auth.google_email && <span className="text-[11px] text-[#787569]">{auth.google_email}</span>}
          <button onClick={disconnect} className="text-[10px] text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1">Disconnect</button>
        </div>
      )}

      {/* OAuth success banner */}
      {connected && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Google Drive connected successfully.
        </div>
      )}
      {oauthError && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Google OAuth error: {oauthError}. Please try again.
        </div>
      )}

      {/* Loading auth status */}
      {authLoading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-[#787569]" />
          <span className="ml-2 text-sm text-[#787569]">Checking Drive connection…</span>
        </div>
      )}

      {/* Connect gate */}
      {!authLoading && auth && !auth.authenticated && (
        <div className="flex flex-col items-center justify-center gap-5 py-10 sm:py-14 rounded-xl bg-gradient-to-br from-[#f8f6f0] to-[#f0ede6] border border-[#e8e2d6]">
          <div className="w-14 h-14 rounded-2xl bg-white shadow-sm border border-[#e8e2d6] flex items-center justify-center">
            <HardDrive className="w-7 h-7 text-[#8a7200]" />
          </div>
          <div className="text-center px-4 max-w-xs">
            <p className="text-base font-bold text-[#1e293b]">Connect your Google Drive</p>
            <p className="text-sm text-[#787569] mt-1.5 leading-relaxed">
              Authorize once. Ingest pitch decks, financials &amp; more — only you see what you add here.
            </p>
          </div>
          {connectError && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 max-w-sm mx-4 text-center">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{connectError}</span>
            </div>
          )}
          <button
            onClick={connectDrive}
            disabled={connecting}
            className="flex items-center gap-2.5 px-5 py-2.5 bg-[#1e293b] text-[#f59e0b] text-sm font-bold rounded-lg hover:bg-[#334155] disabled:opacity-50 transition-colors shadow-sm"
          >
            {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
            {connecting ? 'Opening Google…' : 'Connect with Google Drive'}
          </button>
        </div>
      )}

      {/* Authenticated workspace */}
      {!authLoading && auth?.authenticated && (
        <div className="flex flex-col lg:flex-row gap-4 items-start">

          {/* Left: Drive browser */}
          <div className="flex-1 min-w-0 border border-slate-200 rounded-lg bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-[#f8fafc]">
              <div className="flex items-center gap-2">
                <HardDrive className="w-3.5 h-3.5 text-[#787569]" />
                <span className="text-xs font-bold uppercase tracking-widest text-[#787569]">Your Google Drive</span>
                {tree && <span className="text-[10px] bg-slate-100 text-[#545249] rounded px-1.5 py-0.5 font-mono">{selected.size} selected</span>}
              </div>
              <div className="flex items-center gap-2">
                {tree && allIds.length > 0 && (
                  <>
                    <button onClick={() => setSelected(new Set(allIds))} className="text-[10px] text-[#545249] hover:text-[#1e293b] border border-slate-200 rounded px-2 py-1">Select all</button>
                    <button onClick={() => setSelected(new Set())} className="text-[10px] text-[#545249] hover:text-[#1e293b] border border-slate-200 rounded px-2 py-1">Clear</button>
                  </>
                )}
                <button onClick={fetchTree} disabled={loading}
                  className="flex items-center gap-1 text-[10px] text-[#545249] hover:text-[#1e293b] border border-slate-200 rounded px-2 py-1 disabled:opacity-40">
                  <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
            </div>

            <div className="p-3 max-h-[380px] sm:max-h-[420px] overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center py-14">
                  <Loader2 className="w-5 h-5 animate-spin text-[#787569]" />
                  <span className="ml-2 text-sm text-[#787569]">Loading Drive…</span>
                </div>
              )}
              {browseError && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="text-xs">{browseError}</div>
                </div>
              )}
              {tree && (
                <div className="space-y-0.5">
                  {tree.files.map(f => <FileRow key={f.id} file={f} selected={selected.has(f.id)} onToggle={toggle} />)}
                  {tree.folders.map(folder => <FolderNode key={folder.id} folder={folder} selected={selected} onToggle={toggle} />)}
                  {tree.folders.length === 0 && tree.files.length === 0 && (
                    <p className="text-sm text-[#787569] text-center py-8">Drive is empty or nothing accessible.</p>
                  )}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-100 bg-[#f8fafc]">
              <button
                onClick={runIngest}
                disabled={ingesting || selected.size === 0}
                className="w-full flex items-center justify-center gap-2 text-xs bg-[#1e293b] text-[#f59e0b] rounded-lg px-3 py-2.5 font-bold disabled:opacity-40 hover:bg-[#334155] transition-colors"
              >
                {ingesting
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {ingestProgress ? `${ingestProgress.progress}/${ingestProgress.total} files…` : 'Starting…'}</>
                  : <><CloudDownload className="w-3.5 h-3.5" /> Ingest {selected.size > 0 ? `${selected.size} file${selected.size !== 1 ? 's' : ''}` : 'selected'}</>
                }
              </button>
            </div>
          </div>

          {/* Right: Ask + documents */}
          <div className="w-full lg:w-96 shrink-0 space-y-3">

            {/* Ask */}
            <div className="border border-slate-200 rounded-lg bg-white p-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-widest text-[#787569] flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> Ask your documents
              </p>
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') ask(); }}
                  placeholder="e.g. What is the revenue projection?"
                  className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-2 bg-[#ede8d7] focus:outline-none focus:border-slate-400"
                />
                <button
                  onClick={ask}
                  disabled={asking || !question.trim()}
                  className="flex items-center justify-center bg-[#1e293b] text-[#f59e0b] rounded-lg px-3 disabled:opacity-40 hover:bg-[#334155]"
                >
                  {asking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </button>
              </div>
              {answer && (
                <div className="text-xs text-[#33322c] bg-[#f8fafc] border border-slate-100 rounded-lg p-3 whitespace-pre-wrap">
                  {answer.answer}
                  {answer.sources?.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-1">
                      {answer.sources.map(s => (
                        <span key={s.id} className="text-[10px] text-[#787569] bg-slate-100 rounded px-1.5 py-0.5">{s.filename}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Documents */}
            <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-[#f8fafc] border-b border-slate-100">
                <p className="text-xs font-bold uppercase tracking-widest text-[#787569]">My Documents</p>
                <span className="text-[10px] bg-slate-100 text-[#545249] rounded px-1.5 py-0.5 font-mono">{docs.length}</span>
              </div>
              <div className="divide-y divide-slate-50 max-h-[380px] sm:max-h-[420px] overflow-y-auto">
                {docs.length === 0 && (
                  <p className="text-xs text-[#787569] text-center py-8">Nothing ingested yet. Select files and ingest.</p>
                )}
                {docs.map(d => (
                  <div key={d.id} className="px-4 py-3 hover:bg-slate-50 group">
                    <div className="flex items-start justify-between gap-2">
                      <button onClick={() => openDoc(d.id)} className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-3 h-3 text-[#787569] shrink-0" />
                          <span className="text-xs font-medium text-[#33322c] truncate">{d.filename}</span>
                        </div>
                        <p className="text-[11px] text-[#787569] mt-1 line-clamp-2 leading-snug">{d.summary}</p>
                        <span className="text-[9px] font-medium text-emerald-700 bg-emerald-100 border border-emerald-200 rounded px-1 py-0.5 mt-1 inline-block">{docLabel(d.doc_type)}</span>
                        <TabBadge tab={d.target_tab} reason={d.target_reason} />
                      </button>
                      <button
                        onClick={() => removeDoc(d.id)}
                        className="shrink-0 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {detail && <DocModal doc={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

export default function TerminalPage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      <CVCNavbar />
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <TerminalPanel />
      </div>
    </div>
  );
}
