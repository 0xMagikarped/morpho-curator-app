import { Component, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

import { config } from './config/wagmi';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { VaultPage } from './pages/VaultPage';
import { MarketsPage } from './pages/MarketsPage';
import { CreateVaultPage } from './pages/CreateVaultPage';
import { CreateMarketPage } from './pages/CreateMarketPage';
import { SettingsPage } from './pages/SettingsPage';
import { OracleDecoderPage } from './pages/OracleDecoderPage';
import { OracleDeployerPage } from './pages/OracleDeployerPage';

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
  },
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ color: '#0A0080', padding: '2rem', fontFamily: 'monospace', background: '#EBEBEB', minHeight: '100vh' }}>
          <h1>Something went wrong</h1>
          <pre style={{ color: '#DC2626', whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
          <pre style={{ color: '#6B6BC8', fontSize: '0.75rem', marginTop: '1rem' }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={lightTheme({ accentColor: '#00C060', accentColorForeground: '#FFFFFF', borderRadius: 'none' })}>
            <BrowserRouter>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route
                    path="/vault/:chainId/:address"
                    element={<VaultPage />}
                  />
                  <Route path="/markets" element={<MarketsPage />} />
                  <Route path="/create" element={<CreateVaultPage />} />
                  <Route path="/market/create" element={<CreateMarketPage />} />
                  <Route path="/oracle/decode" element={<OracleDecoderPage />} />
                  <Route path="/oracle/deploy" element={<OracleDeployerPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  );
}

export default App;
