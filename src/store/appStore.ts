import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Address } from 'viem';
import type { Alert, VaultVersion } from '../types';

interface TrackedVault {
  address: Address;
  chainId: number;
  name: string;
  version: VaultVersion;
}

interface AppState {
  // Tracked vaults (persisted)
  trackedVaults: TrackedVault[];
  addTrackedVault: (vault: TrackedVault) => void;
  removeTrackedVault: (address: Address, chainId: number) => void;

  // Active vault selection
  activeVaultAddress: Address | null;
  activeChainId: number | null;
  setActiveVault: (address: Address, chainId: number) => void;
  clearActiveVault: () => void;

  // Alerts
  alerts: Alert[];
  addAlert: (alert: Alert) => void;
  dismissAlert: (id: string) => void;
  clearAlerts: () => void;

  // Custom RPC URLs (persisted)
  customRpcUrls: Record<number, string>;
  setCustomRpcUrl: (chainId: number, url: string) => void;

  // UI state
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Tracked vaults
      trackedVaults: [],
      addTrackedVault: (vault) =>
        set((state) => {
          const exists = state.trackedVaults.some(
            (v) => v.address.toLowerCase() === vault.address.toLowerCase() && v.chainId === vault.chainId,
          );
          if (exists) return state;
          return { trackedVaults: [...state.trackedVaults, vault] };
        }),
      removeTrackedVault: (address, chainId) =>
        set((state) => ({
          trackedVaults: state.trackedVaults.filter(
            (v) => !(v.address.toLowerCase() === address.toLowerCase() && v.chainId === chainId),
          ),
        })),

      // Active vault
      activeVaultAddress: null,
      activeChainId: null,
      setActiveVault: (address, chainId) =>
        set({ activeVaultAddress: address, activeChainId: chainId }),
      clearActiveVault: () =>
        set({ activeVaultAddress: null, activeChainId: null }),

      // Alerts
      alerts: [],
      addAlert: (alert) =>
        set((state) => ({ alerts: [alert, ...state.alerts].slice(0, 100) })),
      dismissAlert: (id) =>
        set((state) => ({
          alerts: state.alerts.map((a) =>
            a.id === id ? { ...a, dismissed: true } : a,
          ),
        })),
      clearAlerts: () => set({ alerts: [] }),

      // Custom RPC
      customRpcUrls: {},
      setCustomRpcUrl: (chainId, url) =>
        set((state) => ({
          customRpcUrls: { ...state.customRpcUrls, [chainId]: url },
        })),

      // UI
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: 'morpho-curator-storage',
      partialize: (state) => ({
        trackedVaults: state.trackedVaults,
        customRpcUrls: state.customRpcUrls,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
