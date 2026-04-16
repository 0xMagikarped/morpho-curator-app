import { useState } from 'react';
import { parseUnits } from 'viem';
import type { Address } from 'viem';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { useVaultWrite } from '../../../hooks/useVaultWrite';
import { useVaultPermissions } from '../../../hooks/useVaultPermissions';

interface FeeManagementProps {
  chainId: number;
  vaultAddress: Address;
  currentFee: bigint;
  currentTimelock: bigint;
  feeRecipient: Address;
  pendingFee: { value: bigint; validAt: bigint } | null;
  onSuccess: () => void;
}

const ZERO = '0x0000000000000000000000000000000000000000';

export function FeeManagement({
  chainId,
  vaultAddress,
  currentFee,
  currentTimelock,
  feeRecipient,
  pendingFee,
  onSuccess,
}: FeeManagementProps) {
  const [feeInput, setFeeInput] = useState('');
  const [recipientInput, setRecipientInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const {
    submit, mode, isPending, isConfirming, isSuccess,
    disabled: writeDisabled, disabledTooltip, invalidReason,
  } = useVaultWrite(chainId, vaultAddress, onSuccess);
  const permissions = useVaultPermissions(chainId, vaultAddress);

  const isMoolah = mode === 'timelocked';
  const currentFeePercent = Number(currentFee) / 1e16;
  const noFeeRecipient = feeRecipient === ZERO;
  const canWrite = permissions.canCurate || permissions.isAdmin;

  const handleSubmitFee = () => {
    setError(null);
    const pct = parseFloat(feeInput);
    if (isNaN(pct) || pct < 0) { setError('Fee must be a positive number'); return; }
    if (pct > 50) { setError('Max fee is 50%'); return; }
    if (pct > 0 && noFeeRecipient && !isMoolah) {
      setError('Set a fee recipient first — fee > 0 requires feeRecipient != address(0)');
      return;
    }
    const feeWad = parseUnits(String(pct / 100), 18);
    void submit({ kind: 'setFee', newFee: feeWad });
    setFeeInput('');
  };

  const handleSetRecipient = () => {
    setError(null);
    const addr = recipientInput.trim();
    if (!addr || addr.length !== 42 || !addr.startsWith('0x')) {
      setError('Invalid address');
      return;
    }
    void submit({ kind: 'setFeeRecipient', newFeeRecipient: addr as Address });
    setRecipientInput('');
  };

  const isBusy = isPending || isConfirming;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fee Management</CardTitle>
        <Badge>{currentFeePercent.toFixed(2)}%</Badge>
      </CardHeader>
      <div className="space-y-3">
        <div className="text-xs text-text-tertiary">
          Current performance fee: <span className="font-mono text-text-primary">{currentFeePercent.toFixed(2)}%</span>
          {' · '}Fee recipient: <span className="font-mono text-text-primary">{noFeeRecipient ? 'Not set' : `${feeRecipient.slice(0, 8)}…${feeRecipient.slice(-6)}`}</span>
        </div>

        {writeDisabled && disabledTooltip && (
          <div className="px-3 py-2 bg-danger/10 border border-danger/30 text-[11px] text-danger">
            <span className="font-semibold">Writes disabled.</span> {disabledTooltip}
          </div>
        )}

        {noFeeRecipient && !isMoolah && (
          <div className="bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
            No fee recipient set. You must set a fee recipient before setting a fee &gt; 0%.
          </div>
        )}

        {/* Set fee recipient */}
        {canWrite && (
          <div>
            <span className="text-xs text-text-secondary font-medium">
              {isMoolah ? 'Propose Fee Recipient' : 'Set Fee Recipient'}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                placeholder="0x…"
                className="flex-1 min-w-0 bg-bg-hover border border-border-subtle px-2 py-1.5 text-xs text-text-primary font-mono placeholder-text-tertiary focus:outline-none focus:border-border-focus"
              />
              <Button
                size="sm"
                onClick={handleSetRecipient}
                disabled={!recipientInput || isBusy || writeDisabled}
                loading={isBusy}
                title={writeDisabled ? disabledTooltip ?? undefined : undefined}
              >
                {isMoolah ? 'Propose' : 'Set'}
              </Button>
            </div>
          </div>
        )}

        {/* Set fee */}
        {canWrite && (
          <div>
            <span className="text-xs text-text-secondary font-medium">
              {isMoolah ? 'Propose Fee Change' : currentTimelock > 0n ? 'Submit Fee' : 'Set Fee'}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number"
                step="0.01"
                min="0"
                max="50"
                value={feeInput}
                onChange={(e) => setFeeInput(e.target.value)}
                placeholder="e.g. 15"
                className="w-24 bg-bg-hover border border-border-subtle px-2 py-1.5 text-xs text-text-primary font-mono placeholder-text-tertiary focus:outline-none focus:border-border-focus"
              />
              <span className="text-xs text-text-tertiary">%</span>
              <Button
                size="sm"
                onClick={handleSubmitFee}
                disabled={!feeInput || isBusy || writeDisabled}
                loading={isBusy}
                title={writeDisabled ? disabledTooltip ?? undefined : undefined}
              >
                {isPending ? 'Confirm…' : isConfirming ? 'Confirming…' : isMoolah ? 'Propose' : 'Submit'}
              </Button>
            </div>
            <p className="text-[10px] text-text-tertiary mt-1">
              Max: 50%{isMoolah ? ' · Proposed via curatorTimeLock' : currentTimelock > 0n ? ' · Subject to timelock' : ''}
            </p>
          </div>
        )}

        {!canWrite && (
          <p className="text-[10px] text-text-tertiary">
            {isMoolah
              ? 'Requires Curator TimeLock proposer role to change fees.'
              : 'Only the vault owner can change fees.'}
          </p>
        )}

        {pendingFee && (
          <div className="bg-blue-muted border border-blue-primary/20 px-3 py-2">
            <span className="text-xs text-text-secondary">
              Pending fee: <span className="font-mono">{(Number(pendingFee.value) / 1e16).toFixed(2)}%</span>
            </span>
          </div>
        )}

        {isSuccess && (
          <div className="bg-success/10 border border-success/20 px-3 py-2 text-xs text-success">
            {isMoolah ? 'Proposal scheduled. Check Pending Proposals.' : 'Fee updated successfully.'}
          </div>
        )}

        {error && <p className="text-[10px] text-danger">{error}</p>}
        {invalidReason && <p className="text-[10px] text-danger">{invalidReason}</p>}
      </div>
    </Card>
  );
}
