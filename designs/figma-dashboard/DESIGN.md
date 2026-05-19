# CVC Intelligence — Design System

**Canonical reference for the platform's visual language.**

`tokens.ts` is the single source of truth for all className strings and color values. This document mirrors it exactly. If you are a design agent, Claude Code session, or human contributor: **tokens.ts and this file must always agree**. When one changes, update the other.

---

## How the System Works

All 18 pages import from one file:

```ts
import { cls } from '../components/tokens';
// then use cls.card, cls.pageTitle, cls.btnPrimary, etc.
```

The `cls` object contains Tailwind className strings. Changing a value in `tokens.ts` and rebuilding updates every page that references it.

**Tailwind v4** — there is no `tailwind.config.js`. Custom design tokens are registered in `src/styles/tailwind.css` under `@theme {}` and become usable as Tailwind utilities:

```css
@theme {
  --color-linen:      #FAF9F6;
  --color-cvc-gold:   #F59E0B;
  --color-cvc-slate:  #1e293b;
  --shadow-cvc:       0 1px 2px 0 rgb(0 0 0 / 0.04), 0 4px 16px 0 rgb(0 0 0 / 0.06);
  --shadow-cvc-hover: 0 2px 4px 0 rgb(0 0 0 / 0.06), 0 8px 24px 0 rgb(0 0 0 / 0.08);
}
```

These become: `bg-linen`, `text-cvc-gold`, `bg-cvc-gold`, `border-cvc-gold`, `text-cvc-slate`, `bg-cvc-slate`, `shadow-cvc`, `shadow-cvc-hover`.

---

## Color Palette

Full reference — every value defined in `tokens.ts` → `palette`.

| Token | Hex | Usage |
|---|---|---|
| `linen` | `#FAF9F6` | Page background (`bg-linen`) |
| `white` | `#FFFFFF` | Card / surface background |
| `slate800` | `#1E293B` | Primary text, dark surfaces (`text-cvc-slate`, `bg-cvc-slate`) |
| `slate700` | `#334155` | Section headings |
| `slate600` | `#475569` | Secondary text |
| `slate500` | `#64748b` | Muted / meta text |
| `slate400` | `#94a3b8` | Placeholder / faint |
| `slate200` | `#e2e8f0` | Card borders, dividers |
| `slate50` | `#F8FAFC` | Data area backgrounds |
| `gold` | `#F59E0B` | CVC Gold — primary accent (`text-cvc-gold`, `bg-cvc-gold`, `border-cvc-gold`) |
| `goldDark` | `#92400e` | Amber text on light backgrounds |
| `darkest` | `#151411` | Navbar near-black |
| `success` | `#10b981` | Success states |
| `danger` | `#ef4444` | Error / destructive states |
| `dangerBg` | `#fee2e2` | Error background tint |
| `dangerText` | `#991b1b` | Error text on danger bg |
| `warningBg` | `#fffbeb` | Warning background tint |
| `warningText` | `#92400e` | Warning text on warning bg |

---

## Surface Hierarchy

Five levels of depth — never skip a level or blend surfaces:

| Level | Token | Classes | Use case |
|---|---|---|---|
| 1 — Page | `cls.page` | `bg-linen` | Full-page wrapper |
| 2 — Card | `cls.card` / `cls.cardPadded` | `bg-white border-slate-200 shadow-cvc` | Primary content containers |
| 3 — Subcard | `cls.subcard` / `cls.subcardSm` | `bg-white border-slate-200` (no shadow) | Nested containers within cards |
| 4 — Data area | `cls.dataArea` | `bg-[#F8FAFC] border-slate-200` | Stats panels, info blocks, read-only data |
| 5 — Inputs | `cls.input` / `cls.inputFull` | `bg-[#ede8d7]` | Warm parchment creates contrast against white card |

---

## Component Class Tokens

Exact strings from `tokens.ts` → `cls`. **Do not rewrite these inline — use the token.**

### Page Shell

```
cls.page = 'min-h-screen bg-linen text-slate-900 font-sans'
```

Padding and max-width live in each page's inner container, not on `cls.page`.

### Cards

```
cls.card       = 'bg-white border border-slate-200 rounded-xl shadow-cvc transition-all hover:shadow-md'
cls.cardPadded = 'bg-white border border-slate-200 rounded-xl shadow-cvc transition-all hover:shadow-md p-6'
cls.subcard    = 'bg-white border border-slate-200 rounded-xl p-4'
cls.subcardSm  = 'bg-white border border-slate-200 rounded-xl p-3'
```

### Data Containers

```
cls.dataArea = 'bg-[#F8FAFC] border border-slate-200 rounded-lg p-4'
```

For stats panels, sector boxes, read-only info blocks.

### Active State

```
cls.activeItem = 'bg-white border-l-4 border-cvc-gold shadow-sm'
```

Apply to the active list/sidebar item — CVC Gold left border.

### Typography

```
cls.pageTitle    = 'text-3xl font-extrabold tracking-tight text-[#1E293B]'
cls.sectionTitle = 'text-lg font-bold text-[#334155]'
cls.cardTitle    = 'text-base font-semibold text-[#1E293B]'
cls.reportTitle  = 'text-3xl font-extrabold tracking-tight text-[#1E293B]'   // CVCPage compat alias

cls.meta    = 'font-mono text-[10px] uppercase tracking-widest text-slate-500 font-bold'
cls.eyebrow = 'font-mono text-[10px] uppercase tracking-widest text-slate-400 font-bold'
cls.label   = 'font-mono text-xs uppercase tracking-widest text-slate-600 font-semibold'

cls.body  = 'text-sm text-[#1E293B]'
cls.muted = 'text-sm text-slate-600'
cls.faint = 'text-xs text-slate-500'
```

`meta` / `eyebrow` / `label` are monospace all-caps — precision-tool aesthetic for technical labels, dates, and KPI captions.

### Inputs & Forms

```
cls.input     = 'bg-[#ede8d7] border border-slate-400 rounded-lg px-3 py-2 text-sm text-[#1E293B] focus:outline-none focus:ring-1 focus:ring-[#1E293B] font-[inherit]'
cls.inputFull = 'w-full bg-[#ede8d7] border border-slate-400 rounded-lg px-3 py-2 text-sm text-[#1E293B] focus:outline-none focus:ring-1 focus:ring-[#1E293B] font-[inherit]'
cls.select    = 'bg-[#ede8d7] border border-slate-400 rounded-lg px-3 py-2 text-sm text-[#1E293B] focus:outline-none focus:ring-1 focus:ring-[#1E293B] font-[inherit]'
```

Warm parchment (`#ede8d7`) background creates contrast against white card panels.

### Buttons

Two primary variants — different text colors, different intent:

```
cls.buttonPrimary = 'bg-[#1E293B] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-800 transition-colors shadow-sm'
cls.btnPrimary    = 'bg-[#1E293B] text-cvc-gold px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#151411] transition-colors shadow-sm font-[inherit]'
cls.btnSecondary  = 'border border-slate-200 text-[#1E293B] rounded-lg px-4 py-2 text-sm font-medium hover:bg-linen transition-colors font-[inherit]'
cls.btnOutline    = 'border border-[#1E293B] text-[#1E293B] rounded-lg px-4 py-2 text-sm font-medium hover:bg-linen transition-colors font-[inherit]'
```

- `buttonPrimary` — white text, standard CTA
- `btnPrimary` — CVC Gold text, brand-forward CTA (use for the most prominent action per screen)
- `btnSecondary` — ghost with slate border
- `btnOutline` — ghost with dark border (stronger than secondary)

### Dividers & Hover

```
cls.reportDivider = 'border-b-2 border-[#1E293B] pb-5 mb-6'
cls.hoverBg       = 'hover:bg-linen'
```

---

## Chart Colors

### Industrial Neon Scale

Use `chartScale` for new charts (donut, area, bar). Order: indigo → pink → cyan → amber.

```ts
chartScale.primary   = '#6366F1'  // indigo
chartScale.secondary = '#EC4899'  // pink
chartScale.tertiary  = '#06B6D4'  // cyan
chartScale.highlight = '#F59E0B'  // amber
chartScale.violet    = '#8b5cf6'
chartScale.emerald   = '#10b981'
chartScale.orange    = '#f97316'
chartScale.blue      = '#3b82f6'
```

### Sector Color Map

Use `chartColors[sectorName]` for any chart keyed by sector. Never hardcode sector colors inline.

```ts
'Supply Chain':          '#6366F1'
'Robotics':              '#EC4899'
'Manufacturing':         '#06B6D4'
'Industrial Automation': '#F59E0B'
'Physical AI':           '#8b5cf6'
'Logistics':             '#10b981'
'AI/ML':                 '#f97316'
'Energy':                '#3b82f6'
'Health':                '#EC4899'
'Fintech':               '#06B6D4'
'Aerospace & Defense':   '#64748b'
'Unclassified':          '#94a3b8'
```

### Fallback Palette

When sector is unknown, cycle through `chartFallbacks`:

```ts
['#6366F1', '#EC4899', '#06B6D4', '#F59E0B', '#8b5cf6', '#10b981', '#f97316', '#3b82f6', '#64748b', '#94a3b8']
```

Chart axes and grid lines use Tailwind slate scale: `stroke-slate-200` for grid, `fill-slate-400` for tick labels.

---

## Dark Theme Exception — PartnerTerminal

`/partners/:id/terminal` (`PartnerTerminal.tsx`) is intentionally excluded from the linen system.

It uses a dark Bloomberg-style terminal aesthetic for F500 partner interactions:

| Element | Value |
|---|---|
| Page background | `#0f172a` |
| Surface | `#1e293b` |
| Accent | `#F0E545` (terminal yellow, not CVC Gold) |
| Text | Slate hierarchy on dark |

**Never apply `bg-linen`, `shadow-cvc`, `cls.card`, or CVC Gold to this page.** It is a deliberate design outlier.

---

## Design Examples

### Standard Dashboard Card

```html
<div class="bg-white border border-slate-200 rounded-xl shadow-cvc p-6 hover:shadow-md transition-all">
  <div class="flex justify-between items-start mb-4">
    <div>
      <span class="font-mono text-[10px] uppercase tracking-widest text-slate-400 font-bold">Portfolio</span>
      <h3 class="text-base font-semibold text-[#1E293B]">Claryo</h3>
    </div>
    <span class="bg-[#F8FAFC] border border-slate-200 rounded-full px-2 py-1 font-mono text-[10px] text-slate-500">Series A</span>
  </div>
  <div class="space-y-2">
    <div class="flex justify-between text-sm">
      <span class="text-slate-500">Readiness</span>
      <span class="font-semibold text-[#1E293B]">8.2/10</span>
    </div>
    <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
      <div class="bg-[#6366F1] h-full" style="width: 82%"></div>
    </div>
  </div>
</div>
```

### Active Navigation Item

```html
<div class="bg-white border-l-4 border-[#F59E0B] shadow-sm px-4 py-3 flex items-center">
  <span class="text-sm font-semibold text-[#1E293B]">Market Intelligence</span>
</div>
```

### Data Area (Stats Panel)

```html
<div class="bg-[#F8FAFC] border border-slate-200 rounded-lg p-4">
  <span class="font-mono text-[10px] uppercase tracking-widest text-slate-500 font-bold">Companies Sourced</span>
  <div class="text-3xl font-extrabold tracking-tight text-[#1E293B] mt-1">1,742</div>
</div>
```

### Parchment Input

```html
<input
  class="w-full bg-[#ede8d7] border border-slate-400 rounded-lg px-3 py-2 text-sm text-[#1E293B] focus:outline-none focus:ring-1 focus:ring-[#1E293B]"
  placeholder="Search companies..."
/>
```

---

## Anti-Drift Rules

Rules for any agent or session modifying the design system:

1. **tokens.ts is the source of truth.** If you change a value in `tokens.ts`, update this file to match. If you add a new token, add it here.
2. **Never hardcode a hex value in a page component** if a `cls.*` token or `palette.*` value already covers it.
3. **Never hardcode sector colors in chart components.** Use `chartColors[sector]` with `chartFallbacks` as the fallback array.
4. **`shadow-cvc` is not `shadow-sm`.** The platform uses the custom 2-layer gallery shadow. Don't substitute Tailwind's built-in shadow utilities on cards.
5. **Sectors are always Title Case** — `Supply Chain`, `Robotics`, `Manufacturing`, `Industrial Automation`, `Physical AI`. Never snake_case in chart keys or filter values.
6. **PartnerTerminal stays dark.** Never apply linen tokens to `/partners/:id/terminal`.
7. **After any token change:** rebuild (`cd designs/figma-dashboard && npm run build`), commit `api/static/app/` with the source change in the same commit, then push to GitHub before deploying.
8. **Do not install new UI libraries.** Build components directly in Tailwind. Recharts is the only charting library.
