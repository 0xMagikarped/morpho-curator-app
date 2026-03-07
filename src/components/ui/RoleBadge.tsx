import { cn } from '../../lib/utils/cn';

type Role = 'owner' | 'curator' | 'allocator' | 'guardian' | 'sentinel';

const roleStyles: Record<Role, string> = {
  owner: 'bg-migration/15 text-migration',
  curator: 'bg-accent-primary/15 text-accent-primary',
  allocator: 'bg-info/15 text-info',
  guardian: 'bg-warning/15 text-warning',
  sentinel: 'bg-danger/15 text-danger',
};

interface RoleBadgeProps {
  role: Role;
  className?: string;
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-wider',
        roleStyles[role],
        className,
      )}
    >
      {role}
    </span>
  );
}
