export interface TrackedVault {
  address: string;
  chainId: number;
  name: string;
  symbol: string;
  asset: string;
  role: 'owner' | 'curator' | 'both';
  version: 'v1' | 'v2';
  addedAt: number;
}

export function walletToKey(wallet: string): string {
  return `tracked_${wallet.toLowerCase().replace('0x', '')}`;
}
