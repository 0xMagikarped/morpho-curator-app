/**
 * V2 three-level cap computation: adapter → collateral → market.
 * Each level has its own risk ID computed from relevant parameters.
 */
import { keccak256, encodeAbiParameters, type Address, type PublicClient } from 'viem';
import { metaMorphoV2Abi } from '../contracts/metaMorphoV2Abi';

// ============================================================
// Risk ID Computation
// ============================================================

/** Adapter-level risk ID */
export function adapterRiskId(adapterAddress: Address): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }],
      [adapterAddress],
    ),
  );
}

/** Collateral-level risk ID */
export function collateralRiskId(
  adapterAddress: Address,
  collateralToken: Address,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }],
      [adapterAddress, collateralToken],
    ),
  );
}

/** Market-level risk ID (full market params) */
export function marketRiskId(
  adapterAddress: Address,
  loanToken: Address,
  collateralToken: Address,
  oracle: Address,
  irm: Address,
  lltv: bigint,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [adapterAddress, loanToken, collateralToken, oracle, irm, lltv],
    ),
  );
}

// ============================================================
// Cap Reading
// ============================================================

export interface CapPair {
  absoluteCap: bigint;
  relativeCap: bigint;
}

/** Read absolute + relative caps for a risk ID from a V2 vault */
export async function readCap(
  client: PublicClient,
  vaultAddress: Address,
  riskId: `0x${string}`,
): Promise<CapPair> {
  const [absoluteCap, relativeCap] = await Promise.all([
    client.readContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'absoluteCap',
      args: [riskId],
    }).catch(() => 0n) as Promise<bigint>,
    client.readContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'relativeCap',
      args: [riskId],
    }).catch(() => 0n) as Promise<bigint>,
  ]);
  return { absoluteCap, relativeCap };
}

// ============================================================
// Effective Cap (min across 3 levels)
// ============================================================

const MAX_UINT256 = 2n ** 256n - 1n;

/** 0n means "no cap set" → treat as unlimited */
function normalize(v: bigint): bigint {
  return v === 0n ? MAX_UINT256 : v;
}

/** Compute effective cap = min(adapter, collateral, market) at each level */
export function effectiveCap(
  adapterCap: CapPair,
  collateralCap: CapPair,
  marketCap: CapPair,
): CapPair {
  const abs = [adapterCap.absoluteCap, collateralCap.absoluteCap, marketCap.absoluteCap]
    .map(normalize);
  const rel = [adapterCap.relativeCap, collateralCap.relativeCap, marketCap.relativeCap]
    .map(normalize);

  return {
    absoluteCap: abs.reduce((a, b) => (a < b ? a : b)),
    relativeCap: rel.reduce((a, b) => (a < b ? a : b)),
  };
}

/** Check if a cap value represents "unlimited" (0 or MAX_UINT256) */
export function isUnlimited(v: bigint): boolean {
  return v === 0n || v >= MAX_UINT256;
}
