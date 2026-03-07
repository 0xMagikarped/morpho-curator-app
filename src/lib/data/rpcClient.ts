import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { morphoBlueAbi, metaMorphoV1Abi, metaMorphoFactoryAbi, erc20Abi, oracleAbi } from '../contracts/abis';
import { getChainConfig } from '../../config/chains';
import type {
  MarketParams,
  MarketState,
  MarketId,
  MarketCap,
  PendingCap,
  PendingTimelock,
  PendingGuardian,
  TokenInfo,
  VaultVersion,
  VaultInfoV2,
} from '../../types';

/**
 * Cache of public clients per chain.
 */
const clientCache = new Map<number, PublicClient>();

const ENV_RPC_URLS: Record<number, string | undefined> = {
  1: import.meta.env.VITE_ETH_RPC_URL,
  8453: import.meta.env.VITE_BASE_RPC_URL,
  1329: import.meta.env.VITE_SEI_RPC_URL,
};

export function getPublicClient(chainId: number): PublicClient {
  const existing = clientCache.get(chainId);
  if (existing) return existing;

  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) throw new Error(`Unsupported chain: ${chainId}`);

  const rpcUrl = ENV_RPC_URLS[chainId] || chainConfig.rpcUrls[0];

  const client = createPublicClient({
    batch: { multicall: true },
    transport: http(rpcUrl, {
      batch: true,
      fetchOptions: { cache: 'no-store' },
    }),
  });

  clientCache.set(chainId, client);
  return client;
}

// ============================================================
// Token reads
// ============================================================

export async function fetchTokenInfo(
  chainId: number,
  address: Address,
): Promise<TokenInfo> {
  const client = getPublicClient(chainId);

  const [name, symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: 'name' }),
    client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
  ]);

  return { address, name, symbol, decimals };
}

// ============================================================
// Morpho Blue reads
// ============================================================

export async function fetchMarketState(
  chainId: number,
  marketId: MarketId,
): Promise<MarketState> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) throw new Error(`Unsupported chain: ${chainId}`);

  const client = getPublicClient(chainId);
  const result = await client.readContract({
    address: chainConfig.morphoBlue,
    abi: morphoBlueAbi,
    functionName: 'market',
    args: [marketId],
  });

  return {
    totalSupplyAssets: result[0],
    totalSupplyShares: result[1],
    totalBorrowAssets: result[2],
    totalBorrowShares: result[3],
    lastUpdate: result[4],
    fee: result[5],
  };
}

export async function fetchMarketParams(
  chainId: number,
  marketId: MarketId,
): Promise<MarketParams> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) throw new Error(`Unsupported chain: ${chainId}`);

  const client = getPublicClient(chainId);
  const result = await client.readContract({
    address: chainConfig.morphoBlue,
    abi: morphoBlueAbi,
    functionName: 'idToMarketParams',
    args: [marketId],
  });

  return {
    loanToken: result.loanToken,
    collateralToken: result.collateralToken,
    oracle: result.oracle,
    irm: result.irm,
    lltv: result.lltv,
  };
}

export async function fetchOraclePrice(
  chainId: number,
  oracleAddress: Address,
): Promise<bigint> {
  const client = getPublicClient(chainId);
  return client.readContract({
    address: oracleAddress,
    abi: oracleAbi,
    functionName: 'price',
  });
}

// ============================================================
// Vault reads
// ============================================================

/**
 * Detect vault version using per-chain factory addresses.
 *
 * Strategy:
 * 1. If the chain has a V1 factory, call isMetaMorpho(vault) on it.
 * 2. If the chain has a V2 factory, call isMetaMorpho(vault) on it.
 * 3. If no factory addresses are known (e.g., SEI), fall back to
 *    probing V2-specific function selectors (sentinel()).
 * 4. Default to V1 if all checks fail.
 */
async function detectVaultVersion(
  client: PublicClient,
  chainId: number,
  vaultAddress: Address,
): Promise<VaultVersion> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) return 'v1';

  // Try V2 factory first — if it recognizes this vault, it's V2
  if (chainConfig.vaultFactories.v2) {
    try {
      const isV2 = await client.readContract({
        address: chainConfig.vaultFactories.v2,
        abi: metaMorphoFactoryAbi,
        functionName: 'isMetaMorpho',
        args: [vaultAddress],
      });
      if (isV2) return 'v2';
    } catch {
      // Factory call failed — factory may not have isMetaMorpho, continue
    }
  }

  // Try V1 factory — if it recognizes this vault, it's V1
  if (chainConfig.vaultFactories.v1) {
    try {
      const isV1 = await client.readContract({
        address: chainConfig.vaultFactories.v1,
        abi: metaMorphoFactoryAbi,
        functionName: 'isMetaMorpho',
        args: [vaultAddress],
      });
      if (isV1) return 'v1';
    } catch {
      // Factory call failed, continue to fallback
    }
  }

  // Fallback: No factory addresses known (e.g., SEI).
  // Probe for V2-specific function: sentinel() selector = 0x2a26417d
  // If it returns without reverting, it's V2.
  try {
    await client.call({
      to: vaultAddress,
      data: '0x2a26417d', // sentinel()
    });
    return 'v2';
  } catch {
    // sentinel() reverted — this is a V1 vault
    return 'v1';
  }
}

export async function fetchVaultBasicInfo(chainId: number, vaultAddress: Address) {
  const client = getPublicClient(chainId);

  // Fetch fields common to both V1 and V2
  const [name, symbol, asset, morpho, owner, curator, timelock, fee, totalAssets, totalSupply, lastTotalAssets, feeRecipient] =
    await Promise.all([
      client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'name' }),
      client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'symbol' }),
      client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'asset' }),
      client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'MORPHO' }),
      client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'owner' }),
      client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'curator' }),
      client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'timelock' }),
      client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'fee' }),
      client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'totalAssets' }),
      client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'totalSupply' }),
      client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'lastTotalAssets' }),
      client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'feeRecipient' }),
    ]);

  const version = await detectVaultVersion(client, chainId, vaultAddress);

  const base = {
    address: vaultAddress,
    chainId,
    name,
    symbol,
    asset: asset as Address,
    morphoBlue: morpho,
    owner,
    curator,
    allocators: [] as Address[], // Populated separately — no on-chain enumeration
    timelock,
    fee,
    feeRecipient,
    totalAssets,
    totalSupply,
    lastTotalAssets,
  };

  if (version === 'v2') {
    // V2-specific fields (sentinel, managementFee, adapters, gates) require V2 ABI reads.
    // Currently returning stubs — V2 data will show placeholder values until implemented.
    return {
      ...base,
      version: 'v2' as const,
      sentinel: '0x0000000000000000000000000000000000000000' as Address,
      managementFee: 0n,
      adapters: [],
      gates: {
        receiveShares: '0x0000000000000000000000000000000000000000' as Address,
        sendShares: '0x0000000000000000000000000000000000000000' as Address,
        receiveAssets: '0x0000000000000000000000000000000000000000' as Address,
        sendAssets: '0x0000000000000000000000000000000000000000' as Address,
      },
    } satisfies VaultInfoV2;
  }

  // V1: fetch guardian
  let guardian: Address = '0x0000000000000000000000000000000000000000';
  try {
    guardian = await client.readContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'guardian',
    });
  } catch {
    // guardian() failed — vault may use a non-standard ABI
  }

  return {
    ...base,
    version: 'v1' as const,
    guardian,
  };
}

/**
 * Fetch supply/withdraw queues for a V1 vault.
 * V2 vaults do NOT have queues — returns empty arrays for V2.
 */
export async function fetchVaultQueues(chainId: number, vaultAddress: Address, version: VaultVersion = 'v1') {
  // V2 has no supply/withdraw queues — allocation is per-adapter
  if (version === 'v2') {
    return { supplyQueue: [] as MarketId[], withdrawQueue: [] as MarketId[] };
  }

  const client = getPublicClient(chainId);

  // Read both lengths in parallel
  const [supplyQueueLength, withdrawQueueLength] = await Promise.all([
    client.readContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'supplyQueueLength',
    }),
    client.readContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'withdrawQueueLength',
    }),
  ]);

  // Read all queue entries in parallel (viem batches these via multicall)
  const supplyPromises = Array.from({ length: Number(supplyQueueLength) }, (_, i) =>
    client.readContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'supplyQueue',
      args: [BigInt(i)],
    }),
  );

  const withdrawPromises = Array.from({ length: Number(withdrawQueueLength) }, (_, i) =>
    client.readContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'withdrawQueue',
      args: [BigInt(i)],
    }),
  );

  const [supplyQueue, withdrawQueue] = await Promise.all([
    Promise.all(supplyPromises),
    Promise.all(withdrawPromises),
  ]);

  return {
    supplyQueue: supplyQueue as MarketId[],
    withdrawQueue: withdrawQueue as MarketId[],
  };
}

export async function fetchMarketCap(
  chainId: number,
  vaultAddress: Address,
  marketId: MarketId,
): Promise<MarketCap> {
  const client = getPublicClient(chainId);
  const result = await client.readContract({
    address: vaultAddress,
    abi: metaMorphoV1Abi,
    functionName: 'config',
    args: [marketId],
  });

  return {
    marketId,
    cap: result[0],
    enabled: result[1],
    removableAt: result[2],
  };
}

export async function fetchPendingCap(
  chainId: number,
  vaultAddress: Address,
  marketId: MarketId,
): Promise<PendingCap | null> {
  const client = getPublicClient(chainId);
  const result = await client.readContract({
    address: vaultAddress,
    abi: metaMorphoV1Abi,
    functionName: 'pendingCap',
    args: [marketId],
  });

  if (result[1] === 0n) return null;
  return { marketId, value: result[0], validAt: result[1] };
}

export async function fetchPendingTimelock(
  chainId: number,
  vaultAddress: Address,
): Promise<PendingTimelock | null> {
  const client = getPublicClient(chainId);
  const result = await client.readContract({
    address: vaultAddress,
    abi: metaMorphoV1Abi,
    functionName: 'pendingTimelock',
  });

  if (result[1] === 0n) return null;
  return { value: result[0], validAt: result[1] };
}

export async function fetchPendingGuardian(
  chainId: number,
  vaultAddress: Address,
): Promise<PendingGuardian | null> {
  const client = getPublicClient(chainId);
  const result = await client.readContract({
    address: vaultAddress,
    abi: metaMorphoV1Abi,
    functionName: 'pendingGuardian',
  });

  if (result[1] === 0n) return null;
  return { value: result[0], validAt: result[1] };
}

export async function checkIsAllocator(
  chainId: number,
  vaultAddress: Address,
  userAddress: Address,
): Promise<boolean> {
  const client = getPublicClient(chainId);
  return client.readContract({
    address: vaultAddress,
    abi: metaMorphoV1Abi,
    functionName: 'isAllocator',
    args: [userAddress],
  });
}

/**
 * Fetch vault position in a specific Morpho Blue market.
 */
export async function fetchVaultMarketPosition(
  chainId: number,
  vaultAddress: Address,
  marketId: MarketId,
) {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) throw new Error(`Unsupported chain: ${chainId}`);

  const client = getPublicClient(chainId);
  const result = await client.readContract({
    address: chainConfig.morphoBlue,
    abi: morphoBlueAbi,
    functionName: 'position',
    args: [marketId, vaultAddress],
  });

  return {
    supplyShares: result[0],
    borrowShares: result[1],
    collateral: result[2],
  };
}

/**
 * Verify a contract exists at an address (eth_getCode).
 */
export async function verifyContractExists(
  chainId: number,
  address: Address,
): Promise<boolean> {
  const client = getPublicClient(chainId);
  const code = await client.getCode({ address });
  return code !== undefined && code !== '0x';
}
