/**
 * Executing a matured Vault V2 timelock action is PERMISSIONLESS.
 *
 * The pending-actions panel used to gate Execute on
 * `canCurate || canManage || isAdmin` and tell the user "Only the vault owner
 * or curator can execute a queued action." That is not what the contract does:
 * `submit()` is the gated step, and the `timelocked` modifier on the target
 * function only checks that `executableAt` is set and matured before clearing
 * it. No role term anywhere on the execute path — so the UI was refusing a
 * transaction the vault would have accepted, and hiding the fact that any
 * wallet can push a stuck matured action through.
 *
 * The on-chain evidence is in the module header of `../timelockGates`.
 */
import { describe, it, expect } from 'vitest';
import { executeBlockedReason } from '../timelockGates';

const connected = { isConnected: true, decodable: true, matured: true };

describe('executeBlockedReason — Execute is permissionless', () => {
  it('allows a connected wallet with no vault role at all', () => {
    expect(executeBlockedReason(connected)).toBeNull();
  });

  it('blocks only on the three things the chain actually blocks on', () => {
    expect(executeBlockedReason({ ...connected, isConnected: false })).toMatch(/connect/i);
    expect(executeBlockedReason({ ...connected, matured: false })).toMatch(/not elapsed/i);
    expect(executeBlockedReason({ ...connected, decodable: false })).toMatch(/decoded/i);
  });

  it('never cites owner or curator — that message was the bug', () => {
    const messages = [
      executeBlockedReason({ ...connected, isConnected: false }),
      executeBlockedReason({ ...connected, matured: false }),
      executeBlockedReason({ ...connected, decodable: false }),
    ];
    for (const m of messages) {
      expect(m).not.toMatch(/owner|curator|sentinel|permission/i);
    }
  });

  it('reports disconnection before maturity — the actionable one first', () => {
    expect(executeBlockedReason({ isConnected: false, decodable: true, matured: false })).toMatch(
      /connect/i,
    );
  });
});
