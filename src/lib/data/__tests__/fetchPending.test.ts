/**
 * PR 4 — Moolah-aware `fetchPending*` guard.
 *
 * On `main` these functions call viem `readContract` against MetaMorpho V1's
 * `pending*` selectors unconditionally; on a Moolah vault (chain 56) those
 * selectors don't exist (Moolah's setCap is instant — no pending state by
 * protocol design) so the read reverts. `fetchPendingCap` had no try/catch,
 * which is the user-visible chain-switch crash; the other two swallowed the
 * revert but still made the wasted RPC. PR 4 short-circuits all three to
 * `null` on Moolah, before any network call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the mock factory below and the tests can share the same spy.
const { readContractSpy } = vi.hoisted(() => ({
  readContractSpy: vi.fn(),
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    // Every `getPublicClient(...)` inside rpcClient.ts builds its client via
    // this factory — we hand back a fake whose only behaviour is the spy.
    createPublicClient: () => ({ readContract: readContractSpy }),
  };
});

// Imports MUST follow the mock — vi.mock is hoisted, but the symbolic order
// helps future readers understand the dependency direction.
import {
  fetchPendingCap,
  fetchPendingTimelock,
  fetchPendingGuardian,
} from '../rpcClient';

const VAULT = '0x0000000000000000000000000000000000000001' as const;
const MARKET_ID =
  '0x0000000000000000000000000000000000000000000000000000000000000002' as const;

const MOOLAH_CHAIN = 56; // BNB / Lista — the only `protocol: 'moolah'` chain.
const MORPHO_CHAIN = 1;  // Ethereum mainnet — vanilla MetaMorpho.

beforeEach(() => {
  readContractSpy.mockReset();
});

describe('fetchPendingCap — Moolah short-circuit (audit PR 4)', () => {
  it('returns null on Moolah and does NOT call readContract', async () => {
    const result = await fetchPendingCap(MOOLAH_CHAIN, VAULT, MARKET_ID);
    expect(result).toBeNull();
    expect(readContractSpy).not.toHaveBeenCalled();
  });

  it('reads pendingCap on Morpho chains and parses the tuple', async () => {
    readContractSpy.mockResolvedValueOnce([10n, 1234n]);
    const result = await fetchPendingCap(MORPHO_CHAIN, VAULT, MARKET_ID);
    expect(readContractSpy).toHaveBeenCalledTimes(1);
    expect(readContractSpy.mock.calls[0][0]).toMatchObject({
      address: VAULT,
      functionName: 'pendingCap',
      args: [MARKET_ID],
    });
    expect(result).toEqual({ marketId: MARKET_ID, value: 10n, validAt: 1234n });
  });
});

describe('fetchPendingTimelock — Moolah short-circuit (audit PR 4)', () => {
  it('returns null on Moolah and does NOT call readContract', async () => {
    // Pre-resolve so a regression that bypasses the guard would WRONGLY
    // surface a non-null pending — locking in the no-call invariant.
    readContractSpy.mockResolvedValueOnce([42n, 999n]);
    const result = await fetchPendingTimelock(MOOLAH_CHAIN, VAULT);
    expect(result).toBeNull();
    expect(readContractSpy).not.toHaveBeenCalled();
  });

  it('reads pendingTimelock on Morpho chains and parses the tuple', async () => {
    readContractSpy.mockResolvedValueOnce([20n, 5678n]);
    const result = await fetchPendingTimelock(MORPHO_CHAIN, VAULT);
    expect(readContractSpy).toHaveBeenCalledTimes(1);
    expect(readContractSpy.mock.calls[0][0]).toMatchObject({
      address: VAULT,
      functionName: 'pendingTimelock',
    });
    expect(result).toEqual({ value: 20n, validAt: 5678n });
  });
});

describe('fetchPendingGuardian — Moolah short-circuit (audit PR 4)', () => {
  it('returns null on Moolah and does NOT call readContract', async () => {
    readContractSpy.mockResolvedValueOnce(['0xdead', 999n]);
    const result = await fetchPendingGuardian(MOOLAH_CHAIN, VAULT);
    expect(result).toBeNull();
    expect(readContractSpy).not.toHaveBeenCalled();
  });

  it('reads pendingGuardian on Morpho chains and parses the tuple', async () => {
    const newGuardian = '0x000000000000000000000000000000000000abcd' as const;
    readContractSpy.mockResolvedValueOnce([newGuardian, 7777n]);
    const result = await fetchPendingGuardian(MORPHO_CHAIN, VAULT);
    expect(readContractSpy).toHaveBeenCalledTimes(1);
    expect(readContractSpy.mock.calls[0][0]).toMatchObject({
      address: VAULT,
      functionName: 'pendingGuardian',
    });
    expect(result).toEqual({ value: newGuardian, validAt: 7777n });
  });
});
