import { cn } from '../../lib/utils/cn';

interface SectionHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function SectionHeader({ children, className }: SectionHeaderProps) {
  return (
    <h2 className={cn('text-[11px] font-medium uppercase tracking-wider text-text-tertiary', className)}>
      <span className="font-mono">{'//'}</span> {children}
    </h2>
  );
}
