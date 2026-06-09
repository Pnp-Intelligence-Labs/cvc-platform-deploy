import { useState, useEffect, useRef } from 'react';
import { Search, SlidersHorizontal, X, Users, BookOpen, Plus, Loader2, Upload } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { cls } from '../components/tokens';
import { AUTH_HEADER as AUTH, api } from '../api/client';


const STAGES = ['All Stages', 'Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Undisclosed'];
const STAGE_LABELS: Record<string, string> = {
  'All Stages': 'All Stages', 'Pre-Seed': 'Pre-Seed', 'Seed': 'Seed',
  'Series A': 'Series A', 'Series B': 'Series B', 'Series C': 'Series C', 'Undisclosed': 'Undisclosed',
};

interface Company {
  id: number;
  name: string;
  one_liner?: string;
  sector?: string;
  stage?: string;
  hq_city?: string;
  country?: string;
  total_raised_usd?: number | null;
  signal_score?: number | null;
  intro_count?: number;
  intro_partners?: string[];
  is_hardware?: boolean | null;
  is_software?: boolean | null;
  founded?: number | null;
  has_case_study?: boolean;
  investor_tier?: string | null;
  is_portfolio?: boolean | null;
  fund?: string | null;
}

function fmt(n?: number | null) {
  if (!n) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#F59E0B' : '#ef4444';
  const c = 2 * Math.PI * 18;
  return (
    <div className="relative w-11 h-11 shrink-0">
      <svg className="w-11 h-11 -rotate-90">
        <circle cx="22" cy="22" r="18" stroke="#e2e8f0" strokeWidth="3" fill="none" />
        <circle cx="22" cy="22" r="18" stroke={color} strokeWidth="3" fill="none"
          strokeDasharray={c} strokeDashoffset={c - (score / 100) * c} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-[#33322c]">{score}</span>
    </div>
  );
}

interface ImportResult {
  inserted: number;
  skipped: number;
  failed: number;
  total_rows: number;
  errors: string[];
}

export default function CompanySearch() {
  const navigate = useNavigate();

  // Current user role — used to gate Import CSV button
  const currentUser = api.getCurrentUser();
  const canImport = ['GP', 'Principal', 'Director'].includes(currentUser?.role ?? '');

  // Quick Add
  const [showQA, setShowQA]           = useState(false);
  const [qaUrl, setQaUrl]             = useState('');
  const [qaLoading, setQaLoading]     = useState(false);
  const [qaError, setQaError]         = useState('');
  const [qaAddPipeline, setQaAddPipeline] = useState(false);
  const qaInputRef                    = useRef<HTMLInputElement>(null);

  // CSV Import
  const [showImport, setShowImport]       = useState(false);
  const [importFile, setImportFile]       = useState<File | null>(null);
  const [importing, setImporting]         = useState(false);
  const [importResult, setImportResult]   = useState<ImportResult | null>(null);
  const [importError, setImportError]     = useState('');
  const fileInputRef                      = useRef<HTMLInputElement>(null);

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportError('');
    setImportResult(null);
    try {
      const form = new FormData();
      form.append('file', importFile);
      const res = await fetch('/admin/companies/import', {
        method: 'POST',
        headers: AUTH,
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
      setImportResult(data);
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setImportError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const closeImport = () => {
    setShowImport(false);
    setImportFile(null);
    setImportResult(null);
    setImportError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qaUrl.trim()) return;
    setQaLoading(true);
    setQaError('');
    try {
      const res = await fetch('/admin/quickadd', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: qaUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
      if (qaAddPipeline) {
        await fetch('/dealflow/intake', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: data.company_id, pipeline_status: 'discovered' }),
        });
      }
      navigate(`/company/${data.company_id}`);
    } catch (err: any) {
      setQaError(err.message || 'Failed to add company');
      setQaLoading(false);
    }
  };

  const [q, setQ]                         = useState('');
  const [sector, setSector]               = useState('All Sectors');
  const [stage, setStage]                 = useState('All Stages');
  const [showAdvanced, setShowAdvanced]   = useState(false);
  const [isHardware, setIsHardware]       = useState<boolean | null>(null);
  const [isSoftware, setIsSoftware]       = useState<boolean | null>(null);
  const [raisedMin, setRaisedMin]         = useState('');
  const [raisedMax, setRaisedMax]         = useState('');
  const [foundedAfter, setFoundedAfter]   = useState('');
  const [foundedBefore, setFoundedBefore] = useState('');
  const [minIntros, setMinIntros]         = useState('');
  const [hasCaseStudy, setHasCaseStudy]   = useState(false);
  const [investorTier, setInvestorTier]   = useState('');
  const [page, setPage]                   = useState(1);
  const [companies, setCompanies]         = useState<Company[]>([]);
  const [total, setTotal]                 = useState(0);
  const [sectorOptions, setSectorOptions] = useState<string[]>(['All Sectors']);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const perPage = 50;

  useEffect(() => {
    fetch('/companies/sectors', { headers: AUTH })
      .then(r => r.ok ? r.json() : [])
      .then((data: { sector: string }[]) => setSectorOptions(['All Sectors', ...data.map(d => d.sector)]))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (q)                              qs.append('q', q);
    if (sector !== 'All Sectors')       qs.append('sector', sector);
    if (stage !== 'All Stages')         qs.append('stage', stage);
    if (isHardware !== null)            qs.append('is_hardware', String(isHardware));
    if (isSoftware !== null)            qs.append('is_software', String(isSoftware));
    if (raisedMin)                      qs.append('raised_min', String(Number(raisedMin) * 1e6));
    if (raisedMax)                      qs.append('raised_max', String(Number(raisedMax) * 1e6));
    if (foundedAfter)                   qs.append('founded_after', foundedAfter);
    if (foundedBefore)                  qs.append('founded_before', foundedBefore);
    if (minIntros)                      qs.append('min_intros', minIntros);
    if (hasCaseStudy)                   qs.append('has_case_study', 'true');
    if (investorTier)                   qs.append('investor_tier', investorTier);
    qs.append('per_page', String(perPage));
    qs.append('page', String(page));

    fetch('/sourcing/?' + qs.toString(), { headers: AUTH })
      .then(r => { if (!r.ok) throw new Error('Search failed'); return r.json(); })
      .then(data => { setCompanies(data.companies ?? []); setTotal(data.total ?? 0); setError(null); })
      .catch(err => { setError(err.message); setCompanies([]); })
      .finally(() => setLoading(false));
  }, [q, sector, stage, isHardware, isSoftware, raisedMin, raisedMax, foundedAfter, foundedBefore, minIntros, hasCaseStudy, investorTier, page]);

  const clearAdvanced = () => {
    setIsHardware(null); setIsSoftware(null);
    setRaisedMin(''); setRaisedMax('');
    setFoundedAfter(''); setFoundedBefore('');
    setMinIntros(''); setHasCaseStudy(false);
    setInvestorTier('');
  };

  const advancedActive = isHardware !== null || isSoftware !== null || raisedMin || raisedMax || foundedAfter || foundedBefore || minIntros || hasCaseStudy || investorTier;
  const totalPages = Math.ceil(total / perPage);

  return (
    <div className={cls.page}>
      <main className="max-w-[1400px] mx-auto px-4 py-6 md:px-6 md:py-8">

        {/* Report header */}
        <div className="border-b-2 border-[#33322c] pb-5 mb-6">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">
            Vertical OS · Deal Pipeline
          </div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className={cls.pageTitle}>Companies</h1>
              <p className="text-sm text-[#545249] mt-1">
                {loading ? '—' : `${total.toLocaleString()} companies`} · sorted by score
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {!showQA ? (
                <div className="flex items-center gap-2">
                  {canImport && (
                    <button
                      onClick={() => setShowImport(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 text-slate-600 text-xs font-semibold rounded hover:border-slate-400 hover:text-slate-800 transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" /> Import CSV
                    </button>
                  )}
                  <button
                    onClick={() => { setShowQA(true); setTimeout(() => qaInputRef.current?.focus(), 50); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1E293B] text-cvc-gold text-xs font-semibold rounded hover:bg-slate-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Quick Add
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-end gap-1.5">
                  <form onSubmit={handleQuickAdd} className="flex items-center gap-2">
                    <input
                      ref={qaInputRef}
                      type="url"
                      placeholder="https://company.com"
                      value={qaUrl}
                      onChange={e => { setQaUrl(e.target.value); setQaError(''); }}
                      className="w-64 px-3 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:border-[#33322c]"
                      disabled={qaLoading}
                    />
                    <button
                      type="submit"
                      disabled={qaLoading || !qaUrl.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1E293B] text-cvc-gold text-xs font-semibold rounded hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                      {qaLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      {qaLoading ? 'Adding…' : 'Add'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowQA(false); setQaUrl(''); setQaError(''); setQaAddPipeline(false); }}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </form>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={qaAddPipeline}
                      onChange={e => setQaAddPipeline(e.target.checked)}
                      className="accent-[#1E293B] w-3.5 h-3.5"
                    />
                    <span className="text-xs text-slate-500">Add to Deal Pipeline</span>
                  </label>
                </div>
              )}
              {qaError && <p className="text-xs text-red-500">{qaError}</p>}
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded border border-slate-200 p-4 mb-6 sticky top-14 z-40 shadow-sm">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#787569]" />
              <input type="text" placeholder="Search companies…" value={q}
                onChange={e => { setQ(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-[#33322c]" />
            </div>
            <select value={sector} onChange={e => { setSector(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-slate-200 rounded bg-white text-sm text-[#33322c] focus:outline-none focus:border-[#33322c]">
              {sectorOptions.map(s => <option key={s}>{s}</option>)}
            </select>
            <select value={stage} onChange={e => { setStage(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-slate-200 rounded bg-white text-sm text-[#33322c] focus:outline-none focus:border-[#33322c]">
              {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>
            <button onClick={() => setShowAdvanced(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 border rounded text-sm font-medium transition-colors ${
                advancedActive
                  ? 'border-[#33322c] text-[#33322c] bg-[#33322c]/5'
                  : 'border-slate-200 text-[#545249] hover:border-[#33322c] hover:text-[#33322c]'
              }`}>
              <SlidersHorizontal className="w-4 h-4" />
              Filters {advancedActive && <span className="bg-[#33322c] text-white text-xs rounded-full px-1.5">on</span>}
            </button>
            {advancedActive && (
              <button onClick={clearAdvanced} className="flex items-center gap-1 text-sm text-[#787569] hover:text-red-500">
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>

          {/* Advanced filters */}
          {showAdvanced && (
            <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Type</p>
                <div className="flex flex-col gap-1.5">
                  {[{ label: 'Hardware', key: 'hw' }, { label: 'Software', key: 'sw' }].map(({ label, key }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox"
                        checked={key === 'hw' ? isHardware === true : isSoftware === true}
                        onChange={e => key === 'hw' ? setIsHardware(e.target.checked ? true : null) : setIsSoftware(e.target.checked ? true : null)}
                        className="accent-[#33322c]" />
                      <span className="text-sm text-[#33322c]">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Raised (US$M)</p>
                <div className="flex gap-2 items-center">
                  <input type="number" placeholder="Min" value={raisedMin} onChange={e => setRaisedMin(e.target.value)}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-[#33322c]" />
                  <span className="text-[#787569] text-xs">–</span>
                  <input type="number" placeholder="Max" value={raisedMax} onChange={e => setRaisedMax(e.target.value)}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-[#33322c]" />
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Founded</p>
                <div className="flex gap-2 items-center">
                  <input type="number" placeholder="From" value={foundedAfter} onChange={e => setFoundedAfter(e.target.value)}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-[#33322c]" />
                  <span className="text-[#787569] text-xs">–</span>
                  <input type="number" placeholder="To" value={foundedBefore} onChange={e => setFoundedBefore(e.target.value)}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-[#33322c]" />
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Min Partner Intros</p>
                <input type="number" placeholder="e.g. 3" value={minIntros} onChange={e => setMinIntros(e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-[#33322c]" />
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Investor Tier</p>
                <select value={investorTier} onChange={e => { setInvestorTier(e.target.value); setPage(1); }}
                  className="w-full px-2 py-1.5 border border-slate-200 rounded bg-white text-sm focus:outline-none focus:border-[#33322c]">
                  <option value="">Any</option>
                  <option value="top_tier">Top Tier</option>
                  <option value="mid_tier">Mid Tier</option>
                  <option value="emerging">Emerging</option>
                </select>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Evidence</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={hasCaseStudy} onChange={e => { setHasCaseStudy(e.target.checked); setPage(1); }}
                    className="accent-[#33322c]" />
                  <span className="text-sm text-[#33322c] flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-[#787569]" /> Has Case Study
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Results */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-solid border-[#33322c] border-r-transparent" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700 text-sm">{error}</div>
        ) : companies.length === 0 ? (
          <div className="text-center py-16 text-[#787569]">No companies match your filters.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {companies.map(c => (
              <div key={c.id} className="bg-white rounded border border-slate-200 overflow-hidden hover:border-slate-200 hover:shadow-sm transition-all flex flex-col">
                <div className="p-5 flex flex-col flex-1">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-sm font-bold text-[#33322c] line-clamp-2 flex-1 tracking-tight">{c.name}</h3>
                    {c.signal_score != null && <ScoreRing score={Math.round(c.signal_score)} />}
                  </div>
                  <p className="text-xs text-[#545249] mb-3 line-clamp-2 min-h-[2rem]">{c.one_liner ?? ''}</p>

                  <div className="space-y-1.5 mb-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[#787569]">Sector</span>
                      <span className="font-medium text-[#33322c] text-right">{c.sector ?? '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#787569]">Stage</span>
                      <span className="font-medium text-[#33322c]">{STAGE_LABELS[c.stage ?? ''] ?? c.stage ?? '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#787569]">Raised</span>
                      <span className="font-medium text-[#33322c]">{fmt(c.total_raised_usd)}</span>
                    </div>
                    {(c.intro_count ?? 0) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-[#787569] flex items-center gap-1"><Users className="w-3 h-3" /> Intros</span>
                        <span className="font-medium text-emerald-600">{c.intro_count} partner{c.intro_count !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                  </div>

                  {(c.fund || c.has_case_study || (c.investor_tier && c.investor_tier !== 'unknown')) && (
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {c.fund && (
                        <span className="text-[10px] font-bold text-[#7a6f00] bg-cvc-gold/20 px-1.5 py-0.5 rounded uppercase tracking-widest border border-cvc-gold/30">{c.fund}</span>
                      )}
                      {c.investor_tier === 'top_tier' && (
                        <span className="text-[10px] font-bold text-[#7a6f00] bg-cvc-gold/20 px-1.5 py-0.5 rounded uppercase tracking-widest border border-cvc-gold/30">Top Investors</span>
                      )}
                      {c.investor_tier === 'mid_tier' && (
                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded uppercase tracking-widest border border-blue-100">Mid-Tier</span>
                      )}
                      {c.investor_tier === 'emerging' && (
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded uppercase tracking-widest border border-emerald-100">Emerging VC</span>
                      )}
                      {c.has_case_study && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                          <BookOpen className="w-3 h-3" /> Case Study
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-auto flex gap-2 pt-2 border-t border-slate-200">
                    <Link to={`/companies/${c.id}`}
                      className="flex-1 text-center px-3 py-1.5 bg-[#33322c] text-white text-xs font-semibold rounded hover:bg-[#151411] transition-colors">
                      View Profile
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && !loading && (
          <div className="flex items-center justify-between mt-8">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-slate-200 rounded text-sm text-[#545249] hover:bg-[#ede8d7] disabled:opacity-40 disabled:cursor-not-allowed">
              Previous
            </button>
            <span className="text-sm text-[#545249]">Page {page} of {totalPages} · {total.toLocaleString()} total</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-slate-200 rounded text-sm text-[#545249] hover:bg-[#ede8d7] disabled:opacity-40 disabled:cursor-not-allowed">
              Next
            </button>
          </div>
        )}
      </main>

      {/* CSV Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-[#33322c]">Import Companies from CSV</h2>
              <button onClick={closeImport} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {!importResult ? (
              <>
                <p className="text-xs text-slate-500 mb-4">
                  Upload a CSV with company data. Only <code className="bg-slate-100 px-1 rounded">name</code> is
                  required — all other columns are optional. Existing companies (matched by name) are skipped.
                </p>
                <div className="text-xs text-slate-400 mb-4 space-y-0.5">
                  <div className="font-medium text-slate-500 mb-1">Supported columns:</div>
                  {['name', 'website', 'sector', 'stage', 'hq_city', 'hq_country', 'founded',
                    'employee_count', 'total_raised_usd', 'one_liner'].map(col => (
                    <span key={col} className="inline-block mr-1.5 mb-1 px-1.5 py-0.5 bg-slate-100 rounded font-mono">{col}</span>
                  ))}
                </div>

                <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors mb-4">
                  <Upload className="w-6 h-6 text-slate-400 mb-1.5" />
                  <span className="text-sm text-slate-500">
                    {importFile ? importFile.name : 'Click to select CSV file'}
                  </span>
                  {importFile && (
                    <span className="text-xs text-slate-400 mt-0.5">
                      {(importFile.size / 1024).toFixed(1)} KB
                    </span>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={e => { setImportFile(e.target.files?.[0] ?? null); setImportError(''); }}
                  />
                </label>

                {importError && (
                  <p className="text-xs text-red-500 mb-3">{importError}</p>
                )}

                <div className="flex gap-2 justify-end">
                  <button onClick={closeImport}
                    className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded hover:bg-slate-50 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={!importFile || importing}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#1E293B] text-cvc-gold text-sm font-semibold rounded hover:bg-slate-700 transition-colors disabled:opacity-50"
                  >
                    {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {importing ? 'Importing…' : 'Import'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="text-center p-3 bg-emerald-50 rounded-lg">
                    <div className="text-2xl font-bold text-emerald-600">{importResult.inserted}</div>
                    <div className="text-xs text-emerald-700 mt-0.5">Added</div>
                  </div>
                  <div className="text-center p-3 bg-slate-50 rounded-lg">
                    <div className="text-2xl font-bold text-slate-500">{importResult.skipped}</div>
                    <div className="text-xs text-slate-500 mt-0.5">Skipped</div>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded-lg">
                    <div className="text-2xl font-bold text-red-500">{importResult.failed}</div>
                    <div className="text-xs text-red-600 mt-0.5">Failed</div>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mb-3">
                  {importResult.total_rows} rows processed.
                  {importResult.inserted > 0 && ' New companies are queued for enrichment.'}
                </p>
                {importResult.errors.length > 0 && (
                  <div className="bg-red-50 rounded p-3 mb-4 max-h-32 overflow-y-auto">
                    {importResult.errors.map((e, i) => (
                      <p key={i} className="text-xs text-red-600">{e}</p>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setImportResult(null); }}
                    className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded hover:bg-slate-50 transition-colors">
                    Import Another
                  </button>
                  <button onClick={closeImport}
                    className="px-4 py-2 bg-[#1E293B] text-cvc-gold text-sm font-semibold rounded hover:bg-slate-700 transition-colors">
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
