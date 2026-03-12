import { get } from '@vercel/edge-config';

export const config = {
  runtime: 'edge',
};

function walletToKey(wallet: string): string {
  return `tracked_${wallet.toLowerCase().replace('0x', '')}`;
}

export default async function handler(request: Request) {
  // CORS
  const origin = request.headers.get('origin');
  const corsHeaders: Record<string, string> = {};
  if (origin) {
    if (origin.endsWith('.vercel.app') || origin.startsWith('http://localhost')) {
      corsHeaders['Access-Control-Allow-Origin'] = origin;
      corsHeaders['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
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

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const url = new URL(request.url);
  const wallet = url.searchParams.get('wallet');

  if (!wallet || !wallet.startsWith('0x')) {
    return new Response(JSON.stringify({ error: 'Invalid wallet address' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const key = walletToKey(wallet);
    const vaults = await get(key);

    return new Response(JSON.stringify(vaults ?? []), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: 'Failed to read tracked vaults', detail: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
