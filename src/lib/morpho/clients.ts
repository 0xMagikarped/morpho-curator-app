import { type Client, type Transport, type Chain } from "viem";
import { getPublicClient } from "../data/rpcClient";

/**
 * Returns a viem Client for the Morpho SDK.
 * Reuses the existing PublicClient cache from rpcClient.ts.
 * Cast needed because PublicClient may have `chain: Chain | undefined`
 * while the SDK expects `Client<Transport, Chain>`.
 */
export function getMorphoClient(chainId: number): Client<Transport, Chain> {
  const client = getPublicClient(chainId);
  if (!client.chain) {
    throw new Error(`[getMorphoClient] PublicClient for chain ${chainId} has no chain property`);
  }
  return client as unknown as Client<Transport, Chain>;
}
