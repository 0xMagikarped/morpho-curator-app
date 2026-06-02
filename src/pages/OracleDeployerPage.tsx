import { useEffect, useMemo, useState } from 'react';
import { isAddress, type Address } from 'viem';
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useSimulateContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { useGuardedWriteContract } from '../hooks/useGuardedWriteContract';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { getSupportedChainIds, getChainConfig } from '../config/chains';
import {
  validateOracleConfig,
  pickVaultConversionSample,
  type ValidationResult,
  type OracleTestConfig,
} from '../lib/oracle/oracleValidator';
import { computeScaleFactor } from '../lib/oracle/oracleDecoder';
import { erc20Abi, oracleV2FactoryAbi } from '../lib/contracts/abis';
import { decodeEventLog } from 'viem';

// Minimal IOracle ABI for the post-deploy price() sanity check.
const deployedOraclePriceAbi = [
  {
    name: 'price',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
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

interface OracleTokenInfo {
  name: string;
  decimals: number;
}

// ============================================================
// Token Info Fetcher
// ============================================================

const fetchOracleTokenInfo = async (
  address: string,
  chainId: number,
  setter: (info: OracleTokenInfo | null) => void,
  /**
   * Optional seed callback: invoked with the fetched decimals iff the
   * decimals input is currently blank. The caller passes a function that
   * checks the current input and only overwrites a blank one — this is
   * the "auto-fill but don't clobber an explicit override" behavior.
   */
  seedDecimals?: (fetched: number) => void,
) => {
  if (!isAddress(address) || address === ZERO_ADDRESS) {
    setter(null);
    return;
  }
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) return;
  try {
    const { getPublicClient } = await import('../lib/data/rpcClient');
    const client = getPublicClient(chainId);
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
    const dec = Number(decimals);
    setter({ name: name as string, decimals: dec });
    if (seedDecimals && Number.isFinite(dec)) seedDecimals(dec);
  } catch {
    setter(null);
  }
};

// ============================================================
// Decimals input helper
// ============================================================

/**
 * Parse the decimals input field. Returns `null` when the input is
 * blank or not a non-negative integer in the valid ERC-20 range (we
 * accept 0..36 — the MorphoChainlinkOracleV2 scale-factor exponent
 * math doesn't tolerate larger values without overflow, and no real
 * token uses more than 36 anyway). Used as the validate-gate signal
 * so we never silently fall back to a default like 18.
 */
function parseDecimalsInput(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > 36) return null;
  return n;
}

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

/**
 * Editable decimals input with confirmation against the on-chain
 * `decimals()` read. The curator has to either accept the fetched
 * value or explicitly type a different one — there is no silent
 * fallback to 18. If the entered value doesn't match the fetched
 * value, the row turns warning to make the override impossible to
 * miss. If the token-info fetch failed, the field stays empty and
 * the validate gate stays closed.
 */
function DecimalsField({
  label,
  inputId,
  value,
  onChange,
  fetched,
}: {
  label: string;
  inputId: string;
  value: string;
  onChange: (v: string) => void;
  fetched: OracleTokenInfo | null;
}) {
  const parsed = parseDecimalsInput(value);
  const fetchedDec = fetched?.decimals ?? null;
  const isOverride = parsed !== null && fetchedDec !== null && parsed !== fetchedDec;
  const isInvalid = value.trim() !== '' && parsed === null;

  return (
    <div className="mt-1.5 space-y-1">
      <label htmlFor={inputId} className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={inputId}
          type="number"
          min={0}
          max={36}
          step={1}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. 18"
          className={`${INPUT_CLASS} w-24 ${
            isInvalid
              ? 'border-danger'
              : isOverride
                ? 'border-warning'
                : ''
          }`}
        />
        <div className="text-xs">
          {fetched ? (
            <span className="text-text-secondary">
              <span className="text-text-tertiary">on-chain:</span>{' '}
              <span className="font-mono">{fetched.name}</span>{' '}
              <span className="text-text-tertiary">·</span>{' '}
              <span className="font-mono">{fetched.decimals}d</span>
            </span>
          ) : (
            <span className="text-text-tertiary">enter token address to auto-fill</span>
          )}
        </div>
      </div>
      {isInvalid && (
        <p className="text-[11px] text-danger">
          Decimals must be an integer between 0 and 36.
        </p>
      )}
      {isOverride && (
        <p className="text-[11px] text-warning">
          ⚠ Overriding on-chain value ({fetchedDec}d). The deployed oracle will use{' '}
          <span className="font-mono">{parsed}</span> — double-check this is what you intend.
        </p>
      )}
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
  baseOracleTokenInfo,
  setBaseOracleTokenInfo,
  quoteOracleTokenInfo,
  setQuoteOracleTokenInfo,
  baseDecimalsInput,
  setBaseDecimalsInput,
  quoteDecimalsInput,
  setQuoteDecimalsInput,
  saltInput,
  setSaltInput,
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
  baseOracleTokenInfo: OracleTokenInfo | null;
  setBaseOracleTokenInfo: (info: OracleTokenInfo | null) => void;
  quoteOracleTokenInfo: OracleTokenInfo | null;
  setQuoteOracleTokenInfo: (info: OracleTokenInfo | null) => void;
  baseDecimalsInput: string;
  setBaseDecimalsInput: (v: string) => void;
  quoteDecimalsInput: string;
  setQuoteDecimalsInput: (v: string) => void;
  saltInput: string;
  setSaltInput: (v: string) => void;
  onValidate: () => void;
}) {
  const chainIds = getSupportedChainIds();

  // Parse the editable decimals; null = invalid / blank. The validate gate
  // requires both to parse cleanly so we never silently fall back to 18.
  const parsedBaseDecimals = parseDecimalsInput(baseDecimalsInput);
  const parsedQuoteDecimals = parseDecimalsInput(quoteDecimalsInput);
  const saltValid = /^0x[0-9a-fA-F]{64}$/.test(saltInput);

  const canValidate =
    isAddress(baseToken) &&
    isAddress(quoteToken) &&
    parsedBaseDecimals !== null &&
    parsedQuoteDecimals !== null &&
    saltValid;

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
          <SectionLabel>Base Token Address (Collateral)</SectionLabel>
          <input
            type="text"
            value={baseToken}
            onChange={(e) => setBaseToken(e.target.value)}
            onBlur={() =>
              fetchOracleTokenInfo(baseToken, chainId, setBaseOracleTokenInfo, (fetched) => {
                // Only seed if the field is blank — never clobber an
                // explicit override the curator typed in.
                if (parseDecimalsInput(baseDecimalsInput) === null) {
                  setBaseDecimalsInput(String(fetched));
                }
              })
            }
            placeholder="0x..."
            className={INPUT_CLASS}
          />
          <DecimalsField
            label="Base Token Decimals"
            inputId="base-decimals"
            value={baseDecimalsInput}
            onChange={setBaseDecimalsInput}
            fetched={baseOracleTokenInfo}
          />
        </div>

        {/* Quote Token */}
        <div className="space-y-1.5">
          <SectionLabel>Quote Token Address (Loan)</SectionLabel>
          <input
            type="text"
            value={quoteToken}
            onChange={(e) => setQuoteToken(e.target.value)}
            onBlur={() =>
              fetchOracleTokenInfo(quoteToken, chainId, setQuoteOracleTokenInfo, (fetched) => {
                if (parseDecimalsInput(quoteDecimalsInput) === null) {
                  setQuoteDecimalsInput(String(fetched));
                }
              })
            }
            placeholder="0x..."
            className={INPUT_CLASS}
          />
          <DecimalsField
            label="Quote Token Decimals"
            inputId="quote-decimals"
            value={quoteDecimalsInput}
            onChange={setQuoteDecimalsInput}
            fetched={quoteOracleTokenInfo}
          />
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

        {/* Salt (CREATE2). 0x0…0 is fine for a first deploy; rotate it
            only if the predicted address collides with an existing oracle. */}
        <div className="space-y-1.5">
          <SectionLabel>CREATE2 Salt</SectionLabel>
          <input
            type="text"
            value={saltInput}
            onChange={(e) => setSaltInput(e.target.value)}
            placeholder="0x0000...0000 (32 bytes)"
            className={`${INPUT_CLASS} ${!saltValid ? 'border-danger' : ''}`}
          />
          {!saltValid && (
            <p className="text-[11px] text-danger">
              Salt must be 0x + 64 hex chars (32 bytes).
            </p>
          )}
          <p className="text-[11px] text-text-tertiary">
            Same (params, salt) returns the SAME oracle address via CREATE2 —
            the factory is idempotent. Change the salt to deploy a fresh
            instance with otherwise identical parameters.
          </p>
        </div>

        {/* Submit */}
        <div className="pt-2">
          <Button onClick={onValidate} disabled={!canValidate}>
            Run Validation
          </Button>
          {!canValidate && (
            <p className="text-xs text-text-tertiary mt-1.5">
              Enter valid base/quote token addresses AND confirm decimals (0–36)
              to proceed. The deployed oracle will use the decimals you confirm
              here — no silent defaults.
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
  scaleFactorResult,
  isLoading,
  onBack,
  onDeploy,
}: {
  results: ValidationResult[];
  scaleFactorResult: { exponent: number; scaleFactor: bigint; valid: boolean } | null;
  isLoading: boolean;
  onBack: () => void;
  onDeploy: () => void;
}) {
  const hasFails = results.some((r) => r.status === 'fail');
  // Negative-exponent SCALE_FACTOR is an irrecoverable on-chain revert
  // (Morpho's unchecked uint256 math). Block deploy even if every check
  // returned `pass` — the math is fundamentally wrong for these decimals.
  const invalidScale = scaleFactorResult !== null && !scaleFactorResult.valid;
  const blockDeploy = hasFails || invalidScale;

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
        {/* Scale Factor — now derived from REAL on-chain feed decimals
            and the probed vault conversion samples, so this number
            matches what the factory will deploy. */}
        {scaleFactorResult !== null && (
          <div className="space-y-1">
            <SectionLabel>Computed Scale Factor</SectionLabel>
            {scaleFactorResult.valid ? (
              <div className="bg-bg-elevated px-3 py-2 text-xs space-y-1">
                <div className="font-mono text-accent-primary break-all">
                  {scaleFactorResult.scaleFactor.toString()}
                </div>
                <div className="text-text-tertiary">
                  exponent = 10^{scaleFactorResult.exponent} ·
                  quoteVaultSample / baseVaultSample
                </div>
              </div>
            ) : (
              <div className="bg-danger/10 border border-danger/30 px-3 py-2 text-xs text-danger">
                Invalid scale factor: exponent ={' '}
                <span className="font-mono">{scaleFactorResult.exponent}</span> is
                negative. The on-chain factory will revert with an unchecked
                underflow. Adjust token / feed decimals before deploying.
              </div>
            )}
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
          <Button onClick={onDeploy} disabled={blockDeploy}>
            Deploy Oracle
          </Button>
          {blockDeploy && (
            <span className="text-xs text-danger">
              {invalidScale
                ? 'Negative-exponent scale factor — fix decimals before deploying.'
                : 'Fix failing checks before deploying.'}
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
  baseOracleTokenInfo,
  quoteOracleTokenInfo,
  onBack,
}: {
  config: OracleTestConfig;
  baseOracleTokenInfo: OracleTokenInfo;
  quoteOracleTokenInfo: OracleTokenInfo;
  onBack: () => void;
}) {
  const { address: walletAddress, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChain } = useSwitchChain();

  const chainConfig = getChainConfig(config.chainId);
  const factoryAddress = chainConfig?.periphery.oracleV2Factory as Address | undefined;

  const chainMismatch = walletChainId !== config.chainId;

  // Vault conversion samples come from the validator (probed on-chain so
  // convertToAssets(sample) lands in [1e18, 1e36] — Morpho's precision
  // requirement). Salt is a curator-supplied bytes32; default 0x0…0.
  const baseVault = config.baseVault;
  const quoteVault = config.quoteVault;

  const { data: simData, error: simError } = useSimulateContract({
    address: factoryAddress!,
    abi: oracleV2FactoryAbi,
    functionName: 'createMorphoChainlinkOracleV2',
    args: [
      baseVault,
      config.baseVaultConversionSample,
      config.baseFeed1,
      config.baseFeed2,
      BigInt(config.baseTokenDecimals),
      quoteVault,
      config.quoteVaultConversionSample,
      config.quoteFeed1,
      config.quoteFeed2,
      BigInt(config.quoteTokenDecimals),
      config.salt,
    ],
    query: { enabled: !!factoryAddress && isConnected && !chainMismatch },
  });

  const { writeContract, data: txHash, isPending } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const handleDeploy = () => {
    if (!simData?.request) return;
    writeContract(simData.request);
  };

  // The deployed oracle's address has two possible sources:
  //   1. `simData.result` — the value the factory will RETURN. With CREATE2
  //      this is the deterministic address for (params, salt). If the same
  //      tuple was used before, the factory returns the EXISTING oracle
  //      address (idempotent) and the tx is essentially a no-op.
  //   2. The `CreateMorphoChainlinkOracleV2` event in the receipt — this
  //      is the source of truth: emitted iff the factory actually deployed
  //      new bytecode.
  // We prefer (2) when available; for the pre-deploy "expected address"
  // banner we fall back to (1).
  const predictedOracle = simData?.result as Address | undefined;
  const deployedOracle = useMemo<Address | undefined>(() => {
    if (!receipt) return predictedOracle;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: oracleV2FactoryAbi,
          data: log.data,
          topics: log.topics,
          eventName: 'CreateMorphoChainlinkOracleV2',
        });
        return decoded.args.oracle as Address;
      } catch {
        // Not our event — skip.
      }
    }
    return predictedOracle;
  }, [receipt, predictedOracle]);

  // H5: post-deploy `price()` sanity read. Confirms the oracle returns
  // a non-zero value of plausible magnitude before the curator wires it
  // into a market. A simulated-success tx with broken price scaling
  // would otherwise look identical to a real success.
  const { data: postDeployPrice, isLoading: pricePending } = useReadContract({
    address: deployedOracle,
    abi: deployedOraclePriceAbi,
    functionName: 'price',
    chainId: config.chainId,
    query: { enabled: !!deployedOracle && isSuccess },
  });

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
                {baseOracleTokenInfo.name} ({config.baseTokenDecimals}d
                {config.baseTokenDecimals !== baseOracleTokenInfo.decimals && (
                  <span className="text-warning">
                    {' '}
                    — overrides on-chain {baseOracleTokenInfo.decimals}d
                  </span>
                )}
                )
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-tertiary">Quote Token</span>
              <span className="text-text-primary font-mono">
                {quoteOracleTokenInfo.name} ({config.quoteTokenDecimals}d
                {config.quoteTokenDecimals !== quoteOracleTokenInfo.decimals && (
                  <span className="text-warning">
                    {' '}
                    — overrides on-chain {quoteOracleTokenInfo.decimals}d
                  </span>
                )}
                )
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
            <div className="bg-danger/10 border border-danger/30 px-3 py-2 text-xs text-danger font-mono break-all max-h-20 overflow-y-auto">
              {simError.message}
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

        {/* Pre-deploy predicted address (CREATE2) — helps catch the
            "I already deployed this exact tuple" case before signing. */}
        {predictedOracle && !txHash && (
          <div className="space-y-1">
            <SectionLabel>Predicted Address (CREATE2)</SectionLabel>
            <div className="bg-bg-elevated px-3 py-2 text-xs space-y-1">
              <div className="font-mono text-text-primary break-all">{predictedOracle}</div>
              <div className="text-[11px] text-text-tertiary">
                If this oracle already exists at this address, the
                factory is idempotent and your tx will return the same
                address without redeploying. Change the salt below to
                deploy a fresh instance.
              </div>
            </div>
          </div>
        )}

        {/* Success — show deployed address + post-deploy price() sanity. */}
        {isSuccess && deployedOracle && (
          <div className="space-y-1">
            <SectionLabel>Deployed Oracle</SectionLabel>
            <div className="bg-success/10 border border-success/30 px-3 py-2.5 space-y-2">
              <div>
                <div className="text-xs text-text-tertiary mb-1">Oracle Address</div>
                <div className="text-sm text-success font-mono break-all">{deployedOracle}</div>
              </div>
              <div>
                <div className="text-xs text-text-tertiary mb-1">price() sanity read</div>
                {pricePending && (
                  <div className="text-xs text-text-secondary">Reading on-chain price()…</div>
                )}
                {!pricePending && postDeployPrice !== undefined && (
                  <div className="text-xs space-y-0.5">
                    <div className="font-mono text-text-primary break-all">
                      {(postDeployPrice as bigint).toString()}
                    </div>
                    {(postDeployPrice as bigint) === 0n ? (
                      <div className="text-danger">
                        ⚠ Oracle returned price() == 0. Do NOT attach this oracle to a
                        market — investigate feed answers and SCALE_FACTOR before use.
                      </div>
                    ) : (
                      <div className="text-text-tertiary">
                        Non-zero price returned. Sanity-check the order of magnitude
                        against your expected price for {baseOracleTokenInfo.name}/
                        {quoteOracleTokenInfo.name} before wiring this oracle into a
                        market.
                      </div>
                    )}
                  </div>
                )}
                {!pricePending && postDeployPrice === undefined && (
                  <div className="text-xs text-warning">
                    Could not read price(). The oracle deployed, but verify
                    manually before use.
                  </div>
                )}
              </div>
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

  // Token info (auto-fetched name + decimals; reference value the curator
  // confirms against)
  const [baseOracleTokenInfo, setBaseOracleTokenInfo] = useState<OracleTokenInfo | null>(null);
  const [quoteOracleTokenInfo, setQuoteOracleTokenInfo] = useState<OracleTokenInfo | null>(null);

  // Curator-confirmed decimals (editable, empty string = unset). These are
  // the values that actually get sent to the factory — there is no silent
  // fallback. The Run-Validation button stays disabled until both parse
  // cleanly via parseDecimalsInput.
  const [baseDecimalsInput, setBaseDecimalsInput] = useState('');
  const [quoteDecimalsInput, setQuoteDecimalsInput] = useState('');

  // CREATE2 salt — bytes32. Defaults to all zeros (the simplest deterministic
  // tuple); curators can rotate it to redeploy a fresh oracle when the
  // factory's CREATE2 idempotency hits an existing oracle at the predicted
  // address. Stored as the typed string so we can validate format before
  // casting to `0x${string}`.
  const [saltInput, setSaltInput] = useState<string>(
    '0x0000000000000000000000000000000000000000000000000000000000000000',
  );

  // Validation state. Holds the validator's results, the (probed) vault
  // conversion samples, and the post-validation scale factor preview
  // computed with REAL feed decimals (was hardcoded 0 before).
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [validatedSamples, setValidatedSamples] = useState<{
    base: bigint | null;
    quote: bigint | null;
  }>({ base: null, quote: null });
  const [scaleFactorResult, setScaleFactorResult] = useState<{
    exponent: number;
    scaleFactor: bigint;
    valid: boolean;
  } | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // H4: any change to chainId invalidates every downstream piece of state
  // that was derived from an on-chain read on the previous chain. Without
  // this, a curator could fetch USDC-on-Base decimals, switch the dropdown
  // to Eth, and deploy with the wrong token-info bound to the new chain's
  // factory address.
  useEffect(() => {
    setBaseOracleTokenInfo(null);
    setQuoteOracleTokenInfo(null);
    setBaseDecimalsInput('');
    setQuoteDecimalsInput('');
    setValidationResults([]);
    setValidatedSamples({ base: null, quote: null });
    setScaleFactorResult(null);
    setStep('configure');
  }, [chainId]);

  const isValidSalt = /^0x[0-9a-fA-F]{64}$/.test(saltInput);

  /**
   * Build the test config. Fails closed: throws if the decimals inputs,
   * salt, or probed vault samples haven't been confirmed. The throw is
   * defence in depth so a future refactor can't sneak a silent default
   * (18 decimals, 1e18 sample, zero salt) back in.
   */
  const buildConfig = (): OracleTestConfig => {
    const baseDec = parseDecimalsInput(baseDecimalsInput);
    const quoteDec = parseDecimalsInput(quoteDecimalsInput);
    if (baseDec === null || quoteDec === null) {
      throw new Error('Decimals not confirmed — enter base and quote token decimals before proceeding.');
    }
    if (!isValidSalt) {
      throw new Error('Salt must be a 32-byte hex string (0x + 64 hex chars).');
    }
    if (validatedSamples.base === null || validatedSamples.quote === null) {
      throw new Error('Vault conversion samples not validated — run validation before proceeding.');
    }
    return {
      chainId,
      baseFeed1: (baseFeed1 || ZERO_ADDRESS) as Address,
      baseFeed2: (baseFeed2 || ZERO_ADDRESS) as Address,
      quoteFeed1: (quoteFeed1 || ZERO_ADDRESS) as Address,
      quoteFeed2: (quoteFeed2 || ZERO_ADDRESS) as Address,
      baseVault: (baseVault || ZERO_ADDRESS) as Address,
      quoteVault: (quoteVault || ZERO_ADDRESS) as Address,
      baseTokenAddress: baseToken as Address,
      quoteTokenAddress: quoteToken as Address,
      baseTokenDecimals: baseDec,
      quoteTokenDecimals: quoteDec,
      baseVaultConversionSample: validatedSamples.base,
      quoteVaultConversionSample: validatedSamples.quote,
      salt: saltInput as `0x${string}`,
    };
  };

  const handleValidate = async () => {
    setStep('validate');
    setIsValidating(true);
    setValidationResults([]);
    setScaleFactorResult(null);
    setValidatedSamples({ base: null, quote: null });

    // Probe the vault conversion samples on chain (C2) BEFORE constructing
    // the config — config.buildConfig() throws if these aren't set, and we
    // want the validation step to be the one to surface a vault probe
    // failure rather than an opaque "samples not validated" error.
    const baseDec = parseDecimalsInput(baseDecimalsInput);
    const quoteDec = parseDecimalsInput(quoteDecimalsInput);
    if (baseDec === null || quoteDec === null) {
      setValidationResults([
        {
          id: 'decimals-not-confirmed',
          name: 'Decimals',
          status: 'fail',
          message: 'Confirm base and quote token decimals before validating.',
        },
      ]);
      setIsValidating(false);
      return;
    }

    const { getPublicClient } = await import('../lib/data/rpcClient');
    const client = getPublicClient(chainId);
    const baseV = (baseVault || ZERO_ADDRESS) as Address;
    const quoteV = (quoteVault || ZERO_ADDRESS) as Address;
    const [baseSample, quoteSample] = await Promise.all([
      pickVaultConversionSample(client, baseV),
      pickVaultConversionSample(client, quoteV),
    ]);

    const samplePreflight: ValidationResult[] = [];
    if (baseSample === null) {
      samplePreflight.push({
        id: 'base-vault-sample',
        name: 'Base Vault Conversion Sample',
        status: 'fail',
        message:
          'Could not pick a baseVaultConversionSample landing in [1e18, 1e36] — verify the vault is a working ERC-4626.',
      });
    }
    if (quoteSample === null) {
      samplePreflight.push({
        id: 'quote-vault-sample',
        name: 'Quote Vault Conversion Sample',
        status: 'fail',
        message:
          'Could not pick a quoteVaultConversionSample landing in [1e18, 1e36] — verify the vault is a working ERC-4626.',
      });
    }
    if (baseSample === null || quoteSample === null) {
      setValidationResults(samplePreflight);
      setIsValidating(false);
      return;
    }
    setValidatedSamples({ base: baseSample, quote: quoteSample });

    try {
      const config: OracleTestConfig = {
        chainId,
        baseFeed1: (baseFeed1 || ZERO_ADDRESS) as Address,
        baseFeed2: (baseFeed2 || ZERO_ADDRESS) as Address,
        quoteFeed1: (quoteFeed1 || ZERO_ADDRESS) as Address,
        quoteFeed2: (quoteFeed2 || ZERO_ADDRESS) as Address,
        baseVault: baseV,
        quoteVault: quoteV,
        baseTokenAddress: baseToken as Address,
        quoteTokenAddress: quoteToken as Address,
        baseTokenDecimals: baseDec,
        quoteTokenDecimals: quoteDec,
        baseVaultConversionSample: baseSample,
        quoteVaultConversionSample: quoteSample,
        salt: (isValidSalt ? saltInput : '0x' + '0'.repeat(64)) as `0x${string}`,
      };
      const { results, feedDecimals } = await validateOracleConfig(config);
      setValidationResults([...samplePreflight, ...results]);

      // H1 / C3: previewed scale factor now uses the REAL feed decimals
      // and the REAL vault samples. Negative-exponent configs are
      // reported as invalid rather than crashing.
      setScaleFactorResult(
        computeScaleFactor({
          baseTokenDecimals: config.baseTokenDecimals,
          quoteTokenDecimals: config.quoteTokenDecimals,
          baseFeed1Decimals: feedDecimals.baseFeed1,
          baseFeed2Decimals: feedDecimals.baseFeed2,
          quoteFeed1Decimals: feedDecimals.quoteFeed1,
          quoteFeed2Decimals: feedDecimals.quoteFeed2,
          baseVaultConversionSample: config.baseVaultConversionSample,
          quoteVaultConversionSample: config.quoteVaultConversionSample,
        }),
      );
    } catch (err) {
      // C3: keep the prior validator results intact instead of replacing
      // them with a generic error — the curator needs the specifics.
      setValidationResults((prev) => [
        ...prev,
        {
          id: 'validation-error',
          name: 'Validation Error',
          status: 'fail',
          message: `Post-validation step failed: ${String(err)}`,
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
          baseOracleTokenInfo={baseOracleTokenInfo}
          setBaseOracleTokenInfo={setBaseOracleTokenInfo}
          quoteOracleTokenInfo={quoteOracleTokenInfo}
          setQuoteOracleTokenInfo={setQuoteOracleTokenInfo}
          baseDecimalsInput={baseDecimalsInput}
          setBaseDecimalsInput={setBaseDecimalsInput}
          quoteDecimalsInput={quoteDecimalsInput}
          setQuoteDecimalsInput={setQuoteDecimalsInput}
          saltInput={saltInput}
          setSaltInput={setSaltInput}
          onValidate={handleValidate}
        />
      )}

      {step === 'validate' && (
        <ValidateStep
          results={validationResults}
          scaleFactorResult={scaleFactorResult}
          isLoading={isValidating}
          onBack={() => setStep('configure')}
          onDeploy={() => setStep('deploy')}
        />
      )}

      {step === 'deploy' && baseOracleTokenInfo && quoteOracleTokenInfo && (
        <DeployStep
          config={buildConfig()}
          baseOracleTokenInfo={baseOracleTokenInfo}
          quoteOracleTokenInfo={quoteOracleTokenInfo}
          onBack={() => setStep('validate')}
        />
      )}
    </div>
  );
}
