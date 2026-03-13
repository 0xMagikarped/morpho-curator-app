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
  dismissedVaults: string[]; // vaultKey strings explicitly untracked by user
  isSyncing: boolean;
  addTrackedVault: (vault: TrackedVault) => void;
  removeTrackedVault: (address: Address, chainId: number) => void;
  trackAll: (vaults: TrackedVault[]) => void;
  isDismissed: (address: string, chainId: number) => boolean;
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

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Tracked vaults
      trackedVaults: [],
      dismissedVaults: [],
      isSyncing: false,

      addTrackedVault: (vault) =>
        set((state) => {
          const exists = state.trackedVaults.some(
            (v) => v.address.toLowerCase() === vault.address.toLowerCase() && v.chainId === vault.chainId,
          );
          if (exists) return state;
          // Re-tracking clears the dismiss
          const key = vaultKey(vault);
          const dismissedVaults = state.dismissedVaults.filter((k) => k !== key);
          return { trackedVaults: [...state.trackedVaults, vault], dismissedVaults };
        }),

      removeTrackedVault: (address, chainId) =>
        set((state) => {
          const key = vaultKey({ address, chainId });
          return {
            trackedVaults: state.trackedVaults.filter(
              (v) => !(v.address.toLowerCase() === address.toLowerCase() && v.chainId === chainId),
            ),
            // Remember this was explicitly untracked
            dismissedVaults: state.dismissedVaults.includes(key)
              ? state.dismissedVaults
              : [...state.dismissedVaults, key],
          };
        }),

      trackAll: (vaults) =>
        set((state) => {
          const existing = new Set(state.trackedVaults.map(vaultKey));
          const newOnes = vaults.filter((v) => !existing.has(vaultKey(v)));
          if (newOnes.length === 0) return state;
          // Clear dismissals for re-tracked vaults
          const newKeys = new Set(newOnes.map(vaultKey));
          const dismissedVaults = state.dismissedVaults.filter((k) => !newKeys.has(k));
          return { trackedVaults: [...state.trackedVaults, ...newOnes], dismissedVaults };
        }),

      isDismissed: (address, chainId) => {
        return get().dismissedVaults.includes(vaultKey({ address, chainId }));
      },

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
          const { trackedVaults: local, dismissedVaults } = get();
          const remoteKeys = new Set(remote.map(vaultKey));
          const dismissedKeys = new Set(dismissedVaults);

          // Start with remote (authoritative)
          // Add local-only vaults that aren't dismissed (added offline before sync)
          const localOnly = local.filter(
            (v) => !remoteKeys.has(vaultKey(v)) && !dismissedKeys.has(vaultKey(v)),
          );
          const merged = [...remote, ...localOnly];

          set({ trackedVaults: merged });
          // Push local-only additions back to Edge Config
          if (localOnly.length > 0) {
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
        dismissedVaults: state.dismissedVaults,
        customRpcUrls: state.customRpcUrls,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
