import type { VaultFlavor } from '../../types';

interface ProtocolChipProps {
  flavor?: VaultFlavor;
  className?: string;
}

/**
 * Small chip that tells the curator which vault model they're in.
 * Lista yellow for Moolah, slate for MetaMorpho. Read-only indicator;
 * its contents never influence behavior — only branding.
 */
export function ProtocolChip({ flavor, className }: ProtocolChipProps) {
  if (!flavor) return null;

  if (flavor === 'moolahVault') {
    return (
      <span
        className={`inline-flex px-1.5 py-0.5 text-[9px] font-mono tracking-wider uppercase bg-[#F0B90B]/10 border border-[#F0B90B]/30 text-[#F0B90B] ${className ?? ''}`}
        title="Lista DAO Moolah — Morpho Blue + MetaMorpho fork with dual TimelockController governance"
      >
        Moolah · Lista
      </span>
    );
  }

  return (
    <span
      className={`inline-flex px-1.5 py-0.5 text-[9px] font-mono tracking-wider uppercase bg-bg-hover border border-border-subtle text-text-tertiary ${className ?? ''}`}
      title="MetaMorpho V1 — Morpho's canonical vault layer"
    >
      MetaMorpho
    </span>
  );
}
