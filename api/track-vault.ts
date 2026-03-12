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
      corsHeaders['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
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

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const { wallet, vault } = await request.json();

    if (!wallet || !wallet.startsWith('0x')) {
      return new Response(JSON.stringify({ error: 'Invalid wallet address' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    if (!vault?.address || !vault?.chainId) {
      return new Response(JSON.stringify({ error: 'Missing vault address or chainId' }), {
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

    const alreadyExists = existing.some(
      (v) =>
        String(v.address).toLowerCase() === vault.address.toLowerCase() &&
        v.chainId === vault.chainId,
    );

    if (alreadyExists) {
      return new Response(JSON.stringify({ message: 'Already tracked', vaults: existing }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const updated = [...existing, { ...vault, address: vault.address, addedAt: Date.now() }];
    await upsertEdgeConfigItem(key, updated);

    return new Response(JSON.stringify({ message: 'Tracked', vaults: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: 'Failed to track vault', detail: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
