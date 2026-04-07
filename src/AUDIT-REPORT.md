# Audit Report — RockawayX Morpho Curator Tooling App

**Date**: 2026-03-25
**Auditor**: Claude Code (Opus 4.6)
**Codebase**: 191 files, ~30,575 lines of TypeScript/TSX

---

## Executive Summary

- **Overall health**: Good — production-ready with targeted debt
- **Total findings**: 34
- **Critical: 5** | **High: 7** | **Medium: 12** | **Low: 10**

The codebase demonstrates strong React/TypeScript fundamentals: strict mode enabled, zero `@ts-ignore`, zero React Context (Zustand instead), excellent TanStack Query patterns, and proper code splitting. The primary weaknesses are **silent error handling in the data layer**, **ABI duplication across files**, and **ESLint errors from React Compiler** that indicate real bugs (setState in effects, ref access during render).

---

## Architecture Overview

```
src/
├── components/   91 files  (vault/ 58, ui/ 13, dashboard/ 10, market/ 9, oracle/ 6, risk/ 3, layout/ 3)
├── lib/          63 files  (data layer, contracts, hooks, morpho SDK, oracle, risk, utils, v2)
├── pages/        11 files  (lazy-loaded via lazyWithRetry)
├── hooks/        14 files  (custom hooks at root + morpho-sdk/)
├── store/         1 file   (Zustand appStore with localStorage persistence)
├── config/        2 files  (chains.ts, wagmi.ts)
└── types/         1 file   (index.ts — all shared types)
```

**Data flow**: GraphQL API (ETH/Base) → RPC fallback → SEI RPC-only.
**State**: Zustand (client), React Query (server), wagmi (wallet/chain).
**V1/V2**: Factory detection → fallback probe → version-aware reads.

---

## Critical Findings (fix before any new features)

### C1. ESLint: 23 Errors Including React Compiler Bugs

- **Files**: 10+ components
- **Issue**: `npx eslint src/` reports **23 errors, 4 warnings**:
  - **11x** "Calling setState synchronously within an effect can trigger cascading renders" — React Compiler detects state updates inside `useEffect` that should use the effect's cleanup or be restructured
  - **2x** "Cannot access refs during render" — reading `.current` during render is unsafe with concurrent React
  - **5x** `@typescript-eslint/no-explicit-any` — typed `any` in components
  - **1x** unused variable (`_assetSymbol`)
  - **1x** missing `useMemo` dependency (`displayableMarkets` in MarketsPage)
  - **1x** conditional useMemo dependency (`marketIds` in CapsTab)
  - **2x** missing `useEffect` dependency (`fetchTokenMeta`)
- **Fix**: Each is a distinct bug. The setState-in-effect and ref-during-render errors are **real concurrency hazards** in React 19.
- **Effort**: Medium (2-4 hours — each needs individual analysis)

### C2. Silent Failures in `safeRead` — Data Layer Swallows Errors

- **File**: `src/lib/data/rpcClient.ts:267-276`
- **Issue**: `safeRead<T>()` catches ALL contract read errors and returns `null` without logging. Used for **all** vault info reads (14+ parallel reads per vault). If 3 of 14 fail, partial data renders with zero-values — user sees stale/wrong data with no error indication.
- **Fix**: Add `console.warn` in catch, surface partial failures to UI via error aggregation.
- **Effort**: Medium

### C3. Dashboard Silently Drops Failed Vaults

- **File**: `src/lib/hooks/useDashboard.ts:49-55`
- **Issue**: `Promise.allSettled()` filters out rejected vaults with no user notification. If 5 of 10 tracked vaults fail to load, user sees 5 and thinks that's all. No error count, no "X vaults failed" banner.
- **Fix**: Return `{ vaults, failedCount }` and show a warning in DashboardPage.
- **Effort**: Small

### C4. Write Operations Not Gated Behind Wallet Connection Check

- **Files**: CapsTab.tsx, RoleManagement.tsx, MarketDeployer.tsx, multiple adapters
- **Issue**: `writeContract()` called without checking `useAccount().isConnected` first. If wallet disconnects mid-session, write calls fail with opaque errors instead of a clear "Connect wallet" message.
- **Fix**: Add `if (!isConnected) return` guard before every `writeContract` call, or create a wrapper hook.
- **Effort**: Small (repetitive but straightforward)

### C5. ABI Type Mismatch Between Duplicate Definitions

- **Files**: `src/lib/contracts/abis.ts` vs `src/lib/contracts/metaMorphoV2Abi.ts`
- **Issue**: `performanceFee` output type is `uint96` in one file, `uint256` in the other. Components import from different sources. This can cause silent BigInt truncation or incorrect fee display.
- **Fix**: Consolidate to single source of truth (see H2).
- **Effort**: Small

---

## High Priority Findings

### H1. API-to-RPC Fallback Has No User Feedback

- **File**: `src/lib/hooks/useVault.ts:42-47`
- **Issue**: When the Morpho GraphQL API fails, the app silently falls back to RPC (5+ seconds slower). Only `console.warn` — no loading state change, no "Using slower data source" indicator.
- **Fix**: Return `{ data, dataSource: 'api' | 'rpc' }` from the hook, show a subtle indicator.
- **Effort**: Small

### H2. ABI Duplication: V2 ABI Defined in 3 Locations

- **Files**: `abis.ts` (lines 664-767), `metaMorphoV2Abi.ts` (lines 15-260), `rpcClient.ts` (lines 181-204, private `vaultV2Abi`)
- **Issue**: Same contract interface defined 3 times with subtle differences. Import paths inconsistent across 10+ components.
- **Fix**: Single source in `metaMorphoV2Abi.ts`, re-export from `abis.ts`, import `vaultV2Abi` in rpcClient.
- **Effort**: Medium (many import updates)

### H3. Transaction Error Messages Truncated to 120 Characters

- **Files**: `RoleManagement.tsx:155,265`, other write components
- **Issue**: `(txError as Error).message?.slice(0, 120)` cuts off critical revert reason data. "Sender is not the owner" or "cap exceeds maximum" may be truncated.
- **Fix**: Show full message with overflow scroll, or at minimum 300 chars.
- **Effort**: Small

### H4. Pending Timelock/Guardian Reads Don't Distinguish V2 from RPC Error

- **File**: `src/lib/data/rpcClient.ts:777-808`
- **Issue**: `fetchPendingTimelock()` returns `null` for both "V2 vault (doesn't have this function)" and "V1 vault with RPC error". Impossible to distinguish.
- **Fix**: Check vault version before calling V1-only functions, or use typed error returns.
- **Effort**: Small

### H5. Market Scanner Failure Silently Breaks Caps Tab

- **Files**: `src/lib/hooks/useMarketScanner.ts`, `src/components/vault/CapsTab.tsx`
- **Issue**: If market scanner fails, CapsTab shows empty "discoverable markets" list with no error. User cannot add new markets and doesn't know why.
- **Fix**: Surface scanner error state in CapsTab UI.
- **Effort**: Small

### H6. Deploy Step Receipt Polling Can Spin Forever

- **File**: `src/components/vault/steps/DeployStep.tsx:49-87`
- **Issue**: `waitForTransactionReceipt()` polls indefinitely if both wallet provider and public RPC fail. No timeout message shown to user.
- **Fix**: Add timeout (e.g., 3 minutes) with user-visible "Transaction may still be pending" message.
- **Effort**: Small

### H7. `npm audit`: 9 Vulnerabilities (7 High) in `undici`

- **Package**: `undici` via `@vercel/node`
- **Issue**: HTTP request smuggling, CRLF injection, DoS via decompression — all in server-side `@vercel/node` dependency.
- **Fix**: `npm audit fix --force` (updates `@vercel/node` to v4, breaking change).
- **Effort**: Small (test API routes after upgrade)

---

## Medium Priority Findings

### M1. Dynamic `createPublicClient` in OracleDeployerPage

- **File**: `src/pages/OracleDeployerPage.tsx:84-85`
- **Issue**: Creates a new viem client instance on every token info `onBlur` event instead of caching.
- **Fix**: Use `useMemo` or the existing `getPublicClient()` from rpcClient.ts.
- **Effort**: Small

### M2. `truncateAddress` Duplicated with Different Behavior

- **Files**: `src/lib/utils/format.ts:88-91` (4+2 chars), `src/components/ui/AddressDisplay.tsx:13-16` (6+4 chars)
- **Issue**: Two implementations produce different output for the same address.
- **Fix**: Remove AddressDisplay's private copy, import from format.ts.
- **Effort**: Small

### M3. Two Formatting Utility Files

- **Files**: `format.ts` (125 lines, 23+ importers) and `formatting.ts` (27 lines, sparse use)
- **Issue**: No clear separation principle. Requires two imports for full formatting.
- **Fix**: Merge `formatting.ts` into `format.ts`.
- **Effort**: Small

### M4. Missing `useMemo` Dependency in MarketsPage

- **File**: `src/pages/MarketsPage.tsx:96-125`
- **Issue**: ESLint warns `displayableMarkets` should be a dependency of `useMemo` but `[markets, selectedTokens, sortKey, sortDir]` is listed instead. This can cause stale filtered results.
- **Fix**: Use `displayableMarkets` as the dependency, or inline the derivation.
- **Effort**: Small

### M5. No Unit Tests for Formatting Functions

- **Files**: `format.ts`, `formatting.ts`
- **Issue**: `calcSharePrice()`, `calcUtilization()`, `rateToAPY()`, `formatTokenAmount()` used in 23+ components but have zero test coverage. Two `truncateAddress` implementations means bugs can diverge.
- **Fix**: Add test file covering all exported functions.
- **Effort**: Medium

### M6. `Promise.allSettled` in V2 Adapter Reads Silently Drops Failed Markets

- **File**: `src/lib/data/rpcClient.ts:637-732`
- **Issue**: Per-market adapter reads use `Promise.allSettled` but only console.log rejected ones. V2 allocation tab may show partial data.
- **Fix**: Return failure count alongside data.
- **Effort**: Small

### M7. No `.env` Validation at Startup

- **Files**: `src/config/wagmi.ts:55-58` (warns), `src/lib/data/rpcClient.ts:44-48` (silent)
- **Issue**: Missing `VITE_WALLETCONNECT_PROJECT_ID` only produces a `console.warn`. Other env vars silently default. No fail-fast.
- **Fix**: Add a startup validation function that checks all required env vars.
- **Effort**: Small

### M8. `IndexedDB` Error Swallowed in Risk DB

- **File**: `src/lib/risk/riskDB.ts:72`
- **Issue**: `pruneOldRecords().catch(() => {})` — quota exceeded or corruption goes unnoticed.
- **Fix**: At minimum, `console.error` the failure.
- **Effort**: Small

### M9. Sentry Not Capturing Data Layer Errors

- **Files**: `useVault.ts`, `rpcClient.ts`, `morphoApi.ts`
- **Issue**: API fallbacks and RPC errors logged to console only, not Sentry. Production debugging lacks context.
- **Fix**: `Sentry.addBreadcrumb()` for data layer fallbacks.
- **Effort**: Small

### M10. `@walletconnect/ethereum-provider` Pinned to Old Version

- **Package**: `@walletconnect/ethereum-provider@2.21.1` (latest: 2.23.8)
- **Issue**: Pinned due to previous compatibility issue with `@wagmi/connectors@6.2.0`. May miss bug fixes.
- **Fix**: Test with latest version; update if compatible.
- **Effort**: Small (test WalletConnect flow)

### M11. Missing `VITE_SENTRY_DSN` in `.env.example`

- **File**: `.env.example`
- **Issue**: Lists WalletConnect and RPC vars but not `VITE_SENTRY_DSN`. Sentry silently disabled in dev.
- **Fix**: Add to `.env.example` with comment.
- **Effort**: Small

### M12. `wagmi` Pinned to v2 While v3 Available

- **Package**: `wagmi@2.19.5` (latest: 3.6.0)
- **Issue**: Pinned to v2 for RainbowKit 2.x compatibility. When RainbowKit supports wagmi v3, upgrade.
- **Fix**: Track RainbowKit releases; upgrade when compatible.
- **Effort**: Large (when available)

---

## Low Priority / Nice-to-Have

### L1. QueueList Key Includes Index

- **File**: `src/components/vault/queues/QueueList.tsx:64`
- **Issue**: `key={\`${item.marketId}-${i}\`}` — index in key is an anti-pattern. `marketId` alone is unique.
- **Fix**: `key={item.marketId}`
- **Effort**: Trivial

### L2. `TokenInfo` Type Duplicated in OracleDeployerPage

- **File**: `src/pages/OracleDeployerPage.tsx:63`
- **Issue**: Local `TokenInfo` interface shadows the shared one from `src/types/index.ts`.
- **Fix**: Import from types.
- **Effort**: Trivial

### L3. Unsafe SDK Type Bridge

- **File**: `src/lib/morpho/clients.ts:11`
- **Issue**: `return getPublicClient(chainId) as unknown as Client<Transport, Chain>` — double cast for SDK compatibility. Documented but fragile.
- **Fix**: Create a proper adapter function with runtime check.
- **Effort**: Small

### L4. `DeployStep.tsx` Uses `(window as any).ethereum`

- **File**: `src/components/vault/steps/DeployStep.tsx:36,56`
- **Issue**: `Record<number, any>` for chain map, `window.ethereum` cast. Minor type gaps.
- **Fix**: Use proper `Chain` type, check `window.ethereum` existence.
- **Effort**: Trivial

### L5. No React Query Exponential Backoff

- **File**: `src/App.tsx:55-60`
- **Issue**: Retry logic is `failureCount < 2` — no backoff between retries.
- **Fix**: Add `retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000)`.
- **Effort**: Trivial

### L6. Sentry Error Boundary UX is Developer-Focused

- **File**: `src/App.tsx:74-82`
- **Issue**: Renders raw stack trace. Not user-friendly.
- **Fix**: Add "Try refreshing" button and friendlier copy.
- **Effort**: Small

### L7. Large Chunk Warnings (4 chunks > 500KB)

- **Build output**: 4 chunks exceed 500KB
- **Issue**: `metamask-sdk`, `core`, `index` chunks are large.
- **Fix**: Manual chunks in `vite.config.ts` `rollupOptions.output.manualChunks`.
- **Effort**: Medium

### L8. `useCallback` Missing on Handlers in AddMarketWizard

- **File**: `src/components/vault/adapters/AddMarketWizard.tsx`
- **Issue**: Event handlers recreated every render. Only matters if children are memoized.
- **Fix**: Wrap in `useCallback` if children become `React.memo`.
- **Effort**: Trivial

### L9. No Dead Code Detection

- **Issue**: No automated unused-export detection. Some hooks/utils may be unused after refactors.
- **Fix**: Add `knip` or `ts-prune` to CI.
- **Effort**: Small

### L10. Missing `noUncheckedIndexedAccess` in tsconfig

- **File**: `tsconfig.app.json`
- **Issue**: Array/object index access not checked for `undefined`. E.g., `arr[0]` is typed as `T` not `T | undefined`.
- **Fix**: Add `"noUncheckedIndexedAccess": true` — will surface some issues but improves safety.
- **Effort**: Medium (may require many fixes)

---

## Architecture Recommendations

1. **Create `useGuardedWriteContract` hook** — wraps `useWriteContract` with automatic `isConnected` check and standardized error display. Eliminates C4 across all write components.

2. **Add error aggregation to data hooks** — `useVaultFullData` should return `{ data, partialErrors: string[] }` so UI can show "Some data may be stale" banners.

3. **Consolidate ABIs into single source** — `src/lib/contracts/` should have one file per contract (morphoBlue.ts, metaMorphoV1.ts, metaMorphoV2.ts) with no inline duplicates.

4. **Add Sentry breadcrumbs to data layer** — Every API→RPC fallback, every `safeRead` null return should be a breadcrumb for production debugging.

5. **Consider `zod` for API response validation** — GraphQL responses are currently cast without validation. A schema would catch API changes early.

---

## Summary by Effort

| Effort | Count | Findings |
|--------|-------|----------|
| Trivial (< 15min each) | 7 | L1, L2, L4, L5, L8, M11, M8 |
| Small (15-60min each) | 15 | C3, C4, C5, H1, H3, H4, H5, H6, H7, M1, M2, M3, M7, L3, L6 |
| Medium (1-4 hours each) | 9 | C1, C2, H2, M4, M5, M6, M9, L7, L10 |
| Large (4+ hours) | 1 | M12 |

**Recommended order**: C4 → C1 → C2 → C5/H2 → C3 → H3 → H5 → rest by severity.
