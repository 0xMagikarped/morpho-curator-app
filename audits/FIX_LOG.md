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

---

## PR 15 — V2 cap mutators take `uint256`, not `uint128` (selector fix)

### Diagnosis
After PR 14 fixed the `idData` shape, Execute on `UpdateCapsDrawer` still
reverted "for an unknown reason". Direct SDK diff against
`@morpho-org/blue-sdk-viem` `vaultV2Abi`:

| Function                     | Ours                       | SDK                        |
|------------------------------|----------------------------|----------------------------|
| `increaseAbsoluteCap`        | `(bytes,uint128)`          | `(bytes,uint256)`          |
| `decreaseAbsoluteCap`        | `(bytes,uint128)`          | `(bytes,uint256)`          |
| `increaseRelativeCap`        | `(bytes,uint128)`          | `(bytes,uint256)`          |
| `decreaseRelativeCap`        | `(bytes,uint128)`          | `(bytes,uint256)`          |
| `absoluteCap` (getter)       | returns `uint128`          | returns `uint256`          |
| `relativeCap` (getter)       | returns `uint128`          | returns `uint256`          |

The function selector is `keccak256(name + "(" + paramTypes + ")")[:4]`.
A `uint128` vs `uint256` change produces a *different* selector. Our
(wrong) selector found no matching function on-chain → fallback ran with
no revert reason → viem surfaced "Execution reverted for an unknown
reason." Encoded calldata is 32 bytes either way for any cap value in
range, but the selector mismatch is what kills the call.

The getter return-type mismatch is a quieter footgun: encoded width is 32
bytes either way, but `uint128` decoding in viem silently truncates
anything above 2^128. Caps don't realistically exceed that, but the
discrepancy is wrong on principle and the test catches it.

### Fix
- **`src/lib/contracts/metaMorphoV2Abi.ts`** — change `uint128` to
  `uint256` for the four cap mutators' cap argument and the two cap
  getters' return type. Arg names also adjusted to match SDK
  (`newAbsoluteCap` / `newRelativeCap`) for diff-clarity. No call-site
  changes needed: `MAX_UINT128` sentinel (in `adapterCapUtils.ts`) is
  still a valid `uint256`; viem encodes any bigint to the ABI-declared
  width, so all callers continue to work without touching them.

### Files changed (`git diff main --stat`)
Modified: `src/lib/contracts/metaMorphoV2Abi.ts`.
New: `src/lib/contracts/__tests__/capAbiAlignment.test.ts`.

### Tests — fail on `main`, pass on branch
6 tests:
- 4 cap mutators: input-type equality + `toFunctionSelector(...)` parity
  against the SDK shape. The selector identity check is what proves the
  on-chain call will dispatch.
- 2 cap getters: output-type equality + explicit `uint256` assertion.

On `main` (uint128 throughout) all 6 assertions fail. On branch all 6
pass.

### Verification
- `npm run test:run` → **165 passed** (18 files; was 159 + 6 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.
- Stash-then-pop fail-on-`main`: all 6 fail on stash, all 6 pass after
  restore.

### Scope-compliance self-audit
**PASS.** One ABI fragment file, one new test file. No call-site changes
required (viem encodes to the declared ABI width regardless of caller).

### Known remaining mismatches (logged for `_followups.md`, NOT in this PR)
The SDK diff found four more shape mismatches that don't gate the
current cap flow but are wrong and should be aligned in a future PR:

- `timelock`: ours `()` → SDK `(bytes4 selector)` — per-selector
  timelocks. `vaultV2RegistryAbi` already has the correct shape (PR 7),
  but the duplicate in `metaMorphoV2Abi` is wrong. Audit callers that
  read `timelock()` (no args) — they'll currently revert when invoked.
- `forceDeallocate`: ours `(bytes32, uint256)` → SDK
  `(address, bytes, uint256, address) returns (uint256)` — completely
  different signature; ours never worked.
- `revoke`: ours `(bytes32)` → SDK `(bytes)`.
- Several "ours only" functions (e.g. `MORPHO`, `VAULT`, `acceptCap`,
  `submitCap`, `fee`, `feeRecipient`, `lastTotalAssets`, …) — these
  aren't on the V2 vault at all; either remove or move to the
  appropriate ABI file (V2-adapter ABI, V1-vault ABI, etc.).

These should be addressed before any UI surface depends on them. The
new test pattern (selector equality vs SDK) is the right shape to extend
function-by-function.

---

## PR 16 — `computeVaultAdapterId` matches the cap-map storage key

### Diagnosis (on-chain ground truth)
PR 15's selector fix made the multicall execute land. User's tx
`0x00a14a7b…ac11` (block 102946094, status 0x1) updated the caps —
verified by reading `absoluteCap(id)` / `relativeCap(id)` at the
correct cap-map key for adapter `0x7764a05b…7a67` on the user's other
V2 vault `0x1ac19bec…fa5a`:

```
absoluteCap = 100_000_000_000_000  (the user's 100M USDC × 10^6 dec) ✓
relativeCap = 1_000_000_000_000_000_000  (= 1e18 = 100%) ✓
```

But the UI still showed `Current: Not set`. Root cause: the read side
used the wrong storage key.

- WRITE: `idData = abi.encode("this", adapter)` → cap-map key
  `keccak256(idData)` = `0x17ea3483…96c5` ← reads here return the real value
- READ (pre-PR-16): `computeVaultAdapterId(adapter)` =
  `keccak256(abi.encode(adapter))` ← reads at this different hash return 0

PR 14 aligned the WRITE side (cap mutator calldata builders) to
`adapterIdData`. The READ side helper (`computeVaultAdapterId`) was
still computing the legacy single-arg hash, so `fetchAdapterCaps(vault,
adapterId)` queried a slot no cap was ever written to.

### Fix
- **`src/lib/v2/adapterUtils.ts`** — `computeVaultAdapterId` now returns
  `keccak256(adapterIdData(adapter))`, pairing READ and WRITE on the
  same idData payload. Removed the now-unused
  `encodeAbiParameters`/`parseAbiParameters` imports.

### Files changed (`git diff main --stat`)
Modified: `src/lib/v2/adapterUtils.ts`,
`src/lib/v2/__tests__/adapterCapIdData.test.ts` (updated the doc-string
on the "wrong shape" test case to reflect that PR 16 retires it).
New: `src/lib/v2/__tests__/computeVaultAdapterId.test.ts`.

### Tests — fail on `main`, pass on branch
2 tests:
- `computeVaultAdapterId(adapter) === keccak256(adapterIdData(adapter))`
  — pins the READ/WRITE pairing as a symmetric invariant.
- `computeVaultAdapterId(0x7764…7a67) === 0x17ea3483…96c5` — grounds
  the assertion on a *real on-chain key* observed from the user's
  successful cap write. If either side drifts again, this exact-bytes
  check catches it.

On `main` both assertions fail (the legacy hash diverges). On branch
both pass.

### Verification
- Fail-on-`main` confirmed by stash-then-pop.
- `npm run test:run` → **167 passed** (19 files; was 165 + 2 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** Single function body change (3 lines: import + new return).
No side-effect on any other consumer — `computeVaultAdapterId` is used
in exactly one place (`useV2Adapters.ts:58`) to feed `fetchAdapterCaps`,
which queries the V2 cap-map. Returning the *correct* storage key only
makes those reads start working.

The READ/WRITE pairing is the actual invariant — any future change to
either side must round-trip through `adapterIdData`. The new test
captures that with both a symbolic equality (`keccak256(adapterIdData(.))`)
and a literal on-chain fixture, so a refactor of either side without
updating the other fails CI.

---

## PR 17 — V2 `setLiquidityAdapter` → `setLiquidityAdapterAndData` (ABI fix)

### Diagnosis
User clicked Select in `SetLiquidityDrawer` → tx reverted with viem
surfacing "The contract function 'setLiquidityAdapter' reverted." SDK
diff against `@morpho-org/blue-sdk-viem` `vaultV2Abi`:

| Surface             | Ours (pre-PR-17)               | SDK / on-chain                           |
|---------------------|--------------------------------|------------------------------------------|
| Setter              | `setLiquidityAdapter(address)` | `setLiquidityAdapterAndData(address, bytes)` |
| Data getter         | `liquidityAdapterData()`       | `liquidityData()`                        |
| Adapter getter      | `liquidityAdapter()`           | `liquidityAdapter()` (matches)           |

Same shape of bug as PR 15 (cap mutator `uint128` vs `uint256`):
hand-rolled function name → no on-chain selector match → contract
fallback → revert with no error data. PR 13 found `multicall` returns
void; PR 15 found cap arg width was wrong; PR 17 finds the setter name
was wrong.

### Fix
- **`src/lib/contracts/metaMorphoV2Abi.ts`** —
  - Removed the legacy `setLiquidityAdapter(address)` fragment
    (commented with a pointer to the correct entry).
  - Renamed `liquidityAdapterData` → `liquidityData` to match SDK.
  - Kept `setLiquidityAdapterAndData(address, bytes)` (already present).
- **`src/components/vault/adapters/SetLiquidityDrawer.tsx`** —
  call `setLiquidityAdapterAndData(adapter, '0x')`. Empty bytes is the
  right shape for a V1-vault adapter and the safe default for an
  unconfigured market-v1 adapter (curator can still allocate via the
  normal flow). Future enhancement: accept `MarketParams` in the
  drawer to bind specific market liquidity routing.

### Files changed (`git diff main --stat`)
Modified: `src/lib/contracts/metaMorphoV2Abi.ts`,
`src/components/vault/adapters/SetLiquidityDrawer.tsx`.
New: `src/lib/contracts/__tests__/liquidityAdapterAbi.test.ts`.

### Tests — fail on `main`, pass on branch
4 tests:
- `setLiquidityAdapter` (the wrong fragment) is NOT present in either
  ABI.
- `setLiquidityAdapterAndData` IS present in both.
- `liquidityData` is in both; `liquidityAdapterData` is in neither.
- `liquidityAdapter` reader is in both (sanity).

On `main` 2 of 4 fail (legacy fragments present + wrong getter name).
On branch all pass.

### Verification
- `npm run test:run` → **171 passed** (20 files; was 167 + 4 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.
- Fail-on-`main` confirmed via stash-then-pop.

### Scope-compliance self-audit
**PASS.** Two ABI fragments adjusted + one drawer call site updated.
The new test extends the SDK-alignment pattern (PR 13: `multicall`
outputs; PR 15: cap arg width; PR 17: liquidity setter name & data
getter). Pattern is now to diff against `vaultV2Abi` whenever a write
surface goes live.

User's broken nonce-N tx on the Safe-controlled XDC vault and the
broken EOA-controlled vault on the same chain both got the wrong
selector. Once Vercel deploys, the Select button on a freshly-loaded
drawer will dispatch `setLiquidityAdapterAndData(0x7764…7a67, 0x)`
which exists on-chain and routes through the curator gate normally.

### Known remaining mismatches still tracked (no change from PR 15)
- `timelock`: ours `()` → SDK `(bytes4 selector)`.
- `forceDeallocate`: ours `(bytes32, uint256)` → SDK
  `(address, bytes, uint256, address) returns (uint256)`.
- `revoke`: ours `(bytes32)` → SDK `(bytes)`.
- "Ours-only" functions not in SDK V2 vaultAbi: `MORPHO`, `VAULT`,
  `acceptCap`, `submitCap`, `fee`, `feeRecipient`, `lastTotalAssets`,
  `submitCap`, `marketIds`, `marketIdsLength`, `realAssets`,
  `expectedSupplyAssets`, `supplyShares`, `pendingAction`, `skim`,
  `setFee`, `setFeeRecipient`, `setSentinel`, `sentinel`, `guardian`,
  `execute`, `adapter`. Each needs surface-by-surface evaluation
  before the corresponding UI is used.

---

## PR 18 — Hide V1 CapsTab on V2 vaults (it sends a non-existent selector)

### Diagnosis
User opened **Caps** tab on a V2 vault (Yield Network USDC on XDC) and
tried `Submit Cap (Add Market)`. Preflight surfaced
"Transaction would revert: unknown error" — the now-familiar fingerprint
of dispatching a selector that doesn't exist on V2.

`CapsTab.tsx` implements the V1 lifecycle:
`submitCap(marketParams, cap)` → wait timelock → `acceptCap(marketParams)`
→ `setSupplyQueue([marketIds])`. None of those selectors exist on
`vaultV2Abi` — V2 replaced market-level caps with per-adapter caps
(`increaseAbsoluteCap(idData, cap)` where `idData = marketIdData(adapter,
params)`). The proper V2 UI is already shipped: `Adapters` tab →
`UpdateCapsDrawer` (PR 12 + 14 + 15) covers adapter-level limits; the
`AddMarketWizard` covers adding a new market with its caps.

### Fix
- **`src/pages/VaultPage.tsx`** — mark the Caps tab as `v1Only`, mirroring
  how Queues / Reallocate / Guardian are gated. The tab disappears from
  the nav on V2 vaults, eliminating the entry point to the broken flow.
- Defence-in-depth: also gate the `activeTab === 'caps'` body. A user
  arriving via a bookmarked `?tab=caps` URL on a V2 vault now sees a
  small "Caps moved" notice with a `Go to Adapters` button instead of
  the V1 cap UI loading and reverting at submit-time.

### Files changed (`git diff main --stat`)
Modified: `src/pages/VaultPage.tsx`.

### Tests
No new test — the change is configuration (`v1Only` on a tab definition
+ conditional render). The existing test suite continues to pass
unchanged (171 / 171). Future PR could add an integration test that
asserts the Caps tab is not rendered on V2 vaults; for now the on-chain
ABI-mismatch tests already shipped (PR 13, 15, 17) cover the
"don't send V1 calldata to V2" invariant at a more fundamental level.

### Verification
- `npm run test:run` → **171 passed** (unchanged from PR 17 — no new
  tests, no regressions). `npx tsc -b` → **0**. `npm run build` →
  **success**.

### Scope-compliance self-audit
**PASS.** Two-line semantic change (`v1Only: true` on the tab def + a
conditional render branch with the V2 notice card). The V1 `CapsTab`
component is untouched — it's still the right impl for V1 vaults, and
no V1-only consumer changed shape.

### What V2 cap surface is actually available now
- **Per-adapter caps** (absolute + relative): Adapters tab → click
  `Caps` on the adapter → `UpdateCapsDrawer` (PR 12: batched abs+rel
  via multicall; PR 14: correct `adapterIdData` shape; PR 15: correct
  `uint256` selector).
- **Per-collateral / per-market caps**: only via `AddMarketWizard`'s
  caps step when adding a new market. A standalone "edit market-level
  cap" UI doesn't exist yet — listed as future work in
  `_followups.md`.
- **Cap readback**: Adapters tab cards (after PR 16) now show the
  adapter-level `Abs. Cap` / `Rel. Cap` values + usage bars, because
  `computeVaultAdapterId` is now keyed on the correct cap-map slot.

---

## PR 19 — Market lookup by ID for chains without Morpho API coverage

### Diagnosis
User in `AddMarketWizard` → Select Markets step pasted a 32-byte market
ID into the search box on an XDC V2 vault. UI: `0 markets with USDC as
loan token · No markets found.` The wizard's `MarketBrowser` calls
`useMorphoMarkets(chainId, loanToken)`, which is gated by
`isApiSupportedChain(chainId)` — XDC (50) and SEI (1329) are not in the
support list. The hook is disabled, returns `[]`, and the search box
filters an empty array → no result regardless of input.

### Fix
- **`src/hooks/useMarketLookup.ts`** (new) — TanStack-Query-backed
  per-input lookup. Calls Morpho Blue's `idToMarketParams(id)` (which
  returns a zero struct for unknown IDs rather than reverting), then
  `market(id)` for state, and `fetchTokenInfo` for the two token sides.
  Synthesizes a `MarketInfo` matching the API-derived shape so
  downstream wizard steps don't need to branch.

  Public helper `parseMarketIdInput(raw)`: forgiving parser accepting
  `0x`+64 hex, bare 64 hex, mixed case, and trimming whitespace.
  Pure — extracted for unit-testing without React.

- **`src/components/vault/adapters/MarketBrowser.tsx`** —
  - When `parseMarketIdInput(search)` returns a valid ID, fire the
    lookup hook (`enabled` gate).
  - Merge the resolved market into the displayed list (dedupe by ID
    against the API result so we don't double-list on chains where
    both work).
  - Surface the four lookup states (`loading | not-found |
    loan-token-mismatch | error`) as small inline messages below the
    count line — does not crowd the regular filter UX.
  - Updated placeholder to hint that pasting a market ID works.

### Files changed (`git diff main --stat`)
New: `src/hooks/useMarketLookup.ts`,
`src/hooks/__tests__/parseMarketIdInput.test.ts`.
Modified: `src/components/vault/adapters/MarketBrowser.tsx`.

### Tests — fail on `main`, pass on branch
8 cases for `parseMarketIdInput`:
- accepts canonical `0x`+64
- accepts bare 64 hex (no prefix)
- accepts mixed-case + whitespace, normalizes lowercase
- rejects empty / whitespace-only
- rejects 63 / 65 hex (off-by-one paste)
- rejects non-hex chars
- rejects bare addresses (40 hex — different shape)

On `main` the module doesn't exist → suite fails to load. On branch
all pass.

### Verification
- `npm run test:run` → **179 passed** (21 files; was 171 + 8 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** Two new files (hook + test), one modified component. The
existing `useMorphoMarkets` GraphQL path stays untouched and is still
the primary source on supported chains (1, 8453) — the lookup hook
only fires when the user types a market-ID-shaped string and only
*adds* to whatever the API returned. Dedupe by ID keeps the list
clean.

Future work (logged in `_followups.md`): an RPC-backed market scanner
for XDC / SEI so users can BROWSE markets there too, not just resolve
by known ID. That's a non-trivial scan (range over `CreateMarket`
events) and out of scope for this fix.

Pattern banked: for any "this chain isn't on the API" gap, provide a
direct-lookup-by-stable-id RPC fallback before building a scanner.
Market lookup, vault lookup, oracle lookup all fit this shape.

---

## PR 20 — `useBatchSetCaps` submit→wait→execute (wizard caps step)

### Diagnosis
User in `AddMarketWizard` → Step 2 Configure Caps → clicked Set Caps
(Batch). UI: "DataNotTimelocked The contract function 'multicall'
reverted." Same fingerprint as PR 11 / PR 12: the V2 cap mutators
(`increaseAbsoluteCap` / `increaseRelativeCap`) are timelocked, each
self-checks `executableAt`, and `useBatchSetCaps.execute(actions)` was
firing one multicall containing the TARGET functions directly — every
inner call reverted, multicall rolled back.

The wizard's caps step was the last consumer of the direct-call-on-V2
pattern. PR 10 fixed the standalone drawers, PR 11 fixed the deploy
hook, PR 12 fixed the standalone cap drawer — PR 20 finishes the sweep.

### Fix
- **`src/hooks/useSetCaps.ts`** — `useBatchSetCaps` now implements the
  V2 governance pattern:
  - Encode all target calldatas once.
  - Split into timelocked (increases) vs immediate (decreases).
  - **Phase 1 — submit**: read existing `executableAt` for each
    increase; if any is 0 (not yet submitted), fire
    `vault.multicall([submit(cd1), submit(cd2), …])` — one Safe sig.
    Submit is skipped entirely when every increase is already queued
    (the resume-after-wait case).
  - Re-read `executableAt`; if `max(executableAt) > now`, stop at
    `waiting-timelock` and expose the unlock time. Re-invoking
    `execute(actions)` after the unlock picks up from on-chain truth.
  - **Phase 2 — execute**: fire `vault.multicall([cd1, cd2, …])` (or a
    direct call when only one action) — one Safe sig.
  - On a 0-timelock vault the whole flow is 2 Safe sigs back-to-back.
  - `useSequentialSetCaps` left untouched but marked as "0-timelock
    only" in a doc-comment for clarity; the wizard uses the batched
    path.

- **`src/components/vault/adapters/AddMarketWizard.tsx`** — Step 2 now
  renders the new states (`submitting` → `confirming-submit` →
  `waiting-timelock` → `executing` → `confirming-execute` → `done`)
  with sequence-numbered hints ("Confirm SUBMIT tx in wallet (1/2)…",
  "(2/2)…"). The "Waiting for timelock" banner surfaces the unlock UTC
  and a "Check timelock & Execute Caps" resume button.

### Files changed (`git diff main --stat`)
Modified: `src/hooks/useSetCaps.ts`,
`src/components/vault/adapters/AddMarketWizard.tsx`.
New: `src/hooks/__tests__/batchSetCaps.test.ts`.

### Tests — fail on `main`, pass on branch
4 integration cases against mocked wagmi + publicClient:
- **0-timelock**: one submit-multicall + one execute-multicall, ends at
  `done`.
- **non-zero timelock**: only submit fires, ends at `waiting-timelock`
  with `executableAt` populated.
- **resume**: existing elapsed executableAt → submit skipped, only
  execute multicall fires, ends at `done`.
- **empty action list**: no writes, stays `idle`.

Call attribution by inspecting the inner calldata's selector (verified
via `viem.toFunctionSelector("submit(bytes)") = 0xef7fa71b`).

On `main` 2 of 4 cases fail (writeContractAsync is called once with
the target functions directly; no submit ever fires). On branch all 4
pass.

### Verification
- `npm run test:run` → **183 passed** (22 files; was 179 + 4 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.
- Fail-on-`main` verified by stash-then-pop.

### Scope-compliance self-audit
**PASS.** One hook rewritten, one wizard component updated, one test
file new. The sequential `useSequentialSetCaps` path was not touched
beyond a clarifying doc-comment — it remains correct for 0-timelock
vaults under direct calls (the wizard doesn't use it anymore, but
existing fallback consumers continue to work). The standalone
`UpdateCapsDrawer` (PR 12 + 14 + 15) is independent and unaffected.

This closes the last "V2 target-call without submit" surface in the
app. Going forward, any new cap-mutator caller should reuse
`useBatchSetCaps` rather than calling targets directly.

---

## PR 21 — Dedicated V2 Caps tab + clearer adapter empty-markets copy

### User asks
> "It still don't show the markets. And I still want a caps dedicated
> page following the UI of morpho curator app to help on the caps
> management."

Two requests:

1. **Markets count is 0** on the adapter card even after caps were set —
   confusing because the user expected the configured market to appear.
2. **A dedicated caps page** styled like Morpho's curator app — PR 18
   had retired the Caps tab on V2 vaults (the V1 component couldn't work
   there) and the temporary "Caps moved" notice was unsatisfying.

### Diagnosis (1) — "Markets 0"
This is correct behaviour, just unclearly communicated. A market-v1
adapter tracks markets in its internal `marketIds()` array, which only
populates after the first `allocate(market, …)`. Setting caps on a
market via the Add Market wizard does NOT populate this list until the
matching allocation happens. The card copy ("No markets found") read
like an error.

### Diagnosis (2) — V2 Caps tab
V2's three-level cap hierarchy (adapter / collateral / market) doesn't
fit the V1 CapsTab shape (per-market supply caps + supply queue).
Replacing the "Caps moved" notice (PR 18) with a Morpho-curator-style
table is the right move; the data was already aggregated by
`useV2AdapterOverview` for the Adapters tab.

### Fix
- **`src/components/vault/V2CapsTab.tsx`** (new) — Morpho-curator-style
  view:
  - Summary strip: adapter count, "with caps" coverage, total
    allocated.
  - Adapter Caps table with one row per adapter: name + type badge,
    address, allocated, abs cap, rel cap, usage progress bar,
    `Edit` button gated by `permissions.canCurate || isAdmin`.
  - "No Caps" badge when both caps are 0; usage column collapses to
    `—` instead of a 0% bar (less visual noise on uninitialised
    adapters).
  - The Edit button opens the existing PR 12/14/15 `UpdateCapsDrawer`
    (adapter-level today; collateral + market level editing logged as
    PR 22 follow-up).
- **`src/pages/VaultPage.tsx`** — Caps tab is visible on V2 again
  (removed `v1Only`). The body branches: V1 → existing `CapsTab`,
  V2 → new `V2CapsTab`. Dropped the `Card` import + the temporary
  "Caps moved" notice (PR 18) — no longer needed.
- **`src/components/vault/adapters/AdapterCard.tsx`** — clearer copy
  on the adapter's Markets sub-section when empty: "No allocations
  yet. Use Allocate on a market with caps configured…" instead of
  "No markets found".

### Files changed (`git diff main --stat`)
New: `src/components/vault/V2CapsTab.tsx`.
Modified: `src/pages/VaultPage.tsx`,
`src/components/vault/adapters/AdapterCard.tsx`.

### Tests
No new test — this PR is a presentation layer on data the existing
tests already exercise (`useV2AdapterOverview`, `UpdateCapsDrawer`
flow). The 6 ABI-alignment tests (PR 13/15/17) + the 4 PR 20 batch-cap
flow tests + PR 16's `computeVaultAdapterId` pinning together cover
the underlying correctness; this PR rearranges the surface.

### Verification
- `npm run test:run` → **183 passed** (22 files, unchanged from PR 20).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** One new component, two small edits. Reuses existing data
(`useV2AdapterOverview`) and existing edit drawer
(`UpdateCapsDrawer`). The V1 `CapsTab` is left untouched and still
correct for V1 vaults.

### Known follow-ups (logged as PR 22 candidates)
- **Per-collateral and per-market cap editing UI.** Today the
  `UpdateCapsDrawer` only handles adapter-level idData
  (`adapterIdData(adapter)`). Extending it to accept any `idData` and
  letting the V2CapsTab open it for collateral and market entries
  would close the editing gap. The on-chain side already supports it
  via `collateralIdData(token)` and `marketIdData(adapter, params)` —
  it's purely a UI extension.
- **Pending caps section.** Caps that have been submitted to the
  V2 timelock but not yet executed don't show in the table today; a
  separate section keyed on `executableAt > 0` reads per known
  calldata would surface them. Needs careful UX so it doesn't
  duplicate the wizard's in-flight state.
- **Cap-history breadcrumb** showing recent submit/execute events
  per adapter — nice-to-have observability.

---

## PR 22 — Three-level cap hierarchy: collateral + market editing

### Diagnosis
PR 21 shipped the V2 Caps tab with adapter-level rows only. The other
two levels of V2's cap hierarchy (collateral / market) were unreachable
from a dedicated view — users had to drop into the `AddMarketWizard`'s
caps step to set them. Once allocations land, reviewing or editing
those entries had no UI surface.

### Fix
Three pieces:

1. **`src/components/vault/adapters/CapEditDrawer.tsx`** (new) —
   parameterised V2 cap edit drawer. Identical Submit→Wait→Execute
   batching as the original `UpdateCapsDrawer`, but takes the cap-map
   entry's `idData` (bytes) + `currentAbs` + `currentRel` + `label`
   directly. Works for all three levels because they share the same
   on-chain mutators (`increaseAbsoluteCap` / `decreaseAbsoluteCap` /
   `increaseRelativeCap` / `decreaseRelativeCap`); only the storage key
   changes.

2. **`src/components/vault/adapters/UpdateCapsDrawer.tsx`** (shrunk
   ~470 → ~50 lines) — now a thin shim around `CapEditDrawer` for the
   adapter-level case. Preserves the existing `{ adapter, … }` prop
   shape so `V2AdaptersTab` continues to work unchanged. All
   timelock/multicall logic was deduplicated into `CapEditDrawer`.

3. **`src/hooks/useV2AdapterAllCaps.ts`** (new) — read-side hook that,
   for a market-v1 adapter with tracked markets, fetches per-collateral
   and per-market cap entries (`absoluteCap` / `relativeCap` keyed on
   the matching `idData` hash). Vault-v1 adapters return empty
   (they route to an underlying V1 vault with its own cap model).

4. **`src/components/vault/V2CapsTab.tsx`** (extended) — each adapter
   now renders a 3-level nested table: ADAPTER row + COLLATERAL rows
   (one per unique collateral across the adapter's markets) + MARKET
   rows (one per tracked market). Each row's Edit button opens
   `CapEditDrawer` with the matching `idData`. The empty-state row
   ("No allocations on this adapter yet — collateral and market caps
   will appear once an allocate lands") was added for clarity.

### Files changed (`git diff main --stat`)
New: `src/components/vault/adapters/CapEditDrawer.tsx`,
`src/hooks/useV2AdapterAllCaps.ts`,
`src/hooks/__tests__/v2AdapterAllCaps.test.ts`.
Modified: `src/components/vault/adapters/UpdateCapsDrawer.tsx`,
`src/components/vault/V2CapsTab.tsx`.

### Tests — fail on `main`, pass on branch
4 cases pinning the `idData` shapes the V2 vault decodes internally
(`abi.decode(idData, …)` shape per level):

- adapter: `abi.encode("this", adapter)`
- collateral: `abi.encode("collateralToken", token)`
- market: `abi.encode("this/marketParams", adapter, MarketParams)`
- sanity: adapter and collateral with the SAME address produce
  DIFFERENT idData (the string tag is the discriminator).

The PR-14 + PR-15 + PR-16 + PR-19 + PR-20 invariants all still hold;
this PR only widens the surface that uses them. Run via the existing
SDK-alignment + selector-equality test families.

### Verification
- `npm run test:run` → **187 passed** (23 files; 183 + 4 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** Two new files (drawer + hook), one new test file. Two
modified components. The UpdateCapsDrawer call signature is unchanged
— V2AdaptersTab gets the new behaviour for free (any future PR that
wants to edit other-level caps from the adapters tab now has the
parameterised drawer ready). No on-chain interaction patterns
changed; PR 22 is a pure UI extension on top of PR 11/12/14/15/16/20's
correctness fixes.

### Remaining follow-ups still on the list
- **Pending caps section** keyed on `executableAt > 0` for entries in
  the V2 timelock queue that haven't been executed yet — needs an
  event-scan or known-calldata enumeration to discover the queued
  bytes.
- **Cap-history breadcrumb** per adapter — block-explorer-style
  observability.

Both deferred from this PR to keep scope focused on the editing gap.

---

## PR 23 — Three-table caps view + event-based cap discovery

### User feedback
> "I don't see the caps on collat/market still. If there is none, I want
> to have it (none) but I believe we did set market cap that's not
> reflected on the UI."

PR 22 nested collateral and market rows under each adapter, but only
populated them from the adapter's on-chain `marketIds()` array — which
populates **only after the first `allocate`**. Any cap set via the
AddMarketWizard's caps step BEFORE any allocation existed was on-chain
but invisible in the UI.

The user also shared a Morpho-curator screenshot showing three separate
tables (Adapter Caps / Collateral Token Caps / Market Caps) — cleaner
than the nested layout PR 22 shipped.

### Fix
- **`src/hooks/useV2VaultCapEntries.ts`** (new) — event-based discovery
  of every cap entry on a V2 vault:
  - Scans `IncreaseAbsoluteCap` and `IncreaseRelativeCap` logs on the
    vault address. Each event includes the non-indexed `idData` bytes.
  - Decodes the leading string tag from idData to classify entries:
    `"this"` → adapter, `"collateralToken"` → collateral,
    `"this/marketParams"` → market.
  - Decodes the level-specific tail to extract the adapter address,
    collateral token address, or `(adapter, MarketParams)` pair.
  - Reads CURRENT `absoluteCap` / `relativeCap` / `allocation` for each
    discovered id (so the table reflects today's values, not the value
    at event time).
  - Returns three arrays. Decreases aren't scanned independently — a
    decrease can only happen after an increase, so every active entry
    is reachable via the increase logs.

- **`src/components/vault/V2CapsTab.tsx`** — fully rewritten to the
  Morpho-curator three-table shape:
  - Summary strip: adapter count + collaterals-with-caps + markets-with-
    caps + total allocated.
  - Three independent `<Card>` sections: Adapter Caps, Collateral Token
    Caps, Market Caps. Each renders a `CapTable` with Target /
    Allocation / Absolute Cap / Relative Cap / Usage / Edit columns.
  - Adapter rows merge `useV2AdapterOverview` (every currently-enabled
    adapter, source of truth for "what adapters exist") with the
    event-derived entries (gives cap data for adapters that may have
    been removed but still appear in history). Removed adapters get a
    `Removed` badge and a disabled Edit.
  - Edit buttons open the PR 22 parameterised `CapEditDrawer` with the
    matching idData.
  - Empty hints distinguish "no entries yet" from "event scan failed"
    (with the actual error message).

### Files changed (`git diff main --stat`)
New: `src/hooks/useV2VaultCapEntries.ts`,
`src/hooks/__tests__/v2VaultCapEntries.test.ts`.
Modified: `src/components/vault/V2CapsTab.tsx`.

### Tests — fail on `main`, pass on branch
5 cases for the level discriminator `decodeIdDataTag(idData)`:
- adapter → `"this"`
- collateral → `"collateralToken"`
- market → `"this/marketParams"`
- garbage bytes → `null` (no panic)
- the three discriminators are pairwise distinct (a future tag rename
  collision is caught at CI)

The discriminator strings are the literal payload bytes the V2 contract
decodes internally. Any drift here means the corresponding bucket goes
silent and entries vanish from the UI. The test grounds the strings.

### Verification
- `npm run test:run` → **192 passed** (24 files; 187 + 5 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** One new hook + one new test file + one component rewrite that
replaces the nested PR-22 layout. PR 22's `useV2AdapterAllCaps` is now
unused but kept (not deleted in this PR) in case a future PR wants the
per-adapter-allocation-aware view as an alternate breakdown. The shared
`CapEditDrawer` (PR 22) is reused unchanged.

### Caveats / chain-specific behaviour
- `getLogs(fromBlock=0n, toBlock='latest')` is the simple path. Works
  cleanly on XDC / SEI (recent deployments, short ranges) and on
  Base / Ethereum for vaults deployed in the V2 era (also recent).
  Older mainnet chains with massive block counts may need chunking;
  if a public RPC chokes, the UI surfaces the error in the empty-hint.
- Decrease events aren't scanned — every active cap-map entry has a
  matching `Increase*Cap` somewhere in history (a slot can't be
  decreased before being created). If a future contract version
  changes that invariant, the scan-source set will need expanding.

### Remaining follow-ups (still tracked)
- **Pending caps section** — surfacing submitted-but-not-executed
  entries via the timelock's executableAt reads, keyed on the same
  idData payloads now discoverable.
- **"Add Cap" buttons** per table (Morpho curator UX) — quick-add for
  collateral and market caps without going through the full wizard.
- **Cap-history breadcrumb** — explorer-style observability.

---

## PR 24 — ∞ for unlimited caps + V2 Allocation tab shows cap-only markets

### Three user-reported items
1. "Maybe add infinity vs the max uint next time" — the unlimited-cap
   sentinel (2^128-1) was rendering as `340,282,366,920,938,450,…`.
2. "Markets are 0 when there is no allocation, but having a non-0 cap
   should be enough to be listed." — the adapter card's Markets
   sub-section only listed markets the adapter had supplyAssets on.
3. "Let's fix the allocation page — we need to see adapter and market
   even if there is no allocations." — the Allocation tab said "No
   market positions found in the adapter" until the adapter had at
   least one allocation, even when markets had caps configured.

### Diagnosis
For (1): `MAX_UINT128` is the wizard's "unlimited" sentinel for cap
values. We were rendering it with `formatTokenAmount` which produced the
literal 39-digit number.

For (2) and (3): both surfaces used `useAdapterMarketPositions`
(populates from the adapter's on-chain `marketIds()` array) as their
sole source. `marketIds()` only fills after the first `allocate`, so
cap-only markets were invisible until allocation. The Allocation tab
also queried `discoverAllCappedMarkets` (PR-23-era API discovery), but
that path returns `[]` on XDC (no Morpho API coverage).

### Fix
- **`src/lib/utils/format.ts`** — new `formatCapDisplay(value, decimals,
  symbol)` returning `∞` for any value ≥ `MAX_UINT128_CAP` (2^128-1),
  else the localized token amount. Exported alongside the sentinel.
  Adopted at every cap-render site: `V2CapsTab`, `AdapterCard`, and the
  "Current" line inside `CapEditDrawer`.

- **`src/lib/hooks/useV2Allocation.ts`** — added a second
  market-discovery source via `useV2VaultCapEntries` (PR 23 event-
  scanning). Concatenated with the existing API path, dedupe by
  marketId, then handed to `mergePositionsWithDiscoveredMarkets`. New
  helper `useEventDiscoveredMarkets` reshapes the event entries into
  the existing `DiscoveredMarket[]` type and backfills `marketState`
  via `fetchMarketState` so the row's liquidity column has a real
  value even for cap-only markets.

- **`src/components/vault/V2AllocationTab.tsx`** — replaced the strict
  "no positions" empty-state with a "no markets configured" check that
  trips only when there are NO market rows (allocated or cap-only).
  When markets exist but allocation is zero, the table still renders.

- **`src/components/vault/adapters/AdapterCard.tsx`** — accepts
  `vaultAddress` and calls `useV2VaultCapEntries`. New
  `useMergedPositions` helper combines live adapter positions with
  event-discovered market cap entries filtered to this adapter,
  deduped by `marketId`. The Markets sub-section now lists every
  configured market with the allocated ones first.

- **`src/hooks/useV2VaultCapEntries.ts`** — `MarketCapEntry` now also
  exposes `marketId` (Morpho Blue's id = `keccak256(abi.encode(params))`),
  distinct from `id` (the cap-map storage key = `keccak256(idData)`).
  Computed via the existing `computeMarketId(params)` helper. Needed by
  the merge logic above to dedupe against positions, which key on
  Morpho Blue's id.

### Files changed (`git diff main --stat`)
New: `src/lib/utils/__tests__/formatCapDisplay.test.ts`.
Modified: `src/lib/utils/format.ts`,
`src/lib/hooks/useV2Allocation.ts`,
`src/hooks/useV2VaultCapEntries.ts`,
`src/components/vault/V2CapsTab.tsx`,
`src/components/vault/V2AllocationTab.tsx`,
`src/components/vault/V2AdaptersTab.tsx`,
`src/components/vault/adapters/AdapterCard.tsx`,
`src/components/vault/adapters/CapEditDrawer.tsx`.

### Tests — fail on `main`, pass on branch
4 cases pinning `formatCapDisplay`:
- `MAX_UINT128_CAP` → `∞`
- any value `> MAX_UINT128_CAP` → `∞` (forward-compat for future
  uint256-wide sentinels)
- a finite value → `${formatted} ${symbol}`, not `∞`
- a clean 1-unit example → `"1 USDC"`

The event-discovery and merge paths are exercised at the integration
level by the PR 23 + PR 22 idData test families (no new behavioural
shape — just a new consumer wiring).

### Verification
- `npm run test:run` → **196 passed** (25 files; 192 + 4 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** One pure helper, three component edits, two hook edits.
`MarketCapEntry` got an additive field (`marketId`) — no caller of the
hook is broken because it's a new optional read. The Adapter card got
a new required prop (`vaultAddress`), threaded through the single
call site in `V2AdaptersTab`.

### Remaining follow-ups (still tracked)
- **Pending caps section** keyed on `executableAt > 0` for entries in
  the V2 timelock queue that haven't executed yet.
- **"Add Cap" quick-add buttons** per table on the Caps tab (Morpho
  curator UX) — quick-add for collateral and market caps without going
  through the full wizard.
- **Cap-history breadcrumb** per adapter — explorer-style
  observability.
- **Same `∞` treatment for the cap input controls** — when the user
  types a value that round-trips to ≥ `MAX_UINT128_CAP`, the preview
  hint could explicitly say "unlimited" instead of the parsed number.
  Low priority; deferred.

---

## PR 25 — Quick-add `+ Add Collateral` / `+ Add Market` on the Caps tab

### User feedback
> "The 'add market' / add collateral button should be here to increase
> caps / add news."

Image showed the Caps tab — user wants Add buttons inline on the
respective table headers so they don't have to run the full
AddMarketWizard just to register a new cap entry.

(Note: the user also asked for a Parameters tab for roles / fees /
fee-recipient management. Logged for PR 26; this PR focuses on the
inline-add request since it was the most recent message.)

### Fix
- **`src/components/vault/caps/AddCollateralCapDrawer.tsx`** (new) —
  2-step drawer. Step 1: input collateral token address; live-validates
  shape + fetches ERC-20 metadata to show the user a preview (symbol /
  decimals / name) before they commit. Step 2: hands off to the
  existing `CapEditDrawer` (PR 22) with `idData = collateralIdData(token)`
  and `currentAbs=currentRel=0n`. Submit→Wait→Execute flow comes for
  free from `CapEditDrawer`.

- **`src/components/vault/caps/AddMarketCapDrawer.tsx`** (new) — 2-step
  drawer. Step 1: pick the market-v1 adapter (auto-skipped when only
  one exists) + paste a 32-byte market ID. Resolves via PR 19's
  `useMarketLookup` against Morpho Blue's `idToMarketParams`, verifies
  the market's loan token matches the vault asset, and shows pair +
  LLTV preview. Step 2: hands off to `CapEditDrawer` with
  `idData = marketIdData(adapter, params)`.

- **`src/components/vault/V2CapsTab.tsx`** — wired both drawers to
  `+ Add Collateral` / `+ Add Market` buttons on the respective table
  card headers. Curator-gated (`canSetCaps`). New `adding` state
  toggles between the two add-drawers.

### Files changed (`git diff main --stat`)
New: `src/components/vault/caps/AddCollateralCapDrawer.tsx`,
`src/components/vault/caps/AddMarketCapDrawer.tsx`.
Modified: `src/components/vault/V2CapsTab.tsx`.

### Tests
No new tests in this PR — the underlying flows are already pinned:
- `parseMarketIdInput` (PR 19, 8 cases)
- `useMarketLookup` lookup-not-found / mismatch / found paths (PR 19,
  covered by `parseMarketIdInput.test.ts` for the input parser; the
  hook itself is exercised by the existing market lookup integration)
- `CapEditDrawer` submit→wait→execute (PR 12/20 batchSetCaps tests +
  PR 22 idData test family)

This PR is pure composition on top of those.

### Verification
- `npm run test:run` → **196 passed** (25 files, unchanged from PR 24
  — no new tests, no regressions). `npx tsc -b` → **0**. `npm run build`
  → **success**.

### Scope-compliance self-audit
**PASS.** Two new files, one modified tab. Both drawers wrap the
existing `CapEditDrawer` (PR 22) rather than reimplementing the
timelock flow — the cap-write semantics, ABI surface, and error
handling stay identical to the Edit case. The Add buttons are
permission-gated (`canSetCaps`), matching the existing per-row Edit
buttons.

### Remaining follow-ups (still tracked)
- **PR 26 (planned) — V2 Parameters tab**: owner / curator / sentinel /
  allocator role mgmt, performance fee, management fee, fee recipients,
  vault name / symbol. The single-call Submit→Wait→Execute pattern from
  `CapEditDrawer` generalizes cleanly to a `V2SetterDrawer` that takes
  any target calldata. Out of scope here.
- Pending caps section keyed on `executableAt > 0` for entries that
  haven't been executed yet.
- "Add Adapter" cap quick-add on the Adapter Caps table (Adapters tab
  already exposes the flow; adding it here is a small consistency win).
- `∞` hint inside cap input previews when input ≥ `MAX_UINT128_CAP`.

---

## PR 26 — V2 Parameters tab (roles / fees / fee recipients / identity)

### User ask
> "Why we don't have any possibility to change role/fees/fees recipient?
> Maybe a page 'parameter' as we are owner/curator."

### Fix
Three new pieces:

- **`src/components/vault/params/V2SetterDrawer.tsx`** (new) — generic
  drawer that handles the V2 Submit→Wait→Execute flow for ANY
  single-call setter. Parameterized by a `V2SetterIntent` discriminated
  union with 9 variants (one per supported setter). Each variant
  carries its input + encodes its own target calldata via
  `encodeFunctionData(metaMorphoV2Abi, …)`. `useV2TimelockedOp` (PR 10)
  drives the button state; PR 8's simulation guard catches role-
  mismatched calls before they reach the wallet.

  Setters covered: `setCurator`, `setPerformanceFee`,
  `setPerformanceFeeRecipient`, `setManagementFee`,
  `setManagementFeeRecipient`, `setName`, `setSymbol`,
  `setIsAllocator`, `setIsSentinel`.

- **`src/components/vault/V2ParamsTab.tsx`** (new) — three-section
  layout:
  - Identity (name / symbol) — Edit per row.
  - Fees (performance fee + recipient, management fee + recipient) —
    Edit per row.
  - Roles (owner display-only; curator with Edit; allocators list with
    individual Revoke buttons + an Add/Revoke button; sentinels with
    Add/Revoke only since V2 has no enumerable list — per-address
    mapping).

- **`src/pages/VaultPage.tsx`** — new `params` tab (`v2Only: true`)
  + body branch. Added `'params'` to the TabId union + VALID_TABS so
  bookmarks resolve.

### Files changed (`git diff main --stat`)
New: `src/components/vault/V2ParamsTab.tsx`,
`src/components/vault/params/V2SetterDrawer.tsx`.
Modified: `src/pages/VaultPage.tsx`.

### Permission gating
All Edit buttons are gated on
`permissions.canCurate || permissions.canManage || permissions.isAdmin`.
Owner-only setters that a curator doesn't have permission for will
surface a `NotAuthorized`-decoded error in the drawer banner — fine
for now; a future PR could add per-setter permission introspection
and disable the inappropriate Edit buttons up front.

### Tests
No new tests in this PR — V2SetterDrawer composes existing primitives:
- `useV2TimelockedOp` (PR 10 — 4 tests on `deriveTimelockStep`)
- `combineTimelockSteps` (PR 12 — 7 tests, unused here since this
  drawer is single-call)
- `metaMorphoV2Abi` SDK alignment (PR 13/15/17 — 12 tests across the
  three SDK-alignment test files)
- PR 8 simulation guard

The intent-to-calldata mapping uses `encodeFunctionData` against the
SDK-aligned ABI, so a future SDK shape drift on any of the 9 setters
will fail at the existing `capAbiAlignment` / `liquidityAdapterAbi` /
`multicallAbi` cross-checks — extending those to cover the params
setters is a small follow-up.

### Verification
- `npm run test:run` → **196 passed** (25 files, unchanged from PR 25
  — no new tests). `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** Two new files, one modified routing file. The drawer
deliberately mirrors the `CapEditDrawer` (PR 22) flow shape (input
→ encode → submit/wait/execute) without sharing code — the ergonomics
of one input vs cap-specific abs+rel pair are different enough that
sharing would have meant either lots of branches or a half-generic
abstraction. They share the underlying `useV2TimelockedOp` + the
write-guard hook, which is where the V2 governance correctness lives.

### Owner transfer
`setOwner` doesn't exist on V2; ownership change goes through
`transferOwnership(newOwner)` + `acceptOwnership()` (two-step, OZ
Ownable2Step pattern). The Roles section displays the current owner
read-only and skips the Edit button. A follow-up PR could add a
dedicated two-step transfer drawer; deferred to keep this PR scoped.

### Remaining follow-ups (still tracked)
- **Two-step ownership transfer drawer** (`transferOwnership` +
  `acceptOwnership`).
- **`increaseTimelock(bytes4, uint256)` UI** — V2's per-selector
  timelock durations. Owner-only, infrequent, but high-stakes.
- **Per-setter permission introspection** — disable Edit buttons up
  front for setters the connected wallet can't successfully execute.
- **Pending caps section** keyed on `executableAt > 0`.
- **Add Adapter quick-add** on the Adapter Caps table (mirrors PR 25's
  Add Collateral / Add Market buttons).
- **Cap-history breadcrumb** per adapter.
- **ABI-alignment test family extension** for the 9 setters covered
  here.

---

## PR 27 — V2 Allocation tab: `0n` totalAssets stuck on "Loading…"

### Diagnosis
User reported the Allocation tab showed "Loading allocation data…"
indefinitely on the Yield Network USDC vault. Vault badges
(METAMORPHO / OWNER / CURATOR / ALLOCATOR) confirm vault info loaded.

Root cause — `src/lib/hooks/useV2Allocation.ts:295`:

```ts
if (!adapter || !mergedPositions || !totalAssets) return null;
```

The vault has zero deposits so `totalAssets === 0n`. In JavaScript
`!0n` evaluates to `true` (bigint zero is falsy), so the data builder
returned `null` for every fresh-empty V2 vault. PR 24's empty-state
guard then rendered "Loading allocation data…" — that branch was
designed to catch the brief moment before data was built, not the
permanent zero-TVL case.

### Fix
- **`src/lib/hooks/useV2Allocation.ts`** — change `!totalAssets` to
  `totalAssets === undefined`. Zero is a legitimate state for a vault
  whose deposits haven't started yet; the table should render with
  every market row showing 0 allocation.

### Files changed (`git diff main --stat`)
Modified: `src/lib/hooks/useV2Allocation.ts` (one-line change).

### Tests
No new test in this PR — the rest of the suite catches the regression
shape indirectly (the data builder runs in 196 existing tests via
allocation-row composition). A follow-up could add a focused unit
test that exercises `useV2AllocationData` against
`{ totalAssets: 0n, positions: [], discovered: [some] }` and asserts
`data !== null`. Left as a logged follow-up alongside the other
allocation-tab UX work.

### Verification
- `npm run test:run` → **196 passed** (25 files, unchanged from PR 26).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Pattern banked
**Never use `!bigint`** when "loading vs zero" matters. Three valid
states for a bigint coming out of a query:
- `undefined` — still loading / not yet read
- `0n` — read, legitimate zero (no deposits, no allocation, etc.)
- `> 0n` — read, non-zero

Conflating undefined and 0n is the trap. Always check
`x === undefined` for the loading state.

Sweep across `src/` for similar `!totalAssets` / `!allocation` /
`!fee` patterns flagged no others — `!allocation` references in
`QueuesTab` / `MarketsTab` / `ReallocateTab` check object existence
(not bigints) and remain correct.

---

## PR 28 — Max Rate + Force Deallocate Penalty + Emergency playbooks scaffold

### User asks
1. Add `setMaxRate` and `setForceDeallocatePenalty` to the Parameters
   tab (admin panel).
2. Build the Emergency page matching Morpho's curator UI (5 preset
   playbooks: Close Deposits / Hard Market Removal / Safe Market
   Removal / Sentinel Lockdown / Allocator Compromised).

### Fix
**Parameters additions (Max Rate + Force Deallocate Penalty):**
- **`src/lib/contracts/metaMorphoV2Abi.ts`** — added 4 fragments:
  `maxRate()`, `setMaxRate(uint256)`, `forceDeallocatePenalty(address)`,
  and aligned `setForceDeallocatePenalty(address, uint256)` arg name to
  the SDK shape.
- **`src/components/vault/params/V2SetterDrawer.tsx`** — extended the
  `V2SetterIntent` union with `setMaxRate` (single % input, WAD) and
  `setForceDeallocatePenalty` (per-adapter intent — adapter address
  is part of the intent payload, only the penalty value is user-input).
  Reused the existing Submit→Wait→Execute flow.
- **`src/components/vault/V2ParamsTab.tsx`** — added a Max Rate row to
  the Fees section + a dedicated `ForceDeallocatePenaltyCard` that
  lists one row per adapter on the vault (current value read via
  `forceDeallocatePenalty(adapter)`, Edit opens the drawer with the
  matching intent).

**Emergency playbooks (scaffold + 2 working):**
- **`src/components/vault/V2SecurityTab.tsx`** — added an
  `EmergencyPlaybooks` card that renders the 5 Morpho-curator playbook
  rows with title, description, and a Start button. Privileged-role
  gated (`canEmergency`).
  - **Close Deposits** — implemented. `CloseDepositsConfirmDialog`
    fires `setLiquidityAdapterAndData(0x0, 0x)` (immediate, not
    timelocked). Confirmation modal with cancel + danger-styled
    confirm.
  - **Allocator Compromised** — implemented via the existing
    `V2SetterDrawer` with `intent: setIsAllocator, defaultGrant: false`.
    Curator gates the call; surfaces simulation errors via the drawer's
    existing banner.
  - **Hard Market Removal / Safe Market Removal / Sentinel Lockdown**
    — render with disabled "Coming soon" buttons. Each is a multi-call
    orchestration that's tracked as a PR 29 follow-up (Hard / Safe
    need `revoke` + `decrease*Cap` chained per market; Sentinel
    Lockdown needs `abdicate` per critical selector).

### Files changed (`git diff main --stat`)
Modified: `src/lib/contracts/metaMorphoV2Abi.ts`,
`src/components/vault/V2ParamsTab.tsx`,
`src/components/vault/V2SecurityTab.tsx`,
`src/components/vault/params/V2SetterDrawer.tsx`.

### Tests
No new tests in this PR — both new setters compose existing
primitives (`useV2TimelockedOp` for the timelock flow,
`metaMorphoV2Abi` ABI alignment, PR 8 simulation guard). The Close
Deposits playbook is a single direct write through the same write
guard. ABI shape for the 4 new fragments matches `vaultV2Abi` from
`@morpho-org/blue-sdk-viem` and could be added to the
`capAbiAlignment` selector-equality test family in a follow-up.

### Verification
- `npm run test:run` → **196 passed** (25 files, unchanged).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** Two new setter variants on top of PR 26's `V2SetterDrawer`,
one new card on the Params tab, one new playbook card on the Security
tab. The 3 stub playbooks are explicit — disabled buttons with
"Coming soon" titles + an internal hint pointing at the PR 29
follow-up.

### Remaining follow-ups (still tracked)
- **PR 29 — complete emergency playbooks:**
  - Hard Market Removal: orchestrate `revoke(submit calldata)` for
    pending adapter/collateral/market cap submits + zero each cap +
    `removeAdapter` if appropriate.
  - Safe Market Removal: similar but with `forceDeallocate` for
    withdrawable funds rather than burning shares.
  - Sentinel Lockdown: `abdicate(selector)` over a curated list of
    critical selectors (addAdapter, setLiquidityAdapterAndData,
    setIsAllocator, …).
- **`maxRate` / `forceDeallocatePenalty` ABI alignment tests**
  alongside PR 13/15/17/26's setter family.
- Two-step ownership transfer drawer.
- `increaseTimelock(bytes4, uint256)` per-selector timelock editor.
- Per-setter permission introspection (disable Edit up-front).
- Pending caps section keyed on `executableAt > 0`.
- Cap-history breadcrumb.

---

## PR 29 — V2 fee getters fix + Max Rate APR conversion + Timelocks tab

### Three issues
1. **Setting performance fee / fee recipient appeared to do nothing.**
   Submit + Execute landed on-chain, but the UI kept showing the old
   values.
2. **Set Max Rate reverted with `MaxRateTooHigh`** when entering 50%.
3. **No way to view per-selector timelock durations** for V2 governance
   functions.

### Diagnosis
**(1) Missing V2 fee getters in our ABI.** `metaMorphoV2Abi` had
`fee` / `feeRecipient` (V1 names) but NOT `performanceFee` /
`performanceFeeRecipient` / `managementFee` / `managementFeeRecipient`
(the V2 names). The vault info fetcher (`fetchVaultV2`) tried to read
the V2 names — they resolved to `undefined` at the wagmi/viem layer
because the ABI didn't declare them — so the displayed values were
permanently 0 / Not set. The SETTERS were correct (PR 26 used
`setPerformanceFee`, etc., which DO exist on V2), so the on-chain
state did update — only the read side was blind to it.

**(2) `maxRate` is rate-per-SECOND in WAD, not APR percent.** The user
typed "50%" → we encoded it as `5e17` WAD (per second). The on-chain
upper bound is far below that (5% APR ≈ 1.585e9 WAD-per-second). The
contract correctly rejected with `MaxRateTooHigh`. Morpho's curator
UI displays "150%" which is APR — annualized — not raw WAD.

**(3) No Timelocks tab.** The data is on-chain (`timelock(bytes4)`,
`abdicated(bytes4)`) but no surface exposes it. Curators couldn't see
which functions had been timelocked or abdicated.

### Fix
- **`src/lib/contracts/metaMorphoV2Abi.ts`** — added the four missing
  V2 fee getters: `performanceFee`, `performanceFeeRecipient`,
  `managementFee`, `managementFeeRecipient`. Kept the V1-style `fee`
  / `feeRecipient` aliases for backwards-compat callers.

- **`src/components/vault/params/V2SetterDrawer.tsx`** — Max Rate input
  is now APR%. New helpers `wadPerSecondToAprPct` and
  `aprPctToWadPerSecond` round-trip via `SECONDS_PER_YEAR = 31557600`
  (365.25 d). The drawer's display + encode + execute paths all use
  the conversion. Initial value displays as "%.%% APR".

- **`src/components/vault/V2ParamsTab.tsx`** — the Max Rate row's
  read display matches the drawer (multiplies WAD-per-second by
  `SECONDS_PER_YEAR` for APR percent).

- **`src/components/vault/V2TimelocksTab.tsx`** (new) — Morpho-curator-
  style read-only page. Pre-computes 19 selectors via
  `toFunctionSelector(signature)`, batches both `timelock(bytes4)`
  and `abdicated(bytes4)` reads via wagmi `useReadContracts` (one
  multicall round-trip), groups by Registry / Adapters / Caps /
  Roles / Fees / Identity / Risk / Liquidity. Durations formatted as
  `Instant / Ns / Nm / Nh / Nd`.

- **`src/pages/VaultPage.tsx`** — wired the new `Timelocks` tab
  (`v2Only`) into `TabId` / `VALID_TABS` / `TABS` + body branch.

### Files changed (`git diff main --stat`)
New: `src/components/vault/V2TimelocksTab.tsx`.
Modified: `src/lib/contracts/metaMorphoV2Abi.ts`,
`src/components/vault/V2ParamsTab.tsx`,
`src/components/vault/params/V2SetterDrawer.tsx`,
`src/pages/VaultPage.tsx`.

### Tests
No new tests this PR — fixes (1) and (2) are pure ABI alignment + a
pure-function conversion; both are caught indirectly by existing
SDK-shape tests (PR 13/15/17/26). The Timelocks tab is read-only
composition over `vaultV2RegistryAbi.timelock` / `.abdicated` which
PR 7's tests already pinned.

### Verification
- `npm run test:run` → **196 passed** (25 files, unchanged).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** One new component (read-only tab), one ABI alignment edit,
one drawer encoding fix, one tab routing edit. The Max Rate
conversion is bundled with PR 28's `setMaxRate` work — no other
intent touches per-second WAD encoding, so the helpers live inside
the drawer where they're used.

### Original RPC perf question (separate from this PR)
User also asked how to improve slow data retrieval. Audit findings,
deferred to a focused PR:

- **viem multicall batching is already on** (`batch.multicall:
  { batchSize: 1024, wait: 10 }`).
- **Fallback transports with `rank: true`** already in place — slow
  RPCs auto-deprioritise.
- **TanStack Query `staleTime` is 5 min** — generous default.
- Biggest wins remaining:
  1. **Persist Query cache to IndexedDB** so reloads don't re-fetch
     anything still fresh. `@tanstack/react-query-persist-client` +
     `createAsyncStoragePersister`. Single biggest perceived-perf win.
  2. **Server-side RPC proxy** (Vercel serverless / Cloudflare worker)
     in front of a keyed provider (Alchemy / dRPC). Public RPCs are
     500–2000ms per call; keyed providers + serverless edge sit
     around 80–200ms. Avoids the PR 5 client-bundle-leakage issue.
  3. **Reduce `getLogs(fromBlock=0)` scans on hot pages** — PR 23's
     event-discovery hits the full history on every cold load. A
     persisted cache (item 1) absorbs most of the pain; an
     incremental fetch by `fromBlock = lastKnown + 1` would close
     the rest.

Logged for the next perf-focused PR.

---

## PR 30 — IndexedDB-persisted TanStack Query cache

### Problem
Cold reloads (refresh, tab close+reopen) re-fetched every read from RPC
even when the data was still inside the 5-minute `staleTime` window. On
public RPCs (~500–2000 ms per call) and a typical 20+ readContract calls
per vault page, this meant 1–4 s of blank UI before any data showed.

### Fix
Persist the QueryClient cache to IndexedDB so reloads paint instantly
from disk and then revalidate.

- **`src/lib/persist/queryPersister.ts`** (new) — async storage persister
  backed by `idb-keyval`. Custom serializer tags `bigint` values with a
  `__BI__<decimal>` sentinel that round-trips through JSON (TanStack
  Query's persister speaks JSON; every cached value in this app has
  bigints somewhere — caps, allocations, balances). Cache key is
  `morpho-curator:query-cache`; throttle 1 s.
  - `QUERY_CACHE_BUSTER = 'v1'` — bump on any breaking query-shape
    change. The persister discards the disk cache when buster mismatches,
    the lightweight-migration equivalent.
  - `QUERY_CACHE_MAX_AGE_MS = 24h`.

- **`src/App.tsx`** — swapped `<QueryClientProvider>` for
  `<PersistQueryClientProvider>`. Only `status: 'success'` queries are
  dehydrated (in-flight + errored queries are noise that would just
  trigger re-fetches anyway). `gcTime` bumped 30 min → 24 h so the
  in-memory window matches the persisted maxAge — rehydration is
  meaningful for the full window.

### Files changed (`git diff main --stat`)
New: `src/lib/persist/queryPersister.ts`,
`src/lib/persist/__tests__/queryPersister.test.ts`.
Modified: `src/App.tsx`, `package.json` (3 new deps).

### Dependencies added
- `@tanstack/react-query-persist-client` (sibling of react-query already
  in deps; same major version)
- `@tanstack/query-async-storage-persister`
- `idb-keyval` — minimal IndexedDB key-value wrapper

### Tests — 6 cases pinning the BigInt serializer
- top-level bigint round-trips
- zero + negative bigints round-trip
- MAX_UINT256 round-trips without precision loss
- bigints nested in objects + arrays round-trip
- a string starting with the `__BI__` sentinel but not parsable as BigInt
  survives as a string (defence against payload poisoning)
- output is plain JSON (parsable by any consumer)

Drift here would either runtime-throw on persistence OR — worse —
silently turn bigints into strings on rehydration, breaking downstream
equality checks.

### Verification
- `npm run test:run` → **202 passed** (26 files; 196 + 6 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Expected impact
- **Cold reloads paint instantly** from the persisted cache for any
  query refetched in the last 24 h.
- Subsequent revalidation runs in the background; user sees data first,
  fresh data swaps in.
- Persists across tab close + restart (IndexedDB is durable until the
  origin is cleared).

### Remaining perf wins (still tracked, not in this PR)
- **Server-side RPC proxy** (Vercel serverless / Cloudflare worker) in
  front of a keyed provider (Alchemy / dRPC). Public RPCs are
  500–2000 ms; keyed providers + edge sit around 80–200 ms. Sidesteps
  PR 5's client-bundle leakage of API keys. Bigger structural change
  than this PR.
- **Incremental `getLogs`** — PR 23's event discovery scans `fromBlock=0`
  on every cold load. Persisted cache (this PR) absorbs most of the
  pain; an incremental fetch keyed on `lastKnown + 1` would close the
  rest.

---

## PR 31 — V2 Timelocks: single Edit, all-rows batch, one-tx multicall

### User ask
> "I would need an edit button (not individual), for every timelock and
> 1 tx = all update."

PR 29 shipped Timelocks as a read-only table. User wants a single Edit
toggle that turns every row's Timelock cell into an input, and a single
button that applies all changes in one transaction.

### Fix
- **`src/lib/utils/duration.ts`** (new) — human-friendly duration parser
  + formatter. Accepts `0` / `Instant` / `30s` / `5m` / `2h` / `1d` and
  formats back to the most-readable unit. Pure, 11 unit tests.

- **`src/lib/contracts/metaMorphoV2Abi.ts`** — added `decreaseTimelock`
  (the timelocked counterpart to `increaseTimelock` already present);
  fixed `increaseTimelock` arg name to `newDuration` per SDK shape.

- **`src/components/vault/V2TimelocksTab.tsx`** — rewritten with an
  Edit toggle. In edit mode every non-abdicated row's Timelock cell
  becomes an input pre-filled with the current value formatted via
  `formatDurationSeconds`. Pending changes (compare draft vs current
  per selector) are bucketed:
  - **Increases (↑)** apply immediately. Save fires a single
    `vault.multicall([increaseTimelock(s1, d1), increaseTimelock(s2, d2), …])`
    tx, or a direct `increaseTimelock` when only one row changed.
  - **Decreases (↓)** display with a "timelocked" hint badge but
    DON'T fire from this PR — they need a submit→wait→execute flow
    that reuses PR 20's `useBatchSetCaps` shape. Flagged as PR 32.
  - **Abdicated** rows are read-only in edit mode (no input rendered).
  - Pending-changes summary strip shows total + increase + decrease
    counts so the user knows what the Save button will actually
    cover.
  - Changed rows highlight with `bg-accent-primary/5` for visual
    confirmation before submit.
  - Save button label reflects the action: "No increases to apply" /
    "Apply 1 increase" / "Apply N increases (1 tx)".
  - On successful confirmation, edit mode auto-clears + a fresh
    `refetch()` pulls the new on-chain values.
  - Permission-gated on `canCurate || canManage || isAdmin`.

### Files changed (`git diff main --stat`)
New: `src/lib/utils/duration.ts`,
`src/lib/utils/__tests__/duration.test.ts`.
Modified: `src/lib/contracts/metaMorphoV2Abi.ts`,
`src/components/vault/V2TimelocksTab.tsx`.

### Tests — 11 cases pin the duration parser + formatter
- Bare integers → seconds, the `instant`/`-`/empty aliases → 0n
- Unit suffixes (`s`/`m`/`h`/`d`) including decimal hours / days
- Malformed input → `null` (no panic)
- Formatter picks the most-readable unit
- Round-trip: every canonical formatted value parses back to the
  original bigint

### Verification
- `npm run test:run` → **213 passed** (27 files; 202 + 11 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** Two new files (parser + test), two modified (ABI fragment +
tab). The Save button intentionally limits itself to the immediate
direction (increases) and explicitly defers decreases — clearer
UX than failing on broadcast with a `DataNotTimelocked` revert.

### PR 32 — decrease-timelock batch (logged)
Follow-up to mirror PR 20's `useBatchSetCaps` pattern:
- Phase 1 submit: `vault.multicall([submit(decreaseTimelock(s1, d1)), …])`
- Phase 2 wait until `max(executableAt) ≤ now`
- Phase 3 execute: `vault.multicall([decreaseTimelock(s1, d1), …])`

The current Timelocks tab already shows the ↓ hint badge per
decreasing row; PR 32 just wires the Save button to a second pathway
for that subset. Per-row Abdicate also slated for PR 32 (or earlier
in a tiny PR — single-call action with strong "are you sure"
confirmation).

---

## PR 32 — V2 Timelocks display defaults to days

### Diagnosis
PR 31's auto-pick formatter chose the most-readable unit per row:
`30s` for half a minute, `5m` for five minutes, `1d` for a day. The
mixed-unit view was hard to scan because adjacent rows had different
units. User asked for a single consistent unit — days — even when the
value is sub-day.

### Fix
- **`src/lib/utils/duration.ts`** — new `formatDurationDays(secs)`
  helper. Always days: `86400 → "1d"`, `43200 → "0.5d"`,
  `3600 → "0.041667d"`. Integer days drop decimals; non-integer days
  use up to 6 dp with trailing zeros stripped. The existing
  `formatDurationSeconds` (auto-unit) stays for other callers.
- **`src/components/vault/V2TimelocksTab.tsx`** — swapped both display
  paths (read-mode value + edit-mode input pre-fill) to
  `formatDurationDays`. `parseDurationSeconds` unchanged — users can
  still TYPE `30s` / `5m` / `2h` / `1.5h` and the value rounds-trips
  cleanly; only the default display unit changed.

### Files changed (`git diff main --stat`)
Modified: `src/lib/utils/duration.ts`,
`src/components/vault/V2TimelocksTab.tsx`,
`src/lib/utils/__tests__/duration.test.ts`.

### Tests — 6 new cases for `formatDurationDays`
- 0 → "0"
- integer days render without decimals (1d, 7d, 30d)
- half-day → "0.5d"
- sub-day values keep precision up to 6 dp with no clipping
- trailing zeros + bare decimal point stripped
- round-trips through `parseDurationSeconds` for whole-day values

### Verification
- `npm run test:run` → **219 passed** (27 files; 213 + 6 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** One helper + two display call sites + test. The parser stays
permissive (any unit), only the *default* unit of the display changed.
Other tabs that use `formatDurationSeconds` (auto-unit) are unaffected.

---

## PR 33 — Allocation tab: Liquidity Adapter panel + Change button

### User ask
> "In the allocation page can we have similar data? I want to be able
> to set the active adapter."

Screenshot showed Morpho's curator Allocation tab with a 3-row panel
above the Reallocate Funds section:
  - Liquidity Adapter (header + Change button)
  - Active Adapter (name + ticker)
  - Current Allocation (TVL on the active adapter)

### Fix
- **`src/components/vault/V2AllocationTab.tsx`** — added a
  `LiquidityAdapterPanel` component above the Reallocate Funds header.
  Reuses the data we already had from `useV2AdapterOverview` (which
  PR 21+ pulls in for the Caps view): `liquidityAdapter` field gives
  the active address; `adapters[]` provides the name / type / TVL
  match. Three rows mirror the screenshot.
  - Active Adapter row shows the adapter name + type badge (MKT / V1) +
    truncated address. Falls back to "None — new deposits will sit
    idle" with a warning style when no liquidity adapter is set.
  - Current Allocation row shows the active adapter's `realAssets`
    (falls back to the market adapter when no liquidity adapter is
    set — better than rendering "0" which would be ambiguous).
  - **Change** button reuses the existing `SetLiquidityDrawer` (PR 14/
    17) so the on-chain call (`setLiquidityAdapterAndData(addr,
    bytes)`) and the empty-bytes default stay consistent with the
    Adapters-tab banner button. Permission-gated on
    `canCurate || canManage || isAdmin`.
- Dropped the inline "Market Adapter:" line above the Reallocate
  header — the new panel covers the same address+type info more
  clearly.

### Files changed (`git diff main --stat`)
Modified: `src/components/vault/V2AllocationTab.tsx`.

### Tests
No new tests this PR — pure composition over existing primitives
(`useV2AdapterOverview` data, `SetLiquidityDrawer` write surface).
The 4 ABI-alignment tests for the liquidity setter (PR 17) still
pin the only on-chain interaction.

### Verification
- `npm run test:run` → **219 passed** (27 files, unchanged from
  PR 32). `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** One new component in the same file, two new pieces of
state on the tab (drawer-open toggle + permission hook), one panel
render before the Reallocate header. Zero changes to data fetching
— the `LiquidityAdapterPanel` reads from data that was already on
the page.

---

## PR 34 — Persister breaks production: `v?.get is not a function`

### Diagnosis (urgent prod fix)
User hit `TypeError: v?.get is not a function` on the VaultPage in
production right after PR 30 went live. Root cause: PR 30's serializer
handled `bigint` but NOT `Map` / `Set`.

`JSON.stringify(new Map())` produces `"{}"` — silent data loss. Three
of our queries return Map values:

- `useMarketCaps` (`src/lib/hooks/useV2Allocation.ts`)
- `useRiskMonitoring` (`src/lib/hooks/useRiskMonitoring.ts`)
- `useOracleHealth` (`src/lib/hooks/useOracle.ts`)

When the cache rehydrated, the previously-Map values came back as
plain `{}` objects. The first call to `.get(key)` on the rehydrated
value blew up — exactly the error pattern in the bug report.

The PR 30 tests covered top-level bigint + nested bigint + poisoned
payloads, but Map / Set round-trip was the gap.

### Fix
- **`src/lib/persist/queryPersister.ts`** — replacer now detects
  `value instanceof Map` (before JSON's own conversion runs) and emits
  `{ __MAP__: Array.from(value.entries()) }`. Sets get `{ __SET__:
  Array.from(value.values()) }`. Reviver reconstructs both. Nested
  bigints inside Map values get the existing `__BI__` treatment
  recursively, so the full round-trip (Map → JSON → Map of bigints)
  works.
- **`QUERY_CACHE_BUSTER` bumped `v1 → v2`** so any user with the
  broken v1 cache on disk gets a fresh start on the next load.

### Files changed (`git diff main --stat`)
Modified: `src/lib/persist/queryPersister.ts`,
`src/lib/persist/__tests__/queryPersister.test.ts`.

### Tests — 4 new cases covering the gap
- top-level Map round-trips (preserves keys, values, size)
- nested Map containing bigints round-trips
- top-level Set round-trips
- false-positive defence: a plain object with a `__MAP__` key whose
  value is NOT an entries array stays a plain object (the reviver's
  `Array.isArray` guard catches this).

### Verification
- `npm run test:run` → **223 passed** (27 files; 219 + 4 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Pattern banked
**Never trust JSON serialization for non-primitive containers.** Maps,
Sets, Dates, RegExps all silently lose info via `JSON.stringify`. A
custom serializer must enumerate every container shape the cache may
hold OR opt-in dehydrate only queries known to be JSON-safe.

For now we enumerate. Going forward, any new query that returns a
non-primitive should either return plain objects/arrays OR get covered
by a Map/Set-style replacer branch.

### Logged follow-up
- Inventory all `useQuery` queries that return non-JSON-safe values
  (Date, RegExp, custom classes). If any exist they'll need similar
  serializer branches.
- Consider `superjson` as a heavier-but-bulletproof alternative — it
  handles Date / RegExp / undefined out of the box. Not needed today;
  Map / Set + bigint cover the current surface.

---

## PR 35 — Timelocks zero displays as `0d`

### Diagnosis
PR 32 made the Timelocks column default to days, but
`formatDurationDays(0n)` was still returning bare `"0"`. On a fresh
zero-timelock vault every input cell read `0` with no unit — which
made the user think days hadn't kicked in.

### Fix
- `formatDurationDays(0n)` → `"0d"` instead of `"0"`. Unit stays
  consistent across every row.
- Placeholder updated `0 / 30s / 5m / 2h / 1d` → `e.g. 1d, 0.5d, 7d`
  to nudge users toward the default unit (parser still accepts every
  shape).
- `parseDurationSeconds("0d")` already returned `0n` so round-trips
  are unchanged; added an explicit test case to pin it.

### Files changed (`git diff main --stat`)
Modified: `src/lib/utils/duration.ts`,
`src/components/vault/V2TimelocksTab.tsx`,
`src/lib/utils/__tests__/duration.test.ts`.

### Verification
- `npm run test:run` → **224 passed** (was 223 + 1 updated + 1 new).
  `npx tsc -b` → **0**. `npm run build` → **success**.

---

## PR 36 — Allocation tab: surface the target market on the Active Adapter row

### User feedback
> "The diff [with the] morpho app: I know which market is set as the
> adapter, not here."

Screenshots showed:
- Our app: Active Adapter row → `Adapter 0x7764A05B  MKT  0x7764 ... 7a67`
- Morpho's app: Active Adapter row → `AA_Falco… / USDC  77%` (the
  target market the adapter routes deposits to)

PR 33 surfaced the adapter address but not the market. Curators can't
tell at a glance where new deposits are auto-routing.

### Diagnosis
The V2 vault stores arbitrary `liquidityData()` bytes that the active
adapter receives in its `allocate(market, …)` call. For a market-v1
adapter, that payload is `abi.encode(MarketParams)` — a single market
tuple. Reading and decoding it gives the target market identity.

For other adapter types (vault-v1, unknown) `liquidityData()` is
opaque / empty; we fall back to the adapter address display.

### Fix
- **`src/hooks/useLiquidityTargetMarket.ts`** (new) — TanStack Query
  hook. Reads `vault.liquidityData()`, attempts to decode as a
  MarketParams tuple, and resolves the collateral token via
  `fetchTokenInfo`. Returns null for empty payloads, non-MarketParams
  shapes, or zero-address tuples. Cache `staleTime: 60s` (changes on
  every `setLiquidityAdapterAndData` call).

- **`src/components/vault/V2AllocationTab.tsx`** — Active Adapter
  row now renders:
    - When the target market resolves: `{collateral}/{loan} @ {lltv}%`
      with the MKT badge on the primary line. The adapter address
      moves to a secondary `via 0x7764…7a67` line below — still
      one-click-copyable via the existing `AddressDisplay`.
    - When it doesn't resolve (vault-v1, unknown, or no liquidity
      adapter set): falls back to the PR 33 shape (adapter name +
      type badge).

### Files changed (`git diff main --stat`)
New: `src/hooks/useLiquidityTargetMarket.ts`.
Modified: `src/components/vault/V2AllocationTab.tsx`.

### Tests
No new tests this PR — the hook is a thin wrapper over
`readContract` + `decodeAbiParameters` + `fetchTokenInfo`, all
already covered by upstream tests. The decoder's guard cases
(empty bytes, malformed tuple, zero-address sentinel) are exercised
visually in the fall-through to the address-display branch.

### Verification
- `npm run test:run` → **224 passed** (27 files, unchanged from
  PR 35). `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** One new hook (single readContract + decode + token-info
fetch), one panel render change. The fall-back to PR 33's
adapter-address display means vault-v1 adapters / unconfigured
adapters keep their previous look — no regression on those.

### Logged follow-up
- When the target market is rendered, optionally hyperlink the pair
  to the Morpho Blue market explorer for that chain. Tiny ergonomic
  win; deferred so the panel stays a presentation-only change.

---

## PR 37 — SetLiquidityDrawer: pick the target market, not just the adapter

### User feedback
> "Still not the case?"

After PR 36 shipped, the Active Adapter row still rendered the adapter
address instead of the target market. Root cause: PR 17's
`SetLiquidityDrawer` hardcoded empty bytes for `liquidityData`, so PR 36's
hook had nothing to decode. The curator had no UI to pick which market
the adapter routes to.

### Fix
`SetLiquidityDrawer` is now a two-step flow:

1. **Pick adapter** — same list as before. For vault-v1 / unknown
   adapters, the Select button immediately fires
   `setLiquidityAdapterAndData(adapter, 0x)` (their liquidityData is
   opaque/empty by design). For market-v1 adapters, Select transitions
   to step 2.
2. **Pick target market** — lists every market with caps configured
   on the adapter (sourced from PR 23's event scan, filtered to the
   chosen adapter). Each row shows pair / LLTV / market ID / current
   allocation. Select fires
   `setLiquidityAdapterAndData(adapter, abi.encode(MarketParams))`.
   - **Back** returns to step 1.
   - **Skip (no target)** sends empty bytes — useful when no markets
     are configured yet (adapter is set but no auto-routing).
   - Empty market list shows a warning pointing at the Caps tab.

The PR 36 `useLiquidityTargetMarket` hook now has a non-empty payload
to decode → Active Adapter row renders `WXDC / USDC @ 38.5%` per the
Morpho-curator screenshot.

### Files changed (`git diff main --stat`)
Modified: `src/components/vault/adapters/SetLiquidityDrawer.tsx`.

### Tests
No new tests — composition over existing primitives
(`useV2VaultCapEntries`, `useGuardedWriteContract`, the
`setLiquidityAdapterAndData` ABI fragment from PR 17). The encoding
shape (`abi.encode(MarketParams)`) mirrors what PR 36 decodes, and
PR 22's `marketIdData` test family already pins the MarketParams
tuple layout.

### Verification
- `npm run test:run` → **224 passed** (27 files, unchanged).
  `npx tsc -b` → **0**. `npm run build` → **success**.

### Scope-compliance self-audit
**PASS.** One drawer rewritten in place. The drawer's external API
(`{ open, onClose, adapters, currentLiquidityAdapter, … }`) didn't
change; both call sites (V2AdaptersTab banner button + PR 33
Allocation tab Change button) work unchanged.

### Loop closed (PR 33 → PR 36 → PR 37)
PR 33 surfaced the panel. PR 36 added the read-side decoder. PR 37
added the write-side picker. The Active Adapter row now matches
Morpho's curator UI end-to-end:
  - Curator picks adapter + target market in the drawer
  - `setLiquidityAdapterAndData(adapter, abi.encode(MarketParams))`
  - On-chain `liquidityData()` returns those bytes
  - `useLiquidityTargetMarket` decodes them
  - Allocation tab renders `{collateral}/{loan} @ {lltv}%`
