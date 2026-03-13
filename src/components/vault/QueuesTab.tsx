import { useState, useMemo, useCallback } from 'react';
import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { ArrowRightLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { SectionHeader } from '../ui/SectionHeader';
import { useVaultInfo, useVaultAllocation, useVaultMarketsFromApi, useVaultRole } from '../../lib/hooks/useVault';
import { useChainGuard } from '../../lib/hooks/useChainGuard';
import { formatTokenAmount } from '../../lib/utils/format';
import { metaMorphoV1Abi } from '../../lib/contracts/abis';
import { QueueList, type QueueMarketItem } from './queues/QueueList';
import { QueueSuggestions } from './queues/QueueSuggestions';

interface QueuesTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function QueuesTab({ chainId, vaultAddress }: QueuesTabProps) {
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const { data: allocation, isLoading: allocLoading } = useVaultAllocation(chainId, vaultAddress);
  const { data: markets, isLoading: marketsLoading } = useVaultMarketsFromApi(chainId, vaultAddress);
  const role = useVaultRole(chainId, vaultAddress);
  const { isMismatch, requestSwitch } = useChainGuard(chainId);

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const [editingSupply, setEditingSupply] = useState(false);
  const [editingWithdraw, setEditingWithdraw] = useState(false);

  const decimals = vault?.assetInfo.decimals ?? 18;
  const assetSymbol = vault?.assetInfo.symbol ?? '';
  const canEdit = role.isAllocator || role.isOwner;

  // Build market lookup from API data
  const marketLookup = useMemo(() => {
    const map = new Map<string, {
      label: string;
      supplyAssets: bigint;
      supplyCap: bigint;
      availableLiquidity: bigint;
      supplyAPY: number;
      utilization: number;
    }>();

    if (!markets || !allocation) return map;

    for (const m of markets) {
      const collateralSymbol = m.collateralToken?.symbol ?? '???';
      const loanSymbol = m.loanToken?.symbol ?? '???';
      const lltv = Number(m.params.lltv) / 1e18 * 100;
      const label = `${collateralSymbol}/${loanSymbol} ${lltv.toFixed(lltv % 1 === 0 ? 0 : 1)}% LLTV`;

      // Find allocation state for this market
      const alloc = allocation.allocations.find((a) => a.marketId === m.id);

      map.set(m.id, {
        label,
        supplyAssets: alloc?.supplyAssets ?? 0n,
        supplyCap: alloc?.supplyCap ?? 0n,
        availableLiquidity: alloc?.availableLiquidity ?? 0n,
        supplyAPY: m.supplyAPY,
        utilization: m.utilization,
      });
    }
    return map;
  }, [markets, allocation]);

  // Build queue items from market IDs
  const buildQueueItems = useCallback(
    (ids: `0x${string}`[]): QueueMarketItem[] =>
      ids.map((id) => {
        const info = marketLookup.get(id);
        return {
          marketId: id,
          label: info?.label ?? `${id.slice(0, 10)}...`,
          supplyAssets: info?.supplyAssets ?? 0n,
          supplyCap: info?.supplyCap ?? 0n,
          availableLiquidity: info?.availableLiquidity ?? 0n,
          supplyAPY: info?.supplyAPY ?? 0,
          utilization: info?.utilization ?? 0,
        };
      }),
    [marketLookup],
  );

  // Current queues from allocation data
  const originalSupplyQueue = useMemo(
    () => buildQueueItems(allocation?.supplyQueue ?? []),
    [allocation?.supplyQueue, buildQueueItems],
  );
  const originalWithdrawQueue = useMemo(
    () => buildQueueItems(allocation?.withdrawQueue ?? []),
    [allocation?.withdrawQueue, buildQueueItems],
  );

  // Editable state
  const [supplyDraft, setSupplyDraft] = useState<QueueMarketItem[]>([]);
  const [withdrawDraft, setWithdrawDraft] = useState<QueueMarketItem[]>([]);

  const activeSupply = editingSupply ? supplyDraft : originalSupplyQueue;
  const activeWithdraw = editingWithdraw ? withdrawDraft : originalWithdrawQueue;

  // Removable withdraw markets: 0 supply
  const removableWithdrawMarkets = useMemo(() => {
    const set = new Set<string>();
    for (const item of originalWithdrawQueue) {
      if (item.supplyAssets === 0n) set.add(item.marketId);
    }
    return set;
  }, [originalWithdrawQueue]);

  // Markets with non-zero cap not in supply queue (for add)
  const addableSupplyMarkets = useMemo(() => {
    if (!allocation || !markets) return [];
    const inQueue = new Set(activeSupply.map((q) => q.marketId));
    return markets
      .filter((m) => {
        const alloc = allocation.allocations.find((a) => a.marketId === m.id);
        return alloc && alloc.supplyCap > 0n && !inQueue.has(m.id);
      })
      .map((m) => buildQueueItems([m.id])[0]);
  }, [allocation, markets, activeSupply, buildQueueItems]);

  // ---- Edit handlers ----

  const startEditSupply = () => {
    setSupplyDraft([...originalSupplyQueue]);
    setEditingSupply(true);
  };

  const startEditWithdraw = () => {
    setWithdrawDraft([...originalWithdrawQueue]);
    setEditingWithdraw(true);
  };

  const cancelEditSupply = () => {
    setEditingSupply(false);
    setSupplyDraft([]);
  };

  const cancelEditWithdraw = () => {
    setEditingWithdraw(false);
    setWithdrawDraft([]);
  };

  const moveSupply = (from: number, to: number) => {
    if (to < 0 || to >= supplyDraft.length) return;
    const arr = [...supplyDraft];
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    setSupplyDraft(arr);
  };

  const moveWithdraw = (from: number, to: number) => {
    if (to < 0 || to >= withdrawDraft.length) return;
    const arr = [...withdrawDraft];
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    setWithdrawDraft(arr);
  };

  const removeSupply = (index: number) => {
    setSupplyDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const removeWithdraw = (index: number) => {
    const item = withdrawDraft[index];
    if (!removableWithdrawMarkets.has(item.marketId)) return;
    setWithdrawDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const addToSupply = (item: QueueMarketItem) => {
    setSupplyDraft((prev) => [...prev, item]);
  };

  // ---- Save handlers ----

  const supplyChanged = useMemo(() => {
    if (!editingSupply) return false;
    if (supplyDraft.length !== originalSupplyQueue.length) return true;
    return supplyDraft.some((m, i) => m.marketId !== originalSupplyQueue[i]?.marketId);
  }, [editingSupply, supplyDraft, originalSupplyQueue]);

  const withdrawChanged = useMemo(() => {
    if (!editingWithdraw) return false;
    if (withdrawDraft.length !== originalWithdrawQueue.length) return true;
    return withdrawDraft.some((m, i) => m.marketId !== originalWithdrawQueue[i]?.marketId);
  }, [editingWithdraw, withdrawDraft, originalWithdrawQueue]);

  const saveSupplyQueue = () => {
    const newQueue = supplyDraft.map((m) => m.marketId);
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'setSupplyQueue',
      args: [newQueue],
    });
  };

  const saveWithdrawQueue = () => {
    // Compute index permutation: desired[i] was at original index X
    const originalIds = originalWithdrawQueue.map((m) => m.marketId);
    const indexes = withdrawDraft.map((m) => {
      const idx = originalIds.indexOf(m.marketId);
      return BigInt(idx);
    });
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'updateWithdrawQueue',
      args: [indexes],
    });
  };

  // Suggestion handlers
  const applySuggestedSupply = (reordered: QueueMarketItem[]) => {
    if (!editingSupply) startEditSupply();
    setSupplyDraft(reordered);
  };

  const applySuggestedWithdraw = (reordered: QueueMarketItem[]) => {
    if (!editingWithdraw) startEditWithdraw();
    setWithdrawDraft(reordered);
  };

  const isLoading = allocLoading || marketsLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => <div key={i} className="h-32 animate-shimmer bg-bg-hover" />)}
      </div>
    );
  }

  // V2 guard
  if (vault?.version === 'v2') {
    return (
      <Card className="py-8 text-center">
        <p className="text-text-secondary text-sm">V2 vaults use adapters, not market queues.</p>
        <p className="text-text-tertiary text-xs mt-1">
          Check the <span className="text-accent-primary font-medium">Adapters</span> tab.
        </p>
      </Card>
    );
  }

  const totalSupplied = allocation?.totalAllocated ?? 0n;
  const totalCap = originalSupplyQueue.reduce((s, m) => s + m.supplyCap, 0n);
  const totalAvailable = originalWithdrawQueue.reduce((s, m) => s + m.availableLiquidity, 0n);

  return (
    <div className="space-y-4">
      {/* Network mismatch */}
      {isMismatch && (
        <div className="flex items-center justify-between bg-warning/10 border border-warning/20 px-3 py-2">
          <span className="text-xs text-warning">Wrong network. Switch to submit transactions.</span>
          <Button size="sm" variant="secondary" onClick={requestSwitch}>Switch</Button>
        </div>
      )}

      {/* Success banner */}
      {isSuccess && (
        <div className="bg-success/10 border border-success/20 px-3 py-2 text-xs text-success">
          Queue updated successfully. Refreshing data...
        </div>
      )}

      {/* Suggestions (only in edit mode) */}
      <QueueSuggestions
        supplyQueue={editingSupply ? supplyDraft : originalSupplyQueue}
        withdrawQueue={editingWithdraw ? withdrawDraft : originalWithdrawQueue}
        onApplySupply={applySuggestedSupply}
        onApplyWithdraw={applySuggestedWithdraw}
        editing={editingSupply || editingWithdraw}
      />

      {/* ── Supply Queue ── */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Supply Queue</CardTitle>
            <p className="text-[10px] text-text-tertiary mt-0.5">
              New deposits are routed to markets in this order.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge>{activeSupply.length} market{activeSupply.length !== 1 ? 's' : ''}</Badge>
            {canEdit && !editingSupply && (
              <Button size="sm" variant="secondary" onClick={startEditSupply}>
                Edit Queue
              </Button>
            )}
          </div>
        </CardHeader>

        <QueueList
          items={activeSupply}
          editing={editingSupply}
          mode="supply"
          decimals={decimals}
          assetSymbol={assetSymbol}
          onMove={editingSupply ? moveSupply : undefined}
          onRemove={editingSupply ? removeSupply : undefined}
        />

        {/* Add market button (edit mode) */}
        {editingSupply && addableSupplyMarkets.length > 0 && (
          <div className="mt-3 border-t border-border-subtle pt-3">
            <p className="text-[10px] text-text-tertiary uppercase tracking-wider mb-1.5">
              Add market to supply queue
            </p>
            <div className="space-y-1">
              {addableSupplyMarkets.map((m) => (
                <div
                  key={m.marketId}
                  className="flex items-center justify-between px-2 py-1.5 bg-bg-hover/30 text-xs"
                >
                  <span className="text-text-secondary">{m.label}</span>
                  <Button size="sm" variant="ghost" onClick={() => addToSupply(m)}>
                    + Add
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Preview + save (edit mode) */}
        {editingSupply && (
          <div className="mt-3 border-t border-border-subtle pt-3 space-y-2">
            {supplyChanged && (
              <QueueDiffPreview
                label="Supply"
                before={originalSupplyQueue}
                after={supplyDraft}
              />
            )}
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={cancelEditSupply}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={saveSupplyQueue}
                disabled={!supplyChanged || isMismatch || isPending || isConfirming}
                loading={isPending || isConfirming}
              >
                Save Supply Queue
              </Button>
            </div>
          </div>
        )}

        {/* Summary */}
        {!editingSupply && activeSupply.length > 0 && (
          <div className="flex gap-4 mt-3 pt-2 border-t border-border-subtle text-[10px] text-text-tertiary">
            <span>Total Cap: <span className="font-mono text-text-secondary">{formatTokenAmount(totalCap, decimals)} {assetSymbol}</span></span>
            <span>Total Supplied: <span className="font-mono text-text-secondary">{formatTokenAmount(totalSupplied, decimals)} {assetSymbol}</span></span>
          </div>
        )}
      </Card>

      {/* ── Withdraw Queue ── */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Withdraw Queue</CardTitle>
            <p className="text-[10px] text-text-tertiary mt-0.5">
              Withdrawals pull liquidity from markets in this order.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge>{activeWithdraw.length} market{activeWithdraw.length !== 1 ? 's' : ''}</Badge>
            {canEdit && !editingWithdraw && (
              <Button size="sm" variant="secondary" onClick={startEditWithdraw}>
                Edit Queue
              </Button>
            )}
          </div>
        </CardHeader>

        <QueueList
          items={activeWithdraw}
          editing={editingWithdraw}
          mode="withdraw"
          decimals={decimals}
          assetSymbol={assetSymbol}
          onMove={editingWithdraw ? moveWithdraw : undefined}
          onRemove={editingWithdraw ? removeWithdraw : undefined}
          removableMarkets={removableWithdrawMarkets}
        />

        {/* Preview + save (edit mode) */}
        {editingWithdraw && (
          <div className="mt-3 border-t border-border-subtle pt-3 space-y-2">
            {withdrawChanged && (
              <QueueDiffPreview
                label="Withdraw"
                before={originalWithdrawQueue}
                after={withdrawDraft}
              />
            )}
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={cancelEditWithdraw}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={saveWithdrawQueue}
                disabled={!withdrawChanged || isMismatch || isPending || isConfirming}
                loading={isPending || isConfirming}
              >
                Save Withdraw Queue
              </Button>
            </div>
          </div>
        )}

        {/* Summary */}
        {!editingWithdraw && activeWithdraw.length > 0 && (
          <div className="mt-3 pt-2 border-t border-border-subtle text-[10px] text-text-tertiary">
            <span>Total Available Liquidity: <span className="font-mono text-text-secondary">{formatTokenAmount(totalAvailable, decimals)} {assetSymbol}</span></span>
          </div>
        )}
      </Card>

      {/* ── Queue Comparison ── */}
      {!editingSupply && !editingWithdraw && originalSupplyQueue.length > 0 && originalWithdrawQueue.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ArrowRightLeft size={14} className="text-text-tertiary" />
              <CardTitle>Queue Comparison</CardTitle>
            </div>
          </CardHeader>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wider mb-1.5">
                Supply (deposit priority)
              </p>
              {originalSupplyQueue.map((m, i) => (
                <div key={`s-${m.marketId}-${i}`} className="text-xs text-text-secondary py-0.5">
                  <span className="font-mono text-text-tertiary mr-1.5">{i + 1}.</span>
                  {m.label}
                </div>
              ))}
            </div>
            <div>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wider mb-1.5">
                Withdraw (pull priority)
              </p>
              {originalWithdrawQueue.map((m, i) => (
                <div key={`w-${m.marketId}-${i}`} className="text-xs text-text-secondary py-0.5">
                  <span className="font-mono text-text-tertiary mr-1.5">{i + 1}.</span>
                  {m.label}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---- Before/After diff preview ----

function QueueDiffPreview({
  label,
  before,
  after,
}: {
  label: string;
  before: QueueMarketItem[];
  after: QueueMarketItem[];
}) {
  const changedCount = after.reduce((count, m, i) => {
    return count + (m.marketId !== before[i]?.marketId ? 1 : 0);
  }, 0) + Math.abs(after.length - before.length);

  const shortLabel = (m: QueueMarketItem) => m.label.split('/')[0] ?? m.label.slice(0, 8);

  return (
    <div className="bg-bg-hover/50 px-3 py-2 text-[10px]">
      <p className="text-text-tertiary uppercase tracking-wider mb-1">{label} Queue Preview</p>
      <div className="space-y-0.5">
        <p className="text-text-tertiary">
          Before: {before.map((m) => shortLabel(m)).join(' \u2192 ')}
        </p>
        <p className="text-text-primary">
          After: {after.map((m) => shortLabel(m)).join(' \u2192 ')}
        </p>
      </div>
      <p className="text-text-tertiary mt-1">
        {changedCount} position{changedCount !== 1 ? 's' : ''} changed
        {after.length !== before.length && ` (${after.length > before.length ? '+' : ''}${after.length - before.length} market${Math.abs(after.length - before.length) !== 1 ? 's' : ''})`}
      </p>
    </div>
  );
}
