/**
 * DealPipelinePanel — shared between PortfolioHomepage and VenturesOverview.
 * Self-contained: fetches /dealflow/ internally, no props required.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  X, Plus, RefreshCw, Search, ExternalLink, Trash2,
  CheckCircle, MoreHorizontal, ChevronDown,
} from 'lucide-react';
import { AUTH_HEADER as AUTH } from '../api/client';

// ── Design tokens (match PortfolioHomepage) ───────────────────────────────────
const CARD     = 'bg-white border border-slate-200 rounded-xl shadow-cvc';
const CARD_HI  = 'bg-white border border-cvc-slate rounded-xl shadow-cvc';
const CARD_HOV = 'hover:border-cvc-slate hover:shadow-cvc-hover';

// ── Types ────────────────────────────────────────────────────────────────────
interface Deal {
  company_id: number; name: string; sector?: string; stage?: string;
  status: string; status_changed_at?: string; reason?: string;
  changed_by?: string | null;
}

interface TermSheetForm {
  investment_type: string; round_type: string; check_size_usd: string;
  pre_money_valuation_usd: string; is_lead_investor: boolean;
  board_seat: boolean; pro_rata_rights: boolean;
  close_date: string; co_investors: string; notes: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PIPELINE_COLS = [
  { key: 'discovered',    label: 'Discovered',    color: '#787569', accent: 'rgba(138,136,128,0.12)' },
  { key: 'due_diligence', label: 'Due Diligence', color: '#4a4840', accent: 'rgba(74,72,64,0.10)'    },
  { key: 'approved',      label: 'Approved',      color: '#059669', accent: 'rgba(5,150,105,0.10)'   },
  { key: 'passed',        label: 'Passed',        color: '#ef4444', accent: 'rgba(239,68,68,0.08)'   },
  { key: 'invested',      label: 'Invested',      color: '#151411', accent: 'rgba(37,35,32,0.08)'    },
];

const STAGE_LABELS: Record<string, string> = {
  pre_seed: 'Pre-Seed', seed: 'Seed', series_a: 'Series A',
  series_b: 'Series B', series_c: 'Series C+', undisclosed: 'Undisclosed',
};

const EMPTY_TS_FORM: TermSheetForm = {
  investment_type: '', round_type: '', check_size_usd: '',
  pre_money_valuation_usd: '', is_lead_investor: false, board_seat: false,
  pro_rata_rights: false, close_date: '', co_investors: '', notes: '',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(iso?: string): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatUSD(val: string): string {
  const n = parseInt(val.replace(/,/g, ''), 10);
  return isNaN(n) ? val : n.toLocaleString('en-US');
}

// ── Component ─────────────────────────────────────────────────────────────────
export function DealPipelinePanel({ filterUser }: { filterUser?: string | null }) {
  const navigate = useNavigate();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [passFormOpen, setPassFormOpen] = useState<Set<number>>(new Set());
  const [passReasonDraft, setPassReasonDraft] = useState<Record<number, string>>({});
  const [passReasonSaving, setPassReasonSaving] = useState<number | null>(null);
  const [termSheetCompany, setTermSheetCompany] = useState<Deal | null>(null);
  const [tsForm, setTsForm] = useState<TermSheetForm>(EMPTY_TS_FORM);
  const [tsSubmitting, setTsSubmitting] = useState(false);
  const [tsSuccess, setTsSuccess] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const COL_DEFAULT_ROWS = 2;
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addStage, setAddStage] = useState<string>('discovered');
  const [addSuggestions, setAddSuggestions] = useState<{ id: number; name: string; sector?: string }[]>([]);
  const [addCompanyId, setAddCompanyId] = useState<number | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const addSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addSugRef = useRef<HTMLDivElement>(null);

  const openTermSheet = async (deal: Deal) => {
    setTermSheetCompany(deal); setTsForm(EMPTY_TS_FORM); setTsSuccess(false);
    try {
      const r = await fetch(`/dealflow/${deal.company_id}/term-sheet`, { headers: AUTH });
      if (r.ok) {
        const ex = await r.json();
        if (ex && ex.investment_type !== undefined) {
          setTsForm({
            investment_type: ex.investment_type ?? '', round_type: ex.round_type ?? '',
            check_size_usd: ex.check_size_usd != null ? String(ex.check_size_usd) : '',
            pre_money_valuation_usd: ex.pre_money_valuation_usd != null ? String(ex.pre_money_valuation_usd) : '',
            is_lead_investor: ex.is_lead_investor ?? false, board_seat: ex.board_seat ?? false,
            pro_rata_rights: ex.pro_rata_rights ?? false, close_date: ex.close_date ?? '',
            co_investors: (ex.co_investors ?? []).join(', '), notes: ex.notes ?? '',
          });
        }
      }
    } catch { /* no existing sheet is fine */ }
    setTimeout(() => { document.getElementById('dp-ts-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
  };

  const submitTermSheet = async () => {
    if (!termSheetCompany) return;
    setTsSubmitting(true);
    try {
      const payload = {
        investment_type: tsForm.investment_type || null, round_type: tsForm.round_type || null,
        check_size_usd: tsForm.check_size_usd ? parseInt(tsForm.check_size_usd.replace(/,/g, ''), 10) : null,
        pre_money_valuation_usd: tsForm.pre_money_valuation_usd ? parseInt(tsForm.pre_money_valuation_usd.replace(/,/g, ''), 10) : null,
        post_money_valuation_usd: null, is_lead_investor: tsForm.is_lead_investor,
        co_investors: tsForm.co_investors ? tsForm.co_investors.split(',').map(s => s.trim()).filter(Boolean) : [],
        board_seat: tsForm.board_seat, pro_rata_rights: tsForm.pro_rata_rights,
        close_date: tsForm.close_date || null, lead_attorney: null, notes: tsForm.notes || null,
      };
      const r = await fetch(`/dealflow/${termSheetCompany.company_id}/term-sheet`, {
        method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error('Failed to save');
      setDeals(prev => prev.map(d =>
        d.company_id === termSheetCompany.company_id
          ? { ...d, status: 'invested', status_changed_at: new Date().toISOString() } : d
      ));
      setTsSuccess(true);
      setTimeout(() => { setTermSheetCompany(null); setTsSuccess(false); }, 2200);
    } catch { alert('Error saving term sheet.'); } finally { setTsSubmitting(false); }
  };

  const tsSet = (field: keyof TermSheetForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setTsForm(prev => ({ ...prev, [field]: e.target.value }));
  const tsToggle = (field: keyof TermSheetForm) => () =>
    setTsForm(prev => ({ ...prev, [field]: !prev[field as 'is_lead_investor'] }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/dealflow/', { headers: AUTH });
      if (r.ok) setDeals((await r.json()).filter((d: Deal) => d.status));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (addSugRef.current && !addSugRef.current.contains(e.target as Node)) setAddSuggestions([]);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleAddNameChange = (val: string) => {
    setAddName(val); setAddCompanyId(null);
    if (addSearchTimer.current) clearTimeout(addSearchTimer.current);
    if (val.trim().length < 2) { setAddSuggestions([]); return; }
    addSearchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/companies?q=${encodeURIComponent(val.trim())}&limit=6&name_only=true`, { headers: AUTH });
        if (r.ok) {
          const data = await r.json();
          const list = Array.isArray(data) ? data : (data.companies ?? []);
          setAddSuggestions(list.map((c: any) => ({ id: c.id, name: c.name, sector: c.sector })));
        }
      } catch { /* silent */ }
    }, 250);
  };

  const submitAdd = async () => {
    if (!addName.trim()) return;
    setAddSubmitting(true);
    setAddError(null);
    try {
      const body: any = { name: addName.trim(), pipeline_status: addStage };
      if (addCompanyId) body.company_id = addCompanyId;
      const r = await fetch('/dealflow/intake', {
        method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (r.ok) {
        setAddName(''); setAddCompanyId(null); setAddStage('discovered'); setShowAdd(false); setAddError(null); load();
      } else {
        const err = await r.json().catch(() => ({}));
        setAddError(err.detail ?? `Server error (${r.status})`);
      }
    } catch (e: any) {
      setAddError(e?.message ?? 'Network error');
    } finally { setAddSubmitting(false); }
  };

  const moveStatus = async (companyId: number, newStatus: string) => {
    setMoving(companyId);
    try {
      await fetch(`/dealflow/${companyId}/status`, {
        method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      setDeals(prev => prev.map(d =>
        d.company_id === companyId ? { ...d, status: newStatus, status_changed_at: new Date().toISOString() } : d
      ));
    } finally { setMoving(null); }
  };

  const removeFromPipeline = async (companyId: number) => {
    setRemoving(companyId);
    try {
      const r = await fetch(`/dealflow/${companyId}`, { method: 'DELETE', headers: AUTH });
      if (r.ok) setDeals(prev => prev.filter(d => d.company_id !== companyId));
    } finally { setRemoving(null); }
  };

  const openPassForm = (companyId: number, existingReason?: string) => {
    setPassReasonDraft(prev => ({ ...prev, [companyId]: existingReason ?? '' }));
    setPassFormOpen(prev => { const s = new Set(prev); s.add(companyId); return s; });
  };
  const closePassForm = (companyId: number) => {
    setPassFormOpen(prev => { const s = new Set(prev); s.delete(companyId); return s; });
  };
  const submitPass = async (companyId: number) => {
    setPassReasonSaving(companyId);
    try {
      const reason = passReasonDraft[companyId]?.trim() || null;
      await fetch(`/dealflow/${companyId}/status`, {
        method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'passed', reason }),
      });
      setDeals(prev => prev.map(d =>
        d.company_id === companyId
          ? { ...d, status: 'passed', reason: reason ?? undefined, status_changed_at: new Date().toISOString() }
          : d
      ));
      closePassForm(companyId);
    } finally { setPassReasonSaving(null); }
  };

  const byStatus = (key: string) => deals.filter(d =>
    d.status === key && (!filterUser || d.changed_by === filterUser)
  );
  const nextStage = (currentKey: string) => {
    const idx = PIPELINE_COLS.findIndex(c => c.key === currentKey);
    return PIPELINE_COLS.find((c, i) => i > idx && c.key !== 'passed') ?? null;
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <p className="text-xs text-[#787569]">
          {filterUser
            ? `${deals.filter(d => d.changed_by === filterUser).length} deals · ${filterUser}`
            : `${deals.length} companies · ${PIPELINE_COLS.filter(c => byStatus(c.key).length > 0).length} active stages`
          }
        </p>
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all"
            style={showAdd
              ? { background: '#ede8d7', color: '#787569', border: '1px solid #e2e8f0' }
              : { background: '#151411', color: 'white' }}>
            {showAdd ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showAdd ? 'Cancel' : 'Add to Pipeline'}
          </button>
          <button onClick={load} className={`p-1.5 rounded border border-slate-200 ${CARD_HOV} transition-all`}>
            <RefreshCw className={`w-3.5 h-3.5 text-[#787569] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Add to pipeline form */}
      {showAdd && (
        <div className={`${CARD_HI} rounded p-4 mb-5`}>
          <p className="text-xs font-bold text-[#33322c] mb-3">Add company to pipeline</p>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-[200px] relative" ref={addSugRef}>
              <label className="block text-[10px] font-semibold text-[#787569] mb-1 uppercase tracking-wide">Company</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#787569] pointer-events-none" />
                <input
                  value={addName} onChange={e => handleAddNameChange(e.target.value)}
                  placeholder="Search existing or type new name"
                  className="w-full bg-white border border-slate-200 rounded pl-8 pr-3 py-2 text-sm text-[#33322c] placeholder-[#ACACAA] outline-none focus:border-[#151411] transition-colors"
                />
              </div>
              {addCompanyId && <p className="text-[10px] text-[#151411] font-semibold mt-0.5 pl-1">✓ Linked #{addCompanyId}</p>}
              {addSuggestions.length > 0 && (
                <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded shadow-lg overflow-hidden">
                  {addSuggestions.map(s => (
                    <button key={s.id} onMouseDown={() => { setAddName(s.name); setAddCompanyId(s.id); setAddSuggestions([]); }}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-[#ede8d7] border-b border-slate-200 last:border-0">
                      <span className="text-sm font-medium text-[#33322c]">{s.name}</span>
                      {s.sector && <span className="text-[10px] text-[#787569]">{s.sector}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-[#787569] mb-1 uppercase tracking-wide">Stage</label>
              <select value={addStage} onChange={e => setAddStage(e.target.value)}
                className="bg-white border border-slate-200 rounded px-3 py-2 text-sm text-[#33322c] outline-none focus:border-[#151411]">
                {PIPELINE_COLS.filter(c => c.key !== 'passed').map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            <button onClick={submitAdd} disabled={addSubmitting || !addName.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-semibold bg-[#151411] text-white disabled:opacity-40 transition-all">
              <Plus className="w-3.5 h-3.5" />
              {addSubmitting ? 'Adding…' : 'Add'}
            </button>
          </div>
          {addError && (
            <p className="mt-2 text-xs text-red-600 font-medium">{addError}</p>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#151411] border-r-transparent" />
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {PIPELINE_COLS.map(col => {
            const cards = byStatus(col.key);
            return (
              <div key={col.key} className="flex-shrink-0" style={{ minWidth: 210, width: 210 }}>
                {/* Column header */}
                <div className="flex items-center justify-between mb-2 px-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: col.color }} />
                    <span className="text-[10px] font-bold text-[#33322c] uppercase tracking-wider">{col.label}</span>
                  </div>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: col.accent, color: col.color }}>
                    {cards.length}
                  </span>
                </div>

                {/* Cards */}
                {(() => {
                  const isExpanded = expandedCols.has(col.key);
                  const visible = isExpanded ? cards : cards.slice(0, COL_DEFAULT_ROWS);
                  const hidden = cards.length - COL_DEFAULT_ROWS;
                  return (
                <div className="space-y-1">
                  {cards.length === 0 ? (
                    <div className="border border-dashed border-slate-200 rounded h-10 flex items-center justify-center">
                      <span className="text-[9px] text-[#ACACAA]">Empty</span>
                    </div>
                  ) : visible.map(deal => {
                    const prOpen = passFormOpen.has(deal.company_id);
                    return (
                      <div key={deal.company_id} className="relative">
                        {/* Slim row */}
                        <div
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-slate-100 bg-white hover:bg-[#fafafa] transition-all group"
                          style={{ borderLeftWidth: 2, borderLeftColor: col.color }}>

                          <span
                            className="flex-1 text-[11px] font-semibold text-[#33322c] truncate cursor-pointer hover:text-[#151411] transition-colors"
                            onClick={() => navigate(`/companies/${deal.company_id}`)}>
                            {deal.name}
                          </span>

                          {deal.sector && (
                            <span className="text-[8px] font-semibold px-1 py-0.5 rounded bg-[#ede8d7] text-[#787569] shrink-0 hidden lg:block truncate max-w-[50px]">
                              {deal.sector}
                            </span>
                          )}

                          {deal.changed_by && (
                            <span title={deal.changed_by}
                              className="w-4 h-4 rounded-full bg-slate-200 text-[7px] font-bold flex items-center justify-center text-slate-500 uppercase shrink-0">
                              {deal.changed_by[0]}
                            </span>
                          )}

                          <button
                            onClick={() => setOpenMenuId(openMenuId === deal.company_id ? null : deal.company_id)}
                            className="p-0.5 rounded text-slate-300 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Dropdown menu */}
                        {openMenuId === deal.company_id && (
                          <div className="absolute right-0 top-full mt-0.5 w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 overflow-hidden">
                            {col.key !== 'passed' && col.key !== 'invested' && <>
                              <p className="px-3 pt-1.5 pb-0.5 text-[9px] font-bold text-slate-400 uppercase tracking-wide">Move to</p>
                              {PIPELINE_COLS.filter(c => c.key !== col.key && c.key !== 'passed').map(c => (
                                <button key={c.key}
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    // Invested requires term sheet — gate it
                                    if (c.key === 'invested') { openTermSheet(deal); }
                                    else { moveStatus(deal.company_id, c.key); }
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-xs text-[#33322c] hover:bg-[#ede8d7] flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                                  {c.label}{c.key === 'invested' ? ' →' : ''}
                                </button>
                              ))}
                              <div className="border-t border-slate-100 my-1" />
                              <button
                                onClick={() => { setOpenMenuId(null); openPassForm(deal.company_id); }}
                                className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50">
                                Pass on deal
                              </button>
                              <div className="border-t border-slate-100 my-1" />
                            </>}

                            {col.key === 'invested' && <>
                              <button
                                onClick={() => { setOpenMenuId(null); openTermSheet(deal); }}
                                className="w-full text-left px-3 py-1.5 text-xs text-[#33322c] hover:bg-[#ede8d7]">
                                View / Edit Term Sheet
                              </button>
                              <div className="border-t border-slate-100 my-1" />
                              <p className="px-3 pt-1 pb-0.5 text-[9px] font-bold text-slate-400 uppercase tracking-wide">Send back</p>
                              {PIPELINE_COLS.filter(c => c.key !== 'invested' && c.key !== 'passed').map(c => (
                                <button key={c.key}
                                  onClick={() => { moveStatus(deal.company_id, c.key); setOpenMenuId(null); }}
                                  className="w-full text-left px-3 py-1.5 text-xs text-[#787569] hover:bg-[#ede8d7] flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                                  {c.label}
                                </button>
                              ))}
                              <div className="border-t border-slate-100 my-1" />
                            </>}

                            {col.key === 'passed' && <>
                              <button
                                onClick={() => { setOpenMenuId(null); openPassForm(deal.company_id, deal.reason); }}
                                className="w-full text-left px-3 py-1.5 text-xs text-[#787569] hover:bg-[#ede8d7]">
                                {deal.reason ? 'Edit pass reason' : 'Add pass reason'}
                              </button>
                              <div className="border-t border-slate-100 my-1" />
                            </>}

                            <button
                              onClick={() => { setOpenMenuId(null); navigate(`/companies/${deal.company_id}`); }}
                              className="w-full text-left px-3 py-1.5 text-xs text-[#33322c] hover:bg-[#ede8d7] flex items-center gap-2">
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              Open profile
                            </button>
                            <button
                              onClick={() => { setOpenMenuId(null); removeFromPipeline(deal.company_id); }}
                              disabled={removing === deal.company_id}
                              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-50 flex items-center gap-2 disabled:opacity-40">
                              <Trash2 className="w-3 h-3 shrink-0" />
                              Remove from pipeline
                            </button>
                          </div>
                        )}

                        {/* Pass form — expands inline */}
                        {prOpen && (
                          <div className="border border-t-0 border-slate-200 rounded-b px-3 py-2.5" style={{ background: 'rgba(239,68,68,0.04)' }}>
                            <p className="text-[10px] font-bold text-red-500 mb-2">Why are we passing?</p>
                            <textarea
                              rows={2}
                              placeholder="e.g. Valuation too high, market too early…"
                              value={passReasonDraft[deal.company_id] ?? ''}
                              onChange={e => setPassReasonDraft(prev => ({ ...prev, [deal.company_id]: e.target.value }))}
                              className="w-full bg-white border border-red-200 rounded px-2 py-1.5 text-xs text-[#33322c] outline-none focus:border-red-400 resize-none mb-2 placeholder-[#ACACAA]"
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <button onClick={() => submitPass(deal.company_id)} disabled={passReasonSaving === deal.company_id}
                                className="flex-1 py-1.5 rounded text-xs font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors">
                                {passReasonSaving === deal.company_id ? 'Saving…' : col.key === 'passed' ? 'Save' : 'Pass →'}
                              </button>
                              <button onClick={() => closePassForm(deal.company_id)}
                                className="px-3 py-1.5 rounded text-xs font-semibold text-[#787569] border border-slate-200 hover:bg-[#ede8d7] transition-colors">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Accordion toggle */}
                  {hidden > 0 && (
                    <button
                      onClick={() => setExpandedCols(prev => {
                        const next = new Set(prev);
                        isExpanded ? next.delete(col.key) : next.add(col.key);
                        return next;
                      })}
                      className="w-full flex items-center justify-center gap-1 py-2 mt-1 rounded-b-md text-[10px] font-bold transition-all"
                      style={{ background: col.accent, color: col.color }}
                    >
                      <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      {isExpanded ? 'Collapse' : `${hidden} more`}
                    </button>
                  )}
                </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* Term Sheet Panel */}
      {termSheetCompany && (
        <div id="dp-ts-panel" className="mt-10">
          <div className={`${CARD_HI} rounded overflow-hidden`}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#151411]" />
                  <span className="text-[10px] font-bold text-[#151411] uppercase tracking-widest">Term Sheet</span>
                </div>
                <h2 className="text-xl font-bold text-[#33322c]">{termSheetCompany.name}</h2>
                <p className="text-xs text-[#787569] mt-0.5">Fill in the key deal terms. Submitting moves this company to Invested.</p>
              </div>
              <button onClick={() => setTermSheetCompany(null)} className="p-2 rounded hover:bg-[#ede8d7] transition-colors">
                <X className="w-4 h-4 text-[#787569]" />
              </button>
            </div>

            {tsSuccess ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <CheckCircle className="w-10 h-10 text-[#151411]" />
                <p className="text-base font-bold text-[#33322c]">Investment recorded</p>
                <p className="text-sm text-[#787569]">{termSheetCompany.name} added to Portfolio.</p>
              </div>
            ) : (
              <div className="px-6 py-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                  {[
                    { label: 'Investment Type', field: 'investment_type' as const, options: ['', 'SAFE', 'convertible_note', 'equity', 'warrant'], labels: ['Select…', 'SAFE', 'Convertible Note', 'Equity', 'Warrant'] },
                    { label: 'Round Type', field: 'round_type' as const, options: ['', 'Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C'], labels: ['Select…', 'Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C+'] },
                  ].map(({ label, field, options, labels }) => (
                    <div key={field}>
                      <label className="block text-[10px] font-semibold text-[#787569] uppercase tracking-wide mb-1.5">{label}</label>
                      <select value={tsForm[field]} onChange={tsSet(field)}
                        className="w-full text-sm bg-white border border-slate-200 rounded px-3 py-2 text-[#33322c] outline-none focus:border-[#151411]">
                        {options.map((o, i) => <option key={o} value={o}>{labels[i]}</option>)}
                      </select>
                    </div>
                  ))}
                  {[
                    { label: 'Check Size ($)', field: 'check_size_usd' as const, placeholder: 'e.g. 250,000' },
                    { label: 'Pre-Money Valuation ($)', field: 'pre_money_valuation_usd' as const, placeholder: 'e.g. 8,000,000' },
                  ].map(({ label, field, placeholder }) => (
                    <div key={field}>
                      <label className="block text-[10px] font-semibold text-[#787569] uppercase tracking-wide mb-1.5">{label}</label>
                      <input type="text" value={tsForm[field]} onChange={tsSet(field)}
                        onBlur={e => setTsForm(p => ({ ...p, [field]: formatUSD(e.target.value) }))}
                        placeholder={placeholder}
                        className="w-full text-sm bg-white border border-slate-200 rounded px-3 py-2 text-[#33322c] placeholder-[#ACACAA] outline-none focus:border-[#151411]" />
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div>
                    <label className="block text-[10px] font-semibold text-[#787569] uppercase tracking-wide mb-1.5">Close Date</label>
                    <input type="date" value={tsForm.close_date} onChange={tsSet('close_date')}
                      className="w-full text-sm bg-white border border-slate-200 rounded px-3 py-2 text-[#33322c] outline-none focus:border-[#151411]" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-[#787569] uppercase tracking-wide mb-1.5">Co-Investors <span className="font-normal opacity-60">(comma-separated)</span></label>
                    <input type="text" value={tsForm.co_investors} onChange={tsSet('co_investors')}
                      placeholder="e.g. PNP, Harvey Williams"
                      className="w-full text-sm bg-white border border-slate-200 rounded px-3 py-2 text-[#33322c] placeholder-[#ACACAA] outline-none focus:border-[#151411]" />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-5">
                  {([
                    { field: 'is_lead_investor', label: 'Lead Investor' },
                    { field: 'board_seat',        label: 'Board Seat' },
                    { field: 'pro_rata_rights',   label: 'Pro-Rata Rights' },
                  ] as { field: keyof TermSheetForm; label: string }[]).map(({ field, label }) => (
                    <button key={field} type="button" onClick={tsToggle(field)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all"
                      style={tsForm[field]
                        ? { background: 'rgba(37,35,32,0.08)', borderColor: 'rgba(37,35,32,0.4)', color: '#151411' }
                        : { background: '#ede8d7', borderColor: '#e2e8f0', color: '#787569' }}>
                      <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${tsForm[field] ? 'border-[#151411] bg-[#151411]' : 'border-[#ACACAA]'}`}>
                        {tsForm[field] && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      {label}
                    </button>
                  ))}
                </div>

                <div className="mb-5">
                  <label className="block text-[10px] font-semibold text-[#787569] uppercase tracking-wide mb-1.5">Notes</label>
                  <textarea value={tsForm.notes} onChange={tsSet('notes')} rows={3}
                    placeholder="Structure nuances, key conditions, etc."
                    className="w-full text-sm bg-white border border-slate-200 rounded px-3 py-2 text-[#33322c] placeholder-[#ACACAA] outline-none focus:border-[#151411] resize-none" />
                </div>

                <div className="flex items-center gap-3">
                  <button onClick={submitTermSheet} disabled={tsSubmitting}
                    className="px-5 py-2.5 rounded text-sm font-bold text-white bg-[#151411] hover:bg-[#3a3830] disabled:opacity-50 transition-all">
                    {tsSubmitting ? 'Saving…' : 'Submit — Move to Invested'}
                  </button>
                  <button onClick={() => setTermSheetCompany(null)}
                    className="px-4 py-2.5 rounded text-sm font-semibold text-[#787569] hover:bg-[#ede8d7] transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
