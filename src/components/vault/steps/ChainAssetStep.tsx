import { useState } from 'react';
import { isAddress } from 'viem';
import { CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { getSupportedChainIds, getChainConfig } from '../../../config/chains';
import { getPublicClient } from '../../../lib/data/rpcClient';
import { erc20Abi } from '../../../lib/contracts/abis';
import type { StepProps } from '../CreateVaultWizard';

export function ChainAssetStep({ state, onUpdate, onNext }: StepProps) {
  const [customToken, setCustomToken] = useState('');
  const [loadingToken, setLoadingToken] = useState(false);
  const [tokenError, setTokenError] = useState('');

  const isV2 = state.version === 'v2';

  const chains = getSupportedChainIds()
    .map((id) => ({ id, config: getChainConfig(id)! }))
    .filter((c) => isV2 ? !!c.config.vaultFactories.v2 : !!c.config.vaultFactories.v1);

  const selectedConfig = state.chainId ? getChainConfig(state.chainId) : null;

  // Known tokens for selected chain
  const knownTokens = selectedConfig
    ? [
        ...selectedConfig.stablecoins.map((t) => ({
          address: t.address as `0x${string}`,
          symbol: t.symbol,
          decimals: t.decimals,
        })),
        {
          address: selectedConfig.nativeToken.wrapped as `0x${string}`,
          symbol: `W${selectedConfig.nativeToken.symbol}`,
          decimals: selectedConfig.nativeToken.decimals,
        },
      ]
    : [];

  const handleCustomToken = async () => {
    if (!state.chainId || !isAddress(customToken)) {
      setTokenError('Invalid address');
      return;
    }
    setLoadingToken(true);
    setTokenError('');
    try {
      const client = getPublicClient(state.chainId);
      const [symbol, decimals] = await Promise.all([
        client.readContract({ address: customToken as `0x${string}`, abi: erc20Abi, functionName: 'symbol' }),
        client.readContract({ address: customToken as `0x${string}`, abi: erc20Abi, functionName: 'decimals' }),
      ]);
      onUpdate({
        asset: customToken as `0x${string}`,
        assetSymbol: symbol,
        assetDecimals: decimals,
      });
    } catch {
      setTokenError('Failed to read token — is this a valid ERC-20?');
    } finally {
      setLoadingToken(false);
    }
  };

  const canProceed = state.chainId && state.asset;

  return (
    <div className="space-y-6">
      <CardHeader>
        <CardTitle>Select Chain & Loan Asset</CardTitle>
      </CardHeader>

      {/* Version Selector */}
      <div>
        <label className="text-xs text-text-tertiary mb-2 block">Vault Version</label>
        <div className="flex gap-3">
          <button
            onClick={() => onUpdate({ version: 'v1', chainId: null, asset: null, assetSymbol: '', assetDecimals: 18 })}
            className={`flex-1 border px-4 py-3 text-left transition-colors ${
              !isV2
                ? 'border-accent-primary bg-accent-primary-muted'
                : 'border-border-default bg-bg-hover/30 hover:border-border-default'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">MetaMorpho V1</span>
              <Badge variant="success">Stable</Badge>
            </div>
            <p className="text-xs text-text-tertiary mt-1">
              Supply/withdraw queues, single guardian, single timelock
            </p>
          </button>
          <button
            onClick={() => onUpdate({ version: 'v2', chainId: null, asset: null, assetSymbol: '', assetDecimals: 18 })}
            className={`flex-1 border px-4 py-3 text-left transition-colors ${
              isV2
                ? 'border-accent-primary bg-accent-primary-muted'
                : 'border-border-default bg-bg-hover/30 hover:border-border-default'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">MetaMorpho V2</span>
              <Badge variant="info">New</Badge>
            </div>
            <p className="text-xs text-text-tertiary mt-1">
              Adapters, multi-sentinel, dual fees, per-function timelocks
            </p>
          </button>
        </div>
      </div>

      {/* Chain Selection */}
      <div>
        <label className="text-xs text-text-tertiary mb-2 block">Chain</label>
        <div className="flex gap-3">
          {chains.map(({ id, config }) => (
            <button
              key={id}
              onClick={() =>
                onUpdate({ chainId: id, asset: null, assetSymbol: '', assetDecimals: 18 })
              }
              className={`flex-1 border px-4 py-3 text-left transition-colors ${
                state.chainId === id
                  ? 'border-accent-primary bg-accent-primary-muted'
                  : 'border-border-default bg-bg-hover/30 hover:border-border-default'
              }`}
            >
              <div className="text-sm font-medium text-text-primary">{config.name}</div>
              <div className="text-xs text-text-tertiary mt-1">Chain {id}</div>
              <div className="flex gap-1 mt-2">
                {config.vaultFactories.v1 && <Badge variant="success">V1</Badge>}
                {config.vaultFactories.v2 && <Badge variant="info">V2</Badge>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Asset Selection */}
      {state.chainId && (
        <div>
          <label className="text-xs text-text-tertiary mb-2 block">Loan Asset</label>
          <div className="space-y-2">
            {knownTokens.map((token) => (
              <button
                key={token.address}
                onClick={() =>
                  onUpdate({
                    asset: token.address,
                    assetSymbol: token.symbol,
                    assetDecimals: token.decimals,
                  })
                }
                className={`w-full flex items-center justify-between border px-4 py-3 transition-colors ${
                  state.asset?.toLowerCase() === token.address.toLowerCase()
                    ? 'border-accent-primary bg-accent-primary-muted'
                    : 'border-border-default bg-bg-hover/30 hover:border-border-default'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-text-primary">{token.symbol}</span>
                  <span className="text-xs text-text-tertiary font-mono">
                    {token.address.slice(0, 6)}...{token.address.slice(-4)}
                  </span>
                </div>
                <span className="text-xs text-text-tertiary">{token.decimals} decimals</span>
              </button>
            ))}

            {/* Custom token */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Custom token address (0x...)"
                value={customToken}
                onChange={(e) => setCustomToken(e.target.value)}
                className="flex-1 bg-bg-hover border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={handleCustomToken}
                loading={loadingToken}
              >
                Load
              </Button>
            </div>
            {tokenError && <p className="text-xs text-danger">{tokenError}</p>}
          </div>
        </div>
      )}

      {/* Info */}
      {state.asset && (
        <p className="text-xs text-text-tertiary">
          This vault will accept deposits in {state.assetSymbol} and lend to Morpho Blue
          markets on {selectedConfig?.name}.
        </p>
      )}

      {/* Navigation */}
      <div className="flex justify-end pt-2">
        <Button onClick={onNext} disabled={!canProceed}>
          Next
        </Button>
      </div>
    </div>
  );
}
