import {
  encodeFunctionData,
  encodeAbiParameters,
  keccak256,
  decodeEventLog,
  type Hash,
  type TransactionReceipt,
  type Address,
} from 'viem';
import { metaMorphoFactoryAbi, metaMorphoV1Abi, metaMorphoV2FactoryAbi, metaMorphoV2Abi } from '../contracts/abis';
import { getChainConfig } from '../../config/chains';

// ============================================================
// Types
// ============================================================

export interface VaultCreationParams {
  chainId: number;
  initialOwner: `0x${string}`;
  initialTimelock: bigint;
  asset: `0x${string}`;
  name: string;
  symbol: string;
  salt: `0x${string}`;
}

export interface MarketParamsStruct {
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
  oracle: `0x${string}`;
  irm: `0x${string}`;
  lltv: bigint;
}

export interface PostDeployConfig {
  curator?: `0x${string}`;
  allocators?: `0x${string}`[];
  guardian?: `0x${string}`;
  fee?: bigint; // WAD (e.g., 0.15e18 = 15%)
  feeRecipient?: `0x${string}`;
  initialMarkets?: Array<{
    marketParams: MarketParamsStruct;
    supplyCap: bigint; // In raw asset units (e.g., 50000e6 for 50K USDC)
  }>;
  finalTimelock?: bigint; // Increase timelock after setup
}

export type TransactionStepStatus = 'pending' | 'confirming' | 'confirmed' | 'failed' | 'waiting';

export interface TransactionStep {
  id: string;
  label: string;
  to: `0x${string}` | null; // null = filled from deploy result
  data: `0x${string}`;
  status: TransactionStepStatus;
  txHash?: Hash;
  error?: string;
  requiresWait?: number; // seconds to wait before executing
}

// ============================================================
// Market ID computation
// ============================================================

export function computeMarketId(params: MarketParamsStruct): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv],
    ),
  );
}

// ============================================================
// Parse vault address from deploy receipt
// ============================================================

export function parseVaultAddressFromReceipt(receipt: TransactionReceipt): `0x${string}` | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: metaMorphoFactoryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'CreateMetaMorpho') {
        return (decoded.args as { metaMorpho: `0x${string}` }).metaMorpho;
      }
    } catch {
      // Not our event, skip
    }
  }
  return null;
}

// ============================================================
// Build transaction sequence
// ============================================================

export function buildDeploymentTxSequence(
  params: VaultCreationParams,
  config: PostDeployConfig,
): TransactionStep[] {
  const chainConfig = getChainConfig(params.chainId);
  if (!chainConfig) throw new Error(`Unsupported chain: ${params.chainId}`);

  const factoryAddress = chainConfig.vaultFactories.v1;
  if (!factoryAddress) throw new Error(`No V1 factory on chain ${params.chainId}`);

  const steps: TransactionStep[] = [];
  let stepIndex = 0;

  // Step 1: Deploy vault via factory
  steps.push({
    id: `step-${stepIndex++}`,
    label: 'Deploy vault via factory',
    to: factoryAddress,
    data: encodeFunctionData({
      abi: metaMorphoFactoryAbi,
      functionName: 'createMetaMorpho',
      args: [
        params.initialOwner,
        params.initialTimelock,
        params.asset,
        params.name,
        params.symbol,
        params.salt,
      ],
    }),
    status: 'pending',
  });

  // Step 2: Set curator
  if (config.curator) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Set curator`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'setCurator',
        args: [config.curator],
      }),
      status: 'pending',
    });
  }

  // Step 3: Set allocators
  for (const allocator of config.allocators ?? []) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Set allocator`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'setIsAllocator',
        args: [allocator, true],
      }),
      status: 'pending',
    });
  }

  // Step 4: Submit guardian (instant if first guardian — no dependency)
  if (config.guardian) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Set guardian`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'submitGuardian',
        args: [config.guardian],
      }),
      status: 'pending',
    });
  }

  // Step 5: Set fee recipient (MUST come before setFee — no dependency)
  if (config.feeRecipient) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Set fee recipient`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'setFeeRecipient',
        args: [config.feeRecipient],
      }),
      status: 'pending',
    });
  }

  // Step 6: Set fee (REQUIRES feeRecipient != address(0) when fee > 0)
  if (config.fee && config.fee > 0n) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Set performance fee: ${Number(config.fee * 100n / BigInt(1e18))}%`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'setFee',
        args: [config.fee],
      }),
      status: 'pending',
    });
  }

  // Step 7: Submit caps for initial markets
  for (const market of config.initialMarkets ?? []) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Set supply cap`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'submitCap',
        args: [market.marketParams, market.supplyCap],
      }),
      status: 'pending',
    });

    // If timelock > 0, need acceptCap after waiting
    if (params.initialTimelock > 0n) {
      steps.push({
        id: `step-${stepIndex++}`,
        label: `Accept cap (after timelock)`,
        to: null,
        data: encodeFunctionData({
          abi: metaMorphoV1Abi,
          functionName: 'acceptCap',
          args: [market.marketParams],
        }),
        status: 'pending',
        requiresWait: Number(params.initialTimelock),
      });
    }
  }

  // Step 8: Set supply queue
  if (config.initialMarkets && config.initialMarkets.length > 0) {
    const marketIds = config.initialMarkets.map((m) => computeMarketId(m.marketParams));

    steps.push({
      id: `step-${stepIndex++}`,
      label: 'Set supply queue',
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'setSupplyQueue',
        args: [marketIds],
      }),
      status: 'pending',
    });

    // Step 9: Update withdraw queue (identity permutation)
    const permutation = marketIds.map((_, i) => BigInt(i));
    steps.push({
      id: `step-${stepIndex++}`,
      label: 'Set withdraw queue',
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'updateWithdrawQueue',
        args: [permutation],
      }),
      status: 'pending',
    });
  }

  // Step 10: Increase timelock (always instant for increase)
  if (config.finalTimelock && config.finalTimelock > params.initialTimelock) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Increase timelock to ${formatTimelockDuration(Number(config.finalTimelock))}`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'submitTimelock',
        args: [config.finalTimelock],
      }),
      status: 'pending',
    });
  }

  return steps;
}

// ============================================================
// Helpers
// ============================================================

export function feePercentToWad(percent: number): bigint {
  return BigInt(Math.round(percent * 1e16)); // percent * 1e18 / 100
}

export function feeWadToPercent(wad: bigint): number {
  return Number(wad) / 1e16;
}

export function formatTimelockDuration(seconds: number): string {
  if (seconds === 0) return '0 (no protection)';
  const days = seconds / 86400;
  if (days >= 1 && seconds % 86400 === 0) return `${days} day${days > 1 ? 's' : ''}`;
  const hours = seconds / 3600;
  if (hours >= 1 && seconds % 3600 === 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  return `${seconds.toLocaleString()}s`;
}

export function getFactoryAddress(chainId: number, version: 'v1' | 'v2' = 'v1'): Address | undefined {
  const config = getChainConfig(chainId);
  return version === 'v2' ? config?.vaultFactories.v2 : config?.vaultFactories.v1;
}

// ============================================================
// V2 Vault Creation
// ============================================================

export interface V2VaultCreationParams {
  chainId: number;
  initialOwner: `0x${string}`;
  asset: `0x${string}`;
  name: string;   // Set via setName() post-deploy
  symbol: string;  // Set via setSymbol() post-deploy
  salt: `0x${string}`;
}

export interface V2PostDeployConfig {
  curator?: `0x${string}`;
  allocators?: `0x${string}`[];
  sentinels?: `0x${string}`[];
  performanceFee?: bigint;
  performanceFeeRecipient?: `0x${string}`;
  managementFee?: bigint;
  managementFeeRecipient?: `0x${string}`;
  timelocks?: Array<{ selector: `0x${string}`; seconds: number }>;
}

export function parseV2VaultAddressFromReceipt(receipt: TransactionReceipt): `0x${string}` | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: metaMorphoV2FactoryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'CreateVaultV2') {
        return (decoded.args as { newVaultV2: `0x${string}` }).newVaultV2;
      }
    } catch {
      // Not our event
    }
  }
  return null;
}

export function buildV2DeploymentTxSequence(
  params: V2VaultCreationParams,
  config: V2PostDeployConfig,
): TransactionStep[] {
  const chainConfig = getChainConfig(params.chainId);
  if (!chainConfig) throw new Error(`Unsupported chain: ${params.chainId}`);

  const factoryAddress = chainConfig.vaultFactories.v2;
  if (!factoryAddress) throw new Error(`No V2 factory on chain ${params.chainId}`);

  const steps: TransactionStep[] = [];
  let stepIndex = 0;

  // Step 1: Deploy vault via V2 factory
  steps.push({
    id: `step-${stepIndex++}`,
    label: 'Deploy V2 vault via factory',
    to: factoryAddress,
    data: encodeFunctionData({
      abi: metaMorphoV2FactoryAbi,
      functionName: 'createVaultV2',
      args: [params.initialOwner, params.asset, params.salt],
    }),
    status: 'pending',
  });

  // Step 2: Set name (V2 vaults start with empty name)
  if (params.name) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Set name: "${params.name}"`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'setName',
        args: [params.name],
      }),
      status: 'pending',
    });
  }

  // Step 3: Set symbol (V2 vaults start with empty symbol)
  if (params.symbol) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Set symbol: "${params.symbol}"`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'setSymbol',
        args: [params.symbol],
      }),
      status: 'pending',
    });
  }

  // Step 4: Set curator
  if (config.curator) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: 'Set curator',
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'setCurator',
        args: [config.curator],
      }),
      status: 'pending',
    });
  }

  // Step 3: Set allocators
  for (const allocator of config.allocators ?? []) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: 'Set allocator',
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'setIsAllocator',
        args: [allocator, true],
      }),
      status: 'pending',
    });
  }

  // Step 4: Set sentinels
  for (const sentinel of config.sentinels ?? []) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: 'Set sentinel',
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'setIsSentinel',
        args: [sentinel, true],
      }),
      status: 'pending',
    });
  }

  // Step 5: Set performance fee recipient (must come before fee)
  if (config.performanceFeeRecipient) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: 'Set performance fee recipient',
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'setPerformanceFeeRecipient',
        args: [config.performanceFeeRecipient],
      }),
      status: 'pending',
    });
  }

  // Step 6: Set performance fee
  if (config.performanceFee && config.performanceFee > 0n) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Set performance fee: ${Number(config.performanceFee * 100n / BigInt(1e18))}%`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'setPerformanceFee',
        args: [config.performanceFee],
      }),
      status: 'pending',
    });
  }

  // Step 7: Set management fee recipient
  if (config.managementFeeRecipient) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: 'Set management fee recipient',
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'setManagementFeeRecipient',
        args: [config.managementFeeRecipient],
      }),
      status: 'pending',
    });
  }

  // Step 8: Set management fee
  if (config.managementFee && config.managementFee > 0n) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Set management fee: ${Number(config.managementFee * 100n / BigInt(1e18))}%`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'setManagementFee',
        args: [config.managementFee],
      }),
      status: 'pending',
    });
  }

  // Step 9: Set per-function timelocks
  for (const tl of config.timelocks ?? []) {
    if (tl.seconds > 0) {
      steps.push({
        id: `step-${stepIndex++}`,
        label: `Set timelock: ${tl.selector} = ${formatTimelockDuration(tl.seconds)}`,
        to: null,
        data: encodeFunctionData({
          abi: metaMorphoV2Abi,
          functionName: 'setTimelock',
          args: [tl.selector, BigInt(tl.seconds)],
        }),
        status: 'pending',
      });
    }
  }

  return steps;
}
