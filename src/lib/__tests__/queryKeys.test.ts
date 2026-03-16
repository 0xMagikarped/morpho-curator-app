import { describe, it, expect } from 'vitest';
import { vaultKeys, marketKeys, oracleKeys, dashboardKeys, riskKeys, sdkKeys } from '../queryKeys';

describe('vaultKeys', () => {
  it('creates unique keys for different vault addresses', () => {
    const key1 = vaultKeys.detail(1, '0xAAA');
    const key2 = vaultKeys.detail(1, '0xBBB');
    expect(key1).not.toEqual(key2);
  });

  it('creates unique keys for different chains', () => {
    const key1 = vaultKeys.detail(1, '0xAAA');
    const key2 = vaultKeys.detail(8453, '0xAAA');
    expect(key1).not.toEqual(key2);
  });

  it('list and detail share the common "vault" root', () => {
    const listKey = vaultKeys.list(1);
    const detailKey = vaultKeys.detail(1, '0xAAA');
    // Both start with the 'vault' root for broad invalidation
    expect(listKey[0]).toBe('vault');
    expect(detailKey[0]).toBe('vault');
    // But diverge at index 1 (list vs detail)
    expect(listKey[1]).toBe('list');
    expect(detailKey[1]).toBe('detail');
  });

  it('fullData key extends detail key', () => {
    const detailKey = vaultKeys.detail(1, '0xAAA');
    const fullDataKey = vaultKeys.fullData(1, '0xAAA');
    expect(fullDataKey.slice(0, detailKey.length)).toEqual(detailKey);
    expect(fullDataKey.length).toBeGreaterThan(detailKey.length);
  });

  it('lowercases addresses for consistency', () => {
    const key1 = vaultKeys.detail(1, '0xAbCdEf');
    const key2 = vaultKeys.detail(1, '0xabcdef');
    expect(key1).toEqual(key2);
  });

  it('handles undefined/empty addresses without throwing', () => {
    expect(() => vaultKeys.detail(1, undefined as unknown as string)).not.toThrow();
    expect(() => vaultKeys.detail(1, '')).not.toThrow();
    expect(() => vaultKeys.role(1, '0xAAA', undefined)).not.toThrow();
  });

  it('role key includes user when provided', () => {
    const withUser = vaultKeys.role(1, '0xAAA', '0xUser');
    const withoutUser = vaultKeys.role(1, '0xAAA');
    expect(withUser).not.toEqual(withoutUser);
  });

  it('pending key extends detail key', () => {
    const detailKey = vaultKeys.detail(1, '0xAAA');
    const pendingKey = vaultKeys.pending(1, '0xAAA');
    expect(pendingKey.slice(0, detailKey.length)).toEqual(detailKey);
  });

  it('adapters key extends detail key', () => {
    const detailKey = vaultKeys.detail(1, '0xAAA');
    const adaptersKey = vaultKeys.adapters(1, '0xAAA');
    expect(adaptersKey.slice(0, detailKey.length)).toEqual(detailKey);
  });
});

describe('marketKeys', () => {
  it('creates unique keys for different markets', () => {
    const key1 = marketKeys.detail(1, '0xMARKET1');
    const key2 = marketKeys.detail(1, '0xMARKET2');
    expect(key1).not.toEqual(key2);
  });

  it('discovered key contains chain id', () => {
    const key = marketKeys.discovered(1);
    expect(key).toContain(1);
  });

  it('scanner key contains chain id', () => {
    const key = marketKeys.scanner(8453);
    expect(key).toContain(8453);
  });
});

describe('oracleKeys', () => {
  it('lowercases oracle addresses', () => {
    const key1 = oracleKeys.info(1, '0xAbCdEf');
    const key2 = oracleKeys.info(1, '0xabcdef');
    expect(key1).toEqual(key2);
  });

  it('healthBatch handles empty addresses array', () => {
    expect(() => oracleKeys.healthBatch(1, [])).not.toThrow();
  });

  it('healthBatch handles undefined addresses', () => {
    expect(() => oracleKeys.healthBatch(1, undefined as unknown as string[])).not.toThrow();
  });
});

describe('dashboardKeys', () => {
  it('handles undefined wallet in vaults key', () => {
    expect(() => dashboardKeys.vaults('tracked-key')).not.toThrow();
    expect(() => dashboardKeys.vaults('tracked-key', undefined)).not.toThrow();
  });

  it('managed key lowercases wallet', () => {
    const key1 = dashboardKeys.managed('0xAbCdEf');
    const key2 = dashboardKeys.managed('0xabcdef');
    expect(key1).toEqual(key2);
  });

  it('managed handles empty string', () => {
    expect(() => dashboardKeys.managed('')).not.toThrow();
  });
});

describe('riskKeys', () => {
  it('sharePrice key lowercases address', () => {
    const key1 = riskKeys.sharePrice(1, '0xAbCdEf');
    const key2 = riskKeys.sharePrice(1, '0xabcdef');
    expect(key1).toEqual(key2);
  });
});

describe('sdkKeys', () => {
  it('vault key includes address and chain', () => {
    const key = sdkKeys.vault('0xAAA', 1);
    expect(key).toContain(1);
    expect(key).toContain('0xaaa');
  });

  it('handles undefined address safely', () => {
    expect(() => sdkKeys.vault(undefined as unknown as string, 1)).not.toThrow();
  });
});
