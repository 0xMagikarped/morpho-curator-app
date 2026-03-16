import * as Sentry from '@sentry/react';

type TxState = 'signing' | 'pending' | 'confirming' | 'confirmed' | 'failed' | 'reverted' | 'rejected';

export function trackTxStateChange(state: TxState, context: {
  chainId: number;
  action: string;
  vaultAddress?: string;
  txHash?: string;
  error?: string;
}) {
  Sentry.addBreadcrumb({
    category: 'transaction',
    message: `TX ${context.action}: ${state}`,
    data: {
      chain_id: context.chainId,
      tx_hash: context.txHash,
      vault: context.vaultAddress,
    },
    level: state === 'failed' || state === 'reverted' ? 'error' : 'info',
  });

  if (state === 'failed' || state === 'reverted') {
    Sentry.captureMessage(`Transaction ${state}: ${context.action}`, {
      level: 'error',
      tags: {
        tx_state: state,
        tx_action: context.action,
        chain_id: String(context.chainId),
      },
      extra: {
        tx_hash: context.txHash,
        vault_address: context.vaultAddress,
        error_message: context.error,
      },
      fingerprint: ['tx-failure', context.action, state],
    });
  }
}
