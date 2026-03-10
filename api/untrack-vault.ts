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
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { wallet, address, chainId } = req.body as {
    wallet?: string;
    address?: string;
    chainId?: number;
  };

  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }
  if (!address || !chainId) {
    return res.status(400).json({ error: 'Missing vault address or chainId' });
  }

  try {
    const key = kvKey(wallet);
    const existing = (await kv.get<TrackedVault[]>(key)) ?? [];

    const updated = existing.filter(
      (v) =>
        !(v.address.toLowerCase() === address.toLowerCase() && v.chainId === chainId),
    );

    await kv.set(key, updated);

    return res.status(200).json({ vaults: updated });
  } catch (err) {
    console.error('[untrack-vault] KV write error:', err);
    return res.status(500).json({ error: 'Failed to untrack vault' });
  }
}
