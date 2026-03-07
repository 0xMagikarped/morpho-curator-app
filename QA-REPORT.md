# QA Report — RockawayX Curator Tooling App
## Date: 2026-03-06
## Build Status: PASS (with lint errors)

## Build Details
- **TypeScript (`tsc --noEmit`):** 0 errors
- **Vite build:** PASS — 1,073.72 kB main chunk (320.83 kB gzipped)
- **ESLint:** 5 errors, 0 warnings
  - 1x Rules of Hooks violation (conditional `useMemo` in OverviewTab)
  - 3x Impure `Date.now()` calls in render (GuardianTab, OverviewTab x2)
  - 1x `as any` type assertion (V2SecurityTab)
- **npm audit:** 0 vulnerabilities
- **Dependency warnings:** Node engine mismatch (running v23.9.0, some packages want ^20.19 || ^22.13 || >=24)

## Summary
- **Critical: 5 findings** (wrong on-chain encoding, missing safety checks)
- **High: 6 findings** (broken features, React violations)
- **Medium: 7 findings** (wrong data, UX issues)
- **Low: 7 findings** (minor validation gaps, cosmetic)
- **Info: 6 recommendations**

---

## Critical Findings

### [C-01] CapsTab hardcodes 6 decimals for supply cap encoding
- **Location:** `src/components/vault/CapsTab.tsx:38`
- **Description:** `BigInt(Math.floor(parseFloat(newCapValue) * 1e6))` hardcodes 6 decimals. For an 18-decimal asset (e.g., DAI, WETH), the submitted cap would be **10^12 times too small**. A user entering "1000000" for 1M DAI would submit a cap of 1M * 1e6 = 1e12 raw units, when it should be 1e24.
- **Impact:** Vault curators on Ethereum/Base could set supply caps that are astronomically wrong, either blocking all deposits (too low) or providing no protection (if they compensate by entering huge numbers).
- **Recommendation:** Read asset decimals from vault info: `const decimals = vault?.assetInfo?.decimals ?? 18; const capWei = BigInt(Math.round(parseFloat(newCapValue) * 10 ** decimals));`

### [C-02] ReallocateTab hardcodes 6 decimals for reallocation amounts
- **Location:** `src/components/vault/ReallocateTab.tsx:70,156`
- **Description:** `BigInt(Math.floor(parseFloat(value || '0') * 1e6))` for target input and `Number(edit.targetAssets) / 1e6` for display. Same issue as C-01 — wrong for non-6-decimal assets.
- **Impact:** Reallocation targets would be computed incorrectly for 18-decimal assets, potentially causing the vault to attempt moves of near-zero amounts or overflow amounts.
- **Recommendation:** Use vault's asset decimals from context, not hardcoded 6.

### [C-03] V2SecurityTab hardcodes 6 decimals for forceDeallocate
- **Location:** `src/components/vault/V2SecurityTab.tsx:39`
- **Description:** `BigInt(Math.floor(parseFloat(deallocateAmount) * 1e6))` — emergency force-deallocate amount encoded with hardcoded 6 decimals.
- **Impact:** Emergency withdrawal on a V2 vault with non-6-decimal assets would withdraw the wrong amount. This is an emergency action — getting it wrong in a crisis could be catastrophic.
- **Recommendation:** Fetch and use the vault's asset decimals.

### [C-04] No wallet chain mismatch check before any writeContract call
- **Location:** All write-capable components: `CapsTab.tsx`, `ReallocateTab.tsx`, `GuardianTab.tsx`, `V2SecurityTab.tsx`, `DeployStep.tsx`
- **Description:** None of these components verify that the user's wallet is connected to the same chain as the vault before sending transactions. If a user views a SEI vault (chainId 1329) but their wallet is on Ethereum (chainId 1), `writeContract` will attempt to send the transaction on Ethereum — to an address that is NOT the vault on that chain.
- **Impact:** Transactions sent to the wrong chain. In the worst case, if a contract at the same address exists on the wrong chain, funds could be lost. More likely, the transaction reverts with a confusing error.
- **Recommendation:** Add a `useChainId()` check in every write component. Before any `writeContract`, verify `walletChainId === targetChainId`. Show "Switch to {chainName}" button using wagmi's `useSwitchChain()` if mismatched.

### [C-05] Missing Base V2 Factory address
- **Location:** `src/config/chains.ts:140-143`
- **Description:** Comment says "V2 Factory not deployed on Base" but Morpho docs confirm Base V2 Factory exists at `0x4501125508079A99ebBebCE205DeC9593C2b5857`. This means V2 vault detection on Base will always fail — any V2 vault on Base would be incorrectly identified as V1.
- **Impact:** V2 vaults on Base would be shown with V1 UI (wrong tab set, wrong ABI for write operations). Any curator action on a misidentified V2 vault would revert.
- **Recommendation:** Add `v2: '0x4501125508079A99ebBebCE205DeC9593C2b5857' as Address` to Base's `vaultFactories`.

---

## High Findings

### [H-01] React Rules of Hooks violation — conditional useMemo in OverviewTab
- **Location:** `src/components/vault/OverviewTab.tsx:57` (per ESLint output)
- **Description:** The `useMemo` that generates `riskAlerts` is called after the early return `if (isLoading || !vault) return ...`. React hooks must be called in the same order every render — calling them after a conditional return violates this rule.
- **Impact:** Can cause React runtime errors, stale state, or crashes in development mode. May work in production by coincidence but is fundamentally broken.
- **Recommendation:** Move all hooks above the early return. Use conditional logic inside the hook instead of conditionally calling the hook.

### [H-02] `Date.now()` called during render (impure function)
- **Location:** `GuardianTab.tsx:119`, `CapsTab.tsx:79`, `V2SecurityTab.tsx:111`, `OverviewTab.tsx:70,81`
- **Description:** `Date.now()` is called inside render paths (inside `.map()` callbacks and `useMemo`). React's concurrent rendering can call render functions multiple times, and impure functions produce different results each time, causing inconsistent UI.
- **Impact:** Countdown timers ("Available in X") may flicker or show inconsistent values. In React 19 strict mode, render may be called twice, causing the timestamp to differ between calls.
- **Recommendation:** Compute `now` once using `useMemo` with a timer-based dependency, or use `useEffect` + `useState` with a 1-second interval.

### [H-03] `as any` type assertion hides V2 guardian access bug
- **Location:** `src/components/vault/V2SecurityTab.tsx:58`
- **Description:** `(vault as any).guardian` — the `VaultInfoV2` type does NOT define a `guardian` field. V2 vaults have `sentinel` instead. This `as any` hides the fact that `vault.guardian` is `undefined` for V2 vaults.
- **Impact:** The "Guardian" role in V2SecurityTab always shows "Not assigned" (because `undefined` matches `'0x0'` check in RoleItem), even if the V2 vault has a guardian. Note: V2 contracts DO have `guardian()` in the ABI — but the TypeScript type doesn't include it, so the fetched data doesn't have it.
- **Recommendation:** Either add `guardian` to `VaultInfoV2` type and fetch it in `rpcClient.ts`, or remove the guardian display from V2SecurityTab if V2 doesn't use guardians.

### [H-04] V2 vault info returns hardcoded stubs — V2 features are non-functional
- **Location:** `src/lib/data/rpcClient.ts:228-243`
- **Description:** When a V2 vault is detected, `fetchVaultBasicInfo` returns hardcoded zero values: `sentinel: '0x0...'`, `managementFee: 0n`, `adapters: []`, `gates: { all zeroes }`. None of the V2-specific fields are actually fetched from the chain.
- **Impact:** V2AdaptersTab shows no adapters. V2SecurityTab shows sentinel as "Not assigned" even if one exists. All V2 management features are effectively broken.
- **Recommendation:** Implement actual V2 field fetching using `metaMorphoV2Abi` — at minimum read `sentinel()`, `guardian()`, and iterate adapters.

### [H-05] PendingActions on Dashboard is always empty
- **Location:** `src/pages/DashboardPage.tsx:83`
- **Description:** `<PendingActions actions={[]} />` — the component is rendered with a hardcoded empty array. There's no logic to aggregate pending actions from tracked vaults.
- **Impact:** The PendingActions component is useless — curators see no pending timelocked actions on the dashboard, defeating the purpose of the feature.
- **Recommendation:** Aggregate pending actions from all tracked vaults using `useVaultPendingActions` for each vault, merge results, and pass to the component.

### [H-06] Tab navigation state is local only — not URL-synced
- **Location:** `src/pages/VaultPage.tsx:42`
- **Description:** `const [activeTab, setActiveTab] = useState<TabId>('overview')` — tab state is in component state, not reflected in the URL. There is no route like `/vault/:chainId/:address/:tab`.
- **Impact:** Refreshing the page always resets to Overview tab. Sharing a link to a specific tab (e.g., Caps) is impossible. Browser back button doesn't navigate between tabs.
- **Recommendation:** Use URL search params (`?tab=caps`) or nested routes.

---

## Medium Findings

### [M-01] Oracle freshness scorer measures RPC latency, not oracle data staleness
- **Location:** `src/lib/oracle/oracleRiskScorer.ts:52-100`
- **Description:** The "Freshness" dimension (30% weight — the largest) scores based on `health.latencyMs` — the time it takes the RPC to return the `price()` call. This measures network latency, NOT how fresh the oracle's price data is. A Chainlink oracle that hasn't been updated in 24 hours (stale) but responds quickly to RPC calls scores 100 on freshness.
- **Impact:** The highest-weighted risk dimension is essentially measuring internet speed, not oracle risk. A dangerously stale oracle could get an "A" grade.
- **Recommendation:** Check `lastUpdate` timestamp from the oracle or Morpho Blue's `market().lastUpdate`. Compare against a staleness threshold (e.g., >1 hour = warning, >24 hours = critical).

### [M-02] No RPC call batching — excessive RPC calls per page load
- **Location:** `src/lib/data/rpcClient.ts`, `src/lib/hooks/useVault.ts`
- **Description:** Each vault page load makes 12+ individual `readContract` calls for basic info, plus N calls per market (cap, state, position, 2 token reads = 5 per market). For a vault with 5 markets, that's 12 + 25 = 37 RPC calls. Viem supports `multicall` but it's never used.
- **Impact:** Slow page loads, especially on SEI (400ms block time, limited RPC). Risk of hitting rate limits on public RPCs.
- **Recommendation:** Use viem's `multicall` to batch reads. Group all vault reads into one multicall, all market reads into another.

### [M-03] Share price history grows indefinitely in IndexedDB
- **Location:** `src/lib/risk/riskDB.ts`, `src/lib/risk/sharePriceMonitor.ts`
- **Description:** Every `checkSharePrice` call writes a new record to IndexedDB. With a 5-minute poll interval, that's 288 records/day per vault. After a year of tracking 5 vaults: ~525K records. There is no cleanup or pruning logic.
- **Impact:** IndexedDB storage grows unbounded, eventually degrading performance of IDB queries (full scans to sort by timestamp).
- **Recommendation:** Add a pruning step: after saving, delete records older than 30 days, or keep only the most recent N records per vault.

### [M-04] Custom RPC URLs stored but never used
- **Location:** `src/store/appStore.ts:81-85` (stores), `src/lib/data/rpcClient.ts:22-35` (ignores)
- **Description:** The zustand store persists `customRpcUrls` per chain, but `getPublicClient()` always reads from `chainConfig.rpcUrls[0]` and caches the client. Custom RPCs from the settings page are never applied.
- **Impact:** Users who configure custom RPCs in settings will find their configuration has no effect.
- **Recommendation:** Check `appStore.customRpcUrls[chainId]` in `getPublicClient()` before falling back to chain config.

### [M-05] Hardcoded SEI chain ID 1329 scattered across codebase
- **Location:** `src/config/wagmi.ts:10`, `src/components/migration/UsdcMigrationBanner.tsx:22`, `src/lib/scanner/marketScanner.ts:402`, `src/pages/MarketsPage.tsx:19`, `src/pages/DashboardPage.tsx:21,40`
- **Description:** The chain ID `1329` appears as a magic number in 6 files outside of `chains.ts`. This should come from config or a named constant.
- **Impact:** If SEI chain ID ever changes (unlikely but possible in testnets) or if the app needs to support a different default chain, every occurrence must be found and updated.
- **Recommendation:** Export `DEFAULT_CHAIN_ID` from config and use it everywhere.

### [M-06] `formatTokenAmount` called with hardcoded decimals throughout
- **Location:** `CapsTab.tsx:136-137`, `ReallocateTab.tsx:149,166,170,184`, `MarketsTab.tsx:57,115,118`
- **Description:** Multiple components call `formatTokenAmount(x, 6)` with a hardcoded `6` for decimals instead of reading the actual vault asset decimals. This only works correctly for USDC.
- **Impact:** Token amounts display incorrectly for non-6-decimal assets (DAI 18 decimals, WBTC 8 decimals).
- **Recommendation:** Pass asset decimals through context or props from the vault info.

### [M-07] V2SecurityTab tries to use V1 supply/withdraw queues
- **Location:** `src/components/vault/V2SecurityTab.tsx:19-22`
- **Description:** Uses `useVaultAllocation()` which internally calls `fetchVaultQueues()` — but for V2 vaults, this returns empty arrays. The `marketIds` derived from queues will always be `undefined`, so pending cap checks per-market never execute.
- **Impact:** V2SecurityTab shows "No pending actions" even when there are pending caps on V2 markets.
- **Recommendation:** V2 needs a different mechanism to enumerate markets/adapters, or the pending actions check should use a V2-specific query.

---

## Low Findings

### [L-01] TrackedVault address comparison is case-sensitive
- **Location:** `src/store/appStore.ts:48`
- **Description:** `v.address === vault.address` — Ethereum addresses can be mixed-case (EIP-55 checksum). The same vault could be tracked twice if added with different casing.
- **Recommendation:** Compare with `.toLowerCase()`.

### [L-02] Supply cap precision loss for very large values
- **Location:** `src/components/vault/steps/MarketsStep.tsx:79-81`
- **Description:** `BigInt(Math.round(Number(m.supplyCap) * 10 ** state.assetDecimals))` — `Number()` loses precision for values above 2^53. For an 18-decimal token, any cap above ~9,007 tokens would have rounding errors.
- **Recommendation:** Use string-based decimal parsing instead of floating point.

### [L-03] WalletConnect project ID fallback is invalid
- **Location:** `src/config/wagmi.ts:25`
- **Description:** `'morpho-curator-dev'` is not a valid WalletConnect Cloud project ID. If `VITE_WALLETCONNECT_PROJECT_ID` env var is not set, WalletConnect will fail.
- **Recommendation:** Document the required env var. Remove the fallback or use a real project ID.

### [L-04] No error UI for most async operations
- **Location:** Throughout — `useVaultInfo`, `useVaultAllocation`, `useVaultMarkets`, `useSharePrice`, etc.
- **Description:** TanStack Query hooks return `error` state, but most components only check `isLoading` and `data`. When an RPC call fails, the user sees either a perpetual loading spinner or empty data with no error message.
- **Recommendation:** Add error states to data-fetching components showing the error and a retry button.

### [L-05] Missing `queryKey` serialization for array values
- **Location:** `src/lib/hooks/useVault.ts:101`
- **Description:** `queryKey: ['vault-markets', chainId, marketIds]` — `marketIds` is an array. TanStack Query deep-compares arrays, but if the array is reconstructed on every render (common with `useMemo` returning a new array), it triggers unnecessary refetches.
- **Recommendation:** Sort and join market IDs into a string for the query key: `marketIds?.sort().join(',')`.

### [L-06] Infura API key exposed in source code
- **Location:** `src/config/wagmi.ts:15,29`, `src/config/chains.ts:21`
- **Description:** Infura API key `70fde4d039af47d6b5ce31de9d8710a8` is hardcoded in source. This will be in the client bundle and visible to anyone.
- **Recommendation:** Move to environment variable (`VITE_SEI_RPC_URL`). Infura keys in client-side code should have origin restrictions configured.

### [L-07] Oracle classifier unreachable RedStone path
- **Location:** `src/lib/oracle/oracleClassifier.ts:94-106`
- **Description:** The RedStone check (`hasLatestAnswer && !hasLatestRoundData`) is only reached if `hasLatestRoundData` is false. But the earlier Chainlink check (line 68) already matches on `hasLatestAnswer` alone, so any oracle with `latestAnswer()` in bytecode is classified as Chainlink before RedStone is checked.
- **Recommendation:** Restructure: check for RedStone-specific patterns first, or use additional heuristics (e.g., RedStone bytecode signatures).

---

## Info / Recommendations

### [I-01] Bundle size — main chunk exceeds 1 MB
- The main JS chunk is 1,073 kB. Consider code-splitting with `React.lazy()` for routes (e.g., CreateVaultPage, MarketsPage) and moving heavy dependencies (viem) to a vendor chunk.

### [I-02] APY calculation not implemented
- `useVaultMarkets` returns `supplyAPY: 0, borrowAPY: 0` with a TODO. This is displayed in markets but always shows 0%.

### [I-03] Duplicate vault version detection logic
- `src/lib/vault/vaultVersion.ts` and `src/lib/data/rpcClient.ts:135-186` both implement vault version detection with slightly different approaches. One uses raw `client.call` with selector, the other uses `readContract`. Should consolidate.

### [I-04] No vault discovery beyond manual entry
- GraphQL-based vault discovery for Ethereum/Base and event-scan vault discovery for SEI are not implemented. Only manual address entry and the known Feather USDC vault are available.

### [I-05] Markets store uses implicit key path
- `src/lib/indexer/indexedDB.ts:87` — `db.createObjectStore('markets', { keyPath: undefined })` creates a store without an explicit key path, requiring manual key management. This is fragile; consider using a composite key path like `'chainId:marketId'`.

### [I-06] `createPublicClient` called per-function in oracle/risk modules
- `oracleClassifier.ts`, `oracleMonitor.ts`, `utilizationMonitor.ts`, `sharePriceMonitor.ts`, `usdcMigration.ts`, `vaultVersion.ts` all create new `PublicClient` instances instead of using the cached `getPublicClient()` from `rpcClient.ts`. This means no connection reuse.

---

## Appendix A: Address Verification Results

### Ethereum (Chain ID 1)
| Contract | chains.ts | Morpho Docs | Match |
|----------|-----------|-------------|-------|
| Morpho Blue | `0xBBBBBbbBBb9cc5e90e3b3Af64bdAF62C37EEFFCb` | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | YES (checksum differs, same address) |
| V1 Factory | `0x1897A8997241C1cD4bD0698647e4EB7213535c24` | `0x1897A8997241C1cD4bD0698647e4EB7213535c24` | YES |
| V2 Factory | `0xA1D94F746dEfa1928926b84fB2596c06926C0405` | `0xA1D94F746dEfa1928926b84fB2596c06926C0405` | YES |
| AdaptiveCurveIrm | `0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC` | `0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC` | YES |
| PublicAllocator | `0xfd32fA2ca22c76dD6E550706Ad913FC6CE91c75D` | `0xfd32fA2ca22c76dD6E550706Ad913FC6CE91c75D` | YES |
| OracleV2Factory | `0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766` | `0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766` | YES |
| Bundler3 | `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245` | Not in excerpt | UNVERIFIED |

### Base (Chain ID 8453)
| Contract | chains.ts | Morpho Docs | Match |
|----------|-----------|-------------|-------|
| Morpho Blue | `0xBBBBBbbBBb9cc5e90e3b3Af64bdAF62C37EEFFCb` | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | YES |
| V1 Factory | `0xFf62A7c278C62eD665133147129245053Bbf5918` | `0xFf62A7c278C62eD665133147129245053Bbf5918` | YES |
| V2 Factory | **MISSING** | `0x4501125508079A99ebBebCE205DeC9593C2b5857` | **MISSING** (see C-05) |
| AdaptiveCurveIrm | `0x46415998764C29aB2a25CbeA6254146D50D22687` | `0x46415998764C29aB2a25CbeA6254146D50D22687` | YES |
| PublicAllocator | `0xA090dD1a701408Df1d4d0B85b716c87565f90467` | `0xA090dD1a701408Df1d4d0B85b716c87565f90467` | YES |
| OracleV2Factory | `0x2DC205F24BCb6B311E5cdf0745B0741648Aebd3d` | `0x2DC205F24BCb6B311E5cdf0745B0741648Aebd3d` | YES |

### SEI (Chain ID 1329)
- Not indexed by Morpho official docs. Addresses previously verified on-chain.
- No V2 factory (correct — V2 not deployed on SEI).
- No hardcoded addresses found outside `chains.ts` (clean).

---

## Appendix B: ABI Verification Results

### Morpho Blue Core (`morphoBlueAbi`)
| Function | Parameter Types | Return Types | Verified |
|----------|----------------|--------------|----------|
| `market(bytes32)` | bytes32 | (uint128 x6) | YES — matches Solidity |
| `idToMarketParams(bytes32)` | bytes32 | tuple(5 fields) | YES |
| `position(bytes32,address)` | bytes32, address | (uint256, uint128, uint128) | YES |
| `CreateMarket` event | indexed bytes32, tuple | — | YES |

### MetaMorpho V1 (`metaMorphoV1Abi`)
| Function | Verified | Notes |
|----------|----------|-------|
| `submitCap(MarketParams,uint256)` | YES | Takes MarketParams tuple, not bytes32 |
| `acceptCap(MarketParams)` | YES | Takes MarketParams tuple, not bytes32 |
| `setSupplyQueue(bytes32[])` | YES | Takes market IDs array |
| `updateWithdrawQueue(uint256[])` | YES | Takes index permutation |
| `reallocate(tuple[])` | YES | Takes MarketAllocation array |
| `pendingCap(bytes32)` | YES | Returns (uint192, uint64) |
| `config(bytes32)` | YES | Returns (uint184, bool, uint64) |
| `pendingGuardian()` | YES | Returns (address, uint96) |

### MetaMorpho V2 (`metaMorphoV2Abi`)
| Function | Verified | Notes |
|----------|----------|-------|
| `submitCap(bytes32,uint256)` | PLAUSIBLE | V2 uses bytes32 ID, not MarketParams |
| `acceptCap(bytes32)` | PLAUSIBLE | Consistent with V2 pattern |
| `forceDeallocate(bytes32,uint256)` | PLAUSIBLE | Based on docs — verify against deployed bytecode |
| `sentinel()` | PLAUSIBLE | V2-specific role |

### Market ID Computation
- **Location:** `src/lib/vault/createVault.ts:65-78`
- Uses `keccak256(encodeAbiParameters([address,address,address,address,uint256], [...]))` — **CORRECT**. Matches Morpho Blue's on-chain computation exactly.

### Fee Encoding
- **Location:** `src/lib/vault/createVault.ts:298-300`
- `feePercentToWad(percent) = BigInt(Math.round(percent * 1e16))` — this computes `percent * 1e18 / 100` correctly. 15% -> `150000000000000000n` (0.15e18). **CORRECT**.

### Vault Creation Transaction Sequence
- **Location:** `src/lib/vault/createVault.ts:106-292`
- Deploy first, then role config, then caps, then queues, then timelock increase. **CORRECT**.
- `submitCap` sends `MarketParams` struct (V1). **CORRECT**.
- `acceptCap` sends `MarketParams` struct (V1). **CORRECT**.
- If `initialTimelock = 0`, no `acceptCap` steps generated. **CORRECT**.
- If `initialTimelock > 0`, `acceptCap` steps generated with `requiresWait`. **CORRECT**.
- `setSupplyQueue` sends `bytes32[]` market IDs. **CORRECT**.
- `updateWithdrawQueue` sends index permutation (`BigInt(i)`). **CORRECT**.
- Timelock increase via `submitTimelock` — instant for increases. **CORRECT** (no `acceptTimelock` generated).

---

## Appendix C: Validation Checklist

- [x] Build passes clean (`tsc --noEmit` + `npm run build`)
- [x] All Ethereum addresses in chains.ts verified against Morpho docs
- [x] All Base addresses verified (except MISSING V2 factory — see C-05)
- [x] No hardcoded contract addresses outside chains.ts
- [x] All V1 ABIs verified against Solidity interfaces
- [ ] V2 ABI needs verification against deployed bytecode
- [x] Fee encoding: percentage -> WAD correct (`feePercentToWad`)
- [x] Cap encoding in wizard: human units -> raw units correct (uses asset decimals)
- [ ] **Cap encoding in CapsTab: HARDCODED 6 decimals — WRONG (C-01)**
- [ ] **Cap encoding in ReallocateTab: HARDCODED 6 decimals — WRONG (C-02)**
- [x] Market ID: uses `encodeAbiParameters` not `encodePacked`
- [x] Vault creation tx order is correct
- [x] Timelock=0 path: no accept steps generated
- [x] Timelock>0 path: accept steps generated with wait
- [x] `submitCap` V1 sends MarketParams, not bytes32
- [x] `acceptCap` V1 sends MarketParams, not bytes32
- [x] `updateWithdrawQueue` sends index permutation, not market IDs
- [x] `setSupplyQueue` sends bytes32 market IDs, not MarketParams
- [x] Oracle classifier handles unknown/EOA oracles gracefully (returns "Custom Oracle")
- [x] Oracle risk scorer dimensions sum to 100% (30+25+20+15+10=100)
- [ ] **Oracle scorer freshness dimension measures wrong thing (M-01)**
- [ ] **Conditional hook call in OverviewTab (H-01)**
- [ ] **Date.now() in render (H-02)**
- [ ] No error UI for most async operations (L-04)
- [x] All lists have empty states
- [x] All data views have loading states (skeletons)
- [ ] **Chain mismatch does NOT block write operations (C-04)**
- [ ] **`as any` in V2SecurityTab (H-03)**
- [x] `npm audit` shows 0 vulnerabilities
- [x] IndexedDB schema versioning uses separate DBs (v1 each)
- [x] SEI works without GraphQL dependency
- [x] Share price uses `convertToAssets(1e18)` not `convertToAssets(1)`
