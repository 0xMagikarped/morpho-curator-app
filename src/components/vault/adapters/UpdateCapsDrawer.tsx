/**
 * Adapter-level cap edit drawer.
 *
 * PR 22 — this file shrank from a 470-line implementation to a thin shim
 * around the new parameterized `CapEditDrawer`. Everything specific to
 * the V2 timelock model (Submit→Wait→Execute, batched multicall, error
 * surfacing) now lives in `CapEditDrawer`. `UpdateCapsDrawer` is what
 * V2AdaptersTab uses to edit the per-adapter cap entry — it just maps
 * `V2AdapterFull` to the cap-edit-drawer's `{ idData, currentAbs,
 * currentRel, label }` shape.
 */
import type { Address } from 'viem';
import { CapEditDrawer } from './CapEditDrawer';
import { adapterIdData } from '../../../lib/v2/adapterCapUtils';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

interface UpdateCapsDrawerProps {
  open: boolean;
  onClose: () => void;
  adapter: V2AdapterFull | null;
  vaultAddress: Address;
  chainId: number;
  timelockSeconds: bigint;
  decimals: number;
  assetSymbol: string;
}

export function UpdateCapsDrawer({
  open,
  onClose,
  adapter,
  vaultAddress,
  chainId,
  timelockSeconds,
  decimals,
  assetSymbol,
}: UpdateCapsDrawerProps) {
  if (!adapter) return null;
  return (
    <CapEditDrawer
      open={open}
      onClose={onClose}
      label={`Adapter caps: ${adapter.name ?? adapter.address.slice(0, 10)}`}
      idData={adapterIdData(adapter.address)}
      currentAbs={adapter.absoluteCap}
      currentRel={adapter.relativeCap}
      vaultAddress={vaultAddress}
      chainId={chainId}
      timelockSeconds={timelockSeconds}
      decimals={decimals}
      assetSymbol={assetSymbol}
    />
  );
}
