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
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { wallet, vault } = req.body;
  if (!wallet || !wallet.startsWith('0x')) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }
  if (!vault?.address || !vault?.chainId) {
    return res.status(400).json({ error: 'Missing vault address or chainId' });
  }

  try {
    const key = walletToKey(wallet);
    const existing = ((await get(key)) || []) as Record<string, unknown>[];

    const alreadyExists = existing.some(
      (v) =>
        String(v.address).toLowerCase() === vault.address.toLowerCase() &&
        v.chainId === vault.chainId,
    );

    if (alreadyExists) {
      return res.status(200).json({ message: 'Already tracked', vaults: existing });
    }

    const updated = [...existing, { ...vault, address: vault.address, addedAt: Date.now() }];
    await upsertEdgeConfigItem(key, updated);
    return res.status(200).json({ message: 'Tracked', vaults: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to track vault', detail: msg });
  }
}
