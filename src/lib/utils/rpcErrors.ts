export type RpcErrorType = 'rate_limit' | 'network' | 'contract' | 'unknown';

export interface RpcErrorClassification {
  type: RpcErrorType;
  retryable: boolean;
  message: string;
}

/**
 * Classify an RPC error as retryable or fatal.
 * Used to decide whether to retry or show an error to the user.
 */
export function classifyRpcError(error: unknown): RpcErrorClassification {
  const err = error as { code?: number; message?: string; shortMessage?: string };
  const msg = err?.message || err?.shortMessage || '';

  if (err?.code === 429 || msg.includes('rate') || msg.includes('too many')) {
    return { type: 'rate_limit', retryable: true, message: 'RPC rate limited — retrying...' };
  }

  if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('fetch failed')) {
    return { type: 'network', retryable: true, message: 'Network error — retrying...' };
  }

  if (err?.code === -32603 || msg.includes('revert') || msg.includes('execution reverted')) {
    return { type: 'contract', retryable: false, message: 'Transaction would revert' };
  }

  return { type: 'unknown', retryable: false, message: msg || 'Unknown error' };
}

/**
 * Chain-specific block confirmation depths for finality.
 */
const SAFE_DEPTH: Record<number, number> = {
  1: 12,      // Ethereum — ~3 min
  8453: 120,  // Base — ~4 min
  42161: 120, // Arbitrum — ~4 min
  1329: 1,    // SEI — instant finality
};

export function getFinality(confirmations: number, chainId: number): 'finalized' | 'confirming' | 'pending' {
  const required = SAFE_DEPTH[chainId] || 12;
  if (confirmations >= required) return 'finalized';
  if (confirmations > 0) return 'confirming';
  return 'pending';
}

export function getRequiredConfirmations(chainId: number): number {
  return SAFE_DEPTH[chainId] || 12;
}
