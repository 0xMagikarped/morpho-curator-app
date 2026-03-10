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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { wallet, vault } = req.body as { wallet?: string; vault?: TrackedVault };

  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }
  if (!vault?.address || !vault?.chainId) {
    return res.status(400).json({ error: 'Missing vault data' });
  }

  try {
    const key = kvKey(wallet);
    const existing = (await kv.get<TrackedVault[]>(key)) ?? [];

    const alreadyTracked = existing.some(
      (v) =>
        v.address.toLowerCase() === vault.address.toLowerCase() &&
        v.chainId === vault.chainId,
    );

    if (alreadyTracked) {
      return res.status(200).json({ vaults: existing, added: false });
    }

    const updated = [...existing, vault];
    await kv.set(key, updated);

    return res.status(200).json({ vaults: updated, added: true });
  } catch (err) {
    console.error('[track-vault] KV write error:', err);
    return res.status(500).json({ error: 'Failed to track vault' });
  }
}
