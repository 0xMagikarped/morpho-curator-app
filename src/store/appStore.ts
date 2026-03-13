import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Address } from 'viem';
import type { Alert, VaultVersion } from '../types';

export interface TrackedVault {
  address: Address;
  chainId: number;
  name: string;
  version: VaultVersion;
}

interface AppState {
  // Tracked vaults (persisted locally + synced to Edge Config)
  trackedVaults: TrackedVault[];
  isSyncing: boolean;
  addTrackedVault: (vault: TrackedVault) => void;
  removeTrackedVault: (address: Address, chainId: number) => void;
  trackAll: (vaults: TrackedVault[]) => void;
  syncFromEdgeConfig: (wallet: string) => Promise<void>;
  persistToEdgeConfig: (wallet: string) => Promise<void>;

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

function vaultKey(v: { address: string; chainId: number }): string {
  return `${v.address.toLowerCase()}-${v.chainId}`;
}

function mergeVaultLists(local: TrackedVault[], remote: TrackedVault[]): TrackedVault[] {
  const merged = new Map<string, TrackedVault>();
  // Remote (Edge Config) is authoritative
  for (const v of remote) merged.set(vaultKey(v), v);
  // Add local-only vaults (tracked offline or before sync)
  for (const v of local) {
    const k = vaultKey(v);
    if (!merged.has(k)) merged.set(k, v);
  }
  return Array.from(merged.values());
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Tracked vaults
      trackedVaults: [],
      isSyncing: false,

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

      trackAll: (vaults) =>
        set((state) => {
          const existing = new Set(state.trackedVaults.map(vaultKey));
          const newOnes = vaults.filter((v) => !existing.has(vaultKey(v)));
          if (newOnes.length === 0) return state;
          return { trackedVaults: [...state.trackedVaults, ...newOnes] };
        }),

      syncFromEdgeConfig: async (wallet) => {
        if (!wallet) return;
        set({ isSyncing: true });
        try {
          const res = await fetch(`/api/tracked-vaults?wallet=${wallet}`);
          if (!res.ok) {
            console.warn('[tracking] Edge Config fetch failed:', res.status);
            return;
          }
          const remote = await res.json();
          if (!Array.isArray(remote)) {
            console.warn('[tracking] Edge Config returned non-array:', remote);
            return;
          }
          const local = get().trackedVaults;
          const merged = mergeVaultLists(local, remote);
          set({ trackedVaults: merged });
          // If local had vaults not in remote, push the merged list back
          if (merged.length > remote.length) {
            get().persistToEdgeConfig(wallet);
          }
        } catch (err) {
          console.warn('[tracking] Edge Config sync failed, using local data:', err);
        } finally {
          set({ isSyncing: false });
        }
      },

      persistToEdgeConfig: async (wallet) => {
        const { trackedVaults } = get();
        try {
          const res = await fetch('/api/track-vault', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet, vaults: trackedVaults }),
          });
          if (!res.ok) {
            const body = await res.text();
            console.error('[tracking] Edge Config persist failed:', res.status, body);
          }
        } catch (err) {
          console.warn('[tracking] Edge Config persist failed:', err);
        }
      },

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
