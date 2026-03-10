---
name: design-agent
description: "Design Agent Squad — 7-agent UI pipeline for morpho-curator-app. Generates 9/10+ quality React/TypeScript/Tailwind components in the project's existing terminal-punk dark aesthetic. Triggers on: design component, build UI, revamp, vault dashboard, market list, new component, redesign, UI, terminal-punk, DeFi UI, generate component."
triggers: "design component, build UI, revamp, vault dashboard, market list, new component, redesign, UI, terminal-punk, generate component, design system, visual update, restyle"
---

# Design Agent Squad — morpho-curator-app

## IMPORTANT: How to Run This Pipeline

When this skill activates, **do not answer inline**. You must run the full 7-agent pipeline below, step by step, in sequence. Each agent's output becomes the next agent's input. Do not skip agents. Do not merge steps.

Work through every agent role yourself — you are the orchestrator and all 7 agents.

---

## Pipeline Execution (run every time)

```
Inspector → Architect → Stylist → Animator → Guardian → Critic → Forger
                                                            ↑         |
                                                            └─────────┘
                                                        (re-run if < 9.0)
```

### Step 1 — INSPECTOR
Search the reference library for 3–5 relevant inspirations.

```bash
cd ../Design-Agent/design-agent-squad
python shared/scripts/search_references.py "[component type] dark" --type [component-type]
python shared/scripts/search_references.py "terminal-punk DeFi dashboard" --type dashboard
```

jobx.dev is already indexed and will rank #1 for dark dashboard queries. Extract from it:
- Relevant design tokens (colors, spacing, typography)
- Component patterns that match the request
- Quality signatures to target

Output: structured JSON with curated references and shared design patterns.

### Step 2 — ARCHITECT
Design the spatial layout. Output a written spec covering:
- Grid structure (base unit: 4px)
- Component hierarchy and nesting
- Responsive breakpoints (mobile: 1-col, tablet: 2-col, desktop: 3-col)
- Spacing map (padding, gaps, margins as multiples of 4px)
- Scroll / sticky / overflow behavior

Do NOT reference colors or visual style yet — layout only.

### Step 3 — STYLIST
Apply the visual layer on top of the Architect's layout spec. Output:
- Color assignments using `var(--color-*)` tokens from `src/index.css` (no hardcoded hex)
- Typography: font-mono for all numbers/addresses/APY, font-sans for labels/prose
- Border treatment: 1px solid at 8–10% opacity
- Depth: no heavy shadows — borders do the work. Hover: 0 4px 16px black/40%
- Icon specifications: Lucide only, 16px in cards, 20px in nav, 14px in metadata

### Step 4 — ANIMATOR
Add all interaction and motion specs:
- Hover states (100ms ease-out on all interactive elements)
- Loading skeletons (use `.animate-shimmer` class already in `src/index.css`)
- Drawer/modal: 250ms ease-out enter, 200ms ease-in exit
- At-Risk pulse: `@keyframes pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.05) } }`, 500ms
- Count-up animation on StatCard values (300ms on mount)
- All animations wrapped in `@media (prefers-reduced-motion: reduce) { /* disable */ }`

### Step 5 — GUARDIAN
Run accessibility and usability checks on the spec so far. Verify:
- WCAG AA contrast on all text against their background tokens
- Tab order is logical and complete
- All icon-only buttons have `aria-label`
- Touch targets are minimum 44×44px
- Drawer/modal has `role="dialog"`, `aria-modal="true"`, focus trap, ESC close
- Address fields use `<AddressDisplay />` component (already exists in `components/ui/`)
- Keyboard navigation works for all interactive elements (table rows, filter chips, etc.)

Flag any violations. Fix them in the spec before proceeding.

### Step 6 — CRITIC
Score the complete spec (Inspector + Architect + Stylist + Animator + Guardian outputs) using the UICrit rubric:

| Dimension | Weight | What to check |
|-----------|--------|---------------|
| Layout & Composition | 15% | 4px grid, responsive, hierarchy |
| Typography | 15% | mono/sans split enforced, modular scale |
| Color & Theme | 15% | only var(--color-*), WCAG AA, no hex |
| Depth & Elevation | 10% | borders over shadows, consistent layers |
| Interaction & Motion | 15% | all 5 states present, reduced-motion |
| Accessibility | 15% | WCAG AA, keyboard, aria, 44px targets |
| Polish & Craft | 15% | Lucide-only, systematic radius, micro-details |

**If total score < 9.0/10**: identify the lowest-scoring dimensions, return to the relevant agent step and fix. Re-score. Repeat until ≥ 9.0/10.

**If total score ≥ 9.0/10**: proceed to Forger. Print the score summary.

### Step 7 — FORGER
Generate the complete, production-ready code. Rules:
- Stack: React 19 + TypeScript + Tailwind CSS 4 + CVA + tailwind-merge
- **No shadcn/ui** — use existing components from `src/components/ui/` and `src/components/risk/`
- Reuse: `Card`, `CardHeader`, `CardTitle`, `Badge`, `Button`, `ProgressBar`, `UtilizationBar`, `AddressDisplay`
- All `var(--color-*)` tokens — zero hardcoded hex in component JSX/TSX
- Export named components (not default exports unless it's a page)
- Include TypeScript interfaces for all props
- Include JSDoc comment on each component explaining its role
- File naming: PascalCase, placed in appropriate `src/components/` subdirectory

Output each component as a complete, copy-paste-ready `.tsx` file.

---

## What This Skill Does

## Pipeline

```
Inspector → [Architect + Stylist] (parallel) → Animator → Guardian → Critic → Forger
                                                                ↑              |
                                                                └──────────────┘
                                                              (iterate if < 9/10)
```

| Agent | What it does for this project |
|-------|-------------------------------|
| **Inspector** | Searches reference library — jobx.dev ranks #1 for dark dashboard queries |
| **Architect** | Layouts using 4px grid, sidebar 240px, 3-col desktop grid, TanStack Table for lists |
| **Stylist** | Applies project CSS tokens (`var(--color-*)`) + jobx.dev visual direction |
| **Animator** | Hover states, shimmer skeletons, drawer slide-ins, status pulse on At-Risk |
| **Guardian** | WCAG AA, keyboard nav, aria-labels, 44px targets, address copy patterns |
| **Critic** | 7-dimension UICrit score — passes at ≥ 9.0/10 |
| **Forger** | React 19 + TypeScript + Tailwind 4 + existing project conventions |

## Design System (project tokens)

### Colors — always use CSS vars, never hardcode hex
```css
/* Backgrounds */
--color-bg-root:     #08090C   /* page shell */
--color-bg-surface:  #0F1117   /* cards */
--color-bg-elevated: #171923   /* drawers, dropdowns */
--color-bg-hover:    #1E2130
--color-bg-active:   #252A3A

/* Accent */
--color-accent-primary:       #00E676
--color-accent-primary-muted: #00E67620
--color-accent-primary-hover: #00FF8A

/* Semantic */
--color-success:  #22C55E    --color-warning: #F59E0B
--color-danger:   #EF4444    --color-info:    #3B82F6

/* Risk */
--color-risk-normal:   #22C55E
--color-risk-elevated: #F59E0B
--color-risk-critical: #EF4444

/* Oracle grades: A=#22C55E B=#3B82F6 C=#F59E0B D=#F97316 F=#EF4444 */
```

### Typography
- **Data / numbers / addresses / APY / amounts** → `font-mono` (`Fira Code` / `JetBrains Mono`)
- **Labels / prose / headings** → `font-sans` (`Inter`)
- Card title: 16–20px / weight 600
- Section label: 12–13px / weight 500 / muted
- Values: 13–14px mono / weight 500
- Metadata (timestamps, hashes): 11px mono / opacity 50–60%

### Spacing & Radius
- Base unit: 4px
- Card padding: 12–16px
- Grid gap: 8px
- Radius: badges=`--radius-sm (4px)` · buttons/inputs=`--radius-md (6px)` · cards=`--radius-lg (8px)` · drawers=`--radius-xl (12px)`

### Motion
- Hover: 100ms ease-out
- Component: 150ms ease-out
- Drawer/modal: 250ms ease-out enter / 200ms ease-in exit
- At-Risk pulse: scale 1.0 → 1.05 → 1.0, 500ms cycle
- Skeleton shimmer: `.animate-shimmer` (already in index.css)
- **Always**: `@media (prefers-reduced-motion: reduce) { /* disable */ }`

## Pre-Built Component Specs

### VaultDashboard (DashboardPage + VaultPage)
Full spec in `../../curator-tool-morpho-revamp-prompt.md` (section: VAULT DASHBOARD REQUEST)

Key layout:
- Left sidebar 240px: logo, nav links, wallet + chain indicator at bottom
- Top stats bar: TVL, Net APY (7d), Active Markets count, Status badge
- Main 3-col grid (desktop) / 1-col (mobile):
  - Row 1: 4 × StatCard (TVL, APY, Utilization, Liquidity Available)
  - Row 2: AllocationBar (Recharts) + MarketHealthGrid
  - Row 3: RiskPanel + ActivityFeed

### MarketCard (inside grid)
- Header: token icon + market name + status badge (Active / At-Risk / Frozen)
- Body: Supply APY, Borrow APY, Utilization%, Available — all mono
- Footer: LTV utilization ProgressBar (green → amber → red)
- At-Risk: amber `var(--color-risk-elevated)` border + pulse animation
- Frozen: `var(--color-risk-critical)` border + 40% opacity overlay

### StatCard
```tsx
// Pattern: label (muted sans) / value (mono 24px) / delta (colored arrow + %)
<StatCard label="Total TVL" value="$42.8M" delta="+2.4%" positive />
```

### MarketList (MarketsPage)
Full spec in `../../curator-tool-morpho-revamp-prompt.md` (section: MARKET LIST REQUEST)

Key elements:
- Filter bar: token chips (multi-select), Status (All/Active/At-Risk/Frozen), APY range slider, Utilization range slider
- TanStack Table: sticky header, sortable columns, row hover highlight
- Detail drawer: 480px, slide from right, tabs (Overview | Risk | History | Curator Notes)

### ActivityFeed
- Last 10 on-chain events: deposit / withdraw / rebalance / liquidation
- Each row: event type badge + amount (mono) + timestamp (mono, muted) + tx hash (truncated, copy button)

## Data States (required on every component)

| State | Implementation |
|-------|----------------|
| Loading | `.animate-shimmer` skeleton at correct dimensions |
| Empty | Zero-state illustration + descriptive label + CTA |
| Healthy | Default populated state |
| At-Risk | Amber banner / border / pulse badge |
| Paused | Muted overlay + curator notice text |
| Error | Error toast + retry button + "Last updated: X ago" stale label |

## How to Trigger This Pipeline

Just say what you want to build. The pipeline runs automatically.

```
Revamp the VaultDashboard
Build the StatCard component
Design the MarketList with detail drawer
Build ActivityFeed
```

For the full revamp, paste the request blocks from the revamp prompt file:
`../Design-Agent/curator-tool-morpho-revamp-prompt.md`
— sections: VAULT DASHBOARD REQUEST and MARKET LIST REQUEST

## Quality Bar (9.0 / 10 minimum)

| Dimension | Weight | Key checks |
|-----------|--------|------------|
| Layout & Composition | 15% | 4px grid adherence, responsive breakpoints |
| Typography | 15% | mono/sans split, modular scale |
| Color & Theme | 15% | `var(--color-*)` only, no hardcoded hex, WCAG AA |
| Depth & Elevation | 10% | borders do the work, no heavy shadows |
| Interaction & Motion | 15% | all 5 states, prefers-reduced-motion |
| Accessibility | 15% | WCAG 2.1 AA, keyboard nav, aria-labels, 44px targets |
| Polish & Craft | 15% | Lucide-only icons, systematic radius, micro-details |

## Hard Rules

- Dark-first — never add light mode
- `var(--color-*)` CSS tokens — no hardcoded hex in components
- **Lucide React only** — no other icon libraries
- All on-chain numbers → `font-mono`
- All addresses → `<AddressDisplay />` component (truncated + copy)
- Touch targets ≥ 44×44px
- Skeleton on every async data boundary
- `prefers-reduced-motion` on every animation

---

*Design Agent Squad · morpho-curator-app · jobx.dev aesthetic · 2026-03-09*
