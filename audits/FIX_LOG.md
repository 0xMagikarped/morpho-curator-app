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

## PR 3 — Enforce CSP + add HSTS + complete connect-src

- **Branch:** `fix/audit-03-csp-hsts` (off `main` @ `3b75a0f`)
- **Audit finding:** `audits/AUDIT_2026-05-16.md` §4 — CSP Report-Only (not enforced),
  incomplete `connect-src`, no HSTS; + MEDIUM `script-src 'unsafe-eval'`, no Permissions-Policy.
- **Date:** 2026-05-17

### vercel.json changes
1. Header key `Content-Security-Policy-Report-Only` → **`Content-Security-Policy`** (enforced).
2. `script-src 'self' 'unsafe-eval'` → **`script-src 'self'`**. Justified by bundle grep:
   `dist/assets/*.js` had **0** `eval(` and **0** `new Function(`; the only `WebAssembly`
   tokens (5) are inert string refs in the Sentry vendor chunk — no real instantiation, so no
   `'wasm-unsafe-eval'` needed.
3. **connect-src completed** (was breaking BNB/Pharos/DefiLlama/Sentry once enforced).
4. Added `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
5. Added `Permissions-Policy: camera=(), microphone=(), geolocation=(), usb=(), payment=()`.
6. Untouched (separate audit rows, no bundling): dead `/api/` rewrite, COOP/COEP,
   `style-src 'unsafe-inline'`, `img-src https:`, `/assets/*` cache rule.

### Final connect-src allowlist + provenance (the substantive deliverable)
Sources: (a) `src/config/wagmi.ts` fallback transports; (b) `src/config/chains.ts` `rpcUrls`
(the `getPublicClient` path — used by the data layer and PR-1/2 simulate; DISTINCT from (a));
(c) browser `fetch` data APIs; (d) bundled `viem/chains` defaults (defensive);
(e) WalletConnect/Reown.

| Host | Why |
|---|---|
| `'self'` | app origin |
| `https://*.publicnode.com` | sei/eth/base/bsc publicnode (a)(b) |
| `https://evm-rpc.sei-apis.com` | SEI (a) |
| `https://eth.public-rpc.com` | ETH (a) |
| `https://rpc.ankr.com` | eth/base ankr (a) |
| `https://mainnet.base.org` | Base (a)(b)(d) |
| `https://*.llamarpc.com` | **added** — eth/base llamarpc in `chains.ts` rpcUrls (b) |
| `https://*.binance.org` | **added** — bsc-dataseed1/2 (a)(b) |
| `https://rpc.pharos.xyz` | **added** — Pharos (a)(b) |
| `https://eth.merkle.io` | **added (defensive)** — viem/chains mainnet default (d) |
| `https://*.rpc.thirdweb.com` | **added (defensive)** — viem/chains bsc default (d) |
| `https://api.morpho.org` | **added** — actual `MORPHO_API_URL` (`morphoApi.ts:4,169`) |
| `https://blue-api.morpho.org` | kept (harmless; SDK may use) |
| `https://coins.llama.fi` | **added** — DefiLlama pricing (`defiLlama.ts:26`) |
| `https://*.sentry.io` | **added** — Sentry ingest (when `VITE_SENTRY_DSN` set) |
| `https://*.walletconnect.com/.org`, `https://*.reown.com` + `wss://` of each | WalletConnect/Reown (e) |

Excluded by design: block explorers (etherscan/bscscan/basescan/seiscan/pharosscan) — anchor
navigations, not fetch/XHR → not a `connect-src` concern.

### Files changed
Modified (tracked): `vercel.json` (+6/-2 lines, full policy rewrite), `playwright.config.ts`
(+22/-8 — env-driven `baseURL`, skip local `webServer` when `BASE_URL` is external).
New (untracked): `src/__tests__/cspPolicy.test.ts` (100 LOC), `e2e/csp.spec.ts` (61 LOC).

### Tests
- **`src/__tests__/cspPolicy.test.ts` (vitest, deterministic, in CI):** 26 assertions —
  CSP enforced (no `-Report-Only`); `script-src` has no `'unsafe-eval'`; **each** of the 20
  required `connect-src` hosts present; no over-broad `https:` wildcard; HSTS
  `max-age>=63072000`+`includeSubDomains`+`preload`; Permissions-Policy present;
  frame-ancestors/X-Frame-Options regression guard.
- **`e2e/csp.spec.ts` (Playwright, env-gated):** `test.skip` unless `BASE_URL` set; against a
  Vercel preview asserts enforced CSP+HSTS response headers and zero CSP console violations
  across 6 routes. Sends `x-vercel-protection-bypass` when `VERCEL_AUTOMATION_BYPASS_SECRET`
  is provided.

### Verification
- **Fail-on-`main` demonstrated:** `git stash` `vercel.json` (→ main: Report-Only,
  unsafe-eval, no HSTS, incomplete connect-src) → `cspPolicy.test.ts` = **25 failed | 1
  passed** (the 1 = unchanged frame-ancestors guard). `git stash pop` → **26 passed**.
- `npm run test:run` → **117 passed** (7 files; was 91 — +26, 0 skipped).
- `npx tsc -b` → **0 errors**. `npm run build` → **success**.
- `git diff main --stat` → only `vercel.json` + `playwright.config.ts` (+2 new test files).
  PA `stash@{0}: pre-pr2-pa-feature` verified **intact**.

### Live-enforcement checkpoint (OPEN — human-in-the-loop)
`vite` does not emit `vercel.json` headers; `e2e/csp.spec.ts` only validates a real Vercel
preview. Project is linked (`.vercel/project.json`; remote
`github.com/0xMagikarped/morpho-curator-app`). **Not yet run** — requires: push
`fix/audit-03-csp-hsts` (external deploy — not done unilaterally), then
`BASE_URL=<preview> VERCEL_AUTOMATION_BYPASS_SECRET=<tok> npx playwright test e2e/csp.spec.ts`.
Until then, enforcement correctness is gated by the deterministic structural test only.

### Scope-compliance self-audit
**PASS.** Only `vercel.json` + `playwright.config.ts` modified; 2 new test files. No `src/**`
runtime code, wagmi/chains config, `tsconfig`/`eslint`/`package.json`/CI, PR-1/2 artifacts,
the PA stash, or `chore/document-defi-data-skill` touched. No push / Vercel-dashboard change
(human checkpoint, surfaced not silently skipped).
