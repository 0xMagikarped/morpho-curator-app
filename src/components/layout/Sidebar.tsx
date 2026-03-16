import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BarChart3, Vault, PlusCircle, Settings, PanelLeftClose, PanelLeft, FlaskConical, Search, Rocket } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { cn } from '../../lib/utils/cn';
import { ChainBadge } from '../ui/ChainBadge';
import { prefetchRoute } from '../../lib/prefetchRoute';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/markets', label: 'Markets', icon: BarChart3 },
  { path: '/create', label: 'Create Vault', icon: PlusCircle, accent: true },
  { path: '/market/create', label: 'Create Market', icon: FlaskConical },
  { path: '/oracle/decode', label: 'Oracle Decoder', icon: Search },
  { path: '/oracle/deploy', label: 'Oracle Deployer', icon: Rocket },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const trackedVaults = useAppStore((s) => s.trackedVaults);

  return (
    <aside
      className={cn(
        'relative flex flex-col h-screen border-r border-border-default transition-all duration-200',
        'bg-bg-surface',
        sidebarCollapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border-default">
        {!sidebarCollapsed && (
          <span className="font-display text-sm font-bold tracking-tight text-text-secondary">
            <span className="text-accent-primary mr-0.5">{'>'}</span>
            morpho<span className="text-accent-primary">_</span>
            <span className="text-text-tertiary text-xs">curator</span>
          </span>
        )}
        <button
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
        >
          {sidebarCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 space-y-0.5 px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            onMouseEnter={() => prefetchRoute(item.path)}
            onFocus={() => prefetchRoute(item.path)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 text-sm transition-colors relative',
                isActive
                  ? 'bg-bg-active text-text-secondary font-medium row-accent-left'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover',
              )
            }
          >
            <item.icon className={cn('w-[18px] h-[18px] shrink-0', item.accent && 'text-accent-primary')} />
            {!sidebarCollapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Tracked Vaults */}
      {!sidebarCollapsed && trackedVaults.length > 0 && (
        <div className="px-3 py-3 border-t border-border-subtle">
          <p className="text-text-tertiary text-[10px] uppercase tracking-widest font-mono mb-2 px-1">
            {'// Vaults'}
          </p>
          <div className="space-y-0.5">
            {trackedVaults.map((v) => (
              <NavLink
                key={`${v.chainId}-${v.address}`}
                to={`/vault/${v.chainId}/${v.address}`}
                onMouseEnter={() => prefetchRoute('vault-detail')}
                onFocus={() => prefetchRoute('vault-detail')}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 px-2 py-1.5 text-xs truncate transition-colors',
                    isActive
                      ? 'bg-bg-active text-text-secondary font-medium'
                      : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover',
                  )
                }
              >
                <Vault className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
                <span className="truncate">{v.name}</span>
                <ChainBadge chainId={v.chainId} className="ml-auto text-[9px] px-1 py-0" />
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
