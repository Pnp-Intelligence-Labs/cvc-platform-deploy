/**
 * ReportWorkspace.tsx
 * Custom report builder — shown as the "Custom" tab in IndustrialMatrix.
 *
 * Left panel: report list + create
 * Right panel: selected report — outline, sources, generate, preview
 */

import { useState, useEffect, useRef } from 'react';
import {
  Plus, Trash2, ChevronDown, ChevronUp, Play, RefreshCw,
  FileText, Database, Link2, ClipboardPaste, Upload,
  Download, Eye, EyeOff, AlertCircle, CheckCircle2,
  Clock, Loader2, BookOpen, Sparkles, X, GripVertical, Search,
} from 'lucide-react';
import { AUTH_HEADER } from '../api/client';
import DataExplorer from './DataExplorer';
import ReportEditorial from './ReportEditorial';

const API = '';

// ── Types ────────────────────────────────────────────────────────────────────

interface TrendReport {
  id: number;
  title: string;
  sector: string | null;
  theme: string | null;
  date_from: string | null;
  date_to: string | null;
  status: string;
  output_format: string;   // 'report' | 'blog'
  citation_style: string;  // 'superscript' | 'chicago' | 'ieee' | 'mla'
  audience: string;        // executive | practitioner | investor | analyst | general
  tone: string;            // analytical | authoritative | narrative | concise | conversational
  created_by: string;
  created_at: string;
  updated_at: string;
  report_brief: string | null;
  published_html: string | null;
  section_count?: number;
}

interface ReportSection {
  id: number;
  report_id: number;
  position: number;
  title: string;
  instructions: string | null;
  section_type: string;
  audience: string | null;   // null = inherit from report
  tone: string | null;       // null = inherit from report
  data_sources: { source_id: number; type: string; label: string }[];
  status: string;
  content: string | null;
  confidence_score: number | null;
  generated_at: string | null;
  version_history: { content: string; generated_at: string; confidence_score: number }[];
  error_msg: string | null;
}

interface ReportSource {
  id: number;
  report_id: number;
  section_id: number | null;
  source_type: string;
  label: string | null;
  filename: string | null;
  content_text: string | null;
  query_sql: string | null;
  query_result: any;
  article_url: string | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, JSX.Element> = {
  pending:    <Clock className="w-3.5 h-3.5 text-slate-400" />,
  generating: <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />,
  done:       <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
  error:      <AlertCircle className="w-3.5 h-3.5 text-red-400" />,
};

const SOURCE_ICON: Record<string, JSX.Element> = {
  pdf:       <FileText className="w-3.5 h-3.5 text-rose-500" />,
  article:   <Link2 className="w-3.5 h-3.5 text-blue-500" />,
  db_query:  <Database className="w-3.5 h-3.5 text-violet-500" />,
  paste:     <ClipboardPaste className="w-3.5 h-3.5 text-amber-500" />,
};

const SECTION_TYPES = [
  { value: 'prose',           label: 'Prose' },
  { value: 'deep_dive',       label: 'Deep Dive' },
  { value: 'sidebar',         label: 'Sidebar' },
  { value: 'spotlight',       label: 'Spotlight' },
  { value: 'tech_stack',      label: 'Tech Stack' },
  { value: 'investment_take', label: 'Investment' },
];

const AUDIENCES = [
  { value: 'practitioner', label: 'Practitioners' },
  { value: 'executive',    label: 'Executives' },
  { value: 'investor',     label: 'Investors' },
  { value: 'analyst',      label: 'Analysts' },
  { value: 'general',      label: 'General' },
];

const TONES = [
  { value: 'analytical',    label: 'Analytical' },
  { value: 'authoritative', label: 'Authoritative' },
  { value: 'narrative',     label: 'Narrative' },
  { value: 'concise',       label: 'Concise' },
  { value: 'conversational', label: 'Conversational' },
];

const TYPE_BADGE_CLS: Record<string, string> = {
  prose:           'border-slate-200 text-[#545249] bg-white',
  deep_dive:       'border-blue-200 text-blue-700 bg-blue-50',
  sidebar:         'border-amber-200 text-amber-700 bg-amber-50',
  spotlight:       'border-emerald-200 text-emerald-700 bg-emerald-50',
  tech_stack:      'border-violet-200 text-violet-700 bg-violet-50',
  investment_take: 'border-yellow-300 text-yellow-800 bg-yellow-50',
};

function confLabel(score: number | null): { text: string; color: string } {
  if (score === null)  return { text: '',            color: '#94a3b8' };
  if (score === 0)     return { text: 'AI only',     color: '#94a3b8' };
  if (score >= 0.7)    return { text: 'well-cited',  color: '#10b981' };
  if (score >= 0.35)   return { text: 'cited',       color: '#f59e0b' };
  return               { text: 'lightly cited',      color: '#ef4444' };
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  defaultSector?: string;
}

export default function ReportWorkspace({ defaultSector }: Props) {
  const [reports, setReports]         = useState<TrendReport[]>([]);
  const [selected, setSelected]       = useState<TrendReport | null>(null);
  const [sections, setSections]       = useState<ReportSection[]>([]);
  const [sources, setSources]         = useState<ReportSource[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [briefLoading, setBriefLoading] = useState(false);
  const [editorialOpen, setEditorialOpen] = useState(false);

  // Create report form
  const [showCreate, setShowCreate]       = useState(false);
  const [newTitle, setNewTitle]           = useState('');
  const [newSector, setNewSector]         = useState(defaultSector || '');
  const [newTheme, setNewTheme]           = useState('');
  const [newOutputFormat, setNewOutputFormat] = useState<'report' | 'blog'>('report');
  const [newCitationStyle, setNewCitationStyle] = useState<string>('superscript');
  const [newAudience, setNewAudience]       = useState<string>('practitioner');
  const [newTone, setNewTone]               = useState<string>('analytical');
  const [creating, setCreating]             = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { fetchReports(); }, []);

  function startPolling(id: number) {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      const res = await fetch(`${API}/reports/${id}`, { headers: AUTH_HEADER });
      if (!res.ok) return;
      const data = await res.json();
      setSelected(data);
      setSections(data.sections || []);
      setSources(data.sources || []);
      const stillGoing = (data.sections || []).some((s: ReportSection) => s.status === 'generating')
        || data.status === 'generating';
      if (!stillGoing) {
        clearInterval(pollingRef.current!);
        pollingRef.current = null;
      }
    }, 3000);
  }

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  async function fetchReports() {
    const res = await fetch(`${API}/reports/`, { headers: AUTH_HEADER });
    if (res.ok) setReports(await res.json());
  }

  async function selectReport(id: number) {
    setLoadingReport(true);
    const res = await fetch(`${API}/reports/${id}`, { headers: AUTH_HEADER });
    if (res.ok) {
      const data = await res.json();
      setSelected(data);
      setSections(data.sections || []);
      setSources(data.sources || []);
    }
    setLoadingReport(false);
  }

  async function refreshReport(id: number) {
    const res = await fetch(`${API}/reports/${id}`, { headers: AUTH_HEADER });
    if (res.ok) {
      const data = await res.json();
      setSelected(data);
      setSections(data.sections || []);
      setSources(data.sources || []);
    }
  }

  async function createReport() {
    if (!newTitle.trim()) return;
    setCreating(true);
    const res = await fetch(`${API}/reports/`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim(), sector: newSector || null, theme: newTheme || null, output_format: newOutputFormat, citation_style: newCitationStyle, audience: newAudience, tone: newTone }),
    });
    if (res.ok) {
      const r = await res.json();
      setReports(prev => [r, ...prev]);
      setShowCreate(false);
      setNewTitle(''); setNewSector(defaultSector || ''); setNewTheme(''); setNewOutputFormat('report'); setNewCitationStyle('superscript'); setNewAudience('practitioner'); setNewTone('analytical');
      selectReport(r.id);
    }
    setCreating(false);
  }

  async function deleteReport(id: number) {
    if (!confirm('Delete this report?')) return;
    await fetch(`${API}/reports/${id}`, { method: 'DELETE', headers: AUTH_HEADER });
    setReports(prev => prev.filter(r => r.id !== id));
    if (selected?.id === id) { setSelected(null); setSections([]); setSources([]); }
  }

  async function generateBrief() {
    if (!selected) return;
    setBriefLoading(true);
    await fetch(`${API}/reports/${selected.id}/brief`, { method: 'POST', headers: AUTH_HEADER });
    // Poll until brief appears
    let tries = 0;
    const poll = async () => {
      const res = await fetch(`${API}/reports/${selected.id}`, { headers: AUTH_HEADER });
      if (res.ok) {
        const data = await res.json();
        if (data.report_brief || tries > 20) {
          setSelected(data);
          setSections(data.sections || []);
          setSources(data.sources || []);
          setBriefLoading(false);
          return;
        }
      }
      tries++;
      setTimeout(poll, 2000);
    };
    setTimeout(poll, 2000);
  }

  async function publishReport() {
    if (!selected) return;
    await fetch(`${API}/reports/${selected.id}/publish`, { method: 'POST', headers: AUTH_HEADER });
    setSelected(prev => prev ? { ...prev, status: 'generating' } : prev);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-4 min-h-[600px]">

      {/* Left: report list */}
      <div className="w-64 shrink-0 flex flex-col gap-2">
        <button
          onClick={() => setShowCreate(v => !v)}
          className="flex items-center gap-2 px-3 py-2 bg-[#1e293b] text-[#f59e0b] text-xs font-bold rounded hover:bg-[#334155] transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> New Report
        </button>

        {showCreate && (
          <div className="border border-slate-200 rounded p-3 bg-white space-y-2">
            <input
              value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="Report title"
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-[#ede8d7] focus:outline-none focus:border-slate-400"
            />
            <input
              value={newSector} onChange={e => setNewSector(e.target.value)}
              placeholder="Sector (optional)"
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-[#ede8d7] focus:outline-none focus:border-slate-400"
            />
            <textarea
              value={newTheme} onChange={e => setNewTheme(e.target.value)}
              placeholder="Theme / angle (optional)"
              rows={2}
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-[#ede8d7] focus:outline-none focus:border-slate-400 resize-none"
            />
            <div>
              <p className="text-[10px] text-[#787569] mb-1">Format</p>
              <div className="flex gap-1 p-0.5 bg-slate-200 rounded w-fit">
                {(['report', 'blog'] as const).map(f => (
                  <button key={f} type="button" onClick={() => setNewOutputFormat(f)}
                    className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                      newOutputFormat === f ? 'bg-white text-[#33322c] shadow-sm' : 'text-[#545249]'
                    }`}>
                    {f === 'report' ? 'Report' : 'Blog Post'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-[#787569] mb-1">Citation Style</p>
              <select value={newCitationStyle} onChange={e => setNewCitationStyle(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-[#ede8d7] focus:outline-none">
                <option value="superscript">Superscript [N]</option>
                <option value="chicago">Chicago</option>
                <option value="ieee">IEEE [N]</option>
                <option value="mla">MLA Works Cited</option>
              </select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <p className="text-[10px] text-[#787569] mb-1">Audience</p>
                <select value={newAudience} onChange={e => setNewAudience(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-[#ede8d7] focus:outline-none">
                  {AUDIENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <p className="text-[10px] text-[#787569] mb-1">Tone</p>
                <select value={newTone} onChange={e => setNewTone(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-[#ede8d7] focus:outline-none">
                  {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={createReport} disabled={creating || !newTitle.trim()}
                className="flex-1 text-xs bg-[#1e293b] text-white rounded py-1.5 font-medium disabled:opacity-50">
                {creating ? 'Creating...' : 'Create'}
              </button>
              <button onClick={() => setShowCreate(false)}
                className="text-xs text-[#787569] hover:text-slate-700 px-2">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex-1 space-y-1 overflow-y-auto max-h-[560px]">
          {reports.length === 0 && (
            <p className="text-xs text-[#787569] text-center py-6">No reports yet</p>
          )}
          {reports.map(r => (
            <div key={r.id}
              onClick={() => selectReport(r.id)}
              className={`group relative cursor-pointer rounded px-3 py-2.5 border transition-colors ${
                selected?.id === r.id
                  ? 'bg-[#1e293b] text-white border-[#1e293b]'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className={`text-xs font-semibold leading-tight ${selected?.id === r.id ? 'text-white' : 'text-[#33322c]'}`}>
                {r.title}
              </div>
              <div className={`text-[10px] mt-0.5 ${selected?.id === r.id ? 'text-slate-300' : 'text-[#787569]'}`}>
                {r.sector && <span className="mr-2">{r.sector}</span>}
                <span className="font-mono">{r.status}</span>
                {r.section_count !== undefined && <span className="ml-2">{r.section_count}s</span>}
              </div>
              <button
                onClick={e => { e.stopPropagation(); deleteReport(r.id); }}
                className={`absolute top-2 right-2 opacity-0 group-hover:opacity-100 ${selected?.id === r.id ? 'text-slate-400 hover:text-white' : 'text-slate-400 hover:text-red-500'}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Right: report editor */}
      <div className="flex-1 min-w-0">
        {loadingReport ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-5 h-5 animate-spin text-[#787569]" />
          </div>
        ) : !selected ? (
          <div className="flex flex-col items-center justify-center h-48 text-[#787569]">
            <BookOpen className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">Select or create a report</p>
          </div>
        ) : (
          <div className="space-y-4">

            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-[#1e293b] leading-tight">{selected.title}</h2>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {selected.sector && <span className="text-xs text-[#787569]">{selected.sector}</span>}
                  {selected.theme && <span className="text-xs text-[#545249] italic">{selected.theme}</span>}
                  {/* Output format toggle */}
                  <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded">
                    {(['report', 'blog'] as const).map(f => (
                      <button key={f} type="button"
                        onClick={async () => {
                          const res = await fetch(`${API}/reports/${selected.id}`, {
                            method: 'PATCH',
                            headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ output_format: f }),
                          });
                          if (res.ok) setSelected(prev => prev ? { ...prev, output_format: f } : prev);
                        }}
                        className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                          (selected.output_format || 'report') === f
                            ? 'bg-white text-[#33322c] shadow-sm'
                            : 'text-[#787569] hover:text-[#545249]'
                        }`}>
                        {f === 'report' ? 'Report' : 'Blog Post'}
                      </button>
                    ))}
                  </div>
                  {/* Citation style selector */}
                  <select
                    value={selected.citation_style || 'superscript'}
                    onChange={async (e) => {
                      const style = e.target.value;
                      await fetch(`${API}/reports/${selected.id}`, {
                        method: 'PATCH',
                        headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ citation_style: style }),
                      });
                      const res = await fetch(`${API}/reports/${selected.id}/reformat`, {
                        method: 'POST',
                        headers: AUTH_HEADER,
                      });
                      if (res.ok) {
                        const data = await res.json();
                        setSelected(prev => prev ? { ...prev, citation_style: style, published_html: data.published_html } : prev);
                      } else {
                        setSelected(prev => prev ? { ...prev, citation_style: style } : prev);
                      }
                    }}
                    className="text-[10px] border border-slate-200 rounded px-2 py-0.5 bg-white text-[#545249] focus:outline-none cursor-pointer"
                  >
                    <option value="superscript">Superscript [N]</option>
                    <option value="chicago">Chicago</option>
                    <option value="ieee">IEEE [N]</option>
                    <option value="mla">MLA Works Cited</option>
                  </select>
                  {/* Audience selector */}
                  <select
                    value={selected.audience || 'practitioner'}
                    onChange={async (e) => {
                      const v = e.target.value;
                      await fetch(`${API}/reports/${selected.id}`, {
                        method: 'PATCH',
                        headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ audience: v }),
                      });
                      setSelected(prev => prev ? { ...prev, audience: v } : prev);
                    }}
                    className="text-[10px] border border-slate-200 rounded px-2 py-0.5 bg-violet-50 text-violet-700 border-violet-200 focus:outline-none cursor-pointer font-medium"
                    title="Audience — affects all future section generation"
                  >
                    {AUDIENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                  {/* Tone selector */}
                  <select
                    value={selected.tone || 'analytical'}
                    onChange={async (e) => {
                      const v = e.target.value;
                      await fetch(`${API}/reports/${selected.id}`, {
                        method: 'PATCH',
                        headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tone: v }),
                      });
                      setSelected(prev => prev ? { ...prev, tone: v } : prev);
                    }}
                    className="text-[10px] border border-slate-200 rounded px-2 py-0.5 bg-amber-50 text-amber-700 border-amber-200 focus:outline-none cursor-pointer font-medium"
                    title="Tone — affects all future section generation"
                  >
                    {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selected.status === 'ready' && (
                  <button onClick={() => setPreviewOpen(v => !v)}
                    className="flex items-center gap-1.5 text-xs border border-emerald-200 text-emerald-700 bg-emerald-50 rounded px-3 py-1.5 font-medium hover:bg-emerald-100 transition-colors">
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </button>
                )}
                <button onClick={publishReport}
                  disabled={selected.status === 'generating' || sections.length === 0}
                  className="flex items-center gap-1.5 text-xs bg-[#1e293b] text-[#f59e0b] rounded px-3 py-1.5 font-medium disabled:opacity-40 hover:bg-[#334155] transition-colors">
                  {selected.status === 'generating'
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Assembling...</>
                    : <><Sparkles className="w-3.5 h-3.5" /> Publish</>}
                </button>
              </div>
            </div>

            {/* Preview pane */}
            {previewOpen && selected.published_html && (
              <div className="border border-emerald-200 rounded overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-emerald-50 border-b border-emerald-200">
                  <span className="text-xs font-bold text-emerald-700">Published Preview</span>
                  <div className="flex gap-2">
                    <a
                      href={`data:text/html;charset=utf-8,${encodeURIComponent(selected.published_html)}`}
                      download={`${selected.title.replace(/\s+/g, '_')}.html`}
                      className="text-xs text-emerald-700 hover:underline flex items-center gap-1">
                      <Download className="w-3 h-3" /> Download HTML
                    </a>
                    <button onClick={() => setPreviewOpen(false)} className="text-emerald-700">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <iframe
                  srcDoc={selected.published_html}
                  className="w-full h-[500px] border-0"
                  title="Report preview"
                  sandbox="allow-same-origin allow-scripts allow-popups"
                />
              </div>
            )}

            {/* Step 1: Brief */}
            <BriefPanel
              brief={selected.report_brief}
              loading={briefLoading}
              onGenerate={generateBrief}
              onUpdate={async (text) => {
                const res = await fetch(`${API}/reports/${selected.id}`, {
                  method: 'PATCH',
                  headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ report_brief: text }),
                });
                if (res.ok) setSelected(prev => prev ? { ...prev, report_brief: text } : prev);
              }}
            />

            {/* Step 2: Outline / Sections */}
            <SectionsPanel
              reportId={selected.id}
              sections={sections}
              sources={sources}
              onSectionsChange={setSections}
              onSourcesChange={setSources}
              onStartPolling={() => startPolling(selected.id)}
            />

            {/* Step 3: Sources */}
            <SourcesPanel
              reportId={selected.id}
              sources={sources}
              sections={sections}
              onSourcesChange={setSources}
            />

            {/* Step 3: Data Explorer */}
            <DataExplorer
              reportId={selected.id}
              report={selected}
              sections={sections}
              onAddSource={(src) => setSources(prev => [...prev, src])}
            />

            {/* Download bar — shown once at least one section is done */}
            {sections.some(s => s.status === 'done') && (
              <DownloadBar
                reportId={selected.id}
                reportTitle={selected.title}
                doneCount={sections.filter(s => s.status === 'done').length}
                totalCount={sections.length}
                publishedHtml={selected.published_html}
                reportStatus={selected.status}
                onOpenEditorial={() => setEditorialOpen(true)}
                onPublish={publishReport}
                onPublishedHtmlReady={(html) => setSelected(prev => prev ? { ...prev, published_html: html, status: 'ready' } : prev)}
              />
            )}

            {/* Editorial overlay */}
            {editorialOpen && selected.published_html && (
              <ReportEditorial
                reportId={selected.id}
                reportTitle={selected.title}
                publishedHtml={selected.published_html}
                citationStyle={selected.citation_style || 'superscript'}
                onClose={() => setEditorialOpen(false)}
                onSave={(html) => {
                  setSelected(prev => prev ? { ...prev, published_html: html } : prev);
                  setEditorialOpen(false);
                }}
              />
            )}

          </div>
        )}
      </div>
    </div>
  );
}


// ── BriefPanel ────────────────────────────────────────────────────────────────

function BriefPanel({ brief, loading, onGenerate, onUpdate }: {
  brief: string | null;
  loading: boolean;
  onGenerate: () => void;
  onUpdate: (text: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(brief || '');
  const [saving, setSaving]   = useState(false);
  const [open, setOpen]       = useState(false);

  useEffect(() => { setDraft(brief || ''); }, [brief]);

  async function save() {
    setSaving(true);
    await onUpdate(draft);
    setSaving(false);
    setEditing(false);
  }

  return (
    <div className="border border-slate-200 rounded bg-white overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#f8f9fa] transition-colors">
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-[#787569]" />
          <span className="text-xs font-bold uppercase tracking-widest text-[#787569]">Report Brief</span>
          {brief && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-[#787569]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#787569]" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="bg-[#f8fafc] border border-slate-100 rounded p-3 space-y-2">
            <p className="text-xs font-semibold text-[#33322c]">What is the report brief?</p>
            <p className="text-xs text-[#545249] leading-relaxed">
              The brief is 2–3 sentences that define the core argument, the audience, and the angle of this report.
              It gets injected into every section generation — so every section stays coherent with the same thesis.
            </p>
            <p className="text-xs text-[#545249] leading-relaxed">
              <span className="font-medium text-[#33322c]">Good brief:</span> "This report argues that autonomous mobile robots are crossing the ROI threshold for mid-market warehouses in 2025, driven by falling hardware costs and tighter labor markets. It is written for your corporate partners evaluating deployment timelines. The angle is: the barrier is no longer technical — it is integration and change management."
            </p>
            <p className="text-[10px] text-[#787569]">
              You can write it manually, or click Generate to have the system draft one from your title, theme, and section outline.
            </p>
          </div>
          {!editing ? (
            <div className="flex gap-2">
              <div className="flex-1 text-sm text-[#33322c] leading-relaxed bg-[#f8fafc] rounded px-3 py-2.5 min-h-[48px]">
                {brief || <span className="text-[#787569] italic">Not generated yet</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <button onClick={onGenerate} disabled={loading}
                  className="flex items-center gap-1 text-xs bg-[#1e293b] text-[#f59e0b] rounded px-2.5 py-1.5 font-medium disabled:opacity-40">
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {loading ? 'Generating...' : brief ? 'Regen' : 'Generate'}
                </button>
                <button onClick={() => setEditing(true)}
                  className="text-xs text-[#545249] border border-slate-200 rounded px-2.5 py-1.5 hover:bg-slate-50">
                  {brief ? 'Edit' : 'Write manually'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={draft} onChange={e => setDraft(e.target.value)}
                rows={4}
                className="w-full text-sm border border-slate-200 rounded px-3 py-2 bg-[#ede8d7] focus:outline-none focus:border-slate-400 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={save} disabled={saving}
                  className="text-xs bg-[#1e293b] text-white rounded px-3 py-1.5 font-medium disabled:opacity-40">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => { setEditing(false); setDraft(brief || ''); }}
                  className="text-xs text-[#787569] hover:text-slate-700">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── SourcesPanel ───────────────────────────────────────────────────────────────

function SourcesPanel({ reportId, sources, sections, onSourcesChange }: {
  reportId: number;
  sources: ReportSource[];
  sections: ReportSection[];
  onSourcesChange: (s: ReportSource[]) => void;
}) {
  const [open, setOpen]         = useState(false);
  const [addType, setAddType]   = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteLabel, setPasteLabel] = useState('');
  const [articleUrl, setArticleUrl] = useState('');
  const [articleLabel, setArticleLabel] = useState('');
  const [querySql, setQuerySql] = useState('');
  const [queryLabel, setQueryLabel] = useState('');
  const [savingSrc, setSavingSrc] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function deleteSource(id: number) {
    await fetch(`${API}/reports/${reportId}/sources/${id}`, { method: 'DELETE', headers: AUTH_HEADER });
    onSourcesChange(sources.filter(s => s.id !== id));
  }

  async function assignSource(id: number, sectionId: number | null) {
    const res = await fetch(`${API}/reports/${reportId}/sources/${id}`, {
      method: 'PATCH',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ section_id: sectionId }),
    });
    if (res.ok) {
      const updated = await res.json();
      onSourcesChange(sources.map(s => s.id === id ? updated : s));
    }
  }

  async function saveSource(payload: object) {
    setSavingSrc(true);
    const res = await fetch(`${API}/reports/${reportId}/sources`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const s = await res.json();
      onSourcesChange([...sources, s]);
      setAddType(null);
      setPasteText(''); setPasteLabel(''); setArticleUrl(''); setArticleLabel('');
      setQuerySql(''); setQueryLabel('');
    }
    setSavingSrc(false);
  }

  async function uploadPdf(file: File) {
    setSavingSrc(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('label', file.name);
    const res = await fetch(`${API}/reports/${reportId}/sources/upload`, {
      method: 'POST',
      headers: AUTH_HEADER,
      body: fd,
    });
    if (res.ok) {
      const s = await res.json();
      onSourcesChange([...sources, s]);
    }
    setSavingSrc(false);
  }

  return (
    <div className="border border-slate-200 rounded bg-white overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#f8f9fa] transition-colors">
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-[#787569]" />
          <span className="text-xs font-bold uppercase tracking-widest text-[#787569]">Sources</span>
          <span className="text-[10px] bg-slate-100 text-[#545249] rounded px-1.5 py-0.5 font-mono">{sources.length}</span>
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-[#787569]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#787569]" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[10px] text-[#787569]">
            Shared sources are available to all sections. Assign a source to a section to scope it.
          </p>

          {/* Existing sources */}
          {sources.length > 0 && (
            <div className="space-y-1">
              {sources.map(s => {
                const charCount = s.content_text ? s.content_text.length : (s.query_result ? JSON.stringify(s.query_result).length : 0);
                const hasContent = charCount > 0;
                return (
                <div key={s.id} className="flex items-start gap-2 group px-3 py-2 rounded bg-[#f8fafc] hover:bg-[#f1f5f9] transition-colors">
                  <div className="mt-0.5 shrink-0">{SOURCE_ICON[s.source_type] || <FileText className="w-3.5 h-3.5 text-slate-400" />}</div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-[#33322c] block truncate">
                      {s.label || s.filename || s.article_url || s.source_type}
                    </span>
                    <span className={`text-[10px] font-mono ${hasContent ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {hasContent ? `${charCount.toLocaleString()} chars ingested` : 'no content — URL may be paywalled or inaccessible'}
                    </span>
                  </div>
                  <select
                    value={s.section_id ?? ''}
                    onChange={e => assignSource(s.id, e.target.value === '' ? null : Number(e.target.value))}
                    className={`text-[10px] border rounded px-1.5 py-0.5 shrink-0 focus:outline-none cursor-pointer transition-colors ${
                      s.section_id
                        ? 'border-violet-200 text-violet-700 bg-violet-50'
                        : 'border-slate-200 text-[#787569] bg-white'
                    }`}
                  >
                    <option value="">All sections</option>
                    {sections.map(sec => (
                      <option key={sec.id} value={sec.id}>{sec.title.slice(0, 28)}</option>
                    ))}
                  </select>
                  <button onClick={() => deleteSource(s.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 shrink-0 mt-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                );
              })}
            </div>
          )}

          {/* Add source buttons */}
          {!addType && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => fileRef.current?.click()}
                disabled={savingSrc}
                className="flex items-center gap-1.5 text-xs border border-slate-200 rounded px-2.5 py-1.5 text-[#545249] hover:bg-slate-50 disabled:opacity-40">
                <Upload className="w-3 h-3" /> Upload PDF
              </button>
              <input ref={fileRef} type="file" accept=".pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadPdf(f); e.target.value = ''; }} />
              <button onClick={() => setAddType('article')}
                className="flex items-center gap-1.5 text-xs border border-slate-200 rounded px-2.5 py-1.5 text-[#545249] hover:bg-slate-50">
                <Link2 className="w-3 h-3" /> Add Article
              </button>
              <button onClick={() => setAddType('db_query')}
                className="flex items-center gap-1.5 text-xs border border-slate-200 rounded px-2.5 py-1.5 text-[#545249] hover:bg-slate-50">
                <Database className="w-3 h-3" /> DB Query
              </button>
              <button onClick={() => setAddType('paste')}
                className="flex items-center gap-1.5 text-xs border border-slate-200 rounded px-2.5 py-1.5 text-[#545249] hover:bg-slate-50">
                <ClipboardPaste className="w-3 h-3" /> Paste Text
              </button>
              {savingSrc && <Loader2 className="w-4 h-4 animate-spin text-[#787569]" />}
            </div>
          )}

          {/* Article form */}
          {addType === 'article' && (
            <div className="border border-blue-200 rounded p-3 bg-blue-50 space-y-2">
              <p className="text-[10px] text-blue-700">The server will fetch and extract the article text. Works best with arXiv, open-access journals, and news sites. Paywalled sites (Nature subscriber content, LinkedIn) will show "no content" — paste the text instead.</p>
              <input value={articleUrl} onChange={e => setArticleUrl(e.target.value)}
                placeholder="Article URL" className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none" />
              <input value={articleLabel} onChange={e => setArticleLabel(e.target.value)}
                placeholder="Label (optional)" className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none" />
              <div className="flex gap-2 items-center">
                <button onClick={() => saveSource({ source_type: 'article', article_url: articleUrl, label: articleLabel || articleUrl })}
                  disabled={savingSrc || !articleUrl.trim()}
                  className="text-xs bg-[#1e293b] text-white rounded px-3 py-1.5 disabled:opacity-40">
                  {savingSrc ? 'Fetching...' : 'Fetch & Add'}
                </button>
                <button onClick={() => setAddType(null)} className="text-xs text-[#787569]">Cancel</button>
              </div>
            </div>
          )}

          {/* DB Query form */}
          {addType === 'db_query' && (
            <div className="border border-violet-200 rounded p-3 bg-violet-50 space-y-2">
              <p className="text-[10px] text-violet-700">SELECT queries only. Results (up to 200 rows) are cached and injected as context.</p>
              <input value={queryLabel} onChange={e => setQueryLabel(e.target.value)}
                placeholder="Label (e.g. 'Robotics companies by score')" className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none" />
              <textarea value={querySql} onChange={e => setQuerySql(e.target.value)}
                placeholder="SELECT name, sector, score_composite FROM cvc.companies WHERE sector = 'Robotics' ORDER BY score_composite DESC LIMIT 50"
                rows={3} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none font-mono resize-none" />
              <div className="flex gap-2">
                <button onClick={() => saveSource({ source_type: 'db_query', query_sql: querySql, label: queryLabel })}
                  disabled={savingSrc || !querySql.trim()}
                  className="text-xs bg-[#1e293b] text-white rounded px-3 py-1.5 disabled:opacity-40">
                  {savingSrc ? 'Running...' : 'Run & Save'}
                </button>
                <button onClick={() => setAddType(null)} className="text-xs text-[#787569]">Cancel</button>
              </div>
            </div>
          )}

          {/* Paste form */}
          {addType === 'paste' && (
            <div className="border border-amber-200 rounded p-3 bg-amber-50 space-y-2">
              <input value={pasteLabel} onChange={e => setPasteLabel(e.target.value)}
                placeholder="Label (e.g. 'Industry data from report')" className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none" />
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
                placeholder="Paste text, data, or notes here..."
                rows={5} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none resize-none" />
              <div className="flex gap-2">
                <button onClick={() => saveSource({ source_type: 'paste', content_text: pasteText, label: pasteLabel || 'Pasted content' })}
                  disabled={savingSrc || !pasteText.trim()}
                  className="text-xs bg-[#1e293b] text-white rounded px-3 py-1.5 disabled:opacity-40">
                  {savingSrc ? 'Adding...' : 'Add'}
                </button>
                <button onClick={() => setAddType(null)} className="text-xs text-[#787569]">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── SectionsPanel ─────────────────────────────────────────────────────────────

function SectionsPanel({ reportId, sections, sources, onSectionsChange, onSourcesChange, onStartPolling }: {
  reportId: number;
  sections: ReportSection[];
  sources: ReportSource[];
  onSectionsChange: (s: ReportSection[]) => void;
  onSourcesChange: (s: ReportSource[]) => void;
  onStartPolling: () => void;
}) {
  const [newTitle, setNewTitle]           = useState('');
  const [addingSection, setAddingSection] = useState(false);
  const [expandedOverrides, setExpandedOverrides] = useState<Record<number, boolean>>({});
  const prevSectionsRef = useRef<ReportSection[]>([]);

  // Auto-expand a section when it finishes generating
  useEffect(() => {
    const prev = prevSectionsRef.current;
    sections.forEach(s => {
      const was = prev.find(p => p.id === s.id);
      if (was?.status === 'generating' && s.status === 'done') {
        setExpandedOverrides(o => ({ ...o, [s.id]: true }));
      }
    });
    prevSectionsRef.current = sections;
  }, [sections]);

  // Outline generator state
  const [generatingOutline, setGeneratingOutline] = useState(false);
  const [draftSections, setDraftSections] = useState<{title: string; instructions: string; section_type: string}[]>([]);
  const [savingDraft, setSavingDraft] = useState(false);

  async function generateOutline() {
    setGeneratingOutline(true);
    try {
      const res = await fetch(`${API}/reports/${reportId}/generate-outline`, {
        method: 'POST',
        headers: AUTH_HEADER,
      });
      if (res.ok) {
        const data = await res.json();
        setDraftSections(data.sections || []);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || 'Outline generation failed');
      }
    } catch (e) {
      alert(`Outline generation failed: ${e}`);
    }
    setGeneratingOutline(false);
  }

  async function confirmDraft() {
    if (draftSections.length === 0) return;
    setSavingDraft(true);
    const res = await fetch(`${API}/reports/${reportId}/sections/bulk-create`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections: draftSections }),
    });
    if (res.ok) {
      const data = await res.json();
      onSectionsChange([...sections, ...(data.sections || [])]);
      setDraftSections([]);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || 'Failed to save sections');
    }
    setSavingDraft(false);
  }
  const isExpanded = (s: ReportSection) => {
    if (s.id in expandedOverrides) return expandedOverrides[s.id];
    return false;
  };
  const toggleExpanded = (id: number, current: boolean) =>
    setExpandedOverrides(prev => ({ ...prev, [id]: !current }));

  // Import outline state
  const [importOpen, setImportOpen]   = useState(false);
  const [importMode, setImportMode]   = useState<'paste' | 'pdf'>('paste');
  const [importText, setImportText]   = useState('');
  const [importing, setImporting]     = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef                 = useRef<HTMLInputElement>(null);

  async function runImport(text: string) {
    setImporting(true);
    setImportError(null);
    const res = await fetch(`${API}/reports/${reportId}/import-outline`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_text: text }),
    });
    if (res.ok) {
      const data = await res.json();
      onSectionsChange([...sections, ...data.sections]);
      setImportOpen(false);
      setImportText('');
    } else {
      const err = await res.json().catch(() => ({}));
      setImportError(err.detail || 'Import failed');
    }
    setImporting(false);
  }

  async function importPdf(file: File) {
    setImporting(true);
    setImportError(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API}/reports/${reportId}/import-outline/upload`, {
      method: 'POST',
      headers: AUTH_HEADER,
      body: fd,
    });
    if (res.ok) {
      const data = await res.json();
      onSectionsChange([...sections, ...data.sections]);
      setImportOpen(false);
    } else {
      const err = await res.json().catch(() => ({}));
      setImportError(err.detail || 'PDF import failed');
    }
    setImporting(false);
  }

  async function addSection() {
    if (!newTitle.trim()) return;
    setAddingSection(true);
    const res = await fetch(`${API}/reports/${reportId}/sections`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() }),
    });
    if (res.ok) {
      const s = await res.json();
      onSectionsChange([...sections, s]);
      setNewTitle('');
    }
    setAddingSection(false);
  }

  async function deleteSection(id: number) {
    await fetch(`${API}/reports/${reportId}/sections/${id}`, { method: 'DELETE', headers: AUTH_HEADER });
    onSectionsChange(sections.filter(s => s.id !== id));
    setExpandedOverrides(prev => { const n = { ...prev }; delete n[id]; return n; });
  }

  async function generateSection(id: number) {
    const res = await fetch(`${API}/reports/${reportId}/sections/${id}/generate`, {
      method: 'POST', headers: AUTH_HEADER,
    });
    if (res.ok) {
      onSectionsChange(sections.map(s => s.id === id ? { ...s, status: 'generating' } : s));
      onStartPolling();
    }
  }

  async function generateAll() {
    const pending = sections.filter(s => s.status !== 'done' && s.status !== 'generating');
    for (const s of pending) {
      await fetch(`${API}/reports/${reportId}/sections/${s.id}/generate`, {
        method: 'POST', headers: AUTH_HEADER,
      });
      await new Promise(r => setTimeout(r, 150));
    }
    onSectionsChange(sections.map(s =>
      pending.some(p => p.id === s.id) ? { ...s, status: 'generating' } : s
    ));
    onStartPolling();
  }

  async function updateSection(id: number, patch: Partial<ReportSection>) {
    const res = await fetch(`${API}/reports/${reportId}/sections/${id}`, {
      method: 'PATCH',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated = await res.json();
      onSectionsChange(sections.map(s => s.id === id ? updated : s));
    }
  }

  const doneCount = sections.filter(s => s.status === 'done').length;

  return (
    <div className="border border-slate-200 rounded bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-[#787569]" />
          <span className="text-xs font-bold uppercase tracking-widest text-[#787569]">Outline</span>
          <span className="text-[10px] bg-slate-100 text-[#545249] rounded px-1.5 py-0.5 font-mono">
            {doneCount}/{sections.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setImportOpen(v => !v); setImportError(null); }}
            className={`flex items-center gap-1.5 text-xs border rounded px-2.5 py-1.5 font-medium transition-colors ${
              importOpen ? 'bg-slate-100 border-slate-300 text-[#33322c]' : 'border-slate-200 text-[#545249] hover:bg-slate-50'
            }`}>
            <Upload className="w-3 h-3" /> Import Outline
          </button>
          {sections.length > 0 && (
            <button onClick={generateAll}
              disabled={sections.every(s => s.status === 'done' || s.status === 'generating')}
              className="flex items-center gap-1.5 text-xs bg-[#1e293b] text-[#f59e0b] rounded px-2.5 py-1.5 font-medium disabled:opacity-40 hover:bg-[#334155] transition-colors">
              <Play className="w-3 h-3" /> Generate All
            </button>
          )}
        </div>
      </div>

      {/* Import Outline panel */}
      {importOpen && (
        <div className="border-b border-slate-100 px-4 py-4 bg-[#f8fafc] space-y-3">
          <div>
            <p className="text-xs font-semibold text-[#33322c] mb-1">Import outline from a document or pasted text</p>
            <p className="text-[10px] text-[#787569] leading-relaxed">
              Upload a PDF (full report, research paper, slide deck) or paste an existing outline or table of contents.
              The AI will extract section titles and analyst instructions and add them to your outline.
              Sections are appended — existing ones are not overwritten.
            </p>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 p-0.5 bg-slate-200 rounded w-fit">
            {(['paste', 'pdf'] as const).map(m => (
              <button key={m} onClick={() => setImportMode(m)}
                className={`text-xs px-3 py-1 rounded font-medium transition-colors ${
                  importMode === m ? 'bg-white text-[#33322c] shadow-sm' : 'text-[#545249]'
                }`}>
                {m === 'paste' ? 'Paste text / outline' : 'Upload PDF'}
              </button>
            ))}
          </div>

          {importMode === 'paste' ? (
            <div className="space-y-2">
              <textarea
                value={importText} onChange={e => setImportText(e.target.value)}
                rows={6}
                placeholder={"Paste your outline, table of contents, or any document text here.\n\nExample:\n1. Market Overview\n2. Key Players & Competitive Dynamics\n3. Investment Thesis\n4. Risks & Challenges\n5. Portfolio Fit"}
                className="w-full text-xs border border-slate-200 rounded px-3 py-2 bg-white focus:outline-none focus:border-slate-400 resize-none font-mono"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => runImport(importText)}
                  disabled={importing || !importText.trim()}
                  className="flex items-center gap-1.5 text-xs bg-[#1e293b] text-[#f59e0b] rounded px-3 py-1.5 font-medium disabled:opacity-40">
                  {importing ? <><Loader2 className="w-3 h-3 animate-spin" /> Extracting...</> : <><Sparkles className="w-3 h-3" /> Extract Outline</>}
                </button>
                <button onClick={() => setImportOpen(false)} className="text-xs text-[#787569] hover:text-slate-700">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={() => importFileRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-2 w-full border-2 border-dashed border-slate-300 rounded px-4 py-4 text-sm text-[#545249] hover:border-slate-400 hover:bg-white transition-colors disabled:opacity-40">
                {importing
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Extracting outline from PDF...</>
                  : <><Upload className="w-4 h-4" /> Click to upload a PDF</>}
              </button>
              <input ref={importFileRef} type="file" accept=".pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) importPdf(f); e.target.value = ''; }} />
              <button onClick={() => setImportOpen(false)} className="text-xs text-[#787569] hover:text-slate-700">Cancel</button>
            </div>
          )}

          {importError && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded p-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {importError}
            </div>
          )}
        </div>
      )}

      <div className="p-4 space-y-2">
        {sections.length === 0 && draftSections.length === 0 && !importOpen && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <FileText className="w-8 h-8 text-slate-300" />
            <p className="text-xs text-[#787569]">No sections yet</p>
            <div className="flex items-center gap-2">
              <button
                onClick={generateOutline}
                disabled={generatingOutline}
                className="flex items-center gap-1.5 text-xs bg-[#1e293b] text-[#f59e0b] rounded px-3 py-2 font-medium disabled:opacity-40 hover:bg-[#334155] transition-colors"
              >
                {generatingOutline
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating outline...</>
                  : <><Sparkles className="w-3.5 h-3.5" /> Generate Outline</>}
              </button>
              <span className="text-xs text-[#787569]">or add manually below</span>
            </div>
          </div>
        )}

        {/* Draft outline review panel */}
        {draftSections.length > 0 && (
          <div className="border border-amber-200 rounded bg-amber-50 overflow-hidden mb-3">
            <div className="flex items-center justify-between px-4 py-3 border-b border-amber-200">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs font-bold text-amber-800">Draft Outline — {draftSections.length} sections</span>
                <span className="text-[10px] text-amber-600">Review and edit before saving</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDraftSections([])}
                  className="text-xs text-[#787569] hover:text-slate-700 px-2 py-1 border border-slate-200 rounded bg-white"
                >
                  Discard
                </button>
                <button
                  onClick={confirmDraft}
                  disabled={savingDraft}
                  className="flex items-center gap-1.5 text-xs bg-[#1e293b] text-[#f59e0b] rounded px-3 py-1.5 font-medium disabled:opacity-40 hover:bg-[#334155] transition-colors"
                >
                  {savingDraft ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</> : 'Confirm & Save'}
                </button>
              </div>
            </div>
            <div className="p-3 space-y-2">
              {draftSections.map((ds, i) => (
                <div key={i} className="border border-amber-200 rounded bg-white p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          value={ds.title}
                          onChange={e => setDraftSections(prev => prev.map((s, j) => j === i ? { ...s, title: e.target.value } : s))}
                          className="flex-1 text-xs font-semibold border border-slate-200 rounded px-2 py-1.5 bg-[#ede8d7] focus:outline-none focus:border-slate-400"
                          placeholder="Section title"
                        />
                        <select
                          value={ds.section_type || 'prose'}
                          onChange={e => setDraftSections(prev => prev.map((s, j) => j === i ? { ...s, section_type: e.target.value } : s))}
                          className={`text-[10px] border rounded px-1.5 py-1 shrink-0 focus:outline-none cursor-pointer font-medium ${TYPE_BADGE_CLS[ds.section_type || 'prose'] || TYPE_BADGE_CLS.prose}`}
                        >
                          {SECTION_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        value={ds.instructions}
                        onChange={e => setDraftSections(prev => prev.map((s, j) => j === i ? { ...s, instructions: e.target.value } : s))}
                        rows={2}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-[#ede8d7] focus:outline-none focus:border-slate-400 resize-none text-[#545249]"
                        placeholder="Analyst instructions..."
                      />
                    </div>
                    <button
                      onClick={() => setDraftSections(prev => prev.filter((_, j) => j !== i))}
                      className="text-slate-400 hover:text-red-500 mt-1 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {sections.map((section, idx) => (
          <SectionCard
            key={section.id}
            section={section}
            sources={sources}
            reportId={reportId}
            isFirst={idx === 0}
            isLast={idx === sections.length - 1}
            expanded={isExpanded(section)}
            onExpand={() => toggleExpanded(section.id, isExpanded(section))}
            onDelete={() => deleteSection(section.id)}
            onGenerate={() => generateSection(section.id)}
            onUpdate={(patch) => updateSection(section.id, patch)}
            onSourcesChange={onSourcesChange}
          />
        ))}

        {/* Add section row */}
        <div className="flex gap-2 pt-1">
          <input
            value={newTitle} onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addSection()}
            placeholder="Add section title..."
            className="flex-1 text-xs border border-slate-200 rounded px-3 py-2 bg-[#ede8d7] focus:outline-none focus:border-slate-400"
          />
          <button onClick={addSection} disabled={addingSection || !newTitle.trim()}
            className="flex items-center gap-1 text-xs bg-slate-100 text-[#545249] rounded px-3 py-2 hover:bg-slate-200 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}


// ── SectionCard ───────────────────────────────────────────────────────────────

interface DiscoveryWebSource {
  title: string;
  url: string;
  snippet: string;
}

interface DiscoveryDbSource {
  id: string;
  label: string;
  description: string;
  sql: string;
  preview: string[];
}

function SectionCard({ section, sources, reportId, isFirst, isLast, expanded, onExpand, onDelete, onGenerate, onUpdate, onSourcesChange }: {
  section: ReportSection;
  sources: ReportSource[];
  reportId: number;
  isFirst: boolean;
  isLast: boolean;
  expanded: boolean;
  onExpand: () => void;
  onDelete: () => void;
  onGenerate: () => void;
  onUpdate: (patch: Partial<ReportSection>) => void;
  onSourcesChange: (s: ReportSource[]) => void;
}) {
  const [editingContent, setEditingContent] = useState(false);
  const [contentDraft, setContentDraft]     = useState(section.content || '');
  const [savingContent, setSavingContent]   = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState(section.instructions || '');
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [showHistory, setShowHistory]       = useState(false);

  // Research / discovery state
  const [discoverOpen, setDiscoverOpen]     = useState(false);
  const [discovering, setDiscovering]       = useState(false);
  const [discoverError, setDiscoverError]   = useState<string | null>(null);
  const [webSources, setWebSources]         = useState<DiscoveryWebSource[]>([]);
  const [dbSources, setDbSources]           = useState<DiscoveryDbSource[]>([]);
  const [checkedWeb, setCheckedWeb]         = useState<Set<number>>(new Set());
  const [checkedDb, setCheckedDb]           = useState<Set<string>>(new Set());
  const [addingSources, setAddingSources]   = useState(false);

  async function runDiscover() {
    setDiscovering(true);
    setDiscoverError(null);
    setWebSources([]);
    setDbSources([]);
    setCheckedWeb(new Set());
    setCheckedDb(new Set());
    try {
      const res = await fetch(`${API}/reports/${reportId}/sections/${section.id}/discover`, {
        method: 'POST',
        headers: AUTH_HEADER,
      });
      if (res.ok) {
        const data = await res.json();
        setWebSources(data.web_sources || []);
        setDbSources(data.db_sources || []);
      } else {
        const err = await res.json().catch(() => ({}));
        setDiscoverError(err.detail || 'Discovery failed');
      }
    } catch (e) {
      setDiscoverError(`Discovery failed: ${e}`);
    }
    setDiscovering(false);
  }

  async function addSelectedSources() {
    setAddingSources(true);
    const newSources: ReportSource[] = [];

    for (const idx of Array.from(checkedWeb)) {
      const ws = webSources[idx];
      if (!ws) continue;
      try {
        const res = await fetch(`${API}/reports/${reportId}/sources`, {
          method: 'POST',
          headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_type: 'article',
            label: ws.title,
            article_url: ws.url,
            section_id: section.id,
          }),
        });
        if (res.ok) newSources.push(await res.json());
      } catch (e) {
        console.warn('Failed to add web source', ws.url, e);
      }
    }

    for (const dbId of Array.from(checkedDb)) {
      const ds = dbSources.find(d => d.id === dbId);
      if (!ds) continue;
      try {
        const res = await fetch(`${API}/reports/${reportId}/sources`, {
          method: 'POST',
          headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_type: 'db_query',
            label: ds.label,
            query_sql: ds.sql,
            section_id: section.id,
          }),
        });
        if (res.ok) newSources.push(await res.json());
      } catch (e) {
        console.warn('Failed to add db source', ds.id, e);
      }
    }

    if (newSources.length > 0) {
      onSourcesChange([...sources, ...newSources]);
    }
    setDiscoverOpen(false);
    setAddingSources(false);
  }

  const selectedCount = checkedWeb.size + checkedDb.size;

  useEffect(() => { setContentDraft(section.content || ''); }, [section.content]);

  async function saveContent() {
    setSavingContent(true);
    await onUpdate({ content: contentDraft } as any);
    setSavingContent(false);
    setEditingContent(false);
  }

  async function saveInstructions() {
    setSavingInstructions(true);
    await onUpdate({ instructions: instructionsDraft } as any);
    setSavingInstructions(false);
  }

  const attachedSources = sources.filter(s => s.section_id === section.id);
  const sharedSources   = sources.filter(s => s.section_id === null);
  const allSources      = [...attachedSources, ...sharedSources];

  return (
    <div className={`border rounded overflow-hidden transition-colors ${
      section.status === 'error' ? 'border-red-200' : 'border-slate-200'
    }`}>
      {/* Section header row */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#f8fafc] hover:bg-[#f1f5f9] transition-colors cursor-pointer"
        onClick={onExpand}>
        <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
        {STATUS_ICON[section.status] || STATUS_ICON.pending}
        <span className="text-xs font-semibold text-[#33322c] flex-1">{section.title}</span>
        {section.confidence_score !== null && (() => {
          const { text, color } = confLabel(section.confidence_score);
          return text ? (
            <span className="text-[10px] font-medium shrink-0" style={{ color }}>{text}</span>
          ) : null;
        })()}
        {/* Section type selector */}
        <select
          value={section.section_type || 'prose'}
          onChange={e => { e.stopPropagation(); onUpdate({ section_type: e.target.value } as any); }}
          onClick={e => e.stopPropagation()}
          className={`text-[10px] border rounded px-1.5 py-0.5 shrink-0 focus:outline-none cursor-pointer transition-colors font-medium ${TYPE_BADGE_CLS[section.section_type || 'prose'] || TYPE_BADGE_CLS.prose}`}
        >
          {SECTION_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <span className="text-[10px] text-[#787569] font-mono shrink-0">{allSources.length}src</span>
        <button
          onClick={e => { e.stopPropagation(); setDiscoverOpen(v => !v); if (!discoverOpen && webSources.length === 0 && dbSources.length === 0) runDiscover(); }}
          className={`shrink-0 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
            discoverOpen ? 'border-blue-300 text-blue-700 bg-blue-50' : 'border-slate-200 text-[#545249] hover:bg-slate-100'
          }`}
          title="Discover sources for this section"
        >
          <Search className="w-3 h-3" /> Research
        </button>
        {section.status !== 'generating' && (
          <button
            onClick={e => { e.stopPropagation(); onGenerate(); }}
            className="shrink-0 p-1 rounded hover:bg-slate-200 text-[#545249]"
            title={section.status === 'done' ? 'Regenerate' : 'Generate'}>
            {section.status === 'done'
              ? <RefreshCw className="w-3 h-3" />
              : <Play className="w-3 h-3" />}
          </button>
        )}
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          className="shrink-0 p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500">
          <Trash2 className="w-3 h-3" />
        </button>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-[#787569] shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-[#787569] shrink-0" />}
      </div>

      {/* Discovery panel */}
      {discoverOpen && (
        <div className="border-t border-blue-100 bg-[#f0f7ff] px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-xs font-bold text-blue-800">Source Discovery</span>
              {discovering && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={runDiscover}
                disabled={discovering}
                className="text-[10px] text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-0.5 bg-white disabled:opacity-40"
              >
                {discovering ? 'Searching...' : 'Re-run'}
              </button>
              <button onClick={() => setDiscoverOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {discoverError && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded p-2 border border-red-200">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {discoverError}
            </div>
          )}

          {!discovering && webSources.length === 0 && dbSources.length === 0 && !discoverError && (
            <p className="text-xs text-[#787569] italic">Searching for sources...</p>
          )}

          {/* Web Sources */}
          {webSources.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-blue-700">Web Sources ({webSources.length})</div>
              {webSources.map((ws, i) => (
                <label key={i} className="flex items-start gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={checkedWeb.has(i)}
                    onChange={e => setCheckedWeb(prev => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(i); else n.delete(i);
                      return n;
                    })}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <a href={ws.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-medium text-blue-700 hover:underline block truncate"
                      onClick={e => e.stopPropagation()}>
                      {ws.title}
                    </a>
                    {ws.snippet && (
                      <p className="text-[10px] text-[#545249] leading-relaxed mt-0.5 line-clamp-2">{ws.snippet}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* DB Sources */}
          {dbSources.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-violet-700">From Your Database</div>
              {dbSources.map(ds => (
                <label key={ds.id} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkedDb.has(ds.id)}
                    onChange={e => setCheckedDb(prev => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(ds.id); else n.delete(ds.id);
                      return n;
                    })}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Database className="w-3 h-3 text-violet-500 shrink-0" />
                      <span className="text-xs font-medium text-[#33322c]">{ds.label}</span>
                      <span className="text-[10px] text-[#787569]">{ds.description}</span>
                    </div>
                    {ds.preview && ds.preview.length > 0 && (
                      <p className="text-[10px] text-[#545249] mt-0.5 ml-5">{ds.preview.join(', ')}{ds.preview.length < parseInt(ds.description) ? '...' : ''}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Add selected button */}
          {(webSources.length > 0 || dbSources.length > 0) && (
            <div className="pt-1 border-t border-blue-100">
              <button
                onClick={addSelectedSources}
                disabled={addingSources || selectedCount === 0}
                className="flex items-center gap-1.5 text-xs bg-[#1e293b] text-[#f59e0b] rounded px-3 py-1.5 font-medium disabled:opacity-40 hover:bg-[#334155] transition-colors"
              >
                {addingSources
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Adding...</>
                  : `Add Selected${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Expanded area */}
      {expanded && (
        <div className="px-4 pb-4 pt-3 space-y-3 border-t border-slate-100">
          {/* Error */}
          {section.error_msg && (
            <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 rounded p-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {section.error_msg}
            </div>
          )}

          {/* Instructions */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">Analyst Instructions</div>
            <textarea
              value={instructionsDraft}
              onChange={e => setInstructionsDraft(e.target.value)}
              onBlur={saveInstructions}
              rows={2}
              placeholder="What should this section cover? Any specific angle, data to highlight, or arguments to make?"
              className="w-full text-xs border border-slate-200 rounded px-3 py-2 bg-[#ede8d7] focus:outline-none focus:border-slate-400 resize-none"
            />
          </div>

          {/* Section-level audience/tone overrides */}
          <div className="flex gap-2 items-center">
            <span className="text-[10px] text-[#787569] shrink-0">Override:</span>
            <select
              value={section.audience || ''}
              onChange={e => onUpdate({ audience: e.target.value || null } as any)}
              className="text-[10px] border border-slate-200 rounded px-1.5 py-0.5 bg-white focus:outline-none cursor-pointer text-[#545249]"
              title="Section audience override (blank = use report default)"
            >
              <option value="">Audience (default)</option>
              {AUDIENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <select
              value={section.tone || ''}
              onChange={e => onUpdate({ tone: e.target.value || null } as any)}
              className="text-[10px] border border-slate-200 rounded px-1.5 py-0.5 bg-white focus:outline-none cursor-pointer text-[#545249]"
              title="Section tone override (blank = use report default)"
            >
              <option value="">Tone (default)</option>
              {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Sources for this section */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">
              Sources ({allSources.length})
            </div>
            {allSources.length === 0 ? (
              <p className="text-xs text-[#787569] italic">No sources — LLM will draw from general knowledge</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {attachedSources.map(s => (
                  <span key={s.id} className="flex items-center gap-1 text-[10px] bg-violet-100 text-violet-700 rounded px-2 py-0.5">
                    {SOURCE_ICON[s.source_type]} {s.label || s.filename || s.source_type}
                  </span>
                ))}
                {sharedSources.map(s => (
                  <span key={s.id} className="flex items-center gap-1 text-[10px] bg-slate-100 text-[#545249] rounded px-2 py-0.5">
                    {SOURCE_ICON[s.source_type]} {s.label || s.filename || s.source_type}
                    <span className="text-[#787569]">(shared)</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Generated content */}
          {section.content && !editingContent && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">
                  Generated Content
                  {section.generated_at && (
                    <span className="ml-2 font-normal normal-case">
                      · {new Date(section.generated_at).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {section.version_history.length > 0 && (
                    <button onClick={() => setShowHistory(v => !v)}
                      className="text-[10px] text-[#787569] hover:text-slate-700">
                      {showHistory ? 'Hide' : `${section.version_history.length} prev`}
                    </button>
                  )}
                  <button onClick={() => setEditingContent(true)}
                    className="text-[10px] text-[#545249] hover:text-[#1e293b] border border-slate-200 rounded px-2 py-0.5">
                    Edit
                  </button>
                </div>
              </div>
              <div className="text-sm text-[#33322c] leading-relaxed bg-[#f8fafc] rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                {section.content}
              </div>
              {showHistory && section.version_history.map((v, i) => (
                <div key={i} className="border border-slate-100 rounded p-2 bg-white opacity-60">
                  <div className="text-[10px] text-[#787569] mb-1">v{section.version_history.length - i} · {v.generated_at ? new Date(v.generated_at).toLocaleString() : '—'}</div>
                  <div className="text-xs text-[#33322c] max-h-24 overflow-y-auto whitespace-pre-wrap">{v.content}</div>
                </div>
              ))}
            </div>
          )}

          {/* Content edit mode */}
          {editingContent && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">Edit Content</div>
              <textarea
                value={contentDraft} onChange={e => setContentDraft(e.target.value)}
                rows={10}
                className="w-full text-sm border border-slate-200 rounded px-3 py-2 bg-[#ede8d7] focus:outline-none focus:border-slate-400 resize-y font-mono"
              />
              <div className="flex gap-2">
                <button onClick={saveContent} disabled={savingContent}
                  className="text-xs bg-[#1e293b] text-white rounded px-3 py-1.5 font-medium disabled:opacity-40">
                  {savingContent ? 'Saving...' : 'Save Edit'}
                </button>
                <button onClick={() => { setEditingContent(false); setContentDraft(section.content || ''); }}
                  className="text-xs text-[#787569] hover:text-slate-700">Cancel</button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!section.content && section.status !== 'generating' && (
            <button onClick={onGenerate}
              className="w-full py-3 border border-dashed border-slate-300 rounded text-xs text-[#787569] hover:text-[#33322c] hover:border-slate-400 transition-colors flex items-center justify-center gap-2">
              <Play className="w-3.5 h-3.5" /> Generate this section
            </button>
          )}

          {section.status === 'generating' && (
            <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded p-3">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Generating... this takes 20–40 seconds
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── DownloadBar ───────────────────────────────────────────────────────────────

function DownloadBar({ reportId, reportTitle, doneCount, totalCount, publishedHtml, reportStatus, onOpenEditorial, onPublish, onPublishedHtmlReady }: {
  reportId: number;
  reportTitle: string;
  doneCount: number;
  totalCount: number;
  publishedHtml: string | null;
  reportStatus: string;
  onOpenEditorial: () => void;
  onPublish: () => void;
  onPublishedHtmlReady: (html: string) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [publishingForEdit, setPublishingForEdit] = useState(false);

  async function downloadDocx() {
    setDownloading(true);
    try {
      const res = await fetch(`${API}/reports/${reportId}/download/docx`, { headers: AUTH_HEADER });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportTitle.replace(/\s+/g, '_')}_Report.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Download failed: ${e}`);
    }
    setDownloading(false);
  }

  async function openEditorial() {
    if (publishedHtml) {
      onOpenEditorial();
      return;
    }
    // Need to publish first — trigger publish and poll for HTML
    setPublishingForEdit(true);
    onPublish();
    let tries = 0;
    const poll = async () => {
      const res = await fetch(`${API}/reports/${reportId}`, { headers: AUTH_HEADER });
      if (res.ok) {
        const data = await res.json();
        if (data.published_html) {
          onPublishedHtmlReady(data.published_html);
          setPublishingForEdit(false);
          // Small delay so state propagates before opening
          setTimeout(() => onOpenEditorial(), 50);
          return;
        }
      }
      tries++;
      if (tries < 40) setTimeout(poll, 2000);
      else setPublishingForEdit(false);
    };
    setTimeout(poll, 2500);
  }

  return (
    <div className="border border-slate-200 rounded bg-white px-5 py-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-xs font-semibold text-[#33322c]">Export report</p>
        <p className="text-[10px] text-[#787569] mt-0.5">
          {doneCount} of {totalCount} sections complete
          {!publishedHtml && <span className="ml-2 text-amber-600">· not yet published</span>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={openEditorial}
          disabled={publishingForEdit || reportStatus === 'generating'}
          className="flex items-center gap-1.5 text-xs bg-emerald-600 text-white rounded px-3 py-2 font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          {publishingForEdit
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing...</>
            : <><FileText className="w-3.5 h-3.5" /> Edit &amp; Review</>}
        </button>
        <button
          onClick={downloadDocx}
          disabled={downloading}
          className="flex items-center gap-1.5 text-xs bg-[#1e293b] text-white rounded px-3 py-2 font-medium hover:bg-[#334155] transition-colors disabled:opacity-50"
        >
          {downloading
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Preparing...</>
            : <><Download className="w-3.5 h-3.5" /> Download Word (.docx)</>}
        </button>
        {publishedHtml && (
          <a
            href={`data:text/html;charset=utf-8,${encodeURIComponent(publishedHtml)}`}
            download={`${reportTitle.replace(/\s+/g, '_')}.html`}
            className="flex items-center gap-1.5 text-xs border border-slate-200 text-[#545249] rounded px-3 py-2 font-medium hover:bg-slate-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Download HTML
          </a>
        )}
      </div>
    </div>
  );
}
