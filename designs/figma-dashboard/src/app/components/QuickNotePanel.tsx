/**
 * QuickNotePanel — fixed right-edge slide-out for capturing meeting notes.
 *
 * Context selector: Ventures | PSM | Sales
 * Ventures form: company search/create → date → 5 impression dimensions (1–5 + note) →
 *                personal note (private) → transcript paste/upload → submit.
 */

import { useState, useEffect, useRef } from 'react';
import { X, Pencil, ChevronRight, Star, Upload, Lock } from 'lucide-react';

function getJwt(): { Authorization: string } {
  const t = localStorage.getItem('platform_jwt');
  return t ? { Authorization: `Bearer ${t}` } : { Authorization: '' };
}

function getCurrentUsername(): string {
  try {
    const token = localStorage.getItem('platform_jwt');
    if (!token) return '';
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.sub ?? '';
  } catch { return ''; }
}

// ── Star rating ───────────────────────────────────────────────────────────────

function StarRating({
  value, onChange,
}: { value: number | null; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => {
        const filled = n <= (hovered ?? value ?? 0);
        return (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onChange(value === n ? 0 : n)}
            className="focus:outline-none transition-transform hover:scale-110"
            title={`${n}/5`}
          >
            <Star
              className={`w-5 h-5 transition-colors ${
                filled
                  ? 'fill-amber-400 stroke-amber-400'
                  : 'fill-transparent stroke-slate-300'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

// ── Company search ────────────────────────────────────────────────────────────

interface CompanyHit { id: number; name: string; sector?: string; }

type CompanySelection =
  | { kind: 'existing'; id: number; name: string }
  | { kind: 'new'; name: string; url: string }
  | null;

function CompanySearch({
  value, onChange,
}: {
  value: CompanySelection;
  onChange: (v: CompanySelection) => void;
}) {
  const [query,   setQuery]   = useState(value?.name ?? '');
  const [results, setResults] = useState<CompanyHit[]>([]);
  const [open,    setOpen]    = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/companies?q=${encodeURIComponent(query)}&limit=8`, { headers: getJwt() });
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
      } catch { setResults([]); }
    }, 250);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  function pickExisting(hit: CompanyHit) {
    setQuery(hit.name);
    setOpen(false);
    onChange({ kind: 'existing', id: hit.id, name: hit.name });
  }

  const url = value?.kind === 'new' ? value.url : '';

  return (
    <div>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => {
            const name = e.target.value;
            setQuery(name);
            // Always treat typed name as new company — picking from dropdown upgrades to existing
            onChange(name.trim().length >= 1 ? { kind: 'new', name: name.trim(), url } : null);
          }}
          onFocus={() => query.length >= 2 && results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Company name…"
          className="w-full px-3 py-2 text-sm bg-[#ede8d7] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-[#33322c] placeholder-[#a09a8a]"
        />
        {open && results.length > 0 && (
          <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-xl z-[60] overflow-hidden">
            {results.map(r => (
              <button
                key={r.id}
                onMouseDown={() => pickExisting(r)}
                className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-amber-50 transition-colors"
              >
                <span className="text-sm font-medium text-[#33322c] truncate">{r.name}</span>
                <span className="text-xs text-slate-400 shrink-0">{r.sector ?? ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* URL field — always visible once a name is typed */}
      {value?.kind === 'new' && (
        <input
          type="url"
          placeholder="Website URL (optional)"
          value={url}
          onChange={e => onChange({ kind: 'new', name: query.trim(), url: e.target.value })}
          className="mt-2 w-full px-3 py-2 text-sm bg-[#ede8d7] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-[#33322c] placeholder-[#a09a8a]"
        />
      )}
      {value?.kind === 'existing' && (
        <p className="mt-1 text-xs text-emerald-600 font-medium">✓ Linked to existing profile</p>
      )}
    </div>
  );
}

// ── Impression row ────────────────────────────────────────────────────────────

function ImpressionRow({
  label,
  rating,
  note,
  onRating,
  onNote,
}: {
  label:    string;
  rating:   number | null;
  note:     string;
  onRating: (v: number) => void;
  onNote:   (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-sm font-semibold text-[#33322c] w-32 shrink-0">{label}</span>
        <StarRating value={rating} onChange={onRating} />
        <ChevronRight className={`w-3.5 h-3.5 text-slate-400 ml-2 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-0 bg-slate-50/50">
          <textarea
            rows={2}
            value={note}
            onChange={e => onNote(e.target.value)}
            placeholder={`Notes on ${label.toLowerCase()}…`}
            className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-400 text-[#33322c] placeholder-[#a09a8a] resize-none"
          />
        </div>
      )}
    </div>
  );
}

// ── Sales lead search ─────────────────────────────────────────────────────────

interface LeadHit { id: number; company_name: string; stage: string; assigned_to: string | null; }

const STAGE_BADGES: Record<string, string> = {
  target:      'bg-slate-100 text-slate-600',
  nurturing:   'bg-blue-50 text-blue-700',
  proposal:    'bg-amber-50 text-amber-700',
  closed_won:  'bg-emerald-50 text-emerald-700',
  closed_lost: 'bg-red-50 text-red-600',
};
const STAGE_LABELS: Record<string, string> = {
  target: 'Target', nurturing: 'Nurturing', proposal: 'Proposal',
  closed_won: 'Won', closed_lost: 'Lost',
};

function LeadSearch({
  value, onChange,
}: {
  value: LeadHit | null;
  onChange: (v: LeadHit | null) => void;
}) {
  const [query,   setQuery]   = useState(value?.company_name ?? '');
  const [results, setResults] = useState<LeadHit[]>([]);
  const [open,    setOpen]    = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/sales/targets?q=${encodeURIComponent(query)}`, { headers: getJwt() });
        const data: LeadHit[] = await res.json();
        setResults(Array.isArray(data) ? data.slice(0, 8) : []);
        setOpen(true);
      } catch { setResults([]); }
    }, 250);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  function pick(hit: LeadHit) {
    setQuery(hit.company_name);
    setOpen(false);
    onChange(hit);
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(null); }}
        onFocus={() => query.length >= 2 && results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search sales leads…"
        className="w-full px-3 py-2 text-sm bg-[#ede8d7] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-[#33322c] placeholder-[#a09a8a]"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-xl z-[60] overflow-hidden">
          {results.map(r => (
            <button
              key={r.id}
              onMouseDown={() => pick(r)}
              className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-amber-50 transition-colors"
            >
              <span className="text-sm font-medium text-[#33322c] truncate">{r.company_name}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STAGE_BADGES[r.stage] ?? 'bg-slate-100 text-slate-500'}`}>
                {STAGE_LABELS[r.stage] ?? r.stage}
              </span>
            </button>
          ))}
        </div>
      )}
      {value && (
        <p className="mt-1 text-xs text-emerald-600 font-medium">
          ✓ Linked · <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-bold ${STAGE_BADGES[value.stage] ?? 'bg-slate-100 text-slate-500'}`}>
            {STAGE_LABELS[value.stage] ?? value.stage}
          </span>
          {value.assigned_to && <span className="text-slate-400"> · {value.assigned_to}</span>}
        </p>
      )}
    </div>
  );
}

// ── Simple rating row (no expandable note — sales dims are just ratings) ───────

function RatingRow({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#33322c] w-40 shrink-0">{label}</span>
      <StarRating value={value} onChange={v => onChange(v === (value ?? 0) ? 0 : v)} />
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type Context = 'ventures' | 'psm' | 'sales';

interface Impressions {
  rating_founder:    number | null;
  note_founder:      string;
  rating_market:     number | null;
  note_market:       string;
  rating_tech:       number | null;
  note_tech:         string;
  rating_business:   number | null;
  note_business:     string;
  rating_deployment: number | null;
  note_deployment:   string;
}

const BLANK_IMPRESSIONS: Impressions = {
  rating_founder: null,    note_founder: '',
  rating_market:  null,    note_market:  '',
  rating_tech:    null,    note_tech:    '',
  rating_business: null,   note_business: '',
  rating_deployment: null, note_deployment: '',
};

interface SalesRatings {
  rating_buying_intent:  number | null;
  rating_dm_access:      number | null;
  rating_budget_fit:     number | null;
  rating_strategic_fit:  number | null;
  rating_timeline:       number | null;
}

const BLANK_SALES_RATINGS: SalesRatings = {
  rating_buying_intent: null,
  rating_dm_access:     null,
  rating_budget_fit:    null,
  rating_strategic_fit: null,
  rating_timeline:      null,
};

export function QuickNotePanel({ darkPage = false, defaultContext = 'ventures' }: { darkPage?: boolean; defaultContext?: Context }) {
  const [open,     setOpen]     = useState(false);
  const [context,  setContext]  = useState<Context>(defaultContext);

  // ── Ventures state ──
  const [company,  setCompany]  = useState<CompanySelection>(null);
  const [metAt,    setMetAt]    = useState(() => new Date().toISOString().slice(0, 10));
  const [imp,      setImp]      = useState<Impressions>(BLANK_IMPRESSIONS);
  const [personal, setPersonal] = useState('');
  const [transcript, setTranscript] = useState('');

  // ── Sales state ──
  const [salesLead,        setSalesLead]        = useState<LeadHit | null>(null);
  const [salesDate,        setSalesDate]        = useState(() => new Date().toISOString().slice(0, 10));
  const [techInterest,     setTechInterest]     = useState('');
  const [techChallenge,    setTechChallenge]    = useState('');
  const [salesRatings,     setSalesRatings]     = useState<SalesRatings>(BLANK_SALES_RATINGS);
  const [salesPersonal,    setSalesPersonal]    = useState('');
  const [salesTranscript,  setSalesTranscript]  = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [done,     setDone]     = useState(false);
  const [error,    setError]    = useState('');
  const fileRef     = useRef<HTMLInputElement>(null);
  const salesFileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setCompany(null);
    setMetAt(new Date().toISOString().slice(0, 10));
    setImp(BLANK_IMPRESSIONS);
    setPersonal('');
    setTranscript('');
    setSalesLead(null);
    setSalesDate(new Date().toISOString().slice(0, 10));
    setTechInterest('');
    setTechChallenge('');
    setSalesRatings(BLANK_SALES_RATINGS);
    setSalesPersonal('');
    setSalesTranscript('');
    setDone(false);
    setError('');
  }

  function setImpField<K extends keyof Impressions>(key: K, val: Impressions[K]) {
    setImp(prev => ({ ...prev, [key]: val }));
  }

  async function handleFileRead(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.endsWith('.pdf')) {
      setTranscript(`[PDF attached: ${file.name} — paste text content below or submit as-is]`);
    } else {
      const text = await file.text();
      setTranscript(text);
    }
    e.target.value = '';
  }

  async function submit() {
    if (!company) { setError('Select or create a company first.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        context_type:       context,
        met_at:             metAt,
        company_name:       company.name,
        company_url:        company.kind === 'new' ? company.url || null : null,
        company_id:         company.kind === 'existing' ? company.id : null,
        personal_note:      personal || null,
        transcript_text:    transcript || null,
        ...imp,
      };
      // Null out 0-ratings (user cleared)
      for (const k of ['rating_founder','rating_market','rating_tech','rating_business','rating_deployment'] as const) {
        if (body[k] === 0) body[k] = null;
      }
      const res = await fetch('/notes', {
        method: 'POST',
        headers: { ...getJwt(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());

      // If new company with a URL, fire QuickAdd in background to seed the profile
      if (company.kind === 'new' && company.url?.trim()) {
        fetch('/admin/quickadd', {
          method: 'POST',
          headers: { ...getJwt(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: company.url.trim() }),
        }).catch(() => {/* silent — enrichment is best-effort */});
      }

      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSales() {
    if (!salesLead) { setError('Select a lead account first.'); return; }
    setSubmitting(true);
    setError('');
    try {
      // Build a human-readable body so it's legible in plain-text note views too
      const lines: string[] = [`Meeting: ${salesDate}`];
      if (techInterest)  lines.push(`Tech Interest: ${techInterest}`);
      if (techChallenge) lines.push(`Tech Challenge: ${techChallenge}`);
      const bodyText = lines.join('\n');

      const payload: Record<string, unknown> = {
        note_type:            'meeting',
        body:                 bodyText,
        meeting_date:         salesDate,
        tech_interest:        techInterest   || null,
        tech_challenge:       techChallenge  || null,
        personal_note:        salesPersonal  || null,
        transcript_text:      salesTranscript || null,
        ...Object.fromEntries(
          Object.entries(salesRatings).map(([k, v]) => [k, v === 0 ? null : v])
        ),
      };

      const res = await fetch(`/sales/targets/${salesLead.id}/notes`, {
        method:  'POST',
        headers: { ...getJwt(), 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  const CONTEXTS: { key: Context; label: string }[] = [
    { key: 'ventures', label: 'Ventures' },
    { key: 'psm',      label: 'PSM'      },
    { key: 'sales',    label: 'Sales'    },
  ];

  return (
    <>
      {/* Tab trigger — fixed right edge */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed right-0 top-1/2 -translate-y-1/2 z-[55] rounded-l-lg px-2 py-4 flex flex-col items-center gap-1.5 shadow-lg transition-colors ${
          darkPage
            ? 'bg-[#f5f5f0] text-[#253B49] border-l border-t border-b border-slate-300 hover:bg-white'
            : 'bg-[#151411] text-cvc-gold border-l border-t border-b border-white/10 hover:bg-[#1e293b]'
        }`}
        title="Quick Note"
      >
        <Pencil className="w-4 h-4" />
        <span className="text-[10px] font-bold uppercase tracking-widest [writing-mode:vertical-rl] rotate-180">
          Note
        </span>
      </button>

      {/* Slide-out panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] bg-white shadow-2xl z-[54] border-l border-slate-200 flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-[#151411] shrink-0">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-cvc-gold" />
            <span className="text-white font-bold text-sm tracking-tight">Quick Note</span>
          </div>
          <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Context selector — hidden when defaultContext locks the panel to one mode */}
        <div className={`flex gap-2 px-5 py-3 border-b border-slate-100 shrink-0 ${defaultContext !== 'ventures' ? 'hidden' : ''}`}>
          {CONTEXTS.map(c => (
            <button
              key={c.key}
              onClick={() => { setContext(c.key); reset(); }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors border ${
                context === c.key
                  ? 'bg-[#151411] text-cvc-gold border-[#151411]'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {context === 'ventures' ? (
            <div className="flex flex-col gap-4">
              {/* Company */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Company
                </label>
                <CompanySearch value={company} onChange={setCompany} />
              </div>

              {/* Meeting date */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Meeting Date
                </label>
                <input
                  type="date"
                  value={metAt}
                  onChange={e => setMetAt(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#ede8d7] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-[#33322c]"
                />
              </div>

              {/* Impressions */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Impressions
                </label>
                <div className="flex flex-col gap-2">
                  <ImpressionRow
                    label="Founder / Team"
                    rating={imp.rating_founder}
                    note={imp.note_founder}
                    onRating={v => setImpField('rating_founder', v || null)}
                    onNote={v => setImpField('note_founder', v)}
                  />
                  <ImpressionRow
                    label="Market"
                    rating={imp.rating_market}
                    note={imp.note_market}
                    onRating={v => setImpField('rating_market', v || null)}
                    onNote={v => setImpField('note_market', v)}
                  />
                  <ImpressionRow
                    label="Technology"
                    rating={imp.rating_tech}
                    note={imp.note_tech}
                    onRating={v => setImpField('rating_tech', v || null)}
                    onNote={v => setImpField('note_tech', v)}
                  />
                  <ImpressionRow
                    label="Business"
                    rating={imp.rating_business}
                    note={imp.note_business}
                    onRating={v => setImpField('rating_business', v || null)}
                    onNote={v => setImpField('note_business', v)}
                  />
                  <ImpressionRow
                    label="Deployment"
                    rating={imp.rating_deployment}
                    note={imp.note_deployment}
                    onRating={v => setImpField('rating_deployment', v || null)}
                    onNote={v => setImpField('note_deployment', v)}
                  />
                </div>
              </div>

              {/* Personal note — private */}
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  <Lock className="w-3 h-3" />
                  Personal Note
                  <span className="normal-case font-normal text-slate-300 tracking-normal">— private to you</span>
                </label>
                <textarea
                  rows={3}
                  value={personal}
                  onChange={e => setPersonal(e.target.value)}
                  placeholder="Your gut read. Only you can see this."
                  className="w-full px-3 py-2 text-sm bg-[#ede8d7] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-[#33322c] placeholder-[#a09a8a] resize-none"
                />
              </div>

              {/* Transcript */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Transcript / Notes
                </label>
                <textarea
                  rows={4}
                  value={transcript}
                  onChange={e => setTranscript(e.target.value)}
                  placeholder="Paste Granola transcript or meeting notes here…"
                  className="w-full px-3 py-2 text-sm bg-[#ede8d7] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-[#33322c] placeholder-[#a09a8a] resize-none"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500 hover:text-[#33322c] transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload file (TXT / PDF)
                </button>
                <input ref={fileRef} type="file" accept=".txt,.pdf,.md" onChange={handleFileRead} className="hidden" />
              </div>

              {/* Error */}
              {error && (
                <p className="text-xs text-red-500 font-medium">{error}</p>
              )}

              {/* Submit / success */}
              {done ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                    <span className="text-emerald-600 text-lg font-bold">✓</span>
                  </div>
                  <p className="text-sm font-semibold text-[#33322c]">Note saved!</p>
                  <button
                    onClick={reset}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-[#33322c] border border-slate-200 rounded-lg transition-colors"
                  >
                    Log another
                  </button>
                </div>
              ) : (
                <button
                  onClick={submit}
                  disabled={submitting || !company}
                  className="w-full py-2.5 bg-[#151411] text-cvc-gold font-bold text-sm rounded-lg hover:bg-[#1e293b] disabled:opacity-40 transition-colors"
                >
                  {submitting ? 'Saving…' : 'Submit Note'}
                </button>
              )}
            </div>
          ) : context === 'sales' ? (
            // ── Sales form ──────────────────────────────────────────────────
            <div className="flex flex-col gap-4">

              {/* Lead search */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Lead Account
                </label>
                <LeadSearch value={salesLead} onChange={setSalesLead} />
              </div>

              {/* Meeting date */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Meeting Date
                </label>
                <input
                  type="date"
                  value={salesDate}
                  onChange={e => setSalesDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#ede8d7] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-[#33322c]"
                />
              </div>

              {/* Tech fields */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Tech Interest
                </label>
                <textarea
                  rows={2}
                  value={techInterest}
                  onChange={e => setTechInterest(e.target.value)}
                  placeholder="What technology or capability are they exploring?"
                  className="w-full px-3 py-2 text-sm bg-[#ede8d7] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-[#33322c] placeholder-[#a09a8a] resize-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Tech Challenge
                </label>
                <textarea
                  rows={2}
                  value={techChallenge}
                  onChange={e => setTechChallenge(e.target.value)}
                  placeholder="What problem are they trying to solve?"
                  className="w-full px-3 py-2 text-sm bg-[#ede8d7] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-[#33322c] placeholder-[#a09a8a] resize-none"
                />
              </div>

              {/* Ratings */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                  Assessment
                </label>
                <div className="flex flex-col gap-2.5 bg-[#F8FAFC] border border-slate-100 rounded-lg px-3 py-3">
                  <RatingRow label="Buying Intent"     value={salesRatings.rating_buying_intent}  onChange={v => setSalesRatings(r => ({ ...r, rating_buying_intent: v || null }))} />
                  <RatingRow label="DM Access"         value={salesRatings.rating_dm_access}      onChange={v => setSalesRatings(r => ({ ...r, rating_dm_access: v || null }))} />
                  <RatingRow label="Budget Fit"        value={salesRatings.rating_budget_fit}     onChange={v => setSalesRatings(r => ({ ...r, rating_budget_fit: v || null }))} />
                  <RatingRow label="Strategic Fit"     value={salesRatings.rating_strategic_fit}  onChange={v => setSalesRatings(r => ({ ...r, rating_strategic_fit: v || null }))} />
                  <RatingRow label="Close Timeline"    value={salesRatings.rating_timeline}       onChange={v => setSalesRatings(r => ({ ...r, rating_timeline: v || null }))} />
                </div>
              </div>

              {/* Personal note */}
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  <Lock className="w-3 h-3" />
                  Personal Note
                  <span className="normal-case font-normal text-slate-300 tracking-normal">— private to you</span>
                </label>
                <textarea
                  rows={2}
                  value={salesPersonal}
                  onChange={e => setSalesPersonal(e.target.value)}
                  placeholder="Your read on this deal. Only you can see this."
                  className="w-full px-3 py-2 text-sm bg-[#ede8d7] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-[#33322c] placeholder-[#a09a8a] resize-none"
                />
              </div>

              {/* Transcript */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Transcript / Notes
                </label>
                <textarea
                  rows={3}
                  value={salesTranscript}
                  onChange={e => setSalesTranscript(e.target.value)}
                  placeholder="Paste Granola transcript or call notes…"
                  className="w-full px-3 py-2 text-sm bg-[#ede8d7] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-[#33322c] placeholder-[#a09a8a] resize-none"
                />
                <button
                  type="button"
                  onClick={() => salesFileRef.current?.click()}
                  className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500 hover:text-[#33322c] transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload file (TXT / PDF)
                </button>
                <input
                  ref={salesFileRef}
                  type="file"
                  accept=".txt,.pdf,.md"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.name.endsWith('.pdf')) {
                      setSalesTranscript(`[PDF: ${file.name}]`);
                    } else {
                      setSalesTranscript(await file.text());
                    }
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </div>

              {error && <p className="text-xs text-red-500 font-medium">{error}</p>}

              {done ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                    <span className="text-emerald-600 text-lg font-bold">✓</span>
                  </div>
                  <p className="text-sm font-semibold text-[#33322c]">Note saved to lead!</p>
                  <button onClick={reset} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-[#33322c] border border-slate-200 rounded-lg transition-colors">
                    Log another
                  </button>
                </div>
              ) : (
                <button
                  onClick={submitSales}
                  disabled={submitting || !salesLead}
                  className="w-full py-2.5 bg-[#151411] text-cvc-gold font-bold text-sm rounded-lg hover:bg-[#1e293b] disabled:opacity-40 transition-colors"
                >
                  {submitting ? 'Saving…' : 'Submit Note'}
                </button>
              )}
            </div>
          ) : (
            // PSM stub
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                <Pencil className="w-5 h-5 text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-600">PSM Quick Notes</p>
              <p className="text-xs text-slate-400 max-w-[240px]">Coming soon — PSM partner note capture.</p>
            </div>
          )}
        </div>
      </div>

      {/* Dim overlay when open (non-blocking — click-through) */}
      {open && (
        <div
          className="fixed inset-0 z-[53] bg-black/10"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}
