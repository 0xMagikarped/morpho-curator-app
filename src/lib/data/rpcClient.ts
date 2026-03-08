import { createPublicClient, http, type Address, type PublicClient, type Chain, defineChain } from 'viem';
import { mainnet, base } from 'viem/chains';
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

const sei = defineChain({
  id: 1329,
  name: 'SEI',
  nativeCurrency: { name: 'SEI', symbol: 'SEI', decimals: 18 },
  rpcUrls: { default: { http: ['https://sei-evm-rpc.publicnode.com'] } },
});

const VIEM_CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  1329: sei,
};

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
    chain: VIEM_CHAINS[chainId],
    transport: http(rpcUrl, {
      fetchOptions: { cache: 'no-store' },
    }),
    batch: {
      multicall: { batchSize: 1024, wait: 10 },
    },
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

/** ABI fragment for V2 vaults that use lowercase morpho() instead of MORPHO() */
const morphoLowercaseAbi = [
  {
    inputs: [],
    name: 'morpho',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'sentinel',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export async function fetchVaultBasicInfo(chainId: number, vaultAddress: Address) {
  const client = getPublicClient(chainId);

  // Detect version first — this determines which ABI calls to make
  const version = await detectVaultVersion(client, chainId, vaultAddress);

  // Use multicall with allowFailure to handle V1/V2 ABI differences.
  // ERC-4626 fields (name, symbol, asset, totalAssets, totalSupply) are common.
  // MetaMorpho fields (owner, curator, timelock, fee, feeRecipient, lastTotalAssets) are common.
  // MORPHO() is V1-only; morpho() is V2. guardian() is V1-only; sentinel() is V2.
  const results = await client.multicall({
    contracts: [
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'name' },             // 0
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'symbol' },            // 1
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'asset' },             // 2
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'MORPHO' },            // 3 (V1)
      { address: vaultAddress, abi: morphoLowercaseAbi, functionName: 'morpho' },         // 4 (V2)
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'owner' },             // 5
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'curator' },           // 6
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'timelock' },          // 7
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'fee' },               // 8
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'totalAssets' },       // 9
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'totalSupply' },       // 10
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'lastTotalAssets' },   // 11
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'feeRecipient' },      // 12
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'guardian' },          // 13 (V1)
      { address: vaultAddress, abi: morphoLowercaseAbi, functionName: 'sentinel' },       // 14 (V2)
    ],
    allowFailure: true,
  });

  const ZERO = '0x0000000000000000000000000000000000000000' as Address;

  // Extract results with safe fallbacks
  const name = results[0].status === 'success' ? results[0].result : '';
  const symbol = results[1].status === 'success' ? results[1].result : '';
  const asset = results[2].status === 'success' ? results[2].result : ZERO;

  // V1 uses MORPHO() (uppercase), V2 uses morpho() (lowercase)
  const morphoV1 = results[3].status === 'success' ? results[3].result : null;
  const morphoV2 = results[4].status === 'success' ? results[4].result : null;
  const morphoBlue = (morphoV1 ?? morphoV2 ?? getChainConfig(chainId)?.morphoBlue ?? ZERO) as Address;

  // Validate that we got at least a name — otherwise this isn't a valid vault
  if (!name && results[0].status === 'failure') {
    throw new Error(`Contract at ${vaultAddress} is not a valid MetaMorpho vault`);
  }

  const owner = results[5].status === 'success' ? results[5].result : ZERO;
  const curator = results[6].status === 'success' ? results[6].result : ZERO;
  const timelock = results[7].status === 'success' ? results[7].result : 0n;
  const fee = results[8].status === 'success' ? results[8].result : 0n;
  const totalAssets = results[9].status === 'success' ? results[9].result : 0n;
  const totalSupply = results[10].status === 'success' ? results[10].result : 0n;
  const lastTotalAssets = results[11].status === 'success' ? results[11].result : 0n;
  const feeRecipient = results[12].status === 'success' ? results[12].result : ZERO;

  const base = {
    address: vaultAddress,
    chainId,
    name,
    symbol,
    asset: asset as Address,
    morphoBlue,
    owner,
    curator,
    allocators: [] as Address[],
    timelock,
    fee,
    feeRecipient,
    totalAssets,
    totalSupply,
    lastTotalAssets,
  };

  if (version === 'v2') {
    const sentinel = results[14].status === 'success' ? results[14].result as Address : ZERO;
    return {
      ...base,
      version: 'v2' as const,
      sentinel,
      managementFee: 0n,
      adapters: [],
      gates: {
        receiveShares: ZERO,
        sendShares: ZERO,
        receiveAssets: ZERO,
        sendAssets: ZERO,
      },
    } satisfies VaultInfoV2;
  }

  const guardian = results[13].status === 'success' ? results[13].result as Address : ZERO;
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
