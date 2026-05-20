import { useState } from 'react';
import { Upload, Users, CheckCircle, ArrowRight, X, Building2, Handshake, BarChart2, FileText, Sparkles } from 'lucide-react';
import { AUTH_HEADER as AUTH } from '../api/client';
import { cls } from './tokens';

interface Props {
  teamName: string;
  onComplete: () => void;
}

type Path = 'demo' | 'import' | null;

interface ImportResult {
  inserted: number;
  skipped: number;
  failed: number;
  errors: string[];
}

const STEPS = ['welcome', 'data', 'companies', 'partners', 'team', 'done'] as const;
type Step = typeof STEPS[number];

export default function OnboardingWizard({ teamName, onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [path, setPath] = useState<Path>(null);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedDone, setSeedDone] = useState(false);
  const [coFile, setCoFile] = useState<File | null>(null);
  const [coResult, setCoResult] = useState<ImportResult | null>(null);
  const [coLoading, setCoLoading] = useState(false);
  const [paFile, setPaFile] = useState<File | null>(null);
  const [paResult, setPaResult] = useState<ImportResult | null>(null);
  const [paLoading, setPaLoading] = useState(false);

  const stepIndex = STEPS.indexOf(step);

  function dismiss() {
    localStorage.setItem('platform_onboarding_v1', 'done');
    onComplete();
  }

  async function loadDemo() {
    setSeedLoading(true);
    try {
      const res = await fetch('/admin/seed-demo', { method: 'POST', headers: { ...AUTH } });
      if (res.ok) { setSeedDone(true); setStep('done'); }
    } finally {
      setSeedLoading(false);
    }
  }

  async function importCompanies() {
    if (!coFile) return;
    setCoLoading(true);
    try {
      const form = new FormData();
      form.append('file', coFile);
      const res = await fetch('/admin/companies/import', { method: 'POST', headers: { ...AUTH }, body: form });
      setCoResult(await res.json());
    } finally {
      setCoLoading(false);
    }
  }

  async function importPartners() {
    if (!paFile) return;
    setPaLoading(true);
    try {
      const form = new FormData();
      form.append('file', paFile);
      const res = await fetch('/admin/partners/import', { method: 'POST', headers: { ...AUTH }, body: form });
      setPaResult(await res.json());
    } finally {
      setPaLoading(false);
    }
  }

  // Progress dots — only show for import path
  const showProgress = path === 'import' && step !== 'welcome' && step !== 'data';
  const importSteps: Step[] = ['companies', 'partners', 'team', 'done'];
  const importIndex = importSteps.indexOf(step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">

        {/* Header bar */}
        <div className="bg-[#151411] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cvc-gold flex items-center justify-center">
              <span className="text-[#151411] font-bold text-sm">{teamName.charAt(0).toUpperCase()}</span>
            </div>
            <span className="text-white font-semibold text-sm">{teamName}</span>
          </div>
          {showProgress && (
            <div className="flex items-center gap-2">
              {importSteps.slice(0, -1).map((s, i) => (
                <div key={s} className={`w-2 h-2 rounded-full transition-colors ${
                  i < importIndex ? 'bg-cvc-gold' : i === importIndex ? 'bg-white' : 'bg-white/30'
                }`} />
              ))}
            </div>
          )}
          <button onClick={dismiss} className="text-white/40 hover:text-white/80 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-8">

          {/* ── Welcome ── */}
          {step === 'welcome' && (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#787569] mb-2">Getting started</p>
              <h2 className="text-2xl font-bold text-[#33322c] mb-2">Welcome to {teamName}</h2>
              <p className="text-[#545249] mb-6">Your private VC operations platform is ready. Here's what's included:</p>

              <div className="grid grid-cols-2 gap-3 mb-8">
                {[
                  { icon: Building2, label: 'Ventures', desc: 'Company database + deal pipeline' },
                  { icon: Handshake, label: 'Partners', desc: 'Corporate partner CRM' },
                  { icon: BarChart2, label: 'Pipeline', desc: 'Sales, sourcing, requests' },
                  { icon: FileText, label: 'Reports', desc: 'Meeting notes, briefings, data explorer' },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="w-8 h-8 rounded bg-[#33322c] flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[#33322c]">{label}</div>
                      <div className="text-xs text-[#787569]">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setPath('demo'); setStep('data'); }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-[#33322c] rounded-lg text-sm font-semibold text-[#33322c] hover:bg-[#33322c] hover:text-white transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  Explore with demo data
                </button>
                <button
                  onClick={() => { setPath('import'); setStep('companies'); }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-[#33322c] rounded-lg text-sm font-semibold text-white hover:bg-[#151411] transition-colors"
                >
                  Import my data
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              <button onClick={dismiss} className="w-full mt-3 text-xs text-[#787569] hover:text-[#33322c] py-1">
                Skip for now
              </button>
            </div>
          )}

          {/* ── Demo loading ── */}
          {step === 'data' && path === 'demo' && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-2xl bg-[#33322c] flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-7 h-7 text-cvc-gold" />
              </div>
              <h2 className="text-xl font-bold text-[#33322c] mb-2">Load demo data</h2>
              <p className="text-sm text-[#545249] mb-2">
                Loads 20 sample companies across sectors and stages, plus 5 corporate partners with matched opportunities.
              </p>
              <p className="text-xs text-[#787569] mb-8">
                All demo records are tagged so you can delete them anytime:<br />
                <code className="bg-slate-100 px-1 rounded">DELETE FROM cvc.companies WHERE enrichment_source = 'demo_seed'</code>
              </p>
              <button
                onClick={loadDemo}
                disabled={seedLoading}
                className="px-8 py-3 bg-[#33322c] text-white text-sm font-semibold rounded-lg hover:bg-[#151411] disabled:opacity-60 transition-colors"
              >
                {seedLoading ? 'Loading…' : 'Load Demo Data'}
              </button>
              <div className="mt-3">
                <button onClick={() => setStep('companies')} className="text-xs text-[#787569] hover:text-[#33322c]">
                  Skip — I'll import my own data instead
                </button>
              </div>
            </div>
          )}

          {/* ── Import Companies ── */}
          {step === 'companies' && (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#787569] mb-2">Step 1 of 3</p>
              <h2 className="text-xl font-bold text-[#33322c] mb-1">Import your deal flow</h2>
              <p className="text-sm text-[#545249] mb-5">
                Export a CSV from Airtable, Notion, or any spreadsheet. Required column: <code className="bg-slate-100 px-1 rounded text-xs">name</code>.
                Optional: website, sector, stage, hq_city, hq_country, founded, employee_count, total_raised_usd, one_liner.
              </p>

              {!coResult ? (
                <>
                  <label className="block w-full border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-[#33322c] transition-colors mb-4">
                    <Upload className="w-7 h-7 mx-auto mb-2 text-[#787569]" />
                    <span className="text-sm font-medium text-[#545249]">
                      {coFile ? coFile.name : 'Click to select a CSV file'}
                    </span>
                    <p className="text-xs text-[#787569] mt-1">Column names are case-insensitive. Duplicates are skipped.</p>
                    <input type="file" accept=".csv" className="hidden" onChange={e => setCoFile(e.target.files?.[0] ?? null)} />
                  </label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setStep('partners')}
                      className="flex-1 px-4 py-2.5 border border-slate-200 text-sm text-[#545249] rounded-lg hover:border-[#33322c] transition-colors"
                    >
                      Skip
                    </button>
                    <button
                      onClick={importCompanies}
                      disabled={!coFile || coLoading}
                      className="flex-1 px-4 py-2.5 bg-[#33322c] text-white text-sm font-semibold rounded-lg hover:bg-[#151411] disabled:opacity-50 transition-colors"
                    >
                      {coLoading ? 'Importing…' : 'Import Companies'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-5 text-center">
                    <div className="bg-green-50 rounded-xl p-4">
                      <div className="text-3xl font-bold text-green-700">{coResult.inserted}</div>
                      <div className="text-xs text-green-600 mt-1 font-medium">Added</div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4">
                      <div className="text-3xl font-bold text-[#545249]">{coResult.skipped}</div>
                      <div className="text-xs text-[#787569] mt-1 font-medium">Skipped</div>
                    </div>
                    <div className="bg-red-50 rounded-xl p-4">
                      <div className="text-3xl font-bold text-red-600">{coResult.failed}</div>
                      <div className="text-xs text-red-500 mt-1 font-medium">Failed</div>
                    </div>
                  </div>
                  {coResult.errors.length > 0 && (
                    <div className="bg-red-50 rounded-lg p-3 text-xs text-red-700 mb-4 max-h-24 overflow-y-auto">
                      {coResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                    </div>
                  )}
                  <button
                    onClick={() => setStep('partners')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#33322c] text-white text-sm font-semibold rounded-lg hover:bg-[#151411] transition-colors"
                  >
                    Next: Import Partners
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Import Partners ── */}
          {step === 'partners' && (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#787569] mb-2">Step 2 of 3</p>
              <h2 className="text-xl font-bold text-[#33322c] mb-1">Import your partners</h2>
              <p className="text-sm text-[#545249] mb-5">
                Required column: <code className="bg-slate-100 px-1 rounded text-xs">name</code>.
                Optional: industry, contact_name, contact_email, challenge_areas, sectors_of_interest, notes.
                Comma-separated values in a cell become arrays.
              </p>

              {!paResult ? (
                <>
                  <label className="block w-full border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-[#33322c] transition-colors mb-4">
                    <Upload className="w-7 h-7 mx-auto mb-2 text-[#787569]" />
                    <span className="text-sm font-medium text-[#545249]">
                      {paFile ? paFile.name : 'Click to select a CSV file'}
                    </span>
                    <p className="text-xs text-[#787569] mt-1">Existing partners (matched by name) are skipped.</p>
                    <input type="file" accept=".csv" className="hidden" onChange={e => setPaFile(e.target.files?.[0] ?? null)} />
                  </label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setStep('team')}
                      className="flex-1 px-4 py-2.5 border border-slate-200 text-sm text-[#545249] rounded-lg hover:border-[#33322c] transition-colors"
                    >
                      Skip
                    </button>
                    <button
                      onClick={importPartners}
                      disabled={!paFile || paLoading}
                      className="flex-1 px-4 py-2.5 bg-[#33322c] text-white text-sm font-semibold rounded-lg hover:bg-[#151411] disabled:opacity-50 transition-colors"
                    >
                      {paLoading ? 'Importing…' : 'Import Partners'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-5 text-center">
                    <div className="bg-green-50 rounded-xl p-4">
                      <div className="text-3xl font-bold text-green-700">{paResult.inserted}</div>
                      <div className="text-xs text-green-600 mt-1 font-medium">Added</div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4">
                      <div className="text-3xl font-bold text-[#545249]">{paResult.skipped}</div>
                      <div className="text-xs text-[#787569] mt-1 font-medium">Skipped</div>
                    </div>
                    <div className="bg-red-50 rounded-xl p-4">
                      <div className="text-3xl font-bold text-red-600">{paResult.failed}</div>
                      <div className="text-xs text-red-500 mt-1 font-medium">Failed</div>
                    </div>
                  </div>
                  {paResult.errors.length > 0 && (
                    <div className="bg-red-50 rounded-lg p-3 text-xs text-red-700 mb-4 max-h-24 overflow-y-auto">
                      {paResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                    </div>
                  )}
                  <button
                    onClick={() => setStep('team')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#33322c] text-white text-sm font-semibold rounded-lg hover:bg-[#151411] transition-colors"
                  >
                    Next: Add Your Team
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Add Team ── */}
          {step === 'team' && (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#787569] mb-2">Step 3 of 3</p>
              <h2 className="text-xl font-bold text-[#33322c] mb-1">Add your team</h2>
              <p className="text-sm text-[#545249] mb-5">
                Create an account for each team member. Roles control what they can access.
              </p>
              <div className="rounded-xl border border-slate-200 overflow-hidden mb-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#787569]">Role</th>
                      <th className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#787569]">Access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[
                      ['GP', 'Everything — full admin access'],
                      ['Principal / Director', 'All data, no system config'],
                      ['Ventures', 'Companies, deal flow, DD, fund data'],
                      ['PSM', 'Assigned partners only'],
                    ].map(([role, access]) => (
                      <tr key={role}>
                        <td className="px-4 py-2.5 font-medium text-[#33322c]">{role}</td>
                        <td className="px-4 py-2.5 text-[#545249]">{access}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep('done')}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-sm text-[#545249] rounded-lg hover:border-[#33322c] transition-colors"
                >
                  I'll do this later
                </button>
                <a
                  href="/app/admin"
                  onClick={dismiss}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#33322c] text-white text-sm font-semibold rounded-lg hover:bg-[#151411] transition-colors"
                >
                  <Users className="w-4 h-4" />
                  Open User Management
                </a>
              </div>
            </div>
          )}

          {/* ── Done ── */}
          {step === 'done' && (
            <div className="text-center py-2">
              <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-[#33322c] mb-2">
                {seedDone ? 'Demo data loaded!' : 'You\'re all set'}
              </h2>
              <p className="text-sm text-[#545249] mb-8">
                {seedDone
                  ? 'Your platform is pre-populated with 20 sample companies and 5 partners. Explore the platform, then import your real data when ready.'
                  : 'Your platform is ready. You can import more data anytime from the Companies and Partners pages.'}
              </p>
              <div className="grid grid-cols-2 gap-3 mb-6 text-left">
                {[
                  { href: '/app/ventures', label: 'Ventures', desc: 'Browse your company database' },
                  { href: '/app/partners', label: 'Partners', desc: 'View your partner CRM' },
                  { href: '/app/admin', label: 'Admin', desc: 'Manage users and settings' },
                  { href: '/app/explore', label: 'Data Explorer', desc: 'Pre-built pipeline reports' },
                ].map(({ href, label, desc }) => (
                  <a
                    key={href}
                    href={href}
                    onClick={dismiss}
                    className="flex flex-col p-3 rounded-lg border border-slate-200 hover:border-[#33322c] transition-colors"
                  >
                    <span className="text-sm font-semibold text-[#33322c]">{label}</span>
                    <span className="text-xs text-[#787569] mt-0.5">{desc}</span>
                  </a>
                ))}
              </div>
              <button
                onClick={dismiss}
                className="px-8 py-3 bg-[#33322c] text-white text-sm font-semibold rounded-lg hover:bg-[#151411] transition-colors"
              >
                Start Exploring
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
