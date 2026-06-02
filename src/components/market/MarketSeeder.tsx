import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWalletClient, useChainId } from 'wagmi';
import {
  createPublicClient,
  custom,
  parseUnits,
  formatUnits,
  type TransactionReceipt,
  type Hash,
  type EIP1193Provider,
} from 'viem';
import { mainnet, base, bsc, xdc } from 'viem/chains';
import type { Chain } from 'viem';
import { CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { getChainConfig } from '../../config/chains';
import { getPublicClient } from '../../lib/data/rpcClient';
import { erc20Abi } from '../../lib/contracts/abis';
import { oracleIntrospectionAbi } from '../../lib/contracts/abis';
import { useChainGuard } from '../../lib/hooks/useChainGuard';
import { sei, pharos } from '../../config/wagmi';
import { computeSeedAmounts, buildSeedSteps, type MarketParamsTuple } from '../../lib/market/seedCalculation';
import type { TransactionStep } from '../../lib/vault/createVault';
import type { MarketFormData } from './MarketForm';

// ============================================================
// Types
// ============================================================

interface MarketSeederProps {
  data: MarketFormData;
  marketId: `0x${string}`;
  onBack: () => void;
}

type SeedStatus = 'configure' | 'executing' | 'complete' | 'failed';

// ============================================================
// Helpers
// ============================================================

const VIEM_CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  1329: sei,
  56: bsc,
  1672: pharos,
  50: xdc,
};

async function waitForReceipt(
  chainId: number,
  hash: Hash,
  timeoutMs = 180_000,
): Promise<TransactionReceipt> {
  const startTime = Date.now();

  const ethereum: EIP1193Provider | undefined =
    typeof window !== 'undefined'
      ? (window as Window & { ethereum?: EIP1193Provider }).ethereum
      : undefined;
  if (ethereum) {
    try {
      const client = createPublicClient({
        chain: VIEM_CHAINS[chainId],
        transport: custom(ethereum),
      });
      return await client.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: timeoutMs,
        pollingInterval: 2_000,
      });
    } catch {
      // fall through
    }
  }

  const elapsed = Date.now() - startTime;
  const remainingTimeout = Math.max(timeoutMs - elapsed, 30_000);
  const publicClient = getPublicClient(chainId);
  return publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: remainingTimeout,
    pollingInterval: 3_000,
  });
}

// ============================================================
// Component
// ============================================================

export function MarketSeeder({ data, marketId, onBack }: MarketSeederProps) {
  const chainId = useChainId();
  const chainConfig = getChainConfig(chainId);
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { isMismatch, requestSwitch } = useChainGuard(chainId);

  const morphoBlue = chainConfig?.morphoBlue;
  const loanDecimals = data.loanTokenMeta?.decimals ?? 18;
  const collateralDecimals = data.collateralTokenMeta?.decimals ?? 18;

  // Configure phase state
  const [loanAmountInput, setLoanAmountInput] = useState('');
  const [oraclePrice, setOraclePrice] = useState<bigint | null>(null);
  const [loanBalance, setLoanBalance] = useState<bigint | null>(null);
  const [collateralBalance, setCollateralBalance] = useState<bigint | null>(null);
  const [loanAllowance, setLoanAllowance] = useState<bigint>(0n);
  const [collateralAllowance, setCollateralAllowance] = useState<bigint>(0n);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  // Execute phase state
  const [status, setStatus] = useState<SeedStatus>('configure');
  const [steps, setSteps] = useState<TransactionStep[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Fetch oracle price + balances + allowances
  useEffect(() => {
    if (!address || !morphoBlue || !data.oracle) return;

    let cancelled = false;
    setFetching(true);
    setFetchError(null);

    const client = getPublicClient(chainId);

    (async () => {
      try {
        const [price, lBal, cBal, lAllow, cAllow] = await Promise.all([
          client.readContract({
            address: data.oracle,
            abi: oracleIntrospectionAbi,
            functionName: 'price',
          }) as Promise<bigint>,
          client.readContract({
            address: data.loanToken,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          }) as Promise<bigint>,
          client.readContract({
            address: data.collateralToken,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          }) as Promise<bigint>,
          client.readContract({
            address: data.loanToken,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address, morphoBlue],
          }) as Promise<bigint>,
          client.readContract({
            address: data.collateralToken,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address, morphoBlue],
          }) as Promise<bigint>,
        ]);

        if (!cancelled) {
          setOraclePrice(price);
          setLoanBalance(lBal);
          setCollateralBalance(cBal);
          setLoanAllowance(lAllow);
          setCollateralAllowance(cAllow);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError((err as Error).message);
        }
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();

    return () => { cancelled = true; };
  }, [address, morphoBlue, data.oracle, data.loanToken, data.collateralToken, chainId]);

  // Compute seed amounts
  const loanAmountRaw = loanAmountInput
    ? parseUnits(loanAmountInput, loanDecimals)
    : 0n;

  const seedAmounts = oraclePrice && loanAmountRaw > 0n
    ? computeSeedAmounts(loanAmountRaw, oraclePrice, loanDecimals, collateralDecimals, data.lltv)
    : null;

  const insufficientLoan = loanBalance !== null && loanAmountRaw > 0n && loanAmountRaw > loanBalance;
  const insufficientCollateral = collateralBalance !== null && seedAmounts && seedAmounts.collateralToSupply > collateralBalance;

  // Build steps and execute
  const handleExecute = useCallback(async () => {
    if (!walletClient || !address || !morphoBlue || !seedAmounts || !oraclePrice) return;

    const mp: MarketParamsTuple = {
      loanToken: data.loanToken,
      collateralToken: data.collateralToken,
      oracle: data.oracle,
      irm: data.irm,
      lltv: data.lltv,
    };

    const txSteps = buildSeedSteps({
      morphoBlue,
      marketParams: mp,
      loanToken: data.loanToken,
      collateralToken: data.collateralToken,
      loanAmount: loanAmountRaw,
      collateralAmount: seedAmounts.collateralToSupply,
      borrowAmount: seedAmounts.borrowAmount,
      sender: address,
      loanAllowance,
      collateralAllowance,
    });

    setSteps(txSteps);
    setCurrentStepIdx(0);
    setStatus('executing');
    setError(null);

    for (let i = 0; i < txSteps.length; i++) {
      setCurrentStepIdx(i);
      setSteps((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: 'confirming' } : s)),
      );

      try {
        const hash = await walletClient.sendTransaction({
          to: txSteps[i].to!,
          data: txSteps[i].data,
          chain: walletClient.chain,
          account: address,
        });

        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, txHash: hash, status: 'confirming' } : s)),
        );

        const receipt = await waitForReceipt(chainId, hash);

        if (receipt.status === 'reverted') {
          throw new Error(`Transaction reverted on-chain (step: ${txSteps[i].label})`);
        }

        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: 'confirmed' } : s)),
        );
      } catch (err) {
        const msg = (err as Error).message ?? 'Unknown error';
        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: 'failed', error: msg } : s)),
        );
        setError(msg);
        setStatus('failed');
        return;
      }
    }

    setStatus('complete');
  }, [
    walletClient, address, morphoBlue, seedAmounts, oraclePrice,
    data, loanAmountRaw, chainId, loanAllowance, collateralAllowance,
  ]);

  // Retry from failed step
  const handleRetry = useCallback(async () => {
    if (!walletClient || !address || steps.length === 0) return;

    setStatus('executing');
    setError(null);

    for (let i = currentStepIdx; i < steps.length; i++) {
      setCurrentStepIdx(i);
      setSteps((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: 'confirming', error: undefined } : s)),
      );

      try {
        const hash = await walletClient.sendTransaction({
          to: steps[i].to!,
          data: steps[i].data,
          chain: walletClient.chain,
          account: address,
        });

        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, txHash: hash, status: 'confirming' } : s)),
        );

        const receipt = await waitForReceipt(chainId, hash);

        if (receipt.status === 'reverted') {
          throw new Error(`Transaction reverted on-chain (step: ${steps[i].label})`);
        }

        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: 'confirmed' } : s)),
        );
      } catch (err) {
        const msg = (err as Error).message ?? 'Unknown error';
        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: 'failed', error: msg } : s)),
        );
        setError(msg);
        setStatus('failed');
        return;
      }
    }

    setStatus('complete');
  }, [walletClient, address, steps, currentStepIdx, chainId]);

  // Fixed-term guard
  if (data.rateModel === 'fixed') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Seed Market</CardTitle>
        </CardHeader>
        <div className="p-4">
          <p className="text-xs text-text-tertiary">
            Fixed-term markets use a broker model and cannot be seeded through this flow.
            Contact the broker operator to arrange initial liquidity.
          </p>
          <Button variant="ghost" onClick={onBack} className="mt-3">Back</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            Seed Market
            <Badge variant="info">90% Utilization</Badge>
          </span>
        </CardTitle>
      </CardHeader>

      <div className="space-y-4">
        {/* Chain mismatch */}
        {isMismatch && (
          <div className="flex items-center justify-between bg-warning/10 border border-warning/20 px-3 py-2">
            <span className="text-xs text-warning">Wrong network</span>
            <Button size="sm" variant="secondary" onClick={requestSwitch}>Switch</Button>
          </div>
        )}

        {fetchError && (
          <div className="bg-danger/10 border border-danger/20 px-3 py-2">
            <p className="text-xs text-danger">Failed to fetch on-chain data: {fetchError}</p>
          </div>
        )}

        {/* Configure phase */}
        {status === 'configure' && (
          <>
            <div className="space-y-3">
              <div className="bg-bg-hover p-3 space-y-2">
                <p className="text-[10px] text-text-tertiary uppercase tracking-wider">Market</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-text-tertiary">Loan:</span>{' '}
                    <span className="font-mono text-text-primary">
                      {data.loanTokenMeta?.symbol ?? data.loanToken.slice(0, 10)}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Collateral:</span>{' '}
                    <span className="font-mono text-text-primary">
                      {data.collateralTokenMeta?.symbol ?? data.collateralToken.slice(0, 10)}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">LLTV:</span>{' '}
                    <span className="font-mono text-text-primary">
                      {(Number(data.lltv) / 1e18 * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Market ID:</span>{' '}
                    <span className="font-mono text-text-primary text-[10px]">
                      {marketId.slice(0, 10)}…{marketId.slice(-6)}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-text-tertiary uppercase block mb-1">
                  Loan Supply Amount ({data.loanTokenMeta?.symbol ?? 'TOKEN'})
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={loanAmountInput}
                  onChange={(e) => setLoanAmountInput(e.target.value)}
                  placeholder={`e.g. 1000`}
                  className="w-full bg-bg-hover border border-border-default px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
                />
                {loanBalance !== null && (
                  <p className="text-[10px] text-text-tertiary mt-1">
                    Balance: <span className="font-mono">{formatUnits(loanBalance, loanDecimals)}</span> {data.loanTokenMeta?.symbol}
                  </p>
                )}
                {insufficientLoan && (
                  <p className="text-[10px] text-danger mt-0.5">Insufficient loan token balance</p>
                )}
              </div>

              {/* Computed breakdown */}
              {seedAmounts && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-bg-hover p-3">
                    <span className="text-[10px] text-text-tertiary uppercase block">Dead Deposit</span>
                    <p className="text-sm font-mono text-text-primary">1e9 shares</p>
                    <p className="text-[10px] text-text-tertiary">→ 0x...dEaD</p>
                  </div>
                  <div className="bg-bg-hover p-3">
                    <span className="text-[10px] text-text-tertiary uppercase block">Loan Supply</span>
                    <p className="text-sm font-mono text-text-primary">
                      {loanAmountInput} {data.loanTokenMeta?.symbol}
                    </p>
                  </div>
                  <div className="bg-bg-hover p-3">
                    <span className="text-[10px] text-text-tertiary uppercase block">Borrow (90%)</span>
                    <p className="text-sm font-mono text-text-primary">
                      {formatUnits(seedAmounts.borrowAmount, loanDecimals)} {data.loanTokenMeta?.symbol}
                    </p>
                  </div>
                  <div className="bg-bg-hover p-3">
                    <span className="text-[10px] text-text-tertiary uppercase block">Collateral Needed</span>
                    <p className="text-sm font-mono text-text-primary">
                      {formatUnits(seedAmounts.collateralToSupply, collateralDecimals)} {data.collateralTokenMeta?.symbol}
                    </p>
                    <p className="text-[10px] text-text-tertiary">(incl. 5% buffer)</p>
                    {insufficientCollateral && (
                      <p className="text-[10px] text-danger mt-0.5">Insufficient balance</p>
                    )}
                  </div>
                  <div className="bg-bg-hover p-3 col-span-2">
                    <span className="text-[10px] text-text-tertiary uppercase block">Effective LTV</span>
                    <p className={`text-sm font-mono ${seedAmounts.effectiveLtv < Number(data.lltv) / 1e18 ? 'text-success' : 'text-danger'}`}>
                      {(seedAmounts.effectiveLtv * 100).toFixed(2)}%
                    </p>
                    <p className="text-[10px] text-text-tertiary">
                      Liquidation at {(Number(data.lltv) / 1e18 * 100).toFixed(1)}% — {' '}
                      {seedAmounts.effectiveLtv < Number(data.lltv) / 1e18
                        ? 'safe margin'
                        : 'above LLTV!'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button variant="ghost" onClick={onBack}>Back</Button>
              <Button
                onClick={handleExecute}
                disabled={
                  !seedAmounts ||
                  !address ||
                  isMismatch ||
                  fetching ||
                  insufficientLoan ||
                  insufficientCollateral === true
                }
                loading={fetching}
                className="flex-1"
              >
                Execute Seed ({seedAmounts ? (loanAllowance >= loanAmountRaw ? 5 : 6) : '?'} transactions)
              </Button>
            </div>
          </>
        )}

        {/* Execution phase */}
        {(status === 'executing' || status === 'complete' || status === 'failed') && (
          <>
            <div className="space-y-2">
              {steps.map((step, idx) => (
                <StepRow key={step.id} step={step} idx={idx} chainId={chainId} />
              ))}
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-danger/10 border border-danger/20 px-3 py-2">
                <AlertTriangle size={14} className="text-danger shrink-0 mt-0.5" />
                <p className="text-xs text-danger">{error}</p>
              </div>
            )}

            {status === 'complete' && (
              <div className="bg-success/10 border border-success/20 px-3 py-2">
                <p className="text-xs text-success">
                  Market seeded successfully at 90% utilization!
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="ghost" onClick={onBack}>
                {status === 'complete' ? 'Done' : 'Back'}
              </Button>
              {status === 'failed' && (
                <Button onClick={handleRetry} className="flex-1">
                  Retry from step {currentStepIdx + 1}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

// ============================================================
// Step Row
// ============================================================

function StepRow({
  step,
  idx,
  chainId,
}: {
  step: TransactionStep;
  idx: number;
  chainId: number;
}) {
  const chainConfig = getChainConfig(chainId);
  const explorerUrl = step.txHash && chainConfig?.blockExplorer
    ? `${chainConfig.blockExplorer}/tx/${step.txHash}`
    : null;

  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-bg-hover">
      <span className="text-xs font-mono text-text-tertiary w-5 text-center">{idx + 1}</span>

      {step.status === 'pending' && (
        <div className="w-4 h-4 border border-border-default" />
      )}
      {step.status === 'confirming' && (
        <Loader2 size={16} className="text-info animate-spin" />
      )}
      {step.status === 'confirmed' && (
        <CheckCircle2 size={16} className="text-success" />
      )}
      {step.status === 'failed' && (
        <XCircle size={16} className="text-danger" />
      )}

      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-primary truncate">{step.label}</p>
        {step.error && (
          <p className="text-[10px] text-danger truncate">{step.error}</p>
        )}
      </div>

      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] font-mono text-text-tertiary hover:text-text-secondary"
        >
          {step.txHash!.slice(0, 8)}…
        </a>
      )}
    </div>
  );
}
