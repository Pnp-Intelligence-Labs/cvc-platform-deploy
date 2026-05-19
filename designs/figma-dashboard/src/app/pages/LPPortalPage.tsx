/**
 * LP Portal — Fund I overview for GPs and Directors.
 * Route: /lp  (added by plugin nav injection)
 *
 * Sections:
 *   1. Fund header — committed, deployed, NAV, TVPI, IRR, DPI
 *   2. Deployment breakdown — capital allocation bar
 *   3. Portfolio by vintage year — collapsible accordion
 *   4. NAV History chart — TVPI line over time (recharts)
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  BadgeDollarSign, ChevronRight, ChevronDown, TrendingUp,
  Building2, BarChart2,
} from 'lucide-react';
import CVCNavbar from '../components/CVCNavbar';
import { AUTH_HEADER as AUTH } from '../api/client';
import { cls } from '../components/tokens';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// ── Types ────────────────────────────────────────────────────────────────────

interface FundOverview {
  name: string;
  size_musd: number;
  deployed_musd: number;
  nav_musd: number;
  net_irr_pct: number | null;
  net_tvpi: number;
  dpi: number;
  deployment_pct: number;
  portfolio_companies: number;
  initial_investments_usd: number | null;
  followon_investments_usd: number | null;
  remaining_reserves_usd: number | null;
  fund_size_usd: number | null;
  investable_capital_usd: number | null;
  deployed_capital_usd: number | null;
}

interface SectorCount { name: string; company_count: number }

interface Investment {
  id: number;
  name: string;
  sector: string | null;
  stage: string | null;
  location: string | null;
  check_size_usd: number | null;
  fmv_usd: number | null;
  moic: number | null;
  close_date: string;
  round_type: string | null;
  investment_type: string | null;
  is_lead_investor: boolean;
  is_written_off: boolean;
  co_investors: string[];
  followons: { date: string; amount_usd: number; followon_type: string }[];
}

interface AnnualReport {
  year: number;
  investments: Investment[];
  year_deployed: number;
  year_fmv: number;
  year_moic: number | null;
  year_company_count: number;
  cumulative_deployed: number;
  cumulative_count: number;
}

interface NavPoint { date: string; fmv: number; invested: number; tvpi: number | null }

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtM(usd: number | null | undefined): string {
  if (usd == null) return '—';
  return `$${(usd / 1_000_000).toFixed(1)}M`;
}

function fmtUSD(usd: number | null | undefined): string {
  if (usd == null) return '—';
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}

function fmtX(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(2)}x`;
}

// ── Stat Tile ─────────────────────────────────────────────────────────────────

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">{label}</p>
      <p className="text-2xl font-extrabold text-[#33322c] tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-[#787569] mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Investment Row ─────────────────────────────────────────────────────────────

function InvestmentRow({ inv }: { inv: Investment }) {
  const [open, setOpen] = useState(false);
  const hasFollowons = inv.followons.length > 0;

  return (
    <div className={`border-b border-slate-100 last:border-0 ${inv.is_written_off ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-[#ede8d7]/40 transition-colors">
        <Link to={`/company/${inv.id}`}
          className="font-semibold text-sm text-[#33322c] hover:underline flex-1 min-w-0 truncate">
          {inv.name}
          {inv.is_written_off && <span className="ml-1.5 text-[9px] text-red-400 font-normal">written off</span>}
        </Link>
        <span className="text-[10px] text-[#787569] shrink-0 w-24 text-right">{inv.sector ?? '—'}</span>
        <span className="text-[10px] text-[#787569] shrink-0 w-20 text-right">{fmtUSD(inv.check_size_usd)}</span>
        <span className="text-[10px] font-semibold text-[#33322c] shrink-0 w-20 text-right tabular-nums">{fmtUSD(inv.fmv_usd)}</span>
        <span className={`text-[10px] font-bold shrink-0 w-12 text-right tabular-nums ${
          inv.moic != null && inv.moic >= 1.5 ? 'text-emerald-600' : inv.moic != null && inv.moic < 1 ? 'text-red-400' : 'text-[#787569]'
        }`}>{fmtX(inv.moic)}</span>
        {hasFollowons && (
          <button onClick={() => setOpen(o => !o)}
            className="shrink-0 p-0.5 rounded text-[#787569] hover:text-[#33322c] transition-colors">
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
          </button>
        )}
        {!hasFollowons && <span className="w-4 shrink-0" />}
      </div>
      {open && hasFollowons && (
        <div className="bg-slate-50 border-t border-slate-100 px-8 py-2 space-y-1">
          {inv.followons.map((fo, i) => (
            <div key={i} className="flex items-center gap-4 text-xs text-[#787569]">
              <span className="font-medium text-[#33322c]">Follow-on</span>
              <span>{fo.date}</span>
              <span className="font-semibold text-[#33322c]">{fmtUSD(fo.amount_usd)}</span>
              <span className="text-[10px]">{fo.followon_type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Vintage Year Accordion ─────────────────────────────────────────────────────

function VintageYear({ report, defaultOpen }: { report: AnnualReport; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#ede8d7] transition-colors">
        <div className="flex items-center gap-3">
          <span className="font-bold text-[#33322c]">{report.year}</span>
          <span className="text-xs text-[#787569]">{report.year_company_count} investment{report.year_company_count !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-6 text-xs text-[#787569]">
          <span>Deployed: <span className="font-semibold text-[#33322c]">{fmtUSD(report.year_deployed)}</span></span>
          <span>FMV: <span className="font-semibold text-[#33322c]">{fmtUSD(report.year_fmv)}</span></span>
          {report.year_moic != null && (
            <span>MOIC: <span className={`font-bold ${report.year_moic >= 1.5 ? 'text-emerald-600' : 'text-[#33322c]'}`}>{fmtX(report.year_moic)}</span></span>
          )}
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-200">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 border-b border-slate-100">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#787569] flex-1">Company</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#787569] w-24 text-right">Sector</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#787569] w-20 text-right">Check</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#787569] w-20 text-right">FMV</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#787569] w-12 text-right">MOIC</span>
            <span className="w-4" />
          </div>
          {report.investments.map(inv => (
            <InvestmentRow key={inv.id} inv={inv} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── NAV History Chart ─────────────────────────────────────────────────────────

function NavHistoryChart({ history }: { history: NavPoint[] }) {
  if (history.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded p-6 text-center text-[#787569] text-sm">
        No NAV history data yet. Add entries to <code className="text-xs bg-[#ede8d7] px-1 rounded">cvc.fund_nav_history</code>.
      </div>
    );
  }

  const data = history.map(h => ({
    date: h.date.slice(0, 7), // YYYY-MM
    FMV: +(h.fmv / 1_000_000).toFixed(2),
    Invested: +(h.invested / 1_000_000).toFixed(2),
    TVPI: h.tvpi,
  }));

  return (
    <div className="bg-white border border-slate-200 rounded p-5">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-[#8a7200]" />
        <span className="font-semibold text-[#33322c] text-sm">NAV History</span>
        <span className="text-xs text-[#787569] ml-1">FMV vs. invested capital ($M)</span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
            tickFormatter={v => `$${v}M`} width={48} />
          <Tooltip
            formatter={(v: number, name: string) => [`$${v}M`, name]}
            contentStyle={{ fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff' }}
          />
          <Line type="monotone" dataKey="FMV"      stroke="#10b981" strokeWidth={2} dot={false} name="FMV" />
          <Line type="monotone" dataKey="Invested" stroke="#94a3b8" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Invested" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LPPortalPage() {
  const [overview, setOverview]   = useState<{ fund: FundOverview; sectors: SectorCount[] } | null>(null);
  const [reports, setReports]     = useState<AnnualReport[]>([]);
  const [navHistory, setNavHistory] = useState<NavPoint[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/lp/overview',       { headers: AUTH }).then(r => { if (!r.ok) throw new Error('overview'); return r.json(); }),
      fetch('/lp/annual-reports', { headers: AUTH }).then(r => { if (!r.ok) throw new Error('reports'); return r.json(); }),
      fetch('/lp/nav-history',    { headers: AUTH }).then(r => r.ok ? r.json() : { history: [] }),
    ])
      .then(([ov, reps, nav]) => {
        setOverview(ov);
        setReports(reps.reports ?? []);
        setNavHistory(nav.history ?? []);
      })
      .catch(e => {
        if (e.message === 'overview') setError('Could not load LP portal data — check your role permissions.');
        else setError('Failed to load LP portal data.');
      })
      .finally(() => setLoading(false));
  }, []);

  const fund = overview?.fund;

  return (
    <div className={cls.page}>
      <CVCNavbar />

      <div className="max-w-[1200px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="border-b-2 border-[#33322c] pb-5 mb-8">
          <div className="flex items-center gap-2 mb-1">
            <BadgeDollarSign className="w-4 h-4 text-[#8a7200]" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">LP Portal · Fund Overview</p>
          </div>
          <h1 className={cls.pageTitle}>{fund?.name ?? 'LP Portal'}</h1>
        </div>

        {loading && <div className="flex items-center justify-center h-64 text-[#787569]">Loading…</div>}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded px-5 py-4 text-sm">{error}</div>
        )}

        {fund && (
          <>
            {/* ── Fund Metrics ── */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
              <StatTile label="Fund Size"   value={fmtM(fund.size_musd * 1_000_000)} />
              <StatTile label="Deployed"    value={fmtM(fund.deployed_musd * 1_000_000)} sub={`${fmtPct(fund.deployment_pct)} deployed`} />
              <StatTile label="NAV"         value={fmtM(fund.nav_musd * 1_000_000)} />
              <StatTile label="Net TVPI"    value={fmtX(fund.net_tvpi)} />
              <StatTile label="Net IRR"     value={fmtPct(fund.net_irr_pct)} />
              <StatTile label="DPI"         value={fmtX(fund.dpi)} sub={`${fund.portfolio_companies} companies`} />
            </div>

            {/* ── Capital Allocation Bar ── */}
            {(fund.initial_investments_usd || fund.followon_investments_usd || fund.remaining_reserves_usd) && (
              <div className="bg-white border border-slate-200 rounded p-5 mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart2 className="w-4 h-4 text-[#8a7200]" />
                  <span className="font-semibold text-[#33322c] text-sm">Capital Allocation</span>
                </div>
                <div className="space-y-2">
                  {[
                    { label: 'Initial Investments', value: fund.initial_investments_usd,   color: '#10b981' },
                    { label: 'Follow-on Investments', value: fund.followon_investments_usd, color: '#6366f1' },
                    { label: 'Remaining Reserves',  value: fund.remaining_reserves_usd,    color: '#f59e0b' },
                  ].filter(row => row.value != null).map(row => {
                    const total = (fund.initial_investments_usd ?? 0) + (fund.followon_investments_usd ?? 0) + (fund.remaining_reserves_usd ?? 0);
                    const pct = total > 0 ? ((row.value! / total) * 100) : 0;
                    return (
                      <div key={row.label} className="flex items-center gap-3">
                        <span className="text-xs text-[#787569] w-40 shrink-0">{row.label}</span>
                        <div className="flex-1 h-2 bg-[#ede8d7] rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: row.color }} />
                        </div>
                        <span className="text-xs font-semibold text-[#33322c] w-20 text-right shrink-0 tabular-nums">
                          {fmtM(row.value)}
                        </span>
                        <span className="text-[10px] text-[#787569] w-10 text-right shrink-0">{pct.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Sector Breakdown ── */}
            {(overview?.sectors ?? []).length > 0 && (
              <div className="bg-white border border-slate-200 rounded p-5 mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <Building2 className="w-4 h-4 text-[#8a7200]" />
                  <span className="font-semibold text-[#33322c] text-sm">Portfolio by Sector</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(overview?.sectors ?? []).map(s => (
                    <div key={s.name} className="flex items-center gap-2 bg-[#ede8d7] rounded px-3 py-1.5">
                      <span className="text-sm font-semibold text-[#33322c]">{s.company_count}</span>
                      <span className="text-xs text-[#787569]">{s.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── NAV History Chart ── */}
            <div className="mb-8">
              <NavHistoryChart history={navHistory} />
            </div>

            {/* ── Portfolio by Vintage Year ── */}
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-sm font-bold text-[#33322c]">Portfolio by Vintage Year</h2>
              <span className="text-xs text-[#787569]">{reports.reduce((n, r) => n + r.year_company_count, 0)} investments</span>
            </div>
            <div className="space-y-3">
              {reports.map((r, i) => (
                <VintageYear key={r.year} report={r} defaultOpen={i === 0} />
              ))}
              {reports.length === 0 && !loading && (
                <div className="bg-white border border-slate-200 rounded px-5 py-8 text-center text-[#787569] text-sm">
                  No portfolio investments found for {fund.name}. Import via the CSV tool or add term sheets manually.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
