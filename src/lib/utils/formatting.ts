export function formatTokenDisplay(amount: number, tokenSymbol: string): string {
  const symbol = tokenSymbol.toUpperCase();
  let decimals: number;
  if (symbol.includes('USD') || symbol.includes('USDT') || symbol.includes('USDC') || symbol.includes('DAI')) {
    decimals = 0;
  } else if (symbol.includes('ETH')) {
    decimals = 2;
  } else if (symbol.includes('BTC')) {
    decimals = 6;
  } else {
    decimals = 2;
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function formatMarketId(marketId: string): string {
  if (marketId.length <= 14) return marketId;
  return `${marketId.slice(0, 8)}...${marketId.slice(-4)}`;
}

export function isValidMarketId(marketId: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(marketId) || /^[a-fA-F0-9]{64}$/.test(marketId);
}
