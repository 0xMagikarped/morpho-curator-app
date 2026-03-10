import { useState } from 'react';
import { isAddress, type Address } from 'viem';
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useSimulateContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { getSupportedChainIds, getChainConfig } from '../config/chains';
import {
  validateOracleConfig,
  type ValidationResult,
  type OracleTestConfig,
} from '../lib/oracle/oracleValidator';
import { computeScaleFactor } from '../lib/oracle/oracleDecoder';
import { erc20Abi } from '../lib/contracts/abis';

// ============================================================
// Oracle Factory ABI
// ============================================================

const oracleFactoryAbi = [
  {
    name: 'createMorphoChainlinkOracleV2',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'baseVault', type: 'address' },
      { name: 'baseVaultConversionSample', type: 'uint256' },
      { name: 'baseFeed1', type: 'address' },
      { name: 'baseFeed2', type: 'address' },
      { name: 'baseTokenDecimals', type: 'uint256' },
      { name: 'quoteVault', type: 'address' },
      { name: 'quoteVaultConversionSample', type: 'uint256' },
      { name: 'quoteFeed1', type: 'address' },
      { name: 'quoteFeed2', type: 'address' },
      { name: 'quoteTokenDecimals', type: 'uint256' },
    ],
    outputs: [{ name: 'oracle', type: 'address' }],
  },
] as const;

// ============================================================
// Constants
// ============================================================

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

const INPUT_CLASS =
  'w-full bg-bg-elevated border border-border-subtle px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-border-focus';

// ============================================================
// Types
// ============================================================

type Step = 'configure' | 'validate' | 'deploy';

interface TokenInfo {
  name: string;
  decimals: number;
}

// ============================================================
// Token Info Fetcher
// ============================================================

const fetchTokenInfo = async (
  address: string,
  chainId: number,
  setter: (info: TokenInfo | null) => void,
) => {
  if (!isAddress(address) || address === ZERO_ADDRESS) {
    setter(null);
    return;
  }
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) return;
  try {
    const { createPublicClient, http } = await import('viem');
    const client = createPublicClient({ transport: http(chainConfig.rpcUrls[0]) });
    const [name, decimals] = await Promise.all([
      client.readContract({
        address: address as Address,
        abi: erc20Abi,
        functionName: 'name',
      }),
      client.readContract({
        address: address as Address,
        abi: erc20Abi,
        functionName: 'decimals',
      }),
    ]);
    setter({ name: name as string, decimals: Number(decimals) });
  } catch {
    setter(null);
  }
};

// ============================================================
// Section Header
// ============================================================

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[10px] font-medium text-text-tertiary tracking-wider font-mono uppercase">
      // {children}
    </div>
  );
}

// ============================================================
// Configure Step
// ============================================================

function ConfigureStep({
  chainId,
  setChainId,
  baseToken,
  setBaseToken,
  quoteToken,
  setQuoteToken,
  baseFeed1,
  setBaseFeed1,
  baseFeed2,
  setBaseFeed2,
  quoteFeed1,
  setQuoteFeed1,
  quoteFeed2,
  setQuoteFeed2,
  baseVault,
  setBaseVault,
  quoteVault,
  setQuoteVault,
  baseTokenInfo,
  setBaseTokenInfo,
  quoteTokenInfo,
  setQuoteTokenInfo,
  onValidate,
}: {
  chainId: number;
  setChainId: (id: number) => void;
  baseToken: string;
  setBaseToken: (v: string) => void;
  quoteToken: string;
  setQuoteToken: (v: string) => void;
  baseFeed1: string;
  setBaseFeed1: (v: string) => void;
  baseFeed2: string;
  setBaseFeed2: (v: string) => void;
  quoteFeed1: string;
  setQuoteFeed1: (v: string) => void;
  quoteFeed2: string;
  setQuoteFeed2: (v: string) => void;
  baseVault: string;
  setBaseVault: (v: string) => void;
  quoteVault: string;
  setQuoteVault: (v: string) => void;
  baseTokenInfo: TokenInfo | null;
  setBaseTokenInfo: (info: TokenInfo | null) => void;
  quoteTokenInfo: TokenInfo | null;
  setQuoteTokenInfo: (info: TokenInfo | null) => void;
  onValidate: () => void;
}) {
  const chainIds = getSupportedChainIds();

  const canValidate =
    isAddress(baseToken) &&
    isAddress(quoteToken) &&
    baseTokenInfo !== null &&
    quoteTokenInfo !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configure Oracle Parameters</CardTitle>
        <Badge variant="info">Step 1/3</Badge>
      </CardHeader>

      <div className="space-y-4">
        {/* Chain Selector */}
        <div className="space-y-1.5">
          <SectionLabel>Chain</SectionLabel>
          <select
            value={chainId}
            onChange={(e) => setChainId(Number(e.target.value))}
            className={INPUT_CLASS}
          >
            {chainIds.map((id) => {
              const cfg = getChainConfig(id);
              return (
                <option key={id} value={id}>
                  {cfg?.name ?? `Chain ${id}`} ({id})
                </option>
              );
            })}
          </select>
        </div>

        {/* Base Token */}
        <div className="space-y-1.5">
          <SectionLabel>Base Token Address</SectionLabel>
          <input
            type="text"
            value={baseToken}
            onChange={(e) => setBaseToken(e.target.value)}
            onBlur={() => fetchTokenInfo(baseToken, chainId, setBaseTokenInfo)}
            placeholder="0x..."
            className={INPUT_CLASS}
          />
          {baseTokenInfo && (
            <div className="text-xs text-text-secondary">
              {baseTokenInfo.name} — {baseTokenInfo.decimals} decimals
            </div>
          )}
        </div>

        {/* Quote Token */}
        <div className="space-y-1.5">
          <SectionLabel>Quote Token Address</SectionLabel>
          <input
            type="text"
            value={quoteToken}
            onChange={(e) => setQuoteToken(e.target.value)}
            onBlur={() => fetchTokenInfo(quoteToken, chainId, setQuoteTokenInfo)}
            placeholder="0x..."
            className={INPUT_CLASS}
          />
          {quoteTokenInfo && (
            <div className="text-xs text-text-secondary">
              {quoteTokenInfo.name} — {quoteTokenInfo.decimals} decimals
            </div>
          )}
        </div>

        {/* Feeds */}
        <div className="space-y-1.5">
          <SectionLabel>Price Feeds</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-text-tertiary">BASE_FEED_1</label>
              <input
                type="text"
                value={baseFeed1}
                onChange={(e) => setBaseFeed1(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-tertiary">BASE_FEED_2</label>
              <input
                type="text"
                value={baseFeed2}
                onChange={(e) => setBaseFeed2(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-tertiary">QUOTE_FEED_1</label>
              <input
                type="text"
                value={quoteFeed1}
                onChange={(e) => setQuoteFeed1(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-tertiary">QUOTE_FEED_2</label>
              <input
                type="text"
                value={quoteFeed2}
                onChange={(e) => setQuoteFeed2(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </div>

        {/* Vaults */}
        <div className="space-y-1.5">
          <SectionLabel>ERC-4626 Vaults (optional)</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-text-tertiary">BASE_VAULT</label>
              <input
                type="text"
                value={baseVault}
                onChange={(e) => setBaseVault(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-tertiary">QUOTE_VAULT</label>
              <input
                type="text"
                value={quoteVault}
                onChange={(e) => setQuoteVault(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="pt-2">
          <Button onClick={onValidate} disabled={!canValidate}>
            Run Validation
          </Button>
          {!canValidate && (
            <p className="text-xs text-text-tertiary mt-1.5">
              Enter valid base and quote token addresses to proceed.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

// ============================================================
// Validate Step
// ============================================================

function ValidateStep({
  results,
  scaleFactor,
  isLoading,
  onBack,
  onDeploy,
}: {
  results: ValidationResult[];
  scaleFactor: bigint | null;
  isLoading: boolean;
  onBack: () => void;
  onDeploy: () => void;
}) {
  const hasFails = results.some((r) => r.status === 'fail');

  const statusIcon = (status: ValidationResult['status']) => {
    switch (status) {
      case 'pass':
        return <span className="text-success font-mono">&#10003;</span>;
      case 'warn':
        return <span className="text-warning font-mono">&#9888;</span>;
      case 'fail':
        return <span className="text-danger font-mono">&#10005;</span>;
      case 'skip':
        return <span className="text-text-tertiary font-mono">&mdash;</span>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Running Validation...</CardTitle>
          <Badge variant="info">Step 2/3</Badge>
        </CardHeader>
        <div className="flex items-center gap-2 py-8 justify-center text-text-secondary text-sm">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Querying on-chain data...
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Validation Results</CardTitle>
        <Badge variant={hasFails ? 'danger' : 'success'}>
          {hasFails ? 'Issues Found' : 'All Checks Passed'}
        </Badge>
      </CardHeader>

      <div className="space-y-4">
        {/* Scale Factor */}
        {scaleFactor !== null && (
          <div className="space-y-1">
            <SectionLabel>Computed Scale Factor</SectionLabel>
            <div className="bg-bg-elevated px-3 py-2 font-mono text-xs text-accent-primary break-all">
              {scaleFactor.toString()}
            </div>
          </div>
        )}

        {/* Check Results */}
        <div className="space-y-1">
          <SectionLabel>Checks</SectionLabel>
          <div className="divide-y divide-border-subtle">
            {results.map((result) => (
              <div key={result.id} className="py-2.5 space-y-1">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-4 text-center flex-shrink-0">
                    {statusIcon(result.status)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">
                        {result.name}
                      </span>
                      <Badge
                        variant={
                          result.status === 'pass'
                            ? 'success'
                            : result.status === 'warn'
                              ? 'warning'
                              : result.status === 'fail'
                                ? 'danger'
                                : 'default'
                        }
                      >
                        {result.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5">{result.message}</p>
                    {result.details && (
                      <pre className="text-[11px] text-text-tertiary mt-1 font-mono whitespace-pre-wrap break-all">
                        {result.details}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onDeploy} disabled={hasFails}>
            Deploy Oracle
          </Button>
          {hasFails && (
            <span className="text-xs text-danger">
              Fix failing checks before deploying.
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ============================================================
// Deploy Step
// ============================================================

function DeployStep({
  config,
  baseTokenInfo,
  quoteTokenInfo,
  onBack,
}: {
  config: OracleTestConfig;
  baseTokenInfo: TokenInfo;
  quoteTokenInfo: TokenInfo;
  onBack: () => void;
}) {
  const { address: walletAddress, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChain } = useSwitchChain();

  const chainConfig = getChainConfig(config.chainId);
  const factoryAddress = chainConfig?.periphery.oracleV2Factory as Address | undefined;

  const chainMismatch = walletChainId !== config.chainId;

  // Compute vault conversion samples
  const baseVault = config.baseVault;
  const quoteVault = config.quoteVault;
  const baseVaultSample = baseVault === ZERO_ADDRESS ? 1n : 10n ** 18n;
  const quoteVaultSample = quoteVault === ZERO_ADDRESS ? 1n : 10n ** 18n;

  const { data: simData, error: simError } = useSimulateContract({
    address: factoryAddress!,
    abi: oracleFactoryAbi,
    functionName: 'createMorphoChainlinkOracleV2',
    args: [
      baseVault,
      baseVaultSample,
      config.baseFeed1,
      config.baseFeed2,
      BigInt(config.baseTokenDecimals),
      quoteVault,
      quoteVaultSample,
      config.quoteFeed1,
      config.quoteFeed2,
      BigInt(config.quoteTokenDecimals),
    ],
    query: { enabled: !!factoryAddress && isConnected && !chainMismatch },
  });

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const handleDeploy = () => {
    if (!simData?.request) return;
    writeContract(simData.request);
  };

  // Derive deployed oracle address from simulation result
  const deployedOracle = simData?.result as Address | undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deploy Oracle</CardTitle>
        <Badge variant="info">Step 3/3</Badge>
      </CardHeader>

      <div className="space-y-4">
        {/* Summary */}
        <div className="space-y-1">
          <SectionLabel>Deployment Summary</SectionLabel>
          <div className="bg-bg-elevated px-3 py-2 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-text-tertiary">Chain</span>
              <span className="text-text-primary">{chainConfig?.name ?? config.chainId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-tertiary">Base Token</span>
              <span className="text-text-primary font-mono">
                {baseTokenInfo.name} ({baseTokenInfo.decimals}d)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-tertiary">Quote Token</span>
              <span className="text-text-primary font-mono">
                {quoteTokenInfo.name} ({quoteTokenInfo.decimals}d)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-tertiary">Factory</span>
              <span className="text-text-primary font-mono text-[11px] truncate ml-4">
                {factoryAddress ?? 'Not available'}
              </span>
            </div>
          </div>
        </div>

        {/* Wallet Guard */}
        <div className="space-y-1">
          <SectionLabel>Wallet</SectionLabel>
          {!isConnected ? (
            <div className="bg-bg-elevated px-3 py-2 text-sm text-warning">
              Connect your wallet to deploy.
            </div>
          ) : (
            <div className="bg-bg-elevated px-3 py-2 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">Connected</span>
                <span className="text-text-primary font-mono text-[11px]">{walletAddress}</span>
              </div>
              {chainMismatch && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-warning">
                    Wrong chain. Expected {chainConfig?.name ?? config.chainId}.
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => switchChain({ chainId: config.chainId })}
                  >
                    Switch Chain
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Simulation Error */}
        {simError && !chainMismatch && isConnected && (
          <div className="space-y-1">
            <SectionLabel>Simulation Error</SectionLabel>
            <div className="bg-danger/10 border border-danger/30 px-3 py-2 text-xs text-danger font-mono break-all">
              {simError.message.slice(0, 300)}
            </div>
          </div>
        )}

        {/* Transaction Status */}
        {txHash && (
          <div className="space-y-1">
            <SectionLabel>Transaction</SectionLabel>
            <div className="bg-bg-elevated px-3 py-2 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-text-tertiary">TX Hash</span>
                <a
                  href={`${chainConfig?.blockExplorer}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-primary font-mono text-[11px] hover:underline truncate ml-4"
                >
                  {txHash}
                </a>
              </div>
              <div className="flex justify-between">
                <span className="text-text-tertiary">Status</span>
                <span
                  className={
                    isSuccess
                      ? 'text-success'
                      : isConfirming
                        ? 'text-warning'
                        : 'text-text-secondary'
                  }
                >
                  {isSuccess ? 'Confirmed' : isConfirming ? 'Confirming...' : 'Pending'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Success — show deployed address */}
        {isSuccess && deployedOracle && (
          <div className="space-y-1">
            <SectionLabel>Deployed Oracle</SectionLabel>
            <div className="bg-success/10 border border-success/30 px-3 py-2.5">
              <div className="text-xs text-text-tertiary mb-1">Oracle Address</div>
              <div className="text-sm text-success font-mono break-all">{deployedOracle}</div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button variant="secondary" onClick={onBack} disabled={isConfirming}>
            Back
          </Button>
          {!isSuccess && (
            <Button
              onClick={handleDeploy}
              disabled={!simData?.request || isPending || isConfirming || chainMismatch || !isConnected}
              loading={isPending || isConfirming}
            >
              {isPending
                ? 'Confirm in Wallet...'
                : isConfirming
                  ? 'Confirming...'
                  : 'Deploy Oracle'}
            </Button>
          )}
        </div>

        {!factoryAddress && (
          <div className="text-xs text-danger">
            No oracle factory address configured for this chain.
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================================
// Main Page Component
// ============================================================

export function OracleDeployerPage() {
  const [step, setStep] = useState<Step>('configure');

  // Form state
  const [chainId, setChainId] = useState<number>(getSupportedChainIds()[0]);
  const [baseToken, setBaseToken] = useState('');
  const [quoteToken, setQuoteToken] = useState('');
  const [baseFeed1, setBaseFeed1] = useState(ZERO_ADDRESS as string);
  const [baseFeed2, setBaseFeed2] = useState(ZERO_ADDRESS as string);
  const [quoteFeed1, setQuoteFeed1] = useState(ZERO_ADDRESS as string);
  const [quoteFeed2, setQuoteFeed2] = useState(ZERO_ADDRESS as string);
  const [baseVault, setBaseVault] = useState(ZERO_ADDRESS as string);
  const [quoteVault, setQuoteVault] = useState(ZERO_ADDRESS as string);

  // Token info
  const [baseTokenInfo, setBaseTokenInfo] = useState<TokenInfo | null>(null);
  const [quoteTokenInfo, setQuoteTokenInfo] = useState<TokenInfo | null>(null);

  // Validation state
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [scaleFactor, setScaleFactor] = useState<bigint | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const buildConfig = (): OracleTestConfig => ({
    chainId,
    baseFeed1: (baseFeed1 || ZERO_ADDRESS) as Address,
    baseFeed2: (baseFeed2 || ZERO_ADDRESS) as Address,
    quoteFeed1: (quoteFeed1 || ZERO_ADDRESS) as Address,
    quoteFeed2: (quoteFeed2 || ZERO_ADDRESS) as Address,
    baseVault: (baseVault || ZERO_ADDRESS) as Address,
    quoteVault: (quoteVault || ZERO_ADDRESS) as Address,
    baseTokenAddress: baseToken as Address,
    quoteTokenAddress: quoteToken as Address,
    baseTokenDecimals: baseTokenInfo?.decimals ?? 18,
    quoteTokenDecimals: quoteTokenInfo?.decimals ?? 18,
  });

  const handleValidate = async () => {
    setStep('validate');
    setIsValidating(true);
    setValidationResults([]);
    setScaleFactor(null);

    try {
      const config = buildConfig();
      const results = await validateOracleConfig(config);
      setValidationResults(results);

      // Compute scale factor for display
      // Feed decimals default to 0 when zero-address (matching validator behavior)
      const sf = computeScaleFactor({
        baseTokenDecimals: config.baseTokenDecimals,
        quoteTokenDecimals: config.quoteTokenDecimals,
        baseFeed1Decimals: 0,
        baseFeed2Decimals: 0,
        quoteFeed1Decimals: 0,
        quoteFeed2Decimals: 0,
        baseVaultConversionSample: config.baseVault === ZERO_ADDRESS ? 1n : 10n ** 18n,
        quoteVaultConversionSample: config.quoteVault === ZERO_ADDRESS ? 1n : 10n ** 18n,
      });
      setScaleFactor(sf);
    } catch (err) {
      setValidationResults([
        {
          id: 'validation-error',
          name: 'Validation Error',
          status: 'fail',
          message: `Validation failed: ${String(err)}`,
        },
      ]);
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Oracle Tester & Deployer</h1>
        <p className="text-sm text-text-tertiary mt-0.5">
          Configure, validate, and deploy a MorphoChainlinkOracleV2
        </p>
      </div>

      {step === 'configure' && (
        <ConfigureStep
          chainId={chainId}
          setChainId={setChainId}
          baseToken={baseToken}
          setBaseToken={setBaseToken}
          quoteToken={quoteToken}
          setQuoteToken={setQuoteToken}
          baseFeed1={baseFeed1}
          setBaseFeed1={setBaseFeed1}
          baseFeed2={baseFeed2}
          setBaseFeed2={setBaseFeed2}
          quoteFeed1={quoteFeed1}
          setQuoteFeed1={setQuoteFeed1}
          quoteFeed2={quoteFeed2}
          setQuoteFeed2={setQuoteFeed2}
          baseVault={baseVault}
          setBaseVault={setBaseVault}
          quoteVault={quoteVault}
          setQuoteVault={setQuoteVault}
          baseTokenInfo={baseTokenInfo}
          setBaseTokenInfo={setBaseTokenInfo}
          quoteTokenInfo={quoteTokenInfo}
          setQuoteTokenInfo={setQuoteTokenInfo}
          onValidate={handleValidate}
        />
      )}

      {step === 'validate' && (
        <ValidateStep
          results={validationResults}
          scaleFactor={scaleFactor}
          isLoading={isValidating}
          onBack={() => setStep('configure')}
          onDeploy={() => setStep('deploy')}
        />
      )}

      {step === 'deploy' && baseTokenInfo && quoteTokenInfo && (
        <DeployStep
          config={buildConfig()}
          baseTokenInfo={baseTokenInfo}
          quoteTokenInfo={quoteTokenInfo}
          onBack={() => setStep('validate')}
        />
      )}
    </div>
  );
}
