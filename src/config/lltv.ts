/**
 * Standard LLTV presets used across market creation and discovery.
 * Values are WAD-scaled (1e18 = 100%).
 */
export const LLTV_PRESETS = [
  { label: '94.5%', value: 945000000000000000n, desc: 'Stablecoins / pegged pairs' },
  { label: '91.5%', value: 915000000000000000n, desc: 'Tight-correlated (LST/ETH)' },
  { label: '86%',   value: 860000000000000000n, desc: 'Blue-chip / high liquidity' },
  { label: '77%',   value: 770000000000000000n, desc: 'Mid-cap / moderate risk' },
  { label: '62.5%', value: 625000000000000000n, desc: 'Small-cap / volatile' },
  { label: '45%',   value: 450000000000000000n, desc: 'High-risk / thin liquidity' },
] as const;
