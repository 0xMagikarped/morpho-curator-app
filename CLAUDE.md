# morpho-curator-app — Project Context

Morpho Blue vault curator tool. Power-user DeFi interface for curators managing vault allocations, market health, oracle risk, and on-chain actions.

## Stack

- **Runtime**: React 19 + TypeScript + Vite 7
- **Styling**: Tailwind CSS 4 (custom `@theme` tokens in `src/index.css`) + CVA + tailwind-merge
- **Web3**: Wagmi v3 + RainbowKit + viem v2
- **Data**: TanStack Query v5 (server state), Zustand v5 (client state)
- **Tables**: TanStack Table v8
- **Charts**: Recharts v3
- **Icons**: Lucide React (exclusive — no other icon libraries)
- **Router**: React Router v7

## Design System

All tokens are defined as CSS custom properties in `src/index.css` under `@theme`.

### Colors
```css
--color-bg-root:     #08090C   /* page shell */
--color-bg-surface:  #0F1117   /* cards, panels */
--color-bg-elevated: #171923   /* drawers, dropdowns */
--color-bg-hover:    #1E2130
--color-bg-active:   #252A3A

--color-accent-primary:       #00E676   /* CTAs, active nav, positive delta */
--color-accent-primary-muted: #00E67620
--color-accent-primary-hover: #00FF8A

--color-success:  #22C55E
--color-warning:  #F59E0B
--color-danger:   #EF4444
--color-info:     #3B82F6
--color-migration:#A855F7

--color-risk-normal:   #22C55E
--color-risk-elevated: #F59E0B
--color-risk-critical: #EF4444

--color-grade-a: #22C55E  /* Oracle grades */
--color-grade-b: #3B82F6
--color-grade-c: #F59E0B
--color-grade-d: #F97316
--color-grade-f: #EF4444
```

### Typography
```css
--font-sans: 'Inter', 'Geist Sans', system-ui, sans-serif
--font-mono: 'Fira Code', 'JetBrains Mono', monospace
```
**Rule**: all numbers, addresses, hashes, APY%, amounts → `font-mono`. Labels, prose → `font-sans`.

### Border Radius
```css
--radius-sm: 4px   /* badges */
--radius-md: 6px   /* buttons, inputs */
--radius-lg: 8px   /* cards */
--radius-xl: 12px  /* modals, drawers */
```

### Animations
- Shimmer skeleton: `.animate-shimmer` (defined in index.css)
- Standard hover: `100ms ease-out`
- Drawer/modal: `250ms ease-out`
- Always implement `prefers-reduced-motion: reduce`

## Component Structure

```
src/
├── components/
│   ├── dashboard/    AlertsFeed, PendingActions, PortfolioSummary, QuickActions
│   ├── layout/       AppLayout, Header, Sidebar
│   ├── market/       MarketDeployer, MarketDetail, MarketForm, MarketPreview,
│   │                 RateSimulator, SeedCalculator
│   ├── migration/    UsdcMigrationBanner
│   ├── oracle/       OracleHealthIndicator, OracleRiskBadge, OracleRiskCard,
│   │                 OracleTypeBadge, PriceComparison, VaultOracleDashboard
│   ├── risk/         RiskAlertBanner, SharePriceChart, UtilizationBar
│   ├── ui/           AddressDisplay, Badge, Button, Card, ChainBadge,
│   │                 ProgressBar, RoleBadge, SectionHeader, VersionBadge
│   └── vault/        CapsTab, CreateVaultWizard, DeadDepositHelper,
│                     GuardianTab, MarketsTab, OverviewTab, PositionHealthTable, ...
├── pages/            DashboardPage, VaultPage, MarketsPage, CreateMarketPage,
│                     CreateVaultPage, OracleDecoderPage, OracleDeployerPage, SettingsPage
├── store/            Zustand stores
├── lib/              Utilities, wagmi config
├── config/           Chain + contract config
└── types/            Shared TypeScript types
```

## Coding Conventions

- Dark-first — never add light mode unless explicitly asked
- Use existing CSS custom properties (`var(--color-*)`) — no hardcoded hex in component code
- Prefer Tailwind utilities; use inline `style` only for dynamic values (e.g., percentage widths)
- All external data must have loading skeletons (`animate-shimmer`) + error states
- Addresses: always display truncated with `AddressDisplay` component, copy-on-click
- Numbers/APY/amounts: always `font-mono` class
- Every interactive element: keyboard accessible, `aria-label` where icon-only
- Touch targets: minimum 44×44px

## Visual Direction (Revamp Target)

Inspiration: **jobx.dev** — terminal-punk, data-dense, monospace-first.
Full prompt and token mapping: `../Design-Agent/curator-tool-morpho-revamp-prompt.md`
Reference library entry: `../Design-Agent/design-agent-squad/shared/references/templates/dashboards/jobx-dashboard.md`

The revamp evolves the existing green accent system toward a cooler, more terminal aesthetic while keeping the same CSS variable architecture. Specific jobx.dev token adaptations are in the design-agent skill.

## Design Agent Squad

The Design Agent Squad is available as a skill. See `.claude/skills/design-agent/SKILL.md`.

Pipeline location: `../Design-Agent/design-agent-squad/`
Revamp prompt: `../Design-Agent/curator-tool-morpho-revamp-prompt.md`
