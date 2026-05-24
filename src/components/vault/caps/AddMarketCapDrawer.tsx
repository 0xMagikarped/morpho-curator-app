/**
 * PR 25 — quick-add a market-level cap entry from the Caps tab.
 *
 * Two pickers in step 1:
 *   - Adapter (which market-v1 adapter is the cap scoped to)
 *   - Market ID (32-byte hex; resolved via PR 19's `useMarketLookup`
 *     against Morpho Blue's `idToMarketParams`, so any chain works).
 *
 * Step 2 hands off to `CapEditDrawer` with idData = marketIdData(adapter,
 * params), current abs/rel = 0. Existing Submit→Wait→Execute flow takes
 * over from there.
 */
import { useState } from 'react';
import type { Address } from 'viem';
import { useMarketLookup, parseMarketIdInput } from '../../../hooks/useMarketLookup';
import { useV2AdapterOverview, type V2AdapterFull } from '../../../lib/hooks/useV2Adapters';
import { useVaultInfo } from '../../../lib/hooks/useVault';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { AddressDisplay } from '../../ui/AddressDisplay';
import { CapEditDrawer } from '../adapters/CapEditDrawer';
import { marketIdData } from '../../../lib/v2/adapterCapUtils';
import { truncateAddress } from '../../../lib/utils/format';
import type { MarketParams } from '../../../types';

interface AddMarketCapDrawerProps {
  open: boolean;
  onClose: () => void;
  vaultAddress: Address;
  chainId: number;
  timelockSeconds: bigint;
  decimals: number;
  assetSymbol: string;
}

export function AddMarketCapDrawer({
  open,
  onClose,
  vaultAddress,
  chainId,
  timelockSeconds,
  decimals,
  assetSymbol,
}: AddMarketCapDrawerProps) {
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const { data: overview } = useV2AdapterOverview(chainId, vaultAddress, vault?.totalAssets);
  const marketAdapters: V2AdapterFull[] = (overview?.adapters ?? []).filter(
    (a) => a.type === 'market-v1',
  );

  const [adapter, setAdapter] = useState<V2AdapterFull | null>(null);
  const [marketInput, setMarketInput] = useState('');
  const [confirmed, setConfirmed] = useState<{ adapter: V2AdapterFull; params: MarketParams } | null>(
    null,
  );

  // Auto-pick the single market-v1 adapter when there's just one.
  const effectiveAdapter = adapter ?? (marketAdapters.length === 1 ? marketAdapters[0] : null);

  const lookup = useMarketLookup({
    chainId,
    input: marketInput,
    expectedLoanToken: vault?.asset,
    enabled: parseMarketIdInput(marketInput) !== null,
  });

  const handleClose = () => {
    setMarketInput('');
    setAdapter(null);
    setConfirmed(null);
    onClose();
  };

  if (confirmed) {
    const lltvPct = (Number(confirmed.params.lltv) / 1e18) * 100;
    return (
      <CapEditDrawer
        open
        onClose={handleClose}
        label={`Add Market cap @ ${lltvPct.toFixed(1)}% LLTV`}
        idData={marketIdData(confirmed.adapter.address, confirmed.params)}
        currentAbs={0n}
        currentRel={0n}
        vaultAddress={vaultAddress}
        chainId={chainId}
        timelockSeconds={timelockSeconds}
        decimals={decimals}
        assetSymbol={assetSymbol}
      />
    );
  }

  const canContinue = !!effectiveAdapter && lookup.kind === 'found';

  return (
    <Drawer open={open} onClose={handleClose} title="Add Market Cap">
      <div className="space-y-4">
        <p className="text-xs text-text-tertiary">
          Set absolute + relative caps on a specific Morpho Blue market. Scope is per-adapter
          — choosing the adapter sets which adapter routes funds to this market.
        </p>

        {/* Adapter pick — auto-skip if only one market-v1 adapter exists */}
        {marketAdapters.length > 1 ? (
          <div>
            <label className="text-xs text-text-tertiary block mb-1">Adapter</label>
            <select
              value={adapter?.address ?? ''}
              onChange={(e) => {
                const next = marketAdapters.find((a) => a.address === (e.target.value as Address));
                setAdapter(next ?? null);
              }}
              className="w-full bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary font-mono focus:border-border-focus focus:outline-none"
            >
              <option value="" disabled>Pick a market adapter…</option>
              {marketAdapters.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name ?? truncateAddress(a.address)}
                </option>
              ))}
            </select>
          </div>
        ) : effectiveAdapter ? (
          <div className="p-3 bg-bg-hover border border-border-subtle text-xs">
            <span className="text-text-tertiary">Adapter: </span>
            <AddressDisplay address={effectiveAdapter.address} chainId={chainId} />
            <Badge variant="success" className="ml-2">MKT</Badge>
          </div>
        ) : (
          <p className="text-[10px] text-warning">
            No market-v1 adapter on this vault. Add one from the Adapters tab first.
          </p>
        )}

        {/* Market ID input */}
        <div>
          <label className="text-xs text-text-tertiary block mb-1">Market ID (32-byte hex)</label>
          <input
            type="text"
            value={marketInput}
            onChange={(e) => setMarketInput(e.target.value)}
            placeholder="0x…"
            className="w-full bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
          />
        </div>

        {/* Lookup status (PR 19 surfaces) */}
        {lookup.kind === 'loading' && (
          <p className="text-[10px] text-text-tertiary italic">Resolving market via Morpho Blue…</p>
        )}
        {lookup.kind === 'not-found' && (
          <p className="text-[10px] text-warning">No Morpho Blue market with this ID on chain {chainId}.</p>
        )}
        {lookup.kind === 'loan-token-mismatch' && (
          <p className="text-[10px] text-warning">
            Market exists but its loan token ({truncateAddress(lookup.actual)}) ≠ vault asset ({assetSymbol}).
          </p>
        )}
        {lookup.kind === 'error' && (
          <p className="text-[10px] text-danger">Lookup error: {lookup.message}</p>
        )}
        {lookup.kind === 'found' && (
          <div className="p-3 bg-bg-hover border border-border-subtle text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-text-tertiary">Pair</span>
              <span className="text-text-primary">
                {lookup.market.collateralToken.symbol} / {lookup.market.loanToken.symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-tertiary">LLTV</span>
              <span className="font-mono text-text-primary">
                {((Number(lookup.market.params.lltv) / 1e18) * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        )}

        <Button
          className="w-full"
          disabled={!canContinue}
          onClick={() => {
            if (effectiveAdapter && lookup.kind === 'found') {
              setConfirmed({ adapter: effectiveAdapter, params: lookup.market.params });
            }
          }}
        >
          Continue to Caps
        </Button>
      </div>
    </Drawer>
  );
}
