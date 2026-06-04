// Same-origin JSON-RPC proxy. The frontend points proxied chains at
// /api/rpc/<chainId>; this function injects the server-side Alchemy key (never
// shipped to the browser) and forwards the request upstream. Falls through to
// the public RPC URL passed as ?fallback= if no key/slug is available, so the
// app still works before ALCHEMY_API_KEY is configured.
import { alchemyUrl } from '../_upstream.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed — use POST' });
    return;
  }

  const chainId = Number(req.query.chainId);
  const key = process.env.ALCHEMY_API_KEY;
  const fallback = typeof req.query.fallback === 'string' ? req.query.fallback : null;
  const upstream = alchemyUrl(chainId, key) ?? fallback;

  if (!upstream) {
    res.status(502).json({ error: `No upstream RPC for chain ${chainId} (set ALCHEMY_API_KEY)` });
    return;
  }

  // Vercel parses JSON bodies; re-serialize to forward (object or batch array).
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  try {
    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const text = await upstreamRes.text();
    res.status(upstreamRes.status);
    res.setHeader('content-type', 'application/json');
    // Short edge cache for identical reads; RPC results are effectively immutable
    // per block, and viem sends no-store on its side anyway.
    res.setHeader('cache-control', 'no-store');
    res.send(text);
  } catch {
    res.status(502).json({ error: 'Upstream RPC request failed' });
  }
}
