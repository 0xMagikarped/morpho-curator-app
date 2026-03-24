import { useState, useEffect } from 'react';
import { isAddress } from 'viem';
import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { truncateAddress } from '../../../lib/utils/format';
import { metaMorphoV1Abi } from '../../../lib/contracts/abis';

interface RoleManagementProps {
  chainId: number;
  vaultAddress: Address;
  currentCurator: Address;
  currentFeeRecipient: Address;
  currentGuardian: Address;
  onSuccess: () => void;
}

const ZERO = '0x0000000000000000000000000000000000000000';

export function RoleManagement({
  chainId,
  vaultAddress,
  currentCurator,
  currentFeeRecipient,
  currentGuardian,
  onSuccess,
}: RoleManagementProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Update Roles</CardTitle>
      </CardHeader>
      <div className="space-y-4">
        <RoleField
          label="Set Curator"
          current={currentCurator}
          chainId={chainId}
          vaultAddress={vaultAddress}
          functionName="setCurator"
          onSuccess={onSuccess}
        />
        <div className="border-t border-border-subtle" />
        <RoleField
          label="Set Fee Recipient"
          current={currentFeeRecipient}
          chainId={chainId}
          vaultAddress={vaultAddress}
          functionName="setFeeRecipient"
          onSuccess={onSuccess}
        />
        <div className="border-t border-border-subtle" />
        <RoleField
          label="Set Guardian"
          current={currentGuardian}
          chainId={chainId}
          vaultAddress={vaultAddress}
          functionName="submitGuardian"
          onSuccess={onSuccess}
          hint="Subject to timelock delay"
        />
        <div className="border-t border-border-subtle" />
        <SetAllocator
          chainId={chainId}
          vaultAddress={vaultAddress}
          onSuccess={onSuccess}
        />
        <div className="border-t border-border-subtle" />
        <TransferOwnership
          chainId={chainId}
          vaultAddress={vaultAddress}
          onSuccess={onSuccess}
        />
      </div>
    </Card>
  );
}

function RoleField({
  label,
  current,
  chainId,
  vaultAddress,
  functionName,
  onSuccess,
  hint,
}: {
  label: string;
  current: Address;
  chainId: number;
  vaultAddress: Address;
  functionName: string;
  onSuccess: () => void;
  hint?: string;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { writeContract, data: hash, isPending, error: txError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      setValue('');
      setError(null);
      onSuccess();
    }
  }, [isSuccess, onSuccess]);

  const handleSubmit = () => {
    setError(null);
    if (!isAddress(value)) {
      setError('Invalid address');
      return;
    }
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: functionName as 'setCurator',
      args: [value as Address],
      chainId,
    });
  };

  const isBusy = isPending || isConfirming;
  const isZero = current === ZERO;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-text-secondary font-medium">{label}</span>
        <span className="text-[10px] font-mono text-text-tertiary">
          {isZero ? 'Not set' : truncateAddress(current)}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x..."
          className="flex-1 bg-bg-hover border border-border-subtle px-2 py-1.5 text-xs text-text-primary font-mono placeholder-text-tertiary min-w-0 focus:outline-none focus:border-border-focus"
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!value || isBusy}
          loading={isBusy}
        >
          {isPending ? 'Confirm...' : isConfirming ? 'Confirming...' : 'Update'}
        </Button>
      </div>
      {hint && <p className="text-[10px] text-text-tertiary mt-1">{hint}</p>}
      {error && <p className="text-[10px] text-danger mt-1">{error}</p>}
      {txError && <p className="text-[10px] text-danger mt-1">{(txError as Error).message?.slice(0, 120)}</p>}
    </div>
  );
}

function SetAllocator({
  chainId,
  vaultAddress,
  onSuccess,
}: {
  chainId: number;
  vaultAddress: Address;
  onSuccess: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { writeContract, data: hash, isPending, error: txError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Check if the entered address is currently an allocator
  const checkAddress = isAddress(value) ? (value as Address) : undefined;
  const { data: isCurrentlyAllocator, refetch: refetchCheck } = useReadContract({
    address: vaultAddress,
    abi: metaMorphoV1Abi,
    functionName: 'isAllocator',
    args: checkAddress ? [checkAddress] : undefined,
    chainId,
    query: { enabled: !!checkAddress },
  });

  useEffect(() => {
    if (isSuccess) {
      setValue('');
      setError(null);
      reset();
      refetchCheck();
      onSuccess();
    }
  }, [isSuccess, onSuccess, reset, refetchCheck]);

  const handleGrant = () => {
    setError(null);
    if (!isAddress(value)) {
      setError('Invalid address');
      return;
    }
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'setIsAllocator',
      args: [value as Address, true],
      chainId,
    });
  };

  const handleRevoke = () => {
    setError(null);
    if (!isAddress(value)) {
      setError('Invalid address');
      return;
    }
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'setIsAllocator',
      args: [value as Address, false],
      chainId,
    });
  };

  const isBusy = isPending || isConfirming;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-text-secondary font-medium">Set Allocator</span>
        {checkAddress && isCurrentlyAllocator !== undefined && (
          <Badge variant={isCurrentlyAllocator ? 'success' : 'default'}>
            {isCurrentlyAllocator ? 'Active' : 'Not allocator'}
          </Badge>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x... allocator address"
          className="flex-1 bg-bg-hover border border-border-subtle px-2 py-1.5 text-xs text-text-primary font-mono placeholder-text-tertiary min-w-0 focus:outline-none focus:border-border-focus"
        />
        <Button
          size="sm"
          onClick={handleGrant}
          disabled={!value || isBusy}
          loading={isBusy}
        >
          {isPending ? 'Confirm...' : isConfirming ? 'Confirming...' : 'Grant'}
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={handleRevoke}
          disabled={!value || isBusy}
          loading={isBusy}
        >
          Revoke
        </Button>
      </div>
      <p className="text-[10px] text-text-tertiary mt-1">Grant or revoke allocator role (can reallocate between markets)</p>
      {error && <p className="text-[10px] text-danger mt-1">{error}</p>}
      {txError && <p className="text-[10px] text-danger mt-1">{(txError as Error).message?.slice(0, 120)}</p>}
    </div>
  );
}

function TransferOwnership({
  chainId,
  vaultAddress,
  onSuccess,
}: {
  chainId: number;
  vaultAddress: Address;
  onSuccess: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { writeContract, data: hash, isPending, error: txError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      setValue('');
      setError(null);
      onSuccess();
    }
  }, [isSuccess, onSuccess]);

  const handleSubmit = () => {
    setError(null);
    if (!isAddress(value)) {
      setError('Invalid address');
      return;
    }
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'transferOwnership',
      args: [value as Address],
      chainId,
    });
  };

  const isBusy = isPending || isConfirming;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-text-secondary font-medium">Transfer Ownership</span>
        <span className="text-[10px] text-danger font-medium">(2-step)</span>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x... new pending owner"
          className="flex-1 bg-bg-hover border border-border-subtle px-2 py-1.5 text-xs text-text-primary font-mono placeholder-text-tertiary min-w-0 focus:outline-none focus:border-border-focus"
        />
        <Button
          size="sm"
          variant="danger"
          onClick={handleSubmit}
          disabled={!value || isBusy}
          loading={isBusy}
        >
          {isPending ? 'Confirm...' : isConfirming ? 'Confirming...' : 'Submit'}
        </Button>
      </div>
      <p className="text-[10px] text-warning mt-1">New owner must call acceptOwnership() to complete transfer</p>
      {error && <p className="text-[10px] text-danger mt-1">{error}</p>}
      {txError && <p className="text-[10px] text-danger mt-1">{(txError as Error).message?.slice(0, 120)}</p>}
    </div>
  );
}
