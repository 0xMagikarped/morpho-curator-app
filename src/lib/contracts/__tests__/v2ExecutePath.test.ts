/**
 * The Timelock Queue's Execute button re-sends a queued action by decoding
 * the submitted calldata against `metaMorphoV2Abi` and handing the resulting
 * (functionName, args) to writeContract. That round-trip MUST reproduce the
 * original bytes exactly — `executableAt` is keyed on the calldata, so a
 * single differing byte means the vault reverts `DataNotTimelocked` and the
 * action can never be executed from the UI.
 *
 * Fixture is a real `submit()` payload from RockawayX USDC on Pharos
 * (vault 0x047cd0a9…02e5, block 13765952): increaseAbsoluteCap to
 * 10,000,000 USDC on the wsrUSD collateralToken cap id.
 */
import { describe, it, expect } from 'vitest';
import { decodeFunctionData, encodeFunctionData, toFunctionSelector } from 'viem';
import { metaMorphoV2Abi } from '../metaMorphoV2Abi';

const SUBMITTED_CALLDATA =
  '0xf6f98fd5' +
  '0000000000000000000000000000000000000000000000000000000000000040' +
  '000000000000000000000000000000000000000000000000000009184e72a000' +
  '0000000000000000000000000000000000000000000000000000000000000080' +
  '0000000000000000000000000000000000000000000000000000000000000040' +
  '0000000000000000000000004809010926aec940b550d34a46a52739f996d75d' +
  '000000000000000000000000000000000000000000000000000000000000000f' +
  '636f6c6c61746572616c546f6b656e0000000000000000000000000000000000';

describe('V2 timelock Execute path', () => {
  it('decodes a real submitted increaseAbsoluteCap payload', () => {
    const decoded = decodeFunctionData({
      abi: metaMorphoV2Abi,
      data: SUBMITTED_CALLDATA as `0x${string}`,
    });
    expect(decoded.functionName).toBe('increaseAbsoluteCap');
    const args = decoded.args as readonly unknown[];
    // 10,000,000 USDC at 6 decimals.
    expect(args[1]).toBe(10_000_000_000_000n);
  });

  it('re-encodes to byte-identical calldata (executableAt is keyed on it)', () => {
    const decoded = decodeFunctionData({
      abi: metaMorphoV2Abi,
      data: SUBMITTED_CALLDATA as `0x${string}`,
    });
    const reencoded = encodeFunctionData({
      abi: metaMorphoV2Abi,
      functionName: decoded.functionName,
      args: decoded.args as never,
    });
    expect(reencoded).toBe(SUBMITTED_CALLDATA);
  });

  it('exposes revoke(bytes), not revoke(bytes32)', () => {
    // The wrong fragment hashes to a different selector, so a revoke would
    // hit the fallback and silently revert.
    const revoke = metaMorphoV2Abi.find(
      (f) => f.type === 'function' && f.name === 'revoke',
    ) as { inputs: { type: string }[] } | undefined;
    expect(revoke?.inputs[0]?.type).toBe('bytes');
    // bytes32 and bytes hash to different selectors — that was the bug.
    expect(toFunctionSelector('revoke(bytes)')).not.toBe(
      toFunctionSelector('revoke(bytes32)'),
    );
  });

  it('selector of the submitted payload matches increaseAbsoluteCap', () => {
    expect(SUBMITTED_CALLDATA.slice(0, 10)).toBe(
      toFunctionSelector('increaseAbsoluteCap(bytes,uint256)'),
    );
  });
});
