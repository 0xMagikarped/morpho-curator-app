import type { Address, PublicClient } from 'viem';

export interface PositionData {
  borrower: Address;
  supplyShares: bigint;
  borrowShares: bigint;
  collateral: bigint;
  borrowAssets: bigint;
  healthRatio: number;
}

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

const oraclePriceAbi = [{
  name: 'price', type: 'function', stateMutability: 'view',
  inputs: [], outputs: [{ type: 'uint256' }],
}] as const;

export function calculateHealthRatio(
  collateralAmount: bigint,
  borrowAmount: bigint,
  oraclePrice: bigint,
  loanTokenDecimals: number,
  collateralTokenDecimals: number,
  lltv: bigint
): number {
  if (borrowAmount === 0n) return Infinity;

  const ORACLE_PRICE_SCALE = 10n ** BigInt(36 + loanTokenDecimals - collateralTokenDecimals);
  const collateralValueInLoan = (collateralAmount * oraclePrice) / ORACLE_PRICE_SCALE;
  const maxBorrow = (collateralValueInLoan * lltv) / (10n ** 18n);

  return Number(maxBorrow) / Number(borrowAmount);
}

export async function fetchPositionHealth(
  client: PublicClient,
  morphoAddress: Address,
  marketId: `0x${string}`,
  oracleAddress: Address,
  borrower: Address,
  loanTokenDecimals: number,
  collateralTokenDecimals: number,
  lltv: bigint
): Promise<PositionData> {
  const [position, marketState, oraclePrice] = await Promise.all([
    client.readContract({ address: morphoAddress, abi: positionAbi, functionName: 'position', args: [marketId, borrower] }),
    client.readContract({ address: morphoAddress, abi: marketAbi, functionName: 'market', args: [marketId] }),
    client.readContract({ address: oracleAddress, abi: oraclePriceAbi, functionName: 'price' }),
  ]);

  const borrowShares = position[1];
  const collateral = position[2];
  const totalBorrowAssets = marketState[2];
  const totalBorrowShares = marketState[3];

  const borrowAssets = totalBorrowShares > 0n
    ? (BigInt(borrowShares) * totalBorrowAssets) / totalBorrowShares
    : 0n;

  const healthRatio = calculateHealthRatio(
    BigInt(collateral), borrowAssets, oraclePrice,
    loanTokenDecimals, collateralTokenDecimals, lltv
  );

  return {
    borrower,
    supplyShares: position[0],
    borrowShares: BigInt(borrowShares),
    collateral: BigInt(collateral),
    borrowAssets,
    healthRatio,
  };
}
