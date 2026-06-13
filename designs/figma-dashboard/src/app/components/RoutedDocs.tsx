import { useState, useEffect } from 'react';
import { Sparkles, FileText } from 'lucide-react';
import { AUTH_HEADER } from '../api/client';
import { DocModal, docLabel, type DocDetail } from '../pages/TerminalPage';

// Docs the ingestion classifier routed to a given tab. Surfaced on each
// destination page so a user's ingested Drive docs show up where that kind of
// data lives — not just in My Terminal.

interface RoutedDoc {
  id: number;
  filename: string;
  doc_type: string;
  summary: string;
  conversion: string;
  target_reason?: string;
  ingested_at: string;
}

const TAB_TITLE: Record<string, string> = {
  home: 'My Desk', ventures: 'Ventures', partners: 'Partners',
  sales: 'Sales', requests: 'Requests',
};

export function RoutedDocs({ tab }: { tab: string }) {
  const [docs, setDocs] = useState<RoutedDoc[]>([]);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/terminal/routed?tab=${encodeURIComponent(tab)}`, { headers: AUTH_HEADER });
        if (alive && res.ok) setDocs((await res.json()).documents ?? []);
      } catch { /* ignore — panel just stays hidden */ }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, [tab]);

  async function openDoc(id: number) {
    try {
      const res = await fetch(`/terminal/documents/${id}`, { headers: AUTH_HEADER });
      if (res.ok) setDetail(await res.json());
    } catch { /* ignore */ }
  }

  // Stay invisible until we know there's something routed here — no empty boxes.
  if (!loaded || docs.length === 0) return null;

  return (
    <section className="max-w-[1400px] mx-auto px-4 md:px-6 mt-4">
      <div className="border border-[#e8e2d6] rounded-lg bg-gradient-to-br from-[#f8f6f0] to-[#f4f1e9] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#e8e2d6]">
          <Sparkles className="w-3.5 h-3.5 text-[#8a7200]" />
          <span className="text-xs font-bold uppercase tracking-widest text-[#787569]">
            From your Terminal — routed to {TAB_TITLE[tab] ?? tab}
          </span>
          <span className="ml-auto text-[10px] bg-white/70 text-[#545249] rounded px-1.5 py-0.5 font-mono">{docs.length}</span>
        </div>
        <div className="flex gap-3 overflow-x-auto p-3">
          {docs.map(d => (
            <button key={d.id} onClick={() => openDoc(d.id)}
              title={d.target_reason || undefined}
              className="shrink-0 w-64 text-left bg-white border border-slate-200 rounded-lg p-3 hover:border-[#8a7200] hover:shadow-sm transition-all">
              <div className="flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-[#787569] shrink-0" />
                <span className="text-xs font-medium text-[#33322c] truncate">{d.filename}</span>
              </div>
              <p className="text-[11px] text-[#787569] mt-1 line-clamp-2 leading-snug">{d.summary}</p>
              <span className="text-[9px] font-medium text-emerald-700 bg-emerald-100 border border-emerald-200 rounded px-1 py-0.5 mt-1.5 inline-block">{docLabel(d.doc_type)}</span>
            </button>
          ))}
        </div>
      </div>
      {detail && <DocModal doc={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}
