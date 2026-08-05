/**
 * Pending timelocked actions on a Vault V2 — the V2 counterpart to
 * `PendingCapsBanner` (which is V1-only).
 *
 * Before this, a `submit()` produced no visible state anywhere in the app:
 * the queue lives in `executableAt[keccak(calldata)]`, which nothing
 * enumerated, so a curator who queued a cap increase saw an unchanged Caps
 * tab and no indication a timelock was running.
 *
 * Each row ticks down live and, once matured, offers Execute — which
 * re-sends the exact submitted calldata (the vault self-checks
 * `executableAt`).
 *
 * Execute and Revoke are gated DIFFERENTLY, and conflating them is a bug this
 * panel shipped: it required owner/curator for both.
 *
 *   Execute — permissionless. `submit()` is the gated step; the `timelocked`
 *     modifier on the target function only checks that `executableAt` is set
 *     and matured, then clears it. Anyone may push a matured action through.
 *   Revoke  — restricted to owner / curator / sentinel.
 *
 * Verified against RockawayX USDC on Pharos (0x047cd0a9…02e5): `eth_call` of
 * both queued `increaseAbsoluteCap` payloads from a role-less address returns
 * success, while `revoke(bytes)` from the same address reverts `Unauthorized()`
 * (0x82b42900) and succeeds from the curator.
 */
import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { decodeFunctionData, type Address } from 'viem';
import { useAccount, useReadContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useGuardedWriteContract } from '../../hooks/useGuardedWriteContract';
import { useVaultPermissions } from '../../hooks/useVaultPermissions';
import { useV2PendingActions, type PendingV2Action } from '../../lib/hooks/useV2PendingActions';
import { useQueuedActionPreflight } from '../../lib/hooks/useQueuedActionPreflight';
import { metaMorphoV2Abi } from '../../lib/contracts/metaMorphoV2Abi';
import { vaultKeys } from '../../lib/queryKeys';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { TimelockCountdown } from './TimelockCountdown';
import { executeBlockedReason } from '../../lib/vault/timelockGates';

interface Props {
  chainId: number;
  vaultAddress: Address;
  assetDecimals: number;
  assetSymbol: string;
  /** Pass `vault.version === 'v2'`; V1 uses PendingCapsBanner instead. */
  isV2: boolean;
  /** Render even when the queue is empty (used on the Timelocks tab). */
  alwaysShow?: boolean;
}

export function V2PendingTimelockPanel({
  chainId,
  vaultAddress,
  assetDecimals,
  assetSymbol,
  isV2,
  alwaysShow = false,
}: Props) {
  const queryClient = useQueryClient();
  const permissions = useVaultPermissions(chainId, vaultAddress);
  const { address: connectedAddress } = useAccount();
  const { data: isSentinel } = useReadContract({
    address: vaultAddress,
    abi: metaMorphoV2Abi,
    functionName: 'isSentinel',
    args: connectedAddress ? [connectedAddress] : undefined,
    chainId,
    query: { enabled: isV2 && !!connectedAddress, staleTime: 5 * 60_000 },
  });
  const { data: result, isLoading, isBackfilling, backfillError } = useV2PendingActions(
    chainId,
    vaultAddress,
    assetDecimals,
    assetSymbol,
    isV2,
  );

  const {
    writeContract,
    data: txHash,
    isPending,
    error,
    simulateError,
    isSimulating,
    walletError,
    isConnected,
  } = useGuardedWriteContract();

  const { byData: preflight, isChecking } = useQueuedActionPreflight(
    chainId,
    vaultAddress,
    result?.actions ?? [],
    connectedAddress,
    isV2,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which row fired the current write. Without this, `isPending` is shared
  // and one click disables EVERY row — including forever if the wallet
  // request is left hanging (a Safe proposal never auto-resolves).
  const [activeData, setActiveData] = useState<`0x${string}` | null>(null);
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!isPending && !isSimulating) setActiveData((d) => (isSuccess ? null : d));
  }, [isPending, isSimulating, isSuccess]);

  useEffect(() => {
    if (!isSuccess) return;
    // Executed rows leave the queue; carrying their ticks over would re-select
    // whatever slid into their place.
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: vaultKeys.detail(chainId, vaultAddress) });
    queryClient.invalidateQueries({ queryKey: vaultKeys.adapters(chainId, vaultAddress) });
  }, [isSuccess, queryClient, chainId, vaultAddress]);

  const actions = result?.actions ?? [];

  // Hidden entirely when there is nothing queued, except on the Timelocks
  // tab (`alwaysShow`) where the scan-coverage note is itself the useful
  // information — an old queued action outside the window would otherwise
  // be invisible with no hint that the view is bounded.
  if (!isV2 || isLoading || !result) return null;
  if (actions.length === 0 && !alwaysShow) return null;

  // Revoke only. `permissions` covers owner + curator; V2 sentinels are a
  // per-address mapping with no enumeration, so the connected wallet is
  // checked directly — a sentinel is precisely the role that turns up wanting
  // to kill a queued action, and it was seeing a disabled button.
  const canRevoke =
    permissions.canCurate || permissions.canManage || permissions.isAdmin || isSentinel === true;
  const busy = isPending || isSimulating;

  // Execute = re-send the queued calldata itself. The vault checks
  // `executableAt` internally, so no separate `execute(bytes)` exists.
  const execute = (action: PendingV2Action) => {
    setActiveData(action.data);
    try {
      const decoded = decodeFunctionData({ abi: metaMorphoV2Abi, data: action.data });
      writeContract({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: decoded.functionName,
        args: decoded.args as readonly unknown[],
        chainId,
      } as Parameters<typeof writeContract>[0]);
    } catch {
      /* undecodable calldata — Execute stays disabled for these rows */
    }
  };

  const revoke = (action: PendingV2Action) => {
    setActiveData(action.data);
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'revoke',
      args: [action.data],
      chainId,
    });
  };

  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  // ---- batch execute -----------------------------------------------------
  // `multicall` delegatecalls each payload into the vault, so `msg.data` inside
  // each inner call is that payload — which is exactly what `executableAt` is
  // keyed on. The timelock therefore still checks out per action.
  const BATCH = '0xbatch' as const;
  const isBatchable = (a: PendingV2Action) =>
    a.executableAt <= nowSec &&
    a.functionName !== 'unknown' &&
    preflight[a.data]?.status !== 'reverts';
  const batchable = actions.filter(isBatchable);
  const selectedActions = batchable.filter((a) => selected.has(a.data));
  const batchBusy = busy && activeData === BATCH;

  const toggle = (data: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(data)) next.delete(data);
      else next.add(data);
      return next;
    });

  const executeBatch = () => {
    if (selectedActions.length === 0) return;
    setActiveData(BATCH);
    // A single selection doesn't need the multicall wrapper — send it direct,
    // which is cheaper and gives a cleaner revert if it does fail.
    if (selectedActions.length === 1) {
      setActiveData(selectedActions[0].data);
      execute(selectedActions[0]);
      return;
    }
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'multicall',
      args: [selectedActions.map((a) => a.data)],
      chainId,
    });
  };

  return (
    <Card className="border-warning/30">
      <CardHeader>
        <Clock size={14} className="text-warning" />
        <CardTitle>Timelock Queue</CardTitle>
        {actions.length > 0 ? (
          <Badge variant="warning">{actions.length} pending</Badge>
        ) : isBackfilling ? (
          // "Empty" before the history scan lands would be a claim we can't
          // back — this vault's oldest live entry is 5.5M blocks deep.
          <Badge variant="info">Scanning…</Badge>
        ) : result?.isFullHistory ? (
          <Badge variant="success">Empty</Badge>
        ) : (
          <Badge variant="warning">Partial</Badge>
        )}
      </CardHeader>

      <p className="text-[10px] text-text-tertiary mb-3">
        Actions submitted to the vault's timelock. They apply only once executed — the
        countdown starting is not the change landing.
      </p>

      {/* walletError is set when the guard short-circuits before the wallet
          is ever asked (e.g. not connected). Omitting it here made the click
          look like it did nothing at all. */}
      {(simulateError || error || walletError) && (
        <div role="alert" className="bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger mb-3">
          {walletError ??
            simulateError?.message ??
            (error instanceof Error ? error.message : 'Transaction failed.')}
        </div>
      )}

      {actions.length > 0 && !canRevoke && isConnected && (
        <div className="bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-text-primary mb-3">
          Connected wallet is not the owner, curator or a sentinel of this vault — Revoke is
          read-only for you. Executing a matured action is permissionless and stays available.
        </div>
      )}

      {/* Batch bar — only worth showing once more than one action could go in
          the same transaction. */}
      {batchable.length > 1 && (
        <div className="flex flex-wrap items-center gap-3 px-3 py-2 mb-3 bg-bg-hover/50 border border-border-subtle text-xs">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selectedActions.length === batchable.length}
              // Indeterminate isn't expressible in JSX props; the ref sets it.
              ref={(el) => {
                if (el) el.indeterminate = selectedActions.length > 0 && selectedActions.length < batchable.length;
              }}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(batchable.map((a) => a.data)) : new Set())
              }
              className="accent-accent-primary"
              aria-label="Select all executable actions"
            />
            <span className="text-text-secondary">
              Select all executable ({batchable.length})
            </span>
          </label>
          <span className="text-text-tertiary text-[10px]">
            {selectedActions.length === 0
              ? 'Executes in one transaction.'
              : `${selectedActions.length} selected — one transaction, one signature.`}
          </span>
          <div className="ml-auto">
            <Button
              size="sm"
              disabled={selectedActions.length === 0 || !isConnected || batchBusy}
              loading={batchBusy}
              onClick={executeBatch}
              title={
                !isConnected
                  ? 'Connect your wallet to execute.'
                  : selectedActions.length === 0
                    ? 'Select at least one action.'
                    : `Execute ${selectedActions.length} action${selectedActions.length !== 1 ? 's' : ''} in one transaction`
              }
            >
              {selectedActions.length > 1
                ? `Execute ${selectedActions.length} (1 tx)`
                : 'Execute selected'}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {actions.map((a) => {
          const ready = a.executableAt <= nowSec;
          const decodable = a.functionName !== 'unknown';
          const pre = preflight[a.data];
          const wouldRevert = pre?.status === 'reverts';
          const blocked =
            executeBlockedReason({ isConnected, decodable, matured: ready }) ??
            (wouldRevert
              ? `Would revert on-chain: ${pre.reason}. Revoke it instead.`
              : null);
          const rowBusy = busy && activeData === a.data;
          const selectable = isBatchable(a);
          return (
            <div
              key={a.data}
              className="flex flex-wrap items-center justify-between gap-3 p-3 bg-bg-hover/30 border border-border-subtle"
            >
              {batchable.length > 1 && (
                <input
                  type="checkbox"
                  checked={selected.has(a.data)}
                  disabled={!selectable}
                  onChange={() => toggle(a.data)}
                  className="accent-accent-primary shrink-0 disabled:opacity-30"
                  title={
                    selectable
                      ? 'Include in the batch'
                      : wouldRevert
                        ? 'Would revert — cannot be batched'
                        : 'Not executable yet'
                  }
                  aria-label={`Include "${a.label}" in the batch`}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-text-primary font-medium">{a.label}</span>
                  {a.value && <span className="font-mono text-text-secondary">→ {a.value}</span>}
                  {ready ? (
                    wouldRevert ? (
                      <Badge variant="danger">Would revert</Badge>
                    ) : (
                      <Badge variant="success">Ready</Badge>
                    )
                  ) : (
                    <Badge variant="warning">Waiting</Badge>
                  )}
                  {ready && isChecking && !pre && (
                    <span className="text-[10px] text-text-tertiary">checking…</span>
                  )}
                </div>
                {a.target && (
                  <p className="text-[10px] text-text-tertiary mt-0.5">{a.target}</p>
                )}
                <p className="text-[10px] text-text-tertiary mt-0.5">
                  <TimelockCountdown executableAt={a.executableAt} />
                </p>
                {blocked && (
                  <p className="text-[10px] text-warning mt-0.5">{blocked}</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={!!blocked || rowBusy}
                  loading={rowBusy}
                  onClick={() => execute(a)}
                  title={blocked ?? 'Apply this change now'}
                >
                  Execute
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canRevoke || !isConnected || rowBusy}
                  onClick={() => revoke(a)}
                  title={
                    !isConnected
                      ? 'Connect your wallet to revoke.'
                      : !canRevoke
                        ? 'Only the vault owner, curator or a sentinel can revoke a queued action.'
                        : 'Cancel this queued action'
                  }
                >
                  Revoke
                </Button>
              </div>
            </div>
          );
        })}
        {actions.length === 0 && (
          <p className="text-xs text-text-tertiary py-2">
            {isBackfilling
              ? 'Scanning vault history…'
              : result.isFullHistory
                ? 'Nothing queued.'
                : 'Nothing queued in the range scanned so far.'}
          </p>
        )}
      </div>

      <p className="text-[10px] text-text-tertiary mt-3">
        {result.isFullHistory
          ? 'Covers the vault’s full history.'
          : isBackfilling
            ? `Scanning earlier history — blocks ${result.fromBlock.toLocaleString()}–${result.toBlock.toLocaleString()} covered so far. Older queued actions will appear as the scan walks back.`
            : `Covers blocks ${result.fromBlock.toLocaleString()}–${result.toBlock.toLocaleString()} — an action queued before that window is not listed.`}
      </p>

      {backfillError && (
        <p role="alert" className="text-[10px] text-warning mt-1">
          History scan stalled ({backfillError}). Reload to resume from block{' '}
          <span className="font-mono">{result.fromBlock.toLocaleString()}</span>.
        </p>
      )}
    </Card>
  );
}
