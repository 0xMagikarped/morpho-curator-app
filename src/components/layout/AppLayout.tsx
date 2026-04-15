import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { PausedBanner } from './PausedBanner';

export function AppLayout() {
  return (
    <div className="flex h-screen bg-bg-root text-text-primary">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header />
        <PausedBanner />
        <main className="flex-1 overflow-auto p-4 lg:p-6 bg-bg-root">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
