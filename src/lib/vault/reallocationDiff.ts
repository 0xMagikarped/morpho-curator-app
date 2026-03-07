import type { Address, PublicClient } from 'viem';

const positionAbi = [{
  name: 'position', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'id', type: 'bytes32' }, { name: 'user', type: 'address' }],
  outputs: [
    { name: 'supplyShares', type: 'uint256' },
    { name: 'borrowShares', type: 'uint128' },
    { name: 'collateral', type: 'uint128' },
  ],
}] as const;

const marketAbi = [{
  name: 'market', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'id', type: 'bytes32' }],
  outputs: [
    { name: 'totalSupplyAssets', type: 'uint128' },
    { name: 'totalSupplyShares', type: 'uint128' },
    { name: 'totalBorrowAssets', type: 'uint128' },
    { name: 'totalBorrowShares', type: 'uint128' },
    { name: 'lastUpdate', type: 'uint128' },
    { name: 'fee', type: 'uint128' },
  ],
}] as const;

export interface MarketAllocationSnapshot {
  marketId: `0x${string}`;
  supplyAssets: bigint;
  timestamp: number;
}

export interface AllocationDiff {
  marketId: `0x${string}`;
  before: bigint;
  after: bigint;
  delta: bigint;
  deltaPercent: number;
}

export async function snapshotAllocations(
  client: PublicClient,
  vaultAddress: Address,
  marketIds: `0x${string}`[],
  morphoAddress: Address
): Promise<MarketAllocationSnapshot[]> {
  const snapshots: MarketAllocationSnapshot[] = [];

  for (const marketId of marketIds) {
    const [position, marketState] = await Promise.all([
      client.readContract({ address: morphoAddress, abi: positionAbi, functionName: 'position', args: [marketId, vaultAddress] }),
      client.readContract({ address: morphoAddress, abi: marketAbi, functionName: 'market', args: [marketId] }),
    ]);

    const supplyShares = position[0];
    const totalSupplyAssets = marketState[0];
    const totalSupplyShares = marketState[1];

    const supplyAssets = totalSupplyShares > 0n
      ? (supplyShares * totalSupplyAssets) / totalSupplyShares
      : 0n;

    snapshots.push({ marketId, supplyAssets, timestamp: Date.now() });
  }

  return snapshots;
}

export function computeDiff(
  before: MarketAllocationSnapshot[],
  after: MarketAllocationSnapshot[]
): AllocationDiff[] {
  const afterMap = new Map(after.map(s => [s.marketId, s]));

  return before.map(b => {
    const a = afterMap.get(b.marketId);
    const afterAssets = a?.supplyAssets ?? 0n;
    const delta = afterAssets - b.supplyAssets;
    const deltaPercent = b.supplyAssets > 0n
      ? Number(delta * 10000n / b.supplyAssets) / 100
      : afterAssets > 0n ? 100 : 0;

    return { marketId: b.marketId, before: b.supplyAssets, after: afterAssets, delta, deltaPercent };
  });
}
