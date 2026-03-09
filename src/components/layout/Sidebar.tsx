import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BarChart3, Vault, PlusCircle, Settings, PanelLeftClose, PanelLeft, FlaskConical, Search, Rocket } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { cn } from '../../lib/utils/cn';
import { ChainBadge } from '../ui/ChainBadge';

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
  const { sidebarCollapsed, toggleSidebar, trackedVaults } = useAppStore();

  return (
    <aside
      className={cn(
        'noise relative flex flex-col h-screen border-r border-border-default transition-all duration-200',
        'bg-bg-surface',
        sidebarCollapsed ? 'w-16' : 'w-60',
      )}
      style={{ backgroundImage: 'linear-gradient(180deg, #0D1017 0%, #0A0D14 100%)' }}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border-default">
        {!sidebarCollapsed && (
          <span className="text-sm font-bold text-text-primary tracking-tight font-mono">
            <span className="text-accent-primary">{'>'}</span>
            <span className="ml-1 text-text-secondary">morpho</span>
            <span className="text-accent-primary">_</span>
            <span className="text-text-tertiary text-xs ml-0.5">curator</span>
          </span>
        )}
        <button
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
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
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors relative',
                isActive
                  ? 'bg-bg-active text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                isActive && 'before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-accent-primary before:rounded-r',
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
          <p className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-2 px-1 font-mono">
            {'// Vaults'}
          </p>
          <div className="space-y-0.5">
            {trackedVaults.map((v) => (
              <NavLink
                key={`${v.chainId}-${v.address}`}
                to={`/vault/${v.chainId}/${v.address}`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs truncate transition-colors',
                    isActive
                      ? 'bg-bg-active text-text-primary'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
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
