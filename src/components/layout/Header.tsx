import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId } from 'wagmi';
import { getChainConfig } from '../../config/chains';
import { ChainBadge } from '../ui/ChainBadge';
import { useAppStore } from '../../store/appStore';

export function Header() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const chainConfig = getChainConfig(chainId);
  const trackedVaults = useAppStore((s) => s.trackedVaults);

  const trackedChainIds = isConnected
    ? []
    : [...new Set(trackedVaults.map((v) => v.chainId))];

  return (
    <header className="flex items-center justify-between h-12 px-4 border-b border-border-default bg-bg-surface">
      <div className="flex items-center gap-3">
        {isConnected && chainConfig && (
          <div className="flex items-center gap-2">
            <ChainBadge chainId={chainId} />
            {!chainConfig.apiSupported && (
              <span className="text-[10px] px-1.5 py-0.5 bg-warning/15 text-warning font-medium">
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
          <span className="text-[11px] text-text-tertiary font-mono">
            <span className="text-accent-primary mr-1">●</span>multi-chain
          </span>
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
