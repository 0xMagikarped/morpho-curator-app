import { get } from '@vercel/edge-config';
import type { VercelRequest, VercelResponse } from '@vercel/node';

function walletToKey(wallet: string): string {
  return `tracked_${wallet.toLowerCase().replace('0x', '')}`;
}

async function upsertEdgeConfigItem(key: string, value: unknown) {
  const r = await fetch(
    `https://api.vercel.com/v1/edge-config/${process.env.EDGE_CONFIG_ID}/items`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [{ operation: 'upsert', key, value }] }),
    },
  );
  if (!r.ok) {
    const err = await r.json();
    throw new Error(`Edge Config write failed: ${JSON.stringify(err)}`);
  }
  return r.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  const origin = req.headers.origin as string | undefined;
  if (origin) {
    if (origin.endsWith('.vercel.app') || origin.startsWith('http://localhost')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const { wallet, vaultAddress, chainId } = req.body;
  if (!wallet || !vaultAddress || !chainId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const key = walletToKey(wallet);
    const existing = ((await get(key)) || []) as Record<string, unknown>[];

    const updated = existing.filter(
      (v) =>
        !(String(v.address).toLowerCase() === vaultAddress.toLowerCase() &&
          v.chainId === chainId),
    );

    await upsertEdgeConfigItem(key, updated);
    return res.status(200).json({ message: 'Untracked', vaults: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to untrack vault', detail: msg });
  }
}
