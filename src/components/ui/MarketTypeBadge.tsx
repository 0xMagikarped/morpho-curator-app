import { getMarketRateType } from '../../lib/utils/irm';
import { Badge } from './Badge';

interface MarketTypeBadgeProps {
  irmAddress: `0x${string}`;
  chainId: number;
}

export function MarketTypeBadge({ irmAddress, chainId }: MarketTypeBadgeProps) {
  const rateType = getMarketRateType(irmAddress, chainId);

  if (rateType === 'fixed') {
    return <Badge variant="info">Fixed</Badge>;
  }

  return null; // Don't clutter UI with "VARIABLE" badges — that's the default
}
