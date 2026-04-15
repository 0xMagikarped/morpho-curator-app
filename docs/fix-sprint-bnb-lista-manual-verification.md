# Fix Sprint — Manual Verification

> Sprint source: `docs/qa-bnb-lista-followups-report.md` (27 findings + 2
> architectural concerns). Fixes landed in 3 commits (Round 1 / 2 / 3).
> This checklist is for the QA hand-off — an engineer with a BSC wallet
> runs it end-to-end, ticks each item, and files any mismatch.

---

## Gate checks (already green — re-confirm)

- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run build` — clean
- [ ] `npx vitest run` — 70/70 passing (8 decoder tests)

---

## MV1 — Fixed-term deploy simulation on live BNB

Prereq: wallet connected with the OPERATOR role on the MarketFactory
(`0xce26859127d236a61f168d2d0905f77d7E286Ab2`). If no OPERATOR wallet is
available, the form should render the "OPERATOR required" banner and
disable Create — record that outcome instead of running the rest.

1. [ ] Navigate to Create Market on BNB.
2. [ ] Select loan token `USD1` (`0x8d0D…8B0d`, 18 decimals).
3. [ ] Select collateral `slisBNB` (`0xB0b8…4A1B`, 18 decimals).
4. [ ] Both token metadata badges render green with "(18 dec)".
5. [ ] Toggle **Fixed term** at the top of the form.
6. [ ] Broker dropdown shows **only USD1 brokers** — confirm entries
       include `slisBNB/USD1`, `BTCB/USD1`, `PT-sUSDe/USD1`, `USDe/USD1`,
       `sUSDe/USD1`. No WBNB/lisUSD or lisUSD-loan entries.
7. [ ] Pick `slisBNB/USD1` (address `0xF07b…9d2`).
8. [ ] Broker detail row shows the 0x address.
9. [ ] Rate calculator row renders "Lista RateCalculator (default)" with
       address `0xF81A…2330`.
10. [ ] Enter APR = 2.00 (%).
11. [ ] Click **Preview Market** — `FixedTermPreview` renders with
        target/max APR (2.00% / 4.00%), LLTV 86.0%, no oracle row.
12. [ ] Click **Deploy Fixed-Term Market** → wallet popup. Do NOT sign.
13. [ ] Wallet shows a decoded call to
        `MarketFactory.createFixedTermMarket(FixedTermMarketParams)` with:
        - `broker` = `0xF07b…9d2`
        - `loanToken` = USD1
        - `collateralToken` = slisBNB
        - `irm` = `0xF81A…2330`
        - `lltv` = 860000000000000000 (0.86e18)
        - `ratePerSecond` ≈ `2% × 1e18 / (365 × 86400)` = `634195839` (±1)
        - `maxRatePerSecond` = `ratePerSecond × 2` ≈ `1268391678` (±2)
14. [ ] No "Unknown Signature Type" / "revert #1002" messages.
15. [ ] Reject the tx in the wallet. Close.

Optional broadcast (if Lista ops provides a throwaway broker):

- [ ] Sign + broadcast. Tx lands.
- [ ] Open Vault → Markets tab on a vault with the new market in supply
      queue. The row carries the `[FIXED · BROKER]` badge.
- [ ] `brokers(id)` on the Moolah singleton returns the broker address
      (`cast call` or BscScan Read).

### Boundary APR probes

- [ ] APR = 0.01 → `ratePerSecond` ≈ `3170979` (no zero drop)
- [ ] APR = 50 → `ratePerSecond` ≈ `15854895992`
- [ ] APR = 100 → `ratePerSecond` ≈ `31709791984`, max = 2× exactly
- [ ] APR = 0 → submit button disabled with reason
- [ ] APR = 101 → submit button disabled with reason

### 18-dec preflight

- [ ] Select loan token USDT (`0x55d3…7955`, 18 dec) + an inconvenient
      6-dec collateral — simulator should refuse with
      "Fixed-term markets require 18-decimal tokens on both sides."

---

## MV2 — Protocol tab role probe vs BscScan

1. [ ] Open Lista USD1 vault → Protocol tab.
2. [ ] `GovernanceCard` shows three role rows. For each:

   | Role | UI address | BscScan check | UI indicator (✓/!) |
   |---|---|---|---|
   | DEFAULT_ADMIN_ROLE | `0x07D2…5253` |  |  |
   | MANAGER            | `0x8d38…B0c6` |  |  |
   | PAUSER             | `0xEEfe…5Bd8` |  |  |

3. For each row:
   - [ ] Open https://bscscan.com/address/0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C#readProxyContract
   - [ ] Call `hasRole(role, address)` via "Read as Proxy" with the
         exact role keccak (OZ uses `keccak256("MANAGER")` etc.):
         - DEFAULT_ADMIN_ROLE = `0x000…000` (bytes32 zero)
         - MANAGER = `keccak256("MANAGER")` =
           `0x241ecf16d79d0f8dbfb92cbc07fe17840425976cf0667f022fe9877caa831b08`
         - PAUSER = `keccak256("PAUSER")` =
           `0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a`
   - [ ] UI green check ↔ BscScan `true`; UI warning triangle ↔ `false`.
4. [ ] If any row disagrees: **stop, file as Critical**. Role-cache
       drift here is how stale governance addresses slip into the UI.

---

## MV4 — Decoder correctness on a real proposal

Pre-req: a Moolah vault proposal pending (either found in the wild or
freshly scheduled via the app).

1. [ ] Open the vault's Pending Proposals panel.
2. [ ] Pick a proposal with non-trivial args (e.g., a `submitCap` on
       USD1 with a rounded cap like 10_000_000e18).
3. [ ] Note the decoded fields in the UI:
   - Function name + abi label
   - Target address (+ resolved label)
   - Each arg: name, type, value (+ hint format)
4. [ ] Copy the raw calldata from the proposal row (use the dev-tools
       network tab on the TimeLock scan, or read the tx input on
       BscScan if it was app-originated).
5. [ ] On BscScan tx page → **Decode Input Data**. Compare field by
       field against the UI.
6. [ ] Run a viem script independently:
   ```ts
   import { decodeFunctionData } from 'viem';
   import { metaMorphoV1Abi } from '…/abis';
   console.log(decodeFunctionData({ abi: metaMorphoV1Abi, data: '0x…' }));
   ```
   Confirm function name + each arg value matches the UI.
7. [ ] **Critical check**: for `submitCap`, verify the displayed amount
       matches the raw bigint shifted by `loanToken.decimals()`. On an
       18-dec token, `10_000_000_000_000_000_000_000_000` wei should
       display as "10,000,000 USD1", never as "10.00 USD1".
8. [ ] If any field mismatches: **halt release, file as Critical**.

### Batch proposal

- [ ] If an active `scheduleBatch` exists (e.g., curator queued several
      caps together), expand the proposal row.
- [ ] Batch enumerates numbered sub-rows (#1, #2, …), each decoded
      independently.
- [ ] Targets within the batch resolve to labels where applicable.

### Cross-vault proposal (decimals safety)

- [ ] If a batch op targets a **different** vault than the page you're
      on, its decoded amount args should render
      "(decimals unknown)" instead of inheriting the page's vault
      decimals. Synthesize one if none exists in the wild.

---

## Safety gates

### Blacklist

- [ ] Patch a tracked vault address into `Moolah.vaultBlacklist` (dev
      RPC or temporary override in `useIsVaultBlacklisted`) to simulate.
- [ ] Dashboard card: dimmed, `[BLOCKED BY LISTA]` chip, hover stays
      default (no accent border flash).
- [ ] Vault detail page: red banner at top.
- [ ] CapsTab: "Writes disabled" banner + every Submit/Accept/Revoke
      disabled with the exact tooltip "Vault blocked by Lista. Writes
      will revert on-chain."
- [ ] QueuesTab: same banner + both Save buttons disabled.
- [ ] ReallocateTab: same banner + Execute Reallocation disabled.

### Pause

- [ ] Patch `Moolah.paused()` to `true` (dev RPC or local mock).
- [ ] Top banner renders across the app.
- [ ] Same write-button gating as blacklist, with tooltip "Moolah
      protocol is paused. Writes will revert."

### External proposal (salt preserved)

- [ ] Either find a proposal in the wild or synthesize one by
      clearing the local `scheduledOps` after scheduling so the app
      sees its own op as an "external".
- [ ] Row renders **"External proposal — salt unknown"** info pill.
- [ ] Execute button disabled with tooltip naming the salt.
- [ ] Salt input appears under the row. Invalid bytes32 → red "Invalid
      bytes32" indicator. Valid → green "Salt ok". Execute enables
      once a valid salt is pasted AND the op is ready.
- [ ] Cancel button still works (doesn't need salt).

### Log scan truncation

- [ ] On BSC with a stale RPC window (e.g., public node that caps at
      5k), confirm the panel renders the `"Historic proposals may be
      truncated"` banner with a Retry link, NOT a silent "only own
      proposals" fallback.

### Expiry

- [ ] Synthesize a local op whose `scheduledAt + delay + 7 days` is in
      the past (dev: scrub `Date.now()` in the row test).
- [ ] Row shows red "Expired (past …d deadline)" chip.
- [ ] Execute button hidden; Cancel disabled (the op is dead, cancel
      is a no-op on-chain).

### Countdown

- [ ] Open a not-yet-ready proposal. The "Ready in Xh Ym" countdown
      updates once per second (not every 30 s on refetch).

---

## Regression sanity

### ETH vault

- [ ] Role card renders in the MetaMorpho V1 layout (single owner,
      single curator, single guardian, timelock).
- [ ] CapsTab submit is a single tx (no Propose / Execute split).
- [ ] No Protocol tab visible.
- [ ] No `[Moolah · Lista]` chip; no PausedBanner.
- [ ] Market creation: no Fixed-term toggle, no broker dropdown.
- [ ] Pending actions use the legacy `PendingActionsBanner` (accept
      guardian / timelock / cap flows).

### Base + SEI

- [ ] Spot-check one vault per chain, mirror the ETH checklist.

### Pharos

- [ ] Chain selector shows "Pharos — Coming Soon".
- [ ] Navigating to a Pharos vault URL renders the Coming Soon state.
      Browser dev-tools network tab: no RPC fires against
      `rpc.pharos.xyz`.
- [ ] `getDefaultVaultFlavor(1672, …)` returns `metaMorphoV1` (safe
      fallback); `defaultVaultFlavor` on chain config is `undefined`.

### Decoder cross-flavor scoping

- [ ] Paste an MM V1 `submitCap` calldata into the decoder (any BSC
      test harness): decodes via MoolahVault (has the setter now) —
      NOT via MM V1 (scoped to `protocol === 'morpho'`).
- [ ] Paste a scheduled call on an ETH vault → decodes via MM V1. No
      cross-flavor fallthrough.

---

## Breaking changes to flag to downstream consumers

| Change | File | Impact |
|---|---|---|
| `VaultSnapshot.admin: Address` → `Address \| null` | `src/lib/vault/adapter.ts:75-79` | Every consumer must null-check. Compile error if not. |
| `fetchTimelockProposals` signature change | `src/lib/vault/proposals.ts:122-134` | Returns `FetchProposalsResult` wrapping proposals + scan metadata. Takes `localSeeds` instead of plain `seedOpIds`. |
| `PreparedWrite` union grows `invalid` variant | `src/lib/vault/writes.ts:212-225` | New consumers of `prepareWrite` must handle all 3 variants. |
| `TrackedVault.flavor?: VaultFlavor` | `src/store/appStore.ts:6-15` | Optional — existing persisted entries keep working. |

---

## Deferred / not addressed

All 27 QA findings landed across the 3 rounds. The two architectural
concerns that crossed release-safety thresholds (§3.1 selector coupling,
§3.3 pause write-gate) are closed. Two concerns from the QA report were
intentionally left as documentation-only:

- **§3.4 (legacy read layer)**: tagged with a LEGACY signpost
  (`src/lib/data/rpcClient.ts:1-7`) but not refactored. Migrating
  fee-management + timelock-management UIs to `readVaultSnapshot` is a
  scoped follow-up; doing it inside this sprint would have pulled in
  surface that's not on the critical path.
- **R3.7 (flavor-probe skeleton)**: effectively resolved by R3.3
  (tracked vaults carry their flavor) — the common path renders the
  correct layout immediately. The skeleton edge case only applies to
  first-visit-ever-on-unknown-vault, where the placeholder-data chain
  default is almost always right.
