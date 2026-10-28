import { useAccount, useSwitchChain } from 'wagmi';

/**
 * Returns chain mismatch info and a switchChain helper.
 * Components should disable write actions when isMismatch is true.
 *
 * Keyed on `chainId`, NOT on `chain`. `useAccount().chain` is resolved by
 * looking the connected id up in wagmi's configured chains, so it is
 * `undefined` whenever the wallet sits on a network the app doesn't configure
 * — and the old `!!chain && chain.id !== required` test then read that as
 * "no mismatch" and let the write through. A wallet on an unknown network is
 * the case most in need of the guard, not the one exempt from it.
 */
export function useChainGuard(requiredChainId: number) {
  const { chain, chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();

  const isMismatch = isConnected && chainId !== requiredChainId;

  const requestSwitch = () => {
    switchChain({ chainId: requiredChainId });
  };

  return {
    isMismatch,
    walletChainId: chainId,
    /** True when the wallet is on a network this app doesn't configure. */
    isUnknownChain: isConnected && chainId !== undefined && !chain,
    requestSwitch,
  };
}
