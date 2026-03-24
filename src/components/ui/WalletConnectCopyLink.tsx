import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { useWalletConnectUri } from '../../hooks/useWalletConnectUri';

/**
 * Renders a floating "Copy Link" button when RainbowKit's modal
 * shows a WalletConnect QR code. Positioned via fixed overlay.
 *
 * Listens to wagmi's connector `display_uri` event to capture the URI
 * since RainbowKit doesn't expose it via public API.
 */
export function WalletConnectCopyLink() {
  const { uri, connectModalOpen } = useWalletConnectUri();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
    } catch {
      // Fallback for non-HTTPS contexts
      const ta = document.createElement('textarea');
      ta.value = uri;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [uri]);

  if (!uri || !connectModalOpen) return null;

  return (
    <button
      onClick={handleCopy}
      aria-label="Copy WalletConnect URI"
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 16px',
        background: copied ? '#00C060' : '#1400FF',
        color: '#FFFFFF',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: '13px',
        fontWeight: 600,
        zIndex: 2147483647,
        transition: 'background 150ms ease-out',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'Copied!' : 'Copy Link'}
    </button>
  );
}
