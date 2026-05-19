import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Bell, CheckCheck, Zap, Code2, Bot, Package, UserCheck, AlertTriangle } from 'lucide-react';
import { api } from '../api/client';
import { AUTH_HEADER as AUTH } from '../api/client';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  source: string | null;
  link: string | null;
  created_at: string | null;
}

const LS_KEY = 'platform_notif_last_read';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  1) return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function typeIcon(type: string) {
  switch (type) {
    case 'enrichment':
    case 'batch_enrichment': return <Zap          className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />;
    case 'dd_complete':      return <Package       className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />;
    case 'task_complete':    return <Code2         className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />;
    case 'agent_update':     return <Bot           className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />;
    case 'assignment':       return <UserCheck     className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />;
    case 'cron_error':       return <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />;
    default:                 return <Bell          className="w-3.5 h-3.5 text-white/50 shrink-0 mt-0.5" />;
  }
}

function sourceLabel(source: string | null): string {
  if (!source) return '';
  const map: Record<string, string> = {
    bigclaw:         'BigClaw',
    'bigclaw-agent': 'BigClaw',
    bigbosshog:      'BigBossHog',
    sharpclaw:       'SharpClaw',
    enrich_worker:   'Enrich Phase 1',
    enrich_phase2:   'Enrich Phase 2',
    score_refresh:   'Scoring',
    weekly_signals:  'Signals',
    weekly_briefing: 'Briefing',
    news_fetcher:    'News Fetcher',
    refinery:        'Refinery',
    system:          'System',
    cron:            'Cron',
  };
  return map[source.toLowerCase()] ?? source;
}

const NotificationBell: React.FC = () => {
  const [open, setOpen]                   = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [lastReadAt, setLastReadAt]       = useState<number>(() => {
    const stored = localStorage.getItem(LS_KEY);
    return stored ? parseInt(stored, 10) : 0;
  });
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const fetchNotifications = useCallback(async () => {
    try {
      
      const res = await fetch('/notifications', { headers: AUTH });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data);
    } catch {
      // non-fatal — bell just stays empty
    }
  }, []);

  // Initial fetch + poll every 90s
  useEffect(() => {
    setLoading(true);
    fetchNotifications().finally(() => setLoading(false));
    const timer = setInterval(fetchNotifications, 90_000);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const unreadCount = notifications.filter(n => {
    if (!n.created_at) return false;
    return new Date(n.created_at).getTime() > lastReadAt;
  }).length;

  const markAllRead = () => {
    const now = Date.now();
    localStorage.setItem(LS_KEY, String(now));
    setLastReadAt(now);
  };

  const handleOpen = () => {
    setOpen(v => !v);
    if (!open) markAllRead();
  };

  const handleClick = (n: Notification) => {
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  // Group by day
  const groups: { label: string; items: Notification[] }[] = [];
  const today     = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  const todayItems     = notifications.filter(n => n.created_at && new Date(n.created_at) >= today);
  const yesterdayItems = notifications.filter(n => n.created_at && new Date(n.created_at) >= yesterday && new Date(n.created_at) < today);
  const olderItems     = notifications.filter(n => n.created_at && new Date(n.created_at) < yesterday);

  if (todayItems.length)     groups.push({ label: 'Today',     items: todayItems });
  if (yesterdayItems.length) groups.push({ label: 'Yesterday', items: yesterdayItems });
  if (olderItems.length)     groups.push({ label: 'Earlier',   items: olderItems });

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={handleOpen}
        title="Notifications"
        className="relative flex items-center justify-center w-9 h-9 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-cvc-gold text-[#1a2d38] text-[10px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-cvc-slate border border-white/10 rounded-lg shadow-2xl z-[200] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-white font-semibold text-sm">Notifications</span>
            {notifications.length > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-white/50 hover:text-white/80 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* Body */}
          <div className="overflow-y-auto max-h-[420px]">
            {loading && notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-white/40 text-sm">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-white/40 text-sm">No notifications</div>
            ) : (
              groups.map(group => (
                <div key={group.label}>
                  <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/30 bg-white/[0.02]">
                    {group.label}
                  </div>
                  {group.items.map(n => {
                    const isUnread = n.created_at ? new Date(n.created_at).getTime() > lastReadAt : false;
                    return (
                      <button
                        key={n.id}
                        onClick={() => handleClick(n)}
                        className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors flex gap-3 ${
                          isUnread ? 'bg-white/[0.03]' : ''
                        }`}
                      >
                        {/* Unread dot */}
                        <div className="w-1.5 h-1.5 rounded-full bg-cvc-gold shrink-0 mt-1.5 self-start" style={{ opacity: isUnread ? 1 : 0 }} />

                        {/* Icon */}
                        {typeIcon(n.type)}

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white/90 font-medium leading-snug truncate">
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="text-xs text-white/45 mt-0.5 line-clamp-2 leading-relaxed">
                              {n.body}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            {n.source && (
                              <span className="text-[10px] text-white/30 font-medium">
                                {sourceLabel(n.source)}
                              </span>
                            )}
                            {n.created_at && (
                              <span className="text-[10px] text-white/25">
                                {timeAgo(n.created_at)}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-white/10 text-center">
              <button
                onClick={() => { setOpen(false); navigate('/admin'); }}
                className="text-xs text-white/40 hover:text-white/70 transition-colors"
              >
                View Task Queue in Admin →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export { NotificationBell };
export default NotificationBell;
