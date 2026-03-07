import { useAccount, useSwitchChain } from 'wagmi';

/**
 * Returns chain mismatch info and a switchChain helper.
 * Components should disable write actions when isMismatch is true.
 */
export function useChainGuard(requiredChainId: number) {
  const { chain } = useAccount();
  const { switchChain } = useSwitchChain();

  const isMismatch = !!chain && chain.id !== requiredChainId;

  const requestSwitch = () => {
    switchChain({ chainId: requiredChainId });
  };

  return { isMismatch, walletChainId: chain?.id, requestSwitch };
}
