/**
 * Who may do what to a queued Vault V2 timelock action.
 *
 * Execute and Revoke are gated differently, and the pending-actions panel
 * shipped conflating them — it required owner/curator for both and told the
 * user "Only the vault owner or curator can execute a queued action."
 *
 *   Execute — permissionless. `submit()` is the gated step; the `timelocked`
 *     modifier on the target function only checks that `executableAt` is set
 *     and matured, then clears it. There is no role term on the execute path.
 *   Revoke  — restricted to owner / curator / sentinel.
 *
 * Verified against RockawayX USDC on Pharos (0x047cd0a9…02e5) with two matured
 * `increaseAbsoluteCap` payloads queued:
 *
 *   eth_call(from: 0x1111…1111, to: vault, data: <queued calldata>)  -> success
 *   eth_call(from: 0x1111…1111, to: vault, data: revoke(<calldata>)) -> revert
 *                                                       Unauthorized() 0x82b42900
 *   eth_call(from: <curator>,   to: vault, data: revoke(<calldata>)) -> success
 *
 * 0x1111…1111 is neither owner nor curator (both 0x8747cf05…d846), not an
 * allocator and not a sentinel.
 */

export interface ExecuteGateInput {
  isConnected: boolean;
  /** False when the submitted calldata doesn't decode against the V2 ABI. */
  decodable: boolean;
  /** `executableAt <= now`. */
  matured: boolean;
}

/**
 * Why Execute is unavailable — or null when it is available.
 *
 * Deliberately takes no role argument: the on-chain execute path has none
 * either, so a role term here could only ever block a transaction the vault
 * would have accepted. Keeping it out of the signature means a future edit
 * can't reintroduce the gate without changing the type.
 */
export function executeBlockedReason(input: ExecuteGateInput): string | null {
  if (!input.isConnected) return 'Connect your wallet to execute.';
  if (!input.decodable) return 'Calldata could not be decoded — execute from the originating drawer.';
  if (!input.matured) return 'The timelock has not elapsed yet.';
  return null;
}
