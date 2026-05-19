import { useState, useEffect } from 'react';
import ReportWorkspace from '../components/ReportWorkspace';
import { Link, useSearchParams } from 'react-router';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, BarChart, Bar,
} from 'recharts';
import { Shield, X, Globe, Pencil, Check, ExternalLink, TrendingUp, Cpu, Layers, ChevronDown, BookOpen, FileText } from 'lucide-react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
} from 'react-simple-maps';
import { cls } from '../components/tokens';
import { AUTH_HEADER as AUTH } from '../api/client';

const API_BASE = '';

const SECTORS = ['Robotics', 'Manufacturing', 'Supply Chain', 'Industrial Automation', 'Physical AI'];

const SECTOR_SLUG: Record<string, string> = {
  'Robotics':              'robotics',
  'Supply Chain':          'supply_chain',
  'Industrial Automation': 'industrial_auto',
  'Physical AI':           'physical_ai',
  'Manufacturing':         'manufacturing',
};

const SECTOR_COLORS: Record<string, string> = {
  'Robotics': '#6366f1',
  'Manufacturing': '#f59e0b',
  'Supply Chain': '#10b981',
  'Industrial Automation': '#ef4444',
  'Physical AI': '#8b5cf6',
};

interface SectorDef {
  definition: string;
  scope: string;
  tags: string[];
}

const SECTOR_DEFINITIONS: Record<string, SectorDef> = {
  'Robotics': {
    definition: 'Companies building or enabling physical robotic systems — including hardware, software, and the perception/control stack that makes machines move and act autonomously.',
    scope: 'Broad by design: any company whose core product is a robot or directly enables robots to operate is tracked here, regardless of the end market.',
    tags: [
      'Industrial Robotics', 'Warehouse Automation', 'Aerial Robotics (Drones)',
      'Agricultural Robotics', 'Construction Robotics', 'Logistics Automation',
      'AMR / Mobile Robots', 'Service Robotics', 'Medical Robotics',
      'Defense Robotics', 'Robotics Software & OS', 'Sensing & Perception',
      'Autonomous Vehicles', 'Space Robotics', 'Underwater / Maritime',
    ],
  },
  'Manufacturing': {
    definition: 'Companies that improve, digitize, or supply the manufacturing process — covering factory operations, process automation, quality control, materials, and the tooling that produces physical goods.',
    scope: 'Includes both pure manufacturing tech and adjacent suppliers (materials, equipment, industrial software) whose primary customer is a manufacturer.',
    tags: [
      'Factory Automation', 'Industrial IoT', 'Computer Vision / Inspection',
      'Advanced Materials', 'Semiconductor Design & Fab', 'Aerospace Manufacturing',
      'Automotive Manufacturing', 'Additive Manufacturing / 3D Printing',
      'Industrial Safety', 'Energy Management', 'Motor Controls',
      'Silicon Photonics / Laser Optics', 'AI/ML for Manufacturing',
      'Microelectronics', 'Construction Technology',
    ],
  },
  'Supply Chain': {
    definition: 'Companies that move, track, optimize, or de-risk the flow of goods — from raw materials through distribution to the end customer.',
    scope: 'Logistics, freight, warehousing, procurement, trade compliance, and any software layer that orchestrates physical goods movement. Includes cybersecurity and risk tools when the primary use case is supply chain resilience.',
    tags: [
      'Logistics & Freight', 'Warehouse Automation', 'Last-Mile Delivery',
      'Inventory & Procurement', 'Demand Forecasting', 'Trade Compliance',
      'Industrial IoT / Tracking', 'Agriculture & Food Supply Chain',
      'E-commerce Fulfillment', 'Supply Chain Risk & Resilience',
      'Automotive Supply Chain', 'Aerospace Supply Chain',
      'Document Processing / Customs', 'Sustainability & Emissions Tracking',
      'Cybersecurity (supply chain context)',
    ],
  },
  'Industrial Automation': {
    definition: 'Companies that automate industrial processes at the system level — integrating sensors, controllers, software, and connectivity to run facilities with less human intervention.',
    scope: 'Broader than robotics: includes industrial control systems (ICS/SCADA), process automation, building/facility automation, and the connectivity and security layer for OT environments. Cybersecurity companies whose primary customers are industrial operators (e.g. Claroty) belong here.',
    tags: [
      'Industrial IoT', 'SCADA / ICS', 'Process Automation',
      'Computer Vision / Machine Inspection', 'OT Cybersecurity',
      'Semiconductor Design', 'Construction Technology',
      'Precision Agriculture', 'Industrial Robotics',
      'Automotive Automation', 'Facility Management',
      'Edge AI / Embedded Intelligence', 'Industrial Analytics',
    ],
  },
  'Physical AI': {
    definition: 'Companies applying AI and machine learning directly to physical-world tasks — where the model\'s output drives actuation, navigation, or real-time decision-making in the physical environment.',
    scope: 'Distinct from pure software AI: the AI is the product\'s core value driver in a physical context. Includes autonomous systems, embodied AI, computer vision for real-world environments, and AI-native sensors.',
    tags: [
      'Embodied AI / Humanoid Robots', 'Autonomous Vehicles & Drones',
      'Computer Vision (physical deployment)', 'AI-Native Sensors',
      'Precision Agriculture (AI-driven)', 'Construction AI',
      'Aerospace Autonomy', 'Foundation Models for Robotics',
      'AI Simulation & Digital Twins', 'Edge AI Inference',
    ],
  },
};

const DEFAULT_WEIGHTS = { readiness: 0.4, sovereignty: 0.3, friction: 0.3 };
const WEIGHT_KEY = (sector: string) => `cvc_industrial_weights_${sector || 'all'}`;

function loadWeights(sector: string) {
  try {
    const stored = localStorage.getItem(WEIGHT_KEY(sector));
    if (stored) return JSON.parse(stored) as typeof DEFAULT_WEIGHTS;
  } catch { /* */ }
  return { ...DEFAULT_WEIGHTS };
}
function saveWeights(sector: string, w: typeof DEFAULT_WEIGHTS) {
  localStorage.setItem(WEIGHT_KEY(sector), JSON.stringify(w));
}

const PROTOCOL_WEIGHTS: Record<string, number> = {
  'OPC-UA': -3.0, 'MQTT': -3.0,
  'Siemens S7': -2.0, 'Rockwell ControlLogix': -2.0,
  'ROS2': -1.5, 'VDA 5050': -1.5, 'Public API': -1.5, 'SDK': -1.5,
  'Modbus': -1.0, 'Modbus TCP': -1.0, 'Profinet': -1.0,
  'EtherNet/IP': -1.0, 'EtherCAT': -1.0, 'CANopen': -1.0,
};

interface Source {
  id: number; url: string; type: 'primary' | 'secondary'; excerpt: string;
}

interface Company {
  id: number; name: string; sector: string; stage: string;
  readiness_score: number;
  sovereignty_score: number | null;
  sovereignty_tier: 'green' | 'yellow' | 'red' | 'unknown';
  friction_score: number;
  composite_score: number | null; composite_label: string;
  protocols: string[];
  deployment_signal: string | null; integration_notes: string | null;
  verified_certs: string[];
  hq_city: string | null; country: string | null;
  total_funding: number; intel_sources: Source[];
}

interface CountryData {
  country: string; avgSovereignty: number; count: number; companies: Company[];
}

interface IntelSignal {
  title: string; url?: string; source?: string; published_at?: string; summary?: string;
}
interface BibEntry {
  source_name: string; signal_count: number;
  signal_types: string[]; first_seen: string | null; last_seen: string | null;
  articles: { title: string; url: string; quarter: string }[];
}
interface FundingEvent {
  company_name: string; company_id: number | null; round_type: string;
  amount_usd: number | null; investors: string[]; event_date: string | null;
  source_url: string; quarter: string;
}
interface SectorIntel {
  narrative: string;
  narrative_quarter?: string;
  funding_data: { quarter: string; total_funding: number }[];
  funding_events: FundingEvent[];
  recent_signals: IntelSignal[];
  patent_count: number;
  bibliography: BibEntry[];
  signal_breakdown: { signal_type: string; count: number }[];
}

function computeComposite(
  readiness: number,
  sovereignty: number | null,
  friction: number | null,
  w: typeof DEFAULT_WEIGHTS,
): number | null {
  const hasSov = sovereignty !== null;
  const hasFri = friction !== null;
  if (!hasSov && !hasFri) return Math.round(readiness * 10) / 10;
  let score: number;
  if (hasSov && hasFri) {
    const total = w.readiness + w.sovereignty + w.friction;
    score = (readiness * w.readiness + sovereignty! * w.sovereignty + (10 - friction!) * w.friction) / total;
  } else if (hasSov) {
    score = readiness * 0.6 + sovereignty! * 0.4;
  } else {
    score = readiness * 0.6 + (10 - friction!) * 0.4;
  }
  return Math.round(score * 10) / 10;
}

function compositeLabel(score: number | null): string {
  if (score === null) return '—';
  if (score >= 7.5) return 'Integration King';
  if (score >= 5.0) return 'Watchlist';
  return 'Pilot Purgatory';
}

function formatFunding(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n > 0)              return `$${(n / 1_000).toFixed(0)}K`;
  return 'Undisclosed';
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SovereigntyBadge({ tier, score }: { tier: string; score: number | null }) {
  const configs: Record<string, { bg: string; text: string; border: string }> = {
    green:   { bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200' },
    yellow:  { bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200'   },
    red:     { bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200'     },
    unknown: { bg: 'bg-[#ede8d7]',    text: 'text-[#545249]',   border: 'border-slate-200'   },
  };
  const c = configs[tier] ?? configs.unknown;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      <Shield className="w-3 h-3" />
      {score !== null ? `${score}/10` : 'No data'}
    </span>
  );
}

function CompositeBadge({ score, label }: { score: number | null; label: string }) {
  if (score === null) return <span className="text-[#787569] text-xs">—</span>;
  const cls = score >= 7.5
    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : score >= 5.0
    ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-red-700 bg-red-50 border-red-200';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold border ${cls}`}>
      <span className="font-mono">{score}</span>
      <span className="opacity-70 text-[10px]">{label}</span>
    </span>
  );
}

function SourceCitation({ sources, field }: { sources: Source[]; field: string }) {
  if (!sources?.length) return null;
  const fieldSources = sources.filter(s => s.excerpt.toLowerCase().includes(field.toLowerCase()) || field === 'all');
  if (!fieldSources.length) return null;
  return (
    <span className="ml-1">
      {fieldSources.slice(0, 3).map(s => (
        <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"
          className="text-xs text-[#33322c] hover:underline font-semibold"
          onClick={e => e.stopPropagation()}>[{s.id}]</a>
      ))}
      {fieldSources.length > 3 && <span className="text-xs text-[#787569]">+{fieldSources.length - 3}</span>}
    </span>
  );
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: Company = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-white border border-slate-200 rounded shadow-lg p-3 max-w-xs text-xs">
      <div className="font-bold text-[#33322c] mb-0.5">{d.name}</div>
      <div className="text-[#787569] mb-2">{d.sector} · {d.stage}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
        <span className="text-[#787569]">Readiness</span>
        <span className="font-semibold text-[#33322c]">{d.readiness_score}/10</span>
        <span className="text-[#787569]">Friction</span>
        <span className="font-semibold text-[#33322c]">
          {d.friction_score !== null ? `${d.friction_score}/10` : <span className="italic text-[#787569]">Unverified</span>}
        </span>
        <span className="text-[#787569]">Signal</span>
        <span className="font-semibold text-[#33322c]">{d.deployment_signal ?? '—'}</span>
        <span className="text-[#787569]">Funding</span>
        <span className="font-semibold text-[#33322c]">{formatFunding(d.total_funding)}</span>
      </div>
      {(d.protocols?.length ?? 0) > 0 && (
        <div className="text-[#787569] mb-1">
          Protocols: <span className="text-[#33322c]">{d.protocols?.slice(0, 4).join(', ')}</span>
        </div>
      )}
      {d.integration_notes && (
        <div className="text-[#33322c] mt-2 border-t border-slate-200 pt-2">
          {d.integration_notes?.slice(0, 160)}{(d.integration_notes?.length ?? 0) > 160 ? '…' : ''}
        </div>
      )}
    </div>
  );
}

function SovereigntyCard({
  company, onClose, onScoresUpdated,
}: {
  company: Company;
  onClose: () => void;
  onScoresUpdated: (id: number, readiness: number, sovereignty: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editReadiness, setEditReadiness] = useState(String(company.readiness_score));
  const [editSovereignty, setEditSovereignty] = useState(
    company.sovereignty_score !== null ? String(company.sovereignty_score) : ''
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const saveScores = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const body: Record<string, number> = {};
      const r = parseFloat(editReadiness);
      const s = editSovereignty !== '' ? parseFloat(editSovereignty) : null;
      if (!isNaN(r)) body.readiness_score = r;
      if (s !== null && !isNaN(s)) body.sovereignty_score = s;
      const res = await fetch(`/industrial/${company.id}/scores`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? 'Save failed');
      onScoresUpdated(company.id, isNaN(r) ? company.readiness_score : r, s);
      setEditing(false);
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded shadow-xl p-6 mt-6">
      {/* Header */}
      <div className="flex items-start justify-between pb-4 mb-5 border-b border-slate-200">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Company Detail</div>
          <h3 className="text-xl font-bold text-[#33322c] tracking-tight">{company.name}</h3>
          <p className="text-sm text-[#545249] mt-0.5">{company.sector} · {company.stage}</p>
        </div>
        <div className="flex items-center gap-2">
          <SovereigntyBadge tier={company.sovereignty_tier} score={company.sovereignty_score} />
          <button
            onClick={() => { setEditing(!editing); setSaveError(''); }}
            className={`p-1.5 rounded border transition-colors ${editing ? 'bg-[#33322c] text-white border-[#33322c]' : 'text-[#787569] border-slate-200 hover:border-[#33322c] hover:text-[#33322c]'}`}
            title="Edit scores"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose} className="p-1.5 text-[#787569] hover:text-slate-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {editing && (
        <div className="bg-[#ede8d7] border border-slate-200 rounded p-4 mb-5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-3">Edit Scores</div>
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="block text-xs text-[#545249] mb-1">Readiness (0–10)</label>
              <input
                type="number" step="0.1" min="0" max="10"
                value={editReadiness}
                onChange={e => setEditReadiness(e.target.value)}
                className="w-24 bg-white border border-slate-200 rounded px-2 py-1.5 text-sm text-[#33322c] focus:outline-none focus:border-[#33322c]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#545249] mb-1">Sovereignty (0–10)</label>
              <input
                type="number" step="0.1" min="0" max="10"
                value={editSovereignty}
                placeholder="—"
                onChange={e => setEditSovereignty(e.target.value)}
                className="w-24 bg-white border border-slate-200 rounded px-2 py-1.5 text-sm text-[#33322c] focus:outline-none focus:border-[#33322c]"
              />
            </div>
            <div className="flex items-end gap-2 pb-0.5">
              <button
                onClick={saveScores}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#33322c] hover:bg-[#151411] text-white text-xs font-semibold rounded transition-colors disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} className="text-xs text-[#787569] hover:text-slate-700 px-2 py-1.5">
                Cancel
              </button>
            </div>
          </div>
          {saveError && <p className="text-xs text-red-600 mt-2">{saveError}</p>}
          <p className="text-[10px] text-[#787569] mt-2">One decimal place (e.g. 7.3). Changes persist immediately.</p>
        </div>
      )}

      {/* Score metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-[#f1f5f9] border border-slate-200 rounded mb-5">
        {[
          { label: 'Readiness', value: `${company.readiness_score}/10`, field: 'readiness',
            color: company.readiness_score >= 7 ? 'text-emerald-700' : company.readiness_score >= 5 ? 'text-amber-700' : 'text-red-700' },
          { label: 'Friction',
            value: company.friction_score !== null ? `${company.friction_score}/10` : 'Unverified', field: 'friction',
            color: company.friction_score === null ? 'text-[#787569]' : company.friction_score <= 4 ? 'text-emerald-700' : company.friction_score <= 7 ? 'text-amber-700' : 'text-red-700' },
          { label: 'Deployment', value: company.deployment_signal ?? '—', color: 'text-[#33322c]', field: 'deployment' },
          { label: 'Funding',   value: formatFunding(company.total_funding), color: 'text-[#33322c]', field: 'funding' },
        ].map(({ label, value, color, field }) => (
          <div key={label} className="px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">{label}</div>
            <div className={`font-bold text-sm ${color} flex items-center gap-1`}>
              {value}
              {field && <SourceCitation sources={company.intel_sources} field={field} />}
            </div>
          </div>
        ))}
      </div>

      {(company.protocols?.length ?? 0) > 0 && (
        <div className="mb-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Protocols</div>
          <div className="flex flex-wrap gap-1.5">
            {company.protocols.map(p => (
              <span key={p} className="bg-[#f1f5f9]/30 text-[#33322c] px-2 py-0.5 rounded text-xs font-medium">{p}</span>
            ))}
          </div>
        </div>
      )}

      {(company.verified_certs?.length ?? 0) > 0 && (
        <div className="mb-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Certifications</div>
          <div className="flex flex-wrap gap-1.5">
            {company.verified_certs.map(cert => (
              <span key={cert} className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-xs font-medium border border-emerald-200">{cert}</span>
            ))}
          </div>
        </div>
      )}

      {company.integration_notes && (
        <div className="bg-[#ede8d7] border border-slate-200 rounded p-4 mb-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Integration Notes</div>
          <p className="text-sm text-[#33322c] leading-relaxed">{company.integration_notes}</p>
        </div>
      )}

      <div className="flex justify-end pt-4 border-t border-slate-200">
        <Link to={`/companies/${company.id}`}
          className="px-4 py-2 bg-[#33322c] hover:bg-[#151411] text-white text-sm font-semibold rounded transition-colors">
          View Full Profile →
        </Link>
      </div>
    </div>
  );
}

// ── Geopolitical View ────────────────────────────────────────────────────────
const geoUrl = "https://unpkg.com/world-atlas@2/countries-110m.json";

function GeopoliticalView({ companies }: { companies: Company[] }) {
  const [countryData, setCountryData] = useState<Record<string, CountryData>>({});
  const [selectedCountry, setSelectedCountry] = useState<CountryData | null>(null);
  const [position, setPosition] = useState<{ coordinates: [number, number]; zoom: number }>({ coordinates: [0, 20], zoom: 1 });

  useEffect(() => {
    const data: Record<string, CountryData> = {};
    companies.forEach(c => {
      if (!c.country) return;
      if (!data[c.country]) data[c.country] = { country: c.country, avgSovereignty: 0, count: 0, companies: [] };
      data[c.country].count += 1;
      data[c.country].companies.push(c);
    });
    Object.values(data).forEach(cd => {
      const valid = cd.companies.map(c => c.sovereignty_score).filter(s => s !== null) as number[];
      cd.avgSovereignty = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
    });
    setCountryData(data);
  }, [companies]);

  const getColor = (score: number) => {
    if (score === 0) return "#cbd5e1";
    const r = Math.floor(255 * score / 10);
    const g = Math.floor(255 * (10 - score) / 10);
    return `rgb(${r}, ${g}, 0)`;
  };

  const countryCoords: Record<string, [number, number]> = {
    'United States': [-98, 39], 'Canada': [-96, 60], 'Mexico': [-102, 23],
    'United Kingdom': [-2, 54], 'Germany': [10, 51], 'France': [2, 46],
    'Netherlands': [5, 52], 'Sweden': [18, 62], 'Norway': [8, 61],
    'Denmark': [10, 56], 'Finland': [26, 64], 'Switzerland': [8, 47],
    'Austria': [14, 47], 'Belgium': [4, 51], 'Spain': [-4, 40],
    'Italy': [12, 43], 'Poland': [20, 52], 'Czech Republic': [16, 50],
    'Israel': [35, 31], 'India': [78, 22], 'China': [105, 35],
    'Japan': [138, 37], 'South Korea': [128, 36], 'Taiwan': [121, 24],
    'Singapore': [104, 1], 'Australia': [134, -25], 'New Zealand': [172, -42],
    'Brazil': [-55, -10], 'Chile': [-71, -35], 'Colombia': [-74, 4],
    'South Africa': [25, -29], 'United Arab Emirates': [54, 24],
  };

  return (
    <div className="mt-4">
      <div className="border border-slate-200 rounded overflow-hidden" style={{ height: 380 }}>
        <ComposableMap projection="geoMercator" className="w-full h-full" style={{ background: '#f8fafc' }}>
          <ZoomableGroup zoom={position.zoom} center={position.coordinates} onMoveEnd={setPosition}>
            <Geographies geography={geoUrl}>
              {({ geographies }) =>
                geographies.map(geo => {
                  const data = countryData[geo.properties.NAME];
                  return (
                    <Geography key={geo.rsmKey} geography={geo}
                      fill={data ? getColor(data.avgSovereignty) : "#e2e8f0"}
                      stroke="#ffffff" strokeWidth={0.5}
                      style={{ default: { outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }}
                      onClick={() => data && setSelectedCountry(data)}
                      className="cursor-pointer"
                    />
                  );
                })
              }
            </Geographies>
            {Object.values(countryData).filter(cd => cd.count >= 3 && countryCoords[cd.country]).map(cd => {
              const coords = countryCoords[cd.country];
              return (
                <Marker key={cd.country} coordinates={coords}>
                  <circle r={Math.sqrt(cd.count) * 3} fill="rgba(37,59,73,0.8)" stroke="white" strokeWidth={1}
                    className="cursor-pointer" onClick={() => setSelectedCountry(cd)} />
                  <text textAnchor="middle" y={4} fill="white" fontSize={8} fontWeight="bold">{cd.count}</text>
                </Marker>
              );
            })}
          </ZoomableGroup>
        </ComposableMap>
      </div>

      {selectedCountry && (
        <div className="border border-slate-200 rounded p-5 mt-3">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-0.5">Country View</div>
              <h3 className="font-bold text-[#33322c]">{selectedCountry.country}</h3>
            </div>
            <button onClick={() => setSelectedCountry(null)} className="text-[#787569] hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="text-xs text-[#545249] mb-3">
            Avg Sovereignty: <span className="font-semibold text-[#33322c]">{selectedCountry.avgSovereignty.toFixed(1)}/10</span>
            <span className="ml-3">{selectedCountry.count} companies tracked</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {selectedCountry.companies.map(c => (
              <div key={c.id} className="border border-slate-200 rounded p-3 hover:border-slate-200 transition-colors">
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex-1 min-w-0 mr-2">
                    <div className="font-semibold text-sm text-[#33322c] truncate">{c.name}</div>
                    <div className="text-xs text-[#787569] mt-0.5">{c.sector} · {c.stage}</div>
                  </div>
                  <SovereigntyBadge tier={c.sovereignty_tier} score={c.sovereignty_score} />
                </div>
                <div className="text-xs text-[#787569]">
                  Readiness: <span className="font-medium text-[#33322c]">{c.readiness_score}/10</span>
                </div>
                <Link to={`/companies/${c.id}`}
                  className="inline-flex items-center gap-1 text-xs text-[#33322c] hover:underline font-medium mt-2 transition-colors">
                  View Profile →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Methodology Tab ───────────────────────────────────────────────────────────
function MethodologyTab({ currentSector }: { currentSector: string }) {
  const [sector, setSector] = useState(currentSector);
  const [weights, setWeights] = useState(() => loadWeights(currentSector));
  const [saved, setSaved] = useState(false);

  const totalWeight = +(weights.readiness + weights.sovereignty + weights.friction).toFixed(2);
  const isValid = Math.abs(totalWeight - 1.0) < 0.005;

  const update = (key: keyof typeof weights, val: number) => {
    setWeights(w => ({ ...w, [key]: Math.round(val * 100) / 100 }));
    setSaved(false);
  };

  const handleSave = () => {
    if (!isValid) return;
    saveWeights(sector, weights);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSectorChange = (s: string) => {
    setSector(s);
    setWeights(loadWeights(s));
    setSaved(false);
  };

  const handleReset = () => {
    setWeights({ ...DEFAULT_WEIGHTS });
    setSaved(false);
  };

  return (
    <div className="space-y-6">
      {/* Composite formula */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Scoring Framework</div>
        <h2 className={`${cls.sectionTitle} mb-1`}>Composite Score Formula</h2>
        <p className="text-sm text-[#545249] mb-4">
          The composite score combines readiness, sovereignty, and friction into a single 0–10 signal.
          Weights are editable per sector and stored in your browser.
        </p>

        <div className="bg-[#ede8d7] border border-slate-200 rounded p-4 mb-5 font-mono text-sm text-[#33322c]">
          composite = (Readiness × W₁) + (Sovereignty × W₂) + ((10 − Friction) × W₃)
          <br />
          <span className="text-[#787569] text-xs">where W₁ + W₂ + W₃ = 1.0</span>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <label className="text-xs font-semibold text-[#33322c] uppercase tracking-wide">Weights for:</label>
          <select
            value={sector}
            onChange={e => handleSectorChange(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded text-sm text-[#33322c] bg-white focus:outline-none focus:border-[#33322c]"
          >
            <option value="">All Sectors (default)</option>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {([
            { key: 'readiness', label: 'Readiness (W₁)', desc: 'Pilot-to-Production progress' },
            { key: 'sovereignty', label: 'Sovereignty (W₂)', desc: 'Geopolitical resilience' },
            { key: 'friction', label: 'Friction (W₃)', desc: 'Integration difficulty (inverted)' },
          ] as { key: keyof typeof weights; label: string; desc: string }[]).map(({ key, label, desc }) => (
            <div key={key} className="border border-slate-200 rounded p-4">
              <div className="text-xs font-semibold text-[#33322c] mb-0.5">{label}</div>
              <div className="text-[10px] text-[#787569] mb-3">{desc}</div>
              <div className="flex items-center gap-2">
                <input
                  type="number" step="0.05" min="0" max="1"
                  value={weights[key]}
                  onChange={e => update(key, parseFloat(e.target.value) || 0)}
                  className="w-20 border border-slate-200 rounded px-2 py-1 text-sm text-[#33322c] focus:outline-none focus:border-[#33322c]"
                />
                <span className="text-sm text-[#545249]">{(weights[key] * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>

        <div className={`text-sm mb-4 font-medium ${isValid ? 'text-emerald-700' : 'text-red-600'}`}>
          Total: {(totalWeight * 100).toFixed(0)}% {isValid ? '✓' : '— must equal 100%'}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={!isValid}
            className="px-4 py-2 bg-[#33322c] text-white text-sm font-semibold rounded disabled:opacity-40 transition-colors hover:bg-[#151411]"
          >
            {saved ? '✓ Saved' : 'Save Weights'}
          </button>
          <button
            onClick={handleReset}
            className="px-4 py-2 border border-slate-200 text-[#33322c] text-sm font-medium rounded hover:bg-[#ede8d7] transition-colors"
          >
            Reset to defaults
          </button>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-6">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Definitions</div>
        <h2 className={`${cls.sectionTitle} mb-4`}>Score Definitions</h2>
        <div className="space-y-3">
          {[
            {
              name: 'Readiness Score (0–10)',
              color: 'text-blue-700',
              desc: 'Measures a company\'s progress from pilot project to full production deployment. High scores indicate enterprise-grade reliability, multi-site deployments, and reference customers in target industries.',
              high: '8–10: Active production deployments, Fortune 500 customers, proven ROI',
              mid:  '5–7: Pilot customers, some production use, maturing product',
              low:  '0–4: Pre-commercial, limited pilots, R&D stage',
            },
            {
              name: 'Friction Score (0–10, lower = better)',
              color: 'text-orange-700',
              desc: 'Integration difficulty — how hard is it to connect this product to industrial systems? Starts at 10.0, reduced by each protocol supported.',
              high: '8–10: No standard protocols, proprietary stack only',
              mid:  '4–7: Some standard protocols, moderate integration effort',
              low:  '0–3: OPC-UA, MQTT, open APIs — drops straight in',
            },
            {
              name: 'Sovereignty Score (0–10)',
              color: 'text-emerald-700',
              desc: 'Geopolitical resilience and data sovereignty risk. Considers country of incorporation, ownership structure, data storage location, export control exposure.',
              high: '8–10: US/allied domicile, no foreign ownership risk, FedRAMP/ITAR awareness',
              mid:  '4–7: Allied country, some third-party cloud exposure',
              low:  '0–3: Adversarial jurisdiction, opaque ownership, supply chain risk',
            },
            {
              name: 'Composite Score (0–10)',
              color: 'text-purple-700',
              desc: 'Weighted average of the three scores above. Weights are configurable per sector. Classifies companies as Integration King, Watchlist, or Pilot Purgatory.',
              high: '≥ 7.5: Integration King — deploy-ready, low risk',
              mid:  '5.0–7.4: Watchlist — monitor for improvements',
              low:  '< 5.0: Pilot Purgatory — significant barriers remain',
            },
          ].map(({ name, color, desc, high, mid, low }) => (
            <div key={name} className="border border-slate-200 rounded p-4">
              <div className={`font-bold text-sm mb-1.5 ${color}`}>{name}</div>
              <p className="text-sm text-[#33322c] mb-3 leading-relaxed">{desc}</p>
              <div className="space-y-1 text-xs text-[#545249]">
                <div><span className="text-emerald-600 font-bold">●</span> {high}</div>
                <div><span className="text-amber-500 font-bold">●</span> {mid}</div>
                <div><span className="text-red-500 font-bold">●</span> {low}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-200 pt-6">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Reference</div>
        <h2 className={`${cls.sectionTitle} mb-2`}>Protocol Friction Weights</h2>
        <p className="text-sm text-[#545249] mb-4">
          Friction starts at 10.0. Each supported protocol subtracts from this score. Companies without protocol data show as "Unverified."
        </p>
        <div className="overflow-hidden border border-slate-200 rounded">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-[#ede8d7]">
                <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#787569]">Protocol</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#787569]">Friction Reduction</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#787569]">Rationale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f1f5f9]">
              {[
                { proto: 'OPC-UA', w: -3.0, why: 'Industrial standard, native PLC/SCADA interop' },
                { proto: 'MQTT', w: -3.0, why: 'IoT backbone, cloud-ready, widely supported' },
                { proto: 'Siemens S7', w: -2.0, why: 'Dominant in European manufacturing' },
                { proto: 'Rockwell ControlLogix', w: -2.0, why: 'Dominant in US manufacturing' },
                { proto: 'ROS2', w: -1.5, why: 'Robotics standard, strong ecosystem' },
                { proto: 'VDA 5050', w: -1.5, why: 'AGV/AMR interoperability standard' },
                { proto: 'Public API / SDK', w: -1.5, why: 'Open integration surface' },
                { proto: 'Modbus / Modbus TCP', w: -1.0, why: 'Legacy but ubiquitous' },
                { proto: 'Profinet / EtherNet/IP', w: -1.0, why: 'Common fieldbus, some tooling required' },
                { proto: 'EtherCAT / CANopen', w: -1.0, why: 'Specialized, limited middleware' },
              ].map(({ proto, w, why }) => (
                <tr key={proto} className="hover:bg-[#ede8d7]/50">
                  <td className="px-4 py-2.5 font-mono text-xs text-[#33322c] font-medium">{proto}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-emerald-700 font-bold text-sm">{w.toFixed(1)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[#545249]">{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Collapsible section ──────────────────────────────────────────────────────
function CollapsibleSection({
  title, badge, icon, open, onToggle, children,
}: {
  title: string; badge?: string | number; icon?: React.ReactNode;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border border-slate-200 rounded overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-6 py-4 bg-white hover:bg-[#ede8d7]/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {icon && <span className="text-[#787569]">{icon}</span>}
          <span className="font-bold text-[#33322c] text-sm tracking-tight">{title}</span>
          {badge !== undefined && (
            <span className="text-[10px] font-bold text-[#787569] bg-[#f1f5f9]/30 px-2 py-0.5 rounded uppercase tracking-wide">{badge}</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-[#787569] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-6 pb-6 pt-4 border-t border-slate-200 bg-white">{children}</div>}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function IndustrialMatrix() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [sector, setSector] = useState<string>('');
  const customMode = searchParams.get('view') === 'custom';
  const setCustomMode = (on: boolean) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (on) next.set('view', 'custom'); else next.delete('view');
      return next;
    }, { replace: true });
  };
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectorIntel, setSectorIntel] = useState<SectorIntel | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [selectedFundingQuarter, setSelectedFundingQuarter] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'intelligence' | 'methodology'>('intelligence');
  const [secIntel, setSecIntel] = useState(true);
  const [secMatrix, setSecMatrix] = useState(true);
  const [secGeo, setSecGeo] = useState(true);
  const [secCompanies, setSecCompanies] = useState(false);
  const [secBib, setSecBib] = useState(false);
  const [bibQuarterFilter, setBibQuarterFilter] = useState<string>('all');

  useEffect(() => {
    const fetch_ = async () => {
      try {
        setLoading(true);
        const params = sector ? `?sector=${encodeURIComponent(sector)}` : '';
        const res = await fetch(`/industrial/matrix${params}`, { headers: AUTH });
        if (!res.ok) throw new Error('Failed to fetch companies');
        const data = await res.json();
        setCompanies(data.companies);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    fetch_();
  }, [sector]);

  useEffect(() => {
    if (!sector) { setSectorIntel(null); return; }
    const slug = SECTOR_SLUG[sector];
    if (!slug) return;
    setIntelLoading(true);
    setBibQuarterFilter('all');
    fetch(`/intelligence/${slug}`, { headers: AUTH })
      .then(r => r.ok ? r.json() : null)
      .then(d => setSectorIntel(d))
      .catch(() => setSectorIntel(null))
      .finally(() => setIntelLoading(false));
  }, [sector]);

  const handleScoresUpdated = (id: number, readiness: number, sovereignty: number | null) => {
    setCompanies(prev => prev.map(c => {
      if (c.id !== id) return c;
      const updated = { ...c, readiness_score: readiness, sovereignty_score: sovereignty };
      const tier = sovereignty === null ? 'unknown' : sovereignty >= 8 ? 'green' : sovereignty >= 4 ? 'yellow' : 'red';
      return { ...updated, sovereignty_tier: tier as Company['sovereignty_tier'] };
    }));
    setSelectedCompany(prev => {
      if (!prev || prev.id !== id) return prev;
      const tier = sovereignty === null ? 'unknown' : sovereignty >= 8 ? 'green' : sovereignty >= 4 ? 'yellow' : 'red';
      return { ...prev, readiness_score: readiness, sovereignty_score: sovereignty, sovereignty_tier: tier as Company['sovereignty_tier'] };
    });
  };

  const avgReadiness = companies.length
    ? Math.round(companies.reduce((s, c) => s + c.readiness_score, 0) / companies.length * 10) / 10 : 0;
  const sovScored = companies.filter(c => c.sovereignty_score !== null);
  const avgSovereignty = sovScored.length
    ? Math.round(sovScored.reduce((s, c) => s + (c.sovereignty_score ?? 0), 0) / sovScored.length * 10) / 10 : null;
  const integrationKings = companies.filter(c => c.composite_score !== null && c.composite_score >= 7.5).length;

  const tierBreakdown = [
    { name: 'Integration King', count: companies.filter(c => (c.composite_score ?? 0) >= 7.5).length, fill: '#10b981' },
    { name: 'Watchlist',        count: companies.filter(c => (c.composite_score ?? 0) >= 5 && (c.composite_score ?? 0) < 7.5).length, fill: '#f59e0b' },
    { name: 'Pilot Purgatory',  count: companies.filter(c => c.composite_score !== null && (c.composite_score ?? 0) < 5).length, fill: '#ef4444' },
    { name: 'Unscored',         count: companies.filter(c => c.composite_score === null).length, fill: '#94a3b8' },
  ];
  const sovBreakdown = [
    { name: 'Green',   count: companies.filter(c => c.sovereignty_tier === 'green').length,   fill: '#10b981' },
    { name: 'Yellow',  count: companies.filter(c => c.sovereignty_tier === 'yellow').length,  fill: '#f59e0b' },
    { name: 'Red',     count: companies.filter(c => c.sovereignty_tier === 'red').length,     fill: '#ef4444' },
    { name: 'Unknown', count: companies.filter(c => c.sovereignty_tier === 'unknown').length, fill: '#94a3b8' },
  ];
  const fundingChart = (sectorIntel?.funding_data ?? [])
    .map(d => ({ quarter: d.quarter, funding: Math.round(d.total_funding / 1_000_000) }))
    .sort((a, b) => {
      const [aq, ay] = a.quarter.replace('Q','').split('-').map(Number);
      const [bq, by] = b.quarter.replace('Q','').split('-').map(Number);
      return ay !== by ? ay - by : aq - bq;
    });

  const chartData = companies.map(c => ({
    ...c,
    x: c.readiness_score,
    y: c.friction_score ?? 0,
    z: c.total_funding > 0 ? c.total_funding : 1_000_000,
    color: SECTOR_COLORS[c.sector] ?? '#888888',
  }));

  const scatterChart = (
    <div>
      <ResponsiveContainer width="100%" height={480}>
        <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" dataKey="x" name="Readiness" unit="/10" domain={[0, 10]}
            tick={{ fill: '#64748b', fontSize: 11 }} tickLine={{ stroke: '#e2e8f0' }} axisLine={{ stroke: '#e2e8f0' }}
            label={{ value: 'Pilot-to-Production Readiness', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 11 }}
          />
          <YAxis type="number" dataKey="y" name="Friction" unit="/10" domain={[0, 10]}
            tick={{ fill: '#64748b', fontSize: 11 }} tickLine={{ stroke: '#e2e8f0' }} axisLine={{ stroke: '#e2e8f0' }}
            label={{ value: 'Integration Friction', angle: -90, position: 'insideLeft', offset: -5, fill: '#64748b', fontSize: 11 }}
          />
          <ZAxis type="number" dataKey="z" range={[16, 180]} />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '4 4', stroke: '#cbd5e1' }} />
          <Scatter data={chartData} fill="#8884d8"
            onClick={e => { if (e?.id) { const co = companies.find(c => c.id === e.id); if (co) setSelectedCompany(co); } }}
          >
            {chartData.map((entry, i) => (
              <Cell key={`cell-${i}`} fill={entry.color} className="cursor-pointer" />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      {companies.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="border border-slate-200 rounded p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-3">Composite Score Breakdown</div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={tierBreakdown} margin={{ left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {tierBreakdown.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="border border-slate-200 rounded p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-3">Sovereignty Breakdown</div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={sovBreakdown} margin={{ left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {sovBreakdown.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );

  const companyCards = (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {companies.map(company => (
        <div key={company.id}
          className="border border-slate-200 rounded p-4 hover:border-slate-200 hover:shadow-sm transition-all cursor-pointer bg-white"
          onClick={() => setSelectedCompany(company)}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-bold text-[#33322c] text-sm">{company.name}</h3>
              <p className="text-xs text-[#787569] mt-0.5">{company.sector} · {company.stage}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <SovereigntyBadge tier={company.sovereignty_tier} score={company.sovereignty_score} />
              <CompositeBadge score={company.composite_score} label={company.composite_label} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            <div className="text-[#787569]">Readiness: <span className="font-semibold text-[#33322c]">{company.readiness_score}/10</span></div>
            <div className="text-[#787569]">Friction: <span className="font-semibold text-[#33322c]">
              {company.friction_score !== null ? `${company.friction_score}/10` : <span className="text-[#787569] italic">Unverified</span>}
            </span></div>
            <div className="text-[#787569]">HQ: <span className="font-semibold text-[#33322c]">{company.hq_city}, {company.country}</span></div>
            <div className="text-[#787569]">Raised: <span className="font-semibold text-[#33322c]">{formatFunding(company.total_funding)}</span></div>
          </div>
          <div className="flex items-center justify-between pt-2.5 border-t border-slate-200">
            <button onClick={e => { e.stopPropagation(); setSelectedCompany(company); }}
              className="text-xs text-[#787569] hover:text-[#33322c] transition-colors">Industrial details</button>
            <Link to={`/companies/${company.id}`} onClick={e => e.stopPropagation()}
              className="text-xs font-semibold text-[#33322c] hover:underline transition-colors">View Profile →</Link>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className={cls.page}>
      <div className="max-w-[1400px] mx-auto px-6 py-8">

        {/* Report header */}
        <div className="border-b-2 border-[#33322c] pb-5 mb-6">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">
            SLAM · Industrial Intelligence
          </div>
          <h1 className={cls.pageTitle}>
            {sector ? sector : 'All Sectors'}
          </h1>
          <p className="text-sm text-[#545249] mt-1">
            Market signals, portfolio matrix, and sector intelligence — updated nightly.
          </p>
        </div>

        {/* Sector tabs */}
        <div className="flex gap-0 border-b border-slate-200 mb-6 -mt-1 overflow-x-auto">
          {(['All Sectors', ...SECTORS] as string[]).map(s => {
            const active = !customMode && (s === 'All Sectors' ? sector === '' : sector === s);
            return (
              <button key={s}
                onClick={() => { setCustomMode(false); setSector(s === 'All Sectors' ? '' : s); }}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? 'border-[#33322c] text-[#33322c]'
                    : 'border-transparent text-[#545249] hover:text-[#33322c] hover:border-slate-200'
                }`}
              >{s}</button>
            );
          })}
          <button
            onClick={() => setCustomMode(true)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              customMode
                ? 'border-[#33322c] text-[#33322c]'
                : 'border-transparent text-[#545249] hover:text-[#33322c] hover:border-slate-200'
            }`}
          >Custom Report</button>
        </div>

        {error && (
          <div className="border border-red-200 bg-red-50 rounded p-4 mb-5">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {customMode ? (
          <div className="border border-slate-200 rounded p-5 bg-white">
            <div className="mb-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Report Workspace</div>
              <p className="text-xs text-[#545249]">Build custom sector reports — define the outline, attach sources (PDFs, DB queries, articles, pasted data), and generate each section with SLAM editorial voice applied automatically.</p>
            </div>
            <ReportWorkspace defaultSector={sector || undefined} />
          </div>
        ) : loading ? (
          <div className="border border-slate-200 rounded p-12 text-center bg-white">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-[#33322c] border-r-transparent" />
            <p className="mt-3 text-sm text-[#545249]">Loading companies…</p>
          </div>
        ) : !sector ? (
          /* ── All Sectors view ─────────────────────────────────────────────── */
          <div className="space-y-3">
            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#f1f5f9] border border-slate-200 rounded">
              <div className="px-6 py-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Companies</div>
                <div className={cls.pageTitle}>{companies.length}</div>
              </div>
              <div className="px-6 py-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Avg Readiness</div>
                <div className={cls.pageTitle}>{avgReadiness}<span className="text-base font-normal text-[#787569]">/10</span></div>
              </div>
              <div className="px-6 py-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Integration Kings</div>
                <div className="text-2xl font-bold text-emerald-700">{integrationKings}</div>
              </div>
              <div className="px-6 py-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Avg Sovereignty</div>
                <div className={cls.pageTitle}>{avgSovereignty ?? '—'}{avgSovereignty ? <span className="text-base font-normal text-[#787569]">/10</span> : null}</div>
              </div>
            </div>
            <CollapsibleSection title="Portfolio Matrix — All Sectors" badge={`${companies.length} companies`}
              icon={<Cpu className="w-4 h-4" />} open={secMatrix} onToggle={() => setSecMatrix(v => !v)}>
              {scatterChart}
            </CollapsibleSection>
            <CollapsibleSection title="Company Profiles" badge={companies.length}
              icon={<FileText className="w-4 h-4" />} open={secCompanies} onToggle={() => setSecCompanies(v => !v)}>
              {companyCards}
            </CollapsibleSection>
          </div>
        ) : (
          /* ── Single sector view ───────────────────────────────────────────── */
          <div className="space-y-3">

            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#f1f5f9] border border-slate-200 rounded">
              <div className="px-6 py-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Companies</div>
                <div className={cls.pageTitle}>{companies.length}</div>
              </div>
              <div className="px-6 py-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Avg Readiness</div>
                <div className={cls.pageTitle}>{avgReadiness}<span className="text-base font-normal text-[#787569]">/10</span></div>
              </div>
              <div className="px-6 py-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Integration Kings</div>
                <div className="text-2xl font-bold text-emerald-700">{integrationKings}</div>
              </div>
              <div className="px-6 py-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Avg Sovereignty</div>
                <div className={cls.pageTitle}>{avgSovereignty ?? '—'}{avgSovereignty ? <span className="text-base font-normal text-[#787569]">/10</span> : null}</div>
              </div>
            </div>

            {/* Sector definition */}
            {SECTOR_DEFINITIONS[sector] && (() => {
              const def = SECTOR_DEFINITIONS[sector];
              const color = SECTOR_COLORS[sector] ?? '#33322c';
              return (
                <div className="border border-slate-200 rounded p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">Sector Scope</div>
                      <p className="text-sm text-[#33322c] leading-relaxed mb-1 font-medium">{def.definition}</p>
                      <p className="text-xs text-[#787569] italic mb-3">{def.scope}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {def.tags.map(tag => (
                          <span key={tag} className="text-[10px] px-2 py-0.5 rounded border font-medium"
                            style={{ borderColor: color + '44', color, backgroundColor: color + '0d' }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Section tabs */}
            <div className="flex border-b border-slate-200 pt-2">
              {([
                { key: 'intelligence', label: 'Intelligence' },
                { key: 'methodology', label: 'Methodology' },
              ] as { key: typeof activeTab; label: string }[]).map(tab => (
                <button key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'border-[#33322c] text-[#33322c]'
                      : 'border-transparent text-[#545249] hover:text-[#33322c]'
                  }`}
                >{tab.label}</button>
              ))}
            </div>

            {activeTab === 'methodology' ? (
              <div className="border border-slate-200 rounded p-6 bg-white">
                <MethodologyTab currentSector={sector} />
              </div>
            ) : (
              <div className="space-y-3">

                {/* Market Intelligence */}
                <CollapsibleSection title="Market Intelligence" icon={<TrendingUp className="w-4 h-4" />}
                  open={secIntel} onToggle={() => setSecIntel(v => !v)}>
                  {intelLoading ? (
                    <div className="flex justify-center py-10">
                      <div className="animate-spin rounded-full h-6 w-6 border-2 border-b-transparent border-[#33322c]" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Narrative */}
                        <div className="border border-slate-200 rounded p-5">
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">Sector Narrative</div>
                            {sectorIntel?.narrative_quarter && (
                              <span className="text-[10px] text-[#787569] font-mono">{sectorIntel.narrative_quarter}</span>
                            )}
                          </div>
                          <p className="text-sm text-[#33322c] leading-relaxed whitespace-pre-line">
                            {sectorIntel?.narrative || 'No sector report yet — generated by the quarterly trend pipeline.'}
                          </p>
                        </div>

                        {/* Funding chart */}
                        <div className="border border-slate-200 rounded p-5">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">Tracked Funding ($M)</div>
                            {selectedFundingQuarter && (
                              <button onClick={() => setSelectedFundingQuarter(null)}
                                className="text-[10px] text-[#787569] hover:text-slate-700 flex items-center gap-1">
                                <X className="w-3 h-3" /> Clear
                              </button>
                            )}
                          </div>
                          <p className="text-[10px] text-[#787569] mb-3">Click a bar to see individual rounds</p>
                          {fundingChart.length > 0 ? (
                            <ResponsiveContainer width="100%" height={180}>
                              <BarChart data={fundingChart} margin={{ left: -10 }}
                                onClick={(d) => {
                                  if (d?.activePayload?.[0]?.payload?.quarter) {
                                    const q = d.activePayload[0].payload.quarter;
                                    setSelectedFundingQuarter(prev => prev === q ? null : q);
                                  }
                                }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: '#787569' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 10, fill: '#787569' }} axisLine={false} tickLine={false}
                                  tickFormatter={(v) => v >= 1000 ? `$${(v/1000).toFixed(1)}B` : `$${v}M`} />
                                <Tooltip formatter={(v: number) => [v >= 1000 ? `$${(v/1000).toFixed(2)}B` : `$${v}M`, 'Funding']} />
                                <Bar dataKey="funding" radius={[2, 2, 0, 0]} className="cursor-pointer">
                                  {fundingChart.map((entry, i) => (
                                    <Cell key={i}
                                      fill={entry.quarter === selectedFundingQuarter ? '#10b981' : '#5B7FA6'} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="flex items-center justify-center h-40 text-[#787569] text-sm">No funding data yet.</div>
                          )}

                          {selectedFundingQuarter && (() => {
                            const events = (sectorIntel?.funding_events ?? []).filter(e => e.quarter === selectedFundingQuarter);
                            return (
                              <div className="mt-4 border-t border-slate-200 pt-4">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">
                                  {selectedFundingQuarter} — {events.length} round{events.length !== 1 ? 's' : ''} tracked
                                </div>
                                {events.length === 0 ? (
                                  <p className="text-xs text-[#787569]">No individual events recorded for this quarter.</p>
                                ) : (
                                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                    {events.map((e, i) => (
                                      <div key={i} className="flex items-start justify-between gap-3 border border-slate-200 rounded px-3 py-2">
                                        <div className="flex-1 min-w-0">
                                          {e.company_id ? (
                                            <Link to={`/companies/${e.company_id}`}
                                              className="text-sm font-semibold text-[#33322c] hover:underline truncate block">
                                              {e.company_name}
                                            </Link>
                                          ) : (
                                            <span className="text-sm font-semibold text-[#33322c] truncate block">{e.company_name}</span>
                                          )}
                                          <div className="flex flex-wrap gap-2 mt-0.5">
                                            <span className="text-xs text-[#787569] capitalize">{e.round_type.replace('_', ' ')}</span>
                                            {e.event_date && <span className="text-xs text-[#787569]">{e.event_date}</span>}
                                            {(e.investors ?? []).length > 0 && (
                                              <span className="text-xs text-[#787569]">· {e.investors.slice(0, 2).join(', ')}{e.investors.length > 2 ? ` +${e.investors.length - 2}` : ''}</span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                          <div className="text-sm font-bold text-emerald-700">
                                            {e.amount_usd ? formatFunding(e.amount_usd) : 'Undisclosed'}
                                          </div>
                                          {e.source_url && (
                                            <a href={e.source_url} target="_blank" rel="noopener noreferrer"
                                              className="text-[10px] text-[#787569] hover:text-[#33322c] flex items-center gap-0.5 justify-end mt-0.5">
                                              source <ExternalLink className="w-2.5 h-2.5" />
                                            </a>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Recent signals */}
                      <div className="border border-slate-200 rounded p-5">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">Recent Signals — 30 Days</div>
                          {sectorIntel?.patent_count ? (
                            <span className="text-[10px] font-mono text-[#787569]">{sectorIntel.patent_count} patents this quarter</span>
                          ) : null}
                        </div>
                        {(sectorIntel?.recent_signals ?? []).length === 0 ? (
                          <p className="text-sm text-[#787569]">No signals in the last 30 days — trend pipeline populates this weekly.</p>
                        ) : (
                          <div className="divide-y divide-[#f1f5f9] max-h-80 overflow-y-auto">
                            {sectorIntel!.recent_signals.map((sig, i) => (
                              <div key={i} className="py-3 first:pt-0 last:pb-0">
                                {sig.url ? (
                                  <a href={sig.url} target="_blank" rel="noopener noreferrer"
                                    className="flex items-start gap-1 text-sm font-semibold text-[#33322c] hover:underline">
                                    {sig.title}<ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0 text-[#787569]" />
                                  </a>
                                ) : (
                                  <p className="text-sm font-semibold text-[#33322c]">{sig.title}</p>
                                )}
                                {sig.summary && <p className="text-xs text-[#545249] mt-1 line-clamp-2 leading-relaxed">{sig.summary}</p>}
                                <div className="flex gap-3 mt-1">
                                  {sig.source && <span className="text-[10px] text-[#787569] font-medium">{sig.source}</span>}
                                  {sig.published_at && <span className="text-[10px] text-[#787569]">{new Date(sig.published_at).toLocaleDateString()}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CollapsibleSection>

                {/* Sector Matrix */}
                <CollapsibleSection title="Sector Matrix" badge={`${companies.length} companies`}
                  icon={<Cpu className="w-4 h-4" />} open={secMatrix} onToggle={() => setSecMatrix(v => !v)}>
                  {scatterChart}
                </CollapsibleSection>

                {/* Geographic View */}
                <CollapsibleSection title="Geographic View" icon={<Globe className="w-4 h-4" />}
                  open={secGeo} onToggle={() => setSecGeo(v => !v)}>
                  <GeopoliticalView companies={companies} />
                </CollapsibleSection>

                {/* Company Profiles */}
                <CollapsibleSection title="Company Profiles" badge={companies.length}
                  icon={<FileText className="w-4 h-4" />} open={secCompanies} onToggle={() => setSecCompanies(v => !v)}>
                  {companyCards}
                </CollapsibleSection>

                {/* Bibliography */}
                <CollapsibleSection
                  title="Source Bibliography"
                  badge={(sectorIntel?.bibliography ?? []).length > 0 ? `${sectorIntel!.bibliography.length} sources` : undefined}
                  icon={<BookOpen className="w-4 h-4" />}
                  open={secBib} onToggle={() => setSecBib(v => !v)}>
                  {(sectorIntel?.bibliography ?? []).length === 0 ? (
                    <p className="text-sm text-[#787569] py-2">No sources tracked yet — populates as the trend pipeline collects signals.</p>
                  ) : (
                    (() => {
                      const allQuarters = Array.from(new Set(
                        sectorIntel!.bibliography.flatMap(b => (b.articles ?? []).map(a => a.quarter).filter(Boolean))
                      )).sort((a, b) => {
                        const [aq, ay] = a.replace('Q','').split('-').map(Number);
                        const [bq, by] = b.replace('Q','').split('-').map(Number);
                        return ay !== by ? ay - by : aq - bq;
                      });

                      const filtered = sectorIntel!.bibliography.map(b => ({
                        ...b,
                        articles: (b.articles ?? []).filter(a =>
                          bibQuarterFilter === 'all' || a.quarter === bibQuarterFilter
                        ),
                      })).filter(b => b.articles.length > 0);

                      return (
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <p className="text-xs text-[#787569]">All sources tracked for this sector. Filter by quarter.</p>
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              <button
                                onClick={() => setBibQuarterFilter('all')}
                                className={`text-xs px-2.5 py-1 rounded border transition-colors font-medium ${bibQuarterFilter === 'all' ? 'bg-[#33322c] text-white border-[#33322c]' : 'bg-white text-[#545249] border-slate-200 hover:border-slate-400'}`}>
                                All
                              </button>
                              {allQuarters.map(q => (
                                <button key={q}
                                  onClick={() => setBibQuarterFilter(q)}
                                  className={`text-xs px-2.5 py-1 rounded border transition-colors font-medium ${bibQuarterFilter === q ? 'bg-[#33322c] text-white border-[#33322c]' : 'bg-white text-[#545249] border-slate-200 hover:border-slate-400'}`}>
                                  {q}
                                </button>
                              ))}
                            </div>
                          </div>
                          {filtered.length === 0 ? (
                            <p className="text-sm text-[#787569] py-2">No articles found for {bibQuarterFilter}.</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm border-collapse">
                                <thead>
                                  <tr className="border-b-2 border-slate-200">
                                    <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#787569]">Source / Articles</th>
                                    <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#787569]">Signal Types</th>
                                    <th className="text-center px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#787569]">Count</th>
                                    <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#787569]">Last Seen</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#f1f5f9]">
                                  {filtered.map((b, i) => (
                                    <tr key={i} className="hover:bg-[#ede8d7]/50 align-top">
                                      <td className="px-3 py-3">
                                        <div className="font-semibold text-[#33322c] text-xs mb-1.5">{b.source_name || '—'}</div>
                                        <div className="space-y-1">
                                          {b.articles.map((a, j) => (
                                            <a key={j} href={a.url} target="_blank" rel="noopener noreferrer"
                                              className="flex items-start gap-1 text-xs text-[#33322c] hover:underline leading-snug">
                                              <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5 text-[#c5c0ad]" />
                                              <span>{a.title}</span>
                                              <span className="ml-1 text-[#787569] shrink-0 font-mono">{a.quarter}</span>
                                            </a>
                                          ))}
                                        </div>
                                      </td>
                                      <td className="px-3 py-3">
                                        <div className="flex flex-wrap gap-1">
                                          {b.signal_types.map(t => (
                                            <span key={t} className="text-[10px] bg-[#f1f5f9]/30 text-[#33322c] px-1.5 py-0.5 rounded font-medium">{t}</span>
                                          ))}
                                        </div>
                                      </td>
                                      <td className="px-3 py-3 text-center font-bold text-[#33322c] font-mono">{b.articles.length}</td>
                                      <td className="px-3 py-3 text-xs text-[#787569] font-mono">{b.last_seen || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  )}
                </CollapsibleSection>

              </div>
            )}
          </div>
        )}
      </div>

      {/* Company detail modal */}
      {selectedCompany && (
        <div className="fixed inset-0 bg-black/20 flex items-start justify-center p-4 z-50 backdrop-blur-sm">
          <div className="max-w-3xl w-full mt-16">
            <SovereigntyCard
              company={selectedCompany}
              onClose={() => setSelectedCompany(null)}
              onScoresUpdated={handleScoresUpdated}
            />
          </div>
        </div>
      )}
    </div>
  );
}
