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
