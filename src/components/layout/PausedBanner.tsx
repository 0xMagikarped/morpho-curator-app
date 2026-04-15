import { AlertOctagon } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useMoolahSingletonState } from '../../lib/hooks/useMoolahSingleton';
import { getChainConfig } from '../../config/chains';

/**
 * Shown at the top of the page when the Moolah singleton is paused.
 * Paused = reads still work, but writes revert. Surface it loud.
 */
export function PausedBanner() {
  const { chainId } = useAccount();
  const { data } = useMoolahSingletonState(chainId);
  const config = chainId ? getChainConfig(chainId) : undefined;

  if (!data?.isPaused || config?.protocol !== 'moolah') return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-danger/10 border border-danger/30 text-danger text-xs">
      <AlertOctagon size={14} className="shrink-0" />
      <span>
        <span className="font-semibold">Lista Moolah protocol is paused.</span>{' '}
        Reads are live; writes will revert. Check
        <a
          href={config.moolah?.docsUrl ?? 'https://docs.bsc.lista.org/'}
          target="_blank"
          rel="noreferrer"
          className="underline ml-1"
        >
          Lista docs
        </a>
        {' '}for status.
      </span>
    </div>
  );
}
