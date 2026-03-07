import { Badge } from '../ui/Badge';
import type { OracleGrade } from '../../lib/oracle/oracleTypes';

const GRADE_VARIANTS: Record<OracleGrade, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  'A': 'success',
  'B': 'info',
  'C': 'warning',
  'D': 'warning',
  'F': 'danger',
};

interface OracleRiskBadgeProps {
  grade: OracleGrade;
  score: number;
  compact?: boolean;
}

export function OracleRiskBadge({ grade, score, compact }: OracleRiskBadgeProps) {
  const label = compact ? grade : `${grade} (${score})`;
  return <Badge variant={GRADE_VARIANTS[grade]}>{label}</Badge>;
}
