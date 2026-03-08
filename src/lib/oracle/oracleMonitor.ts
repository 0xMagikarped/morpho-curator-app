import type { Address } from 'viem';
import { getPublicClient } from '../data/rpcClient';
import { oracleAbi } from '../contracts/abis';
import type { OracleHealth } from './oracleTypes';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

// ============================================================
// Check oracle health (liveness + price fetch)
// ============================================================

export async function checkOracleHealth(
  chainId: number,
  oracleAddress: Address,
): Promise<OracleHealth> {
  if (oracleAddress === ZERO_ADDRESS) {
    return {
      address: oracleAddress,
      chainId,
      currentPrice: null,
      lastCheckedAt: Date.now(),
      isResponding: false,
      latencyMs: 0,
      error: 'No oracle (zero address)',
    };
  }

  let client;
  try {
    client = getPublicClient(chainId);
  } catch {
    return {
      address: oracleAddress,
      chainId,
      currentPrice: null,
      lastCheckedAt: Date.now(),
      isResponding: false,
      latencyMs: 0,
      error: 'Unknown chain',
    };
  }

  const start = performance.now();
  try {
    const price = await client.readContract({
      address: oracleAddress,
      abi: oracleAbi,
      functionName: 'price',
    });
    const latencyMs = Math.round(performance.now() - start);

    return {
      address: oracleAddress,
      chainId,
      currentPrice: price as bigint,
      lastCheckedAt: Date.now(),
      isResponding: true,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      address: oracleAddress,
      chainId,
      currentPrice: null,
      lastCheckedAt: Date.now(),
      isResponding: false,
      latencyMs,
      error: err instanceof Error ? err.message : 'Oracle call failed',
    };
  }
}

// ============================================================
// Batch check multiple oracles
// ============================================================

export async function checkOracleHealthBatch(
  chainId: number,
  oracleAddresses: Address[],
): Promise<Map<Address, OracleHealth>> {
  const unique = [...new Set(oracleAddresses)];
  const results = await Promise.allSettled(
    unique.map((addr) => checkOracleHealth(chainId, addr)),
  );

  const map = new Map<Address, OracleHealth>();
  for (let i = 0; i < unique.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      map.set(unique[i], result.value);
    } else {
      map.set(unique[i], {
        address: unique[i],
        chainId,
        currentPrice: null,
        lastCheckedAt: Date.now(),
        isResponding: false,
        latencyMs: 0,
        error: 'Check failed',
      });
    }
  }

  return map;
}
