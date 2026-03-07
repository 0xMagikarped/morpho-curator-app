import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useChainId } from 'wagmi';
import { getChainConfig } from '../../config/chains';
import { ChainBadge } from '../ui/ChainBadge';

export function Header() {
  const chainId = useChainId();
  const chainConfig = getChainConfig(chainId);

  return (
    <header className="flex items-center justify-between h-14 px-6 border-b border-border-subtle bg-bg-surface">
      <div className="flex items-center gap-3">
        {chainConfig && (
          <div className="flex items-center gap-2">
            <ChainBadge chainId={chainId} />
            {!chainConfig.apiSupported && (
              <span className="text-[10px] px-1.5 py-0.5 bg-warning/15 text-warning rounded-sm font-medium">
                RPC Only
              </span>
            )}
          </div>
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
