import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isHex, type Address } from 'viem';
import { useAccount, useReadContract, useWaitForTransactionReceipt } from 'wagmi';

import { keccak256, toHex } from 'viem';
import { AlertTriangle, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { ProposalContents } from './ProposalContents';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useGuardedWriteContract } from '../../../hooks/useGuardedWriteContract';
import { getPublicClient } from '../../../lib/data/rpcClient';
import { useVaultSnapshot, type TimelockEntry } from '../../../lib/vault/adapter';
import { fetchTimelockProposals, type TimelockProposal } from '../../../lib/vault/proposals';
import { timelockControllerAbi } from '../../../lib/contracts/moolahAbis';
import { useAppStore } from '../../../store/appStore';

const CANCELLER_ROLE = keccak256(toHex('CANCELLER_ROLE'));

interface PendingProposalsPanelProps {
  chainId: number;
  vaultAddress: Address;
}

/**
 * Pending Proposals panel — only rendered for Moolah vaults.
 *
 * Merges local scheduled-ops (from `appStore`) with on-chain `CallScheduled`
 * logs per timelock. Each op ships with a Execute/Cancel button that's only
 * enabled when the connected account has the right role.
 */
export function PendingProposalsPanel({ chainId, vaultAddress }: PendingProposalsPanelProps) {
  const { data: snapshot } = useVaultSnapshot(chainId, vaultAddress);

  if (!snapshot || snapshot.flavor !== 'moolahVault') return null;

  const timelocks = snapshot.timelocks.filter((t): t is TimelockEntry & { address: Address } =>
    t.address !== null,
  );
  if (timelocks.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            Pending Proposals
            <span className="px-1.5 py-0.5 text-[9px] font-mono tracking-wider uppercase bg-[#F0B90B]/10 border border-[#F0B90B]/30 text-[#F0B90B]">
              Moolah
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <div className="space-y-4">
        {timelocks.map((tl) => (
          <TimelockProposalsSection
            key={tl.address}
            chainId={chainId}
            vaultAddress={vaultAddress}
            timelock={tl}
          />
        ))}
      </div>
    </Card>
  );
}

function TimelockProposalsSection({
  chainId,
  vaultAddress,
  timelock,
}: {
  chainId: number;
  vaultAddress: Address;
  timelock: TimelockEntry & { address: Address };
}) {
  // Read the raw array from Zustand (stable reference when the slice
  // hasn't changed), then filter in component scope via useMemo. Putting
  // `.filter()` inside the selector created a new array on every
  // `getSnapshot` call → `useSyncExternalStore` saw a different reference
  // → re-render → infinite loop (React error #185).
  const allScheduledOps = useAppStore((s) => s.scheduledOps);
  const removeScheduledOp = useAppStore((s) => s.removeScheduledOp);
  const scheduledOps = useMemo(
    () =>
      allScheduledOps.filter(
        (o) =>
          o.chainId === chainId &&
          o.timelock.toLowerCase() === timelock.address.toLowerCase(),
      ),
    [allScheduledOps, chainId, timelock.address],
  );

  // Pass the full local seeds (with authoritative salt) to the fetcher so
  // external ops can be distinguished and gated on Execute.
  const localSeeds = useMemo(
    () =>
      scheduledOps.map((o) => ({
        opId: o.opId,
        target: o.target,
        value: BigInt(o.value),
        data: o.data,
        predecessor: o.predecessor,
        salt: o.salt,
        delay: BigInt(o.delay),
        scheduledAt: o.scheduledAt,
        txHash: o.txHash,
        label: o.label,
      })),
    [scheduledOps],
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['timelock-proposals', chainId, timelock.address, localSeeds.length],
    queryFn: async () => {
      const client = getPublicClient(chainId);
      return fetchTimelockProposals(client, timelock.address, chainId, localSeeds);
    },
    enabled: Boolean(timelock.address),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const proposals = data?.proposals ?? [];
  const scanTruncated = data?.scanTruncated ?? false;

  // Prune local cache entries whose on-chain state reports isDone (either
  // Executed or Cancelled by any party). Keeps the 500-entry FIFO from
  // leaking against repeated external execution.
  useEffect(() => {
    if (!data) return;
    const localOpIds = new Set(scheduledOps.map((o) => o.opId.toLowerCase()));
    const stillPending = new Set(data.proposals.map((p) => p.opId.toLowerCase()));
    for (const opId of localOpIds) {
      if (!stillPending.has(opId)) {
        removeScheduledOp(chainId, opId as `0x${string}`);
      }
    }
    // Intentionally dependency-omit scheduledOps (it's derived; avoids a loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, chainId, removeScheduledOp]);

  // Lifts the "now" clock for live countdowns. One interval per panel section.
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-2">
        <span className="text-text-secondary">
          {timelock.label} TimeLock <span className="text-text-tertiary">·</span>{' '}
          <span className="font-mono text-text-tertiary">
            {Math.round(Number(timelock.minDelay) / 3600)}h delay
          </span>
        </span>
        <span className="text-text-tertiary font-mono">
          {proposals.length} queued
        </span>
      </div>
      {scanTruncated && (
        <div className="mb-2 px-2 py-1.5 bg-warning/10 border border-warning/30 text-[10px] text-warning flex items-start gap-1.5">
          <AlertTriangle size={10} className="shrink-0 mt-0.5" />
          <span>
            Historic proposals may be truncated — the RPC refused part of the
            log scan. Showing your locally-scheduled ops + recent events.
            <button
              type="button"
              onClick={() => refetch()}
              className="ml-1 underline hover:text-text-primary"
            >
              Retry
            </button>
          </span>
        </div>
      )}
      {isLoading ? (
        <div className="h-12 animate-shimmer bg-bg-hover" />
      ) : proposals.length === 0 ? (
        <p className="text-[11px] text-text-tertiary">No pending proposals.</p>
      ) : (
        <div className="space-y-2">
          {proposals.map((p) => (
            <ProposalRow
              key={p.opId}
              chainId={chainId}
              vaultAddress={vaultAddress}
              timelock={timelock}
              proposal={p}
              nowSeconds={nowSeconds}
              onAction={() => refetch()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalRow({
  chainId,
  vaultAddress,
  timelock,
  proposal,
  nowSeconds,
  onAction,
}: {
  chainId: number;
  vaultAddress: Address;
  timelock: TimelockEntry & { address: Address };
  proposal: TimelockProposal;
  nowSeconds: number;
  onAction: () => void;
}) {
  const { address: account } = useAccount();
  const removeScheduledOp = useAppStore((s) => s.removeScheduledOp);

  // External proposals: salt unknown. We first try zero salt (the OZ /
  // Gnosis Safe default), then let the curator paste manually.
  const ZERO_SALT = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
  const [pastedSalt, setPastedSalt] = useState<string>('');
  const pastedSaltValid =
    isHex(pastedSalt) && (pastedSalt.length === 66); // 0x + 64 hex chars
  // For external proposals: default to zero salt (most common), allow override.
  const effectiveSalt: `0x${string}` = proposal.saltKnown
    ? proposal.salt
    : pastedSaltValid
      ? (pastedSalt as `0x${string}`)
      : ZERO_SALT;
  // Always allow execute attempt — zero salt is the right default for
  // externally-scheduled ops (Safe, CLI, etherscan). If it's wrong the
  // pre-flight check below catches it before the wallet signs.
  const saltResolved = true;

  // Enumerated cancellers come from the snapshot. When enumeration is
  // empty but a wallet is connected, fall back to a direct `hasRole` probe
  // — enumeration can fail for RPC reasons even when the account holds
  // the role.
  const enumeratedCanceller = Boolean(
    account &&
      timelock.cancellers?.some((c) => c.toLowerCase() === account.toLowerCase()),
  );
  const needsFallbackCancellerCheck =
    Boolean(account) && (timelock.cancellers?.length ?? 0) === 0;
  const { data: fallbackCanceller } = useReadContract({
    address: timelock.address,
    abi: timelockControllerAbi,
    functionName: 'hasRole',
    args: account ? [CANCELLER_ROLE, account] : undefined,
    chainId,
    query: { enabled: needsFallbackCancellerCheck && Boolean(account) },
  });
  const canCancel = enumeratedCanceller || Boolean(fallbackCanceller);

  // Executor list — `address(0)` in OZ's EXECUTOR_ROLE is the "open
  // execute" sentinel (anyone can execute). Check for both.
  const canExecute = Boolean(
    account &&
      (timelock.executors?.some((e) => e.toLowerCase() === account.toLowerCase()) ||
        timelock.executors?.some((e) => e === '0x0000000000000000000000000000000000000000')),
  );

  const { writeContract: writeExec, data: execHash, isPending: execPending } = useGuardedWriteContract();
  const { writeContract: writeCancel, data: cancelHash, isPending: cancelPending } = useGuardedWriteContract();
  const { isLoading: execConfirming, isSuccess: execSuccess } = useWaitForTransactionReceipt({ hash: execHash });
  const { isLoading: cancelConfirming, isSuccess: cancelSuccess } = useWaitForTransactionReceipt({ hash: cancelHash });
  // Track which hash we've already handled so the callback fires exactly
  // once — onAction() → refetch() → re-render → execSuccess still true →
  // infinite loop if unchecked (React error #185).
  const [handledTx, setHandledTx] = useState<`0x${string}` | null>(null);
  useEffect(() => {
    const doneHash = (execSuccess && execHash) || (cancelSuccess && cancelHash) || null;
    if (doneHash && doneHash !== handledTx) {
      setHandledTx(doneHash);
      removeScheduledOp(chainId, proposal.opId);
      onAction();
    }
  }, [execSuccess, cancelSuccess, execHash, cancelHash, handledTx, chainId, proposal.opId, removeScheduledOp, onAction]);

  const [preflightError, setPreflightError] = useState<string | null>(null);

  const handleExecute = async () => {
    if (!saltResolved) return;
    setPreflightError(null);

    // Pre-flight: verify the operation exists and is ready on-chain BEFORE
    // sending the tx. This catches salt mismatches, predecessor issues, and
    // stale state — surfacing a clear error instead of an opaque "#1002".
    try {
      const client = getPublicClient(chainId);
      // Compute the opId the same way OZ does: hash(target, value, data, predecessor, salt)
      const preflightOpId = await client.readContract({
        address: timelock.address,
        abi: timelockControllerAbi,
        functionName: 'hashOperation',
        args: [
          proposal.target,
          proposal.value,
          proposal.data,
          proposal.predecessor,
          effectiveSalt,
        ],
      }) as `0x${string}`;

      const [isOp, isReady] = await Promise.all([
        client.readContract({
          address: timelock.address,
          abi: timelockControllerAbi,
          functionName: 'isOperation',
          args: [preflightOpId],
        }) as Promise<boolean>,
        client.readContract({
          address: timelock.address,
          abi: timelockControllerAbi,
          functionName: 'isOperationReady',
          args: [preflightOpId],
        }) as Promise<boolean>,
      ]);

      if (!isOp) {
        setPreflightError(
          `Operation not found on-chain (computed id: ${preflightOpId.slice(0, 10)}…). ` +
          `The salt may not match — the original schedule used a different salt than "${effectiveSalt.slice(0, 10)}…". ` +
          (proposal.saltKnown
            ? 'This proposal was submitted from this app — try clearing localStorage and re-discovering.'
            : 'Try pasting the correct salt from the original scheduling tool.'),
        );
        return;
      }
      if (!isReady) {
        const ts = await client.readContract({
          address: timelock.address,
          abi: timelockControllerAbi,
          functionName: 'getTimestamp',
          args: [preflightOpId],
        }) as bigint;
        if (ts === 1n) {
          setPreflightError('Operation already executed.');
        } else {
          setPreflightError(`Operation exists but is not ready yet (readyAt: ${ts}).`);
        }
        return;
      }
    } catch (err) {
      // Pre-flight RPC failed — let the wallet handle it (it'll simulate).
      console.warn('[execute preflight] RPC check failed:', err);
    }

    writeExec({
      address: timelock.address,
      abi: timelockControllerAbi,
      functionName: 'execute',
      args: [
        proposal.target,
        proposal.value,
        proposal.data,
        proposal.predecessor,
        effectiveSalt,
      ],
      chainId,
      value: proposal.value,
    });
  };

  const handleCancel = () => {
    writeCancel({
      address: timelock.address,
      abi: timelockControllerAbi,
      functionName: 'cancel',
      args: [proposal.opId],
      chainId,
    });
  };

  const countdown = formatCountdown(proposal.readyAt, nowSeconds);
  const execBusy = execPending || execConfirming;
  const cancelBusy = cancelPending || cancelConfirming;

  const execBlockedReason = !canExecute
    ? 'Connected wallet is not an EXECUTOR on this timelock'
    : !saltResolved
      ? 'External proposal — salt unknown. Paste the correct salt below to execute.'
      : undefined;

  return (
    <div className="px-3 py-2 bg-bg-hover border border-border-subtle">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          {!proposal.saltKnown && (
            <div className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider bg-info/10 border border-info/30 text-info">
              <AlertTriangle size={8} />
              External proposal — salt unknown
            </div>
          )}
          <ProposalContents
            chainId={chainId}
            target={proposal.target}
            value={proposal.value}
            data={proposal.data}
            vaultAddress={vaultAddress}
          />
          <div className="flex items-center gap-1 text-[10px]">
            {proposal.isExpired ? (
              <>
                <XCircle size={10} className="text-danger" />
                <span className="text-danger">
                  Expired (past {Math.floor((Number(proposal.delay) + 7 * 86400) / 86400)}d deadline)
                </span>
              </>
            ) : proposal.isReady ? (
              <>
                <CheckCircle2 size={10} className="text-success" />
                <span className="text-success">Ready now</span>
              </>
            ) : proposal.readyAt === 0n && proposal.scheduledAt == null ? (
              <>
                <XCircle size={10} className="text-text-tertiary" />
                <span className="text-text-tertiary">Scheduled on-chain, fetching…</span>
              </>
            ) : (
              <>
                <Clock size={10} className="text-warning" />
                <span className="text-warning">Ready in {countdown}</span>
              </>
            )}
          </div>
          {!proposal.saltKnown && !proposal.isExpired && (
            <div className="pt-1 space-y-1">
              <p className="text-[9px] text-text-tertiary">
                External proposal — executing with zero salt (default). Override below if needed:
              </p>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={pastedSalt}
                  onChange={(e) => { setPastedSalt(e.target.value.trim()); setPreflightError(null); }}
                  placeholder="0x… (override salt if zero doesn't work)"
                  className="flex-1 min-w-0 bg-bg-surface border border-border-default px-2 py-1 text-[10px] text-text-primary font-mono placeholder-text-tertiary focus:outline-none focus:border-border-focus"
                />
                {pastedSalt && !pastedSaltValid && (
                  <span className="text-[9px] text-danger shrink-0">Invalid bytes32</span>
                )}
                {pastedSaltValid && (
                  <span className="text-[9px] text-success shrink-0">Using custom salt</span>
                )}
              </div>
            </div>
          )}
          {preflightError && (
            <div className="mt-1 px-2 py-1.5 bg-danger/10 border border-danger/30 text-[10px] text-danger">
              {preflightError}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {!proposal.isExpired && proposal.isReady ? (
            <Button
              size="sm"
              onClick={handleExecute}
              disabled={!canExecute || execBusy}
              loading={execBusy}
              title={execBlockedReason}
            >
              {execPending ? 'Confirm…' : execConfirming ? 'Executing…' : 'Execute'}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="danger"
            onClick={handleCancel}
            disabled={!canCancel || cancelBusy || proposal.isExpired}
            loading={cancelBusy}
            title={!canCancel ? 'Connected wallet is not a CANCELLER on this timelock' : undefined}
          >
            {cancelPending ? 'Confirm…' : cancelConfirming ? 'Cancelling…' : 'Cancel'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatCountdown(readyAt: bigint, nowSeconds: number): string {
  if (readyAt === 0n) return '—';
  const now = BigInt(nowSeconds);
  if (readyAt <= now) return 'now';
  const secs = Number(readyAt - now);
  const hours = Math.floor(secs / 3600);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  const minutes = Math.floor((secs % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
