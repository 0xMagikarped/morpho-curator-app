import { useCallback, useState } from "react";
import type { Address } from "viem";
import {
  type Market,
  type MarketId,
  type Vault,
  type VaultMarketConfig,
  type Position,
} from "@morpho-org/blue-sdk";
import { fetchAccrualVault, fetchMarket } from "@morpho-org/blue-sdk-viem";
import {
  SimulationState,
  simulateOperation,
  type InputSimulationState,
} from "@morpho-org/simulation-sdk";
import { getMorphoClient } from "../../lib/morpho/clients";

export interface AllocationChange {
  marketId: MarketId;
  targetAssets: bigint;
}

export interface MarketImpact {
  marketId: MarketId;
  label: string;
  beforeSupplyApy: number;
  afterSupplyApy: number;
  beforeUtilization: bigint;
  afterUtilization: bigint;
  flow: bigint; // positive = net supply, negative = net withdraw
}

export interface SimulationResult {
  beforeApy: number;
  afterApy: number;
  beforeNetApy: number;
  afterNetApy: number;
  marketImpacts: MarketImpact[];
  isValid: boolean;
  error?: string;
}

/**
 * Hook for simulating vault reallocation impact.
 *
 * Uses the Morpho simulation-sdk to construct a SimulationState,
 * then applies a MetaMorpho_Reallocate operation to compute before/after APY.
 */
export function useReallocationSimulation(
  vaultAddress: Address,
  chainId: number,
) {
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const simulate = useCallback(
    async (changes: AllocationChange[]) => {
      setIsSimulating(true);
      try {
        const client = getMorphoClient(chainId);

        // Fetch the AccrualVault (includes allocations, markets, positions)
        const accrualVault = await fetchAccrualVault(vaultAddress, client);

        // Fetch all markets in the vault's supply queue
        const marketIds = [...accrualVault.supplyQueue];
        const markets = await Promise.all(
          marketIds.map((id) => fetchMarket(id, client)),
        );

        // Build before-state APY
        const beforeApy = accrualVault.apy;
        const beforeNetApy = accrualVault.netApy;

        // Build market lookup
        const marketMap = new Map<MarketId, Market>();
        for (const m of markets) {
          marketMap.set(m.id, m);
        }

        // Build SimulationState input
        const marketsRecord: Record<MarketId, Market> = {} as Record<MarketId, Market>;
        for (const m of markets) {
          marketsRecord[m.id] = m;
        }

        const vaultsRecord: Record<Address, Vault> = {
          [vaultAddress]: accrualVault as Vault,
        };

        // Build vault market configs from allocations
        const vaultMarketConfigs: Record<
          Address,
          Record<MarketId, VaultMarketConfig>
        > = {
          [vaultAddress]: {} as Record<MarketId, VaultMarketConfig>,
        };
        for (const [mId, alloc] of accrualVault.allocations) {
          vaultMarketConfigs[vaultAddress]![mId] = alloc.config;
        }

        // Build positions (vault's position in each market)
        const positions: Record<Address, Record<MarketId, Position>> = {
          [vaultAddress]: {} as Record<MarketId, Position>,
        };
        for (const [mId, alloc] of accrualVault.allocations) {
          positions[vaultAddress]![mId] = alloc.position;
        }

        // Get current block info
        const block = await client.request({
          method: "eth_getBlockByNumber" as never,
          params: ["latest", false] as never,
        }) as { number: string; timestamp: string };

        const simInput: InputSimulationState = {
          chainId,
          block: {
            number: BigInt(block.number),
            timestamp: BigInt(block.timestamp),
          },
          markets: marketsRecord,
          vaults: vaultsRecord,
          vaultMarketConfigs,
          positions,
        };

        const startState = new SimulationState(simInput);

        // Apply MetaMorpho_Reallocate operation
        const reallocateOp = {
          type: "MetaMorpho_Reallocate" as const,
          sender: vaultAddress,
          address: vaultAddress,
          args: changes.map((c) => ({
            id: c.marketId,
            assets: c.targetAssets,
          })),
        };

        const endState = simulateOperation(reallocateOp, startState);

        // Extract after-state APY
        const afterVault = (endState as SimulationState).getAccrualVault(vaultAddress);
        const afterApy = afterVault.apy;
        const afterNetApy = afterVault.netApy;

        // Build per-market impact
        const marketImpacts: MarketImpact[] = changes.map((change) => {
          const beforeMarket = marketMap.get(change.marketId);
          const afterMarket = (endState as SimulationState).tryGetMarket(change.marketId);

          const beforeAllocation = accrualVault.allocations.get(change.marketId);
          const currentAssets = beforeAllocation?.position.supplyAssets ?? 0n;
          const flow = change.targetAssets - currentAssets;

          return {
            marketId: change.marketId,
            label: change.marketId.slice(0, 10),
            beforeSupplyApy: beforeMarket?.supplyApy ?? 0,
            afterSupplyApy: afterMarket?.supplyApy ?? 0,
            beforeUtilization: beforeMarket?.utilization ?? 0n,
            afterUtilization: afterMarket?.utilization ?? 0n,
            flow,
          };
        });

        setSimulation({
          beforeApy,
          afterApy,
          beforeNetApy,
          afterNetApy,
          marketImpacts,
          isValid: true,
        });
      } catch (error: unknown) {
        setSimulation({
          beforeApy: 0,
          afterApy: 0,
          beforeNetApy: 0,
          afterNetApy: 0,
          marketImpacts: [],
          isValid: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsSimulating(false);
      }
    },
    [vaultAddress, chainId],
  );

  return { simulation, isSimulating, simulate };
}
