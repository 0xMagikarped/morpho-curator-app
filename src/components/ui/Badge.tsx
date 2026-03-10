import { cn } from '../../lib/utils/cn';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'owner' | 'curator' | 'allocator' | 'guardian' | 'sentinel';

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-blue-muted text-blue-primary border-blue-primary/20',
  success: 'bg-accent-primary-muted text-accent-primary border-accent-primary/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  danger: 'bg-danger/10 text-danger border-danger/20',
  info: 'bg-blue-muted text-blue-primary border-blue-primary/20',
  purple: 'bg-migration/15 text-migration border-migration/30',
  // Role-specific badges
  owner: 'bg-migration/15 text-migration border-migration/30',
  curator: 'bg-accent-primary-muted text-accent-primary border-accent-primary/20',
  allocator: 'bg-blue-muted text-blue-primary border-blue-primary/20',
  guardian: 'bg-warning/10 text-warning border-warning/20',
  sentinel: 'bg-danger/10 text-danger border-danger/20',
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
        'inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide border',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
