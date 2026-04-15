/**
 * TimeLock calldata decoder.
 *
 * Walks the ABI registry and returns the first clean decode. Batch-aware:
 * `scheduleBatch` ops expand into nested `DecodedCall` entries so the UI
 * can enumerate them.
 *
 * Explicit safety rule: wrong decodes are worse than no decode. When no
 * ABI matches, we return null rather than render misleading values.
 */

import { decodeFunctionData, keccak256, toHex, type Abi, type Address } from 'viem';
import { KNOWN_ABIS, type KnownAbiEntry } from './abiRegistry';

export interface DecodedArg {
  name: string;
  type: string;
  /** Raw value as returned by viem. UI formats based on type + hints. */
  value: unknown;
}

export interface DecodedCall {
  /** ABI entry label (e.g. "MoolahVault"). */
  abiLabel: string;
  functionName: string;
  args: DecodedArg[];
  target: Address;
  value: bigint;
  rawData: `0x${string}`;
  /** If the call is a `scheduleBatch`, the inner ops in order. */
  batch?: DecodedCall[];
}

function selectorOf(data: `0x${string}`): `0x${string}` | null {
  if (!data || data.length < 10) return null;
  return data.slice(0, 10).toLowerCase() as `0x${string}`;
}

/** Build selector `keccak256("name(type1,type2,…)")[:4]` from a viem ABI fn. */
function functionSelector(item: {
  name: string;
  inputs: ReadonlyArray<{ type: string; components?: ReadonlyArray<unknown> }>;
}): `0x${string}` {
  const sig = `${item.name}(${item.inputs.map((i) => formatType(i)).join(',')})`;
  return keccak256(toHex(sig)).slice(0, 10).toLowerCase() as `0x${string}`;
}

function formatType(input: { type: string; components?: ReadonlyArray<unknown> }): string {
  if (input.type === 'tuple' && input.components) {
    return `(${(input.components as Array<{ type: string; components?: ReadonlyArray<unknown> }>)
      .map((c) => formatType(c))
      .join(',')})`;
  }
  if (input.type.startsWith('tuple[') && input.components) {
    const suffix = input.type.slice('tuple'.length);
    return `(${(input.components as Array<{ type: string; components?: ReadonlyArray<unknown> }>)
      .map((c) => formatType(c))
      .join(',')})${suffix}`;
  }
  return input.type;
}

/** Find the ABI item whose selector matches `data`. Null on no match. */
function findAbiItem(abi: Abi, selector: `0x${string}`) {
  for (const item of abi) {
    if (item.type !== 'function') continue;
    try {
      if (functionSelector(item as never) === selector) return item;
    } catch {
      // Malformed entry — ignore.
    }
  }
  return null;
}

/**
 * Decode a single call. `chainId` powers address-based ABI matching in
 * `KNOWN_ABIS`. Returns `null` when no ABI decodes cleanly.
 */
export function decodeCall(
  target: Address,
  value: bigint,
  data: `0x${string}`,
  chainId: number,
): DecodedCall | null {
  const selector = selectorOf(data);
  if (!selector) return null;

  for (const entry of KNOWN_ABIS) {
    if (!entry.match(target, chainId)) continue;
    const decoded = tryDecode(entry, target, value, data, chainId);
    if (decoded) return decoded;
  }

  return null;
}

function tryDecode(
  entry: KnownAbiEntry,
  target: Address,
  value: bigint,
  data: `0x${string}`,
  chainId: number,
): DecodedCall | null {
  const selector = selectorOf(data);
  if (!selector) return null;

  const item = findAbiItem(entry.abi, selector);
  if (!item) return null;

  let decoded: { functionName: string; args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: entry.abi, data });
  } catch {
    return null;
  }

  const funcItem = item as unknown as {
    name: string;
    inputs: ReadonlyArray<{ name?: string; type: string; components?: ReadonlyArray<unknown> }>;
  };
  const args: DecodedArg[] = funcItem.inputs.map((input, i) => ({
    name: input.name || `arg${i}`,
    type: input.type,
    value: decoded.args?.[i],
  }));

  const out: DecodedCall = {
    abiLabel: entry.label,
    functionName: decoded.functionName,
    args,
    target,
    value,
    rawData: data,
  };

  // Expand OZ's `scheduleBatch` into per-call nested decodes.
  // Signature: scheduleBatch(address[], uint256[], bytes[], bytes32, bytes32, uint256).
  if (decoded.functionName === 'scheduleBatch') {
    const targets = decoded.args?.[0] as Address[] | undefined;
    const values = decoded.args?.[1] as bigint[] | undefined;
    const payloads = decoded.args?.[2] as `0x${string}`[] | undefined;
    if (
      targets &&
      values &&
      payloads &&
      targets.length === payloads.length &&
      values.length === targets.length
    ) {
      out.batch = targets.map((t, i) => {
        const inner = decodeCall(t, values[i] ?? 0n, payloads[i], chainId);
        if (inner) return inner;
        return {
          abiLabel: 'Unknown',
          functionName: 'unknown',
          args: [],
          target: t,
          value: values[i] ?? 0n,
          rawData: payloads[i],
        };
      });
    }
  }

  return out;
}
