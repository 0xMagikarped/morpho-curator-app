/**
 * Morpho custom-error ABI fragments (PR 1 — audit finding D5).
 *
 * SOURCE OF TRUTH — verbatim, machine-extracted (no hand-rolling):
 *   package : @morpho-org/blue-sdk-viem@4.5.0 (already a dependency; no package.json change)
 *   file    : node_modules/@morpho-org/blue-sdk-viem/lib/esm/abis.js
 *   method  : <abi>.filter(e => e.type === 'error'), serialized as literal `as const`.
 *   date    : 2026-05-16
 *
 * These are spread into the partial local ABIs in this directory so viem's
 * decodeErrorResult / ContractFunctionRevertedError can resolve named Morpho
 * reverts (AboveMaxTimelock, NoPendingValue, AlreadyPending, MarketNotCreated, ...)
 * instead of surfacing an opaque "execution reverted".
 *
 * OMISSIONS (deliberate — do not "fix" by inventing):
 *   - "AboveAbsoluteCap": NOT a verbatim Morpho error name. It was an illustrative
 *     label in audits/AUDIT_2026-05-16.md (D5). The real cap errors are present
 *     under their authoritative names (V1: AllCapsReached / SupplyCapExceeded;
 *     V2: AbsoluteCapExceeded / AbsoluteCapNotDecreasing / ...).
 *   - Factory & VaultV2 registry ABIs expose 0 custom errors in the SDK (they use
 *     string reverts); intentionally no fragments are exported for them.
 *
 * Regenerate: re-run the extraction in audits/FIX_LOG.md (PR 1).
 */

/** 55 custom errors — verbatim from @morpho-org/blue-sdk-viem `metaMorphoAbi`. */
export const MORPHO_METAMORPHO_V1_ERRORS = [
  {"type":"error","name":"AboveMaxTimelock","inputs":[]},
  {"type":"error","name":"AddressEmptyCode","inputs":[{"name":"target","type":"address","internalType":"address"}]},
  {"type":"error","name":"AddressInsufficientBalance","inputs":[{"name":"account","type":"address","internalType":"address"}]},
  {"type":"error","name":"AllCapsReached","inputs":[]},
  {"type":"error","name":"AlreadyPending","inputs":[]},
  {"type":"error","name":"AlreadySet","inputs":[]},
  {"type":"error","name":"BelowMinTimelock","inputs":[]},
  {"type":"error","name":"DuplicateMarket","inputs":[{"name":"id","type":"bytes32","internalType":"Id"}]},
  {"type":"error","name":"ECDSAInvalidSignature","inputs":[]},
  {"type":"error","name":"ECDSAInvalidSignatureLength","inputs":[{"name":"length","type":"uint256","internalType":"uint256"}]},
  {"type":"error","name":"ECDSAInvalidSignatureS","inputs":[{"name":"s","type":"bytes32","internalType":"bytes32"}]},
  {"type":"error","name":"ERC20InsufficientAllowance","inputs":[{"name":"spender","type":"address","internalType":"address"},{"name":"allowance","type":"uint256","internalType":"uint256"},{"name":"needed","type":"uint256","internalType":"uint256"}]},
  {"type":"error","name":"ERC20InsufficientBalance","inputs":[{"name":"sender","type":"address","internalType":"address"},{"name":"balance","type":"uint256","internalType":"uint256"},{"name":"needed","type":"uint256","internalType":"uint256"}]},
  {"type":"error","name":"ERC20InvalidApprover","inputs":[{"name":"approver","type":"address","internalType":"address"}]},
  {"type":"error","name":"ERC20InvalidReceiver","inputs":[{"name":"receiver","type":"address","internalType":"address"}]},
  {"type":"error","name":"ERC20InvalidSender","inputs":[{"name":"sender","type":"address","internalType":"address"}]},
  {"type":"error","name":"ERC20InvalidSpender","inputs":[{"name":"spender","type":"address","internalType":"address"}]},
  {"type":"error","name":"ERC2612ExpiredSignature","inputs":[{"name":"deadline","type":"uint256","internalType":"uint256"}]},
  {"type":"error","name":"ERC2612InvalidSigner","inputs":[{"name":"signer","type":"address","internalType":"address"},{"name":"owner","type":"address","internalType":"address"}]},
  {"type":"error","name":"ERC4626ExceededMaxDeposit","inputs":[{"name":"receiver","type":"address","internalType":"address"},{"name":"assets","type":"uint256","internalType":"uint256"},{"name":"max","type":"uint256","internalType":"uint256"}]},
  {"type":"error","name":"ERC4626ExceededMaxMint","inputs":[{"name":"receiver","type":"address","internalType":"address"},{"name":"shares","type":"uint256","internalType":"uint256"},{"name":"max","type":"uint256","internalType":"uint256"}]},
  {"type":"error","name":"ERC4626ExceededMaxRedeem","inputs":[{"name":"owner","type":"address","internalType":"address"},{"name":"shares","type":"uint256","internalType":"uint256"},{"name":"max","type":"uint256","internalType":"uint256"}]},
  {"type":"error","name":"ERC4626ExceededMaxWithdraw","inputs":[{"name":"owner","type":"address","internalType":"address"},{"name":"assets","type":"uint256","internalType":"uint256"},{"name":"max","type":"uint256","internalType":"uint256"}]},
  {"type":"error","name":"FailedInnerCall","inputs":[]},
  {"type":"error","name":"InconsistentAsset","inputs":[{"name":"id","type":"bytes32","internalType":"Id"}]},
  {"type":"error","name":"InconsistentReallocation","inputs":[]},
  {"type":"error","name":"InvalidAccountNonce","inputs":[{"name":"account","type":"address","internalType":"address"},{"name":"currentNonce","type":"uint256","internalType":"uint256"}]},
  {"type":"error","name":"InvalidMarketRemovalNonZeroCap","inputs":[{"name":"id","type":"bytes32","internalType":"Id"}]},
  {"type":"error","name":"InvalidMarketRemovalNonZeroSupply","inputs":[{"name":"id","type":"bytes32","internalType":"Id"}]},
  {"type":"error","name":"InvalidMarketRemovalTimelockNotElapsed","inputs":[{"name":"id","type":"bytes32","internalType":"Id"}]},
  {"type":"error","name":"InvalidShortString","inputs":[]},
  {"type":"error","name":"MarketNotCreated","inputs":[]},
  {"type":"error","name":"MarketNotEnabled","inputs":[{"name":"id","type":"bytes32","internalType":"Id"}]},
  {"type":"error","name":"MathOverflowedMulDiv","inputs":[]},
  {"type":"error","name":"MaxFeeExceeded","inputs":[]},
  {"type":"error","name":"MaxQueueLengthExceeded","inputs":[]},
  {"type":"error","name":"NoPendingValue","inputs":[]},
  {"type":"error","name":"NonZeroCap","inputs":[]},
  {"type":"error","name":"NotAllocatorRole","inputs":[]},
  {"type":"error","name":"NotCuratorNorGuardianRole","inputs":[]},
  {"type":"error","name":"NotCuratorRole","inputs":[]},
  {"type":"error","name":"NotEnoughLiquidity","inputs":[]},
  {"type":"error","name":"NotGuardianRole","inputs":[]},
  {"type":"error","name":"OwnableInvalidOwner","inputs":[{"name":"owner","type":"address","internalType":"address"}]},
  {"type":"error","name":"OwnableUnauthorizedAccount","inputs":[{"name":"account","type":"address","internalType":"address"}]},
  {"type":"error","name":"PendingCap","inputs":[{"name":"id","type":"bytes32","internalType":"Id"}]},
  {"type":"error","name":"PendingRemoval","inputs":[]},
  {"type":"error","name":"SafeCastOverflowedUintDowncast","inputs":[{"name":"bits","type":"uint8","internalType":"uint8"},{"name":"value","type":"uint256","internalType":"uint256"}]},
  {"type":"error","name":"SafeERC20FailedOperation","inputs":[{"name":"token","type":"address","internalType":"address"}]},
  {"type":"error","name":"StringTooLong","inputs":[{"name":"str","type":"string","internalType":"string"}]},
  {"type":"error","name":"SupplyCapExceeded","inputs":[{"name":"id","type":"bytes32","internalType":"Id"}]},
  {"type":"error","name":"TimelockNotElapsed","inputs":[]},
  {"type":"error","name":"UnauthorizedMarket","inputs":[{"name":"id","type":"bytes32","internalType":"Id"}]},
  {"type":"error","name":"ZeroAddress","inputs":[]},
  {"type":"error","name":"ZeroFeeRecipient","inputs":[]},
] as const;

/** 36 custom errors — verbatim from @morpho-org/blue-sdk-viem `vaultV2Abi`. */
export const MORPHO_METAMORPHO_V2_ERRORS = [
  {"type":"error","name":"Abdicated","inputs":[]},
  {"type":"error","name":"AbsoluteCapExceeded","inputs":[]},
  {"type":"error","name":"AbsoluteCapNotDecreasing","inputs":[]},
  {"type":"error","name":"AbsoluteCapNotIncreasing","inputs":[]},
  {"type":"error","name":"AutomaticallyTimelocked","inputs":[]},
  {"type":"error","name":"CannotReceiveAssets","inputs":[]},
  {"type":"error","name":"CannotReceiveShares","inputs":[]},
  {"type":"error","name":"CannotSendAssets","inputs":[]},
  {"type":"error","name":"CannotSendShares","inputs":[]},
  {"type":"error","name":"CastOverflow","inputs":[]},
  {"type":"error","name":"DataAlreadyPending","inputs":[]},
  {"type":"error","name":"DataNotTimelocked","inputs":[]},
  {"type":"error","name":"FeeInvariantBroken","inputs":[]},
  {"type":"error","name":"FeeTooHigh","inputs":[]},
  {"type":"error","name":"InvalidSigner","inputs":[]},
  {"type":"error","name":"MaxRateTooHigh","inputs":[]},
  {"type":"error","name":"NoCode","inputs":[]},
  {"type":"error","name":"NotAdapter","inputs":[]},
  {"type":"error","name":"NotInAdapterRegistry","inputs":[]},
  {"type":"error","name":"PenaltyTooHigh","inputs":[]},
  {"type":"error","name":"PermitDeadlineExpired","inputs":[]},
  {"type":"error","name":"RelativeCapAboveOne","inputs":[]},
  {"type":"error","name":"RelativeCapExceeded","inputs":[]},
  {"type":"error","name":"RelativeCapNotDecreasing","inputs":[]},
  {"type":"error","name":"RelativeCapNotIncreasing","inputs":[]},
  {"type":"error","name":"TimelockNotDecreasing","inputs":[]},
  {"type":"error","name":"TimelockNotExpired","inputs":[]},
  {"type":"error","name":"TimelockNotIncreasing","inputs":[]},
  {"type":"error","name":"TransferFromReturnedFalse","inputs":[]},
  {"type":"error","name":"TransferFromReverted","inputs":[]},
  {"type":"error","name":"TransferReturnedFalse","inputs":[]},
  {"type":"error","name":"TransferReverted","inputs":[]},
  {"type":"error","name":"Unauthorized","inputs":[]},
  {"type":"error","name":"ZeroAbsoluteCap","inputs":[]},
  {"type":"error","name":"ZeroAddress","inputs":[]},
  {"type":"error","name":"ZeroAllocation","inputs":[]},
] as const;

/** 12 custom errors — verbatim from @morpho-org/blue-sdk-viem `publicAllocatorAbi`. */
export const MORPHO_PUBLIC_ALLOCATOR_ERRORS = [
  {"inputs":[],"name":"AlreadySet","type":"error"},
  {"inputs":[],"name":"DepositMarketInWithdrawals","type":"error"},
  {"inputs":[],"name":"EmptyWithdrawals","type":"error"},
  {"inputs":[],"name":"InconsistentWithdrawals","type":"error"},
  {"inputs":[],"name":"IncorrectFee","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"MarketNotEnabled","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"MaxInflowExceeded","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"MaxOutflowExceeded","type":"error"},
  {"inputs":[],"name":"MaxSettableFlowCapExceeded","type":"error"},
  {"inputs":[],"name":"NotAdminNorVaultOwner","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"NotEnoughSupply","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"WithdrawZero","type":"error"},
] as const;

/** 9 custom errors — verbatim from @morpho-org/blue-sdk-viem `morphoVaultV1AdapterAbi`. */
export const MORPHO_VAULT_V1_ADAPTER_ERRORS = [
  {"type":"error","name":"ApproveReturnedFalse","inputs":[]},
  {"type":"error","name":"ApproveReverted","inputs":[]},
  {"type":"error","name":"AssetMismatch","inputs":[]},
  {"type":"error","name":"CannotSkimMorphoVaultV1Shares","inputs":[]},
  {"type":"error","name":"InvalidData","inputs":[]},
  {"type":"error","name":"NoCode","inputs":[]},
  {"type":"error","name":"NotAuthorized","inputs":[]},
  {"type":"error","name":"TransferReturnedFalse","inputs":[]},
  {"type":"error","name":"TransferReverted","inputs":[]},
] as const;

/** 7 custom errors — verbatim from @morpho-org/blue-sdk-viem `morphoMarketV1AdapterAbi`. */
export const MORPHO_MARKET_V1_ADAPTER_ERRORS = [
  {"type":"error","name":"ApproveReturnedFalse","inputs":[]},
  {"type":"error","name":"ApproveReverted","inputs":[]},
  {"type":"error","name":"LoanAssetMismatch","inputs":[]},
  {"type":"error","name":"NoCode","inputs":[]},
  {"type":"error","name":"NotAuthorized","inputs":[]},
  {"type":"error","name":"TransferReturnedFalse","inputs":[]},
  {"type":"error","name":"TransferReverted","inputs":[]},
] as const;

/** 16 custom errors — verbatim from @morpho-org/blue-sdk-viem `morphoMarketV1AdapterV2Abi`. */
export const MORPHO_MARKET_V1_ADAPTER_V2_ERRORS = [
  {"inputs":[],"name":"Abdicated","type":"error"},
  {"inputs":[],"name":"ApproveReturnedFalse","type":"error"},
  {"inputs":[],"name":"ApproveReverted","type":"error"},
  {"inputs":[],"name":"AutomaticallyTimelocked","type":"error"},
  {"inputs":[],"name":"DataAlreadyPending","type":"error"},
  {"inputs":[],"name":"DataNotTimelocked","type":"error"},
  {"inputs":[],"name":"IrmMismatch","type":"error"},
  {"inputs":[],"name":"LoanAssetMismatch","type":"error"},
  {"inputs":[],"name":"NoCode","type":"error"},
  {"inputs":[],"name":"SharePriceAboveOne","type":"error"},
  {"inputs":[],"name":"TimelockNotDecreasing","type":"error"},
  {"inputs":[],"name":"TimelockNotExpired","type":"error"},
  {"inputs":[],"name":"TimelockNotIncreasing","type":"error"},
  {"inputs":[],"name":"TransferReturnedFalse","type":"error"},
  {"inputs":[],"name":"TransferReverted","type":"error"},
  {"inputs":[],"name":"Unauthorized","type":"error"},
] as const;
