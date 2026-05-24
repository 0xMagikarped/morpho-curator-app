/**
 * PR 25 — quick-add a collateral-level cap entry from the Caps tab.
 *
 * Step 1: user pastes a collateral token address. We validate it's a
 *         contract + fetch ERC-20 metadata.
 * Step 2: hand off to `CapEditDrawer` with idData = collateralIdData(token),
 *         current abs/rel = 0. The drawer's existing Submit→Wait→Execute
 *         flow handles the rest.
 *
 * Skips the full `AddMarketWizard` for the case where the curator already
 * has a token address in mind and just wants to set caps on it.
 */
import { useState } from 'react';
import { isAddress, type Address } from 'viem';
import { useQuery } from '@tanstack/react-query';
import { fetchTokenInfo } from '../../../lib/data/rpcClient';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { CapEditDrawer } from '../adapters/CapEditDrawer';
import { collateralIdData } from '../../../lib/v2/adapterCapUtils';

interface AddCollateralCapDrawerProps {
  open: boolean;
  onClose: () => void;
  vaultAddress: Address;
  chainId: number;
  timelockSeconds: bigint;
  decimals: number;
  assetSymbol: string;
}

export function AddCollateralCapDrawer({
  open,
  onClose,
  vaultAddress,
  chainId,
  timelockSeconds,
  decimals,
  assetSymbol,
}: AddCollateralCapDrawerProps) {
  const [tokenInput, setTokenInput] = useState('');
  const [confirmed, setConfirmed] = useState<Address | null>(null);

  // Lookup token metadata + verify it's actually a contract.
  const validAddress = isAddress(tokenInput) ? (tokenInput as Address) : null;
  const tokenQuery = useQuery({
    queryKey: ['token-info-preview', chainId, validAddress?.toLowerCase()],
    enabled: !!validAddress,
    queryFn: () => fetchTokenInfo(chainId, validAddress!),
    staleTime: 60_000,
  });

  const handleClose = () => {
    setTokenInput('');
    setConfirmed(null);
    onClose();
  };

  // Once the user clicks Continue, we hand off to CapEditDrawer with the
  // collateral idData. CapEditDrawer reads `currentAbs`/`currentRel` from
  // props rather than chain — for a brand-new entry they're zero, and the
  // drawer's existing flow Just Works.
  if (confirmed) {
    return (
      <CapEditDrawer
        open
        onClose={handleClose}
        label={`Add Collateral cap: ${tokenQuery.data?.symbol ?? confirmed.slice(0, 10)}`}
        idData={collateralIdData(confirmed)}
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

  return (
    <Drawer open={open} onClose={handleClose} title="Add Collateral Cap">
      <div className="space-y-4">
        <p className="text-xs text-text-tertiary">
          Set absolute + relative caps on a specific collateral token. Used to limit
          aggregate exposure across every market that uses this token as collateral.
        </p>

        <div>
          <label className="text-xs text-text-tertiary block mb-1">Collateral Token Address</label>
          <input
            type="text"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="0x…"
            className="w-full bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
          />
        </div>

        {tokenInput.length > 0 && !validAddress && (
          <p className="text-[10px] text-warning">Not a valid 20-byte address.</p>
        )}

        {validAddress && tokenQuery.isLoading && (
          <p className="text-[10px] text-text-tertiary italic">Resolving token metadata…</p>
        )}

        {validAddress && tokenQuery.error && (
          <p className="text-[10px] text-danger">
            Lookup error: {tokenQuery.error instanceof Error ? tokenQuery.error.message : 'unknown'}
          </p>
        )}

        {validAddress && tokenQuery.data && (
          <div className="p-3 bg-bg-hover border border-border-subtle text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-text-tertiary">Symbol</span>
              <span className="font-mono text-text-primary">{tokenQuery.data.symbol}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-tertiary">Decimals</span>
              <span className="font-mono text-text-primary">{tokenQuery.data.decimals}</span>
            </div>
            {tokenQuery.data.name && (
              <div className="flex justify-between">
                <span className="text-text-tertiary">Name</span>
                <span className="text-text-primary truncate">{tokenQuery.data.name}</span>
              </div>
            )}
          </div>
        )}

        <Button
          className="w-full"
          disabled={!validAddress || tokenQuery.isLoading}
          onClick={() => setConfirmed(validAddress!)}
        >
          Continue to Caps
        </Button>
      </div>
    </Drawer>
  );
}
