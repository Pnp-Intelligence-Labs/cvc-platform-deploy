import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Play, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import { cls } from '../components/tokens';

type JobType = 'founder' | '4d' | 'funding' | 'deployments' | 'industrial' | 'score_refresh';
type TargetType = 'sector' | 'portfolio' | 'all';

interface BatchJob {
  id: number;
  job_type: string;
  target_type: string;
  sector?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at?: string;
  completed_at?: string;
  results_summary?: any;
  progress_current: number;
  progress_total: number;
  created_at: string;
}

const jobTypeLabels: Record<JobType, string> = {
  founder:       'Founder Research',
  '4d':          '4D Classification',
  funding:       'Funding Rounds',
  deployments:   'Case Studies & Deployments',
  industrial:    'Industrial Analysis',
  score_refresh: 'Score Refresh',
};

const targetLabels: Record<TargetType, string> = {
  sector: 'By Sector',
  portfolio: 'Portfolio',
  all: 'All Companies'
};

function BatchResultsSummary({ summary }: { summary: any }) {
  const companies: any[] = summary.companies ?? [];
  const hasPerCompany = companies.length > 0;

  return (
    <div className="space-y-4">
      {/* Brave quota warning */}
      {summary.brave_quota_exhausted && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <span className="text-amber-500 text-lg leading-none mt-0.5">⚠</span>
          <div>
            <div className="text-sm font-semibold text-amber-800">Brave Search quota exhausted</div>
            <div className="text-xs text-amber-700 mt-0.5">All search results are empty this run — both API keys hit their monthly limit. Raise the spend cap in your Brave Search account to restore search coverage.</div>
          </div>
        </div>
      )}

      {/* Top-line stats */}
      {(summary.total != null) && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { label: 'Total',          value: summary.total,                 color: '#253B49' },
            { label: 'Success',        value: summary.success,               color: '#10b981' },
            { label: 'Failed',         value: summary.failed,                color: '#ef4444' },
            { label: 'Skipped',        value: summary.skipped,               color: '#9ca3af' },
            { label: 'News Written',   value: summary.news_articles_written, color: '#6366f1' },
            { label: 'CS Queued',      value: summary.case_studies_queued,   color: '#f59e0b' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white border border-[#e5e7eb] rounded-lg p-3 text-center">
              <div className="text-xl font-bold" style={{ color }}>{value ?? '—'}</div>
              <div className="text-[10px] text-[#9ca3af] font-medium uppercase tracking-wide mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Per-company breakdown */}
      {hasPerCompany && (
        <div className="border border-[#e5e7eb] rounded-lg overflow-hidden">
          <div className="bg-[#f9fafb] px-4 py-2.5 border-b border-[#e5e7eb]">
            <span className="text-xs font-bold text-[#374151] uppercase tracking-wide">Per-Company Results</span>
          </div>
          <div className="divide-y divide-[#f5f5f5] max-h-80 overflow-y-auto">
            {companies.map((c: any) => (
              <div key={c.id} className="flex items-start justify-between px-4 py-2.5 hover:bg-[#fafcff]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      c.status === 'success' ? 'bg-[#10b981]' :
                      c.status === 'skipped' ? 'bg-[#9ca3af]' : 'bg-[#ef4444]'
                    }`} />
                    <span className="text-xs font-semibold text-[#1f2937] truncate">{c.name}</span>
                  </div>
                  {c.error && <p className="text-[10px] text-[#ef4444] ml-3.5 mt-0.5">{c.error}</p>}
                </div>
                <div className="flex items-center gap-3 ml-3 flex-shrink-0 text-[10px] text-[#6b7280]">
                  <span title="Website fetched">{c.website_ok ? '🌐' : '—'}</span>
                  <span title="News articles found">{c.news_found ?? 0} news</span>
                  <span title="Case studies queued for review"
                    className={c.case_studies_queued > 0 ? 'text-[#f59e0b] font-semibold' : ''}>
                    {c.case_studies_queued ?? 0} CS
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search performance breakdown (deployments job only) */}
      {summary.search_performance && Object.keys(summary.search_performance).length > 0 && (
        <div className="border border-[#e5e7eb] rounded-lg overflow-hidden">
          <div className="bg-[#f9fafb] px-4 py-2.5 border-b border-[#e5e7eb]">
            <span className="text-xs font-bold text-[#374151] uppercase tracking-wide">Brave Search Performance</span>
          </div>
          <div className="divide-y divide-[#f5f5f5]">
            {Object.entries(summary.search_performance as Record<string, any>).map(([type, s]) => (
              <div key={type} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs font-medium text-[#374151] capitalize">{type.replace('_', ' ')}</span>
                <div className="flex items-center gap-4 text-xs text-[#6b7280]">
                  <span>{s.runs} runs</span>
                  <span className="font-semibold text-[#253B49]">{s.avg_results} avg results</span>
                  <span className={`font-semibold ${s.zero_result_pct > 50 ? 'text-red-500' : s.zero_result_pct > 20 ? 'text-amber-500' : 'text-green-600'}`}>
                    {s.zero_result_pct}% zero-result
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fallback: raw JSON for non-deep jobs */}
      {!hasPerCompany && !summary.search_performance && (
        <pre className="text-xs text-[#6b7280] overflow-x-auto font-mono bg-[#f9fafb] p-3 rounded-lg border border-[#e5e7eb]">
          {JSON.stringify(summary, null, 2)}
        </pre>
      )}
    </div>
  );
}

export const AdminBatchJobs: React.FC = () => {
  const [jobType, setJobType] = useState<JobType>('founder');
  const [target, setTarget] = useState<TargetType>('all');
  const [sector, setSector] = useState<string>('');
  const [sectors, setSectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [latestJob, setLatestJob] = useState<BatchJob | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetchSectors();
    fetchLatestJob();
    const interval = setInterval(fetchLatestJob, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchSectors = async () => {
    try {
      const data = await api.companies.getSectors();
      setSectors(data);
    } catch (e) {
      console.error('Failed to fetch sectors', e);
    }
  };

  const fetchLatestJob = async () => {
    try {
      const data = await api.admin.getLatestBatchJob();
      setLatestJob(data);
    } catch (e) {
      console.error('Failed to fetch latest job', e);
    }
  };

  const handleRun = async () => {
    setLoading(true);
    setError('');
    try {
      await api.admin.runBatchEnrichment({
        job: jobType,
        target: target,
        ...(target === 'sector' && sector ? { sector } : {})
      });
      await fetchLatestJob();
    } catch (e: any) {
      setError(e.message || 'Failed to start job');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'running':
        return <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="p-6">
      <div className="mb-8">
        <h3 className={`${cls.sectionTitle} mb-4`}>New Batch Job</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Job Type</label>
            <select 
              value={jobType}
              onChange={(e) => setJobType(e.target.value as JobType)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#253B49] bg-white"
            >
              <option value="founder">Founder Research</option>
              <option value="4d">4D Classification</option>
              <option value="funding">Funding Rounds</option>
              <option value="deployments">Case Studies &amp; Deployments</option>
              <option value="industrial">Industrial Analysis</option>
              <option value="score_refresh">Score Refresh</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Target</label>
            <select 
              value={target}
              onChange={(e) => setTarget(e.target.value as TargetType)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#253B49] bg-white"
            >
              <option value="all">All Companies</option>
              <option value="portfolio">Portfolio</option>
              <option value="sector">By Sector</option>
            </select>
          </div>
          
          {target === 'sector' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sector</label>
              <select 
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#253B49] bg-white"
              >
                <option value="">Select Sector</option>
                {sectors.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-md flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
        
        <button
          onClick={handleRun}
          disabled={loading || (target === 'sector' && !sector)}
          className="bg-[#253B49] text-white px-6 py-2 rounded-md hover:bg-opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {loading ? 'Starting...' : 'Run Batch Job'}
        </button>
      </div>
      
      <div className="border-t border-gray-200 pt-6">
        <h3 className={`${cls.sectionTitle} mb-4`}>Last Run Status</h3>
        
        {latestJob ? (
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {getStatusIcon(latestJob.status)}
                  <div>
                    <div className="font-medium text-gray-900">
                      {jobTypeLabels[latestJob.job_type as JobType] || latestJob.job_type} • {' '}
                      {targetLabels[latestJob.target_type as TargetType] || latestJob.target_type}
                      {latestJob.sector && ` • ${latestJob.sector}`}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      Job #{latestJob.id} • Started {formatDate(latestJob.started_at)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {latestJob.status === 'running' && latestJob.progress_total > 0 && (
                    <span className="text-sm font-semibold text-blue-700 tabular-nums">
                      {latestJob.progress_current}/{latestJob.progress_total}
                      <span className="ml-1.5 text-blue-400 font-normal">
                        ({Math.round(100 * latestJob.progress_current / latestJob.progress_total)}%)
                      </span>
                    </span>
                  )}
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    latestJob.status === 'completed' ? 'bg-green-100 text-green-800' :
                    latestJob.status === 'failed' ? 'bg-red-100 text-red-800' :
                    latestJob.status === 'running' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {latestJob.status.charAt(0).toUpperCase() + latestJob.status.slice(1)}
                  </span>
                </div>
              </div>

              {/* Progress bar — only shown while running with known total */}
              {latestJob.status === 'running' && latestJob.progress_total > 0 && (
                <div className="mt-3">
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${Math.round(100 * latestJob.progress_current / latestJob.progress_total)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
            
            {latestJob.completed_at && (
              <div className="text-sm text-gray-600">
                Completed: {formatDate(latestJob.completed_at)}
              </div>
            )}
            
            {latestJob.results_summary && Object.keys(latestJob.results_summary).length > 0 && (
              <BatchResultsSummary summary={latestJob.results_summary} />
            )}
            
            {latestJob.error_message && (
              <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">
                <span className="font-medium">Error:</span> {latestJob.error_message}
              </div>
            )}
          </div>
        ) : (
          <div className="text-gray-500 text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            No batch jobs have been run yet.
          </div>
        )}
      </div>
    </div>
  );
};
