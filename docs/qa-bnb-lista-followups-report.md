# QA Report — BNB/Lista Moolah Rework + 4 Follow-ups

**Date:** 2026-04-15
**Scope:** 10-stage Moolah rework (commits `e7975e4…4c6ee52`) + 4 follow-ups
(commits `5af8e45 · be741e0 · d4c8a37 · 24cfae7`).
**Mode:** Read-only audit. No code changes. Findings drive a separate fix
sprint.

---

## 1. Summary

| Severity | Count |
|---|---|
| Critical | **3** |
| High     | **7** |
| Medium   | **9** |
| Low      | **8** |
| **Total** | **27** |

- `npx tsc --noEmit` → **clean**
- `npm run build` → **clean**
- `npx vitest run src/lib/timelock` → **5/5 passing**
- All 10 rework subsystems + all 4 follow-up subsystems present in the tree.

**Pass rate** on static probes: ~83% (22/27 probes pass cleanly; 5 require
live-network verification — see § 5 gaps).

**Overall verdict:** the rework is structurally sound and builds cleanly,
but two safety-relevant regressions need to land before production: write
buttons stay active on blacklisted Moolah vaults (C-1), and the BSC log
window is ~180× wider than typical public-RPC limits, so external
proposals from Safe / CLI disappear from the Pending Proposals panel
silently (H-1). The remaining issues are UX polish and edge-case
hardening.

---

## 2. Findings

Severity rubric:

- **Critical** — silent write failure, data corruption, wrong decode, or
  cross-chain contamination.
- **High** — broken flow, confusing UX, or flavor-leak that breaks a
  common curator action.
- **Medium** — suboptimal UX, missing warning, rare edge case.
- **Low** — polish, dead code, minor labelling, test gaps.

### 2.1 Findings table

| ID | Sev | Phase | Title | File : line | Repro / evidence | Suggested fix |
|---|---|---|---|---|---|---|
| **C-1** | Critical | 8 | Writes still reachable on blacklisted vaults | `src/pages/VaultPage.tsx:191-202` (banner only); `CapsTab.tsx`, `QueuesTab.tsx`, `ReallocateTab.tsx`, `RolesMoolah.tsx` all ignore `isBlacklisted` | `useIsVaultBlacklisted` returns `true` → red banner appears, but nothing else reads the flag. Curator can still propose caps / queue edits; the schedule tx will revert on-chain with no pre-flight signal. | Plumb `isBlacklisted` through to the write hooks (`useVaultWrite` result) and disable the relevant buttons with a tooltip "Vault blacklisted by Lista". |
| **C-2** | Critical | 5 | Salt dropped when reconstructing proposals from `CallScheduled` events | `src/lib/vault/proposals.ts:187-190` | OZ `CallScheduled` event signature is `(id, index, target, value, data, predecessor, delay)` — **no salt**. Reconstructed proposals default salt to `0x00…00`. If the original scheduler used a non-zero salt, `timelock.execute(target,value,data,predecessor,salt)` will compute a different id and revert. Our own app-submitted ops have a non-zero deterministic salt (`makeSalt`) but are served from the `scheduledOps` cache, which masks the bug. Any Safe / CLI proposal with a non-zero salt will be un-executable from our UI. | Merge by opId: when the local cache has an entry whose `opId` equals the event-derived `opId`, prefer the local copy (it has the real salt). For events with no local match + non-zero salt, surface an "External op — execute from scheduling wallet" warning and gate the Execute button. |
| **C-3** | Critical | 7 / 9 | `MetaMorpho V1` ABI entry is a chain-wide catch-all | `src/lib/timelock/abiRegistry.ts:66` | `match: (_target, chainId) => getChainConfig(chainId) !== undefined` — matches every valid chain. On Moolah chains both `MoolahVault` and `MetaMorpho V1` match, so the fall-through order guarantees a decode for common MM-style setters (intended). **But** any future MoolahVault-only setter that happens to collide with an MM V1 selector will be decoded as the MM function silently. Wrong decode > no decode. The decoder also has no integrity check that the decoded tuple shape matches on-chain calldata length. | Restrict MM V1 to MM chains (`config.protocol === 'morpho'`) OR scope to targets recognised as MetaMorpho vaults. Add a selector denylist for known-collision hot-spots. |
| **H-1** | High | 5 | BSC log window far exceeds public-node limits | `src/lib/vault/proposals.ts:91` | `BSC_LOG_WINDOW = 900_000n` (~30 days). `bsc-dataseed*.binance.org` and `bsc.publicnode.com` cap `eth_getLogs` at ≤5k blocks. The wide query throws and the code falls back to `seed-only` at `proposals.ts:163-166` — so the app sees only its own proposals. External Safe / CLI proposals become invisible with no UX signal. | Cap BSC at 5000 blocks (or chunk + paginate). Surface a "Historic proposals truncated — run full scan" control when the window is tight. Consider using a BSC-aware indexer (BscScan API) for the wider window. |
| **H-2** | High | 5 | `formatCountdown` only re-runs on React Query refetch (every 30 s) | `src/components/vault/moolah/PendingProposalsPanel.tsx:200, 262-269` | Countdown is a pure function called in the render; the parent has `refetchInterval: 30_000`. "Ready in 1h 23m" stays frozen for 30 s, then jumps. Spec asks for live-updating timer. | Add a `useEffect(() => setInterval(forceUpdate, 1000), [])` in `ProposalRow`, or lift a `nowSeconds` state in the panel. |
| **H-3** | High | 4 | Expired proposals render as "Scheduled on-chain, fetching…" | `src/components/vault/moolah/PendingProposalsPanel.tsx:222-225` | OZ TimelockController expires an op silently after `delay + DONE_TIMESTAMP + 7 d grace`. `getTimestamp(id)` returns `0n` for expired AND never-scheduled. Current UI shows "fetching…" for both. Curator can't tell that an op died of old age. | Track `scheduledAt` (already in local cache) + delay; if `now > scheduledAt + delay + GRACE_PERIOD` and `getTimestamp == 0`, render "Expired" distinctly. |
| **H-4** | High | 3 | `pendingTimelock` / `pendingGuardian` absent from `VaultSnapshot` | `src/lib/vault/adapter.ts:46-88` (type), `readSnapshotMetaMorphoV1` `291-311` | Legacy `fetchV1VaultInfo` + `fetchPendingTimelock` / `fetchPendingGuardian` still power `useVaultPendingActions` and `PendingActionsBanner` on MM chains. UI that reaches for the new snapshot's `timelocks[0].pending` (typed but never populated) gets `undefined`. Not a regression on MM today because the old path is unchanged — but a time bomb as other surfaces migrate. | Either populate `timelocks[0].pending` in `readSnapshotMetaMorphoV1` (preferred) or document the snapshot as not-authoritative for pending state. |
| **H-5** | High | 9 | Decoder hint amount formatter trusts `vaultAssetDecimals` from the **target vault**, which for cross-vault proposals may be wrong | `src/components/vault/moolah/ProposalContents.tsx:30-37`, `hints.ts:85-93` | The hint passes `vaultAssetDecimals` from the surrounding page's vault snapshot. If a proposal's calldata touches a *different* vault (e.g., fee-recipient of a different MoolahVault), the decimals hint is silently wrong. Per spec: wrong decimals are the most dangerous failure mode. The code does fall back to `(decimals unknown)` when no hint is registered, so most routes are safe — but `submitCap` etc. have a hint registered unconditionally. | Re-probe the target vault's `decimals()` lazily, or restrict the amount hint to cases where `ctx.target === snapshot.address`. |
| **H-6** | High | 7 | Fixed-term broker dropdown shows all 19 brokers regardless of selected loan token | `src/components/market/MarketForm.tsx:333-344` | Dropdown renders `brokers.map(...)` with no filter. Curator can pick WBNB/lisUSD while the form's loan token is USD1 → contract reverts, gas wasted, confusing error. Helper `getBrokersForLoanSymbol` exists in `src/config/moolah.ts` but isn't used. | Filter: `brokers.filter(b => b.loanSymbol === loanMeta?.symbol)` or pre-fill the loan token from broker selection. |
| **H-7** | High | 6 | Fixed-term form skips the 18-decimal preflight that protects vault deploy | `src/components/market/MarketForm.tsx:192-197` | `isFixedValid` only checks broker / rateCalc / APR range. Asset 18-dec is enforced on `buildMoolahDeploymentTxSequence` but not here. A fixed-term market with a non-18-dec loan token will revert on the factory call. | Add `loanMeta?.decimals === 18` (and `collatMeta?.decimals === 18`) to `isFixedValid`, or read it from the broker config and verify at submit time. |
| **M-1** | Medium | 3 | `admin: adminMembers[0] ?? ZERO_ADDRESS` leaks zero to UI | `src/lib/vault/adapter.ts:228` | `RolesMoolah` falls back to `chainConfig.moolah.vaultAdmin` at `RolesMoolah.tsx:47-49` — good — but other consumers of the snapshot (decoder label resolver, governance card) will read the ZERO and render as "not assigned". | Change type to `admin: Address \| null` and force every consumer to handle null explicitly. |
| **M-2** | Medium | 7 | `addTrackedVault` does not tag the new vault's flavor | `src/components/vault/steps/DeployStep.tsx:306-311` | `TrackedVault` type has no `flavor` field (see `src/store/appStore.ts:6-11`), so the miss is unavoidable today. Re-detection fires on next load. Not an immediate regression — but a missed opportunity to eliminate the probe. | Extend `TrackedVault` with an optional `flavor` + use it as a cheap seed for `useVaultFlavor`. |
| **M-3** | Medium | 4 | `setManager` intent has a broken direct path | `src/lib/vault/writes.ts:363-367` | `directMetaMorpho` for `setManager` casts `'setManager' as unknown as 'asset'` and targets `moolahVaultAbi`, which does **not** expose a `setManager` function. `moolahVaultAbi` (src/lib/contracts/moolahAbis.ts) has no setter ABI at all — only reads. If `setManager` is ever routed `direct` on a MetaMorpho vault, viem will throw at encode time. Currently the intent is only emitted by TimelockController proposals (routing `'curator'`), so the dead branch never runs — but it's a landmine. | Either add `setManager` to a proper ABI or remove the direct branch and assert that `setManager` is Moolah-only. |
| **M-4** | Medium | 4 | Routing uses MetaMorpho setter names for scheduled calls targeting MoolahVault | `src/lib/vault/writes.ts:103-152` (`encodeVaultCall`) | `submitCap` / `acceptCap` / `setCurator` are MM V1 names. MoolahVault inherits these (per SBC claims) but nothing in the code verifies the selector exists on the target. If Moolah ever renames or removes one, the propose will schedule a reverting call (schedule succeeds, execute reverts at `delay` later). | Simulate the calldata against the target before scheduling (cheap `estimateGas` or `call`). Already possible because we have a `PublicClient` in `prepareWrite`. |
| **M-5** | Medium | 4 | Cancel button inactive when `timelock.cancellers` enumeration fails | `src/components/vault/moolah/PendingProposalsPanel.tsx:145-150`; `adapter.ts:203-205` | `enumerateRole` returns `[]` on any read error (network, RPC quirk). A valid `CANCELLER_ROLE` holder then sees Cancel disabled with no hint. | Separately check `hasRole(CANCELLER_ROLE, account)` when the enumerated list is empty AND `account` is connected. |
| **M-6** | Medium | 9 | `RestrictedListsCard` disclaimer only shows when the card renders | `src/components/vault/ProtocolTab.tsx:195-306` | Card early-returns `null` when nothing is blacklisted (`hasAnything === false`), so the disclaimer "Only known candidates are probed…" (line 297) never appears in the clean-state case. DC4 asks for the disclaimer to be explicit. | Render an always-on empty-state body with the disclaimer. |
| **M-7** | Medium | 8 | Min-loan warning tied to a stablecoin allowlist of 6 symbols | `src/components/vault/ReallocateTab.tsx:36` | `STABLECOIN_SYMBOLS = {USDT, USD1, lisUSD, USDC, DAI, USDe}`. FDUSD / BUSD are not included; other fork stables are missed. DC3 allows silent hide, so this is a polish item, not a correctness issue. | Either add a chain-level token-metadata table (`isStablecoin`) or read a "price ≈ 1 USD" flag from a token registry. |
| **M-8** | Medium | 5 | `opId` fallback keccak does not exactly match OZ's `abi.encode` padding | `src/lib/vault/writes.ts:398-411` | `computeOpIdFallback` uses `concat([toHex(target,{size:32}), toHex(value,{size:32}), data, predecessor, salt])`. OZ v4 encodes `(address, uint256, bytes, bytes32, bytes32)` — `bytes` is length-prefixed in ABI encoding, not raw-concatenated. Hashes will diverge. The code prefers the on-chain `hashOperation` path; the fallback runs only when the timelock isn't reachable. | Use `encodeAbiParameters` to match OZ exactly; or drop the fallback and treat "couldn't reach timelock" as fatal. |
| **M-9** | Medium | 2 | Flavor probe races: UI renders placeholder-flavor for ~100 ms | `src/lib/vault/flavor.ts:105-107` (`placeholderData`); consumers in `RoleManagement.tsx:23-32`, `GuardianTab.tsx:17-30` | `placeholderData` seeds from chain default; the probe then confirms. On a vault whose runtime flavor differs from the chain default (MetaMorpho on BNB, or a Moolah vault on ETH), the UI will briefly render the wrong layout before flipping. Cosmetic, but confusing. | Gate the card render on `query.status !== 'pending'` OR add a skeleton state until the probe resolves. |
| **L-1** | Low | 4 | Multiple `as never` / `as unknown as` casts in `useVaultWrite` | `src/hooks/useVaultWrite.ts:108-110`; `src/lib/vault/writes.ts:366`; `src/lib/vault/adapter.ts:128,137` | Type-erased casts work around wagmi's strict `writeContract` union. Survivable but opaque to future maintainers. | Collapse to a single helper `writeAny(prepared)` with the casts localized. |
| **L-2** | Low | 9 | Decoder address resolver does not include broker contracts | `src/lib/timelock/hints.ts:86-143` | Known addresses enumerated: tokens, vaults, singleton, factory, liquidators, revenue, providers, roles, periphery. Not enumerated: `MOOLAH_BROKERS` entries. Proposals that touch a broker render raw hex. | Add a loop over `MOOLAH_BROKERS[chainId]` in `resolveAddressLabel`. |
| **L-3** | Low | 5 | `canExecute` OR-of clauses includes "open execute" via zero-address sentinel | `src/components/vault/moolah/PendingProposalsPanel.tsx:151-158` | Correct logic (OZ v4: `address(0)` in `EXECUTOR_ROLE` means open execution) but slightly unusual — worth a code comment describing why the sentinel is checked in the same list as real accounts. | Add a one-line comment. |
| **L-4** | Low | 2 | `getDefaultVaultFlavor` assumes all chains have a sensible default | `src/config/chains.ts:320-329` | Pharos (1672) defaults to `metaMorphoV1` while `deployed: false`. Probes on Pharos vaults won't fire (chain-gated upstream), but `getDefaultVaultFlavor(1672, …)` returns `'metaMorphoV1'` which is at least safe. | Add `defaultVaultFlavor: undefined` and short-circuit to null on `!deployed`. |
| **L-5** | Low | 7 | `ProtocolStateCard` renders singleton + impl unconditionally but omits `minLoanValue` / `defaultMarketFee` when zero | `src/components/vault/ProtocolTab.tsx:88-126` | Inconsistent rendering policy: some rows always show, others omit on zero. Low-impact but jars on the Protocol tab. | Pick one policy (recommend: always show, mark zeros as "not set"). |
| **L-6** | Low | 8 | `VaultCard` applies `opacity-50 grayscale` but still makes the whole card hover-clickable | `src/components/vault/VaultCard.tsx:104-110` | Visual signals "read only" but the click still navigates. Intentional per spec (click to inspect), but the hover border still flashes accent-primary on a dead card. | Kill hover styles when `isBlacklisted`. |
| **L-7** | Low | 9 | No test coverage for decoder amount-hint + tuple-array decoding | `src/lib/timelock/__tests__/decodeCall.test.ts` | 5 tests cover happy paths + unknown selector + scheduleBatch. Missing: MarketParams tuple rendering, wrong-decimals hint path, resolveAddressLabel round-trip. | Add targeted unit tests. |
| **L-8** | Low | 11 | Dead re-export in `decodeCall.ts` | `src/lib/timelock/decodeCall.ts` — earlier rev had `decodeCallWithCtx` + batch-context; current file ships without any dead exports. | Verified clean after the rewrite; flagging only as a reminder to check during fix sprint. | — |

---

## 3. Architectural concerns

These aren't bugs today but shape the risk surface.

### 3.1 Write router coupling to MetaMorpho selector names

`src/lib/vault/writes.ts` reuses MM V1 selector names (`submitCap`,
`setCurator`, `updateWithdrawQueue`, …) for calls that will be executed
against **MoolahVault**. MoolahVault appears to inherit the same signatures
today, but the code never verifies. A single renamed selector in a future
Moolah upgrade turns every scheduled op into a delayed revert. Consider
either (a) a simulation preflight before `schedule()` or (b) a separate
`moolahVaultWriteAbi` that is authoritative for calldata encoding.

### 3.2 Flavor coupling in the ABI registry

`abiRegistry.ts`'s `MoolahVault` match predicate is `config.protocol === 'moolah'`
(line 46). That's fine *today* because we only detect flavor per-vault via
the probe. But the registry match is **per-chain**, so on BNB **every**
decoded call routes through MoolahVault first, even if the target is
accidentally a MetaMorpho clone deployed on BNB. Scope the predicate to the
vault's detected flavor, not the chain's default.

### 3.3 `PausedBanner` is visual-only

`src/components/layout/PausedBanner.tsx` surfaces the pause state but does
not gate writes. Spec called for writes to be disabled across the app while
paused. Today a curator can still sign a propose, and the tx reverts
on-chain. Recommend feeding `isPaused` into `useVaultWrite` and disabling
`submit` at the hook level.

### 3.4 Legacy `fetchVaultBasicInfo` + new `VaultSnapshot` duplicate read layer

Two read pipelines coexist: the legacy V1/V2 shape for most consumers and
the new snapshot for Roles / Protocol / Pending Proposals. They can
disagree on BNB today (the snapshot reads role members live; legacy reads
the Moolah-fallback shape). Plan a migration window to retire the legacy
path; otherwise features that split across them (fee management, timelock
management on BNB — currently hidden) will grow subtle divergences.

### 3.5 Scheduled-op cache is append-mostly

`appStore.scheduledOps` is capped at 500 entries (FIFO). Execute + cancel
remove entries (`PendingProposalsPanel.tsx:167-170`), but externally
executed ops leak — they'll sit in the cache until eviction. A periodic
`removeIfDone` based on the `CallExecuted`/`Cancelled` scan would keep the
cache tight.

---

## 4. Positive observations

Don't destabilise these in the fix sprint.

- **Flavor detection logic** is correct and cache-safe
  (`useVaultFlavor` uses `staleTime: Infinity` + `placeholderData`).
  `detectVaultFlavor` handles the hybrid-contract edge with a clear rule:
  Moolah wins because MetaMorpho doesn't implement AccessControl
  (`src/lib/vault/flavor.ts:72-81`). Documented inline.
- **MoolahVault adapter** correctly enumerates BOTH manager + curator
  TimeLocks with their PROPOSER / EXECUTOR / CANCELLER holders
  (`adapter.ts:194-213`) and reads the EIP-1967 implementation slot for
  protocol-level observability (`adapter.ts:99-109`). Full `PROPOSER_ROLE`
  constant used — no silent role-keccak mismatch.
- **MarketFactory resolver** short-circuits correctly to the hardcoded
  config on the hot path (DC5 confirmed) — hardcoded
  `0xce26859127d236a61f168d2d0905f77d7E286Ab2` matches Lista docs +
  on-chain ERC1967 slot.
- **Fixed-term form** scope is right: no `term` field in `BrokerInfo`
  (DC1), no `oracle` input in the struct (DC2), `maxRatePerSecond =
  2 × ratePerSecond` computed consistently (`MarketForm.tsx:182-183`).
- **Deploy path** enforces 18-dec asset + ≥1-day delay (`createVault.ts:567-577`,
  `DeployStep.tsx:131-134`). Captures all 3 returned addresses from
  `VaultCreated` event (`createVault.ts:617-645`), auto-tracks the vault.
- **Guardian redirect on Moolah** renders a clear redirect to Pending
  Proposals and explains the CANCELLER_ROLE model; the MM revokePending*
  UI is correctly unreachable on Moolah
  (`GuardianTab.tsx:29-68`).
- **Decoder fallback** is safe: `UnknownCall` renders a warning banner +
  raw-calldata expander + BscScan link; no partial decode
  (`ProposalContents.tsx:270-308`).
- **Decoder unit tests** cover the 5 highest-value paths and pass
  deterministically (15 ms total).
- **Cross-chain regression** holds: ETH / Base / SEI keep
  `protocol: 'morpho'`, `defaultVaultFlavor: 'metaMorphoV1'`; Pharos keeps
  `deployed: false`; the `protocols: ['moolah']` tab gate on Protocol tab
  means ETH vaults never see it.
- **`tsc --noEmit` is clean**; **`npm run build` is clean**.

---

## 5. Test-coverage gaps

Manual / live-network verification required before release. Items marked
`MV*` map to the Phase 11.6 checklist.

1. **MV1 — Fixed-term deploy simulation on live BNB**. Requires a
   wallet-connected session. Static preconditions verified: ABI matches
   `createFixedTermMarket`, `aprPercentToRatePerSecond` math is correct,
   OPERATOR gating renders the banner on `hasRole === false`. **Status:
   pending manual verification.**
2. **MV2 — Protocol tab role probe vs BscScan cross-check**. Requires live
   BscScan + wallet. Static verified: role constants use
   `keccak256('MANAGER')` / `keccak256('PAUSER')` (not the MM V1
   `_ROLE`-suffixed form), matching Moolah's contract convention
   (`ProtocolTab.tsx:20-24`). **Status: pending manual verification.**
3. **MV3 — MarketFactory address cross-check**. Static pass: proxy matches
   Lista docs + on-chain ERC1967 slot (confirmed in commit `d4c8a37`).
   **Status: pass (static).**
4. **MV4 — Decoder correctness on a real proposal**. Requires a live
   BNB vault with a pending proposal. Static: unit tests cover the five
   classes of decodes, but no BscScan-comparison for a live op. **Status:
   pending manual verification.**
5. Wrong-decimals rendering in `ProposalContents` — no automated test.
6. `RolesMoolah` empty-state (vault whose CURATOR role has zero members) —
   no automated test.
7. `PendingProposalsPanel` with >5 ops per timelock (layout stress) — not
   verified.
8. Mobile / narrow-screen layouts for the Protocol tab and the Pending
   Proposals rows — not verified.

---

## 6. Fix-sprint recommendations

Suggested batching into three rounds.

### Round 1 — Safety-critical (blocks release)

| # | Finding | Why first |
|---|---|---|
| 1 | **C-1** Writes reachable on blacklisted vaults | Avoids the curator signing transactions that will always revert — and makes the banner's promise real. |
| 2 | **C-2** Salt dropped in event reconstruction | Breaks Execute for any externally-scheduled op (Safe / CLI / any other curator tool). |
| 3 | **H-1** BSC log window vs RPC limit | External proposals disappear silently; closely coupled to C-2. |
| 4 | **H-7** Fixed-term 18-dec preflight | Wasted tx + bad UX on simulate; cheap to add. |
| 5 | **H-6** Broker dropdown filter | Same reason as H-7 — wasted tx protection. |

### Round 2 — UX + correctness polish

| # | Finding | Why |
|---|---|---|
| 1 | **H-2** Live countdown | Visible regression vs MetaMorpho's instant-feedback flow. |
| 2 | **H-3** Expired-op rendering | Eliminates the "fetching…" confusion. |
| 3 | **H-5** Amount-hint source | Closes a wrong-decode risk. |
| 4 | **H-4** `pendingTimelock` / `pendingGuardian` in snapshot | Unblocks future snapshot-only consumers. |
| 5 | **C-3** ABI catch-all scoping | Future-proofs the decoder against Moolah upgrades. |
| 6 | **M-5** Cancel fallback gating | Useful when RPC flakes. |
| 7 | **M-1** `admin` null propagation | Tightens the null semantics. |

### Round 3 — Polish + tests

- M-2 (flavor seed in tracked vaults)
- M-3 (dead `setManager` direct path)
- M-4 (simulation preflight for schedules)
- M-6 (`RestrictedListsCard` always-on disclaimer)
- M-7 (broader stablecoin allowlist)
- M-8 (exact OZ opId fallback)
- M-9 (placeholder-flavor flicker)
- All L-1 … L-7 items
- Test additions from § 5

---

## 7. Appendix — file map

Rework subsystem → files (confirmed present):

- **Flavor detection**: `src/lib/vault/flavor.ts`, `src/types/index.ts`,
  `src/config/chains.ts`.
- **Vault adapter**: `src/lib/vault/adapter.ts` + legacy path in
  `src/lib/data/rpcClient.ts`.
- **Write router**: `src/lib/vault/writes.ts`, `src/hooks/useVaultWrite.ts`.
- **Roles cards**: `src/components/vault/owner/RoleManagement.tsx`
  (dispatcher), `RolesMoolah.tsx`, `RolesMetaMorphoV1.tsx`.
- **Pending proposals**: `src/lib/vault/proposals.ts`,
  `src/components/vault/moolah/PendingProposalsPanel.tsx`,
  `src/components/vault/moolah/ProposalContents.tsx`,
  `src/store/appStore.ts` (scheduledOps slice).
- **Decoder**: `src/lib/timelock/{abiRegistry,decodeCall,hints}.ts`,
  `src/lib/timelock/__tests__/decodeCall.test.ts`.
- **Deploy / market creation**: `src/components/vault/steps/DeployStep.tsx`,
  `src/lib/vault/createVault.ts`, `src/components/market/{MarketForm,MarketPreview,MarketDeployer}.tsx`,
  `src/pages/CreateMarketPage.tsx`, `src/config/moolah.ts`,
  `src/lib/moolah/resolveMarketFactory.ts`, `src/hooks/useMarketFactoryAddress.ts`.
- **Moolah UI surfaces**: `src/components/ui/ProtocolChip.tsx`,
  `src/components/layout/PausedBanner.tsx`,
  `src/components/ui/ChainBadge.tsx`,
  `src/components/vault/moolah/MoolahMarketBadges.tsx`,
  `src/components/vault/ProtocolTab.tsx`,
  `src/components/vault/VaultCard.tsx` (blacklist dimming).
- **Moolah ABIs + contracts**: `src/lib/contracts/moolahAbis.ts`.
- **Hooks**: `src/lib/hooks/useMoolahSingleton.ts`.
- **Docs**: `docs/bnb-lista-inventory.md`.
