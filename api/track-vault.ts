import { get } from '@vercel/edge-config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { walletToKey, type TrackedVault } from './_lib/types';
import { upsertEdgeConfigItem } from './_lib/edge-config-write';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { wallet, vault } = req.body;
  if (!wallet || !wallet.startsWith('0x')) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }
  if (!vault?.address || !vault?.chainId) {
    return res.status(400).json({ error: 'Missing vault address or chainId' });
  }

  try {
    const key = walletToKey(wallet);
    const existing = (await get<TrackedVault[]>(key)) || [];

    const alreadyExists = existing.some(
      (v) =>
        v.address.toLowerCase() === vault.address.toLowerCase() &&
        v.chainId === vault.chainId,
    );

    if (alreadyExists) {
      return res.status(200).json({ message: 'Already tracked', vaults: existing });
    }

    const updated = [
      ...existing,
      { ...vault, address: vault.address, addedAt: Date.now() },
    ];

    await upsertEdgeConfigItem(key, updated);
    return res.status(200).json({ message: 'Tracked', vaults: updated });
  } catch (error) {
    console.error('Track vault error:', error);
    return res.status(500).json({ error: 'Failed to track vault' });
  }
}
