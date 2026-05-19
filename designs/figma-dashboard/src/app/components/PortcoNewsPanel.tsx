/**
 * Portco News & Announcements panel — shared between PortfolioHomepage and
 * VenturesOverview. Fetches /portfolio/news independently; accepts an optional
 * portfolioCompanies list for the "Add Announcement" dropdown (if not provided,
 * it fetches /portfolio/ itself).
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Newspaper, Plus, Trash2, ExternalLink, Lock, Globe } from 'lucide-react';
import { AUTH_HEADER as AUTH } from '../api/client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PortcoCompanyMin { id: number; name: string; }

interface Announcement {
  id: number; company_id: number; company_name: string;
  title: string; body?: string; announcement_type: string;
  is_public: boolean; source_url?: string; announced_date?: string;
  added_by?: string; created_at: string; source: 'manual';
}
interface ScrapedNews {
  company_id: number; company_name: string;
  title: string; snippet?: string; source_url?: string;
  age?: string; source: 'scraped';
}

// ── Constants ────────────────────────────────────────────────────────────────

const CARD = 'bg-white border border-slate-200 rounded-xl shadow-cvc';

const ANN_TYPE_COLORS: Record<string, string> = {
  funding:     'bg-emerald-100 text-emerald-700 border-emerald-200',
  partnership: 'bg-teal-100 text-teal-700 border-teal-200',
  product:     'bg-blue-100 text-blue-700 border-blue-200',
  press:       'bg-slate-100 text-slate-600 border-slate-200',
  internal:    'bg-amber-100 text-amber-700 border-amber-200',
  general:     'bg-slate-100 text-slate-600 border-slate-200',
};

const EMPTY_ANN = {
  company_id: 0, title: '', body: '', announcement_type: 'general',
  is_public: false, source_url: '', announced_date: '',
};

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Pre-loaded company list from a parent that already has it.
   *  If omitted, the panel fetches /portfolio/ itself. */
  portfolioCompanies?: PortcoCompanyMin[];
}

export function PortcoNewsPanel({ portfolioCompanies: externalCompanies }: Props = {}) {
  const navigate = useNavigate();
  const [companies, setCompanies]       = useState<PortcoCompanyMin[]>(externalCompanies ?? []);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [scraped, setScraped]             = useState<ScrapedNews[]>([]);
  const [showAdd, setShowAdd]             = useState(false);
  const [form, setForm]                   = useState({ ...EMPTY_ANN });
  const [submitting, setSubmitting]       = useState(false);
  const [deleting, setDeleting]           = useState<number | null>(null);
  const [err, setErr]                     = useState('');

  // Sync if parent passes updated list after mount
  useEffect(() => {
    if (externalCompanies && externalCompanies.length > 0) setCompanies(externalCompanies);
  }, [externalCompanies]);

  // Self-fetch companies when none provided externally
  useEffect(() => {
    if (externalCompanies && externalCompanies.length > 0) return;
    fetch('/portfolio/', { headers: AUTH })
      .then(r => r.ok ? r.json() : [])
      .then((d: PortcoCompanyMin[]) => setCompanies(d))
      .catch(() => {});
  }, []);

  const load = () => {
    fetch('/portfolio/news', { headers: AUTH })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setAnnouncements(d.announcements || []); setScraped(d.scraped_news || []); })
      .catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async () => {
    if (!form.company_id || !form.title.trim()) { setErr('Company and title are required.'); return; }
    setSubmitting(true); setErr('');
    const res = await fetch('/portfolio/announcements', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        announced_date: form.announced_date || null,
        source_url: form.source_url || null,
        body: form.body || null,
      }),
    });
    setSubmitting(false);
    if (res.ok) { setShowAdd(false); setForm({ ...EMPTY_ANN }); load(); }
    else setErr('Failed to save.');
  };

  const handleDelete = async (id: number) => {
    setDeleting(id);
    await fetch(`/portfolio/announcements/${id}`, { method: 'DELETE', headers: AUTH });
    setDeleting(null);
    load();
  };

  return (
    <div className={`${CARD} p-5 flex flex-col`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-[#8a7200]" />
          <h3 className="text-sm font-semibold text-[#33322c]">Portco News & Announcements</h3>
          {announcements.length > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#ede8d7] text-[#33322c]">
              {announcements.length}
            </span>
          )}
        </div>
        <button
          onClick={() => { setShowAdd(v => !v); setErr(''); }}
          className="flex items-center gap-1 text-[10px] font-semibold text-[#151411] hover:text-[#33322c] border border-slate-200 rounded px-2 py-1 hover:border-[#151411] transition-colors"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="mb-4 p-4 rounded border border-[#ede8d7] bg-[#faf9f6] space-y-3">
          <p className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">New Announcement</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[#787569] block mb-1">Company *</label>
              <select
                value={form.company_id}
                onChange={e => setForm(f => ({ ...f, company_id: +e.target.value }))}
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white"
              >
                <option value={0}>— select —</option>
                {[...companies].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#787569] block mb-1">Type</label>
              <select
                value={form.announcement_type}
                onChange={e => setForm(f => ({ ...f, announcement_type: e.target.value }))}
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white"
              >
                {['general','funding','partnership','product','press','internal'].map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[#787569] block mb-1">Title *</label>
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Signed 3-year contract with Boeing"
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#787569] block mb-1">Details (optional)</label>
            <textarea
              rows={2}
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder="Additional context, deal terms, etc."
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[#787569] block mb-1">Date (optional)</label>
              <input type="date" value={form.announced_date}
                onChange={e => setForm(f => ({ ...f, announced_date: e.target.value }))}
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" />
            </div>
            <div>
              <label className="text-[10px] text-[#787569] block mb-1">Source URL (optional)</label>
              <input value={form.source_url}
                onChange={e => setForm(f => ({ ...f, source_url: e.target.value }))}
                placeholder="https://..."
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="pnp_is_public" checked={form.is_public}
              onChange={e => setForm(f => ({ ...f, is_public: e.target.checked }))}
              className="rounded" />
            <label htmlFor="pnp_is_public" className="text-xs text-[#33322c]">
              Already public (press-confirmed)
            </label>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={submitting}
              className="px-3 py-1.5 text-xs font-semibold bg-[#151411] text-white rounded hover:bg-[#33322c] disabled:opacity-50">
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setShowAdd(false); setErr(''); }}
              className="px-3 py-1.5 text-xs text-[#787569] border border-slate-200 rounded hover:border-[#151411]">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Manual announcements */}
      {announcements.length === 0 && !showAdd && (
        <p className="text-xs text-[#787569] py-4 text-center">No announcements yet — click Add to log one.</p>
      )}
      <div className={`space-y-2 ${announcements.length > 4 ? 'max-h-72 overflow-y-auto pr-1' : ''}`}>
        {announcements.map(ann => (
          <div key={ann.id} className="border border-slate-200 rounded p-3 hover:border-slate-300 transition-colors group">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <button
                    onClick={() => navigate(`/company/${ann.company_id}`)}
                    className="text-[10px] font-semibold text-[#151411] hover:underline shrink-0"
                  >
                    {ann.company_name}
                  </button>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${ANN_TYPE_COLORS[ann.announcement_type] ?? ANN_TYPE_COLORS.general}`}>
                    {ann.announcement_type}
                  </span>
                  {ann.is_public
                    ? <span className="flex items-center gap-0.5 text-[9px] text-slate-500"><Globe className="w-2.5 h-2.5" /> Public</span>
                    : <span className="flex items-center gap-0.5 text-[9px] font-bold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded"><Lock className="w-2.5 h-2.5" /> Stealth</span>
                  }
                </div>
                <p className="text-xs font-semibold text-[#33322c] leading-snug">{ann.title}</p>
                {ann.body && <p className="text-[11px] text-[#787569] mt-0.5 line-clamp-2">{ann.body}</p>}
                <div className="flex items-center gap-2 mt-1">
                  {ann.announced_date && (
                    <span className="text-[10px] text-[#787569]">
                      {new Date(ann.announced_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                  {ann.source_url && (
                    <a href={ann.source_url} target="_blank" rel="noreferrer"
                      className="flex items-center gap-0.5 text-[10px] text-blue-600 hover:underline">
                      <ExternalLink className="w-2.5 h-2.5" /> Source
                    </a>
                  )}
                  {ann.added_by && <span className="text-[10px] text-[#787569]">by {ann.added_by}</span>}
                </div>
              </div>
              <button
                onClick={() => handleDelete(ann.id)}
                disabled={deleting === ann.id}
                className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Scraped news */}
      {scraped.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide whitespace-nowrap">
              From the Web · {scraped.length} articles
            </span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {scraped.map((item, i) => (
              <div key={i} className="border border-slate-100 rounded p-2.5 bg-[#fafafa] hover:bg-[#f1f5f9] transition-colors">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <button
                        onClick={() => navigate(`/company/${item.company_id}`)}
                        className="text-[10px] font-semibold text-[#151411] hover:underline shrink-0"
                      >
                        {item.company_name}
                      </button>
                      {item.age && <span className="text-[9px] text-[#787569]">{item.age}</span>}
                    </div>
                    {item.source_url
                      ? <a href={item.source_url} target="_blank" rel="noreferrer"
                          className="text-xs font-medium text-blue-700 hover:underline leading-snug line-clamp-2 block">
                          {item.title}
                        </a>
                      : <p className="text-xs font-medium text-[#33322c] leading-snug line-clamp-2">{item.title}</p>
                    }
                    {item.snippet && <p className="text-[11px] text-[#787569] mt-0.5 line-clamp-2">{item.snippet}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
