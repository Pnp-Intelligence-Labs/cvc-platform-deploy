import { useState } from 'react';
import { X, MessageSquare, CheckCircle } from 'lucide-react';

const getAuth = () => {
  const token = localStorage.getItem('platform_jwt');
  return token ? { Authorization: `Bearer ${token}` } : {} as Record<string, string>;
};

function getUsername(): string {
  try {
    const token = localStorage.getItem('platform_jwt');
    if (!token) return 'unknown';
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.sub || payload.username || 'unknown';
  } catch {
    return 'unknown';
  }
}

const PAGE_LABELS: Record<string, string> = {
  '/':            'Home',
  '/portfolio':   'Portfolio',
  '/companies':   'Companies',
  '/industrial':  'Industrial',
  '/partners':    'Partners',
  '/lp-portal':   'LP Portal',
  '/tasks':       'Tasks',
  '/enrichment':  'Enrichment',
  '/admin':       'Admin',
};

function getPageLabel(path: string) {
  // exact match first
  if (PAGE_LABELS[path]) return PAGE_LABELS[path];
  // prefix match (e.g. /companies/123)
  for (const [prefix, label] of Object.entries(PAGE_LABELS)) {
    if (prefix !== '/' && path.startsWith(prefix + '/')) return label;
  }
  return path;
}

interface Props {
  currentPath: string;
  onClose: () => void;
}

export function FeedbackModal({ currentPath, onClose }: Props) {
  const [comment, setComment]     = useState('');
  const [priority, setPriority]   = useState<'low' | 'medium' | 'high'>('medium');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState('');
  const [done, setDone]           = useState(false);

  const pageLabel = getPageLabel(currentPath);

  const submit = async () => {
    if (!comment.trim()) { setError('Please add a comment or description.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const spec = `[Dashboard Feedback] ${pageLabel} (${currentPath})\n\n${comment.trim()}`;
      const res = await fetch('/tasks', {
        method: 'POST',
        headers: { ...getAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec, priority, created_by: getUsername() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Error ${res.status}`);
      }
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f0f0]">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="w-5 h-5 text-[#253B49]" />
            <div>
              <h2 className="text-base font-bold text-[#253B49]">Add Feedback</h2>
              <p className="text-xs text-[#94a3b8] mt-0.5">Comment or raise an issue about the dashboard</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#94a3b8] hover:text-[#374151] p-1 rounded transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <div className="px-6 py-8 text-center">
            <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#1f2937]">Feedback received</p>
            <p className="text-xs text-[#94a3b8] mt-1">Logged for review in Admin → Staff Feedback. Nate will forward it to the queue.</p>
            <button
              onClick={onClose}
              className="mt-5 px-6 py-2 rounded-lg bg-[#253B49] text-white text-sm font-semibold hover:bg-[#1a2d38] transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">

            {/* Page context */}
            <div className="bg-[#f8fafc] border border-[#e5e7eb] rounded-lg px-4 py-3">
              <p className="text-xs text-[#94a3b8] mb-0.5">Reporting from</p>
              <p className="text-sm font-semibold text-[#253B49]">{pageLabel}</p>
              <p className="text-[10px] text-[#9ca3af] font-mono mt-0.5">{currentPath}</p>
            </div>

            {/* Comment */}
            <div>
              <label className="block text-xs font-semibold text-[#374151] mb-1.5">
                Comment / Issue <span className="text-red-500">*</span>
              </label>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={4}
                placeholder="Describe the issue or suggestion..."
                className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-sm text-[#253B49] outline-none focus:border-[#253B49] transition-colors resize-none"
                autoFocus
              />
            </div>

            {/* Priority */}
            <div>
              <label className="block text-xs font-semibold text-[#374151] mb-2">Priority</label>
              <div className="flex gap-2">
                {(['low', 'medium', 'high'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className="flex-1 py-2 rounded-lg border-2 text-xs font-semibold capitalize transition-all"
                    style={{
                      borderColor: priority === p ? (p === 'high' ? '#ef4444' : p === 'medium' ? '#f59e0b' : '#6b7280') : '#e5e7eb',
                      background: priority === p ? (p === 'high' ? '#fef2f2' : p === 'medium' ? '#fffbeb' : '#f9fafb') : 'white',
                      color: priority === p ? (p === 'high' ? '#b91c1c' : p === 'medium' ? '#92400e' : '#374151') : '#9ca3af',
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600">{error}</div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-lg border border-[#e5e7eb] text-sm font-semibold text-[#6b7280] hover:bg-[#f5f5f7] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                style={{ background: '#253B49', color: 'white' }}
              >
                {submitting ? 'Submitting…' : 'Submit Feedback'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
