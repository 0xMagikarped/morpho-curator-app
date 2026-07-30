/**
 * Pending timelocked actions on a Morpho Vault V2.
 *
 * V1 has `PendingCapsBanner`, driven by the vault's `pendingCap` storage.
 * V2 has no equivalent read — a queued action lives only in
 * `executableAt[keccak(data)]`, keyed by the exact calldata that was
 * `submit`-ed, and there is no way to enumerate that mapping on-chain. So
 * nothing in the app ever showed a running V2 timelock: a curator would
 * submit a cap increase and get no feedback anywhere until they happened to
 * reopen the very same drawer with the very same numbers typed in.
 *
 * Recovering the queue takes two steps:
 *   1. Scan `Submit(bytes4 indexed selector, bytes data, uint256 executableAt)`
 *      to recover every calldata ever queued. (`scanContractEvent` handles
 *      range-capped RPCs — Pharos allows 1000 blocks per request.)
 *   2. Re-read `executableAt(data)` for each. Executing or revoking clears
 *      the slot to 0, so a non-zero value is the authoritative "still
 *      queued" signal — the event log alone would show stale entries.
 */
import { useQuery } from '@tanstack/react-query';
import {
  decodeAbiParameters,
  decodeFunctionData,
  parseAbiItem,
  type Address,
  type PublicClient,
} from 'viem';
import { getPublicClient, fetchTokenInfo } from '../data/rpcClient';
import { metaMorphoV2Abi } from '../contracts/metaMorphoV2Abi';
import { scanContractEvent, findDeploymentBlock } from '../data/eventScan';
import { getLogWindowConfig } from '../vault/proposals';
import { vaultKeys } from '../queryKeys';

const SUBMIT_EVENT = parseAbiItem(
  'event Submit(bytes4 indexed selector, bytes data, uint256 executableAt)',
);

export interface PendingActionsResult {
  actions: PendingV2Action[];
  /** First block scanned — the queue is only complete from here onward. */
  fromBlock: bigint;
  toBlock: bigint;
  /** True when the scan reached the vault's deployment block (full history). */
  isFullHistory: boolean;
}

export interface PendingV2Action {
  /** Exact submitted calldata — the timelock key, and what Execute re-sends. */
  data: `0x${string}`;
  selector: `0x${string}`;
  /** Unix seconds. Always > 0 here (zero entries are filtered out). */
  executableAt: bigint;
  /** Decoded function name, e.g. `increaseAbsoluteCap`. */
  functionName: string;
  /** Human action label, e.g. "Increase absolute cap". */
  label: string;
  /** What the action targets, e.g. "collateral wsrUSD" — null if undecodable. */
  target: string | null;
  /** Formatted new value, e.g. "10,000,000 USDC" or "100%". */
  value: string | null;
  blockNumber: bigint | null;
}

const LABELS: Record<string, string> = {
  increaseAbsoluteCap: 'Increase absolute cap',
  increaseRelativeCap: 'Increase relative cap',
  decreaseAbsoluteCap: 'Decrease absolute cap',
  decreaseRelativeCap: 'Decrease relative cap',
  addAdapter: 'Add adapter',
  removeAdapter: 'Remove adapter',
  setAdapterRegistry: 'Set adapter registry',
  setIsAllocator: 'Set allocator',
  setPerformanceFee: 'Set performance fee',
  setPerformanceFeeRecipient: 'Set performance fee recipient',
  setManagementFee: 'Set management fee',
  setManagementFeeRecipient: 'Set management fee recipient',
  setMaxRate: 'Set max rate',
  setForceDeallocatePenalty: 'Set force-deallocate penalty',
  setLiquidityAdapterAndData: 'Set liquidity adapter',
  decreaseTimelock: 'Decrease timelock',
  abdicate: 'Abdicate selector',
};

/** Leading `string` tag of a cap-map idData payload ("this" / "collateralToken" / "this/marketParams"). */
function idDataTag(idData: `0x${string}`): string | null {
  try {
    const hex = idData.slice(2);
    const offset = Number(BigInt('0x' + hex.slice(0, 64)));
    const lenStart = offset * 2;
    const length = Number(BigInt('0x' + hex.slice(lenStart, lenStart + 64)));
    const strHex = hex.slice(lenStart + 64, lenStart + 64 + length * 2);
    let out = '';
    for (let i = 0; i < strHex.length; i += 2) out += String.fromCharCode(parseInt(strHex.slice(i, i + 2), 16));
    return out;
  } catch {
    return null;
  }
}

/** Resolve a cap idData payload to a human target string. */
async function describeCapTarget(
  chainId: number,
  idData: `0x${string}`,
): Promise<string | null> {
  const tag = idDataTag(idData);
  try {
    if (tag === 'this') {
      const [, adapter] = decodeAbiParameters([{ type: 'string' }, { type: 'address' }], idData);
      return `adapter ${(adapter as string).slice(0, 10)}…`;
    }
    if (tag === 'collateralToken') {
      const [, token] = decodeAbiParameters([{ type: 'string' }, { type: 'address' }], idData);
      const info = await fetchTokenInfo(chainId, token as Address).catch(() => null);
      return `collateral ${info?.symbol ?? (token as string).slice(0, 10) + '…'}`;
    }
    if (tag === 'this/marketParams') {
      const [, , params] = decodeAbiParameters(
        [
          { type: 'string' },
          { type: 'address' },
          {
            type: 'tuple',
            components: [
              { type: 'address', name: 'loanToken' },
              { type: 'address', name: 'collateralToken' },
              { type: 'address', name: 'oracle' },
              { type: 'address', name: 'irm' },
              { type: 'uint256', name: 'lltv' },
            ],
          },
        ],
        idData,
      );
      const p = params as { collateralToken: Address; loanToken: Address; lltv: bigint };
      const [collat, loan] = await Promise.all([
        fetchTokenInfo(chainId, p.collateralToken).catch(() => null),
        fetchTokenInfo(chainId, p.loanToken).catch(() => null),
      ]);
      const lltv = (Number(p.lltv) / 1e18) * 100;
      return `market ${collat?.symbol ?? '???'}/${loan?.symbol ?? '???'} @ ${lltv.toFixed(1)}%`;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function formatUnitsCompact(v: bigint, decimals: number): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  let out = whole.toLocaleString('en-US');
  if (frac > 0n) {
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, 4);
    if (fracStr) out += `.${fracStr}`;
  }
  return (neg ? '-' : '') + out;
}

async function fetchPendingActions(
  chainId: number,
  vaultAddress: Address,
  assetDecimals: number,
  assetSymbol: string,
): Promise<PendingActionsResult> {
  const client = getPublicClient(chainId) as PublicClient;

  // A full-history scan is far too expensive here: this vault sits 5.3M
  // blocks past its deployment, which is ~537 pages at Pharos's 10k window
  // — per event, on every mount. Bound the scan to the chain's standard
  // recent-history depth and report the covered window so the limit is
  // visible in the UI rather than silently truncating the queue.
  const latest = await client.getBlockNumber();
  const { defaultScan } = getLogWindowConfig(chainId);
  const deployment = await findDeploymentBlock(client, chainId, vaultAddress, latest);
  const floor = latest > defaultScan ? latest - defaultScan : 0n;
  const fromBlock = floor > deployment ? floor : deployment;

  const logs = await scanContractEvent(
    client,
    chainId,
    vaultAddress,
    SUBMIT_EVENT,
    fromBlock,
    latest,
  );

  // Dedupe by calldata — re-submitting the same action overwrites the slot.
  const byData = new Map<`0x${string}`, { selector: `0x${string}`; blockNumber: bigint | null }>();
  for (const log of logs) {
    const args = (log as { args?: { selector?: `0x${string}`; data?: `0x${string}` } }).args;
    if (!args?.data || !args.selector) continue;
    byData.set(args.data, {
      selector: args.selector,
      blockNumber: (log as { blockNumber?: bigint }).blockNumber ?? null,
    });
  }
  const window = { fromBlock, toBlock: latest, isFullHistory: fromBlock <= deployment };
  if (byData.size === 0) return { actions: [], ...window };

  // `executableAt` is the source of truth: executing or revoking zeroes it.
  const entries = [...byData.entries()];
  const liveExecutableAt = await Promise.all(
    entries.map(([data]) =>
      client
        .readContract({
          address: vaultAddress,
          abi: metaMorphoV2Abi,
          functionName: 'executableAt',
          args: [data],
        })
        .catch(() => 0n) as Promise<bigint>,
    ),
  );

  const pending: PendingV2Action[] = [];
  await Promise.all(
    entries.map(async ([data, meta], i) => {
      const executableAt = liveExecutableAt[i];
      if (executableAt === 0n) return; // executed or revoked

      let functionName = 'unknown';
      let target: string | null = null;
      let value: string | null = null;
      try {
        const decoded = decodeFunctionData({ abi: metaMorphoV2Abi, data });
        functionName = decoded.functionName;
        const args = (decoded.args ?? []) as readonly unknown[];

        if (/^(increase|decrease)(Absolute|Relative)Cap$/.test(functionName)) {
          target = await describeCapTarget(chainId, args[0] as `0x${string}`);
          const raw = args[1] as bigint;
          value = functionName.includes('Absolute')
            ? `${formatUnitsCompact(raw, assetDecimals)} ${assetSymbol}`
            : `${(Number(raw) / 1e16).toFixed(2)}%`;
        } else if (typeof args[0] === 'string' && args[0].startsWith('0x') && args[0].length === 42) {
          target = `${args[0].slice(0, 10)}…`;
        }
      } catch {
        /* unknown selector — still surface it as a raw pending entry */
      }

      pending.push({
        data,
        selector: meta.selector,
        executableAt,
        functionName,
        label: LABELS[functionName] ?? functionName,
        target,
        value,
        blockNumber: meta.blockNumber,
      });
    }),
  );

  return {
    actions: pending.sort((a, b) => (a.executableAt < b.executableAt ? -1 : 1)),
    ...window,
  };
}

export function useV2PendingActions(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  assetDecimals: number,
  assetSymbol: string,
  enabled = true,
) {
  return useQuery<PendingActionsResult>({
    queryKey: [...vaultKeys.adapters(chainId ?? 0, vaultAddress!), 'pending-timelock-actions'],
    queryFn: () => fetchPendingActions(chainId!, vaultAddress!, assetDecimals, assetSymbol),
    enabled: enabled && !!chainId && !!vaultAddress,
    staleTime: 30_000,
    // Advance pending → executable without a manual refresh.
    refetchInterval: 60_000,
  });
}
