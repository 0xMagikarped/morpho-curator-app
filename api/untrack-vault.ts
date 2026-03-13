import { get } from '@vercel/edge-config';

export const config = {
  runtime: 'edge',
};

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
    'Access-Control-Allow-Methods': 'DELETE, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default async function handler(request: Request) {
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  if (request.method !== 'DELETE' && request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const { wallet, vaultAddress, chainId } = await request.json();

    if (!wallet || !vaultAddress || chainId === undefined) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
    }

    if (!process.env.EDGE_CONFIG_ID || !process.env.VERCEL_API_TOKEN) {
      return new Response(JSON.stringify({ error: 'Edge Config not configured' }), { status: 500, headers });
    }

    const key = walletToKey(wallet);
    const existing = ((await get(key)) ?? []) as Record<string, unknown>[];

    const updated = existing.filter(
      (v) =>
        !(String(v.address).toLowerCase() === vaultAddress.toLowerCase() &&
          v.chainId === chainId),
    );

    await upsertEdgeConfigItem(key, updated);

    return new Response(JSON.stringify({ message: 'Untracked', vaults: updated }), { status: 200, headers });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: 'Failed to untrack vault', detail: msg }), { status: 500, headers });
  }
}
