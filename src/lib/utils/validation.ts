import { parseUnits } from 'viem';

export interface AmountValidation {
  valid: boolean;
  amount?: bigint;
  error?: string;
}

/**
 * Validate a token amount input string using viem's parseUnits.
 * Returns the parsed bigint amount if valid, or an error message.
 */
export function validateAmount(
  input: string,
  decimals: number,
  maxBalance?: bigint,
): AmountValidation {
  if (!input || input.trim() === '') {
    return { valid: false, error: 'Enter an amount' };
  }

  if (!/^\d+\.?\d*$/.test(input)) {
    return { valid: false, error: 'Invalid number' };
  }

  const parts = input.split('.');
  if (parts[1] && parts[1].length > decimals) {
    return { valid: false, error: `Max ${decimals} decimal places` };
  }

  try {
    const amount = parseUnits(input, decimals);
    if (amount === 0n) {
      return { valid: false, error: 'Amount must be greater than 0' };
    }
    if (maxBalance !== undefined && amount > maxBalance) {
      return { valid: false, error: 'Exceeds available balance' };
    }
    return { valid: true, amount };
  } catch {
    return { valid: false, error: 'Number too large' };
  }
}

/**
 * Chains supported by the Morpho GraphQL API.
 * Skip API entirely for unlisted chains — go straight to RPC.
 */
const MORPHO_API_SUPPORTED_CHAINS = [1, 8453] as const;

export function isMorphoApiSupported(chainId: number): boolean {
  return (MORPHO_API_SUPPORTED_CHAINS as readonly number[]).includes(chainId);
}
