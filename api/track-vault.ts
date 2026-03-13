import { get } from '@vercel/edge-config';

export const config = {
  runtime: 'edge',
};

function walletToKey(wallet: string): string {
  return `tracked_${wallet.toLowerCase().replace('0x', '')}`;
}

async function writeEdgeConfig(key: string, value: unknown) {
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
    const err = await r.text();
    throw new Error(`Edge Config write failed: ${r.status} ${err}`);
  }
  return r.json();
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  return {
    'Content-Type': 'application/json',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default async function handler(request: Request) {
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const body = await request.json();
    const { wallet, vaults, vault } = body;

    if (!wallet || !wallet.startsWith('0x')) {
      return new Response(JSON.stringify({ error: 'Invalid wallet address' }), { status: 400, headers });
    }

    if (!process.env.EDGE_CONFIG_ID || !process.env.VERCEL_API_TOKEN) {
      return new Response(JSON.stringify({ error: 'Edge Config not configured' }), { status: 500, headers });
    }

    const key = walletToKey(wallet);
    let finalVaults;

    if (Array.isArray(vaults)) {
      // Full list sync — replace entirely
      finalVaults = vaults;
    } else if (vault?.address && vault?.chainId) {
      // Single vault add — read-modify-write
      const current = ((await get(key)) ?? []) as Record<string, unknown>[];
      const exists = current.some(
        (v) =>
          String(v.address).toLowerCase() === vault.address.toLowerCase() &&
          v.chainId === vault.chainId,
      );
      if (exists) {
        return new Response(JSON.stringify({ success: true, message: 'Already tracked', vaults: current }), { status: 200, headers });
      }
      finalVaults = [...current, { ...vault, address: vault.address, trackedAt: new Date().toISOString() }];
    } else {
      return new Response(JSON.stringify({ error: 'vaults array or vault object required' }), { status: 400, headers });
    }

    await writeEdgeConfig(key, finalVaults);

    return new Response(JSON.stringify({ success: true, vaults: finalVaults }), { status: 200, headers });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[track-vault] Error:', msg);
    return new Response(JSON.stringify({ error: 'Failed to track vault', detail: msg }), { status: 500, headers });
  }
}
