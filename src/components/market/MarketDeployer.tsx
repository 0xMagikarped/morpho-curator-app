import type { Address } from 'viem';
import { useSimulateContract, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { morphoBlueExtendedAbi } from '../../lib/contracts/abis';
import { getChainConfig } from '../../config/chains';
import { useChainGuard } from '../../lib/hooks/useChainGuard';
import type { MarketFormData } from './MarketForm';

interface MarketDeployerProps {
  data: MarketFormData;
  marketId: `0x${string}`;
  onBack: () => void;
}

export function MarketDeployer({ data, marketId, onBack }: MarketDeployerProps) {
  const chainId = useChainId();
  const chainConfig = getChainConfig(chainId);
  const { isMismatch, requestSwitch } = useChainGuard(chainId);

  const marketParams = {
    loanToken: data.loanToken,
    collateralToken: data.collateralToken,
    oracle: data.oracle,
    irm: data.irm,
    lltv: data.lltv,
  };

  const { data: simData, error: simError } = useSimulateContract({
    address: chainConfig?.morphoBlue as Address,
    abi: morphoBlueExtendedAbi,
    functionName: 'createMarket',
    args: [marketParams],
    query: { enabled: !!chainConfig && !isMismatch },
  });

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const handleDeploy = () => {
    if (!simData?.request) return;
    writeContract(simData.request);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deploy Market</CardTitle>
        {isSuccess ? <Badge variant="success">Deployed</Badge> : <Badge variant="info">Ready</Badge>}
      </CardHeader>

      <div className="space-y-3">
        {isMismatch && (
          <div className="flex items-center justify-between bg-warning/10 border border-warning/20 px-3 py-2">
            <span className="text-xs text-warning">Wrong network</span>
            <Button size="sm" variant="secondary" onClick={requestSwitch}>
              Switch
            </Button>
          </div>
        )}

        {simError && (
          <div className="bg-danger/10 border border-danger/20 px-3 py-2">
            <p className="text-xs text-danger">
              Simulation failed: {simError.message.slice(0, 200)}
            </p>
          </div>
        )}

        {writeError && (
          <div className="bg-danger/10 border border-danger/20 px-3 py-2">
            <p className="text-xs text-danger">
              Transaction failed: {writeError.message.slice(0, 200)}
            </p>
          </div>
        )}

        {isSuccess && txHash && (
          <div className="bg-success/10 border border-success/20 px-3 py-2 space-y-1">
            <p className="text-xs text-success">Market deployed successfully!</p>
            <p className="text-xs text-text-secondary font-mono">Tx: {txHash}</p>
            <p className="text-xs text-text-secondary font-mono">Market ID: {marketId}</p>
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button
            onClick={handleDeploy}
            disabled={!simData?.request || isPending || isConfirming || isMismatch || isSuccess}
            loading={isPending || isConfirming}
            className="flex-1"
          >
            {isPending
              ? 'Signing...'
              : isConfirming
                ? 'Confirming...'
                : isSuccess
                  ? 'Deployed'
                  : 'Create Market'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
