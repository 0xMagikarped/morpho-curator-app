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
