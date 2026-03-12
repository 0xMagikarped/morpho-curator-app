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

export default async function handler(request: Request) {
  // CORS
  const origin = request.headers.get('origin');
  const corsHeaders: Record<string, string> = {};
  if (origin) {
    if (origin.endsWith('.vercel.app') || origin.startsWith('http://localhost')) {
      corsHeaders['Access-Control-Allow-Origin'] = origin;
      corsHeaders['Access-Control-Allow-Methods'] = 'DELETE, POST, OPTIONS';
      corsHeaders['Access-Control-Allow-Headers'] = 'Content-Type';
    } else {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (request.method !== 'DELETE' && request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const { wallet, vaultAddress, chainId } = await request.json();

    if (!wallet || !vaultAddress || chainId === undefined) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (!process.env.EDGE_CONFIG_ID || !process.env.VERCEL_API_TOKEN) {
      return new Response(JSON.stringify({ error: 'Edge Config not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const key = walletToKey(wallet);
    const existing = ((await get(key)) ?? []) as Record<string, unknown>[];

    const updated = existing.filter(
      (v) =>
        !(String(v.address).toLowerCase() === vaultAddress.toLowerCase() &&
          v.chainId === chainId),
    );

    await upsertEdgeConfigItem(key, updated);

    return new Response(JSON.stringify({ message: 'Untracked', vaults: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: 'Failed to untrack vault', detail: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
