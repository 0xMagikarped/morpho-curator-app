import * as Sentry from '@sentry/react';
import { classifyRpcError } from '../utils/rpcErrors';

export function trackRpcError(error: unknown, context: {
  chainId: number;
  method?: string;
  provider?: string;
}) {
  const classified = classifyRpcError(error);

  Sentry.captureException(error, {
    level: classified.retryable ? 'warning' : 'error',
    tags: {
      rpc_error_type: classified.type,
      chain_id: String(context.chainId),
      rpc_method: context.method || 'unknown',
      rpc_provider: context.provider || 'unknown',
      retryable: String(classified.retryable),
    },
    fingerprint: ['rpc-error', classified.type, String(context.chainId)],
  });
}

export function trackRpcLatency(chainId: number, provider: string, durationMs: number) {
  Sentry.setMeasurement('rpc.latency', durationMs, 'millisecond');
  Sentry.addBreadcrumb({
    category: 'rpc.latency',
    message: `${provider} chain=${chainId} ${durationMs}ms`,
    level: durationMs > 5000 ? 'warning' : 'info',
  });
}
