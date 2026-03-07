import { keccak256, encodePacked } from 'viem';

/**
 * Generate a deterministic salt for CREATE2 vault deployment.
 * Based on owner address + vault name + a nonce for uniqueness.
 */
export function generateVaultSalt(
  owner: `0x${string}`,
  name: string,
  nonce?: number,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ['address', 'string', 'uint256'],
      [owner, name, BigInt(nonce ?? Date.now())],
    ),
  );
}

/**
 * Generate a random salt (32 bytes).
 */
export function generateRandomSalt(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}
