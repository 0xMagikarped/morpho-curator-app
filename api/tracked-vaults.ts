import { get } from '@vercel/edge-config';

export const config = {
  runtime: 'edge',
};

function walletToKey(wallet: string): string {
  return `tracked_${wallet.toLowerCase().replace('0x', '')}`;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  return {
    'Content-Type': 'application/json',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default async function handler(request: Request) {
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  const url = new URL(request.url);
  const wallet = url.searchParams.get('wallet');

  if (!wallet || !wallet.startsWith('0x')) {
    return new Response(JSON.stringify({ error: 'Invalid wallet address' }), { status: 400, headers });
  }

  try {
    const key = walletToKey(wallet);
    const vaults = await get(key);
    return new Response(JSON.stringify(vaults ?? []), { status: 200, headers });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: 'Failed to read tracked vaults', detail: msg }), { status: 500, headers });
  }
}
