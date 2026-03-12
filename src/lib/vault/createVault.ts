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
  operations?: string[]; // Human-readable labels for multicall sub-operations
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
// Build V1 deployment with multicall
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

  // Step 1: Deploy vault via factory (always separate — vault doesn't exist yet)
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

  // Collect all immediate config calls for multicall
  const immediateCalls: `0x${string}`[] = [];
  const immediateLabels: string[] = [];

  // Set curator
  if (config.curator) {
    immediateCalls.push(
      encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'setCurator', args: [config.curator] }),
    );
    immediateLabels.push('Set curator');
  }

  // Set allocators
  for (const allocator of config.allocators ?? []) {
    immediateCalls.push(
      encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'setIsAllocator', args: [allocator, true] }),
    );
    immediateLabels.push('Set allocator');
  }

  // Submit guardian
  if (config.guardian) {
    immediateCalls.push(
      encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'submitGuardian', args: [config.guardian] }),
    );
    immediateLabels.push('Set guardian');
  }

  // Set fee recipient BEFORE fee (order matters)
  if (config.feeRecipient) {
    immediateCalls.push(
      encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'setFeeRecipient', args: [config.feeRecipient] }),
    );
    immediateLabels.push('Set fee recipient');
  }

  // Set fee
  if (config.fee && config.fee > 0n) {
    immediateCalls.push(
      encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'setFee', args: [config.fee] }),
    );
    immediateLabels.push(`Set performance fee: ${Number(config.fee * 100n / BigInt(1e18))}%`);
  }

  // Submit caps for initial markets
  for (const market of config.initialMarkets ?? []) {
    immediateCalls.push(
      encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'submitCap', args: [market.marketParams, market.supplyCap] }),
    );
    immediateLabels.push('Submit supply cap');
  }

  // If timelock is 0, acceptCap + queues + timelock increase can go in same multicall
  const hasMarkets = config.initialMarkets && config.initialMarkets.length > 0;
  const needsWaitForCaps = hasMarkets && params.initialTimelock > 0n;

  if (hasMarkets && !needsWaitForCaps) {
    // Timelock is 0 — acceptCap immediately in same multicall
    for (const market of config.initialMarkets!) {
      immediateCalls.push(
        encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'acceptCap', args: [market.marketParams] }),
      );
      immediateLabels.push('Accept supply cap');
    }

    // Set queues
    const marketIds = config.initialMarkets!.map((m) => computeMarketId(m.marketParams));
    immediateCalls.push(
      encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'setSupplyQueue', args: [marketIds] }),
    );
    immediateLabels.push('Set supply queue');

    const permutation = marketIds.map((_, i) => BigInt(i));
    immediateCalls.push(
      encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'updateWithdrawQueue', args: [permutation] }),
    );
    immediateLabels.push('Set withdraw queue');

    // Increase timelock LAST (gates future changes)
    if (config.finalTimelock && config.finalTimelock > params.initialTimelock) {
      immediateCalls.push(
        encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'submitTimelock', args: [config.finalTimelock] }),
      );
      immediateLabels.push(`Increase timelock to ${formatTimelockDuration(Number(config.finalTimelock))}`);
    }
  } else if (!hasMarkets) {
    // No markets — just increase timelock if needed
    if (config.finalTimelock && config.finalTimelock > params.initialTimelock) {
      immediateCalls.push(
        encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'submitTimelock', args: [config.finalTimelock] }),
      );
      immediateLabels.push(`Increase timelock to ${formatTimelockDuration(Number(config.finalTimelock))}`);
    }
  }

  // Step 2: Multicall all immediate config
  if (immediateCalls.length > 0) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Configure vault (${immediateCalls.length} operations)`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'multicall',
        args: [immediateCalls],
      }),
      status: 'pending',
      operations: immediateLabels,
    });
  }

  // Step 3 (optional): Deferred config after timelock wait
  if (needsWaitForCaps) {
    const deferredCalls: `0x${string}`[] = [];
    const deferredLabels: string[] = [];

    for (const market of config.initialMarkets!) {
      deferredCalls.push(
        encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'acceptCap', args: [market.marketParams] }),
      );
      deferredLabels.push('Accept supply cap');
    }

    const marketIds = config.initialMarkets!.map((m) => computeMarketId(m.marketParams));
    deferredCalls.push(
      encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'setSupplyQueue', args: [marketIds] }),
    );
    deferredLabels.push('Set supply queue');

    const permutation = marketIds.map((_, i) => BigInt(i));
    deferredCalls.push(
      encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'updateWithdrawQueue', args: [permutation] }),
    );
    deferredLabels.push('Set withdraw queue');

    if (config.finalTimelock && config.finalTimelock > params.initialTimelock) {
      deferredCalls.push(
        encodeFunctionData({ abi: metaMorphoV1Abi, functionName: 'submitTimelock', args: [config.finalTimelock] }),
      );
      deferredLabels.push(`Increase timelock to ${formatTimelockDuration(Number(config.finalTimelock))}`);
    }

    steps.push({
      id: `step-${stepIndex++}`,
      label: `Finalize markets (${deferredCalls.length} operations)`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'multicall',
        args: [deferredCalls],
      }),
      status: 'pending',
      operations: deferredLabels,
      requiresWait: Number(params.initialTimelock),
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

// ============================================================
// Build V2 deployment with multicall
// ============================================================

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

  // Collect all config calls for a single multicall
  // Within multicall, submit+execute pairs work with timelock=0 (same block.timestamp)
  const calls: `0x${string}`[] = [];
  const labels: string[] = [];

  // Helper: add a timelocked function call (submit + execute in same multicall)
  const addTimelocked = (label: string, calldata: `0x${string}`) => {
    calls.push(
      encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'submit', args: [calldata] }),
    );
    labels.push(`Submit: ${label}`);
    calls.push(calldata);
    labels.push(label);
  };

  // --- Owner-only functions (no timelock) ---

  // Set name
  if (params.name) {
    calls.push(
      encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setName', args: [params.name] }),
    );
    labels.push(`Set name: "${params.name}"`);
  }

  // Set symbol
  if (params.symbol) {
    calls.push(
      encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setSymbol', args: [params.symbol] }),
    );
    labels.push(`Set symbol: "${params.symbol}"`);
  }

  // Set curator — MUST come before timelocked steps (submit requires msg.sender == curator)
  if (config.curator) {
    calls.push(
      encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setCurator', args: [config.curator] }),
    );
    labels.push('Set curator');
  }

  // Set sentinels (owner-only, no timelock)
  for (const sentinel of config.sentinels ?? []) {
    calls.push(
      encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setIsSentinel', args: [sentinel, true] }),
    );
    labels.push('Set sentinel');
  }

  // --- Timelocked functions (submit + execute pairs) ---

  // Set allocators
  for (const allocator of config.allocators ?? []) {
    addTimelocked(
      'Set allocator',
      encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setIsAllocator', args: [allocator, true] }),
    );
  }

  // Set performance fee recipient (must come before fee)
  if (config.performanceFeeRecipient) {
    addTimelocked(
      'Set performance fee recipient',
      encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setPerformanceFeeRecipient', args: [config.performanceFeeRecipient] }),
    );
  }

  // Set performance fee
  if (config.performanceFee && config.performanceFee > 0n) {
    addTimelocked(
      `Set performance fee: ${Number(config.performanceFee * 100n / BigInt(1e18))}%`,
      encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setPerformanceFee', args: [config.performanceFee] }),
    );
  }

  // Set management fee recipient
  if (config.managementFeeRecipient) {
    addTimelocked(
      'Set management fee recipient',
      encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setManagementFeeRecipient', args: [config.managementFeeRecipient] }),
    );
  }

  // Set management fee
  if (config.managementFee && config.managementFee > 0n) {
    addTimelocked(
      `Set management fee: ${Number(config.managementFee * 100n / BigInt(1e18))}%`,
      encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setManagementFee', args: [config.managementFee] }),
    );
  }

  // Set per-function timelocks (LAST — gates future changes)
  for (const tl of config.timelocks ?? []) {
    if (tl.seconds > 0) {
      addTimelocked(
        `Set timelock: ${tl.selector} = ${formatTimelockDuration(tl.seconds)}`,
        encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'increaseTimelock', args: [tl.selector, BigInt(tl.seconds)] }),
      );
    }
  }

  // Step 2: Multicall all config
  if (calls.length > 0) {
    steps.push({
      id: `step-${stepIndex++}`,
      label: `Configure vault (${labels.filter(l => !l.startsWith('Submit:')).length} operations)`,
      to: null,
      data: encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'multicall',
        args: [calls],
      }),
      status: 'pending',
      operations: labels,
    });
  }

  return steps;
}
