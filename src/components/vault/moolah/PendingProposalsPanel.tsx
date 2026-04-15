import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { useWaitForTransactionReceipt } from 'wagmi';
import type { Address } from 'viem';
import { Clock, CheckCircle2, XCircle } from 'lucide-react';
import { ProposalContents } from './ProposalContents';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useGuardedWriteContract } from '../../../hooks/useGuardedWriteContract';
import { getPublicClient } from '../../../lib/data/rpcClient';
import { useVaultSnapshot, type TimelockEntry } from '../../../lib/vault/adapter';
import { fetchTimelockProposals, type TimelockProposal } from '../../../lib/vault/proposals';
import { timelockControllerAbi } from '../../../lib/contracts/moolahAbis';
import { useAppStore } from '../../../store/appStore';

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
  const scheduledOps = useAppStore((s) =>
    s.scheduledOps.filter(
      (o) =>
        o.chainId === chainId &&
        o.timelock.toLowerCase() === timelock.address.toLowerCase(),
    ),
  );
  const seedIds = useMemo(() => scheduledOps.map((o) => o.opId), [scheduledOps]);

  const { data: proposals = [], isLoading, refetch } = useQuery({
    queryKey: ['timelock-proposals', chainId, timelock.address, seedIds.length],
    queryFn: async () => {
      const client = getPublicClient(chainId);
      return fetchTimelockProposals(client, timelock.address, chainId, seedIds);
    },
    enabled: Boolean(timelock.address),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

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
  onAction,
}: {
  chainId: number;
  vaultAddress: Address;
  timelock: TimelockEntry & { address: Address };
  proposal: TimelockProposal;
  onAction: () => void;
}) {
  const { address: account } = useAccount();
  const removeScheduledOp = useAppStore((s) => s.removeScheduledOp);

  const canCancel = Boolean(
    account &&
      timelock.cancellers?.some(
        (c) => c.toLowerCase() === account.toLowerCase(),
      ),
  );
  const canExecute = Boolean(
    account &&
      (timelock.executors?.some((e) => e.toLowerCase() === account.toLowerCase()) ||
        // OZ v4: address(0) in EXECUTOR_ROLE means open execution.
        timelock.executors?.some(
          (e) => e === '0x0000000000000000000000000000000000000000',
        )),
  );

  const { writeContract: writeExec, data: execHash, isPending: execPending } = useGuardedWriteContract();
  const { writeContract: writeCancel, data: cancelHash, isPending: cancelPending } = useGuardedWriteContract();
  const { isLoading: execConfirming, isSuccess: execSuccess } = useWaitForTransactionReceipt({ hash: execHash });
  const { isLoading: cancelConfirming, isSuccess: cancelSuccess } = useWaitForTransactionReceipt({ hash: cancelHash });

  if ((execSuccess || cancelSuccess)) {
    // Fire once on success — cheap to call repeatedly since the op is gone.
    queueMicrotask(() => {
      removeScheduledOp(chainId, proposal.opId);
      onAction();
    });
  }

  const handleExecute = () => {
    writeExec({
      address: timelock.address,
      abi: timelockControllerAbi,
      functionName: 'execute',
      args: [
        proposal.target,
        proposal.value,
        proposal.data,
        proposal.predecessor,
        proposal.salt,
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

  const countdown = formatCountdown(proposal.readyAt);
  const execBusy = execPending || execConfirming;
  const cancelBusy = cancelPending || cancelConfirming;

  return (
    <div className="px-3 py-2 bg-bg-hover border border-border-subtle">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <ProposalContents
            chainId={chainId}
            target={proposal.target}
            value={proposal.value}
            data={proposal.data}
            vaultAddress={vaultAddress}
          />
          <div className="flex items-center gap-1 text-[10px]">
            {proposal.isReady ? (
              <>
                <CheckCircle2 size={10} className="text-success" />
                <span className="text-success">Ready now</span>
              </>
            ) : proposal.readyAt === 0n ? (
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
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {proposal.isReady ? (
            <Button
              size="sm"
              onClick={handleExecute}
              disabled={!canExecute || execBusy}
              loading={execBusy}
              title={!canExecute ? 'Connected wallet is not an EXECUTOR on this timelock' : undefined}
            >
              {execPending ? 'Confirm…' : execConfirming ? 'Executing…' : 'Execute'}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="danger"
            onClick={handleCancel}
            disabled={!canCancel || cancelBusy}
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

function formatCountdown(readyAt: bigint): string {
  if (readyAt === 0n) return '—';
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (readyAt <= now) return 'now';
  const secs = Number(readyAt - now);
  const hours = Math.floor(secs / 3600);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  const minutes = Math.floor((secs % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
