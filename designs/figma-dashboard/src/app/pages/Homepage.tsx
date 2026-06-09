import { useEffect, useState, useCallback } from 'react';
import OnboardingWizard from '../components/OnboardingWizard';
import useEmblaCarousel from 'embla-carousel-react';
import { Link } from 'react-router';
import MyDesk from './MyDesk';
import { Bell, Activity, FileText, ChevronRight, ChevronDown, AlertCircle, CheckCircle2, Building2, GitBranch, Cpu, Rocket, Zap, Trophy, PencilLine, X, Handshake, BadgeDollarSign, ShieldCheck, AlertTriangle, ThumbsUp, MessageCircle, Send, Target, Swords, Info } from 'lucide-react';
import CVCNavbar from '../components/CVCNavbar';
import { api } from '../api/client';
import { AUTH_HEADER as AUTH } from '../api/client';
import { cls } from '../components/tokens';
import { useConfig } from '../hooks/useConfig';

// ── Types ────────────────────────────────────────────────────────────────────

interface BriefingInsight {
  id?: number;
  source_type: string;
  source_title: string;
  source_url: string;
  show_name: string;
  insight: string;
  expert: string;
  confidence: string;
  sector: string;
  created_at: string;
}

interface Briefing {
  week_start: string;
  week_end: string;
  total_items: number;
  podcast_count: number;
  news_count: number;
  article_count: number;
  top_tags: { tag: string; count: number }[];
  top_companies: { company: string; count: number }[];
  top_technologies: { technology?: string; tech?: string; count: number }[];
  briefing_text: string | null;
  created_at: string;
  insights: BriefingInsight[];
  total_insights: number;
  signals_by_sector: Record<string, BriefingInsight[]>;
}

interface ActivityItem {
  type: 'new_company' | 'pipeline_change' | 'dd_completed' | 'build_deployed' | 'profile_edit';
  label: string;
  sub?: string;
  company_id?: number;
  task_id?: number;
  ts: string;
}

interface Notification {
  type: 'approval_needed' | 'dd_review';
  label: string;
  sub?: string;
  priority?: string;
  task_id?: number;
  company_id?: number;
  ts: string;
}

interface DashboardData {
  briefings: Briefing[];
  activity: ActivityItem[];
  notifications: Notification[];
}

interface Deliverable {
  id: number;
  title: string;
  service_type: string;
  status: string;
  priority: string;
  partner_name: string | null;
  assignees: string[];
  updated_at: string | null;
}

const SERVICE_LABELS: Record<string, string> = {
  dealflow: 'Dealflow Session', intro: 'Ad Hoc Intro', trend_report: 'Trend Report',
  innovation_day: 'Innovation Day', collection: 'Collection', assignment: 'Assignment', other: 'Other',
};
const SERVICE_COLORS: Record<string, string> = {
  dealflow: '#F0E545', intro: '#10b981', trend_report: '#6366F1',
  innovation_day: '#EC4899', collection: '#06B6D4', assignment: '#F59E0B', other: '#94a3b8',
};

interface TeamMessage {
  id: number;
  title: string;
  body: string;
  posted_by: string;
  pinned: boolean;
  created_at: string;
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1)   return 'just now';
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return fmtDate(iso);
}

const ACTIVITY_ICON: Record<string, React.ReactNode> = {
  new_company:     <Building2 className="w-4 h-4" />,
  pipeline_change: <GitBranch className="w-4 h-4" />,
  dd_completed:    <CheckCircle2 className="w-4 h-4" />,
  build_deployed:  <Rocket className="w-4 h-4" />,
  profile_edit:    <PencilLine className="w-4 h-4" />,
  intel_approved:  <ShieldCheck className="w-4 h-4" />,
  partner_intro:   <Handshake className="w-4 h-4" />,
  new_investment:  <BadgeDollarSign className="w-4 h-4" />,
};

const ACTIVITY_COLOR: Record<string, string> = {
  new_company:     'bg-blue-500/15 text-blue-600',
  pipeline_change: 'bg-cvc-gold/15 text-[#33322c]',
  dd_completed:    'bg-emerald-500/15 text-emerald-600',
  build_deployed:  'bg-purple-500/15 text-purple-600',
  profile_edit:    'bg-orange-500/15 text-orange-600',
  intel_approved:  'bg-indigo-500/15 text-indigo-600',
  partner_intro:   'bg-teal-500/15 text-teal-600',
  new_investment:  'bg-emerald-600/15 text-emerald-700',
};

// ── Briefing parser ───────────────────────────────────────────────────────────

function parseBriefingText(text: string) {
  const lines = text.split('\n').filter(Boolean);
  const sections: { heading: string; bullets: string[] }[] = [];
  let current: { heading: string; bullets: string[] } | null = null;

  for (const line of lines) {
    // Bullet lines first — • is U+2022 (charCode 8226 > 0xFF) so it must be
    // excluded before the emoji-header check, otherwise "• **Company**" lines
    // get misread as section headers and become spurious tabs.
    const isBullet = line.startsWith('•') || line.startsWith('-');
    // Section headers: emoji-prefixed bold heading, not a bullet, not the title line
    const isEmojiHeader = !isBullet && line.charCodeAt(0) > 0xFF && line.includes('**') && !line.includes('Weekly Intel');
    if (isEmojiHeader) {
      if (current) sections.push(current);
      current = { heading: line.replace(/\*\*/g, '').trim(), bullets: [] };
    } else if (isBullet) {
      current?.bullets.push(line.replace(/^[•\-]\s*/, '').replace(/\*\*/g, ''));
    } else if (current) {
      current.bullets.push(line.replace(/\*\*/g, '').replace(/^_|_$/g, ''));
    }
  }
  if (current) sections.push(current);
  return sections;
}

// Render a briefing bullet that may contain [[link text](url)] or [https://...] citation links
function renderBullet(text: string): React.ReactNode {
  // Match both [[title](url)] and bare [https://...] patterns
  const parts = text.split(/(\[\[.*?\]\(.*?\)\]|\[https?:\/\/[^\]]+\])/);
  return parts.map((part, i) => {
    // Standard [[title](url)] format
    const m1 = part.match(/^\[\[(.*?)\]\((.*?)\)\]$/);
    if (m1) {
      const rawTitle = m1[1];
      const url = m1[2];
      // Long titles are usually scraped page text — fall back to bare domain.
      let displayTitle = rawTitle;
      if (rawTitle.length > 60) {
        try { displayTitle = new URL(url).hostname.replace(/^www\./, ''); }
        catch { displayTitle = rawTitle.slice(0, 57) + '…'; }
      }
      return (
        <a key={i} href={url} target="_blank" rel="noopener noreferrer"
           className="text-[#8a7200]/70 hover:text-[#8a7200] underline decoration-dotted transition-colors">
          [{displayTitle}]
        </a>
      );
    }
    // Bare URL in brackets [https://...] — extract domain as display text
    const m2 = part.match(/^\[(https?:\/\/[^\]]+)\]$/);
    if (m2) {
      const url = m2[1];
      let displayTitle = url;
      try { displayTitle = new URL(url).hostname.replace(/^www\./, ''); }
      catch { displayTitle = url.slice(0, 40) + '…'; }
      return (
        <a key={i} href={url} target="_blank" rel="noopener noreferrer"
           className="text-[#8a7200]/70 hover:text-[#8a7200] underline decoration-dotted transition-colors">
          [{displayTitle}]
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// Map section heading text → tab colour
function sectionColor(heading: string): string {
  const h = heading.toLowerCase();
  if (h.includes('artificial intelligence') || (h.includes(' ai') && !h.includes('physical'))) return SECTOR_COLORS['Artificial Intelligence'];
  if (h.includes('robotics') || h.includes('physical ai')) return SECTOR_COLORS['Robotics & Physical AI'];
  if (h.includes('supply chain') || h.includes('logistics')) return SECTOR_COLORS['Supply Chain & Logistics'];
  if (h.includes('manufactur') || h.includes('industrial')) return SECTOR_COLORS['Manufacturing & Industrial'];
  if (h.includes('semiconductor') || h.includes('hardware')) return SECTOR_COLORS['Semiconductors & Hardware'];
  if (h.includes('defense') || h.includes('government')) return SECTOR_COLORS['Defense & Government'];
  if (h.includes('macro') || h.includes('market')) return SECTOR_COLORS['Macro & Markets'];
  if (h.includes('venture') || h.includes('funding')) return SECTOR_COLORS['Venture Capital & Funding'];
  if (h.includes('portfolio') || h.includes('portco') || h.includes('pulse')) return SECTOR_COLORS['Portfolio'];
  return SECTOR_COLORS['General'];
}

// Title-case an ALL_CAPS section heading (keeps leading emoji)
function sectionTabLabel(heading: string): string {
  return heading.replace(/[A-Z]{2,}/g, m => m.charAt(0) + m.slice(1).toLowerCase());
}

// ── Collapsible Briefing Card ─────────────────────────────────────────────────

const SECTOR_COLORS: Record<string, string> = {
  'Supply Chain':             'bg-blue-500/20 text-blue-700 border-blue-500/40',
  'Robotics':                 'bg-purple-500/20 text-purple-700 border-purple-500/40',
  'Physical AI':              'bg-cvc-gold/20 text-[#33322c] border-cvc-gold/50',
  'Industrial Automation':    'bg-orange-500/20 text-orange-700 border-orange-500/40',
  'Manufacturing':            'bg-emerald-500/20 text-emerald-700 border-emerald-500/40',
  'Artificial Intelligence':  'bg-violet-500/20 text-violet-700 border-violet-500/40',
  'Robotics & Physical AI':   'bg-purple-500/20 text-purple-700 border-purple-500/40',
  'Supply Chain & Logistics': 'bg-blue-500/20 text-blue-700 border-blue-500/40',
  'Manufacturing & Industrial':'bg-emerald-500/20 text-emerald-700 border-emerald-500/40',
  'Semiconductors & Hardware':'bg-cyan-500/20 text-cyan-700 border-cyan-500/40',
  'Defense & Government':     'bg-slate-500/20 text-slate-700 border-slate-500/40',
  'Macro & Markets':          'bg-amber-500/20 text-amber-700 border-amber-500/40',
  'Venture Capital & Funding':'bg-green-500/20 text-green-700 border-green-500/40',
  'Partners':                 'bg-rose-500/20 text-rose-700 border-rose-500/40',
  'Portfolio':                'bg-green-500/20 text-green-700 border-green-500/40',
  'General':                  'bg-[#ede8d7] text-[#787569] border-slate-200',
};


interface UpvoteState { count: number; voters: string[] }
interface BriefingComment { id: number; comment: string; commented_by: string; created_at: string; }

function BriefingCard({ briefing, defaultOpen }: { briefing: Briefing; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<string>('Overview');
  const [localInsights, setLocalInsights] = useState<BriefingInsight[]>(briefing.insights ?? []);
  const [localSectors, setLocalSectors] = useState<Record<string, BriefingInsight[]>>(briefing.signals_by_sector ?? {});
  const [deleting, setDeleting] = useState<number | null>(null);
  // upvotes: insight_text → {count, voters}
  const [upvotes, setUpvotes] = useState<Map<string, UpvoteState>>(new Map());
  const [upvotesLoaded, setUpvotesLoaded] = useState(false);
  const [upvoting, setUpvoting] = useState<Set<string>>(new Set());
  // comments: insight_text → comment[]
  const [comments, setComments] = useState<Map<string, BriefingComment[]>>(new Map());
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [posting, setPosting] = useState<Set<string>>(new Set());
  const currentUser = (api as any).getCurrentUser?.()?.username ?? '';

  const hasPartners = (localSectors['Partners']?.length ?? 0) > 0;

  // Deduplicated podcast insights — only actual podcast source_type
  const podcastInsights = (() => {
    const seen = new Set<string>();
    return localInsights.filter(ins => {
      if (ins.source_type !== 'podcast') return false;
      if (seen.has(ins.insight)) return false;
      seen.add(ins.insight);
      return true;
    });
  })();

  // Parse briefing_text into topic sections → become the middle tabs
  const textSections = parseBriefingText(briefing.briefing_text ?? '');

  // Unified tab list: Overview | Podcasts | topic sections | Partners
  const allTabs = [
    'Overview',
    'Podcasts',
    ...textSections.map(s => s.heading),
    ...(hasPartners ? ['Partners'] : []),
  ];
  const currentTab = allTabs.includes(activeTab) ? activeTab : 'Overview';

  // Load upvotes + comments when card opens
  useEffect(() => {
    if (!open) return;
    if (!upvotesLoaded) {
      fetch(`/home/briefings/upvotes/${briefing.week_start}`, { headers: AUTH })
        .then(r => r.ok ? r.json() : [])
        .then((rows: { insight_text: string; count: number; voters: string[] }[]) => {
          const m = new Map<string, UpvoteState>();
          for (const row of rows) m.set(row.insight_text, { count: row.count, voters: row.voters });
          setUpvotes(m);
          setUpvotesLoaded(true);
        })
        .catch(() => setUpvotesLoaded(true));
    }
    if (!commentsLoaded) {
      fetch(`/home/briefings/comments/${briefing.week_start}`, { headers: AUTH })
        .then(r => r.ok ? r.json() : {})
        .then((grouped: Record<string, BriefingComment[]>) => {
          const m = new Map<string, BriefingComment[]>();
          for (const [key, val] of Object.entries(grouped)) m.set(key, val);
          setComments(m);
          setCommentsLoaded(true);
        })
        .catch(() => setCommentsLoaded(true));
    }
  }, [open, upvotesLoaded, commentsLoaded, briefing.week_start]);

  async function handleUpvote(
    insightText: string, section: string,
    insightId?: number, sourceTitle?: string, sourceUrl?: string,
  ) {
    if (!currentUser) {
      alert('Your session has expired — please log out and log back in to upvote.');
      return;
    }
    if (upvoting.has(insightText)) return;
    setUpvoting(prev => new Set(prev).add(insightText));
    // Snapshot for rollback
    const snapshot = upvotes.get(insightText);
    // Optimistic update
    setUpvotes(prev => {
      const next = new Map(prev);
      const cur = next.get(insightText) ?? { count: 0, voters: [] };
      const myVote = cur.voters.includes(currentUser);
      next.set(insightText, myVote
        ? { count: Math.max(0, cur.count - 1), voters: cur.voters.filter(v => v !== currentUser) }
        : { count: cur.count + 1, voters: [...cur.voters, currentUser] },
      );
      return next;
    });
    try {
      const res = await fetch('/home/briefings/upvote', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          week_start: briefing.week_start,
          insight_id: insightId ?? null,
          insight_text: insightText,
          section,
          source_title: sourceTitle ?? null,
          source_url: sourceUrl ?? null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setUpvotes(prev => {
          const next = new Map(prev);
          next.set(insightText, { count: data.total, voters: data.voters });
          return next;
        });
      } else {
        // Revert on failure
        setUpvotes(prev => {
          const next = new Map(prev);
          if (snapshot) next.set(insightText, snapshot);
          else next.delete(insightText);
          return next;
        });
        if (res.status === 401) {
          alert('Your session has expired — please log out and log back in.');
        } else {
          alert('Upvote failed — please try again.');
        }
      }
    } catch {
      // Revert on network error
      setUpvotes(prev => {
        const next = new Map(prev);
        if (snapshot) next.set(insightText, snapshot);
        else next.delete(insightText);
        return next;
      });
    } finally {
      setUpvoting(prev => { const s = new Set(prev); s.delete(insightText); return s; });
    }
  }

  async function handleComment(
    insightText: string, section: string,
    insightId?: number,
  ) {
    const draft = (commentDrafts[insightText] ?? '').trim();
    if (!draft || !currentUser || posting.has(insightText)) return;
    setPosting(prev => new Set(prev).add(insightText));
    try {
      const res = await fetch('/home/briefings/comment', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          week_start: briefing.week_start,
          insight_id: insightId ?? null,
          insight_text: insightText,
          section,
          comment: draft,
        }),
      });
      if (res.ok) {
        const newComment: BriefingComment = await res.json();
        setComments(prev => {
          const next = new Map(prev);
          const existing = next.get(insightText) ?? [];
          next.set(insightText, [...existing, newComment]);
          return next;
        });
        setCommentDrafts(prev => ({ ...prev, [insightText]: '' }));
      }
    } finally {
      setPosting(prev => { const s = new Set(prev); s.delete(insightText); return s; });
    }
  }

  async function deleteInsight(id: number, sector: string) {
    if (!id || deleting) return;
    setDeleting(id);
    try {
      const r = await fetch(`/home/briefings/insights/${id}`, { method: 'DELETE', headers: AUTH });
      if (r.ok) {
        setLocalInsights(prev => prev.filter(i => i.id !== id));
        setLocalSectors(prev => {
          const updated = { ...prev };
          if (updated[sector]) {
            updated[sector] = updated[sector].filter(i => i.id !== id);
            if (updated[sector].length === 0) delete updated[sector];
          }
          return updated;
        });
      }
    } finally {
      setDeleting(null);
    }
  }

  // Upvote + comment action bar — reused across all insight types
  function InsightActions({ text, section, insightId, sourceTitle, sourceUrl }: {
    text: string; section: string; insightId?: number; sourceTitle?: string; sourceUrl?: string;
  }) {
    const upvoteState = upvotes.get(text);
    const myVote = currentUser ? (upvoteState?.voters.includes(currentUser) ?? false) : false;
    const upvoteCount = upvoteState?.count ?? 0;
    const threadComments = comments.get(text) ?? [];
    const isOpen = openComments.has(text);

    return (
      <div className="mt-1">
        {/* Action row */}
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Upvote */}
          <button
            onClick={() => handleUpvote(text, section, insightId, sourceTitle, sourceUrl)}
            disabled={upvoting.has(text)}
            title={myVote ? 'Remove upvote' : 'Upvote this insight'}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-all ${
              myVote
                ? 'text-amber-600 bg-amber-50 border border-amber-200 !opacity-100'
                : 'text-[#c5c0ad] hover:text-amber-500 hover:bg-amber-50'
            }`}
          >
            <ThumbsUp className="w-3 h-3" />
            {upvoteCount > 0 && <span className="text-[10px] font-bold tabular-nums">{upvoteCount}</span>}
          </button>
          {/* Comment toggle */}
          <button
            onClick={() => setOpenComments(prev => {
              const s = new Set(prev);
              s.has(text) ? s.delete(text) : s.add(text);
              return s;
            })}
            title="Comments"
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-all ${
              isOpen || threadComments.length > 0
                ? 'text-blue-600 bg-blue-50 border border-blue-200 !opacity-100'
                : 'text-[#c5c0ad] hover:text-blue-500 hover:bg-blue-50'
            }`}
          >
            <MessageCircle className="w-3 h-3" />
            {threadComments.length > 0 && <span className="text-[10px] font-bold tabular-nums">{threadComments.length}</span>}
          </button>
          {/* Voter pills */}
          {upvoteState && upvoteState.voters.length > 0 && (
            <div className="flex gap-1">
              {upvoteState.voters.map(v => (
                <span key={v} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 uppercase tracking-wide">
                  {v.charAt(0).toUpperCase() + v.slice(1, 4)}
                </span>
              ))}
            </div>
          )}
        </div>
        {/* Comment thread (always visible when open, even without hover) */}
        {isOpen && (
          <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden bg-[#fafcff]">
            {threadComments.length > 0 && (
              <div className="divide-y divide-slate-100">
                {threadComments.map(c => (
                  <div key={c.id} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] font-bold text-[#545249] capitalize shrink-0 mt-0.5">{c.commented_by}</span>
                      <p className="text-xs text-[#33322c] leading-relaxed flex-1">{c.comment}</p>
                    </div>
                    <p className="text-[9px] text-[#c5c0ad] mt-1 ml-[calc(theme(spacing.2)+theme(fontSize.xs[0]))]">{fmtRelative(c.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
            {currentUser ? (
              <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-100">
                <input
                  value={commentDrafts[text] ?? ''}
                  onChange={e => setCommentDrafts(prev => ({ ...prev, [text]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleComment(text, section, insightId); } }}
                  placeholder="Add a comment or action item..."
                  className="flex-1 text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#33322c] bg-white"
                />
                <button
                  onClick={() => handleComment(text, section, insightId)}
                  disabled={!(commentDrafts[text] ?? '').trim() || posting.has(text)}
                  className="p-1.5 bg-[#33322c] text-white rounded disabled:opacity-40 hover:bg-[#151411] transition-colors"
                >
                  <Send className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <p className="text-xs text-[#787569] px-3 py-2 text-center">Log in to comment</p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      {/* Header — always visible, click to toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 border-b border-slate-200 hover:bg-[#ede8d7] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <FileText className="w-4 h-4 text-[#8a7200]" />
          <span className="font-semibold text-[#33322c] text-sm">Weekly Intelligence Briefing</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#787569]">
            {fmtDate(briefing.week_start)} – {fmtDate(briefing.week_end)}
          </span>
          {open
            ? <ChevronDown className="w-4 h-4 text-[#787569]" />
            : <ChevronRight className="w-4 h-4 text-[#787569]" />
          }
        </div>
      </button>

      {open && (
        <div className="px-6 py-5 space-y-5">
          {/* Unified tab bar: Overview | Podcasts | topic sections | Partners */}
          {(allTabs.length > 1) && (
            <div>
              {/* Tab pills */}
              <div className="flex flex-wrap gap-2 mb-4">
                {allTabs.map(tab => {
                  const isActive = currentTab === tab;
                  const upvoteCount = tab === 'Overview' ? upvotes.size : 0;
                  const colorClass = tab === 'Overview'
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : tab === 'Podcasts'
                    ? 'bg-cvc-gold/20 text-[#33322c] border-cvc-gold/50'
                    : tab === 'Partners'
                    ? SECTOR_COLORS['Partners']
                    : sectionColor(tab);
                  const count = tab === 'Overview'
                    ? upvoteCount
                    : tab === 'Podcasts'
                    ? podcastInsights.length
                    : tab === 'Partners'
                    ? (localSectors['Partners']?.length ?? 0)
                    : (textSections.find(s => s.heading === tab)?.bullets.length ?? 0);
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                        isActive
                          ? colorClass
                          : 'bg-transparent text-[#787569] border-slate-200 hover:border-[#33322c] hover:text-[#33322c]'
                      }`}
                    >
                      {tab === 'Overview' ? '⭐ Overview' : sectionTabLabel(tab)}
                      <span className="ml-1.5 opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>

              {/* Overview tab — upvoted insights from all sections, team curated */}
              {currentTab === 'Overview' && (() => {
                const upvotedItems = Array.from(upvotes.entries())
                  .sort((a, b) => b[1].count - a[1].count)
                  .slice(0, 5);
                if (upvotedItems.length === 0) return (
                  <div className="py-6 text-center">
                    <ThumbsUp className="w-6 h-6 text-[#c5c0ad] mx-auto mb-2" />
                    <p className="text-sm text-[#787569]">No upvoted insights yet.</p>
                    <p className="text-xs text-[#c5c0ad] mt-1">
                      Upvote signals in Podcasts or topic tabs — they'll appear here for the team.
                    </p>
                  </div>
                );
                return (
                  <ul className="space-y-3">
                    {upvotedItems.map(([text, state]) => {
                      // Try to find matching insight for source URL
                      const matchedIns = localInsights.find(i => i.insight === text);
                      return (
                        <li key={text} className="flex items-start gap-3 group">
                          <span className="text-amber-400 mt-1 shrink-0">•</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[#33322c] leading-relaxed">
                              {matchedIns?.source_url
                                ? <>{text}{' '}<a href={matchedIns.source_url} target="_blank" rel="noopener noreferrer"
                                    className="text-[#8a7200]/60 hover:text-[#8a7200]">
                                    [{matchedIns.show_name || matchedIns.source_title}]
                                  </a></>
                                : text}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {state.voters.map(v => (
                                <span key={v} className="text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                  {v}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-all">
                            <span className="text-xs font-bold text-amber-500 tabular-nums flex items-center gap-1">
                              <ThumbsUp className="w-3 h-3" />{state.count}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}

              {/* Podcasts tab — structured insights from briefing_insights */}
              {currentTab === 'Podcasts' && (
                <ul className="space-y-3">
                  {podcastInsights.map((ins) => {
                    const citation = ins.expert
                      ? `${ins.expert.split(',')[0]} — ${ins.show_name || ins.source_title}`
                      : (ins.show_name || ins.source_title);
                    return (
                      <li key={ins.id ?? ins.insight} className="group">
                        <div className="flex items-start gap-3">
                          <span className="text-[#c5c0ad] mt-1 shrink-0">•</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[#33322c] leading-relaxed">
                              {ins.insight}{' '}
                              {citation && ins.source_url ? (
                                <a href={ins.source_url} target="_blank" rel="noopener noreferrer"
                                   className="text-[#8a7200]/60 hover:text-[#8a7200] transition-colors">
                                  [{citation}]
                                </a>
                              ) : citation ? (
                                <span className="text-[#787569]">[{citation}]</span>
                              ) : null}
                            </p>
                            <InsightActions text={ins.insight} section="Podcasts"
                              insightId={ins.id} sourceTitle={ins.source_title} sourceUrl={ins.source_url} />
                          </div>
                          {ins.id && (
                            <button
                              onClick={() => deleteInsight(ins.id!, ins.sector)}
                              disabled={deleting === ins.id}
                              title="Remove from briefing"
                              className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[#c5c0ad] hover:text-red-400 hover:bg-red-50 transition-all mt-0.5"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {podcastInsights.length === 0 && (
                    <p className="text-xs text-[#787569] italic">No podcast signals this week.</p>
                  )}
                </ul>
              )}

              {/* Partners tab — grouped by partner name */}
              {currentTab === 'Partners' && (() => {
                const partnerMap = new Map<string, BriefingInsight[]>();
                for (const ins of (localSectors['Partners'] ?? [])) {
                  const key = ins.show_name || 'Unknown Partner';
                  if (!partnerMap.has(key)) partnerMap.set(key, []);
                  partnerMap.get(key)!.push(ins);
                }
                const partners = Array.from(partnerMap.entries());
                if (partners.length === 0) return (
                  <p className="text-xs text-[#787569] italic">No partner signals this week.</p>
                );
                return (
                  <div className="space-y-3">
                    {partners.map(([partnerName, items]) => (
                      <div key={partnerName} className="bg-rose-50/50 border border-rose-100 rounded overflow-hidden">
                        <div className="px-4 py-2.5 border-b border-rose-100">
                          <div className="text-xs font-semibold text-rose-700">{partnerName}</div>
                        </div>
                        <div className="divide-y divide-rose-50">
                          {items.map((ins) => (
                            <div key={ins.id ?? ins.source_title} className="px-4 py-2.5 flex items-start gap-3 group">
                              <span className="text-rose-300 mt-1 shrink-0 text-xs">•</span>
                              <div className="flex-1 min-w-0">
                                {ins.insight && (
                                  <p className="text-xs text-[#545249] leading-relaxed mb-1">{ins.insight}</p>
                                )}
                                {ins.source_url ? (
                                  <a href={ins.source_url} target="_blank" rel="noopener noreferrer"
                                     className="text-[10px] font-medium text-rose-500/70 hover:text-rose-600 hover:underline inline-flex items-center gap-0.5">
                                    ↗ {ins.source_title}
                                  </a>
                                ) : ins.source_title ? (
                                  <div className="text-[10px] text-[#a09a8a]">{ins.source_title}</div>
                                ) : null}
                              </div>
                              <InsightActions text={ins.insight || ins.source_title || ''} section="Partners"
                                insightId={ins.id} sourceTitle={ins.source_title} sourceUrl={ins.source_url} />
                              {ins.id && (
                                <button
                                  onClick={() => deleteInsight(ins.id!, 'Partners')}
                                  disabled={deleting === ins.id}
                                  title="Remove from briefing"
                                  className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[#c5c0ad] hover:text-red-400 hover:bg-red-50 transition-all mt-0.5"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Topic section tabs — bullets parsed from briefing_text */}
              {currentTab !== 'Overview' && currentTab !== 'Podcasts' && currentTab !== 'Partners' && (() => {
                const section = textSections.find(s => s.heading === currentTab);
                if (!section || section.bullets.length === 0) return (
                  <p className="text-xs text-[#787569] italic">No signals for this topic this week.</p>
                );
                return (
                  <ul className="space-y-3">
                    {section.bullets.map((bullet, bi) => (
                      <li key={bi} className="group">
                        <div className="flex items-start gap-3">
                          <span className="text-[#c5c0ad] mt-1 shrink-0">•</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[#33322c] leading-relaxed">
                              {renderBullet(bullet)}
                            </p>
                            <InsightActions text={bullet} section={currentTab} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          )}

          {/* Stats row */}
          <div className="flex flex-wrap gap-4">
            {[
              { label: 'Sources analysed', value: briefing.total_items },
              { label: 'Podcasts',          value: briefing.podcast_count },
              { label: 'News / Articles',   value: briefing.news_count + briefing.article_count },
              ...(briefing.total_insights ? [{ label: 'Insights extracted', value: briefing.total_insights }] : []),
            ].map(s => (
              <div key={s.label} className="bg-[#ede8d7] rounded px-4 py-2.5 text-center min-w-[90px]">
                <div className={cls.sectionTitle}>{s.value}</div>
                <div className="text-xs text-[#787569] mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Tags */}
          {briefing.top_tags.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Top themes</div>
              <div className="flex flex-wrap gap-1.5">
                {briefing.top_tags.slice(0, 8).map((t) => (
                  <span key={t.tag} className="px-2.5 py-1 bg-[#ede8d7] rounded text-xs text-[#545249]">
                    {t.tag}
                  </span>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ── Traction Sidebar ─────────────────────────────────────────────────────────

interface TractionItem {
  company_id: number; company_name: string; score: number;
  stage: string | null; velocity_active: boolean; stagnating: boolean;
  delta_direction: 'up' | 'down' | 'flat'; delta_score: number;
}
const STAGE_PILL: Record<string, string> = {
  'Commercial Agreement': 'bg-emerald-100 text-emerald-700',
  'Commercial':           'bg-emerald-100 text-emerald-700',
  'Pilot':                'bg-amber-100  text-amber-700',
  'PoC':                  'bg-violet-100 text-violet-700',
  'NDA':                  'bg-blue-100   text-blue-700',
};

// ── Portfolio Pulse Widget ────────────────────────────────────────────────────
interface PulseEvent {
  type: 'funding' | 'stage_change' | 'commercial';
  company_id: number;
  company_name: string;
  label: string;
  event_at: string;
}

const PULSE_ICON: Record<string, React.ReactNode> = {
  funding:      <BadgeDollarSign className="w-3.5 h-3.5 text-amber-500 shrink-0" />,
  stage_change: <Rocket          className="w-3.5 h-3.5 text-indigo-500 shrink-0" />,
  commercial:   <Handshake       className="w-3.5 h-3.5 text-emerald-500 shrink-0" />,
};
const PULSE_COLOR: Record<string, string> = {
  funding:      'bg-amber-50 text-amber-700 border-amber-200',
  stage_change: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  commercial:   'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function PortfolioPulseWidget() {
  const [events, setEvents] = useState<PulseEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/home/portfolio-pulse', { headers: AUTH })
      .then(r => r.ok ? r.json() : [])
      .then(d => setEvents(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden h-full">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-200">
        <Activity className="w-4 h-4 text-[#8a7200]" />
        <span className="font-semibold text-[#33322c] text-sm">Portfolio Pulse</span>
      </div>
      {loading ? (
        <div className="px-5 py-6 text-center text-[#787569] text-xs">Loading…</div>
      ) : events.length === 0 ? (
        <div className="px-5 py-6 text-center text-[#787569] text-xs">No recent significant events.</div>
      ) : (
        <div className="divide-y divide-[#f1f5f9]">
          {events.map((ev, i) => (
            <Link key={i} to={`/company/${ev.company_id}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-[#ede8d7] transition-colors group">
              {PULSE_ICON[ev.type]}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#33322c] group-hover:text-[#151411] truncate">
                  {ev.company_name}
                </p>
                <span className={`inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded border mt-0.5 ${PULSE_COLOR[ev.type]}`}>
                  {ev.label}
                </span>
              </div>
              <span className="text-[10px] text-[#ACACAA] shrink-0 whitespace-nowrap">{fmtRelative(ev.event_at)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}


function TractionSidebar() {
  const [win, setWin] = useState<'14d' | '2mo' | '6mo'>('2mo');
  const [items, setItems] = useState<TractionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/home/traction?window=${win}`, { headers: AUTH })
      .then(r => r.json())
      .then(d => setItems(d.companies ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [win]);

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden h-full">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#8a7200]" />
          <span className="font-semibold text-[#33322c] text-sm">Corporate Traction</span>
          <div className="relative group/info">
            <Info className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600 cursor-help" />
            <div className="absolute left-0 top-5 z-50 w-72 bg-[#1e293b] text-white text-xs rounded shadow-lg p-3 hidden group-hover/info:block leading-relaxed">
              <p className="font-semibold mb-1.5">How scores are calculated</p>
              <div className="space-y-0.5 text-slate-300 mb-2.5">
                <div className="flex justify-between"><span>Intro logged</span><span className="text-white font-medium">1 pt</span></div>
                <div className="flex justify-between"><span>NDA signed</span><span className="text-white font-medium">10 pts</span></div>
                <div className="flex justify-between"><span>PoC started</span><span className="text-white font-medium">25 pts</span></div>
                <div className="flex justify-between"><span>Pilot running</span><span className="text-white font-medium">50 pts</span></div>
                <div className="flex justify-between"><span>Commercial deal</span><span className="text-white font-medium">150 pts</span></div>
              </div>
              <p className="font-semibold mb-1">Time decay</p>
              <p className="text-slate-300 mb-1">Intro and NDA points lose half their value every <span className="text-white">3 weeks</span>. An intro from 2 months ago is worth less than 10% of a fresh one.</p>
              <p className="text-slate-300">PoC, Pilot, and Commercial points decay much slower — half-life of <span className="text-white">3 months</span>.</p>
            </div>
          </div>
        </div>
        <div className="flex gap-0.5">
          {(['14d', '2mo', '6mo'] as const).map(w => (
            <button key={w} onClick={() => setWin(w)}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${
                win === w ? 'bg-[#151411] text-white' : 'text-[#787569] hover:text-[#33322c]'
              }`}>
              {w}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="px-5 py-8 text-center text-[#787569] text-xs">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-8 text-center text-[#787569] text-sm">
          No traction data yet — PSMs need to log outcomes.
        </div>
      ) : (
        <div className="divide-y divide-[#f1f5f9]">
          {items.slice(0, 12).map((item, i) => (
            <Link key={item.company_id} to={`/company/${item.company_id}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-[#ede8d7] transition-colors group">
              <span className="text-[10px] font-bold text-[#ACACAA] w-4 shrink-0 tabular-nums">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm text-[#33322c] group-hover:text-[#151411] truncate">{item.company_name}</span>
                  {item.stage && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${STAGE_PILL[item.stage] ?? 'bg-slate-100 text-slate-500'}`}>
                      {item.stage}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {item.velocity_active && <span className="text-[9px] text-amber-600 font-semibold">⚡ Rising</span>}
                  {item.stagnating && <span className="text-[9px] text-slate-400">⚠ Stale</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {item.delta_direction !== 'flat' && (
                  <span className={`text-[10px] font-bold ${item.delta_direction === 'up' ? 'text-emerald-500' : 'text-red-400'}`}>
                    {item.delta_direction === 'up' ? '↑' : '↓'}
                  </span>
                )}
                <span className="text-xs font-bold text-[#151411] tabular-nums">{item.score}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Leaderboard Panel ────────────────────────────────────────────────────────

function LeaderboardRow({ e, i, max }: { e: { name: string; count: number }; i: number; max: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`text-xs font-bold w-4 shrink-0 ${i === 0 ? 'text-[#8a7200]' : 'text-[#787569]'}`}>{i + 1}</span>
      <span className="text-sm text-[#33322c] w-20 shrink-0 truncate">{e.name}</span>
      <div className="flex-1 h-1.5 bg-[#ede8d7] rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-cvc-gold/80" style={{ width: `${(e.count / max) * 100}%` }} />
      </div>
      <span className="text-xs text-[#787569] w-6 text-right shrink-0">{e.count}</span>
    </div>
  );
}

function LeaderboardPanel({
  title, sub, top3, rest, max,
}: {
  title: string;
  sub: string;
  top3: { name: string; count: number }[];
  rest: { name: string; count: number }[];
  max: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-6 py-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-0.5">{title}</p>
      <p className="text-[10px] text-[#787569] mb-4">{sub}</p>
      <div className="space-y-3">
        {top3.map((e, i) => <LeaderboardRow key={e.name} e={e} i={i} max={max} />)}
      </div>
      {rest.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-1 text-[10px] text-[#787569] hover:text-[#33322c] transition-colors mt-2"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
            {open ? 'Hide' : `+${rest.length} more`}
          </button>
          {open && (
            <div className="space-y-3 mt-3 pt-3 border-t border-[#f1f5f9]">
              {rest.map((e, i) => <LeaderboardRow key={e.name} e={e} i={i + 3} max={max} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── My Partners Widget (PSM role) ─────────────────────────────────────────────

interface PartnerSummary { id: number; name: string; industry: string | null; membership_level: string | null }

function MyPartnersWidget() {
  const [partners, setPartners] = useState<PartnerSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/partners/', { headers: AUTH })
      .then(r => r.ok ? r.json() : { partners: [] })
      .then(d => setPartners((d.partners ?? []).slice(0, 6)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <Handshake className="w-4 h-4 text-[#8a7200]" />
          <span className="font-semibold text-[#33322c] text-sm">My Partners</span>
        </div>
        <Link to="/partners" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">View all →</Link>
      </div>
      {loading ? (
        <div className="px-5 py-4 text-xs text-slate-400">Loading…</div>
      ) : partners.length === 0 ? (
        <p className="text-xs text-slate-400 italic px-5 py-4">No partners assigned yet.</p>
      ) : (
        <div className="divide-y divide-[#f1f5f9]">
          {partners.map(p => (
            <Link key={p.id} to={`/partners/${p.id}/terminal`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-[#ede8d7] transition-colors group">
              <div className="w-7 h-7 rounded-full bg-[#ede8d7] flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-[#787569]">{p.name[0].toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#33322c] group-hover:text-[#151411] truncate">{p.name}</p>
                {p.industry && <p className="text-[10px] text-slate-400 truncate">{p.industry}</p>}
              </div>
              {p.membership_level && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                  {p.membership_level}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── My Recent Activity Widget (Ventures role) ─────────────────────────────────

function MyActivityWidget() {
  const [edits, setEdits] = useState<{ company_id: number; company_name: string; action: string; ts: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMyActivity()
      .then(d => setEdits(d.edits ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-200">
        <Activity className="w-4 h-4 text-[#8a7200]" />
        <span className="font-semibold text-[#33322c] text-sm">My Recent Activity</span>
      </div>
      {loading ? (
        <div className="px-5 py-4 text-xs text-slate-400">Loading…</div>
      ) : edits.length === 0 ? (
        <p className="text-xs text-slate-400 italic px-5 py-4">No recent activity.</p>
      ) : (
        <div className="divide-y divide-[#f1f5f9]">
          {edits.map((e, i) => (
            <Link key={i} to={`/company/${e.company_id}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-[#ede8d7] transition-colors group">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#33322c] group-hover:text-[#151411] truncate">{e.company_name}</p>
                <p className="text-[10px] text-slate-400 truncate">{e.action}</p>
              </div>
              <span className="text-[10px] text-slate-400 shrink-0">{fmtRelative(e.ts)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Homepage Carousel ─────────────────────────────────────────────────────────

function HomeCarousel({ messages, expandedMsg, setExpandedMsg, initialIndex }: {
  messages: TeamMessage[];
  expandedMsg: number | null;
  setExpandedMsg: (id: number | null) => void;
  initialIndex?: number;
}) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false, align: 'start' });
  const [selectedIndex, setSelectedIndex] = useState(initialIndex ?? 0);
  const SLIDES = 3;

  // Scroll to initial index once emblaApi is ready
  useEffect(() => {
    if (!emblaApi || !initialIndex) return;
    emblaApi.scrollTo(initialIndex, true);
  }, [emblaApi, initialIndex]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on('select', onSelect);
    return () => { emblaApi.off('select', onSelect); };
  }, [emblaApi, onSelect]);

  return (
    <div className="mb-6 relative">
      <div ref={emblaRef} className="overflow-hidden">
        <div className="flex items-start">

          {/* Slide 1: From the Team */}
          <div className="flex-[0_0_100%] min-w-0 h-[280px]">
            <div className="bg-white border border-slate-200 rounded p-5 h-full overflow-y-auto">
              <div className="flex items-center gap-2 mb-3">
                <Bell className="w-4 h-4 text-[#8a7200]" />
                <span className="text-sm font-semibold text-[#8a7200]">From the Team</span>
                {messages.length > 0 && (
                  <span className="text-xs text-[#787569]">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
                )}
              </div>
              {messages.length === 0 ? (
                <p className="text-sm text-[#787569] py-2">No announcements right now.</p>
              ) : (
                <div className="space-y-1">
                  {messages.map(msg => (
                    <div key={msg.id} className={`rounded border transition-colors ${msg.pinned ? 'border-cvc-gold/30 bg-cvc-gold/5' : 'border-slate-200 bg-[#ede8d7]'}`}>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-2 text-left"
                        onClick={() => setExpandedMsg(expandedMsg === msg.id ? null : msg.id)}
                      >
                        {msg.pinned && <AlertCircle className="w-3.5 h-3.5 text-[#8a7200] shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-[#33322c] truncate">{msg.title}</p>
                        </div>
                        <span className="text-[10px] text-[#ACACAA] shrink-0 whitespace-nowrap mr-2">
                          {new Date(msg.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                        <span className="text-[10px] text-[#33322c]/60 hover:text-[#33322c] shrink-0">
                          {expandedMsg === msg.id ? 'Close' : 'Read →'}
                        </span>
                      </button>
                      {expandedMsg === msg.id && (
                        <div className="px-4 pb-4 border-t border-slate-200">
                          <p className="text-sm text-[#33322c] leading-relaxed whitespace-pre-wrap pt-3">{msg.body}</p>
                          <p className="text-[10px] text-[#787569] mt-3">
                            Posted by {msg.posted_by} · {new Date(msg.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Slide 2: Pipeline Pulse — full width */}
          <div className="flex-[0_0_100%] min-w-0 h-[280px]">
            <PipelinePulseWidget />
          </div>

          {/* Slide 3: Corporate Traction + Portfolio Pulse — 50/50 */}
          <div className="flex-[0_0_100%] min-w-0 h-[280px]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 h-full">
              <div className="overflow-y-auto h-full"><TractionSidebar /></div>
              <div className="overflow-y-auto h-full"><PortfolioPulseWidget /></div>
            </div>
          </div>

        </div>
      </div>

      {/* Prev / Next arrows */}
      <button
        onClick={() => emblaApi?.scrollPrev()}
        disabled={selectedIndex === 0}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-7 h-7 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-slate-800 disabled:opacity-20 transition-all z-10"
      >
        <ChevronRight className="w-3.5 h-3.5 rotate-180" />
      </button>
      <button
        onClick={() => emblaApi?.scrollNext()}
        disabled={selectedIndex === SLIDES - 1}
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-7 h-7 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-slate-800 disabled:opacity-20 transition-all z-10"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>

      {/* Dot indicators */}
      <div className="flex justify-center gap-1.5 mt-3">
        {Array.from({ length: SLIDES }).map((_, i) => (
          <button
            key={i}
            onClick={() => emblaApi?.scrollTo(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === selectedIndex ? 'bg-[#33322c] w-4' : 'bg-slate-300 w-1.5'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ── Pipeline Pulse Widget ─────────────────────────────────────────────────────

const _STAGE_LABELS: Record<string, string> = {
  target: 'Target', nurturing: 'Nurturing', proposal: 'Proposal',
  closed_won: 'Won', closed_lost: 'Lost',
};
const _STAGE_COLORS: Record<string, string> = {
  target: '#94a3b8', nurturing: '#3b82f6', proposal: '#f59e0b',
  closed_won: '#10b981', closed_lost: '#ef4444',
};

function PipelinePulseWidget() {
  const [data, setData] = useState<{
    stage_counts: Record<string, number>;
    recent_moves: { id: number; company_name: string; assigned_to: string | null; stage: string; stage_changed_at: string }[];
    open_skirmish_count: number;
    top_skirmishes: { id: number; title: string; partner_name: string | null; priority: string; created_at: string }[];
    bucket_of_shame: { id: number; company_name: string; assigned_to: string | null; stage_changed_at: string }[];
  } | null>(null);

  useEffect(() => {
    fetch('/sales/pipeline-summary', { headers: AUTH })
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setData(d))
      .catch(() => {});
  }, []);

  if (!data) return null;

  const stages = ['target', 'nurturing', 'proposal', 'closed_won', 'closed_lost'];
  const maxCount = Math.max(...stages.map(s => data.stage_counts[s] ?? 0), 1);

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden h-full">
      <div className="flex items-center gap-2.5 px-6 py-3.5 border-b border-slate-200">
        <Target className="w-4 h-4 text-[#8a7200]" />
        <span className="font-semibold text-[#33322c] text-sm">Pipeline Pulse</span>
        <span className="text-xs text-[#787569] ml-1">sales targets & proposals</span>
        <Link to="/sales" className="ml-auto text-xs text-[#787569] hover:text-[#33322c] flex items-center gap-0.5 transition-colors">
          View all <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#f1f5f9]">

        {/* Stage Counts */}
        <div className="px-6 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-3">Stage Counts</p>
          <div className="space-y-2">
            {stages.map(s => {
              const n = data.stage_counts[s] ?? 0;
              return (
                <div key={s} className="flex items-center gap-2">
                  <span className="text-xs text-[#33322c] w-20 shrink-0">{_STAGE_LABELS[s]}</span>
                  <div className="flex-1 h-1.5 bg-[#ede8d7] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${(n / maxCount) * 100}%`, background: _STAGE_COLORS[s] }} />
                  </div>
                  <span className="text-xs text-[#787569] w-5 text-right shrink-0">{n}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Moves */}
        <div className="px-6 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-3">Recent Moves</p>
          {data.recent_moves.length === 0 ? (
            <p className="text-xs text-[#787569]">No recent stage changes.</p>
          ) : (
            <div className="space-y-2">
              {data.recent_moves.map(m => {
                const d = Math.floor((Date.now() - new Date(m.stage_changed_at).getTime()) / 86400000);
                const ago = d === 0 ? 'today' : d === 1 ? '1d ago' : `${d}d ago`;
                return (
                  <div key={m.id} className="text-xs text-[#33322c] leading-snug">
                    <span className="font-semibold">{m.company_name}</span>
                    <span className="text-[#787569]"> moved to </span>
                    <span className="font-semibold" style={{ color: _STAGE_COLORS[m.stage] }}>{_STAGE_LABELS[m.stage]}</span>
                    {m.assigned_to && <span className="text-[#787569]"> by {m.assigned_to}</span>}
                    <span className="text-[#787569]"> · {ago}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Open Requests */}
        <div className="px-6 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Swords className="w-3.5 h-3.5 text-[#787569]" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569]">Open Requests</p>
            <span className="ml-auto text-xs font-bold text-[#33322c]">{data.open_skirmish_count}</span>
          </div>
          {data.top_skirmishes.length === 0 ? (
            <p className="text-xs text-[#787569]">No open requests.</p>
          ) : (
            <div className="space-y-2">
              {data.top_skirmishes.map(s => (
                <div key={s.id} className="text-xs text-[#33322c] leading-snug">
                  <span className="font-semibold truncate block">{s.title}</span>
                  {s.partner_name && <span className="text-[#787569]">{s.partner_name}</span>}
                </div>
              ))}
            </div>
          )}
          <Link to="/sales" className="text-[10px] text-[#787569] hover:text-[#33322c] mt-3 block transition-colors">
            Manage in Sales →
          </Link>
        </div>

      </div>

    </div>
  );
}


// ── Component ────────────────────────────────────────────────────────────────

export default function Homepage() {
  const currentUser = api.getCurrentUser();
  const role = currentUser?.role ?? '';
  const isPSM = role === 'PSM' || role === 'Senior PSM';
  const config = useConfig();
  const isVentures = role === 'Ventures';
  // Carousel initial slide: PSMs → Pipeline Pulse (1), Ventures → Traction (2), others → Announcements (0)
  const carouselInitialIndex = isPSM ? 1 : isVentures ? 2 : 0;

  const [homeTab, setHomeTab] = useState<'desk' | 'team'>('desk');

  const [data, setData]             = useState<DashboardData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [messages, setMessages]     = useState<TeamMessage[]>([]);
  const [expandedMsg, setExpandedMsg] = useState<number | null>(null);
  const [leaderboards, setLeaderboards] = useState<Record<string, {name: string; count: number}[]>>({});
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getDashboard(),
      api.getTeamMessages().catch(() => ({ messages: [] })),
      api.getLeaderboards().catch(() => null),
      fetch('/home/deliverables', { headers: AUTH }).then(r => r.json()).catch(() => ({ deliverables: [] })),
    ])
      .then(([dash, msgs, boards, dels]) => {
        setData(dash);
        setMessages(msgs.messages ?? []);
        if (boards) setLeaderboards(boards);
        setDeliverables(dels.deliverables ?? []);
      })
      .catch(() => setError('Could not load dashboard data.'))
      .finally(() => setLoading(false));
  }, []);

  // Show onboarding wizard for fresh installs:
  // admin role + not previously dismissed + no company data yet
  useEffect(() => {
    const dismissed = localStorage.getItem('platform_onboarding_v1');
    if (dismissed) return;
    const adminRoles = ['GP', 'Principal', 'Director'];
    if (!adminRoles.includes(role)) return;
    fetch('/companies/?limit=1', { headers: AUTH })
      .then(r => r.json())
      .then(d => {
        const count = Array.isArray(d) ? d.length : (d?.companies?.length ?? d?.count ?? 1);
        if (count === 0) setShowOnboarding(true);
      })
      .catch(() => {});
  }, [role]);

  return (
    <div className={cls.page}>
      <CVCNavbar />
      {showOnboarding && (
        <OnboardingWizard
          teamName={config?.team_name ?? 'Your Platform'}
          onComplete={() => setShowOnboarding(false)}
        />
      )}

      <div className="max-w-[1400px] mx-auto px-4 py-6 md:px-6 md:py-8">

        {/* Report Header */}
        <div className="border-b-2 border-[#33322c] pb-5 mb-8">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#787569] mb-2">Vertical OS · Intelligence</p>
          <h1 className={cls.pageTitle}>Vertical OS</h1>
          <p className="text-sm text-[#787569] mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-0 border-b border-slate-200 mb-8 -mt-2">
          {(['desk', 'team'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setHomeTab(tab)}
              className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                homeTab === tab
                  ? 'border-[#33322c] text-[#33322c]'
                  : 'border-transparent text-[#787569] hover:text-[#33322c]'
              }`}
            >
              {tab === 'desk' ? 'My Desk' : 'Team'}
            </button>
          ))}
        </div>

        {homeTab === 'desk' ? (
          <MyDesk />
        ) : (
          <>

        {loading && (
          <div className="flex items-center justify-center h-64 text-[#787569]">Loading…</div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded px-5 py-4 text-sm">
            {error}
          </div>
        )}

        {/* ── Leaderboards ── */}
        <div className="mb-6 bg-white border border-slate-200 rounded overflow-hidden">
          <div className="flex items-center gap-2.5 px-6 py-3.5 border-b border-slate-200">
            <Trophy className="w-4 h-4 text-[#8a7200]" />
            <span className="font-semibold text-[#33322c] text-sm">Leaderboards</span>
            <span className="text-xs text-[#787569] ml-1">partner management & servicing</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#f1f5f9]">
            {[
              {
                title: 'Startups Reviewed',
                sub: 'startup profiles reviewed',
                entries: leaderboards.startups_reviewed ?? [],
              },
              {
                title: 'Introductions',
                sub: 'partner ↔ startup intros made',
                entries: leaderboards.introductions ?? [],
              },
              {
                title: 'Partner Data',
                sub: 'partner profiles enriched',
                entries: leaderboards.partner_data ?? [],
              },
            ].map(board => {
              const max = Math.max(...board.entries.map(e => e.count), 1);
              const top3 = board.entries.slice(0, 3);
              const rest = board.entries.slice(3);
              return (
                <LeaderboardPanel key={board.title} title={board.title} sub={board.sub} top3={top3} rest={rest} max={max} />
              );
            })}
          </div>
        </div>

        {/* ── Carousel: Announcements / Pipeline Pulse / Traction+Portco ── */}
        <HomeCarousel messages={messages} expandedMsg={expandedMsg} setExpandedMsg={setExpandedMsg} initialIndex={carouselInitialIndex} />

        {data && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

            {/* ── Left column: Briefing (2/3 width) ── */}
            <div className="xl:col-span-2 space-y-6">

              {/* Weekly Briefings — collapsible, newest first */}
              {data.briefings.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded px-6 py-10 text-center text-[#787569] text-sm">
                  No briefing generated yet — runs every Sunday at 5AM UTC.
                </div>
              ) : (
                data.briefings.map((b, i) => (
                  <BriefingCard key={b.week_start} briefing={b} defaultOpen={i === 0} />
                ))
              )}
            </div>

            {/* ── Right column: role-aware ── */}
            <div className="space-y-6">

              {/* PSM: My Partners first */}
              {isPSM && <MyPartnersWidget />}

              {/* Deliverables */}
              <div className="bg-white border border-slate-200 rounded overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                  <div className="flex items-center gap-2.5">
                    <Send className="w-4 h-4 text-[#8a7200]" />
                    <span className="font-semibold text-[#33322c] text-sm">Deliverables</span>
                  </div>
                  <Link to="/requests" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">View all →</Link>
                </div>
                {deliverables.length === 0 ? (
                  <p className="text-xs text-slate-400 italic px-5 py-4">No open deliverables.</p>
                ) : (
                  <div className="divide-y divide-[#f1f5f9]">
                    {deliverables.map(d => (
                      <div key={d.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[#ede8d7] transition-colors">
                        {/* Service type dot */}
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: SERVICE_COLORS[d.service_type] ?? '#94a3b8' }}
                        />
                        <div className="flex-1 min-w-0">
                          <Link
                            to="/requests"
                            className="text-sm font-medium text-[#33322c] hover:text-[#151411] truncate block"
                          >
                            {d.title}
                          </Link>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-slate-400">{SERVICE_LABELS[d.service_type] ?? d.service_type}</span>
                            {d.partner_name && <span className="text-[10px] text-slate-400">· {d.partner_name}</span>}
                          </div>
                        </div>
                        {/* Days ago */}
                        {d.updated_at && (
                          <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap">
                            {(() => {
                              const days = Math.floor((Date.now() - new Date(d.updated_at!).getTime()) / 86400000);
                              return days === 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`;
                            })()}
                          </span>
                        )}
                        {/* Assignees */}
                        {d.assignees.length > 0 && (
                          <div className="flex -space-x-1 flex-shrink-0">
                            {d.assignees.slice(0, 3).map(a => (
                              <div key={a} title={a}
                                className="w-5 h-5 rounded-full bg-slate-200 border border-white flex items-center justify-center text-[9px] font-bold text-slate-600 uppercase">
                                {a[0]}
                              </div>
                            ))}
                            {d.assignees.length > 3 && (
                              <div className="w-5 h-5 rounded-full bg-slate-100 border border-white flex items-center justify-center text-[9px] text-slate-400">
                                +{d.assignees.length - 3}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Ventures: My Recent Activity below deliverables */}
              {isVentures && <MyActivityWidget />}

            </div>

          </div>
        )}

          </>
        )}
      </div>
    </div>
  );
}
