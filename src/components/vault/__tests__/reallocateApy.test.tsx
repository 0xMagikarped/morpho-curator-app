/**
 * The V1 Reallocate tab's APY column.
 *
 * Reported from a SEI vault: every market read "0.00%", and there was no
 * post-rebalance rate anywhere. Two distinct bugs behind one symptom —
 * `fetchVaultDataViaRpc` hardcoded `supplyAPY: 0` (so RPC-only chains showed a
 * confident zero), and V1 had no IRM projection at all, unlike the V2 dialog.
 *
 * This renders the real component against a stubbed chain and asserts what a
 * curator actually sees: a live rate per market, an arrow to the projected
 * rate on edited rows, and — critically — never "0.00%" for a market whose
 * rate is merely unknown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const IDLE = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;
const WSEI = '0x2222222222222222222222222222222222222222222222222222222222222222' as const;
const VAULT = '0x015F10a56e97e02437D294815D8e079e1903E41C' as const;

const params = (irm: string) => ({
  loanToken: '0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392',
  collateralToken: '0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7',
  oracle: '0x0000000000000000000000000000000000000abc',
  irm,
  lltv: 770_000_000_000_000_000n,
});

// Live SEI numbers for the WSEI market (see the rate-projection fixtures).
const CURRENT_SUPPLY_APY_PCT = 0.5556;
const NEXT_SUPPLY_APY_PCT = 0.7712;

vi.mock('../../../lib/hooks/useVault', () => ({
  useVaultInfo: () => ({
    data: {
      name: 'Feather USDC',
      asset: '0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392',
      assetInfo: { symbol: 'USDC', decimals: 6 },
      totalAssets: 10_000_000_000n,
    },
  }),
  useVaultAllocation: () => ({
    data: {
      supplyQueue: [IDLE, WSEI],
      withdrawQueue: [IDLE, WSEI],
      allocations: [
        { marketId: IDLE, supplyAssets: 1_000_000_000n, supplyCap: 0n, availableLiquidity: 0n },
        { marketId: WSEI, supplyAssets: 9_000_000_000n, supplyCap: 50_000_000_000n, availableLiquidity: 5_000_000_000n },
      ],
    },
    isLoading: false,
    error: null,
  }),
  useVaultMarketsFromApi: () => ({
    data: [
      {
        id: IDLE,
        params: params('0x0000000000000000000000000000000000000000'),
        state: { totalSupplyAssets: 0n, totalSupplyShares: 0n, totalBorrowAssets: 0n, totalBorrowShares: 0n, lastUpdate: 0n, fee: 0n },
        loanToken: { symbol: 'USDC', decimals: 6, address: '0x0', name: 'USDC' },
        collateralToken: { symbol: 'IDLE', decimals: 18, address: '0x0000000000000000000000000000000000000000', name: 'Idle' },
        // The regression: an unknown rate is null, never 0.
        supplyAPY: null,
        borrowAPY: null,
        utilization: 0,
        rewards: [],
      },
      {
        id: WSEI,
        params: params('0x6eFA8e3Aa8279eB2fd46b6083A9E52dA72EA56c4'),
        state: { totalSupplyAssets: 40_000_000_000n, totalSupplyShares: 0n, totalBorrowAssets: 9_400_000_000n, totalBorrowShares: 0n, lastUpdate: 0n, fee: 0n },
        loanToken: { symbol: 'USDC', decimals: 6, address: '0x0', name: 'USDC' },
        collateralToken: { symbol: 'WSEI', decimals: 18, address: '0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7', name: 'WSEI' },
        supplyAPY: CURRENT_SUPPLY_APY_PCT / 100,
        borrowAPY: 0.0237,
        utilization: 0.235,
        rewards: [],
      },
    ],
    isLoading: false,
    error: null,
  }),
  useVaultRole: () => ({ isAllocator: true, isOwner: true, isCurator: false, isGuardian: false, isEmergencyRole: false }),
}));

vi.mock('../../../hooks/useVaultPermissions', () => ({
  useVaultPermissions: () => ({ canCurate: true, canManage: true, isAdmin: true, canAllocate: true }),
}));
vi.mock('../../../lib/hooks/useChainGuard', () => ({
  useChainGuard: () => ({ isMismatch: false, requestSwitch: vi.fn() }),
}));
vi.mock('../../../lib/vault/flavor', () => ({ useVaultFlavor: () => ({ data: 'metaMorphoV1' }) }));
vi.mock('../../../lib/hooks/useMoolahSingleton', () => ({
  useIsVaultBlacklisted: () => ({ data: false }),
  useMoolahSingletonState: () => ({ data: null }),
}));
vi.mock('../../../hooks/morpho-sdk/useReallocationSimulation', () => ({
  useReallocationSimulation: () => ({ simulate: vi.fn(), result: null, isSimulating: false, reset: vi.fn() }),
}));
vi.mock('../../../hooks/morpho-sdk/useReallocate', () => ({
  useReallocate: () => ({ reallocate: vi.fn(), isPending: false, isConfirming: false, isSuccess: false, error: null, hash: undefined, reset: vi.fn() }),
}));
vi.mock('../PublicAllocatorPanel', () => ({ PublicAllocatorPanel: () => null }));

// The rate projection: WSEI has a live rate and a projected one.
vi.mock('../../../lib/hooks/useReallocationRates', () => ({
  useReallocationRates: () => ({
    byMarket: new Map([
      [WSEI, {
        marketId: WSEI,
        targetAssets: 0n,
        currentUtilizationPct: 23.5,
        currentBorrowApyPct: 2.3679,
        currentSupplyApyPct: CURRENT_SUPPLY_APY_PCT,
        nextUtilizationPct: 29.3,
        nextBorrowApyPct: 2.6379,
        nextSupplyApyPct: NEXT_SUPPLY_APY_PCT,
        exceedsLiquidity: false,
      }],
    ]),
    isProjecting: false,
    isError: false,
  }),
}));

import { ReallocateTab } from '../ReallocateTab';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const rowFor = (label: string) => {
  // Market labels render as "<COLLATERAL> <LLTV>%" (e.g. "WSEI 77.0%"), and a
  // label can appear more than once, so match on prefix and take the first row.
  const row = screen
    .getAllByText(new RegExp(`^${label}\\b`))
    .map((el) => el.closest('tr'))
    .find((tr): tr is HTMLTableRowElement => tr !== null);
  if (!row) throw new Error(`no row for ${label}`);
  return within(row);
};

beforeEach(() => {
  render(<ReallocateTab chainId={1329} vaultAddress={VAULT} />, { wrapper });
});

describe('V1 Reallocate — APY column', () => {
  it('shows the live supply APY for a market instead of 0.00%', () => {
    expect(rowFor('WSEI').getByText('0.56%')).toBeTruthy();
  });

  it('never renders 0.00% anywhere — the reported symptom', () => {
    // Every market previously showed this because the RPC path hardcoded 0.
    expect(screen.queryAllByText('0.00%')).toHaveLength(0);
  });

  it('renders an em dash for IDLE, which has no rate', () => {
    expect(rowFor('IDLE').getAllByText('—').length).toBeGreaterThan(0);
  });

  it('exposes the blended vault APY, which V1 never had on an RPC chain', () => {
    expect(screen.getByText(/Blended vault APY/)).toBeTruthy();
    expect(screen.getByText(/idle earns 0%/)).toBeTruthy();
  });
});

describe('V1 Reallocate — projected APY after rebalancing', () => {
  it('shows current → projected once a target is edited', () => {
    const row = rowFor('WSEI');
    // Unedited: the live rate only, no arrow.
    expect(row.getByText('0.56%')).toBeTruthy();
    expect(row.queryByText('0.77%')).toBeNull();

    // Edit the WSEI target — this is the reallocation the curator is weighing.
    const input = row.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '8000' } });
    fireEvent.blur(input);

    // Both sides of the move are now visible: the rate today, and the rate
    // this allocation would produce. That second number is what V1 lacked.
    const edited = rowFor('WSEI');
    expect(edited.getByText('0.56%')).toBeTruthy();
    expect(edited.getByText('0.77%')).toBeTruthy();
  });
});
