import * as Sentry from '@sentry/react';

export function trackMorphoApiError(error: unknown, context: {
  query: string;
  chainId?: number;
  statusCode?: number;
}) {
  Sentry.captureException(error, {
    level: 'error',
    tags: {
      api: 'morpho',
      chain_id: context.chainId ? String(context.chainId) : 'unknown',
      status_code: context.statusCode ? String(context.statusCode) : 'unknown',
    },
    extra: {
      graphql_query: context.query.slice(0, 500),
    },
    fingerprint: ['morpho-api', String(context.statusCode)],
  });
}

export function trackApiLatency(endpoint: string, durationMs: number) {
  Sentry.setMeasurement('api.latency', durationMs, 'millisecond');
  Sentry.addBreadcrumb({
    category: 'api.latency',
    message: `${endpoint} ${durationMs}ms`,
    level: durationMs > 5000 ? 'warning' : 'info',
  });
}
