import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId } from 'wagmi';
import { getChainConfig } from '../../config/chains';
import { ChainBadge } from '../ui/ChainBadge';
import { useAppStore } from '../../store/appStore';

export function Header() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const chainConfig = getChainConfig(chainId);
  const { trackedVaults } = useAppStore();

  // When connected, show the wallet's active chain
  // When disconnected, show all chains that have tracked vaults
  const trackedChainIds = isConnected
    ? []
    : [...new Set(trackedVaults.map((v) => v.chainId))];

  return (
    <header className="flex items-center justify-between h-14 px-6 border-b border-border-subtle bg-bg-surface">
      <div className="flex items-center gap-3">
        {isConnected && chainConfig && (
          <div className="flex items-center gap-2">
            <ChainBadge chainId={chainId} />
            {!chainConfig.apiSupported && (
              <span className="text-[10px] px-1.5 py-0.5 bg-warning/15 text-warning rounded-sm font-medium">
                RPC Only
              </span>
            )}
          </div>
        )}
        {!isConnected && trackedChainIds.length > 0 && (
          <div className="flex items-center gap-2">
            {trackedChainIds.map((id) => (
              <ChainBadge key={id} chainId={id} />
            ))}
            <span className="text-[10px] text-text-tertiary">
              {trackedVaults.length} vault{trackedVaults.length !== 1 ? 's' : ''} tracked
            </span>
          </div>
        )}
        {!isConnected && trackedChainIds.length === 0 && (
          <span className="text-xs text-text-tertiary">Multi-chain</span>
        )}
      </div>

      <ConnectButton
        showBalance={false}
        chainStatus="icon"
        accountStatus="address"
      />
    </header>
  );
}
