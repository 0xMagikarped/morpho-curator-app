import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

interface TrackedVault {
  address: string;
  chainId: number;
  name: string;
  version: 'v1' | 'v2';
}

function kvKey(wallet: string): string {
  return `tracked-vaults:${wallet.toLowerCase()}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const wallet = req.query.wallet as string | undefined;
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    const vaults = await kv.get<TrackedVault[]>(kvKey(wallet));
    return res.status(200).json({ vaults: vaults ?? [] });
  } catch (err) {
    console.error('[tracked-vaults] KV read error:', err);
    return res.status(500).json({ error: 'Failed to read tracked vaults' });
  }
}
