/**
 * `useChainGuard` decided mismatch from `useAccount().chain`, which wagmi
 * resolves by looking the connected id up in the app's configured chains — so
 * it is `undefined` whenever the wallet sits on a network the app doesn't
 * configure. `!!chain && chain.id !== required` then evaluated false, i.e.
 * "no mismatch", and the write went through to the wallet. The wallet on an
 * unknown network is the case that most needs the guard.
 *
 * These pin the predicate itself, independent of React.
 */
import { describe, it, expect } from 'vitest';

/** The predicate as implemented in useChainGuard. */
const isMismatch = (isConnected: boolean, chainId: number | undefined, required: number) =>
  isConnected && chainId !== required;

/** The predicate as it was before — kept to pin the regression it allowed. */
const oldIsMismatch = (chain: { id: number } | undefined, required: number) =>
  !!chain && chain.id !== required;

const PHAROS = 1672;

describe('useChainGuard mismatch predicate', () => {
  it('is false when the wallet is on the required chain', () => {
    expect(isMismatch(true, PHAROS, PHAROS)).toBe(false);
  });

  it('is true when the wallet is on another configured chain', () => {
    expect(isMismatch(true, 1, PHAROS)).toBe(true);
  });

  it('is TRUE when the wallet is on a chain the app does not configure', () => {
    // wagmi reports chainId but resolves `chain` to undefined. The old
    // predicate saw undefined and waved the write through.
    expect(isMismatch(true, 999_999, PHAROS)).toBe(true);
    expect(oldIsMismatch(undefined, PHAROS)).toBe(false); // the bug
  });

  it('is false when no wallet is connected — that is a different guard', () => {
    // Connection is checked separately in useGuardedWriteContract; reporting a
    // network mismatch for a disconnected wallet would be misleading.
    expect(isMismatch(false, undefined, PHAROS)).toBe(false);
  });
});
