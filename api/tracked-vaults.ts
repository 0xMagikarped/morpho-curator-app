import { get } from '@vercel/edge-config';
import type { VercelRequest, VercelResponse } from '@vercel/node';

function walletToKey(wallet: string): string {
  return `tracked_${wallet.toLowerCase().replace('0x', '')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  const origin = req.headers.origin as string | undefined;
  if (origin) {
    if (origin.endsWith('.vercel.app') || origin.startsWith('http://localhost')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const wallet = req.query.wallet as string;
  if (!wallet || !wallet.startsWith('0x')) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    const key = walletToKey(wallet);
    const vaults = await get(key);
    return res.status(200).json(vaults || []);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to read tracked vaults', detail: msg });
  }
}
