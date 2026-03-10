import { get } from '@vercel/edge-config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { walletToKey, type TrackedVault } from './_lib/types';
import { upsertEdgeConfigItem } from './_lib/edge-config-write';
import { checkCors } from './_lib/cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!checkCors(req, res)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { wallet, vaultAddress, chainId } = req.body;
  if (!wallet || !vaultAddress || !chainId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const key = walletToKey(wallet);
    const existing = (await get<TrackedVault[]>(key)) || [];

    const updated = existing.filter(
      (v) =>
        !(v.address.toLowerCase() === vaultAddress.toLowerCase() &&
          v.chainId === chainId),
    );

    await upsertEdgeConfigItem(key, updated);
    return res.status(200).json({ message: 'Untracked', vaults: updated });
  } catch (error) {
    console.error('Untrack vault error:', error);
    return res.status(500).json({ error: 'Failed to untrack vault' });
  }
}
