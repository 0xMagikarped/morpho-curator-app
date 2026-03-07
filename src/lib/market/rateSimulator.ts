import type { Address, PublicClient } from 'viem';

const SECONDS_PER_YEAR = 31_536_000n;

const morphoReadAbi = [
  {
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
  },
  {
    name: 'idToMarketParams', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
  },
] as const;

const irmAbi = [
  {
    name: 'borrowRateView', type: 'function', stateMutability: 'view',
    inputs: [
      {
        name: 'marketParams', type: 'tuple',
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
      },
      {
        name: 'market', type: 'tuple',
        components: [
          { name: 'totalSupplyAssets', type: 'uint128' },
          { name: 'totalSupplyShares', type: 'uint128' },
          { name: 'totalBorrowAssets', type: 'uint128' },
          { name: 'totalBorrowShares', type: 'uint128' },
          { name: 'lastUpdate', type: 'uint128' },
          { name: 'fee', type: 'uint128' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export interface RateSimulationResult {
  targetUtilization: number;
  simulatedBorrowRate: number;
  currentUtilization: number;
  currentBorrowRate: number;
  totalSupplyAssets: bigint;
  totalBorrowAssets: bigint;
}

export async function simulateRateAtUtilization(
  client: PublicClient,
  morphoAddress: Address,
  marketId: `0x${string}`,
  targetUtilizationPercent: number
): Promise<RateSimulationResult> {
  const marketParams = await client.readContract({
    address: morphoAddress,
    abi: morphoReadAbi,
    functionName: 'idToMarketParams',
    args: [marketId],
  });

  const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee] =
    await client.readContract({
      address: morphoAddress,
      abi: morphoReadAbi,
      functionName: 'market',
      args: [marketId],
    });

  const currentMarketState = {
    totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee,
  };

  const currentRateRaw = await client.readContract({
    address: marketParams.irm,
    abi: irmAbi,
    functionName: 'borrowRateView',
    args: [marketParams, currentMarketState],
  });

  const currentAnnualRate = Number(currentRateRaw * SECONDS_PER_YEAR) / 1e18 * 100;

  const targetBasis = BigInt(Math.round(targetUtilizationPercent * 100));
  const simulatedBorrowAssets = (totalSupplyAssets * targetBasis) / 10000n;

  const simulatedMarketState = {
    ...currentMarketState,
    totalBorrowAssets: simulatedBorrowAssets,
  };

  const simulatedRateRaw = await client.readContract({
    address: marketParams.irm,
    abi: irmAbi,
    functionName: 'borrowRateView',
    args: [marketParams, simulatedMarketState],
  });

  const simulatedAnnualRate = Number(simulatedRateRaw * SECONDS_PER_YEAR) / 1e18 * 100;

  const currentUtilization = totalSupplyAssets > 0n
    ? Number(totalBorrowAssets * 10000n / totalSupplyAssets) / 100
    : 0;

  return {
    targetUtilization: targetUtilizationPercent,
    simulatedBorrowRate: simulatedAnnualRate,
    currentUtilization,
    currentBorrowRate: currentAnnualRate,
    totalSupplyAssets,
    totalBorrowAssets,
  };
}
