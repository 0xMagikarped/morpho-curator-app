# Audit fix — deferred follow-ups

Items intentionally out of scope of the PR they were found in, logged here instead
of causing scope drift.

## From PR 2 (simulate-before-write guard)

- **Unify decoded `simulateError` rendering across the remaining ~25
  `useGuardedWriteContract` consumers.** PR 2 made the *guard* itself global (all
  ~26 write sites are now fail-closed via the hook) but only wired the decoded
  error into ONE UI surface — `src/components/vault/CapsTab.tsx` (via
  `useVaultWrite`). The other consumers (owner cards, adapter drawers,
  V2 tabs, `PendingProposalsPanel`, `usePublicAllocator`, etc.) still render
  their own ad-hoc/absent error UI and do not yet show the decoded
  `simulateError.errorName`. Follow-up: introduce one shared error/alert
  component and route every consumer's `simulateError`/`error` through it.
  Ref: `audits/AUDIT_2026-05-16.md` §5 (D4), `audits/FIX_LOG.md` (PR 2).
