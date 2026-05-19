import { useState, useEffect, useRef } from 'react';
import { Search, Plus, X, Check } from 'lucide-react';
import { CVCNavbar } from '../components/CVCNavbar';
import { Link } from 'react-router';
import { api } from '../api/client';
import { cls } from '../components/tokens';

interface SourcingCompany {
  id: number;
  name: string;
  sector?: string;
  stage?: string;
  location?: string;
  raised?: string;
  one_liner?: string;
  signal_score?: number;
  intro_count?: number;
}

interface Shortlist {
  id: number;
  name: string;
}

interface ShortlistModal {
  open: boolean;
  companyId: number | null;
  companyName: string;
}

const SECTORS = ['All Sectors', 'Robotics', 'Manufacturing', 'Supply Chain', 'Industrial Automation', 'Physical AI'];
const STAGES  = ['All Stages', 'Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C+'];

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#F59E0B' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <div style={{ width: 64, height: 6, backgroundColor: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#33322c', minWidth: 32 }}>{Math.round(score)}</span>
    </div>
  );
}

export default function SourcingView() {
  const [companies, setCompanies]     = useState<SourcingCompany[]>([]);
  const [loading, setLoading]         = useState(true);
  const [q, setQ]                     = useState('');
  const [sector, setSector]           = useState('');
  const [stage, setStage]             = useState('');
  const [total, setTotal]             = useState(0);

  const [shortlists, setShortlists]   = useState<Shortlist[]>([]);
  const [modal, setModal]             = useState<ShortlistModal>({ open: false, companyId: null, companyName: '' });
  const [newListName, setNewListName] = useState('');
  const [creating, setCreating]       = useState(false);
  const [toast, setToast]             = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async (params: { q?: string; sector?: string; stage?: string }) => {
    setLoading(true);
    try {
      const data = await api.getSourcingTargets({ ...params, limit: 100 });
      setCompanies(data.companies ?? []);
      setTotal(data.total ?? (data.companies ?? []).length);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load({}); }, []);

  const applyFilters = () => {
    load({
      q:      q.trim()   || undefined,
      sector: sector     || undefined,
      stage:  stage      || undefined,
    });
  };

  const openShortlistModal = async (company: SourcingCompany) => {
    setModal({ open: true, companyId: company.id, companyName: company.name });
    setNewListName('');
    try {
      const data = await api.getShortlists();
      setShortlists(data.shortlists ?? data ?? []);
    } catch (e) {
      console.error(e);
    }
  };

  const addToExisting = async (listId: number) => {
    if (!modal.companyId) return;
    try {
      await api.addToShortlist(listId, modal.companyId);
      showToast(`${modal.companyName} added to shortlist`);
      setModal({ open: false, companyId: null, companyName: '' });
    } catch (e) {
      console.error(e);
    }
  };

  const createAndAdd = async () => {
    if (!newListName.trim() || !modal.companyId) return;
    setCreating(true);
    try {
      const list = await api.createShortlist(newListName.trim());
      await api.addToShortlist(list.id, modal.companyId);
      showToast(`${modal.companyName} added to "${newListName.trim()}"`);
      setModal({ open: false, companyId: null, companyName: '' });
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  };

  return (
    <div className={cls.page}>
      <CVCNavbar active="sourcing" />

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '2rem' }}>
        {/* Report Header */}
        <div className="border-b-2 border-[#33322c] pb-5 mb-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">SLAM · Deal Flow</p>
          <div className="flex items-baseline justify-between">
            <h1 className={cls.pageTitle}>Sourcing</h1>
            <span className="text-sm text-slate-500">{total} companies ranked by signal score</span>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ position: 'relative', flex: '1 1 260px' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#787569' }} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyFilters()}
              placeholder="Search companies…"
              style={{ width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8, border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.9rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          <select value={sector} onChange={e => setSector(e.target.value === 'All Sectors' ? '' : e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.9rem', fontFamily: 'inherit', backgroundColor: 'white' }}>
            {SECTORS.map(s => <option key={s} value={s === 'All Sectors' ? '' : s}>{s}</option>)}
          </select>
          <select value={stage} onChange={e => setStage(e.target.value === 'All Stages' ? '' : e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.9rem', fontFamily: 'inherit', backgroundColor: 'white' }}>
            {STAGES.map(s => <option key={s} value={s === 'All Stages' ? '' : s}>{s}</option>)}
          </select>
          <button onClick={applyFilters}
            style={{ padding: '8px 20px', backgroundColor: '#33322c', color: 'var(--color-cvc-gold)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem', fontFamily: 'inherit', fontWeight: 600 }}>
            Search
          </button>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#666' }}>Loading…</div>
        ) : (
          <div style={{ backgroundColor: 'white', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e2e8f0' }}>
                  {['Company', 'Sector', 'Stage', 'Raised', 'Signal Score', ''].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '0.8rem', color: '#545249', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {companies.map((c, i) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <Link to={`/company/${c.id}`} style={{ color: '#33322c', fontWeight: 600, textDecoration: 'none', fontSize: '0.95rem' }}>{c.name}</Link>
                      {c.one_liner && <div style={{ color: '#545249', fontSize: '0.8rem', marginTop: 2, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.one_liner}</div>}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#33322c', fontSize: '0.9rem' }}>{c.sector || '—'}</td>
                    <td style={{ padding: '12px 16px', color: '#33322c', fontSize: '0.9rem', textTransform: 'capitalize' }}>{c.stage?.replace('_', ' ') || '—'}</td>
                    <td style={{ padding: '12px 16px', color: '#33322c', fontSize: '0.9rem' }}>{c.raised || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {c.signal_score != null ? <ScoreBar score={c.signal_score} /> : <span style={{ color: '#787569', fontSize: '0.85rem' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button
                        onClick={() => openShortlistModal(c)}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', backgroundColor: '#f3f4f6', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'inherit', color: '#33322c', fontWeight: 500 }}
                      >
                        <Plus size={13} /> Shortlist
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {companies.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#545249' }}>No companies match your filters.</div>
            )}
          </div>
        )}
      </div>

      {/* Shortlist Modal */}
      {modal.open && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(37,59,73,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setModal({ open: false, companyId: null, companyName: '' }); }}>
          <div style={{ backgroundColor: 'white', borderRadius: 10, padding: '1.75rem', width: 420, maxWidth: '90vw', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, color: '#33322c', fontSize: '1.25rem' }}>Add to Shortlist</h2>
              <button onClick={() => setModal({ open: false, companyId: null, companyName: '' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#545249' }}><X size={18} /></button>
            </div>
            <p style={{ margin: '0 0 1.25rem', color: '#33322c', fontSize: '0.9rem' }}>
              Adding <strong>{modal.companyName}</strong>
            </p>

            {shortlists.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#545249', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Existing Lists</p>
                {shortlists.map(sl => (
                  <button key={sl.id} onClick={() => addToExisting(sl.id)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '8px 12px', marginBottom: 4, backgroundColor: '#f9fafb', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem', fontFamily: 'inherit', color: '#33322c', textAlign: 'left' }}>
                    {sl.name}
                    <Check size={14} style={{ color: '#787569' }} />
                  </button>
                ))}
              </div>
            )}

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#545249', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>New List</p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createAndAdd()}
                  placeholder="List name…"
                  style={{ flex: 1, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.9rem', fontFamily: 'inherit' }}
                />
                <button onClick={createAndAdd} disabled={creating || !newListName.trim()}
                  style={{ padding: '8px 16px', backgroundColor: '#33322c', color: 'var(--color-cvc-gold)', border: 'none', borderRadius: 6, cursor: creating || !newListName.trim() ? 'not-allowed' : 'pointer', fontSize: '0.9rem', fontFamily: 'inherit', fontWeight: 600, opacity: creating || !newListName.trim() ? 0.6 : 1 }}>
                  {creating ? '…' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, backgroundColor: '#33322c', color: 'var(--color-cvc-gold)', padding: '12px 20px', borderRadius: 8, fontSize: '0.9rem', fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 2000 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
