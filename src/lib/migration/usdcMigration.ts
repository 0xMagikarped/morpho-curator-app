import { createPublicClient, http, type Address } from 'viem';
import { getChainConfig } from '../../config/chains';
import { erc20Abi } from '../contracts/abis';

export interface MigrationStatus {
  bridgedUsdcAddress: Address;
  nativeUsdcAddress: Address | null;
  migrationLive: boolean;
  bridgedUsdcBalance: bigint;
  nativeUsdcBalance: bigint;
  status: 'pending' | 'live' | 'completed' | 'not-applicable';
}

/**
 * Check USDC.n migration status for a vault on SEI.
 * Returns not-applicable for non-SEI chains or vaults not using bridged USDC.
 */
export async function checkMigrationStatus(
  chainId: number,
  vaultAddress: Address,
  vaultAsset: Address,
): Promise<MigrationStatus> {
  const chainConfig = getChainConfig(chainId);
  const migration = chainConfig?.migration?.usdcBridgedToNative;

  if (!migration) {
    return {
      bridgedUsdcAddress: '0x0000000000000000000000000000000000000000',
      nativeUsdcAddress: null,
      migrationLive: false,
      bridgedUsdcBalance: 0n,
      nativeUsdcBalance: 0n,
      status: 'not-applicable',
    };
  }

  // Check if vault uses bridged USDC
  const isBridgedUsdc = vaultAsset.toLowerCase() === migration.bridgedAddress.toLowerCase();
  if (!isBridgedUsdc) {
    return {
      bridgedUsdcAddress: migration.bridgedAddress,
      nativeUsdcAddress: migration.nativeAddress,
      migrationLive: false,
      bridgedUsdcBalance: 0n,
      nativeUsdcBalance: 0n,
      status: 'not-applicable',
    };
  }

  const client = createPublicClient({
    transport: http(chainConfig!.rpcUrls[0]),
  });

  // Check bridged USDC balance
  let bridgedBalance = 0n;
  try {
    bridgedBalance = await client.readContract({
      address: migration.bridgedAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [vaultAddress],
    }) as bigint;
  } catch { /* ignore */ }

  // Check if native USDC exists
  let migrationLive = false;
  let nativeBalance = 0n;
  if (migration.nativeAddress) {
    try {
      const code = await client.getCode({ address: migration.nativeAddress });
      migrationLive = !!code && code.length > 2;

      if (migrationLive) {
        nativeBalance = await client.readContract({
          address: migration.nativeAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [vaultAddress],
        }) as bigint;
      }
    } catch { /* ignore */ }
  }

  return {
    bridgedUsdcAddress: migration.bridgedAddress,
    nativeUsdcAddress: migration.nativeAddress,
    migrationLive,
    bridgedUsdcBalance: bridgedBalance,
    nativeUsdcBalance: nativeBalance,
    status: migrationLive ? 'live' : migration.status,
  };
}
