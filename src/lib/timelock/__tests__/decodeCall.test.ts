import { describe, it, expect } from 'vitest';
import { encodeFunctionData, type Address } from 'viem';
import { decodeCall } from '../decodeCall';
import { metaMorphoV1Abi } from '../../contracts/abis';
import { moolahSingletonAbi, timelockControllerAbi } from '../../contracts/moolahAbis';

// BNB Lista tracked vault — in the chain config so KNOWN_ABIS will
// recognize it as a MoolahVault.
const LISTA_USD1_VAULT = '0xfa27f172e0b6ebcEF9c51ABf817E2cb142FbE627' as Address;
const MOOLAH_SINGLETON = '0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C' as Address;

// A plausible MoolahMarketFactory proxy on BNB. Used only for ABI-routing
// tests — the actual match predicate checks chainConfig.moolah.marketFactory,
// which is unset in the default config, so MarketFactory calls fall through
// to MetaMorphoV1 / TimelockController depending on selector.
const FAKE_FACTORY = '0x0000000000000000000000000000000000000aaa' as Address;

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

describe('decodeCall', () => {
  it('decodes a MoolahVault setter on a known vault target', () => {
    const capParams = {
      loanToken: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d' as Address,
      collateralToken: '0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B' as Address,
      oracle: '0x0000000000000000000000000000000000000001' as Address,
      irm: '0xFe7dAe87Ebb11a7BEB9F534BB23267992d9cDe7c' as Address,
      lltv: 860000000000000000n,
    };
    const data = encodeFunctionData({
      abi: metaMorphoV1Abi,
      functionName: 'submitCap',
      args: [capParams, 10_000_000n * 10n ** 18n],
    });

    const out = decodeCall(LISTA_USD1_VAULT, 0n, data, 56);

    expect(out).not.toBeNull();
    expect(out?.functionName).toBe('submitCap');
    expect(out?.args[0].type).toBe('tuple');
    expect(out?.args[1].value).toBe(10_000_000n * 10n ** 18n);
    expect(out?.target).toBe(LISTA_USD1_VAULT);
  });

  it('decodes a Moolah singleton read like paused()', () => {
    const data = encodeFunctionData({
      abi: moolahSingletonAbi,
      functionName: 'paused',
    });
    const out = decodeCall(MOOLAH_SINGLETON, 0n, data, 56);
    expect(out?.functionName).toBe('paused');
    // abiLabel should surface a Moolah-aware label, not TimelockController.
    expect(out?.abiLabel).not.toBe('TimelockController');
  });

  it('falls through to TimelockController for self-calls like updateDelay', () => {
    const data = encodeFunctionData({
      abi: [
        {
          inputs: [{ name: 'newDelay', type: 'uint256' }],
          name: 'updateDelay',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ],
      functionName: 'updateDelay',
      args: [86_400n],
    });
    // Target is some unknown timelock — no registry pin, no vault match.
    const out = decodeCall(FAKE_FACTORY, 0n, data, 56);
    expect(out?.functionName).toBe('updateDelay');
    expect(out?.args[0].value).toBe(86_400n);
  });

  it('returns null for an unknown selector', () => {
    const unknownData = ('0xdeadbeef' + '0'.repeat(120)) as `0x${string}`;
    const out = decodeCall(FAKE_FACTORY, 0n, unknownData, 56);
    expect(out).toBeNull();
  });

  it('expands scheduleBatch into nested decodes', () => {
    const inner1 = encodeFunctionData({
      abi: metaMorphoV1Abi,
      functionName: 'setFee',
      args: [123n],
    });
    const inner2 = encodeFunctionData({
      abi: metaMorphoV1Abi,
      functionName: 'setFeeRecipient',
      args: ['0x1000000000000000000000000000000000000001' as Address],
    });
    const data = encodeFunctionData({
      abi: timelockControllerAbi,
      functionName: 'scheduleBatch',
      args: [
        [LISTA_USD1_VAULT, LISTA_USD1_VAULT],
        [0n, 0n],
        [inner1, inner2],
        ZERO_BYTES32,
        ZERO_BYTES32,
        86_400n,
      ],
    });

    const out = decodeCall(FAKE_FACTORY, 0n, data, 56);
    expect(out?.functionName).toBe('scheduleBatch');
    expect(out?.batch?.length).toBe(2);
    expect(out?.batch?.[0].functionName).toBe('setFee');
    expect(out?.batch?.[1].functionName).toBe('setFeeRecipient');
  });
});
