import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Address } from 'viem';
import type { Alert, VaultFlavor, VaultVersion } from '../types';

export interface TrackedVault {
  address: Address;
  chainId: number;
  name: string;
  version: VaultVersion;
  /**
   * Optional flavor tag. Set by the deploy flow or any caller that knows
   * the flavor; used by `useVaultFlavor` to seed `placeholderData` and
   * skip the flavor probe round-trip.
   */
  flavor?: VaultFlavor;
}

/**
 * A TimelockController operation we've scheduled ourselves. Persisted so
 * the Pending Proposals panel always sees the app's own proposals even when
 * the RPC prunes older `CallScheduled` logs (frequent on BSC public nodes).
 *
 * `opId` is the canonical `hashOperation` bytes32; use it as the key when
 * merging with on-chain logs to avoid double-counting.
 */
export interface ScheduledOp {
  /** Chain the timelock lives on. */
  chainId: number;
  /** The TimelockController address. */
  timelock: Address;
  /** The vault the operation targets (only used for grouping in UI). */
  vault: Address;
  /** `hashOperation(target, value, data, predecessor, salt)`. */
  opId: `0x${string}`;
  target: Address;
  value: string; // stringified bigint for JSON-safe persistence
  data: `0x${string}`;
  predecessor: `0x${string}`;
  salt: `0x${string}`;
  /** Delay passed to schedule (seconds). */
  delay: string;
  /** Block timestamp of the schedule tx (seconds). */
  scheduledAt: number;
  /** Human-readable label for the calldata — best-effort, may be 'Unknown call'. */
  label: string;
  /** Schedule tx hash. */
  txHash?: `0x${string}`;
}

interface AppState {
  // Tracked vaults (persisted locally via Zustand persist middleware)
  trackedVaults: TrackedVault[];
  dismissedVaults: string[]; // vaultKey strings explicitly untracked by user
  addTrackedVault: (vault: TrackedVault) => void;
  removeTrackedVault: (address: Address, chainId: number) => void;
  trackAll: (vaults: TrackedVault[]) => void;
  dismissDiscovered: (vaults: Array<{ address: string; chainId: number }>) => void;
  isDismissed: (address: string, chainId: number) => boolean;

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

  // Moolah scheduled timelock operations (persisted per chainId+vault)
  scheduledOps: ScheduledOp[];
  addScheduledOp: (op: ScheduledOp) => void;
  removeScheduledOp: (chainId: number, opId: `0x${string}`) => void;
  getScheduledOpsForVault: (chainId: number, vault: Address) => ScheduledOp[];
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

      dismissDiscovered: (vaults) =>
        set((state) => {
          const keys = vaults.map(vaultKey);
          const existing = new Set(state.dismissedVaults);
          const newKeys = keys.filter((k) => !existing.has(k));
          if (newKeys.length === 0) return state;
          return { dismissedVaults: [...state.dismissedVaults, ...newKeys] };
        }),

      isDismissed: (address, chainId) => {
        return get().dismissedVaults.includes(vaultKey({ address, chainId }));
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

      // Moolah scheduled ops
      scheduledOps: [],
      addScheduledOp: (op) =>
        set((state) => {
          const exists = state.scheduledOps.some(
            (o) => o.chainId === op.chainId && o.opId.toLowerCase() === op.opId.toLowerCase(),
          );
          if (exists) return state;
          return { scheduledOps: [op, ...state.scheduledOps].slice(0, 500) };
        }),
      removeScheduledOp: (chainId, opId) =>
        set((state) => ({
          scheduledOps: state.scheduledOps.filter(
            (o) => !(o.chainId === chainId && o.opId.toLowerCase() === opId.toLowerCase()),
          ),
        })),
      getScheduledOpsForVault: (chainId, vault) =>
        get().scheduledOps.filter(
          (o) => o.chainId === chainId && o.vault.toLowerCase() === vault.toLowerCase(),
        ),
    }),
    {
      name: 'morpho-curator-storage',
      partialize: (state) => ({
        trackedVaults: state.trackedVaults,
        dismissedVaults: state.dismissedVaults,
        customRpcUrls: state.customRpcUrls,
        sidebarCollapsed: state.sidebarCollapsed,
        scheduledOps: state.scheduledOps,
      }),
    },
  ),
);
