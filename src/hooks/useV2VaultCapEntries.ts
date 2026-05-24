/**
 * PR 23 — discover every cap entry on a V2 vault by scanning past cap
 * events, regardless of allocation state.
 *
 * The V2 vault emits `IncreaseAbsoluteCap`, `IncreaseRelativeCap`,
 * `DecreaseAbsoluteCap`, `DecreaseRelativeCap` for every successful cap
 * change. Each event includes `idData` (the raw bytes argument passed to
 * `increase*Cap` / `decrease*Cap`) as a non-indexed event field, so a
 * single `getLogs` pass + bytes decode is enough to enumerate every cap
 * entry the vault has ever had — bucketed by level via the string tag at
 * the start of idData ("this" → adapter, "collateralToken" → collateral,
 * "this/marketParams" → market).
 *
 * For each discovered entry we then read the *current* `absoluteCap`,
 * `relativeCap`, and `allocation` (one batched multicall'd-via-Promise.all
 * read). Entries whose caps have been zeroed out still show up here —
 * that's intentional. The UI can hide them if desired.
 *
 * Used by `V2CapsTab` to render the three Morpho-curator-style tables
 * (Adapter / Collateral Token / Market) even before any allocation has
 * landed.
 */
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { decodeAbiParameters, parseAbiItem } from 'viem';
import { getPublicClient, fetchTokenInfo } from '../lib/data/rpcClient';
import { metaMorphoV2Abi } from '../lib/contracts/metaMorphoV2Abi';
import { computeMarketId } from '../lib/market/marketId';
import { vaultKeys } from '../lib/queryKeys';
import type { TokenInfo, MarketParams } from '../types';

export interface AdapterCapEntry {
  level: 'adapter';
  /** Cap-map storage key (keccak256 of idData). */
  id: `0x${string}`;
  idData: `0x${string}`;
  adapter: Address;
  absoluteCap: bigint;
  relativeCap: bigint;
  allocation: bigint;
}

export interface CollateralCapEntry {
  level: 'collateral';
  id: `0x${string}`;
  idData: `0x${string}`;
  collateralToken: TokenInfo;
  absoluteCap: bigint;
  relativeCap: bigint;
  allocation: bigint;
}

export interface MarketCapEntry {
  level: 'market';
  /** Cap-map storage key (keccak256 of idData). Used by V2 vault to look up caps. */
  id: `0x${string}`;
  /** The Morpho Blue market ID (keccak256(abi.encode(MarketParams))). Used to read market state. */
  marketId: `0x${string}`;
  idData: `0x${string}`;
  adapter: Address;
  params: MarketParams;
  /** The market's loan-token / collateral-token info, if resolvable. */
  collateralToken: TokenInfo | null;
  absoluteCap: bigint;
  relativeCap: bigint;
  allocation: bigint;
}

export interface VaultCapEntries {
  adapterCaps: AdapterCapEntry[];
  collateralCaps: CollateralCapEntry[];
  marketCaps: MarketCapEntry[];
}

const CAP_READ_ABI = [
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'absoluteCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'relativeCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'allocation', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

/** Decode the leading `string tag` from a cap-map idData payload. */
function decodeIdDataTag(idData: `0x${string}`): string | null {
  try {
    // idData starts with the same encoding as `abi.decode(idData, (string, …))`
    // — we just decode the leading string. The remaining slot(s) are
    // level-specific and decoded separately below.
    const [tag] = decodeAbiParameters([{ type: 'string' }, { type: 'address' }], idData);
    return tag;
  } catch {
    // Some idData payloads are longer (market level adds a tuple); the
    // leading string still decodes via the partial decode above. If even
    // that fails, classify as unknown.
    try {
      // Manual decode: skip the offset word (0x20), read the string length,
      // then the string bytes (padded to 32).
      const hex = idData.slice(2);
      const offset = Number(BigInt('0x' + hex.slice(0, 64)));
      const lenStart = offset * 2;
      const length = Number(BigInt('0x' + hex.slice(lenStart, lenStart + 64)));
      const strHex = hex.slice(lenStart + 64, lenStart + 64 + length * 2);
      return Buffer.from(strHex, 'hex').toString('utf8');
    } catch {
      return null;
    }
  }
}

function decodeAdapterIdData(idData: `0x${string}`): Address {
  const [, adapter] = decodeAbiParameters(
    [{ type: 'string' }, { type: 'address' }],
    idData,
  );
  return adapter as Address;
}

function decodeCollateralIdData(idData: `0x${string}`): Address {
  const [, token] = decodeAbiParameters(
    [{ type: 'string' }, { type: 'address' }],
    idData,
  );
  return token as Address;
}

function decodeMarketIdData(idData: `0x${string}`): { adapter: Address; params: MarketParams } {
  const [, adapter, params] = decodeAbiParameters(
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
  return {
    adapter: adapter as Address,
    params: params as MarketParams,
  };
}

const INCREASE_ABS_EVENT = parseAbiItem(
  'event IncreaseAbsoluteCap(bytes32 indexed id, bytes idData, uint256 newAbsoluteCap)',
);
const INCREASE_REL_EVENT = parseAbiItem(
  'event IncreaseRelativeCap(bytes32 indexed id, bytes idData, uint256 newRelativeCap)',
);

async function fetchVaultCapEntries(
  chainId: number,
  vaultAddress: Address,
): Promise<VaultCapEntries> {
  const client = getPublicClient(chainId);

  // Scan increase events only — they create a cap-map slot; decreases just
  // mutate an existing slot, so they always have a matching `Increase…` in
  // the history (a slot can't be decreased before being set).
  const [absLogs, relLogs] = await Promise.all([
    client.getLogs({
      address: vaultAddress,
      event: INCREASE_ABS_EVENT,
      fromBlock: 0n,
      toBlock: 'latest',
    }),
    client.getLogs({
      address: vaultAddress,
      event: INCREASE_REL_EVENT,
      fromBlock: 0n,
      toBlock: 'latest',
    }),
  ]);

  // Collect unique (id, idData) pairs. `id` is the indexed topic = keccak256(idData),
  // so multiple events for the same entry coalesce.
  const seen = new Map<`0x${string}`, `0x${string}`>(); // id → idData
  for (const log of [...absLogs, ...relLogs]) {
    const id = log.args.id as `0x${string}` | undefined;
    const idData = log.args.idData as `0x${string}` | undefined;
    if (id && idData && !seen.has(id)) {
      seen.set(id, idData);
    }
  }

  // Classify each entry by its idData tag.
  const adapterIds: { id: `0x${string}`; idData: `0x${string}`; adapter: Address }[] = [];
  const collateralIds: { id: `0x${string}`; idData: `0x${string}`; collateral: Address }[] = [];
  const marketIds: { id: `0x${string}`; idData: `0x${string}`; adapter: Address; params: MarketParams }[] = [];

  for (const [id, idData] of seen.entries()) {
    const tag = decodeIdDataTag(idData);
    try {
      if (tag === 'this') {
        adapterIds.push({ id, idData, adapter: decodeAdapterIdData(idData) });
      } else if (tag === 'collateralToken') {
        collateralIds.push({ id, idData, collateral: decodeCollateralIdData(idData) });
      } else if (tag === 'this/marketParams') {
        const decoded = decodeMarketIdData(idData);
        marketIds.push({ id, idData, ...decoded });
      }
      // unknown tags → skip (forward-compat with future cap levels)
    } catch {
      // malformed idData → skip
    }
  }

  // Read current values for each entry. Group reads to limit RPC fan-out.
  const readEntry = async (id: `0x${string}`) => {
    const [absoluteCap, relativeCap, allocation] = await Promise.all([
      client.readContract({ address: vaultAddress, abi: CAP_READ_ABI, functionName: 'absoluteCap', args: [id] }).catch(() => 0n) as Promise<bigint>,
      client.readContract({ address: vaultAddress, abi: CAP_READ_ABI, functionName: 'relativeCap', args: [id] }).catch(() => 0n) as Promise<bigint>,
      client.readContract({ address: vaultAddress, abi: CAP_READ_ABI, functionName: 'allocation', args: [id] }).catch(() => 0n) as Promise<bigint>,
    ]);
    return { absoluteCap, relativeCap, allocation };
  };

  // Build the three buckets concurrently, enriching tokens where we can.
  const [adapterCaps, collateralCaps, marketCaps] = await Promise.all([
    Promise.all(
      adapterIds.map(async (a): Promise<AdapterCapEntry> => ({
        level: 'adapter',
        id: a.id,
        idData: a.idData,
        adapter: a.adapter,
        ...(await readEntry(a.id)),
      })),
    ),
    Promise.all(
      collateralIds.map(async (c): Promise<CollateralCapEntry> => {
        const [reads, token] = await Promise.all([
          readEntry(c.id),
          fetchTokenInfo(chainId, c.collateral).catch(() => ({
            address: c.collateral, name: 'Unknown', symbol: '???', decimals: 18,
          })),
        ]);
        return {
          level: 'collateral',
          id: c.id,
          idData: c.idData,
          collateralToken: token,
          ...reads,
        };
      }),
    ),
    Promise.all(
      marketIds.map(async (m): Promise<MarketCapEntry> => {
        const [reads, collateralToken] = await Promise.all([
          readEntry(m.id),
          fetchTokenInfo(chainId, m.params.collateralToken).catch(() => null),
        ]);
        return {
          level: 'market',
          id: m.id,
          marketId: computeMarketId(m.params),
          idData: m.idData,
          adapter: m.adapter,
          params: m.params,
          collateralToken,
          ...reads,
        };
      }),
    ),
  ]);

  return { adapterCaps, collateralCaps, marketCaps };
}

export function useV2VaultCapEntries(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
) {
  return useQuery<VaultCapEntries>({
    queryKey: [...vaultKeys.adapters(chainId ?? 0, vaultAddress!), 'all-cap-entries'],
    queryFn: () => fetchVaultCapEntries(chainId!, vaultAddress!),
    enabled: !!chainId && !!vaultAddress,
    staleTime: 30_000,
  });
}

// Re-exports for tests + future direct callers.
export { decodeIdDataTag, metaMorphoV2Abi };
