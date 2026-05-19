/**
 * DataExplorer.tsx
 * AI-powered and catalog-driven data query suggester for the Report Workspace.
 *
 * Two modes:
 *   suggest  — LLM reads the report context and proposes relevant DB queries
 *   browse   — Static catalog of pre-built query packs, browsable by category
 *
 * Each suggestion can be previewed (inline recharts chart) or added as a source.
 */

import { useState, useEffect } from 'react';
import {
  Database, Sparkles, ChevronDown, Loader2, BarChart2,
  TrendingUp, PieChart as PieChartIcon, CheckCircle2, Plus,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { AUTH_HEADER } from '../api/client';

const API = '';

// ── Palette ───────────────────────────────────────────────────────────────────

const CHART_COLORS = ['#6366F1', '#10b981', '#f59e0b', '#EC4899', '#06B6D4', '#8b5cf6'];

// ── Types ─────────────────────────────────────────────────────────────────────

interface Suggestion {
  title: string;
  rationale: string;
  sql: string;
  chart_type: 'bar' | 'line' | 'pie' | 'area';
  x_key: string;
  y_key: string;
  description?: string;
}

interface CatalogCategory {
  name: string;
  suggestions: Suggestion[];
}

interface PreviewResult {
  suggestionIndex: number;
  columns: string[];
  rows: Record<string, any>[];
  row_count: number;
  chart_type: string;
  x_key: string;
  y_key: string;
  error?: string;
}

// Minimal types needed from ReportWorkspace — avoids cross-file type import complexity
interface TrendReport {
  id: number;
  title: string;
  report_brief: string | null;
  sector: string | null;
}

interface ReportSection {
  id: number;
  title: string;
  instructions: string | null;
}

interface Props {
  reportId: number;
  report: TrendReport;
  sections: ReportSection[];
  onAddSource: (source: any) => void;
}

// ── Chart type badge ──────────────────────────────────────────────────────────

function ChartTypeBadge({ type }: { type: string }) {
  const icon =
    type === 'bar'  ? <BarChart2 className="w-2.5 h-2.5" /> :
    type === 'line' || type === 'area' ? <TrendingUp className="w-2.5 h-2.5" /> :
    <PieChartIcon className="w-2.5 h-2.5" />;

  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-slate-100 text-[#545249] rounded px-1.5 py-0.5 font-mono">
      {icon} {type}
    </span>
  );
}

// ── Inline chart ──────────────────────────────────────────────────────────────

function InlineChart({ preview }: { preview: PreviewResult }) {
  const { rows, chart_type, x_key, y_key } = preview;

  if (!rows.length) {
    return <p className="text-xs text-[#787569] py-4 text-center">No data returned</p>;
  }

  // Truncate x labels for readability
  const truncate = (v: any) => {
    const s = String(v ?? '');
    return s.length > 16 ? s.slice(0, 14) + '…' : s;
  };

  const displayRows = rows.slice(0, 30);

  if (chart_type === 'pie') {
    const pieData = displayRows.map(r => ({
      name: truncate(r[x_key]),
      value: Number(r[y_key]) || 0,
    }));
    return (
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}>
            {pieData.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v: any) => Number(v).toLocaleString()} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chart_type === 'line' || chart_type === 'area') {
    return (
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={displayRows} margin={{ top: 4, right: 8, bottom: 24, left: 8 }}>
          <XAxis dataKey={x_key} tick={{ fontSize: 9 }} tickFormatter={truncate} angle={-30} textAnchor="end" />
          <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => Number(v).toLocaleString()} width={48} />
          <Tooltip formatter={(v: any) => Number(v).toLocaleString()} />
          <Line type="monotone" dataKey={y_key} stroke={CHART_COLORS[0]} dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // Default: bar
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={displayRows} margin={{ top: 4, right: 8, bottom: 24, left: 8 }}>
        <XAxis dataKey={x_key} tick={{ fontSize: 9 }} tickFormatter={truncate} angle={-30} textAnchor="end" />
        <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => Number(v).toLocaleString()} width={48} />
        <Tooltip formatter={(v: any) => Number(v).toLocaleString()} />
        <Bar dataKey={y_key} radius={[3, 3, 0, 0]}>
          {displayRows.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── SuggestionCard ────────────────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  index,
  reportId,
  previewResult,
  previewLoading,
  addingSource,
  addedSource,
  onPreview,
  onAddSource,
}: {
  suggestion: Suggestion;
  index: number;
  reportId: number;
  previewResult: PreviewResult | null;
  previewLoading: number | null;
  addingSource: number | null;
  addedSource: number | null;
  onPreview: (idx: number) => void;
  onAddSource: (idx: number) => void;
}) {
  const isPreviewing = previewLoading === index;
  const isAdding = addingSource === index;
  const isAdded = addedSource === index;
  const hasPreview = previewResult?.suggestionIndex === index;

  return (
    <div className="border border-slate-200 rounded bg-white overflow-hidden">
      <div className="px-3 py-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-[#33322c] leading-tight flex-1">{suggestion.title}</span>
          <ChartTypeBadge type={suggestion.chart_type} />
        </div>
        <p className="text-xs text-[#787569] leading-relaxed">{suggestion.rationale}</p>
        {suggestion.description && suggestion.description !== suggestion.rationale && (
          <p className="text-[10px] text-[#9e9a94] italic">{suggestion.description}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onPreview(index)}
            disabled={isPreviewing}
            className="flex items-center gap-1.5 text-xs border border-slate-200 text-[#545249] rounded px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            {isPreviewing
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Running...</>
              : <><BarChart2 className="w-3 h-3" /> Preview</>}
          </button>
          <button
            onClick={() => onAddSource(index)}
            disabled={isAdding || isAdded}
            className="flex items-center gap-1.5 text-xs bg-[#1e293b] text-[#f59e0b] rounded px-2.5 py-1.5 font-medium disabled:opacity-50 hover:bg-[#334155] transition-colors"
          >
            {isAdded
              ? <><CheckCircle2 className="w-3 h-3 text-emerald-400" /> Added</>
              : isAdding
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Adding...</>
              : <><Plus className="w-3 h-3" /> Add as Source</>}
          </button>
        </div>
      </div>

      {hasPreview && previewResult && (
        <div className="border-t border-slate-100 bg-[#f8fafc] px-3 py-3">
          {previewResult.error ? (
            <p className="text-xs text-red-500 font-mono">{previewResult.error}</p>
          ) : (
            <>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">
                Preview — {previewResult.row_count} rows
              </p>
              <InlineChart preview={previewResult} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DataExplorer({ reportId, report, sections, onAddSource }: Props) {
  const [mode, setMode] = useState<'suggest' | 'browse'>('suggest');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<CatalogCategory[]>([]);
  const [catalogCategory, setCatalogCategory] = useState<string>('');

  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState<number | null>(null);

  const [addingSource, setAddingSource] = useState<number | null>(null);
  const [addedSource, setAddedSource] = useState<number | null>(null);

  const [open, setOpen] = useState(false);

  // Load catalog once when switching to browse mode
  useEffect(() => {
    if (mode === 'browse' && catalog.length === 0) {
      fetch(`${API}/reports/catalog`, { headers: AUTH_HEADER })
        .then(r => r.json())
        .then(data => {
          setCatalog(data);
          if (data.length > 0) setCatalogCategory(data[0].name);
        })
        .catch(() => {});
    }
  }, [mode]);

  async function fetchSuggestions() {
    setLoadingSuggestions(true);
    setSuggestError(null);
    setPreviewResult(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50000); // 50s client timeout
    try {
      const res = await fetch(`${API}/reports/${reportId}/explore`, {
        method: 'POST',
        headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_section_context: true }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      } else {
        setSuggestError('Suggestion failed — try again');
      }
    } catch (e: any) {
      setSuggestError(e?.name === 'AbortError' ? 'Request timed out — try again' : 'Could not reach server');
    } finally {
      clearTimeout(timer);
      setLoadingSuggestions(false);
    }
  }

  async function runPreview(idx: number, suggestion: Suggestion) {
    setPreviewLoading(idx);
    setPreviewResult(null);
    try {
      const res = await fetch(`${API}/reports/${reportId}/preview-query`, {
        method: 'POST',
        headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: suggestion.sql,
          chart_type: suggestion.chart_type,
          x_key: suggestion.x_key,
          y_key: suggestion.y_key,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewResult({ ...data, suggestionIndex: idx });
      } else {
        const err = await res.json().catch(() => ({ detail: 'Query failed' }));
        setPreviewResult({
          suggestionIndex: idx, columns: [], rows: [], row_count: 0,
          chart_type: suggestion.chart_type, x_key: suggestion.x_key, y_key: suggestion.y_key,
          error: err.detail || 'Query failed',
        });
      }
    } catch (e: any) {
      setPreviewResult({
        suggestionIndex: idx, columns: [], rows: [], row_count: 0,
        chart_type: suggestion.chart_type, x_key: suggestion.x_key, y_key: suggestion.y_key,
        error: e?.message || 'Network error',
      });
    }
    setPreviewLoading(null);
  }

  async function addSuggestionAsSource(idx: number, suggestion: Suggestion) {
    setAddingSource(idx);
    try {
      const res = await fetch(`${API}/reports/${reportId}/sources`, {
        method: 'POST',
        headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: 'db_query',
          label: suggestion.title,
          query_sql: suggestion.sql,
          chart_type: suggestion.chart_type || null,
          x_key: suggestion.x_key || null,
          y_key: suggestion.y_key || null,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        onAddSource(result);
        setAddedSource(idx);
        // Reset "added" indicator after 3s
        setTimeout(() => setAddedSource(prev => prev === idx ? null : prev), 3000);
      }
    } catch (_) {}
    setAddingSource(null);
  }

  // Active suggestion list — depends on mode and selected catalog category
  const activeSuggestions: Suggestion[] = mode === 'suggest'
    ? suggestions
    : (catalog.find(c => c.name === catalogCategory)?.suggestions || []);

  return (
    <div className="border border-slate-200 rounded bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#f8f9fa] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-[#787569]" />
          <span className="text-xs font-bold uppercase tracking-widest text-[#787569]">Data Explorer</span>
          {suggestions.length > 0 && mode === 'suggest' && (
            <span className="text-[10px] bg-slate-100 text-[#545249] rounded px-1.5 py-0.5 font-mono">
              {suggestions.length}
            </span>
          )}
        </div>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-[#787569] rotate-180 transition-transform" />
          : <ChevronDown className="w-3.5 h-3.5 text-[#787569] transition-transform" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100">

          {/* Mode toggle */}
          <div className="flex gap-1 p-0.5 bg-slate-100 rounded w-fit mt-3">
            <button
              onClick={() => setMode('suggest')}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                mode === 'suggest' ? 'bg-white text-[#33322c] shadow-sm' : 'text-[#545249] hover:text-[#33322c]'
              }`}
            >
              <Sparkles className="w-3 h-3" /> AI Suggestions
            </button>
            <button
              onClick={() => setMode('browse')}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                mode === 'browse' ? 'bg-white text-[#33322c] shadow-sm' : 'text-[#545249] hover:text-[#33322c]'
              }`}
            >
              <Database className="w-3 h-3" /> Browse Catalog
            </button>
          </div>

          {/* Suggest mode */}
          {mode === 'suggest' && (
            <>
              {loadingSuggestions ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-[#787569]">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <p className="text-xs">Analyzing report context...</p>
                  <p className="text-[10px] text-[#9e9a94]">Usually takes 5–15 seconds</p>
                </div>
              ) : suggestError ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <p className="text-xs text-red-500">{suggestError}</p>
                  <button onClick={fetchSuggestions} className="flex items-center gap-2 text-sm bg-[#1e293b] text-[#f59e0b] rounded px-4 py-2.5 font-medium hover:bg-[#334155] transition-colors">
                    <Sparkles className="w-4 h-4" /> Try again
                  </button>
                </div>
              ) : suggestions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <Database className="w-8 h-8 text-slate-300" />
                  <button
                    onClick={fetchSuggestions}
                    className="flex items-center gap-2 text-sm bg-[#1e293b] text-[#f59e0b] rounded px-4 py-2.5 font-medium hover:bg-[#334155] transition-colors"
                  >
                    <Sparkles className="w-4 h-4" /> Suggest data for this report
                  </button>
                  <p className="text-xs text-[#787569] text-center max-w-xs">
                    AI will read your brief and sections and suggest relevant data from the CVC database
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-[#787569]">{suggestions.length} suggestions based on your report</p>
                    <button
                      onClick={fetchSuggestions}
                      disabled={loadingSuggestions}
                      className="flex items-center gap-1 text-[10px] text-[#545249] hover:text-[#1e293b] border border-slate-200 rounded px-2 py-1 disabled:opacity-40"
                    >
                      <Sparkles className="w-2.5 h-2.5" /> Refresh
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                    {suggestions.map((s, idx) => (
                      <SuggestionCard
                        key={idx}
                        suggestion={s}
                        index={idx}
                        reportId={reportId}
                        previewResult={previewResult}
                        previewLoading={previewLoading}
                        addingSource={addingSource}
                        addedSource={addedSource}
                        onPreview={(i) => runPreview(i, suggestions[i])}
                        onAddSource={(i) => addSuggestionAsSource(i, suggestions[i])}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Browse mode */}
          {mode === 'browse' && (
            <>
              {catalog.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-[#787569]" />
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Category pills */}
                  <div className="flex flex-wrap gap-1.5">
                    {catalog.map(cat => (
                      <button
                        key={cat.name}
                        onClick={() => { setCatalogCategory(cat.name); setPreviewResult(null); }}
                        className={`text-xs rounded px-3 py-1.5 font-medium transition-colors ${
                          catalogCategory === cat.name
                            ? 'bg-[#1e293b] text-[#f59e0b]'
                            : 'border border-slate-200 text-[#545249] hover:bg-slate-50'
                        }`}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>

                  {/* Suggestion cards for selected category */}
                  <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                    {activeSuggestions.map((s, idx) => (
                      <SuggestionCard
                        key={idx}
                        suggestion={s}
                        index={idx}
                        reportId={reportId}
                        previewResult={previewResult}
                        previewLoading={previewLoading}
                        addingSource={addingSource}
                        addedSource={addedSource}
                        onPreview={(i) => runPreview(i, activeSuggestions[i])}
                        onAddSource={(i) => addSuggestionAsSource(i, activeSuggestions[i])}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

        </div>
      )}
    </div>
  );
}
