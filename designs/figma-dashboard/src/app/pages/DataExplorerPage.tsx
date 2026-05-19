/**
 * DataExplorerPage — pre-built analytical report templates.
 * Consumes the data-explorer plugin API at /explore/*.
 *
 * Shows 8 report templates. User picks one, applies filters,
 * and sees the data as a bar chart or table plus provenance metadata.
 */

import { useState, useEffect, useCallback } from 'react';
import { CVCNavbar } from '../components/CVCNavbar';
import { AUTH_HEADER as AUTH } from '../api/client';
import { cls, chartFallbacks } from '../components/tokens';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  BarChart2, TrendingUp, PieChart, Users2, Building2, Activity,
  Star, Shuffle, AlertCircle, RefreshCw, Info, ChevronDown,
} from 'lucide-react';

// ── Report registry ────────────────────────────────────────────────────────────

interface ReportDef {
  key:         string;
  label:       string;
  description: string;
  icon:        React.ComponentType<{ className?: string }>;
  xKey:        string;
  yKey:        string;
  yLabel:      string;
  filters?:    FilterDef[];
  endpoint:    (filters: Record<string, string>) => string;
}

interface FilterDef {
  key:         string;
  label:       string;
  type:        'text' | 'number' | 'select';
  options?:    string[];
  default?:    string;
  placeholder?: string;
}

const REPORTS: ReportDef[] = [
  {
    key:         'sector-overview',
    label:       'Sector Overview',
    description: 'Company count, portfolio count, and avg score by sector.',
    icon:        PieChart,
    xKey:        'sector',
    yKey:        'company_count',
    yLabel:      'Companies',
    filters: [
      { key: 'stage',     label: 'Stage',     type: 'select', options: ['', 'Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Series D+', 'Growth'], default: '' },
      { key: 'min_score', label: 'Min Score', type: 'number', placeholder: '0–100' },
    ],
    endpoint: (f) => {
      const p = new URLSearchParams();
      if (f.stage)     p.set('stage', f.stage);
      if (f.min_score) p.set('min_score', f.min_score);
      return `/explore/sector-overview?${p}`;
    },
  },
  {
    key:         'funding-trends',
    label:       'Funding Trends',
    description: 'Total capital raised per year across tracked companies.',
    icon:        TrendingUp,
    xKey:        'year',
    yKey:        'total_m',
    yLabel:      'Total ($M)',
    filters: [
      { key: 'sector',     label: 'Sector',     type: 'text',   placeholder: 'e.g. Robotics' },
      { key: 'start_year', label: 'From Year',  type: 'number', default: '2020', placeholder: '2020' },
      { key: 'end_year',   label: 'To Year',    type: 'number', default: '2026', placeholder: '2026' },
    ],
    endpoint: (f) => {
      const p = new URLSearchParams();
      if (f.sector)     p.set('sector', f.sector);
      if (f.start_year) p.set('start_year', f.start_year);
      if (f.end_year)   p.set('end_year', f.end_year);
      return `/explore/funding-trends?${p}`;
    },
  },
  {
    key:         'stage-distribution',
    label:       'Stage Distribution',
    description: 'Company count by funding stage (Pre-Seed through Growth).',
    icon:        BarChart2,
    xKey:        'stage',
    yKey:        'company_count',
    yLabel:      'Companies',
    filters: [
      { key: 'sector', label: 'Sector', type: 'text', placeholder: 'e.g. Supply Chain' },
    ],
    endpoint: (f) => {
      const p = new URLSearchParams();
      if (f.sector) p.set('sector', f.sector);
      return `/explore/stage-distribution?${p}`;
    },
  },
  {
    key:         'score-distribution',
    label:       'Score Distribution',
    description: 'Companies bucketed by composite score (0–100, 20-point bands).',
    icon:        Star,
    xKey:        'label',
    yKey:        'company_count',
    yLabel:      'Companies',
    filters: [
      { key: 'sector', label: 'Sector', type: 'text', placeholder: 'e.g. Manufacturing' },
    ],
    endpoint: (f) => {
      const p = new URLSearchParams();
      if (f.sector) p.set('sector', f.sector);
      return `/explore/score-distribution?${p}`;
    },
  },
  {
    key:         'engagement-over-time',
    label:       'Partner Engagement',
    description: 'Partner intro events per year. No partner names exposed.',
    icon:        Activity,
    xKey:        'year',
    yKey:        'intro_events',
    yLabel:      'Intro Events',
    filters: [
      { key: 'sector', label: 'Sector', type: 'text', placeholder: 'Filter by sector' },
    ],
    endpoint: (f) => {
      const p = new URLSearchParams();
      if (f.sector) p.set('sector', f.sector);
      return `/explore/engagement-over-time?${p}`;
    },
  },
  {
    key:         'industry-activity',
    label:       'Industry Activity',
    description: 'Intro events grouped by corporate partner industry.',
    icon:        Building2,
    xKey:        'industry',
    yKey:        'intro_events',
    yLabel:      'Intro Events',
    endpoint: (_f) => '/explore/industry-activity',
  },
  {
    key:         'sector-demand',
    label:       'Sector Demand',
    description: 'Which startup sectors attract the most corporate partner interest?',
    icon:        Shuffle,
    xKey:        'sector',
    yKey:        'intro_events',
    yLabel:      'Intro Events',
    endpoint: (_f) => '/explore/sector-demand',
  },
  {
    key:         'intro-outcomes',
    label:       'Intro Outcomes',
    description: 'How partner introductions resolve — outcome distribution.',
    icon:        Users2,
    xKey:        'label',
    yKey:        'count',
    yLabel:      'Count',
    filters: [
      { key: 'sector', label: 'Sector', type: 'text', placeholder: 'Filter by sector' },
    ],
    endpoint: (f) => {
      const p = new URLSearchParams();
      if (f.sector) p.set('sector', f.sector);
      return `/explore/intro-outcomes?${p}`;
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

interface DataQuality {
  total_companies:  number;
  human_edited_pct: number;
  enriched_pct:     number;
  data_score:       number;
}

interface Meta {
  source_tables: string[];
  key_fields:    Record<string, string>;
  caveats:       string[];
  data_quality:  DataQuality;
}

interface ReportResult {
  data: Record<string, any>[];
  meta: Meta;
}

function QualityBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-emerald-100 text-emerald-700'
              : score >= 40 ? 'bg-amber-100 text-amber-700'
              :               'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${color}`}>
      Data quality: {score}/100
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DataExplorerPage() {
  const [selectedKey, setSelectedKey]   = useState<string>(REPORTS[0].key);
  const [filters, setFilters]           = useState<Record<string, string>>({});
  const [result, setResult]             = useState<ReportResult | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [showMeta, setShowMeta]         = useState(false);

  const report = REPORTS.find(r => r.key === selectedKey)!;

  // Reset filters when report changes
  useEffect(() => {
    const defaults: Record<string, string> = {};
    for (const f of report.filters ?? []) {
      if (f.default) defaults[f.key] = f.default;
    }
    setFilters(defaults);
    setResult(null);
    setError(null);
  }, [selectedKey]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(report.endpoint(filters), { headers: AUTH });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setResult(json);
    } catch (e: any) {
      setError(e.message ?? 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [report, filters]);

  // Auto-run when report changes
  useEffect(() => { run(); }, [selectedKey]);

  return (
    <div className={cls.page}>
      <CVCNavbar />

      <div className="max-w-[1400px] mx-auto px-8 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Data Explorer</h1>
          <p className="text-sm text-slate-500 mt-1">
            Pre-built analytical reports. Every number shows where it came from.
          </p>
        </div>

        <div className="flex gap-6">

          {/* Left sidebar — report list */}
          <div className="w-56 shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">Reports</p>
            <div className="flex flex-col gap-0.5">
              {REPORTS.map(r => {
                const Icon = r.icon;
                return (
                  <button
                    key={r.key}
                    onClick={() => setSelectedKey(r.key)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm font-medium text-left transition-colors ${
                      selectedKey === r.key
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">

            {/* Report header + filters */}
            <div className="bg-white rounded border border-slate-200 p-5 mb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">{report.label}</h2>
                  <p className="text-sm text-slate-500 mt-0.5">{report.description}</p>
                </div>
                <button
                  onClick={run}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-sm font-semibold rounded hover:bg-slate-700 transition-colors disabled:opacity-50 shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  {loading ? 'Loading…' : 'Run'}
                </button>
              </div>

              {/* Filters */}
              {(report.filters ?? []).length > 0 && (
                <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-slate-100">
                  {(report.filters ?? []).map(f => (
                    <div key={f.key} className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{f.label}</label>
                      {f.type === 'select' ? (
                        <div className="relative">
                          <select
                            value={filters[f.key] ?? f.default ?? ''}
                            onChange={e => setFilters(prev => ({ ...prev, [f.key]: e.target.value }))}
                            className="appearance-none pr-7 pl-2.5 py-1.5 text-sm border border-slate-200 rounded bg-white text-slate-700 focus:outline-none focus:border-slate-400"
                          >
                            {(f.options ?? []).map(o => (
                              <option key={o} value={o}>{o || 'All'}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        </div>
                      ) : (
                        <input
                          type={f.type}
                          value={filters[f.key] ?? f.default ?? ''}
                          placeholder={f.placeholder}
                          onChange={e => setFilters(prev => ({ ...prev, [f.key]: e.target.value }))}
                          className="px-2.5 py-1.5 text-sm border border-slate-200 rounded bg-white text-slate-700 focus:outline-none focus:border-slate-400 w-28"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded p-3 mb-4 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Chart */}
            {result && result.data.length > 0 && (
              <div className="bg-white rounded border border-slate-200 p-5 mb-4">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold text-slate-700">{report.yLabel} by {report.xKey}</p>
                  {result.meta?.data_quality && (
                    <QualityBadge score={result.meta.data_quality.data_score} />
                  )}
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={result.data} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
                    <XAxis
                      dataKey={report.xKey}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      angle={-30}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={48} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 6 }}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <Bar dataKey={report.yKey} radius={[3, 3, 0, 0]} maxBarSize={56}>
                      {result.data.map((_entry, i) => (
                        <Cell key={i} fill={chartFallbacks[i % chartFallbacks.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Table */}
            {result && result.data.length > 0 && (
              <div className="bg-white rounded border border-slate-200 overflow-hidden mb-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        {Object.keys(result.data[0]).map(col => (
                          <th key={col} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap">
                            {col.replace(/_/g, ' ')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.map((row, i) => (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60">
                          {Object.values(row).map((val: any, j) => (
                            <td key={j} className="px-4 py-2 text-slate-700 whitespace-nowrap">
                              {val === null || val === undefined ? '—' : String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {result && result.data.length === 0 && !loading && (
              <div className="bg-white rounded border border-slate-200 p-8 text-center text-slate-400 mb-4">
                No data for this filter combination.
              </div>
            )}

            {/* Provenance / Meta */}
            {result?.meta && (
              <div className="bg-white rounded border border-slate-200">
                <button
                  onClick={() => setShowMeta(m => !m)}
                  className="flex items-center justify-between w-full px-5 py-3 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4" />
                    Data provenance & caveats
                  </div>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showMeta ? 'rotate-180' : ''}`} />
                </button>
                {showMeta && (
                  <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Source Tables</p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.meta.source_tables.map(t => (
                          <code key={t} className="px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600 font-mono">{t}</code>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Key Fields</p>
                      <div className="space-y-1">
                        {Object.entries(result.meta.key_fields).map(([field, desc]) => (
                          <div key={field} className="flex gap-2 text-xs">
                            <code className="text-slate-500 font-mono shrink-0">{field}</code>
                            <span className="text-slate-500">—</span>
                            <span className="text-slate-600">{desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Caveats</p>
                      <ul className="space-y-1">
                        {result.meta.caveats.map((c, i) => (
                          <li key={i} className="flex gap-2 text-xs text-slate-500">
                            <span className="shrink-0 mt-0.5">•</span>
                            <span>{c}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {result.meta.data_quality && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Data Quality</p>
                        <div className="flex flex-wrap gap-4 text-xs text-slate-600">
                          <span><strong>{result.meta.data_quality.total_companies}</strong> companies in scope</span>
                          <span><strong>{result.meta.data_quality.human_edited_pct}%</strong> human-edited</span>
                          <span><strong>{result.meta.data_quality.enriched_pct}%</strong> enriched</span>
                          <QualityBadge score={result.meta.data_quality.data_score} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
