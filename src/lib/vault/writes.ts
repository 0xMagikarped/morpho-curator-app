/**
 * Vault write router.
 *
 * Every write path the app issues — setCap, setFeeRecipient, setSupplyQueue,
 * setIsAllocator, etc. — runs through `prepareWrite`. It returns either:
 *   - { type: 'direct'    }  single tx to the vault (MetaMorpho).
 *   - { type: 'timelocked' } propose on a TimelockController, wait minDelay,
 *                            then execute (Moolah).
 *
 * UI components call `useVaultWrite(intent)` and render Propose / Wait /
 * Execute based on the shape.
 *
 * Canonical TimeLock mapping for Moolah (mirrors Lista's vault-governance
 * contract map in `lista-dao/moolah`):
 *
 *   setCap, setSupplyQueue, updateWithdrawQueue, setFeeRecipient, setFee,
 *   setCurator, setTimelockDelay, removeCap   → curatorTimeLock
 *   setIsAllocator, setManager                → managerTimeLock
 *   reallocate                                → DIRECT call to the vault.
 *                                               PROPOSER holders on the
 *                                               managerTimeLock are also the
 *                                               addresses with ALLOCATOR_ROLE
 *                                               on the vault; the vault
 *                                               enforces allocator perms
 *                                               on reallocate() itself, not
 *                                               via schedule/execute.
 *
 * Note on `reallocate`: the OZ timelock pattern is too slow for active
 * rebalancing, so Moolah keeps reallocation direct but permissioned via
 * role-check on msg.sender. We document that here so it's discoverable.
 */

import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbiParameters,
  toHex,
  type Address,
  type PublicClient,
} from 'viem';
import type { VaultFlavor } from '../../types';
import { metaMorphoV1Abi } from '../contracts/abis';
import { timelockControllerAbi } from '../contracts/moolahAbis';
import type { VaultSnapshot } from './adapter';

export type WriteIntentKind =
  | 'setCap'
  | 'removeCap'
  | 'acceptCap'
  | 'setSupplyQueue'
  | 'updateWithdrawQueue'
  | 'setFeeRecipient'
  | 'setFee'
  | 'setCurator'
  | 'setManager'
  | 'setIsAllocator'
  | 'setTimelockDelay'
  | 'reallocate';

export type WriteIntent =
  | {
      kind: 'setCap';
      marketParams: { loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint };
      newSupplyCap: bigint;
    }
  | {
      kind: 'acceptCap';
      marketParams: { loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint };
    }
  | { kind: 'removeCap'; marketId: `0x${string}` }
  | { kind: 'setSupplyQueue'; newSupplyQueue: `0x${string}`[] }
  | { kind: 'updateWithdrawQueue'; indexes: bigint[] }
  | { kind: 'setFeeRecipient'; newFeeRecipient: Address }
  | { kind: 'setFee'; newFee: bigint }
  | { kind: 'setCurator'; newCurator: Address }
  | { kind: 'setManager'; newManager: Address }
  | { kind: 'setIsAllocator'; addr: Address; isAllocator: boolean }
  | { kind: 'setTimelockDelay'; newDelaySeconds: bigint }
  | {
      kind: 'reallocate';
      allocations: Array<{
        marketParams: { loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint };
        assets: bigint;
      }>;
    };

/**
 * Which timelock a given intent routes through on Moolah.
 *
 * IMPORTANT: MoolahVault's role model differs from MetaMorpho V1:
 *   - CURATOR role → setCap (instant, one step — no submitCap/acceptCap)
 *   - MANAGER role → setFee, setFeeRecipient, grantRole(ALLOCATOR)
 *   - ALLOCATOR role → setSupplyQueue, updateWithdrawQueue, reallocate (DIRECT call, no timelock)
 *
 * Verified against lista-dao/moolah MoolahVault.sol (2026-04-17).
 */
const INTENT_TIMELOCK: Record<WriteIntentKind, 'curator' | 'manager' | 'direct'> = {
  setCap: 'curator',
  acceptCap: 'curator',       // Moolah: acceptCap doesn't exist; setCap is instant
  removeCap: 'curator',
  setSupplyQueue: 'direct',   // Moolah: ALLOCATOR role, called directly
  updateWithdrawQueue: 'direct', // Moolah: ALLOCATOR role, called directly
  setFeeRecipient: 'manager', // Moolah: MANAGER role
  setFee: 'manager',          // Moolah: MANAGER role
  setCurator: 'curator',
  setManager: 'curator',
  setTimelockDelay: 'curator',
  setIsAllocator: 'manager',  // Moolah: MANAGER is admin of ALLOCATOR
  reallocate: 'direct',       // Moolah: ALLOCATOR role, called directly
};

// OZ AccessControl ABI — for grantRole / revokeRole on MoolahVault
const accessControlAbi = [
  {
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    name: 'grantRole',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    name: 'revokeRole',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// MoolahVault setCap ABI — different from MetaMorpho's submitCap
const moolahSetCapAbi = [
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
        name: 'marketParams',
        type: 'tuple',
      },
      { name: 'newSupplyCap', type: 'uint256' },
    ],
    name: 'setCap',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

/** keccak256("ALLOCATOR") — the role constant on MoolahVault. */
const MOOLAH_ALLOCATOR_ROLE = keccak256(toHex('ALLOCATOR'));

function encodeVaultCall(intent: WriteIntent, flavor: VaultFlavor): `0x${string}` {
  const isMoolah = flavor === 'moolahVault';

  switch (intent.kind) {
    case 'setCap':
      // Moolah: setCap (instant, one step). MetaMorpho: submitCap (two-step with timelock).
      if (isMoolah) {
        return encodeFunctionData({
          abi: moolahSetCapAbi,
          functionName: 'setCap',
          args: [intent.marketParams, intent.newSupplyCap],
        });
      }
      return encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'submitCap',
        args: [intent.marketParams, intent.newSupplyCap],
      });
    case 'acceptCap':
      // Moolah: setCap is instant — no accept step. Encode as setCap with 0 cap
      // as a safety fallback; the UI should not show an Accept button on Moolah.
      if (isMoolah) {
        return encodeFunctionData({
          abi: moolahSetCapAbi,
          functionName: 'setCap',
          args: [intent.marketParams, 0n],
        });
      }
      return encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'acceptCap',
        args: [intent.marketParams],
      });
    case 'removeCap':
      return encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'revokePendingCap',
        args: [intent.marketId],
      });
    case 'setSupplyQueue':
      return encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'setSupplyQueue',
        args: [intent.newSupplyQueue],
      });
    case 'updateWithdrawQueue':
      return encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'updateWithdrawQueue',
        args: [intent.indexes],
      });
    case 'setFeeRecipient':
      return encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'setFeeRecipient',
        args: [intent.newFeeRecipient],
      });
    case 'setFee':
      return encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'setFee',
        args: [intent.newFee],
      });
    case 'setCurator':
      return encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'setCurator',
        args: [intent.newCurator],
      });
    case 'setManager':
      return encodeFunctionData({
        abi: [
          {
            inputs: [{ name: 'newManager', type: 'address' }],
            name: 'setManager',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
          },
        ],
        functionName: 'setManager',
        args: [intent.newManager],
      });
    case 'setIsAllocator':
      // Moolah: use OZ grantRole/revokeRole with the ALLOCATOR role constant.
      // MetaMorpho: use setIsAllocator(addr, bool).
      if (isMoolah) {
        return encodeFunctionData({
          abi: accessControlAbi,
          functionName: intent.isAllocator ? 'grantRole' : 'revokeRole',
          args: [MOOLAH_ALLOCATOR_ROLE, intent.addr],
        });
      }
      return encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'setIsAllocator',
        args: [intent.addr, intent.isAllocator],
      });
    case 'setTimelockDelay':
      return encodeFunctionData({
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
        args: [intent.newDelaySeconds],
      });
    case 'reallocate':
      return encodeFunctionData({
        abi: metaMorphoV1Abi,
        functionName: 'reallocate',
        args: [intent.allocations],
      });
    default: {
      const _exhaustive: never = intent;
      throw new Error(`encodeVaultCall: unhandled intent ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Deterministic salt keyed on intent contents so re-submitting the same op
 * returns the same `opId` — handy for dedupe and polling.
 */
function makeSalt(intent: WriteIntent, vault: Address): `0x${string}` {
  const payload = JSON.stringify(intent, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  return keccak256(
    encodeAbiParameters(parseAbiParameters('address, string'), [vault, payload]),
  );
}

/**
 * Parse a revert / simulation error into a short human-readable string.
 * Viem wraps chain errors in nested causes; pick the first useful one.
 */
// parseSimulationError was here — removed because simulation preflight
// is skipped for timelocked writes (the only current codepath). If
// direct-write preflight is ever re-enabled, re-add the parser.

export type PreparedWrite =
  | {
      type: 'direct';
      to: Address;
      abi: readonly unknown[];
      functionName: string;
      args: readonly unknown[];
      value: bigint;
    }
  | {
      type: 'invalid';
      /** Human-readable blocker so UI can render a disabled+tooltipped button. */
      reason: string;
    }
  | {
      type: 'timelocked';
      /** Which TimelockController to call. */
      timelock: Address;
      /** Vault address being operated on (passed through to `target`). */
      target: Address;
      value: bigint;
      calldata: `0x${string}`;
      predecessor: `0x${string}`;
      salt: `0x${string}`;
      delay: bigint;
      /** OZ v4 hash: keccak256(abi.encode(target,value,data,predecessor,salt)). */
      opId: `0x${string}`;
      /** Intent kind (for routing UI). */
      intentKind: WriteIntentKind;
      /** Human label for the proposal. */
      label: string;
    };

/**
 * Build the tx(s) needed to satisfy a write intent for a specific vault.
 * For Moolah vaults we need the `VaultSnapshot` to know which TimeLock to
 * target and what delay to use. Pass `null` snapshot for MetaMorpho.
 */
export async function prepareWrite(
  vault: Address,
  intent: WriteIntent,
  snapshot: VaultSnapshot | null,
  client?: PublicClient,
): Promise<PreparedWrite> {
  const flavor = snapshot?.flavor ?? 'metaMorphoV1';

  // setManager is a Moolah-only intent — it doesn't exist on MM V1.
  // Refuse to emit a direct tx on a MetaMorpho vault; UI gets the same
  // disabled+reason treatment as any other invalid.
  if (intent.kind === 'setManager' && flavor !== 'moolahVault') {
    return { type: 'invalid', reason: 'setManager is Moolah-only.' };
  }

  if (flavor === 'metaMorphoV1') {
    // Direct vault call, mirroring today's behavior.
    return directMetaMorpho(vault, intent);
  }

  // Moolah branch
  if (!snapshot) throw new Error('prepareWrite: Moolah vault requires a snapshot');

  const routing = INTENT_TIMELOCK[intent.kind];
  if (routing === 'direct') {
    // Reallocate and other exempt intents: still call the vault directly.
    return directMetaMorpho(vault, intent);
  }

  const timelockEntry = snapshot.timelocks.find((t) =>
    routing === 'curator' ? t.label === 'Curator' : t.label === 'Manager',
  );
  if (!timelockEntry?.address) {
    throw new Error(`prepareWrite: Moolah vault is missing its ${routing}TimeLock`);
  }

  const calldata = encodeVaultCall(intent, 'moolahVault');

  // For `setTimelockDelay`, OZ's `updateDelay` must be called BY the timelock
  // on itself — schedule it with target = timelock address.
  const target = intent.kind === 'setTimelockDelay' ? timelockEntry.address : vault;

  const predecessor =
    '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
  const salt = makeSalt(intent, vault);
  const delay = timelockEntry.minDelay;

  // NOTE: we intentionally skip the simulation preflight for timelocked
  // writes. The inner calldata targets the vault, which enforces role
  // checks on msg.sender. Under eth_call the sender is the curator's
  // wallet (or 0x0), NOT the TimeLock — so role-gated functions like
  // setFee / setIsAllocator always revert in simulation even when the
  // calldata is correct. The real execution happens when the TimeLock
  // calls the vault as msg.sender, which passes the on-chain check.

  // Hash the operation on-chain when a client is available — guarantees we
  // match OZ's keccak across versions (v4 vs v5).
  let opId: `0x${string}`;
  if (client) {
    try {
      opId = (await client.readContract({
        address: timelockEntry.address,
        abi: timelockControllerAbi,
        functionName: 'hashOperation',
        args: [target, 0n, calldata, predecessor, salt],
      })) as `0x${string}`;
    } catch {
      opId = computeOpIdFallback(target, 0n, calldata, predecessor, salt);
    }
  } else {
    opId = computeOpIdFallback(target, 0n, calldata, predecessor, salt);
  }

  return {
    type: 'timelocked',
    timelock: timelockEntry.address,
    target,
    value: 0n,
    calldata,
    predecessor,
    salt,
    delay,
    opId,
    intentKind: intent.kind,
    label: describeIntent(intent),
  };
}

function directMetaMorpho(vault: Address, intent: WriteIntent): PreparedWrite {
  switch (intent.kind) {
    case 'setCap':
      return {
        type: 'direct', to: vault, abi: metaMorphoV1Abi, value: 0n,
        functionName: 'submitCap', args: [intent.marketParams, intent.newSupplyCap],
      };
    case 'acceptCap':
      return {
        type: 'direct', to: vault, abi: metaMorphoV1Abi, value: 0n,
        functionName: 'acceptCap', args: [intent.marketParams],
      };
    case 'removeCap':
      return {
        type: 'direct', to: vault, abi: metaMorphoV1Abi, value: 0n,
        functionName: 'revokePendingCap', args: [intent.marketId],
      };
    case 'setSupplyQueue':
      return {
        type: 'direct', to: vault, abi: metaMorphoV1Abi, value: 0n,
        functionName: 'setSupplyQueue', args: [intent.newSupplyQueue],
      };
    case 'updateWithdrawQueue':
      return {
        type: 'direct', to: vault, abi: metaMorphoV1Abi, value: 0n,
        functionName: 'updateWithdrawQueue', args: [intent.indexes],
      };
    case 'setFeeRecipient':
      return {
        type: 'direct', to: vault, abi: metaMorphoV1Abi, value: 0n,
        functionName: 'setFeeRecipient', args: [intent.newFeeRecipient],
      };
    case 'setFee':
      return {
        type: 'direct', to: vault, abi: metaMorphoV1Abi, value: 0n,
        functionName: 'setFee', args: [intent.newFee],
      };
    case 'setCurator':
      return {
        type: 'direct', to: vault, abi: metaMorphoV1Abi, value: 0n,
        functionName: 'setCurator', args: [intent.newCurator],
      };
    case 'setManager':
      // `setManager` exists only on MoolahVault. On the MetaMorpho direct
      // path the `prepareWrite` invariant has already intercepted and
      // returned `{type:'invalid'}`. Keep an unreachable branch so the
      // switch stays exhaustive without carrying a broken cast.
      throw new Error('directMetaMorpho: setManager is Moolah-only (should have been intercepted earlier)');
    case 'setIsAllocator':
      return {
        type: 'direct', to: vault, abi: metaMorphoV1Abi, value: 0n,
        functionName: 'setIsAllocator', args: [intent.addr, intent.isAllocator],
      };
    case 'setTimelockDelay':
      return {
        type: 'direct', to: vault, abi: metaMorphoV1Abi, value: 0n,
        functionName: 'submitTimelock', args: [intent.newDelaySeconds],
      };
    case 'reallocate':
      return {
        type: 'direct', to: vault, abi: metaMorphoV1Abi, value: 0n,
        functionName: 'reallocate', args: [intent.allocations],
      };
    default: {
      const _exhaustive: never = intent;
      throw new Error(`directMetaMorpho: unhandled intent ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Fallback for hashing ops when the timelock isn't reachable. Matches OZ
 * TimelockController v4/v5 exactly: `keccak256(abi.encode(address, uint256,
 * bytes, bytes32, bytes32))`. We prefer the on-chain `hashOperation` path
 * (see `prepareWrite`) because it's guaranteed to match the target OZ
 * version; this fallback is only for offline / no-client paths (tests,
 * dedupe).
 */
export function computeOpIdFallback(
  target: Address,
  value: bigint,
  data: `0x${string}`,
  predecessor: `0x${string}`,
  salt: `0x${string}`,
): `0x${string}` {
  const encoded = encodeAbiParameters(
    parseAbiParameters('address, uint256, bytes, bytes32, bytes32'),
    [target, value, data, predecessor, salt],
  );
  return keccak256(encoded);
}

/** Short human-readable label — used in the Pending Proposals panel. */
function describeIntent(intent: WriteIntent): string {
  switch (intent.kind) {
    case 'setCap':
      return `submitCap — ${intent.newSupplyCap.toString()}`;
    case 'acceptCap':
      return 'acceptCap';
    case 'removeCap':
      return `revokePendingCap`;
    case 'setSupplyQueue':
      return `setSupplyQueue (${intent.newSupplyQueue.length} markets)`;
    case 'updateWithdrawQueue':
      return `updateWithdrawQueue`;
    case 'setFeeRecipient':
      return `setFeeRecipient`;
    case 'setFee':
      return `setFee — ${intent.newFee.toString()}`;
    case 'setCurator':
      return `setCurator`;
    case 'setManager':
      return `setManager`;
    case 'setIsAllocator':
      return `${intent.isAllocator ? 'grantAllocator' : 'revokeAllocator'}`;
    case 'setTimelockDelay':
      return `updateDelay — ${intent.newDelaySeconds.toString()}s`;
    case 'reallocate':
      return `reallocate (${intent.allocations.length} markets)`;
  }
}
