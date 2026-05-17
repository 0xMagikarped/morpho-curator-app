/**
 * PR 3 — audit §4: CSP enforcement, HSTS, complete connect-src.
 *
 * Deterministic structural assertions on `vercel.json` (no deploy needed),
 * so this runs in CI. On `main` the policy is Report-Only, has
 * `script-src 'unsafe-eval'`, no HSTS and an incomplete connect-src — so
 * tests fail. On this branch all pass. (Live enforcement is proven
 * separately by the env-gated Playwright spec `e2e/csp.spec.ts`.)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

interface HeaderEntry { key: string; value: string }
interface HeaderRule { source: string; headers: HeaderEntry[] }
interface VercelJson { headers: HeaderRule[] }

// vitest runs with cwd at the repo root; `vercel.json` lives there.
const vercel: VercelJson = JSON.parse(
  readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'),
);

/** Headers applied to every path. */
const globalRule = vercel.headers.find((r) => r.source === '/(.*)');
const header = (key: string) =>
  globalRule?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

const csp = header('Content-Security-Policy') ?? '';
const directive = (name: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `)) ?? '';

/** Every connect-src host the app actually contacts (wagmi transports +
 *  chains.ts rpcUrls + data APIs + WalletConnect). Provenance: FIX_LOG PR 3. */
const REQUIRED_CONNECT_SRC = [
  "'self'",
  'https://*.publicnode.com',
  'https://eth.public-rpc.com',
  'https://rpc.ankr.com',
  'https://mainnet.base.org',
  'https://evm-rpc.sei-apis.com',
  'https://*.llamarpc.com',
  'https://*.binance.org',
  'https://rpc.pharos.xyz',
  'https://eth.merkle.io',
  'https://*.rpc.thirdweb.com',
  'https://api.morpho.org',
  'https://coins.llama.fi',
  'https://*.sentry.io',
  'https://*.walletconnect.com',
  'https://*.walletconnect.org',
  'https://*.reown.com',
  'wss://*.walletconnect.com',
  'wss://*.walletconnect.org',
  'wss://*.reown.com',
] as const;

describe('vercel.json security headers (audit §4)', () => {
  it('CSP is ENFORCED, not Report-Only', () => {
    expect(globalRule).toBeDefined();
    expect(header('Content-Security-Policy')).toBeTruthy();
    expect(header('Content-Security-Policy-Report-Only')).toBeUndefined();
  });

  it("script-src does NOT allow 'unsafe-eval'", () => {
    const scriptSrc = directive('script-src');
    expect(scriptSrc).toBe("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it.each(REQUIRED_CONNECT_SRC)('connect-src allows %s', (host) => {
    const connectSrc = directive('connect-src');
    expect(connectSrc.split(/\s+/)).toContain(host);
  });

  it('connect-src still forbids a non-allowlisted host', () => {
    // Guards against an over-broad `https:` wildcard slipping in.
    expect(directive('connect-src')).not.toContain('https://evil.example');
    expect(directive('connect-src').split(/\s+/)).not.toContain('https:');
  });

  it('HSTS is present and strong', () => {
    const hsts = header('Strict-Transport-Security') ?? '';
    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? '0');
    expect(maxAge).toBeGreaterThanOrEqual(63_072_000);
    expect(hsts).toContain('includeSubDomains');
    expect(hsts).toContain('preload');
  });

  it('Permissions-Policy is present', () => {
    expect(header('Permissions-Policy')).toBeTruthy();
  });

  it('frame-ancestors stays locked down (regression guard)', () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(header('X-Frame-Options')).toBe('DENY');
  });
});
