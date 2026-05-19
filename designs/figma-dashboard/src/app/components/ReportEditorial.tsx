/**
 * ReportEditorial.tsx
 * Full-screen editorial review tool for published report HTML.
 *
 * Layout: fixed overlay — editor (left flex-1) + annotations sidebar (right w-80)
 * Engine: contenteditable + browser Selection API (preserves full report HTML structure)
 * Annotations: inline (text selection → bubble → comment) + document (sidebar button)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, MessageSquare, CheckCircle2, XCircle, Sparkles,
  Loader2, AlertCircle, Save, Plus, RotateCcw, BarChart2,
} from 'lucide-react';
import { AUTH_HEADER } from '../api/client';

const API = '';

// ── Types ────────────────────────────────────────────────────────────────────

interface Annotation {
  id: number;
  report_id: number;
  scope: string;           // 'inline' | 'document'
  selected_text: string | null;
  comment: string;
  status: string;          // 'open' | 'addressed' | 'dismissed'
  proposed_rewrite: string | null;
  created_by: string;
  created_at: string;
}

interface ChartSource {
  id: number;
  label: string;
  chart_type: string;
  x_key: string;
  y_key: string;
  query_result: string;
}

interface BubbleState {
  visible: boolean;
  x: number;
  y: number;
  commentMode: boolean;
  commentDraft: string;
}

interface Props {
  reportId: number;
  reportTitle: string;
  publishedHtml: string;
  citationStyle?: string;
  onClose: () => void;
  onSave: (html: string) => void;
}

// ── Editor CSS injected into the contenteditable frame ────────────────────────

const EDITOR_RESET_CSS = `
  body { margin: 0; font-family: inherit; }
  .comment-mark {
    background: rgba(251, 191, 36, 0.28);
    border-bottom: 2px solid #f59e0b;
    border-radius: 2px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .comment-mark:hover { background: rgba(251, 191, 36, 0.5); }
  .comment-mark[data-status="addressed"] {
    background: rgba(16, 185, 129, 0.15);
    border-bottom-color: #10b981;
  }
  .comment-mark[data-status="dismissed"] {
    background: transparent;
    border-bottom: none;
    text-decoration: line-through;
    opacity: 0.5;
  }
`;

// ── Main component ────────────────────────────────────────────────────────────

export default function ReportEditorial({ reportId, reportTitle, publishedHtml, citationStyle, onClose, onSave }: Props) {
  const editorRef   = useRef<HTMLDivElement>(null);
  const iframeRef   = useRef<HTMLIFrameElement>(null);
  const overlayRef  = useRef<HTMLDivElement>(null);
  const savedRange  = useRef<Range | null>(null);

  const [localHtml, setLocalHtml]               = useState<string>(publishedHtml);
  const [localCitationStyle, setLocalCitationStyle] = useState<string>(citationStyle || 'superscript');
  const [iframeKey, setIframeKey]               = useState(0);

  const [annotations, setAnnotations]   = useState<Annotation[]>([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [rewriting, setRewriting]       = useState(false);
  const [addressingId, setAddressingId] = useState<number | null>(null);

  const [bubble, setBubble] = useState<BubbleState>({
    visible: false, x: 0, y: 0, commentMode: false, commentDraft: '',
  });

  const [sidebarTab, setSidebarTab]   = useState<'annotations' | 'charts'>('annotations');
  const [chartSources, setChartSources] = useState<ChartSource[]>([]);
  const [draggingOver, setDraggingOver] = useState(false);
  const dragChartHtmlRef = useRef<string>('');

  // ── Load annotations on mount ─────────────────────────────────────────────

  useEffect(() => {
    fetchAnnotations();
  }, []);

  async function fetchAnnotations() {
    setLoading(true);
    const res = await fetch(`${API}/reports/${reportId}/annotations`, { headers: AUTH_HEADER });
    if (res.ok) setAnnotations(await res.json());
    setLoading(false);
  }

  // ── Chart sources ─────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${API}/reports/${reportId}/sources`, { headers: AUTH_HEADER })
      .then(r => r.json())
      .then((all: any[]) => {
        const charts = all.filter(s =>
          s.source_type === 'db_query' &&
          s.chart_type && s.x_key && s.y_key && s.query_result
        );
        setChartSources(charts);
      })
      .catch(() => {});
  }, []);

  function generateChartHtml(src: ChartSource): string {
    let rows: any[];
    try {
      const raw = src.query_result;
      rows = ((typeof raw === 'string' ? JSON.parse(raw) : raw) || []).slice(0, 30);
    } catch { rows = []; }
    if (!rows.length) return '';
    const canvasId = `chart_drop_${src.id}_${Date.now()}`;
    const jsType = src.chart_type === 'pie' ? 'pie' : (src.chart_type === 'line' || src.chart_type === 'area' ? 'line' : 'bar');
    const showLegend = jsType === 'pie' ? 'true' : 'false';
    const scalesCfg = jsType === 'pie' ? '' : ',scales:{y:{beginAtZero:true,ticks:{font:{size:10}}},x:{ticks:{font:{size:10},maxRotation:45}}}';
    const borderWidth = jsType === 'line' ? 2 : 0;
    const lbl = (src.label || 'Data').replace(/"/g, '\\"');
    const xk = src.x_key.replace(/"/g, '\\"');
    const yk = src.y_key.replace(/"/g, '\\"');
    const colors = '["#6366F1","#10b981","#f59e0b","#EC4899","#06B6D4","#8b5cf6","#3b82f6","#ef4444","#14b8a6","#f97316"]';
    const script = `(function(){var raw=${JSON.stringify(rows)};var labels=raw.map(function(r){var v=r["${xk}"];return v!=null?String(v).slice(0,24):"";});var vals=raw.map(function(r){var v=Number(r["${yk}"]);return isNaN(v)?0:v;});var colors=${colors};var el=document.getElementById("${canvasId}");if(!el||typeof Chart==="undefined")return;new Chart(el,{type:"${jsType}",data:{labels:labels,datasets:[{label:"${lbl}",data:vals,backgroundColor:colors,borderColor:"#6366F1",borderWidth:${borderWidth},fill:false}]},options:{responsive:true,plugins:{legend:{display:${showLegend}}}${scalesCfg}}});})();`;
    const toolbar = `<div class="chart-toolbar" style="display:none;position:absolute;top:8px;right:8px;gap:4px;z-index:10;"><button class="chart-btn chart-up" title="Move up" style="background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:2px 7px;font-size:12px;cursor:pointer;color:#334155;">↑</button><button class="chart-btn chart-down" title="Move down" style="background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:2px 7px;font-size:12px;cursor:pointer;color:#334155;">↓</button><button class="chart-btn chart-remove" title="Remove" style="background:#fff;border:1px solid #fca5a5;border-radius:4px;padding:2px 7px;font-size:12px;cursor:pointer;color:#ef4444;">✕</button></div>`;
    return `<div class="chart-block" contenteditable="false" style="position:relative;margin:20px 0 24px;border:1px solid #e2e8f0;border-radius:6px;padding:16px;background:#fafafa;">${toolbar}<div style="font-family:monospace;font-size:10px;color:#787569;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">${src.label || 'Data'}</div><canvas id="${canvasId}" style="max-height:260px;width:100%;display:block;"></canvas><script>${script}</script></div>`;
  }

  function insertChartAtPoint(doc: Document, x: number, y: number) {
    const chartHtml = dragChartHtmlRef.current;
    if (!chartHtml) return;

    // Walk up from drop point to a block-level element
    const blocks = new Set(['P','H1','H2','H3','H4','DIV','SECTION','OL','UL','LI','BLOCKQUOTE']);
    let target: Element | null = doc.elementFromPoint(x, y);
    while (target && !blocks.has(target.tagName)) target = target.parentElement;
    if (!target) target = doc.body.lastElementChild;

    // Insert chart HTML (without inline script)
    const scriptMatch = chartHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    const htmlNoScript = chartHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    const wrapper = doc.createElement('div');
    wrapper.innerHTML = htmlNoScript;
    const chartNode = wrapper.firstElementChild;
    if (chartNode && target?.parentNode) {
      target.parentNode.insertBefore(chartNode, target.nextSibling);
    }

    // Run chart script — load Chart.js first if needed
    if (scriptMatch) {
      const run = () => {
        const s = doc.createElement('script');
        s.textContent = scriptMatch[1];
        doc.body.appendChild(s);
      };
      const win = iframeRef.current?.contentWindow as any;
      if (win?.Chart) { run(); }
      else {
        const loader = doc.createElement('script');
        loader.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js';
        loader.onload = run;
        doc.head.appendChild(loader);
      }
    }

    dragChartHtmlRef.current = '';
    setDraggingOver(false);
  }

  // ── Inject report HTML + reset CSS into iframe ────────────────────────────

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const htmlWithEditorCss = localHtml.replace(
      '</head>',
      `<style>${EDITOR_RESET_CSS}</style></head>`
    );
    doc.open();
    doc.write(htmlWithEditorCss);
    doc.close();

    // Make body editable
    if (doc.body) {
      doc.body.contentEditable = 'true';
      doc.body.spellcheck = false;
    }


    // Chart block toolbar — show on hover, handle remove/move clicks
    doc.addEventListener('mouseover', (e) => {
      const block = (e.target as HTMLElement).closest('.chart-block') as HTMLElement | null;
      if (block) {
        const tb = block.querySelector<HTMLElement>('.chart-toolbar');
        if (tb) tb.style.display = 'flex';
      }
    });
    doc.addEventListener('mouseout', (e) => {
      const block = (e.target as HTMLElement).closest('.chart-block') as HTMLElement | null;
      if (block && !block.contains(e.relatedTarget as Node)) {
        const tb = block.querySelector<HTMLElement>('.chart-toolbar');
        if (tb) tb.style.display = 'none';
      }
    });
    doc.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.chart-btn') as HTMLElement | null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const block = btn.closest('.chart-block') as HTMLElement | null;
      if (!block) return;
      if (btn.classList.contains('chart-remove')) {
        block.remove();
      } else if (btn.classList.contains('chart-up')) {
        const prev = block.previousElementSibling;
        if (prev) block.parentNode!.insertBefore(block, prev);
      } else if (btn.classList.contains('chart-down')) {
        const next = block.nextElementSibling;
        if (next) block.parentNode!.insertBefore(next, block);
      }
    });

    // Intercept link clicks — contentEditable blocks native navigation
    const handleLinkClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest('a');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) {
        // In-page anchor (inline citation → bibliography entry)
        const target = doc.querySelector(href);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      } else if (href) {
        // External URL → open in new tab
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    };
    doc.addEventListener('click', handleLinkClick);

    // Listen for selections inside the iframe
    const handleSelectionChange = () => {
      const sel = doc.getSelection();
      if (!sel || sel.isCollapsed || sel.toString().trim() === '') {
        // Don't hide immediately — user may be clicking the bubble
        return;
      }
      const range = sel.getRangeAt(0);
      savedRange.current = range.cloneRange();
      const rect = range.getBoundingClientRect();
      const iframeRect = iframe.getBoundingClientRect();

      setBubble(prev => ({
        ...prev,
        visible: true,
        commentMode: false,
        commentDraft: '',
        x: iframeRect.left + rect.left + rect.width / 2,
        y: iframeRect.top + rect.top - 8,
      }));
    };

    doc.addEventListener('selectionchange', handleSelectionChange);
    // Click anywhere clears bubble if not in comment mode
    doc.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-bubble]')) {
        setBubble(prev => ({ ...prev, visible: false, commentMode: false, commentDraft: '' }));
      }
    });

    return () => {
      doc.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [localHtml]);

  // ── Apply comment marks to editor based on open annotations ──────────────

  const applyMarks = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    // Remove all existing marks first
    doc.querySelectorAll('.comment-mark').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(doc.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    });

    // Apply marks for open/addressed annotations that have selected_text
    annotations
      .filter(a => a.selected_text && a.status !== 'dismissed')
      .forEach(ann => {
        try {
          markText(doc, ann.selected_text!, ann.id, ann.status);
        } catch (e) {
          // Silently skip — text may have been edited away
        }
      });
  }, [annotations]);

  useEffect(() => { applyMarks(); }, [applyMarks]);

  // ── Text marking helper ───────────────────────────────────────────────────

  function markText(doc: Document, text: string, annId: number, status: string) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const idx = node.textContent?.indexOf(text);
      if (idx !== undefined && idx >= 0 && node.parentElement?.tagName !== 'MARK') {
        const range = doc.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + text.length);
        const mark = doc.createElement('mark');
        mark.className = 'comment-mark';
        mark.dataset.commentId = String(annId);
        mark.dataset.status = status;
        try {
          range.surroundContents(mark);
        } catch (e) {
          // Cross-node selection — skip visual mark, annotation still in sidebar
        }
        return; // Only mark first occurrence
      }
    }
  }

  // ── Add inline comment ────────────────────────────────────────────────────

  async function addInlineComment() {
    const range = savedRange.current;
    const text = range ? range.toString().trim() : '';
    if (!bubble.commentDraft.trim()) return;

    setBubble(prev => ({ ...prev, visible: false, commentMode: false, commentDraft: '' }));

    const res = await fetch(`${API}/reports/${reportId}/annotations`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'inline',
        selected_text: text || null,
        comment: bubble.commentDraft.trim(),
      }),
    });
    if (res.ok) {
      const ann = await res.json();
      setAnnotations(prev => [...prev, ann]);
    }
  }

  // ── Add document-level comment ────────────────────────────────────────────

  const [docCommentDraft, setDocCommentDraft] = useState('');
  const [addingDocComment, setAddingDocComment] = useState(false);
  const [showDocInput, setShowDocInput] = useState(false);

  async function addDocumentComment() {
    if (!docCommentDraft.trim()) return;
    setAddingDocComment(true);
    const res = await fetch(`${API}/reports/${reportId}/annotations`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'document',
        selected_text: null,
        comment: docCommentDraft.trim(),
      }),
    });
    if (res.ok) {
      const ann = await res.json();
      setAnnotations(prev => [...prev, ann]);
      setDocCommentDraft('');
      setShowDocInput(false);
    }
    setAddingDocComment(false);
  }

  // ── Address annotation via LLM ────────────────────────────────────────────

  async function addressAnnotation(annId: number) {
    setAddressingId(annId);
    const res = await fetch(`${API}/reports/${reportId}/annotations/${annId}/address`, {
      method: 'POST',
      headers: AUTH_HEADER,
    });
    if (res.ok) {
      const data = await res.json();
      setAnnotations(prev => prev.map(a => a.id === annId ? data.annotation : a));
    }
    setAddressingId(null);
  }

  // ── Apply rewrite to editor ───────────────────────────────────────────────

  function applyRewrite(ann: Annotation) {
    if (!ann.selected_text || !ann.proposed_rewrite) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    // Find mark with this annotation id
    const mark = doc.querySelector(`.comment-mark[data-comment-id="${ann.id}"]`);
    if (mark) {
      const textNode = doc.createTextNode(ann.proposed_rewrite);
      mark.parentNode?.replaceChild(textNode, mark);
      return;
    }

    // Fallback: find the raw text and replace first occurrence
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const idx = node.textContent?.indexOf(ann.selected_text);
      if (idx !== undefined && idx >= 0) {
        const newText = node.textContent!.slice(0, idx) + ann.proposed_rewrite + node.textContent!.slice(idx + ann.selected_text.length);
        node.textContent = newText;
        break;
      }
    }

    // Mark annotation as addressed
    dismissAnnotation(ann.id, 'addressed');
  }

  // ── Dismiss/approve annotation ────────────────────────────────────────────

  async function dismissAnnotation(annId: number, status: 'addressed' | 'dismissed') {
    const res = await fetch(`${API}/reports/${reportId}/annotations/${annId}`, {
      method: 'PATCH',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated = await res.json();
      setAnnotations(prev => prev.map(a => a.id === annId ? updated : a));
    }
  }

  async function deleteAnnotation(annId: number) {
    await fetch(`${API}/reports/${reportId}/annotations/${annId}`, {
      method: 'DELETE',
      headers: AUTH_HEADER,
    });
    setAnnotations(prev => prev.filter(a => a.id !== annId));
  }

  // ── Address all open annotations ──────────────────────────────────────────

  async function addressAll() {
    const open = annotations.filter(a => a.status === 'open');
    for (const ann of open) {
      await addressAnnotation(ann.id);
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // ── Rewrite document via tone/audience pass ───────────────────────────────

  async function rewriteDocument() {
    setRewriting(true);
    await fetch(`${API}/reports/${reportId}/rewrite`, { method: 'POST', headers: AUTH_HEADER });
    // Poll until done
    let tries = 0;
    const poll = async () => {
      const res = await fetch(`${API}/reports/${reportId}`, { headers: AUTH_HEADER });
      if (res.ok) {
        const data = await res.json();
        if (data.status !== 'generating' || tries > 60) {
          if (data.published_html) {
            setLocalHtml(data.published_html);
            setIframeKey(k => k + 1);
          }
          setRewriting(false);
          return;
        }
      }
      tries++;
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 3000);
  }

  // ── Save draft — strip marks, PATCH published_html ────────────────────────

  async function saveDraft() {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    setSaving(true);

    // Clone body, strip all comment marks to recover clean text
    const clone = doc.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.comment-mark').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(doc.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    });
    clone.removeAttribute('contenteditable');

    const cleanHtml = localHtml.replace(
      /<body[^>]*>[\s\S]*<\/body>/i,
      `<body>${clone.innerHTML}</body>`
    );

    const res = await fetch(`${API}/reports/${reportId}`, {
      method: 'PATCH',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ published_html: cleanHtml }),
    });
    if (res.ok) {
      onSave(cleanHtml);
    }
    setSaving(false);
  }

  // ── Counts ────────────────────────────────────────────────────────────────

  const openCount      = annotations.filter(a => a.status === 'open').length;
  const addressedCount = annotations.filter(a => a.status === 'addressed').length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex bg-[#f8f9fa]" style={{ fontFamily: 'Inter, sans-serif' }}>

      {/* ── Selection bubble ──────────────────────────────────────────────── */}
      {bubble.visible && (
        <div
          data-bubble="true"
          className="fixed z-[60] pointer-events-auto"
          style={{
            left: bubble.x,
            top: bubble.y,
            transform: 'translate(-50%, -100%)',
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          {!bubble.commentMode ? (
            <button
              onClick={() => setBubble(prev => ({ ...prev, commentMode: true }))}
              className="flex items-center gap-1.5 bg-[#1e293b] text-[#f59e0b] text-xs font-semibold px-3 py-1.5 rounded shadow-lg hover:bg-[#334155] transition-colors"
            >
              <MessageSquare className="w-3 h-3" /> Comment
            </button>
          ) : (
            <div className="bg-white border border-slate-200 rounded shadow-xl p-3 w-64 space-y-2">
              <textarea
                autoFocus
                value={bubble.commentDraft}
                onChange={e => setBubble(prev => ({ ...prev, commentDraft: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addInlineComment(); } if (e.key === 'Escape') setBubble(prev => ({ ...prev, visible: false, commentMode: false, commentDraft: '' })); }}
                placeholder="Add a comment or instruction for the editor..."
                rows={3}
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-[#f8f9fa] focus:outline-none focus:border-slate-400 resize-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#787569]">↵ to submit · Esc to cancel</span>
                <button
                  onClick={addInlineComment}
                  disabled={!bubble.commentDraft.trim()}
                  className="text-xs bg-[#1e293b] text-white rounded px-2.5 py-1 font-medium disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Editor panel ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Editor toolbar */}
        <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="text-[#787569] hover:text-slate-700 p-1 rounded hover:bg-slate-100">
              <X className="w-4 h-4" />
            </button>
            <div>
              <p className="text-sm font-bold text-[#1e293b] leading-tight">Editorial</p>
              <p className="text-[10px] text-[#787569]">{reportTitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#787569]">Select text to comment · Click a mark to see it in the sidebar</span>
            <select
              value={localCitationStyle}
              onChange={async (e) => {
                const style = e.target.value;
                setLocalCitationStyle(style);
                await fetch(`${API}/reports/${reportId}`, {
                  method: 'PATCH',
                  headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ citation_style: style }),
                });
                const res = await fetch(`${API}/reports/${reportId}/reformat`, {
                  method: 'POST',
                  headers: AUTH_HEADER,
                });
                if (res.ok) {
                  const data = await res.json();
                  if (data.published_html) {
                    setLocalHtml(data.published_html);
                    setIframeKey(k => k + 1);   // force full iframe remount
                  }
                }
              }}
              className="text-xs border border-slate-200 rounded px-2 py-1.5 bg-white text-[#33322c] focus:outline-none cursor-pointer"
            >
              <option value="superscript">Superscript [N]</option>
              <option value="chicago">Chicago</option>
              <option value="ieee">IEEE [N]</option>
              <option value="mla">MLA Works Cited</option>
            </select>
            <button
              onClick={rewriteDocument}
              disabled={rewriting || saving}
              title="Apply current audience + tone settings to all sections via voice pass"
              className="flex items-center gap-1.5 text-xs border border-violet-300 text-violet-700 bg-violet-50 rounded px-3 py-1.5 font-medium disabled:opacity-50 hover:bg-violet-100 transition-colors"
            >
              {rewriting ? <><Loader2 className="w-3 h-3 animate-spin" /> Rewriting...</> : <><Sparkles className="w-3 h-3" /> Rewrite</>}
            </button>
            <button
              onClick={saveDraft}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs bg-[#1e293b] text-white rounded px-3 py-1.5 font-medium disabled:opacity-50 hover:bg-[#334155] transition-colors"
            >
              {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</> : <><Save className="w-3 h-3" /> Save Draft</>}
            </button>
          </div>
        </div>

        {/* Editable iframe — key forces full remount on citation style change */}
        <div className="flex-1 relative min-h-0">
          <iframe
            key={iframeKey}
            ref={iframeRef}
            className={`w-full h-full border-0 bg-white transition-all ${draggingOver ? 'ring-2 ring-inset ring-indigo-400' : ''}`}
            title="Editorial editor"
            sandbox="allow-same-origin allow-scripts allow-popups"
          />
          {/* Always in DOM — pointer-events toggled synchronously via ref on dragstart/dragend */}
          <div
            ref={overlayRef}
            className="absolute inset-0 z-10"
            style={{ pointerEvents: 'none' }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDraggingOver(true); }}
            onDragLeave={() => setDraggingOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDraggingOver(false);
              if (overlayRef.current) overlayRef.current.style.pointerEvents = 'none';
              const iframe = iframeRef.current;
              if (!iframe?.contentDocument) return;
              const rect = iframe.getBoundingClientRect();
              insertChartAtPoint(iframe.contentDocument, e.clientX - rect.left, e.clientY - rect.top);
            }}
          />
        </div>
      </div>

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <div className="w-80 shrink-0 flex flex-col bg-white border-l border-slate-200">

        {/* Tab bar */}
        <div className="flex border-b border-slate-200 shrink-0">
          <button
            onClick={() => setSidebarTab('annotations')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
              sidebarTab === 'annotations'
                ? 'text-[#1e293b] border-b-2 border-[#1e293b]'
                : 'text-[#787569] hover:text-[#334155]'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Annotations
            {openCount > 0 && (
              <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-1.5 font-mono">{openCount}</span>
            )}
          </button>
          <button
            onClick={() => setSidebarTab('charts')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
              sidebarTab === 'charts'
                ? 'text-[#1e293b] border-b-2 border-[#1e293b]'
                : 'text-[#787569] hover:text-[#334155]'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            Charts
            {chartSources.length > 0 && (
              <span className="text-[10px] bg-indigo-100 text-indigo-700 rounded-full px-1.5 font-mono">{chartSources.length}</span>
            )}
          </button>
        </div>

        {/* ── Annotations tab ────────────────────────────────────────────── */}
        {sidebarTab === 'annotations' && (
          <>
            <div className="px-4 py-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {addressedCount > 0 && (
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 rounded-full px-1.5 py-0.5 font-mono font-medium">
                      {addressedCount} done
                    </span>
                  )}
                </div>
                {openCount > 1 && (
                  <button
                    onClick={addressAll}
                    disabled={addressingId !== null}
                    className="text-[10px] text-[#545249] border border-slate-200 rounded px-2 py-0.5 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" /> Address All
                  </button>
                )}
              </div>
              {!showDocInput ? (
                <button
                  onClick={() => setShowDocInput(true)}
                  className="w-full flex items-center gap-1.5 text-[10px] text-[#545249] border border-dashed border-slate-300 rounded px-2.5 py-1.5 hover:bg-slate-50 transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add document comment
                </button>
              ) : (
                <div className="space-y-1.5">
                  <textarea
                    autoFocus
                    value={docCommentDraft}
                    onChange={e => setDocCommentDraft(e.target.value)}
                    placeholder="Document-level comment or instruction..."
                    rows={2}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-[#f8f9fa] focus:outline-none focus:border-slate-400 resize-none"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={addDocumentComment}
                      disabled={addingDocComment || !docCommentDraft.trim()}
                      className="text-xs bg-[#1e293b] text-white rounded px-2.5 py-1 font-medium disabled:opacity-40"
                    >
                      {addingDocComment ? 'Adding...' : 'Add'}
                    </button>
                    <button onClick={() => { setShowDocInput(false); setDocCommentDraft(''); }}
                      className="text-xs text-[#787569] hover:text-slate-700 px-1">Cancel</button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-[#787569]" />
                </div>
              ) : annotations.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <MessageSquare className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs text-[#787569]">No annotations yet</p>
                  <p className="text-[10px] text-[#787569] mt-1">Select text in the editor to add a comment</p>
                </div>
              ) : (
                annotations.map(ann => (
                  <AnnotationCard
                    key={ann.id}
                    ann={ann}
                    addressing={addressingId === ann.id}
                    onAddress={() => addressAnnotation(ann.id)}
                    onApplyRewrite={() => applyRewrite(ann)}
                    onDismiss={() => dismissAnnotation(ann.id, 'dismissed')}
                    onDelete={() => deleteAnnotation(ann.id)}
                  />
                ))
              )}
            </div>
          </>
        )}

        {/* ── Charts tab ──────────────────────────────────────────────────── */}
        {sidebarTab === 'charts' && (
          <div className="flex-1 overflow-y-auto">
            {chartSources.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <BarChart2 className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-[#787569]">No chart sources yet</p>
                <p className="text-[10px] text-[#787569] mt-1">
                  Use the Data Explorer to suggest and add data sources to your report. Chart sources will appear here to drag into the document.
                </p>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                <p className="text-[10px] text-[#787569] px-1 pb-1">Drag a chart into the document to insert it at that position.</p>
                {chartSources.map(src => (
                  <div
                    key={src.id}
                    draggable
                    onDragStart={(e) => {
                      dragChartHtmlRef.current = generateChartHtml(src);
                      e.dataTransfer.setData('text/plain', src.label || 'chart');
                      e.dataTransfer.effectAllowed = 'copy';
                      if (overlayRef.current) overlayRef.current.style.pointerEvents = 'auto';
                    }}
                    onDragEnd={() => {
                      if (overlayRef.current) overlayRef.current.style.pointerEvents = 'none';
                      setDraggingOver(false);
                    }}
                    className="flex items-start gap-2 px-3 py-2.5 bg-white border border-slate-200 rounded-md cursor-grab active:cursor-grabbing hover:border-indigo-300 hover:bg-indigo-50 transition-colors select-none"
                  >
                    <BarChart2 className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#33322c] leading-tight truncate">{src.label || 'Untitled Chart'}</p>
                      <p className="text-[10px] text-[#787569] mt-0.5 capitalize">{src.chart_type} · {src.x_key} / {src.y_key}</p>
                    </div>
                    <span className="text-[10px] text-indigo-400 shrink-0 mt-0.5">⠿ drag</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// ── AnnotationCard ────────────────────────────────────────────────────────────

function AnnotationCard({ ann, addressing, onAddress, onApplyRewrite, onDismiss, onDelete }: {
  ann: Annotation;
  addressing: boolean;
  onAddress: () => void;
  onApplyRewrite: () => void;
  onDismiss: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(ann.status === 'open');

  const borderColor =
    ann.status === 'addressed' ? 'border-emerald-300' :
    ann.status === 'dismissed' ? 'border-slate-200 opacity-50' :
    'border-amber-300';

  const bgColor =
    ann.status === 'addressed' ? 'bg-emerald-50' :
    ann.status === 'dismissed' ? 'bg-slate-50' :
    'bg-amber-50';

  return (
    <div className={`px-3 py-3 border-l-2 ${borderColor} ${bgColor} transition-colors`}>
      {/* Scope + status badge */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-bold uppercase tracking-widest ${
            ann.scope === 'document' ? 'text-violet-600' : 'text-amber-700'
          }`}>
            {ann.scope === 'document' ? 'Document' : 'Inline'}
          </span>
          {ann.status === 'addressed' && (
            <span className="flex items-center gap-0.5 text-[10px] text-emerald-700 font-medium">
              <CheckCircle2 className="w-3 h-3" /> Addressed
            </span>
          )}
          {ann.status === 'dismissed' && (
            <span className="text-[10px] text-[#787569]">Dismissed</span>
          )}
        </div>
        <button onClick={onDelete} className="text-slate-400 hover:text-red-500 p-0.5 rounded">
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Selected text */}
      {ann.selected_text && (
        <div className="bg-white border border-amber-200 rounded px-2 py-1 mb-1.5">
          <p className="text-[10px] text-[#33322c] italic line-clamp-2">"{ann.selected_text}"</p>
        </div>
      )}

      {/* Comment */}
      <p className="text-xs text-[#33322c] leading-relaxed mb-2">{ann.comment}</p>

      {/* Proposed rewrite */}
      {ann.proposed_rewrite && (
        <div className="bg-white border border-emerald-200 rounded px-2.5 py-2 mb-2 space-y-1.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="w-3 h-3 text-emerald-600" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Proposed</span>
          </div>
          <p className="text-xs text-[#33322c] leading-relaxed">{ann.proposed_rewrite}</p>
          {ann.scope === 'inline' && ann.selected_text && (
            <button
              onClick={onApplyRewrite}
              className="flex items-center gap-1 text-[10px] bg-emerald-600 text-white rounded px-2 py-0.5 font-medium hover:bg-emerald-700 transition-colors"
            >
              <RotateCcw className="w-2.5 h-2.5" /> Apply
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      {ann.status === 'open' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={onAddress}
            disabled={addressing}
            className="flex items-center gap-1 text-[10px] border border-amber-300 text-amber-700 bg-white rounded px-2 py-0.5 font-medium hover:bg-amber-50 disabled:opacity-40 transition-colors"
          >
            {addressing
              ? <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Asking LLM...</>
              : <><Sparkles className="w-2.5 h-2.5" /> Address</>}
          </button>
          <button
            onClick={onDismiss}
            className="flex items-center gap-1 text-[10px] text-[#787569] hover:text-slate-700 border border-slate-200 bg-white rounded px-2 py-0.5 transition-colors"
          >
            <XCircle className="w-2.5 h-2.5" /> Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
