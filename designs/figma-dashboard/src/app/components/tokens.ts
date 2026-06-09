/**
 * Plug and Play Vertical OS — Design System Tokens
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MASTER SWITCH: Edit here to update the entire platform.
 *
 * All 18 pages import { cls } from this file.
 * Change a value → rebuild → every page updates.
 *
 * Tailwind token utilities (defined in tailwind.css @theme):
 *   bg-linen         = #FAF9F6   page background
 *   text-cvc-slate   = #1e293b   primary headings / dark surfaces
 *   bg-cvc-slate     = #1e293b   dark button fill
 *   text-cvc-gold    = #F59E0B   amber accent text
 *   bg-cvc-gold      = #F59E0B   amber accent fill
 *   border-cvc-gold  = #F59E0B   amber accent border
 *   shadow-cvc               soft 2-layer gallery elevation
 *   shadow-cvc-hover         elevated shadow on hover
 */

// ── Color palette (reference values) ─────────────────────────────────────────

export const palette = {
  linen:      '#FAF9F6',  // page background
  white:      '#ffffff',  // card background
  slate800:   '#1E293B',  // primary text / dark surfaces (cvc-slate)
  slate700:   '#334155',  // section headings
  slate600:   '#475569',  // secondary text
  slate500:   '#64748b',  // muted / meta text
  slate400:   '#94a3b8',  // placeholder / faint
  slate200:   '#e2e8f0',  // card borders
  slate50:    '#F8FAFC',  // data area backgrounds
  gold:       '#F59E0B',  // brand accent (cvc-gold)
  goldDark:   '#92400e',  // amber text on light backgrounds
  darkest:    '#151411',  // navbar near-black
  success:    '#10b981',
  danger:     '#ef4444',
  dangerBg:   '#fee2e2',
  dangerText: '#991b1b',
  warningBg:  '#fffbeb',
  warningText:'#92400e',
} as const;

// ── Industrial Neon chart scale ───────────────────────────────────────────────
// Use chartScale for new donut/area charts (indigo → pink → cyan → amber)
// Use chartColors for recharts sector-keyed lookups

export const chartScale = {
  primary:   '#6366F1',  // indigo
  secondary: '#EC4899',  // pink
  tertiary:  '#06B6D4',  // cyan
  highlight: '#F59E0B',  // amber
  violet:    '#8b5cf6',
  emerald:   '#10b981',
  orange:    '#f97316',
  blue:      '#3b82f6',
} as const;

export const chartColors: Record<string, string> = {
  'Supply Chain':          '#6366F1',
  'Robotics':              '#EC4899',
  'Manufacturing':         '#06B6D4',
  'Industrial Automation': '#F59E0B',
  'Physical AI':           '#8b5cf6',
  'Logistics':             '#10b981',
  'AI/ML':                 '#f97316',
  'Energy':                '#3b82f6',
  'Health':                '#EC4899',
  'Fintech':               '#06B6D4',
  'Aerospace & Defense':   '#64748b',
  'Unclassified':          '#94a3b8',
};

export const chartFallbacks = [
  '#6366F1', '#EC4899', '#06B6D4', '#F59E0B',
  '#8b5cf6', '#10b981', '#f97316', '#3b82f6',
  '#64748b', '#94a3b8',
];

// ── Shared className strings ──────────────────────────────────────────────────

export const cls = {

  // ── Page shell ──────────────────────────────────────────────────────────────
  // Note: padding/max-width live in each page's inner container, not here.
  page: 'min-h-screen bg-linen text-slate-900 font-sans',

  // ── Cards ───────────────────────────────────────────────────────────────────
  // card        — bare container (you add padding in the page)
  // cardPadded  — card + p-6 (most common)
  // subcard     — nested inner card, no shadow
  card:       'bg-white border border-slate-200 rounded-xl shadow-cvc transition-all hover:shadow-md',
  cardPadded: 'bg-white border border-slate-200 rounded-xl shadow-cvc transition-all hover:shadow-md p-6',
  subcard:    'bg-white border border-slate-200 rounded-xl p-4',
  subcardSm:  'bg-white border border-slate-200 rounded-xl p-3',

  // ── Data containers ─────────────────────────────────────────────────────────
  // For "Sectors of Interest" boxes, stats panels, info blocks
  dataArea: 'bg-[#F8FAFC] border border-slate-200 rounded-lg p-4',

  // ── Active state ─────────────────────────────────────────────────────────────
  // Apply to the active list/sidebar item — brand accent left border, white bg
  activeItem: 'bg-white border-l-4 border-cvc-gold shadow-sm',

  // ── Typography ──────────────────────────────────────────────────────────────
  // Change pageTitle here → all page h1s update at once
  pageTitle:    'text-2xl md:text-3xl font-extrabold tracking-tight text-[#1E293B]',
  sectionTitle: 'text-lg font-bold text-[#334155]',
  cardTitle:    'text-base font-semibold text-[#1E293B]',
  reportTitle:  'text-2xl md:text-3xl font-extrabold tracking-tight text-[#1E293B]',  // page compat

  // Metadata / technical labels — monospace all-caps for precision-tool feel
  meta:    'font-mono text-[10px] uppercase tracking-widest text-slate-500 font-bold',
  eyebrow: 'font-mono text-[10px] uppercase tracking-widest text-slate-400 font-bold',
  label:   'font-mono text-xs uppercase tracking-widest text-slate-600 font-semibold',

  // Body copy
  body:  'text-sm text-[#1E293B]',
  muted: 'text-sm text-slate-600',
  faint: 'text-xs text-slate-500',

  // ── Inputs ──────────────────────────────────────────────────────────────────
  // Warm parchment bg creates contrast against white card panels
  input:     'bg-[#ede8d7] border border-slate-400 rounded-lg px-3 py-2 text-sm text-[#1E293B] focus:outline-none focus:ring-1 focus:ring-[#1E293B] font-[inherit]',
  inputFull: 'w-full bg-[#ede8d7] border border-slate-400 rounded-lg px-3 py-2 text-sm text-[#1E293B] focus:outline-none focus:ring-1 focus:ring-[#1E293B] font-[inherit]',
  select:    'bg-[#ede8d7] border border-slate-400 rounded-lg px-3 py-2 text-sm text-[#1E293B] focus:outline-none focus:ring-1 focus:ring-[#1E293B] font-[inherit]',

  // ── Buttons ─────────────────────────────────────────────────────────────────
  buttonPrimary: 'bg-[#1E293B] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-800 transition-colors shadow-sm',
  btnPrimary:    'bg-[#1E293B] text-cvc-gold px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#151411] transition-colors shadow-sm font-[inherit]',
  btnSecondary:  'border border-slate-200 text-[#1E293B] rounded-lg px-4 py-2 text-sm font-medium hover:bg-linen transition-colors font-[inherit]',
  btnOutline:    'border border-[#1E293B] text-[#1E293B] rounded-lg px-4 py-2 text-sm font-medium hover:bg-linen transition-colors font-[inherit]',

  // ── Dividers ────────────────────────────────────────────────────────────────
  reportDivider: 'border-b-2 border-[#1E293B] pb-5 mb-6',

  // ── Hover ───────────────────────────────────────────────────────────────────
  hoverBg: 'hover:bg-linen',

} as const;
