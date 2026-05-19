import { ExternalLink, Linkedin, Globe, ArrowLeft, Factory, Shield, BookOpen, Download, AlertTriangle, FileText, Trash2, Pencil, Check, X, Clock, ClipboardCheck, Zap, Link, Type, Upload, Plus, Eye, EyeOff, TrendingUp, Lock, Info, Building } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { CVCNavbar } from '../components/CVCNavbar';
import { useNavigate, useParams } from 'react-router';
import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { AUTH_HEADER as AUTH } from '../api/client';
import { cls } from '../components/tokens';

interface Company {
  id: number;
  name: string;
  one_liner?: string | null;
  sector?: string | null;
  secondary_sector?: string | null;
  sector_confidence?: number | null;
  sector_rationale?: string | null;
  sector_reviewed_by?: string | null;
  sector_reviewed_at?: string | null;
  subsector?: string | null;
  stage?: string | null;
  hq_city?: string | null;
  country?: string | null;
  location?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  crunchbase_url?: string | null;
  founded?: string | null;
  employee_count?: number | null;
  total_raised_usd?: number | null;
  investors?: string[];
  tags?: string[];
  score_composite?: number | null;
  score_commercial?: number | null;
  score_technical?: number | null;
  score_market_timing?: number | null;
  score_partner_fit?: number | null;
  score_capital_eff?: number | null;
  env_4d?: string | null;
  func_4d?: string | null;
  stack_4d?: string | null;
  biz_model_4d?: string | null;
  enrichment_status?: string | null;
  enrichment_source?: string | null;
  phase2_enriched_at?: string | null;
  scored_at?: string | null;
  score_updated_at?: string | null;
  updated_at?: string | null;
  description?: string | null;
  background?: string | null;
  competitive_advantage?: string | null;
  case_study?: string | null;
  industrial_readiness_score?: number | null;
  sovereignty_score?: number | null;
  protocol_support?: string[] | null;
  deployment_signal_level?: string | null;
  verified_certs?: string[] | null;
  integration_notes?: string | null;
  news_articles?: { title: string; url: string; snippet: string; age: string }[] | null;
  case_studies?: { title: string; url: string; snippet: string; age: string }[] | null;
  founders?: {
    name: string;
    role: string;
    linkedin?: string | null;
    departed?: boolean;
    departed_year?: number | null;
    prior_companies?: {
      name: string;
      role: string;
      exit_type: string;
      acquirer?: string | null;
      year?: number | null;
      deal_size_usd?: number | null;
    }[];
  }[] | null;
  is_repeat_founder?: boolean | null;
  prior_exit_count?: number | null;
  verticals?: string[] | null;
  predicted_subsector?: string | null;
  business_model?: string | null;
  funding_rounds?: {
    id: number | null; round_type: string; amount_usd: number | null;
    announced_date: string | null; investors: string[]; source: string | null;
    approximate: boolean; valuation_usd: number | null; notes: string | null;
  }[];
  pending_suggestions?: {
    id: number; suggestion_type: string; field_name: string | null;
    current_value: string | null; suggested_value: string | null;
    suggested_data: any | null; confidence: number;
    reasoning: string | null; created_at: string;
    intel_label: string | null; intel_url: string | null;
  }[];
  robotics?: {
    form_factor?: string | null;
    application?: string | null;
    deployment_stage?: string | null;
    payload_kg?: number | null;
    task_success_rate?: number | null;
    uptime_pct?: number | null;
  } | null;
  revenue_arr_usd?: number | null;
  revenue_period?: string | null;
  revenue_source?: string | null;
  investor_tier?: string | null;
  lead_investors?: string[] | null;
  commercial_signals?: {
    b2b_focus?: boolean;
    revenue_evidence?: string;
    product_available?: boolean;
    enterprise_deployment?: boolean;
    has_enterprise_customers?: boolean;
    employee_count?: number;
  } | null;
  is_portfolio?: boolean | null;
  fund?: string | null;
  term_sheet?: {
    investment_type?: string | null;
    round_type?: string | null;
    check_size_usd?: number | null;
    pre_money_valuation_usd?: number | null;
    post_money_valuation_usd?: number | null;
    round_size_usd?: number | null;
    shares_purchased?: number | null;
    pps_usd?: number | null;
    stage_at_investment?: string | null;
    lead_investor?: string | null;
    revenue_at_investment_usd?: number | null;
    fmv_usd?: number | null;
    moic?: number | null;
    fund?: string | null;
    is_lead_investor?: boolean | null;
    co_investors?: string[] | null;
    board_seat?: boolean | null;
    pro_rata_rights?: boolean | null;
    close_date?: string | null;
    lead_attorney?: string | null;
    notes?: string | null;
    category_2?: string | null;
  } | null;
  term_sheets?: Array<CompanyProfile['term_sheet']>;
}

interface ActivityLogEntry {
  id: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  changed_at: string;
  change_source: string;
}

interface DDStatus {
  status: 'not_started' | 'ingested' | 'running' | 'complete';
  company_name: string;
  stages: {
    ingestion?: boolean;
    agents?: Record<string, boolean>;
    overview?: boolean;
    appendix?: boolean;
    outputs?: { ic_memo: boolean; appendix: boolean; scorecard: boolean };
  };
}

interface DDOverview {
  recommendation?: string | null;
  recommendation_rationale?: string | null;
  investment_thesis?: string | null;
  summary?: string | null;
  section_summaries?: Record<string, string>;
  ic_questions?: { question: string; context?: string; source_agents?: string[]; priority?: string }[];
  cross_agent_signals?: { severity: string; headline: string; narrative: string; agents_involved?: string[] }[];
  all_flags?: { severity: string; flag?: string; our_finding?: string; agent: string; topic?: string }[];
  scorecard?: Record<string, unknown>;
  key_metrics?: Record<string, string | number>;
}

interface DDAgent {
  agent: string;
  status: string;
  summary?: string;
  findings_count?: number;
  flags_count?: number;
}

const INPUT_CLS = "w-full border border-[#787569] rounded px-3 py-2 text-sm text-[#33322c] focus:outline-none focus:ring-1 focus:ring-[#33322c] bg-[#ede8d7]";

const FOURD_DEFINITIONS: Record<string, string> = {
  // Environment
  Structured_Indoor:    'Warehouses, factories, hospitals — controlled, predictable environment',
  Unstructured_Outdoor: 'Construction, agriculture, field service — unpredictable terrain',
  Aerial:               'Drones, UAVs, airborne systems',
  Subsea_Underground:   'Subsea inspection, mining, tunneling',
  Virtual_Simulated:    'Simulation, digital twin — no physical operating environment',
  Environment_Agnostic: 'Horizontal platform — works across multiple physical environments',
  // Function
  Manipulation:         'Grasping, assembly, pick-and-place — the robot touches things',
  Mobility:             'Locomotion, navigation, transport, AMRs',
  Perception:           'Sensing, computer vision, detection, mapping',
  Cognition:            'Decision-making, planning, AI inference, reasoning',
  Human_Collaboration:  'Cobots, human-robot interaction, assistive technology',
  Infrastructure:       'Connectivity, edge compute, developer tooling — the robot ecosystem',
  // Stack Layer
  Component:            'Chip, sensor, actuator — a part that goes into something else',
  Subsystem:            'Vision module, gripper — integrates into a larger product',
  Solution:             'End-to-end product for a specific use case — vertical-focused',
  Platform:             'Horizontal layer others build on — OS, middleware, dev platform',
  Intelligence:         'Pure software/AI layer — no hardware, sits on top of existing systems',
  Ops:                  'Fleet management, monitoring, maintenance tooling for deployed systems',
  // Business Model
  Hardware_OEM:          'Sells the physical product (robot, sensor, device)',
  SaaS:                  'Software subscription — recurring revenue, no hardware',
  RaaS:                  'Robotics-as-a-Service — outcome-based, hardware + software bundled',
  Integration_Consulting:'Services-led — deploys and integrates third-party systems',
  Data_Analytics:        'Sells data products or analytics derived from operations',
  Marketplace:           'Platform connecting buyers and sellers of robotics services',
  Research_Lab:          'Pre-commercial — grant or government contract funded',
};

function ScoreCard({ label, score, emphasized = false }: { label: string; score: number | null; emphasized?: boolean }) {
  const hasScore = score != null;
  const color = !hasScore ? '#c5c0ad' : score >= 80 ? '#10b981' : score >= 60 ? '#F59E0B' : '#ef4444';

  return (
    <div className={`bg-white rounded border border-slate-200 p-4 ${emphasized ? 'ring-2 ring-[#10b981]' : ''}`}>
      <p className="text-sm text-[#545249] mb-2">{label}</p>
      <div className="flex items-end justify-between">
        <span className={`${emphasized ? 'text-4xl' : 'text-3xl'} font-bold ${hasScore ? 'text-[#33322c]' : 'text-[#c5c0ad]'}`}>
          {hasScore ? score : '—'}
        </span>
        <div className="h-2 flex-1 ml-3 bg-[#ede8d7] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: hasScore ? `${score}%` : '0%', backgroundColor: color }}
          />
        </div>
      </div>
    </div>
  );
}

export default function CompanyProfile() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ddStatus, setDdStatus] = useState<DDStatus | null>(null);
  const [ddOverview, setDdOverview] = useState<DDOverview | null>(null);
  const [ddAgents, setDdAgents] = useState<DDAgent[]>([]);
  const [ddEditing, setDdEditing] = useState(false);
  const [ddEditReco, setDdEditReco] = useState('');
  const [ddEditRationale, setDdEditRationale] = useState('');
  const [ddConfirmDelete, setDdConfirmDelete] = useState(false);
  const [ddSaving, setDdSaving] = useState(false);
  const [confirmDeleteCompany, setConfirmDeleteCompany] = useState(false);
  const [deletingCompany, setDeletingCompany] = useState(false);

  // Inline edit state
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Partial<Company>>({});
  const [saving, setSaving] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);

  // Intel state
  const [intelItems, setIntelItems] = useState<any[]>([]);
  const [showIntelModal, setShowIntelModal] = useState(false);
  const [intelTab, setIntelTab] = useState<'pdf' | 'url' | 'text'>('pdf');
  const [intelLabel, setIntelLabel] = useState('');
  const [intelUrl, setIntelUrl] = useState('');
  const [intelText, setIntelText] = useState('');
  const [intelTextSourceUrl, setIntelTextSourceUrl] = useState('');
  const [intelFile, setIntelFile] = useState<File | null>(null);
  const [intelIntent, setIntelIntent] = useState<Set<string>>(new Set());
  const [intelSubmitting, setIntelSubmitting] = useState(false);
  const [intelEditUrlId, setIntelEditUrlId] = useState<number | null>(null);
  const [intelEditUrlValue, setIntelEditUrlValue] = useState('');
  const [suggestions, setSuggestions] = useState<NonNullable<Company['pending_suggestions']>>([]);
  const [suggestionWorking, setSuggestionWorking] = useState<number | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState<number | null>(null);
  const [sectorReviewOpen, setSectorReviewOpen] = useState(false);
  const [sectorOverride, setSectorOverride] = useState<{ primary: string; secondary: string }>({ primary: '', secondary: '' });
  const [sectorSaving, setSectorSaving] = useState(false);
  const [processingIntel, setProcessingIntel] = useState(false);
  const [processResult, setProcessResult] = useState<string | null>(null);
  const [showEnrichPanel, setShowEnrichPanel] = useState(false);
  const [enrichJobs, setEnrichJobs] = useState<Set<string>>(new Set());
  const [runningEnrich, setRunningEnrich] = useState(false);
  const [enrichResult, setEnrichResult] = useState<string | null>(null);
  // Per-step status for the sequential wizard
  const [stepRunning, setStepRunning] = useState<string | null>(null);
  const [stepStatuses, setStepStatuses] = useState<Record<string, 'pending' | 'running' | 'complete' | 'error'>>({});
  const [stepLastRun, setStepLastRun] = useState<Record<string, string | null>>({});
  const [enrichPollRef, setEnrichPollRef] = useState<ReturnType<typeof setInterval> | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set());
  const [showAddRound, setShowAddRound] = useState(false);
  const [roundForm, setRoundForm] = useState({ round_type: '', amount_usd: '', valuation_usd: '', announced_date: '', investors: '', source: '', approximate: false });
  const [roundAutofilling, setRoundAutofilling] = useState(false);
  const [savingRound, setSavingRound] = useState(false);
  const [deletingRound, setDeletingRound] = useState<number | null>(null);
  const [editingRoundId, setEditingRoundId] = useState<number | null>(null);
  const [roundEditFields, setRoundEditFields] = useState<{ round_type: string; amount_usd: string; valuation_usd: string; announced_date: string; investors: string; source: string }>({ round_type: '', amount_usd: '', valuation_usd: '', announced_date: '', investors: '', source: '' });
  const [savingRoundEdit, setSavingRoundEdit] = useState(false);
  const [editFields, setEditFields] = useState<{ round_type: string; amount_usd: string; announced_date: string; investors: string; source_url: string }>({ round_type: '', amount_usd: '', announced_date: '', investors: '', source_url: '' });
  const [showRoundDetail, setShowRoundDetail] = useState(false);
  const [showNonDilutive, setShowNonDilutive] = useState(false);
  const [showFounders, setShowFounders] = useState(true);
  const [show4D, setShow4D] = useState(true);
  const [showIndustrial, setShowIndustrial] = useState(true);
  const [showFunding, setShowFunding] = useState(false);
  const [showCommercial, setShowCommercial] = useState(true);

  // Commercial Deployments
  interface CommercialDeployment {
    id: number;
    customer_name: string | null;
    deployment_type: string;
    contract_value_usd: number | null;
    start_date: string | null;
    end_date: string | null;
    stealth: boolean;
    notes: string | null;
    source_url: string | null;
    added_by: string | null;
  }
  const [partnerIntros, setPartnerIntros] = useState<any[]>([]);
  const [introsCollapsed, setIntrosCollapsed] = useState(true);
  const [contacts, setContacts] = useState<{ id: number; name: string; title: string | null; email: string | null; phone: string | null; is_primary: boolean }[]>([]);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', title: '', email: '', phone: '', is_primary: false });
  const [deployments, setDeployments] = useState<CommercialDeployment[]>([]);
  const [deploymentsLoaded, setDeploymentsLoaded] = useState(false);
  const [showAddDeployment, setShowAddDeployment] = useState(false);
  const [depForm, setDepForm] = useState({ customer_name: '', deployment_type: 'Paid Pilot', contract_value_usd: '', start_date: '', end_date: '', stealth: false, notes: '', source_url: '' });
  const [depFormErr, setDepFormErr] = useState<string | null>(null);
  const [savingDep, setSavingDep] = useState(false);
  const [showCaseStudies, setShowCaseStudies] = useState(false);
  const [editingDepId, setEditingDepId] = useState<number | null>(null);
  const [depEditFields, setDepEditFields] = useState<{ customer_name: string; deployment_type: string; contract_value_usd: string; start_date: string; end_date: string; stealth: boolean; notes: string; source_url: string }>({ customer_name: '', deployment_type: '', contract_value_usd: '', start_date: '', end_date: '', stealth: false, notes: '', source_url: '' });
  const [savingDepEdit, setSavingDepEdit] = useState(false);
  const [deletingDepId, setDeletingDepId] = useState<number | null>(null);
  const [stealthVisible, setStealthVisible] = useState<Set<number>>(new Set());
  const [meetingNotes, setMeetingNotes] = useState<any[]>([]);

  useEffect(() => {
    const fetchCompany = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const data = await api.getCompanyProfile(id);
        setCompany(data);
        setSuggestions(data.pending_suggestions ?? []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch company profile');
      } finally {
        setLoading(false);
      }
    };
    fetchCompany();

    // Refresh suggestions when tab regains focus (e.g. after Chrome extension action)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && id) {
        api.getCompanyProfile(id).then(data => {
          setSuggestions(data.pending_suggestions ?? []);
          setCompany(data);
        }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    // Also poll every 30s so stale suggestions clear even if tab never hides
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible' && id) {
        api.getCompanyProfile(id).then(data => {
          setSuggestions(data.pending_suggestions ?? []);
        }).catch(() => {});
      }
    }, 30_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(poll);
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const headers = AUTH;
    fetch(`/admin/dd/${id}/status`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then((data: DDStatus | null) => {
        if (!data) return;
        setDdStatus(data);
        if (data.status === 'complete') {
          fetch(`/admin/dd/${id}/overview`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(d => d && setDdOverview(d));
          fetch(`/admin/dd/${id}/agents`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(d => d?.agents && setDdAgents(d.agents));
        }
      });
  }, [id]);

  // Load activity log on mount
  useEffect(() => {
    if (!id) return;
    fetch(`/companies/${id}/activity`, { headers: AUTH })
      .then(r => r.ok ? r.json() : [])
      .then(setActivityLog);
  }, [id]);

  // Load intel items on mount
  useEffect(() => {
    if (!id) return;
    fetch(`/companies/${id}/intel`, { headers: AUTH })
      .then(r => r.ok ? r.json() : [])
      .then(setIntelItems);
  }, [id]);

  // Load commercial deployments on mount
  useEffect(() => {
    if (id) loadDeployments();
  }, [id]);

  // Load partner intros on mount
  useEffect(() => {
    if (!id) return;
    fetch(`/companies/${id}/intros`, { headers: AUTH })
      .then(r => r.ok ? r.json() : [])
      .then(setPartnerIntros);
  }, [id]);

  // Load meeting notes on mount
  useEffect(() => {
    if (!id) return;
    fetch(`/notes?company_id=${id}`, { headers: AUTH })
      .then(r => r.ok ? r.json() : { notes: [] })
      .then(d => setMeetingNotes(d.notes ?? []))
      .catch(() => {});
  }, [id]);

  // Load company contacts on mount
  useEffect(() => {
    if (!id) return;
    fetch(`/companies/${id}/contacts`, { headers: AUTH })
      .then(r => r.ok ? r.json() : [])
      .then(setContacts);
  }, [id]);

  // Load portco announcements on mount (only for portfolio companies)
  interface PortcoAnnouncement {
    id: number; title: string; body?: string; announcement_type: string;
    is_public: boolean; source_url?: string; announced_date?: string; added_by?: string;
  }
  const [announcements, setAnnouncements] = useState<PortcoAnnouncement[]>([]);
  useEffect(() => {
    if (!id) return;
    fetch(`/companies/${id}/announcements`, { headers: AUTH })
      .then(r => r.ok ? r.json() : [])
      .then(setAnnouncements)
      .catch(() => {});
  }, [id]);

  // Auto-expand funding section when company has rounds
  useEffect(() => {
    const rounds = company?.funding_rounds ?? [];
    const NON_DILUTIVE = /^(sbir|sttr|prize|award|grant|contract|government)/i;
    const hasEquity = rounds.some(r => !NON_DILUTIVE.test(r.round_type || ''));
    const hasNonDilutive = rounds.some(r => NON_DILUTIVE.test(r.round_type || ''));
    setShowFunding(rounds.length > 0);
    setShowRoundDetail(hasEquity);
    setShowNonDilutive(hasNonDilutive);
  }, [company]);

  // Auto-open enrichment panel for freshly-added companies
  useEffect(() => {
    if (company?.enrichment_status === 'enriching' || company?.enrichment_source === 'quickadd') {
      setShowEnrichPanel(true);
    }
  }, [company?.id]);

  // Load last_run timestamps when enrichment panel opens
  useEffect(() => {
    if (!showEnrichPanel || !id || stepRunning) return;
    fetch(`/admin/status/${id}`, { headers: AUTH })
      .then(r => r.ok ? r.json() : null)
      .then(status => {
        if (!status) return;
        const runs: Record<string, string | null> = {};
        for (const key of ['founder', 'fourD', 'funding', 'cases']) {
          runs[key] = status[key]?.last_run ?? null;
        }
        setStepLastRun(runs);
      })
      .catch(() => {});
  }, [showEnrichPanel, id]);

  // Cleanup poll interval on unmount
  useEffect(() => {
    return () => { if (enrichPollRef) clearInterval(enrichPollRef); };
  }, [enrichPollRef]);

  // Resume enrichment poll if a step was in-flight when we navigated away
  useEffect(() => {
    if (!id) return;
    const stored = localStorage.getItem(`enrichRunning:${id}`);
    if (!stored) return;
    const { stepKey, startedAt } = JSON.parse(stored);
    // Abandon stale state older than 20 minutes
    if (Date.now() - startedAt > 20 * 60 * 1000) {
      localStorage.removeItem(`enrichRunning:${id}`);
      return;
    }
    setStepRunning(stepKey);
    setStepStatuses(prev => ({ ...prev, [stepKey]: 'running' }));
    const interval = setInterval(async () => {
      try {
        const sr = await fetch(`/admin/status/${id}`, { headers: AUTH });
        if (!sr.ok) return;
        const status = await sr.json();
        const stepStatus = status[stepKey];
        if (stepStatus?.done === true) {
          clearInterval(interval);
          setEnrichPollRef(null);
          localStorage.removeItem(`enrichRunning:${id}`);
          setStepStatuses(prev => ({ ...prev, [stepKey]: 'complete' }));
          if (stepStatus.last_run) setStepLastRun(prev => ({ ...prev, [stepKey]: stepStatus.last_run }));
          setStepRunning(null);
          const updated = await api.getCompanyProfile(id);
          setCompany(updated);
        }
      } catch { /* keep polling */ }
    }, 6000);
    setEnrichPollRef(interval);
  }, [id]);

  const submitIntel = async () => {
    if (!id) return;
    setIntelSubmitting(true);
    try {
      const form = new FormData();
      form.append('intel_type', intelTab);
      if (intelLabel) form.append('label', intelLabel);
      if (intelTab === 'pdf' && intelFile) form.append('file', intelFile);
      if (intelTab === 'url') form.append('source_url', intelUrl);
      if (intelTab === 'text') {
        form.append('raw_text', intelText);
        form.append('source_url', intelTextSourceUrl);
      }
      if (intelIntent.size > 0) form.append('intent', JSON.stringify(Array.from(intelIntent)));
      const res = await fetch(`/companies/${id}/intel`, {
        method: 'POST',
        headers: AUTH,
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || 'Upload failed. Check the server.');
        return;
      }
      const updated = await fetch(`/companies/${id}/intel`, { headers: AUTH });
      setIntelItems(await updated.json());
      setShowIntelModal(false);
      setIntelLabel(''); setIntelUrl(''); setIntelText(''); setIntelTextSourceUrl(''); setIntelFile(null);
      setIntelIntent(new Set());
    } catch {
      alert('Upload failed. Check the server.');
    } finally {
      setIntelSubmitting(false);
    }
  };

  const deleteIntel = async (intelId: number) => {
    if (!id) return;
    const res = await fetch(`/companies/${id}/intel/${intelId}`, {
      method: 'DELETE',
      headers: AUTH,
    });
    if (!res.ok) { setEnrichResult(`Delete failed (${res.status})`); return; }
    setIntelItems(prev => prev.filter(i => i.id !== intelId));
  };

  const processIntel = async () => {
    if (!id) return;
    setProcessingIntel(true);
    setProcessResult(null);
    try {
      const res = await fetch(`/companies/${id}/intel/process`, { method: 'POST', headers: AUTH });
      if (res.ok) {
        setProcessResult('Processing started — suggestions will appear shortly.');
        setTimeout(async () => {
          const data = await api.getCompanyProfile(id);
          setSuggestions(data.pending_suggestions ?? []);
          setProcessResult(null);
        }, 5000);
      }
    } finally {
      setProcessingIntel(false);
    }
  };

  const autofillRound = async (url: string) => {
    if (!url || !url.startsWith('http')) return;
    setRoundAutofilling(true);
    try {
      const res = await fetch(`/companies/${id}/funding-rounds/autofill`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) return;
      const filled = await res.json();
      setRoundForm(f => ({
        ...f,
        round_type:    !f.round_type    && filled.round_type    ? filled.round_type    : f.round_type,
        amount_usd:    !f.amount_usd    && filled.amount_usd    ? String(filled.amount_usd)    : f.amount_usd,
        valuation_usd: !f.valuation_usd && filled.valuation_usd ? String(filled.valuation_usd) : f.valuation_usd,
        announced_date:!f.announced_date && filled.announced_date ? filled.announced_date : f.announced_date,
        investors:     !f.investors     && filled.investors?.length ? filled.investors.join(', ') : f.investors,
      }));
    } finally {
      setRoundAutofilling(false);
    }
  };

  const saveRound = async () => {
    if (!id || !roundForm.round_type.trim()) return;
    setSavingRound(true);
    try {
      const body: any = {
        round_type: roundForm.round_type.trim(),
        approximate: roundForm.approximate,
      };
      if (roundForm.amount_usd) body.amount_usd = parseInt(roundForm.amount_usd.replace(/[^0-9]/g, ''), 10);
      if (roundForm.valuation_usd) body.valuation_usd = parseInt(roundForm.valuation_usd.replace(/[^0-9]/g, ''), 10);
      if (roundForm.announced_date) body.announced_date = roundForm.announced_date;
      if (roundForm.investors.trim()) body.investors = roundForm.investors.split(',').map((x: string) => x.trim()).filter(Boolean);
      if (roundForm.source.trim()) body.source = roundForm.source.trim();
      const res = await fetch(`/companies/${id}/funding-rounds`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await api.getCompanyProfile(id);
        setCompany(data);
        setShowAddRound(false);
        setRoundForm({ round_type: '', amount_usd: '', valuation_usd: '', announced_date: '', investors: '', source: '', approximate: false });
      }
    } finally {
      setSavingRound(false);
    }
  };

  const saveRoundEdit = async (roundId: number) => {
    if (!id) return;
    setSavingRoundEdit(true);
    try {
      const patch: Record<string, any> = {};
      if (roundEditFields.round_type.trim()) patch.round_type = roundEditFields.round_type.trim();
      if (roundEditFields.amount_usd) patch.amount_usd = parseInt(roundEditFields.amount_usd.replace(/[^0-9]/g, ''), 10);
      patch.valuation_usd = roundEditFields.valuation_usd ? parseInt(roundEditFields.valuation_usd.replace(/[^0-9]/g, ''), 10) : null;
      if (roundEditFields.announced_date.trim()) patch.announced_date = roundEditFields.announced_date.trim();
      if (roundEditFields.investors.trim()) patch.investors = roundEditFields.investors.split(',').map((x: string) => x.trim()).filter(Boolean);
      patch.source = roundEditFields.source.trim() || null;
      const res = await fetch(`/companies/${id}/funding-rounds/${roundId}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setEnrichResult(`Save failed: ${err.detail || res.status}`);
        return;
      }
      const data = await api.getCompanyProfile(id);
      setCompany(data);
      setEditingRoundId(null);
    } finally {
      setSavingRoundEdit(false);
    }
  };

  const deleteRound = async (roundId: number) => {
    if (!id) return;
    setDeletingRound(roundId);
    try {
      const res = await fetch(`/companies/${id}/funding-rounds/${roundId}`, { method: 'DELETE', headers: AUTH });
      if (!res.ok) { setEnrichResult(`Delete failed (${res.status})`); return; }
      const data = await api.getCompanyProfile(id);
      setCompany(data);
    } finally {
      setDeletingRound(null);
    }
  };

  // ── Commercial Deployments ─────────────────────────────────────────────────
  const loadDeployments = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/companies/${id}/commercial-deployments`, { headers: AUTH });
      if (res.ok) setDeployments(await res.json());
    } finally {
      setDeploymentsLoaded(true);
    }
  };

  const saveDeployment = async () => {
    if (!id) return;
    setSavingDep(true);
    setDepFormErr(null);
    try {
      const res = await fetch(`/companies/${id}/commercial-deployments`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: depForm.customer_name.trim() || null,
          deployment_type: depForm.deployment_type,
          contract_value_usd: depForm.contract_value_usd ? parseInt(depForm.contract_value_usd.replace(/[^0-9]/g, ''), 10) : null,
          start_date: depForm.start_date || null,
          end_date: depForm.end_date || null,
          stealth: depForm.stealth,
          notes: depForm.notes.trim() || null,
          source_url: depForm.source_url.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDepFormErr(err.detail || `Save failed (${res.status})`);
        return;
      }
      setDepForm({ customer_name: '', deployment_type: 'Paid Pilot', contract_value_usd: '', start_date: '', end_date: '', stealth: false, notes: '', source_url: '' });
      setDepFormErr(null);
      setShowAddDeployment(false);
      await loadDeployments();
    } finally {
      setSavingDep(false);
    }
  };

  const saveDepEdit = async (depId: number) => {
    if (!id) return;
    setSavingDepEdit(true);
    try {
      const patch: Record<string, any> = {
        customer_name: depEditFields.customer_name.trim() || null,
        deployment_type: depEditFields.deployment_type,
        contract_value_usd: depEditFields.contract_value_usd ? parseInt(depEditFields.contract_value_usd.replace(/[^0-9]/g, ''), 10) : null,
        start_date: depEditFields.start_date || null,
        end_date: depEditFields.end_date || null,
        stealth: depEditFields.stealth,
        notes: depEditFields.notes.trim() || null,
        source_url: depEditFields.source_url.trim() || null,
      };
      const depRes = await fetch(`/companies/${id}/commercial-deployments/${depId}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!depRes.ok) {
        const err = await depRes.json().catch(() => ({}));
        setEnrichResult(`Save failed: ${err.detail || depRes.status}`);
        return;
      }
      setEditingDepId(null);
      await loadDeployments();
    } finally {
      setSavingDepEdit(false);
    }
  };

  const deleteDep = async (depId: number) => {
    if (!id) return;
    setDeletingDepId(depId);
    try {
      const res = await fetch(`/companies/${id}/commercial-deployments/${depId}`, { method: 'DELETE', headers: AUTH });
      if (!res.ok) { setEnrichResult(`Delete failed (${res.status})`); return; }
      await loadDeployments();
    } finally {
      setDeletingDepId(null);
    }
  };

  const toggleStealthVisible = (depId: number) => {
    setStealthVisible(prev => {
      const next = new Set(prev);
      if (next.has(depId)) next.delete(depId); else next.add(depId);
      return next;
    });
  };

  const runEnrichment = async () => {
    if (!id || enrichJobs.size === 0) return;
    setRunningEnrich(true);
    setEnrichResult(null);
    try {
      const res = await fetch(`/companies/${id}/refresh-enrichment`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: Array.from(enrichJobs) }),
      });
      const data = await res.json();
      const labels: Record<string, string> = { phase1: 'Phase 1', phase2: 'Phase 2', score: 'Scoring', cases: 'Case Studies & Deployments' };
      const parts = Object.entries(data.jobs || {}).map(([k, v]) =>
        `${labels[k] ?? k}: ${v === 'running' ? 'started' : 'queued'}`
      );
      setEnrichResult(parts.join(' · '));
      setEnrichJobs(new Set());
      setShowEnrichPanel(false);
      const updated = await api.getCompanyProfile(id);
      setCompany(updated);
    } finally {
      setRunningEnrich(false);
    }
  };

  const runEnrichStep = async (stepKey: string) => {
    if (!id || stepRunning) return;
    setStepRunning(stepKey);
    setStepStatuses(prev => ({ ...prev, [stepKey]: 'running' }));
    localStorage.setItem(`enrichRunning:${id}`, JSON.stringify({ stepKey, startedAt: Date.now() }));

    try {
      const res = await fetch(`/companies/${id}/refresh-enrichment`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: [stepKey] }),
      });
      if (!res.ok) throw new Error('Failed to start');
    } catch {
      localStorage.removeItem(`enrichRunning:${id}`);
      setStepStatuses(prev => ({ ...prev, [stepKey]: 'error' }));
      setStepRunning(null);
      return;
    }

    // Poll status every 6s until the step shows complete
    if (enrichPollRef) clearInterval(enrichPollRef);
    const interval = setInterval(async () => {
      try {
        const sr = await fetch(`/admin/status/${id}`, { headers: AUTH });
        if (!sr.ok) return;
        const status = await sr.json();
        const stepStatus = status[stepKey];
        const finished = stepStatus?.done === true || stepStatus?.last_run != null;
        if (finished) {
          clearInterval(interval);
          setEnrichPollRef(null);
          localStorage.removeItem(`enrichRunning:${id}`);
          setStepStatuses(prev => ({
            ...prev,
            [stepKey]: stepStatus?.done === true ? 'complete' : 'error',
          }));
          if (stepStatus?.last_run) setStepLastRun(prev => ({ ...prev, [stepKey]: stepStatus.last_run }));
          setStepRunning(null);
          // Refresh company data to reflect new fields
          const updated = await api.getCompanyProfile(id);
          setCompany(updated);
        }
      } catch { /* network hiccup — keep polling */ }
    }, 6000);
    setEnrichPollRef(interval);
  };

  const enterEditMode = () => {
    if (!company) return;
    setDraft({ ...company });
    setEditMode(true);
  };

  const cancelEdit = () => {
    setDraft({});
    setEditMode(false);
  };

  const refreshProfile = async () => {
    if (!id) return;
    const [profileData, logData] = await Promise.all([
      api.getCompanyProfile(id),
      fetch(`/companies/${id}/activity`, { headers: AUTH })
        .then(r => r.ok ? r.json() : []),
    ]);
    setCompany(profileData);
    setActivityLog(logData);
  };

  const saveEdit = async () => {
    if (!company) return;
    setSaving(true);
    try {
      const r = await fetch(`/companies/${company.id}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (r.ok) {
        const updated = await r.json();
        setCompany(updated);
        setEditMode(false);
        setDraft({});
        // Refresh activity log
        fetch(`/companies/${company.id}/activity`, { headers: AUTH })
          .then(r => r.ok ? r.json() : [])
          .then(setActivityLog);
      }
    } finally {
      setSaving(false);
    }
  };

  const completeReview = async () => {
    if (!company) return;
    setSaving(true);
    try {
      const existingTags = draft.tags ?? company.tags ?? [];
      const updatedTags = existingTags.includes('Reviewed')
        ? existingTags
        : [...existingTags, 'Reviewed'];
      const payload = { ...draft, tags: updatedTags };
      const r = await fetch(`/companies/${company.id}`, {
        method: 'PATCH',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        const updated = await r.json();
        setCompany(updated);
        setEditMode(false);
        setDraft({});
        fetch(`/companies/${company.id}/activity`, { headers: AUTH })
          .then(r => r.ok ? r.json() : [])
          .then(setActivityLog);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={`${cls.page} flex items-center justify-center`}>
        <div className="inline-block h-10 w-10 animate-spin rounded-full border-2 border-solid border-[#33322c] border-r-transparent"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${cls.page} flex items-center justify-center`}>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700 text-center">
          {error}
        </div>
      </div>
    );
  }

  if (!company) return null;

  return (
    <div className={cls.page}>
      <CVCNavbar />

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        {/* Report Header */}
        <div className="border-b-2 border-[#33322c] pb-5 mb-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">SLAM · Company Intelligence</p>
          <div className="flex items-center justify-between">
            <h1 className={cls.pageTitle}>Company Profile</h1>
            <button
              onClick={() => navigate('/companies')}
              className="flex items-center gap-2 text-[#545249] hover:text-[#33322c] transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Companies
            </button>
          </div>
        </div>

        {/* Header Section */}
        <div className="bg-white rounded border border-slate-200 p-8 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1 mr-6">
              {editMode ? (
                <div className="space-y-3 mb-4">
                  <input
                    value={draft.name ?? ''}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                    placeholder="Company name"
                    className={INPUT_CLS + " text-xl font-bold"}
                  />
                  <input
                    value={draft.one_liner ?? ''}
                    onChange={e => setDraft(d => ({ ...d, one_liner: e.target.value }))}
                    placeholder="One-liner description"
                    className={INPUT_CLS}
                  />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Sector</label>
                      <select value={draft.sector ?? ''} onChange={e => setDraft(d => ({ ...d, sector: e.target.value }))} className={INPUT_CLS}>
                        <option value="">— Select —</option>
                        {['Robotics','Supply Chain','Manufacturing','Industrial Automation','Physical AI','Other'].map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Stage</label>
                      <select value={draft.stage ?? ''} onChange={e => setDraft(d => ({ ...d, stage: e.target.value }))} className={INPUT_CLS}>
                        <option value="">— Select —</option>
                        {['Seed','Series A','Series B','Series C','Growth','Public'].map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">City</label>
                      <input value={draft.hq_city ?? ''} onChange={e => setDraft(d => ({ ...d, hq_city: e.target.value }))} placeholder="City" className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Country (2-letter)</label>
                      <input value={draft.country ?? ''} onChange={e => setDraft(d => ({ ...d, country: e.target.value }))} placeholder="US" maxLength={2} className={INPUT_CLS} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Website</label>
                      <input value={draft.website ?? ''} onChange={e => setDraft(d => ({ ...d, website: e.target.value }))} placeholder="https://..." className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">LinkedIn URL</label>
                      <input value={draft.linkedin_url ?? ''} onChange={e => setDraft(d => ({ ...d, linkedin_url: e.target.value }))} placeholder="https://linkedin.com/company/..." className={INPUT_CLS} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Founded</label>
                      <input type="number" value={draft.founded != null ? String(draft.founded) : ''} onChange={e => setDraft(d => ({ ...d, founded: e.target.value ? parseInt(e.target.value) : undefined }))} placeholder="e.g. 2018" className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Employees</label>
                      <input type="number" value={draft.employee_count != null ? String(draft.employee_count) : ''} onChange={e => setDraft(d => ({ ...d, employee_count: e.target.value ? parseInt(e.target.value) : undefined }))} placeholder="e.g. 50" className={INPUT_CLS} />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="text-3xl font-bold text-[#33322c]">{company.name}</h1>
                    {company.fund && (
                      <span className="text-[11px] font-bold text-[#7a6f00] bg-cvc-gold/20 px-2 py-1 rounded uppercase tracking-widest border border-cvc-gold/30">{company.fund}</span>
                    )}
                  </div>
                  <p className="text-lg text-[#545249] mb-1">{company.one_liner ?? ""}</p>
                  {(company.founded || company.employee_count) && (
                    <p className="text-sm text-[#787569] mb-4">
                      {company.founded && `Est. ${company.founded}`}
                      {company.founded && company.employee_count ? ' · ' : ''}
                      {company.employee_count && `${company.employee_count.toLocaleString()} employees`}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-3 py-1 bg-[#33322c] text-white text-sm font-medium rounded">
                      {(company.sector ?? 'Unknown').replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                    {company.subsector && (
                      <span className="px-3 py-1 border border-[#33322c] text-[#33322c] text-sm font-medium rounded">
                        {company.subsector.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </span>
                    )}
                    <span className="px-3 py-1 border border-[#33322c] text-[#33322c] text-sm font-medium rounded">{company.stage}</span>
                    <span className="px-3 py-1 bg-[#ede8d7] text-[#545249] text-sm font-medium rounded">{company.location ?? company.hq_city ?? ""}{company.country ? ", " + company.country : ""}</span>
                    {company.business_model && (
                      <span className="px-3 py-1 bg-[#ede8d7] text-[#33322c] text-sm font-medium rounded border border-slate-200">{company.business_model}</span>
                    )}
                    {company.predicted_subsector && company.predicted_subsector !== company.subsector && (
                      <span className="px-3 py-1 bg-[#ede8d7] text-[#545249] text-xs font-medium rounded border border-dashed border-slate-200" title="AI-predicted subsector">{company.predicted_subsector}</span>
                    )}
                    {company.investor_tier && company.investor_tier !== 'unknown' && (() => {
                      const tierStyles: Record<string, string> = {
                        top_tier: 'bg-cvc-gold/20 text-[#7a6f00] border-cvc-gold',
                        mid_tier: 'bg-blue-50 text-blue-700 border-blue-200',
                        emerging: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                      };
                      const tierLabels: Record<string, string> = {
                        top_tier: 'Top-Tier Investors', mid_tier: 'Mid-Tier Investors', emerging: 'Emerging Investors',
                      };
                      return (
                        <span className={`px-3 py-1 border text-sm font-medium rounded ${tierStyles[company.investor_tier!] ?? ''}`}>
                          {tierLabels[company.investor_tier!] ?? company.investor_tier}
                        </span>
                      );
                    })()}
                    {company.industrial_readiness_score != null && (
                      <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 text-sm font-medium rounded flex items-center gap-1.5">
                        <Factory className="w-3.5 h-3.5" />
                        Industrial Analysis
                      </span>
                    )}
                  </div>

                  {/* ── Key Contacts ── */}
                  {contacts.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-x-6 gap-y-2">
                      {contacts.map(c => (
                        <div key={c.id} className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-[#ede8d7] flex items-center justify-center text-[10px] font-bold text-[#545249] shrink-0">
                            {c.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm font-semibold text-[#33322c]">{c.name}</span>
                          {c.title && <span className="text-xs text-[#787569]">{c.title}</span>}
                          {c.email && <a href={`mailto:${c.email}`} className="text-xs text-[#6366f1] hover:underline">{c.email}</a>}
                          {c.phone && <span className="text-xs text-[#787569]">{c.phone}</span>}
                        </div>
                      ))}
                      <button onClick={() => setShowAddContact(v => !v)}
                        className="text-xs text-[#787569] hover:text-[#33322c] transition-colors">
                        {showAddContact ? 'cancel' : '+ add contact'}
                      </button>
                    </div>
                  )}
                  {contacts.length === 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <button onClick={() => setShowAddContact(v => !v)}
                        className="text-xs text-[#787569] hover:text-[#33322c] transition-colors">
                        {showAddContact ? 'cancel' : '+ add contact'}
                      </button>
                    </div>
                  )}
                  {showAddContact && (
                    <div className="mt-3 bg-[#F8FAFC] rounded border border-slate-200 p-4 grid grid-cols-2 gap-3">
                      <input className={cls.input} placeholder="Name *" value={contactForm.name} onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))} />
                      <input className={cls.input} placeholder="Title (e.g. CEO)" value={contactForm.title} onChange={e => setContactForm(f => ({ ...f, title: e.target.value }))} />
                      <input className={cls.input} placeholder="Email" value={contactForm.email} onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} />
                      <input className={cls.input} placeholder="Phone" value={contactForm.phone} onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))} />
                      <div className="col-span-2 flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs text-[#545249] cursor-pointer">
                          <input type="checkbox" checked={contactForm.is_primary} onChange={e => setContactForm(f => ({ ...f, is_primary: e.target.checked }))} />
                          Primary contact
                        </label>
                        <button
                          disabled={!contactForm.name.trim()}
                          onClick={async () => {
                            const res = await fetch(`/companies/${id}/contacts`, {
                              method: 'POST',
                              headers: { ...AUTH, 'Content-Type': 'application/json' },
                              body: JSON.stringify(contactForm),
                            });
                            if (res.ok) {
                              const row = await res.json();
                              setContacts(c => [...c, row].sort((a, b) => Number(b.is_primary) - Number(a.is_primary)));
                              setContactForm({ name: '', title: '', email: '', phone: '', is_primary: false });
                              setShowAddContact(false);
                            }
                          }}
                          className="px-3 py-1.5 text-xs font-semibold bg-[#1e293b] text-cvc-gold rounded hover:opacity-90 disabled:opacity-40 transition-opacity">
                          Save Contact
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── Sector Classification Review ── */}
                  {company.sector_confidence != null && (() => {
                    const conf = company.sector_confidence!;
                    const reviewed = !!company.sector_reviewed_at;
                    const confColor = conf >= 80 ? 'bg-emerald-100 text-emerald-700' : conf >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-[#f1f5f9]/30 text-[#33322c]';
                    const SECTORS = ['Supply Chain', 'Robotics', 'Physical AI', 'Industrial Automation', 'Manufacturing', 'Other'];

                    if (reviewed && !sectorReviewOpen) {
                      return (
                        <div className="mt-3 flex items-center gap-2">
                          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <span className="text-xs text-[#545249]">Sector reviewed by {company.sector_reviewed_by}</span>
                          <button onClick={() => { setSectorReviewOpen(true); setSectorOverride({ primary: company.sector ?? '', secondary: company.secondary_sector ?? '' }); }} className="text-xs text-blue-500 hover:underline ml-1">Edit</button>
                        </div>
                      );
                    }

                    return (
                      <div className={`mt-3 rounded p-4 border ${reviewed ? 'bg-white border-slate-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Zap className={`w-4 h-4 ${reviewed ? 'text-[#545249]' : 'text-amber-600'}`} />
                            <span className={`text-sm font-semibold ${reviewed ? 'text-[#33322c]' : 'text-amber-900'}`}>
                              {reviewed ? 'Sector Classification' : 'Sector Classification — Pending Review'}
                            </span>
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${confColor}`}>{conf}% confidence</span>
                          </div>
                          {reviewed && <button onClick={() => setSectorReviewOpen(false)} className="text-[#787569] hover:text-[#33322c]"><X className="w-4 h-4" /></button>}
                        </div>

                        {/* Current assignment */}
                        <div className="flex flex-wrap gap-2 mb-3">
                          <div>
                            <div className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide mb-1">Primary</div>
                            <span className="px-2.5 py-1 bg-[#33322c] text-white text-xs font-medium rounded">{company.sector ?? '—'}</span>
                          </div>
                          {company.secondary_sector && (
                            <div>
                              <div className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide mb-1">Secondary</div>
                              <span className="px-2.5 py-1 border border-[#33322c] text-[#33322c] text-xs font-medium rounded">{company.secondary_sector}</span>
                            </div>
                          )}
                        </div>

                        {/* Rationale */}
                        {company.sector_rationale && (
                          <p className="text-xs text-[#545249] leading-relaxed mb-3 italic">"{company.sector_rationale}"</p>
                        )}

                        {/* Override dropdowns */}
                        <div className="flex flex-wrap gap-2 mb-3">
                          <div>
                            <label className="text-[10px] font-semibold text-[#545249] uppercase tracking-wide">Override Primary</label>
                            <select
                              value={sectorReviewOpen || !reviewed ? (sectorOverride.primary || company.sector || '') : company.sector || ''}
                              onChange={e => setSectorOverride(s => ({ ...s, primary: e.target.value }))}
                              className="block mt-0.5 border border-slate-200 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-400 bg-white"
                            >
                              {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-[#545249] uppercase tracking-wide">Override Secondary</label>
                            <select
                              value={sectorReviewOpen || !reviewed ? (sectorOverride.secondary || company.secondary_sector || '') : company.secondary_sector || ''}
                              onChange={e => setSectorOverride(s => ({ ...s, secondary: e.target.value }))}
                              className="block mt-0.5 border border-slate-200 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-400 bg-white"
                            >
                              <option value="">— None —</option>
                              {SECTORS.filter(s => s !== 'Other').map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            disabled={sectorSaving}
                            onClick={async () => {
                              setSectorSaving(true);
                              const payload: Record<string, any> = {
                                sector: sectorOverride.primary || company.sector,
                                secondary_sector: sectorOverride.secondary || company.secondary_sector || null,
                              };
                              const updated = await api.updateCompany(company.id, payload);
                              setCompany(updated);
                              setSectorReviewOpen(false);
                              setSectorSaving(false);
                            }}
                            className="px-3 py-1.5 bg-[#33322c] text-white text-xs font-semibold rounded hover:bg-[#1a2e3a] disabled:opacity-50"
                          >
                            {sectorSaving ? 'Saving…' : reviewed ? 'Save Changes' : 'Confirm Classification'}
                          </button>
                          {!reviewed && (
                            <button
                              disabled={sectorSaving}
                              onClick={async () => {
                                setSectorSaving(true);
                                const updated = await api.updateCompany(company.id, {
                                  sector: company.sector,
                                  secondary_sector: company.secondary_sector ?? null,
                                });
                                setCompany(updated);
                                setSectorSaving(false);
                              }}
                              className="px-3 py-1.5 border border-slate-200 text-[#33322c] text-xs font-semibold rounded hover:bg-[#ede8d7] disabled:opacity-50"
                            >
                              Confirm as-is
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              {/* Edit / Save / Cancel buttons */}
              {!editMode && !confirmDeleteCompany && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowIntelModal(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-cvc-gold text-[#33322c] rounded text-sm font-medium hover:bg-yellow-300 transition-colors"
                    title="Add Intel"
                  >
                    <Zap className="w-4 h-4" />
                    + Intel
                  </button>
                  <button
                    onClick={enterEditMode}
                    className="flex items-center gap-1.5 px-3 py-2 border border-[#33322c] rounded text-[#33322c] hover:bg-[#33322c] hover:text-white transition-colors text-sm font-medium"
                    title="Review Startup"
                  >
                    <ClipboardCheck className="w-4 h-4" />
                    Review
                  </button>
                </div>
              )}
              {editMode && (
                <>
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#10b981] text-white rounded text-sm font-medium hover:bg-[#059669] disabled:opacity-50 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-[#545249] rounded text-sm font-medium hover:bg-[#ede8d7] transition-colors"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                </>
              )}
              {!editMode && (
                <>
                  {company.website && (
                    <a href={company.website} target="_blank" rel="noopener noreferrer" className="p-2 border border-slate-200 rounded hover:bg-[#ede8d7] transition-colors">
                      <Globe className="w-5 h-5 text-[#545249]" />
                    </a>
                  )}
                  {company.linkedin_url && (
                    <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer" className="p-2 border border-slate-200 rounded hover:bg-[#ede8d7] transition-colors">
                      <Linkedin className="w-5 h-5 text-[#545249]" />
                    </a>
                  )}
                  {company.crunchbase_url && (
                    <a href={company.crunchbase_url} target="_blank" rel="noopener noreferrer" className="p-2 border border-slate-200 rounded hover:bg-[#ede8d7] transition-colors">
                      <ExternalLink className="w-5 h-5 text-[#545249]" />
                    </a>
                  )}
                  {!confirmDeleteCompany && (
                    <button
                      onClick={() => setConfirmDeleteCompany(true)}
                      className="p-2 border border-slate-200 rounded text-[#545249] hover:text-red-600 hover:border-red-300 transition-colors"
                      title="Delete company"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                  {confirmDeleteCompany && (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded px-3 py-1.5">
                      <span className="text-sm text-red-700 font-medium">Delete {company.name}?</span>
                      <button
                        onClick={async () => {
                          setDeletingCompany(true);
                          const r = await fetch(`/companies/${company.id}`, { method: 'DELETE', headers: AUTH });
                          if (r.ok) { navigate('/companies', { replace: true }); }
                          else { setDeletingCompany(false); setConfirmDeleteCompany(false); }
                        }}
                        disabled={deletingCompany}
                        className="px-3 py-1 bg-red-600 text-white text-xs font-semibold rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {deletingCompany ? 'Deleting…' : 'Delete'}
                      </button>
                      <button onClick={() => setConfirmDeleteCompany(false)} className="px-3 py-1 border border-slate-200 text-[#545249] text-xs font-medium rounded hover:bg-white transition-colors">Cancel</button>
                    </div>
                  )}
                </>
              )}

              {/* Enrichment Pipeline — shown when not in edit mode */}
              {!editMode && (() => {
                const founderDone     = Array.isArray(company.founders) && company.founders.length > 0;
                const fourDDone       = [company.env_4d, company.func_4d, company.stack_4d, company.biz_model_4d].every(Boolean);
                const fundingDone     = (company.funding_rounds ?? []).length > 0;
                const deploymentsDone = deploymentsLoaded && (deployments.length > 0 || (company.case_studies ?? []).length > 0);
                const newsDone        = (company.news_articles ?? []).length > 0;
                const industrialDone  = company.industrial_readiness_score != null;
                const allPrereqsDone  = founderDone && fourDDone && fundingDone && deploymentsDone && newsDone;

                const steps: { key: string; label: string; done: boolean; locked?: boolean; stat: string | null; doneColor: string; dotColor: string }[] = [
                  {
                    key: 'founder', label: 'Founder', done: founderDone,
                    stat: founderDone ? `${(company.founders ?? []).length} founder${(company.founders ?? []).length !== 1 ? 's' : ''}${company.prior_exit_count ? ` · ${company.prior_exit_count} exit${company.prior_exit_count !== 1 ? 's' : ''}` : ''}` : null,
                    doneColor: 'bg-[#f0fdf4] border-[#86efac]', dotColor: 'bg-[#16a34a]',
                  },
                  {
                    key: 'fourD', label: '4D', done: fourDDone,
                    stat: fourDDone ? `${[company.env_4d, company.func_4d, company.stack_4d, company.biz_model_4d].filter(Boolean).length}/4 fields` : null,
                    doneColor: 'bg-[#f5f3ff] border-[#c4b5fd]', dotColor: 'bg-[#7c3aed]',
                  },
                  {
                    key: 'funding', label: 'Funding', done: fundingDone,
                    stat: fundingDone ? `${(company.funding_rounds ?? []).length} round${(company.funding_rounds ?? []).length !== 1 ? 's' : ''}` : null,
                    doneColor: 'bg-[#eff6ff] border-[#93c5fd]', dotColor: 'bg-[#2563eb]',
                  },
                  {
                    key: 'deployments', label: 'Deployments', done: deploymentsDone,
                    stat: deploymentsDone ? `${deployments.length} structured · ${(company.case_studies ?? []).length} research` : null,
                    doneColor: 'bg-[#fff7ed] border-[#fdba74]', dotColor: 'bg-[#ea580c]',
                  },
                  {
                    key: 'news', label: 'News', done: newsDone,
                    stat: newsDone ? `${(company.news_articles ?? []).length} article${(company.news_articles ?? []).length !== 1 ? 's' : ''}` : null,
                    doneColor: 'bg-[#f0fdf4] border-[#86efac]', dotColor: 'bg-[#059669]',
                  },
                  {
                    key: 'industrial', label: 'Industrial', done: industrialDone,
                    locked: !allPrereqsDone,
                    stat: industrialDone ? `Readiness: ${company.industrial_readiness_score}/10` : null,
                    doneColor: 'bg-[#faf5ff] border-[#a78bfa]', dotColor: 'bg-[#7c3aed]',
                  },
                ];

                const completedCount = steps.filter(s => s.done).length;

                return (
                  <div className="relative mt-3">
                    {/* Progress header */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-[#787569] uppercase tracking-wide">Enrichment Pipeline</span>
                      <span className="text-[10px] font-semibold text-[#545249]">{completedCount}/6 complete</span>
                    </div>
                    {/* Step track */}
                    <div className="flex items-stretch gap-0">
                      {steps.map((step, i) => (
                        <div key={step.key} className="flex items-center flex-1 min-w-0">
                          {/* Step pill */}
                          <div className={`flex-1 min-w-0 border rounded-lg px-2.5 py-2 transition-colors ${step.done ? step.doneColor : step.locked ? 'bg-[#ede8d7] border-slate-200 opacity-60' : 'bg-[#ede8d7] border-slate-200'}`}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${step.done ? 'bg-white text-[#33322c] shadow-sm' : 'bg-[#f1f5f9] text-[#787569]'}`}>
                                {step.done
                                  ? <span className="text-[9px] font-bold">✓</span>
                                  : step.locked
                                    ? <Lock className="w-2.5 h-2.5" />
                                    : <span className="text-[9px] font-bold">{i + 1}</span>
                                }
                              </span>
                              <span className={`text-[10px] font-bold truncate ${step.done ? 'text-[#33322c]' : 'text-[#787569]'}`}>{step.label}</span>
                            </div>
                            {step.stat ? (
                              <p className="text-[9px] text-[#545249] truncate pl-5">{step.stat}</p>
                            ) : step.locked ? (
                              <p className="text-[9px] text-[#c5c0ad] pl-5">Complete 1–5 first</p>
                            ) : (
                              <p className="text-[9px] text-[#c5c0ad] pl-5">Not run</p>
                            )}
                          </div>
                          {/* Connector arrow */}
                          {i < steps.length - 1 && (
                            <div className={`w-4 h-px flex-shrink-0 mx-0.5 ${step.done ? 'bg-[#10b981]' : 'bg-[#f1f5f9]'}`} />
                          )}
                        </div>
                      ))}
                    </div>
                    {/* Run / Re-run link */}
                    <div className="flex items-center justify-end gap-3 mt-2">
                      {enrichResult && <span className="text-[10px] text-[#10b981] font-medium">{enrichResult}</span>}
                      <button
                        onClick={() => { setShowEnrichPanel(v => !v); setEnrichResult(null); }}
                        className="text-[10px] font-semibold px-2.5 py-1 rounded bg-[#1e293b] text-white hover:bg-[#0f172a] transition-colors"
                      >
                        {completedCount === 0 ? 'Run Enrichment' : showEnrichPanel ? 'Close' : 'Manage Enrichment'}
                      </button>
                    </div>

                    {showEnrichPanel && (
                      <div className="absolute right-0 top-full mt-2 z-20 bg-white border border-slate-200 rounded-xl shadow-lg p-4 w-88" style={{ width: '22rem' }}>
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-xs font-bold text-[#33322c]">Enrichment Pipeline</p>
                            <p className="text-[10px] text-[#787569]">Run each step in order. Results build on each other.</p>
                          </div>
                          <button onClick={() => setShowEnrichPanel(false)} className="text-[#787569] hover:text-[#545249] p-1"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="space-y-2">
                          {([
                            { key: 'founder', label: 'Step 1 — Founder Research',           sub: 'founder_research.py — bios, prior exits, red flags',            badgeColor: 'bg-[#f0fdf4] text-[#15803d]',  badge: 'Web',   done: founderDone   },
                            { key: 'fourD',   label: 'Step 2 — 4D Classification',          sub: 'enrich_4d.py — Brave + LLM → 4D fields + news',                 badgeColor: 'bg-[#ede9fe] text-[#5b21b6]',  badge: 'LLM',   done: fourDDone     },
                            { key: 'funding', label: 'Step 3 — Funding Rounds',              sub: 'enrich_funding_rounds.py — Brave → Human Review queue',         badgeColor: 'bg-[#dbeafe] text-[#1e40af]',  badge: 'Brave', done: fundingDone   },
                            { key: 'cases',   label: 'Step 4 — Case Studies & Deployments',  sub: 'enrich_cases.py — Brave → case studies + revenue extraction',  badgeColor: 'bg-[#d1fae5] text-[#065f46]',  badge: 'Brave', done: deploymentsDone },
                          ] as { key: string; label: string; sub: string; badgeColor: string; badge: string; done: boolean }[]).map((opt) => {
                            const uiStatus = stepStatuses[opt.key] ?? (opt.done ? 'complete' : 'pending');
                            const isRunning = uiStatus === 'running';
                            const isError = uiStatus === 'error';
                            const lastRun = stepLastRun[opt.key] ?? null;
                            const hasRun = opt.done || !!lastRun;
                            const canRun = !stepRunning;
                            return (
                              <div key={opt.key} className={`rounded-lg border px-3 py-2.5 transition-colors ${
                                isRunning ? 'bg-[#faf5ff] border-[#c4b5fd]'
                                : isError  ? 'bg-red-50 border-red-200'
                                : hasRun && opt.done ? 'bg-[#f0fdf4] border-[#86efac]'
                                : hasRun   ? 'bg-[#f8fafc] border-slate-200 opacity-70'
                                : 'bg-[#ede8d7] border-slate-200'
                              }`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold ${
                                      isRunning ? 'bg-[#7c3aed] text-white'
                                      : isError  ? 'bg-red-500 text-white'
                                      : opt.done ? 'bg-[#16a34a] text-white'
                                      : hasRun   ? 'bg-slate-300 text-white'
                                      : 'bg-[#f1f5f9] text-[#545249]'
                                    }`}>
                                      {opt.done ? '✓' : isError ? '!' : isRunning ? '…' : hasRun ? '↺' : null}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className={`text-[11px] font-semibold ${
                                          opt.done ? 'text-[#15803d]' : isRunning ? 'text-[#5b21b6]' : hasRun ? 'text-[#787569]' : 'text-[#33322c]'
                                        }`}>{opt.label}</span>
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${opt.badgeColor}`}>{opt.badge}</span>
                                      </div>
                                      <p className="text-[10px] text-[#787569]">{opt.sub}</p>
                                      {lastRun && (
                                        <p className="text-[10px] text-[#787569] mt-0.5">
                                          Last run: {lastRun} — {opt.done ? 'data found' : 'no findings'}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  {!isRunning && (
                                    <button
                                      onClick={() => runEnrichStep(opt.key)}
                                      disabled={!canRun}
                                      className={`text-[11px] px-2.5 py-1 rounded font-semibold disabled:opacity-40 transition-colors flex-shrink-0 ${
                                        isError ? 'bg-red-500 text-white hover:bg-red-600'
                                        : hasRun ? 'bg-slate-200 text-[#545249] hover:bg-slate-300'
                                        : 'bg-[#6366f1] text-white hover:bg-[#4f46e5]'
                                      }`}
                                    >
                                      {isError ? 'Retry' : hasRun ? 'Re-run' : 'Run'}
                                    </button>
                                  )}
                                </div>
                                {isRunning && (
                                  <div className="mt-2">
                                    <div className="h-1 rounded-full bg-[#ede9fe] overflow-hidden animate-pulse">
                                      <div className="h-full w-2/3 bg-[#7c3aed] rounded-full" />
                                    </div>
                                    <p className="text-[9px] text-[#7c3aed] mt-1">Running — polling for completion…</p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-[9px] text-[#787569] mt-3 text-center">Steps 5 & 6 unlock after step 1–4 complete</p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Founding Team */}
        <div className="bg-white rounded border border-slate-200 mb-6">
            <button
              onClick={() => setShowFounders(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#ede8d7] transition-colors rounded"
            >
              <div className="flex items-center gap-2.5">
                <svg className={`w-4 h-4 text-[#787569] transition-transform ${showFounders ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                <span className="text-sm font-semibold text-[#33322c]">Founding Team</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#fef3c7] text-[#92400e]">Founder Research</span>
                {company.is_repeat_founder && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#d1fae5] text-[#065f46]">Repeat Founder</span>
                )}
                {(company.prior_exit_count ?? 0) > 0 && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#dbeafe] text-[#1e40af]">{company.prior_exit_count} Exit{company.prior_exit_count !== 1 ? 's' : ''}</span>
                )}
              </div>
              <span className="text-[10px] text-[#787569]">{showFounders ? 'collapse' : 'expand'}</span>
            </button>
            {showFounders && (
              <div className="px-5 pb-5 pt-1">
                {(company.founders ?? []).length === 0 ? (
                  <p className="text-sm text-[#787569] text-center py-6">No founder data yet — run Founder Research from the Enrichment page to populate this section.</p>
                ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {company.founders!.map((f, i) => (
                    <div key={i} className={`rounded border p-4 ${f.departed ? 'bg-[#fafafa] border-slate-200 opacity-70' : 'bg-white border-slate-200'}`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className={`text-sm font-semibold ${f.departed ? 'text-[#545249]' : 'text-[#33322c]'}`}>{f.name}</p>
                          <p className="text-xs text-[#787569]">{f.role}</p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {f.departed && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#fee2e2] text-[#991b1b]">
                              Departed{f.departed_year ? ` ${f.departed_year}` : ''}
                            </span>
                          )}
                          {(f.prior_companies ?? []).length > 0 && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#d1fae5] text-[#065f46]">Repeat</span>
                          )}
                          {f.linkedin && (
                            <a href={f.linkedin} target="_blank" rel="noopener noreferrer"
                              className="p-1 rounded text-[#545249] hover:text-[#0077b5] transition-colors" title="LinkedIn">
                              <Linkedin className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                      {(f.prior_companies ?? []).length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          <p className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">Prior Companies</p>
                          {f.prior_companies!.map((pc, j) => (
                            <div key={j} className="flex items-center justify-between text-xs">
                              <span className="text-[#33322c] font-medium">{pc.name}</span>
                              <div className="flex items-center gap-1.5">
                                {pc.role && <span className="text-[#787569]">{pc.role}</span>}
                                {pc.exit_type === 'acquisition' && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#dbeafe] text-[#1e40af]">
                                    Acq{pc.acquirer ? ` → ${pc.acquirer}` : ''}{pc.year ? ` ${pc.year}` : ''}
                                  </span>
                                )}
                                {pc.exit_type === 'ipo' && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#ede9fe] text-[#5b21b6]">
                                    IPO{pc.year ? ` ${pc.year}` : ''}
                                  </span>
                                )}
                                {pc.deal_size_usd && (
                                  <span className="text-[10px] text-[#545249]">
                                    ${pc.deal_size_usd >= 1e9 ? (pc.deal_size_usd/1e9).toFixed(1)+'B' : (pc.deal_size_usd/1e6).toFixed(0)+'M'}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}
        </div>

        {/* 4D Classification */}
        <div className="bg-white rounded border border-slate-200 mb-6">
          <button
            onClick={() => setShow4D(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#ede8d7] transition-colors rounded"
          >
            <div className="flex items-center gap-2.5">
              <svg className={`w-4 h-4 text-[#787569] transition-transform ${show4D ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
              <span className="text-sm font-semibold text-[#33322c]">4D Classification</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#ede9fe] text-[#5b21b6]">4D Classification</span>
              {[company.env_4d, company.func_4d, company.stack_4d, company.biz_model_4d].filter(Boolean).length > 0 && !show4D && (
                <span className="text-xs text-[#545249]">
                  {[company.env_4d, company.func_4d, company.stack_4d, company.biz_model_4d].filter(Boolean).map(v => v!.replace(/_/g,' ')).join(' · ')}
                </span>
              )}
            </div>
            <span className="text-[10px] text-[#787569]">{show4D ? 'collapse' : 'expand'}</span>
          </button>
          {show4D && (
            <div className="px-5 pb-5 pt-1">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[
                  { label: 'Environment', field: 'env_4d' as const, options: ['Structured_Indoor','Unstructured_Outdoor','Aerial','Subsea_Underground','Virtual_Simulated','Environment_Agnostic'] },
                  { label: 'Function', field: 'func_4d' as const, options: ['Manipulation','Mobility','Perception','Cognition','Human_Collaboration','Infrastructure'] },
                  { label: 'Stack Layer', field: 'stack_4d' as const, options: ['Component','Subsystem','Solution','Platform','Intelligence','Ops'] },
                  { label: 'Business Model', field: 'biz_model_4d' as const, options: ['Hardware_OEM','SaaS','RaaS','Integration_Consulting','Data_Analytics','Marketplace','Research_Lab'] },
                ].map(({ label, field, options }) => (
                  <div key={field} className="bg-white rounded-lg border border-slate-200 p-4">
                    <p className="text-xs font-semibold text-[#545249] uppercase mb-2">{label}</p>
                    {editMode ? (
                      <select
                        value={draft[field] ?? ''}
                        onChange={e => setDraft(d => ({ ...d, [field]: e.target.value || null }))}
                        className={INPUT_CLS}
                      >
                        <option value="">— Select —</option>
                        {options.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                      </select>
                    ) : (
                      <div className="flex items-start gap-1.5 mt-1">
                        <p className={`${cls.sectionTitle} leading-tight`}>
                          {company[field] ? company[field]!.replace(/_/g, ' ') : '—'}
                        </p>
                        {company[field] && FOURD_DEFINITIONS[company[field]!] && (
                          <div className="relative group flex-shrink-0 mt-1">
                            <Info className="w-3.5 h-3.5 text-[#787569] cursor-help" />
                            <div className="absolute left-0 bottom-full mb-1.5 w-56 bg-[#33322c] text-white text-xs rounded-lg px-3 py-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                              <p className="font-semibold mb-0.5">{company[field]!.replace(/_/g, ' ')}</p>
                              <p className="text-[#c5c0ad]">{FOURD_DEFINITIONS[company[field]!]}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Funding Rounds */}
        {(() => {
          const fmtAmt = (n: number | null | undefined) => {
            if (!n) return '—';
            if (n >= 1e9) return '$' + parseFloat((n/1e9).toFixed(2)) + 'B';
            if (n >= 1e6) return '$' + parseFloat((n/1e6).toFixed(2)) + 'M';
            return '$' + parseFloat((n/1e3).toFixed(1)) + 'K';
          };
          // Non-dilutive: SBIR, STTR, prizes, grants, contracts — kept separate from equity
          const NON_DILUTIVE = /^(sbir|sttr|prize|award|grant|contract|government)/i;
          const ROUND_ORDER: Record<string, number> = {
            'pre-seed': 0, 'preseed': 0,
            'seed': 1,
            'series a': 2,
            'series b': 3,
            'series c': 4,
            'series d': 5,
            'series e': 6,
            'series f': 7,
            'growth': 8, 'late stage': 8, 'late-stage': 8,
            'pre-ipo': 9, 'pre ipo': 9,
            'ipo': 10, 'public': 10,
          };
          const roundOrder = (type: string | null | undefined) => {
            const key = (type ?? '').toLowerCase().trim();
            // match "Series X" variants e.g. "Series A1" → same bucket as "Series A"
            for (const [k, v] of Object.entries(ROUND_ORDER)) {
              if (key.startsWith(k)) return v;
            }
            return 99;
          };
          const sortRounds = (a: { round_type?: string | null; announced_date?: string | null },
                              b: { round_type?: string | null; announced_date?: string | null }) => {
            const oa = roundOrder(a.round_type), ob = roundOrder(b.round_type);
            if (oa !== ob) return oa - ob;
            return (a.announced_date ?? '').localeCompare(b.announced_date ?? '');
          };
          const equityRounds = [...(company.funding_rounds ?? [])]
            .filter(r => !NON_DILUTIVE.test(r.round_type || ''))
            .sort(sortRounds);
          const nonDilutiveRounds = [...(company.funding_rounds ?? [])]
            .filter(r => NON_DILUTIVE.test(r.round_type || ''))
            .sort(sortRounds);
          const totalRaised = equityRounds.reduce((sum, r) => sum + (r.amount_usd || 0), 0);
          const totalNonDilutive = nonDilutiveRounds.reduce((sum, r) => sum + (r.amount_usd || 0), 0);

          const renderRoundRow = (r: NonNullable<Company['funding_rounds']>[number], rowKey: number | string) => {
            const isEditing = editingRoundId === r.id;
            if (isEditing) return (
              <div key={rowKey} className="py-2 border-b border-[#f9fafb] last:border-0">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">Round Type</label>
                    <input className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-[#6366f1]"
                      value={roundEditFields.round_type} onChange={e => setRoundEditFields(f => ({ ...f, round_type: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">Amount (USD)</label>
                    <input className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-[#6366f1]"
                      value={roundEditFields.amount_usd} onChange={e => setRoundEditFields(f => ({ ...f, amount_usd: e.target.value }))} placeholder="e.g. 75000" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">Pre-Money Valuation (USD)</label>
                    <input className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-[#6366f1]"
                      value={roundEditFields.valuation_usd} onChange={e => setRoundEditFields(f => ({ ...f, valuation_usd: e.target.value }))} placeholder="e.g. 2120000000" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">Date (YYYY-MM-DD)</label>
                    <input className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-[#6366f1]"
                      value={roundEditFields.announced_date} onChange={e => setRoundEditFields(f => ({ ...f, announced_date: e.target.value }))} placeholder="e.g. 2023-03-15" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">Investors</label>
                    <input className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-[#6366f1]"
                      value={roundEditFields.investors} onChange={e => setRoundEditFields(f => ({ ...f, investors: e.target.value }))} placeholder="comma-separated" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">Source URL</label>
                    <input className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-[#6366f1]"
                      value={roundEditFields.source} onChange={e => setRoundEditFields(f => ({ ...f, source: e.target.value }))} placeholder="https://..." />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => saveRoundEdit(r.id!)} disabled={savingRoundEdit}
                    className="flex items-center gap-1 px-3 py-1 bg-[#33322c] text-white text-xs font-semibold rounded hover:bg-[#151411] disabled:opacity-50 transition-colors">
                    <Check className="w-3 h-3" />{savingRoundEdit ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditingRoundId(null)}
                    className="flex items-center gap-1 px-3 py-1 bg-[#f1f5f9]/30 text-[#33322c] text-xs font-semibold rounded hover:bg-slate-200 transition-colors">
                    <X className="w-3 h-3" />Cancel
                  </button>
                </div>
              </div>
            );
            return (
              <div key={rowKey} className="flex items-start justify-between gap-3 text-sm py-1.5 border-b border-[#f9fafb] last:border-0">
                <div className="flex-1">
                  <span className="font-medium text-[#33322c]">{r.round_type}</span>
                  {r.announced_date && <span className="text-[#787569] text-xs ml-2">{r.announced_date.slice(0,7)}</span>}
                  {r.approximate && <span className="text-[10px] text-[#787569] ml-2 italic">est.</span>}
                  {(r.investors ?? []).length > 0 && (
                    <div className="text-xs text-[#545249] mt-0.5">{r.investors.join(', ')}</div>
                  )}
                </div>
                <div className="flex items-start gap-1">
                  <div className="text-right">
                    <span className="font-semibold text-[#33322c]">{r.amount_usd ? fmtAmt(r.amount_usd) : 'Undisclosed'}</span>
                    {r.valuation_usd && <div className="text-xs text-[#545249] mt-0.5">Val: {fmtAmt(r.valuation_usd)}</div>}
                    {r.source && (
                      <a href={r.source} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#6366f1] hover:underline mt-0.5 block">
                        {(() => { try { return new URL(r.source).hostname.replace('www.',''); } catch { return 'source'; } })()} ↗
                      </a>
                    )}
                  </div>
                  {r.id && (
                    <>
                      <button onClick={() => {
                        setRoundEditFields({
                          round_type: r.round_type ?? '',
                          amount_usd: r.amount_usd ? String(r.amount_usd) : '',
                          valuation_usd: r.valuation_usd ? String(r.valuation_usd) : '',
                          announced_date: r.announced_date ?? '',
                          investors: (r.investors ?? []).join(', '),
                          source: r.source ?? '',
                        });
                        setEditingRoundId(r.id!);
                      }}
                        className="p-1 text-[#c5c0ad] hover:text-[#6366f1] transition-colors mt-0.5" title="Edit round">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteRound(r.id!)} disabled={deletingRound === r.id}
                        className="p-1 text-[#c5c0ad] hover:text-red-400 transition-colors disabled:opacity-40 mt-0.5" title="Remove round">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          };

          return (
          <div className="bg-white rounded border border-slate-200 mb-6">
            <button
              onClick={() => setShowFunding(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#ede8d7] transition-colors rounded"
            >
              <div className="flex items-center gap-2.5">
                <svg className={`w-4 h-4 text-[#787569] transition-transform ${showFunding ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                <span className="text-sm font-semibold text-[#33322c]">Funding History</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#dbeafe] text-[#1e40af]">Funding Enrichment</span>
                {!showFunding && totalRaised > 0 && (
                  <span className="text-xs font-semibold text-[#33322c]">${parseFloat((totalRaised/1e6).toFixed(2))}M raised</span>
                )}
                {!showFunding && (company.funding_rounds ?? []).some(r => r.approximate) && (
                  <span className="text-xs text-[#787569] italic">Some figures approximate</span>
                )}
              </div>
              <span className="text-[10px] text-[#787569]">{showFunding ? 'collapse' : 'expand'}</span>
            </button>
            {showFunding && (
            <div className="px-5 pb-5 pt-1">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {(company.funding_rounds ?? []).some(r => r.approximate) && (
                  <span className="text-xs text-[#787569] italic">Some figures are approximate</span>
                )}
                <button onClick={() => setShowAddRound(v => !v)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#6366f1] border border-[#6366f1]/30 rounded-lg hover:bg-[#6366f1]/5 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add Round
                </button>
              </div>
            </div>

            {equityRounds.length === 0 && nonDilutiveRounds.length === 0 && !showAddRound && (
              <p className="text-sm text-[#787569] text-center py-6">No funding data yet — run Funding &amp; Commercial enrichment or add a round manually above.</p>
            )}

            {/* Total raised hero */}
            <div className="flex items-baseline gap-4 mb-5">
              {totalRaised > 0 && (
                <div>
                  <span className="text-3xl font-black tracking-tight text-[#33322c]">{fmtAmt(totalRaised)}</span>
                  <span className="text-sm font-medium text-[#787569] ml-2">equity raised</span>
                </div>
              )}
              {totalNonDilutive > 0 && (
                <div>
                  <span className={cls.sectionTitle}>{fmtAmt(totalNonDilutive)}</span>
                  <span className="text-xs font-medium text-[#787569] ml-1.5">non-dilutive</span>
                </div>
              )}
            </div>

            {/* Equity bar chart */}
            {equityRounds.length > 0 && (() => {
              const CHART_H = 100;
              const maxAmt = Math.max(...equityRounds.map(x => x.amount_usd || 0));
              const colors = ['#33322c','#10b981','#6366f1','#f59e0b','#0ea5e9','#ef4444'];
              return (
                <div className="flex items-end gap-1 overflow-x-auto pb-3 mb-4 border-b border-[#f3f4f6]" style={{ paddingTop: '32px' }}>
                  {equityRounds.map((r, i) => {
                    const amtH = maxAmt > 0 ? Math.max(Math.round(((r.amount_usd || 0) / maxAmt) * CHART_H), 4) : 4;
                    const rawValH = r.valuation_usd && maxAmt > 0 ? Math.round((r.valuation_usd / maxAmt) * CHART_H) : 0;
                    const valH = rawValH > 0 ? Math.min(Math.max(rawValH, amtH + 20), Math.round(CHART_H * 1.6)) : 0;
                    const colHeight = Math.max(amtH, valH, 20);
                    return (
                      <div key={r.id ?? i} className="flex flex-col items-center flex-1 min-w-[72px] px-1">
                        <div className="relative w-full" style={{ height: `${colHeight}px`, overflow: 'visible' }}>
                          {/* translucent valuation bar */}
                          {valH > 0 && (
                            <div className="absolute bottom-0 left-0 right-0 rounded-t"
                              style={{ height: `${valH}px`, backgroundColor: colors[i % colors.length], opacity: 0.18 }} />
                          )}
                          {/* solid raise bar */}
                          <div className="absolute bottom-0 left-0 right-0 rounded-t"
                            style={{ height: `${amtH}px`, backgroundColor: colors[i % colors.length], opacity: r.approximate ? 0.5 : 1 }} />
                          {/* valuation label — just above translucent bar */}
                          {valH > 0 && r.valuation_usd && (
                            <div className="absolute left-0 right-0 text-center text-[10px] text-[#787569] leading-none"
                              style={{ bottom: `${valH + 3}px` }}>
                              val {fmtAmt(r.valuation_usd)}
                            </div>
                          )}
                          {/* raise amount label — just above solid bar */}
                          <div className="absolute left-0 right-0 text-center text-xs font-semibold text-[#33322c] leading-none"
                            style={{ bottom: `${amtH + 3}px` }}>
                            {fmtAmt(r.amount_usd)}
                          </div>
                        </div>
                        <div className="text-xs text-[#545249] mt-1 text-center leading-tight">{r.round_type}</div>
                        {r.announced_date && <div className="text-[10px] text-[#787569] text-center">{r.announced_date.slice(0,7)}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Equity detail rows */}
            {equityRounds.length > 0 && (
              <>
                <button onClick={() => setShowRoundDetail(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#545249] hover:text-[#33322c] transition-colors mt-1">
                  <svg className={`w-3.5 h-3.5 transition-transform ${showRoundDetail ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
                  {showRoundDetail ? 'Hide rounds' : `Show rounds (${equityRounds.length})`}
                </button>
                {showRoundDetail && (
                  <div className="space-y-2 mt-3">
                    {[...equityRounds].reverse().map((r, i) => renderRoundRow(r, r.id ?? i))}
                  </div>
                )}
              </>
            )}

            {/* Non-dilutive funding */}
            {nonDilutiveRounds.length > 0 && (
              <div className={`${equityRounds.length > 0 ? 'mt-5 pt-4 border-t border-[#f3f4f6]' : ''}`}>
                <button
                  onClick={() => setShowNonDilutive(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#545249] hover:text-[#33322c] transition-colors"
                >
                  <svg className={`w-3.5 h-3.5 transition-transform ${showNonDilutive ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
                  {showNonDilutive ? 'Hide non-dilutive' : `Non-Dilutive Funding (${nonDilutiveRounds.length})`}
                </button>
                {showNonDilutive && (
                  <div className="space-y-2 mt-3">
                    {nonDilutiveRounds.map((r, i) => renderRoundRow(r, r.id ?? i))}
                  </div>
                )}
              </div>
            )}

            {/* Add round form */}
            {showAddRound && (
              <div className="mt-4 pt-4 border-t border-[#f3f4f6]">
                <p className="text-xs font-semibold text-[#545249] uppercase tracking-wide mb-3">Add Funding Round</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">Round Type *</label>
                    <input
                      className="w-full mt-0.5 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#6366f1]"
                      placeholder="e.g. Series A, Grant, SBIR"
                      value={roundForm.round_type}
                      onChange={e => setRoundForm(f => ({ ...f, round_type: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">Amount (USD)</label>
                    <input
                      className="w-full mt-0.5 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#6366f1]"
                      placeholder="e.g. 2750000"
                      value={roundForm.amount_usd}
                      onChange={e => setRoundForm(f => ({ ...f, amount_usd: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">Pre-Money Valuation (USD)</label>
                    <input
                      className="w-full mt-0.5 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#6366f1]"
                      placeholder="e.g. 2120000000"
                      value={roundForm.valuation_usd}
                      onChange={e => setRoundForm(f => ({ ...f, valuation_usd: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">Date (YYYY-MM-DD)</label>
                    <input
                      className="w-full mt-0.5 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#6366f1]"
                      placeholder="e.g. 2024-03-15"
                      value={roundForm.announced_date}
                      onChange={e => setRoundForm(f => ({ ...f, announced_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide flex items-center gap-1.5">
                      Source URL
                      {roundAutofilling && <span className="text-[9px] font-bold text-indigo-500 animate-pulse">Autofilling…</span>}
                    </label>
                    <input
                      className="w-full mt-0.5 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#6366f1]"
                      placeholder="Paste a link — fields fill automatically"
                      value={roundForm.source}
                      onChange={e => setRoundForm(f => ({ ...f, source: e.target.value }))}
                      onPaste={e => {
                        const pasted = e.clipboardData.getData('text').trim();
                        if (pasted.startsWith('http')) setTimeout(() => autofillRound(pasted), 50);
                      }}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide">Investors (comma-separated)</label>
                    <input
                      className="w-full mt-0.5 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#6366f1]"
                      placeholder="e.g. Andreessen Horowitz, Sequoia"
                      value={roundForm.investors}
                      onChange={e => setRoundForm(f => ({ ...f, investors: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-[#545249] cursor-pointer">
                    <input type="checkbox" checked={roundForm.approximate} onChange={e => setRoundForm(f => ({ ...f, approximate: e.target.checked }))} className="rounded" />
                    Approximate amount
                  </label>
                  <div className="flex gap-2 ml-auto">
                    <button onClick={() => setShowAddRound(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-[#545249] border border-slate-200 rounded-lg hover:bg-[#ede8d7] transition-colors">
                      Cancel
                    </button>
                    <button onClick={saveRound} disabled={savingRound || !roundForm.round_type.trim()}
                      className="px-3 py-1.5 text-xs font-semibold bg-[#33322c] text-white rounded-lg hover:bg-[#151411] disabled:opacity-50 transition-colors">
                      {savingRound ? 'Saving…' : 'Save Round'}
                    </button>
                  </div>
                </div>
              </div>
            )}
            </div>
            )}
          </div>
          );
        })()}

        {/* Deployments & Case Studies */}
        {(() => {
          const DEPLOYMENT_TYPES = ['Paid Pilot', 'PoC', 'LOI', 'Commercial Deployment', 'Renewal', 'Enterprise', 'Government Contract'];
          const fmtVal = (v: number | null) => v == null ? 'Undisclosed' : v >= 1e6 ? `$${parseFloat((v / 1e6).toFixed(2))}M` : v >= 1e3 ? `$${parseFloat((v / 1e3).toFixed(1))}K` : `$${v.toLocaleString()}`;

          // build chart data — one point per deployment sorted by start_date
          const chartData = [...deployments]
            .filter(d => d.start_date && d.contract_value_usd)
            .sort((a, b) => (a.start_date ?? '') < (b.start_date ?? '') ? -1 : 1)
            .map(d => ({
              date: d.start_date!.slice(0, 7), // YYYY-MM
              value: d.contract_value_usd! / 1e3, // display in $K
              label: d.stealth && !stealthVisible.has(d.id) ? '●●●' : (d.customer_name ?? 'Unknown'),
            }));

          const totalContractValue = deployments.reduce((s, d) => s + (d.contract_value_usd ?? 0), 0);
          const cs = editMode ? (draft.commercial_signals ?? company.commercial_signals) : company.commercial_signals;

          return (
            <div className="bg-white rounded border border-slate-200 mb-6">
              <button
                onClick={() => setShowCommercial(v => !v)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#ede8d7] transition-colors rounded"
              >
                <div className="flex items-center gap-2.5">
                  <svg className={`w-4 h-4 text-[#787569] transition-transform ${showCommercial ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                  <TrendingUp className="w-4 h-4 text-[#10b981]" />
                  <span className="text-sm font-semibold text-[#33322c]">Deployments & Case Studies</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#d1fae5] text-[#065f46]">Deployment Enrichment</span>
                  {!showCommercial && deployments.length > 0 && (
                    <span className="text-xs font-semibold text-[#10b981]">{deployments.length} contract{deployments.length !== 1 ? 's' : ''}{totalContractValue > 0 ? ` · ${fmtVal(totalContractValue)}` : ''}</span>
                  )}
                </div>
                <span className="text-[10px] text-[#787569]">{showCommercial ? 'collapse' : 'expand'}</span>
              </button>
              {showCommercial && (
              <div className="px-5 pb-5 pt-1">
              <div className="flex justify-end mb-3">
                <button
                  onClick={() => setShowAddDeployment(v => !v)}
                  className="flex items-center gap-1 text-xs font-semibold text-white bg-[#10b981] hover:bg-[#059669] px-3 py-1.5 rounded-md transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>

              {/* Commercial Signals strip — always visible, always directly toggleable */}
              {(() => {
                const signals = company.commercial_signals ?? {};
                const SIGNAL_KEYS = [
                  { key: 'product_available'        as const, label: 'Product Available' },
                  { key: 'enterprise_deployment'    as const, label: 'Enterprise Deployment' },
                  { key: 'has_enterprise_customers' as const, label: 'Enterprise Customers' },
                  { key: 'b2b_focus'                as const, label: 'B2B Focus' },
                ] as const;
                const patchSignals = async (updated: Record<string, any>) => {
                  const r = await fetch(`/companies/${id}`, {
                    method: 'PATCH',
                    headers: { ...AUTH, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ commercial_signals: updated }),
                  });
                  if (!r.ok) { setEnrichResult(`Save failed (${r.status})`); return; }
                  await refreshProfile();
                };
                return (
                  <div className="mb-5">
                    <p className="text-[10px] font-semibold text-[#787569] uppercase tracking-wide mb-2">Enrichment Signals</p>
                    <div className="flex flex-wrap gap-2">
                      {SIGNAL_KEYS.map(({ key, label }) => {
                        const val = !!signals[key];
                        return (
                          <button key={key} type="button"
                            onClick={() => patchSignals({ ...signals, [key]: !val })}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                              val ? 'bg-[#d1fae5] border-[#6ee7b7] text-[#065f46]' : 'bg-[#f3f4f6] border-slate-200 text-[#545249] hover:border-[#6366f1]'
                            }`}>
                            <span>{val ? '✓' : '○'}</span>
                            <span>{label}</span>
                          </button>
                        );
                      })}
                      <select
                        value={signals.revenue_evidence ?? ''}
                        onChange={e => patchSignals({ ...signals, revenue_evidence: e.target.value || undefined })}
                        className="text-xs border border-slate-200 rounded-full px-2.5 py-1 focus:outline-none focus:border-[#6366f1] bg-white text-[#33322c]"
                      >
                        <option value="">— Revenue Evidence —</option>
                        <option value="strong">Strong revenue</option>
                        <option value="moderate">Moderate revenue</option>
                        <option value="weak">Weak revenue</option>
                        <option value="none">No revenue</option>
                      </select>
                    </div>
                  </div>
                );
              })()}

              {/* Revenue traction card — shown when we have ARR data but not in edit mode */}
              {!editMode && company.revenue_arr_usd && (
                <div className="mb-4 p-3 rounded-lg bg-[#f0fdf4] border border-[#bbf7d0] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <TrendingUp className="w-4 h-4 text-[#10b981] shrink-0" />
                    <span className="text-sm font-bold text-[#065f46]">
                      {company.revenue_arr_usd >= 1e6
                        ? `$${parseFloat((company.revenue_arr_usd / 1e6).toFixed(2))}M`
                        : company.revenue_arr_usd >= 1e3
                        ? `$${parseFloat((company.revenue_arr_usd / 1e3).toFixed(1))}K`
                        : `$${company.revenue_arr_usd.toLocaleString()}`} ARR
                    </span>
                    {company.revenue_period && (
                      <span className="text-xs text-[#545249]">· {company.revenue_period}</span>
                    )}
                  </div>
                  {company.revenue_source && (
                    company.revenue_source.startsWith('http')
                      ? <a href={company.revenue_source} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-[#10b981] hover:underline flex items-center gap-0.5 shrink-0">
                          <ExternalLink className="w-2.5 h-2.5" /> source
                        </a>
                      : <span className="text-[10px] text-[#10b981] shrink-0">{company.revenue_source}</span>
                  )}
                </div>
              )}

              {/* Revenue ARR — edit inputs (only shown in edit mode) */}
              {editMode && (
                <div className="mb-5 p-3 rounded-lg bg-[#f0fdf4] border border-[#bbf7d0]">
                  <p className="text-[10px] font-semibold text-[#065f46] uppercase tracking-wide mb-2">Revenue / ARR</p>
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] text-[#545249] mb-1 block">ARR (USD)</label>
                        <input
                          type="number"
                          placeholder="e.g. 30000000"
                          value={draft.revenue_arr_usd ?? company.revenue_arr_usd ?? ''}
                          onChange={e => setDraft(d => ({ ...d, revenue_arr_usd: e.target.value ? parseInt(e.target.value) : null }))}
                          className={INPUT_CLS}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] text-[#545249] mb-1 block">Period</label>
                        <input
                          type="text"
                          placeholder="e.g. H1 2025, Q1 2026"
                          value={draft.revenue_period ?? company.revenue_period ?? ''}
                          onChange={e => setDraft(d => ({ ...d, revenue_period: e.target.value || null }))}
                          className={INPUT_CLS}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-[#545249] mb-1 block">Source URL</label>
                      <input
                        type="url"
                        placeholder="https://..."
                        value={draft.revenue_source ?? company.revenue_source ?? ''}
                        onChange={e => setDraft(d => ({ ...d, revenue_source: e.target.value || null }))}
                        className={INPUT_CLS}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Contract value chart — prominent when data exists, placeholder when empty */}
              {chartData.length > 0 ? (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-[#33322c]">Contract Value Over Time</p>
                    <p className="text-[10px] text-[#787569]">$K · hover for details</p>
                  </div>
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#787569' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#787569' }} tickFormatter={(v: number) => `$${v}K`} />
                        <Tooltip
                          formatter={(value: number, _: string, entry: any) => [`$${value}K — ${entry.payload.label}`, 'Contract']}
                          contentStyle={{ fontSize: 11, borderRadius: 6 }}
                        />
                        <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2.5} dot={{ r: 5, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : deploymentsLoaded && deployments.length === 0 && (
                <div className="mb-5 rounded-lg border border-dashed border-slate-200 bg-[#ede8d7] flex flex-col items-center justify-center py-8 text-center">
                  <TrendingUp className="w-8 h-8 text-[#c5c0ad] mb-2" />
                  <p className="text-sm font-medium text-[#787569]">No contract data yet</p>
                  <p className="text-xs text-[#c0c7cd] mt-1">Add your first deployment above — the chart will build as contracts accumulate</p>
                </div>
              )}

              {/* Add form */}
              {showAddDeployment && (
                <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg p-4 mb-4">
                  <p className="text-xs font-semibold text-[#065f46] uppercase tracking-wide mb-3">New Deployment Entry</p>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Customer Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Walmart, Stealth…"
                        value={depForm.customer_name}
                        onChange={e => setDepForm(f => ({ ...f, customer_name: e.target.value }))}
                        className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-[#33322c]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Type *</label>
                      <select
                        value={depForm.deployment_type}
                        onChange={e => setDepForm(f => ({ ...f, deployment_type: e.target.value }))}
                        className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-[#33322c]"
                      >
                        {DEPLOYMENT_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Contract Value (USD)</label>
                      <input
                        type="text"
                        placeholder="e.g. 250000"
                        value={depForm.contract_value_usd}
                        onChange={e => setDepForm(f => ({ ...f, contract_value_usd: e.target.value }))}
                        className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-[#33322c]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Start Date</label>
                      <input
                        type="date"
                        value={depForm.start_date}
                        onChange={e => setDepForm(f => ({ ...f, start_date: e.target.value }))}
                        className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-[#33322c]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">End Date</label>
                      <input
                        type="date"
                        value={depForm.end_date}
                        onChange={e => setDepForm(f => ({ ...f, end_date: e.target.value }))}
                        className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-[#33322c]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Notes</label>
                      <input
                        type="text"
                        placeholder="Optional context…"
                        value={depForm.notes}
                        onChange={e => setDepForm(f => ({ ...f, notes: e.target.value }))}
                        className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-[#33322c]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Source URL</label>
                      <input
                        type="text"
                        placeholder="Link to press release or announcement…"
                        value={depForm.source_url}
                        onChange={e => setDepForm(f => ({ ...f, source_url: e.target.value }))}
                        className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-[#33322c]"
                      />
                    </div>
                  </div>
                  {depFormErr && (
                    <p className="text-xs text-red-500 mb-2">{depFormErr}</p>
                  )}
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <div
                        onClick={() => setDepForm(f => ({ ...f, stealth: !f.stealth }))}
                        className={`w-8 h-4 rounded-full transition-colors relative ${depForm.stealth ? 'bg-[#7c3aed]' : 'bg-[#f1f5f9]'}`}
                      >
                        <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${depForm.stealth ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <span className="text-xs font-medium text-[#33322c]">Stealth mode</span>
                      {depForm.stealth && <span className="text-[10px] text-[#7c3aed] font-semibold">Customer name will be blurred</span>}
                    </label>
                    <div className="ml-auto flex gap-2">
                      <button onClick={() => { setShowAddDeployment(false); setDepFormErr(null); }} className="text-xs px-3 py-1.5 border border-slate-200 rounded text-[#545249] hover:bg-[#f3f4f6]">Cancel</button>
                      <button onClick={saveDeployment} disabled={savingDep} className="text-xs px-3 py-1.5 bg-[#10b981] text-white rounded font-semibold hover:bg-[#059669] disabled:opacity-50">
                        {savingDep ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Chart */}
              {chartData.length > 1 && (
                <div className="mb-5" style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#787569' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#787569' }} tickFormatter={(v: number) => `$${v}K`} />
                      <Tooltip
                        formatter={(value: number, _: string, entry: any) => [`$${value}K — ${entry.payload.label}`, 'Contract']}
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                      />
                      <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={{ r: 4, fill: '#10b981' }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Deployment list */}
              {!deploymentsLoaded && <p className="text-xs text-[#787569] text-center py-4">Loading…</p>}
              {deploymentsLoaded && deployments.length === 0 && !showAddDeployment && (
                <p className="text-xs text-[#787569] text-center py-6">No deployments recorded yet.</p>
              )}
              {deploymentsLoaded && deployments.length > 0 && (
                <div className="space-y-2">
                  {deployments.map(dep => {
                    const isEditing = editingDepId === dep.id;
                    const isStealthRevealed = stealthVisible.has(dep.id);
                    if (isEditing) {
                      return (
                        <div key={dep.id} className="bg-white border border-slate-200 rounded p-3">
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            <div>
                              <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Customer</label>
                              <input type="text" value={depEditFields.customer_name} onChange={e => setDepEditFields(f => ({ ...f, customer_name: e.target.value }))} className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-[#33322c]" />
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Type</label>
                              <select value={depEditFields.deployment_type} onChange={e => setDepEditFields(f => ({ ...f, deployment_type: e.target.value }))} className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-[#33322c]">
                                {DEPLOYMENT_TYPES.map(t => <option key={t}>{t}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Value (USD)</label>
                              <input type="text" value={depEditFields.contract_value_usd} onChange={e => setDepEditFields(f => ({ ...f, contract_value_usd: e.target.value }))} className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-[#33322c]" />
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Start Date</label>
                              <input type="date" value={depEditFields.start_date} onChange={e => setDepEditFields(f => ({ ...f, start_date: e.target.value }))} className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-[#33322c]" />
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">End Date</label>
                              <input type="date" value={depEditFields.end_date} onChange={e => setDepEditFields(f => ({ ...f, end_date: e.target.value }))} className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-[#33322c]" />
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Notes</label>
                              <input type="text" value={depEditFields.notes} onChange={e => setDepEditFields(f => ({ ...f, notes: e.target.value }))} className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-[#33322c]" />
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] font-semibold text-[#545249] uppercase block mb-1">Source URL</label>
                              <input type="text" value={depEditFields.source_url} onChange={e => setDepEditFields(f => ({ ...f, source_url: e.target.value }))} placeholder="Link to press release or announcement…" className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-[#33322c]" />
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                              <div onClick={() => setDepEditFields(f => ({ ...f, stealth: !f.stealth }))} className={`w-8 h-4 rounded-full transition-colors relative ${depEditFields.stealth ? 'bg-[#7c3aed]' : 'bg-[#f1f5f9]'}`}>
                                <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${depEditFields.stealth ? 'translate-x-4' : 'translate-x-0.5'}`} />
                              </div>
                              <span className="text-[10px] font-medium text-[#33322c]">Stealth</span>
                            </label>
                            <div className="ml-auto flex gap-2">
                              <button onClick={() => setEditingDepId(null)} className="text-xs px-2 py-1 border border-slate-200 rounded text-[#545249] hover:bg-[#f3f4f6]">Cancel</button>
                              <button onClick={() => saveDepEdit(dep.id)} disabled={savingDepEdit} className="text-xs px-2 py-1 bg-[#10b981] text-white rounded font-semibold hover:bg-[#059669] disabled:opacity-50 flex items-center gap-1">
                                <Check className="w-3 h-3" />{savingDepEdit ? 'Saving…' : 'Save'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={dep.id} className="flex items-start gap-3 py-2.5 px-3 bg-white rounded border border-slate-200 group">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-sm font-semibold text-[#33322c]"
                              style={dep.stealth && !isStealthRevealed ? { filter: 'blur(5px)', userSelect: 'none' } : {}}
                            >
                              {dep.customer_name || 'Unknown customer'}
                            </span>
                            {dep.stealth && (
                              <button
                                onClick={() => toggleStealthVisible(dep.id)}
                                className="text-[#7c3aed] hover:text-[#5b21b6] flex items-center gap-0.5"
                                title={isStealthRevealed ? 'Hide name' : 'Reveal name'}
                              >
                                {isStealthRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            )}
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              dep.deployment_type === 'Commercial Deployment' ? 'bg-[#d1fae5] text-[#065f46]' :
                              dep.deployment_type === 'Paid Pilot' ? 'bg-[#dbeafe] text-[#1e40af]' :
                              dep.deployment_type === 'Enterprise' ? 'bg-[#fef3c7] text-[#92400e]' :
                              dep.deployment_type === 'Government Contract' ? 'bg-[#e0e7ff] text-[#3730a3]' :
                              'bg-[#f3f4f6] text-[#33322c]'
                            }`}>
                              {dep.deployment_type}
                            </span>
                            {dep.contract_value_usd && (
                              <span className="text-xs font-semibold text-[#10b981]">{fmtVal(dep.contract_value_usd)}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[#787569]">
                            {dep.start_date && <span>{dep.start_date}</span>}
                            {dep.end_date && <span>→ {dep.end_date}</span>}
                            {dep.notes && <span className="truncate max-w-xs">{dep.notes}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              setEditingDepId(dep.id);
                              setDepEditFields({
                                customer_name: dep.customer_name ?? '',
                                deployment_type: dep.deployment_type,
                                contract_value_usd: dep.contract_value_usd ? String(dep.contract_value_usd) : '',
                                start_date: dep.start_date ?? '',
                                end_date: dep.end_date ?? '',
                                stealth: dep.stealth,
                                notes: dep.notes ?? '',
                                source_url: dep.source_url ?? '',
                              });
                            }}
                            className="p-1 text-[#787569] hover:text-[#33322c] rounded"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteDep(dep.id)}
                            disabled={deletingDepId === dep.id}
                            className="p-1 text-[#787569] hover:text-red-500 rounded disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Legacy case study — freeform text entered manually */}
              {company.case_study && (
                <div className="mt-5 pt-5 border-t border-slate-200">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#545249] mb-2 flex items-center gap-2">
                    SLAM Case Study Note
                    <span className="text-[#787569] font-normal normal-case tracking-normal">manually entered</span>
                  </p>
                  <p className="text-sm text-[#33322c] leading-relaxed whitespace-pre-line">{company.case_study}</p>
                </div>
              )}

              {/* Brave-sourced case studies — collapsible */}
              {(company.case_studies ?? []).length > 0 && (
                <div className="mt-5 pt-5 border-t border-slate-200">
                  <button
                    onClick={() => setShowCaseStudies(v => !v)}
                    className="flex items-center gap-2 w-full text-left mb-2 group"
                  >
                    <svg className={`w-3.5 h-3.5 text-[#787569] transition-transform ${showCaseStudies ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                    <p className="text-xs font-bold uppercase tracking-wide text-[#545249]">
                      From Brave Research
                      <span className="ml-1.5 font-normal normal-case text-[#787569]">({company.case_studies!.length})</span>
                    </p>
                  </button>
                  {showCaseStudies && (
                    <div className="space-y-2">
                      {company.case_studies!.map((a, i) => (
                        <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                          className="block p-3 rounded-lg border border-slate-200 hover:border-slate-200 hover:bg-[#ede8d7] transition-colors group">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="text-sm font-medium text-[#33322c] group-hover:text-[#065f46] leading-snug">{a.title}</span>
                            <ExternalLink className="w-3.5 h-3.5 text-[#787569] flex-shrink-0 mt-0.5" />
                          </div>
                          {a.snippet && <p className="text-xs text-[#545249] leading-relaxed line-clamp-2">{a.snippet}</p>}
                          {a.age && <p className="text-[10px] text-[#787569] mt-1">{a.age}</p>}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
              </div>
              )}
            </div>
          );
        })()}

        {/* Portco Announcements */}
        {announcements.length > 0 && (
          <div className="bg-white rounded border border-slate-200 p-6 mb-6">
            <h3 className={`${cls.sectionTitle} mb-4`}>Announcements</h3>
            <div className="space-y-3">
              {announcements.map(ann => (
                <div key={ann.id} className="p-3 rounded border border-slate-200 hover:border-slate-300 transition-colors">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {!ann.is_public && (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-violet-50 text-violet-700 border-violet-200">
                            <Lock className="w-2.5 h-2.5" /> Stealth
                          </span>
                        )}
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize ${
                          ann.announcement_type === 'funding'     ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          ann.announcement_type === 'partnership' ? 'bg-teal-50 text-teal-700 border-teal-200' :
                          ann.announcement_type === 'product'     ? 'bg-blue-50 text-blue-700 border-blue-200' :
                          ann.announcement_type === 'press'       ? 'bg-slate-100 text-slate-600 border-slate-200' :
                          ann.announcement_type === 'internal'    ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          {ann.announcement_type}
                        </span>
                        {ann.is_public && (
                          <span className="flex items-center gap-1 text-[10px] text-slate-500">
                            <Globe className="w-2.5 h-2.5" /> Public
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-[#33322c]">{ann.title}</p>
                      {ann.body && <p className="text-xs text-[#545249] mt-1 leading-relaxed">{ann.body}</p>}
                      <div className="flex items-center gap-3 mt-1.5">
                        {ann.announced_date && (
                          <span className="text-[10px] text-[#787569]">
                            {new Date(ann.announced_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        )}
                        {ann.source_url && (
                          <a href={ann.source_url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 text-[10px] text-blue-600 hover:underline">
                            <ExternalLink className="w-2.5 h-2.5" /> Source
                          </a>
                        )}
                        {ann.added_by && <span className="text-[10px] text-[#787569]">logged by {ann.added_by}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* News */}
        {(company.news_articles?.length ?? 0) > 0 && (() => {
          // Parse "X days/weeks/months ago" → seconds for sort (lower = more recent)
          const ageToSec = (age: string) => {
            const m = age?.match(/(\d+)\s+(second|minute|hour|day|week|month|year)/);
            if (!m) return 999999999;
            const [, n, unit] = m;
            return +n * ({ second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 } as Record<string, number>)[unit];
          };
          const sorted = [...company.news_articles!].sort((a, b) => ageToSec(a.age) - ageToSec(b.age));
          return (
            <div className="bg-white rounded border border-slate-200 p-6 mb-6">
              <h3 className={`${cls.sectionTitle} mb-4`}>News</h3>
              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {sorted.map((a, i) => (
                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                    className="block p-3 rounded-lg border border-slate-200 hover:border-[#33322c] hover:bg-[#f8fafc] transition-colors group">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-sm font-medium text-[#33322c] group-hover:text-[#33322c] leading-snug">{a.title}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-[#787569] flex-shrink-0 mt-0.5" />
                    </div>
                    {a.snippet && <p className="text-xs text-[#545249] leading-relaxed line-clamp-2">{a.snippet}</p>}
                    {a.age && <p className="text-[10px] text-[#787569] mt-1">{a.age}</p>}
                  </a>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Scores Grid */}
        {editMode ? (
          <div className="bg-white rounded border border-slate-200 p-4 mb-6">
            <p className="text-xs font-semibold text-[#545249] uppercase mb-3">Scores (0–100)</p>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {([
                ['score_composite', 'Composite'],
                ['score_commercial', 'Commercial'],
                ['score_technical', 'Technical'],
                ['score_market_timing', 'Market Timing'],
                ['score_partner_fit', 'Partner Fit'],
                ['score_capital_eff', 'Capital Efficiency'],
              ] as [keyof Company, string][]).map(([field, label]) => (
                <div key={field}>
                  <label className="text-xs text-[#787569] block mb-1">{label}</label>
                  <input
                    type="number"
                    min={0} max={100} step={1}
                    value={draft[field] != null ? String(draft[field]) : (company[field] != null ? String(Math.round(company[field] as number)) : '')}
                    onChange={e => setDraft(d => ({ ...d, [field]: e.target.value ? parseFloat(e.target.value) : undefined }))}
                    placeholder="—"
                    className={INPUT_CLS}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
            <ScoreCard label="Composite" score={company.score_composite != null ? Math.round(company.score_composite) : null} emphasized />
            <ScoreCard label="Commercial" score={company.score_commercial != null ? Math.round(company.score_commercial) : null} />
            <ScoreCard label="Technical" score={company.score_technical != null ? Math.round(company.score_technical) : null} />
            <ScoreCard label="Market Timing" score={company.score_market_timing != null ? Math.round(company.score_market_timing) : null} />
            <ScoreCard label="Partner Fit" score={company.score_partner_fit != null ? Math.round(company.score_partner_fit) : null} />
            <ScoreCard label="Capital Efficiency" score={company.score_capital_eff != null ? Math.round(company.score_capital_eff) : null} />
          </div>
        )}

        {/* DD Results */}
        {ddStatus?.status === 'complete' && ddOverview && (() => {
          const recoConfig: Record<string, { label: string; bg: string; text: string; border: string }> = {
            invest:      { label: 'Invest',      bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-300' },
            conditional: { label: 'Conditional', bg: 'bg-blue-50',     text: 'text-blue-700',    border: 'border-blue-300'    },
            watch:       { label: 'Watch',        bg: 'bg-yellow-50',   text: 'text-yellow-700',  border: 'border-yellow-300'  },
            pass:        { label: 'Pass',         bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-300'     },
          };
          const reco = ddOverview.recommendation?.toLowerCase() ?? 'watch';
          const rc = recoConfig[reco] ?? recoConfig.watch;
          const topFlags = (ddOverview.all_flags ?? []).filter(f => f.severity === 'red').slice(0, 5);
          const companyName = ddStatus.company_name;
          const outputs = ddStatus.stages.outputs;

          const startEdit = () => {
            setDdEditReco(reco);
            setDdEditRationale(ddOverview.recommendation_rationale ?? '');
            setDdEditing(true);
          };
          const cancelDdEdit = () => setDdEditing(false);
          const saveDdEdit = async () => {
            setDdSaving(true);
            try {
              const r = await fetch(`/admin/dd/${id}/overview`, {
                method: 'PATCH',
                headers: { ...AUTH, 'Content-Type': 'application/json' },
                body: JSON.stringify({ recommendation: ddEditReco, recommendation_rationale: ddEditRationale }),
              });
              if (r.ok) {
                setDdOverview(prev => prev ? { ...prev, recommendation: ddEditReco, recommendation_rationale: ddEditRationale } : prev);
                setDdEditing(false);
              }
            } finally { setDdSaving(false); }
          };
          const confirmDelete = async () => {
            const r = await fetch(`/admin/dd/${id}`, { method: 'DELETE', headers: AUTH });
            if (r.ok) { setDdStatus(null); setDdOverview(null); setDdAgents([]); setDdConfirmDelete(false); }
          };

          return (
            <div className="bg-white rounded border border-[#33322c]/30 p-6 mb-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#33322c]" />
                  <h3 className={cls.sectionTitle}>Due Diligence Results</h3>
                </div>
                <div className="flex items-center gap-2">
                  {!ddEditing && !ddConfirmDelete && (
                    <span className={`px-3 py-1 text-sm font-semibold rounded border ${rc.bg} ${rc.text} ${rc.border}`}>
                      {rc.label}
                    </span>
                  )}
                  {!ddEditing && !ddConfirmDelete && (
                    <button onClick={startEdit} className="p-1.5 rounded border border-slate-200 text-[#545249] hover:text-[#33322c] hover:border-[#33322c] transition-colors" title="Edit recommendation">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {!ddEditing && !ddConfirmDelete && (
                    <button onClick={() => setDdConfirmDelete(true)} className="p-1.5 rounded border border-slate-200 text-[#545249] hover:text-red-600 hover:border-red-300 transition-colors" title="Delete DD run">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {ddConfirmDelete && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-red-600 font-medium">Delete this DD run?</span>
                      <button onClick={confirmDelete} className="px-3 py-1 bg-red-600 text-white text-xs font-semibold rounded hover:bg-red-700 transition-colors">Delete</button>
                      <button onClick={() => setDdConfirmDelete(false)} className="px-3 py-1 border border-slate-200 text-[#545249] text-xs font-medium rounded hover:bg-[#ede8d7] transition-colors">Cancel</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Inline edit form */}
              {ddEditing && (
                <div className="bg-[#ede8d7] rounded p-4 mb-5 border border-slate-200">
                  <p className="text-xs font-semibold text-[#545249] uppercase mb-3">Edit Recommendation</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {(['invest', 'conditional', 'watch', 'pass'] as const).map(r => (
                      <button key={r} onClick={() => setDdEditReco(r)}
                        className={`px-3 py-1 text-sm font-semibold rounded border capitalize transition-colors ${
                          ddEditReco === r
                            ? r === 'invest' ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
                              : r === 'conditional' ? 'bg-blue-100 border-blue-400 text-blue-800'
                              : r === 'watch' ? 'bg-yellow-100 border-yellow-400 text-yellow-800'
                              : 'bg-red-100 border-red-400 text-red-800'
                            : 'bg-white border-slate-200 text-[#545249] hover:border-[#33322c]'
                        }`}>
                        {r}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={ddEditRationale}
                    onChange={e => setDdEditRationale(e.target.value)}
                    placeholder="Recommendation rationale..."
                    rows={3}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-[#33322c] focus:outline-none focus:border-[#33322c] mb-3 resize-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={saveDdEdit} disabled={ddSaving}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-[#33322c] text-white text-sm font-medium rounded hover:bg-[#151411] disabled:opacity-50 transition-colors">
                      <Check className="w-3.5 h-3.5" />{ddSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={cancelDdEdit} className="flex items-center gap-1.5 px-4 py-1.5 border border-slate-200 text-[#545249] text-sm font-medium rounded hover:bg-white transition-colors">
                      <X className="w-3.5 h-3.5" /> Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Recommendation Rationale */}
              {!ddEditing && ddOverview.recommendation_rationale && (
                <div className="bg-[#ede8d7] rounded p-4 mb-5 border-l-4 border-[#33322c]">
                  <p className="text-xs font-semibold text-[#545249] uppercase mb-2">Recommendation Rationale</p>
                  <p className="text-sm text-[#33322c] leading-relaxed italic">{ddOverview.recommendation_rationale}</p>
                </div>
              )}

              {/* Summary */}
              {!ddEditing && ddOverview.summary && (
                <div className="bg-white rounded p-4 mb-5 border border-slate-200">
                  <p className="text-xs font-semibold text-[#545249] uppercase mb-2">Summary</p>
                  <p className="text-sm text-[#33322c] leading-relaxed">{ddOverview.summary}</p>
                </div>
              )}

              {/* Scorecard mini-grid */}
              {ddOverview.scorecard && Object.keys(ddOverview.scorecard).length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
                  {Object.entries(ddOverview.scorecard).slice(0, 6).map(([k, v]) => {
                    const val = typeof v === 'number' ? v : 0;
                    const color = val >= 75 ? '#10b981' : val >= 50 ? '#F59E0B' : '#ef4444';
                    return (
                      <div key={k} className="bg-white border border-slate-200 rounded p-3">
                        <p className="text-xs font-semibold text-[#545249] uppercase mb-1">{k.replace(/_/g, ' ')}</p>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xl font-bold text-[#33322c]">{val}</span>
                          <div className="flex-1 h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${val}%`, backgroundColor: color }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
                {ddOverview.investment_thesis && (
                  <div className="bg-white border border-slate-200 rounded p-4">
                    <p className="text-xs font-semibold text-[#545249] uppercase mb-2">Investment Thesis</p>
                    <p className="text-sm text-[#33322c] leading-relaxed">{ddOverview.investment_thesis}</p>
                  </div>
                )}
                {topFlags.length > 0 && (
                  <div className="bg-red-50 rounded-lg p-4 border border-red-100">
                    <div className="flex items-center gap-1.5 mb-2">
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                      <p className="text-xs font-semibold text-red-600 uppercase">High-Severity Flags</p>
                    </div>
                    <ul className="space-y-1.5">
                      {topFlags.map((f, i) => (
                        <li key={i} className="text-sm text-red-700 flex gap-2">
                          <span className="text-red-400 shrink-0">•</span>
                          <span>{f.our_finding ?? f.flag ?? f.topic}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Cross-Agent Signals */}
              {(ddOverview.cross_agent_signals ?? []).length > 0 && (
                <div className="mb-5">
                  <p className="text-xs font-semibold text-[#545249] uppercase mb-2">Cross-Agent Signals</p>
                  <div className="space-y-3">
                    {(ddOverview.cross_agent_signals ?? []).map((s, i) => (
                      <div key={i} className={`rounded-lg p-4 border ${s.severity === 'red' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
                        <div className="flex items-start gap-2 mb-1">
                          <span className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${s.severity === 'red' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{s.severity}</span>
                          <p className={`text-sm font-semibold ${s.severity === 'red' ? 'text-red-800' : 'text-yellow-800'}`}>{s.headline}</p>
                        </div>
                        <p className="text-sm text-[#33322c] leading-relaxed">{s.narrative}</p>
                        {s.agents_involved && s.agents_involved.length > 0 && (
                          <p className="text-xs text-[#787569] mt-1">Agents: {s.agents_involved.join(', ')}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section Summaries */}
              {ddOverview.section_summaries && Object.keys(ddOverview.section_summaries).length > 0 && (
                <div className="mb-5">
                  <p className="text-xs font-semibold text-[#545249] uppercase mb-2">Agent Findings</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Object.entries(ddOverview.section_summaries).map(([agent, text]) => (
                      <div key={agent} className="bg-white rounded p-3 border border-slate-200">
                        <p className="text-xs font-semibold text-[#33322c] uppercase mb-1 capitalize">{agent}</p>
                        <p className="text-xs text-[#33322c] leading-relaxed">{text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* IC Questions */}
              {(ddOverview.ic_questions ?? []).length > 0 && (
                <div className="mb-5">
                  <p className="text-xs font-semibold text-[#545249] uppercase mb-2">IC Questions</p>
                  <div className="space-y-2">
                    {(ddOverview.ic_questions ?? []).map((q, i) => (
                      <div key={i} className="bg-white rounded p-3 border border-slate-200">
                        <div className="flex items-start gap-2 mb-1">
                          <span className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                            q.priority === 'high' ? 'bg-red-100 text-red-700' :
                            q.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-[#ede8d7] text-[#545249]'
                          }`}>{q.priority ?? 'low'}</span>
                          <p className="text-sm font-medium text-[#33322c]">{q.question}</p>
                        </div>
                        {q.context && <p className="text-xs text-[#545249] ml-9">{q.context}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {ddAgents.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-5">
                  {ddAgents.map(a => (
                    <div key={a.agent} className={`px-3 py-1.5 rounded border text-xs font-medium flex items-center gap-1.5 ${
                      a.status === 'complete' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-[#ede8d7] border-slate-200 text-[#545249]'
                    }`}>
                      <span className="capitalize">{a.agent}</span>
                      {a.findings_count != null && a.findings_count > 0 && (
                        <span className="bg-white/60 rounded px-1">{a.findings_count} findings</span>
                      )}
                      {(a.flags_count ?? 0) > 0 && (
                        <span className="bg-red-100 text-red-600 rounded px-1">{a.flags_count} flags</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-200">
                {outputs?.ic_memo && (
                  <a
                    href={`/admin/dd/${id}/download/${encodeURIComponent(companyName + '_IC_Memo.pdf')}`}
                    className="flex items-center gap-2 px-4 py-2 bg-[#33322c] text-white text-sm font-medium rounded hover:bg-[#33322c]/90 transition-colors"
                    download
                  >
                    <Download className="w-4 h-4" /> IC Memo
                  </a>
                )}
                {outputs?.appendix && (
                  <a
                    href={`/admin/dd/${id}/download/${encodeURIComponent(companyName + '_Appendix.pdf')}`}
                    className="flex items-center gap-2 px-4 py-2 border border-[#33322c] text-[#33322c] text-sm font-medium rounded hover:bg-[#ede8d7] transition-colors"
                    download
                  >
                    <Download className="w-4 h-4" /> Appendix
                  </a>
                )}
                {outputs?.scorecard && (
                  <a
                    href={`/admin/dd/${id}/download/${encodeURIComponent(companyName + '_Scorecard.xlsx')}`}
                    className="flex items-center gap-2 px-4 py-2 border border-[#33322c] text-[#33322c] text-sm font-medium rounded hover:bg-[#ede8d7] transition-colors"
                    download
                  >
                    <Download className="w-4 h-4" /> Scorecard
                  </a>
                )}
              </div>
            </div>
          );
        })()}

        {/* Intel Suggestions */}
        {suggestions.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded p-5 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-amber-900">
                {suggestions.length} Pending Suggestion{suggestions.length !== 1 ? 's' : ''} from Intel
              </h3>
            </div>
            <div className="space-y-3">
              {suggestions.map(s => {
                const conf = Math.round(s.confidence * 100);
                const confColor = conf >= 90 ? 'bg-emerald-100 text-emerald-700' : conf >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-[#f1f5f9]/30 text-[#33322c]';
                const isWorking = suggestionWorking === s.id;
                const isEditing = editingSuggestion === s.id;

                const fmtAmt = (n?: number | null) => {
                  if (!n) return 'Undisclosed';
                  if (n >= 1e9) return '$' + parseFloat((n/1e9).toFixed(2)) + 'B';
                  if (n >= 1e6) return '$' + parseFloat((n/1e6).toFixed(2)) + 'M';
                  return '$' + n.toLocaleString();
                };

                let label = '';
                let detail = '';
                if (s.suggestion_type === 'new_funding_round' && s.suggested_data) {
                  const d = s.suggested_data;
                  label = `New round: ${d.round_type} ${fmtAmt(d.amount_usd)}`;
                  detail = [d.announced_date, (d.investors||[]).slice(0,3).join(', ')].filter(Boolean).join(' · ');
                } else if (s.suggestion_type === 'field_update') {
                  const fromVal = s.current_value ?? '—';
                  label = `Update ${s.field_name}: "${fromVal}" → "${s.suggested_value}"`;
                } else if (s.suggestion_type === 'new_investor') {
                  const investorName = s.suggested_data?.investor_name ?? s.suggested_value ?? 'Unknown';
                  label = `Add investor: ${investorName}`;
                } else if (s.suggestion_type === 'new_case_study' && s.suggested_data) {
                  const d = s.suggested_data;
                  label = `New case study: ${d.title || 'Deployment evidence'}`;
                  detail = d.customer_name ? `Customer: ${d.customer_name}` : '';
                } else if (s.suggestion_type === 'new_commercial_deployment' && s.suggested_data) {
                  const d = s.suggested_data;
                  label = `New deployment: ${d.customer_name || 'Undisclosed'} — ${d.deployment_type || 'Commercial'}`;
                  detail = [
                    d.contract_value_usd ? fmtAmt(d.contract_value_usd) : null,
                    d.start_date || null,
                  ].filter(Boolean).join(' · ');
                } else if (s.suggestion_type === 'case_study' && s.suggested_data) {
                  const d = s.suggested_data;
                  label = d.title || 'Case study evidence';
                  detail = d.snippet ? d.snippet.replace(/<[^>]+>/g, '').slice(0, 120) + (d.snippet.length > 120 ? '…' : '') : '';
                }

                // Collect all source URLs: sources[], source_url, url (case_study), intel_url
                const rawSources: string[] = [
                  ...(s.suggested_data?.sources || []),
                  ...(s.suggested_data?.source_url && !s.suggested_data?.sources?.includes(s.suggested_data.source_url)
                    ? [s.suggested_data.source_url] : []),
                  ...(s.suggested_data?.url && !s.suggested_data?.sources?.includes(s.suggested_data.url)
                    ? [s.suggested_data.url] : []),
                  ...(s.intel_url ? [s.intel_url] : []),
                ].filter((u, i, arr) => u && arr.indexOf(u) === i);

                const hostname = (url: string) => {
                  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
                };

                const sourceLinks = rawSources.length > 0 ? (
                  <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {rawSources.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="text-blue-500 hover:underline">
                        {hostname(url)}{rawSources.length > 1 ? ` [${i+1}]` : ''}
                      </a>
                    ))}
                  </span>
                ) : s.intel_label ? (
                  <span>{s.intel_label}</span>
                ) : null;

                return (
                  <div key={s.id} className="bg-white border border-amber-200 rounded p-3">
                    {isEditing && s.suggestion_type === 'new_funding_round' ? (
                      /* ── Inline edit form ── */
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="text-xs font-semibold text-amber-700">Editing suggestion</span>
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${confColor}`}>{conf}% confidence</span>
                          {sourceLinks && rawSources.length > 0 && (
                            <span className="text-xs text-blue-500 cursor-pointer hover:underline" onClick={() => setExpandedSources(prev => { const next = new Set(prev); next.has(s.id) ? next.delete(s.id) : next.add(s.id); return next; })}>
                              {expandedSources.has(s.id) ? '▲ hide sources' : `▼ sources (${rawSources.length})`}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold text-[#545249] uppercase tracking-wide">Round Type</label>
                            <input
                              className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-400"
                              value={editFields.round_type}
                              onChange={e => setEditFields(f => ({ ...f, round_type: e.target.value }))}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-[#545249] uppercase tracking-wide">Amount (USD)</label>
                            <input
                              type="number"
                              className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-400"
                              value={editFields.amount_usd}
                              onChange={e => setEditFields(f => ({ ...f, amount_usd: e.target.value }))}
                              placeholder="e.g. 2750000"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-[#545249] uppercase tracking-wide">Date (YYYY-MM-DD)</label>
                            <input
                              className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-400"
                              value={editFields.announced_date}
                              onChange={e => setEditFields(f => ({ ...f, announced_date: e.target.value }))}
                              placeholder="e.g. 2024-03-15"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-[#545249] uppercase tracking-wide">Investors (comma-separated)</label>
                            <input
                              className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-400"
                              value={editFields.investors}
                              onChange={e => setEditFields(f => ({ ...f, investors: e.target.value }))}
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="text-[10px] font-semibold text-[#545249] uppercase tracking-wide">Source URL</label>
                            <input
                              type="url"
                              className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-400"
                              value={editFields.source_url}
                              onChange={e => setEditFields(f => ({ ...f, source_url: e.target.value }))}
                              placeholder="Paste article or press release URL…"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            disabled={isWorking}
                            onClick={async () => {
                              setSuggestionWorking(s.id);
                              const patch: Record<string, any> = {};
                              if (editFields.round_type.trim()) patch.round_type = editFields.round_type.trim();
                              if (editFields.amount_usd) patch.amount_usd = parseInt(editFields.amount_usd, 10);
                              if (editFields.announced_date.trim()) patch.announced_date = editFields.announced_date.trim();
                              if (editFields.investors.trim()) patch.investors = editFields.investors.split(',').map(x => x.trim()).filter(Boolean);
                              if (editFields.source_url.trim()) patch.source_url = editFields.source_url.trim();
                              const patchRes = await fetch(`/companies/${id}/suggestions/${s.id}`, {
                                method: 'PATCH',
                                headers: { ...AUTH, 'Content-Type': 'application/json' },
                                body: JSON.stringify(patch),
                              });
                              if (!patchRes.ok) {
                                const err = await patchRes.json().catch(() => ({}));
                                setEnrichResult(`Save failed: ${err.detail || patchRes.status}`);
                                setSuggestionWorking(null);
                                return;
                              }
                              await refreshProfile();
                              setSuggestions(prev => prev.map(x => x.id === s.id ? { ...x, ...patch } : x));
                              setEditingSuggestion(null);
                              setSuggestionWorking(null);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold rounded transition-colors disabled:opacity-50"
                          >
                            <Check className="w-3 h-3" />{isWorking ? '…' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingSuggestion(null)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[#f1f5f9]/30 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded transition-colors"
                          >
                            <X className="w-3 h-3" />Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ── Normal display ── */
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="text-sm font-medium text-[#33322c]">{label}</span>
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${confColor}`}>{conf}% confidence</span>
                          </div>
                          {detail && <p className="text-xs text-[#545249] mb-1">{detail}</p>}
                          {s.reasoning && <p className="text-xs text-[#787569] italic">{s.reasoning}</p>}
                          {sourceLinks && (
                            <div className="mt-1">
                              <button
                                onClick={() => setExpandedSources(prev => {
                                  const next = new Set(prev);
                                  next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                                  return next;
                                })}
                                className="text-[10px] text-blue-500 hover:underline"
                              >
                                {expandedSources.has(s.id) ? '▲ hide sources' : `▼ sources (${rawSources.length})`}
                              </button>
                              {expandedSources.has(s.id) && (
                                <p className="text-xs text-[#545249] mt-1">Sources: {sourceLinks}</p>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          {s.suggestion_type === 'new_funding_round' && (
                            <button
                              onClick={() => {
                                const d = s.suggested_data || {};
                                setEditFields({
                                  round_type: d.round_type ?? '',
                                  amount_usd: d.amount_usd ? String(d.amount_usd) : '',
                                  announced_date: d.announced_date ?? '',
                                  investors: (d.investors ?? []).join(', '),
                                  source_url: d.source_url ?? '',
                                });
                                setEditingSuggestion(s.id);
                              }}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-[#ede8d7] hover:bg-[#f1f5f9]/30 text-[#33322c] text-xs font-semibold rounded border border-slate-200 transition-colors"
                              title="Edit before accepting"
                            >
                              <Pencil className="w-3 h-3" />Edit
                            </button>
                          )}
                          <button
                            disabled={isWorking}
                            onClick={async () => {
                              setSuggestionWorking(s.id);
                              const res = await fetch(`/companies/${id}/suggestions/${s.id}/accept`, {
                                method: 'POST', headers: { 'Authorization': AUTH.Authorization },
                              });
                              if (res.ok) {
                                const result = await res.json();
                                setSuggestions(prev => prev.filter(x => x.id !== s.id));
                                await refreshProfile();
                                if (result.action_note?.startsWith('source_attached:')) {
                                  const rtype = result.action_note.split(':')[1];
                                  setEnrichResult(`Source URL attached to existing ${rtype} round`);
                                }
                              }
                              setSuggestionWorking(null);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded transition-colors disabled:opacity-50"
                          >
                            <Check className="w-3 h-3" />{isWorking ? '…' : 'Accept'}
                          </button>
                          <button
                            disabled={isWorking}
                            onClick={async () => {
                              setSuggestionWorking(s.id);
                              const rejectRes = await fetch(`/companies/${id}/suggestions/${s.id}/reject`, {
                                method: 'POST', headers: { 'Authorization': AUTH.Authorization },
                              });
                              if (!rejectRes.ok) {
                                setEnrichResult(`Reject failed (${rejectRes.status})`);
                                setSuggestionWorking(null);
                                return;
                              }
                              setSuggestions(prev => prev.filter(x => x.id !== s.id));
                              await refreshProfile();
                              setSuggestionWorking(null);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[#f1f5f9]/30 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded transition-colors disabled:opacity-50"
                          >
                            <X className="w-3 h-3" />Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Investors & Tags */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded border border-slate-200 p-6">
            <h3 className={`${cls.sectionTitle} mb-4`}>Investors</h3>
            {editMode ? (
              <div>
                <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Investors (comma-separated)</label>
                <input
                  value={draft.investors?.join(', ') ?? ''}
                  onChange={e => setDraft(d => ({ ...d, investors: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                  placeholder="Andreessen Horowitz, Sequoia, ..."
                  className={INPUT_CLS}
                />
              </div>
            ) : (
              <>
                {(company.lead_investors ?? []).length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-[#545249] uppercase tracking-wide mb-2">Lead Investors</p>
                    <div className="flex flex-wrap gap-2">
                      {company.lead_investors!.map((inv, i) => (
                        <span key={i} className="px-3 py-1 bg-[#33322c] text-white text-sm font-medium rounded">{inv}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(company.investors ?? []).length > 0 && (
                  <div>
                    {(company.lead_investors ?? []).length > 0 && (
                      <p className="text-xs font-semibold text-[#545249] uppercase tracking-wide mb-2">All Investors</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {company.investors!.map((investor, i) => (
                        <span key={i} className="px-3 py-1 border border-[#33322c] text-[#33322c] text-sm font-medium rounded">{investor}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(company.lead_investors ?? []).length === 0 && (company.investors ?? []).length === 0 && (
                  <p className="text-sm text-[#787569]">No investor data</p>
                )}
              </>
            )}
          </div>

          <div className="bg-white rounded border border-slate-200 p-6">
            <h3 className={`${cls.sectionTitle} mb-4`}>Tags &amp; Verticals</h3>
            {editMode ? (
              <div>
                <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Tags (comma-separated)</label>
                <input
                  value={draft.tags?.join(', ') ?? ''}
                  onChange={e => setDraft(d => ({ ...d, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                  placeholder="computer-vision, autonomous, ..."
                  className={INPUT_CLS}
                />
              </div>
            ) : (
              <>
                {(company.verticals ?? []).length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-[#545249] uppercase tracking-wide mb-2">Verticals</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {company.verticals!.map((v, i) => (
                        <span key={i} className="px-3 py-1 bg-[#33322c]/10 text-[#33322c] text-xs font-medium rounded border border-[#33322c]/20">{v}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(company.tags ?? []).length > 0 && (
                  <>
                    {(company.verticals ?? []).length > 0 && <p className="text-xs font-semibold text-[#545249] uppercase tracking-wide mb-2">Tags</p>}
                    <div className="flex flex-wrap gap-2">
                      {company.tags!.map((tag, i) => (
                        <span key={i} className="px-3 py-1 border border-[#33322c] text-[#33322c] text-sm font-medium rounded">{tag}</span>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>


        {/* Description */}
        <div className="bg-white rounded border border-slate-200 p-6 mb-6">
          <h3 className={`${cls.sectionTitle} mb-4`}>Company Description</h3>
          {editMode ? (
            <textarea
              value={draft.description ?? ''}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              rows={5}
              placeholder="Company description..."
              className={INPUT_CLS + " resize-none"}
            />
          ) : (
            <p className="text-[#545249] leading-relaxed">{company.description ?? "No description available."}</p>
          )}
        </div>

        {/* Background */}
        {(company.background || editMode) && (
          <div className="bg-white rounded border border-slate-200 p-6 mb-6">
            <h3 className={`${cls.sectionTitle} mb-4`}>Background</h3>
            {editMode ? (
              <textarea
                value={draft.background ?? ''}
                onChange={e => setDraft(d => ({ ...d, background: e.target.value }))}
                rows={5}
                placeholder="Company background..."
                className={INPUT_CLS + " resize-none"}
              />
            ) : (
              <p className="text-[#545249] leading-relaxed whitespace-pre-line">{company.background}</p>
            )}
          </div>
        )}

        {/* Competitive Advantage */}
        {(company.competitive_advantage || editMode) && (
          <div className="bg-white rounded border border-slate-200 p-6 mb-6">
            <h3 className={`${cls.sectionTitle} mb-4`}>Competitive Advantage</h3>
            {editMode ? (
              <textarea
                value={draft.competitive_advantage ?? ''}
                onChange={e => setDraft(d => ({ ...d, competitive_advantage: e.target.value }))}
                rows={5}
                placeholder="What sets this company apart..."
                className={INPUT_CLS + " resize-none"}
              />
            ) : (
              <p className="text-[#545249] leading-relaxed whitespace-pre-line">{company.competitive_advantage}</p>
            )}
          </div>
        )}


        {/* Industrial Analysis */}
        {(company.industrial_readiness_score != null || editMode) && (
          <div className="bg-white rounded border border-amber-200 mb-6">
            <button
              onClick={() => setShowIndustrial(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-amber-50/50 transition-colors rounded"
            >
              <div className="flex items-center gap-2.5">
                <svg className={`w-4 h-4 text-amber-400 transition-transform ${showIndustrial ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                <Factory className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-semibold text-[#33322c]">Industrial Analysis</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Industrial Enrichment</span>
                {!showIndustrial && company.industrial_readiness_score != null && (
                  <span className="text-xs text-[#545249]">Readiness {company.industrial_readiness_score}/10 · Sovereignty {company.sovereignty_score ?? '—'}/10</span>
                )}
              </div>
              <span className="text-[10px] text-[#787569]">{showIndustrial ? 'collapse' : 'expand'}</span>
            </button>
            {showIndustrial && (
            <div className="px-5 pb-5 pt-1">
            {editMode ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Readiness (0–10)</label>
                    <input
                      type="number"
                      min={0} max={10} step={0.1}
                      value={draft.industrial_readiness_score != null ? String(draft.industrial_readiness_score) : ''}
                      onChange={e => setDraft(d => ({ ...d, industrial_readiness_score: e.target.value ? parseFloat(e.target.value) : undefined }))}
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Sovereignty (0–10)</label>
                    <input
                      type="number"
                      min={0} max={10} step={0.1}
                      value={draft.sovereignty_score != null ? String(draft.sovereignty_score) : ''}
                      onChange={e => setDraft(d => ({ ...d, sovereignty_score: e.target.value ? parseFloat(e.target.value) : undefined }))}
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Deploy Signal</label>
                    <select
                      value={draft.deployment_signal_level ?? ''}
                      onChange={e => setDraft(d => ({ ...d, deployment_signal_level: e.target.value || null }))}
                      className={INPUT_CLS}
                    >
                      <option value="">— Select —</option>
                      {['Lab-Stage','Pilot','Scaling','Operational'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Protocol Support (comma-separated)</label>
                  <input
                    value={draft.protocol_support?.join(', ') ?? ''}
                    onChange={e => setDraft(d => ({ ...d, protocol_support: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                    placeholder="OPC-UA, MQTT, ROS2, ..."
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Verified Certs (comma-separated)</label>
                  <input
                    value={draft.verified_certs?.join(', ') ?? ''}
                    onChange={e => setDraft(d => ({ ...d, verified_certs: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                    placeholder="ISO 9001, CE, UL, ..."
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#545249] uppercase block mb-1">Integration Notes</label>
                  <textarea
                    value={draft.integration_notes ?? ''}
                    onChange={e => setDraft(d => ({ ...d, integration_notes: e.target.value }))}
                    rows={3}
                    placeholder="Integration context and notes..."
                    className={INPUT_CLS + " resize-none"}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-white border border-slate-200 rounded p-3">
                    <p className="text-xs font-semibold text-[#545249] uppercase mb-1">Readiness</p>
                    <p className={cls.pageTitle}>{company.industrial_readiness_score}<span className="text-sm text-[#545249]">/10</span></p>
                  </div>
                  <div className="bg-white border border-slate-200 rounded p-3">
                    <p className="text-xs font-semibold text-[#545249] uppercase mb-1 flex items-center gap-1"><Shield className="w-3 h-3" />Sovereignty</p>
                    {company.sovereignty_score != null
                      ? <p className={cls.pageTitle}>{company.sovereignty_score}<span className="text-sm text-[#545249]">/10</span></p>
                      : <p className="text-sm text-[#787569] mt-1">Data Unavailable</p>}
                  </div>
                  <div className="bg-white border border-slate-200 rounded p-3">
                    <p className="text-xs font-semibold text-[#545249] uppercase mb-1">Deploy Signal</p>
                    <p className="text-sm font-semibold text-[#33322c] mt-1">{company.deployment_signal_level ?? '—'}</p>
                  </div>
                </div>
                {(company.protocol_support?.length ?? 0) > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-[#545249] uppercase mb-2">Protocols</p>
                    <div className="flex flex-wrap gap-1.5">
                      {company.protocol_support!.map(p => (
                        <span key={p} className="px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-mono rounded">{p}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(company.verified_certs?.length ?? 0) > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-[#545249] uppercase mb-2">Verified Certs</p>
                    <div className="flex flex-wrap gap-1.5">
                      {company.verified_certs!.map(c => (
                        <span key={c} className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium rounded">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
                {company.integration_notes && (
                  <div className="bg-amber-50 rounded-lg p-4 text-sm text-[#33322c] border border-amber-100">
                    {company.integration_notes}
                  </div>
                )}
              </>
            )}
            </div>
            )}
          </div>
        )}

        {/* Robotics Profile */}
        {company.robotics && (
          <div className="bg-white rounded border border-slate-200 p-6 mb-6">
            <h3 className={`${cls.sectionTitle} mb-4`}>Robotics Profile</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: 'Form Factor',       value: company.robotics.form_factor },
                { label: 'Application',       value: company.robotics.application },
                { label: 'Deployment Stage',  value: company.robotics.deployment_stage },
                { label: 'Payload (kg)',      value: company.robotics.payload_kg != null ? String(company.robotics.payload_kg) : null },
                { label: 'Task Success Rate', value: company.robotics.task_success_rate != null ? `${company.robotics.task_success_rate}%` : null },
                { label: 'Uptime',            value: company.robotics.uptime_pct != null ? `${company.robotics.uptime_pct}%` : null },
              ].filter(f => f.value).map(({ label, value }) => (
                <div key={label} className="bg-white border border-slate-200 rounded p-3">
                  <p className="text-xs font-semibold text-[#545249] uppercase mb-1">{label}</p>
                  <p className="text-sm font-semibold text-[#33322c]">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Complete Review — only shown in edit/review mode */}
        {editMode && (
          <div className="bg-[#33322c] rounded border border-[#33322c] p-5 mt-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Complete Review</p>
              <p className="text-xs text-white/60 mt-0.5">Saves all changes and adds a Reviewed tag to this startup's profile.</p>
            </div>
            <button
              onClick={completeReview}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-white text-[#33322c] rounded text-sm font-semibold hover:bg-[#f0f4f6] disabled:opacity-50 transition-colors shrink-0 ml-6"
            >
              <ClipboardCheck className="w-4 h-4" />
              {saving ? 'Saving…' : 'Complete Review'}
            </button>
          </div>
        )}

        {/* CVC Position — one card per investment vehicle */}
        {(company.term_sheets ?? (company.term_sheet ? [company.term_sheet] : [])).length > 0 && (
          <div className="mt-6">
            <h3 className={`${cls.sectionTitle} mb-3`}>SLAM Position</h3>
            <div className="space-y-3">
              {(company.term_sheets ?? (company.term_sheet ? [company.term_sheet] : [])).map((ts, idx) => ts && (
                <div key={ts.fund ?? idx} className="bg-white rounded border border-slate-200 p-5">
                  {ts.fund && (
                    <span className="text-[11px] font-bold text-[#7a6f00] bg-cvc-gold/20 px-2 py-0.5 rounded uppercase tracking-widest border border-cvc-gold/30 inline-block mb-3">{ts.fund}</span>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    {[
                      { label: 'Invested', value: ts.check_size_usd ? `$${ts.check_size_usd.toLocaleString()}` : null },
                      { label: 'Current FMV', value: ts.fmv_usd ? `$${Math.round(ts.fmv_usd).toLocaleString()}` : null },
                      { label: 'MOIC', value: ts.moic != null ? `${ts.moic.toFixed(2)}x` : null },
                      { label: 'Close Date', value: ts.close_date ?? null },
                    ].map(({ label, value }) => value ? (
                      <div key={label} className="bg-[#F8FAFC] rounded p-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-1">{label}</p>
                        <p className={`text-base font-bold text-[#33322c] ${label === 'MOIC' && ts.moic != null && ts.moic >= 2 ? 'text-emerald-600' : label === 'MOIC' && ts.moic != null && ts.moic < 1 ? 'text-red-600' : ''}`}>{value}</p>
                      </div>
                    ) : null)}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-2 text-sm">
                    {ts.round_type && (
                      <div className="flex justify-between border-b border-slate-100 py-1.5">
                        <span className="text-[#787569]">Stage at Investment</span>
                        <span className="font-medium text-[#33322c]">{ts.round_type}</span>
                      </div>
                    )}
                    {ts.round_size_usd != null && (
                      <div className="flex justify-between border-b border-slate-100 py-1.5">
                        <span className="text-[#787569]">Round Size</span>
                        <span className="font-medium text-[#33322c]">${ts.round_size_usd.toLocaleString()}</span>
                      </div>
                    )}
                    {ts.pre_money_valuation_usd != null && (
                      <div className="flex justify-between border-b border-slate-100 py-1.5">
                        <span className="text-[#787569]">Pre-Money Val.</span>
                        <span className="font-medium text-[#33322c]">${ts.pre_money_valuation_usd.toLocaleString()}</span>
                      </div>
                    )}
                    {ts.category_2 && (
                      <div className="flex justify-between border-b border-slate-100 py-1.5">
                        <span className="text-[#787569]">Category</span>
                        <span className="font-medium text-[#33322c]">{ts.category_2}</span>
                      </div>
                    )}
                    {ts.lead_investor && (
                      <div className="flex justify-between border-b border-slate-100 py-1.5">
                        <span className="text-[#787569]">Lead Investor</span>
                        <span className="font-medium text-[#33322c]">{ts.lead_investor}</span>
                      </div>
                    )}
                    {ts.shares_purchased != null && (
                      <div className="flex justify-between border-b border-slate-100 py-1.5">
                        <span className="text-[#787569]">Shares</span>
                        <span className="font-medium text-[#33322c]">{ts.shares_purchased.toLocaleString()}</span>
                      </div>
                    )}
                    {ts.pps_usd != null && (
                      <div className="flex justify-between border-b border-slate-100 py-1.5">
                        <span className="text-[#787569]">PPS at Investment</span>
                        <span className="font-medium text-[#33322c]">${ts.pps_usd.toFixed(4)}</span>
                      </div>
                    )}
                    {ts.revenue_at_investment_usd != null && (
                      <div className="flex justify-between border-b border-slate-100 py-1.5">
                        <span className="text-[#787569]">Revenue @ Investment</span>
                        <span className="font-medium text-[#33322c]">${ts.revenue_at_investment_usd.toLocaleString()}</span>
                      </div>
                    )}
                    {ts.investment_type && (
                      <div className="flex justify-between border-b border-slate-100 py-1.5">
                        <span className="text-[#787569]">Instrument</span>
                        <span className="font-medium text-[#33322c]">{ts.investment_type}</span>
                      </div>
                    )}
                    {ts.pro_rata_rights != null && (
                      <div className="flex justify-between border-b border-slate-100 py-1.5">
                        <span className="text-[#787569]">Pro-Rata</span>
                        <span className={`font-medium ${ts.pro_rata_rights ? 'text-emerald-600' : 'text-[#787569]'}`}>{ts.pro_rata_rights ? 'Yes' : 'No'}</span>
                      </div>
                    )}
                    {ts.board_seat != null && (
                      <div className="flex justify-between border-b border-slate-100 py-1.5">
                        <span className="text-[#787569]">Board Seat</span>
                        <span className={`font-medium ${ts.board_seat ? 'text-emerald-600' : 'text-[#787569]'}`}>{ts.board_seat ? 'Yes' : 'No'}</span>
                      </div>
                    )}
                    {(ts.co_investors ?? []).length > 0 && (
                      <div className="col-span-2 md:col-span-3 flex justify-between border-b border-slate-100 py-1.5">
                        <span className="text-[#787569]">Co-Investors</span>
                        <span className="font-medium text-[#33322c] text-right">{(ts.co_investors ?? []).join(', ')}</span>
                      </div>
                    )}
                    {ts.notes && (
                      <div className="col-span-2 md:col-span-3 pt-1.5">
                        <span className="text-[#787569] text-xs">Notes: </span>
                        <span className="text-[#545249] text-xs">{ts.notes}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Partner Introductions */}
        {partnerIntros.length > 0 && (
          <div className="bg-white rounded border border-slate-200 p-6 mt-6">
            <button
              className="flex items-center gap-2 w-full text-left"
              onClick={() => setIntrosCollapsed(c => !c)}
            >
              <Building className="w-5 h-5 text-[#545249]" />
              <h3 className={cls.sectionTitle}>Partner Introductions</h3>
              <span className="text-xs text-[#787569]">— {partnerIntros.length} intro{partnerIntros.length !== 1 ? 's' : ''} on record</span>
              <span className="ml-auto text-[#787569] text-xs">{introsCollapsed ? '▸ expand' : '▾ collapse'}</span>
            </button>
            {!introsCollapsed && (
              <div className="mt-4 overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-wide text-[#787569]">Partner</th>
                      <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-wide text-[#787569]">Intro Date</th>
                      <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-wide text-[#787569]">Delivered</th>
                      <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-wide text-[#787569]">Type</th>
                      <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-wide text-[#787569]">Receiver</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partnerIntros.map(intro => (
                      <tr key={intro.id} className="border-b border-[#f3f4f6] hover:bg-[#fafafa]">
                        <td className="py-2 px-3 font-medium text-[#33322c] text-xs">{intro.matched_partner_name ?? intro.partner_name}</td>
                        <td className="py-2 px-3 text-[#545249] text-xs whitespace-nowrap">{intro.intro_date ?? '—'}</td>
                        <td className="py-2 px-3 text-[#545249] text-xs whitespace-nowrap">{intro.delivered_date ?? '—'}</td>
                        <td className="py-2 px-3 text-xs">
                          {intro.intro_type && <span className="px-1.5 py-0.5 bg-[#f3f4f6] rounded text-[#545249]">{intro.intro_type}</span>}
                        </td>
                        <td className="py-2 px-3 text-[#787569] text-xs">{intro.receiver || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Activity Log */}
        <div className="bg-white rounded border border-slate-200 p-6 mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-[#545249]" />
            <h3 className={cls.sectionTitle}>Activity Log</h3>
            <span className="text-xs text-[#787569]">— analyst edits and score changes</span>
          </div>
          {activityLog.length === 0 ? (
            <p className="text-sm text-[#787569]">No edits recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-wide text-[#787569]">When</th>
                    <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-wide text-[#787569]">Analyst</th>
                    <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-wide text-[#787569]">Field</th>
                    <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-wide text-[#787569]">Old</th>
                    <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-wide text-[#787569]">New</th>
                  </tr>
                </thead>
                <tbody>
                  {activityLog.map(entry => (
                    <tr key={entry.id} className="border-b border-[#f3f4f6] hover:bg-[#fafafa]">
                      <td className="py-2 px-3 text-[#787569] text-xs whitespace-nowrap">
                        {new Date(entry.changed_at).toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-xs font-semibold text-[#10b981]">
                        {entry.changed_by}
                        {entry.change_source === 'eintel' && (
                          <span className="ml-1.5 text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1 py-0.5 rounded uppercase tracking-wider">eintel</span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono text-xs text-[#33322c]">{entry.field_name}</td>
                      <td className="py-2 px-3 text-[#787569] text-xs max-w-[200px] truncate">{entry.old_value ?? '—'}</td>
                      <td className="py-2 px-3 text-[#33322c] text-xs max-w-[200px] truncate font-medium">{entry.new_value ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Intel Section */}
        {intelItems.length > 0 && (
          <div className="bg-white rounded border border-slate-200 p-6 mt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-[#6366f1]" />
                <h3 className={cls.sectionTitle}>Intel</h3>
                <span className="text-xs text-[#787569]">— analyst-uploaded sources</span>
              </div>
              <div className="flex items-center gap-2">
                {processResult && <span className="text-xs text-[#10b981]">{processResult}</span>}
                <button
                  onClick={processIntel}
                  disabled={processingIntel}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6366f1] text-white text-xs font-semibold rounded-lg hover:bg-[#4f46e5] disabled:opacity-50 transition-colors"
                >
                  <Zap className="w-3.5 h-3.5" />
                  {processingIntel ? 'Processing…' : 'Process Intel'}
                </button>
              </div>
            </div>
            <div className="space-y-3">
              {intelItems.map(item => (
                <div key={item.id} className="flex items-start gap-3 p-3 bg-[#ede8d7] rounded-lg border border-slate-200">
                  <div className="flex-shrink-0 mt-0.5">
                    {item.intel_type === 'pdf' && <FileText className="w-4 h-4 text-[#545249]" />}
                    {item.intel_type === 'url' && <Link className="w-4 h-4 text-[#545249]" />}
                    {item.intel_type === 'text' && <Type className="w-4 h-4 text-[#545249]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-medium text-[#33322c]">
                        {item.label || item.file_name || item.source_url || 'Pasted text'}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 bg-[#f1f5f9] text-[#545249] rounded uppercase tracking-wide">{item.intel_type}</span>
                      {item.processed && <span className="text-xs px-1.5 py-0.5 bg-green-50 text-green-700 rounded">processed</span>}
                      {(item.intent || []).map((tag: string) => {
                        const intentColors: Record<string, string> = {
                          funding: 'bg-blue-50 text-blue-700',
                          commercial_deployment: 'bg-green-50 text-green-700',
                          team: 'bg-purple-50 text-purple-700',
                          product: 'bg-amber-50 text-amber-700',
                          press: 'bg-gray-100 text-gray-600',
                        };
                        const intentLabels: Record<string, string> = {
                          funding: 'Funding',
                          commercial_deployment: 'Commercial',
                          team: 'Team',
                          product: 'Product',
                          press: 'Press',
                        };
                        return (
                          <span key={tag} className={`text-xs px-1.5 py-0.5 rounded font-medium ${intentColors[tag] || 'bg-gray-100 text-gray-600'}`}>
                            {intentLabels[tag] || tag}
                          </span>
                        );
                      })}
                    </div>
                    <p className="text-xs text-[#787569]">
                      {item.uploaded_by} · {new Date(item.uploaded_at).toLocaleDateString()}
                    </p>
                    {item.raw_text && (
                      <p className="text-xs text-[#545249] mt-1 line-clamp-2">{item.raw_text.slice(0, 200)}…</p>
                    )}
                    {item.intel_type === 'text' && !item.source_url && intelEditUrlId !== item.id && (
                      <button
                        onClick={() => { setIntelEditUrlId(item.id); setIntelEditUrlValue(''); }}
                        className="mt-1.5 text-xs text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1"
                      >
                        <Link className="w-3 h-3" /> Add source URL
                      </button>
                    )}
                    {item.intel_type === 'text' && item.source_url && (
                      <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="mt-1 text-xs text-blue-500 hover:underline break-all block truncate">
                        {item.source_url}
                      </a>
                    )}
                    {intelEditUrlId === item.id && (
                      <div className="mt-2 flex gap-2 items-center">
                        <input
                          type="url"
                          autoFocus
                          placeholder="https://..."
                          value={intelEditUrlValue}
                          onChange={e => setIntelEditUrlValue(e.target.value)}
                          className="flex-1 px-2 py-1 border border-amber-400 rounded text-xs text-[#33322c] focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                        <button
                          disabled={!intelEditUrlValue.startsWith('http')}
                          onClick={async () => {
                            const res = await fetch(`/companies/${id}/intel/${item.id}`, {
                              method: 'PATCH',
                              headers: { ...AUTH, 'Content-Type': 'application/json' },
                              body: JSON.stringify({ source_url: intelEditUrlValue }),
                            });
                            if (res.ok) {
                              setIntelItems(prev => prev.map(i => i.id === item.id ? { ...i, source_url: intelEditUrlValue } : i));
                              setIntelEditUrlId(null);
                            }
                          }}
                          className="px-2 py-1 bg-[#33322c] text-white rounded text-xs disabled:opacity-40"
                        >Save</button>
                        <button onClick={() => setIntelEditUrlId(null)} className="px-2 py-1 text-xs text-[#787569] hover:text-[#33322c]">✕</button>
                      </div>
                    )}
                    {item.signals?.sources?.length > 0 && (
                      <details className="mt-1.5">
                        <summary className="text-xs text-blue-500 cursor-pointer hover:underline">
                          {item.signals.sources.length} source{item.signals.sources.length !== 1 ? 's' : ''} consulted
                        </summary>
                        <ul className="mt-1 space-y-0.5 pl-2 border-l border-slate-200">
                          {item.signals.sources.map((s: {url: string; title: string}, i: number) => (
                            <li key={i}>
                              <a href={s.url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-500 hover:underline break-all">
                                {s.title || s.url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  <button
                    onClick={() => deleteIntel(item.id)}
                    className="flex-shrink-0 text-[#c5c0ad] hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Meeting Notes ───────────────────────────────────────────────── */}
        {meetingNotes.length > 0 && (
          <div className="max-w-[1400px] mx-auto px-8 pb-10">
            <div className={cls.card}>
              <div className="px-6 py-4 border-b border-slate-100">
                <p className={cls.sectionTitle}>Meeting Notes</p>
                <p className="text-xs text-slate-400 mt-0.5">Logged by ventures team — impressions are team-visible, personal notes private</p>
              </div>
              <div className="divide-y divide-slate-100">
                {meetingNotes.map(note => {
                  const currentUser = (() => {
                    try {
                      const t = localStorage.getItem('cvc_jwt');
                      if (!t) return '';
                      return JSON.parse(atob(t.split('.')[1])).sub ?? '';
                    } catch { return ''; }
                  })();
                  const dims = [
                    { key: 'founder',    label: 'Founder / Team' },
                    { key: 'market',     label: 'Market'         },
                    { key: 'tech',       label: 'Technology'     },
                    { key: 'business',   label: 'Business'       },
                    { key: 'deployment', label: 'Deployment'     },
                  ] as const;
                  const hasRatings = dims.some(d => note[`rating_${d.key}`] != null);
                  return (
                    <div key={note.id} className="px-6 py-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#33322c]">{note.submitted_by}</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-xs text-slate-500">{note.met_at}</span>
                          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full ml-1">
                            {note.context_type}
                          </span>
                        </div>
                      </div>

                      {/* Impression ratings */}
                      {hasRatings && (
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
                          {dims.map(d => {
                            const rating: number | null = note[`rating_${d.key}`];
                            const noteText: string = note[`note_${d.key}`] ?? '';
                            if (rating == null && !noteText) return null;
                            return (
                              <div key={d.key} className="bg-[#F8FAFC] rounded-lg p-2.5 border border-slate-100">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{d.label}</p>
                                {rating != null && (
                                  <div className="flex gap-0.5 mb-1">
                                    {[1,2,3,4,5].map(n => (
                                      <span key={n} className={`text-base ${n <= rating ? 'text-amber-400' : 'text-slate-200'}`}>★</span>
                                    ))}
                                  </div>
                                )}
                                {noteText && <p className="text-xs text-slate-600 leading-relaxed">{noteText}</p>}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Personal note — only for submitter */}
                      {note.personal_note && note.submitted_by === currentUser && (
                        <div className="flex items-start gap-2 mt-2 p-3 bg-amber-50 border border-amber-100 rounded-lg">
                          <span className="text-amber-500 text-xs mt-0.5">🔒</span>
                          <p className="text-sm text-[#33322c] leading-relaxed">{note.personal_note}</p>
                        </div>
                      )}

                      {/* Transcript */}
                      {note.transcript_text && (
                        <details className="mt-2">
                          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 transition-colors">
                            View transcript
                          </summary>
                          <pre className="mt-2 text-xs text-slate-600 bg-[#F8FAFC] border border-slate-100 rounded-lg p-3 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                            {note.transcript_text}
                          </pre>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* +Intel Modal */}
      {showIntelModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-[#8a7200]" />
                <h2 className={cls.sectionTitle}>Add Intel</h2>
              </div>
              <button onClick={() => { setShowIntelModal(false); setIntelIntent(new Set()); setIntelText(''); setIntelTextSourceUrl(''); setIntelUrl(''); setIntelLabel(''); setIntelFile(null); }} className="text-[#787569] hover:text-[#33322c]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 pt-4">
              {/* Tab switcher */}
              <div className="flex gap-1 bg-[#f3f4f6] rounded-lg p-1 mb-4">
                {(['pdf', 'url', 'text'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setIntelTab(tab)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      intelTab === tab ? 'bg-white text-[#33322c] shadow-sm' : 'text-[#545249] hover:text-[#33322c]'
                    }`}
                  >
                    {tab === 'pdf' && <Upload className="w-3.5 h-3.5" />}
                    {tab === 'url' && <Link className="w-3.5 h-3.5" />}
                    {tab === 'text' && <Type className="w-3.5 h-3.5" />}
                    {tab === 'pdf' ? 'PDF / File' : tab === 'url' ? 'URL' : 'Text'}
                  </button>
                ))}
              </div>

              {/* Label */}
              <div className="mb-3">
                <input
                  type="text"
                  placeholder="Label (optional — e.g. Series A Deck)"
                  value={intelLabel}
                  onChange={e => setIntelLabel(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-[#33322c] placeholder-[#787569] focus:outline-none focus:ring-2 focus:ring-[#33322c]"
                />
              </div>

              {/* Input by tab */}
              {intelTab === 'pdf' && (
                <div className="mb-4">
                  <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-[#33322c] hover:bg-[#ede8d7] transition-colors">
                    <Upload className="w-6 h-6 text-[#787569] mb-1" />
                    <span className="text-sm text-[#545249]">
                      {intelFile ? intelFile.name : 'Drop a PDF or click to browse'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.txt,.md"
                      className="hidden"
                      onChange={e => setIntelFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
              )}
              {intelTab === 'url' && (
                <div className="mb-4">
                  <input
                    type="url"
                    placeholder="https://..."
                    value={intelUrl}
                    onChange={e => setIntelUrl(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-[#33322c] placeholder-[#787569] focus:outline-none focus:ring-2 focus:ring-[#33322c]"
                  />
                </div>
              )}
              {intelTab === 'text' && (
                <div className="mb-4 space-y-2">
                  <textarea
                    placeholder="Paste notes, excerpts, or any raw text..."
                    value={intelText}
                    onChange={e => setIntelText(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-[#33322c] placeholder-[#787569] focus:outline-none focus:ring-2 focus:ring-[#33322c] resize-none"
                  />
                  <div>
                    <input
                      type="url"
                      placeholder="Source URL — required (paste the article or post link)"
                      value={intelTextSourceUrl}
                      onChange={e => setIntelTextSourceUrl(e.target.value)}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-[#33322c] placeholder-[#787569] focus:outline-none focus:ring-2 focus:ring-[#33322c] ${
                        intelText && !intelTextSourceUrl ? 'border-amber-400 bg-amber-50' : 'border-slate-200'
                      }`}
                    />
                    {intelText && !intelTextSourceUrl && (
                      <p className="text-xs text-amber-600 mt-1">A source URL is required — verification can't run without one.</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Intent / Direction */}
            <div className="px-6 pb-4">
              <p className="text-xs font-medium text-[#545249] mb-2 uppercase tracking-wide">What is this for? <span className="font-normal normal-case">(optional — guides extraction)</span></p>
              <div className="flex flex-wrap gap-2">
                {([
                  { key: 'funding', label: 'Funding & Commercial', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100', activeColor: 'bg-blue-600 text-white border-blue-600' },
                  { key: 'commercial_deployment', label: 'Commercial Deployment', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100', activeColor: 'bg-green-600 text-white border-green-600' },
                  { key: 'team', label: 'Founder Research', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100', activeColor: 'bg-purple-600 text-white border-purple-600' },
                  { key: 'product', label: '4D Classification', color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100', activeColor: 'bg-amber-500 text-white border-amber-500' },
                  { key: 'press', label: 'News & Case Studies', color: 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100', activeColor: 'bg-gray-600 text-white border-gray-600' },
                ] as const).map(({ key, label, color, activeColor }) => {
                  const active = intelIntent.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setIntelIntent(prev => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key); else next.add(key);
                          return next;
                        });
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${active ? activeColor : color}`}
                    >
                      {active && <span className="mr-1">✓</span>}{label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-6 pb-5">
              <button
                onClick={() => { setShowIntelModal(false); setIntelIntent(new Set()); setIntelText(''); setIntelTextSourceUrl(''); setIntelUrl(''); setIntelLabel(''); setIntelFile(null); }}
                className="px-4 py-2 border border-slate-200 text-[#545249] rounded-lg text-sm hover:bg-[#ede8d7] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitIntel}
                disabled={intelSubmitting || (intelTab === 'pdf' && !intelFile) || (intelTab === 'url' && !intelUrl) || (intelTab === 'text' && (!intelText || !intelTextSourceUrl))}
                className="px-4 py-2 bg-[#33322c] text-white rounded-lg text-sm font-medium hover:bg-[#151411] disabled:opacity-40 transition-colors"
              >
                {intelSubmitting ? 'Saving…' : 'Save Intel'}
              </button>
              <button
                onClick={async () => { await submitIntel(); setTimeout(processIntel, 500); }}
                disabled={intelSubmitting || (intelTab === 'pdf' && !intelFile) || (intelTab === 'url' && !intelUrl) || (intelTab === 'text' && (!intelText || !intelTextSourceUrl))}
                className="px-4 py-2 bg-[#6366f1] text-white rounded-lg text-sm font-medium hover:bg-[#4f46e5] disabled:opacity-40 transition-colors"
              >
                {intelSubmitting ? 'Saving…' : 'Save & Process'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
