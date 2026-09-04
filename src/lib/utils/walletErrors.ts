/**
 * Turn a wallet-side dispatch failure into something a curator can act on.
 *
 * Writes are preflighted against the RPC before the wallet is ever opened
 * (see `useGuardedWriteContract`), so by the time an error comes back from the
 * wallet the *contract* call is known-good. What is left are connection-shaped
 * failures — and those were surfacing as a raw viem dump:
 *
 *   An unknown RPC error occurred. Request Arguments: chain: undefined
 *   (id: 1672) from: 0x8747… data: 0xf6f98fd5…  Details: Unsupported chains.
 *
 * "Unsupported chains." is WalletConnect sign-client error 5100: the chain the
 * app asked to transact on is not in the session's approved namespaces. The
 * session is pinned to the chain list that existed when the wallet approved
 * it, so a chain added to the app afterwards is absent until the user
 * reconnects. Nothing about that is discoverable from the dump.
 */

/** Flatten an error and its `cause` chain into one lowercase haystack. */
function flatten(error: unknown): { text: string; codes: number[] } {
  const parts: string[] = [];
  const codes: number[] = [];
  let cur: unknown = error;
  for (let depth = 0; cur && depth < 12; depth++) {
    const e = cur as { message?: string; shortMessage?: string; details?: string; name?: string; code?: unknown; cause?: unknown };
    for (const v of [e.message, e.shortMessage, e.details, e.name]) {
      if (typeof v === 'string') parts.push(v);
    }
    if (typeof e.code === 'number') codes.push(e.code);
    cur = e.cause;
  }
  return { text: parts.join(' \n ').toLowerCase(), codes };
}

export interface WalletErrorDescription {
  /** One-line, plain-language statement of what went wrong. */
  message: string;
  /** What the curator should do about it, when there is a concrete step. */
  action?: string;
  /** True when the transaction was never broadcast — nothing to check on-chain. */
  notSent: boolean;
}

/**
 * Describe a wallet dispatch failure, or return null when it isn't one we
 * recognise (the caller then shows the raw error rather than a guess).
 *
 * `chainName` is used to name the chain in the message; pass the target chain
 * of the write when known.
 */
export function describeWalletError(
  error: unknown,
  chainName?: string,
): WalletErrorDescription | null {
  if (!error) return null;
  const { text, codes } = flatten(error);
  const where = chainName ? `on ${chainName}` : 'on this network';
  const chain = chainName ?? 'this network';

  // WalletConnect sign-client 5100 — the session's approved namespaces do not
  // include the requested `eip155:<id>`. Switching cannot fix it; the session
  // itself has to be renegotiated.
  if (codes.includes(5100) || text.includes('unsupported chains')) {
    return {
      message: `Your wallet session doesn't include ${chain}, so it can't sign transactions ${where}.`,
      action:
        'Disconnect the wallet and reconnect — the new session will include this network. If it still fails, add the network in your wallet first, then reconnect.',
      notSent: true,
    };
  }

  // User dismissed the wallet prompt. Not a fault worth a red wall of text.
  if (codes.includes(4001) || text.includes('user rejected') || text.includes('user denied')) {
    return { message: 'Rejected in the wallet.', notSent: true };
  }

  // The chain isn't in the app's wagmi config at all — a configuration bug on
  // our side, not something the curator can fix by reconnecting.
  if (text.includes('chain not configured')) {
    return {
      message: `${chain} isn't configured in this app, so the wallet can't be switched to it.`,
      notSent: true,
    };
  }

  // Wallet is on a different network and the switch didn't happen.
  if (
    codes.includes(4902) ||
    text.includes('does not match the target chain') ||
    text.includes('chain mismatch') ||
    (text.includes('switchchainerror') && !text.includes('unsupported chains'))
  ) {
    return {
      message: `Your wallet is on a different network and couldn't switch to ${chain}.`,
      action: `Switch to ${chain} in your wallet, then try again.`,
      notSent: true,
    };
  }

  return null;
}
