import { TrendingUp, Building2, Clock, HandshakeIcon, MapPin, Download, DollarSign, Target, PieChart as PieChartIcon, X, Search, ChevronRight } from 'lucide-react';
import { PortcoNewsPanel } from '../components/PortcoNewsPanel';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from 'recharts';
import { api } from '../api/client';
import { AUTH_HEADER as AUTH } from '../api/client';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router';
import { cls } from '../components/tokens';


// ── Design tokens ─────────────────────────────────────────────────────────────
const CARD     = 'bg-white border border-slate-200 rounded-xl shadow-cvc';
const CARD_HI  = 'bg-white border border-cvc-slate rounded-xl shadow-cvc';
const CARD_HOV = 'hover:border-cvc-slate hover:shadow-cvc-hover';

// ── Color maps — Industrial Neon palette ──────────────────────────────────────
const SECTOR_COLORS: Record<string, string> = {
  'Supply Chain':          '#6366f1',  // indigo
  'Robotics':              '#ec4899',  // pink
  'Logistics':             '#10b981',  // emerald
  'AI/ML':                 '#f97316',  // orange
  'Manufacturing':         '#06b6d4',  // cyan
  'Energy':                '#3b82f6',  // blue
  'Health':                '#8b5cf6',  // violet
  'Fintech':               '#06b6d4',  // cyan
  'Aerospace & Defense':   '#64748b',  // slate
  'Industrial Automation': '#f59e0b',  // amber
  'Physical AI':           '#8b5cf6',  // violet
  'Unclassified':          '#94a3b8',  // slate-400
};
const FALLBACK_COLORS = ['#6366f1','#ec4899','#06b6d4','#f59e0b','#8b5cf6','#10b981','#f97316','#3b82f6','#64748b','#94a3b8'];

interface PortfolioCompany {
  id: number; name: string; sector?: string; stage?: string; location?: string;
  raised?: string; one_liner?: string; intro_count: number;
  intro_partners: string[]; last_intro_date?: string;
  latest_investment_date?: string; score?: number;
  fund?: string | null;
}
interface Stats {
  total_companies: number; total_raised_usd: number; avg_founded_year?: number;
  sector_distribution: { sector: string; count: number }[];
  stage_distribution: { stage: string; count: number }[];
  top_by_intros: PortfolioCompany[]; recent_introductions: PortfolioCompany[];
  cvc_deployed_capital?: number | null;
  cvc_committed_capital?: number | null;
  cvc_nav?: number | null;
  cvc_tvpi?: number | null;
  total_deployed_usd?: number | null;
  fund_i_deployed_usd?: number | null;
  family_office_deployed_usd?: number | null;
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KPICard({ title, value, subtitle, icon: Icon, color = '#151411' }: any) {
  return (
    <div className={`${CARD} rounded p-4 ${CARD_HOV} transition-all group relative overflow-hidden`}>
      <div className="absolute inset-x-0 top-0 h-[2px] rounded-t opacity-70" style={{ background: color }} />
      <div className="flex items-start justify-between mb-3">
        <div className="p-1.5 rounded-lg" style={{ background: color + '18' }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <div className="space-y-0.5">
        <h3 className="text-3xl font-bold text-[#33322c] tracking-tight">{value}</h3>
        <p className="text-xs text-[#33322c]">{title}</p>
        {subtitle && <p className="text-[10px] text-[#787569] pt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Company Row ───────────────────────────────────────────────────────────────
function CompanyRow({ company, onClick, movement, flash }: {
  company: PortfolioCompany; onClick: () => void;
  movement?: 'up' | 'down'; flash?: boolean;
}) {
  const stageLabel = company.stage
    ? company.stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Unknown';
  return (
    <div onClick={onClick}
      className="flex items-center justify-between px-3 py-2 rounded border border-slate-200 hover:border-[#151411] hover:shadow-sm transition-all cursor-pointer">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#33322c] truncate">{company.name}</p>
        <p className="text-[10px] text-[#787569]">{company.sector || 'Unclassified'} · {stageLabel}</p>
      </div>
      <div className="flex items-center gap-2 ml-3 shrink-0">
        {company.intro_count > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#ede8d7', color: '#151411' }}>
            {movement && flash && (
              <span className={`animate-bounce ${movement === 'up' ? 'text-green-500' : 'text-amber-500'}`}>
                {movement === 'up' ? '↑' : '↓'}
              </span>
            )}
            {company.intro_count} intro{company.intro_count !== 1 ? 's' : ''}
          </span>
        )}
        {company.raised && <span className="text-xs font-bold text-[#151411]">{company.raised}</span>}
      </div>
    </div>
  );
}

// ── Tooltip style for light charts ────────────────────────────────────────────
const lightTooltip = {
  contentStyle: { background: '#FFFFFF', border: '1px solid #e2e8f0', borderRadius: '4px', color: '#33322c', fontSize: 12 },
  labelStyle: { color: '#33322c' },
};

// ── LP Tab ────────────────────────────────────────────────────────────────────
const LP_SECTOR_COLORS: Record<string, string> = {
  'Manufacturing':         '#06b6d4',
  'Energy':                '#3b82f6',
  'Supply Chain':          '#6366f1',
  'Robotics':              '#ec4899',
  'Industrial Automation': '#f59e0b',
  'Physical AI':           '#8b5cf6',
  'Unclassified':          '#787569',
};

function fmtUSD(n?: number | null): string {
  if (n == null) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function fmtM(n?: number | null): string {
  if (n == null) return '—';
  return '$' + (n / 1_000_000).toFixed(2) + 'M';
}
function moicColor(m?: number | null): string {
  if (m == null) return 'text-[#787569]';
  if (m >= 2.0) return 'text-emerald-600 font-bold';
  if (m >= 1.5) return 'text-amber-600 font-semibold';
  if (m >= 1.0) return 'text-[#33322c]';
  return 'text-red-500';
}
function moicBg(m?: number | null): string {
  if (m == null) return 'bg-slate-100 text-[#787569]';
  if (m >= 2.0) return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  if (m >= 1.5) return 'bg-amber-50 text-amber-700 border border-amber-200';
  if (m >= 1.0) return 'bg-slate-100 text-[#33322c] border border-slate-200';
  return 'bg-red-50 text-red-600 border border-red-200';
}
function formatDate(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

interface AnnualReport {
  year: number;
  investments: any[];
  year_deployed: number;
  year_fmv: number;
  year_moic: number | null;
  year_company_count: number;
  cumulative_deployed: number;
  cumulative_count: number;
  sector_breakdown: Record<string, number>;
}

function AnnualReportSection({ report, defaultOpen }: { report: AnnualReport; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasAllFmv = report.investments.every(i => i.fmv_usd != null);

  return (
    <div className={`${CARD} rounded overflow-hidden mb-3`}>
      {/* Year header — always visible */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#fafaf8] transition-colors text-left"
      >
        <div className="flex items-center gap-4">
          <span className="text-lg font-extrabold text-[#151411] tracking-tight">{report.year}</span>
          <span className="text-[10px] font-bold text-[#787569] uppercase tracking-widest border border-slate-200 rounded px-2 py-0.5">
            {report.year_company_count} investment{report.year_company_count !== 1 ? 's' : ''}
          </span>
          {report.year_moic != null && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${moicBg(report.year_moic)}`}>
              {report.year_moic}x vintage MOIC
            </span>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold text-[#33322c]">{fmtUSD(report.year_deployed)}</p>
            <p className="text-[10px] text-[#787569]">deployed this year</p>
          </div>
          <div className="text-right hidden md:block">
            <p className="text-xs font-bold text-[#33322c]">{fmtUSD(report.cumulative_deployed)}</p>
            <p className="text-[10px] text-[#787569]">{report.cumulative_count} cos cumulative</p>
          </div>
          <ChevronRight className={`w-4 h-4 text-[#787569] transition-transform ${open ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100">
          {/* Sector pills */}
          {Object.keys(report.sector_breakdown).length > 0 && (
            <div className="px-5 pt-3 pb-2 flex flex-wrap gap-1.5">
              {Object.entries(report.sector_breakdown).map(([s, n]) => (
                <span key={s} className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: (LP_SECTOR_COLORS[s] ?? '#787569') + '18', color: LP_SECTOR_COLORS[s] ?? '#787569' }}>
                  {s} ({n})
                </span>
              ))}
            </div>
          )}

          {/* Investment table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#f8fafc] border-y border-slate-100">
                  <th className="text-left px-5 py-2 text-[10px] font-bold text-[#787569] uppercase tracking-wide">Company</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold text-[#787569] uppercase tracking-wide">Sector</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold text-[#787569] uppercase tracking-wide">Type</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold text-[#787569] uppercase tracking-wide">Check Size</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold text-[#787569] uppercase tracking-wide hidden xl:table-cell">Pre-Money</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold text-[#787569] uppercase tracking-wide hidden xl:table-cell">Round Size</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold text-[#787569] uppercase tracking-wide">Current FMV</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold text-[#787569] uppercase tracking-wide">MOIC</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold text-[#787569] uppercase tracking-wide">Close</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold text-[#787569] uppercase tracking-wide hidden lg:table-cell">Lead / Co-Investors</th>
                </tr>
              </thead>
              <tbody>
                {report.investments.map((inv: any) => (
                  <>
                    <tr key={inv.id} className={`border-b border-slate-50 hover:bg-[#fafaf8] transition-colors ${inv.is_written_off ? 'opacity-70' : ''}`}>
                      <td className="px-5 py-2.5 font-semibold text-[#33322c]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{inv.name}</span>
                          {inv.is_written_off && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600 border border-red-200 uppercase tracking-wide">Write-Off</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[#787569]">{inv.sector || '—'}</span>
                          {inv.category_2 && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#ede8d7] text-[#33322c]">{inv.category_2}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {inv.investment_type
                          ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#ede8d7] text-[#33322c]">
                              {inv.investment_type === 'convertible_note' ? 'Conv. Note' : inv.investment_type?.toUpperCase()}
                            </span>
                          : <span className="text-[#ACACAA]">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[#33322c]">
                        {fmtUSD(inv.check_size_usd)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[#787569] hidden xl:table-cell">
                        {fmtUSD(inv.pre_money_valuation_usd)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[#787569] hidden xl:table-cell">
                        {fmtUSD(inv.round_size_usd)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono ${inv.is_written_off ? 'text-red-500' : 'text-[#33322c]'}`}>
                        {inv.is_written_off ? '$0' : fmtUSD(inv.fmv_usd)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {inv.is_written_off
                          ? <span className="text-xs font-bold text-red-500">0.00x</span>
                          : inv.moic != null
                            ? <span className={`text-xs font-bold ${moicColor(inv.moic)}`}>{inv.moic}x</span>
                            : <span className="text-[#ACACAA]">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[#787569] whitespace-nowrap">
                        {formatDate(inv.close_date)}
                      </td>
                      <td className="px-3 py-2.5 hidden lg:table-cell">
                        <div className="space-y-0.5">
                          {inv.is_lead_investor
                            ? <span className="text-[10px] font-bold text-emerald-600">SLAM Lead</span>
                            : inv.lead_investor
                              ? <span className="text-[10px] text-[#787569]">{inv.lead_investor}</span>
                              : <span className="text-[10px] text-[#ACACAA]">—</span>}
                          {inv.co_investors && inv.co_investors.length > 0 && (
                            <p className="text-[9px] text-[#ACACAA] leading-tight">
                              +{inv.co_investors.join(', ')}
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Follow-on sub-rows */}
                    {(inv.followons || []).map((fo: any, fi: number) => (
                      <tr key={`${inv.id}-fo-${fi}`} className="border-b border-slate-50 bg-[#f8fafc]">
                        <td className="px-5 py-1.5 text-[#787569]">
                          <span className="pl-4 text-[10px] font-semibold">↳ {fo.followon_type === 'pro_rata' ? 'Pro Rata' : 'Follow-On'}</span>
                        </td>
                        <td className="px-3 py-1.5 text-[10px] text-[#ACACAA]" colSpan={2}>{fo.notes || ''}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-[10px] text-[#787569]">{fmtUSD(fo.amount_usd)}</td>
                        <td className="px-3 py-1.5 hidden xl:table-cell" />
                        <td className="px-3 py-1.5 hidden xl:table-cell" />
                        <td className="px-3 py-1.5 text-right text-[10px] text-[#ACACAA]">—</td>
                        <td className="px-3 py-1.5 text-right text-[10px] text-[#ACACAA]">—</td>
                        <td className="px-3 py-1.5 text-right text-[10px] text-[#787569] whitespace-nowrap">{formatDate(fo.date)}</td>
                        <td className="px-3 py-1.5 hidden lg:table-cell" />
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Year summary footer */}
          <div className="px-5 py-3 bg-[#f8fafc] border-t border-slate-100 flex flex-wrap gap-6 text-xs">
            <div>
              <span className="text-[#787569]">Year Deployed</span>
              <span className="ml-2 font-bold text-[#33322c]">{fmtUSD(report.year_deployed)}</span>
            </div>
            {report.year_fmv > 0 && (
              <div>
                <span className="text-[#787569]">Current FMV</span>
                <span className="ml-2 font-bold text-[#33322c]">{fmtUSD(report.year_fmv)}</span>
              </div>
            )}
            {report.year_moic != null && (
              <div>
                <span className="text-[#787569]">Vintage MOIC</span>
                <span className={`ml-2 font-bold ${moicColor(report.year_moic)}`}>{report.year_moic}x</span>
              </div>
            )}
            {!hasAllFmv && (
              <div className="text-[#ACACAA] text-[10px] self-center">* FMV as of latest valuation · some positions pending</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LPTab() {
  const [fund, setFund] = useState<any>(null);
  const [sectorAlloc, setSectorAlloc] = useState<any[]>([]);
  const [reports, setReports] = useState<AnnualReport[]>([]);
  const [navHistory, setNavHistory] = useState<{ q: string; v: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [lpData, rptData, navData] = await Promise.all([
          api.getLPPortal(),
          fetch('/lp/annual-reports', { headers: AUTH }).then(r => r.json()),
          fetch('/lp/nav-history', { headers: AUTH }).then(r => r.json()),
        ]);

        const totalCos = (lpData.sectors || []).reduce((s: number, x: any) => s + (x.company_count || 0), 0);
        setSectorAlloc(
          totalCos > 0
            ? (lpData.sectors || []).map((s: any) => ({
                name: s.name,
                value: Math.round(((s.company_count || 0) / totalCos) * 100),
                color: LP_SECTOR_COLORS[s.name] ?? '#787569',
              }))
            : []
        );
        setFund(lpData.fund);
        setReports(rptData.reports || []);

        // Build quarterly TVPI snapshots (last entry per quarter: Mar, Jun, Sep, Dec)
        const quarterMonths = new Set([2, 5, 8, 11]); // 0-indexed
        const quarterSnaps: { q: string; v: number }[] = [];
        const history: any[] = navData.history || [];
        // Group by quarter label, keep last entry
        const quarterMap: Record<string, number> = {};
        for (const row of history) {
          const dt = new Date(row.date);
          const month = dt.getMonth(); // 0-indexed
          if (!quarterMonths.has(month)) continue;
          const qNum = Math.floor(month / 3) + 1;
          const label = `Q${qNum} ${dt.getFullYear()}`;
          quarterMap[label] = row.tvpi ?? 1.0;
        }
        for (const [q, v] of Object.entries(quarterMap)) {
          quarterSnaps.push({ q, v: Math.round(v * 100) / 100 });
        }
        // Sort chronologically
        quarterSnaps.sort((a, b) => {
          const [aq, ay] = a.q.split(' ');
          const [bq, by_] = b.q.split(' ');
          return Number(ay) !== Number(by_) ? Number(ay) - Number(by_) : Number(aq[1]) - Number(bq[1]);
        });
        setNavHistory(quarterSnaps);
      } catch (e: any) { setError(e.message || 'Failed to load LP data'); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-10 w-10 border-2 border-[#151411] border-r-transparent" /></div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded p-6 text-red-600 text-sm">{error}</div>;
  if (!fund) return null;

  const deploymentPct = fund.deployment_pct ?? 0;

  return (
    <>
      {/* Fund Structure */}
      <div className={`${CARD} rounded p-5 mb-6`}>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1.5 h-1.5 rounded-full bg-[#151411]" />
          <span className="text-[10px] font-bold text-[#151411] uppercase tracking-widest">Fund I — Structure</span>
          <span className="text-[10px] text-[#787569] ml-1">Vintage {fund.vintage_year} · Closed</span>
        </div>
        <div className="grid grid-cols-3 gap-0 divide-x divide-slate-200">
          {[
            { label: 'Gross Fund Size',         value: fmtUSD(fund.fund_size_usd),           sub: 'LP commitments' },
            { label: 'Management Fees',          value: fund.management_fees_usd ? `(${fmtUSD(fund.management_fees_usd)})` : '—', sub: 'Reserved for operations' },
            { label: 'Investable Capital',       value: fmtUSD(fund.investable_capital_usd),  sub: 'Available to deploy' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="px-5 first:pl-0 last:pr-0 text-center">
              <p className="text-[10px] font-bold text-[#787569] uppercase tracking-wide mb-1">{label}</p>
              <p className="text-xl font-extrabold text-[#33322c] tracking-tight">{value}</p>
              <p className="text-[10px] text-[#787569] mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
        {/* Deployment progress bar */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold text-[#787569] uppercase tracking-wide">Deployment Progress</span>
            <span className="text-xs font-bold text-[#33322c]">{fmtUSD(fund.deployed_capital_usd)} of {fmtUSD(fund.investable_capital_usd)} · {deploymentPct}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-[#151411] rounded-full transition-all" style={{ width: `${Math.min(deploymentPct, 100)}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-[#787569]">{fund.portfolio_companies} portfolio companies</span>
            <span className="text-[10px] text-[#787569]">{(100 - deploymentPct).toFixed(2)}% remaining</span>
          </div>
          {/* Investment breakdown */}
          {(fund.initial_investments_usd || fund.followon_investments_usd || fund.remaining_reserves_usd) && (
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 divide-x divide-slate-200">
              {[
                { label: 'Initial Investments', value: fund.initial_investments_usd, pct: fund.investable_capital_usd ? Math.round(fund.initial_investments_usd / fund.investable_capital_usd * 10000) / 100 : null, color: '#151411' },
                { label: 'Follow-On Investments', value: fund.followon_investments_usd, pct: fund.investable_capital_usd ? Math.round(fund.followon_investments_usd / fund.investable_capital_usd * 10000) / 100 : null, color: '#4a4840' },
                { label: 'Remaining Reserves', value: fund.remaining_reserves_usd, pct: fund.investable_capital_usd ? Math.round(fund.remaining_reserves_usd / fund.investable_capital_usd * 10000) / 100 : null, color: '#787569' },
              ].map(({ label, value, pct, color }) => (
                <div key={label} className="px-4 first:pl-0 last:pr-0 text-center">
                  <p className="text-[9px] font-bold text-[#787569] uppercase tracking-wide mb-1">{label}</p>
                  <p className="text-base font-extrabold text-[#33322c]">{fmtUSD(value)}</p>
                  {pct != null && <p className="text-[10px] mt-0.5" style={{ color }}>{pct}% of investable</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Performance KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {[
          { label: 'TVPI',           value: `${fund.net_tvpi ?? 0}x`,       color: '#151411',  sub: 'Total value / paid-in' },
          { label: 'DPI',            value: `${fund.dpi ?? 0}x`,            color: '#4a4840',  sub: 'Distributions / paid-in' },
          { label: 'Net IRR',        value: fund.net_irr_pct != null ? `${fund.net_irr_pct}%` : '—',  color: '#686560',  sub: 'Since first close' },
          { label: 'NAV',            value: fmtM(fund.nav_musd * 1_000_000), color: '#3a3830', sub: 'Current portfolio value' },
          { label: 'Deployed',       value: fmtUSD(fund.deployed_capital_usd), color: '#151411', sub: `${deploymentPct}% of investable` },
          { label: 'Companies',      value: String(fund.portfolio_companies ?? 0), color: '#4a4840', sub: 'Active portfolio' },
        ].map(({ label, value, color, sub }) => (
          <div key={label} className={`${CARD} rounded p-4 relative overflow-hidden`}>
            <div className="absolute inset-x-0 top-0 h-[2px] rounded-t" style={{ background: color }} />
            <p className="text-[10px] font-bold text-[#787569] uppercase tracking-wide mb-2">{label}</p>
            <p className="text-xl font-extrabold text-[#33322c] tracking-tight leading-none mb-1">{value}</p>
            <p className="text-[10px] text-[#787569]">{sub}</p>
          </div>
        ))}
      </div>

      {/* Portfolio Analytics — category breakdown */}
      {reports.length > 0 && (() => {
        const catTotals: Record<string, { usd: number; count: number }> = {};
        for (const rpt of reports) {
          for (const inv of rpt.investments) {
            const cat = inv.sector || 'Unclassified';
            if (!catTotals[cat]) catTotals[cat] = { usd: 0, count: 0 };
            catTotals[cat].usd += inv.check_size_usd || 0;
            catTotals[cat].count += 1;
          }
        }
        const sorted = Object.entries(catTotals).sort((a, b) => b[1].usd - a[1].usd);
        const total = sorted.reduce((s, [, v]) => s + v.usd, 0);
        const CAT_COLORS = ['#6366f1','#ec4899','#06b6d4','#f59e0b','#8b5cf6','#10b981','#f97316','#3b82f6','#64748b','#94a3b8'];
        return (
          <div className={`${CARD} rounded p-5 mb-6`}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1.5 h-1.5 rounded-full bg-[#151411]" />
              <span className="text-[10px] font-bold text-[#151411] uppercase tracking-widest">Portfolio by Sector</span>
              <span className="text-[10px] text-[#787569] ml-1">{sorted.length} sectors · {fmtUSD(total)} total deployed</span>
            </div>
            <div className="space-y-2">
              {sorted.map(([cat, { usd, count }], i) => {
                const pct = total > 0 ? Math.round(usd / total * 1000) / 10 : 0;
                const color = CAT_COLORS[i % CAT_COLORS.length];
                return (
                  <div key={cat} className="flex items-center gap-3">
                    <div className="w-24 shrink-0 text-[10px] font-semibold text-[#33322c] truncate">{cat}</div>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <div className="w-20 text-right text-[10px] font-mono text-[#33322c]">{fmtUSD(usd)}</div>
                    <div className="w-12 text-right text-[10px] text-[#787569]">{count} co{count !== 1 ? 's' : ''}</div>
                    <div className="w-10 text-right text-[10px] font-semibold" style={{ color }}>{pct}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className={`${CARD} rounded p-5`}>
          <h3 className="text-sm font-semibold text-[#33322c] mb-1">TVPI Trajectory</h3>
          <p className="text-[10px] text-[#787569] mb-4">{navHistory.length > 0 ? 'Quarterly value progression' : 'No quarterly history — add marks to fund_nav_history to populate'}</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={navHistory.length > 0 ? navHistory : [{ q: '—', v: 1 }]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="q" tick={{ fill: '#787569', fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis domain={[0.8, 'auto']} tick={{ fill: '#787569', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...lightTooltip} formatter={(v: any) => [`${v}x`, 'TVPI']} />
              <Line type="monotone" dataKey="v" stroke="#151411" strokeWidth={2} dot={{ fill: '#151411', r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className={`${CARD} rounded p-5`}>
          <h3 className="text-sm font-semibold text-[#33322c] mb-1">Sector Allocation</h3>
          <p className="text-[10px] text-[#787569] mb-4">By portfolio company count</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={sectorAlloc} cx="50%" cy="50%" outerRadius={72} dataKey="value"
                label={(e: any) => `${e.name} ${e.value}%`} labelLine={{ stroke: '#e2e8f0' }}>
                {sectorAlloc.map((entry: any, i: number) => <Cell key={i} fill={entry.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Annual Investment Reports */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-[#33322c]">Annual Investment Reports</h3>
            <p className="text-[10px] text-[#787569] mt-0.5">Fund I investments by vintage year · FMV as of latest valuation</p>
          </div>
        </div>
        {reports.map((r, i) => (
          <AnnualReportSection key={r.year} report={r} defaultOpen={i === 0} />
        ))}
      </div>
    </>
  );
}

// ── Milestone banner ──────────────────────────────────────────────────────────
interface MilestoneRound {
  id: number; company_id: number; company_name: string;
  round_type: string; amount_usd: number; valuation_usd?: number;
  announced_date?: string; created_at: string;
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PortfolioHomepage() {
  const navigate = useNavigate();
  const userRole = api.getCurrentUser()?.role ?? 'GP';
  const canSeeLP = userRole !== 'PSM';
  const [tab, setTab] = useState<'overview' | 'lp'>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [portfolioCompanies, setPortfolioCompanies] = useState<PortfolioCompany[]>([]);
  const [gridSearch, setGridSearch] = useState('');
  const [fundFilter, setFundFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const portfolioRef = useRef<HTMLDivElement>(null);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [introMovements, setIntroMovements] = useState<Record<number, 'up' | 'down'>>({});
  const [flashActive, setFlashActive] = useState(false);
  const [recentStages, setRecentStages] = useState<Map<number, string>>(new Map());
  const [milestoneRound, setMilestoneRound] = useState<MilestoneRound | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/portfolio/stats', { headers: AUTH }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      fetch('/portfolio/', { headers: AUTH }).then(r => r.ok ? r.json() : []),
      fetch('/portfolio/recent-stages', { headers: AUTH }).then(r => r.ok ? r.json() : []),
      fetch('/portfolio/milestone-round', { headers: AUTH }).then(r => r.ok ? r.json() : null),
    ])
      .then(([statsData, portfolioData, stagesData, milestoneData]) => {
        setStats(statsData);
        setPortfolioCompanies(portfolioData);
        const sm = new Map<number, string>();
        for (const e of (stagesData as { company_id: number; new_stage: string }[])) {
          sm.set(e.company_id, e.new_stage);
        }
        setRecentStages(sm);
        if (milestoneData?.id) {
          const dismissKey = `portfolio_banner_dismissed_${milestoneData.id}`;
          setBannerDismissed(localStorage.getItem(dismissKey) === 'true');
          setMilestoneRound(milestoneData);
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Compare intro counts to last-visit snapshot — animate movers on open
  useEffect(() => {
    if (!stats?.top_by_intros?.length) return;
    const stored = localStorage.getItem('portfolio_intro_snapshot');
    const prev: Record<string, number> = stored ? JSON.parse(stored) : {};
    const movements: Record<number, 'up' | 'down'> = {};
    for (const c of stats.top_by_intros) {
      const prevCount = prev[String(c.id)];
      if (prevCount !== undefined && c.intro_count > prevCount) movements[c.id] = 'up';
      else if (prevCount !== undefined && c.intro_count < prevCount) movements[c.id] = 'down';
    }
    if (Object.keys(movements).length > 0) {
      setIntroMovements(movements);
      setFlashActive(true);
      setTimeout(() => setFlashActive(false), 3500);
    }
    // Save snapshot for next visit
    const snapshot: Record<string, number> = {};
    for (const c of stats.top_by_intros) snapshot[String(c.id)] = c.intro_count;
    localStorage.setItem('portfolio_intro_snapshot', JSON.stringify(snapshot));
  }, [stats?.top_by_intros]);

  if (loading) return (
    <div className={`${cls.page} flex items-center justify-center`}>
      <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#151411] border-r-transparent" />
    </div>
  );
  if (error) return (
    <div className={`${cls.page} flex items-center justify-center`}>
      <div className="bg-red-50 border border-red-200 rounded p-6 text-red-600">{error}</div>
    </div>
  );
  if (!stats) return null;

  const deployedRaw = stats.total_deployed_usd ?? stats.cvc_deployed_capital;
  const deployedFormatted = deployedRaw
    ? (deployedRaw >= 1_000_000 ? `$${(deployedRaw / 1_000_000).toFixed(1)}M` : `$${deployedRaw.toLocaleString('en-US')}`)
    : '$' + (stats.total_raised_usd / 1_000_000).toFixed(0) + 'M';
  const deployedSubtitle = (stats.fund_i_deployed_usd && stats.family_office_deployed_usd)
    ? `Fund I $${(stats.fund_i_deployed_usd/1_000_000).toFixed(1)}M · FO $${(stats.family_office_deployed_usd/1_000_000).toFixed(1)}M`
    : 'Across all portfolio vehicles';
  const avgAge = stats.avg_founded_year ? (new Date().getFullYear() - stats.avg_founded_year).toFixed(1) : null;
  const totalIntros = stats.top_by_intros.reduce((s, c) => s + c.intro_count, 0);
  const sectorData = stats.sector_distribution.map((item, i) => ({
    name: item.sector, value: item.count,
    color: SECTOR_COLORS[item.sector] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  }));
  const stageData = stats.stage_distribution.map(item => ({
    stage: item.stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    rawStage: item.stage,
    count: item.count,
  }));

  const stageCompanies = selectedStage
    ? portfolioCompanies.filter(c => c.stage === selectedStage)
    : [];

  return (
    <div className={cls.page}>
      <main className="max-w-[1400px] mx-auto px-6 py-8">

        {/* McKinsey-style report header */}
        <div className="border-b-2 border-[#151411] pb-5 mb-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">SLAM · Portfolio</p>
          <div className="flex items-center justify-between">
            <div>
              <h1 className={cls.pageTitle}>Portfolio</h1>
              <p className="text-xs text-[#787569] mt-0.5">
                {portfolioCompanies.filter(c => c.fund === 'Fund I').length} Fund I
                {' · '}
                {portfolioCompanies.filter(c => c.fund === 'Family Office').length} Family Office
                {' · '}
                {portfolioCompanies.length} total
              </p>
            </div>
            <div className="flex gap-1 p-1 rounded border border-slate-200 bg-white">
              {([
                { key: 'overview',  label: 'Overview'      },
                ...(canSeeLP ? [{ key: 'lp', label: 'Fund I' }] : []),
              ] as { key: 'overview' | 'lp'; label: string }[]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-1.5 rounded text-xs font-semibold transition-all ${
                    tab === t.key
                      ? 'bg-[#151411] text-white shadow-sm'
                      : 'text-[#787569] hover:text-[#33322c]'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {tab === 'lp' && <LPTab />}

        {tab === 'overview' && (
          <>
            {/* Milestone banner — most recent large round, dismissable per-user */}
            {milestoneRound && !bannerDismissed && (
              <div className="flex items-center justify-between gap-4 mb-5 px-4 py-3 rounded border border-cvc-gold/40 bg-cvc-gold/10">
                <div className="flex items-center gap-3 min-w-0">
                  <DollarSign className="w-4 h-4 text-cvc-gold shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-[#33322c]">
                      {milestoneRound.company_name}
                    </span>
                    <span className="text-xs text-[#787569] ml-2">
                      closed a ${(milestoneRound.amount_usd / 1_000_000).toFixed(0)}M{' '}
                      {milestoneRound.round_type}
                      {milestoneRound.valuation_usd
                        ? ` · $${(milestoneRound.valuation_usd / 1_000_000).toFixed(0)}M valuation`
                        : ''}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => navigate(`/company/${milestoneRound.company_id}`)}
                    className="text-[11px] font-semibold text-cvc-gold hover:text-[#b87300] transition-colors">
                    View →
                  </button>
                  <button
                    onClick={() => {
                      localStorage.setItem(`portfolio_banner_dismissed_${milestoneRound.id}`, 'true');
                      setBannerDismissed(true);
                    }}
                    className="text-[#aaa] hover:text-[#555] transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* KPI row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <KPICard title="Portfolio Companies" value={stats.total_companies} icon={Building2} color="#151411" />
              <KPICard title="Capital Deployed" value={deployedFormatted} subtitle={deployedSubtitle} icon={TrendingUp} color="#4a4840" />
              <KPICard title="Avg. Company Age" value={avgAge ? `${avgAge}y` : 'N/A'} subtitle="Since founding" icon={Clock} color="#686560" />
              <KPICard title="Partner Intros" value={totalIntros} subtitle="Across portfolio" icon={HandshakeIcon} color="#3a3830" />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <div className={`${CARD} rounded p-5`}>
                <h3 className="text-sm font-semibold text-[#33322c] mb-4">Portfolio by Sector</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={sectorData} cx="50%" cy="50%" innerRadius={50} outerRadius={88} paddingAngle={2} dataKey="value">
                      {sectorData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Legend verticalAlign="bottom" height={36}
                      formatter={(value, entry: any) => (
                        <span style={{ color: '#33322c', fontSize: 11 }}>
                          {value} ({entry.payload.value})
                        </span>
                      )} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className={`${CARD} rounded p-5`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-[#33322c]">Stage Distribution</h3>
                  {selectedStage && (
                    <button onClick={() => setSelectedStage(null)} className="text-[10px] text-[#787569] hover:text-[#33322c] flex items-center gap-1">
                      <X className="w-3 h-3" /> Clear
                    </button>
                  )}
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stageData} margin={{ left: -20 }} style={{ cursor: 'pointer' }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="stage" tick={{ fill: '#787569', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#787569', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip {...lightTooltip} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}
                      onClick={(data: any) => setSelectedStage(s => s === data.rawStage ? null : data.rawStage)}>
                      {stageData.map((entry, i) => (
                        <Cell key={i} fill={selectedStage === entry.rawStage ? '#f59e0b' : '#151411'}
                          opacity={selectedStage && selectedStage !== entry.rawStage ? 0.35 : 1} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {selectedStage && stageCompanies.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-[10px] font-bold text-[#787569] uppercase tracking-wide mb-2">
                      {stageData.find(s => s.rawStage === selectedStage)?.stage} · {stageCompanies.length} companies
                    </p>
                    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                      {stageCompanies.map(c => (
                        <div key={c.id} onClick={() => navigate(`/company/${c.id}`)}
                          className="flex items-center justify-between px-2.5 py-1.5 rounded border border-slate-100 hover:border-[#151411] hover:bg-[#fafaf8] transition-all cursor-pointer group">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#33322c] truncate group-hover:text-[#151411]">{c.name}</p>
                            <p className="text-[10px] text-[#787569] truncate">{c.sector || 'Unclassified'}</p>
                          </div>
                          {c.fund && (
                            <span className="text-[8px] font-bold text-[#7a6f00] bg-cvc-gold/20 px-1 py-0.5 rounded uppercase tracking-wider border border-cvc-gold/30 shrink-0 ml-2 whitespace-nowrap">{c.fund}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Top intros + portco news */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <div className={`${CARD} rounded p-5`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[#33322c]">Top by Partner Intros</h3>
                  <button onClick={() => portfolioRef.current?.scrollIntoView({ behavior: 'smooth' })}
                    className="text-[10px] text-[#151411] hover:underline">View all</button>
                </div>
                <div className="space-y-2">
                  {stats.top_by_intros.length > 0
                    ? stats.top_by_intros.map(c => (
                        <CompanyRow key={c.id} company={c} onClick={() => navigate(`/company/${c.id}`)}
                          movement={introMovements[c.id]} flash={flashActive} />
                      ))
                    : <p className="text-xs text-[#ACACAA]">No intro data yet.</p>}
                </div>
              </div>
              <PortcoNewsPanel portfolioCompanies={portfolioCompanies} />
            </div>

            {/* All portfolio tiles */}
            <div ref={portfolioRef}>
              <div className="flex items-center justify-between mb-3 gap-4">
                <div className="shrink-0">
                  <h3 className="text-sm font-semibold text-[#33322c]">All Portfolio Companies</h3>
                </div>
                <div className="flex items-center gap-2 flex-1 justify-end">
                  {/* Fund filter pills */}
                  <div className="flex gap-1 shrink-0">
                    {([null, 'Fund I', 'Family Office'] as (string | null)[]).map(f => (
                      <button key={f ?? 'all'} onClick={() => setFundFilter(f)}
                        className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-all border ${
                          fundFilter === f
                            ? 'bg-[#151411] text-white border-[#151411]'
                            : 'bg-white text-[#787569] border-slate-200 hover:border-[#151411] hover:text-[#33322c]'
                        }`}>
                        {f ?? 'All'}
                      </button>
                    ))}
                  </div>
                  <div className="relative max-w-xs w-full">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#787569] pointer-events-none" />
                    <input
                      value={gridSearch}
                      onChange={e => setGridSearch(e.target.value)}
                      placeholder="Search portfolio…"
                      className="w-full bg-white border border-slate-200 rounded pl-8 pr-8 py-1.5 text-sm text-[#33322c] placeholder-[#ACACAA] outline-none focus:border-[#151411] transition-colors"
                    />
                    {gridSearch && (
                      <button onClick={() => setGridSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                        <X className="w-3.5 h-3.5 text-[#787569] hover:text-[#33322c]" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
                {portfolioCompanies
                  .filter(c => (!fundFilter || c.fund === fundFilter) && (!gridSearch || c.name.toLowerCase().includes(gridSearch.toLowerCase()) || (c.sector ?? '').toLowerCase().includes(gridSearch.toLowerCase())))
                  .map(c => {
                    const isOOB = c.stage === 'Out of Business';
                    const isNewStage = recentStages.has(c.id);
                    const sectorColor = isOOB ? '#94a3b8' : (SECTOR_COLORS[c.sector ?? ''] ?? '#151411');
                    return (
                      <Link key={c.id} to={`/company/${c.id}`}
                        className={`${CARD} rounded p-3 ${CARD_HOV} transition-all group relative overflow-hidden ${isOOB ? 'opacity-50 grayscale' : ''} ${isNewStage ? 'border-l-2 border-l-cvc-gold' : ''}`}>
                        <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l" style={{ background: isNewStage ? '#F59E0B' : sectorColor }} />
                        <div className="pl-1">
                          <div className="flex items-start justify-between gap-1 mb-1.5">
                            <p className="text-xs font-bold text-[#33322c] leading-tight line-clamp-2 group-hover:text-[#151411] transition-colors flex-1">{c.name}</p>
                            {isOOB
                              ? <span className="text-[8px] font-bold text-slate-500 bg-slate-100 px-1 py-0.5 rounded uppercase tracking-wider border border-slate-300 shrink-0 whitespace-nowrap">Closed</span>
                              : isNewStage
                              ? <span className="text-[8px] font-bold text-[#7a6f00] bg-cvc-gold/20 px-1 py-0.5 rounded uppercase tracking-wider border border-cvc-gold/50 shrink-0 whitespace-nowrap">New: {recentStages.get(c.id)}</span>
                              : c.fund && (
                                <span className="text-[8px] font-bold text-[#7a6f00] bg-cvc-gold/20 px-1 py-0.5 rounded uppercase tracking-wider border border-cvc-gold/30 shrink-0 whitespace-nowrap">{c.fund}</span>
                              )
                            }
                          </div>
                          {c.sector && (
                            <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold mb-1.5"
                              style={{ background: sectorColor + '20', color: '#33322c', borderLeft: `2px solid ${sectorColor}` }}>
                              {c.sector}
                            </span>
                          )}
                          <div className="space-y-0.5">
                            {c.stage && <p className="text-[10px] text-[#787569]">{c.stage.replace(/_/g,' ').replace(/\b\w/g, l => l.toUpperCase())}</p>}
                            {c.location && (
                              <p className="text-[10px] text-[#787569] flex items-center gap-1 truncate">
                                <MapPin className="w-2 h-2 flex-shrink-0" />{c.location}
                              </p>
                            )}
                            {c.raised && <p className="text-[10px] font-bold text-[#151411]">{c.raised}</p>}
                          </div>
                          {c.intro_count > 0 && !isOOB && (
                            <div className="mt-2 pt-1.5 border-t border-slate-200">
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ background: '#ede8d7', color: '#151411' }}>
                                {c.intro_count} intro{c.intro_count !== 1 ? 's' : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
              </div>
            </div>
          </>
        )}

      </main>
    </div>
  );
}
