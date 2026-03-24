import * as Sentry from '@sentry/react';
import { Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

import { config } from './config/wagmi';
import { AppLayout } from './components/layout/AppLayout';
import { PageLoader } from './components/ui/PageLoader';
import { WalletConnectCopyLink } from './components/ui/WalletConnectCopyLink';
import { lazyWithRetry } from './lib/lazyWithRetry';

// Lazy-loaded page components — each becomes its own chunk
const DashboardPage = lazyWithRetry(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const VaultPage = lazyWithRetry(() =>
  import('./pages/VaultPage').then((m) => ({ default: m.VaultPage })),
);
const MarketsPage = lazyWithRetry(() =>
  import('./pages/MarketsPage').then((m) => ({ default: m.MarketsPage })),
);
const CreateVaultPage = lazyWithRetry(() =>
  import('./pages/CreateVaultPage').then((m) => ({ default: m.CreateVaultPage })),
);
const CreateMarketPage = lazyWithRetry(() =>
  import('./pages/CreateMarketPage').then((m) => ({ default: m.CreateMarketPage })),
);
const SettingsPage = lazyWithRetry(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const OracleDecoderPage = lazyWithRetry(() =>
  import('./pages/OracleDecoderPage').then((m) => ({ default: m.OracleDecoderPage })),
);
const OracleDeployerPage = lazyWithRetry(() =>
  import('./pages/OracleDeployerPage').then((m) => ({ default: m.OracleDeployerPage })),
);
const SetRegistryPage = lazyWithRetry(() =>
  import('./pages/SetRegistryPage').then((m) => ({ default: m.SetRegistryPage })),
);
const AddMarketPage = lazyWithRetry(() =>
  import('./pages/AddMarketPage').then((m) => ({ default: m.AddMarketPage })),
);
const CapsPage = lazyWithRetry(() =>
  import('./pages/CapsPage').then((m) => ({ default: m.CapsPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,       // 5 min — DeFi data is fresh for 5 min
      gcTime: 30 * 60 * 1000,         // 30 min — keep stale data in cache
      retry: (failureCount, error) => {
        // Don't retry client errors (4xx)
        const status = (error as { status?: number })?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,     // Prevent surprise refetches burning RPC quota
      refetchOnReconnect: 'always',    // Do refetch when network comes back
    },
    mutations: {
      onError: (error) => {
        Sentry.captureException(error, {
          tags: { source: 'react-query-mutation' },
        });
      },
    },
  },
});

function SentryFallback({ error }: { error: Error }) {
  return (
    <div style={{ color: '#0A0080', padding: '2rem', fontFamily: 'monospace', background: '#EBEBEB', minHeight: '100vh' }}>
      <h1>Something went wrong</h1>
      <pre style={{ color: '#DC2626', whiteSpace: 'pre-wrap' }}>{error.message}</pre>
      <pre style={{ color: '#6B6BC8', fontSize: '0.75rem', marginTop: '1rem' }}>{error.stack}</pre>
    </div>
  );
}

function App() {
  // Clear chunk-reload flag on successful app load
  useEffect(() => {
    sessionStorage.removeItem('chunk-reload');
  }, []);

  return (
    <Sentry.ErrorBoundary fallback={({ error }) => <SentryFallback error={error as Error} />}>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={lightTheme({ accentColor: '#00C060', accentColorForeground: '#FFFFFF', borderRadius: 'none' })}>
            <WalletConnectCopyLink />
            <BrowserRouter>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
                  <Route path="/vault/:chainId/:address" element={<Suspense fallback={<PageLoader />}><VaultPage /></Suspense>} />
                  <Route path="/vault/:chainId/:address/registry" element={<Suspense fallback={<PageLoader />}><SetRegistryPage /></Suspense>} />
                  <Route path="/vault/:chainId/:address/add-market" element={<Suspense fallback={<PageLoader />}><AddMarketPage /></Suspense>} />
                  <Route path="/vault/:chainId/:address/caps" element={<Suspense fallback={<PageLoader />}><CapsPage /></Suspense>} />
                  <Route path="/markets" element={<Suspense fallback={<PageLoader />}><MarketsPage /></Suspense>} />
                  <Route path="/create" element={<Suspense fallback={<PageLoader />}><CreateVaultPage /></Suspense>} />
                  <Route path="/market/create" element={<Suspense fallback={<PageLoader />}><CreateMarketPage /></Suspense>} />
                  <Route path="/oracle/decode" element={<Suspense fallback={<PageLoader />}><OracleDecoderPage /></Suspense>} />
                  <Route path="/oracle/deploy" element={<Suspense fallback={<PageLoader />}><OracleDeployerPage /></Suspense>} />
                  <Route path="/settings" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
                </Route>
              </Routes>
            </BrowserRouter>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
