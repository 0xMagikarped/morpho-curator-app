import { encodeAbiParameters, keccak256, parseAbiParameters, type Address } from 'viem';

export interface MarketParamsInput {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

export function computeMarketId(params: MarketParamsInput): `0x${string}` {
  const encoded = encodeAbiParameters(
    parseAbiParameters('address, address, address, address, uint256'),
    [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]
  );
  return keccak256(encoded);
}
