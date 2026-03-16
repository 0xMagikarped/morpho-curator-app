import * as Sentry from '@sentry/react';

export function initSentry() {
  if (import.meta.env.PROD) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      tracesSampleRate: 0.2,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0.5,

      ignoreErrors: [
        'ResizeObserver loop',
        'Non-Error exception captured',
        /Loading chunk .* failed/,
        'MetaMask - RPC Error',
        'User rejected the request',
        'user rejected transaction',
      ],

      beforeSend(event) {
        if (event.message) {
          event.message = event.message.replace(/0x[a-fA-F0-9]{40}/g, '0x[ADDR]');
        }
        return event;
      },
    });
  }
}
