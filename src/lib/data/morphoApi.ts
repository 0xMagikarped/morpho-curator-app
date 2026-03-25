import type { Address } from 'viem';
import type { MarketId, AllocationState, MarketInfo, TokenInfo, VaultInfo } from '../../types';

const MORPHO_API_URL = 'https://api.morpho.org/graphql';

/** Chains supported by the Morpho GraphQL API */
const API_SUPPORTED_CHAINS = new Set([1, 8453]);

export function isApiSupportedChain(chainId: number): boolean {
  return API_SUPPORTED_CHAINS.has(chainId);
}

// ============================================================
// GraphQL query
// ============================================================

const VAULT_QUERY = `
  query GetVault($address: String!, $chainId: Int!) {
    vaultByAddress(address: $address, chainId: $chainId) {
      address
      name
      symbol
      asset { address symbol decimals }
      chain { id }
      state {
        totalAssets
        totalSupply
        lastTotalAssets
        fee
        timelock
        owner
        curator
        guardian
        feeRecipient
        apy
        netApy
        allocation {
          market {
            uniqueKey
            loanAsset { address symbol decimals }
            collateralAsset { address symbol decimals }
            lltv
            oracleAddress
            irmAddress
            state {
              supplyAssets
              borrowAssets
              liquidityAssets
              utilization
              supplyApy
              borrowApy
            }
          }
          supplyAssets
          supplyShares
          supplyCap
          supplyQueueIndex
          withdrawQueueIndex
          pendingSupplyCap
          pendingSupplyCapValidAt
          removableAt
        }
      }
    }
  }
`;

// ============================================================
// Types for API response
// ============================================================

interface ApiAsset {
  address: string;
  symbol: string;
  decimals: number;
}

interface ApiMarketState {
  supplyAssets: string;
  borrowAssets: string;
  liquidityAssets: string;
  utilization: number;
  supplyApy: number;
  borrowApy: number;
}

interface ApiMarket {
  uniqueKey: string;
  loanAsset: ApiAsset;
  collateralAsset: ApiAsset | null;
  lltv: string;
  oracleAddress: string;
  irmAddress: string;
  state: ApiMarketState;
}

interface ApiAllocation {
  market: ApiMarket;
  supplyAssets: string;
  supplyShares: string;
  supplyCap: string;
  supplyQueueIndex: number | null;
  withdrawQueueIndex: number | null;
  pendingSupplyCap: string | null;
  pendingSupplyCapValidAt: number | null;
  removableAt: number | null;
}

interface ApiVaultState {
  totalAssets: string;
  totalSupply: string;
  lastTotalAssets: string;
  fee: number;
  timelock: number;
  owner: string;
  curator: string;
  guardian: string;
  feeRecipient: string;
  apy: number;
  netApy: number;
  allocation: ApiAllocation[];
}

interface ApiVault {
  address: string;
  name: string;
  symbol: string;
  asset: ApiAsset;
  chain: { id: number };
  state: ApiVaultState;
}

// ============================================================
// Fetch function
// ============================================================

async function queryApi<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(MORPHO_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Morpho API returned ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`Morpho API error: ${json.errors[0].message}`);
  }

  return json.data;
}

// ============================================================
// Public interface — returns same shapes as rpcClient
// ============================================================

export interface ApiVaultData {
  info: VaultInfo & { assetInfo: TokenInfo };
  allocation: {
    supplyQueue: MarketId[];
    withdrawQueue: MarketId[];
    allocations: AllocationState[];
    totalAllocated: bigint;
  };
  markets: MarketInfo[];
}

export async function fetchVaultFromApi(
  chainId: number,
  vaultAddress: Address,
): Promise<ApiVaultData> {
  const data = await queryApi<{ vaultByAddress: ApiVault | null }>(
    VAULT_QUERY,
    { address: vaultAddress, chainId },
  );

  const vault = data.vaultByAddress;
  if (!vault) {
    throw new Error(`Vault ${vaultAddress} not found on chain ${chainId}`);
  }

  const s = vault.state;

  // Parse asset info
  const assetInfo: TokenInfo = {
    address: vault.asset.address as Address,
    name: vault.asset.symbol, // API doesn't return full name, use symbol
    symbol: vault.asset.symbol,
    decimals: vault.asset.decimals,
  };

  // Build allocation arrays sorted by queue index
  const sortedBySupply = [...s.allocation]
    .filter((a) => a.supplyQueueIndex !== null)
    .sort((a, b) => (a.supplyQueueIndex ?? 0) - (b.supplyQueueIndex ?? 0));

  const sortedByWithdraw = [...s.allocation]
    .filter((a) => a.withdrawQueueIndex !== null)
    .sort((a, b) => (a.withdrawQueueIndex ?? 0) - (b.withdrawQueueIndex ?? 0));

  const supplyQueue = sortedBySupply.map((a) => a.market.uniqueKey as MarketId);
  const withdrawQueue = sortedByWithdraw.map((a) => a.market.uniqueKey as MarketId);

  const allocations: AllocationState[] = s.allocation.map((a) => ({
    marketId: a.market.uniqueKey as MarketId,
    supplyAssets: BigInt(a.supplyAssets),
    supplyCap: BigInt(a.supplyCap),
    availableLiquidity: BigInt(a.market.state.liquidityAssets),
  }));

  const totalAllocated = allocations.reduce((sum, a) => sum + a.supplyAssets, 0n);

  // Build market info
  const markets: MarketInfo[] = s.allocation.map((a) => {
    const m = a.market;
    const collateralToken: TokenInfo = m.collateralAsset
      ? { address: m.collateralAsset.address as Address, name: m.collateralAsset.symbol, symbol: m.collateralAsset.symbol, decimals: m.collateralAsset.decimals }
      : { address: '0x0000000000000000000000000000000000000000' as Address, name: 'None', symbol: 'NONE', decimals: 0 };
    const loanToken: TokenInfo = {
      address: m.loanAsset.address as Address,
      name: m.loanAsset.symbol,
      symbol: m.loanAsset.symbol,
      decimals: m.loanAsset.decimals,
    };

    return {
      id: m.uniqueKey as MarketId,
      params: {
        loanToken: m.loanAsset.address as Address,
        collateralToken: (m.collateralAsset?.address ?? '0x0000000000000000000000000000000000000000') as Address,
        oracle: m.oracleAddress as Address,
        irm: m.irmAddress as Address,
        lltv: BigInt(m.lltv),
      },
      state: {
        totalSupplyAssets: BigInt(m.state.supplyAssets),
        totalSupplyShares: 0n,
        totalBorrowAssets: BigInt(m.state.borrowAssets),
        totalBorrowShares: 0n,
        lastUpdate: 0n,
        fee: 0n,
      },
      loanToken,
      collateralToken,
      supplyAPY: m.state.supplyApy,
      borrowAPY: m.state.borrowApy,
      utilization: m.state.utilization,
    };
  });

  // Fee from API is a float (0.0 - 1.0), convert to WAD (1e18)
  const feeWad = BigInt(Math.round(s.fee * 1e18));

  return {
    info: {
      address: vaultAddress,
      chainId,
      name: vault.name,
      symbol: vault.symbol,
      asset: vault.asset.address as Address,
      morphoBlue: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as Address,
      allocators: [] as Address[],
      owner: s.owner as Address,
      pendingOwner: '0x0000000000000000000000000000000000000000' as Address,
      curator: s.curator as Address,
      timelock: BigInt(s.timelock),
      fee: feeWad,
      feeRecipient: s.feeRecipient as Address,
      totalAssets: BigInt(s.totalAssets),
      totalSupply: BigInt(s.totalSupply),
      lastTotalAssets: BigInt(s.lastTotalAssets),
      version: 'v1',
      guardian: s.guardian as Address,
      assetInfo,
    },
    allocation: {
      supplyQueue,
      withdrawQueue,
      allocations,
      totalAllocated,
    },
    markets,
  };
}
