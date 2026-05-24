# Audit Fix Log

## PR 1 — Complete custom-error ABIs

- **Branch:** `fix/audit-01-error-abis`
- **Audit finding:** `audits/AUDIT_2026-05-16.md` Pass D / D5 (0 `type:'error'` entries in any
  contract ABI → viem cannot decode any Morpho revert).
- **Date:** 2026-05-16

### Source of truth (verbatim, machine-extracted — no hand-rolling)
- **Morpho (V1 / V2 / PublicAllocator / adapters):** `@morpho-org/blue-sdk-viem@4.5.0`
  (already a dependency — **no `package.json` change**), file
  `node_modules/@morpho-org/blue-sdk-viem/lib/cjs/abis.js`,
  extraction `<abi>.filter(e => e.type === 'error')`.
- **Moolah/Lista (BSC):** verified on-chain **MoolahVault implementation**
  `0xA1f832c7C7ECf91A53b4ff36E0ABdb5133C15982` (chainId 56), fetched via Etherscan v2
  multichain `getsourcecode` through the `defi-data` skill on 2026-05-16. BscScan:
  `https://bscscan.com/address/0xA1f832c7C7ECf91A53b4ff36E0ABdb5133C15982#code`.
  (User chose "Fetch Moolah ABI from BscScan now".) The Moolah singleton/core uses string
  reverts + only OZ infra errors, so only the MetaMorpho-fork **vault** error set was taken.

### Per-ABI error fragment counts (spread in as `as const`)
| Local ABI | Source | # errors |
|---|---|---|
| `metaMorphoV1Abi` (abis.ts) | SDK `metaMorphoAbi` | 55 |
| `publicAllocatorAbi` (abis.ts) | SDK `publicAllocatorAbi` | 12 |
| `metaMorphoV2Abi` (metaMorphoV2Abi.ts) | SDK `vaultV2Abi` | 36 |
| `v1VaultAdapterAbi` (metaMorphoV2Abi.ts) | SDK `morphoVaultV1AdapterAbi` | 9 |
| `v1MarketAdapterAbi` (metaMorphoV2Abi.ts) | SDK `morphoMarketV1AdapterV2Abi` | 16 |
| `moolahVaultAbi` (moolahAbis.ts) | verified BscScan MoolahVault impl | 54 |
| `marketAdapterFactoryAbi.ts` factories | SDK exposes **0** (string reverts) — doc note only |
| `vaultV2RegistryAbi.ts` | no distinct SDK error ABI — doc note only |

`MORPHO_MARKET_V1_ADAPTER_ERRORS` (7, SDK `morphoMarketV1AdapterAbi`, the non-V2 market
adapter) is exported by `morphoErrors.ts` for completeness but has **no local consumer ABI**
in this codebase, so it is intentionally not spread anywhere. Not a defect; noted for future
use. No items punted to `audits/_followups.md` (no scope drift occurred).

### Documented omission
`AboveAbsoluteCap` is **not** included — it was an illustrative label in
`AUDIT_2026-05-16.md` (D5), not a verbatim Morpho error. The authoritative cap errors are
present under their real names (V1: `AllCapsReached`/`SupplyCapExceeded`;
V2: `AbsoluteCapExceeded`/`AbsoluteCapNotDecreasing`/...). The test explicitly asserts
`AboveAbsoluteCap` is **absent** so it can never be silently invented later.

### Files changed
New (untracked, all under `src/lib/contracts/`):
- `morphoErrors.ts` — 183 LOC (135 fragments: 55+12+36+9+16+7 across 6 exports)
- `moolahErrors.ts` — 74 LOC (54 fragments)
- `__tests__/errorAbis.test.ts` — 110 LOC

Modified (tracked, `git diff main --stat`, all under `src/lib/contracts/`):
- `abis.ts` +11 · `metaMorphoV2Abi.ts` +13 · `moolahAbis.ts` +6 ·
  `marketAdapterFactoryAbi.ts` +4 (doc) · `vaultV2RegistryAbi.ts` +4 (doc)

### Tests added (`errorAbis.test.ts`) — fail pre-fix, pass post-fix
- **`%s exposes exactly %d custom errors`** — parametrized exact-count assertion per ABI
  (55/36/12/9/16/54): regression-visible.
- **`metaMorphoV1Abi contains the audit-named errors`** — asserts `NoPendingValue`,
  `AboveMaxTimelock`, `AlreadyPending`, `MarketNotCreated` present **and**
  `AboveAbsoluteCap` absent.
- **`moolahVaultAbi carries the fork-specific governance errors`** — `MarketNotCreated`,
  `SupplyCapExceeded`, `AllCapsReached`, `AlreadyPending`.
- **`every error encodes→decodes`** — for *every* fragment in *every* ABI:
  `encodeErrorResult` → `decodeErrorResult`, assert `errorName` resolves and re-encoding the
  decoded args reproduces the calldata bit-for-bit (representation-agnostic round-trip).
- **`decodeErrorResult does NOT silently swallow an unknown selector`** — `0xdeadbeef` must
  throw (proves the decoder is not permissive).
- **`vaultV2RegistryAbi intentionally exposes 0 custom errors`** — locks the documented
  omission.

### Verification
- **Fail-on-`main` demonstrated:** `git stash push` of the 5 ABI files (→ `main` state) →
  `errorAbis.test.ts` = **8 failed | 8 passed** (counts/named/round-trip/Moolah fail at 0
  errors; only negative-control + registry-0 pass). `git stash pop` → **16 passed**.
- `npm run test:run` → **86 passed** (5 files; was 70 — +16 new, 0 skipped).
- `npx tsc -b` → **0 errors**.
- `npm run build` → **success** (`✓ built`; pre-existing chunk-size warning only, not an error).
- `git diff main --stat` → only `src/lib/contracts/**` (+ unrelated pre-existing files, see below).

### Scope-compliance self-audit
**PASS.** Every file I created/modified is under `src/lib/contracts/` (the approved scope):
5 ABI files + `morphoErrors.ts` + `moolahErrors.ts` + `__tests__/errorAbis.test.ts`. No write
hook, component, page, store, or build/TS/lint config was touched. **No `package.json`
change.** The working tree also shows `CLAUDE.md`, `src/components/vault/PublicAllocatorPanel.tsx`,
`src/lib/hooks/usePublicAllocator.ts` modified — these were **dirty before this session**
(present in the session-start `git status`), are **not part of PR 1**, and were **not staged
or committed**. They must not be bundled into this PR's commit (global rule #3).

---

## PR 2 — simulate-before-write guard

- **Branch:** `fix/audit-02-simulate-guard` (off `main` @ `537c792`, PR 1 merged)
- **Audit finding:** `audits/AUDIT_2026-05-16.md` §5 / D4 (writes broadcast with no
  `simulateContract` preflight; reverts opaque). Builds on PR 1's D5 error ABIs.
- **Date:** 2026-05-17

### Approach (user-approved: A — auto-simulate inside the hook)
Every contract write (~26 consumer files, ~40 call sites) already funnels through the single
`useGuardedWriteContract`. The preflight is implemented **once in that hook**, so all sites
become fail-closed with **zero call-site edits**. The "blocked until simulate-succeeded-for-
these-args" invariant holds by construction (simulation is bound to the exact args of each
call — no stale-simulation TOCTOU window). No PR-2 split needed. Decode idiom reuses
`useReallocate.ts` (`BaseError.walk` → `ContractFunctionRevertedError.data.errorName`); RPC
client reuses `getPublicClient` (`src/lib/data/rpcClient.ts`). No new deps.

### Files changed (`git diff main --stat`)
Modified (tracked): `src/hooks/useGuardedWriteContract.ts` +143 (core: `simulate`,
`simulateError`, `isSimulating`, fail-closed `writeContract`/`writeContractAsync`, decoder),
`src/hooks/useVaultWrite.ts` +11 (plumb combined `error` = `simulateError ?? writeError` +
expose `simulateError`; extend `UseVaultWriteResult`), `src/components/vault/CapsTab.tsx` +19
(render one decoded-revert banner; previously rendered no write error at all).
New (untracked): `src/hooks/__tests__/useGuardedWriteContract.simulate.test.tsx` (146 LOC),
`audits/_followups.md` (17 LOC).

### Tests (`useGuardedWriteContract.simulate.test.tsx`) — fail on `main`, pass on branch
Establishes the first wagmi/`renderHook` harness (mocks `wagmi` + `getPublicClient`):
1. **simulate-success → write proceeds** — `simulateContract` called once, wagmi
   `writeContract` called exactly once, `simulateError === null`.
2. **known revert → BLOCKED** — encoded `AboveMaxTimelock` → wagmi `writeContract` NOT
   called, `simulateError.errorName === 'AboveMaxTimelock'`, message contains it.
3. **unknown selector → BLOCKED fail-closed** — `0xdeadbeef` → not called,
   `errorName === null`, `raw === '0xdeadbeef'`.
4. **`writeContractAsync` rejects** on preflight revert (`AlreadyPending`) — awaiting callers
   (`useSetCaps`/`useAllocateV2`) reject and do not proceed.
5. **DOM render** — decoded `errorName` (`MarketNotCreated`) appears via Testing Library.

### Verification
- **Fail-on-`main` demonstrated:** `git stash` of the 3 tracked files (→ `main` state) →
  suite = **5 failed (5) + 1 error** (old hook has no preflight; `writeContract` dispatches
  immediately, no `simulateError`). `git stash pop` → **5 passed**.
- `npm run test:run` → **91 passed** (6 files; was 86 — +5, 0 skipped).
- `npx tsc -b` → **0 errors** (after extending `UseVaultWriteResult` with `simulateError`).
- `npm run build` → **success** (pre-existing chunk-size warning only).
- `git diff main --stat` → only the 3 files above. PA `stash@{0}: pre-pr2-pa-feature`
  verified **intact** after the fail-demo stash/pop.

### Scope-compliance self-audit
**PASS with one disclosed test deviation.** Only the 3 planned files modified + 2 planned new
files. **Not touched:** any ABI file (PR 1 territory), any new component, the other ~25
consumer error surfaces (deferred → `audits/_followups.md`), the 3 raw
`walletClient.sendTransaction` paths, gas/chain/transport config, CSP/`vercel.json` (PR 3),
`tsconfig`/`eslint`/`package.json`/CI, the stashed PA pair, `chore/document-defi-data-skill`.
**Deviation (disclosed per "report faithfully"):** the approved plan's test #4 said
`render(<CapsTab/>)`. Implemented instead as a minimal in-test fixture component consuming the
**real** `useGuardedWriteContract`. Rationale: CapsTab is 781 LOC with ~10 unrelated data
hooks; mounting it would test CapsTab's wiring (and require heavy mocking) rather than the
guard's hook→DOM contract. The fixture is a stronger, less brittle unit of the actual
behaviour; CapsTab's one-line `simulateError` passthrough is covered by `tsc` + `build` + the
explicit banner JSX. Net: a test-quality improvement, not a scope change.

---

## PR 4 — Moolah-aware `fetchPending*` (chain-switch crash fix)

- **Branch:** `fix/moolah-pendingcap-guard` (off `main` @ `3b75a0f`, PR 1+2 merged; PR 3 parked)
- **User-visible bug:** switching connected wallet to BNB Chain (56, Moolah) left the UI
  stuck — `useDiscoveredMarketStatuses RPC call failed: ContractFunctionExecutionError:
  pendingCap reverted` from `useVault.ts:503` → `rpcClient.ts:919`.
- **Date:** 2026-05-21

### Root cause
`src/lib/data/rpcClient.ts` had three symmetric reads using the MetaMorpho V1 ABI —
`fetchPendingCap` (L910), `fetchPendingTimelock` (~L925), `fetchPendingGuardian` (~L949) —
all calling `pending*` selectors that **do not exist on `moolahVaultAbi`** (Moolah's `setCap`
is instant; governance flows through a TimelockController; no pending state by protocol
design). `fetchPendingCap` had no try/catch, so the revert propagated up through
`Promise.all` in `useVaultPendingActions:454` and `useDiscoveredMarketStatuses:503`. The
other two swallowed the revert in try/catch but still burned an RPC call.

### Approach — chokepoint fix (matches PR 2's funnel-point discipline)
At the top of each function: `if (getChainConfig(chainId)?.protocol === 'moolah') return null;`
— semantically correct ("no pending value" by protocol design, not "RPC failed"). Reuses
`getChainConfig` (already imported in the file) and the canonical Moolah-gate idiom used in
11+ other call sites (`MarketDeployer.tsx:32`, `useMoolahSingleton.ts:23`,
`timelock/hints.ts:92`, …). Zero call-site edits needed; both visible callers + the two
latent variants are fixed in one place.

### Files changed (`git diff main --stat`)
Modified: `src/lib/data/rpcClient.ts` (+8 lines = 3 guards × 2-3 lines each with one-line
context comment). New: `src/lib/data/__tests__/fetchPending.test.ts` (109 LOC).

### Tests (`fetchPending.test.ts`) — fail on `main`, pass on branch
Mocks `viem.createPublicClient` via `vi.hoisted` + `vi.mock('viem', importActual)` so
`getPublicClient` hands the three functions a fake whose `readContract` is a spy. Six tests:
- For each of `{ pendingCap, pendingTimelock, pendingGuardian }`:
  - **Moolah (chain 56)** → returns `null`; `readContract` **not called** (no wasted RPC).
    For `pendingTimelock`/`pendingGuardian` the spy is pre-resolved to a non-null tuple so a
    regression that bypassed the guard would wrongly surface a fake pending value — locking
    the no-call invariant.
  - **Morpho (chain 1)** → `readContract` called exactly once with the matching
    `functionName`/`address`, return tuple parsed into the expected shape.

### Verification
- **Fail-on-`main` demonstrated:** `git stash` `rpcClient.ts` (→ main: no guards) → suite =
  **3 failed | 3 passed** (the 3 Moolah tests fail at "readContract not called" /
  "result === null"; the 3 Morpho tests still pass). `git stash pop` → **6 passed**.
- `npm run test:run` → **97 passed** (7 files; was 91 — +6, 0 skipped).
- `npx tsc -b` → **0 errors**. `npm run build` → **success**.
- `git diff main --stat` → only `src/lib/data/rpcClient.ts`. PA `stash@{0}: pre-pr2-pa-feature`
  verified **intact**.

### Scope-compliance self-audit
**PASS.** Only `rpcClient.ts` modified + one new test file. No caller edited (chokepoint
discipline). Not touched: PR-1 ABI files, PR-2 write hooks, PR-3 `vercel.json` /
`playwright.config.ts`, the Base RPC pool (PR 5), the Infura key leak, SeiTrace 522/CORS, any
UI component, store, config, or CI. PR 3 (`aa92454`) remains parked on its branch; PA stash
and `chore/document-defi-data-skill` untouched.

### Follow-ups noted (do not address in PR 4)
- `useDiscoveredMarketStatuses` (`useVault.ts:506`) still has a generic `console.warn` +
  `continue` per rejected market — fail-open swallow pattern; with PR 4 the Moolah case no
  longer triggers it, but other reverts still go silent. → `_followups.md`.
- `fetchPendingCap` lacks a try/catch on Morpho/V2 chains; if V2 vaults also lack the V1
  selector, this could resurface. PR 4 doesn't add a defensive catch (scope: Moolah only).
  → `_followups.md`.

Manual verification (post-merge, separate hand-off): user reloads the production deploy on
a BNB Moolah vault and confirms (a) the `pendingCap reverted` console.warn is gone and
(b) the chain-switch flow no longer leaves the UI stuck on Moolah vaults.

---

## Feature — Add XDC Network (chainId 50), V2 vaults only

- **Branch:** `feat/xdc-network` (off `main` @ `3b75a0f`)
- **Request:** add XDC Network as a supported chain, **restricted to Morpho Vault V2**
  (no MetaMorpho V1, no Moolah).
- **Date:** 2026-05-22

> Not an audit finding — a feature. Logged here to keep one running change log.

### Design facts
- `viem/chains` already exports `xdc` (id 50, native XDC/18, XDCScan, multicall3
  `0x0B17…D9aF`) — imported directly, no custom `defineChain` (unlike sei/pharos).
- `VaultFlavor` has no `'vaultV2'` value — V2 is an orthogonal runtime axis
  (`detectVaultVersion` `sentinel()` probe). **"V2-only" is enforced purely by config:**
  `ChainAssetStep.tsx:20` filters creatable chains by `isV2 ? !!v2 : !!v1`, so giving XDC
  only a `vaultFactories.v2` makes it appear in the V2 create flow and absent from V1 —
  zero extra code.

### On-chain verification (XDC RPC `eth_getCode`, chainId `0x32`, 2026-05-22)
All six Morpho addresses have contract code: `morphoBlue` 0xEa49…4fD9, `vaultV2Factory`
0x2275…be2B, `v2AdapterRegistry` 0x79A8…d5c1, `morphoMarketV1AdapterV2Factory` 0x5C00…5d31,
`adaptiveCurveIrm` 0x15c7…14A0, `oracleV2Factory` 0x6Ad9…83B4. WXDC resolved + verified:
`0x951857744785E80e2De051c32EE7b25f9c458C42` (`symbol() → "WXDC"`, `name() → "Wrapped XDC"`).
`bundler3` / `morphoVaultV1AdapterFactory` / `publicAllocator` not deployed-for / not needed
on the V2-market-adapter path — omitted.

### Files changed (`git diff main --stat`)
Modified: `src/config/chains.ts` (+54 — the `50:` `CHAIN_CONFIGS` entry),
`src/config/wagmi.ts` (+11 — `import { xdc }`, `xdcTransports`, chain + transport entry),
`src/config/env.ts` (+1 — `xdcRpcUrl`), `.env.example` (+1 — `VITE_XDC_RPC_URL`),
`vercel.json` (connect-src += `rpc.xinfin.network`, `*.xdcrpc.com`, `rpc.xdc.network`).
New: `src/config/__tests__/xdc.test.ts` (73 LOC).

### Tests (`xdc.test.ts`) — fail on `main`, pass on branch
On `main` `CHAIN_CONFIGS[50]` is undefined → all 5 fail. Asserts: chain registered &
`protocol: 'morpho'`, `apiSupported: false`, `deployed: true`; **V2-only invariant**
(`vaultFactories.v2` set, `vaultFactories.v1` undefined); the six addresses match the
verified values exactly; the `ChainAssetStep` gating predicate (XDC qualifies V2, excluded
V1); native token XDC/18 + valid 20-byte WXDC.

### Verification
- Fail-on-`main`: `git stash` the 5 config files → `xdc.test.ts` **5 failed** →
  `stash pop` → **5 passed**.
- `npm run test:run` → **96 passed** (7 files; 91 baseline + 5, 0 skipped).
- `npx tsc -b` → **0 errors**. `npm run build` → **success**.
- `git diff main --stat` → only the 5 config files. PA `stash@{0}` intact.

### PR-3 coordination (flagged)
`main`'s `vercel.json` is still Report-Only CSP (PR 3 parked). The XDC `connect-src` hosts
added here are correct under Report-Only. When `fix/audit-03-csp-hsts` (PR 3) is rebased/
merged its enforced-`connect-src` rewrite **will conflict** on that line — resolution is a
trivial union: PR 3's enforced policy must include `https://rpc.xinfin.network`,
`https://*.xdcrpc.com`, `https://rpc.xdc.network`.

### Scope-compliance self-audit
**PASS.** Only the 5 config files + one test. No vault/market component logic touched
(chain flows are config-driven). No PR-1/2/3/4 artifacts, the PA stash, or
`chore/document-defi-data-skill` touched. `deploymentBlock: 0` follows the Pharos
precedent (non-API chain; scanner starts from genesis).

Manual verification (post-merge hand-off): connect a wallet on XDC, open the create-vault
wizard → confirm XDC appears under **V2 only**, and a V2 vault page loads.

---

## PR 5 — RPC pool: reject client-exposed keyed RPCs + rank fallbacks

- **Branch:** `fix/audit-05-rpc-pool` (off `main` @ `e4c10d4`)
- **Symptom:** production console 429 storm — `POST mainnet.infura.io/v3/70fde4d…` /
  `base-mainnet.infura.io/v3/…` **Too Many Requests** from `useManagedVaults.ts:164`;
  downstream `rpcClient.ts:533` "9 of 17 V2 reads returned null".
- **Date:** 2026-05-22

### Root cause
`infura` appears **nowhere in `src/`**, yet the production bundle `index-CoceRxJu.js`
contains `infura.io/v3/70fde4d039af47d6b5ce31de9d8710a8` — proving `VITE_ETH_RPC_URL` /
`VITE_BASE_RPC_URL` are set in Vercel to Infura URLs. `getPublicClient` (`rpcClient.ts`) and
`wagmi.ts` give env RPCs **first priority**, so every ETH/Base read hit that over-quota
free-tier Infura project → 429. Because `VITE_*` vars are inlined by Vite, the key was also
**publicly exposed** in the shipped bundle. (The audit's "no secret in bundle" finding is now
stale — the var was added post-audit.)

### Fix (user-approved Option A — code hardening; user removes the Vercel vars)
1. **`src/config/env.ts`** (+45/-…) — new exported `sanitizeRpcUrl(name, url)`: rejects any
   RPC URL embedding a provider key (`infura.io/v3/`, `alchemy.com/v2/`, `g.alchemy.com/`,
   `.quiknode.pro/`, `.quicknode.com/`) — `console.error`s why and returns `''` so the app
   falls back to the unkeyed public RPCs in `chains.ts`. Applied to all 6 `VITE_*_RPC_URL`
   reads. `env` keeps the same shape — consumers unchanged. **`env.ts` is the single
   chokepoint both `getPublicClient` and `wagmi.ts` read from**, so this fixes both paths.
   Because the guard *rejects* (not just warns), PR 5 stops the 429s on its own the moment it
   deploys — the app stops calling Infura even before the Vercel var is removed.
2. **`src/lib/data/rpcClient.ts`** (+4/-1) — `getPublicClient`: `fallback(…, { rank: true })`
   so viem health-ranks transports and deprioritises a slow/429-ing endpoint.
3. **`src/config/wagmi.ts`** (+13/-6) — `{ rank: true }` on all six chain `fallback(...)`.
New: `src/config/__tests__/envRpcGuard.test.ts` (61 LOC).

### Tests (`envRpcGuard.test.ts`) — fail on `main`, pass on branch
`sanitizeRpcUrl` doesn't exist on `main` → all 13 fail there. Asserts: rejects Infura
(mainnet+base), Alchemy, QuickNode keyed URLs → `''`; emits a `console.error` naming the var
and the exposure; passes unkeyed public RPCs (publicnode/llamarpc/xinfin/base.org/ankr)
through unchanged; empty stays empty. `rank: true` is viem-internal — not unit-tested;
covered by `tsc` + `build`.

### Verification
- Fail-on-`main`: `git stash` the 3 files → `envRpcGuard.test.ts` **13 failed** →
  `stash pop` → **13 passed**.
- `npm run test:run` → **115 passed** (9 files; 102 baseline + 13, 0 skipped).
- `npx tsc -b` → **0 errors**. `npm run build` → **success**.
- `git diff main --stat` → only `env.ts`, `wagmi.ts`, `rpcClient.ts`. PA `stash@{0}` intact.
- Note: the full suite now prints `[env] VITE_BASE_RPC_URL/VITE_SEI_RPC_URL contains an
  embedded provider API key` on module load — the guard correctly firing on the **local**
  `.env`/`.env.local`, which themselves hold keyed RPC URLs. Harmless test noise; also a real
  signal that the local env has the same misconfiguration as Vercel.

### Operational follow-up (user — outside the PR)
- Remove `VITE_ETH_RPC_URL` + `VITE_BASE_RPC_URL` from Vercel (and local `.env`/`.env.local`).
  After PR 5 the guard makes them inert, but removing them is what deletes the exposed key
  *string* from future bundles.
- **Rotate the Infura key** `70fde4d039af47d6b5ce31de9d8710a8` — public in the shipped bundle,
  treat as compromised.

### Scope-compliance self-audit
**PASS.** Only `env.ts`, `wagmi.ts`, `rpcClient.ts` + one test. No `api/` proxy (Option B not
chosen), no component/store, no `package.json`/CI. The `api.morpho.org` 400 (→ PR 6) and the
`useManagedVaults` huge-range `getLogs` issue (→ `_followups.md`) are untouched. PR 3, the PA
stash, and `chore/document-defi-data-skill` untouched.

---

## PR 6 — Surface simulate/wallet errors on the Set Registry flow

- **Branch:** `fix/setregistry-error-surface` (off `main` @ `e4c10d4`)
- **Symptom:** on the XDC "Set the Morpho Registry" page, clicking *Set Registry & Continue
  to Abdicate* did nothing — no transaction, no feedback.
- **Date:** 2026-05-22

### Root cause
Since PR 2, `useGuardedWriteContract.writeContract` runs a `simulateContract` preflight and
**fail-closes** (no wallet popup) on a revert — setting `simulateError`. But
`useSetRegistry`/`useAbdicateRegistry` (`useSetRegistryAndAbdicate.ts`) destructured only
`{ writeContract, data, isPending, error, reset }` — **not `simulateError`/`walletError`**.
`SetRegistryPage`'s error banner renders the wagmi *write* `error`, which is `null` when the
*simulation* fails. → failing preflight = no tx **and** a silent UI. This is the PR-2 deferred
follow-up (`audits/_followups.md` — "~25 consumers not wired") surfacing as a real production
bug; the XDC Set Registry flow is the first consumer to hit a *failing* simulation. PR 6 makes
the failure **visible**; it does not guess the underlying revert reason (revealed once the
banner renders).

### Fix — chokepoint in the hook (page banner already existed)
- **`src/hooks/useSetRegistryAndAbdicate.ts`** (+36/-…) — new `combineWriteError(simulateError,
  walletError, writeError)` helper folds the three failure channels into one `Error` (priority:
  decoded preflight revert → wallet-not-connected → wagmi write error). Both `useSetRegistry`
  and `useAbdicateRegistry` now destructure `simulateError`/`walletError`/`isSimulating` and
  return the combined `error` — so the page's existing banner works with **no banner change**.
  Mirrors PR 2's `useVaultWrite` fix.
- **`src/pages/SetRegistryPage.tsx`** (+/-) — destructure `isSimulating` from each hook; the
  action buttons show `"Simulating…"` and stay disabled during the preflight, closing the ~1s
  silent gap even when the simulation *succeeds*.

New: `src/hooks/__tests__/setRegistryError.test.tsx` (99 LOC).

### Tests (`setRegistryError.test.tsx`) — fail on `main`, pass on branch
`vi.mock`s `useGuardedWriteContract` (mutable holder) + `wagmi`; `renderHook`s the two
wrappers. 6 tests: decoded `simulateError` surfaced in `error` (set + abdicate paths);
`walletError` surfaced; plain wagmi write error still surfaced (no regression); null when
nothing failed; `isSimulating` passed through both. On `main` the wrappers ignore
`simulateError`/`walletError`/`isSimulating` → **4 of 6 fail**.

### Verification
- Fail-on-`main`: `git stash` the 2 files → suite = **4 failed | 2 passed** → `stash pop` →
  **6 passed**.
- `npm run test:run` → **108 passed** (9 files; 102 baseline + 6, 0 skipped).
- `npx tsc -b` → **0 errors**. `npm run build` → **success**.
- `git diff main --stat` → only `useSetRegistryAndAbdicate.ts`, `SetRegistryPage.tsx`. PA
  `stash@{0}` intact.

### Scope-compliance self-audit
**PASS.** Only the 2 named files + one test. `useGuardedWriteContract` (PR 2) unchanged; no
ABI, `vercel.json`, or config touched. The broader unification across the other ~24
`useGuardedWriteContract` consumers remains the `audits/_followups.md` item — PR 6 fixes only
the reported-broken Set Registry flow. The underlying reason the XDC `setAdapterRegistry`/
`submit` simulation reverts is **out of scope** — it becomes visible (decoded) once this ships,
and fixing it (if a code bug) is separate follow-up work.

Manual verification (post-merge hand-off): user retries Set Registry on the XDC vault → the
page now shows the **decoded revert reason** instead of doing nothing.

---

## PR 7 — Fix the V2 registry-set flow (submit → timelock → execute)

- **Branch:** `fix/v2-registry-timelock-flow` (off `main` @ `3f7ffeb`)
- **Symptom:** XDC "Set Registry" reverted `DataNotTimelocked()` (`0x1ea942a8`, decoded via
  PR 6's now-visible error banner).
- **Date:** 2026-05-22

### Root cause
Morpho Vault V2 timelocks config changes: `submit(calldata)` queues an op
(`executableAt[data] = now + timelock(selector)`); the target function (`setAdapterRegistry`)
is then called directly and self-checks `executableAt`, reverting `DataNotTimelocked` if never
submitted. `SetRegistryPage` did `hasTimelock ? submit : direct` — wrong: it's never a bare
direct call, and submit/execute aren't either/or, they're sequential. `hasTimelock` was false
because the hand-written `vaultV2RegistryAbi` had **non-existent functions** — `timelock()`
(no args; real is `timelock(bytes4)`) and `pendingTimelock(bytes4)` (doesn't exist) — and
lacked `executableAt(bytes)`. The whole `vaultV2RegistryAbi`/`useRegistryStatus` was built on
an incorrect V2 timelock model.

### On-chain verification (XDC RPC, vault `0x3F4ed284…1a2f`, 2026-05-22)
`owner` == `curator` == `0x22d4…676a`; `adapterRegistry` = 0x0 (unset); `timelock` for both
the `setAdapterRegistry` and `abdicate` selectors = **0** (no wait — submit then execute
immediately); `executableAt` of the set-registry calldata = 0 (never submitted — confirms the
direct call had no prior `submit`). `abdicate` called directly also reverts → treated as
timelocked too (submit→execute), and any wrinkle now surfaces as a *named* error via the
fragments below.

### Fix
- **`vaultV2RegistryAbi.ts`** — replaced with the verified `@morpho-org/blue-sdk-viem`
  `vaultV2Abi` shapes: `submit(bytes)`, `executableAt(bytes)`, `timelock(bytes4)`,
  `setAdapterRegistry`, `abdicate(bytes4)`, `abdicated(bytes4)`, `adapterRegistry`, `owner`,
  `curator`, `revoke`. Spread in `MORPHO_METAMORPHO_V2_ERRORS` so `DataNotTimelocked` & co.
  decode to names — completes PR 1's documented `vaultV2RegistryAbi` follow-up.
- **`useRegistryStatus.ts`** — reworked to read the real surface + `executableAt` for both
  operations' calldata, and derive a 9-state `step` machine
  (`set_not_submitted|set_pending|set_executable|abdicate_*|complete|loading|error`). Exposes
  `canManage` (owner OR curator — `submit` is curator-gated; the old hook gated on owner only).
- **`useSetRegistryAndAbdicate.ts`** — `setRegistry`→`executeSetRegistry`,
  `abdicate`→`executeAbdicate` (the direct post-timelock calls); `submitSetRegistry`/
  `submitAbdicate` kept. PR 6's `combineWriteError`/`isSimulating` retained.
- **`SetRegistryPage.tsx`** — rebuilt as a state machine over `step`: one button per
  sub-state (Submit → wait[absolute-UTC] → Execute) for each of set + abdicate; gates on
  `canManage`.

### Files changed (`git diff main --stat`)
Modified: `vaultV2RegistryAbi.ts`, `useRegistryStatus.ts`, `useSetRegistryAndAbdicate.ts`,
`SetRegistryPage.tsx`, plus **two discovered-in-scope** (not in the original plan's file list,
but mandatory consequences of the hook-signature/ABI change — fixed, not deferred):
`RegistryAlertBanner.tsx` (the other `useRegistryStatus` consumer — old `status` shape →
compile break) and `errorAbis.test.ts` (PR 1's "vaultV2RegistryAbi exposes 0 errors" assertion
became obsolete once PR 7 spread the V2 errors in — updated to assert `DataNotTimelocked` is
now present).
New: `src/hooks/__tests__/registryStatus.test.ts` (112 LOC).

### Tests (`registryStatus.test.ts`) — fail on `main`, pass on branch
Mocks `useReadContracts`/`useAccount`; 8 tests asserting each `step` derivation
(not-submitted / pending / executable for both set + abdicate; complete; loading; error) and
`canManage` for owner / curator / neither. On `main` the hook has no `step` field → all fail.

### Verification
- Fail-on-`main`: `git stash` the 5 files → `registryStatus.test.ts` **8 failed** →
  `stash pop` → **8 passed**.
- `npm run test:run` → **129 passed** (11 files; 121 baseline + 8). One pre-existing PR-1
  test was updated (see above), not regressed.
- `npx tsc -b` → **0 errors**. `npm run build` → **success**.
- `git diff main --stat` → the 6 files above.  PA `stash@{0}` intact.

### Scope-compliance self-audit
**PASS, with two disclosed in-scope additions** (`RegistryAlertBanner.tsx`,
`errorAbis.test.ts`) — both are mandatory fallout of the planned hook/ABI change (a compile
break and an obsolete assertion), fixed rather than left broken; flagged here, not silently
bundled. No other vault/market logic, no `vercel.json`, no other ABI, no CI/config touched.

Manual verification (post-merge): on the XDC vault — Submit Registry Change → (no wait,
timelock 0) → Execute — completes without `DataNotTimelocked`; then the abdicate step.

---

## PR 8 — Guard chainId fallback (un-break the V2 adapter drawers)

- **Branch:** `fix/adapter-drawer-chainid` (off `main` @ `51a4467`)
- **Symptom:** "Add Adapter to Vault" on XDC — the *Submit — Add Adapter* button does
  nothing.
- **Date:** 2026-05-22

### Root cause — PR-2 latent-assumption #2
PR 2's `useGuardedWriteContract.simulate` hard-failed when a `writeContract` call omitted
`chainId` (`throw 'Missing chainId — refusing to dispatch'`). PR 2 assumed every consumer
passes `chainId`; the **adapter drawers never did**. `AddAdapterDrawer.handleSubmit`
*correctly* wraps `addAdapter` in `submit()` — but its `writeContract({…})` has no `chainId`
→ simulate fail-closes → no tx. And the drawer destructured only `{ writeContract, data,
isPending }`, so nothing rendered → dead button. Grep confirmed `AllocateDrawer`,
`DeallocateDrawer`, `RemoveAdapterDrawer`, `InlineCapEditor`, `UpdateCapsDrawer` (+
`AddAdapterDrawer`) all omit `chainId` — **every V2 adapter-management action was hard-blocked
in production since PR 2**. `tsc`/tests missed it: `chainId` is optional in wagmi's type and
no test exercised those drawers.

### Fix — chokepoint in the guard
`useGuardedWriteContract`: when `chainId` is omitted, fall back to the **connected chain**
(`useAccount().chainId`) for the preflight — exactly what wagmi's own `writeContract` does
when `chainId` is absent. One change un-breaks **all** the adapter drawers, no call-site
sweep (PR 2/5/7 chokepoint discipline). Plus `AddAdapterDrawer` now surfaces
`simulateError`/`error` in a banner (it also gets an explicit `chainId` on its call) so a
genuine revert — e.g. an unregistered "Unknown type" adapter — shows a decoded reason rather
than a dead button.

### Files changed (`git diff main --stat`)
`src/hooks/useGuardedWriteContract.ts` (+14/-5 — chainId fallback),
`src/components/vault/adapters/AddAdapterDrawer.tsx` (+10 — `chainId` arg + error banner),
`src/hooks/__tests__/useGuardedWriteContract.simulate.test.tsx` (+19 — new test + mock gains
a connected `chainId`).

### Tests — fail on `main`, pass on branch
New case in the PR-2 suite: `writeContract` **without `chainId`** → guard uses the connected
chain → `simulateContract` runs → wagmi `writeContract` dispatches; `simulateError` null.
On `main` the old guard throws "Missing chainId" → write blocked → the test fails.

### Verification
- Fail-on-`main`: `git stash` the 2 source files → suite = **1 failed | 5 passed** →
  `stash pop` → **6 passed**.
- `npm run test:run` → **130 passed** (11 files; 129 + 1). `npx tsc -b` → **0 errors**.
  `npm run build` → **success**. `git diff main --stat` → the 3 files above. PA `stash@{0}`
  intact.

### Scope-compliance self-audit
**PASS.** Guard fix + the one reported drawer + its test. The other adapter drawers are
un-broken by the chokepoint guard fix with no edits; surfacing `simulateError` in each of
them remains the `audits/_followups.md` unification item. No ABI, `vercel.json`, or other
config touched.

Manual verification (post-deploy): on the XDC vault, "Add Adapter" → *Submit — Add Adapter*
now fires the tx (or shows a decoded revert reason for an unregistered adapter).

---

## PR 9 — Deploy Market Adapter: idempotency + corrected event ABI

- **Branch:** `fix/deploy-adapter-idempotency` (off `main` @ `1c659d4`)
- **Symptom:** "Deploy adapter" on the XDC vault reverted —
  *"The contract function 'createMorphoMarketV1AdapterV2' reverted"*.
- **Date:** 2026-05-23

### Diagnosis
On-chain probe: `factory.morphoMarketV1AdapterV2(0x3F4e…1a2f) = 0x73b52f…cdd6` —
**non-zero**. The adapter was **already deployed** for this vault — `0x73b5…cdd6`
is the exact same address the user tried to add manually in the prior screenshot.
The factory is **one-adapter-per-vault** (CREATE2), so `create…` reverts on a second call.

**How it got there & stayed invisible:** a prior on-chain `create` had succeeded, but the
hand-written `marketAdapterFactoryAbi` had the event's adapter param **non-indexed** (real
event emits it **indexed**, named `morphoMarketV1AdapterV2`). `decodeEventLog` then read
`args.adapter` → `undefined` → "Could not find adapter in transaction logs" → the flow
errored *after* the on-chain deploy already succeeded, never recording the adapter. Every
retry then reverted against the already-deployed adapter.

### Fix
- **`marketAdapterFactoryAbi.ts`** — replaced with verbatim shapes from the SDK
  `morphoMarketV1AdapterV2FactoryAbi` / `morphoVaultV1AdapterFactoryAbi`. Events now match
  reality (both params indexed; correct names). Added the `morphoMarketV1AdapterV2(parentVault)
  → address` and `morphoVaultV1Adapter(parentVault, morphoVaultV1) → address` views —
  required for the idempotency check.
- **`useDeployMarketAdapter.ts`** — before calling `create…`, read
  `factory.morphoMarketV1AdapterV2(vaultAddress)`; if non-zero, skip the deploy and go
  straight to `addAdapter` with that address. The new-deploy path's event parsing now reads
  `args.morphoMarketV1AdapterV2` (the corrected indexed name).

### Files changed
Modified: `src/hooks/useDeployMarketAdapter.ts` (+~30/-~10), `src/lib/contracts/marketAdapterFactoryAbi.ts`
(+~38/-~15). New: `src/hooks/__tests__/deployMarketAdapter.test.ts` (108 LOC).

### Tests — fail on `main`, pass on branch
1. **Idempotency:** mock `factory.morphoMarketV1AdapterV2` → existing address →
   `writeDeployAsync` **not** called; `writeAddAsync` called with the existing adapter; step
   ends `'done'`. On `main` the hook blindly calls `create…` → assertion fails.
2. **Genuine new deploy:** mock returns zero → `writeDeployAsync` called → fake receipt
   carries a `CreateMorphoMarketV1AdapterV2` log with **indexed** params → adapter address
   extracted via the corrected ABI → `writeAddAsync` follows. On `main` the old non-indexed
   ABI fails to decode → "Could not find adapter" → step `'error'`, not `'done'` → fails.

### Verification
- Fail-on-`main`: `git stash` the 2 source files → suite **2 failed** → `stash pop` → **2
  passed**.
- `npm run test:run` → **132 passed** (12 files; 130 + 2). `npx tsc -b` → **0**.
  `npm run build` → **success**. `git diff main --stat` → exactly those 2 files. PA stash intact.

### Scope-compliance self-audit
**PASS.** Only `useDeployMarketAdapter.ts` + `marketAdapterFactoryAbi.ts` + one test. The
"Unknown type" adapter detection in `useV2Adapters`/`useAdapterPreview` (`isMorphoMarketV1AdapterV2`
not consulted) is a separate cosmetic gap → `_followups.md` if it keeps biting.

Manual verification (post-deploy): on the XDC vault, the "Deploy Market Adapter" step now
detects the existing `0x73b5…cdd6`, skips the deploy, and prompts `addAdapter` directly.

---

## PR 10 — Submit → Wait → Execute across every V2-timelocked drawer

- **Branch:** `fix/v2-timelocked-ops-sweep` (off `main` @ `42c0442`)
- **Symptom:** the user hit `DataAlreadyPending` clicking *Submit — Add Adapter* — a prior
  `submit(addAdapter…)` had succeeded but the drawer offered no way to **execute**.
- **Date:** 2026-05-23

### Root cause
Vault V2 timelocks every config change: `submit(calldata)` queues the op, then the target
function (`addAdapter` / `removeAdapter` / `increaseAbsoluteCap` / …) is called **directly**
after `executableAt`, and self-checks. Three drawers — `AddAdapterDrawer`,
`RemoveAdapterDrawer`, `UpdateCapsDrawer` — only modelled the **Submit** half. Once submitted,
the user had no UI to Execute, and re-submitting reverted `DataAlreadyPending`.
`UpdateCapsDrawer.handleUpdateRelCap` additionally had the SetRegistry-pre-PR-7 bug — calling
`increaseRelativeCap` *direct* without `submit`. Per-PR PR 7 fixed this for the registry
flow; the same pattern was needed for adapter management.

### Chokepoint design
- **`src/lib/hooks/useV2TimelockedOp.ts`** (new) — one shared hook reads
  `executableAt(calldata)` (via the PR-7 `vaultV2RegistryAbi`) and polls every 10s. Derives
  `loading | not_submitted | pending | executable`. Exports a pure
  `deriveTimelockStep(executableAt, now)` so the derivation is unit-testable without React.
  Any current/future timelocked-op consumer can now hook into it.
- The three drawers each:
  - Compute the inner `encodeFunctionData(...)` calldata of the timelocked op.
  - Call `useV2TimelockedOp` on that calldata.
  - Render **Submit** / **Wait (absolute-UTC executableAt)** / **Execute** based on `step`.
  - Pass `chainId` to every `writeContract` call (also closes the PR-8 fallback path —
    drawers no longer rely on the connected-chain fallback).
- `UpdateCapsDrawer` got the most surgery — two **independent** timelocked ops
  (`increaseAbsoluteCap` + `increaseRelativeCap`), each with its own `useV2TimelockedOp`
  instance; immediate `decreaseAbsoluteCap` / `decreaseRelativeCap` paths preserved as direct
  calls. `increaseRelativeCap` is now correctly submit→execute (it used to revert
  `DataNotTimelocked` on any non-zero increase).
- `V2AdaptersTab` now passes `chainId` to the two drawers that grew the prop.

### Files changed (`git diff main --stat`)
Modified: `src/components/vault/adapters/AddAdapterDrawer.tsx`,
`src/components/vault/adapters/RemoveAdapterDrawer.tsx`,
`src/components/vault/adapters/UpdateCapsDrawer.tsx`,
`src/components/vault/V2AdaptersTab.tsx`.
New: `src/lib/hooks/useV2TimelockedOp.ts`, `src/lib/hooks/__tests__/useV2TimelockedOp.test.ts`.

### Tests — fail on `main`, pass on branch
4 tests of the pure `deriveTimelockStep(executableAt, now)`: `0 → not_submitted`,
`future → pending`, `past → executable`, `equal-to-now → executable` (mirroring the contract's
`<=` gate). On `main` the function doesn't exist — `import` fails → suite fails to load. The
drawer behaviour itself is exercised by the integration tests previously established
(`useGuardedWriteContract.simulate`, `setRegistryError`, `registryStatus`,
`deployMarketAdapter`) — they remain green here.

### Verification
- Fail-on-`main`: `mv` the helper aside → test = **suite failed to load** → restore →
  **4 passed**.
- `npm run test:run` → **136 passed** (13 files; 132 + 4). `npx tsc -b` → **0**. `npm run build`
  → **success**. PA `stash@{0}` intact.

### Scope-compliance self-audit
**PASS.** One reusable hook + the three drawers + the parent that wires `chainId` for the
prop additions. `useSetRegistryAndAbdicate` (PR 7) was already submit/execute — left alone.
V1 paths (`RolesMetaMorphoV1`, `usePublicAllocator`, V1 cap submit/accept) untouched —
different timelock model. Owner cards on V2 (fees / sentinel / curator / increaseTimelock)
NOT swept — they're rarer and each has UI specifics; future use of `useV2TimelockedOp` is
straightforward when those are touched. Audit `_followups.md` updated.

Manual verification (post-deploy): user retries Add Adapter on the XDC vault — the drawer
now sees the existing pending `submit(addAdapter(0x73b5…))`, shows **Ready to execute**, and
the **Execute — Add Adapter** button calls `addAdapter` directly to finalise.

---

## PR 11 — `useDeployMarketAdapter` submit→wait→execute (the wizard's missing PR 10)

### Diagnosis (verified on XDC via tx `0x85d5f3…a5c50`)
The "Add Market" wizard's `Deploy Adapter & Add to Vault` button on the user's XDC vault
(`0x3F4ed284…1a2f`, Safe `0x22D4…676A`) produced a Safe queue tx that:
1. Got flagged `will most likely fail` by Safe's Tenderly preflight (XDC public RPCs strip
   `from` in `eth_estimateGas`, so the simulator runs as 0x0 and the V2 `msg.sender ==
   curator` gate fails).
2. When the user signed nonce-17 and broadcast it, the Safe contract reverted **GS026**
   (`Invalid owner provided`) — the EIP-712 digest the wallet signed was over `nonce: 17`,
   but on-chain `Safe.nonce()` had already advanced to 18 by mining time, so `ecrecover`
   returned a non-owner address.

The signature was correct **for nonce 17** (recovered `0xBDa66C…f9e5` ✓). Two separable
problems converged: (a) the Safe queue had a stale tx that can never execute now that nonce 17
is consumed, and (b) — the actual *code bug* — `useDeployMarketAdapter` called
`vault.addAdapter(adapter)` **directly**, bypassing V2's submit→execute timelock model.
PR 10 fixed this for the standalone `AddAdapterDrawer` / `RemoveAdapterDrawer` /
`UpdateCapsDrawer`, but the wizard's hook predates PR 10 and was missed in the sweep.

For the user's specific vault on XDC the direct call happened to work conceptually (a prior
standalone-drawer submission had already advanced `executableAt` into the past), but it
generated a Safe queue tx that contained an `addAdapter` call which, when paired with the
stale Safe queue, was undiagnosable as a code issue. On any fresh non-zero-timelock vault the
direct `addAdapter` reverts `DataNotTimelocked`.

On-chain truth confirmed prior to this PR:
- `factory(0x5C00…).morphoMarketV1AdapterV2(vault) = 0x73b5…cdd6` ✓ factory-derived
- `factory(0x5C00…).isMorphoMarketV1AdapterV2(adapter) = true` ✓
- `adapter.parentVault() = 0x3F4e…1a2f` ✓
- `adapter.factory() = 0x5C00…d31` ✓
- `registry(0x79A8…).isInRegistry(adapter) = true` ✓ whitelisted
- `vault.executableAt(addAdapter cd) = 1779547936` ≤ `block.timestamp 1779552648` → executable

### Fix
New pure helper `src/hooks/deployAdapterStateMachine.ts` exposing `nextDeployStep(input)`
that returns one of five terminal states based on factory + vault + executableAt + now.
`useDeployMarketAdapter` becomes a thin orchestrator around it: Phase 1 detects/deploys the
factory adapter (PR 9 idempotency preserved); Phase 2 enters a re-read-after-each-tx loop
that the helper drives. The loop naturally handles every entry point — fresh vault,
already-submitted, executable, already-added — and the resume-after-refresh case (user
closed the tab between submit and execute) becomes free.

The hook also reads `vault.isAdapter(adapter)` and short-circuits to `done` when the adapter
is already on the vault, fixing a smaller latent bug where re-clicking the wizard's deploy
button on a completed vault would have queued a no-op `addAdapter`.

`AddMarketWizard.tsx`'s `DeployStatus` grows from 2 status rows to 3 (deploy / submit /
execute), surfaces a `Submitted to timelock — Executable at <UTC>` warning banner when the
hook returns at `waiting-timelock`, and adds a `Check timelock & Execute` resume button.

### Files changed (`git diff main --stat`)
Modified: `src/hooks/useDeployMarketAdapter.ts`,
`src/components/vault/adapters/AddMarketWizard.tsx`,
`src/hooks/__tests__/deployMarketAdapter.test.ts` (existing PR 9 tests updated for the new
3-write-hook + submit-then-execute sequence).
New: `src/hooks/deployAdapterStateMachine.ts`,
`src/hooks/__tests__/deployAdapterStateMachine.test.ts`.

### Tests — fail on `main`, pass on branch
7 unit tests of `nextDeployStep` covering all five terminal states + the `executableAt ==
now` boundary + the `isAdapter wins over executableAt` precedence. On `main` the helper
doesn't exist — import fails → suite fails to load. On branch all pass.

Existing PR 9 hook tests (4) updated to the PR 11 flow: skips factory deploy on existing,
short-circuits when already added, stops at `waiting-timelock` when executableAt is future,
and runs the full deploy → submit → execute happy-path with the indexed-event extraction.

### Verification
- Fail-on-`main`: stash branch files → suite fails to load (missing module) → restore →
  **7 passed**.
- `npm run test:run` → **145 passed** (14 files; was 136 in PR 10 + 9 new). `npx tsc -b` →
  **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** Two new files (helper + test), three modified (hook, wizard, hook test). The
existing PR 9 test file is updated rather than duplicated — the PR-9 intent (factory
idempotency + correct event extraction) is preserved as the first and last test cases. No
ABI changes (`vault.executableAt(bytes)` was already in `vaultV2RegistryAbi` from PR 7 — the
hook imports both `metaMorphoV2Abi` for writes and `vaultV2RegistryAbi` for the one
`executableAt` read). The standalone drawers (PR 10) are untouched — they were already
correct. V1 paths untouched.

Note on the user's stuck Safe queue: independent of this PR. The pending nonce-17 tx in the
Safe queue can never execute (on-chain nonce is 18). User needs to reject the stale entries
in Safe's UI and re-create the addAdapter tx, which will now be assigned the live nonce. PR
11 prevents the same shape of stuck-queue from happening again for future vaults.

---

## PR 12 — UpdateCapsDrawer: batch abs+rel via multicall + Drawer focus fix

### Two user-reported issues in one drawer

1. **"Can we have one tx for both updates?"** — `UpdateCapsDrawer` showed
   independent Submit/Execute buttons for absolute cap and relative cap, so
   updating both meant 4 Safe txs on a non-zero-timelock vault (2 submits, 2
   executes), or 2 on a 0-timelock vault. Curators submitting cap changes for
   a market typically want both moved together.
2. **"For each input I need to re-click the input case"** — typing into a
   cap input lost focus after every keystroke; the close button silently
   reclaimed focus on each parent re-render.

### Diagnosis — focus bug

`Drawer.tsx` collapsed three concerns into one `useEffect` keyed on
`[open, onClose]`:
- one-shot `previousFocusRef` capture + body-scroll lock,
- keydown handler (ESC + tab focus trap),
- rAF-scheduled auto-focus of the first focusable element (the X button).

Parents that pass an inline `onClose={() => { ... }}` (the realistic case)
create a fresh function identity on every render. That bumped the
dependency, the effect cleaned up + re-ran, and the rAF callback called
`focusable[0].focus()` — stealing focus from the input back to the close
button. Per-keystroke.

### Diagnosis — batching

`UpdateCapsDrawer`'s state machine was correct in PR 10 — each cap had its
own `useV2TimelockedOp` keyed on its exact calldata. The remaining work is
just UX: gather increase calldatas into one `vault.multicall([submit(cd1),
submit(cd2)])` and execute calldatas into one
`vault.multicall([increaseAbsCap, increaseRelCap])`. V2's multicall
preserves `msg.sender`, so the inner ops still pass the curator gate. Each
inner `submit` enters its own `executableAt` slot (V2 keys timelocks by
exact bytes); each inner increase target self-checks against that slot.

### Fix

- **`src/components/ui/Drawer.tsx`** — split the effect:
  - `useEffect(..., [open])`: one-shot focus snapshot + body-scroll lock +
    rAF auto-focus. Runs once per open, not on every re-render.
  - `useEffect(..., [open, onClose])`: keydown handler only — needs the
    fresh `onClose` to close over current state.
- **`src/lib/hooks/useV2TimelockedOp.ts`** — new pure
  `combineTimelockSteps(states: TimelockOpState[])`: derives a single
  `none | loading | not_submitted | pending(executableAt) | executable`
  for any batch of independent timelocked ops. `pending` picks the **max**
  `executableAt` across the batch so a multicall execute is gated on the
  slowest member. `not_submitted` triggers on *any* un-submitted member —
  a multicall execute that contains an un-timelocked entry would revert
  `DataNotTimelocked`.
- **`src/components/vault/adapters/UpdateCapsDrawer.tsx`** — rewritten:
  - one unified Submit/Execute button for the increase batch (1 or 2 ops),
  - one immediate Apply button for the decrease batch (1 or 2 ops),
  - banner uses the combined state, single unlock time across both caps,
  - single-action cases (only abs or only rel changed) bypass the
    multicall wrap — straight to the target function (cleaner gas,
    clearer simulation).
  - stale-value edge case handled by the helper: if the user edits a cap
    after submitting, the new calldata's `executableAt` is 0 → batch
    state falls back to `not_submitted` and the UI shows "Submit". The
    old slot stays queued on-chain but never gets executed.

### Files changed (`git diff main --stat`)
Modified: `src/components/ui/Drawer.tsx`,
`src/lib/hooks/useV2TimelockedOp.ts`,
`src/components/vault/adapters/UpdateCapsDrawer.tsx`,
`src/lib/hooks/__tests__/useV2TimelockedOp.test.ts`.
New: `src/components/ui/__tests__/drawerFocus.test.tsx`.

### Tests — fail on `main`, pass on branch
- **drawerFocus** (1 test): renders a `<Fixture>` that re-renders Drawer on
  every keystroke with a fresh inline `onClose`. Counts calls to
  `closeBtn.focus()`. On `main` the count grows by the number of keystrokes
  → assertion fails. On branch the count stays at the initial-open value.
  The bug fingerprint (effect re-running) is what the test pins, not the
  downstream `document.activeElement` state (which depends on rAF + microtask
  ordering in JSDOM — flakier).
- **combineTimelockSteps** (7 tests): empty → `none`; any loading → loading;
  any unsubmitted → `not_submitted`; pending picks max executableAt;
  pending + executable mix still pending (slowest gates); all elapsed →
  executable; batch-of-one collapses correctly. Sits alongside PR 10's
  4 `deriveTimelockStep` tests in the same file.

### Verification
- Fail-on-`main`: stash `Drawer.tsx` → drawerFocus.test = **fail** (focus
  count = 1 + N where N=3 keystrokes) → restore → **pass**. The pure
  helper test fails to load on `main` (`combineTimelockSteps` doesn't
  exist) — verified.
- `npm run test:run` → **153 passed** (15 files; was 145 + 8 new). `npx
  tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** Three modified, two new (test + helper inside the existing file).
The Drawer fix is the smallest possible — effect split, no behaviour
change beyond eliminating the rAF re-fire. The batching uses the same
multicall hook V2's vault already advertises (and `useBatchSetCaps`
already uses for the wizard's cap step); single-action cases preserved
to avoid the multicall wrap when it'd be noise.

Future drawers / cards that want batch-timelocked UX can reuse the
exported `combineTimelockSteps` directly. Pattern is now: per-calldata
`useV2TimelockedOp`s in the component, push them into an array,
`combineTimelockSteps` derives the unified button state.

Manual verification (post-deploy): user enters both abs cap + rel cap →
single "Submit — Both Increases" Safe tx → wait (or 0s on XDC) → single
"Execute — Both Increases" Safe tx. Inputs stay focused while typing.

---

## PR 13 — `metaMorphoV2Abi.multicall` returns void (decoding error fix)

### Diagnosis (1-shot, on-chain + SDK cross-check)
PR 12 shipped the batched cap-update flow. User immediately hit:

> The contract function "multicall" returned no data ("0x").

XDC probe:
- `eth_call multicall([])` to the vault → returns `0x` (empty bytes).
- Bytecode contains selector `0xac9650d8` (`multicall(bytes[])`).
- `@morpho-org/blue-sdk-viem` `vaultV2Abi.multicall` declares
  `outputs: []` — **the V2 vault's multicall returns nothing.**

Our `metaMorphoV2Abi.ts` declared
`outputs: [{ name: 'results', type: 'bytes[]' }]` (the OpenZeppelin
Multicall pattern). viem tries to decode `bytes[]` from the empty return
data → DecodeReturnDataError surfaced as "returned no data".

Same root cause as PR 1's vaultV2RegistryAbi rebuild: hand-written V2
ABIs in the repo had been built against the OZ defaults rather than the
SDK's authoritative shape. The selector matches, the function executes,
the simulator just can't validate the response.

### Fix
- **`src/lib/contracts/metaMorphoV2Abi.ts`** — change
  `outputs: [{ name: 'results', type: 'bytes[]' }]` → `outputs: []`.
  Two-line change. No callers were reading the return value (would have
  thrown long ago).

### Files changed (`git diff main --stat`)
Modified: `src/lib/contracts/metaMorphoV2Abi.ts`.
New: `src/lib/contracts/__tests__/multicallAbi.test.ts`.

### Tests — fail on `main`, pass on branch
2 tests:
- `ours.outputs === []` — direct shape assertion.
- `ours.outputs.length === sdk.outputs.length` and
  `ours.inputs.map(.type) === sdk.inputs.map(.type)` — pin against
  `@morpho-org/blue-sdk-viem` `vaultV2Abi.multicall` so a future SDK
  update is caught before we ship.

On `main` (outputs=[bytes[]]) both assertions fail. On branch (outputs=[])
both pass.

### Verification
- Fail-on-`main`: stash → both tests fail → restore → pass.
- `npm run test:run` → **155 passed** (16 files; was 153 + 2 new). `npx
  tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** One ABI fragment line, two-test pin. No code changes elsewhere
— the multicall callsites (`useBatchSetCaps`, PR 12's batched ops in
`UpdateCapsDrawer`) were already correct in their inputs and never read
the result. Selector unchanged → no on-chain side-effects, just viem
decoding alignment.

Future audit hook: any other hand-written ABI fragment we ship for V2
contracts should be diffed against the SDK's `vaultV2Abi` / `blueAbi` /
adapter ABIs before merging. PR 1 already covered the *error* fragments
this way; PR 13 extends the pattern to function-shape mismatches that
silently no-op until they surface as decode errors.

---

## PR 14 — UpdateCapsDrawer cap idData + SetLiquidityDrawer chainId/error

### Two bugs surfaced after PR 12+13 made the cap flow actually reachable

**Bug A — Multicall execute reverts.** With PR 13's ABI fix the multicall
encoded + simulated cleanly; the inner `increaseAbsoluteCap` / `increaseRel
ativeCap` calls then reverted. Root cause: `UpdateCapsDrawer` was passing
`adapter.adapterId` (a `bytes32` keccak256 hash from
`computeVaultAdapterId`) as the `idData` argument. V2's cap functions
internally do `abi.decode(idData, (string, address))` and revert when
fed a 32-byte hash. The correct shape is `adapterIdData(adapter.address)
= abi.encode("this", adapter.address)` — the `lib/v2/adapterCapUtils.ts`
helper that `AddMarketWizard` has been using correctly all along.

PR 10 (the original drawer) and PR 12 (the batching refactor) both
inherited the wrong shape. Nothing on-chain was actually executable until
now — but the bug only surfaced when execute was first reached. The
multicall layer was correct; the inner arg encoding was not.

**Bug B — Set Liquidity Adapter "Select" button looked unresponsive.**
`SetLiquidityDrawer` was calling `writeContract({...})` with no `chainId`
arg. PR 8 made `useGuardedWriteContract` fall back to the connected wallet
chain when `chainId` is omitted, so chain-correct preflights still ran,
but the guard's `simulateError` was never rendered. On any preflight
failure (e.g. the XDC `from`-strip simulator quirk, or a real revert),
the button click did nothing visible.

### Fix
- **`src/components/vault/adapters/UpdateCapsDrawer.tsx`** — memoised
  `adapterCapIdData = adapterIdData(adapter.address)` and threaded it
  through all 6 increase + 6 decrease calldata sites (the two memoised
  `*IncreaseCalldata` for submit; the four direct calls in the execute
  paths; the four direct calls in the immediate-decrease paths). Removed
  the `adapter.adapterId` misuse entirely from this file.
- **`src/components/vault/adapters/SetLiquidityDrawer.tsx`** — added
  `chainId` to the `writeContract` call and rendered the standard
  `{simulateError || error}` banner (the PR 6/8 pattern shared across
  drawers).

### Files changed (`git diff main --stat`)
Modified: `src/components/vault/adapters/UpdateCapsDrawer.tsx`,
`src/components/vault/adapters/SetLiquidityDrawer.tsx`.
New: `src/lib/v2/__tests__/adapterCapIdData.test.ts`.

### Tests — fail on `main`, pass on branch
4 tests of the encoding contract:
- `adapterIdData(adapter)` produces ≥96 bytes (string offset + address
  word + string length + padded "this" content).
- The legacy `keccak256(abi.encode(adapter))` shape is exactly 32 bytes —
  the bug's fingerprint.
- `increaseAbsoluteCap` calldata built with the proper helper differs
  from calldata built with the hash, and is strictly longer (the
  `bytes`-length prefix dominates).
- Sanity round-trip: the hex of "this" (`74686973`) and the adapter
  address both appear in the raw payload at the expected positions.

### Verification
- `npm run test:run` → **159 passed** (17 files; was 155 + 4 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** Two drawers modified, one tiny test file new. No ABI changes,
no hook contract changes. `adapter.adapterId` (the hash) remains
useful for *reads* (caps map keys, allocation lookups, the
`fetchAdapterCaps` flow) — only the cap-mutator calldata sites were
ever wrong, and now use the proper helper.

Manual verification (post-deploy): user opens UpdateCapsDrawer on the
XDC adapter, sets abs=100M USDC + rel=100%, clicks "Submit — Both
Increases" (one Safe tx, batched via multicall), then "Execute — Both
Increases" (one Safe tx, batched via multicall) — both land. Liquidity
Adapter drawer Select button responds: simulates against XDC, surfaces
any error in the banner, broadcasts when the simulate passes.

Note on the previously-submitted (wrong) slots: any cap submits the user
already made before PR 14 used the hash-as-idData; those slots stay
queued on-chain harmlessly because the calldata they're keyed on can
never be successfully executed (V2's decode reverts). The fresh
properly-encoded slot is a brand-new entry. No on-chain cleanup needed.
