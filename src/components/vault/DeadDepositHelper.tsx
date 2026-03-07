import { useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { morphoBlueExtendedAbi, erc20ApproveAbi } from '../../lib/contracts/abis';
import { getChainConfig } from '../../config/chains';
import { useChainGuard } from '../../lib/hooks/useChainGuard';
import type { MarketParams } from '../../types';

const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const;
const DEAD_DEPOSIT_SHARES = 1_000_000_000n;

interface DeadDepositHelperProps {
  marketParams: MarketParams;
  hasDeadDeposit: boolean;
}

export function DeadDepositHelper({ marketParams, hasDeadDeposit }: DeadDepositHelperProps) {
  const chainId = useChainId();
  const chainConfig = getChainConfig(chainId);
  const { isMismatch } = useChainGuard(chainId);

  const { writeContract: writeApprove, data: approveTxHash, isPending: approvePending } = useWriteContract();
  const { isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash });

  const { writeContract: writeSupply, data: supplyTxHash, isPending: supplyPending } = useWriteContract();
  const { isLoading: supplyConfirming, isSuccess: supplySuccess } = useWaitForTransactionReceipt({ hash: supplyTxHash });

  const handleApprove = () => {
    if (!chainConfig) return;
    writeApprove({
      address: marketParams.loanToken,
      abi: erc20ApproveAbi,
      functionName: 'approve',
      args: [chainConfig.morphoBlue, DEAD_DEPOSIT_SHARES * 2n],
    });
  };

  const handleSupply = () => {
    if (!chainConfig) return;
    writeSupply({
      address: chainConfig.morphoBlue,
      abi: morphoBlueExtendedAbi,
      functionName: 'supply',
      args: [marketParams, 0n, DEAD_DEPOSIT_SHARES, DEAD_ADDRESS, '0x'],
    });
  };

  if (hasDeadDeposit) {
    return (
      <div className="bg-success/10 border border-success/20 rounded-md p-3 text-xs text-success">
        Dead deposit already exists (1e9 shares to 0x...dEaD)
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dead Deposit</CardTitle>
        <Badge variant="warning">Anti-inflation</Badge>
      </CardHeader>

      <div className="space-y-3">
        <p className="text-xs text-text-tertiary">
          Supply 1e9 shares to the dead address (0x...dEaD) to protect against share inflation attacks on new markets.
        </p>

        <div className="flex gap-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleApprove}
            disabled={isMismatch || approvePending || approveSuccess}
            loading={approvePending}
          >
            {approveSuccess ? '1. Approved ✓' : '1. Approve'}
          </Button>
          <Button
            size="sm"
            onClick={handleSupply}
            disabled={isMismatch || !approveSuccess || supplyPending || supplyConfirming || supplySuccess}
            loading={supplyPending || supplyConfirming}
          >
            {supplySuccess ? '2. Done ✓' : '2. Supply Dead Deposit'}
          </Button>
        </div>

        {supplySuccess && (
          <p className="text-xs text-success">Dead deposit complete!</p>
        )}
      </div>
    </Card>
  );
}
