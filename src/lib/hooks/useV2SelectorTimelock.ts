/**
 * Per-selector timelock durations on a Morpho Vault V2.
 *
 * V2 has NO single `timelock()` value — each governed function carries its
 * own duration, read via `timelock(bytes4 selector)`. `fetchV2VaultInfo`
 * therefore reports `vault.timelock = 0n` for every V2 vault (there is
 * nothing else it could report), and every V2 drawer that displayed that
 * value rendered "timelocked (0.0d)" — so a running timelock was invisible
 * on V2 chains (Pharos, XDC, …). These hooks read the real per-selector
 * value instead.
 *
 * Two entry points:
 *   - `useV2SelectorTimelocks(chainId, vault, signatures)` — by human-readable
 *     signature, e.g. `'increaseAbsoluteCap(bytes,uint256)'`. Use when the
 *     surface knows statically which functions it governs.
 *   - `useV2CalldataTimelock(chainId, vault, calldata)` — pulls the selector
 *     off calldata the caller already built. Use in drawers that assemble a
 *     `submit(bytes)` payload.
 */
import { useMemo } from 'react';
import { useReadContracts } from 'wagmi';
import { toFunctionSelector, type Address } from 'viem';
import { vaultV2RegistryAbi } from '../contracts/vaultV2RegistryAbi';

export interface SelectorTimelock {
  selector: `0x${string}`;
  /** Duration in seconds. `undefined` while loading or on read failure. */
  seconds: bigint | undefined;
}

/** Read `timelock(selector)` for a fixed list of function signatures. */
export function useV2SelectorTimelocks(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  signatures: readonly string[],
): { bySignature: Record<string, bigint | undefined>; isLoading: boolean } {
  const selectors = useMemo(
    () => signatures.map((sig) => ({ sig, selector: toFunctionSelector(sig) })),
    // `signatures` is expected to be a module-level constant at every call
    // site; join it so an inline array literal doesn't thrash the query key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signatures.join('|')],
  );

  const contracts = useMemo(
    () =>
      selectors.map(
        ({ selector }) =>
          ({
            address: vaultAddress,
            abi: vaultV2RegistryAbi,
            functionName: 'timelock',
            args: [selector],
            chainId,
          }) as const,
      ),
    [selectors, vaultAddress, chainId],
  );

  const { data, isLoading } = useReadContracts({
    contracts,
    query: {
      enabled: !!vaultAddress && !!chainId && contracts.length > 0,
      staleTime: 60_000,
    },
  });

  const bySignature = useMemo(() => {
    const out: Record<string, bigint | undefined> = {};
    selectors.forEach(({ sig }, i) => {
      const r = data?.[i];
      out[sig] = r?.status === 'success' ? (r.result as bigint) : undefined;
    });
    return out;
  }, [selectors, data]);

  return { bySignature, isLoading };
}

/**
 * Timelock duration for whatever function `calldata` targets. The selector is
 * the first 4 bytes, so a drawer that already built its `submit` payload needs
 * no extra wiring.
 */
export function useV2CalldataTimelock(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  calldata: `0x${string}` | undefined,
): bigint | undefined {
  const selector = calldata && calldata.length >= 10 ? (calldata.slice(0, 10) as `0x${string}`) : undefined;

  const { data } = useReadContracts({
    contracts: selector
      ? [
          {
            address: vaultAddress,
            abi: vaultV2RegistryAbi,
            functionName: 'timelock',
            args: [selector],
            chainId,
          } as const,
        ]
      : [],
    query: {
      enabled: !!vaultAddress && !!chainId && !!selector,
      staleTime: 60_000,
    },
  });

  const r = data?.[0];
  return r?.status === 'success' ? (r.result as bigint) : undefined;
}
