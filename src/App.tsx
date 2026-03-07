import { Component, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
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
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ color: 'white', padding: '2rem', fontFamily: 'monospace', background: '#08090C', minHeight: '100vh' }}>
          <h1>Something went wrong</h1>
          <pre style={{ color: '#EF4444', whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
          <pre style={{ color: '#8B8FA3', fontSize: '0.75rem', marginTop: '1rem' }}>{this.state.error.stack}</pre>
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
          <RainbowKitProvider theme={darkTheme({ accentColor: '#00E676', accentColorForeground: '#08090C', borderRadius: 'small' })}>
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
