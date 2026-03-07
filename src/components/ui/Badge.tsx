import { cn } from '../../lib/utils/cn';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'owner' | 'curator' | 'allocator' | 'guardian' | 'sentinel';

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-bg-hover text-text-secondary',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
  info: 'bg-info/15 text-info border-info/30',
  purple: 'bg-migration/15 text-migration border-migration/30',
  // Role-specific badges
  owner: 'bg-migration/15 text-migration',
  curator: 'bg-accent-primary/15 text-accent-primary',
  allocator: 'bg-info/15 text-info',
  guardian: 'bg-warning/15 text-warning',
  sentinel: 'bg-danger/15 text-danger',
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium border border-transparent',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
