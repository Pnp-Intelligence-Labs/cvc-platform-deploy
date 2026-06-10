import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { CVCNavbar } from '../components/CVCNavbar';
import { AUTH_HEADER } from '../api/client';
import {
  FolderOpen, Folder, FileText, RefreshCw, Loader2,
  ChevronRight, ChevronDown, CheckSquare, Square,
  CloudDownload, AlertCircle, CheckCircle2, XCircle,
  HardDrive, Info, Trash2, ExternalLink,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

interface DriveFolder {
  id: string;
  name: string;
  children: DriveTree;
}

interface DriveTree {
  folders: DriveFolder[];
  files: DriveFile[];
  truncated?: boolean;
}

interface IngestDoc {
  filename: string;
  doc_type: string;
  chars: number;
  conversion: string;
}

interface IngestResult {
  company: string;
  date: string;
  summary: { total: number; converted: number; skipped: number; failed: number };
  documents: IngestDoc[];
}

// ── Doc type metadata ─────────────────────────────────────────────────────────

const DOC_META: Record<string, { label: string; tier: 'high' | 'medium' | 'low'; color: string }> = {
  pitch_deck:          { label: 'Pitch Deck',         tier: 'high',   color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  financial_model:     { label: 'Financial Model',    tier: 'high',   color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  financial_statement: { label: 'Financials',         tier: 'high',   color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  cap_table:           { label: 'Cap Table',          tier: 'high',   color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  customer_contract:   { label: 'Customer Contract',  tier: 'high',   color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  investor_qa:         { label: 'Investor Q&A',       tier: 'high',   color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  team_bio:            { label: 'Team',               tier: 'high',   color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  legal_terms:         { label: 'Legal Terms',        tier: 'medium', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  patent_ip:           { label: 'IP / Patent',        tier: 'medium', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  legal_formation:     { label: 'Formation Docs',     tier: 'low',    color: 'bg-slate-100 text-slate-500 border-slate-200' },
  unknown:             { label: 'Unknown',            tier: 'low',    color: 'bg-slate-100 text-slate-500 border-slate-200' },
};

function docMeta(type: string) {
  return DOC_META[type] ?? { label: type, tier: 'low', color: 'bg-slate-100 text-slate-500 border-slate-200' };
}

// ── File icon helper ──────────────────────────────────────────────────────────

function mimeIcon(mime: string) {
  if (mime.includes('pdf'))         return '📄';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📑';
  if (mime.includes('document') || mime.includes('word')) return '📝';
  if (mime.includes('image'))       return '🖼️';
  if (mime.includes('video'))       return '🎬';
  if (mime.includes('audio'))       return '🎵';
  if (mime.includes('zip') || mime.includes('archive')) return '📦';
  return '📎';
}

function fmtSize(bytes?: string) {
  if (!bytes) return '';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── Collect all file IDs under a tree node ────────────────────────────────────

function collectFileIds(tree: DriveTree): string[] {
  const ids: string[] = tree.files.map(f => f.id);
  for (const folder of tree.folders) {
    ids.push(...collectFileIds(folder.children));
  }
  return ids;
}

// ── FolderNode component ──────────────────────────────────────────────────────

function FolderNode({
  folder,
  selected,
  onToggle,
  depth = 0,
}: {
  folder: DriveFolder;
  selected: Set<string>;
  onToggle: (ids: string[], checked: boolean) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const allIds  = collectFileIds(folder.children);
  const checked = allIds.filter(id => selected.has(id));
  const allChecked  = allIds.length > 0 && checked.length === allIds.length;
  const partChecked = checked.length > 0 && checked.length < allIds.length;

  return (
    <div style={{ marginLeft: depth * 16 }}>
      <div className="flex items-center gap-1.5 py-1 group cursor-pointer hover:bg-slate-50 rounded px-1">
        {/* Folder checkbox */}
        <button
          onClick={() => onToggle(allIds, !allChecked)}
          className="shrink-0 text-slate-400 hover:text-slate-600"
        >
          {allChecked
            ? <CheckSquare className="w-3.5 h-3.5 text-[#1e293b]" />
            : partChecked
              ? <CheckSquare className="w-3.5 h-3.5 text-slate-400" />
              : <Square className="w-3.5 h-3.5" />}
        </button>
        {/* Expand toggle */}
        <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1 flex-1 min-w-0 text-left">
          <span className="text-slate-400 shrink-0">
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
          {open ? <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
          <span className="text-xs font-medium text-[#33322c] truncate">{folder.name}</span>
          <span className="text-[10px] text-[#787569] shrink-0 ml-1">
            {allIds.length > 0 ? `${checked.length}/${allIds.length}` : ''}
          </span>
        </button>
      </div>

      {open && (
        <div>
          {folder.children.folders.map(sub => (
            <FolderNode key={sub.id} folder={sub} selected={selected} onToggle={onToggle} depth={depth + 1} />
          ))}
          {folder.children.files.map(file => (
            <FileRow key={file.id} file={file} selected={selected.has(file.id)} onToggle={onToggle} depth={depth + 1} />
          ))}
          {folder.children.truncated && (
            <p className="text-[10px] text-[#787569] italic ml-6 py-0.5">Folder too deep — not shown</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── FileRow component ─────────────────────────────────────────────────────────

function FileRow({
  file,
  selected,
  onToggle,
  depth = 0,
}: {
  file: DriveFile;
  selected: boolean;
  onToggle: (ids: string[], checked: boolean) => void;
  depth?: number;
}) {
  return (
    <div
      style={{ marginLeft: depth * 16 }}
      className={`flex items-center gap-1.5 py-0.5 px-1 rounded cursor-pointer hover:bg-slate-50 ${selected ? 'bg-blue-50' : ''}`}
      onClick={() => onToggle([file.id], !selected)}
    >
      <button className="shrink-0 text-slate-400">
        {selected
          ? <CheckSquare className="w-3.5 h-3.5 text-[#1e293b]" />
          : <Square className="w-3.5 h-3.5" />}
      </button>
      <span className="text-xs shrink-0">{mimeIcon(file.mimeType)}</span>
      <span className="text-xs text-[#33322c] truncate flex-1">{file.name}</span>
      {file.size && <span className="text-[10px] text-[#787569] shrink-0">{fmtSize(file.size)}</span>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DriveIngestPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [driveAuth, setDriveAuth]       = useState<{ authenticated: boolean; reason?: string } | null>(null);
  const [authLoading, setAuthLoading]   = useState(true);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting]     = useState(false);
  const [tree, setTree]               = useState<DriveTree | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [company, setCompany]         = useState('');
  const [ingesting, setIngesting]     = useState(false);
  const [ingestProgress, setIngestProgress] = useState<{ progress: number; total: number } | null>(null);
  const [result, setResult]           = useState<IngestResult | null>(null);
  const [ingestErr, setIngestErr]     = useState<string | null>(null);
  const [ingested, setIngested]       = useState<string[]>([]);
  const [deingesting, setDeingesting] = useState<string | null>(null);

  // Banner from OAuth redirect
  const driveConnected = searchParams.get('drive_connected') === '1';
  const driveOAuthError = searchParams.get('drive_error');

  const checkAuthStatus = useCallback(async () => {
    setAuthLoading(true);
    try {
      const res = await fetch('/drive/auth-status', { headers: AUTH_HEADER });
      if (res.ok) setDriveAuth(await res.json());
      else setDriveAuth({ authenticated: false });
    } catch {
      setDriveAuth({ authenticated: false });
    }
    setAuthLoading(false);
  }, []);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTree(null);
    try {
      const res = await fetch('/drive/browse', { headers: AUTH_HEADER });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? `Error ${res.status}`);
      } else {
        setTree(await res.json());
      }
    } catch (e) {
      setError(`Network error: ${e}`);
    }
    setLoading(false);
  }, []);

  const fetchIngested = useCallback(async () => {
    try {
      const res = await fetch('/drive/ingested', { headers: AUTH_HEADER });
      if (res.ok) setIngested(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    checkAuthStatus();
    if (driveConnected || driveOAuthError) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('drive_connected');
        next.delete('drive_error');
        return next;
      }, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (driveAuth?.authenticated) {
      fetchTree();
      fetchIngested();
    }
  }, [driveAuth?.authenticated, fetchTree, fetchIngested]);

  async function deingest(company: string) {
    setDeingesting(company);
    try {
      await fetch(`/drive/ingested/${encodeURIComponent(company)}`, {
        method: 'DELETE',
        headers: AUTH_HEADER,
      });
      setIngested(prev => prev.filter(c => c !== company));
      if (result?.company === company) setResult(null);
    } catch {}
    setDeingesting(null);
  }

  function toggle(ids: string[], checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) ids.forEach(id => next.add(id));
      else         ids.forEach(id => next.delete(id));
      return next;
    });
  }

  async function runIngest() {
    if (!company.trim() || selected.size === 0) return;
    setIngesting(true); setIngestErr(null); setResult(null); setIngestProgress(null);
    try {
      const res = await fetch('/drive/ingest', {
        method: 'POST',
        headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: company.trim(), file_ids: [...selected] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIngestErr(body.detail ?? `Error ${res.status}`);
        setIngesting(false);
        return;
      }
      const { job_id, total } = body;
      setIngestProgress({ progress: 0, total });
      // Poll until done
      let finalJob: any = null;
      while (true) {
        await new Promise(r => setTimeout(r, 2000));
        const sr = await fetch(`/drive/ingest/${job_id}`, { headers: AUTH_HEADER });
        if (!sr.ok) break;
        finalJob = await sr.json();
        setIngestProgress({ progress: finalJob.progress, total: finalJob.total });
        if (finalJob.status === 'done' || finalJob.status === 'failed') break;
      }
      if (finalJob?.status === 'done') {
        setResult({
          company: finalJob.company,
          date: finalJob.date,
          summary: finalJob.summary,
          documents: finalJob.results,
        });
        fetchIngested();
      }
    } catch (e) {
      setIngestErr(`Network error: ${e}`);
    }
    setIngesting(false);
    setIngestProgress(null);
  }

  const allIds = tree ? collectFileIds(tree) : [];

  async function connectDrive() {
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch('/drive/auth-url?return_to=ingest', { headers: AUTH_HEADER });
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

  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      <CVCNavbar />
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4">

        {/* Header */}
        <div className="flex items-center gap-3">
          <HardDrive className="w-5 h-5 text-[#787569]" />
          <div>
            <h1 className="text-lg font-bold text-[#1e293b]">Drive Ingestion</h1>
            <p className="text-xs text-[#787569]">Browse your Google Drive, select files, and ingest them into the DD pipeline.</p>
          </div>
        </div>

        {/* OAuth success / error banners */}
        {driveConnected && (
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Google Drive connected successfully.
          </div>
        )}
        {driveOAuthError && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Google OAuth error: {driveOAuthError}. Try connecting again.
          </div>
        )}

        {/* Auth loading */}
        {authLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-[#787569]" />
            <span className="ml-2 text-sm text-[#787569]">Checking Drive connection…</span>
          </div>
        )}

        {/* Not authenticated — show connect gate */}
        {!authLoading && driveAuth && !driveAuth.authenticated && (
          <div className="flex flex-col items-center justify-center gap-5 py-12 sm:py-16 rounded-xl bg-gradient-to-br from-[#f8f6f0] to-[#f0ede6] border border-[#e8e2d6]">
            <div className="w-14 h-14 rounded-2xl bg-white shadow-sm border border-[#e8e2d6] flex items-center justify-center">
              <HardDrive className="w-7 h-7 text-[#8a7200]" />
            </div>
            <div className="text-center px-4 max-w-xs">
              <p className="text-base font-bold text-[#1e293b]">Google Drive not connected</p>
              <p className="text-sm text-[#787569] mt-1.5 leading-relaxed">
                Authenticate once to browse and ingest files from your Drive.
              </p>
            </div>
            {connectError && (
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 max-w-sm mx-4">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{connectError}</span>
              </div>
            )}
            <button
              onClick={connectDrive}
              disabled={connecting}
              className="flex items-center gap-2.5 px-5 py-2.5 bg-[#1e293b] text-[#f59e0b] text-sm font-bold rounded-lg hover:bg-[#334155] disabled:opacity-50 transition-colors shadow-sm"
            >
              {connecting
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <ExternalLink className="w-4 h-4" />}
              {connecting ? 'Opening Google…' : 'Connect Google Drive'}
            </button>
          </div>
        )}

        {/* Drive is authenticated — show browser + ingest UI */}
        {!authLoading && driveAuth?.authenticated && (
        <div className="flex flex-col lg:flex-row gap-4 items-start">

          {/* Left: Drive browser */}
          <div className="flex-1 min-w-0 border border-slate-200 rounded bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-[#f8fafc]">
              <div className="flex items-center gap-2">
                <HardDrive className="w-3.5 h-3.5 text-[#787569]" />
                <span className="text-xs font-bold uppercase tracking-widest text-[#787569]">Google Drive</span>
                {tree && (
                  <span className="text-[10px] bg-slate-100 text-[#545249] rounded px-1.5 py-0.5 font-mono">
                    {selected.size} selected
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {tree && allIds.length > 0 && (
                  <>
                    <button
                      onClick={() => setSelected(new Set(allIds))}
                      className="text-[10px] text-[#545249] hover:text-[#1e293b] border border-slate-200 rounded px-2 py-1"
                    >
                      Select all
                    </button>
                    <button
                      onClick={() => setSelected(new Set())}
                      className="text-[10px] text-[#545249] hover:text-[#1e293b] border border-slate-200 rounded px-2 py-1"
                    >
                      Clear
                    </button>
                  </>
                )}
                <button
                  onClick={fetchTree}
                  disabled={loading}
                  className="flex items-center gap-1 text-[10px] text-[#545249] hover:text-[#1e293b] border border-slate-200 rounded px-2 py-1 disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                  {loading ? 'Loading...' : 'Refresh'}
                </button>
              </div>
            </div>

            <div className="p-3 max-h-[520px] overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 animate-spin text-[#787569]" />
                  <span className="ml-2 text-sm text-[#787569]">Loading Drive...</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Could not load Drive</p>
                    <p className="text-xs mt-0.5">{error}</p>
                  </div>
                </div>
              )}

              {tree && (
                <div className="space-y-0.5">
                  {/* Root files */}
                  {tree.files.map(f => (
                    <FileRow key={f.id} file={f} selected={selected.has(f.id)} onToggle={toggle} depth={0} />
                  ))}
                  {/* Root folders */}
                  {tree.folders.map(folder => (
                    <FolderNode key={folder.id} folder={folder} selected={selected} onToggle={toggle} depth={0} />
                  ))}
                  {tree.folders.length === 0 && tree.files.length === 0 && (
                    <p className="text-sm text-[#787569] text-center py-8">Drive is empty or nothing accessible.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Ingest panel + results */}
          <div className="w-full lg:w-80 shrink-0 space-y-3">

            {/* Ingest controls */}
            <div className="border border-slate-200 rounded bg-white p-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-widest text-[#787569]">Ingest Selected</p>
              <div>
                <label className="text-[10px] text-[#787569] block mb-1">Company / project name</label>
                <input
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="e.g. Acme Robotics"
                  className="w-full text-xs border border-slate-200 rounded px-2.5 py-2 bg-[#ede8d7] focus:outline-none focus:border-slate-400"
                />
              </div>
              {selected.size > 0 && (
                <div className="flex items-center gap-1.5 text-[10px] text-[#545249] bg-blue-50 border border-blue-200 rounded px-2.5 py-1.5">
                  <FileText className="w-3 h-3 text-blue-500 shrink-0" />
                  {selected.size} file{selected.size !== 1 ? 's' : ''} selected
                </div>
              )}
              <button
                onClick={runIngest}
                disabled={ingesting || !company.trim() || selected.size === 0}
                className="w-full flex items-center justify-center gap-2 text-xs bg-[#1e293b] text-[#f59e0b] rounded px-3 py-2.5 font-semibold disabled:opacity-40 hover:bg-[#334155] transition-colors"
              >
                {ingesting
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {ingestProgress ? `${ingestProgress.progress}/${ingestProgress.total} files...` : 'Starting...'}</>
                  : <><CloudDownload className="w-3.5 h-3.5" /> Run Ingestion</>}
              </button>
              {ingestErr && (
                <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {ingestErr}
                </div>
              )}

              {/* Key */}
              <div className="border-t border-slate-100 pt-3 space-y-1.5">
                <p className="text-[10px] font-semibold text-[#787569] uppercase tracking-widest">Key</p>
                {[
                  { tier: 'high',   label: 'High value — analyzed by DD agents',       cls: 'bg-emerald-100 text-emerald-700' },
                  { tier: 'medium', label: 'Medium — routed for reference',             cls: 'bg-amber-100 text-amber-700' },
                  { tier: 'low',    label: 'Low — formation/unknown, usually skipped',  cls: 'bg-slate-100 text-slate-500' },
                ].map(k => (
                  <div key={k.tier} className="flex items-center gap-2">
                    <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium border ${k.cls} border-transparent`}>{k.tier}</span>
                    <span className="text-[10px] text-[#787569]">{k.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Ingested companies */}
            {ingested.length > 0 && (
              <div className="border border-slate-200 rounded bg-white overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-[#f8fafc] border-b border-slate-100">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#787569]">Ingested</p>
                  <span className="text-[10px] bg-slate-100 text-[#545249] rounded px-1.5 py-0.5 font-mono">{ingested.length}</span>
                </div>
                <div className="divide-y divide-slate-50 max-h-48 overflow-y-auto">
                  {ingested.map(name => (
                    <div key={name} className="flex items-center justify-between px-4 py-2 hover:bg-slate-50">
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                        <span className="text-xs text-[#33322c] truncate">{name.replace(/_/g, ' ')}</span>
                      </div>
                      <button
                        onClick={() => deingest(name)}
                        disabled={deingesting === name}
                        className="shrink-0 ml-2 flex items-center gap-1 text-[10px] text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded px-1.5 py-0.5 disabled:opacity-40 transition-colors"
                      >
                        {deingesting === name
                          ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          : <Trash2 className="w-2.5 h-2.5" />}
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Results */}
            {result && (
              <div className="border border-slate-200 rounded bg-white overflow-hidden">
                <div className="px-4 py-3 bg-[#f8fafc] border-b border-slate-100">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#787569]">Results — {result.company}</p>
                  <p className="text-[10px] text-[#787569] mt-0.5">{result.date}</p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
                  {[
                    { label: 'Total',     value: result.summary.total,     color: '#1e293b' },
                    { label: 'Converted', value: result.summary.converted, color: '#10b981' },
                    { label: 'Skipped',   value: result.summary.skipped,   color: '#9ca3af' },
                    { label: 'Failed',    value: result.summary.failed,    color: '#ef4444' },
                  ].map(s => (
                    <div key={s.label} className="text-center py-2">
                      <div className="text-sm font-bold" style={{ color: s.color }}>{s.value}</div>
                      <div className="text-[9px] text-[#787569] uppercase">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Document list */}
                <div className="p-3 max-h-[320px] overflow-y-auto space-y-1">
                  {result.documents.map((doc, i) => {
                    const meta = docMeta(doc.doc_type);
                    const ok   = doc.conversion === 'ok' || doc.conversion === 'truncated';
                    const skip = doc.conversion === 'skipped';
                    return (
                      <div key={i} className="flex items-start gap-2 py-1.5 border-b border-slate-50 last:border-0">
                        <div className="mt-0.5 shrink-0">
                          {ok   ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          : skip ? <Info className="w-3 h-3 text-slate-400" />
                                 : <XCircle className="w-3 h-3 text-red-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[#33322c] truncate leading-tight">{doc.filename}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`text-[9px] font-medium border rounded px-1 py-0.5 ${meta.color}`}>
                              {meta.label}
                            </span>
                            {doc.chars > 0 && (
                              <span className="text-[9px] text-[#787569] font-mono">
                                {doc.chars.toLocaleString()}ch
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Tier summary */}
                <div className="px-4 py-3 bg-[#f8fafc] border-t border-slate-100 space-y-1">
                  {(['high', 'medium', 'low'] as const).map(tier => {
                    const count = result.documents.filter(d => docMeta(d.doc_type).tier === tier && (d.conversion === 'ok' || d.conversion === 'truncated')).length;
                    if (count === 0) return null;
                    const meta = { high: 'High value', medium: 'Medium', low: 'Low / skipped' }[tier];
                    const cls  = { high: 'text-emerald-600', medium: 'text-amber-600', low: 'text-slate-400' }[tier];
                    return (
                      <div key={tier} className="flex items-center justify-between">
                        <span className={`text-[10px] font-medium ${cls}`}>{meta}</span>
                        <span className="text-[10px] font-mono text-[#787569]">{count} doc{count !== 1 ? 's' : ''}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
