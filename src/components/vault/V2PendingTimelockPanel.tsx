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
 * `executableAt`). Revoke cancels a queued action and is available at any
 * point to the curator / owner / sentinel.
 */
import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { decodeFunctionData, type Address } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useGuardedWriteContract } from '../../hooks/useGuardedWriteContract';
import { useVaultPermissions } from '../../hooks/useVaultPermissions';
import { useV2PendingActions, type PendingV2Action } from '../../lib/hooks/useV2PendingActions';
import { metaMorphoV2Abi } from '../../lib/contracts/metaMorphoV2Abi';
import { vaultKeys } from '../../lib/queryKeys';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { TimelockCountdown } from './TimelockCountdown';

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
  const { data: result, isLoading } = useV2PendingActions(
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

  const canAct = permissions.canCurate || permissions.canManage || permissions.isAdmin;
  const busy = isPending || isSimulating;

  /** Why a row's Execute is blocked — shown to the user, not just inferred. */
  const blockedReason = (ready: boolean, decodable: boolean): string | null => {
    if (!isConnected) return 'Connect your wallet to execute.';
    if (!canAct) return 'Only the vault owner or curator can execute a queued action.';
    if (!decodable) return 'Calldata could not be decoded — execute from the originating drawer.';
    if (!ready) return 'The timelock has not elapsed yet.';
    return null;
  };

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

  return (
    <Card className="border-warning/30">
      <CardHeader>
        <Clock size={14} className="text-warning" />
        <CardTitle>Timelock Queue</CardTitle>
        {actions.length > 0 ? (
          <Badge variant="warning">{actions.length} pending</Badge>
        ) : (
          <Badge variant="success">Empty</Badge>
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

      {actions.length > 0 && !canAct && isConnected && (
        <div className="bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-text-primary mb-3">
          Connected wallet is not the owner or curator of this vault — Execute and Revoke
          are read-only for you.
        </div>
      )}

      <div className="space-y-2">
        {actions.map((a) => {
          const ready = a.executableAt <= nowSec;
          const decodable = a.functionName !== 'unknown';
          const blocked = blockedReason(ready, decodable);
          const rowBusy = busy && activeData === a.data;
          return (
            <div
              key={a.data}
              className="flex flex-wrap items-center justify-between gap-3 p-3 bg-bg-hover/30 border border-border-subtle"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-text-primary font-medium">{a.label}</span>
                  {a.value && <span className="font-mono text-text-secondary">→ {a.value}</span>}
                  {ready ? (
                    <Badge variant="success">Ready</Badge>
                  ) : (
                    <Badge variant="warning">Waiting</Badge>
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
                  disabled={!canAct || !isConnected || rowBusy}
                  onClick={() => revoke(a)}
                  title="Cancel this queued action"
                >
                  Revoke
                </Button>
              </div>
            </div>
          );
        })}
        {actions.length === 0 && (
          <p className="text-xs text-text-tertiary py-2">Nothing queued.</p>
        )}
      </div>

      <p className="text-[10px] text-text-tertiary mt-3">
        {result.isFullHistory
          ? 'Covers the vault’s full history.'
          : `Covers blocks ${result.fromBlock.toLocaleString()}–${result.toBlock.toLocaleString()} — an action queued before that window is not listed.`}
      </p>
    </Card>
  );
}
