import { useMemo } from 'react';
import type { Address } from 'viem';
import { keccak256, toHex } from 'viem';
import { useAccount, useReadContract, useSimulateContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useGuardedWriteContract } from '../../hooks/useGuardedWriteContract';
import { useMarketFactoryAddress } from '../../hooks/useMarketFactoryAddress';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { morphoBlueExtendedAbi } from '../../lib/contracts/abis';
import { moolahMarketFactoryAbi } from '../../lib/contracts/moolahAbis';
import { getChainConfig, isChainDeployed } from '../../config/chains';
import { useChainGuard } from '../../lib/hooks/useChainGuard';
import type { MarketFormData } from './MarketForm';

interface MarketDeployerProps {
  data: MarketFormData;
  marketId: `0x${string}`;
  onBack: () => void;
}

const OPERATOR_ROLE = keccak256(toHex('OPERATOR'));

export function MarketDeployer({ data, marketId, onBack }: MarketDeployerProps) {
  const chainId = useChainId();
  const chainConfig = getChainConfig(chainId);
  const { address: account } = useAccount();
  const { isMismatch, requestSwitch } = useChainGuard(chainId);

  const isMoolah = chainConfig?.protocol === 'moolah';
  const { address: resolvedFactory, source: factorySource, isLoading: factoryLoading } =
    useMarketFactoryAddress(isMoolah ? chainId : undefined);
  const moolahMarketFactory = resolvedFactory ?? undefined;

  const marketParams = useMemo(
    () => ({
      loanToken: data.loanToken,
      collateralToken: data.collateralToken,
      oracle: data.oracle,
      irm: data.irm,
      lltv: data.lltv,
    }),
    [data.loanToken, data.collateralToken, data.oracle, data.irm, data.lltv],
  );

  // ------------------------------------------------------------
  // Moolah OPERATOR gating — block the write when not allow-listed
  // ------------------------------------------------------------
  const { data: isOperator, isLoading: operatorCheckLoading } = useReadContract({
    address: moolahMarketFactory as Address | undefined,
    abi: moolahMarketFactoryAbi,
    functionName: 'hasRole',
    args: account && moolahMarketFactory ? [OPERATOR_ROLE, account] : undefined,
    chainId,
    query: { enabled: Boolean(isMoolah && moolahMarketFactory && account) },
  });

  // ------------------------------------------------------------
  // Simulation — targets differ by flavor
  // ------------------------------------------------------------
  const morphoSim = useSimulateContract({
    address: chainConfig?.morphoBlue as Address,
    abi: morphoBlueExtendedAbi,
    functionName: 'createMarket',
    args: [marketParams],
    query: {
      enabled: Boolean(!isMoolah && chainConfig && !isMismatch && isChainDeployed(chainId)),
    },
  });

  const isFixedTerm = data.rateModel === 'fixed' && data.fixedTerm !== undefined;

  // Variable market on Moolah: `createMarket(params, [], [], false, false)`.
  const moolahSim = useSimulateContract({
    address: moolahMarketFactory as Address | undefined,
    abi: moolahMarketFactoryAbi,
    functionName: 'createMarket',
    args: [marketParams, [], [], false, false],
    query: {
      enabled: Boolean(
        isMoolah &&
          !isFixedTerm &&
          moolahMarketFactory &&
          !isMismatch &&
          account &&
          isOperator === true,
      ),
    },
  });

  // Fixed-term market on Moolah: `createFixedTermMarket({ broker, loanToken,
  // collateralToken, irm, lltv, ratePerSecond, maxRatePerSecond })`.
  // loanToken / collateralToken are baked into the broker contract; we still
  // pass them so BscScan's decoder shows intent. Broker owns the canonical
  // values on-chain.
  const fixedTermArgs = data.fixedTerm
    ? ({
        broker: data.fixedTerm.broker,
        loanToken: data.loanToken,
        collateralToken: data.collateralToken,
        irm: data.fixedTerm.rateCalculator,
        lltv: data.lltv,
        ratePerSecond: data.fixedTerm.ratePerSecond,
        maxRatePerSecond: data.fixedTerm.maxRatePerSecond,
      } as const)
    : null;
  const fixedTermSim = useSimulateContract({
    address: moolahMarketFactory as Address | undefined,
    abi: moolahMarketFactoryAbi,
    functionName: 'createFixedTermMarket',
    args: fixedTermArgs ? [fixedTermArgs] : undefined,
    query: {
      enabled: Boolean(
        isMoolah &&
          isFixedTerm &&
          fixedTermArgs &&
          moolahMarketFactory &&
          !isMismatch &&
          account &&
          isOperator === true,
      ),
    },
  });

  const simError = isMoolah
    ? (isFixedTerm ? fixedTermSim.error : moolahSim.error)
    : morphoSim.error;
  const hasSimRequest = isMoolah
    ? (isFixedTerm ? Boolean(fixedTermSim.data?.request) : Boolean(moolahSim.data?.request))
    : Boolean(morphoSim.data?.request);

  const { writeContract, data: txHash, isPending, error: writeError } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const handleDeploy = () => {
    if (isMoolah) {
      if (isFixedTerm) {
        if (!fixedTermSim.data?.request) return;
        writeContract(fixedTermSim.data.request);
      } else {
        if (!moolahSim.data?.request) return;
        writeContract(moolahSim.data.request);
      }
    } else {
      if (!morphoSim.data?.request) return;
      writeContract(morphoSim.data.request);
    }
  };

  // ------------------------------------------------------------
  // Moolah gating states (block before we even run the simulation)
  // ------------------------------------------------------------
  const moolahBlockedReason: string | null = (() => {
    if (!isMoolah) return null;
    if (factoryLoading) return null;
    if (!moolahMarketFactory) {
      return 'Could not resolve the MarketFactory address. Set `VITE_BNB_MARKET_FACTORY` in the env or hardcode it in `src/config/chains.ts`.';
    }
    if (!account) return 'Connect a wallet to check OPERATOR role.';
    if (operatorCheckLoading) return null;
    if (isOperator === false) {
      return 'Market creation on Lista is gated by the OPERATOR role. Contact Lista to get an operator wallet allow-listed, or ask them to deploy the market.';
    }
    return null;
  })();

  // ------------------------------------------------------------
  // Ambient factory-source label (Moolah only)
  // ------------------------------------------------------------
  const factorySourceLabel: Record<Exclude<typeof factorySource, null>, string> = {
    config: 'config',
    env: 'env',
    discovered: 'discovered',
  };
  const factorySourceTooltip: Record<Exclude<typeof factorySource, null>, string> = {
    config: 'Hardcoded in chain config.',
    env: 'Overridden via VITE_BNB_MARKET_FACTORY.',
    discovered: 'Resolved from on-chain probes. Override via VITE_BNB_MARKET_FACTORY or hardcode in chain config.',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            Deploy Market
            {isMoolah && (
              <span className="px-1.5 py-0.5 text-[9px] font-mono tracking-wider uppercase bg-[#F0B90B]/10 border border-[#F0B90B]/30 text-[#F0B90B]">
                Moolah · MarketFactory
              </span>
            )}
          </span>
        </CardTitle>
        {isSuccess ? <Badge variant="success">Deployed</Badge> : <Badge variant="info">Ready</Badge>}
      </CardHeader>

      <div className="space-y-3">
        {isMismatch && (
          <div className="flex items-center justify-between bg-warning/10 border border-warning/20 px-3 py-2">
            <span className="text-xs text-warning">Wrong network</span>
            <Button size="sm" variant="secondary" onClick={requestSwitch}>Switch</Button>
          </div>
        )}

        {isMoolah && (
          <div className="px-3 py-2 bg-[#F0B90B]/5 border border-[#F0B90B]/20 text-[11px] text-text-secondary">
            {isFixedTerm ? (
              <>
                Fixed-term market via{' '}
                <span className="font-mono">MarketFactory.createFixedTermMarket</span>.
                Broker <span className="font-mono text-text-primary">{data.fixedTerm?.brokerLabel}</span>{' '}
                locks in <span className="font-mono text-text-primary">{data.fixedTerm?.aprPercent.toFixed(2)}%</span> APR
                (max {((data.fixedTerm?.aprPercent ?? 0) * 2).toFixed(2)}%).
              </>
            ) : (
              <>
                Variable market via <span className="font-mono">MarketFactory.createMarket</span>,
                wired to the full liquidator + provider stack.
              </>
            )}
          </div>
        )}

        {moolahBlockedReason && (
          <div className="flex items-start gap-2 bg-warning/10 border border-warning/20 px-3 py-2">
            <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-warning">{moolahBlockedReason}</p>
          </div>
        )}

        {simError && !moolahBlockedReason && (
          <div className="bg-danger/10 border border-danger/20 px-3 py-2 max-h-20 overflow-y-auto">
            <p className="text-xs text-danger">Simulation failed: {simError.message}</p>
          </div>
        )}

        {writeError && (
          <div className="bg-danger/10 border border-danger/20 px-3 py-2 max-h-20 overflow-y-auto">
            <p className="text-xs text-danger">Transaction failed: {writeError.message}</p>
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
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Button
            onClick={handleDeploy}
            disabled={
              !hasSimRequest ||
              isPending ||
              isConfirming ||
              isMismatch ||
              isSuccess ||
              Boolean(moolahBlockedReason)
            }
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

        {/* Ambient factory-source label (Moolah only) */}
        {isMoolah && moolahMarketFactory && factorySource && (
          <div
            className="flex items-center gap-1.5 text-[10px] text-text-tertiary"
            title={factorySourceTooltip[factorySource]}
          >
            <span>Market factory:</span>
            <a
              href={`${chainConfig?.blockExplorer}/address/${moolahMarketFactory}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-text-secondary hover:text-text-primary inline-flex items-center gap-0.5"
            >
              {moolahMarketFactory.slice(0, 6)}…{moolahMarketFactory.slice(-4)}
              <ExternalLink size={9} />
            </a>
            <span>(source: {factorySourceLabel[factorySource]})</span>
          </div>
        )}
      </div>
    </Card>
  );
}
