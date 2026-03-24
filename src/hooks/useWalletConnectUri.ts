import { useEffect, useState } from 'react';
import { useConfig } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';

/**
 * Captures the WalletConnect URI from wagmi connector events.
 * The walletConnect connector emits { type: 'display_uri', data: uri }
 * whenever a new pairing URI is generated.
 */
export function useWalletConnectUri() {
  const [uri, setUri] = useState<string | null>(null);
  const config = useConfig();
  const { connectModalOpen } = useConnectModal();

  useEffect(() => {
    if (!connectModalOpen) {
      setUri(null);
      return;
    }

    const unsubscribes: (() => void)[] = [];

    for (const connector of config.connectors) {
      const handler = (message: { type: string; data?: unknown }) => {
        if (message.type === 'display_uri' && typeof message.data === 'string') {
          setUri(message.data);
        }
      };
      connector.emitter.on('message', handler);
      unsubscribes.push(() => connector.emitter.off('message', handler));
    }

    return () => {
      for (const unsub of unsubscribes) unsub();
    };
  }, [config.connectors, connectModalOpen]);

  return { uri, connectModalOpen };
}
