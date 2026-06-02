import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '../../lib/utils/cn';
import { truncateAddress } from '../../lib/utils/format';

interface HashDisplayProps {
  /** Full value copied to the clipboard (e.g. a market ID or tx hash). */
  value: string;
  /** Override the displayed text. Defaults to a truncated form of `value`. */
  label?: string;
  /** Leading/trailing hex chars shown when auto-truncating (default 4). */
  chars?: number;
  /** Render the full value instead of truncating. */
  truncate?: boolean;
  className?: string;
  /** aria-label / tooltip for the copy button. */
  copyLabel?: string;
}

/**
 * Copy-to-clipboard display for arbitrary hashes / IDs — mirrors
 * `AddressDisplay`'s hover-reveal copy button, minus the block-explorer link
 * (market IDs and tx hashes don't map to an `/address/` page).
 */
export function HashDisplay({
  value,
  label,
  chars = 4,
  truncate = true,
  className,
  copyLabel = 'Copy ID',
}: HashDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const display = label ?? (truncate ? truncateAddress(value, chars) : value);

  return (
    <span className={cn('inline-flex items-center gap-1.5 group', className)}>
      <span className="font-mono text-text-tertiary" title={value}>
        {display}
      </span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-text-secondary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
        aria-label={copyLabel}
        title={copyLabel}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </span>
  );
}
