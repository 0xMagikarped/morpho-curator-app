import { useState } from 'react';
import { useChainId } from 'wagmi';
import type { Address } from 'viem';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { AddressDisplay } from '../ui/AddressDisplay';
import { getChainConfig, CHAIN_CONFIGS } from '../../config/chains';
import { getPublicClient } from '../../lib/data/rpcClient';
import { morphoBlueAbi, erc20Abi } from '../../lib/contracts/abis';
import type { MarketFormData } from './MarketForm';

interface SeedExistingMarketFormProps {
  onResolved: (data: MarketFormData, marketId: `0x${string}`) => void;
}

export function SeedExistingMarketForm({ onResolved }: SeedExistingMarketFormProps) {
  const connectedChainId = useChainId();

  const [marketIdInput, setMarketIdInput] = useState('');
  const [selectedChainId, setSelectedChainId] = useState<number>(connectedChainId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedParams, setResolvedParams] = useState<{
    loanToken: Address;
    collateralToken: Address;
    oracle: Address;
    irm: Address;
    lltv: bigint;
    loanSymbol: string;
    loanDecimals: number;
    collateralSymbol: string;
    collateralDecimals: number;
  } | null>(null);

  const deployedChains = Object.entries(CHAIN_CONFIGS)
    .filter(([, c]) => c.deployed)
    .map(([id, c]) => ({ id: Number(id), name: c.displayName ?? c.name }));

  const handleLoad = async () => {
    setError(null);
    setResolvedParams(null);

    const marketId = marketIdInput.trim() as `0x${string}`;
    if (!marketId.startsWith('0x') || marketId.length !== 66) {
      setError('Invalid market ID — must be a 32-byte hex string (66 chars with 0x prefix).');
      return;
    }

    const chainConfig = getChainConfig(selectedChainId);
    if (!chainConfig?.morphoBlue) {
      setError('Chain not configured or Morpho Blue not deployed.');
      return;
    }

    setLoading(true);

    try {
      const client = getPublicClient(selectedChainId);

      // Fetch market state to verify existence
      const marketState = await client.readContract({
        address: chainConfig.morphoBlue,
        abi: morphoBlueAbi,
        functionName: 'market',
        args: [marketId],
      });

      const lastUpdate = (marketState as readonly bigint[])[4];
      if (!lastUpdate || lastUpdate === 0n) {
        setError('Market does not exist on this chain (lastUpdate = 0).');
        setLoading(false);
        return;
      }

      // Fetch market params
      const params = await client.readContract({
        address: chainConfig.morphoBlue,
        abi: morphoBlueAbi,
        functionName: 'idToMarketParams',
        args: [marketId],
      }) as { loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint };

      // Fetch ERC20 metadata
      const [, loanSymbol, loanDecimals, , collatSymbol, collatDecimals] = await Promise.all([
        client.readContract({ address: params.loanToken, abi: erc20Abi, functionName: 'name' }).catch(() => 'Unknown'),
        client.readContract({ address: params.loanToken, abi: erc20Abi, functionName: 'symbol' }).catch(() => '???'),
        client.readContract({ address: params.loanToken, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
        client.readContract({ address: params.collateralToken, abi: erc20Abi, functionName: 'name' }).catch(() => 'Unknown'),
        client.readContract({ address: params.collateralToken, abi: erc20Abi, functionName: 'symbol' }).catch(() => '???'),
        client.readContract({ address: params.collateralToken, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
      ]);

      setResolvedParams({
        loanToken: params.loanToken,
        collateralToken: params.collateralToken,
        oracle: params.oracle,
        irm: params.irm,
        lltv: params.lltv,
        loanSymbol: loanSymbol as string,
        loanDecimals: Number(loanDecimals),
        collateralSymbol: collatSymbol as string,
        collateralDecimals: Number(collatDecimals),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = () => {
    if (!resolvedParams) return;

    const formData: MarketFormData = {
      loanToken: resolvedParams.loanToken,
      collateralToken: resolvedParams.collateralToken,
      oracle: resolvedParams.oracle,
      irm: resolvedParams.irm,
      lltv: resolvedParams.lltv,
      loanTokenMeta: {
        name: '',
        symbol: resolvedParams.loanSymbol,
        decimals: resolvedParams.loanDecimals,
      },
      collateralTokenMeta: {
        name: '',
        symbol: resolvedParams.collateralSymbol,
        decimals: resolvedParams.collateralDecimals,
      },
      rateModel: 'variable',
    };

    onResolved(formData, marketIdInput.trim() as `0x${string}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Load Existing Market</CardTitle>
      </CardHeader>

      <div className="space-y-4">
        <div>
          <label className="text-xs text-text-tertiary uppercase block mb-1">Chain</label>
          <select
            value={selectedChainId}
            onChange={(e) => {
              setSelectedChainId(Number(e.target.value));
              setResolvedParams(null);
            }}
            className="w-full bg-bg-hover border border-border-default px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus"
          >
            {deployedChains.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-text-tertiary uppercase block mb-1">Market ID</label>
          <input
            type="text"
            value={marketIdInput}
            onChange={(e) => {
              setMarketIdInput(e.target.value);
              setResolvedParams(null);
            }}
            placeholder="0x… (32-byte hex)"
            className="w-full bg-bg-hover border border-border-default px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
          />
        </div>

        <Button
          onClick={handleLoad}
          disabled={!marketIdInput.trim() || loading}
          loading={loading}
        >
          Load Market
        </Button>

        {error && (
          <div className="bg-danger/10 border border-danger/20 px-3 py-2">
            <p className="text-xs text-danger">{error}</p>
          </div>
        )}

        {resolvedParams && (
          <div className="space-y-3">
            <div className="bg-bg-hover p-3 space-y-2">
              <p className="text-[10px] text-text-tertiary uppercase tracking-wider">Market Parameters</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-text-tertiary">Loan:</span>{' '}
                  <span className="font-mono text-text-primary">{resolvedParams.loanSymbol}</span>
                  <div className="text-[10px]">
                    <AddressDisplay address={resolvedParams.loanToken} chainId={selectedChainId} />
                  </div>
                </div>
                <div>
                  <span className="text-text-tertiary">Collateral:</span>{' '}
                  <span className="font-mono text-text-primary">{resolvedParams.collateralSymbol}</span>
                  <div className="text-[10px]">
                    <AddressDisplay address={resolvedParams.collateralToken} chainId={selectedChainId} />
                  </div>
                </div>
                <div>
                  <span className="text-text-tertiary">LLTV:</span>{' '}
                  <span className="font-mono text-text-primary">
                    {(Number(resolvedParams.lltv) / 1e18 * 100).toFixed(1)}%
                  </span>
                </div>
                <div>
                  <span className="text-text-tertiary">Oracle:</span>{' '}
                  <div className="text-[10px]">
                    <AddressDisplay address={resolvedParams.oracle} chainId={selectedChainId} />
                  </div>
                </div>
              </div>
            </div>

            <Button onClick={handleSeed} className="w-full">
              Seed This Market
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
