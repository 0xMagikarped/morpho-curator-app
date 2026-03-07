import { ProgressBar } from '../ui/ProgressBar';

interface UtilizationBarProps {
  utilization: number; // 0-100
  label?: string;
  compact?: boolean;
}

export function UtilizationBar({ utilization, label, compact }: UtilizationBarProps) {
  const color = utilization >= 90
    ? 'text-danger'
    : utilization >= 80
      ? 'text-warning'
      : 'text-text-primary';

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <ProgressBar value={utilization} className="w-16 h-1.5" />
        <span className={`text-xs ${color}`}>{utilization.toFixed(0)}%</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        {label && <span className="text-text-secondary">{label}</span>}
        <span className={color}>{utilization.toFixed(1)}%</span>
      </div>
      <ProgressBar value={utilization} className="h-1.5" />
    </div>
  );
}
