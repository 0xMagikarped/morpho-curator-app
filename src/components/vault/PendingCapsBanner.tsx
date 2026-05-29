/**
 * V1 MetaMorpho pendingCap surface.
 *
 * The Caps tab renders pending caps inline per-market, but those rows are
 * easy to miss when a curator has dozens of markets — especially on
 * RPC-only chains like SEI where the curator may not realise a pending
 * submission exists until the 3-day timelock has already elapsed.
 *
 * This banner sits in the Overview alongside the V2 registry alert and
 * surfaces *every* pendingCap entry for the connected vault, with a
 * countdown + role-gated Accept / Revoke actions. Reuses the existing
 * `useDiscoveredMarketStatuses` infrastructure so we get pendingCap reads
 * for free across queue markets + scanner-discovered markets matching
 * the vault asset.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Address } from 'viem';
import { Clock } from 'lucide-react';
import {
  useReadContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useGuardedWriteContract } from '../../hooks/useGuardedWriteContract';
import {
  useVaultAllocation,
  useDiscoveredMarketStatuses,
  useVaultInfo,
  useVaultRole,
} from '../../lib/hooks/useVault';
import { useMarketScanner } from '../../lib/hooks/useMarketScanner';
import { useVaultSubmitCapMarkets } from '../../lib/hooks/useVaultSubmitCapMarkets';
import { vaultKeys } from '../../lib/queryKeys';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { morphoBlueAbi, metaMorphoV1Abi } from '../../lib/contracts/abis';
import { getChainConfig } from '../../config/chains';
import { formatTokenAmount } from '../../lib/utils/format';

interface PendingCapsBannerProps {
  chainId: number;
  vaultAddress: Address;
  vaultAsset: Address;
  assetSymbol: string;
  assetDecimals: number;
  /** Pass `vault.version === 'v1'` so V2 vaults (different timelock model) skip this. */
  isV1: boolean;
}

export function PendingCapsBanner({ chainId, vaultAddress, vaultAsset, assetSymbol, assetDecimals, isV1 }: PendingCapsBannerProps) {
  // Moolah uses instant `setCap` so there's no pendingCap state at all.
  const isMorpho = getChainConfig(chainId)?.protocol === 'morpho';
  const role = useVaultRole(chainId, vaultAddress);
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const { data: allocation } = useVaultAllocation(chainId, vaultAddress);
  const { data: allChainMarkets } = useMarketScanner(chainId);
  const timelock = vault?.version === 'v1' ? vault.timelock : 0n;
  const { data: submitCapMarkets } = useVaultSubmitCapMarkets(
    chainId,
    vaultAddress,
    timelock,
    isMorpho && isV1 && !!vault,
  );

  // Candidate set: every market that could plausibly hold a pendingCap for
  // this vault. Three sources, unioned:
  //   1. Vault's supply / withdraw queues (markets the vault already touches).
  //   2. Scanner-discovered markets whose loan token matches the vault asset
  //      (markets the curator might be enabling next).
  //   3. Recent `SubmitCap` event emitters from this vault — the
  //      catch-all that handles fresh markets the global scanner hasn't
  //      indexed yet (the SEI miss the user flagged).
  const candidateIds = useMemo<`0x${string}`[]>(() => {
    if (!isMorpho || !isV1) return [];
    const set = new Set<`0x${string}`>();
    for (const id of allocation?.supplyQueue ?? []) set.add(id);
    for (const id of allocation?.withdrawQueue ?? []) set.add(id);
    if (allChainMarkets && vaultAsset) {
      const assetLower = vaultAsset.toLowerCase();
      for (const m of allChainMarkets) {
        if (m.loanToken.toLowerCase() === assetLower) set.add(m.marketId);
      }
    }
    for (const id of submitCapMarkets ?? []) set.add(id);
    return [...set];
  }, [allocation, allChainMarkets, vaultAsset, isV1, isMorpho, submitCapMarkets]);

  const { data: statuses } = useDiscoveredMarketStatuses(chainId, vaultAddress, candidateIds);

  const pending = useMemo(
    () => (statuses ?? []).filter((s) => s.pendingCap !== null),
    [statuses],
  );

  const [nowSec, setNowSec] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const t = setInterval(() => setNowSec(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(t);
  }, []);

  if (!isV1 || !isMorpho || pending.length === 0) return null;

  return (
    <Card className="border-warning/30 bg-warning/5">
      <div className="flex items-center gap-2 mb-3">
        <Clock size={14} className="text-warning" />
        <span className="text-xs font-medium text-warning uppercase tracking-wider">
          Pending Cap Submissions
        </span>
        <Badge variant="warning">{pending.length}</Badge>
      </div>
      <div className="space-y-2">
        {pending.map((s) => (
          <PendingCapRow
            key={s.marketId}
            chainId={chainId}
            vaultAddress={vaultAddress}
            marketId={s.marketId}
            value={s.pendingCap!.value}
            validAt={s.pendingCap!.validAt}
            assetSymbol={assetSymbol}
            assetDecimals={assetDecimals}
            nowSec={nowSec}
            isOwnerOrCurator={role.isOwner || role.isCurator}
            // V1 emergency role == guardian (per useVaultRole).
            isGuardian={role.isEmergencyRole}
          />
        ))}
      </div>
    </Card>
  );
}

function PendingCapRow({
  chainId,
  vaultAddress,
  marketId,
  value,
  validAt,
  assetSymbol,
  assetDecimals,
  nowSec,
  isOwnerOrCurator,
  isGuardian,
}: {
  chainId: number;
  vaultAddress: Address;
  marketId: `0x${string}`;
  value: bigint;
  validAt: bigint;
  assetSymbol: string;
  assetDecimals: number;
  nowSec: bigint;
  isOwnerOrCurator: boolean;
  isGuardian: boolean;
}) {
  const morphoBlue = getChainConfig(chainId)?.morphoBlue;
  const queryClient = useQueryClient();

  // Accept needs the full MarketParams tuple — read from Morpho Blue.
  const { data: marketParams } = useReadContract({
    address: morphoBlue,
    abi: morphoBlueAbi,
    functionName: 'idToMarketParams',
    args: [marketId],
    chainId,
    query: { enabled: !!morphoBlue, staleTime: Infinity },
  });

  const { writeContract, data: hash, isPending } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const busy = isPending || isConfirming;

  useEffect(() => {
    if (!isSuccess) return;
    queryClient.invalidateQueries({ queryKey: vaultKeys.fullData(chainId, vaultAddress) });
    queryClient.invalidateQueries({ queryKey: vaultKeys.pending(chainId, vaultAddress) });
    queryClient.invalidateQueries({ queryKey: vaultKeys.discoveredStatuses(chainId, vaultAddress) });
  }, [isSuccess, chainId, vaultAddress, queryClient]);

  const ready = validAt <= nowSec;
  const countdown = ready ? null : formatCountdown(Number(validAt - nowSec));

  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="min-w-0 space-y-0.5">
        <div className="text-xs text-text-primary flex items-center gap-2 flex-wrap">
          <span>
            New cap{' '}
            <span className="font-mono">
              {formatTokenAmount(value, assetDecimals)} {assetSymbol}
            </span>
          </span>
          <span className="font-mono text-[10px] text-text-tertiary">
            {marketId.slice(0, 10)}…{marketId.slice(-4)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {ready ? (
            <Badge variant="success">Ready</Badge>
          ) : (
            <Badge variant="warning">{countdown}</Badge>
          )}
          <span className="text-[10px] text-text-tertiary">
            valid at {new Date(Number(validAt) * 1000).toUTCString()}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isGuardian && (
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            disabled={busy}
            loading={busy}
            onClick={() =>
              writeContract({
                address: vaultAddress,
                abi: metaMorphoV1Abi,
                functionName: 'revokePendingCap',
                args: [marketId],
                chainId,
              })
            }
          >
            Revoke
          </Button>
        )}
        {isOwnerOrCurator && (
          <Button
            size="sm"
            disabled={!ready || !marketParams || busy}
            loading={busy}
            onClick={() => {
              if (!marketParams) return;
              writeContract({
                address: vaultAddress,
                abi: metaMorphoV1Abi,
                functionName: 'acceptCap',
                args: [marketParams],
                chainId,
              });
            }}
          >
            Accept
          </Button>
        )}
      </div>
    </div>
  );
}

function formatCountdown(diffSec: number): string {
  if (diffSec <= 0) return 'ready';
  const d = Math.floor(diffSec / 86400);
  const h = Math.floor((diffSec % 86400) / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
