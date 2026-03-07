import { Badge } from '../ui/Badge';
import type { OracleType, OracleModel } from '../../lib/oracle/oracleTypes';

const TYPE_LABELS: Record<OracleType, string> = {
  'chainlink-push': 'Chainlink',
  'chainlink-data-streams': 'Chainlink DS',
  'chainlink-v2': 'Chainlink V2',
  'chainlink-erc4626-hybrid': 'CL+ERC4626',
  'erc4626-exchange-rate': 'ERC4626 Rate',
  'pyth': 'Pyth',
  'redstone': 'RedStone',
  'api3': 'API3',
  'morpho-oracle-v2': 'Morpho V2',
  'morpho-oracle-unknown': 'Morpho Unknown',
  'custom': 'Custom',
  'none': 'None',
};

const TYPE_VARIANTS: Record<OracleType, 'success' | 'warning' | 'danger' | 'info' | 'default' | 'purple'> = {
  'chainlink-push': 'success',
  'chainlink-data-streams': 'info',
  'chainlink-v2': 'success',
  'chainlink-erc4626-hybrid': 'purple',
  'erc4626-exchange-rate': 'purple',
  'pyth': 'purple',
  'redstone': 'warning',
  'api3': 'info',
  'morpho-oracle-v2': 'success',
  'morpho-oracle-unknown': 'warning',
  'custom': 'warning',
  'none': 'danger',
};

interface OracleTypeBadgeProps {
  type: OracleType;
  model?: OracleModel;
  showModel?: boolean;
}

export function OracleTypeBadge({ type, model, showModel }: OracleTypeBadgeProps) {
  const label = showModel && model && model !== 'none'
    ? `${TYPE_LABELS[type]} (${model})`
    : TYPE_LABELS[type];

  return <Badge variant={TYPE_VARIANTS[type]}>{label}</Badge>;
}
