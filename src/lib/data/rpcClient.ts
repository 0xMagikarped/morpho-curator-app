import { createPublicClient, http, fallback, type Address, type PublicClient, type Chain, defineChain } from 'viem';
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
  AdapterMarketPosition,
} from '../../types';

const sei = defineChain({
  id: 1329,
  name: 'SEI',
  nativeCurrency: { name: 'SEI', symbol: 'SEI', decimals: 18 },
  rpcUrls: { default: { http: ['https://sei-evm-rpc.publicnode.com'] } },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
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

// Environment-configured RPCs (e.g. Infura) take priority over hardcoded public RPCs.
// Set VITE_ETH_RPC_URL, VITE_BASE_RPC_URL, VITE_SEI_RPC_URL in .env.local.
const ENV_RPC_URLS: Record<number, string | undefined> = {
  1: import.meta.env.VITE_ETH_RPC_URL || undefined,
  8453: import.meta.env.VITE_BASE_RPC_URL || undefined,
  1329: import.meta.env.VITE_SEI_RPC_URL || undefined,
};

export function getPublicClient(chainId: number): PublicClient {
  const existing = clientCache.get(chainId);
  if (existing) return existing;

  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) throw new Error(`Unsupported chain: ${chainId}`);

  // Build transport with fallback across all configured RPCs
  const envUrl = ENV_RPC_URLS[chainId];
  const urls = envUrl ? [envUrl, ...chainConfig.rpcUrls] : chainConfig.rpcUrls;
  const transport = urls.length > 1
    ? fallback(urls.map(url => http(url, { fetchOptions: { cache: 'no-store' } })))
    : http(urls[0], { fetchOptions: { cache: 'no-store' } });

  const client = createPublicClient({
    chain: VIEM_CHAINS[chainId],
    transport,
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
  const ZERO = '0x0000000000000000000000000000000000000000' as Address;
  if (!address || address === ZERO) {
    throw new Error(`Cannot fetch token info for zero address`);
  }

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

/** ABI for V2 factory — uses isVaultV2() not isMetaMorpho() */
const vaultV2FactoryAbi = [
  {
    inputs: [{ name: '', type: 'address' }],
    name: 'isVaultV2',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/** ABI fragment for reading V2 vault view functions */
const vaultV2Abi = [
  { inputs: [], name: 'curator', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'owner', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'adaptersLength', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: '', type: 'uint256' }], name: 'adapters', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: '', type: 'address' }], name: 'isAdapter', outputs: [{ name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: '', type: 'address' }], name: 'isSentinel', outputs: [{ name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: '', type: 'address' }], name: 'isAllocator', outputs: [{ name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'performanceFee', outputs: [{ name: '', type: 'uint96' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'managementFee', outputs: [{ name: '', type: 'uint96' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'performanceFeeRecipient', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'managementFeeRecipient', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'receiveSharesGate', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'sendSharesGate', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'receiveAssetsGate', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'sendAssetsGate', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'liquidityAdapter', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'name', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'asset', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalAssets', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalSupply', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

/**
 * Detect vault version using per-chain factory addresses.
 *
 * Strategy:
 * 1. If the chain has a V2 factory, call isVaultV2(vault) on it.
 * 2. If the chain has a V1 factory, call isMetaMorpho(vault) on it.
 * 3. Fallback: probe adaptersLength() — a V2-only function.
 * 4. Default to V1 if all checks fail.
 */
async function detectVaultVersion(
  client: PublicClient,
  chainId: number,
  vaultAddress: Address,
): Promise<VaultVersion> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) return 'v1';

  // Try V2 factory first — uses isVaultV2() (NOT isMetaMorpho)
  if (chainConfig.vaultFactories.v2) {
    try {
      const isV2 = await client.readContract({
        address: chainConfig.vaultFactories.v2,
        abi: vaultV2FactoryAbi,
        functionName: 'isVaultV2',
        args: [vaultAddress],
      });
      if (isV2) return 'v2';
    } catch {
      // Factory call failed, continue
    }
  }

  // Try V1 factory — uses isMetaMorpho()
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

  // Fallback: probe adaptersLength() — V2-only function
  try {
    await client.readContract({
      address: vaultAddress,
      abi: vaultV2Abi,
      functionName: 'adaptersLength',
    });
    return 'v2';
  } catch {
    return 'v1';
  }
}

/** Safe readContract that returns null on failure instead of throwing */
async function safeRead<T>(
  client: PublicClient,
  params: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] },
): Promise<T | null> {
  try {
    return await client.readContract(params as any) as T;
  } catch {
    return null;
  }
}

export async function fetchVaultBasicInfo(chainId: number, vaultAddress: Address) {
  const client = getPublicClient(chainId);
  const version = await detectVaultVersion(client, chainId, vaultAddress);
  const ZERO = '0x0000000000000000000000000000000000000000' as Address;

  if (version === 'v2') {
    return fetchV2VaultInfo(client, chainId, vaultAddress, ZERO);
  }
  return fetchV1VaultInfo(client, chainId, vaultAddress, ZERO);
}

/** Fetch V1 MetaMorpho vault info */
async function fetchV1VaultInfo(client: PublicClient, chainId: number, vaultAddress: Address, ZERO: Address) {
  const [
    name, symbol, asset, morpho, owner, curator, timelock, fee,
    totalAssets, totalSupply, lastTotalAssets, feeRecipient, guardian,
  ] = await Promise.all([
    safeRead<string>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'name' }),
    safeRead<string>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'symbol' }),
    safeRead<Address>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'asset' }),
    safeRead<Address>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'MORPHO' }),
    safeRead<Address>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'owner' }),
    safeRead<Address>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'curator' }),
    safeRead<bigint>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'timelock' }),
    safeRead<bigint>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'fee' }),
    safeRead<bigint>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'totalAssets' }),
    safeRead<bigint>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'totalSupply' }),
    safeRead<bigint>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'lastTotalAssets' }),
    safeRead<Address>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'feeRecipient' }),
    safeRead<Address>(client, { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'guardian' }),
  ]);

  if (name === null || name === undefined) {
    throw new Error(`Contract at ${vaultAddress} is not a MetaMorpho vault (name() failed)`);
  }
  if (!asset || asset === ZERO) {
    throw new Error(`Contract at ${vaultAddress} returned zero asset address — RPC may be unreliable`);
  }

  return {
    address: vaultAddress,
    chainId,
    name: name || 'Unnamed Vault',
    symbol: symbol ?? '',
    asset,
    morphoBlue: morpho ?? getChainConfig(chainId)?.morphoBlue ?? ZERO,
    owner: owner ?? ZERO,
    curator: curator ?? ZERO,
    allocators: [] as Address[],
    timelock: timelock ?? 0n,
    fee: fee ?? 0n,
    feeRecipient: feeRecipient ?? ZERO,
    totalAssets: totalAssets ?? 0n,
    totalSupply: totalSupply ?? 0n,
    lastTotalAssets: lastTotalAssets ?? 0n,
    version: 'v1' as const,
    guardian: guardian ?? ZERO,
  };
}

/** Fetch V2 vault info — completely different interface from V1 */
async function fetchV2VaultInfo(client: PublicClient, chainId: number, vaultAddress: Address, ZERO: Address) {
  const [
    name, symbol, asset, owner, curator,
    totalAssets, totalSupply,
    performanceFee, managementFee,
    performanceFeeRecipient, managementFeeRecipient,
    adaptersLength,
    receiveSharesGate, sendSharesGate, receiveAssetsGate, sendAssetsGate,
  ] = await Promise.all([
    safeRead<string>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'name' }),
    safeRead<string>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'symbol' }),
    safeRead<Address>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'asset' }),
    safeRead<Address>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'owner' }),
    safeRead<Address>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'curator' }),
    safeRead<bigint>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'totalAssets' }),
    safeRead<bigint>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'totalSupply' }),
    safeRead<bigint>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'performanceFee' }),
    safeRead<bigint>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'managementFee' }),
    safeRead<Address>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'performanceFeeRecipient' }),
    safeRead<Address>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'managementFeeRecipient' }),
    safeRead<bigint>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'adaptersLength' }),
    safeRead<Address>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'receiveSharesGate' }),
    safeRead<Address>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'sendSharesGate' }),
    safeRead<Address>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'receiveAssetsGate' }),
    safeRead<Address>(client, { address: vaultAddress, abi: vaultV2Abi, functionName: 'sendAssetsGate' }),
  ]);

  if (name === null || name === undefined) {
    throw new Error(`Contract at ${vaultAddress} is not a Morpho V2 vault (name() failed)`);
  }
  if (!asset || asset === ZERO) {
    throw new Error(`Contract at ${vaultAddress} returned zero asset address — RPC may be unreliable`);
  }

  return {
    address: vaultAddress,
    chainId,
    name: name || 'Unnamed Vault',
    symbol: symbol ?? '',
    asset,
    morphoBlue: getChainConfig(chainId)?.morphoBlue ?? ZERO,
    owner: owner ?? ZERO,
    curator: curator ?? ZERO,
    allocators: [] as Address[],
    // V2 has per-function timelocks, no single timelock value
    timelock: 0n,
    // V2 uses performanceFee (not fee)
    fee: performanceFee ?? 0n,
    feeRecipient: performanceFeeRecipient ?? ZERO,
    totalAssets: totalAssets ?? 0n,
    totalSupply: totalSupply ?? 0n,
    lastTotalAssets: 0n, // V2 doesn't have lastTotalAssets
    version: 'v2' as const,
    // V2-specific: sentinel is checked per-address, not a single address
    sentinel: ZERO,
    managementFee: managementFee ?? 0n,
    managementFeeRecipient: managementFeeRecipient ?? ZERO,
    adapters: [],
    adaptersLength: Number(adaptersLength ?? 0n),
    gates: {
      receiveShares: receiveSharesGate ?? ZERO,
      sendShares: sendSharesGate ?? ZERO,
      receiveAssets: receiveAssetsGate ?? ZERO,
      sendAssets: sendAssetsGate ?? ZERO,
    },
  } satisfies VaultInfoV2;
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

/** ABI fragment for reading adapter contracts */
const adapterAbi = [
  { inputs: [], name: 'realAssets', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'name', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'VAULT', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MORPHO', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  // Market V1 Adapter per-market reads
  { inputs: [], name: 'marketIdsLength', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'index', type: 'uint256' }], name: 'marketIds', outputs: [{ type: 'bytes32' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'expectedSupplyAssets', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'supplyShares', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

export interface V2AdapterData {
  address: Address;
  realAssets: bigint;
  name: string | null;
  /** For vault adapters: the underlying V1 vault address */
  underlyingVault: Address | null;
  /** For market adapters: the Morpho Blue address */
  morphoBlue: Address | null;
  type: 'vault-v1' | 'market-v1' | 'unknown';
}

/**
 * Fetch all adapters for a V2 vault, including their realAssets and type.
 */
export async function fetchV2Adapters(chainId: number, vaultAddress: Address): Promise<V2AdapterData[]> {
  const client = getPublicClient(chainId);

  // Read adaptersLength
  const length = await safeRead<bigint>(client, {
    address: vaultAddress,
    abi: vaultV2Abi,
    functionName: 'adaptersLength',
  });

  if (!length || length === 0n) return [];

  // Read all adapter addresses
  const adapterAddresses = await Promise.all(
    Array.from({ length: Number(length) }, (_, i) =>
      safeRead<Address>(client, {
        address: vaultAddress,
        abi: vaultV2Abi,
        functionName: 'adapters',
        args: [BigInt(i)],
      }),
    ),
  );

  // For each adapter, read realAssets + probe type (vault adapter vs market adapter)
  const results = await Promise.all(
    adapterAddresses
      .filter((addr): addr is Address => addr !== null)
      .map(async (addr) => {
        const [realAssets, name, underlyingVault, morpho] = await Promise.all([
          safeRead<bigint>(client, { address: addr, abi: adapterAbi, functionName: 'realAssets' }),
          safeRead<string>(client, { address: addr, abi: adapterAbi, functionName: 'name' }),
          safeRead<Address>(client, { address: addr, abi: adapterAbi, functionName: 'VAULT' }),
          safeRead<Address>(client, { address: addr, abi: adapterAbi, functionName: 'MORPHO' }),
        ]);

        let type: V2AdapterData['type'] = 'unknown';
        if (underlyingVault) type = 'vault-v1';
        else if (morpho) type = 'market-v1';

        return {
          address: addr,
          realAssets: realAssets ?? 0n,
          name,
          underlyingVault: underlyingVault ?? null,
          morphoBlue: morpho ?? null,
          type,
        };
      }),
  );

  return results;
}

/**
 * Read per-market positions from a Market V1 adapter.
 * Reads marketIdsLength → marketIds(i) → expectedSupplyAssets + market params + state.
 */
export async function fetchAdapterMarketPositions(
  chainId: number,
  adapterAddress: Address,
  morphoBlueAddress: Address,
): Promise<AdapterMarketPosition[]> {
  const client = getPublicClient(chainId);

  const count = await safeRead<bigint>(client, {
    address: adapterAddress,
    abi: adapterAbi,
    functionName: 'marketIdsLength',
  });

  if (!count || count === 0n) return [];

  // Read all market IDs
  const marketIds = await Promise.all(
    Array.from({ length: Number(count) }, (_, i) =>
      safeRead<`0x${string}`>(client, {
        address: adapterAddress,
        abi: adapterAbi,
        functionName: 'marketIds',
        args: [BigInt(i)],
      }),
    ),
  );

  const validIds = marketIds.filter((id): id is `0x${string}` => id !== null);

  // For each market, read adapter position + Morpho Blue params + state + tokens
  const positions = await Promise.allSettled(
    validIds.map(async (marketId): Promise<AdapterMarketPosition> => {
      // Adapter position reads
      const [expectedAssets, shares] = await Promise.all([
        safeRead<bigint>(client, {
          address: adapterAddress,
          abi: adapterAbi,
          functionName: 'expectedSupplyAssets',
          args: [marketId],
        }),
        safeRead<bigint>(client, {
          address: adapterAddress,
          abi: adapterAbi,
          functionName: 'supplyShares',
          args: [marketId],
        }),
      ]);

      // Market params from Morpho Blue
      const rawParams = await safeRead<readonly [Address, Address, Address, Address, bigint]>(client, {
        address: morphoBlueAddress,
        abi: morphoBlueAbi,
        functionName: 'idToMarketParams',
        args: [marketId],
      });

      // Market state from Morpho Blue
      const rawState = await safeRead<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>(client, {
        address: morphoBlueAddress,
        abi: morphoBlueAbi,
        functionName: 'market',
        args: [marketId],
      });

      const params: MarketParams | null = rawParams ? {
        loanToken: rawParams[0],
        collateralToken: rawParams[1],
        oracle: rawParams[2],
        irm: rawParams[3],
        lltv: rawParams[4],
      } : null;

      const marketState: MarketState | null = rawState ? {
        totalSupplyAssets: rawState[0],
        totalSupplyShares: rawState[1],
        totalBorrowAssets: rawState[2],
        totalBorrowShares: rawState[3],
        lastUpdate: rawState[4],
        fee: rawState[5],
      } : null;

      // Compute supply assets — prefer expectedSupplyAssets, fallback to share conversion
      let supplyAssets = expectedAssets ?? 0n;
      if (!expectedAssets && shares && shares > 0n && marketState && marketState.totalSupplyShares > 0n) {
        supplyAssets = (shares * marketState.totalSupplyAssets) / marketState.totalSupplyShares;
      }

      // Token info (best effort)
      let loanToken: TokenInfo | null = null;
      let collateralToken: TokenInfo | null = null;
      if (params) {
        [loanToken, collateralToken] = await Promise.all([
          fetchTokenInfo(chainId, params.loanToken).catch(() => null),
          fetchTokenInfo(chainId, params.collateralToken).catch(() => null),
        ]);
      }

      return {
        marketId: marketId as MarketId,
        supplyAssets,
        supplyShares: shares ?? 0n,
        params,
        marketState,
        loanToken,
        collateralToken,
      };
    }),
  );

  return positions
    .filter((r): r is PromiseFulfilledResult<AdapterMarketPosition> => r.status === 'fulfilled')
    .map((r) => r.value);
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
  try {
    const result = await client.readContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'pendingTimelock',
    });
    if (result[1] === 0n) return null;
    return { value: result[0], validAt: result[1] };
  } catch {
    // V2 vaults don't have pendingTimelock
    return null;
  }
}

export async function fetchPendingGuardian(
  chainId: number,
  vaultAddress: Address,
): Promise<PendingGuardian | null> {
  const client = getPublicClient(chainId);
  try {
    const result = await client.readContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'pendingGuardian',
    });
    if (result[1] === 0n) return null;
    return { value: result[0], validAt: result[1] };
  } catch {
    // V2 vaults don't have pendingGuardian
    return null;
  }
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
