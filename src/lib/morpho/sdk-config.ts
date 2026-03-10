import { ChainId } from "@morpho-org/blue-sdk";

/**
 * Chains where the Morpho SDK can be used for on-chain reads and simulation.
 * SEI (1329) is supported by the SDK as ChainId.SeiMainnet.
 */
export const SUPPORTED_MORPHO_CHAINS = [
  ChainId.EthMainnet,   // 1
  ChainId.BaseMainnet,  // 8453
  ChainId.SeiMainnet,   // 1329
] as const;

export function isMorphoSdkSupported(chainId: number): boolean {
  return (SUPPORTED_MORPHO_CHAINS as readonly number[]).includes(chainId);
}
