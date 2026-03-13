import type { Address } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { v1VaultAdapterAbi } from '../../../lib/contracts/metaMorphoV2Abi';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

/** Known reward tokens to check for skimming */
const KNOWN_REWARD_TOKENS: Record<number, { symbol: string; address: Address }[]> = {
  1: [
    { symbol: 'MORPHO', address: '0x9994E35Db50125E0DF82e4c2dde62496CE330999' },
    { symbol: 'COMP', address: '0xc00e94Cb662C3520282E6f5717214004A7f26888' },
  ],
  8453: [
    { symbol: 'MORPHO', address: '0x9994E35Db50125E0DF82e4c2dde62496CE330999' },
  ],
};

interface SkimRewardsDrawerProps {
  open: boolean;
  onClose: () => void;
  adapter: V2AdapterFull | null;
  chainId: number;
}

export function SkimRewardsDrawer({
  open,
  onClose,
  adapter,
  chainId,
}: SkimRewardsDrawerProps) {
  const { address: walletAddress } = useAccount();
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  if (!adapter || adapter.type !== 'vault-v1') return null;

  const rewardTokens = KNOWN_REWARD_TOKENS[chainId] ?? [];

  const handleSkim = (tokenAddress: Address) => {
    if (!walletAddress) return;
    writeContract({
      address: adapter.address,
      abi: v1VaultAdapterAbi,
      functionName: 'skim',
      args: [tokenAddress, walletAddress],
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Skim Rewards: ${adapter.name ?? 'Adapter'}`}
    >
      {isSuccess ? (
        <div className="text-center py-8">
          <Badge variant="success" className="mb-2">Skimmed</Badge>
          <p className="text-sm text-text-primary">Rewards claimed.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-text-secondary">
            Claim accumulated reward tokens from this V1 vault adapter.
            Tokens will be sent to your connected wallet.
          </p>

          {rewardTokens.length > 0 ? (
            <div className="space-y-2">
              {rewardTokens.map((token) => (
                <div
                  key={token.address}
                  className="flex items-center justify-between p-3 bg-bg-hover border border-border-subtle"
                >
                  <div>
                    <p className="text-xs text-text-primary font-mono">{token.symbol}</p>
                    <p className="text-[10px] text-text-tertiary font-mono">
                      {token.address.slice(0, 10)}...{token.address.slice(-8)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSkim(token.address)}
                    disabled={isPending || isConfirming || !walletAddress}
                    loading={isPending || isConfirming}
                  >
                    Skim
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-text-tertiary text-sm text-center py-4">
              No known reward tokens for this chain.
            </p>
          )}

          <p className="text-[10px] text-text-tertiary">
            Recipient: {walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Not connected'}
          </p>
        </div>
      )}
    </Drawer>
  );
}
