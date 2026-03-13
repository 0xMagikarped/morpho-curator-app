import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAppStore } from '../../store/appStore';

export function AppLayout() {
  const { address, isConnected } = useAccount();
  const syncFromEdgeConfig = useAppStore((s) => s.syncFromEdgeConfig);

  // Sync tracked vaults from Edge Config on wallet connect
  useEffect(() => {
    if (isConnected && address) {
      syncFromEdgeConfig(address);
    }
  }, [isConnected, address, syncFromEdgeConfig]);

  return (
    <div className="flex h-screen bg-bg-root text-text-primary">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-4 lg:p-6 bg-bg-root">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
