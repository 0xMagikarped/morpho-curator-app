import { useState } from 'react';
import { Copy, ExternalLink, Check } from 'lucide-react';
import { cn } from '../../lib/utils/cn';
import { getChainConfig } from '../../config/chains';

interface AddressDisplayProps {
  address: string;
  chainId?: number;
  className?: string;
  truncate?: boolean;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 13) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function AddressDisplay({ address, chainId, className, truncate = true }: AddressDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const explorerUrl = chainId ? getExplorerUrl(chainId, address) : undefined;

  return (
    <span className={cn('inline-flex items-center gap-1.5 group', className)}>
      <span className="font-mono text-text-primary" title={address}>
        {truncate ? truncateAddress(address) : address}
      </span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-text-secondary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary rounded"
        aria-label="Copy address"
        title="Copy address"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-text-secondary"
          title="View on explorer"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </span>
  );
}

function getExplorerUrl(chainId: number, address: string): string | undefined {
  const config = getChainConfig(chainId);
  if (!config) return undefined;
  return `${config.blockExplorer}/address/${address}`;
}
