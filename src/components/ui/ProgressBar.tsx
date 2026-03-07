import { cn } from '../../lib/utils/cn';

interface ProgressBarProps {
  value: number; // 0-100
  className?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  height?: 'sm' | 'md';
}

const barVariants = {
  default: 'bg-accent-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

function getAutoVariant(value: number): 'success' | 'warning' | 'danger' {
  if (value >= 90) return 'danger';
  if (value >= 80) return 'warning';
  return 'success';
}

export function ProgressBar({ value, className, variant, height = 'md' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const resolvedVariant = variant ?? getAutoVariant(clamped);

  return (
    <div className={cn(
      'w-full bg-bg-hover rounded-full overflow-hidden',
      height === 'sm' ? 'h-1.5' : 'h-2',
      className,
    )}>
      <div
        className={cn('h-full rounded-full transition-all duration-300', barVariants[resolvedVariant])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
