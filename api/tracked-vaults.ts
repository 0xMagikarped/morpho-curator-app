import { get } from '@vercel/edge-config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { walletToKey, type TrackedVault } from './_lib/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const wallet = req.query.wallet as string;
  if (!wallet || !wallet.startsWith('0x')) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    const key = walletToKey(wallet);
    const vaults = await get<TrackedVault[]>(key);
    return res.status(200).json(vaults || []);
  } catch (error) {
    console.error('Edge Config read error:', error);
    return res.status(500).json({ error: 'Failed to read tracked vaults' });
  }
}
