/**
 * PR 5 — reject client-exposed keyed RPC URLs.
 *
 * `sanitizeRpcUrl` does not exist on `main` → this suite fails to import there.
 * On branch it passes. Root cause it guards: `VITE_*_RPC_URL` set to an
 * Infura/Alchemy/QuickNode URL with an embedded key gets inlined into the
 * public client bundle by Vite, exposing the key (and, when over quota,
 * 429-storming every read).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sanitizeRpcUrl } from '../env';

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe('sanitizeRpcUrl — rejects client-exposed keyed RPCs (PR 5)', () => {
  const KEYED = [
    'https://mainnet.infura.io/v3/70fde4d039af47d6b5ce31de9d8710a8',
    'https://base-mainnet.infura.io/v3/70fde4d039af47d6b5ce31de9d8710a8',
    'https://eth-mainnet.g.alchemy.com/v2/abcDEF123456abcDEF123456',
    'https://eth-mainnet.alchemy.com/v2/abcDEF123456',
    'https://snowy-cool.quiknode.pro/0123456789abcdef/',
    'https://example.quicknode.com/0123456789abcdef/',
  ];

  it.each(KEYED)('rejects keyed RPC %s → returns empty string', (url) => {
    expect(sanitizeRpcUrl('VITE_ETH_RPC_URL', url)).toBe('');
  });

  it('emits a console.error explaining WHY the RPC was dropped', () => {
    sanitizeRpcUrl('VITE_ETH_RPC_URL', KEYED[0]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const msg = String(errorSpy.mock.calls[0][0]);
    expect(msg).toContain('VITE_ETH_RPC_URL');
    expect(msg).toContain('exposed');
  });

  const SAFE = [
    'https://ethereum-rpc.publicnode.com',
    'https://eth.llamarpc.com',
    'https://rpc.xinfin.network',
    'https://mainnet.base.org',
    'https://rpc.ankr.com/eth',
  ];

  it.each(SAFE)('passes through unkeyed public RPC %s unchanged', (url) => {
    expect(sanitizeRpcUrl('VITE_ETH_RPC_URL', url)).toBe(url);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('leaves an empty value empty (no RPC override configured)', () => {
    expect(sanitizeRpcUrl('VITE_ETH_RPC_URL', '')).toBe('');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
