/**
 * Wallet dispatch failures must arrive as something a curator can act on.
 *
 * Reported verbatim from the V2 Caps tab on Pharos:
 *
 *   An unknown RPC error occurred. Request Arguments: chain: undefined
 *   (id: 1672) from: 0x8747… to: 0x047cd0a9… data: 0xf6f98fd5…
 *   Contract Call: function: increaseAbsoluteCap(bytes idData, uint256 …)
 *   Details: Unsupported chains.
 *
 * "Unsupported chains." is WalletConnect sign-client error 5100 — the session's
 * approved namespaces do not contain eip155:1672. The contract call was fine;
 * the session was not. Nothing in that dump says so, and nothing says the fix
 * is to reconnect.
 */
import { describe, it, expect } from 'vitest';
import { describeWalletError } from '../walletErrors';

/** The shape viem produces: a wrapper whose `cause` carries the real detail. */
const nested = (detail: string, code?: number) => {
  const cause = Object.assign(new Error(detail), code === undefined ? {} : { code });
  return Object.assign(new Error('An unknown RPC error occurred.'), { cause });
};

describe('describeWalletError — WalletConnect 5100', () => {
  it('explains the reported "Unsupported chains." dump and names the chain', () => {
    const d = describeWalletError(nested('Unsupported chains.'), 'Pharos');
    expect(d).not.toBeNull();
    expect(d!.message).toContain('Pharos');
    expect(d!.message).toMatch(/session/i);
    expect(d!.action).toMatch(/reconnect/i);
    // The transaction never left the browser — say so, so nobody hunts for it.
    expect(d!.notSent).toBe(true);
  });

  it('matches on the numeric 5100 code even without the message', () => {
    const d = describeWalletError(nested('request failed', 5100), 'Pharos');
    expect(d!.action).toMatch(/reconnect/i);
  });

  it('falls back to a generic phrase when the chain name is unknown', () => {
    const d = describeWalletError(nested('Unsupported chains.'));
    expect(d!.message).toContain('this network');
    expect(d!.message).not.toContain('undefined');
  });
});

describe('describeWalletError — other dispatch failures', () => {
  it('reports a user rejection plainly, without an action', () => {
    const d = describeWalletError(nested('User rejected the request.', 4001));
    expect(d!.message).toBe('Rejected in the wallet.');
    expect(d!.action).toBeUndefined();
    expect(d!.notSent).toBe(true);
  });

  it('distinguishes a failed switch from a missing session', () => {
    const d = describeWalletError(nested('does not match the target chain'), 'Pharos');
    expect(d!.message).toMatch(/different network/i);
    expect(d!.action).toMatch(/switch to pharos/i);
    // Not the reconnect advice — reconnecting would not help here.
    expect(d!.action).not.toMatch(/reconnect/i);
  });

  it('flags an app-side configuration gap rather than blaming the wallet', () => {
    const d = describeWalletError(nested('Chain not configured'), 'Citrea');
    expect(d!.message).toMatch(/isn't configured in this app/i);
    expect(d!.action).toBeUndefined();
  });
});

describe('describeWalletError — restraint', () => {
  it('returns null for an unrecognised error so the raw text still shows', () => {
    // Guessing wrong here is worse than showing the dump.
    expect(describeWalletError(nested('execution reverted: NotCurator'))).toBeNull();
    expect(describeWalletError(new Error('boom'))).toBeNull();
  });

  it('returns null for no error', () => {
    expect(describeWalletError(null)).toBeNull();
    expect(describeWalletError(undefined)).toBeNull();
  });

  it('walks a deep cause chain and terminates on a cyclic one', () => {
    const deep = nested('Unsupported chains.');
    (deep as { cause?: unknown }).cause = {
      message: 'wrapper',
      cause: { message: 'Unsupported chains.', code: 5100 },
    };
    expect(describeWalletError(deep, 'Pharos')).not.toBeNull();

    const cyclic: { message: string; cause?: unknown } = { message: 'loop' };
    cyclic.cause = cyclic;
    expect(() => describeWalletError(cyclic)).not.toThrow();
  });
});
