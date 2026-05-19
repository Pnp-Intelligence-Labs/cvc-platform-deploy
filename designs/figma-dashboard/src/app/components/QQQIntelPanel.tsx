/**
 * QQQIntelPanel.tsx — QQQ Market Intelligence widget for the Partners page.
 *
 * Self-contained panel that shows:
 *  • Recent news articles from Nasdaq-100 / QQQ companies
 *  • Activity type filters (venture, M&A, lawsuits, budget, partnerships)
 *  • Company search
 *  • Add / manage watch list companies
 *
 * This is embedded in the Partners page as a separate box —
 * does NOT interfere with partner management functionality.
 */

import { useState, useEffect, useCallback } from 'react';
import { Newspaper, Plus, Search, X, ChevronDown, ChevronRight, ExternalLink, Trash2, RefreshCw, TrendingUp } from 'lucide-react';
import { api } from '../api/client';
import { cls } from '../components/tokens';

// ── Activity type badge colors ───────────────────────────────────────────────
const ACTIVITY_COLORS: Record<string, string> = {
  venture:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  ma:          'bg-orange-50 text-orange-700 border-orange-200',
  lawsuit:     'bg-red-50 text-red-700 border-red-200',
  budget:      'bg-blue-50 text-blue-700 border-blue-200',
  partnership: 'bg-purple-50 text-purple-700 border-purple-200',
  general:     'bg-amber-50 text-amber-700 border-amber-200',
};

const ACTIVITY_LABELS: Record<string, string> = {
  venture:     '🚀 Venture',
  ma:          '🤝 M&A',
  lawsuit:     '⚖️ Lawsuit',
  budget:      '💰 Budget',
  partnership: '🔗 Partnership',
  general:     '📰 General',
};

const ACTIVITY_FILTERS = ['all', 'venture', 'ma', 'lawsuit', 'budget', 'partnership'] as const;

interface NewsArticle {
  id: number;
  link: string;
  company_name: string;
  title: string;
  published_at: string;
  activity_type: string | null;
  formatted_date: string | null;
}

interface WatchCompany {
  id: number;
  company_name: string;
  ticker: string | null;
  active: boolean;
}

export default function QQQIntelPanel() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [stats, setStats] = useState<{ total_articles: number; companies_tracked: number; watch_list_size: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [showWatchList, setShowWatchList] = useState(false);
  const [watchCompanies, setWatchCompanies] = useState<WatchCompany[]>([]);
  const [addName, setAddName] = useState('');
  const [addTicker, setAddTicker] = useState('');
  const [addingCompany, setAddingCompany] = useState(false);
  const [fetching, setFetching] = useState(false);

  const loadNews = useCallback(async () => {
    try {
      const data = await api.getRecentNews(100);
      setArticles(data.articles ?? []);
      setStats(data.stats ?? null);
    } catch {
      // silent — panel is supplementary
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWatchList = useCallback(async () => {
    try {
      const data = await api.listWatchCompanies();
      setWatchCompanies(data ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadNews(); }, [loadNews]);

  // Filter articles
  const filtered = articles.filter(a => {
    if (filter !== 'all' && (a.activity_type || 'general') !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return a.title.toLowerCase().includes(q) || a.company_name.toLowerCase().includes(q);
    }
    return true;
  });

  async function handleAddCompany() {
    if (!addName.trim()) return;
    try {
      setAddingCompany(true);
      await api.addWatchCompany(addName.trim(), addTicker.trim() || undefined);
      setAddName('');
      setAddTicker('');
      loadWatchList();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add company');
    } finally {
      setAddingCompany(false);
    }
  }

  async function handleRemoveCompany(id: number) {
    try {
      await api.removeWatchCompany(id);
      setWatchCompanies(prev => prev.filter(c => c.id !== id));
    } catch { /* silent */ }
  }

  async function handleTriggerFetch() {
    try {
      setFetching(true);
      await api.triggerNewsFetch();
      setTimeout(() => {
        loadNews();
        setFetching(false);
      }, 3000);
    } catch {
      setFetching(false);
    }
  }

  function formatDate(dateStr: string): string {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-cvc overflow-hidden">
      {/* Header */}
      <div
        className="px-5 py-4 border-b border-slate-200 cursor-pointer select-none hover:bg-linen/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {expanded ? <ChevronDown className="w-4 h-4 text-[#787569]" /> : <ChevronRight className="w-4 h-4 text-[#787569]" />}
            <TrendingUp className="w-4 h-4 text-[#F59E0B]" />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#787569] font-bold">QQQ Market Intelligence</p>
              <p className="text-xs text-[#545249] mt-0.5">
                Venture, Corporate VC, M&A, Lawsuits & Budget signals from Nasdaq-100 companies
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stats && (
              <span className="font-mono text-[10px] text-[#787569] bg-[#F8FAFC] border border-slate-200 rounded-full px-2.5 py-0.5">
                {stats.total_articles.toLocaleString()} articles · {stats.companies_tracked} companies
              </span>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div>
          {/* Controls */}
          <div className="px-5 py-3 border-b border-slate-100 bg-[#F8FAFC]/50">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Activity type pills */}
              {ACTIVITY_FILTERS.map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border ${
                    filter === f
                      ? 'bg-[#1E293B] text-[#F59E0B] border-[#1E293B]'
                      : 'bg-white text-[#545249] border-slate-200 hover:border-[#1E293B]'
                  }`}
                >
                  {f === 'all' ? 'All' : ACTIVITY_LABELS[f] ?? f}
                </button>
              ))}

              {/* Search */}
              <div className="relative ml-auto">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#787569]" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-[#1E293B] w-[180px]"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#787569]">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Watch list toggle */}
              <button
                onClick={() => { setShowWatchList(!showWatchList); if (!showWatchList) loadWatchList(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:border-[#1E293B] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {showWatchList ? 'Hide' : 'Manage'} Companies
              </button>

              {/* Refresh */}
              <button
                onClick={handleTriggerFetch}
                disabled={fetching}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:border-[#1E293B] transition-colors disabled:opacity-50"
                title="Trigger news fetch"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${fetching ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Watch list management panel (collapsible) */}
          {showWatchList && (
            <div className="px-5 py-4 border-b border-slate-200 bg-[#FFFBEB]/30">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#787569] font-bold mb-3">
                Watch List — {watchCompanies.length} companies
              </p>

              {/* Add company form */}
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="text"
                  placeholder="Company name..."
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddCompany(); }}
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#1E293B]"
                />
                <input
                  type="text"
                  placeholder="Ticker (opt)"
                  value={addTicker}
                  onChange={e => setAddTicker(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddCompany(); }}
                  className="w-24 px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#1E293B] font-mono"
                />
                <button
                  onClick={handleAddCompany}
                  disabled={!addName.trim() || addingCompany}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#1E293B] text-white text-xs font-semibold rounded-lg hover:bg-[#151411] disabled:opacity-40 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>

              {/* Company list (compact scrollable) */}
              <div className="max-h-[200px] overflow-y-auto">
                <div className="flex flex-wrap gap-1.5">
                  {watchCompanies.map(c => (
                    <span key={c.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-full text-xs group hover:border-red-300 transition-colors">
                      {c.ticker && <span className="font-mono text-[10px] text-[#787569]">{c.ticker}</span>}
                      <span className="text-[#1E293B] font-medium">{c.company_name}</span>
                      <button
                        onClick={() => handleRemoveCompany(c.id)}
                        className="text-[#c5c0ad] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Articles list */}
          <div className="max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-[#1E293B] border-r-transparent" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-[#787569]">
                <Newspaper className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium">No articles found</p>
                <p className="text-xs mt-1">
                  {articles.length === 0
                    ? 'Run a news fetch to populate data'
                    : 'Try adjusting your filters'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filtered.slice(0, 50).map(a => {
                  const type = a.activity_type || 'general';
                  return (
                    <a
                      key={a.id}
                      href={a.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-5 py-3 hover:bg-linen/50 transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-[#1E293B] leading-snug group-hover:text-[#6366F1] transition-colors line-clamp-2">
                            {a.title}
                            <ExternalLink className="inline w-3 h-3 ml-1 opacity-0 group-hover:opacity-60 transition-opacity" />
                          </p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="font-mono text-[10px] px-2 py-0.5 bg-[#EEF2FF] text-[#6366F1] rounded font-bold tracking-wider">
                              {a.company_name}
                            </span>
                            <span className={`font-mono text-[10px] px-2 py-0.5 rounded font-bold tracking-wider border ${ACTIVITY_COLORS[type] || ACTIVITY_COLORS.general}`}>
                              {type.toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <span className="text-[11px] text-[#787569] whitespace-nowrap flex-shrink-0 mt-0.5">
                          {a.formatted_date || formatDate(a.published_at)}
                        </span>
                      </div>
                    </a>
                  );
                })}
                {filtered.length > 50 && (
                  <div className="px-5 py-3 text-center text-xs text-[#787569]">
                    Showing 50 of {filtered.length} articles
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
