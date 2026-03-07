const CHAIN_NAME_MAP: Record<number, string> = {
  1: 'ethereum',
  1329: 'sei',
  8453: 'base',
};

export interface DefiLlamaPrice {
  price: number;
  symbol: string;
  decimals: number;
  timestamp: number;
  confidence: number;
}

export async function getDefiLlamaPrice(
  chainId: number,
  tokenAddress: string
): Promise<DefiLlamaPrice | null> {
  const chainName = CHAIN_NAME_MAP[chainId];
  if (!chainName) return null;

  try {
    const response = await fetch(
      `https://coins.llama.fi/prices/current/${chainName}:${tokenAddress}`
    );
    if (!response.ok) return null;

    const data = await response.json();
    const tokenKey = `${chainName}:${tokenAddress}`;
    const tokenData = data.coins?.[tokenKey];
    if (!tokenData) return null;

    return {
      price: tokenData.price,
      symbol: tokenData.symbol,
      decimals: tokenData.decimals,
      timestamp: tokenData.timestamp,
      confidence: tokenData.confidence,
    };
  } catch {
    return null;
  }
}

export async function getMarketPrices(
  chainId: number,
  loanToken: string,
  collateralToken: string
): Promise<{ loanPrice: DefiLlamaPrice | null; collateralPrice: DefiLlamaPrice | null; relativePrice: number | null }> {
  const [loanPrice, collateralPrice] = await Promise.all([
    getDefiLlamaPrice(chainId, loanToken),
    getDefiLlamaPrice(chainId, collateralToken),
  ]);

  const relativePrice = (loanPrice && collateralPrice && loanPrice.price > 0)
    ? collateralPrice.price / loanPrice.price
    : null;

  return { loanPrice, collateralPrice, relativePrice };
}
