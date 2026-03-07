import { createPublicClient, http, type Address } from 'viem';
import { getChainConfig } from '../../config/chains';
import type { VaultVersion } from '../../types';

const sentinelAbi = [
  {
    inputs: [],
    name: 'sentinel',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const ownerAbi = [
  {
    inputs: [],
    name: 'owner',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Detect vault version by probing for V2-only functions.
 * V2 has sentinel() — V1 does not.
 */
export async function detectVaultVersion(
  chainId: number,
  vaultAddress: Address,
): Promise<VaultVersion> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) return 'v1';

  const client = createPublicClient({
    transport: http(chainConfig.rpcUrls[0]),
  });

  try {
    await client.readContract({
      address: vaultAddress,
      abi: sentinelAbi,
      functionName: 'sentinel',
    });
    return 'v2';
  } catch {
    // sentinel() doesn't exist — check it's at least a valid vault
    try {
      await client.readContract({
        address: vaultAddress,
        abi: ownerAbi,
        functionName: 'owner',
      });
      return 'v1';
    } catch {
      return 'v1'; // Default to v1 if unknown
    }
  }
}
