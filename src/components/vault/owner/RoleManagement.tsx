import type { Address } from 'viem';
import { useVaultFlavor } from '../../../lib/vault/flavor';
import { RolesMetaMorphoV1 } from './RolesMetaMorphoV1';
import { RolesMoolah } from './RolesMoolah';

interface RoleManagementProps {
  chainId: number;
  vaultAddress: Address;
  currentCurator: Address;
  currentFeeRecipient: Address;
  currentGuardian: Address;
  onSuccess: () => void;
}

/**
 * Dispatcher — picks the right Roles card for the vault's flavor.
 *
 * - `metaMorphoV1` → today's direct-setter card (RolesMetaMorphoV1).
 * - `moolahVault`  → Moolah-native read card with dual timelock, protocol
 *   admin, and pause state (RolesMoolah). Write actions surface through
 *   the Stage 5 write router (propose → wait → execute).
 */
export function RoleManagement(props: RoleManagementProps) {
  const { data: flavor } = useVaultFlavor(props.chainId, props.vaultAddress);

  if (flavor === 'moolahVault') {
    return <RolesMoolah chainId={props.chainId} vaultAddress={props.vaultAddress} />;
  }

  // Default to the MetaMorpho V1 path — covers every non-Moolah chain and
  // serves as the fallback while the flavor probe resolves.
  return <RolesMetaMorphoV1 {...props} />;
}
