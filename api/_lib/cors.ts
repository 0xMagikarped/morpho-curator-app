import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ORIGINS = [
  'https://morpho-curator-app.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

/**
 * Validate request origin. Returns true if allowed, false if blocked.
 * Also sets CORS headers on the response.
 */
export function checkCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin as string | undefined;

  // Allow requests with no origin (same-origin, curl, server-to-server)
  if (!origin) return true;

  // Allow any *.vercel.app preview deploys
  if (origin.endsWith('.vercel.app') || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return true;
  }

  return false;
}
