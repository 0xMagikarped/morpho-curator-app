/**
 * V2 adapter detection, ID computation, and on-chain validation utilities.
 */
import type { Address, PublicClient } from 'viem';
import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { v1VaultAdapterAbi, v1MarketAdapterAbi } from '../contracts/metaMorphoV2Abi';
import { marketV1AdapterV2FactoryAbi, vaultV1AdapterFactoryAbi } from '../contracts/marketAdapterFactoryAbi';
import { getChainConfig } from '../../config/chains';

// ============================================================
// Adapter Type Detection
// ============================================================

export type AdapterType = 'vault-v1' | 'market-v1' | 'unknown';

export interface AdapterDetectionResult {
  type: AdapterType;
  /** For vault-v1: target V1 vault address */
  targetVault: Address | null;
  /** For vault-v1: target V1 vault name */
  targetVaultName: string | null;
  /** For market-v1: Morpho Blue address */
  morphoBlue: Address | null;
  /** Adapter's underlying asset */
  asset: Address | null;
}

/**
 * Detect what type of adapter a given address is by probing known view functions.
 */
export async function detectAdapterType(
  adapterAddress: Address,
  client: PublicClient,
): Promise<AdapterDetectionResult> {
  const result: AdapterDetectionResult = {
    type: 'unknown',
    targetVault: null,
    targetVaultName: null,
    morphoBlue: null,
    asset: null,
  };

  // Try MorphoVaultV1Adapter — has VAULT() returning a V1 vault address
  try {
    const targetVault = await client.readContract({
      address: adapterAddress,
      abi: v1VaultAdapterAbi,
      functionName: 'VAULT',
    });
    if (targetVault) {
      result.type = 'vault-v1';
      result.targetVault = targetVault;
      // Read target vault name
      try {
        const name = await client.readContract({
          address: targetVault,
          abi: [{ inputs: [], name: 'name', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' }] as const,
          functionName: 'name',
        });
        result.targetVaultName = name;
      } catch { /* name read failed */ }
      // Read adapter asset
      try {
        result.asset = await client.readContract({
          address: adapterAddress,
          abi: v1VaultAdapterAbi,
          functionName: 'asset',
        });
      } catch { /* asset read failed */ }
      return result;
    }
  } catch { /* not a vault adapter */ }

  // Try MorphoMarketV1AdapterV2 — has MORPHO() returning the Morpho Blue address
  try {
    const morpho = await client.readContract({
      address: adapterAddress,
      abi: v1MarketAdapterAbi,
      functionName: 'MORPHO',
    });
    if (morpho) {
      result.type = 'market-v1';
      result.morphoBlue = morpho;
      try {
        result.asset = await client.readContract({
          address: adapterAddress,
          abi: v1MarketAdapterAbi,
          functionName: 'asset',
        });
      } catch { /* asset read failed */ }
      return result;
    }
  } catch { /* not a market adapter */ }

  return result;
}

/**
 * Detect adapter type using the factory's view functions.
 * This is the canonical way — falls back to probe-based detection.
 */
export async function detectAdapterTypeViaFactory(
  adapterAddress: Address,
  chainId: number,
  client: PublicClient,
): Promise<AdapterDetectionResult> {
  const config = getChainConfig(chainId);
  const marketFactory = config?.periphery.morphoMarketV1AdapterV2Factory;
  const vaultFactory = config?.periphery.morphoVaultV1AdapterFactory;

  // Try factory-based detection first
  if (marketFactory) {
    try {
      const isMarket = await client.readContract({
        address: marketFactory,
        abi: marketV1AdapterV2FactoryAbi,
        functionName: 'isMorphoMarketV1AdapterV2',
        args: [adapterAddress],
      });
      if (isMarket) {
        const result: AdapterDetectionResult = {
          type: 'market-v1',
          targetVault: null,
          targetVaultName: null,
          morphoBlue: null,
          asset: null,
        };
        try {
          result.morphoBlue = await client.readContract({
            address: adapterAddress,
            abi: v1MarketAdapterAbi,
            functionName: 'MORPHO',
          });
        } catch { /* ignore */ }
        try {
          result.asset = await client.readContract({
            address: adapterAddress,
            abi: v1MarketAdapterAbi,
            functionName: 'asset',
          });
        } catch { /* ignore */ }
        return result;
      }
    } catch { /* factory call failed */ }
  }

  if (vaultFactory) {
    try {
      const isVault = await client.readContract({
        address: vaultFactory,
        abi: vaultV1AdapterFactoryAbi,
        functionName: 'isMorphoVaultV1Adapter',
        args: [adapterAddress],
      });
      if (isVault) {
        const result: AdapterDetectionResult = {
          type: 'vault-v1',
          targetVault: null,
          targetVaultName: null,
          morphoBlue: null,
          asset: null,
        };
        try {
          result.targetVault = await client.readContract({
            address: adapterAddress,
            abi: v1VaultAdapterAbi,
            functionName: 'VAULT',
          });
          if (result.targetVault) {
            try {
              result.targetVaultName = await client.readContract({
                address: result.targetVault,
                abi: [{ inputs: [], name: 'name', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' }] as const,
                functionName: 'name',
              });
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
        try {
          result.asset = await client.readContract({
            address: adapterAddress,
            abi: v1VaultAdapterAbi,
            functionName: 'asset',
          });
        } catch { /* ignore */ }
        return result;
      }
    } catch { /* factory call failed */ }
  }

  // Fallback to probe-based detection
  return detectAdapterType(adapterAddress, client);
}

// ============================================================
// Adapter ID Computation
// ============================================================

/**
 * Compute the adapter ID for a V1 vault adapter.
 * NOTE: Verify encoding against adapter source code.
 */
export function computeVaultAdapterId(adapterAddress: Address): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('address'),
      [adapterAddress],
    ),
  );
}

// ============================================================
// Validation Helpers
// ============================================================

/**
 * Check if a contract exists at the given address (has bytecode).
 */
export async function contractExists(
  address: Address,
  client: PublicClient,
): Promise<boolean> {
  try {
    const code = await client.getCode({ address });
    return !!code && code !== '0x' && code.length > 2;
  } catch {
    return false;
  }
}

/**
 * Check if an adapter is already enabled on a V2 vault.
 */
export async function isAdapterEnabled(
  vaultAddress: Address,
  adapterAddress: Address,
  client: PublicClient,
): Promise<boolean> {
  try {
    const result = await client.readContract({
      address: vaultAddress,
      abi: [{
        inputs: [{ name: 'adapter', type: 'address' }],
        name: 'isAdapterEnabled',
        outputs: [{ type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
      }] as const,
      functionName: 'isAdapterEnabled',
      args: [adapterAddress],
    });
    return result;
  } catch {
    // Function may not exist — try isAdapter as fallback
    try {
      const result = await client.readContract({
        address: vaultAddress,
        abi: [{
          inputs: [{ name: 'adapter', type: 'address' }],
          name: 'isAdapter',
          outputs: [{ type: 'bool' }],
          stateMutability: 'view',
          type: 'function',
        }] as const,
        functionName: 'isAdapter',
        args: [adapterAddress],
      });
      return result;
    } catch {
      return false;
    }
  }
}

/**
 * Read the liquidity adapter address from a V2 vault.
 */
export async function fetchLiquidityAdapter(
  vaultAddress: Address,
  client: PublicClient,
): Promise<Address | null> {
  try {
    const addr = await client.readContract({
      address: vaultAddress,
      abi: [{
        inputs: [],
        name: 'liquidityAdapter',
        outputs: [{ type: 'address' }],
        stateMutability: 'view',
        type: 'function',
      }] as const,
      functionName: 'liquidityAdapter',
    });
    const zero = '0x0000000000000000000000000000000000000000';
    return addr && addr.toLowerCase() !== zero ? addr : null;
  } catch {
    return null;
  }
}

/**
 * Read caps for an adapter by its ID from a V2 vault.
 */
export async function fetchAdapterCaps(
  vaultAddress: Address,
  adapterId: `0x${string}`,
  client: PublicClient,
): Promise<{ absoluteCap: bigint; relativeCap: bigint; allocation: bigint }> {
  const capAbi = [
    { inputs: [{ name: 'id', type: 'bytes32' }], name: 'absoluteCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
    { inputs: [{ name: 'id', type: 'bytes32' }], name: 'relativeCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
    { inputs: [{ name: 'id', type: 'bytes32' }], name: 'allocation', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  ] as const;

  const [absoluteCap, relativeCap, allocation] = await Promise.all([
    client.readContract({ address: vaultAddress, abi: capAbi, functionName: 'absoluteCap', args: [adapterId] }).catch(() => 0n),
    client.readContract({ address: vaultAddress, abi: capAbi, functionName: 'relativeCap', args: [adapterId] }).catch(() => 0n),
    client.readContract({ address: vaultAddress, abi: capAbi, functionName: 'allocation', args: [adapterId] }).catch(() => 0n),
  ]);

  return { absoluteCap, relativeCap, allocation };
}
